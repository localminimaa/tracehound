// Accounts: sign in with a wallet. The site asks for a one-time message, the wallet signs it, the signature proves the
// address. No passwords, no email: a user is a wallet address, a plan and the day's usage.
// Solana signatures are ed25519 (node:crypto); EVM ones are personal_sign over secp256k1 (@noble).
import { DatabaseSync } from "node:sqlite";
import { createHash, createPublicKey, randomBytes, verify as edVerify } from "node:crypto";
import { mkdirSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
export const db = new DatabaseSync(process.env.APP_DB || new URL("../data/app.db", import.meta.url).pathname);
// The site and the Telegram bot are two processes on one file: WAL lets them read while the other writes
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, wallet TEXT UNIQUE NOT NULL, chain TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', plan_until INTEGER, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS usage (who TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (who, day, kind));
  CREATE TABLE IF NOT EXISTS tg_codes (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tg_chats (chat_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, linked INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, hash TEXT UNIQUE NOT NULL, prefix TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER);
`);

export type Plan = "free" | "standard" | "pro";
export const PLANS: Record<Plan, { name: string; price: number; checks: number; traces: number; watch: number }> = {
  free: { name: "Free", price: 0, checks: 5, traces: 1, watch: 1 },
  standard: { name: "Standard", price: 19, checks: 100, traces: 10, watch: 25 },
  pro: { name: "Pro", price: 99, checks: 300, traces: 20, watch: 100 },
};
const SESSION_DAYS = 30;
const NONCE_SEC = 600;
const now = () => Math.floor(Date.now() / 1000);
const day = () => new Date().toISOString().slice(0, 10);

const isSol = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

// The message a wallet signs: what it is for, which site, which address, a nonce and when (Sign-In-With style)
export function issueNonce(wallet: string, chain: string, host: string): { message: string } | { error: string } {
  if (!(chain === "solana" ? isSol(wallet) : chain === "evm" && isEvm(wallet))) return { error: "unknown wallet address" };
  db.prepare("DELETE FROM nonces WHERE created < ?").run(now() - NONCE_SEC);
  const nonce = randomBytes(16).toString("hex");
  const message = `${host} wants you to sign in to Tracehound with your ${chain === "solana" ? "Solana" : "Ethereum"} account:\n${wallet}\n\nSigning only proves you own this address. It costs nothing and sends no transaction.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  db.prepare("INSERT INTO nonces (nonce, wallet, message, created) VALUES (?, ?, ?, ?)").run(nonce, wallet, message, now());
  return { message };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.concat([Buffer.alloc(s.match(/^1*/)![0].length), Buffer.from(n ? hex : "", "hex")]);
}

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
function solanaSigned(wallet: string, message: string, sig: Buffer): boolean {
  const raw = b58decode(wallet);
  if (raw.length !== 32 || sig.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: "der", type: "spki" });
  return edVerify(null, Buffer.from(message, "utf8"), key, sig);
}

// personal_sign: keccak256("\x19Ethereum Signed Message:\n" + length + message), signature r ‖ s ‖ v
function evmSigned(wallet: string, message: string, sig: Buffer): boolean {
  if (sig.length !== 65) return false;
  const msg = Buffer.from(message, "utf8");
  const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`, "utf8"), msg]));
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  if (v > 1) return false;
  const pub = secp256k1.recoverPublicKey(Buffer.concat([Buffer.from([v]), sig.subarray(0, 64)]), hash, { prehash: false });
  const full = secp256k1.Point.fromBytes(pub).toBytes(false);
  const addr = `0x${Buffer.from(keccak_256(full.subarray(1))).subarray(-20).toString("hex")}`;
  return addr === wallet.toLowerCase();
}

export interface User { id: number; wallet: string; chain: string; plan: Plan; plan_until: number | null }

// Check the signature against the message we issued for this wallet; on success the user exists and gets a session
export function signIn(wallet: string, chain: string, message: string, signature: string): { token: string; user: User } | { error: string } {
  const row = db.prepare("SELECT nonce, created FROM nonces WHERE wallet = ? AND message = ?").get(wallet, message) as any;
  if (!row || now() - row.created > NONCE_SEC) return { error: "the sign-in message expired, try again" };
  db.prepare("DELETE FROM nonces WHERE nonce = ?").run(row.nonce); // one use only
  let ok = false;
  try {
    ok = chain === "solana"
      ? solanaSigned(wallet, message, Buffer.from(signature, "base64"))
      : evmSigned(wallet, message, Buffer.from(signature.replace(/^0x/, ""), "hex"));
  } catch {
    ok = false;
  }
  if (!ok) return { error: "the signature does not match this wallet" };
  const key = chain === "evm" ? wallet.toLowerCase() : wallet;
  db.prepare("INSERT INTO users (wallet, chain, created) VALUES (?, ?, ?) ON CONFLICT(wallet) DO NOTHING").run(key, chain, now());
  const user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(key) as any as User;
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)").run(token, user.id, now(), now() + SESSION_DAYS * 86400);
  return { token, user: activePlan(user) };
}

// A paid plan past its end date counts as Free
const activePlan = (u: User): User => (u.plan !== "free" && u.plan_until && u.plan_until < now() ? { ...u, plan: "free" } : u);

export function userOf(cookie: string | undefined): User | null {
  const token = cookie?.match(/(?:^|;\s*)th_session=([0-9a-f]{64})/)?.[1];
  if (!token) return null;
  const u = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?").get(token, now()) as any;
  return u ? activePlan(u) : null;
}

export function signOut(cookie: string | undefined) {
  const token = cookie?.match(/(?:^|;\s*)th_session=([0-9a-f]{64})/)?.[1];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export const sessionCookie = (token: string, secure: boolean) =>
  `th_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
export const clearCookie = "th_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

// Daily limits: a signed-in user counts by account, everyone else by IP, both on the Free plan's numbers unless paid
export type Kind = "checks" | "traces";
export function usage(who: string): Record<Kind, number> {
  const rows = db.prepare("SELECT kind, n FROM usage WHERE who = ? AND day = ?").all(who, day()) as any[];
  return { checks: rows.find((r) => r.kind === "checks")?.n ?? 0, traces: rows.find((r) => r.kind === "traces")?.n ?? 0 };
}
export function allow(who: string, plan: Plan, kind: Kind): { ok: boolean; used: number; limit: number } {
  const used = usage(who)[kind], limit = PLANS[plan][kind];
  return { ok: used < limit, used, limit };
}
export function count(who: string, kind: Kind) {
  db.prepare("INSERT INTO usage (who, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT(who, day, kind) DO UPDATE SET n = n + 1").run(who, day(), kind);
}

// A paid period: the same plan extends from its current end, a different one starts now
export function grantPlan(userId: number, plan: Plan, days: number) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any as User;
  const from = u.plan === plan && u.plan_until && u.plan_until > now() ? u.plan_until : now();
  db.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").run(plan, from + days * 86400, userId);
}

