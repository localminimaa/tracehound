// Extra evidence for the token check that needs no developer tracing: the pool's liquidity, how the
// token trades, its socials reused by other tokens, and smart money among its wallets.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fetchJson } from "./util.ts";

// DexScreener pool data for one token: the deepest pool, plus what the token says about itself
export interface Pool {
  pair: string;
  dex: string; // dexscreener dexId: pumpfun, pumpswap, raydium, meteora, ...
  fdv: number | null;
  liq: number | null;
  priceUsd: number | null;
  created: number | null;
  url: string | null;
  buys24: number;
  sells24: number;
  volume24: number;
  socials: Socials;
}
export interface Socials { twitter?: string; telegram?: string; website?: string; image?: string; links: string[] }

export async function poolOf(chain: string, token: string): Promise<Pool | null> {
  const pairs: any[] = await fetchJson(`https://api.dexscreener.com/tokens/v1/${chain}/${token}`).catch(() => []);
  const own = (pairs ?? []).filter((p) => p.baseToken?.address?.toLowerCase() === token.toLowerCase());
  const p = own.sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
  if (!p) return null;
  const links: string[] = [...(p.info?.websites ?? []).map((w: any) => w.url), ...(p.info?.socials ?? []).map((s: any) => s.url)].filter(Boolean);
  return {
    pair: p.pairAddress, dex: p.dexId, fdv: p.fdv ?? p.marketCap ?? null, liq: p.liquidity?.usd ?? null, priceUsd: Number(p.priceUsd) || null,
    created: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null, url: p.url ?? null,
    buys24: p.txns?.h24?.buys ?? 0, sells24: p.txns?.h24?.sells ?? 0, volume24: p.volume?.h24 ?? 0,
    socials: socialsOf(links),
  };
}

// An X account or a site identifies a team; a search link or a news tweet identifies nobody
export function socialsOf(links: string[], image?: string): Socials {
  const s: Socials = { links: [...new Set(links)] };
  for (const raw of s.links) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.split("/").filter(Boolean);
    if (host === "x.com" || host === "twitter.com") {
      if (path[0] === "i" && path[1] === "communities" && path[2]) s.twitter ??= `community/${path[2]}`;
      else if (path[0] && !["search", "intent", "home", "hashtag", "i"].includes(path[0]) && path[1] !== "status") s.twitter ??= path[0].toLowerCase();
    } else if (host === "t.me" || host === "telegram.me") {
      if (path[0]) s.telegram ??= path[0].toLowerCase();
    } else if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u.pathname) || /(^|\.)(ipfs|cdn)|cdn\.|ipfs\./.test(host)) {
      // an image file or a CDN is the token's picture, not its site
    } else if (!/(tiktok|youtube|youtu\.be|instagram|reddit|dexscreener|pump\.fun|solscan|birdeye)/.test(host)) s.website ??= host;
  }
  if (image) s.image = image;
  return s;
}

// Liquidity that the developer cannot pull is the first thing a buyer wants to know
export interface Liquidity { kind: "locked" | "pullable" | "unknown"; note: string; burnPct?: number }
export async function liquidityOf(pool: Pool | null, mint: string): Promise<Liquidity> {
  if (!pool) return { kind: "unknown", note: "No pool found." };
  if (pool.dex === "pumpfun") return { kind: "locked", note: "Still on the pump.fun bonding curve: nobody can withdraw its liquidity." };
  // Only a pump.fun graduation burns the LP; anyone can open a PumpSwap pool for any token and keep its LP
  if (pool.dex === "pumpswap" && mint.endsWith("pump")) return { kind: "locked", note: "Graduated to PumpSwap: pump.fun created the pool and burned its LP tokens." };
  if (pool.dex === "pumpswap") return { kind: "unknown", note: "PumpSwap pool opened by hand, not a pump.fun graduation: its LP may still be held by whoever opened it." };
  if (pool.dex === "raydium") {
    const j = await fetchJson(`https://api-v3.raydium.io/pools/info/ids?ids=${pool.pair}`).catch(() => null);
    const p = j?.data?.[0];
    if (p?.type === "Concentrated") return { kind: "pullable", note: "Raydium concentrated pool: liquidity sits in positions their owners can close at any time." };
    if (typeof p?.burnPercent === "number") {
      const b = p.burnPercent;
      return b >= 95 ? { kind: "locked", note: `Raydium pool, ${b}% of LP tokens burned.`, burnPct: b } : { kind: "pullable", note: `Raydium pool, only ${b}% of LP tokens burned: the rest can be withdrawn.`, burnPct: b };
    }
  }
  if (pool.dex.startsWith("meteora")) return { kind: "pullable", note: "Meteora pool: liquidity providers, including the developer, can withdraw at any time." };
  return { kind: "unknown", note: `${pool.dex} pool: lock status not checked.` };
}

