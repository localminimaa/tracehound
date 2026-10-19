// Telegram bot: token checks on demand, and alerts that keep people coming back.
//   /check <token>          verdict, top reasons and a link to the page
//   /watch <token>          alert when the developer's wallets sell, or a ring alert concerns this token
//   /wallet <address> [chain]  alert when money leaves a wallet (a hacker's, a developer's)
//   /rings on|off           the live ring feed (ring buys, ring-playbook launches)
//   /list, /unwatch <token or wallet>
// Long polling, no webhook. State in data/telegram.json. Polls are priced to fit the Helius budget: a watched
// Solana token costs 2 plain RPC calls a poll however many developer wallets it has (the largest holders and
// their owners), a watched Solana wallet 1 call (signatures) plus parsing only when something moved.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { helius, isSolAddress, solanaAdapter } from "./chains/solana.ts";
import { EVM_CHAINS, evmAdapter } from "./chains/evm.ts";
import { clusterHeld } from "./agent.ts";
import { allow, count, PLANS, tgLink, tgUser, type Plan } from "./auth.ts";
import { allowed } from "./credits.ts";
import { checkEvmToken, detectEvmChain, isEvmToken } from "./evmtoken.ts";
import { listChecks, loadCheck } from "./store.ts";
import { checkToken, type TokenCheck } from "./tokencheck.ts";
import { poolOf } from "./tokenextra.ts";
import { loadAlerts, type Alert } from "./watch.ts";
import { fmtAmount, short } from "./util.ts";

const API = `${process.env.TELEGRAM_API || "https://api.telegram.org"}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const SITE = (process.env.PUBLIC_URL || "https://tracehound.193-233-233-118.sslip.io").replace(/\/$/, "");
const POLL_MIN = Number(process.env.TG_POLL_MIN) || 5;
const TOKENS_TOTAL = 40; // watched tokens across all chats
const WALLET_QUIET_MIN = 30; // a busy wallet gets at most one message in this many minutes
const SOLD_STEP = 0.2; // alert each time the developer's bag shrinks by another 20% of what it held at the start

interface TokenWatch { check: string; chain: string; symbol: string; start: number; alertedAt: number; held: number }
interface WalletWatch { chain: string; last: string | null; quietUntil?: number; held?: number } // held: moves not yet reported
interface Chat { rings: boolean; tokens: Record<string, TokenWatch>; wallets: Record<string, WalletWatch> } // checks are counted per account or chat in app.db
interface State { offset: number; alertsSeen: number; chats: Record<string, Chat> }

const file = new URL("../data/telegram.json", import.meta.url);
const load = (): State => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { offset: 0, alertsSeen: -1, chats: {} });
let state = load();
const save = () => {
  writeFileSync(new URL("telegram.json.tmp", file), JSON.stringify(state));
  renameSync(new URL("telegram.json.tmp", file), file);
};
const chat = (id: number | string): Chat => (state.chats[id] ??= { rings: false, tokens: {}, wallets: {} });
const log = (s: string) => console.log(`${new Date().toISOString().slice(0, 19)} ${s}`);
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method: string, body: object, timeoutMs = 15_000): Promise<any> {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? r.status}`);
  return j.result;
}

