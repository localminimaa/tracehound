import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}

// Before anything reads data/: a fresh install gets the demo set
(await import("./seed.ts")).seed();
const { investigate } = await import("./engine.ts");
const { listCases, loadCase, recentCase, saveCase, listChecks, loadCheck, recentCheck } = await import("./store.ts");
const { checkToken } = await import("./tokencheck.ts");
const { lifeOf, poolOf } = await import("./tokenextra.ts");
const { priceEdges } = await import("./prices.ts");
const { caseBrief, tokenBrief } = await import("./brief.ts");
const { tokenImage } = await import("./images.ts");
const { loadRings } = await import("./rings.ts");
const { signalOf, signalStats } = await import("./signals.ts");
const auth = await import("./auth.ts");
const pay = await import("./payments.ts");

// The tags link previews read: a case or a token check gets its own title, line and picture, anything else the site's
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function ogMeta(req: any, url: URL) {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${TRUST_PROXY || req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host}`;
  let title = "Tracehound", desc = "Paste a hacker's address or an exploit tx. Get the money trail, who funded it and the wallets tied to it, every link a transaction you can open.", img = `${base}/og/site.png`;
  const caseId = url.searchParams.get("case"), checkId = url.searchParams.get("token");
  const c = caseId ? loadCase(caseId) : null;
  const k = !c && checkId ? loadCheck(checkId) : null;
  if (c) {
    const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
    title = lead ? lead.title : `${c.nodes.length} wallets traced`;
    desc = `Tracehound case: ${c.nodes.length} wallets, ${c.findings.length} findings across ${c.chains.join(", ")}. Every link is a transaction you can open.`;
    img = `${base}/og/case/${encodeURIComponent(c.id)}.png`;
  } else if (k) {
    title = `$${k.symbol}: risk ${k.risk}/100, ${k.verdict}`;
    desc = k.reasons?.[0]?.title ? `${k.reasons[0].title}. Token check by Tracehound.` : "Nothing suspicious found. Token check by Tracehound.";
    img = `${base}/og/check/${encodeURIComponent(checkId!)}.png`;
  }
  const page = `${base}${url.pathname}${url.search}`;
  return [
    ["og:type", "website"], ["og:site_name", "Tracehound"], ["og:title", title], ["og:description", desc], ["og:url", page], ["og:image", img],
    ["og:image:width", "1200"], ["og:image:height", "630"], ["twitter:card", "summary_large_image"], ["twitter:title", title], ["twitter:description", desc], ["twitter:image", img],
  ].map(([p, v]) => `<meta ${p.startsWith("og:") ? "property" : "name"}="${p}" content="${htmlEsc(v)}" />`).join("\n  ") + `\n  <meta name="description" content="${htmlEsc(desc)}" />`;
}

const ohlcvCache = new Map<string, { at: number; body: string }>();

// Who is asking: the signed-in account, or else the IP (behind Caddy the real one is in X-Forwarded-For)
const TRUST_PROXY = !!process.env.TRUST_PROXY;
const LIMITS = TRUST_PROXY || !!process.env.ENFORCE_LIMITS; // local development runs without daily limits
const ipOf = (req: any) => (TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
// An API key (Authorization: Bearer th_..., or x-api-key) stands for its account, the same as a signed-in browser
const apiKeyOf = (req: any) => String(req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")).trim();
function whoAsks(req: any) {
  const key = apiKeyOf(req);
  const user = key ? auth.apiUser(key) : auth.userOf(req.headers.cookie);
  return { user, who: user ? `u:${user.id}` : `ip:${ipOf(req)}`, plan: (user?.plan ?? "free") as import("./auth.ts").Plan, viaKey: !!key };
}
// Paid plans get the deep views (holder map, past launches, chart) and exports; locally everything is open
const paid = (req: any) => !LIMITS || whoAsks(req).plan !== "free";
const FREE_REUSE_SEC = 6 * 3600; // the free plan is shown a saved check up to 6 h old instead of spending credits on a new one
const upsell = (what: string) => ({ error: `${what} come with the Standard and Pro plans`, plan: "standard" });

// A new check or trace counts against the day's limit once it has a result; showing a saved one does not, and
// neither does one that failed (a mistyped address, an API down)
function overLimit(req: any, kind: "checks" | "traces"): string | null {
  if (!LIMITS) return null;
  const w = whoAsks(req);
  const a = auth.allow(w.who, w.plan, kind);
  return a.ok ? null : `daily limit reached: ${a.limit} ${kind === "checks" ? "token checks" : "traces"} a day on the ${auth.PLANS[w.plan].name} plan${w.user ? "" : " (sign in with a wallet to keep your own count)"}. It resets at 00:00 UTC.`;
}
const used = (req: any, kind: "checks" | "traces") => LIMITS && auth.count(whoAsks(req).who, kind);
const readBody = (req: any): Promise<any> =>
  new Promise((ok) => {
    let d = "";
    req.on("data", (c: Buffer) => (d += c).length > 8192 && req.destroy());
    req.on("end", () => {
      try {
        ok(JSON.parse(d));
      } catch {
        ok(null);
      }
    });
  });

// Each signal's record on the judged tokens: the same set as the accuracy table (the sampler's own picks, 24 h on)
function signalsView() {
  const out = loadOutcomes();
  const rows = firstChecks().filter((c) => c.market.fdv && out[c.mint] && out[c.mint].hours <= LATE_H)
    .map((c) => ({ titles: c.reasons.map((r) => r.title), change: out[c.mint].fdv / out[c.mint].fdvAtCheck - 1 }));
  return { horizonH: HORIZON_H, ...signalStats(rows) };
}
const { marketOf } = await import("./tokencheck.ts");

// Known pump rings for the rings page: each token's value now (DexScreener, cached 10 min) and the token checks
// of ours that caught the ring's wallets
const ringMarket = { at: 0, map: new Map<string, { fdv: number | null; liq: number | null }>() };
async function ringsView() {
  const rings = loadRings();
  const mints = [...new Set(rings.flatMap((r) => r.tokens.map((t) => t.mint)))];
  if (Date.now() - ringMarket.at > 600_000 && mints.length) {
    const mk = await marketOf(mints).catch(() => new Map());
    ringMarket.map = new Map(mints.map((m) => [m, { fdv: mk.get(m)?.fdv ?? null, liq: mk.get(m)?.liq ?? null }]));
    ringMarket.at = Date.now();
  }
  const checks = listChecks(1000).map((c) => ({ c, full: loadCheck(c.id) }));
  return rings.map((r) => {
    const ws = new Set(r.wallets);
    const caught = checks.filter(({ full }) => full?.reasons?.some((x: any) => x.addresses?.some((a: string) => ws.has(a))) || full?.holders?.some((h: any) => ws.has(h.owner)))
      .map(({ c }) => ({ id: c.id, mint: c.mint, symbol: c.symbol, chain: c.chain, risk: c.risk, verdict: c.verdict, checkedAt: c.checkedAt }));
    const tokens = r.tokens.map((t) => {
      const m = ringMarket.map.get(t.mint);
      // dead: worth almost nothing; drained: a price on paper but the pool emptied, nobody can sell
      const status = (m?.fdv ?? 0) < 15_000 ? "dead" : (m?.liq ?? 0) < 1_000 ? "drained" : "alive";
      return { ...t, fdv: m?.fdv ?? null, liq: m?.liq ?? null, dead: status !== "alive", status };
    });
    return { ...r, tokens, caught };
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}
const { label, setManualLabel, removeManualLabel, LABEL_KINDS } = await import("./labels.ts");

// Manual labels are shown over whatever the trace saw, also in cases traced before the label existed
const KIND_NODE: Record<string, string> = { cex: "cex", swap: "cex", mixer: "mixer", bridge: "bridge", hacker: "known_hacker" };
function withLabels(c: any) {
  for (const n of c.nodes) {
    const l = label(n.chain, n.addr);
    if (l?.source !== "manual") continue;
    n.label = l.name;
    if (KIND_NODE[l.kind] && n.kind !== "suspect") n.kind = KIND_NODE[l.kind];
  }
  return c;
}
const ADDR: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/, solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, bitcoin: /^(bc1[0-9a-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{24,33})$/,
};
const EVM = ["ethereum", "base", "arbitrum", "optimism", "bsc", "polygon"];
const body = (req: any): Promise<any> =>
  new Promise((ok) => {
    let d = "";
    req.on("data", (c: Buffer) => (d += c).length > 4096 && req.destroy());
    req.on("end", () => {
      try {
        ok(JSON.parse(d));
      } catch {
        ok(null);
      }
    });
  });
const { checkEvmToken, detectEvmChain, evmBalances, isEvmToken } = await import("./evmtoken.ts");
const { allowed, creditsToday, DAILY_CREDITS } = await import("./credits.ts");
const { loadAlerts } = await import("./watch.ts");
const { isSolAddress, isSolSignature } = await import("./chains/solana.ts");
// Solana work spends Helius credits; near the day's budget new runs wait until midnight UTC. The last part of the
// day is kept for paid plans, so a busy day on the free plan cannot lock paying users out.
const heliusBusy = (req: any) => {
  const paid = whoAsks(req).plan !== "free";
  const g = allowed(paid ? "web" : "free");
  if (g.ok) return null;
  return paid || !allowed("web").ok
    ? `today's Helius budget is spent (${g.reason}); Solana checks resume after midnight UTC, saved results still open`
    : "today's free Solana checks are used up; paid plans keep working until midnight UTC, saved results still open";
};
// A saved check as the asker may see it: every reason named by its signal; on the free plan the same verdict and
// reasons, while the holder map and past launches stay with paid plans
function checkFor(req: any, id: string) {
  const c = loadCheck(id);
  for (const r of c?.reasons ?? []) r.signal = signalOf(r.title);
  if (c && !paid(req) && (c.holders?.length || c.launches?.length)) {
    c.locked = { holders: c.holders?.length ?? 0, launches: c.launches?.length ?? 0, fresh: (c.holders ?? []).filter((h: any) => h.tags.includes("fresh")).length };
    delete c.holders, delete c.funders, delete c.launches;
  }
  return c;
}

