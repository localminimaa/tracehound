import type { Adapter, Position, Profile, ResolvedTx, Transfer } from "../types.ts";
import { fetchJson, limiter, sleep } from "../util.ts";

export const EVM_CHAINS: Record<string, { id: number; native: string; explorer: string }> = {
  ethereum: { id: 1, native: "ETH", explorer: "https://etherscan.io" },
  base: { id: 8453, native: "ETH", explorer: "https://basescan.org" },
  arbitrum: { id: 42161, native: "ETH", explorer: "https://arbiscan.io" },
  optimism: { id: 10, native: "ETH", explorer: "https://optimistic.etherscan.io" },
  bsc: { id: 56, native: "BNB", explorer: "https://bscscan.com" },
  polygon: { id: 137, native: "POL", explorer: "https://polygonscan.com" },
};

// Tokens we trust by contract, with the smallest amount worth following.
// Everything else is either spam (address poisoning, fake "ETH" lookalikes) or of unknown value.
const ETH = 0.005, USD = 5, BTC = 0.0002;
const TOKENS: Record<string, Record<string, number>> = {
  ethereum: {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": ETH, // WETH
    "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": ETH, // stETH
    "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": ETH, // wstETH
    "0xbe9895146f7af43049ca1c1ae358b0541ea49704": ETH, // cbETH
    "0xae78736cd615f374d3085123a210448e74fc6393": ETH, // rETH
    "0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa": ETH, // mETH
    "0xe6829d9a7ee3040e1276fa75293bde931859e8fa": ETH, // cmETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": USD, // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": USD, // USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f": USD, // DAI
    "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": USD, // USDe
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": BTC, // WBTC
  },
  arbitrum: {
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": ETH, // WETH
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": USD, // USDC
    "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": USD, // USDC.e
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": USD, // USDT
    "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": BTC, // WBTC
  },
  polygon: {
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": ETH, // WETH
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": USD, // USDC
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": USD, // USDC.e
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": USD, // USDT
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": 10, // WPOL
  },
  base: {
    "0x4200000000000000000000000000000000000006": ETH, // WETH
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": USD, // USDC
  },
  optimism: {
    "0x4200000000000000000000000000000000000006": ETH, // WETH
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": USD, // USDC
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": USD, // USDT
  },
  bsc: {
    "0xbb4cdb9cbd36b01bd1cbaee83d2ec5ad4f4ac9b6": 0.02, // WBNB
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8": ETH, // ETH
    "0x55d398326f99059ff775485246999027b3197955": USD, // USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": USD, // USDC
    "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": BTC, // BTCB
  },
};
const NATIVE_MIN: Record<string, number> = { ETH, BNB: 0.02, POL: 10 };
// Lookalike symbols (Cyrillic "ЕТН", "ETH...", links) are the signature of spam tokens
const cleanSymbol = (s: string) => /^[A-Za-z0-9.\-_+$]{1,16}$/.test(s) && !s.includes("..");

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1): fees and withdrawn liquidity
// leaving a Uniswap V3 style position (forks keep the event)
const COLLECT = "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01";
const ZERO = "0x0000000000000000000000000000000000000000";
const LP_MAX = 3; // positions per wallet, and pulls per position, that are opened up
const metas = new Map<string, { symbol: string; decimals: number } | null>();

// ABI string, or the older bytes32 style (MKR and friends)
function decodeString(hex: unknown): string | null {
  if (typeof hex !== "string" || hex.length < 66) return null;
  const b = Buffer.from(hex.slice(2), "hex");
  if (b.length >= 64 && b.readUInt32BE(28) === 32) return b.subarray(64, 64 + b.readUInt32BE(60)).toString("utf8");
  return b.subarray(0, 32).toString("utf8").replace(/\0+$/, "") || null;
}

// One Etherscan v2 key is shared by all chains, so the rate limit is shared too.
const throttle = limiter(Number(process.env.ETHERSCAN_RPS) || 4);
const HUB_NONCE = 5000;

