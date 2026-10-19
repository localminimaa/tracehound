// What happened to a checked token 24 h later. Recorded once per token by the collector and read by the
// backtest, so every verdict is judged on the same horizon instead of "whenever the backtest ran".
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { marketOf, type TokenCheck } from "../src/tokencheck.ts";

export const HORIZON_H = 24;
export const LATE_H = 36; // recorded later than this (the Mac was asleep) is not the same horizon

export interface Outcome {
  checkedAt: number;
  fdvAtCheck: number;
  fdv: number; // 0 when the token has no pool anymore
  hours: number; // actual age when recorded
}

const file = new URL("../data/outcomes.json", import.meta.url);
const dir = new URL("../data/tokens/", import.meta.url);

export const loadOutcomes = (): Record<string, Outcome> => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

// The first check of every token: later re-checks would judge the verdict with hindsight.
// Only the sampler's own picks (and old checks made before sources were recorded): a token someone chose
// to check on the site was picked for a reason, and that would bend the comparison.
export function firstChecks(): TokenCheck[] {
  const first = new Map<string, TokenCheck>();
  if (!existsSync(dir)) return [];
  // ._ files are macOS metadata that exFAT keeps next to every written file
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."))) {
    const c: TokenCheck = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    if (c.chain && c.chain !== "solana") continue; // outcomes are priced on Solana only
    if (!first.has(c.mint) || c.checkedAt < first.get(c.mint)!.checkedAt) first.set(c.mint, c);
  }
  return [...first.values()].filter((c) => (c.source ?? "sample") === "sample");
}

// Records the value of every token that reached the horizon. Costs only DexScreener calls.
export async function recordDue(): Promise<number> {
  const out = loadOutcomes();
  const now = Math.floor(Date.now() / 1000);
  const due = firstChecks().filter((c) => !out[c.mint] && c.market.fdv && now - c.checkedAt >= HORIZON_H * 3600);
  if (!due.length) return 0;
  const mk = await marketOf(due.map((c) => c.mint));
  for (const c of due) {
    out[c.mint] = { checkedAt: c.checkedAt, fdvAtCheck: c.market.fdv!, fdv: mk.get(c.mint)?.fdv ?? 0, hours: Math.round((now - c.checkedAt) / 360) / 10 };
  }
  writeFileSync(file, JSON.stringify(out, null, 1));
  return due.length;
}