// A trace for the site and the API: the same query traced recently is shown again, else a new one within the plan
async function runTrace(req: any, q: string, chain: string, log: (s: string) => void): Promise<string> {
  const cached = recentCase(q, chain);
  if (cached) {
    log(`same query traced ${Math.round((Date.now() / 1000 - cached.created) / 60)} min ago, showing that case`);
    return cached.id;
  }
  const busy = (isSolAddress(q.trim()) || isSolSignature(q.trim())) && heliusBusy(req);
  if (busy) throw new Error(busy);
  if (running >= MAX_RUNNING) throw new Error("too many investigations running, try again in a minute");
  const limit = overLimit(req, "traces");
  if (limit) throw new Error(limit);
  running++;
  try {
    const c = await investigate(q, { chain, log });
    saveCase(c);
    used(req, "traces");
    return c.id;
  } finally {
    running--;
  }
}

// A token check for the site and the API: a saved one while recent enough (longer on the free plan), else a new one
async function runTokenCheck(req: any, raw: string, fresh: boolean, log: (s: string) => void): Promise<string> {
  const mint = isEvmToken(raw.trim()) ? raw.trim().toLowerCase() : raw.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && !isEvmToken(mint)) throw new Error("this is not a Solana, Base or BSC token address");
  const deep = paid(req);
  const cached = fresh && deep ? null : recentCheck(mint, deep ? undefined : FREE_REUSE_SEC);
  if (cached) {
    const min = Math.round((Date.now() / 1000 - Number(cached.split("-").pop())) / 60);
    log(`checked ${min < 60 ? `${Math.max(1, min)} min` : `${Math.round(min / 60)} h`} ago, showing that check${deep ? "" : " (paid plans can check again any time)"}`);
    return cached;
  }
  if (running >= MAX_RUNNING) throw new Error("too many checks running, try again in a minute");
  const busy = !isEvmToken(mint) && heliusBusy(req);
  if (busy) throw new Error(busy);
  const limit = overLimit(req, "checks");
  if (limit) throw new Error(limit);
  running++;
  try {
    if (isEvmToken(mint)) {
      const chain = await detectEvmChain(mint);
      if (!chain) throw new Error("no Base or BSC token with this address has a pool or security data yet");
      const c = await checkEvmToken(mint, chain, { log });
      used(req, "checks");
      return `${c.mint}-${c.checkedAt}`;
    }
    const c = await checkToken(mint, { log, source: "web" });
    used(req, "checks");
    return `${c.mint}-${c.checkedAt}`;
  } finally {
    running--;
  }
}

