// Smart money: wallets that keep getting into tokens early, before those tokens grow 50x and more.
// 1. Winners: young Solana tokens now worth WINNER_FDV+ (GeckoTerminal, free). 2. Early buyers of each
// winner. 3. Wallets early in several winners are candidates. 4. Each candidate's other recent buys give
// its hit rate; bots buying everything fall out. 5. Candidates linked by funding are one cluster, and a
// cluster that buys nothing but these winners is a ring: the people pumping them, not smart money.
import { mkdirSync, writeFileSync } from "node:fs";
import { helius, solanaAdapter } from "./chains/solana.ts";
import { isNeutralFunder, marketOf, PLAYBOOK_LEAD } from "./tokencheck.ts";
import { label } from "./labels.ts";
import { addRing } from "./rings.ts";
import { fetchJson, short } from "./util.ts";

const WINNER_FDV = 250_000; // a pump.fun token starts near $4k, so this is ~60x
const MAX_FDV = 100_000_000; // above this a week-old token is fake supply or a look-alike of a real coin
const MIN_RESERVE = 20_000; // real money in the pool, not a printed number
const MAX_AGE_DAYS = 7;
const EARLY_TXS = 100; // first transactions of a winner whose buyers count as early
const MIN_WINS = 2; // early in at least this many winners to be looked at
const MAX_CANDIDATES = 40;
const MIN_BUYS = 5; // fewer other buys than this tells nothing about a hit rate
const BUY_PAGES = 3; // pages of 100 txs of a candidate's history read for its other buys
const HUB_BUYS = 80; // this many token buys in the last 100 txs is a bot buying everything
const YOUNG_DAYS = 30; // only buys of tokens younger than this count: USDC or JUP are not a memecoin call

export interface Winner { mint: string; symbol: string; fdv: number; createdAt: number }
export interface SmartWallet {
  wallet: string;
  wins: string[]; // winner mints it was early in
  buys: number; // other young tokens it bought recently, the winners that selected it left out
  hits: number; // of those, now worth WINNER_FDV+
  hitRate: number | null; // hits / buys, null when there are too few buys to tell
  funder: string | null; // first funder, unless it is an exchange or a busy service
}
// ring: wallets that buy almost nothing but these winners, linked by funding: the team behind the tokens.
// traders: linked wallets with a real record of other buys, judged by their hit rate.
export interface Cluster {
  kind: "ring" | "traders" | "unknown";
  wallets: SmartWallet[];
  funders: string[]; // outside wallets that funded the members
  winners: string[];
  hits: number;
  buys: number;
  hitRate: number | null;
}
export interface SmartReport { at: number; winners: Winner[]; clusters: Cluster[]; log: string[] }

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

// Young tokens that made it, from GeckoTerminal trending lists. Pools of the same token are merged.
async function findWinners(log: (s: string) => void): Promise<Winner[]> {
  const pools: any[] = [];
  for (const d of ["1h", "6h", "24h"]) pools.push(...((await fetchJson(`${GT}/trending_pools?duration=${d}`).catch(() => null))?.data ?? []));
  for (let page = 1; page <= 3; page++) pools.push(...((await fetchJson(`${GT}/pools?sort=h24_volume_usd_desc&page=${page}`).catch(() => null))?.data ?? []));
  const now = Date.now() / 1000;
  const out = new Map<string, Winner>();
  for (const p of pools) {
    const a = p.attributes ?? {};
    const mint = String(p.relationships?.base_token?.data?.id ?? "").replace(/^solana_/, "");
    const createdAt = Date.parse(a.pool_created_at) / 1000;
    const fdv = Number(a.fdv_usd ?? 0);
    if (!mint || fdv < WINNER_FDV || fdv > MAX_FDV || Number(a.reserve_in_usd ?? 0) < MIN_RESERVE || !(now - createdAt < MAX_AGE_DAYS * 86400) || out.has(mint)) continue;
    out.set(mint, { mint, symbol: String(a.name ?? "?").split(" / ")[0], fdv, createdAt });
  }
  log(`${out.size} winners: tokens under ${MAX_AGE_DAYS} days old now worth $${WINNER_FDV.toLocaleString()}+ with $${MIN_RESERVE.toLocaleString()}+ in the pool`);
  return [...out.values()];
}

