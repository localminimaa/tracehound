// Token check for Base and BSC without a paid Etherscan plan. Free sources only:
// GoPlus (contract permissions, creator, top holders, LP holders), GeckoTerminal (the pool's last 300 trades),
// DexScreener (pool, socials) and a public RPC for balances. Wallet histories need an indexer, so the
// developer's funding and past launches are not looked at here.
import type { TokenCheck, Reason, Holder } from "./tokencheck.ts";
import { saveCheck } from "./tokencheck.ts";
import { poolOf, liquidityOfEvm, reusedSocials, type Trading } from "./tokenextra.ts";
import { fetchJson, fmtAmount, limiter, short } from "./util.ts";

export const EVM_TOKEN_CHAINS: Record<string, { id: number; gt: string; rpc: string; name: string }> = {
  bsc: { id: 56, gt: "bsc", rpc: process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com", name: "BSC" },
  base: { id: 8453, gt: "base", rpc: process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com", name: "Base" },
};
export const isEvmToken = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const gecko = limiter(0.5);
const SNIPE_BLOCKS = 2;
const DEAD = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

// A 0x address can live on either chain; the one with a pool (or GoPlus data) wins
export async function detectEvmChain(addr: string): Promise<string | null> {
  for (const chain of Object.keys(EVM_TOKEN_CHAINS)) if (await poolOf(chain, addr)) return chain;
  for (const [chain, c] of Object.entries(EVM_TOKEN_CHAINS)) if ((await goplus(c.id, addr))?.token_symbol) return chain;
  return null;
}

async function goplus(id: number, addr: string): Promise<any | null> {
  const j = await fetchJson(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${addr}`).catch(() => null);
  return j?.result?.[addr.toLowerCase()] ?? null;
}

// balanceOf through the chain's public RPC: enough for the watch, which only needs current balances
export async function evmBalances(chain: string, token: string, wallets: string[]): Promise<Record<string, number>> {
  const c = EVM_TOKEN_CHAINS[chain];
  const call = (data: string) => fetchJson(c.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data }, "latest"] }) }).then((j) => j.result as string);
  const dec = parseInt((await call("0x313ce567").catch(() => "0x12")) || "0x12", 16) || 18;
  const out: Record<string, number> = {};
  for (const w of wallets) {
    const r = await call(`0x70a08231${w.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`).catch(() => "0x0");
    out[w] = Number(BigInt(r && r !== "0x" ? r : "0x0")) / 10 ** dec;
  }
  return out;
}

export async function checkEvmToken(token: string, chain: string, opts: { log?: (s: string) => void } = {}): Promise<TokenCheck> {
  const cfg = EVM_TOKEN_CHAINS[chain];
  const logLines: string[] = [];
  const log = (s: string) => {
    logLines.push(s);
    opts.log?.(s);
  };
  const reasons: Reason[] = [];
  const add = (r: Reason) => {
    reasons.push(r);
    log(`  +${r.points} ${r.title}`);
  };
  const signals: NonNullable<TokenCheck["signals"]> = [];
  const yes = (v: unknown) => v === "1" || v === 1;

  const g = await goplus(cfg.id, token);
  if (!g) throw new Error(`GoPlus has no data for this token on ${cfg.name} yet`);
  const symbol = String(g.token_symbol ?? "?").trim() || "?";
  const name = String(g.token_name ?? "").trim();
  const supply = Number(g.total_supply ?? 0);
  const dev = g.creator_address ? String(g.creator_address).toLowerCase() : null;
  const owner = String(g.owner_address ?? "").toLowerCase();
  const ownerLive = !!owner && !DEAD.has(owner);
  log(`token ${symbol} ${name ? `(${name}) ` : ""}${short(token)} on ${cfg.name}, supply ${fmtAmount(supply)}, ${g.holder_count ?? "?"} holders`);
  log(`created by ${dev ? short(dev) : "unknown"}, owner ${ownerLive ? short(owner) : "renounced"}`);
  const lp = g.launchpad_token;
  if (yes(lp?.is_launchpad_token)) signals.push({ tone: "info", text: `Launched on ${lp.launchpad_name ?? "a launchpad"}.` });

  // 1. What the contract lets its owner do
  const sellTax = Number(g.sell_tax || 0), buyTax = Number(g.buy_tax || 0);
  if (yes(g.is_honeypot) || yes(g.cannot_sell_all) || sellTax >= 0.5) add({ points: 60, title: "Holders cannot sell (honeypot)", detail: `GoPlus simulated a sale and it fails${sellTax ? ` or loses ${Math.round(sellTax * 100)}% to tax` : ""}. Buying this token means not getting the money back.`, addresses: [token], txs: [] });
  else if (sellTax >= 0.1 || buyTax >= 0.1) add({ points: 15, title: `Trading tax: ${Math.round(buyTax * 100)}% buy, ${Math.round(sellTax * 100)}% sell`, detail: "Every trade pays this to the contract. High tax is a slow drain and can be raised further.", addresses: [token], txs: [] });
  if (yes(g.is_mintable) && ownerLive) add({ points: 30, title: "The owner can mint more tokens", detail: `${short(owner)} owns a contract with a mint function. New supply can be printed and dumped at any time.`, addresses: [owner], txs: [] });
  const blocks = [
    yes(g.is_blacklisted) && "blacklist wallets", yes(g.transfer_pausable) && "pause transfers", yes(g.slippage_modifiable) && "change the tax",
    yes(g.personal_slippage_modifiable) && "set a tax per wallet", yes(g.trading_cooldown) && "enforce a trading cooldown",
  ].filter(Boolean) as string[];
  if (blocks.length && ownerLive) add({ points: 20, title: `The owner can ${blocks.join(", ")}`, detail: `These switches let ${short(owner)} stop chosen holders from selling or make selling expensive after people buy in.`, addresses: [owner], txs: [] });
  if (yes(g.hidden_owner) || yes(g.can_take_back_ownership)) add({ points: 20, title: "Ownership is not really renounced", detail: "The contract has a hidden owner or a way to take ownership back, so a renounced owner does not mean the switches are gone.", addresses: [token], txs: [] });
  if (g.is_open_source === "0") add({ points: 15, title: "Contract source is not verified", detail: "Nobody can read what the contract does. Scam contracts hide their sell restrictions this way.", addresses: [token], txs: [] });
  if (yes(g.is_proxy)) add({ points: 10, title: "Upgradeable contract", detail: "The code behind this token can be replaced later, including with a version that blocks selling.", addresses: [token], txs: [] });
  if (yes(g.honeypot_with_same_creator)) add({ points: 35, title: "The creator has made honeypots before", detail: `GoPlus links ${dev ? short(dev) : "the creator"} to earlier tokens that could not be sold.`, addresses: dev ? [dev] : [], txs: [] });

  // 2. Who holds it: GoPlus lists the top holders, with pools, lockers and burns marked
  const pool = await poolOf(chain, token);
  const pair = pool?.pair?.toLowerCase();
  const rawHolders: any[] = g.holders ?? [];
  const people = rawHolders.filter((h) => !yes(h.is_contract) && !yes(h.is_locked) && !DEAD.has(String(h.address).toLowerCase()) && String(h.address).toLowerCase() !== pair);
  const pct = (h: any) => Number(h.percent) * 100;
  const top10 = people.slice(0, 10).reduce((s, h) => s + pct(h), 0);
  const devPct = Number(g.creator_percent || 0) * 100;
  log(`top holders that are people hold ${top10.toFixed(1)}%, creator ${devPct.toFixed(1)}%`);
  if (devPct >= 10) add({ points: devPct >= 25 ? 20 : 10, title: `The creator holds ${devPct.toFixed(1)}% of supply`, detail: `${short(dev ?? "")} still holds a large share and can dump it at any time.`, addresses: dev ? [dev] : [], txs: [] });
  if (top10 >= 50) add({ points: 10, title: `Top 10 wallets hold ${top10.toFixed(0)}%`, detail: "Supply is concentrated in a few wallets (pools, lockers and burns excluded).", addresses: people.slice(0, 10).map((h) => h.address), txs: [] });

  // 3. Liquidity: share of LP tokens burned or locked
  const liquidity = liquidityOfEvm(pool, g);
  log(`liquidity: ${liquidity.note}`);
  signals.unshift({ tone: liquidity.kind === "locked" ? "good" : liquidity.kind === "pullable" ? "warn" : "info", text: liquidity.note });
  if (liquidity.kind === "pullable" && liquidity.burnPct !== undefined) add({ points: 15, title: `Only ${liquidity.burnPct}% of the pool's LP tokens are burned or locked`, detail: `${liquidity.note} Whoever holds the rest can remove the liquidity and leave holders unable to sell.`, addresses: [], txs: [] });

  // 4. Trades: the pool's last 300 on GeckoTerminal. A young pool's list starts at its first trade.
  let trading: Trading | undefined;
  const events: NonNullable<TokenCheck["events"]> = [];
  const cluster = new Set<string>(dev ? [dev] : []);
  if (pool?.created) events.push({ ts: pool.created, kind: "launch", hash: "" });
  const trades: any[] = pool ? ((await gecko(() => fetchJson(`https://api.geckoterminal.com/api/v2/networks/${cfg.gt}/pools/${pool.pair}/trades`)).catch(() => null))?.data ?? []).map((t: any) => t.attributes) : [];
  if (!trades.length) log("no trade list for this pool on GeckoTerminal (launchpad curves are not indexed): skipping early buyers and trading checks");
  else {
    const asc = [...trades].sort((x, y) => x.block_number - y.block_number);
    const side = new Map<string, { b: number; s: number }>();
    for (const t of asc) {
      const w = String(t.tx_from_address).toLowerCase();
      const c = side.get(w) ?? { b: 0, s: 0 };
      if (t.kind === "buy") c.b++;
      else c.s++;
      side.set(w, c);
      if (dev && w === dev && t.kind === "sell") events.push({ ts: Date.parse(t.block_timestamp) / 1000, kind: "dev_sell", hash: t.tx_hash });
    }
    const n = asc.length;
    const churn = [...side.values()].filter((c) => c.b && c.s).reduce((a, c) => a + c.b + c.s, 0);
    const top = [...side.values()].map((c) => c.b + c.s).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
    trading = { txs: n, traders: side.size, buys: asc.filter((t) => t.kind === "buy").length, sells: asc.filter((t) => t.kind === "sell").length, roundTrip: churn / n, topShare: top / n };
    log(`last ${n} trades: ${trading.traders} wallets, ${trading.buys} buys / ${trading.sells} sells, ${Math.round(trading.roundTrip * 100)}% by wallets that bought and sold`);
    if (n >= 40 && (trading.roundTrip >= 0.6 || trading.topShare >= 0.6)) add({ points: 10, title: "Trading looks bot-made", detail: `Of the last ${n} trades, ${Math.round(trading.roundTrip * 100)}% come from wallets that both bought and sold, and the 5 busiest wallets made ${Math.round(trading.topShare * 100)}%. Volume like this is churned to climb trending lists.`, addresses: [], txs: [] });
    // GeckoTerminal lists up to 300 trades of the last 24 h: fewer than that from a pool under a day old is all of them
    const fromStart = asc.length < 300 && !!pool?.created && Date.now() / 1000 - pool.created < 86400;
    if (fromStart) {
      const first = asc[0].block_number;
      const snipers = [...new Set(asc.filter((t) => t.kind === "buy" && t.block_number - first <= SNIPE_BLOCKS).map((t) => String(t.tx_from_address).toLowerCase()))];
      for (const t of asc.filter((t) => t.kind === "buy" && t.block_number - first <= SNIPE_BLOCKS)) events.push({ ts: Date.parse(t.block_timestamp) / 1000, kind: "bundle_buy", hash: t.tx_hash });
      log(`${snipers.length} wallet(s) bought within ${SNIPE_BLOCKS} blocks of the first trade`);
      if (snipers.length >= 3) {
        snipers.forEach((w) => cluster.add(w));
        add({ points: 15, title: `${snipers.length} wallets bought in the first ${SNIPE_BLOCKS + 1} blocks`, detail: `Buying that fast needs a bot or a bundle prepared with the launch. Without wallet histories we cannot say who funded them; treat them as likely insiders.`, addresses: snipers.slice(0, 8), txs: [] });
      }
    } else log("the trade list does not reach the pool's first trade: early buyers are out of reach");
  }

  // Socials and their reuse by earlier tokens
  const socials = pool?.socials ?? { links: [] };
  if (!socials.twitter && !socials.telegram && !socials.website) signals.push({ tone: "info", text: "No own X account, Telegram or website." });
  const reused = reusedSocials(token, socials);
  if (reused.length) add({ points: 5, title: `Same ${[...new Set(reused.map((r) => r.key))].join(", ")} as ${reused.length} earlier token(s)`, detail: `${[...new Set(reused.map((r) => r.symbol))].slice(0, 6).join(", ")} used the same links. Serial launchers recycle their accounts from token to token.`, addresses: [...new Set(reused.map((r) => r.mint))].slice(0, 6), txs: [] });
  signals.push({ tone: "info", text: `On ${cfg.name} the developer's funding and past launches are not checked: that needs a paid indexer.` });

  // Holder list for the map: GoPlus gives addresses and shares, no funding links
  const holders: Holder[] = people.slice(0, 20).map((h) => ({ owner: String(h.address).toLowerCase(), pct: pct(h), funder: null, fundedAt: null, tags: String(h.address).toLowerCase() === dev ? ["dev"] : cluster.has(String(h.address).toLowerCase()) ? ["cluster"] : [] }));
  const clusterHold = await evmBalances(chain, token, [...cluster].slice(0, 15)).catch(() => ({}));
  const clusterPct = supply ? (Object.values(clusterHold).reduce((a, b) => a + b, 0) / supply) * 100 : 0;

  const risk = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const verdict = risk >= 50 ? "high" : risk >= 25 ? "medium" : "low";
  log(`risk ${risk}/100: ${verdict}`);
  const check: TokenCheck = {
    mint: token.toLowerCase(), symbol, name, checkedAt: Math.floor(Date.now() / 1000), createdAt: pool?.created ?? null, dev, devFunder: null, risk, verdict,
    reasons: reasons.filter((r) => r.points > 0).sort((x, y) => y.points - x.points),
    cluster: [...cluster], clusterPct,
    market: { fdv: pool?.fdv ?? null, liquidityUsd: pool?.liq ?? null, url: pool?.url ?? null, ...(pool ? { pair: pool.pair, dex: pool.dex, volume24: pool.volume24 } : {}) },
    log: logLines, chain, supply, clusterHold, holders, funders: [], launches: [], liquidity, trading, socials, reused, signals, events: events.sort((x, y) => x.ts - y.ts),
  };
  saveCheck(check);
  return check;
}
