// How well each token-check signal predicted a crash. A reason's title names its signal (titles carry numbers,
// so they are matched by pattern, which also covers checks saved before signals had names). For every signal:
// of the judged tokens that had it, how many fell 80%+ in 24 h, against the tokens that did not.
export const SIGNALS: [id: string, name: string, re: RegExp][] = [
  ["mint", "Mint authority still set", /can still mint|owner can mint/i],
  ["freeze", "Freeze authority still set", /can be frozen/i],
  ["mixer_dev", "Developer funded through a mixer", /funded through a mixer/i],
  ["ring_playbook", "Launched with a ring's playbook", /known pump ring's playbook/i],
  ["fresh_dev", "Fresh developer wallet", /^Fresh developer wallet/],
  ["launch_farm", "Developer's circle runs a launch farm", /circle launched \d+ other token/],
  ["bundle", "Early buyers funded by the developer", /early buyer\(s\) are funded by the developer/],
  ["snipers", "Bought in the launch block", /wallets bought in the (launch block|first)/],
  ["dev_exit", "Developer sold 90%+ of the launch bag", /already sold \d+% of the launch bag/],
  ["dev_sold_half", "Developer sold half the launch bag", /^The developer sold \d+% of the launch bag/],
  ["dev_ring", "Developer funded from a ring", /funded from the same ring/],
  ["ring_buyers", "Ring wallets among early buyers", /belong to a known pump ring/],
  ["ring_holds", "Ring wallets hold supply", /pump-ring wallets hold/],
  ["fresh_holders", "Fresh wallets among top holders", /top holders are wallets created/],
  ["cluster_holds", "Developer's wallets hold 10%+", /developer's wallets still hold/],
  ["dev_holds", "Developer or creator holds 10%+", /(developer|creator) holds [\d.]+% of supply/],
  ["top10", "Top 10 hold 50%+", /^Top 10 wallets hold/],
  ["fan_out", "Token handed out to many wallets", /handing the token out/],
  ["sweep", "Token swept into one wallet", /wallets are sending the token to/],
  ["bot_trading", "Bot-made trading", /bot-made/],
  ["lp_unlocked", "LP tokens not burned", /of the pool's LP tokens are burned/],
  ["reused_socials", "Socials reused from earlier tokens", /^Same .* as \d+ earlier token/],
  ["honeypot", "Cannot be sold", /cannot sell/i],
  ["tax", "Trading tax 10%+", /^Trading tax/],
  ["owner_switches", "Owner can block or tax selling", /^The owner can (?!mint)/],
  ["not_renounced", "Ownership not really renounced", /not really renounced/],
  ["unverified", "Contract source not verified", /not verified/],
  ["proxy", "Upgradeable contract", /^Upgradeable contract/],
  ["honeypot_creator", "Creator made honeypots before", /made honeypots before/],
];
export const signalOf = (title: string) => SIGNALS.find(([, , re]) => re.test(title))?.[0] ?? null;

const MIN_N = 5; // fewer tokens than this tell nothing yet

export interface SignalStat { id: string; name: string; n: number; fell: number; rate: number | null; nWithout: number; rateWithout: number | null; median: number | null; enough: boolean }

// rows: one per judged token, the titles of its reasons and its value change 24 h after the first check
export function signalStats(rows: { titles: string[]; change: number }[]) {
  const fell = (c: number) => c <= -0.8;
  const has = rows.map((r) => new Set(r.titles.map(signalOf).filter(Boolean)));
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const stats: SignalStat[] = SIGNALS.map(([id, name]) => {
    const w = rows.filter((_, i) => has[i].has(id)), wo = rows.filter((_, i) => !has[i].has(id));
    return {
      id, name, n: w.length, fell: w.filter((r) => fell(r.change)).length,
      rate: w.length ? w.filter((r) => fell(r.change)).length / w.length : null,
      nWithout: wo.length, rateWithout: wo.length ? wo.filter((r) => fell(r.change)).length / wo.length : null,
      median: median(w.map((r) => r.change)), enough: w.length >= MIN_N && wo.length >= MIN_N,
    };
  }).filter((s) => s.n > 0);
  stats.sort((a, b) => Number(b.enough) - Number(a.enough) || (b.rate ?? 0) - (b.rateWithout ?? 0) - ((a.rate ?? 0) - (a.rateWithout ?? 0)));
  return { judged: rows.length, base: rows.length ? rows.filter((r) => fell(r.change)).length / rows.length : null, minN: MIN_N, signals: stats };
}
