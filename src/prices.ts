// USD value of each flow at the time it moved, from DefiLlama (free, keyless). Only assets we trust by
// contract or by chain are priced: a token that merely calls itself "USDT" gets no dollar value.
import type { GEdge } from "./types.ts";
import { fetchJson } from "./util.ts";

const IDS: Record<string, string> = {
  ETH: "ethereum", WETH: "ethereum", stETH: "staked-ether", wstETH: "wrapped-steth", cbETH: "coinbase-wrapped-staked-eth",
  rETH: "rocket-pool-eth", mETH: "mantle-staked-ether", cmETH: "mantle-restaked-eth",
  USDC: "usd-coin", "USDC.e": "usd-coin", USDT: "tether", DAI: "dai", USDe: "ethena-usde", USDD: "usdd",
  WBTC: "wrapped-bitcoin", BTC: "bitcoin", BTCB: "bitcoin", "WBTC (Wormhole)": "wrapped-bitcoin", "BTC (Sollet)": "bitcoin",
  SOL: "solana", mSOL: "msol", JitoSOL: "jito-staked-sol", bSOL: "blazestake-staked-sol", stSOL: "lido-staked-sol",
  "ETH (Wormhole)": "ethereum", "ETH (Sollet)": "ethereum",
  TRX: "tron", BNB: "binancecoin", WBNB: "binancecoin", POL: "polygon-ecosystem-token", WPOL: "polygon-ecosystem-token",
  LTC: "litecoin", DOGE: "dogecoin", BCH: "bitcoin-cash", AVAX: "avalanche-2", XRP: "ripple", ZEC: "zcash", ATOM: "cosmos", RUNE: "thorchain",
};
const HOUR = 3600;

export async function priceEdges(edges: GEdge[]): Promise<number> {
  const todo = edges.filter((e) => !e.unverified && IDS[e.asset]);
  if (!todo.length) return 0;
  const at = (e: GEdge) => Math.round(e.first / HOUR) * HOUR;
  const want: Record<string, number[]> = {};
  for (const e of todo) {
    const id = `coingecko:${IDS[e.asset]}`;
    want[id] = [...new Set([...(want[id] ?? []), at(e)])];
  }
  const hist = await fetchJson(`https://coins.llama.fi/batchHistorical?coins=${encodeURIComponent(JSON.stringify(want))}&searchWidth=6h`).catch(() => null);
  const price = (id: string, ts: number) =>
    hist?.coins?.[id]?.prices?.reduce((best: any, p: any) => (!best || Math.abs(p.timestamp - ts) < Math.abs(best.timestamp - ts) ? p : best), null)?.price as number | undefined;
  // An asset with no price history around that time falls back to today's price, and the flow says so
  const missing = [...new Set(todo.filter((e) => price(`coingecko:${IDS[e.asset]}`, at(e)) === undefined).map((e) => `coingecko:${IDS[e.asset]}`))];
  const now = missing.length ? (await fetchJson(`https://coins.llama.fi/prices/current/${missing.join(",")}`).catch(() => null))?.coins ?? {} : {};
  let n = 0;
  for (const e of todo) {
    const id = `coingecko:${IDS[e.asset]}`;
    const p = price(id, at(e)) ?? now[id]?.price;
    if (!p) continue;
    e.usd = e.amount * p;
    if (price(id, at(e)) === undefined) e.usdNow = true;
    n++;
  }
  return n;
}
