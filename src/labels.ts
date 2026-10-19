import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchJson, sleep } from "./util.ts";

export type LabelKind = "cex" | "mixer" | "bridge" | "swap" | "dex" | "hacker" | "other";
export interface Label {
  kind: LabelKind;
  name: string;
  source: "seed" | "open" | "por" | "dune" | "manual";
}

const seed = JSON.parse(readFileSync(new URL("../data/labels.json", import.meta.url), "utf8"));
// Open dataset, per chain (scripts/import-labels.ts). Optional: the trace works without it.
let open: Record<string, Record<string, [LabelKind, string]>> = {};
try {
  open = JSON.parse(readFileSync(new URL("../data/labels-open.json", import.meta.url), "utf8"));
} catch {}
// Exchange wallets from proof-of-reserves reports, every chain including Solana and Tron (scripts/import-cex.ts)
let cex: Record<string, Record<string, string>> = {};
try {
  cex = JSON.parse(readFileSync(new URL("../data/labels-cex.json", import.meta.url), "utf8"));
} catch {}
const cache = new Map<string, Label | null>(); // key: chain:addr

// Labels people added from the wallet card. Kept in the repo, so everyone working on it shares them; they win over every other source.
const manualFile = new URL("../data/labels-manual.json", import.meta.url);
type ManualRow = { kind: LabelKind; name: string; by?: string; at: number };
let manual: Record<string, Record<string, ManualRow>> = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, "utf8")) : {};
export const LABEL_KINDS: LabelKind[] = ["cex", "swap", "mixer", "bridge", "dex", "hacker", "other"];

// Base58 chains are case-sensitive, hex chains are not
const exact = (chain: string) => chain === "solana" || chain === "tron" || chain === "bitcoin";
const keyOf = (chain: string, addr: string) => `${chain}:${exact(chain) ? addr : addr.toLowerCase()}`;

export function seedLabel(chain: string, addr: string): Label | null {
  const row = exact(chain) ? seed[chain]?.[addr] : seed.evm[addr.toLowerCase()];
  if (row) return { kind: row[0], name: row[1], source: "seed" };
  const o = exact(chain) ? undefined : open[chain]?.[addr.toLowerCase()];
  if (o) return { kind: o[0], name: o[1], source: "open" };
  const x = cex[chain]?.[exact(chain) ? addr : addr.toLowerCase()];
  return x ? { kind: "cex", name: x, source: "por" } : null;
}

export function label(chain: string, addr: string): Label | null {
  const m = manual[chain]?.[exact(chain) ? addr : addr.toLowerCase()];
  if (m) return { kind: m.kind, name: m.name, source: "manual" };
  return cache.get(keyOf(chain, addr)) ?? seedLabel(chain, addr);
}

export function setManualLabel(chain: string, addr: string, kind: LabelKind, name: string, by?: string) {
  const a = exact(chain) ? addr : addr.toLowerCase();
  // Re-read first: another process (the CLI, a second server) may have written since start
  manual = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, "utf8")) : {};
  (manual[chain] ??= {})[a] = { kind, name, ...(by ? { by } : {}), at: Math.floor(Date.now() / 1000) };
  writeFileSync(manualFile, `${JSON.stringify(manual, null, 1)}\n`);
}

export function removeManualLabel(chain: string, addr: string) {
  manual = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, "utf8")) : {};
  delete manual[chain]?.[exact(chain) ? addr : addr.toLowerCase()];
  writeFileSync(manualFile, `${JSON.stringify(manual, null, 1)}\n`);
}

function kindFrom(category: string, name: string): LabelKind {
  const s = `${category} ${name}`.toLowerCase();
  if (/exploiter|hacker|heist|phish/.test(s)) return "hacker";
  if (/tornado|mixer|railgun|wasabi|sinbad/.test(s)) return "mixer";
  if (/\bcex\b|exchange|binance|coinbase|kraken|okx|bybit|kucoin|htx|huobi|gate\.io|bitget|mexc/.test(s)) return "cex";
  if (/bridge|wormhole|stargate|across|thorchain|layerzero|debridge|mayan/.test(s)) return "bridge";
  if (/fixedfloat|changenow|sideshift|exch\b|swap service|instant exchange/.test(s)) return "swap";
  if (/dex|uniswap|router|aggregator|jupiter|raydium|1inch|0x /.test(s)) return "dex";
  return "other";
}

// Batch lookup in Dune's labels.addresses. Silently does nothing without a key or if Dune is down.
export async function lookupDune(chain: string, addrs: string[], log: (s: string) => void): Promise<void> {
  const key = process.env.DUNE_API_KEY;
  const todo = [...new Set(addrs)].filter((a) => !cache.has(keyOf(chain, a)));
  if (!key || !todo.length || chain === "solana") return; // Dune labels are reliable for EVM only
  for (const a of todo) cache.set(keyOf(chain, a), null);

  const list = todo.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).map((a) => a.toLowerCase());
  if (!list.length) return;
  const sql = `SELECT lower(cast(address AS varchar)) AS addr, name, category
FROM labels.addresses
WHERE blockchain = '${chain}' AND address IN (${list.join(",")})`;
  const headers = { "X-Dune-Api-Key": key, "content-type": "application/json" };
  try {
    const exec = await fetchJson("https://api.dune.com/api/v1/sql/execute", { method: "POST", headers, body: JSON.stringify({ sql, performance: "medium" }) }, 2);
    const id = exec.execution_id;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const st = await fetchJson(`https://api.dune.com/api/v1/execution/${id}/status`, { headers });
      if (st.state === "QUERY_STATE_COMPLETED") break;
      if (/FAILED|CANCELLED|EXPIRED/.test(st.state)) throw new Error(st.state);
      await sleep(2000);
    }
    const res = await fetchJson(`https://api.dune.com/api/v1/execution/${id}/results?limit=1000`, { headers });
    const rows: any[] = res.result?.rows ?? [];
    // Several labels per address are common; prefer the one that tells us the most.
    const rank: Record<LabelKind, number> = { hacker: 6, mixer: 5, cex: 4, swap: 3, bridge: 2, dex: 1, other: 0 };
    for (const r of rows) {
      const kind = kindFrom(r.category ?? "", r.name ?? "");
      const k = keyOf(chain, r.addr);
      const prev = cache.get(k);
      if (!prev || rank[kind] > rank[prev.kind]) cache.set(k, { kind, name: r.name, source: "dune" });
    }
    log(`dune: ${rows.length} labels for ${list.length} ${chain} addresses`);
  } catch (e) {
    log(`dune labels unavailable (${(e as Error).message.slice(0, 120)}) — using seed labels + activity heuristics`);
  }
}
