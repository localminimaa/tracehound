export interface Transfer {
  from: string;
  to: string;
  amount: number;
  asset: string; // native symbol or token symbol/mint
  hash: string;
  ts: number; // unix seconds
  unverified?: boolean; // token outside the known list — real, but its value is unknown
  memo?: string; // note attached to the tx (Tron data field); THORChain deposits carry their swap order here
}

export interface Profile {
  isContract: boolean;
  hub: boolean; // very high activity — exchange hot wallet, router, pool
  txCount: number | null;
}

export interface ResolvedTx {
  from: string;
  to: string | null;
  ts: number;
}

// One chain = one adapter. Everything the engine knows about a chain goes through here.
export interface Adapter {
  chain: string; // "ethereum", "base", "solana", ...
  native: string;
  norm(addr: string): string;
  addrUrl(addr: string): string;
  txUrl(hash: string): string;
  resolveTx(hash: string): Promise<ResolvedTx | null>;
  firstFunding(addr: string): Promise<Transfer | null>;
  outflows(addr: string, max: number): Promise<Transfer[]>;
  profile(addr: string): Promise<Profile>;
  // All value moved inside one tx (swap legs, internal transfers). ts is the tx time the caller already knows.
  txOutputs?(hash: string, ts: number): Promise<Transfer[]>;
  // The event logs of one tx (EVM), read once and shared by the swap and bridge readers
  logs?(hash: string): Promise<{ address: string; topics: string[]; data: string }[]>;
  // Liquidity positions this wallet opened (DEX LP tokens or V3 position NFTs minted to it), who they were handed to and
  // the txs that took the liquidity back out, with every value movement in each
  positions?(addr: string): Promise<Position[]>;
}

export interface Position {
  v: 2 | 3;
  pool: string; // the pair, or the position manager for V3
  name: string; // "WETH/USDC"
  id?: string; // V3 position NFT id
  adder: string;
  addTx: string;
  ts: number;
  moves: Transfer[]; // the LP tokens or the position NFT handed to other wallets
  pulls: { hash: string; ts: number; owner: string; legs: Transfer[] }[];
  empty?: boolean; // V3: no liquidity left in the position now
}

export type NodeKind =
  | "suspect" | "attack_contract" | "known_hacker" | "funder" | "sibling"
  | "cex" | "deposit" | "mixer" | "bridge" | "contract" | "hub" | "wallet";

export interface GNode {
  id: string;
  chain: string;
  addr: string;
  kind: NodeKind;
  label?: string;
  depth: number;
  url: string;
}

export interface GEdge {
  from: string;
  to: string;
  chain: string;
  asset: string;
  amount: number;
  txs: string[];
  first: number;
  last: number;
  dir: "fund" | "out";
  unverified?: boolean; // a token known only by the symbol it gives itself
  usd?: number; // value when it moved
  usdNow?: boolean; // priced at today's rate: no price history for that time
}

export interface Finding {
  kind: string;
  title: string;
  detail: string;
  confidence: "high" | "medium" | "low";
  chain: string;
  addresses: string[];
  txs: string[];
}

export interface Case {
  id: string;
  query: string;
  chainParam?: string;
  created: number;
  durationMs: number;
  chains: string[];
  suspects: string[];
  nodes: GNode[];
  edges: GEdge[];
  findings: Finding[];
  log: string[];
  priced?: boolean; // flows carry their USD value
}