// Tokens a wallet bought itself (it paid the fee and received the token), from its last BUY_PAGES×100 txs.
// txs counts what was read, so a wallet trading all day is told apart from one that buys once a week.
async function buysOf(h: ReturnType<typeof helius>, wallet: string): Promise<{ mints: string[]; txs: number }> {
  const mints = new Set<string>();
  let before: string | undefined;
  let read = 0;
  for (let i = 0; i < BUY_PAGES; i++) {
    const txs = await h.history(wallet, { before }).catch(() => []);
    read += txs.length;
    for (const t of txs) {
      if (t.transactionError || t.feePayer !== wallet) continue;
      for (const tr of t.tokenTransfers ?? []) if (tr.toUserAccount === wallet && tr.mint) mints.add(tr.mint);
    }
    if (txs.length < 100) break;
    before = txs[txs.length - 1].signature;
  }
  return { mints: [...mints], txs: read };
}

// How a ring's tokens were launched: the exact SOL amount a fresh developer got minutes before the launch.
// Only an amount repeated on two or more of its launches counts; one launch is not a habit.
export async function playbookOf(h: ReturnType<typeof helius>, a: ReturnType<typeof solanaAdapter>, mints: string[]) {
  const seen = new Map<string, { launchpad: string; amount: number; n: number }>();
  for (const m of mints) {
    const [l] = await h.history(m, { order: "asc", limit: 1 }).catch(() => []);
    if (l?.type !== "CREATE" || !l.launchpad) continue;
    const f = await a.firstFunding(l.creator).catch(() => null);
    if (!f || f.asset !== "SOL" || l.timestamp - f.ts > PLAYBOOK_LEAD) continue;
    const amount = Math.round(f.amount * 1000) / 1000;
    const k = `${l.launchpad}|${amount}`;
    seen.set(k, { launchpad: l.launchpad, amount, n: (seen.get(k)?.n ?? 0) + 1 });
  }
  return [...seen.values()].filter((p) => p.n >= 2).map(({ launchpad, amount }) => ({ launchpad, amount }));
}

