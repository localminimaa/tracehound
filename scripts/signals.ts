// Which token-check signals came true: for each, how often a token with it fell 80%+ within 24 h of its first
// check, against tokens without it. Same judged set as the backtest and the site's accuracy table.
// Usage: npm run signals
import { signalStats } from "../src/signals.ts";
import { firstChecks, HORIZON_H, LATE_H, loadOutcomes } from "./outcomes.ts";

const out = loadOutcomes();
const rows = firstChecks().filter((c) => c.market.fdv && out[c.mint] && out[c.mint].hours <= LATE_H)
  .map((c) => ({ titles: c.reasons.map((r) => r.title), change: out[c.mint].fdv / out[c.mint].fdvAtCheck - 1 }));
const st = signalStats(rows);
const pct = (x: number | null) => (x == null ? "  -" : `${Math.round(x * 100)}%`.padStart(4));
console.log(`${st.judged} tokens with a ${HORIZON_H} h outcome, ${pct(st.base)} of them fell 80%+\n`);
console.log("signal                                      n  with  w/o   diff");
for (const s of st.signals) {
  const d = s.rate != null && s.rateWithout != null ? Math.round((s.rate - s.rateWithout) * 100) : null;
  console.log(`${s.name.slice(0, 40).padEnd(40)} ${String(s.n).padStart(4)}  ${pct(s.rate)} ${pct(s.rateWithout)}  ${s.enough && d != null ? `${d >= 0 ? "+" : ""}${d}`.padStart(4) : " few"}`);
}
console.log(`\nA signal needs ${st.minN}+ tokens with and without it before its difference means anything.`);