async function send(to: number | string, html: string) {
  try {
    await tg("sendMessage", { chat_id: to, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    const m = (e as Error).message;
    log(`send ${to}: ${m}`);
    // The person blocked the bot or deleted the chat: stop spending on them
    if (/blocked|chat not found|deactivated/i.test(m)) {
      delete state.chats[to];
      save();
    }
  }
}

const tokenLink = (id: string) => `${SITE}/?token=${encodeURIComponent(id)}`;
const verdictLine = (c: TokenCheck) =>
  `<b>${esc(c.symbol)}</b>: risk <b>${c.risk}/100</b> (${c.verdict})${c.market?.fdv ? `, FDV $${fmtAmount(c.market.fdv)}` : ""}`;

function newestCheck(mint: string): any | null {
  const hit = listChecks(1000).find((c) => c.mint.toLowerCase() === mint.toLowerCase());
  return hit ? loadCheck(hit.id) : null;
}

// Who is asking: a chat tied to an account counts against that account's plan and day (shared with the site),
// any other chat is on the Free plan by itself
function whoIs(id: number | string): { key: string; plan: Plan; linked: boolean } {
  const u = tgUser(String(id));
  return u ? { key: `u:${u.id}`, plan: u.plan, linked: true } : { key: `tg:${id}`, plan: "free", linked: false };
}
const watching = (c: Chat) => Object.keys(c.tokens).length + Object.keys(c.wallets).length;

async function runCheck(addr: string, plan: Plan = "free"): Promise<TokenCheck> {
  if (isEvmToken(addr)) {
    const chain = await detectEvmChain(addr.toLowerCase());
    if (!chain) throw new Error("no Base or BSC token with this address has a pool or security data yet");
    return checkEvmToken(addr.toLowerCase(), chain);
  }
  // The last part of the day's budget is kept for paid plans, as on the site
  if (!allowed(plan === "free" ? "free" : "web").ok) throw new Error(`today's ${plan === "free" ? "free " : ""}Solana checks are used up; they resume after 00:00 UTC`);
  return checkToken(addr, { source: "web" });
}

const HELP = `<b>tracehound</b> finds who is behind a token or a hack.

/check &lt;token&gt;: risk verdict with the evidence (Solana, Base, BSC)
/watch &lt;token&gt;: message me when the developer's wallets sell, or a pump ring touches it
/wallet &lt;address&gt; [chain]: message me when money leaves this wallet (Solana, or ${Object.keys(EVM_CHAINS).join(", ")})
/rings on: live feed of pump rings buying tokens and launching new ones
/list: what you watch. /unwatch &lt;token or wallet&gt;: stop
/plan: your plan and what is left today. Tie this chat to your account on the site (Account, Telegram) to use its plan here.

${SITE}`;

async function onCommand(id: number, text: string) {
  const [cmd0, arg = "", arg2 = ""] = text.trim().split(/\s+/);
  const cmd = cmd0.toLowerCase().replace(/@.*$/, "");
  const c = chat(id);
  const w = whoIs(id);

  // /start CODE comes from the account page's t.me link; /link CODE is the same typed by hand
  if ((cmd === "/start" || cmd === "/link") && /^[0-9a-f]{10}$/i.test(arg)) {
    const u = tgLink(String(id), arg);
    return send(id, u ? `Linked to ${esc(short(u.wallet))}, ${PLANS[u.plan].name} plan: ${PLANS[u.plan].checks} checks a day (shared with the site), ${PLANS[u.plan].watch} tokens or wallets to watch.` : "That code is unknown or expired. Make a new one on the site: Account, Telegram.");
  }
  if (cmd === "/start" || cmd === "/help") return send(id, HELP);

  if (cmd === "/plan") {
    const a = allow(w.key, w.plan, "checks");
    return send(id, `${PLANS[w.plan].name} plan${w.linked ? "" : " (this chat is not tied to an account)"}: ${a.limit - a.used} of ${a.limit} checks left today, watching ${watching(c)} of ${PLANS[w.plan].watch}.\n${SITE}/?account`);
  }

  if (cmd === "/rings") {
    c.rings = arg.toLowerCase() !== "off";
    save();
    return send(id, c.rings ? "Ring feed on: you will get every ring buy and ring-playbook launch the watch sees." : "Ring feed off.");
  }

  if (cmd === "/check") {
    if (!isSolAddress(arg) && !isEvmToken(arg)) return send(id, "Send a token address: /check &lt;address&gt;");
    const a = allow(w.key, w.plan, "checks");
    if (!a.ok) return send(id, `That was today's ${a.limit} checks on the ${PLANS[w.plan].name} plan; they reset at 00:00 UTC. More checks: ${SITE}/?account`);
    count(w.key, "checks");
    await send(id, "Checking, this takes about a minute…");
    try {
      const r = await runCheck(arg, w.plan);
      const why = r.reasons.slice(0, 4).map((x) => `+${x.points} ${esc(x.title)}`).join("\n");
      return send(id, `${verdictLine(r)}\n${why || "No risk signals found."}\n\n<a href="${tokenLink(`${r.mint}-${r.checkedAt}`)}">Full evidence</a>  ·  /watch ${esc(r.mint)}`);
    } catch (e) {
      return send(id, `Check failed: ${esc((e as Error).message)}`);
    }
  }

  if (cmd === "/watch") {
    if (!isSolAddress(arg) && !isEvmToken(arg)) return send(id, "Send a token address: /watch &lt;address&gt;");
    if (!c.tokens[arg] && watching(c) >= PLANS[w.plan].watch) return send(id, `The ${PLANS[w.plan].name} plan watches ${PLANS[w.plan].watch} token(s) or wallet(s) at a time; /unwatch one first, or get more: ${SITE}/?account`);
    const all = new Set(Object.values(state.chats).flatMap((x) => Object.keys(x.tokens)));
    if (!all.has(arg) && all.size >= TOKENS_TOTAL) return send(id, "The watch is full right now, try later.");
    let ch = newestCheck(arg);
    if (!ch?.clusterHold) {
      await send(id, "No recent check of this token, running one first…");
      try {
        const r = await runCheck(arg, w.plan);
        ch = loadCheck(`${r.mint}-${r.checkedAt}`) ?? r;
      } catch (e) {
        return send(id, `Check failed: ${esc((e as Error).message)}`);
      }
    }
    const start = Object.values((ch.clusterHold ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
    c.tokens[ch.mint] = { check: `${ch.mint}-${ch.checkedAt}`, chain: ch.chain ?? "solana", symbol: ch.symbol, start, held: start, alertedAt: 0 };
    save();
    return send(id, `Watching <b>${esc(ch.symbol)}</b>. ${start > 0 ? `The developer's wallets held ${fmtAmount(start)} at the check; I will message you as they sell.` : "The developer's wallets held none at the check, so I will only pass on ring alerts for it."}\n<a href="${tokenLink(`${ch.mint}-${ch.checkedAt}`)}">Check</a>`);
  }

  if (cmd === "/wallet") {
    const chain = isSolAddress(arg) ? "solana" : /^0x[0-9a-fA-F]{40}$/.test(arg) ? (arg2.toLowerCase() || "ethereum") : "";
    if (!chain || (chain !== "solana" && !EVM_CHAINS[chain])) return send(id, `Send a wallet: /wallet &lt;address&gt; [${Object.keys(EVM_CHAINS).join("|")}]`);
    const addr = chain === "solana" ? arg : arg.toLowerCase();
    if (!c.wallets[addr] && watching(c) >= PLANS[w.plan].watch) return send(id, `The ${PLANS[w.plan].name} plan watches ${PLANS[w.plan].watch} token(s) or wallet(s) at a time; /unwatch one first, or get more: ${SITE}/?account`);
    c.wallets[addr] = { chain, last: await latestOf(addr, chain).catch(() => null) };
    save();
    return send(id, `Watching ${esc(short(addr))} on ${chain}. I will message you when money leaves it.`);
  }

  if (cmd === "/unwatch") {
    const key = Object.keys(c.tokens).find((k) => k.toLowerCase() === arg.toLowerCase()) ?? Object.keys(c.wallets).find((k) => k.toLowerCase() === arg.toLowerCase());
    if (!key) return send(id, "Not watching that. /list shows what you watch.");
    delete c.tokens[key];
    delete c.wallets[key];
    save();
    return send(id, `Stopped watching ${esc(short(key))}.`);
  }

  if (cmd === "/list") {
    const t = Object.entries(c.tokens).map(([m, w]) => `token <b>${esc(w.symbol)}</b> ${esc(short(m))}: developer wallets ${fmtAmount(w.held)} of ${fmtAmount(w.start)}`);
    const w = Object.entries(c.wallets).map(([a, x]) => `wallet ${esc(short(a))} on ${x.chain}`);
    return send(id, [...t, ...w].join("\n") || "Nothing watched. /watch &lt;token&gt; or /wallet &lt;address&gt;.");
  }

  return send(id, HELP);
}

async function heldNow(w: TokenWatch, mint: string): Promise<number | null> {
  return clusterHeld(w.chain, mint, Object.keys(loadCheck(w.check)?.clusterHold ?? {}));
}

async function pollTokens() {
  const byMint = new Map<string, [string, TokenWatch][]>();
  for (const [id, c] of Object.entries(state.chats)) for (const [m, w] of Object.entries(c.tokens)) byMint.set(m, [...(byMint.get(m) ?? []), [id, w]]);
  for (const [mint, watchers] of byMint) {
    const first = watchers[0][1];
    if (first.start <= 0) continue;
    if (first.chain === "solana" && !allowed("watch").ok) return log("token poll skipped: the day's credit budget is near its end");
    const now = await heldNow(first, mint).catch(() => null);
    if (now === null) continue;
    for (const [id, w] of watchers) {
      // Bought back: the next sale counts from the new level. Small sales add up until they reach a step.
      if (now >= w.held) {
        w.held = now;
        continue;
      }
      if ((w.held - now) / w.start < SOLD_STEP) continue;
      w.held = now;
      const pool = await poolOf(w.chain, mint).catch(() => null);
      w.alertedAt = Math.floor(Date.now() / 1000);
      await send(id, `<b>${esc(w.symbol)}</b>: the developer's wallets sold. They hold ${fmtAmount(now)}, down from ${fmtAmount(w.start)} at the check (${Math.round((1 - now / w.start) * 100)}% gone).${pool?.fdv ? ` FDV now $${fmtAmount(pool.fdv)}.` : ""}\n<a href="${tokenLink(w.check)}">Check</a>`);
    }
  }
  save();
}

// Newest transaction id of a wallet, to notice the next one
async function latestOf(addr: string, chain: string): Promise<string | null> {
  if (chain === "solana") return (await helius().rpc("getSignaturesForAddress", [addr, { limit: 1 }]))?.[0]?.signature ?? null;
  const outs = await evmAdapter(chain).outflows(addr, 20);
  return outs.sort((a, b) => b.ts - a.ts)[0]?.hash ?? null;
}

async function pollWallets() {
  for (const [id, c] of Object.entries(state.chats)) {
    for (const [addr, w] of Object.entries(c.wallets)) {
      if (w.chain === "solana" && !allowed("watch").ok) continue;
      try {
        let moved: string[] = [];
        let newest: string | null = w.last;
        if (w.chain === "solana") {
          const sigs: any[] = await helius().rpc("getSignaturesForAddress", [addr, { limit: 10 }]);
          const fresh = w.last ? sigs.slice(0, Math.max(0, sigs.findIndex((s) => s.signature === w.last))) : [];
          newest = sigs[0]?.signature ?? w.last;
          if (w.last && sigs.length && sigs.findIndex((s) => s.signature === w.last) < 0) fresh.push(...sigs); // more than 10 since the last look
          if (fresh.length) {
            const outs = (await solanaAdapter().outflows(addr, 20)).filter((t) => fresh.some((s) => s.signature === t.hash));
            moved = outs.map((t) => `${fmtAmount(t.amount)} ${esc(t.asset)} to ${esc(short(t.to))}`);
          }
        } else {
          const outs = (await evmAdapter(w.chain).outflows(addr, 20)).sort((a, b) => b.ts - a.ts);
          const k = outs.findIndex((t) => t.hash === w.last);
          const fresh = w.last ? (k < 0 ? outs : outs.slice(0, k)) : [];
          newest = outs[0]?.hash ?? w.last;
          moved = fresh.map((t) => `${fmtAmount(t.amount)} ${esc(t.asset)} to ${esc(short(t.to))}`);
        }
        w.last = newest;
        if (!moved.length) continue;
        const nowSec = Math.floor(Date.now() / 1000);
        if ((w.quietUntil ?? 0) > nowSec) {
          w.held = (w.held ?? 0) + moved.length;
          continue;
        }
        const extra = Math.max(0, moved.length - 8) + (w.held ?? 0);
        w.quietUntil = nowSec + WALLET_QUIET_MIN * 60;
        w.held = 0;
        await send(id, `Money left ${esc(short(addr))} (${w.chain}):\n${moved.slice(0, 8).join("\n")}${extra > 0 ? `\n…and ${extra} more move(s), including those since the last message` : ""}\n<a href="${w.chain === "solana" ? `https://solscan.io/account/${addr}` : `${EVM_CHAINS[w.chain].explorer}/address/${addr}`}">Explorer</a>  ·  trace it on ${SITE}`);
      } catch (e) {
        log(`wallet ${short(addr)}: ${(e as Error).message}`);
      }
    }
  }
  save();
}

// New lines in data/alerts.jsonl go to the ring feed and to whoever watches that token
async function relayAlerts() {
  const all = loadAlerts(100000).reverse(); // oldest first
  if (state.alertsSeen < 0) state.alertsSeen = all.length; // first run: do not replay history
  const fresh: Alert[] = all.slice(state.alertsSeen);
  state.alertsSeen = all.length;
  save();
  for (const a of fresh) {
    const text = `${a.kind === "ring_buy" ? "Pump ring buying" : "Ring playbook launch"}: ${esc(short(a.mint))}\n${esc(a.detail)}${a.risk !== undefined ? `\nRisk ${a.risk}/100` : ""}${a.check ? `\n<a href="${tokenLink(a.check)}">Check</a>` : ""}\n<a href="${SITE}/?ring=${encodeURIComponent(a.ring)}">The ring</a>`;
    for (const [id, c] of Object.entries(state.chats)) if (c.rings || c.tokens[a.mint]) await send(id, text);
  }
}

export async function runBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    log("TELEGRAM_BOT_TOKEN is not set; the bot stays idle");
    setInterval(() => {}, 1 << 30);
    return;
  }
  const me = await tg("getMe", {});
  log(`bot @${me.username} up, ${Object.keys(state.chats).length} chats`);
  await tg("setMyCommands", { commands: [
    { command: "check", description: "Risk verdict for a token" },
    { command: "watch", description: "Alert when the developer sells" },
    { command: "wallet", description: "Alert when money leaves a wallet" },
    { command: "rings", description: "Live pump ring feed (on/off)" },
    { command: "list", description: "What you watch" },
  ] }).catch(() => {});

  const tick = async () => {
    for (const f of [relayAlerts, pollTokens, pollWallets]) await f().catch((e) => log(`${f.name}: ${e.message}`));
  };
  setInterval(() => void tick(), POLL_MIN * 60_000);
  setInterval(() => void relayAlerts().catch(() => {}), 30_000);
  void tick();

  // Commands one at a time: a check takes a minute, and the next person waits in line
  for (;;) {
    try {
      const ups: any[] = await tg("getUpdates", { offset: state.offset, timeout: 30, allowed_updates: ["message"] }, 40_000);
      for (const u of ups) {
        state.offset = u.update_id + 1;
        save();
        const m = u.message;
        if (m?.text?.startsWith("/")) await onCommand(m.chat.id, m.text).catch((e) => log(`command: ${e.message}`));
      }
    } catch (e) {
      log(`updates: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
