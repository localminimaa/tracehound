import { createHash } from "node:crypto";
import type { Adapter, Profile, ResolvedTx, Transfer } from "../types.ts";
import { fetchJson, limiter } from "../util.ts";

// Esplora API (mempool.space, blockstream.info as a fallback): free and keyless.
const BASES = [process.env.BTC_API_URL || "https://mempool.space/api", "https://blockstream.info/api"];
const throttle = limiter(Number(process.env.BTC_RPS) || 2);
const SAT = 1e8;
const MIN = 0.0002; // smaller outputs are change dust or spam, not a lead
const PAGES = 4; // 25 confirmed txs per page; a busy address is an exchange or a service anyway
const FIRST_PAGES = 8; // pages read to reach an address's first tx
const HUB_TXS = 2000;

const get = (path: string) => throttle(() => fetchJson(`${BASES[0]}${path}`).catch(() => fetchJson(`${BASES[1]}${path}`)));

// Legacy addresses are base58check with a 25-byte payload; Solana addresses decode to 32 bytes, so the two never mix up
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58check(s: string): boolean {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const zeros = s.match(/^1*/)![0].length;
  const raw = Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
  if (raw.length !== 25) return false;
  const sum = createHash("sha256").update(createHash("sha256").update(raw.subarray(0, 21)).digest()).digest();
  return sum.subarray(0, 4).equals(raw.subarray(21));
}
export const isBtcAddress = (s: string) => /^(bc1|BC1)[0-9a-zA-Z]{11,71}$/.test(s) || (/^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/.test(s) && base58check(s));
export const isBtcTx = (s: string) => /^[0-9a-fA-F]{64}$/.test(s);

const ins = (tx: any): string[] => (tx.vin ?? []).map((v: any) => v.prevout?.scriptpubkey_address).filter(Boolean);
// The input that put the most money in stands for the sender
const sender = (tx: any): string | null =>
  [...(tx.vin ?? [])].sort((x: any, y: any) => (y.prevout?.value ?? 0) - (x.prevout?.value ?? 0))[0]?.prevout?.scriptpubkey_address ?? null;

export function bitcoinAdapter(): Adapter {
  const profiles = new Map<string, Profile>();
  const norm = (a: string) => (/^bc1/i.test(a) ? a.toLowerCase() : a);

  // Confirmed history, newest first, page by page
  async function history(a: string, pages: number): Promise<any[]> {
    const out: any[] = [];
    let page: any[] = await get(`/address/${a}/txs`);
    for (let i = 0; i < pages && page.length; i++) {
      out.push(...page.filter((t) => t.status?.confirmed));
      if (page.length < 25) break;
      page = await get(`/address/${a}/txs/chain/${page[page.length - 1].txid}`);
    }
    return out;
  }

  // What an address sent in a tx: every output that does not go back to one of the tx's own inputs (change)
  const sent = (tx: any, a: string): Transfer[] => {
    const from = new Set(ins(tx));
    if (!from.has(a)) return [];
    return (tx.vout ?? [])
      .filter((o: any) => o.scriptpubkey_address && !from.has(o.scriptpubkey_address) && o.value / SAT >= MIN)
      .map((o: any) => ({ from: a, to: o.scriptpubkey_address, amount: o.value / SAT, asset: "BTC", hash: tx.txid, ts: tx.status.block_time }));
  };

  return {
    chain: "bitcoin",
    native: "BTC",
    norm,
    addrUrl: (a) => `https://mempool.space/address/${a}`,
    txUrl: (h) => `https://mempool.space/tx/${h}`,

    async resolveTx(hash): Promise<ResolvedTx | null> {
      const tx = await get(`/tx/${hash.toLowerCase()}`).catch(() => null);
      if (!tx) return null;
      const from = sender(tx);
      return from ? { from, to: null, ts: tx.status?.block_time ?? 0 } : null;
    },

    async firstFunding(a) {
      const txs = await history(a, FIRST_PAGES);
      if (txs.length >= FIRST_PAGES * 25) return null; // first tx is beyond reach
      for (const tx of [...txs].reverse()) {
        const got = (tx.vout ?? []).filter((o: any) => o.scriptpubkey_address === a).reduce((s: number, o: any) => s + o.value, 0);
        const from = sender(tx);
        if (got && from && from !== a) return { from, to: a, amount: got / SAT, asset: "BTC", hash: tx.txid, ts: tx.status.block_time };
      }
      return null;
    },

    async outflows(a, max) {
      const txs = await history(a, Math.min(PAGES, Math.ceil(max / 25)));
      return txs.flatMap((tx) => sent(tx, a));
    },

    async profile(a) {
      const hit = profiles.get(a);
      if (hit) return hit;
      const s = await get(`/address/${a}`);
      const n = (s.chain_stats?.tx_count ?? 0) + (s.mempool_stats?.tx_count ?? 0);
      const p = { isContract: false, hub: n >= HUB_TXS, txCount: n };
      profiles.set(a, p);
      return p;
    },
  };
}
