// Bridges besides THORChain. Each one runs a free, keyless explorer API that links a deposit tx on one chain
// to the payout on another, so a trace can continue on the far side instead of stopping at the contract.
import type { Crossing } from "./thorchain.ts";
import { hexToTron } from "./tron.ts";
import { fetchJson, limiter } from "../util.ts";

const throttle = limiter(4);
const get = (url: string) => throttle(() => fetchJson(url, undefined, 2)).catch(() => null);

export interface BridgeCrossing extends Crossing {
  bridge: string;
}

// Wormhole chain ids, also used by Mayan
const WORMHOLE: Record<string, string> = { 1: "solana", 2: "ethereum", 4: "bsc", 5: "polygon", 6: "avalanche", 23: "arbitrum", 24: "optimism", 30: "base" };
// deBridge (DLN) chain ids: EVM ids plus their own for Solana and Tron
const DLN: Record<string, string> = { 1: "ethereum", 56: "bsc", 137: "polygon", 42161: "arbitrum", 10: "optimism", 8453: "base", 43114: "avalanche", 7565164: "solana", 100000026: "tron" };
const EVM_IDS: Record<string, string> = { 1: "ethereum", 56: "bsc", 137: "polygon", 42161: "arbitrum", 10: "optimism", 8453: "base", 43114: "avalanche", 34268394551451: "solana" };

const evmHash = (h: string) => (/^[0-9a-fA-F]{64}$/.test(h) ? `0x${h}` : h);

type Log = { address: string; topics: string[]; data: string };
type Logs = () => Promise<Log[]>;
// Public nodes serve receipts of recent txs only; the trace hands in the adapter's reader (Etherscan) for older ones
const PUBLIC_RPC: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com", base: "https://base-rpc.publicnode.com", arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com", bsc: "https://bsc-rpc.publicnode.com", polygon: "https://polygon-bor-rpc.publicnode.com",
};
async function publicLogs(chain: string, hash: string): Promise<Log[]> {
  if (!PUBLIC_RPC[chain] || !/^0x[0-9a-f]{64}$/i.test(evmHash(hash))) return [];
  const j = await throttle(() => fetchJson(PUBLIC_RPC[chain], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [evmHash(hash)] }) }, 2)).catch(() => null);
  return j?.result?.logs ?? [];
}

// A 32-byte address as the destination chain writes it
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(b: Buffer) {
  let n = BigInt(`0x${b.toString("hex") || "0"}`), out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const x of b) if (x === 0) out = `1${out}`; else break;
  return out;
}
const addressOn = (chain: string, b: Buffer) =>
  chain === "solana" ? b58(b) : chain === "tron" ? hexToTron(`41${b.subarray(-20).toString("hex")}`) : `0x${b.subarray(-20).toString("hex")}`;
const word = (hex: string, i: number) => BigInt(`0x${hex.replace(/^0x/, "").slice(i * 64, i * 64 + 64) || "0"}`);

async function wormhole(hash: string): Promise<BridgeCrossing | null> {
  const op = (await get(`https://api.wormholescan.io/api/v1/operations?txHash=${evmHash(hash)}`))?.operations?.[0];
  const p = op?.content?.standarizedProperties;
  const to = WORMHOLE[p?.toChain];
  if (!op || !to || !p.toAddress) return null;
  const amount = Number(op.data?.tokenAmount ?? 0);
  const symbol = String(op.data?.symbol ?? "token");
  const from = WORMHOLE[p.fromChain ?? op.sourceChain?.chainId] ?? "unknown";
  return {
    bridge: "Wormhole", status: op.targetChain?.status ?? "pending",
    in: { chain: from, address: op.sourceChain?.from ?? "", asset: symbol, amount, hash },
    out: [{ chain: to, address: p.toAddress, asset: symbol, amount, hash: op.targetChain?.transaction?.txHash ?? "" }],
  };
}