// Base and BSC: GoPlus lists who holds the pool's LP tokens, with burns and lockers marked
export function liquidityOfEvm(pool: Pool | null, g: any): Liquidity {
  const lp: any[] = g?.lp_holders ?? [];
  const launchpad = g?.launchpad_token?.is_launchpad_token === "1" ? g.launchpad_token.launchpad_name ?? "the launchpad" : null;
  // GoPlus may describe a different, smaller pool; only its data on the pool people actually trade counts
  const main = (g?.dex ?? []).find((d: any) => pool && String(d.pair).toLowerCase() === pool.pair.toLowerCase());
  if (!pool) return launchpad && g?.is_in_dex !== "1" ? { kind: "locked", note: `Still on ${launchpad}'s bonding curve: there is no pool liquidity to pull yet.` } : { kind: "unknown", note: "No pool found." };
  if (!main) return { kind: "unknown", note: `${pool.dex} pool: lock status not available for this pool.` };
  if (!/v2/i.test(main.liquidity_type ?? "") || !lp.length) return { kind: "pullable", note: `${main.name ?? pool.dex} pool without LP tokens: liquidity sits in positions their owners can withdraw at any time.` };
  const dead = /^0x0{40}$|^0x0{36}dead$/i;
  const safe = lp.filter((h) => h.is_locked === 1 || dead.test(h.address)).reduce((s, h) => s + Number(h.percent), 0);
  const b = Math.round(safe * 100);
  return b >= 95 ? { kind: "locked", note: `${b}% of the pool's LP tokens are burned or locked.`, burnPct: b } : { kind: "pullable", note: `Only ${b}% of the pool's LP tokens are burned or locked: the rest can be withdrawn.`, burnPct: b };
}

// Recent trading from the mint's last transactions: who buys, who sells, and who does both in circles
export interface Trading { txs: number; traders: number; buys: number; sells: number; roundTrip: number; topShare: number }
export function tradingOf(mint: string, txs: any[]): Trading {
  const side = new Map<string, { b: number; s: number }>();
  let buys = 0, sells = 0, n = 0;
  for (const t of txs) {
    if (t.transactionError || !t.feePayer) continue;
    const w = t.feePayer;
    const got = (t.tokenTransfers ?? []).some((x: any) => x.mint === mint && x.toUserAccount === w);
    const gave = (t.tokenTransfers ?? []).some((x: any) => x.mint === mint && x.fromUserAccount === w);
    if (got === gave) continue; // not a trade by the fee payer
    n++;
    const c = side.get(w) ?? { b: 0, s: 0 };
    if (got) c.b++, buys++;
    else c.s++, sells++;
    side.set(w, c);
  }
  // Wallets that bought and sold inside this short window churn volume rather than invest
  const churn = [...side.values()].filter((c) => c.b && c.s).reduce((a, c) => a + c.b + c.s, 0);
  const top = [...side.values()].map((c) => c.b + c.s).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  return { txs: n, traders: side.size, buys, sells, roundTrip: n ? churn / n : 0, topShare: n ? top / n : 0 };
}

// Socials used by another token we checked before. Serial launchers reuse their accounts and sites.
export interface Reuse { key: string; value: string; mint: string; symbol: string; checkedAt: number }
export function reusedSocials(mint: string, s: Socials): Reuse[] {
  const dir = new URL("../data/tokens/", import.meta.url);
  if (!existsSync(dir)) return [];
  const mine: [string, string | undefined][] = [["twitter", s.twitter], ["telegram", s.telegram], ["website", s.website], ["image", s.image]];
  const out = new Map<string, Reuse>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(mint))) {
    let c: any;
    try {
      c = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    } catch {
      continue;
    }
    for (const [k, v] of mine) if (v && c.socials?.[k] === v && !out.has(`${c.mint}|${k}`)) out.set(`${c.mint}|${k}`, { key: k, value: v, mint: c.mint, symbol: c.symbol, checkedAt: c.checkedAt });
  }
  return [...out.values()];
}

// Wallets the smart money scan (npm run smart) rated as good traders in the last week
export function smartSets(): { smart: Map<string, number>; at: number | null } {
  const smart = new Map<string, number>();
  const dir = new URL("../data/smart/", import.meta.url);
  if (!existsSync(dir)) return { smart, at: null };
  let at: number | null = null;
  const week = Date.now() / 1000 - 7 * 86400;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let r: any;
    try {
      r = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    } catch {
      continue;
    }
    if (r.at < week) continue;
    at = Math.max(at ?? 0, r.at);
    for (const c of r.clusters ?? []) {
      if (c.kind === "ring") continue;
      for (const w of c.wallets ?? []) if (w.hitRate !== null && w.hitRate >= 0.2) smart.set(w.wallet, Math.max(smart.get(w.wallet) ?? 0, w.hitRate));
    }
  }
  return { smart, at };
}

// Peak value and how fast a token died, from its GeckoTerminal hourly candles. Used for past launches.
const GT = "https://api.geckoterminal.com/api/v2/networks";
export async function lifeOf(chain: string, token: string): Promise<{ peak: number; peakAt: number; peakAfterH: number; lastTradeAt: number; deadAfterH: number | null } | null> {
  const net = chain === "ethereum" ? "eth" : chain;
  const pools: any[] = (await fetchJson(`${GT}/${net}/tokens/${token}/pools?page=1`).catch(() => null))?.data ?? [];
  const p = pools[0]?.attributes;
  if (!p) return null;
  const supply = Number(p.fdv_usd) / Number(p.base_token_price_usd) || 1e9;
  const ohlcv: number[][] = (await fetchJson(`${GT}/${net}/pools/${p.address}/ohlcv/hour?limit=1000&currency=usd&token=base`).catch(() => null))?.data?.attributes?.ohlcv_list ?? [];
  if (!ohlcv.length) return null;
  const c = [...ohlcv].sort((a, b) => a[0] - b[0]);
  const top = c.reduce((m, x) => (x[2] > m[2] ? x : m));
  // Dead: the first hour after the peak that closes 90% below it. Hours without trades have no candle,
  // so a token nobody trades anymore simply stops; its last candle says when.
  const dead = c.find((x) => x[0] > top[0] && x[4] < top[2] * 0.1);
  const h = (t: number) => Math.round((t - c[0][0]) / 3600);
  return { peak: top[2] * supply, peakAt: top[0], peakAfterH: h(top[0]), lastTradeAt: c[c.length - 1][0], deadAfterH: dead ? h(dead[0]) : null };
}