const { helius } = await import("./chains/solana.ts");
const { firstChecks, loadOutcomes, recordDue, HORIZON_H, LATE_H } = await import("../scripts/outcomes.ts");
const { agentTick, agentView } = await import("./agent.ts");
const { fetchJson, limiter } = await import("./util.ts");

const PORT = Number(process.env.PORT) || 8787;
const pub = new URL("../public/", import.meta.url);
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
let running = 0;
const gecko = limiter(0.4);
const lives = new Map<string, Promise<unknown>>();
const MAX_RUNNING = 3;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  // Basic hardening on every answer: no sniffing, no framing, no referrer path to other sites, HTTPS only behind Caddy
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "frame-ancestors 'none'");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (TRUST_PROXY) res.setHeader("strict-transport-security", "max-age=31536000");

  // Live watch alerts (src/watch.ts runs as its own process), newest first
  if (url.pathname === "/api/alerts") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(loadAlerts(Number(url.searchParams.get("limit")) || 50)));
  }

  // Chains a trace can follow with the keys this server has, for the token page's trace menu
  if (url.pathname === "/api/traceable") {
    const { EVM_CHAINS, evmCovers } = await import("./chains/evm.ts");
    const evm = await Promise.all(Object.keys(EVM_CHAINS).map(async (c) => ((await evmCovers(c)) ? c : null)));
    const chains = [...evm.filter(Boolean), ...(process.env.HELIUS_API_KEY ? ["solana"] : []), "tron", "bitcoin"];
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ chains }));
  }

  // Public API for Pro accounts: plain JSON, an API key instead of the session cookie, the same limits as the site
  if (url.pathname.startsWith("/api/v1/")) {
    const out = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify(body));
    const w = whoAsks(req);
    if (!w.user) return out(401, { error: "send an API key: Authorization: Bearer th_... (make one on the account page)" });
    if (LIMITS && w.user.plan !== "pro") return out(403, { error: "the API comes with the Pro plan" });
    const path = url.pathname.slice("/api/v1/".length).split("/");
    const fail = (e: unknown) => {
      const m = (e as Error).message;
      return out(/daily limit/.test(m) ? 429 : /budget|too many/.test(m) ? 503 : /not a |no Base or BSC|paste an/i.test(m) ? 400 : 502, { error: m });
    };
    try {
      if (path[0] === "usage") return out(200, { plan: w.plan, limits: auth.PLANS[w.plan], usage: auth.usage(w.who), resets: "00:00 UTC" });
      if (path[0] === "token" && path[1]) {
        const id = await runTokenCheck(req, decodeURIComponent(path[1]), url.searchParams.has("fresh"), () => {});
        return out(200, { id, url: `/?token=${id}`, check: checkFor(req, id) });
      }
      if (path[0] === "trace") {
        const q = url.searchParams.get("q") ?? "";
        if (!q) return out(400, { error: "?q=<address or tx>" });
        const id = await runTrace(req, q, url.searchParams.get("chain") ?? "auto", () => {});
        return out(200, { id, url: `/?case=${id}`, case: loadCase(id) });
      }
      if (path[0] === "check" && path[1]) {
        const c = checkFor(req, path[1]);
        return c ? out(200, c) : out(404, { error: "no such check" });
      }
      if (path[0] === "case" && path[1]) {
        const c = loadCase(path[1]);
        return c ? out(200, c) : out(404, { error: "no such case" });
      }
      if (path[0] === "alerts") return out(200, loadAlerts(Math.min(200, Number(url.searchParams.get("limit")) || 50)));
      return out(404, { error: "endpoints: /api/v1/token/<mint>, /api/v1/trace?q=, /api/v1/check/<id>, /api/v1/case/<id>, /api/v1/alerts, /api/v1/usage" });
    } catch (e) {
      return fail(e);
    }
  }

  if (url.pathname === "/api/credits") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ heliusToday: creditsToday(), heliusDaily: DAILY_CREDITS }));
  }

  // Accounts: a wallet signs a one-time message; the session lives in an httpOnly cookie
  if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/me" || url.pathname.startsWith("/api/tg/") || url.pathname.startsWith("/api/keys")) {
    const reply = (status: number, b: unknown, headers: Record<string, string> = {}) => res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(b));
    const host = String(req.headers.host ?? "localhost");
    // Requests that change the session must come from this site
    const origin = req.headers.origin;
    if (req.method === "POST" && origin && new URL(origin).host !== host) return reply(403, { error: "cross-site request" });
    const secure = TRUST_PROXY || String(req.headers["x-forwarded-proto"] ?? "") === "https";
    if (url.pathname === "/api/auth/nonce" && req.method === "POST") {
      const b = await readBody(req);
      const r = auth.issueNonce(String(b?.wallet ?? ""), String(b?.chain ?? ""), host);
      return reply("error" in r ? 400 : 200, r);
    }
    if (url.pathname === "/api/auth/verify" && req.method === "POST") {
      const b = await readBody(req);
      const r = auth.signIn(String(b?.wallet ?? ""), String(b?.chain ?? ""), String(b?.message ?? ""), String(b?.signature ?? ""));
      if ("error" in r) return reply(401, r);
      return reply(200, { user: { wallet: r.user.wallet, chain: r.user.chain, plan: r.user.plan } }, { "set-cookie": auth.sessionCookie(r.token, secure) });
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      auth.signOut(req.headers.cookie);
      return reply(200, { ok: true }, { "set-cookie": auth.clearCookie });
    }
    // API keys: made and revoked from the account page, Pro only where plans are enforced
    if (url.pathname === "/api/keys" && req.method === "POST") {
      const u = whoAsks(req).user;
      if (!u) return reply(401, { error: "sign in first" });
      if (LIMITS && u.plan !== "pro") return reply(403, { error: "API keys come with the Pro plan" });
      const r = auth.makeApiKey(u.id, String((await readBody(req))?.name ?? ""));
      return reply("error" in r ? 400 : 200, r);
    }
    const revoke = url.pathname.match(/^\/api\/keys\/(\d+)\/revoke$/);
    if (revoke && req.method === "POST") {
      const u = whoAsks(req).user;
      if (!u) return reply(401, { error: "sign in first" });
      return reply(auth.revokeApiKey(u.id, Number(revoke[1])) ? 200 : 404, { ok: true });
    }
    // Telegram: a one-time code that ties a chat to this account, and undoing it
    if (url.pathname === "/api/tg/code" && req.method === "POST") {
      const u = whoAsks(req).user;
      if (!u) return reply(401, { error: "sign in first" });
      return reply(200, { ...auth.tgCode(u.id), bot: process.env.TELEGRAM_BOT_NAME || null });
    }
    if (url.pathname === "/api/tg/unlink" && req.method === "POST") {
      const u = whoAsks(req).user;
      if (!u) return reply(401, { error: "sign in first" });
      auth.tgUnlink(u.id);
      return reply(200, { ok: true });
    }
    if (url.pathname === "/api/me") {
      const w = whoAsks(req);
      return reply(200, {
        user: w.user ? { wallet: w.user.wallet, chain: w.user.chain, plan: w.user.plan, planUntil: w.user.plan_until } : null,
        plan: w.plan, limits: auth.PLANS[w.plan], usage: auth.usage(w.who), enforced: LIMITS, plans: auth.PLANS,
        payChains: pay.payChains(), apiKeys: w.user ? auth.apiKeys(w.user.id) : [], telegram: w.user ? { chats: auth.tgChats(w.user.id), bot: process.env.TELEGRAM_BOT_NAME || null } : null,
        payments: w.user ? pay.paymentsOf(w.user.id).map((i) => ({ plan: i.plan, days: i.days, chain: i.chain, usdc: pay.usdcText(i.amount), tx: i.tx, paid: i.paid })) : [],
      });
    }
    return reply(404, { error: "not found" });
  }

  // Payments: an invoice with a unique USDC amount; the poll finds the transfer and switches the plan on
  if (url.pathname.startsWith("/api/pay/")) {
    const reply = (status: number, b: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(b));
    const user = auth.userOf(req.headers.cookie);
    if (!user) return reply(401, { error: "sign in first" });
    const origin = req.headers.origin;
    if (req.method === "POST" && origin && new URL(origin).host !== String(req.headers.host)) return reply(403, { error: "cross-site request" });
    const view = (i: any) => ({
      id: i.id, plan: i.plan, days: i.days, chain: i.chain, usdc: pay.usdcText(i.amount), amount: i.amount, address: i.address,
      mint: pay.USDC[i.chain as keyof typeof pay.USDC].mint, expires: i.expires, status: i.status, tx: i.tx,
    });
    if (url.pathname === "/api/pay/invoice" && req.method === "POST") {
      const b = await readBody(req);
      const r = pay.createInvoice(user, b?.plan, b?.period, b?.chain);
      return "error" in r ? reply(400, r) : reply(200, view(r));
    }
    const m = url.pathname.match(/^\/api\/pay\/invoice\/([0-9a-f]{16})$/);
    if (m) {
      const i = pay.invoiceOf(m[1], user.id);
      if (!i) return reply(404, { error: "no such payment" });
      if (i.status === "open" && url.searchParams.has("check")) await pay.poll((s) => console.log(s));
      return reply(200, view(pay.invoiceOf(m[1], user.id)));
    }
    return reply(404, { error: "not found" });
  }

  if (url.pathname === "/api/investigate") {
    const q = url.searchParams.get("q") ?? "";
    const chain = url.searchParams.get("chain") ?? "auto";
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send("done", await runTrace(req, q, chain, (s) => send("log", s)));
    } catch (e) {
      send("fail", (e as Error).message);
    }
    return res.end();
  }

  // Token check streams its progress the same way an investigation does; done carries the check's id
  if (url.pathname === "/api/token") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send("done", await runTokenCheck(req, url.searchParams.get("mint") ?? "", url.searchParams.has("fresh"), (s) => send("log", s)));
    } catch (e) {
      send("fail", (e as Error).message);
    }
    return res.end();
  }

  const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

  // Peak and lifetime of a past launch, read lazily by the page row by row (GeckoTerminal allows ~30 calls a minute)
  if (url.pathname === "/api/life") {
    const mint = url.searchParams.get("mint") ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return json(400, { error: "bad mint" });
    if (!lives.has(mint)) lives.set(mint, gecko(() => lifeOf("solana", mint)).catch(() => null));
    return json(200, (await lives.get(mint)) ?? {});
  }

  // Watch: what the developer's wallets hold now compared with the check, and the value now
  if (url.pathname === "/api/watch") {
    const c = loadCheck(url.searchParams.get("id") ?? "");
    if (!c?.clusterHold) return json(404, { error: "check not found or made before watching existed" });
    const chain = c.chain ?? "solana";
    const wallets = [...new Set([...(c.dev ? [c.dev] : []), ...Object.keys(c.clusterHold)])].slice(0, 25);
    let now: Record<string, number> = {};
    if (chain !== "solana") now = await evmBalances(chain, c.mint, wallets);
    else {
      const h = helius();
      for (const w of wallets) {
        const accs: any[] = (await h.rpc("getTokenAccountsByOwner", [w, { mint: c.mint }, { encoding: "jsonParsed" }]).catch(() => null))?.value ?? [];
        now[w] = accs.reduce((s, x) => s + Number(x.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
      }
    }
    const pool = await poolOf(chain, c.mint);
    const before = Object.values(c.clusterHold as Record<string, number>).reduce((a, b) => a + b, 0);
    const after = Object.keys(c.clusterHold).reduce((a, w) => a + (now[w] ?? 0), 0);
    return json(200, { at: Math.floor(Date.now() / 1000), held: after, heldAtCheck: before, devNow: c.dev ? now[c.dev] : null, wallets: now, fdv: pool?.fdv ?? null, fdvAtCheck: c.market.fdv, supply: c.supply ?? null });
  }

  // How the verdicts held up: each token's value 24 h after its first check, per verdict group
  if (url.pathname === "/api/signals") return json(200, signalsView());
  if (url.pathname === "/api/agent") return json(200, agentView());

  if (url.pathname === "/api/accuracy") {
    const out = loadOutcomes();
    const rows = firstChecks().filter((c) => c.market.fdv && out[c.mint] && out[c.mint].hours <= LATE_H)
      .map((c) => ({ verdict: c.verdict, change: out[c.mint].fdv / out[c.mint].fdvAtCheck - 1 }));
    const groups = ["low", "medium", "high"].map((v) => {
      const ch = rows.filter((r) => r.verdict === v).map((r) => r.change).sort((a, b) => a - b);
      const n = (f: (x: number) => boolean) => ch.filter(f).length;
      return { verdict: v, n: ch.length, fell80: n((x) => x <= -0.8), halved: n((x) => x <= -0.5), grew2x: n((x) => x >= 1), median: ch.length ? ch[Math.floor(ch.length / 2)] : null };
    });
    return json(200, { horizonH: HORIZON_H, checked: firstChecks().length, judged: rows.length, groups });
  }

  if (url.pathname === "/api/tokens") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(listChecks(30)));
  }

  if (url.pathname.startsWith("/api/check/") && !url.pathname.endsWith(".md")) {
    const c = checkFor(req, url.pathname.slice("/api/check/".length));
    res.writeHead(c ? 200 : 404, { "content-type": "application/json" });
    return res.end(JSON.stringify(c ?? { error: "not found" }));
  }

  if (url.pathname === "/api/cases") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(listCases(12)));
  }

  // Add, change or remove a manual label. With LABEL_TOKEN set (a public deploy), only holders of the token may write.
  if (url.pathname === "/api/label" && req.method === "POST") {
    const reply = (status: number, b: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(b));
    // On the public site (limits on) labels are written only with the label token; locally anyone working on the repo can
    if ((LIMITS || process.env.LABEL_TOKEN) && (!process.env.LABEL_TOKEN || req.headers["x-label-token"] !== process.env.LABEL_TOKEN)) return reply(403, { error: "labels are read-only here" });
    const b = await body(req);
    const chain = String(b?.chain ?? ""), addr = String(b?.addr ?? "").trim(), name = String(b?.name ?? "").trim(), kind = String(b?.kind ?? "");
    const re = EVM.includes(chain) ? ADDR.evm : ADDR[chain];
    if (!re?.test(addr)) return reply(400, { error: "unknown chain or address" });
    if (!name) {
      removeManualLabel(chain, addr);
      return reply(200, { removed: true });
    }
    if (name.length > 60 || /[<>]/.test(name) || !LABEL_KINDS.includes(kind as any)) return reply(400, { error: "name up to 60 characters, kind one of " + LABEL_KINDS.join(", ") });
    setManualLabel(chain, addr, kind as any, name);
    return reply(200, { chain, addr, kind, name });
  }

  // Price candles for the token page's chart, fetched once for everyone and kept two minutes: GeckoTerminal's free
  // limit is per IP, and browsers asking it directly get rate-limited (and, without CORS on the 429, an error)
  if (url.pathname === "/api/ohlcv") {
    const net = url.searchParams.get("net") ?? "", pool = url.searchParams.get("pool") ?? "", tf = url.searchParams.get("tf") ?? "";
    const agg = Number(url.searchParams.get("agg")) || 1, limit = Math.min(1000, Number(url.searchParams.get("limit")) || 100);
    if (!["solana", "bsc", "base", "eth"].includes(net) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40,64}$/.test(pool) || !["minute", "hour", "day"].includes(tf)) return res.writeHead(400).end();
    const key = `${net}/${pool}/${tf}/${agg}/${limit}`;
    const hit = ohlcvCache.get(key);
    let body = hit && Date.now() - hit.at < 120_000 ? hit.body : null;
    if (!body) {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}&currency=usd&token=base`, { headers: { accept: "application/json" } }).catch(() => null);
      if (!r?.ok) return res.writeHead(r?.status === 429 ? 503 : 502, { "content-type": "application/json" }).end(JSON.stringify({ error: "chart source busy, try again in a minute" }));
      body = await r.text();
      ohlcvCache.set(key, { at: Date.now(), body });
      if (ohlcvCache.size > 500) ohlcvCache.delete(ohlcvCache.keys().next().value!);
    }
    return res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=60" }).end(body);
  }

  if (url.pathname === "/api/rings") {
    const rs = await ringsView();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(rs.map(({ wallets, funders, ...r }) => ({ ...r, nWallets: wallets.length, nFunders: funders.length }))));
  }
  if (url.pathname.startsWith("/api/ring/")) {
    const r = (await ringsView()).find((x) => x.id === url.pathname.slice("/api/ring/".length));
    res.writeHead(r ? 200 : 404, { "content-type": "application/json" });
    return res.end(JSON.stringify(r ?? { error: "not found" }));
  }

  // A token's picture, found once and cached; the metadata link comes only from our own saved check, never from the request
  if (url.pathname === "/api/img") {
    const chain = url.searchParams.get("chain") ?? "solana";
    const token = (url.searchParams.get("token") ?? "").trim();
    if (!["solana", "bsc", "base", "ethereum"].includes(chain) || !/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(token)) return res.writeHead(400).end();
    const saved = listChecks(1000).find((c) => c.mint.toLowerCase() === token.toLowerCase());
    const hint = saved ? loadCheck(saved.id)?.socials?.image : undefined;
    const img = await tokenImage(chain, token, hint);
    if (!img) return res.writeHead(404, { "cache-control": "max-age=600" }).end();
    return res.writeHead(200, { "content-type": img.type, "cache-control": "public, max-age=86400", "content-security-policy": "default-src 'none'; sandbox" }).end(img.body);
  }

  // Markdown export: the case or the token check as a file that stands on its own, every tx a link
  const md = url.pathname.match(/^\/api\/(case|check)\/([^/]+)\.md$/);
  if (md) {
    const c = md[1] === "case" ? loadCase(md[2]) : loadCheck(md[2]);
    if (!c) return res.writeHead(404).end("not found");
    // The case's write-up is read on the page by everyone; files and the token check's full write-up are paid
    if (!paid(req) && (md[1] === "check" || url.searchParams.has("download"))) return res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify(upsell("Exports")));
    const text = md[1] === "case" ? caseBrief(withLabels(c)) : tokenBrief(c);
    const file = md[1] === "case" ? `tracehound-case-${md[2]}.md` : `tracehound-${String(c.symbol).replace(/[^\w.-]/g, "") || "token"}-${md[2].slice(-10)}.md`;
    const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
    if (url.searchParams.has("download")) headers["content-disposition"] = `attachment; filename="${file}"`;
    return res.writeHead(200, headers).end(text);
  }

  if (url.pathname.startsWith("/api/case/")) {
    const c = loadCase(url.pathname.slice("/api/case/".length));
    // Cases traced before pricing existed get their USD values on first view
    if (c && !c.priced) {
      await priceEdges(c.edges).catch(() => 0);
      c.priced = true;
      saveCase(c);
    }
    res.writeHead(c ? 200 : 404, { "content-type": "application/json" });
    return res.end(JSON.stringify(c ? withLabels(c) : { error: "not found" }));
  }

  // Link previews: the picture under a shared case or check, drawn once and kept
  const ogm = url.pathname.match(/^\/og\/(case|check|site)(?:\/([^/]+))?\.png$/);
  if (ogm) {
    try {
      const og = await import("./og.ts");
      let png: Buffer | null = null;
      if (ogm[1] === "site") png = await og.ogSite();
      else if (ogm[1] === "case") {
        const c = loadCase(ogm[2] ?? "");
        if (c) png = await og.ogCase(withLabels(c));
      } else {
        const c = loadCheck(ogm[2] ?? "");
        if (c) png = await og.ogCheck({ ...c, id: ogm[2] }, await tokenImage(c.chain ?? "solana", c.mint, c.socials?.image).catch(() => null));
      }
      if (!png) return res.writeHead(404).end();
      return res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" }).end(png);
    } catch (e) {
      console.error(`og: ${(e as Error).message}`);
      return res.writeHead(500).end();
    }
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (file.includes("..")) return res.writeHead(400).end();
  if (file === "index.html") {
    const html = (await readFile(new URL(file, pub), "utf8")).replace("<!--og-->", ogMeta(req, url));
    return res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache" }).end(html);
  }
  try {
    const body = await readFile(new URL(file, pub));
    // Revalidate every load so a redeploy is picked up without a hard refresh
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`tracehound on http://localhost:${PORT}`));
// Which EVM chains the key covers is probed once at start, so the first visitor's trace menu does not wait for it
setTimeout(() => import("./chains/evm.ts").then(({ EVM_CHAINS, evmCovers }) => Promise.all(Object.keys(EVM_CHAINS).map((c) => evmCovers(c)))).catch(() => {}), 3000);

