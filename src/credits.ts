// Daily Helius credit budget shared by every process: the server, launchd's sampler and ring scan, the CLI.
// Each process appends what it spent to data/credits/<UTC day>.log; today's use is the sum of that file.
// The free plan has ~1M credits a month, so the default day is a 30th of it.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

export const DAILY_CREDITS = Number(process.env.HELIUS_DAILY_CREDITS) || 33_000;
// Share of the day a kind of work may start under. Background work stops early so the site always has budget left;
// on the site, free checks stop at 85% and the last 15% is kept for paying users.
const SHARE = { sample: 0.4, smart: 0.5, watch: 0.55, free: 0.85, web: 1 } as const;
export type Work = keyof typeof SHARE;

const dir = new URL("../data/credits/", import.meta.url);
const day = () => new Date().toISOString().slice(0, 10);
let pending = 0;

export function addCredits(n: number) {
  // Replayed answers (the regression set) cost nothing
  if (!process.env.HTTP_CACHE) pending += n;
}

export function flushCredits() {
  if (!pending) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(new URL(`${day()}.log`, dir), `${Math.floor(Date.now() / 1000)} ${process.argv[1]?.split("/").pop() ?? "?"} ${pending}\n`);
  pending = 0;
}
process.on("exit", flushCredits);
// launchd and Ctrl-C stop a process with a signal, which skips "exit" unless the signal is handled
for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => process.exit(0));
setInterval(flushCredits, 60_000).unref();

export function creditsToday(): number {
  const f = new URL(`${day()}.log`, dir);
  const logged = existsSync(f) ? readFileSync(f, "utf8").split("\n").reduce((s, l) => s + (Number(l.split(" ")[2]) || 0), 0) : 0;
  return logged + pending;
}

// May this kind of work start now? The reason is for the log or the person on the site.
export function allowed(work: Work): { ok: boolean; used: number; reason: string } {
  const used = creditsToday();
  const cap = DAILY_CREDITS * SHARE[work];
  return { ok: used < cap, used, reason: `${used.toLocaleString()} of ${DAILY_CREDITS.toLocaleString()} Helius credits used today (UTC), ${work} work stops at ${Math.round(SHARE[work] * 100)}%` };
}
