// The hound on paper: rules on top of the token check, played with pretend money on the tokens the sampler picks.
// Every sampled check is a chance to buy. The agent skips what the check calls high risk, sizes the rest by the
// score, and sells when the developer sells, the price doubles, it falls by half, the pool is gone or a day has
// passed. Next to it runs the naive baseline: the same tokens, all of them, the same money, held for a day.
// Real money only after weeks of the agent beating that baseline. State: data/agent.json. Prices: DexScreener.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { helius } from "./chains/solana.ts";
import { allowed } from "./credits.ts";
import { evmBalances } from "./evmtoken.ts";
import { marketOf, type TokenCheck } from "./tokencheck.ts";
import { firstChecks } from "../scripts/outcomes.ts";
import { fmtAmount } from "./util.ts";

// The rules. Points are hand-set like the score's; they get tuned once the signal table (#1) has enough tokens.
export const RULES = {
  stake: 100, // USD for a token with no risk; less as the score rises
  minStake: 10,
  minLiquidity: 3000, // a pool thinner than this cannot take even a paper order without moving the price
  fee: 0.02, // swap fee and slippage, each way
  takeProfit: 2, // sell at 2x
  stopLoss: 0.5, // sell at -50%
  devSold: 0.5, // sell when the developer's wallets dumped half of what they held at the check
  holdH: 24,
};
const NAIVE_STAKE = 100;

export interface Trade {
  check: string; // the check id, mint-checkedAt
  mint: string;
  symbol: string;
  risk: number;
  verdict: TokenCheck["verdict"];
  openedAt: number;
  entryFdv: number;
  stake: number; // 0: the agent skipped it, only the baseline holds it
  skip?: string; // why the agent did not buy
  devStart?: number; // tokens the developer's wallets held at the check
  lastFdv?: number;
  closedAt?: number;
  exitFdv?: number;
  exit?: "take_profit" | "stop_loss" | "dev_sold" | "pool_gone" | "time";
  naiveFdv?: number; // value after holdH, for the baseline
}
export interface DiaryDay { day: string; text: string; post: string; agent: number; naive: number }
interface State { since: number; trades: Trade[]; diary: DiaryDay[] }

const file = new URL("../data/agent.json", import.meta.url);
const load = (): State => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { since: Math.floor(Date.now() / 1000), trades: [], diary: [] });
function save(s: State) {
  writeFileSync(`${file.pathname}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${file.pathname}.tmp`, file.pathname);
}

const now = () => Math.floor(Date.now() / 1000);
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
// What a stake is worth when the token's value went from a to b, after paying the fee both ways
const worth = (stake: number, a: number, b: number) => stake * (1 - RULES.fee) ** 2 * (b / a);
const pnl = (t: Trade) => (t.stake && t.closedAt ? worth(t.stake, t.entryFdv, t.exitFdv!) - t.stake : 0);
const naivePnl = (t: Trade) => (t.naiveFdv !== undefined ? worth(NAIVE_STAKE, t.entryFdv, t.naiveFdv) - NAIVE_STAKE : 0);

// What the developer's wallets hold now. Solana: one look at the largest holders and their owners, so the cost does
// not grow with the number of wallets; a wallet that fell out of the top 20 counts as sold out. Shared with the bot.
export async function clusterHeld(chain: string, mint: string, wallets: string[]): Promise<number | null> {
  if (!wallets.length) return null;
  if (chain !== "solana") return Object.values(await evmBalances(chain, mint, wallets)).reduce((a, b) => a + b, 0);
  const h = helius();
  const largest: any[] = (await h.rpc("getTokenLargestAccounts", [mint]))?.value ?? [];
  const accs: any[] = (await h.rpc("getMultipleAccounts", [largest.map((l) => l.address), { encoding: "jsonParsed" }]))?.value ?? [];
  const mine = new Set(wallets);
  return largest.reduce((s, l, i) => s + (mine.has(accs[i]?.data?.parsed?.info?.owner) ? Number(l.uiAmount ?? 0) : 0), 0);
}

function decide(c: TokenCheck): Pick<Trade, "stake" | "skip"> {
  if (c.verdict === "high") return { stake: 0, skip: `high risk, ${c.risk}` };
  if ((c.market.liquidityUsd ?? 0) < RULES.minLiquidity) return { stake: 0, skip: `pool of $${fmtAmount(c.market.liquidityUsd ?? 0)} too thin` };
  return { stake: Math.max(RULES.minStake, Math.round(RULES.stake * (1 - c.risk / 100))) };
}