// Outcomes for the accuracy table: every hour, tokens checked 24 h ago get their value recorded (DexScreener, free).
// SAMPLE_EVERY_H also checks SAMPLE_N fresh tokens on that schedule to grow the sample (Helius credits).
const sampleEvery = Number(process.env.SAMPLE_EVERY_H) || 0;
let lastSample = 0;
async function collect() {
  const n = await recordDue().catch(() => 0);
  if (n) console.log(`recorded the ${HORIZON_H} h outcome of ${n} token(s)`);
  await agentTick().catch((e) => console.error(`agent: ${e.message}`));
  if (!sampleEvery || !process.env.HELIUS_API_KEY || Date.now() - lastSample < sampleEvery * 3600_000 || running >= MAX_RUNNING || !allowed("sample").ok) return;
  lastSample = Date.now();
  const fresh: any[] = await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1").catch(() => []);
  const seen = new Set(firstChecks().map((c) => c.mint));
  const mints = [...new Set(fresh.filter((t) => t.chainId === "solana").map((t) => t.tokenAddress as string))].filter((m) => !seen.has(m)).slice(0, Number(process.env.SAMPLE_N) || 5);
  for (const m of mints) {
    running++;
    await checkToken(m, { source: "sample" }).then((c) => console.log(`sampled ${c.symbol} ${c.verdict} ${c.risk}`), () => {}).finally(() => running--);
  }
}
setInterval(collect, 3600_000);
setTimeout(collect, 10_000);
