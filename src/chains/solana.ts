import type { Adapter, Profile, Transfer } from "../types.ts";
import { fetchJson, HttpError, limiter } from "../util.ts";
import { addCredits } from "../credits.ts";

// Helius rate limits come in two groups (free plan): plain RPC 10/s, DAS and parsed APIs 2/s
const throttle = limiter(Number(process.env.HELIUS_RPS) || 8);
const apiThrottle = limiter(Number(process.env.HELIUS_API_RPS) || 2);
const LAMPORTS = 1e9;
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Well-known mints: symbol and the smallest amount worth following. wSOL is just SOL.
const MINTS: Record<string, [string, number]> = {
  So11111111111111111111111111111111111111112: ["SOL", 0.05],
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: ["USDC", 5],
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: ["USDT", 5],
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: ["mSOL", 0.05],
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: ["JitoSOL", 0.05],
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: ["bSOL", 0.05],
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": ["stSOL", 0.05],
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": ["ETH (Wormhole)", 0.005],
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": ["WBTC (Wormhole)", 0.0002],
  "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E": ["BTC (Sollet)", 0.0002],
  "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk": ["ETH (Sollet)", 0.005],
};
const KNOWN_SYMBOLS = new Set(Object.values(MINTS).map(([s]) => s));
const SOL_MIN = 0.05;

// A program derived address (PDA) is a key off the ed25519 curve: no private key exists, only a program
// can sign for it. Vaults and pool authorities of launchpads and DEXes are PDAs, often with no data, so
// they look like plain wallets by owner alone.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P = 2n ** 255n - 19n;
const modpow = (b: bigint, e: bigint) => {
  let r = 1n;
  for (b %= P; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) r = (r * b) % P;
  return r;
};
const D = (((-121665n * modpow(121666n, P - 2n)) % P) + P) % P;
export function isOffCurve(addr: string): boolean {
  let n = 0n;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 255n));
  while (bytes.length < 32) bytes.unshift(0);
  if (bytes.length !== 32) return false;
  // Little-endian y with the sign bit of x on top
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  if (y >= P) return true;
  const y2 = (y * y) % P;
  const x2 = (((y2 - 1n + P) % P) * modpow((D * y2 + 1n) % P, P - 2n)) % P;
  return x2 !== 0n && modpow(x2, (P - 1n) / 2n) !== 1n;
}

export const isSolAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export const isSolSignature = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s);

// Helius bills in credits (helius.dev/docs/billing/credits): plain RPC 1, DAS 10, Parsed Events 10.
// The free plan has ~1M a month, so every call is counted.
const DAS = new Set(["getAsset", "getAssetBatch", "getAssetsByOwner", "getTokenAccounts", "searchAssets"]);
const spent = { rpc: 0, das: 0, parsed: 0 };
export const heliusCredits = () => ({ ...spent, total: spent.rpc + spent.das * 10 + spent.parsed * 10 });

// Launchpads and the instruction that creates a token on each (checked on live launches, 17.10.2026)
const LAUNCHPADS: Record<string, { name: string; ix: RegExp }> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { name: "pump.fun", ix: /^create(_v2)?$/ },
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: { name: "Meteora DBC", ix: /^initialize_virtual_pool/ },
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: { name: "Raydium LaunchLab", ix: /^initialize/ },
};
const PARSE_BATCH = 100;

