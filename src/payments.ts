// Paying for a plan in USDC on Solana or Base. An invoice gets an amount unique to it (the price plus up to a cent of
// micro-USDC), the user sends exactly that to our address, and a poll that runs only while invoices are open finds the
// transfer on chain and switches the plan on. No payment processor, no custody: money lands straight in our wallet.
import { randomBytes } from "node:crypto";
import { db, grantPlan, PLANS, type Plan, type User } from "./auth.ts";
import { fetchJson } from "./util.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, plan TEXT NOT NULL, days INTEGER NOT NULL, chain TEXT NOT NULL,
    amount INTEGER NOT NULL, address TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', tx TEXT UNIQUE, paid INTEGER);
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

export const USDC = {
  solana: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "Solana" },
  base: { mint: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "Base" },
} as const;
export type PayChain = keyof typeof USDC;
const ADDRESS: Record<PayChain, string> = { solana: process.env.PAY_SOLANA_ADDRESS ?? "", base: (process.env.PAY_BASE_ADDRESS ?? "").toLowerCase() };
export const payChains = () => (Object.keys(USDC) as PayChain[]).filter((c) => ADDRESS[c]);

export const PERIODS = { month: { days: 30, months: 1 }, year: { days: 365, months: 10 } } as const; // a year costs ten months
const OPEN_SEC = 3600; // shown to the user as the time to pay
const MATCH_SEC = 6 * 3600; // a late transfer still counts for this long
const now = () => Math.floor(Date.now() / 1000);
const RANK: Record<Plan, number> = { free: 0, standard: 1, pro: 2 };

export interface Invoice { id: string; user_id: number; plan: Plan; days: number; chain: PayChain; amount: number; address: string; created: number; expires: number; status: string; tx: string | null; paid: number | null }
export const usdcText = (micro: number) => (micro / 1e6).toFixed(6);

export function createInvoice(user: User, plan: Plan, period: keyof typeof PERIODS, chain: PayChain): Invoice | { error: string } {
  if (!ADDRESS[chain]) return { error: `payments on ${chain} are not open` };
  if (!PLANS[plan]?.price || !PERIODS[period]) return { error: "unknown plan" };
  if (RANK[user.plan] > RANK[plan] && user.plan_until && user.plan_until > now()) return { error: `you are on ${PLANS[user.plan].name} until ${new Date(user.plan_until * 1000).toISOString().slice(0, 10)}` };
  // An open invoice for the same thing is reused, so reloading the page does not pile them up
  const same = db.prepare("SELECT * FROM invoices WHERE user_id = ? AND plan = ? AND days = ? AND chain = ? AND status = 'open' AND expires > ?").get(user.id, plan, PERIODS[period].days, chain, now() + 600) as any;
  if (same) return same;
  const base = PLANS[plan].price * PERIODS[period].months * 1e6;
  const taken = new Set((db.prepare("SELECT amount FROM invoices WHERE chain = ? AND status = 'open'").all(chain) as any[]).map((r) => r.amount));
  let amount = 0;
  for (let i = 0; i < 50 && (!amount || taken.has(amount)); i++) amount = base + 1 + (randomBytes(2).readUInt16BE() % 9999);
  if (taken.has(amount)) return { error: "too many open payments, try again in a minute" };
  const inv = { id: randomBytes(8).toString("hex"), user_id: user.id, plan, days: PERIODS[period].days, chain, amount, address: ADDRESS[chain], created: now(), expires: now() + OPEN_SEC };
  db.prepare("INSERT INTO invoices (id, user_id, plan, days, chain, amount, address, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(inv.id, inv.user_id, inv.plan, inv.days, inv.chain, inv.amount, inv.address, inv.created, inv.expires);
  wake();
  return { ...inv, status: "open", tx: null, paid: null };
}

export const invoiceOf = (id: string, userId: number) => db.prepare("SELECT * FROM invoices WHERE id = ? AND user_id = ?").get(id, userId) as any as Invoice | undefined;
export const paymentsOf = (userId: number) => db.prepare("SELECT * FROM invoices WHERE user_id = ? AND status = 'paid' ORDER BY paid DESC LIMIT 20").all(userId) as any[] as Invoice[];

// A transfer of `micro` USDC to our address in tx: pay the matching open invoice, once per tx
function settle(chain: PayChain, micro: number, tx: string, at: number, log: (s: string) => void) {
  const inv = db.prepare("SELECT * FROM invoices WHERE chain = ? AND amount = ? AND status = 'open' AND created <= ? AND created > ?").get(chain, micro, at + 120, now() - MATCH_SEC) as any as Invoice | undefined;
  if (!inv || db.prepare("SELECT 1 FROM invoices WHERE tx = ?").get(tx)) return;
  db.prepare("UPDATE invoices SET status = 'paid', tx = ?, paid = ? WHERE id = ?").run(tx, now(), inv.id);
  grantPlan(inv.user_id, inv.plan, inv.days);
  log(`payment: ${usdcText(micro)} USDC on ${chain} → ${inv.plan} for ${inv.days} days (invoice ${inv.id}, tx ${tx})`);
}

const kv = (k: string) => (db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as any)?.v as string | undefined;
const setKv = (k: string, v: string) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);

