// Did the verdicts come true? Compares each token's value at its first check with its value 24 h later
// (recorded by scripts/sample.ts) and sums that up per verdict group.
// Usage: node scripts/backtest.ts          24 h outcomes only, the fair comparison
//        node scripts/backtest.ts --now    value right now, for tokens not yet 24 h old (ages differ)
import { marketOf } from "../src/tokencheck.ts";
import { firstChecks, HORIZON_H, LATE_H, loadOutcomes } from "./outcomes.ts";

const now = process.argv.includes("--now");
const checks = firstChecks().filter((c) => c.market.fdv);
const rows: { symbol: string; verdict: string; risk: number; before: number; after: number; hours: number }[] = [];

if (now) {
  const mk = await marketOf(checks.map((c) => c.mint));
  const t = Date.now() / 1000;
  for (const c of checks) rows.push({ symbol: c.symbol, verdict: c.verdict, risk: c.risk, before: c.market.fdv!, after: mk.get(c.mint)?.fdv ?? 0, hours: (t - c.checkedAt) / 3600 });
} else {
  const out = loadOutcomes();
  for (const c of checks) {
    const o = out[c.mint];
    if (o && o.hours <= LATE_H) rows.push({ symbol: c.symbol, verdict: c.verdict, risk: c.risk, before: o.fdvAtCheck, after: o.fdv, hours: o.hours });
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;

console.log(now
  ? `${rows.length} tokens, value now (ages differ, so groups are not on one horizon)\n`
  : `${rows.length} tokens with a ${HORIZON_H} h outcome (of ${checks.length} checked); --now for the rest\n`);
for (const r of rows) {
  console.log(`${r.symbol.slice(0, 12).padEnd(12)} ${r.verdict.padEnd(6)} ${String(r.risk).padStart(3)}  $${Math.round(r.before).toLocaleString()} → $${Math.round(r.after).toLocaleString()}  ${pct(r.after / r.before - 1)}  ${Math.round(r.hours)} h`);
}
console.log(`\nverdict   n  fell 80%+  halved  grew 2x+  median change`);
for (const v of ["low", "medium", "high"]) {
  const ch = rows.filter((r) => r.verdict === v).map((r) => r.after / r.before - 1);
  const n = (f: (x: number) => boolean) => String(ch.filter(f).length);
  console.log(`${v.padEnd(7)} ${String(ch.length).padStart(3)}  ${n((x) => x <= -0.8).padStart(9)}  ${n((x) => x <= -0.5).padStart(6)}  ${n((x) => x >= 1).padStart(8)}  ${ch.length ? pct(median(ch)) : "-"}`);
}
console.log(`\nA token with no pool counts as -100%. A few dozen tokens per group are needed before the numbers mean anything.`);