// Plans can also be set by hand (gifts, testers): npm run plan -- <wallet> <free|standard|pro> [days]
export function setPlan(wallet: string, plan: Plan, days?: number): boolean {
  const r = db.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE wallet = ? OR wallet = ?").run(plan, days ? now() + days * 86400 : null, wallet, wallet.toLowerCase());
  return r.changes > 0;
}

// Telegram: the account page hands out a one-time code, the bot gets it (/link CODE or the t.me start link) and ties
// the chat to the account, so the bot counts against the account's plan and day
const TG_CODE_SEC = 900;
export function tgCode(userId: number): { code: string; expires: number } {
  db.prepare("DELETE FROM tg_codes WHERE user_id = ? OR created < ?").run(userId, now() - TG_CODE_SEC);
  const code = randomBytes(5).toString("hex").toUpperCase();
  db.prepare("INSERT INTO tg_codes (code, user_id, created) VALUES (?, ?, ?)").run(code, userId, now());
  return { code, expires: now() + TG_CODE_SEC };
}
export function tgLink(chatId: string, code: string): User | null {
  const row = db.prepare("SELECT user_id FROM tg_codes WHERE code = ? AND created > ?").get(code.toUpperCase(), now() - TG_CODE_SEC) as any;
  if (!row) return null;
  db.prepare("DELETE FROM tg_codes WHERE code = ?").run(code.toUpperCase());
  db.prepare("INSERT INTO tg_chats (chat_id, user_id, linked) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id, linked = excluded.linked").run(chatId, row.user_id, now());
  return tgUser(chatId);
}
export function tgUser(chatId: string): User | null {
  const u = db.prepare("SELECT u.* FROM tg_chats t JOIN users u ON u.id = t.user_id WHERE t.chat_id = ?").get(chatId) as any;
  return u ? activePlan(u) : null;
}
export const tgChats = (userId: number) => (db.prepare("SELECT COUNT(*) AS n FROM tg_chats WHERE user_id = ?").get(userId) as any).n as number;
export const tgUnlink = (userId: number) => db.prepare("DELETE FROM tg_chats WHERE user_id = ?").run(userId);

// API keys: shown once when made, stored only as a hash. A request carrying one acts as its account, on its plan.
export const API_KEYS_MAX = 3;
const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export function makeApiKey(userId: number, name: string): { id: number; key: string } | { error: string } {
  if (apiKeys(userId).length >= API_KEYS_MAX) return { error: `${API_KEYS_MAX} keys at most; revoke one first` };
  const key = `th_${randomBytes(24).toString("base64url")}`;
  const r = db.prepare("INSERT INTO api_keys (user_id, hash, prefix, name, created) VALUES (?, ?, ?, ?, ?)").run(userId, keyHash(key), key.slice(0, 7), name.slice(0, 40) || "key", now());
  return { id: Number(r.lastInsertRowid), key };
}
export const apiKeys = (userId: number) =>
  db.prepare("SELECT id, prefix, name, created, last_used FROM api_keys WHERE user_id = ? ORDER BY id").all(userId) as { id: number; prefix: string; name: string; created: number; last_used: number | null }[];
export const revokeApiKey = (userId: number, id: number) => db.prepare("DELETE FROM api_keys WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
export function apiUser(key: string): User | null {
  if (!/^th_[\w-]{20,}$/.test(key)) return null;
  const row = db.prepare("SELECT id, user_id FROM api_keys WHERE hash = ?").get(keyHash(key)) as any;
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?").run(now(), row.id);
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as any;
  return u ? activePlan(u) : null;
}
