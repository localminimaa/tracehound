import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spaces calls out to stay under a provider's requests-per-second limit.
export function limiter(rps: number) {
  let next = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // Replaying recorded answers needs no spacing; the rare live miss retries on 429 anyway
    if (process.env.HTTP_CACHE) return fn();
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + 1000 / rps;
    if (at > now) await sleep(at - now);
    return fn();
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// HTTP_CACHE=<dir> replays recorded responses and records the ones it has not seen (the regression set
// runs on it: no credits, same answers every time). Keys leave the API key out, so they can be shared.
export async function fetchJson(url: string, init?: RequestInit, tries = 4): Promise<any> {
  const dir = process.env.HTTP_CACHE;
  if (!dir) return fetchLive(url, init, tries);
  const key = createHash("sha1").update(`${init?.method ?? "GET"} ${redact(url)} ${typeof init?.body === "string" ? init.body : ""}`).digest("hex");
  const file = join(dir, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const body = await fetchLive(url, init, tries);
  // Some APIs (Etherscan) report a rate limit inside a 200 answer; recording it would replay the failure
  if (/rate limit/i.test(`${body?.result ?? ""} ${body?.message ?? ""} ${body?.error ?? ""}`)) return body;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  cacheMisses++;
  if (process.env.HTTP_CACHE_LOG) console.error(`live: ${redact(url).slice(0, 140)} ${typeof init?.body === "string" ? init.body.slice(0, 80) : ""}`);
  return body;
}
let cacheMisses = 0;
export const cacheMissCount = () => cacheMisses;

async function fetchLive(url: string, init?: RequestInit, tries = 4): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        last = new HttpError(res.status, `${res.status} ${redact(url)}`);
        await sleep(800 * 2 ** i);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, `${res.status} ${redact(url)}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      last = e;
      await sleep(800 * 2 ** i);
    }
  }
  throw last;
}

// Keep API keys out of logs and error messages.
export const redact = (url: string) => url.replace(/(api-?key|apikey)=[^&]+/gi, "$1=***");

export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function envInt(name: string, def: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export function fmtAmount(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