export async function findSmartMoney(opts: { log?: (s: string) => void; winners?: string[] } = {}): Promise<SmartReport> {
  const logLines: string[] = [];
  const log = (s: string) => {
    logLines.push(s);
    opts.log?.(s);
  };
  const h = helius();
  const a = solanaAdapter();

  const winners = opts.winners?.length
    ? opts.winners.map((mint) => ({ mint, symbol: short(mint), fdv: 0, createdAt: 0 }))
    : await findWinners(log);
  const winnerSet = new Set(winners.map((w) => w.mint));

  // 2. Early buyers of every winner: not the developer, and the buyer paid for the tx itself
  const early = new Map<string, Set<string>>();
  for (const w of winners) {
    const txs = await h.history(w.mint, { order: "asc", limit: EARLY_TXS }).catch(() => []);
    const launch = txs.find((t: any) => t.type === "CREATE");
    const dev = launch?.creator ?? launch?.feePayer;
    let n = 0;
    for (const t of txs) {
      if (t.transactionError) continue;
      for (const tr of t.tokenTransfers ?? []) {
        const b = tr.toUserAccount;
        if (tr.mint !== w.mint || !b || b === dev || t.feePayer !== b) continue;
        if (!early.has(b)) early.set(b, new Set());
        if (!early.get(b)!.has(w.mint)) n++;
        early.get(b)!.add(w.mint);
      }
    }
    log(`  ${w.symbol}: ${n} early buyers${w.fdv ? `, now $${Math.round(w.fdv).toLocaleString()}` : ""}`);
  }

  // 3. Repeated early buyers
  const candidates = [...early.entries()]
    .filter(([, m]) => m.size >= MIN_WINS)
    .sort((x, y) => y[1].size - x[1].size)
    .slice(0, MAX_CANDIDATES);
  log(`${early.size} early buyers, ${candidates.length} were early in ${MIN_WINS}+ winners`);

  // 4. What else each candidate buys. Hit rate is measured only on buys that played no part in picking it.
  const ws: SmartWallet[] = [];
  for (const [wallet, wins] of candidates) {
    if (label("solana", wallet) || (await a.profile(wallet)).isContract) continue;
    const { mints, txs } = await buysOf(h, wallet);
    if (mints.length >= HUB_BUYS * (txs / 100)) {
      log(`  ${short(wallet)}: ${mints.length} buys in ${txs} txs, a bot buying everything`);
      continue;
    }
    const others = mints.filter((m) => !winnerSet.has(m));
    const mk = await marketOf(others);
    const now = Date.now() / 1000;
    // A token with no pool left counts as a miss; an old established token is not counted at all
    const young = others.filter((m) => !mk.get(m)?.created || now - mk.get(m)!.created! < YOUNG_DAYS * 86400);
    const hits = young.filter((m) => (mk.get(m)?.fdv ?? 0) >= WINNER_FDV).length;
    ws.push({ wallet, wins: [...wins], buys: young.length, hits, hitRate: young.length >= MIN_BUYS ? hits / young.length : null, funder: null });
  }

  // 5. Who is one hand: the same funder, one candidate funding another, or the same narrow buying.
  // An exchange or a busy service as the funder links nothing.
  for (const w of ws) {
    const f = await a.firstFunding(w.wallet).catch(() => null);
    if (f && !(await isNeutralFunder(a, f.from))) w.funder = f.from;
  }
  const parent = new Map(ws.map((w) => [w.wallet, w.wallet]));
  const root = (x: string): string => (parent.get(x) === x ? x : root(parent.get(x)!));
  const join = (x: string, y: string) => parent.set(root(x), root(y));
  const byFunder = new Map<string, string>();
  for (const w of ws) {
    if (!w.funder) continue;
    if (parent.has(w.funder)) join(w.wallet, w.funder);
    if (byFunder.has(w.funder)) join(w.wallet, byFunder.get(w.funder)!);
    else byFunder.set(w.funder, w.wallet);
  }
  // Wallets that buy nothing but the same two or more winners act as one, whoever funded them
  const idle = ws.filter((w) => w.buys < MIN_BUYS);
  for (let i = 0; i < idle.length; i++)
    for (let j = i + 1; j < idle.length; j++)
      if (idle[i].wins.filter((m) => idle[j].wins.includes(m)).length >= MIN_WINS) join(idle[i].wallet, idle[j].wallet);
  const groups = new Map<string, SmartWallet[]>();
  for (const w of ws) groups.set(root(w.wallet), [...(groups.get(root(w.wallet)) ?? []), w]);

  const clusters: Cluster[] = [...groups.values()].map((members) => {
    const buys = members.reduce((s, w) => s + w.buys, 0);
    const hits = members.reduce((s, w) => s + w.hits, 0);
    // Wallets that trade almost nothing but these winners are the people behind them, not lucky buyers
    const ring = members.length >= 2 && members.filter((w) => w.buys < MIN_BUYS).length > members.length / 2;
    const funders = [...new Set(members.map((w) => w.funder).filter((f): f is string => !!f && !parent.has(f)))];
    return {
      kind: ring ? "ring" : buys >= MIN_BUYS ? "traders" : "unknown",
      wallets: members.sort((x, y) => y.wins.length - x.wins.length),
      funders,
      winners: [...new Set(members.flatMap((w) => w.wins))],
      hits, buys, hitRate: buys >= MIN_BUYS ? hits / buys : null,
    } as Cluster;
  });
  const order = { ring: 0, traders: 1, unknown: 2 };
  clusters.sort((x, y) => order[x.kind] - order[y.kind] || (y.hitRate ?? 0) - (x.hitRate ?? 0) || y.winners.length - x.winners.length);
  const rings = clusters.filter((c) => c.kind === "ring");
  // Remembered, so the token check can recognise these wallets among the first buyers of a new token
  const sym = new Map(winners.map((w) => [w.mint, w.symbol]));
  for (const c of rings) {
    const playbook = await playbookOf(h, a, c.winners);
    if (playbook.length) log(`  ring playbook: ${playbook.map((p) => `${p.amount} SOL to a fresh developer on ${p.launchpad}`).join("; ")}`);
    addRing({ wallets: c.wallets.map((w) => w.wallet), funders: c.funders, tokens: c.winners.map((m) => ({ mint: m, symbol: sym.get(m) ?? short(m) })), playbook });
  }
  log(`${ws.length} wallets checked: ${rings.length} ring(s) of ${rings.reduce((s, c) => s + c.wallets.length, 0)} wallets, ${clusters.filter((c) => c.kind === "traders").length} trader cluster(s)`);

  const report: SmartReport = { at: Math.floor(Date.now() / 1000), winners, clusters, log: logLines };
  const dir = new URL("../data/smart/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${report.at}.json`, dir), JSON.stringify(report));
  return report;
}
