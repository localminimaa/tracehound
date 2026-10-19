// Should I touch this token? Who launched it, who paid for that wallet, what else those wallets
// launched, and whether the first buyers are the developer's own wallets.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Adapter } from "./types.ts";
import { helius, isOffCurve, solanaAdapter } from "./chains/solana.ts";
import { label } from "./labels.ts";
import { ringOf, ringsByPlaybook, type Ring } from "./rings.ts";
import { fetchJson, fmtAmount, short } from "./util.ts";
import { liquidityOf, poolOf, reusedSocials, smartSets, socialsOf, tradingOf, type Liquidity, type Reuse, type Socials, type Trading } from "./tokenextra.ts";

const EARLY_TXS = 100; // oldest transactions of the mint (one request) read for the launch and the first buyers
const SNIPE_SLOTS = 2; // buying within this many slots of the launch is not a human reaction
const MAX_BUYERS = 10; // early buyers whose funding we trace
const MAX_SIBLINGS = 12; // other wallets of the developer's funder we check for launches
const LAUNCH_PAGES = 3; // pages of 100 txs per wallet searched for its past launches
const ENOUGH_LAUNCHES = 15; // past launches found before we stop looking
const DEAD_FDV = 15_000; // a launched token now worth less than this is counted as dead
const SPRAY_MIN = 30; // one wallet sending the token to (or getting it from) this many wallets in the latest 100 txs
export const PLAYBOOK_LEAD = 300; // a developer funded this many seconds or less before the launch is part of a playbook
const MAX_HOLDERS = 15; // top holders whose funding we trace for the holder map
const FRESH_SEC = 86400; // a holder whose wallet got its first money this recently is fresh

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const ago = (sec: number) => (sec < 5400 ? `${Math.round(sec / 60)} min` : sec < 2 * 86400 ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / 86400)} days`);

export interface Reason {
  points: number; // added risk
  title: string;
  detail: string;
  addresses: string[];
  txs: string[];
}

export interface TokenCheck {
  mint: string;
  symbol: string;
  name: string;
  checkedAt: number;
  // sample: picked by scripts/sample.ts, the only checks the backtest uses. web and cli: someone chose
  // the token, so they lean towards tokens that already caught an eye. Older checks have no source.
  source?: "sample" | "web" | "cli" | "watch"; // watch: checked by src/watch.ts after an alert
  createdAt: number | null;
  dev: string | null;
  devFunder: string | null;
  risk: number; // 0..100
  verdict: "low" | "medium" | "high";
  reasons: Reason[];
  cluster: string[]; // wallets we believe are the developer's
  clusterPct: number; // share of supply they hold now
  market: { fdv: number | null; liquidityUsd: number | null; url: string | null; pair?: string; dex?: string; volume24?: number };
  log: string[];
  // Added with the web page; older checks lack them
  chain?: string;
  supply?: number;
  clusterHold?: Record<string, number>; // tokens each developer wallet held at check time, for the watch
  holders?: Holder[];
  funders?: { address: string; holders: string[] }[]; // outside wallets that funded 2+ top holders
  launches?: PastLaunch[];
  liquidity?: Liquidity;
  trading?: Trading;
  socials?: Socials;
  reused?: Reuse[];
  signals?: { tone: "good" | "info" | "warn"; text: string }[]; // facts worth knowing that add no risk
  events?: { ts: number; kind: "dev_sell" | "bundle_buy" | "launch"; amount?: number; hash: string }[]; // chart markers
}

export interface Holder {
  owner: string;
  pct: number;
  funder: string | null;
  fundedAt: number | null;
  tags: ("dev" | "cluster" | "fresh" | "smart" | "ring")[];
}
export interface PastLaunch { mint: string; symbol: string; wallet: string; createdAt: number | null; fdv: number | null; liq: number | null; dead: boolean }

interface Launch {
  mint: string;
  wallet: string;
  ts: number | null;
}

// DexScreener, free and keyless: current value of up to 30 tokens per call. created is when the deepest pool appeared.
type Market = { fdv: number | null; liq: number | null; url: string | null; created: number | null };
export async function marketOf(mints: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < mints.length; i += 30) {
    const pairs: any[] = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`).catch(() => []);
    for (const p of pairs ?? []) {
      const m = p.baseToken?.address;
      const prev = out.get(m);
      // Several pools per token: keep the deepest one
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liq ?? 0)) out.set(m, { fdv: p.fdv ?? p.marketCap ?? null, liq: p.liquidity?.usd ?? null, url: p.url ?? null, created: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null });
    }
  }
  return out;
}