// One step, run hourly by the server: buy what the sampler checked since the last step, then look at what is open
export async function agentTick(log: (s: string) => void = console.log) {
  const s = load();
  const have = new Set(s.trades.map((t) => t.mint));
  const checks = firstChecks();
  for (const c of checks.filter((c) => c.checkedAt >= s.since && !have.has(c.mint) && c.market.fdv).sort((a, b) => a.checkedAt - b.checkedAt)) {
    const d = decide(c);
    const devStart = Object.values(c.clusterHold ?? {}).reduce((a, b) => a + b, 0);
    s.trades.push({ check: `${c.mint}-${c.checkedAt}`, mint: c.mint, symbol: c.symbol, risk: c.risk, verdict: c.verdict, openedAt: c.checkedAt, entryFdv: c.market.fdv!, ...d, ...(devStart ? { devStart } : {}) });
    log(d.stake ? `agent: bought $${d.stake} of ${c.symbol} at FDV $${fmtAmount(c.market.fdv!)}` : `agent: skipped ${c.symbol}: ${d.skip}`);
  }

  // Open: the agent's position, or the baseline's day not over yet
  const open = s.trades.filter((t) => (t.stake && !t.closedAt) || t.naiveFdv === undefined);
  if (open.length) {
    const mk = await marketOf(open.map((t) => t.mint));
    for (const t of open) {
      const fdv = mk.get(t.mint)?.fdv ?? 0; // no pool left: worth nothing
      const age = now() - t.openedAt;
      t.lastFdv = fdv;
      if (t.naiveFdv === undefined && age >= RULES.holdH * 3600) t.naiveFdv = fdv;
      if (!t.stake || t.closedAt) continue;
      let exit: Trade["exit"] | null = !fdv ? "pool_gone" : fdv >= t.entryFdv * RULES.takeProfit ? "take_profit" : fdv <= t.entryFdv * (1 - RULES.stopLoss) ? "stop_loss" : age >= RULES.holdH * 3600 ? "time" : null;
      // The developer selling is the one signal the price shows too late: it is read from the chain
      if (!exit && t.devStart && allowed("watch").ok) {
        const c = checks.find((x) => `${x.mint}-${x.checkedAt}` === t.check);
        const held = c ? await clusterHeld(c.chain ?? "solana", t.mint, Object.keys(c.clusterHold ?? {})).catch(() => null) : null;
        if (held !== null && held <= t.devStart * (1 - RULES.devSold)) exit = "dev_sold";
      }
      if (!exit) continue;
      Object.assign(t, { closedAt: now(), exitFdv: fdv, exit });
      log(`agent: sold ${t.symbol} (${exit}): ${pnl(t) >= 0 ? "+" : "-"}$${Math.abs(pnl(t)).toFixed(2)}`);
    }
  }
  writeDiary(s);
  save(s);
}

const EXIT_TEXT: Record<NonNullable<Trade["exit"]>, string> = {
  take_profit: "doubled, took the profit", stop_loss: "fell by half, cut it", dev_sold: "the developer sold, got out",
  pool_gone: "the pool is gone", time: "a day passed",
};
const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;

// The diary: one entry per finished UTC day, plain text for the page and a short one sized for an X post
function writeDiary(s: State) {
  const today = day(now());
  const done = new Set(s.diary.map((d) => d.day));
  const days = [...new Set(s.trades.flatMap((t) => [day(t.openedAt), ...(t.closedAt ? [day(t.closedAt)] : [])]))].filter((d) => d < today && !done.has(d)).sort();
  for (const d of days) {
    const bought = s.trades.filter((t) => day(t.openedAt) === d && t.stake);
    const skipped = s.trades.filter((t) => day(t.openedAt) === d && !t.stake);
    const sold = s.trades.filter((t) => t.closedAt && day(t.closedAt) === d);
    const end = Date.parse(`${d}T00:00:00Z`) / 1000 + 86400;
    const upTo = (t: Trade) => (t.closedAt ?? Infinity) <= end;
    const agent = s.trades.filter(upTo).reduce((n, t) => n + pnl(t), 0);
    const naive = s.trades.filter((t) => t.naiveFdv !== undefined && t.openedAt + RULES.holdH * 3600 <= end).reduce((n, t) => n + naivePnl(t), 0);
    const lines = [
      `${d}.`,
      bought.length ? `Bought ${bought.map((t) => `${t.symbol} ($${t.stake}, risk ${t.risk})`).join(", ")}.` : "Bought nothing.",
      skipped.length ? `Skipped ${skipped.map((t) => `${t.symbol} (${t.skip})`).join(", ")}.` : "",
      sold.length ? `Sold ${sold.map((t) => `${t.symbol}: ${EXIT_TEXT[t.exit!]}, ${money(pnl(t))}`).join("; ")}.` : "",
      `Paper result so far: ${money(agent)}. Buying every token blindly: ${money(naive)}.`,
    ].filter(Boolean);
    const best = [...sold].sort((a, b) => pnl(b) - pnl(a))[0];
    const post = [
      `Hound on paper, ${d}: ${bought.length} bought, ${skipped.length} skipped${sold.length ? `, ${sold.length} sold` : ""}.`,
      best ? `Best: $${best.symbol} ${money(pnl(best))} (${EXIT_TEXT[best.exit!]}).` : "",
      `Total ${money(agent)} vs ${money(naive)} buying everything.`,
    ].filter(Boolean).join(" ");
    s.diary.push({ day: d, text: lines.join(" "), post, agent, naive });
  }
}

// For the page: totals, every trade with its result, the diary newest first
export function agentView() {
  const s = load();
  const closed = s.trades.filter((t) => t.stake && t.closedAt);
  const judged = s.trades.filter((t) => t.naiveFdv !== undefined);
  const openValue = (t: Trade) => (t.lastFdv !== undefined ? worth(t.stake, t.entryFdv, t.lastFdv) - t.stake : 0);
  return {
    since: s.since, rules: RULES,
    agent: { realized: closed.reduce((n, t) => n + pnl(t), 0), open: s.trades.filter((t) => t.stake && !t.closedAt).reduce((n, t) => n + openValue(t), 0), staked: s.trades.reduce((n, t) => n + t.stake, 0), wins: closed.filter((t) => pnl(t) > 0).length, closed: closed.length },
    naive: { result: judged.reduce((n, t) => n + naivePnl(t), 0), staked: judged.length * NAIVE_STAKE, judged: judged.length },
    trades: [...s.trades].sort((a, b) => b.openedAt - a.openedAt).slice(0, 200).map((t) => ({ ...t, pnl: t.closedAt ? pnl(t) : t.stake ? openValue(t) : null, naivePnl: t.naiveFdv !== undefined ? naivePnl(t) : null })),
    diary: [...s.diary].reverse().slice(0, 60),
  };
}