// Parsed Events result → the shape the rest of the code reads (the old Enhanced Transactions one).
// A launch also gets launchpad, creator and launched (the new mint, when the IDL names it).
// Failed txs keep their signature but carry transactionError: Parsed Events still lists their transfers,
// including SOL "returned" by a close_account that never happened.
function normTx(r: any) {
  const p = r?.parserStatus === "OK" ? r.parsed : null;
  if (!p) return { signature: r?.signature, transactionError: r?.parserError?.code ?? "parser", nativeTransfers: [], tokenTransfers: [] };
  const create = (p.instructions ?? []).find((ix: any) => LAUNCHPADS[ix.programId]?.ix.test(ix.instructionName ?? ""));
  // The creator role, when the launchpad's IDL names it: a launch service may pay the fee for the creator
  const role = (...names: string[]) => create?.decoded?.accounts?.find((a: any) => names.includes(a.name))?.pubkey ?? null;
  return {
    signature: r.signature,
    timestamp: p.blockTime,
    slot: p.slot,
    feePayer: p.feePayer,
    type: create ? "CREATE" : String(p.summary?.type ?? "unknown").toUpperCase(),
    ...(create ? { launchpad: LAUNCHPADS[create.programId].name, creator: role("creator", "user") ?? p.feePayer, launched: role("base_mint", "mint") } : {}),
    transactionError: p.transactionStatus === "ERROR" ? (p.error ?? "error") : null,
    nativeTransfers: p.nativeTransfers ?? [],
    // Minting has no sender; it is not a movement between wallets
    tokenTransfers: (p.tokenTransfers ?? [])
      .filter((t: any) => t.fromUserAccount)
      .map((t: any) => ({ ...t, tokenAmount: Number(t.rawTokenAmount) / 10 ** Number(t.decimals ?? 0) })),
  };
}

// Plain Solana RPC also goes to other providers: SOLANA_RPC_URLS, comma-separated endpoints (Chainstack, QuickNode),
// each within its own free plan. They take turns; one that fails or rate-limits sits out a minute, and Helius answers
// when none can. DAS and the parsed APIs exist only on Helius. The regression set (HTTP_CACHE) stays on Helius so its
// recorded answers keep matching.
const POOL = (process.env.SOLANA_RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean)
  .map((url) => ({ url, throttle: limiter(Number(process.env.SOLANA_RPC_RPS) || 8), down: 0, name: new URL(url).hostname.split(".").slice(-2, -1)[0], no: new Set<string>() }));
// Free plans leave methods out (Chainstack: no signature history, no token-account queries): learned once, then skipped
const NOT_IN_PLAN = /plan|not available|only available|upgrade|not supported|method not found|archive/i;
let turn = 0;
export const poolSpent: Record<string, number> = {};
async function pooled(method: string, params: unknown[] | object): Promise<{ result: any } | null> {
  if (process.env.HTTP_CACHE) return null;
  for (let i = 0; i < POOL.length; i++) {
    const p = POOL[turn++ % POOL.length];
    if (Date.now() < p.down || p.no.has(method)) continue;
    try {
      const j = await p.throttle(() => fetchJson(p.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, 1));
      // A method the plan does not serve, or a bad request: the next provider, then Helius, gives the real answer
      if (j.error) {
        if (NOT_IN_PLAN.test(j.error.message ?? "")) p.no.add(method);
        continue;
      }
      poolSpent[p.name] = (poolSpent[p.name] ?? 0) + 1;
      return { result: j.result };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 401) && NOT_IN_PLAN.test(e.message)) p.no.add(method);
      else p.down = Date.now() + 60_000; // down or rate-limited: sit out a minute
    }
  }
  return null;
}

