import { createHash } from "node:crypto";
import type { Adapter, Profile, ResolvedTx, Transfer } from "../types.ts";
import { fetchJson, limiter } from "../util.ts";

// TronGrid works without a key at a low rate. A free key (TRONGRID_API_KEY) raises the limit.
const API = process.env.TRONGRID_API_BASE || "https://api.trongrid.io";
const throttle = limiter(Number(process.env.TRONGRID_RPS) || (process.env.TRONGRID_API_KEY ? 10 : 3));
const SUN = 1e6;
const TRX_MIN = 50;
const PAGE = 200;

// Tokens we trust by contract, with the smallest amount worth following.
// Tron is full of fake "USDT" contracts used for address poisoning, so nothing else is followed.
const TOKENS: Record<string, [string, number]> = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: ["USDT", 5],
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: ["USDC", 5],
  TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz: ["USDD", 5],
};

export const isTronAddress = (s: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
export const isTronTx = (s: string) => /^[0-9a-fA-F]{64}$/.test(s);

// TronGrid returns raw addresses as hex with a 41 prefix; everything else here is base58check.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha = (b: Buffer) => createHash("sha256").update(b).digest();
export function hexToTron(hex: string): string {
  const raw = Buffer.from(hex.replace(/^0x/, ""), "hex");
  const body = Buffer.concat([raw, sha(sha(raw)).subarray(0, 4)]);
  let n = BigInt(`0x${body.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of body) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}
const addr = (s: string) => (s && !isTronAddress(s) ? hexToTron(s) : s);

export function tronAdapter(): Adapter {
  const headers: Record<string, string> = process.env.TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY } : {};
  const profiles = new Map<string, Profile>();

  const get = (path: string) => throttle(() => fetchJson(`${API}${path}`, { headers }));
  const post = (path: string, body: object) =>
    throttle(() => fetchJson(`${API}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));

  // Plain TRX transfers. Contract calls (including TRC20 transfers) carry no TRX and are read separately.
  const trx = async (a: string, q: string): Promise<Transfer[]> => {
    const j = await get(`/v1/accounts/${a}/transactions?${q}&limit=${PAGE}`);
    return (j.data ?? []).flatMap((tx: any) => {
      const c = tx.raw_data?.contract?.[0];
      if (c?.type !== "TransferContract" || tx.ret?.[0]?.contractRet !== "SUCCESS") return [];
      const v = c.parameter.value;
      const memo = tx.raw_data.data ? Buffer.from(tx.raw_data.data, "hex").toString("utf8") : undefined;
      return [{ from: addr(v.owner_address), to: addr(v.to_address), amount: v.amount / SUN, asset: "TRX", hash: tx.txID, ts: Math.floor(tx.block_timestamp / 1000), ...(memo ? { memo } : {}) }];
    });
  };
  const trc20 = async (a: string, q: string): Promise<Transfer[]> => {
    const j = await get(`/v1/accounts/${a}/transactions/trc20?${q}&limit=${PAGE}`);
    return (j.data ?? []).flatMap((t: any) => {
      const tok = TOKENS[t.token_info?.address];
      if (!tok || t.type !== "Transfer") return [];
      return [{ from: t.from, to: t.to, amount: Number(t.value) / 10 ** Number(t.token_info.decimals ?? 6), asset: tok[0], hash: t.transaction_id, ts: Math.floor(t.block_timestamp / 1000) }];
    });
  };
  const min = (t: Transfer) => (t.asset === "TRX" ? TRX_MIN : Object.values(TOKENS).find(([s]) => s === t.asset)?.[1] ?? 0);

  return {
    chain: "tron",
    native: "TRX",
    norm: (a) => a,
    addrUrl: (a) => `https://tronscan.org/#/address/${a}`,
    txUrl: (h) => `https://tronscan.org/#/transaction/${h}`,

    async resolveTx(hash): Promise<ResolvedTx | null> {
      const tx = await post("/wallet/gettransactionbyid", { value: hash.toLowerCase(), visible: true });
      const v = tx?.raw_data?.contract?.[0]?.parameter?.value;
      if (!v) return null;
      return { from: v.owner_address, to: v.contract_address ?? v.to_address ?? null, ts: Math.floor((tx.raw_data.timestamp ?? 0) / 1000) };
    },

    async firstFunding(a) {
      const [coins, tokens] = await Promise.all([
        trx(a, "only_to=true&order_by=block_timestamp,asc"),
        trc20(a, "only_to=true&order_by=block_timestamp,asc"),
      ]);
      // Activation dust (1 TRX from a poisoner) is not funding: take the first real amount
      return [...coins, ...tokens].filter((t) => t.to === a && t.amount >= min(t) / 10).sort((x, y) => x.ts - y.ts)[0] ?? null;
    },

    // One page (200) of each kind: the most recent outflows
    async outflows(a) {
      const [coins, tokens] = await Promise.all([trx(a, "only_from=true"), trc20(a, "only_from=true")]);
      return [...coins, ...tokens].filter((t) => t.from === a && t.amount >= min(t));
    },

    async profile(a) {
      const hit = profiles.get(a);
      if (hit) return hit;
      const [acc, recent] = await Promise.all([get(`/v1/accounts/${a}`), get(`/v1/accounts/${a}/transactions/trc20?limit=${PAGE}`)]);
      const isContract = acc.data?.[0]?.type === "Contract";
      // A full page of token transfers inside one day means an exchange hot wallet or a busy service
      const rows: any[] = recent.data ?? [];
      const span = rows.length ? (rows[0].block_timestamp - rows[rows.length - 1].block_timestamp) / 1000 : Infinity;
      const p = { isContract, hub: rows.length === PAGE && span < 86400, txCount: rows.length < PAGE ? rows.length : null };
      profiles.set(a, p);
      return p;
    },
  };
}