export function evmAdapter(chain: string): Adapter {
  const cfg = EVM_CHAINS[chain];
  if (!cfg) throw new Error(`unknown EVM chain ${chain}`);
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) throw new Error("ETHERSCAN_API_KEY is not set");
  const profiles = new Map<string, Profile>();

  async function call(params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams({ chainid: String(cfg.id), apikey: key!, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    for (let i = 0; i < 4; i++) {
      const j = await throttle(() => fetchJson(`https://api.etherscan.io/v2/api?${qs}`));
      // Etherscan reports rate limits inside a 200 response
      if (typeof j.result === "string" && /rate limit/i.test(j.result)) {
        await sleep(1200 * (i + 1));
        continue;
      }
      if (j.status === "0" && typeof j.result === "string" && !/no transactions|no records/i.test(j.message ?? "")) {
        throw new Error(`etherscan ${chain}: ${j.message} — ${j.result}`);
      }
      return j.result;
    }
    throw new Error(`etherscan ${chain}: rate limited`);
  }

  // Kept per adapter: the liquidity scan reads the same token history the outflows already fetched
  const lists = new Map<string, { offset: number; rows: Promise<any[]> }>();
  const list = (action: string, addr: string, sort: "asc" | "desc", offset: number, extra: Record<string, string> = {}) => {
    const k = `${action}|${addr}|${sort}|${JSON.stringify(extra)}`;
    const hit = lists.get(k);
    if (hit && hit.offset >= offset) return hit.rows.then((r) => r.slice(0, offset));
    const rows = call({ module: "account", action, address: addr, startblock: 0, endblock: 99999999, page: 1, offset, sort, ...extra }).then((r) => (Array.isArray(r) ? r : []));
    rows.catch(() => lists.delete(k));
    lists.set(k, { offset, rows });
    return rows;
  };

  const receipts = new Map<string, Promise<any>>();
  const receipt = (hash: string) => {
    if (!receipts.has(hash)) {
      const r = call({ module: "proxy", action: "eth_getTransactionReceipt", txhash: hash });
      r.catch(() => receipts.delete(hash));
      receipts.set(hash, r);
    }
    return receipts.get(hash)!;
  };

  const native = (t: any): Transfer => ({
    from: t.from.toLowerCase(), to: (t.to || t.contractAddress || "").toLowerCase(),
    amount: Number(BigInt(t.value)) / 1e18, asset: cfg.native, hash: t.hash, ts: Number(t.timeStamp),
  });
  const known = TOKENS[chain] ?? {};
  const token = (t: any): Transfer => ({
    from: t.from.toLowerCase(), to: t.to.toLowerCase(),
    amount: Number(BigInt(t.value)) / 10 ** Number(t.tokenDecimal || 18),
    asset: t.tokenSymbol || t.contractAddress, hash: t.hash, ts: Number(t.timeStamp),
    ...(t.contractAddress.toLowerCase() in known ? {} : { unverified: true }),
  });
  // Symbol and decimals of a token seen only in logs, read once per contract
  async function tokenMeta(contract: string): Promise<{ symbol: string; decimals: number } | null> {
    const key = `${chain}:${contract}`;
    if (metas.has(key)) return metas.get(key)!;
    const [sym, dec] = await Promise.all([
      call({ module: "proxy", action: "eth_call", to: contract, data: "0x95d89b41", tag: "latest" }).catch(() => null),
      call({ module: "proxy", action: "eth_call", to: contract, data: "0x313ce567", tag: "latest" }).catch(() => null),
    ]);
    const symbol = decodeString(sym);
    const decimals = typeof dec === "string" && dec.length > 2 ? Number(BigInt(dec.slice(0, 66))) : NaN;
    const meta = symbol && cleanSymbol(symbol) && decimals >= 0 && decimals <= 36 ? { symbol, decimals } : null;
    metas.set(key, meta);
    return meta;
  }

  const notDust = (t: Transfer, contract?: string) =>
    t.amount >= (contract ? known[contract.toLowerCase()] ?? 0 : NATIVE_MIN[cfg.native] ?? 0);

  return {
    chain,
    native: cfg.native,
    norm: (a) => a.toLowerCase(),
    addrUrl: (a) => `${cfg.explorer}/address/${a}`,
    txUrl: (h) => `${cfg.explorer}/tx/${h}`,

    async resolveTx(hash): Promise<ResolvedTx | null> {
      const tx = await call({ module: "proxy", action: "eth_getTransactionByHash", txhash: hash });
      if (!tx || typeof tx !== "object") return null;
      const block = await call({ module: "proxy", action: "eth_getBlockByNumber", tag: tx.blockNumber, boolean: "false" });
      return { from: tx.from.toLowerCase(), to: tx.to?.toLowerCase() ?? null, ts: parseInt(block?.timestamp ?? "0", 16) };
    },

    // Earliest incoming value — the wallet that paid this address's first gas.
    async firstFunding(addr) {
      const a = addr.toLowerCase();
      const [txs, internal] = await Promise.all([list("txlist", a, "asc", 25), list("txlistinternal", a, "asc", 25)]);
      const incoming = [
        ...txs.filter((t) => t.to?.toLowerCase() === a && t.value !== "0" && t.isError === "0").map(native),
        ...internal.filter((t) => t.to?.toLowerCase() === a && t.value !== "0" && t.isError === "0").map(native),
      ].sort((x, y) => x.ts - y.ts);
      if (incoming[0]) return incoming[0];
      // Spam tokens are airdropped to everyone, so only a known token counts as funding
      const tokens = await list("tokentx", a, "asc", 25);
      return tokens.filter((t) => t.to.toLowerCase() === a && t.contractAddress.toLowerCase() in known).map(token)[0] ?? null;
    },

    async outflows(addr, max) {
      const a = addr.toLowerCase();
      const [txs, tokens] = await Promise.all([list("txlist", a, "desc", max), list("tokentx", a, "desc", max)]);
      // Fake tokens can emit a Transfer "from" any address without its signature.
      // A token outflow counts if the token is known, or the wallet itself sent that tx.
      const signed = new Set(txs.filter((t) => t.from.toLowerCase() === a).map((t) => t.hash));
      return [
        ...txs.filter((t) => t.from.toLowerCase() === a && t.value !== "0" && t.isError === "0").map(native).filter((t) => notDust(t)),
        ...tokens
          .filter((t) => t.from.toLowerCase() === a)
          .filter((t) => t.contractAddress.toLowerCase() in known || (signed.has(t.hash) && cleanSymbol(t.tokenSymbol ?? "")))
          .map((t) => [t, token(t)] as const)
          .filter(([raw, tr]) => notDust(tr, raw.contractAddress))
          .map(([, tr]) => tr),
      ];
    },

    // Every value movement inside one tx: token Transfer logs plus internal native transfers.
    // This is how a swap is followed: the router keeps nothing, the output goes somewhere.
    async txOutputs(hash, ts) {
      const [rcpt, internal] = await Promise.all([
        receipt(hash),
        call({ module: "account", action: "txlistinternal", txhash: hash }),
      ]);
      const out: Transfer[] = (Array.isArray(internal) ? internal : [])
        .filter((t) => t.value !== "0" && t.isError === "0")
        .map((t) => ({ ...native({ ...t, hash }), ts }))
        .filter((t) => notDust(t));
      for (const log of rcpt?.logs ?? []) {
        if (log.topics?.[0] !== TRANSFER || log.topics.length !== 3 || log.data === "0x") continue;
        const contract = log.address.toLowerCase();
        const meta = await tokenMeta(contract);
        if (!meta) continue;
        const tr: Transfer = {
          from: `0x${log.topics[1].slice(26)}`, to: `0x${log.topics[2].slice(26)}`,
          amount: Number(BigInt(log.data.slice(0, 66))) / 10 ** meta.decimals, asset: meta.symbol, hash, ts,
          ...(contract in known ? {} : { unverified: true }),
        };
        if (tr.amount > 0 && notDust(tr, contract)) out.push(tr);
      }
      return out;
    },

    async logs(hash) {
      return (await receipt(hash))?.logs ?? [];
    },

    // Liquidity this wallet put into a pool: V2 LP tokens minted to it (the minting contract answers token0()), and V3
    // position NFTs minted to it. For each: who the LP or the NFT was handed to, and every tx that took liquidity out.
    async positions(addr) {
      const a = addr.toLowerCase();
      const out: Position[] = [];
      const pairName = async (pair: string) => {
        const [t0, t1] = await Promise.all(["0x0dfe1681", "0xd21220a7"].map((data) => call({ module: "proxy", action: "eth_call", to: pair, data, tag: "latest" }).catch(() => null)));
        if (typeof t0 !== "string" || typeof t1 !== "string" || t0.length !== 66 || t1.length !== 66) return null;
        const [m0, m1] = await Promise.all([tokenMeta(`0x${t0.slice(26)}`), tokenMeta(`0x${t1.slice(26)}`)]);
        return `${m0?.symbol ?? "?"}/${m1?.symbol ?? "?"}`;
      };
      const pull = async (hash: string, ts: number, owner: string) => ({ hash, ts, owner, legs: await this.txOutputs!(hash, ts) });

      const toks = await list("tokentx", a, "desc", 300);
      const minted = [...new Map(toks.filter((t) => t.from === ZERO && t.to === a).map((t) => [t.contractAddress.toLowerCase(), t])).values()];
      let v2 = 0;
      // Other tokens are minted to wallets too (staked ETH, lending receipts): only a contract with token0/token1 is a pair
      for (const m of minted.slice(0, LP_MAX * 2)) {
        if (v2 >= LP_MAX) break;
        const pair = m.contractAddress.toLowerCase();
        const name = await pairName(pair);
        if (!name) continue;
        v2++;
        const p: Position = { v: 2, pool: pair, name, adder: a, addTx: m.hash, ts: Number(m.timeStamp), moves: [], pulls: [] };
        // The adder's own LP history, then that of each wallet it handed LP to (one step)
        const owners = [a];
        for (let i = 0; i < owners.length && i < 3; i++) {
          const w = owners[i];
          const lp = w === a ? toks.filter((t) => t.contractAddress.toLowerCase() === pair) : await list("tokentx", w, "desc", 100, { contractaddress: pair });
          for (const t of lp.filter((t) => t.from === w).reverse()) {
            if (t.to === pair) {
              if (p.pulls.length < LP_MAX) p.pulls.push(await pull(t.hash, Number(t.timeStamp), w));
            } else if (t.to !== ZERO && !/^0x0{20,}dead$/.test(t.to)) {
              p.moves.push({ ...token(t), asset: `${name} LP`, unverified: true });
              if (w === a && !owners.includes(t.to)) owners.push(t.to);
            }
          }
        }
        out.push(p);
      }

      const nfts = await list("tokennfttx", a, "desc", 100);
      for (const m of nfts.filter((t) => t.from === ZERO && t.to === a && /POS/i.test(t.tokenSymbol ?? "")).slice(0, LP_MAX)) {
        const npm = m.contractAddress.toLowerCase(), id = String(m.tokenID);
        const hexId = BigInt(id).toString(16).padStart(64, "0");
        // positions(id): nonce, operator, token0, token1, ... (reverts once the position is burned)
        const pos = await call({ module: "proxy", action: "eth_call", to: npm, data: `0x99fbab88${hexId}`, tag: "latest" }).catch(() => null);
        let name = `position #${id}`;
        // word 7 is the liquidity still in the position
        const empty = typeof pos !== "string" || pos.length < 2 + 64 * 8 || BigInt(`0x${pos.slice(2 + 64 * 7, 2 + 64 * 8)}`) === 0n;
        if (typeof pos === "string" && pos.length >= 2 + 64 * 4) {
          const [m0, m1] = await Promise.all([tokenMeta(`0x${pos.slice(2 + 64 * 2 + 24, 2 + 64 * 3)}`), tokenMeta(`0x${pos.slice(2 + 64 * 3 + 24, 2 + 64 * 4)}`)]);
          if (m0 && m1) name = `${m0.symbol}/${m1.symbol}`;
        }
        const moves = nfts.filter((t) => t.contractAddress.toLowerCase() === npm && String(t.tokenID) === id && t.from === a && t.to !== ZERO).reverse();
        const p: Position = {
          v: 3, pool: npm, name, id, adder: a, addTx: m.hash, ts: Number(m.timeStamp), empty,
          moves: moves.map((t) => ({ from: a, to: t.to.toLowerCase(), amount: 1, asset: `${name} position #${id}`, hash: t.hash, ts: Number(t.timeStamp), unverified: true })), pulls: [],
        };
        const logs = await call({ module: "logs", action: "getLogs", address: npm, fromBlock: 0, toBlock: "latest", topic0: COLLECT, topic0_1_opr: "and", topic1: `0x${hexId}` }).catch(() => []);
        for (const l of (Array.isArray(logs) ? logs : []).slice(-LP_MAX)) {
          const ts = parseInt(l.timeStamp, 16);
          // whoever held the NFT at the time pulled it
          const owner = p.moves.filter((t) => t.ts <= ts).at(-1)?.to ?? a;
          p.pulls.push(await pull(l.transactionHash, ts, owner));
        }
        out.push(p);
      }
      return out;
    },

    async profile(addr) {
      const a = addr.toLowerCase();
      const hit = profiles.get(a);
      if (hit) return hit;
      const [code, nonce] = await Promise.all([
        call({ module: "proxy", action: "eth_getCode", address: a, tag: "latest" }),
        call({ module: "proxy", action: "eth_getTransactionCount", address: a, tag: "latest" }),
      ]);
      const txCount = typeof nonce === "string" ? parseInt(nonce, 16) : null;
      const p = { isContract: typeof code === "string" && code !== "0x", hub: (txCount ?? 0) > HUB_NONCE, txCount };
      profiles.set(a, p);
      return p;
    },
  };
}

// Whether the Etherscan plan serves this chain's account history (the free plan has no Base, BSC or Optimism).
// One cheap call per chain, remembered for six hours.
const covers = new Map<string, { ok: boolean; at: number }>();
export async function evmCovers(chain: string): Promise<boolean> {
  const hit = covers.get(chain);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.ok;
  let ok = false;
  try {
    const a = evmAdapter(chain);
    await a.outflows("0x000000000000000000000000000000000000dead", 1);
    ok = true;
  } catch {}
  covers.set(chain, { ok, at: Date.now() });
  return ok;
}

// Which chains has this address actually been used on? Cheap nonce + balance probe.
export async function activeEvmChains(addr: string): Promise<string[]> {
  evmAdapter("ethereum"); // fail loudly on a missing key instead of "no activity"
  const scores = await Promise.all(
    Object.keys(EVM_CHAINS).map(async (chain) => {
      try {
        const a = evmAdapter(chain);
        const p = await a.profile(addr);
        const out = (p.txCount ?? 0) > 0 ? p.txCount! : (await a.firstFunding(addr)) ? 0.5 : 0;
        return { chain, score: out };
      } catch {
        return { chain, score: 0 }; // chain not on this API plan, or no data
      }
    }),
  );
  return scores.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).map((s) => s.chain);
}

export async function findEvmTx(hash: string): Promise<{ chain: string; tx: ResolvedTx } | null> {
  evmAdapter("ethereum");
  for (const chain of Object.keys(EVM_CHAINS)) {
    try {
      const tx = await evmAdapter(chain).resolveTx(hash);
      if (tx) return { chain, tx };
    } catch {}
  }
  return null;
}