// Thin Helius client, shared by the trace adapter and the token check.
// Helius keys: HELIUS_API_KEY first, then HELIUS_FALLBACK_KEYS (comma separated). A key that keeps refusing
// (429 after the retries, a usage or credit error) sits out an hour; one that is rejected (401/403) a day.
// Each free key has its own monthly credits, so a spent key does not stop the site.
const benched = new Map<string, number>(); // key -> unix ms when it may be tried again
const heliusKeys = () => [process.env.HELIUS_API_KEY, ...(process.env.HELIUS_FALLBACK_KEYS ?? "").split(",")].map((k) => k?.trim()).filter((k): k is string => !!k);
export function heliusKey(): string {
  const keys = heliusKeys();
  if (!keys.length) throw new Error("HELIUS_API_KEY is not set");
  return keys.find((k) => (benched.get(k) ?? 0) < Date.now()) ?? keys[0];
}
const SPENT = /max usage|usage limit|credits|quota|rate limit/i;
async function withKey<T>(call: (key: string) => Promise<T>): Promise<T> {
  const tried = new Set<string>();
  for (;;) {
    const key = heliusKey();
    if (tried.has(key)) return call(key); // every key benched: let the original error through
    tried.add(key);
    try {
      return await call(key);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      const msg = (e as Error).message ?? "";
      if (!(status === 401 || status === 403 || status === 429 || SPENT.test(msg)) || heliusKeys().length < 2) throw e;
      benched.set(key, Date.now() + (status === 401 || status === 403 ? 86_400_000 : 3_600_000));
      console.error(`helius key …${key.slice(-4)} benched (${status || msg.slice(0, 60)}), switching`);
    }
  }
}

export function helius() {
  heliusKey(); // fail early without any key
  const base = "https://mainnet.helius-rpc.com";
  const post = (path: string, body: object) =>
    withKey((key) => apiThrottle(() => fetchJson(`${base}${path}?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })));

  const rpc = async (method: string, params: unknown[] | object) => {
    if (!DAS.has(method) && POOL.length) {
      const r = await pooled(method, params);
      if (r) return r.result;
    }
    if (DAS.has(method)) spent.das++, addCredits(10);
    else spent.rpc++, addCredits(1);
    return withKey(async (key) => {
      const j = await (DAS.has(method) ? apiThrottle : throttle)(() =>
        fetchJson(`${base}/?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
      );
      if (j.error) throw new Error(`helius ${method}: ${j.error.message}`);
      return j.result;
    });
  };

  // Results come back in the order of sigs
  const parse = async (sigs: string[]): Promise<any[]> => {
    const out: any[] = [];
    for (let i = 0; i < sigs.length; i += PARSE_BATCH) {
      spent.parsed++;
      addCredits(10);
      const page: any[] = await post("/v1/parsed-events/transactions", { transactions: sigs.slice(i, i + PARSE_BATCH) });
      out.push(...page.map(normTx));
    }
    return out;
  };

  // One page of an address's history, newest first by default. asc starts from the very first tx.
  // type has no server-side filter: it is applied to the page, so fewer than limit items may come back.
  const history = async (addr: string, opts: { before?: string; type?: string; limit?: number; order?: "asc" | "desc" } = {}): Promise<any[]> => {
    spent.parsed++;
    addCredits(10);
    const page = await post("/v1/parsed-events/transaction-history", {
      address: addr,
      limit: opts.limit ?? 100,
      sortOrder: opts.order ?? "desc",
      ...(opts.before ? { beforeSignature: opts.before } : {}),
    });
    const txs = (page.data ?? []).map(normTx);
    return opts.type ? txs.filter((t: any) => t.type === opts.type) : txs;
  };

  return { rpc, parse, history };
}

