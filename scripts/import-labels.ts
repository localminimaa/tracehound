// Turns the open eth-labels dataset (github.com/dawsbot/eth-labels, data/csv/accounts.csv)
// into data/labels-open.json. Only the labels that matter for a trace are kept.
// Usage: node scripts/import-labels.ts <accounts.csv>
import { readFileSync, writeFileSync } from "node:fs";

const CHAINS: Record<string, string> = { "1": "ethereum", "8453": "base", "42161": "arbitrum", "10": "optimism", "56": "bsc", "137": "polygon" };

const CEX = new Set([
  "exchange", "binance", "coinbase", "kraken", "okx", "kucoin", "bitfinex", "bitstamp", "gemini", "crypto-com", "upbit",
  "bithumb", "poloniex", "gate-io", "gate", "mexc", "bitget", "deribit", "bilaxy", "blofin-exchange", "delta-exchange",
]);
const SWAP = new Set(["changenow", "fixedfloat"]);
const MIXER = new Set(["tornado-cash", "mixer", "ethereum-mixer", "typhoon-cash"]);
const BRIDGE = new Set(["bridge", "allbridge", "debridge", "stargate", "optimism-bridge"]);
const DEX = new Set(["uniswap", "sushiswap", "pancakeswap", "kyberswap", "paraswap", "0x-protocol", "1inch", "dex", "curve-finance", "balancer", "bscswap"]);
const HACKER = new Set(["exploit", "heist", "phish-hack"]);

function kindOf(label: string, tag: string): string | null {
  if (HACKER.has(label) || label.endsWith("-exploit") || /exploiter|hacker|phish/i.test(tag)) return "hacker";
  if (MIXER.has(label)) return "mixer";
  if (CEX.has(label)) return "cex";
  if (SWAP.has(label)) return "swap";
  if (BRIDGE.has(label)) return "bridge";
  if (DEX.has(label)) return "dex";
  return null;
}

// Minimal CSV reader: every field in this file is either quoted or a bare number
const parse = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)|(?<=,)(?=,|$)/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/""/g, '"'));

const [, , path] = process.argv;
if (!path) throw new Error("usage: node scripts/import-labels.ts <accounts.csv>");
const out: Record<string, Record<string, [string, string]>> = {};
let kept = 0;
for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
  if (!line.trim()) continue;
  const [addr, chainId, label, tag] = parse(line);
  const chain = CHAINS[chainId];
  const kind = chain && /^0x[0-9a-f]{40}$/i.test(addr) ? kindOf(label, tag) : null;
  if (!kind) continue;
  const name = tag && tag !== "null" ? tag : label;
  (out[chain] ??= {})[addr.toLowerCase()] = [kind, name];
  kept++;
}
writeFileSync(new URL("../data/labels-open.json", import.meta.url), JSON.stringify({ _source: "github.com/dawsbot/eth-labels", ...out }));
console.log(`kept ${kept} labels:`, Object.fromEntries(Object.entries(out).map(([c, m]) => [c, Object.keys(m).length])));
