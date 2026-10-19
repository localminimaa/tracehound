// Live watch. Two narrow sources, both priced by design rather than by how busy the market is:
// 1. Known ring wallets, polled: every RING_POLL_MIN minutes, the tokens each ring wallet holds (two plain RPC
//    calls a wallet). A new token is looked up in that wallet's history (10 credits) and alerts only if the
//    ring paid for it. Streaming these wallets was tried first: a ring wash-trading around the clock is about
//    one event a second, ~100k credits a day.
// 2. Launches over Helius Parsed Streams (1 credit per event), only on launchpads where a known ring has a
//    playbook (Meteora DBC ~1.9k launches a day, LaunchLab ~1k; pump.fun's ~35k a day would cost more than
//    the budget): a fresh creator funded with the playbook amount minutes before the launch.
// Every alert gets a token check and goes to data/alerts.jsonl. Usage: node src/watch-cli.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { helius, heliusKey } from "./chains/solana.ts";
import { addCredits, allowed } from "./credits.ts";
import { loadRings, reloadRings, ringsByPlaybook, type Ring } from "./rings.ts";
import { checkToken, PLAYBOOK_LEAD } from "./tokencheck.ts";
import { short } from "./util.ts";

const WSS = "wss://beta.helius-rpc.com";
const LAUNCHPADS = [
  { name: "Meteora DBC", program: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", ix: ["initialize_virtual_pool_with_spl_token", "initialize_virtual_pool_with_token2022"] },
  { name: "Raydium LaunchLab", program: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", ix: ["initialize", "initialize_v2", "initialize_with_token_2022"] },
];
// Tokens a ring moves that are not a new pick: SOL, stablecoins
const BASE_MINTS = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const FRESH_SIGS = 4; // a creator with this few transactions is a fresh wallet worth one more lookup
const REPEAT_SEC = 6 * 3600; // the same alert for the same token is not repeated within this
const RING_POLL_MIN = Number(process.env.RING_POLL_MIN) || 15;
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PE9n9qKSD6Lkus"];
const CHECK_TIMEOUT = 5 * 60_000;

export interface Alert {
  ts: number;
  kind: "ring_buy" | "playbook_launch";
  mint: string;
  ring: string; // ring id
  wallets: string[];
  detail: string;
  tx: string;
  check?: string; // id of the token check it triggered
  risk?: number;
}

const dataDir = new URL("../data/", import.meta.url);
const alertsFile = new URL("alerts.jsonl", dataDir);
const log = (s: string) => console.log(`${new Date().toISOString().slice(0, 19)} ${s}`);

export function loadAlerts(limit = 100): Alert[] {
  if (!existsSync(alertsFile)) return [];
  return readFileSync(alertsFile, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l)).reverse();
}

const recent = new Map<string, number>(loadAlerts(500).map((a) => [`${a.kind}|${a.mint}`, a.ts]));
const checking = new Set<string>();
let queue: Promise<void> = Promise.resolve();
// An active ring buys a dozen new tokens a day and each check is ~500 credits: past this many, alerts are
// still written, without a verdict
const CHECKS_A_DAY = Number(process.env.WATCH_CHECKS_A_DAY) || 8;
let checksDay = "";
let checksToday = 0;

async function raise(a: Alert) {
  const key = `${a.kind}|${a.mint}`;
  if (a.ts - (recent.get(key) ?? 0) < REPEAT_SEC) return;
  recent.set(key, a.ts);
  log(`ALERT ${a.kind} ${short(a.mint)}: ${a.detail}`);
  // The check runs before the alert is written, so the alert carries its verdict. One check at a time:
  // the parsed-data rate limit is 2 requests a second on the free plan.
  const day = new Date().toISOString().slice(0, 10);
  if (checksDay !== day) (checksDay = day), (checksToday = 0);
  if (!checking.has(a.mint) && allowed("watch").ok && checksToday < CHECKS_A_DAY) {
    checksToday++;
    checking.add(a.mint);
    const turn = queue;
    let done = () => {};
    queue = new Promise<void>((r) => (done = r));
    await turn;
    try {
      // A stuck check (the Mac asleep, an API hanging) must not hold up the alerts behind it
      const c = await Promise.race([
        checkToken(a.mint, { source: "watch" }),
        new Promise<never>((_, no) => setTimeout(() => no(new Error(`no verdict in ${CHECK_TIMEOUT / 60_000} min`)), CHECK_TIMEOUT).unref()),
      ]);
      a.check = `${c.mint}-${c.checkedAt}`;
      a.risk = c.risk;
      log(`  checked ${c.symbol}: risk ${c.risk} (${c.verdict})`);
    } catch (e) {
      log(`  check failed: ${(e as Error).message}`);
    } finally {
      checking.delete(a.mint);
      done();
    }
  }
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(alertsFile, JSON.stringify(a) + "\n");
}

// What ring wallets did with each token in one transaction (stream shape or parsed history shape). Paying
// SOL or a stablecoin for it is a buy; selling it back in the same transaction is volume farming; receiving
// it for nothing is spam or a transfer and does not count.
export function ringMoves(tx: any, rings: Map<string, Ring>) {
  const out = new Map<string, { got: number; sent: number; paid: boolean; wallets: Set<string> }>();
  if ((tx.status && tx.status !== "ok") || tx.transactionError) return out;
  const paidBy = new Set<string>();
  for (const t of tx.nativeTransfers ?? []) if (rings.has(t.fromUserAccount) && t.amount > 10_000_000) paidBy.add(t.fromUserAccount);
  for (const t of tx.tokenTransfers ?? []) if (BASE_MINTS.has(t.mint) && rings.has(t.fromUserAccount)) paidBy.add(t.fromUserAccount);
  for (const t of tx.tokenTransfers ?? []) {
    if (BASE_MINTS.has(t.mint)) continue;
    const amount = Number(t.rawTokenAmount ?? t.tokenAmount ?? 0);
    for (const [w, dir] of [[t.toUserAccount, "got"], [t.fromUserAccount, "sent"]] as const) {
      if (!w || !rings.has(w)) continue;
      const m = out.get(t.mint) ?? { got: 0, sent: 0, paid: false, wallets: new Set<string>() };
      m[dir] += amount;
      m.wallets.add(w);
      if (paidBy.has(w)) m.paid = true;
      out.set(t.mint, m);
    }
  }
  return out;
}

// 1. Poll ring wallets for tokens they did not hold at the last look. The first look at a wallet only
// records what it holds. Kept in data/watch-state.json, so a restart does not alert on old holdings.
const stateFile = new URL("watch-state.json", dataDir);
async function pollRings() {
  if (!allowed("watch").ok) return log("ring poll skipped: the day's credit budget is near its end");
  reloadRings();
  const rings = new Map(loadRings().flatMap((r) => r.wallets.map((w) => [w, r] as const)));
  const seen: Record<string, string[]> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  const h = helius();
  const fresh = new Map<string, string[]>(); // new mint -> ring wallets that now hold it
  for (const w of rings.keys()) {
    const mints = new Set<string>();
    for (const programId of TOKEN_PROGRAMS) {
      const r = await h.rpc("getTokenAccountsByOwner", [w, { programId }, { encoding: "jsonParsed" }]).catch(() => null);
      for (const a of r?.value ?? []) mints.add(a.account?.data?.parsed?.info?.mint);
    }
    if (seen[w]) for (const m of mints) if (m && !BASE_MINTS.has(m) && !seen[w].includes(m)) fresh.set(m, [...(fresh.get(m) ?? []), w]);
    seen[w] = [...new Set([...(seen[w] ?? []), ...mints])].filter(Boolean);
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(seen));
  for (const [mint, ws] of fresh) {
    const r = rings.get(ws[0])!;
    if (r.tokens.some((t) => t.mint === mint)) continue;
    // Did the ring pay for it? Its own recent history says (spam lands in wallets for free)
    const txs: any[] = await h.history(ws[0], { limit: 50 }).catch(() => []);
    let hit: { tx: string; wash: boolean } | null = null;
    for (const t of txs) {
      const m = ringMoves(t, rings).get(mint);
      if (m?.got && m.paid) { hit = { tx: t.signature, wash: m.sent >= m.got * 0.9 }; break; }
    }
    if (!hit) continue;
    await raise({
      ts: Math.floor(Date.now() / 1000), kind: "ring_buy", mint, ring: r.id, wallets: ws, tx: hit.tx,
      detail: `${ws.length} wallet(s) of a ring of ${r.wallets.length} (pumped ${r.tokens.map((t) => t.symbol).join(", ")}) ${hit.wash ? "bought it and sold it back in one transaction: volume farming" : "bought it"}`,
    });
  }
  log(`ring poll: ${rings.size} wallets, ${fresh.size} new token(s)`);
}

// 2. A launch: is the creator a fresh wallet funded with a ring's playbook amount just before?
async function onLaunch(v: any, launchpad: string) {
  const tx = v.transaction;
  if (tx.status !== "ok") return;
  const ix = (v.matchedIndexes ?? []).map((i: number) => v.instructions[i]).find((x: any) => x?.decoded);
  const role = (n: string) => ix?.decoded?.accounts?.find((a: any) => a.name === n)?.pubkey as string | undefined;
  const creator = role("creator") ?? tx.feePayer;
  const mint = role("base_mint") ?? role("mint");
  if (!creator || !mint) return;
  const playbooks = loadRings().flatMap((r) => (r.playbook ?? []).filter((p) => p.launchpad === launchpad));
  if (!playbooks.length) return;
  const h = helius();
  const sigs: any[] = await h.rpc("getSignaturesForAddress", [creator, { limit: FRESH_SIGS + 1 }]).catch(() => []);
  if (!sigs.length || sigs.length > FRESH_SIGS) return;
  const first = sigs[sigs.length - 1];
  const ftx = await h.rpc("getTransaction", [first.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]).catch(() => null);
  const keys: any[] = ftx?.transaction?.message?.accountKeys ?? [];
  const i = keys.findIndex((k) => (k.pubkey ?? k) === creator);
  if (i < 0) return;
  const got = (ftx.meta.postBalances[i] - ftx.meta.preBalances[i]) / 1e9;
  const lead = (tx.blockTime ?? Math.floor(Date.now() / 1000)) - (ftx.blockTime ?? 0);
  if (got <= 0 || lead > PLAYBOOK_LEAD) return;
  for (const r of ringsByPlaybook(launchpad, got)) {
    await raise({
      ts: Math.floor(Date.now() / 1000), kind: "playbook_launch", mint, ring: r.id, wallets: [creator], tx: tx.signature,
      detail: `fresh developer ${short(creator)} got ${got} SOL ${Math.round(lead)} s before launching on ${launchpad}, the playbook of a ring of ${r.wallets.length} (pumped ${r.tokens.map((t) => t.symbol).join(", ")})`,
    });
  }
}

// 2. One stream connection for launches, open only while the budget allows and some ring has a playbook
export function runWatch() {
  let ws: WebSocket | null = null;
  let backoff = 5;
  let wanted = ""; // launchpads currently subscribed
  const kinds = new Map<number, (v: any) => void>(); // subscription id -> handler
  const pending = new Map<number, (v: any) => void>(); // request id -> handler, until the id comes back
  let reqId = 0;

  const launchpads = () => {
    reloadRings();
    const used = new Set(loadRings().flatMap((r) => (r.playbook ?? []).map((p) => p.launchpad)));
    return allowed("watch").ok ? LAUNCHPADS.filter((l) => used.has(l.name)) : [];
  };

  const connect = () => {
    const lps = launchpads();
    wanted = lps.map((l) => l.name).join(", ");
    if (!lps.length) return log(allowed("watch").ok ? "no ring playbook to watch launches for" : "launch stream off: the day's credit budget is near its end");
    const sock = new WebSocket(`${WSS}/?api-key=${heliusKey()}`);
    ws = sock;
    sock.onopen = () => {
      backoff = 5;
      kinds.clear();
      for (const lp of lps) {
        const id = ++reqId;
        pending.set(id, (v) => void onLaunch(v, lp.name).catch((e) => log(`launch: ${e.message}`)));
        sock.send(JSON.stringify({ jsonrpc: "2.0", id, method: "parsedTransactionSubscribe", params: [{ programs: [lp.program], instructionNames: lp.ix, includeCpi: false }, { details: "full" }] }));
      }
      log(`launch stream on ${wanted}`);
    };
    sock.onmessage = (m) => {
      const j = JSON.parse(String(m.data));
      if (j.id && pending.has(j.id)) {
        const h = pending.get(j.id)!;
        pending.delete(j.id);
        if (j.error) log(`subscribe failed: ${j.error.message}`);
        else kinds.set(j.result, h);
        return;
      }
      if (j.method !== "parsedTransactionNotification") return;
      addCredits(1);
      kinds.get(j.params.subscription)?.(j.params.result.value);
    };
    sock.onclose = () => {
      if (ws !== sock) return; // closed on purpose
      ws = null;
      log(`disconnected, retrying in ${backoff} s`);
      setTimeout(connect, backoff * 1000);
      backoff = Math.min(backoff * 2, 120);
    };
    sock.onerror = () => {};
  };

  // Every minute: the budget crossing or a new playbook changes which launchpads, if any, are streamed
  setInterval(() => {
    const now = launchpads().map((l) => l.name).join(", ");
    if (now === wanted) return;
    log(`launch stream: ${wanted || "off"} -> ${now || "off"}`);
    const old = ws;
    ws = null;
    old?.close();
    connect();
  }, 60_000);
  connect();

  const poll = () => void pollRings().catch((e) => log(`ring poll: ${e.message}`));
  setInterval(poll, RING_POLL_MIN * 60_000);
  poll();
}