export function solanaAdapter(): Adapter {
  const { rpc, parse, history: hist } = helius();
  const history = (addr: string, before?: string) => hist(addr, { before });
  const profiles = new Map<string, Profile>();

  // Unknown mints get their symbol from Helius DAS, once per mint
  const symbols = new Map<string, string>();
  const resolveSymbols = async (mints: string[]) => {
    const todo = [...new Set(mints)].filter((m) => !(m in MINTS) && !symbols.has(m));
    for (let i = 0; i < todo.length; i += 500) {
      const ids = todo.slice(i, i + 500);
      const assets: any[] = await rpc("getAssetBatch", { ids }).catch(() => []);
      ids.forEach((id, k) => {
        const sym = String(assets?.[k]?.content?.metadata?.symbol ?? assets?.[k]?.token_info?.symbol ?? "").trim();
        // A token pretending to be USDC or SOL keeps its mint, so it never merges with the real one
        symbols.set(id, /^[A-Za-z0-9.$_-]{1,12}$/.test(sym) && !KNOWN_SYMBOLS.has(sym) ? sym : `${id.slice(0, 6)}…${id.slice(-4)}`);
      });
    }
  };
  const named = async (ts: Transfer[]): Promise<Transfer[]> => {
    await resolveSymbols(ts.filter((t) => t.asset !== "SOL").map((t) => t.asset));
    return ts
      .filter((t) => t.amount >= (t.asset === "SOL" ? SOL_MIN : MINTS[t.asset]?.[1] ?? 0))
      .map((t) => t.asset === "SOL" ? t : MINTS[t.asset]
        ? { ...t, asset: MINTS[t.asset][0] }
        : { ...t, asset: symbols.get(t.asset) ?? t.asset, unverified: true });
  };

  const transfers = (tx: any): Transfer[] => {
    if (tx.transactionError) return [];
    return [
      ...(tx.nativeTransfers ?? []).map((t: any) => ({
        from: t.fromUserAccount, to: t.toUserAccount, amount: t.amount / LAMPORTS, asset: "SOL", hash: tx.signature, ts: tx.timestamp,
      })),
      ...(tx.tokenTransfers ?? []).map((t: any) => ({
        from: t.fromUserAccount, to: t.toUserAccount, amount: Number(t.tokenAmount), asset: t.mint, hash: tx.signature, ts: tx.timestamp,
      })),
    ].filter((t) => t.from && t.to && t.from !== t.to && t.amount > 0);
  };

  return {
    chain: "solana",
    native: "SOL",
    norm: (a) => a,
    addrUrl: (a) => `https://solscan.io/account/${a}`,
    txUrl: (h) => `https://solscan.io/tx/${h}`,

    async resolveTx(sig) {
      const [tx] = await parse([sig]);
      return tx ? { from: tx.feePayer, to: null, ts: tx.timestamp } : null;
    },

    // The address's history read from its very first tx, in on-chain order
    async firstFunding(addr) {
      const txs = await hist(addr, { order: "asc", limit: 50 });
      const incoming = txs.flatMap((tx) => transfers(tx).filter((t) => t.to === addr));
      const sol = incoming.find((t) => t.asset === "SOL");
      if (sol) return sol;
      // Spam airdrops land in every wallet, so only a known token counts as funding
      const tok = incoming.find((t) => t.asset in MINTS);
      return tok ? (await named([tok]))[0] ?? tok : null;
    },

    async outflows(addr, max) {
      const out: Transfer[] = [];
      let before: string | undefined;
      let seen = 0;
      while (seen < max) {
        const txs = await history(addr, before);
        if (!txs.length) break;
        seen += txs.length;
        for (const tx of txs) out.push(...transfers(tx).filter((t) => t.from === addr));
        before = txs[txs.length - 1].signature;
        if (txs.length < 100) break;
      }
      return named(out);
    },

    async txOutputs(sig) {
      const [tx] = await parse([sig]);
      return tx ? named(transfers(tx)) : [];
    },

    async profile(addr) {
      const hit = profiles.get(addr);
      if (hit) return hit;
      const [info, sigs] = await Promise.all([
        rpc("getAccountInfo", [addr, { encoding: "base64" }]),
        rpc("getSignaturesForAddress", [addr, { limit: 1000 }]),
      ]);
      const v = info?.value;
      // A PDA is a program's account even when it holds no data and the system program owns it
      const isContract = isOffCurve(addr) || (!!v && (v.executable || v.owner !== SYSTEM_PROGRAM));
      // 1000 signatures inside two days means exchange hot wallet or busy program
      const span = sigs.length ? sigs[0].blockTime - sigs[sigs.length - 1].blockTime : Infinity;
      const p = { isContract, hub: sigs.length === 1000 && span < 2 * 86400, txCount: sigs.length < 1000 ? sigs.length : null };
      profiles.set(addr, p);
      return p;
    },
  };
}