async function mayan(hash: string): Promise<BridgeCrossing | null> {
  const s = await get(`https://explorer-api.mayan.finance/v3/swap/trx/${hash}`);
  const to = WORMHOLE[s?.destChain];
  if (!s?.destAddress || !to) return null;
  return {
    bridge: "Mayan", status: s.clientStatus === "COMPLETED" ? "success" : String(s.clientStatus ?? s.status ?? "pending").toLowerCase(),
    in: { chain: WORMHOLE[s.sourceChain] ?? "unknown", address: s.trader ?? "", asset: s.fromTokenSymbol ?? "token", amount: Number(s.fromAmount ?? 0), hash },
    out: [{ chain: to, address: s.destAddress, asset: s.toTokenSymbol ?? "token", amount: Number(s.toAmount ?? s.minAmountOut ?? 0), hash: s.fulfillTxHash ?? s.redeemTxHash ?? "" }],
  };
}

async function debridge(hash: string): Promise<BridgeCrossing | null> {
  const ids = (await get(`https://stats-api.dln.trade/api/Transaction/${evmHash(hash)}/orderIds`))?.orderIds ?? [];
  const out: BridgeCrossing["out"] = [];
  let first: any = null;
  for (const id of ids.slice(0, 3)) {
    const o = await get(`https://stats-api.dln.trade/api/Orders/${id.stringValue}`);
    const t = o?.takeOfferWithMetadata;
    const to = DLN[t?.chainId?.stringValue];
    if (!o || !to) continue;
    first ??= o;
    const dec = Number(t.metadata?.decimals ?? 18);
    const raw = t.finalAmount?.stringValue ?? t.amount?.stringValue ?? "0";
    out.push({ chain: to, address: o.receiverDst?.stringValue ?? "", asset: t.metadata?.symbol ?? "token", amount: Number(BigInt(raw)) / 10 ** dec, hash: o.fulfilledDstEventMetadata?.transactionHash?.stringValue ?? "" });
  }
  if (!first) return null;
  const g = first.giveOfferWithMetadata;
  return {
    bridge: "deBridge", status: /fulfill|unlock/i.test(first.state ?? "") ? "success" : String(first.state ?? "pending").toLowerCase(),
    in: { chain: DLN[g?.chainId?.stringValue] ?? "unknown", address: first.makerSrc?.stringValue ?? "", asset: g?.metadata?.symbol ?? "token", amount: Number(BigInt(g?.amount?.stringValue ?? "0")) / 10 ** Number(g?.metadata?.decimals ?? 18), hash },
    out,
  };
}

// Across needs the origin chain id; its token list gives symbols and decimals
let acrossTokens: Promise<Map<string, { symbol: string; decimals: number }>> | null = null;
const tokensOf = () =>
  (acrossTokens ??= get("https://app.across.to/api/token-list").then((list: any[] | null) => new Map((list ?? []).map((t) => [`${t.chainId}:${String(t.address).toLowerCase()}`, { symbol: t.symbol, decimals: t.decimals }]))));
async function across(chain: string, hash: string): Promise<BridgeCrossing | null> {
  const origin = Object.entries(EVM_IDS).find(([, c]) => c === chain)?.[0];
  if (!origin) return null;
  const d = (await get(`https://app.across.to/api/deposit?originChainId=${origin}&depositTxnRef=${evmHash(hash)}`))?.deposit;
  const to = EVM_IDS[d?.destinationChainId];
  if (!d?.recipient || !to) return null;
  const tokens = await tokensOf();
  const tin = tokens.get(`${d.originChainId}:${String(d.inputToken).toLowerCase()}`), tout = tokens.get(`${d.destinationChainId}:${String(d.outputToken).toLowerCase()}`) ?? tin;
  const amt = (raw: string, t?: { decimals: number }) => (t ? Number(BigInt(raw ?? "0")) / 10 ** t.decimals : 0);
  return {
    bridge: "Across", status: d.status === "filled" ? "success" : String(d.status ?? "pending"),
    in: { chain, address: d.depositor ?? "", asset: tin?.symbol ?? "token", amount: amt(d.inputAmount, tin), hash },
    out: [{ chain: to, address: d.recipient, asset: tout?.symbol ?? "token", amount: amt(d.outputAmount, tout), hash: d.fillTx ?? d.fillTxnRef ?? "" }],
  };
}