// Solana: new signatures on our USDC token account, each read once for how much USDC it added to it
async function solRpc(method: string, params: unknown[]) {
  if (process.env.HELIUS_API_KEY) return (await import("./chains/solana.ts")).helius().rpc(method, params);
  const j = await fetchJson(process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (j.error) throw new Error(`solana ${method}: ${j.error.message}`);
  return j.result;
}
async function pollSolana(log: (s: string) => void) {
  const owner = ADDRESS.solana;
  let ata = kv("sol_ata");
  if (!ata) {
    const r = await solRpc("getTokenAccountsByOwner", [owner, { mint: USDC.solana.mint }, { encoding: "jsonParsed" }]);
    ata = r?.value?.[0]?.pubkey;
    if (!ata) return; // the wallet has no USDC account until its first USDC arrives
    setKv("sol_ata", ata);
  }
  const last = kv("sol_last");
  const sigs: any[] = await solRpc("getSignaturesForAddress", [ata, last ? { until: last, limit: 100 } : { limit: 20 }]);
  let read = true;
  for (const s of [...sigs].reverse()) {
    if (s.err || !s.blockTime) continue;
    const tx = await solRpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).catch((e) => {
      log(`payments solana: ${e.message}`);
      return (read = false);
    });
    if (!tx) continue;
    const bal = (list: any[]) => Number(list?.find((b) => b.owner === owner && b.mint === USDC.solana.mint)?.uiTokenAmount?.amount ?? 0);
    const added = bal(tx.meta?.postTokenBalances) - bal(tx.meta?.preTokenBalances);
    if (added > 0) settle("solana", added, s.signature, s.blockTime, log);
  }
  if (sigs[0] && read) setKv("sol_last", sigs[0].signature); // a tx that could not be read is tried again next time
}

// Base: USDC Transfer logs to our address since the last block looked at (public RPCs serve recent ranges fine)
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
async function baseRpc(method: string, params: unknown[]) {
  const j = await fetchJson(process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (j.error) throw new Error(`base ${method}: ${j.error.message}`);
  return j.result;
}
async function pollBase(log: (s: string) => void) {
  const head = parseInt(await baseRpc("eth_blockNumber", []), 16);
  let from = Number(kv("base_block") ?? 0) + 1;
  // Blocks are 2 s. Public nodes call anything older than a few thousand blocks archive and refuse it, so after a long
  // pause the poll looks back at most ~100 min; the poll runs every minute while an invoice is open, so this is a restart gap only.
  if (head - from > 3000) from = head - 3000;
  const to32 = `0x${ADDRESS.base.slice(2).padStart(64, "0")}`;
  for (let a = from; a <= head; a += 1000) {
    const b = Math.min(head, a + 999);
    const logs: any[] = await baseRpc("eth_getLogs", [{ fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}`, address: USDC.base.mint, topics: [TRANSFER, null, to32] }]);
    for (const l of logs) {
      if (l.removed) continue;
      // the block's time: from the log when the node gives it, else counted back from the head at 2 s a block
      const at = l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : now() - (head - parseInt(l.blockNumber, 16)) * 2;
      settle("base", Number(BigInt(l.data)), l.transactionHash, at, log);
    }
    setKv("base_block", String(b));
  }
}

// The poll runs every minute while some invoice is open, and right away when one is made or the user says they paid
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false, lastPoll = 0;
export async function poll(log: (s: string) => void = console.log) {
  if (running || Date.now() - lastPoll < 15_000) return; // "I paid" clicks cannot hammer the RPCs
  running = true;
  lastPoll = Date.now();
  try {
    db.prepare("UPDATE invoices SET status = 'expired' WHERE status = 'open' AND created < ?").run(now() - MATCH_SEC);
    const open = new Set((db.prepare("SELECT DISTINCT chain FROM invoices WHERE status = 'open'").all() as any[]).map((r) => r.chain));
    for (const [chain, fn] of [["solana", pollSolana], ["base", pollBase]] as const)
      if (open.has(chain) && ADDRESS[chain]) await fn(log).catch((e) => log(`payments ${chain}: ${e.message}`));
  } finally {
    running = false;
  }
  schedule();
}
function schedule() {
  if (timer) clearTimeout(timer);
  const open = (db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'open'").get() as any).n;
  timer = open ? setTimeout(() => poll(), 60_000) : null;
}
export const wake = () => {
  if (!timer && payChains().length) schedule();
};
wake();
