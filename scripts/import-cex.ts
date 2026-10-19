// Exchange wallets from proof of reserves: the addresses exchanges publish so anyone can check their balances. They are
// the exchanges' own hot and cold wallets, on every chain, Solana and Tron included, where no open label set exists.
// Binance and Bybit are read from the exchanges' own endpoints. The rest (OKX, KuCoin, Bitget, HTX, Gate, Bitfinex and
// smaller ones) from the lists DefiLlama keeps of those reports: only the addresses are taken, as text, nothing is run.
// Output: data/labels-cex.json, { chain: { address: exchange } }. Usage: node scripts/import-cex.ts
import { writeFileSync } from "node:fs";

const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "bsc", "polygon", "solana", "tron", "bitcoin"] as const;
type Chain = (typeof CHAINS)[number];
const VALID: Record<Chain, RegExp> = {
  ethereum: /^0x[0-9a-fA-F]{40}$/, base: /^0x[0-9a-fA-F]{40}$/, arbitrum: /^0x[0-9a-fA-F]{40}$/, optimism: /^0x[0-9a-fA-F]{40}$/,
  bsc: /^0x[0-9a-fA-F]{40}$/, polygon: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, bitcoin: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};
const norm = (c: Chain, a: string) => (VALID[c].source.startsWith("^0x") ? a.toLowerCase() : a);

const out: Record<string, Record<string, string>> = Object.fromEntries(CHAINS.map((c) => [c, {}]));
const counts: Record<string, number> = {};
let clashes = 0;
function add(chain: Chain, addr: string, name: string) {
  addr = addr.trim();
  if (!VALID[chain].test(addr)) return;
  const a = norm(chain, addr);
  const prev = out[chain][a];
  if (prev && prev !== name) clashes++; // a custodian holding for two exchanges: the first name stays
  if (prev) return;
  out[chain][a] = name;
  counts[name] = (counts[name] ?? 0) + 1;
}

const get = async (url: string) => {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 tracehound-labels" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
};

// Binance: one list for every network
const BINANCE: Record<string, Chain> = { ETH: "ethereum", BSC: "bsc", BEP20: "bsc", ARBITRUM: "arbitrum", OP: "optimism", OPTIMISM: "optimism", MATIC: "polygon", BASE: "base", SOL: "solana", TRX: "tron", TRON: "tron", BTC: "bitcoin" };
try {
  const rows: any[] = JSON.parse(await get("https://www.binance.com/bapi/apex/v1/public/apex/market/por/address")).data ?? [];
  for (const r of rows) if (BINANCE[String(r.network).toUpperCase()]) add(BINANCE[String(r.network).toUpperCase()], String(r.address), "Binance");
} catch (e) {
  console.error(`binance: ${(e as Error).message}`);
}

// Bybit: a monthly CSV, Coin,Height,Amount,Address with "<COIN>-<Network>" and space-separated addresses
const BYBIT: Record<string, Chain> = { ethereum: "ethereum", bsc: "bsc", arbitrum: "arbitrum", optimism: "optimism", polygon: "polygon", base: "base", solana: "solana", trx: "tron", tron: "tron", btc: "bitcoin", bitcoin: "bitcoin" };
for (let i = 0; i < 3; i++) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - i);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const csv = await get(`https://api2.bybit.com/common-static/por/bybit_por_${ym}.csv`).catch(() => "");
  if (!csv.startsWith("Coin,")) continue;
  for (const line of csv.split("\n").slice(1)) {
    const [coin, , , addrs] = line.split(",");
    const net = coin?.split("-").pop()?.toLowerCase() ?? "";
    const chain = BYBIT[net] ?? (coin === "BTC" ? "bitcoin" : undefined);
    if (chain) for (const a of (addrs ?? "").split(/\s+/)) add(chain, a.replace(/"/g, ""), "Bybit");
  }
  console.log(`bybit: report ${ym}`);
  break;
}

// DefiLlama's lists. Per chain block ("tron: {" ...), only the owners array is read: other arrays there are token lists.
const RAW = "https://raw.githubusercontent.com/DefiLlama/DefiLlama-Adapters/main";
const block = (src: string, from: number) => {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(from, i + 1);
  }
  return "";
};
function owners(src: string, name: string) {
  for (const chain of CHAINS) {
    const re = new RegExp(`(?:^|[\\s,{])["']?${chain}["']?\\s*:\\s*\\{`, "g");
    for (const m of src.matchAll(re)) {
      const body = block(src, m.index! + m[0].lastIndexOf("{"));
      for (const o of body.matchAll(/["']?owners["']?\s*:\s*\[([^\]]*)\]/g)) for (const s of o[1].matchAll(/["'`]([^"'`]+)["'`]/g)) add(chain, s[1], name);
    }
  }
}
const FILES: Record<string, string> = { okex: "OKX", kucoin: "KuCoin", bitget: "Bitget", huobi: "HTX", "gate-io": "Gate", bitfinex: "Bitfinex" };
for (const [file, name] of Object.entries(FILES)) {
  try {
    owners(await get(`${RAW}/projects/${file}/index.js`), name);
  } catch (e) {
    console.error(`${name}: ${(e as Error).message}`);
  }
}
// Smaller exchanges sit together in one object, one top-level key each
const title = (k: string) => k.replace(/-cex$|-exchange$/, "").split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
try {
  const src = await get(`${RAW}/cex/index.js`);
  const start = src.indexOf("const configs = {");
  const body = block(src, src.indexOf("{", start));
  for (const m of body.matchAll(/\n {2}["']?([\w.-]+)["']?\s*:\s*\{/g)) owners(block(body, m.index! + m[0].lastIndexOf("{")), title(m[1]));
} catch (e) {
  console.error(`small exchanges: ${(e as Error).message}`);
}

const file = new URL("../data/labels-cex.json", import.meta.url);
writeFileSync(file, `${JSON.stringify({ _source: "exchange proof-of-reserves wallets: Binance and Bybit from their own reports, the rest via DefiLlama's lists of those reports", _at: new Date().toISOString().slice(0, 10), ...out }, null, 0).replace(/,"/g, ',\n"')}\n`);
console.log(CHAINS.map((c) => `${c} ${Object.keys(out[c]).length}`).join(", "));
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, k]) => `${n} ${k}`).join(", "), clashes ? `· ${clashes} address(es) listed by two exchanges, first kept` : "");
