import type { Adapter } from "../types.ts";
import { fetchJson, limiter } from "../util.ts";
import { EVM_CHAINS } from "./evm.ts";

// Midgard indexes every THORChain swap by its inbound tx, so one call turns
// "the money went into THORChain" into "it came out as BTC at this address".
const MIDGARD = process.env.MIDGARD_URL || "https://gateway.liquify.com/chain/thorchain_midgard/v2";
const throttle = limiter(Number(process.env.MIDGARD_RPS) || 2);
const UNIT = 1e8; // Midgard amounts are always 8 decimals

// THORChain chain prefix → our chain id. Chains we can trace get the real adapter, the rest an explorer-only one.
const CHAINS: Record<string, string> = {
  ETH: "ethereum", BSC: "bsc", BASE: "base", SOL: "solana", TRON: "tron", BTC: "bitcoin", LTC: "litecoin",
  BCH: "bitcoin-cash", DOGE: "dogecoin", AVAX: "avalanche", XRP: "xrp", ZEC: "zcash", GAIA: "cosmos", THOR: "thorchain",
};

const EXPLORERS: Record<string, [string, string]> = { // [address, tx] url prefixes
  bitcoin: ["https://mempool.space/address/", "https://mempool.space/tx/"],
  litecoin: ["https://blockchair.com/litecoin/address/", "https://blockchair.com/litecoin/transaction/"],
  "bitcoin-cash": ["https://blockchair.com/bitcoin-cash/address/", "https://blockchair.com/bitcoin-cash/transaction/"],
  dogecoin: ["https://blockchair.com/dogecoin/address/", "https://blockchair.com/dogecoin/transaction/"],
  zcash: ["https://blockchair.com/zcash/address/", "https://blockchair.com/zcash/transaction/"],
  solana: ["https://solscan.io/account/", "https://solscan.io/tx/"],
  tron: ["https://tronscan.org/#/address/", "https://tronscan.org/#/transaction/"],
  avalanche: ["https://snowtrace.io/address/", "https://snowtrace.io/tx/"],
  xrp: ["https://xrpscan.com/account/", "https://xrpscan.com/tx/"],
  cosmos: ["https://www.mintscan.io/cosmos/address/", "https://www.mintscan.io/cosmos/tx/"],
  thorchain: ["https://runescan.io/address/", "https://runescan.io/tx/"],
};

// A chain we cannot trace yet still gets nodes with working explorer links.
export function explorerAdapter(chain: string): Adapter {
  const evm = EVM_CHAINS[chain]?.explorer;
  const [a, t] = evm ? [`${evm}/address/`, `${evm}/tx/`] : EXPLORERS[chain] ?? ["", ""];
  const none = () => Promise.reject(new Error(`${chain} is not traced yet`));
  return {
    chain, native: chain.toUpperCase(), norm: (x) => x, addrUrl: (x) => a + x, txUrl: (x) => t + x,
    resolveTx: none, firstFunding: none, outflows: none, profile: none,
  };
}

// Current vault and router addresses per chain. Vaults rotate, so a deposit memo is the other signal.
let known: { at: number; addrs: Promise<Set<string>> } | null = null;
const THORNODE = process.env.THORNODE_URL || "https://gateway.liquify.com/chain/thorchain_api/thorchain";
function thorchainAddresses(): Promise<Set<string>> {
  if (!known || Date.now() - known.at > 3600_000) {
    // Several vaults are active at once, each with its own address per chain
    const addrs = fetchJson(`${THORNODE}/vaults/asgard`, undefined, 2)
      .then((vaults: any[]) => new Set(vaults.flatMap((v) => [
        ...(v.addresses ?? []).map((x: any) => [x.chain, x.address]),
        ...(v.routers ?? []).map((x: any) => [x.chain, x.router]),
      ]).filter(([, x]) => x).map(([c, x]) => `${CHAINS[c] ?? c.toLowerCase()}:${x.startsWith("0x") ? x.toLowerCase() : x}`)))
      .catch(() => new Set<string>());
    known = { at: Date.now(), addrs };
  }
  return known.addrs;
}

// THORChain swap and liquidity orders: "=:BTC.BTC:bc1…", "SWAP:…", "+:…"
const MEMO = /^(=|s|swap|\+|a|add|trade\+|secure\+)[:~]/i;

// Is this recipient a THORChain vault or router? Either it is a current one, or the deposit carried a THORChain memo.
export async function isThorchainInbound(chain: string, to: string, sent: { memo?: string }[]): Promise<boolean> {
  if (sent.some((t) => t.memo && MEMO.test(t.memo))) return true;
  return (await thorchainAddresses()).has(`${chain}:${to}`);
}

export interface Crossing {
  status: string; // success, pending, refund
  index?: string; // what links the two sides, for the finding's text
  in: { chain: string; address: string; asset: string; amount: number; hash: string };
  out: { chain: string; address: string; asset: string; amount: number; hash: string }[];
}

// "BTC.BTC" lives on Bitcoin; trade assets ("BTC~BTC") and synths ("BTC/BTC") stay inside THORChain
const asset = (s: string) => {
  const [chain, rest] = s.split(/[.~/]/, 2);
  const home = /[~/]/.test(s) ? "thorchain" : CHAINS[chain] ?? chain.toLowerCase();
  return { chain: home, symbol: (rest ?? chain).split("-")[0] };
};

// The swap started by this inbound tx, or null if it was not a THORChain deposit.
export async function thorchainCrossing(hash: string): Promise<Crossing | null> {
  const id = hash.replace(/^0x/, "");
  const j = await throttle(() => fetchJson(`${MIDGARD}/actions?txid=${/^[0-9a-fA-F]{64}$/.test(id) ? id.toUpperCase() : id}&limit=5`)).catch(() => null);
  const act = (j?.actions ?? []).find((x: any) => x.type === "swap" || x.type === "refund");
  const inb = act?.in?.[0];
  if (!inb?.coins?.[0]) return null;
  const src = asset(inb.coins[0].asset);
  // Affiliate fees are paid out in RUNE to thor1… addresses; they are not where the money went
  const outs = (act.out ?? []).filter((o: any) => o.coins?.[0] && !(o.address?.startsWith("thor1") && act.out.length > 1));
  return {
    status: act.type === "refund" ? "refund" : act.status,
    in: { chain: src.chain, address: inb.address, asset: src.symbol, amount: Number(inb.coins[0].amount) / UNIT, hash: inb.txID },
    out: outs.map((o: any) => {
      const dst = asset(o.coins[0].asset);
      return { chain: dst.chain, address: o.address, asset: dst.symbol, amount: Number(o.coins[0].amount) / UNIT, hash: o.txID ?? "" };
    }),
  };
}