// Launches (pump.fun, Meteora DBC, Raydium LaunchLab) the wallet created, from its recent history. Parsed Events has no type filter, so we page through
// at most `pages` pages (10 credits each) and keep the create txs.
async function launchesOf(h: ReturnType<typeof helius>, wallet: string, pages: number): Promise<any[]> {
  const out: any[] = [];
  let before: string | undefined;
  for (let i = 0; i < pages; i++) {
    const page = await h.history(wallet, { before }).catch(() => []);
    out.push(...page.filter((t: any) => t.type === "CREATE" && !t.transactionError && (t.creator ?? t.feePayer) === wallet));
    if (page.length < 100) break;
    before = page[page.length - 1].signature;
  }
  return out;
}

// A wallet whose first money came from an exchange or a busy service is not linked by that money
export async function isNeutralFunder(a: Adapter, addr: string) {
  const l = label("solana", addr);
  if (l && ["cex", "swap", "bridge", "dex"].includes(l.kind)) return true;
  const p = await a.profile(addr);
  return p.hub || p.isContract;
}

export async function checkToken(mint: string, opts: { log?: (s: string) => void; source?: TokenCheck["source"]; save?: boolean } = {}): Promise<TokenCheck> {
  const logLines: string[] = [];
  const log = (s: string) => {
    logLines.push(s);
    opts.log?.(s);
  };
  const h = helius();
  const a = solanaAdapter();
  const reasons: Reason[] = [];
  const add = (r: Reason) => {
    reasons.push(r);
    log(`  ${r.points > 0 ? "+" : ""}${r.points} ${r.title}`);
  };

  const asset = await h.rpc("getAsset", { id: mint }).catch(() => null);
  const info = asset?.token_info ?? {};
  const symbol = String(asset?.content?.metadata?.symbol ?? info.symbol ?? "?");
  const name = String(asset?.content?.metadata?.name ?? "");
  const decimals = Number(info.decimals ?? 6);
  const metaLinks: string[] = Object.values(asset?.content?.links ?? {}).filter((x): x is string => typeof x === "string" && /^https?:/.test(x));
  const image = typeof asset?.content?.links?.image === "string" ? asset.content.links.image : undefined;
  const supply = Number(info.supply ?? 0) / 10 ** decimals;
  log(`token ${symbol} ${name ? `(${name}) ` : ""}${short(mint)}, supply ${fmtAmount(supply)}`);

  if (info.mint_authority) add({ points: 30, title: "The developer can still mint more tokens", detail: `Mint authority ${short(info.mint_authority)} is not renounced. New supply can be printed and dumped at any time.`, addresses: [info.mint_authority], txs: [] });
  if (info.freeze_authority) add({ points: 30, title: "Holders' tokens can be frozen", detail: `Freeze authority ${short(info.freeze_authority)} is set. It can stop any wallet from selling.`, addresses: [info.freeze_authority], txs: [] });

  // 1. The launch: oldest transactions of the mint, in on-chain order
  const txs: any[] = await h.history(mint, { order: "asc", limit: EARLY_TXS });
  let dev: string | null = null;
  let createdAt: number | null = null;
  let createSlot = 0;
  let launchTx = "";
  let launchpad: string | null = null;
  let devBuy = 0;
  const buyers: { wallet: string; amount: number; slot: number; hash: string; ts: number }[] = [];
  if (!txs.length) {
    log("no history for this mint: skipping launch and early-buyer checks");
  } else {
    const create = txs.find((t) => t.type === "CREATE") ?? txs.find((t) => !t.transactionError);
    if (create) {
      dev = create.creator ?? create.feePayer;
      launchpad = create.launchpad ?? null;
      createdAt = create.timestamp;
      createSlot = create.slot;
      launchTx = create.signature;
      devBuy = (create.tokenTransfers ?? []).filter((t: any) => t.mint === mint && t.toUserAccount === dev).reduce((s: number, t: any) => s + Number(t.tokenAmount), 0);
      log(`launched${create.launchpad ? ` on ${create.launchpad}` : ""} by ${short(dev!)} at ${new Date(createdAt! * 1000).toISOString().slice(0, 16)}Z${devBuy ? `, dev bought ${((devBuy / supply) * 100).toFixed(1)}% in the launch tx` : ""}`);
    }
    for (const t of txs) {
      if (t.transactionError || t.signature === launchTx) continue;
      for (const tr of t.tokenTransfers ?? []) {
        const w = tr.toUserAccount;
        if (tr.mint !== mint || !w || w === dev || buyers.some((b) => b.wallet === w)) continue;
        // The buyer pays the fee; a transfer to someone else is not a buy
        if (t.feePayer !== w) continue;
        buyers.push({ wallet: w, amount: Number(tr.tokenAmount), slot: t.slot, hash: t.signature, ts: t.timestamp });
      }
    }
  }

  // Several steps ask who funded the same wallet; each answer costs a history page, so it is asked once
  const fundings = new Map<string, ReturnType<typeof a.firstFunding>>();
  const funding = (w: string) => {
    if (!fundings.has(w)) fundings.set(w, a.firstFunding(w).catch(() => null));
    return fundings.get(w)!;
  };
  const neutrals = new Map<string, Promise<boolean>>();
  const neutral = (w: string) => {
    if (!neutrals.has(w)) neutrals.set(w, isNeutralFunder(a, w).catch(() => true));
    return neutrals.get(w)!;
  };

  // 2. Who paid for the developer's wallet, and what else that funder set up
  let devFunder: string | null = null;
  const launches: Launch[] = [];
  const siblings: string[] = [];
  if (dev) {
    const f = await funding(dev);
    if (f) {
      devFunder = f.from;
      const isNeutral = await neutral(f.from);
      const l = label("solana", f.from);
      log(`dev funded by ${l?.name ?? short(f.from)} (${fmtAmount(f.amount)} ${f.asset})${createdAt ? `, ${ago(createdAt - f.ts)} before launch` : ""}`);
      if (l?.kind === "mixer") add({ points: 20, title: `Developer wallet funded through a mixer (${l.name})`, detail: `The money that launched this token came out of ${l.name}, so its origin is deliberately hidden.`, addresses: [dev, f.from], txs: [f.hash] });
      // The same exact amount a known ring paid its developers right before their launches
      if (launchpad && createdAt && f.asset === "SOL" && createdAt - f.ts <= PLAYBOOK_LEAD) {
        for (const r of ringsByPlaybook(launchpad, f.amount)) {
          const before = r.tokens.filter((t) => t.mint !== mint).map((t) => t.symbol);
          log(`launch matches the playbook of a known ring: ${fmtAmount(f.amount)} SOL to a fresh developer on ${launchpad}`);
          add({ points: 15, title: "Launched with a known pump ring's playbook", detail: `${short(dev)} got exactly ${f.amount} SOL ${ago(createdAt - f.ts)} before launching on ${launchpad}. The developers of ${before.length ? before.join(", ") : "the ring's tokens"}, which a ring of ${r.wallets.length} wallets pumped, were paid the same exact amount the same way, each from a different funder. Expect the ring to buy in; a round amount can match by chance, so this alone is not proof.`, addresses: [dev, f.from], txs: [f.hash] });
        }
      }
      if (createdAt && createdAt - f.ts < 3600) add({ points: 5, title: "Fresh developer wallet", detail: `${short(dev)} got its first money ${ago(createdAt - f.ts)} before the launch. Throwaway wallets are typical for serial launchers.`, addresses: [dev], txs: [f.hash] });

      // The funder's other recipients: did they launch tokens too?
      if (isNeutral) log(`  funder is an exchange or a busy service: it links nothing`);
      else {
        const outs = await a.outflows(f.from, 300);
        siblings.push(...[...new Map(outs.filter((t) => t.asset === "SOL" && t.to !== dev).map((t) => [t.to, t])).keys()].slice(0, MAX_SIBLINGS));
      }
    } else log(`developer's first funding not found (history too long or empty)`);
    // The developer's own past launches count even when the funder is unknown
    // Enough launches settle the verdict, so we stop looking there
    for (const w of [dev, ...siblings]) {
      if (launches.length >= ENOUGH_LAUNCHES) break;
      for (const c of await launchesOf(h, w, LAUNCH_PAGES)) {
        // The new token is the one the creator receives; anything it sends out is a payment, not the launch
        const m = c.launched ?? (c.tokenTransfers ?? []).find((t: any) => t.toUserAccount === w && t.mint && t.mint !== mint)?.mint;
        if (m && m !== mint && !launches.some((x) => x.mint === m)) launches.push({ mint: m, wallet: w, ts: c.timestamp ?? null });
      }
    }
  }
  if (dev && !launches.length) log(`no other launches found around the developer`);
  let pastLaunches: PastLaunch[] = [];
  if (launches.length) {
    const mk = await marketOf(launches.map((l) => l.mint));
    // Names of the past tokens, dead ones included: DexScreener forgets a token once its pool is gone
    const named: any[] = await h.rpc("getAssetBatch", { ids: launches.map((l) => l.mint) }).catch(() => []);
    pastLaunches = launches.map((l, i) => ({
      mint: l.mint, symbol: String(named?.[i]?.content?.metadata?.symbol ?? "").slice(0, 16) || short(l.mint), wallet: l.wallet, createdAt: l.ts,
      fdv: mk.get(l.mint)?.fdv ?? null, liq: mk.get(l.mint)?.liq ?? null, dead: (mk.get(l.mint)?.fdv ?? 0) < DEAD_FDV,
    })).sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
    const dead = launches.filter((l) => (mk.get(l.mint)?.fdv ?? 0) < DEAD_FDV);
    const wallets = [...new Set(launches.map((l) => l.wallet))];
    const best = Math.max(0, ...launches.map((l) => mk.get(l.mint)?.fdv ?? 0));
    log(`${launches.length} other launches from the developer's circle, ${dead.length} dead, best now $${fmtAmount(best)}`);
    const share = dead.length / launches.length;
    add({
      points: launches.length >= 3 ? (share >= 0.8 ? 35 : 20) : share >= 0.5 ? 10 : 0,
      title: `The developer's circle launched ${launches.length} other token(s), ${dead.length} now dead`,
      detail: `${wallets.length} wallet(s) linked to the developer${devFunder ? ` through the same funder ${short(devFunder)}` : ""} launched other tokens. ${dead.length} of them are now worth under $${fmtAmount(DEAD_FDV)}. The best one is worth $${fmtAmount(best)}. ${share >= 0.8 ? "This looks like a launch farm: launch, dump, repeat." : ""}`.trim(),
      addresses: [...wallets, ...dead.slice(0, 5).map((l) => l.mint)], txs: [],
    });
  }

  // 3. First buyers: snipers in the launch block, and buyers paid for by the developer's circle
  const cluster = new Set<string>(dev ? [dev] : []);
  const snipers = buyers.filter((b) => b.slot - createSlot <= SNIPE_SLOTS);
  const traced = [...snipers, ...buyers.filter((b) => !snipers.includes(b))].slice(0, MAX_BUYERS);
  const funders = new Map<string, string[]>(); // funder -> buyers
  for (const b of traced) {
    const f = await funding(b.wallet);
    if (!f || (await neutral(f.from))) continue;
    funders.set(f.from, [...(funders.get(f.from) ?? []), b.wallet]);
    if (f.from === dev || f.from === devFunder) cluster.add(b.wallet);
  }
  for (const [f, ws] of funders) if (ws.length >= 2) ws.forEach((w) => cluster.add(w)), cluster.add(f);
  const linkedBuyers = traced.filter((b) => cluster.has(b.wallet));
  if (snipers.length) log(`${snipers.length} wallet(s) bought within ${SNIPE_SLOTS} slots of the launch`);
  if (linkedBuyers.length) {
    const bought = linkedBuyers.reduce((s, b) => s + b.amount, 0) + devBuy;
    add({
      points: linkedBuyers.length >= 3 ? 25 : 15,
      title: `${linkedBuyers.length} early buyer(s) are funded by the developer's circle`,
      detail: `These first buyers got their money from the developer, the developer's funder, or a funder they share: ${linkedBuyers.map((b) => short(b.wallet)).join(", ")}. With the developer they bought ${((bought / (supply || 1)) * 100).toFixed(1)}% of supply at launch. This is a bundle: one operator posing as many buyers.`,
      addresses: linkedBuyers.map((b) => b.wallet), txs: linkedBuyers.slice(0, 5).map((b) => b.hash),
    });
  } else if (snipers.length >= 3) {
    add({ points: 10, title: `${snipers.length} wallets bought in the launch block`, detail: `Buying within ${SNIPE_SLOTS} slots of the launch needs a bot or a prepared bundle. Their funding is not linked to the developer, so they may be independent sniper bots.`, addresses: snipers.map((s) => s.wallet), txs: snipers.slice(0, 5).map((s) => s.hash) });
  }

  // The developer's own bag: bought at launch, how much is left
  if (dev && devBuy > 0) {
    const accs: any[] = (await h.rpc("getTokenAccountsByOwner", [dev, { mint }, { encoding: "jsonParsed" }]).catch(() => null))?.value ?? [];
    const left = accs.reduce((s, x) => s + Number(x.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
    const sold = 1 - left / devBuy;
    log(`developer kept ${fmtAmount(left)} of ${fmtAmount(devBuy)} bought at launch`);
    if (sold >= 0.9) add({ points: 25, title: `The developer already sold ${Math.round(sold * 100)}% of the launch bag`, detail: `${short(dev)} bought ${fmtAmount(devBuy)} ${symbol} in the launch tx and now holds ${fmtAmount(left)}. The person who made the token has exited.`, addresses: [dev], txs: [launchTx] });
    else if (sold >= 0.5) add({ points: 10, title: `The developer sold ${Math.round(sold * 100)}% of the launch bag`, detail: `${short(dev)} bought ${fmtAmount(devBuy)} ${symbol} at launch and holds ${fmtAmount(left)} now.`, addresses: [dev], txs: [launchTx] });
  }

  // Early buyers that belong to a known pump ring: the team that pumped other tokens is buying this one
  const inRing = new Map<Ring, typeof buyers>();
  for (const b of buyers) {
    const r = ringOf(b.wallet);
    if (r) inRing.set(r, [...(inRing.get(r) ?? []), b]);
  }
  for (const [r, bs] of inRing) {
    const names = r.tokens.filter((t) => t.mint !== mint).map((t) => t.symbol);
    // The developer's money two hops up: a wallet of the ring or one of its funders means one operator
    const known = new Set([...r.wallets, ...r.funders]);
    const up = devFunder ? [devFunder, (await a.firstFunding(devFunder).catch(() => null))?.from].filter((x): x is string => !!x) : [];
    const link = up.find((x) => known.has(x));
    if (dev && link) {
      log(`developer's money comes from ${short(link)}, a ${r.wallets.includes(link) ? "wallet" : "funder"} of the ring`);
      add({ points: 20, title: "The developer is funded from the same ring", detail: `${short(dev)} was paid by ${up.indexOf(link) === 0 ? short(link) : `${short(devFunder!)}, which was paid by ${short(link)}`}, ${r.wallets.includes(link) ? "a wallet of the ring" : "which also funded wallets of the ring"}. The developer and the early buyers are one operator.`, addresses: [dev, ...up], txs: [] });
    }
    log(`${bs.length} early buyer(s) belong to a ring of ${r.wallets.length} wallets`);
    add({
      points: bs.length >= 2 ? 30 : 15,
      title: `${bs.length} early buyer(s) belong to a known pump ring`,
      detail: `${bs.map((b) => short(b.wallet)).join(", ")} ${bs.length > 1 ? "are" : "is"} part of a ring of ${r.wallets.length} wallets that bought almost nothing but ${names.length ? names.join(", ") : "a few tokens"} and pumped them together. When the same people buy early, the price is usually theirs to push up and then sell into.`,
      addresses: bs.map((b) => b.wallet), txs: bs.slice(0, 5).map((b) => b.hash),
    });
  }

  // 4. Who holds the supply now
  let clusterPct = 0;
  let holderList: Holder[] = [];
  let holderFunders: { address: string; holders: string[] }[] = [];
  const clusterHold: Record<string, number> = {};
  const largest: any[] = (await h.rpc("getTokenLargestAccounts", [mint]).catch(() => null))?.value ?? [];
  if (largest.length && supply) {
    const accs: any[] = (await h.rpc("getMultipleAccounts", [largest.map((l) => l.address), { encoding: "jsonParsed" }]))?.value ?? [];
    const holders: { owner: string; pct: number }[] = [];
    for (let i = 0; i < largest.length; i++) {
      const owner = accs[i]?.data?.parsed?.info?.owner;
      if (!owner) continue;
      const pct = (Number(largest[i].uiAmount) / supply) * 100;
      if ((await a.profile(owner)).isContract) continue; // bonding curve or pool, not a person
      const same = holders.find((x) => x.owner === owner);
      if (same) same.pct += pct;
      else holders.push({ owner, pct });
    }
    // Who funded each top holder: holders paid by the developer's circle, or by one shared wallet, are one hand
    const now = Math.floor(Date.now() / 1000);
    const traced = holders.slice(0, MAX_HOLDERS);
    const fund = new Map<string, Awaited<ReturnType<typeof funding>>>();
    for (const x of traced) fund.set(x.owner, await funding(x.owner));
    const byFunder = new Map<string, string[]>();
    for (const x of traced) {
      const f = fund.get(x.owner);
      if (!f || (await neutral(f.from))) continue;
      byFunder.set(f.from, [...(byFunder.get(f.from) ?? []), x.owner]);
      if (f.from === dev || f.from === devFunder || cluster.has(f.from)) cluster.add(x.owner);
    }
    for (const [f, ws] of byFunder) if (ws.length >= 2) ws.forEach((w) => cluster.add(w)), cluster.add(f);
    const linkedHolders = traced.filter((x) => cluster.has(x.owner) && x.owner !== dev);
    if (linkedHolders.length) log(`${linkedHolders.length} top holder(s) linked to the developer's circle by funding`);
    holderFunders = [...byFunder].filter(([f, ws]) => ws.length >= 2 || traced.some((x) => x.owner === f)).map(([address, ws]) => ({ address, holders: ws }));
    const { smart } = smartSets();
    holderList = holders.slice(0, 20).map((x) => {
      const f = fund.get(x.owner);
      const tags: Holder["tags"] = [];
      if (x.owner === dev) tags.push("dev");
      else if (cluster.has(x.owner)) tags.push("cluster");
      if (f && now - f.ts < FRESH_SEC) tags.push("fresh");
      if (smart.has(x.owner)) tags.push("smart");
      if (ringOf(x.owner)) tags.push("ring");
      return { owner: x.owner, pct: x.pct, funder: f?.from ?? null, fundedAt: f?.ts ?? null, tags };
    });
    for (const x of holders) if (cluster.has(x.owner)) clusterHold[x.owner] = (x.pct / 100) * supply;

    // Fresh wallets holding a lot: a crowd of holders created for this launch
    const fresh = holderList.filter((x) => x.tags.includes("fresh"));
    const freshPct = fresh.reduce((s, x) => s + x.pct, 0);
    if (fresh.length) log(`${fresh.length} of the top ${traced.length} holders got their first money in the last 24 h, holding ${freshPct.toFixed(1)}%`);
    if (fresh.length >= Math.max(4, traced.length * 0.4) || freshPct >= 20) add({
      points: freshPct >= 20 ? 15 : 10, title: `${fresh.length} top holders are wallets created in the last 24 h`,
      detail: `They hold ${freshPct.toFixed(1)}% of supply. Wallets that appear right before a launch and load up on one token are usually the team's own, spread out to look like a crowd.`,
      addresses: fresh.map((x) => x.owner), txs: [],
    });
    clusterPct = holders.filter((x) => cluster.has(x.owner)).reduce((s, x) => s + x.pct, 0);
    const top10 = holders.slice(0, 10).reduce((s, x) => s + x.pct, 0);
    const devPct = holders.find((x) => x.owner === dev)?.pct ?? 0;
    log(`top-10 wallets hold ${top10.toFixed(1)}%, developer ${devPct.toFixed(1)}%, developer's circle ${clusterPct.toFixed(1)}%`);
    if (clusterPct >= 10) add({ points: clusterPct >= 25 ? 25 : 15, title: `The developer's wallets still hold ${clusterPct.toFixed(1)}% of supply`, detail: `Wallets linked to the developer hold ${clusterPct.toFixed(1)}% right now. If they sell together, the price collapses.`, addresses: holders.filter((x) => cluster.has(x.owner)).map((x) => x.owner), txs: [] });
    else if (devPct >= 10) add({ points: 10, title: `The developer holds ${devPct.toFixed(1)}% of supply`, detail: `${short(dev!)} still holds a large share and can dump it at any time.`, addresses: [dev!], txs: [] });
    // A known ring holding a big bag now is the dump that has not happened yet
    const ringHeld = holders.filter((x) => ringOf(x.owner));
    const ringPct = ringHeld.reduce((s, x) => s + x.pct, 0);
    if (ringPct >= 5) {
      log(`wallets of known rings hold ${ringPct.toFixed(1)}%`);
      add({ points: ringPct >= 20 ? 20 : 10, title: `Known pump-ring wallets hold ${ringPct.toFixed(1)}% of supply`, detail: `${ringHeld.length} of the largest holders belong to a ring found pumping other tokens. That bag is still in their hands and can be sold together.`, addresses: ringHeld.map((x) => x.owner), txs: [] });
    }
    if (top10 >= 50) add({ points: 10, title: `Top 10 wallets hold ${top10.toFixed(0)}%`, detail: `Supply is concentrated in a few wallets (pools and bonding curves excluded).`, addresses: holders.slice(0, 10).map((x) => x.owner), txs: [] });
  }

  // 5. How it trades now: the mint's last 100 transactions
  const recent: any[] = await h.history(mint, { limit: 100 }).catch(() => []);
  const trading = tradingOf(mint, recent);
  log(`last ${trading.txs} trades: ${trading.traders} wallets, ${trading.buys} buys / ${trading.sells} sells, ${Math.round(trading.roundTrip * 100)}% by wallets that bought and sold`);
  if (trading.txs >= 40 && (trading.roundTrip >= 0.6 || trading.topShare >= 0.6)) add({
    points: 10, title: "Trading looks bot-made",
    detail: `Of the last ${trading.txs} trades, ${Math.round(trading.roundTrip * 100)}% come from wallets that both bought and sold within that window, and the 5 busiest wallets made ${Math.round(trading.topShare * 100)}%. Volume like this is churned to climb trending lists, not real demand.`,
    addresses: [], txs: [],
  });

  // Tokens moving between wallets outside any pool (program addresses left out, so buys and sells do not
  // count). One wallet sending to many fakes a holder base; many wallets sending to one is a wallet farm
  // being swept into one hand, usually before a sale.
  const out = new Map<string, Set<string>>();
  const into = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  for (const t of recent) {
    if (t.transactionError) continue;
    for (const tr of t.tokenTransfers ?? []) {
      const { fromUserAccount: from, toUserAccount: to } = tr;
      if (tr.mint !== mint || !from || !to || from === to || isOffCurve(from) || isOffCurve(to)) continue;
      link(out, from, to);
      link(into, to, from);
    }
  }
  const span = recent.length ? `${ago(recent[0].timestamp - recent[recent.length - 1].timestamp)}, the last one ${ago(Math.floor(Date.now() / 1000) - recent[0].timestamp)} ago` : "";
  const widest = (m: Map<string, Set<string>>) => [...m].sort((x, y) => y[1].size - x[1].size)[0];
  for (const [dir, [hub, peers] = ["", new Set<string>()]] of [["out", widest(out)], ["in", widest(into)]] as const) {
    if (!hub || peers.size < SPRAY_MIN || label("solana", hub)) continue;
    const own = hub === dev || cluster.has(hub);
    const who = own ? `the developer's wallet ${short(hub)}` : short(hub);
    log(`${short(hub)} ${dir === "out" ? "sent the token to" : "received the token from"} ${peers.size} wallets in the recent ${recent.length} txs`);
    add(dir === "out" ? {
      points: own ? 20 : 15,
      title: `${own ? "The developer is" : "One wallet is"} handing the token out to ${peers.size} wallets`,
      detail: `In the recent ${recent.length} transactions (${span}), ${who} sent ${symbol} to ${peers.size} different wallets outside any pool. That inflates the holder count so the token looks widely owned; those holders did not buy.`,
      addresses: [hub, ...[...peers].slice(0, 10)], txs: [],
    } : {
      points: own ? 25 : 15,
      title: `${peers.size} wallets are sending the token to ${own ? "the developer" : "one wallet"}`,
      detail: `In the recent ${recent.length} transactions (${span}), ${peers.size} different wallets sent ${symbol} to ${who}, outside any pool. Supply hidden across a farm of wallets is being collected in one place, which usually comes before a large sale. It also means those "holders" were never independent.`,
      addresses: [hub, ...[...peers].slice(0, 10)], txs: [],
    });
  }

  // The developer's sells, for the chart
  const events: NonNullable<TokenCheck["events"]> = [];
  if (createdAt) events.push({ ts: createdAt, kind: "launch", hash: launchTx });
  for (const b of linkedBuyers) events.push({ ts: b.ts, kind: "bundle_buy", amount: b.amount, hash: b.hash });
  if (dev) {
    const mine: any[] = await h.history(dev, { limit: 100 }).catch(() => []);
    for (const t of mine) {
      if (t.transactionError) continue;
      const out = (t.tokenTransfers ?? []).filter((x: any) => x.mint === mint && x.fromUserAccount === dev).reduce((s: number, x: any) => s + Number(x.tokenAmount), 0);
      if (out > 0) events.push({ ts: t.timestamp, kind: "dev_sell", amount: out, hash: t.signature });
    }
  }

  // 6. The pool: can its liquidity be pulled, and what the token links to
  const pool = await poolOf("solana", mint);
  const liquidity = await liquidityOf(pool, mint);
  log(`liquidity: ${liquidity.note}`);
  const signals: NonNullable<TokenCheck["signals"]> = [{ tone: liquidity.kind === "locked" ? "good" : liquidity.kind === "pullable" ? "warn" : "info", text: liquidity.note }];
  if (liquidity.kind === "pullable" && liquidity.burnPct !== undefined) add({ points: 15, title: `Only ${liquidity.burnPct}% of the pool's LP tokens are burned`, detail: `${liquidity.note} Whoever holds the rest can remove the liquidity and leave holders unable to sell.`, addresses: [], txs: [] });
  const socials = socialsOf([...(pool?.socials.links ?? []), ...metaLinks], image);
  if (!socials.twitter && !socials.telegram && !socials.website) signals.push({ tone: "info", text: "No own X account, Telegram or website: the links point to searches or other people's posts." });
  const reused = reusedSocials(mint, socials);
  if (reused.length) {
    const what = [...new Set(reused.map((r) => r.key))].join(", ");
    log(`socials reused by ${reused.length} earlier token(s): ${what}`);
    const mk2 = await marketOf([...new Set(reused.map((r) => r.mint))]);
    const dead = reused.filter((r) => (mk2.get(r.mint)?.fdv ?? 0) < DEAD_FDV);
    add({
      points: dead.length ? 15 : 5, title: `Same ${what} as ${plural(new Set(reused.map((r) => r.mint)).size, "earlier token")}`,
      detail: `${[...new Set(reused.map((r) => r.symbol))].slice(0, 6).join(", ")} used the same ${what}${dead.length ? `; ${new Set(dead.map((r) => r.mint)).size} of them are dead now` : ""}. Serial launchers recycle their accounts and sites from token to token.`,
      addresses: [...new Set(reused.map((r) => r.mint))].slice(0, 6), txs: [],
    });
  }

  // 7. Proven early buyers from the smart money scan (rings are scored above, from data/rings.json)
  const { smart, at: smartAt } = smartSets();
  const seen = [...new Set([...buyers.map((b) => b.wallet), ...holderList.map((x) => x.owner)])];
  const smartIn = seen.filter((w) => smart.has(w));
  if (smartIn.length) signals.push({ tone: "good", text: `${plural(smartIn.length, "smart money wallet")} bought early or hold it (wallets that were early in several winners this week).` });
  else if (smartAt) signals.push({ tone: "info", text: "No wallet from the latest smart money scan among early buyers or top holders." });

  const mk = pool ? { fdv: pool.fdv, liq: pool.liq, url: pool.url } : (await marketOf([mint])).get(mint);
  const risk = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const verdict = risk >= 50 ? "high" : risk >= 25 ? "medium" : "low";
  log(`risk ${risk}/100: ${verdict}`);
  const check: TokenCheck = {
    mint, symbol, name, checkedAt: Math.floor(Date.now() / 1000), source: opts.source ?? "cli", createdAt, dev, devFunder, risk, verdict,
    reasons: reasons.filter((r) => r.points > 0).sort((x, y) => y.points - x.points),
    cluster: [...cluster], clusterPct,
    market: { fdv: mk?.fdv ?? null, liquidityUsd: mk?.liq ?? null, url: mk?.url ?? null, ...(pool ? { pair: pool.pair, dex: pool.dex, volume24: pool.volume24 } : {}) },
    log: logLines,
    chain: "solana", supply, clusterHold, holders: holderList, funders: holderFunders, launches: pastLaunches,
    liquidity, trading, socials, reused, signals, events: events.sort((x, y) => x.ts - y.ts),
  };
  if (opts.save !== false) saveCheck(check);
  return check;
}

// Every check is kept: later we compare the verdict with what happened to the token.
const dir = new URL("../data/tokens/", import.meta.url);
export function saveCheck(c: TokenCheck) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${c.mint}-${c.checkedAt}.json`, dir), JSON.stringify(c));
}