// Circle CCTP: USDC is burned here and minted on the far side. The burn event names the recipient and the chain, so the
// trace needs no index (Circle's own attestation API refuses some regions). On Solana the recipient is a USDC account,
// so its owner is read.
const CCTP_DOMAIN: Record<number, string> = { 0: "ethereum", 1: "avalanche", 2: "optimism", 3: "arbitrum", 4: "noble", 5: "solana", 6: "base", 7: "polygon", 8: "sui", 9: "aptos", 10: "unichain", 11: "linea", 12: "codex", 13: "sonic", 14: "worldchain" };
const BURN_V1 = "0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0"; // DepositForBurn, nonce and depositor indexed
const BURN_V2 = "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5"; // v2: depositor second, a max fee and hook data
async function solanaOwner(account: string) {
  const j = await throttle(() => fetchJson(process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [account, { encoding: "jsonParsed" }] }) }, 2)).catch(() => null);
  return (j?.result?.value?.data?.parsed?.info?.owner as string | undefined) ?? account;
}
async function cctp(chain: string, hash: string, logs: Logs): Promise<BridgeCrossing | null> {
  const out: BridgeCrossing["out"] = [];
  let from = "";
  for (const l of await logs()) {
    const v1 = l.topics?.[0] === BURN_V1;
    if (!v1 && l.topics?.[0] !== BURN_V2) continue;
    const domain = Number(word(l.data, 2));
    const to = CCTP_DOMAIN[domain] ?? `CCTP domain ${domain}`;
    const raw = Buffer.from(l.data.slice(2 + 64, 2 + 128), "hex");
    from = `0x${(l.topics[v1 ? 3 : 2] ?? "").slice(26)}`;
    out.push({ chain: to, address: to === "solana" ? await solanaOwner(b58(raw)) : addressOn(to, raw), asset: "USDC", amount: Number(word(l.data, 0)) / 1e6, hash: "" });
  }
  if (!out.length) return null;
  return { bridge: "CCTP", index: "Circle's burn event", status: "sent", in: { chain, address: from, asset: "USDC", amount: out.reduce((n, o) => n + o.amount, 0), hash }, out };
}

// LayerZero endpoint ids: v1 ids, and the same plus 30000 on v2
const LZ: Record<number, string> = { 101: "ethereum", 102: "bsc", 106: "avalanche", 109: "polygon", 110: "arbitrum", 111: "optimism", 184: "base", 168: "solana", 420: "tron", 324: "zksync", 183: "linea", 181: "mantle", 214: "scroll" };
const lzChain = (eid: number) => LZ[eid % 30000] ?? `LayerZero chain ${eid}`;
// Stargate assets. v2 sends every asset in 6 shared decimals; v1 pools have their own
const SG_ASSET: Record<number, string> = { 1: "USDC", 2: "USDT", 13: "ETH" };
const SG_V1_POOL: Record<number, [string, number]> = { 1: ["USDC", 6], 2: ["USDT", 6], 3: ["DAI", 6], 13: ["ETH", 18] };

// Who a LayerZero message pays and how much: Stargate v1 swaps (ABI encoded), Stargate v2 taxi rides, and the OFT
// standard every other token bridge on LayerZero uses (recipient, amount in 6 shared decimals, optional compose call)
function lzPayout(m: any, to: string): { address: string; asset: string; amount: number } | null {
  const p = m.pathway, hex = String(m.source?.tx?.payload ?? "").replace(/^0x/, "");
  const b = Buffer.from(hex, "hex");
  const v1 = p.srcEid < 30000;
  if (p.sender?.id === "stargate") {
    if (v1) {
      // type, src pool, dst pool, gas, credits (2), swap (amount + 5 fees), offset of `to`, offset of the payload
      if (b.length < 15 * 32 || word(hex, 0) !== 1n) return null;
      const [asset, sd] = SG_V1_POOL[Number(word(hex, 2))] ?? ["token", 6];
      const at = Number(word(hex, 12)), len = Number(word(hex, at / 32));
      return { address: addressOn(to, b.subarray(at + 32, at + 32 + len)), asset, amount: Number(word(hex, 6)) / 10 ** sd };
    }
    // taxi: type 1, asset id, receiver, amount. A bus carries many riders; each one's share is read from its own BusRode log
    if (b[0] !== 1 || b.length < 43) return null;
    return { address: addressOn(to, b.subarray(3, 35)), asset: SG_ASSET[b.readUInt16BE(1)] ?? "token", amount: Number(b.readBigUInt64BE(35)) / 1e6 };
  }
  if (v1 || (b.length !== 40 && b.length < 72)) return null;
  const rcpt = b.subarray(0, 32);
  if (to !== "solana" && rcpt.subarray(0, 12).some((x) => x !== 0)) return null; // not an address: some other kind of message
  return { address: addressOn(to, rcpt), asset: p.sender?.name ?? "token", amount: Number(b.readBigUInt64BE(32)) / 1e6 };
}

async function layerzero(chain: string, hash: string): Promise<BridgeCrossing | null> {
  const msgs: any[] = (await get(`https://scan.layerzero-api.com/v1/messages/tx/${evmHash(hash)}`))?.data ?? [];
  const out: BridgeCrossing["out"] = [];
  let app = "", from = "", done = true;
  for (const m of msgs.slice(0, 5)) {
    const to = lzChain(Number(m.pathway?.dstEid));
    const pay = lzPayout(m, to);
    if (!pay) continue;
    app ||= m.pathway.sender?.name ?? "";
    from ||= m.source?.tx?.from ?? "";
    done &&= m.destination?.status === "SUCCEEDED" || m.status?.name === "DELIVERED";
    out.push({ chain: to, ...pay, hash: m.destination?.tx?.txHash ?? "" });
  }
  if (!out.length) return null;
  const bridge = app === "Stargate" ? "Stargate" : app ? `LayerZero (${app})` : "LayerZero";
  return { bridge, index: "LayerZero Scan", status: done ? "success" : "pending", in: { chain, address: from, asset: out[0].asset, amount: out.reduce((n, o) => n + o.amount, 0), hash }, out };
}

// Stargate v2 bus: the rider's tx only books a seat (BusRode: destination, ticket, fare, then asset id, receiver,
// amount, native drop); the bus leaves later in someone else's tx, so the payout is read from the seat
const BUS_RODE = "0x15955c5a4cc61b8fbb05301bce47fd31c0e6f935e1ab97fdac9b134c887bb074";
async function stargateBus(chain: string, hash: string, logs: Logs): Promise<BridgeCrossing | null> {
  const out: BridgeCrossing["out"] = [];
  for (const l of await logs()) {
    if (l.topics?.[0] !== BUS_RODE) continue;
    const to = lzChain(Number(word(l.data, 0)));
    const at = Number(word(l.data, 3)) * 2, seat = Buffer.from(l.data.slice(2 + at + 64, 2 + at + 64 + 86), "hex");
    if (seat.length < 42) continue;
    out.push({ chain: to, address: addressOn(to, seat.subarray(2, 34)), asset: SG_ASSET[seat.readUInt16BE(0)] ?? "token", amount: Number(seat.readBigUInt64BE(34)) / 1e6, hash: "" });
  }
  if (!out.length) return null;
  return { bridge: "Stargate", index: "Stargate's bus ticket", status: "on the bus", in: { chain, address: "", asset: out[0].asset, amount: out.reduce((n, o) => n + o.amount, 0), hash }, out };
}

const BY_NAME: [RegExp, (chain: string, hash: string, logs: Logs) => Promise<BridgeCrossing | null>][] = [
  [/wormhole|portal/i, (_c, h) => wormhole(h)],
  [/mayan/i, (_c, h) => mayan(h)],
  [/debridge|\bdln\b/i, (_c, h) => debridge(h)],
  [/across/i, across],
  [/cctp|circle|token ?messenger/i, cctp],
  [/stargate|layerzero/i, layerzero],
  [/stargate/i, stargateBus],
];

// The bridge a deposit went through and where it paid out. A labeled contract asks only its own bridge;
// an unlabeled one asks all of them, since a fresh bridge contract is rarely labeled. logs: the tx's event logs from
// the trace's own reader; without it a public node is asked, which knows recent txs only.
export async function bridgeCrossing(chain: string, hash: string, name?: string, logs?: Logs): Promise<BridgeCrossing | null> {
  const named = BY_NAME.filter(([re]) => name && re.test(name));
  const ask = named.length ? named : BY_NAME;
  let read: Promise<Log[]> | null = null;
  const once: Logs = () => (read ??= (logs ? logs() : publicLogs(chain, hash)).catch(() => []));
  const found = await Promise.all(ask.map(([, f]) => f(chain, hash, once).catch(() => null)));
  return found.find((x) => x && x.out.some((o) => o.address)) ?? null;
}
