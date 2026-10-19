const $ = (id) => document.getElementById(id);
const EXPLORER = {
  ethereum: "https://etherscan.io", base: "https://basescan.org", arbitrum: "https://arbiscan.io",
  optimism: "https://optimistic.etherscan.io", bsc: "https://bscscan.com", polygon: "https://polygonscan.com",
};
// Non-EVM chains: [address, tx] url prefixes. Chains reached through THORChain are listed even if not traced.
const OTHER = {
  solana: ["https://solscan.io/account/", "https://solscan.io/tx/"],
  tron: ["https://tronscan.org/#/address/", "https://tronscan.org/#/transaction/"],
  bitcoin: ["https://mempool.space/address/", "https://mempool.space/tx/"],
  litecoin: ["https://blockchair.com/litecoin/address/", "https://blockchair.com/litecoin/transaction/"],
  "bitcoin-cash": ["https://blockchair.com/bitcoin-cash/address/", "https://blockchair.com/bitcoin-cash/transaction/"],
  dogecoin: ["https://blockchair.com/dogecoin/address/", "https://blockchair.com/dogecoin/transaction/"],
  zcash: ["https://blockchair.com/zcash/address/", "https://blockchair.com/zcash/transaction/"],
  avalanche: ["https://snowtrace.io/address/", "https://snowtrace.io/tx/"],
  xrp: ["https://xrpscan.com/account/", "https://xrpscan.com/tx/"],
  cosmos: ["https://www.mintscan.io/cosmos/address/", "https://www.mintscan.io/cosmos/tx/"],
  thorchain: ["https://runescan.io/address/", "https://runescan.io/tx/"],
};
const txUrl = (chain, h) => (OTHER[chain] ? OTHER[chain][1] + h : `${EXPLORER[chain]}/tx/${h}`);
const addrUrl = (chain, a) => (OTHER[chain] ? OTHER[chain][0] + a : `${EXPLORER[chain]}/address/${a}`);
const arkham = (a) => `https://intel.arkm.com/explorer/address/${a}`;
const short = (s) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n === 0 ? "0" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n >= 1 ? n.toFixed(2) : n.toPrecision(2));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Node colours: red is the attacker's side, amber the funding, cool tones the services money exits through
const KINDS = {
  suspect: ["#ff5d6c", "suspect"], attack_contract: ["#ff8a65", "attack contract"], known_hacker: ["#ff4fa3", "labeled exploiter"],
  funder: ["#ffb547", "funder"], sibling: ["#e9c98a", "sibling wallet"], cex: ["#6ea8ff", "exchange"], deposit: ["#9cc2ff", "deposit address"],
  mixer: ["#b48cff", "mixer"], bridge: ["#4fd1e0", "bridge"], hub: ["#7f8ba3", "busy wallet"],
  contract: ["#4a5878", "contract"], wallet: ["#a6b0c3", "wallet"],
};
for (const k of Object.values(KINDS)) k[1] = t(k[1]);
// Each chain keeps one colour across pills, graph tags and lists
const CHAINS = {
  ethereum: ["#8c9eff", "Ethereum"], base: ["#3b7bff", "Base"], arbitrum: ["#35a7f0", "Arbitrum"], optimism: ["#ff4d5e", "Optimism"],
  bsc: ["#f0b90b", "BSC"], polygon: ["#9b6dff", "Polygon"], solana: ["#2fe3a6", "Solana"], tron: ["#ff3b3b", "Tron"],
  bitcoin: ["#f7931a", "Bitcoin"], litecoin: ["#a6b4c8", "Litecoin"], dogecoin: ["#c9a43a", "Dogecoin"], "bitcoin-cash": ["#4cc47a", "BCH"],
  avalanche: ["#e84142", "Avalanche"], xrp: ["#cfd6e4", "XRP"], zcash: ["#e5b85c", "Zcash"], cosmos: ["#8d92c9", "Cosmos"], thorchain: ["#33e0c0", "THORChain"],
};
const TRACED = ["ethereum", "base", "arbitrum", "optimism", "bsc", "polygon", "solana", "tron", "bitcoin"];
const EXIT_ONLY = ["litecoin", "dogecoin", "bitcoin-cash", "avalanche", "xrp"];
// Chain marks: a simplified logo on the chain's own colour, drawn here so they stay crisp at 14 px
const W = 'fill="#fff"';
const CHAIN_GLYPH = {
  ethereum: ["#627eea", `<path ${W} d="M12 4.5 7.6 12 12 14.6 16.4 12z" opacity=".95"/><path ${W} d="M12 15.5 7.6 12.9 12 19.5l4.4-6.6z" opacity=".75"/>`],
  base: ["#0052ff", `<path ${W} d="M12 6.2a5.8 5.8 0 1 1-5.77 6.36h7.62v-1.12H6.23A5.8 5.8 0 0 1 12 6.2z"/>`],
  arbitrum: ["#213147", `<path fill="#28a0f0" d="m12 5 5.6 9.7-1.5.9L12 8.4l-4.1 7.2-1.5-.9z"/><path ${W} d="m9 17.6 3-5.2 3 5.2-1.4.8L12 15.6l-1.6 2.8z"/>`],
  optimism: ["#ff0420", `<text x="12" y="15.4" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="8.2" ${W}>OP</text>`],
  bsc: ["#f0b90b", `<path ${W} d="m12 6.3 1.9 1.9L12 10.1l-1.9-1.9zm-3.8 3.8 1.9 1.9-1.9 1.9-1.9-1.9zm7.6 0 1.9 1.9-1.9 1.9-1.9-1.9zM12 10.1l1.9 1.9-1.9 1.9-1.9-1.9zm0 3.8 1.9 1.9L12 17.7l-1.9-1.9z"/>`],
  polygon: ["#8247e5", `<path fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" d="M8.6 9.6 11 8.2l2.4 1.4v2.8L11 13.8l-2.4-1.4zm4.8 2.8 2.4-1.4 2.4 1.4v2.8l-2.4 1.4-2.4-1.4z" transform="translate(-1.6 .3)"/>`],
  solana: ["#12131c", `<defs><linearGradient id="solg" x1="0" x2="1"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><path fill="url(#solg)" d="M8.3 7.4h9l-1.6 1.7h-9zm0 8h9l-1.6 1.7h-9zM6.7 11.4h9l1.6 1.7h-9z"/>`],
  tron: ["#ff060a", `<path fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="m6.5 7 11 2.4-6.4 8.6zm0 0 4.6 11m6.4-8.6-6.4 2"/>`],
  bitcoin: ["#f7931a", `<text x="12.2" y="16.4" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="12" ${W} transform="rotate(12 12 12)">₿</text>`],
  litecoin: ["#345d9d", `<text x="12" y="16.3" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11.5" ${W}>Ł</text>`],
  dogecoin: ["#c2a633", `<text x="12" y="16.3" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11.5" ${W}>Ð</text>`],
  "bitcoin-cash": ["#0ac18e", `<text x="12.2" y="16.4" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="12" ${W} transform="rotate(-12 12 12)">₿</text>`],
  avalanche: ["#e84142", `<path ${W} d="M11.2 6.6a.9.9 0 0 1 1.6 0l4.4 8.4a.9.9 0 0 1-.8 1.3h-3.3l-1.7-3zm-1.9 4.2 2.2 3.8-1 1.7H7.6a.9.9 0 0 1-.8-1.3z"/>`],
  xrp: ["#23292f", `<path fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" d="m7.5 7.5 2.6 2.6a2.7 2.7 0 0 0 3.8 0l2.6-2.6m-9 9 2.6-2.6a2.7 2.7 0 0 1 3.8 0l2.6 2.6"/>`],
  zcash: ["#f4b728", `<text x="12" y="16.2" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="#231f20">Z</text>`],
  cosmos: ["#2e3148", `<circle cx="12" cy="12" r="1.6" ${W}/><ellipse cx="12" cy="12" rx="5.6" ry="2.2" fill="none" stroke="#fff" stroke-width="1" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="5.6" ry="2.2" fill="none" stroke="#fff" stroke-width="1" transform="rotate(-60 12 12)"/>`],
  thorchain: ["#0e1d1d", `<path fill="#33e0c0" d="M13.5 5.5 7.5 13h4l-1 5.5 6-7.5h-4z"/>`],
};
const chainIcon = (ch, size = "1.05em") => {
  const [bg, glyph] = CHAIN_GLYPH[ch] ?? [CHAINS[ch]?.[0] ?? "#8c96aa", ""];
  return `<svg class="ci" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="${bg}" stroke="#ffffff26"/>${glyph}</svg>`;
};
const chainName = (ch) => `<span class="cn">${chainIcon(ch)}${esc(CHAINS[ch]?.[1] ?? ch)}</span>`;
const kv = (k, v, cls = "") => `<div class="kv ${cls}"><span>${k}</span><b>${v}</b></div>`;
const route = (chains) => chains.map(chainName).join(`<span class="arrow">→</span>`);
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(LANG === "zh" ? "、" : ", ")}${t(" and ")}${xs[xs.length - 1]}`);
const plural = (n, one, many = `${one}s`) => `${n}${LANG === "zh" ? "" : " "}${pluralWord(n, one, many)}`;
const ago = (s0) => {
  const s = Date.now() / 1000 - s0;
  return s < 3600 ? t("{n} min ago", { n: Math.max(1, Math.round(s / 60)) }) : s < 86400 ? t("{n} h ago", { n: Math.round(s / 3600) }) : new Date(s0 * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
};

let es, timer, cy, preview, current;

// Home shows the search big in the hero; a case moves it into the top bar
function mode(m) {
  document.body.className = m;
  $("hero").hidden = m !== "home";
  $("app").hidden = m !== "case";
  $("tok").hidden = m !== "tokens";
  $("methodPage").hidden = m !== "method";
  $("ringsPage").hidden = m !== "rings";
  $("agentPage").hidden = m !== "agent";
  $("accountPage").hidden = m !== "account";
  (m === "home" ? $("heroSearch") : $("topSearch")).append($("form"));
  // The section in the nav that this page belongs to, top and bottom bars
  const sec = { home: "home", case: "home", tokens: "tokens", rings: "rings", agent: "agent", method: "method", account: "account" }[m];
  for (const a of document.querySelectorAll(".nav a, .bnav [data-go]")) a.classList.toggle("on", navOf(a) === sec);
  $("bmore").classList.toggle("on", ["rings", "method"].includes(sec));
  $("bmenu").hidden = true;
  // A new page slides in: its blocks rise one after another (a repeat call on the same page does not replay it)
  // (on <html>: code elsewhere compares body's class to the page name)
  const root = document.documentElement;
  if (m !== lastMode) {
    const cls = m === "case" ? "enter-case" : "enter";
    root.classList.remove("enter", "enter-case");
    void root.offsetWidth;
    root.classList.add(cls);
    clearTimeout(enterT);
    enterT = setTimeout(() => root.classList.remove(cls), 1100);
  }
  lastMode = m;
  slideInd(document.querySelector(".nav"), ".nav a.on", "nav-ind");
}

// A marker that glides to the active item of a bar instead of jumping (the nav, the side panel's tabs)
function slideInd(bar, sel, cls) {
  if (!bar) return;
  let ind = bar.querySelector(`:scope > .${cls}`);
  if (!ind) {
    ind = document.createElement("i");
    ind.className = cls;
    bar.append(ind);
  }
  const on = bar.querySelector(sel);
  ind.style.opacity = on ? 1 : 0;
  if (!on) return;
  ind.style.left = `${on.offsetLeft}px`;
  ind.style.width = `${on.offsetWidth}px`;
  if (cls === "tab-ind") {
    ind.style.top = `${on.offsetTop}px`;
    ind.style.height = `${on.offsetHeight}px`;
  }
}
addEventListener("resize", () => slideInd(document.querySelector(".nav"), ".nav a.on", "nav-ind"));
document.fonts?.ready.then(() => slideInd(document.querySelector(".nav"), ".nav a.on", "nav-ind"));
let lastMode = "", enterT;
const navOf = (a) => a.dataset.go ?? ({ "/": "home", "/?tokens": "tokens", "/?rings": "rings", "/?agent": "agent", "/#cases": "cases", "/?method": "method", "/?account": "account" })[a.getAttribute("href")];

function tab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  requestAnimationFrame(() => slideInd(document.querySelector("#app .tabs"), "button.on", "tab-ind"));
  for (const p of ["overview", "findings", "flows", "report"]) $(p).hidden = name !== p;
  $("logpane").hidden = name !== "log";
}

// The token page's trace menu: every wallet the check found worth following, traced on the token's chain
let traceable = null;
function traceTargets(c) {
  const out = [], seen = new Set();
  const add = (addr, what) => addr && !seen.has(addr) && (seen.add(addr), out.push({ addr, what }));
  add(c.dev, "Developer");
  add(c.devFunder, "Who funded the developer");
  for (const w of (c.cluster ?? []).filter((w) => w !== c.dev).slice(0, 4)) add(w, "Developer's other wallet");
  for (const f of (c.funders ?? []).slice(0, 2)) add(f.address, f.holders.length > 1 ? t("Funded {n} top holders", { n: f.holders.length }) : "Funded a top holder");
  for (const h of (c.holders ?? []).slice(0, 5)) add(h.owner, t("Top holder · {pct}%", { pct: h.pct.toFixed(1) }));
  return out;
}
async function traceMenu(c, chain) {
  const list = traceTargets(c);
  traceable ??= fetch("/api/traceable").then((r) => r.json()).then((j) => j.chains).catch(() => []);
  const ok = (await traceable).includes(chain);
  if (!$("traceL")) return;
  $("traceL").innerHTML = (!ok ? `<p class="tm-n">${t("Tracing on {chain} needs a paid Etherscan plan on this server.", { chain: esc(CHAINS[chain]?.[1] ?? chain) })}</p>` : "")
    + (list.length ? list.map((t) => `<button data-trace="${esc(t.addr)}" ${ok ? "" : "disabled"}><span>${esc(t.what)}</span><code>${esc(short(t.addr))}</code></button>`).join("") : `<p class="tm-n">The check found no wallet to follow.</p>`)
    + `<p class="tm-n">Follows where that wallet's money went: exchanges, bridges, mixers, other wallets.</p>`;
  for (const b of $("traceL").querySelectorAll("[data-trace]")) b.onclick = () => {
    $("traceM").open = false;
    $("q").value = b.dataset.trace;
    $("chain").value = chain;
    history.pushState(null, "", "/");
    start(b.dataset.trace);
    scrollTo(0, 0);
  };
}

// The steps of a running trace or token check, lit as the log reaches them, the hound sniffing beside them.
// A step the log passed without touching is greyed out: it had nothing to do for this query.
const TRACE_STEPS = [
  [/looking it up|^found on|^active on|tx signed by|tx sent by|largest input/, "Finding the wallet"],
  [/funding trail of/, "Funding: where its first money came from"],
  [/other wallets funded by/, "Siblings: wallets the same funder topped up"],
  [/following the money/, "Outflows: where the money went"],
  [/⇢/, "Bridges: followed to the other chain", true],
  [/^priced /, "Prices at the time of each flow"],
];
const CHECK_STEPS = [
  [/^token /, "Token and supply"],
  [/^launched|no history for this mint/, "Launch and developer"],
  [/^dev funded|developer's first funding/, "Developer's funding"],
  [/other launches/, "Past launches of the developer's circle"],
  [/bought within|early buyer|developer kept/, "Snipers and early buyers"],
  [/top-10 wallets hold|top holder|holders got their first money/, "Holders"],
  [/^last \d+ trades/, "Trading"],
  [/^liquidity:/, "Liquidity"],
  [/^risk \d+\/100/, "Score"],
];
function stepper(el, steps) {
  el.innerHTML = `<div class="sniff" aria-hidden="true"><i class="sh"><b></b></i><span class="scent">${"<i></i>".repeat(5)}</span></div>
    <div class="steps-w"><ol class="steps">${steps.map(([, label]) => `<li>${esc(t(label))}</li>`).join("")}</ol><div class="step-l"></div></div>`;
  const lis = [...el.querySelectorAll("li")];
  const hit = new Set();
  let at = 0;
  const draw = () => lis.forEach((li, j) => (li.className = j === at ? "on" : j < at || hit.has(j) ? (hit.has(j) ? "done" : "skip") : ""));
  draw();
  return (line) => {
    const s = String(line).trim();
    el.querySelector(".step-l").textContent = s.length > 90 ? `${s.slice(0, 89)}…` : s;
    const i = steps.findIndex(([re]) => re.test(s));
    if (i < 0) return;
    hit.add(i);
    if (!steps[i][2] && i > at) sfx("step");
    if (!steps[i][2]) at = Math.max(at, i);
    draw();
  };
}

function start(q) {
  es?.close();
  clearInterval(timer);
  mode("case");
  cy?.destroy();
  cy = null;
  $("caseQ").textContent = q;
  $("route").innerHTML = "";
  $("stats").innerHTML = "";
  $("shareCase").hidden = true;
  $("node").hidden = true;
  $("legend").innerHTML = "";
  for (const p of ["overview", "findings", "flows"]) $(p).innerHTML = `<p class="empty">Appears when the trace is done.</p>`;
  $("nF").textContent = $("nE").textContent = "";
  $("report").innerHTML = "";
  $("log").textContent = "";
  $("wait").hidden = false;
  $("go").disabled = true;
  tab("log");
  const t0 = Date.now();
  timer = setInterval(() => ($("timer").textContent = `${Math.round((Date.now() - t0) / 1000)}s`), 500);

  const p = new URLSearchParams({ q, chain: $("chain").value, lang: LANG });
  es = new EventSource(`/api/investigate?${p}`);
  const step = stepper($("waitSteps"), TRACE_STEPS);
  buddy("sniff");
  const line = (s) => {
    step(s);
    $("log").textContent += `${s}\n`;
    $("logpane").scrollTop = 1e9;
  };
  es.addEventListener("log", (e) => line(JSON.parse(e.data)));
  es.addEventListener("done", async (e) => {
    finish();
    const id = JSON.parse(e.data);
    history.pushState(null, "", `?case=${id}`);
    const c = await show(id);
    if (c) reactCase(c);
  });
  es.addEventListener("fail", (e) => {
    line(`✖ ${JSON.parse(e.data)}`);
    finish();
  });
  es.onerror = () => finish();
}

function finish() {
  if (buddyState === "sniff") buddy("idle");
  es?.close();
  clearInterval(timer);
  $("wait").hidden = true;
  $("go").disabled = false;
}

// JSON from our API; a network failure or a broken answer comes back as { error } instead of throwing
const getJson = (url) => fetch(url).then((r) => r.json()).catch(() => ({ error: "network" }));

async function show(id) {
  const c = await getJson(`/api/case/${id}`);
  if (c.error) {
    buddy("idle", c.error === "network" ? t("No connection, try again") : t("Case not found"), 3500);
    return home();
  }
  current = c;
  $("shareCase").hidden = false;
  mode("case");
  $("caseQ").textContent = c.query;
  $("route").innerHTML = route(c.chains);
  $("log").textContent = c.log.join("\n");
  const out = movedOut(c);
  $("stats").innerHTML = kv("Wallets", c.nodes.length) + (out ? kv("Moved out", `$${fmt(out)}`) : kv("Flows", c.edges.length)) + kv("Findings", c.findings.length) + kv("Traced in", `${Math.round(c.durationMs / 1000)}s`);
  cy?.destroy();
  view.expanded.clear();
  graphTools();
  timeline(false);
  cy = drawGraph(c, $("graph"), true);
  drawOverview(c);
  drawFindings(c);
  drawFlows(c);
  drawReport(c);
  tab("overview");
  return c;
}

const nodeLabel = (n, c) => {
  const named = (n.label ?? "").toLowerCase().includes(n.chain);
  const tag = c.chains.length > 1 && n.chain !== c.chains[0] && !named ? ` · ${(CHAINS[n.chain]?.[1] ?? n.chain).toUpperCase()}` : "";
  return n.label ? `${n.label}${tag}\n${short(n.addr)}` : `${short(n.addr)}${tag}`;
};

// Small line icons drawn inside each node, one per kind of wallet (Arkham shows entity logos there)
const ICON_PATHS = {
  wallet: '<rect x="4" y="7" width="16" height="11" rx="2"/><path d="M15 12.5h2"/><path d="M6 7l9-3 1 3"/>',
  suspect: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  attack_contract: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>',
  known_hacker: '<path d="M12 3l8 4v5c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  funder: '<path d="M12 20V6M7 11l5-5 5 5"/>',
  sibling: '<circle cx="9" cy="10" r="3"/><circle cx="16" cy="10" r="3"/><path d="M4 19c1-3 3-4 5-4s4 1 5 4M12 19c1-3 2-4 4-4s3.5 1 4 4"/>',
  cex: '<path d="M4 10l8-5 8 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 19h18"/>',
  deposit: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  mixer: '<path d="M4 7h4l8 10h4M4 17h4l2.5-3M14 10l2-3h4M18 5l2 2-2 2M18 15l2 2-2 2"/>',
  bridge: '<path d="M3 16h18M5 16v-3a7 7 0 0 1 14 0v3M9 16v-3M15 16v-3"/>',
  hub: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="6" r="1.5"/><circle cx="5" cy="18" r="1.5"/><circle cx="19" cy="18" r="1.5"/><path d="M6.2 7l4 3.5M17.8 7l-4 3.5M6.2 17l4-3.5M17.8 17l-4-3.5"/>',
  contract: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4M10 12h5M10 16h5"/>',
  group: '<rect x="3" y="4" width="10" height="7" rx="1.5"/><rect x="11" y="9" width="10" height="7" rx="1.5"/><rect x="5" y="14" width="10" height="7" rx="1.5"/>',
};
const icon = (kind, color) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[kind] ?? ICON_PATHS.wallet}</svg>`);
const badge = (ch) => "data:image/svg+xml;utf8," + encodeURIComponent(chainIcon(ch, "24").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));

// Dollar value that left the suspect wallets, and the USD sum of a set of flows
const usdOf = (es) => (es.some((e) => e.usd) ? es.reduce((s, e) => s + (e.usd ?? 0), 0) : null);
const movedOut = (c) => usdOf(c.edges.filter((e) => e.dir === "out" && c.suspects?.includes(e.from)));

// What the case canvas shows: which fan-outs are opened, the smallest flow kept, and whether gas funding is drawn
const view = { expanded: new Set(), minUsd: 0, fund: true, group: true };
const GROUP_MIN = 6; // a wallet paying this many dead-end wallets shows them as one group node
const KEY_KINDS = new Set(["suspect", "cex", "bridge", "mixer", "known_hacker", "deposit", "attack_contract", "group"]);

// The case as drawn: small flows and gas funding filtered out, fan-outs into dead ends folded into one node
function shape(c, interactive) {
  const keep = (e) => (view.fund || e.dir !== "fund") && (!view.minUsd || e.usd == null || e.usd >= view.minUsd || e.dir === "fund");
  let edges = c.edges.filter(keep);
  // Wallets nothing points to anymore drop out with their flows, except the suspects
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  let nodes = c.nodes.filter((n) => touched.has(n.id) || c.suspects?.includes(n.id));
  const groups = new Map();
  if (view.group) {
    const outs = new Map(), ins = new Map();
    for (const e of edges) {
      outs.set(e.from, [...(outs.get(e.from) ?? []), e]);
      ins.set(e.to, [...(ins.get(e.to) ?? []), e]);
    }
    for (const p of nodes) {
      if (view.expanded.has(p.id)) continue;
      // Dead ends of this wallet: they got money only from it and sent nothing on in the case
      const kids = (outs.get(p.id) ?? []).filter((e) => e.dir === "out").map((e) => e.to)
        .filter((id, i, a) => a.indexOf(id) === i)
        .filter((id) => !outs.get(id)?.length && (ins.get(id) ?? []).every((e) => e.from === p.id))
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n) => n && !KEY_KINDS.has(n.kind) && n.kind !== "funder" && n.kind !== "sibling");
      if (kids.length < GROUP_MIN) continue;
      const ids = new Set(kids.map((k) => k.id));
      const gid = `grp:${p.id}`;
      const ge = edges.filter((e) => e.from === p.id && ids.has(e.to));
      groups.set(gid, { parent: p.id, kids: kids.map((k) => k.id) });
      nodes = [...nodes.filter((n) => !ids.has(n.id)), { id: gid, chain: kids[0].chain, addr: "", kind: "group", depth: kids[0].depth, label: plural(kids.length, "wallet"), url: "" }];
      const per = new Map();
      for (const e of ge) per.set(e.asset, (per.get(e.asset) ?? 0) + e.amount);
      const [asset, amount] = [...per].sort((x, y) => y[1] - x[1])[0];
      edges = [...edges.filter((e) => !ge.includes(e)), { from: p.id, to: gid, chain: ge[0].chain, asset, amount, usd: usdOf(ge) ?? undefined, txs: ge.flatMap((e) => e.txs).slice(0, 20), first: Math.min(...ge.map((e) => e.first)), last: Math.max(...ge.map((e) => e.last)), dir: "out", group: ge.length }];
    }
  }
  return { ...c, nodes, edges, groups, interactive };
}

// Text width for sizing the node cards, measured once per string
const measure = (() => {
  const ctx = document.createElement("canvas").getContext("2d");
  const memo = new Map();
  return (s, font) => {
    const k = font + s;
    if (!memo.has(k)) {
      ctx.font = font;
      memo.set(k, ctx.measureText(s).width);
    }
    return memo.get(k);
  };
})();

// One renderer for the case canvas and the small home preview
function drawGraph(c, container, interactive, opts = {}) {
  const s = shape(c, interactive);
  const lanes = interactive && s.chains.length > 1 && new Set(s.nodes.map((n) => n.chain)).size > 1;
  const topUsd = Math.max(0, ...s.edges.map((e) => e.usd ?? 0));
  const top = new Map();
  for (const e of s.edges) top.set(e.asset, Math.max(top.get(e.asset) ?? 0, e.amount));
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  // Money in (for the suspect: money out) shown on each card
  const value = (n) => {
    const own = n.kind === "suspect" || n.kind === "funder" || n.kind === "sibling"
      ? s.edges.filter((e) => e.from === n.id) : s.edges.filter((e) => e.to === n.id && e.dir === "out");
    const v = usdOf(own);
    if (v) return `$${fmt(v)}`;
    const e = own.sort((x, y) => y.amount - x.amount)[0];
    return e ? `${fmt(e.amount)} ${e.asset.length > 8 ? short(e.asset) : e.asset}` : "";
  };
  const pos = flowLayout(s, lanes);
  const F1 = "600 11px Inter Tight", F2 = "400 10px IBM Plex Mono";
  const cards = s.nodes.map((n) => {
    const kind = n.kind;
    const color = kind === "group" ? "#8f95a8" : KINDS[kind][0];
    const name = kind === "group" ? n.label : n.label && n.label !== "suspect" ? n.label : kind === "suspect" ? t("Suspect") : short(n.addr);
    const sub = [kind !== "group" && (n.label || kind === "suspect") ? short(n.addr) : "", value(n)].filter(Boolean).join(" · ");
    const nw = Math.ceil(Math.max(measure(name, F1), measure(sub, F2)) + 52);
    return {
      position: pos.get(n.id),
      data: {
        id: n.id, label: sub ? `${name}\n${sub}` : name, name, color, icon: icon(kind, color), badge: badge(n.chain), url: n.url, addr: n.addr, chain: n.chain,
        kind: kind === "group" ? "group" : KINDS[kind][1], k: kind, nw: interactive ? Math.min(nw, 230) : 22, nh: interactive ? (kind === "suspect" ? 46 : 40) : 22,
        key: KEY_KINDS.has(kind) ? 1 : 0, ...(lanes ? { parent: `lane:${n.chain}` } : {}),
      },
    };
  });
  const flows = s.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e, i) => {
    const cross = byId.get(e.from).chain !== byId.get(e.to).chain;
    return {
      data: {
        id: `e${i}`, source: e.from, target: e.to, label: e.usd ? `$${fmt(e.usd)}` : `${fmt(e.amount)} ${e.asset.length > 8 ? short(e.asset) : e.asset}`,
        w: 1.2 + 5 * Math.sqrt(e.usd && topUsd ? e.usd / topUsd : e.amount / (top.get(e.asset) || 1)), fund: e.dir === "fund" ? 1 : 0, tx: e.txs[0], chain: e.chain,
        cross: cross ? 1 : 0, usd: e.usd ?? null, amount: e.amount, asset: e.asset, ntx: e.txs.length, first: e.first, last: e.last, grp: e.group ?? 0,
        lc: cross ? "#8b74e8" : "#55617c", // chains are told apart by lanes and badges; red stays for danger
      },
    };
  });
  // The biggest flows carry a moving glow, as if the money were still running
  const big = flows.filter((f) => !f.data.fund && f.data.usd && f.data.usd >= topUsd * 0.08).sort((a, b) => b.data.usd - a.data.usd).slice(0, 8);
  for (const f of big) f.classes = "flow";
  const els = [
    ...(lanes ? [...new Set(s.nodes.map((n) => n.chain))].map((ch) => ({ classes: "lane", selectable: false, grabbable: false, data: { id: `lane:${ch}`, label: (CHAINS[ch]?.[1] ?? ch).toUpperCase(), lc: CHAINS[ch]?.[0] ?? "#6c7284", color: CHAINS[ch]?.[0] ?? "#6c7284", nw: 1, nh: 1 } })) : []),
    ...cards,
    ...flows,
    ...(interactive ? pos.captions : []).map(([col, x, y]) => ({
      classes: "zone", position: { x, y }, selectable: false, grabbable: false,
      data: { id: `zone${col}`, color: "#000000", nw: 1, nh: 1, label: col < 0 ? t("FUNDED BY · {n} BACK", { n: -col }) : col === 0 ? t("SUSPECT") : t("MONEY WENT · STEP {n}", { n: col }) },
    })),
  ];
  const g = cytoscape({
    container, elements: els, wheelSensitivity: 0.25, minZoom: 0.1, maxZoom: 3,
    userZoomingEnabled: interactive, userPanningEnabled: interactive, boxSelectionEnabled: false, autoungrabify: !interactive,
    style: [
      {
        selector: "node",
        style: {
          shape: "round-rectangle", width: "data(nw)", height: "data(nh)", "corner-radius": 7,
          "background-color": "#121624", "border-width": 1.5, "border-color": "data(color)", "border-opacity": 0.85,
          "background-image": (n) => (n.data("icon") ? `${n.data("icon")} ${n.data("badge")}` : "none"), "background-clip": "none", "background-image-containment": "over",
          "background-width": interactive ? "16 12" : "10 8", "background-height": interactive ? "16 12" : "10 8", "background-position-x": "0% 100%", "background-position-y": "50% 0%",
          "background-offset-x": interactive ? "10 -5" : "2 -1", "background-offset-y": interactive ? "0 5" : "0 1",
          label: interactive ? "data(label)" : "", color: "#ededed", "font-family": "Inter Tight, sans-serif", "font-size": 11, "font-weight": 500,
          "text-wrap": "wrap", "text-valign": "center", "text-halign": "center", "text-margin-x": 9, "line-height": 1.35, "text-max-width": 200,
          "min-zoomed-font-size": 7,
        },
      },
      { selector: "node[key = 1]", style: { "min-zoomed-font-size": 0 } },
      { selector: 'node[k = "suspect"]', style: { "background-color": "#2a1418", "border-width": 2.5, "font-weight": 600 } },
      { selector: 'node[k = "group"]', style: { "border-style": "dashed", "background-color": "#161a28" } },
      { selector: "node:selected", style: { "border-color": "#5d9cf0", "border-width": 2.5, "overlay-opacity": 0 } },
      { selector: "node:active", style: { "overlay-opacity": 0 } },
      {
        selector: ".lane",
        style: {
          shape: "round-rectangle", "corner-radius": 14, "background-color": "data(lc)", "background-opacity": 0.035, "border-width": 1, "border-color": "data(lc)",
          "border-opacity": 0.22, "border-style": "dashed", padding: 34, label: "data(label)", color: "data(lc)", "font-family": "IBM Plex Mono, monospace",
          "font-size": 11, "letter-spacing": 2, "text-valign": "top", "text-halign": "center", "text-margin-y": 26, "text-opacity": 0.75,
          "background-image": "none", events: "no", "min-zoomed-font-size": 0,
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(w)", "line-color": "data(lc)", "target-arrow-color": "data(lc)", "target-arrow-shape": "triangle", "arrow-scale": 0.85,
          "curve-style": "bezier", "control-point-step-size": 50, opacity: 0.95,
          label: interactive ? "data(label)" : "", "font-family": "IBM Plex Mono, monospace", "font-size": 9.5, color: "#e3e6ee",
          "text-rotation": "none", "text-background-color": "#10131f", "text-background-opacity": 1, "text-background-padding": 3, "text-background-shape": "roundrectangle",
          "text-border-width": 1, "text-border-color": "#2b3244", "text-border-opacity": 1, "min-zoomed-font-size": 7,
        },
      },
      { selector: "edge[fund = 1]", style: { "line-style": "dashed", "line-dash-pattern": [6, 4], "line-color": "#ffb54788", "target-arrow-color": "#ffb54788", color: "#ffd59a" } },
      { selector: "edge[grp > 0]", style: { "line-style": "dashed", "line-dash-pattern": [2, 3] } },
      { selector: "edge:selected, edge.hl", style: { "line-color": "#5d9cf0", "target-arrow-color": "#5d9cf0", color: "#ffffff", opacity: 1, "z-index": 10 } },
      { selector: ".dim", style: { opacity: 0.12 } },
      { selector: ".lane.dim", style: { opacity: 0.4 } },
      { selector: ".future", style: { opacity: 0.05 } },
      { selector: "node.hov, node:selected", style: { "underlay-color": "data(color)", "underlay-opacity": 0.16, "underlay-padding": 6, "underlay-shape": "round-rectangle" } },
      { selector: "node.hov", style: { "border-width": 2.5, "z-index": 20 } },
      { selector: "edge.hov", style: { "line-color": "#7fa3d9", "target-arrow-color": "#7fa3d9", color: "#ffffff", opacity: 1, "z-index": 10 } },
      { selector: "edge.hl, edge.hov", style: { "line-style": "dashed", "line-dash-pattern": [9, 5] } },
      {
        selector: ".zone",
        style: {
          events: "no", width: 1, height: 1, opacity: 1, "background-opacity": 0, "border-width": 0, "background-image": "none", label: "data(label)",
          color: "#8a91a6", "font-family": "IBM Plex Mono, monospace", "font-size": 10.5, "letter-spacing": 1, "text-valign": "center", "text-background-opacity": 0, "min-zoomed-font-size": 0,
        },
      },
    ],
    layout: { name: "preset" },
  });
  g.scratch("shape", s);
  // The moving glow on the biggest flows: a gradient whose bright stop the ticker slides along (plain colours only)
  g.edges(".flow").forEach((e) => {
    const base = e.data("cross") ? "#8b74e8" : "#55617c";
    e.style({ "line-fill": "linear-gradient", "line-gradient-stop-colors": `${base} #ffffff ${base}`, "line-gradient-stop-positions": "0% 50% 100%" });
  });
  g.fit(undefined, interactive ? 60 : 16);
  if (!interactive) previewLabels(g, c);
  if (opts.calm) ticker(g);
  else bloom(g, c);
  if (!interactive) return g;
  smoothWheel(g, container);
  g.on("tap", "node", (e) => (e.target.data("k") === "group" ? openGroup(e.target.id()) : inspect(e.target)));
  g.on("tap", (e) => e.target === g && unselect());
  g.on("tap", "edge", (e) => e.target.data("tx") && window.open(txUrl(e.target.data("chain"), e.target.data("tx")), "_blank"));
  g.on("mouseover", "node", (e) => {
    if (e.target.hasClass("lane")) return;
    e.target.addClass("hov").connectedEdges().addClass("hov");
    container.classList.add("cursor-hot");
  });
  g.on("mouseout", "node", (e) => {
    e.target.removeClass("hov").connectedEdges().removeClass("hov");
    container.classList.remove("cursor-hot");
  });
  g.on("mouseover", "edge", (e) => {
    e.target.addClass("hov");
    if (e.target.data("tx")) container.classList.add("cursor-hot");
    edgeTip(e.target, e.renderedPosition);
  });
  g.on("mousemove", "edge", (e) => edgeTip(e.target, e.renderedPosition));
  g.on("mouseout", "edge", (e) => {
    e.target.removeClass("hov");
    container.classList.remove("cursor-hot");
    $("gtip").hidden = true;
  });
  g.on("viewport", () => miniView(g));
  $("legend").innerHTML =
    Object.entries(KINDS).filter(([k]) => s.nodes.some((n) => n.kind === k)).map(([, [col, name]]) => `<span><i style="color:${col}"></i>${name}</span>`).join("") +
    (s.groups.size ? `<span><i style="color:#8f95a8;border-style:dashed"></i>Group, click to open</span>` : "") +
    `<span>Dashed: gas funding</span>` + (c.chains.length > 1 ? `<span><i style="color:#8b74e8"></i>Cross-chain</span>` : "");
  setTimeout(() => miniMap(g), 1400);
  return g;
}

// The home preview is drawn small, so only what tells the story gets words: names on the suspect, exchanges and
// bridges, amounts on the biggest flows, and the wallets of the lead finding lit. Sizes follow the zoom so they read.
function previewLabels(g, c) {
  const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
  const hot = new Set(lead?.addresses ?? []);
  g.nodes().filter((n) => hot.has(n.data("addr"))).addClass("lead");
  // Words on three flows at most, and on the wallets at their ends: more than that piles up at this size
  const top = g.edges().filter((e) => e.data("usd") && !e.data("fund")).sort((a, b) => b.data("usd") - a.data("usd")).slice(0, 3);
  top.forEach((e) => e.addClass("big").target().addClass("named"));
  if (!hot.size) g.nodes('[k = "suspect"]').addClass("named"); // the lead's wallets sit next to it: one name there is enough
  const z = Math.max(g.zoom(), 0.2);
  g.style()
    .selector("node.named, node.lead").style({ label: "data(name)", "text-valign": "bottom", "text-halign": "center", "text-margin-x": 0, "text-margin-y": 4 / z, "font-size": 10.5 / z, "font-weight": 400, color: "#aab0c0", "text-wrap": "ellipsis", "text-max-width": 110 / z, "min-zoomed-font-size": 0 })
    .selector("node.lead").style({ color: "#ededed", "underlay-color": "#ffb547", "underlay-opacity": 0.25, "underlay-padding": 5, "underlay-shape": "round-rectangle" })
    .selector("node.ping").style({ "underlay-color": "#ffb547", "underlay-opacity": 0.45, "underlay-padding": 7, "underlay-shape": "round-rectangle" })
    .selector("edge.big").style({ label: "data(label)", "font-size": 9.5 / z, "text-background-padding": 2 / z, "min-zoomed-font-size": 0 })
    .update();
  g.fit(undefined, 16);
}

// Wheel and trackpad zoom that eases toward where the cursor points instead of stepping. Touch pinch stays Cytoscape's.
function smoothWheel(g, el) {
  let target = null, at = null, raf = 0;
  const step = () => {
    raf = 0;
    if (g.destroyed() || target == null) return;
    const z = g.zoom(), nz = z + (target - z) * 0.2;
    const done = Math.abs(nz - target) < target * 0.002;
    g.zoom({ level: done ? target : nz, renderedPosition: at });
    if (done) target = null;
    else raf = requestAnimationFrame(step);
  };
  // Caught on the parent in the capture phase, so Cytoscape's own wheel zoom on the container never sees it
  el.parentElement.addEventListener("wheel", (e) => {
    if (g.destroyed() || !el.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = el.getBoundingClientRect();
    at = { x: e.clientX - r.left, y: e.clientY - r.top };
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    target = Math.min(g.maxZoom(), Math.max(g.minZoom(), (target ?? g.zoom()) * Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0024))));
    if (!raf) raf = requestAnimationFrame(step);
  }, { capture: true, passive: false });
}

// Details of a flow next to the cursor: amount, value, how many txs, when
function edgeTip(e, at) {
  const d = e.data();
  const day = (ts) => new Date(ts * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("gtip").innerHTML = `<b>${fmt(d.amount)} ${esc(d.asset.length > 12 ? short(d.asset) : d.asset)}</b>${d.usd ? ` <span>$${fmt(d.usd)}</span>` : ""}
    <small>${d.grp ? t("{n} flows into the group · ", { n: d.grp }) : ""}${plural(d.ntx, "tx")} · ${day(d.first)}${d.last > d.first + 60 ? ` → ${day(d.last)}` : ""}</small>
    <small>${d.fund ? t("gas funding") : d.cross ? t("crossed chains") : CHAINS[d.chain]?.[1] ?? d.chain}${d.tx ? t(" · click to open the tx") : ""}</small>`;
  const box = $("gtip").parentElement.getBoundingClientRect(), gb = $("graph").getBoundingClientRect();
  $("gtip").style.left = `${at.x + gb.left - box.left + 14}px`;
  $("gtip").style.top = `${at.y + gb.top - box.top + 14}px`;
  $("gtip").hidden = false;
}

// Redraw the case canvas after a change of view, keeping the selection out of it
function redraw(fitTo) {
  if (!current) return;
  cy?.destroy();
  cy = drawGraph(current, $("graph"), true, { calm: true });
  if (fitTo) cy.fit(cy.getElementById(fitTo).closedNeighborhood(), 80);
}
function openGroup(gid) {
  const grp = cy.scratch("shape").groups.get(gid);
  if (!grp) return;
  view.expanded.add(grp.parent);
  unselect();
  redraw(grp.parent);
}

// Columns by distance from the suspect: whoever funded it on the left, where the money went on the right.
// Inside a column, wallets sit level with the wallet they are connected to, so a chain reads as a straight line.
// A column with too many wallets wraps into several narrow ones instead of becoming a tall strip.
// With lanes, each chain gets its own horizontal band, stacked in the order the money reached them.
function flowLayout(c, lanes = false) {
  const GAP = c.interactive ? 250 : 200, SUB = 200, ROW = c.interactive ? 74 : 60, MAX = Math.max(7, Math.ceil(Math.sqrt(c.nodes.length) * 1.1));
  const col = new Map(c.nodes.map((n) => [n.id, n.depth]));
  // Siblings share a funder with the suspect, so they belong in the suspect's column
  for (const n of c.nodes) if (n.kind === "sibling") col.set(n.id, 0);
  const near = new Map(c.nodes.map((n) => [n.id, []]));
  for (const e of c.edges) {
    near.get(e.from)?.push(e.to);
    near.get(e.to)?.push(e.from);
  }
  const y = new Map(), sub = new Map(), wide = new Map();
  const cols = [...new Set(col.values())].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  const chainOf = new Map(c.nodes.map((n) => [n.id, n.chain]));
  const laneKeys = lanes ? [...new Set([...c.chains, ...c.nodes.map((n) => n.chain)])].filter((ch) => c.nodes.some((n) => n.chain === ch)) : [null];
  for (const lane of laneKeys) {
    const inLane = (n) => !lane || n.chain === lane;
    for (const k of cols) {
      // Wallets in this column, each aiming for the average height of its already placed neighbours
      const here = c.nodes.filter((n) => col.get(n.id) === k && inLane(n)).map((n) => {
        const ys = near.get(n.id).filter((m) => y.has(m) && (!lane || chainOf.get(m) === lane)).map((m) => y.get(m));
        return { id: n.id, want: n.kind === "suspect" ? -1e9 : ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 };
      });
      if (!here.length) continue;
      here.sort((a, b) => a.want - b.want);
      if (k === 0) here.forEach((h, i) => (h.want = i * ROW)); // the suspect on top, its siblings stacked under it
      const mean = here.reduce((a, h) => a + h.want, 0) / here.length;
      if (here.length > MAX) {
        // Wrapped column: a grid centred on where the group wanted to be, odd columns half a row lower
        const rows = Math.ceil(here.length / Math.ceil(here.length / MAX));
        here.forEach((h, i) => {
          const s = Math.floor(i / rows);
          sub.set(h.id, s);
          y.set(h.id, mean + ((i % rows) - (rows - 1) / 2 + (s % 2) / 2) * ROW);
        });
        wide.set(k, Math.max(wide.get(k) ?? 1, Math.ceil(here.length / rows)));
        continue;
      }
      // Keep the order, push apart anything closer than one row, then centre the group on where it wanted to be
      let last = -Infinity;
      const at = here.map((h) => (last = Math.max(h.want, last + ROW)));
      const shift = k === 0 ? 0 : mean - at.reduce((a, b) => a + b, 0) / here.length;
      here.forEach((h, i) => y.set(h.id, at[i] + shift));
    }
  }
  // Lanes stack top to bottom with a gap between them
  if (lanes) {
    let cursor = 0;
    for (const lane of laneKeys) {
      const ids = c.nodes.filter((n) => n.chain === lane).map((n) => n.id);
      const ys = ids.map((id) => y.get(id));
      const lo = Math.min(...ys), hi = Math.max(...ys);
      for (const id of ids) y.set(id, y.get(id) - lo + cursor);
      cursor += hi - lo + 190;
    }
  }
  // Column x positions, leaving room for wrapped columns; the suspect's column stays at x = 0
  const x = new Map([[0, 0]]);
  const span = (k) => ((wide.get(k) ?? 1) - 1) * SUB;
  const right = cols.filter((k) => k > 0).sort((a, b) => a - b), left = cols.filter((k) => k < 0).sort((a, b) => b - a);
  right.forEach((k, i) => x.set(k, x.get(right[i - 1] ?? 0) + span(right[i - 1] ?? 0) + GAP));
  left.forEach((k, i) => x.set(k, x.get(left[i - 1] ?? 0) - GAP - span(k)));
  const pos = new Map(c.nodes.map((n) => [n.id, { x: x.get(col.get(n.id)) + (sub.get(n.id) ?? 0) * SUB, y: y.get(n.id) }]));
  const top = Math.min(...[...pos.values()].map((p) => p.y)) - (lanes ? 110 : 60);
  pos.captions = cols.map((k) => [k, x.get(k) + span(k) / 2, top]);
  return pos;
}

// The graph unfolds from the suspect outwards instead of popping in all at once
function bloom(g, c) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return ticker(g);
  const start = g.nodes('[k = "suspect"]').first();
  const from = start.nonempty() ? { ...start.position() } : { x: g.extent().x1 + g.extent().w / 2, y: g.extent().y1 + g.extent().h / 2 };
  const depth = new Map(c.nodes.map((n) => [n.id, Math.abs(n.depth)]));
  // While the nodes fly out they all sit near the suspect; a fit in that moment would zoom onto one node
  g.scratch("bloomUntil", Date.now() + 1300);
  g.edges().style("opacity", 0);
  g.$(".lane").style("opacity", 0);
  g.nodes().not(".zone, .lane").forEach((n) => {
    const to = { ...n.position() };
    n.position(from).style("opacity", 0);
    n.delay(60 * (depth.get(n.id()) ?? 1) + Math.random() * 80)
      .animate({ position: to, style: { opacity: 1 } }, { duration: 650, easing: "ease-out-cubic", complete: () => n.removeStyle("opacity") });
  });
  setTimeout(() => {
    if (g.destroyed()) return;
    g.edges().animate({ style: { opacity: 0.95 } }, { duration: 400, complete: () => g.edges().removeStyle("opacity") });
    g.$(".lane").animate({ style: { opacity: 1 } }, { duration: 500, complete: () => g.$(".lane").removeStyle("opacity") });
  }, 500);
  ticker(g);
}

// One animation loop per graph: money running along highlighted flows, a glow travelling the biggest flows,
// and a slow pulse around the suspect
function ticker(g) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const suspect = g.nodes('[k = "suspect"]');
  const big = g.edges(".flow");
  let off = 0;
  const step = (t) => {
    if (g.destroyed()) return;
    const flowing = g.edges(".hl, .hov");
    if (flowing.nonempty() && !calm) flowing.style("line-dash-offset", (off -= 0.5));
    if (!calm && big.nonempty()) {
      const p = ((t / 1800) % 1.3) * 100 - 15; // a bright spot sliding from source to target, then a short pause
      const cl = (v) => Math.min(100, Math.max(0, v)).toFixed(1);
      big.style("line-gradient-stop-positions", `${cl(p - 14)}% ${cl(p)}% ${cl(p + 14)}%`);
    }
    if (suspect.nonempty() && !suspect.selected() && !suspect.hasClass("hov")) {
      const k = (t / 2200) % 1; // one ring every 2.2s, growing and fading
      suspect.style({ "underlay-color": "#ff5d6c", "underlay-shape": "round-rectangle", "underlay-padding": 3 + 14 * k, "underlay-opacity": calm ? 0.12 : 0.22 * (1 - k) });
    } else suspect.removeStyle("underlay-padding underlay-opacity underlay-color");
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Minimap: the whole graph as a picture with the visible part framed; click or drag on it to move there
function miniMap(g) {
  if (g.destroyed() || g !== cy) return;
  const m = $("minimap");
  m.hidden = g.nodes().not(".zone, .lane").length < 14;
  if (m.hidden) return;
  const bb = g.elements().boundingBox();
  m._bb = bb;
  m.querySelector("img").src = g.png({ full: true, scale: Math.min(1, 220 / bb.w), bg: "#0c0e17" });
  miniView(g);
  const go = (ev) => {
    const r = m.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
    const z = g.zoom();
    g.pan({ x: g.width() / 2 - (bb.x1 + fx * bb.w) * z, y: g.height() / 2 - (bb.y1 + fy * bb.h) * z });
  };
  m.onpointerdown = (ev) => {
    go(ev);
    m.onpointermove = (e2) => e2.buttons && go(e2);
  };
}
function miniView(g) {
  const m = $("minimap");
  if (m.hidden || !m._bb || g !== cy) return;
  const bb = m._bb, ext = g.extent();
  const box = m.querySelector("i");
  const cl = (v) => Math.max(0, Math.min(100, v));
  const l = cl(((ext.x1 - bb.x1) / bb.w) * 100), t = cl(((ext.y1 - bb.y1) / bb.h) * 100);
  box.style.left = `${l}%`;
  box.style.top = `${t}%`;
  box.style.width = `${cl(((ext.x2 - bb.x1) / bb.w) * 100) - l}%`;
  box.style.height = `${cl(((ext.y2 - bb.y1) / bb.h) * 100) - t}%`;
}

// Replay: flows appear in the order they happened; wallets light up when money first reaches them
const replay = { t: null, timer: null };
function timeline(on) {
  $("tline").hidden = !on;
  $("gtReplay")?.classList.toggle("on", on);
  clearInterval(replay.timer);
  if (!on || !cy) {
    cy?.elements().removeClass("future");
    return;
  }
  const es = cy.edges();
  const t0 = Math.min(...es.map((e) => e.data("first"))), t1 = Math.max(...es.map((e) => e.data("first")));
  const r = $("tlRange");
  r.min = t0;
  r.max = t1;
  r.step = Math.max(1, Math.round((t1 - t0) / 400));
  const at = (t) => {
    r.value = t;
    $("tlDate").textContent = new Date(t * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    cy.batch(() => {
      for (const e of es) e.toggleClass("future", e.data("first") > t);
      for (const n of cy.nodes().not(".zone, .lane")) {
        const live = n.data("k") === "suspect" || n.connectedEdges().some((e) => e.data("first") <= t);
        n.toggleClass("future", !live);
      }
    });
  };
  r.oninput = () => at(Number(r.value));
  $("tlPlay").onclick = () => {
    clearInterval(replay.timer);
    let t = Number(r.value) >= t1 ? t0 : Number(r.value);
    const stepT = (t1 - t0) / 160 || 1;
    $("tlPlay").textContent = "❚❚";
    replay.timer = setInterval(() => {
      t = Math.min(t1, t + stepT);
      at(t);
      if (t >= t1) {
        clearInterval(replay.timer);
        $("tlPlay").textContent = "▶";
      }
    }, 60);
  };
  at(t0);
  $("tlPlay").click();
}

// Toolbar over the canvas: smallest flow shown, gas funding on or off, fan-outs folded, replay
function graphTools() {
  $("gtools").innerHTML = `
    <label>Min <select id="gtMin">${[0, 1e3, 1e4, 1e5, 1e6].map((v) => `<option value="${v}" ${view.minUsd === v ? "selected" : ""}>${v ? `$${fmt(v)}` : "all"}</option>`).join("")}</select></label>
    <button id="gtFund" class="${view.fund ? "on" : ""}" title="Show the gas funding trail">Funding</button>
    <button id="gtGroup" class="${view.group ? "on" : ""}" title="Fold wallets that only received money into one node">Groups</button>
    <button id="gtReplay" title="Replay the flows in time order">▶ Replay</button>`;
  $("gtMin").onchange = () => {
    view.minUsd = Number($("gtMin").value);
    timeline(false);
    redraw();
  };
  $("gtFund").onclick = () => {
    view.fund = !view.fund;
    $("gtFund").classList.toggle("on", view.fund);
    timeline(false);
    redraw();
  };
  $("gtGroup").onclick = () => {
    view.group = !view.group;
    view.expanded.clear();
    $("gtGroup").classList.toggle("on", view.group);
    timeline(false);
    redraw();
  };
  $("gtReplay").onclick = () => timeline($("tline").hidden);
}

function unselect() {
  $("node").hidden = true;
  cy?.elements().removeClass("dim hl").unselect();
}

const LABELS = [["cex", "Exchange"], ["swap", "Instant swap service"], ["mixer", "Mixer"], ["bridge", "Bridge"], ["hacker", "Exploiter / scammer"], ["dex", "DEX / protocol"], ["other", "Other"]];

// Flows into or out of a wallet: their count, and their dollar value when known
const inOut = (n, side) => {
  const es = n[side]("edge").map((e) => ({ usd: e.data("usd") ?? undefined }));
  const v = usdOf(es);
  return `${es.length}${v ? ` · $${fmt(v)}` : ""}`;
};

// Selecting a wallet highlights its direct flows and opens a card with its links
function inspect(n) {
  const d = n.data();
  // The whole way the money took to reach this wallet, plus where it went next; everything else fades
  cy.elements().addClass("dim").removeClass("hl");
  const path = n.predecessors().union(n).union(n.outgoers());
  path.removeClass("dim");
  path.edges().addClass("hl");
  cy.$(".lane, .zone").removeClass("dim");
  n.select();
  cy.animate({ center: { eles: n } }, { duration: 650, easing: "ease-in-out-cubic" });
  $("node").hidden = false;
  $("node").innerHTML = `
    <div class="head"><i style="background:${d.color}"></i><b>${esc(d.name || cap(d.kind))}</b><button class="txt x" id="close">✕</button></div>
    <div class="body">
      <code>${esc(d.addr)}</code>
      <div class="io">${kv("Chain", chainName(d.chain))}${kv("Type", esc(cap(d.kind)))}${kv("In", inOut(n, "incomers"))}${kv("Out", inOut(n, "outgoers"))}</div>
      <div class="acts">
        <button class="main" id="trace">Trace from here</button>
        <a target="_blank" href="${d.url}">Explorer ↗</a>
        <a target="_blank" href="${arkham(d.addr)}">Arkham ↗</a>
        <button id="copy">Copy</button>
        ${me?.enforced ? "" : `<button id="labelBtn">Label</button>`}
      </div>
      <form id="labelForm" class="label-f" hidden>
        <input id="labelName" maxlength="60" placeholder="Name, e.g. Binance hot wallet" value="${esc(d.name && d.name !== "suspect" ? d.name : "")}" />
        <select id="labelKind">${LABELS.map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select>
        <button class="main">Save</button>
        <span class="muted" id="labelNote">Shared with everyone working on this repo. Empty name removes it.</span>
      </form>
    </div>`;
  $("close").onclick = unselect;
  $("copy").onclick = () => {
    navigator.clipboard.writeText(d.addr);
    $("copy").textContent = "Copied";
  };
  if ($("labelBtn")) $("labelBtn").onclick = () => {
    $("labelForm").hidden = !$("labelForm").hidden;
    $("labelName").focus();
  };
  $("labelForm").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("labelName").value.trim();
    const r = await fetch("/api/label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: d.chain, addr: d.addr, kind: $("labelKind").value, name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return ($("labelNote").textContent = j.error ?? "could not save");
    // Show it at once on the graph; the saved case picks it up on its next load
    const node = current.nodes.find((x) => x.id === n.id());
    if (node) node.label = name || undefined;
    n.data({ name, label: node ? nodeLabel(node, current) : name });
    $("labelNote").textContent = name ? "Saved." : "Removed.";
    inspect(n);
  };
  $("trace").onclick = () => {
    $("q").value = d.addr;
    $("chain").value = [...$("chain").options].some((o) => o.value === d.chain) ? d.chain : "auto";
    start(d.addr);
  };
}

const focusNode = (id) => {
  let n = cy?.getElementById(id);
  // A wallet folded into a group: open the group first
  if (cy && !n.length) {
    const hit = [...(cy.scratch("shape")?.groups ?? [])].find(([, gr]) => gr.kids.includes(id));
    if (hit) {
      view.expanded.add(hit[1].parent);
      redraw();
      n = cy.getElementById(id);
    }
  }
  if (!n?.length) return;
  cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 600, easing: "ease-in-out-cubic" });
  inspect(n);
};

// Long hashes inside prose become short chips; click copies the full value
const chipHashes = (s) =>
  esc(s).replace(/\b(0x[0-9a-fA-F]{40,64}|[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,90})\b/g, (m) => `<span class="h" title="${m} (${t("click to copy")})" data-copy="${m}">${short(m)}</span>`);

// Summary first: the counts, the best lead, and where the money ended up
function drawOverview(c) {
  const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
  const high = c.findings.filter((f) => f.confidence === "high").length;
  const sums = new Map();
  for (const e of c.edges) {
    if (e.dir !== "out") continue;
    const per = sums.get(e.to) ?? new Map();
    per.set(e.asset, (per.get(e.asset) ?? 0) + e.amount);
    sums.set(e.to, per);
  }
  const usdIn = (id) => usdOf(c.edges.filter((e) => e.dir === "out" && e.to === id));
  const exitKinds = ["cex", "deposit", "bridge", "mixer", "known_hacker"];
  const exits = c.nodes.filter((n) => exitKinds.includes(n.kind) || (n.chain !== c.chains[0] && n.depth > 0));
  $("overview").innerHTML = `
    <div class="sec"><div class="card tiles">
      ${kv("Wallets", c.nodes.length)}${movedOut(c) ? kv("Moved out", `$${fmt(movedOut(c))}`) : kv("Flows", c.edges.length)}${kv("High confidence", high, high ? "hot" : "")}${kv("Chains", c.chains.length)}
    </div></div>
    ${lead ? `<div class="sec"><h3>Best Lead</h3><div class="card lead"><span class="tag ${lead.confidence}">${esc(lead.confidence)}</span>
      <p class="lead-t">${chipHashes(tf(lead.title))}</p><p class="lead-d">${chipHashes(lead.detail.split(". ").slice(0, 2).join(". "))}.</p></div></div>` : ""}
    <div class="sec"><h3>Where It Ended Up</h3><div class="card">${exits.length
      ? exits.map((n) => `<div class="exit" data-node="${esc(n.id)}"><i style="background:${KINDS[n.kind][0]}"></i>
          <div class="nm">${esc(n.label ?? cap(KINDS[n.kind][1]))}<small>${chainIcon(n.chain, "0.95em")} ${esc(short(n.addr))}</small></div>
          <div class="amt">${[...(sums.get(n.id) ?? [])].map(([a, v]) => `${fmt(v)} ${esc(a.length > 10 ? short(a) : a)}`).join("<br>") || "—"}${usdIn(n.id) ? `<small>$${fmt(usdIn(n.id))}</small>` : ""}</div></div>`).join("")
      : `<p class="empty">No exchange, bridge or mixer within reach of this trace.</p>`}</div></div>`;
}

function drawFindings(c) {
  $("nF").textContent = c.findings.length || "";
  $("findings").innerHTML = c.findings.length
    ? c.findings.map((f) => `
      <div class="finding c-${f.confidence} t-${KIND_TONE[f.kind] ?? "none"}">
        <div class="f-top"><span class="tag ${f.confidence}">${esc(f.confidence)}</span><span class="f-kind">${esc(t(f.kind.replace(/_/g, " ")))} · ${esc(CHAINS[f.chain]?.[1] ?? f.chain)}</span></div>
        <div class="f-title">${chipHashes(tf(f.title))}</div>
        <p class="f-detail">${chipHashes(f.detail)}</p>
        <div class="f-links">
          ${f.addresses.map((a) => `<a target="_blank" href="${addrUrl(f.chain, a)}">${esc(short(a))}</a><a class="ark" target="_blank" href="${arkham(a)}">Arkham ↗</a>`).join("")}
          ${f.txs.map((h) => `<a target="_blank" href="${txUrl(f.chain, h)}">TX ${esc(short(h))} ↗</a>`).join("")}
        </div>
      </div>`).join("")
    : `<p class="empty">Nothing conclusive found automatically. The graph may still show something.</p>`;
}

// Every edge as a row, largest first within each asset
function drawFlows(c) {
  const name = (id) => {
    const n = c.nodes.find((x) => x.id === id);
    return n ? esc(n.label ?? short(n.addr)) : esc(short(id.split(":")[1] ?? id));
  };
  // Largest dollar value first; flows without a price follow, grouped by asset
  const rows = [...c.edges].sort((x, y) => (y.usd ?? -1) - (x.usd ?? -1) || x.asset.localeCompare(y.asset) || y.amount - x.amount);
  $("nE").textContent = rows.length || "";
  $("flows").innerHTML = `<table class="ftable"><thead><tr><th>From / To</th><th>Value</th><th>Tx</th></tr></thead><tbody>${rows
    .map((e) => `<tr class="${e.dir === "fund" ? "fund" : ""}">
      <td class="pair"><span class="ad" data-node="${esc(e.from)}">${name(e.from)}</span><span class="ad to" data-node="${esc(e.to)}">→ ${name(e.to)}</span></td>
      <td><div class="am">${fmt(e.amount)} ${esc(e.asset.length > 10 ? short(e.asset) : e.asset)}${e.usd ? `<small title="${e.usdNow ? "No price history for that time: today's price" : "Price when it moved"}">${e.usdNow ? "≈" : ""}$${fmt(e.usd)}</small>` : ""}</div></td>
      <td><a target="_blank" href="${txUrl(e.chain, e.txs[0])}">${esc(short(e.txs[0]))}</a>${e.txs.length > 1 ? ` <span class="muted">+${e.txs.length - 1}</span>` : ""}</td></tr>`)
    .join("")}</tbody></table>`;
}

// Report: a write-up built from the findings by a template, exportable as markdown or printed to PDF
async function drawReport(c) {
  await meReady;
  const locked = !isPaid() ? "data-upsell" : "";
  $("report").innerHTML = `<div class="rep-acts">
      <a class="btn" href="/api/case/${c.id}.md?download" ${locked}>Download .md</a>
      <button id="repPdf" ${locked}>Print / PDF</button>
      <span class="muted">Written from the findings, every address and transaction linked.</span>
    </div><div id="repBody"><p class="empty">Loading…</p></div>`;
  if (!locked) $("repPdf").onclick = () => printDoc(`/api/case/${c.id}.md`, `Tracehound case ${c.id}`);
  const body = await fetch(`/api/case/${c.id}.md`).then((r) => r.text()).catch(() => "");
  if (current?.id !== c.id) return;
  $("repBody").innerHTML = DOMPurify.sanitize(marked.parse(body || "Could not build the report."));
  for (const a of $("repBody").querySelectorAll("a")) a.target = "_blank";
}

// A light, printable copy of a markdown export; the browser's print dialog saves it as PDF
const PRINT_CSS = `body{font:14px/1.55 -apple-system,"Inter Tight",Helvetica,Arial,sans-serif;color:#111;max-width:46rem;margin:2rem auto;padding:0 1.5rem}
h1{font-size:1.6rem;margin:0 0 1rem}h2{font-size:1.15rem;margin:1.8rem 0 .6rem;border-bottom:1px solid #ddd;padding-bottom:.3rem}h3{font-size:1rem;margin:1.2rem 0 .3rem}
a{color:#1a5fb4;text-decoration:none;word-break:break-all}table{border-collapse:collapse;width:100%;font-size:12px;margin:.5rem 0}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f4f4f4}code{font-size:12px}em{color:#555}hr{border:0;border-top:1px solid #ddd;margin:2rem 0 1rem}@page{margin:16mm}`;
async function printDoc(url, title, print = true) {
  // Open the window inside the click: after an await the browser treats it as a popup and blocks it
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write("Preparing…");
  const md = await fetch(url).then((r) => r.text());
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${DOMPurify.sanitize(marked.parse(md))}</body></html>`);
  w.document.close();
  if (print) setTimeout(() => w.print(), 300);
  return w;
}

// Under the search: the newest findings and risky tokens running by. Twice over, so the loop has no seam.
function drawTicker(leads, checks) {
  const items = [
    ...leads.map((l) => `<a class="tk t-${KIND_TONE[l.kind] ?? "hack"}" href="?case=${esc(l.id)}" data-case="${esc(l.id)}">${chainIcon(l.chain, "0.95em")}<span>${esc(tf(l.title))}</span><i>${ago(l.created)}</i></a>`),
    ...checks.filter((c) => c.verdict !== "low").slice(0, 6).map((c) => `<a class="tk t-${c.verdict === "high" ? "hack" : "fund"}" href="?token=${esc(c.id)}" data-check="${esc(c.id)}">${tokImg(c.chain, c.mint, "ti sm")}<span><b>${esc(c.symbol)}</b> ${t("risk")} ${c.risk} · ${esc(tf(c.top ?? ""))}</span><i>${ago(c.checkedAt)}</i></a>`),
  ];
  $("ticker").hidden = !items.length;
  if (!items.length) return;
  $("tickerTrack").innerHTML = items.join("") + items.join("");
  $("tickerTrack").style.animationDuration = `${Math.max(30, items.length * 7)}s`;
  for (const a of $("tickerTrack").querySelectorAll("a")) a.onclick = (e) => {
    e.preventDefault();
    if (a.dataset.case) openCase(a.dataset.case);
    else openCheck(a.dataset.check);
  };
}

// Short names for the kinds of finding shown in the home page's lead list
// Colour group of a finding kind: bridges teal, exchanges blue, the attacker's own side red, funding amber, mixers violet
const KIND_TONE = { crossing: "bridge", exit_bridge: "bridge", deposit: "cex", exit_cex: "cex", known_hacker: "hack", loop: "hack", funding: "fund", siblings: "fund", exit_mixer: "mixer", swap_out: "swap", lp_laundering: "swap" };
const LEAD_KIND = { crossing: "bridge", deposit: "deposit", known_hacker: "labeled", funding: "funding", loop: "loop", exit_cex: "exchange", exit_mixer: "mixer", exit_bridge: "bridge", siblings: "siblings", swap_out: "swap", lp_laundering: "liquidity" };
for (const k in LEAD_KIND) LEAD_KIND[k] = t(LEAD_KIND[k]);

// Home: the latest case as a live preview, the coverage table and every recent case
async function home() {
  mode("home");
  // Coverage as two rows of chips: chains the trace follows, and chains it only sees money leave to
  const SRC = { solana: "Helius", tron: "TronGrid", bitcoin: "mempool.space" };
  const chips = (chains, on) => chains.map((ch) => `<span class="cv${on ? " on" : ""}" title="${esc(on ? SRC[ch] ?? "Etherscan v2" : "Midgard")}">${chainName(ch)}</span>`).join("");
  $("coverage").innerHTML = `<div class="cov-r"><span class="k st on">${t("Traced")}</span><div class="cov-c">${chips(TRACED, true)}</div></div>`
    + `<div class="cov-r"><span class="k st">${t("Exit only")}</span><div class="cov-c">${chips(EXIT_ONLY, false)}</div></div>`
    + `<p class="cov-n">${t("Traced: the trail is followed wallet by wallet. Exit only: money leaving through THORChain to these chains is shown, not followed further.")}</p>`;
  const [{ cases = [], totals = {}, leads = [] }, checks] = await Promise.all([
    fetch("/api/cases").then((r) => r.json()).catch(() => ({})),
    fetch("/api/tokens").then((r) => r.json()).catch(() => []),
  ]);
  const risky = checks.filter((r) => r.verdict === "high").length;
  $("homeStats").innerHTML = kv("Cases", totals.cases ?? 0) + kv("Wallets traced", (totals.wallets ?? 0).toLocaleString("en-US"))
    + kv("Value traced", totals.usd ? `$${fmt(totals.usd)}` : "—") + kv("Tokens checked", `${checks.length}${risky ? ` <small>${t("{n} high risk", { n: risky })}</small>` : ""}`);
  $("homeLeads").innerHTML = leads.length
    ? leads.map((l) => `<div class="lead-row t-${KIND_TONE[l.kind] ?? "hack"}" data-id="${esc(l.id)}"><span class="lk">${esc(LEAD_KIND[l.kind] ?? l.kind.replace(/_/g, " "))}</span>
        <div><div class="lt">${esc(tf(l.title))}</div><small>${chainIcon(l.chain, "0.95em")} ${esc(short(l.query))} · ${ago(l.created)}</small></div></div>`).join("")
    : `<p class="empty">High-confidence findings from new cases show up here.</p>`;
  for (const r of $("homeLeads").querySelectorAll(".lead-row")) r.onclick = () => openCase(r.dataset.id);
  drawTicker(leads, checks);
  $("homeTok").innerHTML = checks.length
    ? checks.slice(0, 6).map((r) => `<tr data-check="${esc(r.id)}"><td class="time">${ago(r.checkedAt)}</td>
        <td>${tokImg(r.chain, r.mint)}<b class="sym">${esc(r.symbol)}</b> ${chainIcon(r.chain ?? "solana", "0.8em")}</td>
        <td class="r">${riskC(r)}</td><td class="lead">${esc(r.top ? tf(r.top) : t("Nothing suspicious found"))}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">No token checked yet.</td></tr>`;
  for (const tr of $("homeTok").querySelectorAll("tr[data-check]")) tr.onclick = () => openCheck(tr.dataset.check);
  $("casesN").textContent = cases.length ? t("{n} shown", { n: cases.length }) : "";
  $("totals").textContent = t("{c} CASES · {w} WALLETS", { c: totals.cases ?? 0, w: (totals.wallets ?? 0).toLocaleString("en-US") });
  $("caseRows").innerHTML = cases.length
    ? cases.map((r) => `<tr data-id="${esc(r.id)}">
        <td class="time">${ago(r.created)}</td>
        <td class="q">${esc(short(r.query))}</td>
        <td>${route(r.chains)}</td>
        <td class="r">${r.wallets}</td>
        <td class="lead">${r.top ? `<i class="kd t-${KIND_TONE[r.topKind] ?? "none"}"></i>${esc(tf(r.top))}` : "—"}${r.high ? `<span class="hi">${t("{n} HIGH", { n: r.high })}</span>` : ""}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">Nothing traced yet. Paste an address above.</td></tr>`;
  for (const tr of $("caseRows").querySelectorAll("tr[data-id]")) tr.onclick = () => openCase(tr.dataset.id);
  const latest = cases[0];
  if (!latest) return;
  const c = await getJson(`/api/case/${latest.id}`);
  if (c.error || document.body.className !== "home") return;
  $("preview").onclick = () => openCase(c.id);
  $("previewOpen").hidden = false;
  $("previewOpen").onclick = (e) => {
    e.preventDefault();
    openCase(c.id);
  };
  $("previewMeta").innerHTML = kv("Query", `<code>${esc(short(c.query))}</code>`) + kv("Route", route(c.chains)) + kv("Wallets", c.nodes.length) + kv("Findings", c.findings.length) + kv("Traced", ago(c.created));
  $("previewGraph").innerHTML = "";
  preview?.destroy();
  preview = drawGraph(c, $("previewGraph"), false, { calm: true });
  previewReplay(preview);
  const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
  $("previewLead").hidden = !lead;
  if (lead) $("previewLead").innerHTML = `<span class="lk t-${KIND_TONE[lead.kind] ?? "hack"}">${esc(LEAD_KIND[lead.kind] ?? lead.kind.replace(/_/g, " "))}</span><span>${esc(shortHashes(tf(lead.title)))}</span>`;
}

// Token check: a list of recent checks, a live log while one runs, and the verdict with its evidence
// A risk score as its number and a short bar filled to it, in the verdict's colour
const riskC = (r) => `<span class="risk-c ${r.verdict}" style="--r:${Math.max(3, Math.min(100, r.risk))}%">${r.risk}</span>`;
const VERDICT = { low: t("Low risk"), medium: t("Medium risk"), high: t("High risk") };
const usd = (n) => (n == null ? "—" : `$${fmt(n)}`);
const age = (sec) => (sec < 5400 ? t("{n} min", { n: Math.max(1, Math.round(sec / 60)) }) : sec < 2 * 86400 ? t("{n} h", { n: Math.round(sec / 3600) }) : t("{n} days", { n: Math.round(sec / 86400) }));
// A token's picture from our own cache (DexScreener, GeckoTerminal, Helius CDN, IPFS); gone without a trace if none exists
const imgUrl = (chain, token) => `/api/img?chain=${encodeURIComponent(chain ?? "solana")}&token=${encodeURIComponent(token)}`;
const tokImg = (chain, token, cls = "ti") => `<img class="${cls}" src="${imgUrl(chain, token)}" alt="" loading="lazy" onload="this.classList.add('ld')" onerror="this.remove()" />`;

// Links on the token page point to the explorer of the token's chain
let tokChain = "solana";
const sol = (a, label = short(a)) => `<a target="_blank" href="${addrUrl(tokChain, a)}">${esc(label)}</a>`;
const GT_NET = { solana: "solana", bsc: "bsc", base: "base" };
// Candles come through our server, which asks GeckoTerminal once for everyone and keeps the answer two minutes
const ohlcvUrl = (chain, pool, tf, agg, limit) => `/api/ohlcv?${new URLSearchParams({ net: GT_NET[chain] ?? chain, pool, tf, agg, limit })}`;
let tes, ttimer, checkNow;

// How the verdicts held up 24 h after the first check, per verdict group
function accuracyHtml(acc) {
  const pc = (x) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);
  const share = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : "—");
  return acc?.judged
    ? `<table class="tbl zebra acc"><thead><tr><th>Verdict</th><th class="r">Tokens</th><th class="r">Fell 80%+</th><th class="r">Halved</th><th class="r">Grew 2x+</th><th class="r">Median</th></tr></thead><tbody>
      ${acc.groups.map((g) => `<tr><td><span class="tag ${g.verdict}">${VERDICT[g.verdict]}</span></td><td class="r mono">${g.n}</td><td class="r mono">${share(g.fell80, g.n)}</td><td class="r mono">${share(g.halved, g.n)}</td><td class="r mono">${share(g.grew2x, g.n)}</td><td class="r mono">${pc(g.median)}</td></tr>`).join("")}
      </tbody></table><p class="note">${t("{judged} of {checked} checked tokens have reached {h} h. A few dozen per group are needed before these numbers mean much.", { judged: acc.judged, checked: acc.checked, h: acc.horizonH })}</p>`
    : `<p class="empty">${t("No token has reached {h} h since its check yet ({n} checked). Each check is judged automatically a day later.", { h: acc?.horizonH ?? 24, n: acc?.checked ?? 0 })}</p>`;
}

// Each signal's record: of the judged tokens that had it, how many fell 80%+ in 24 h, against those without it
let signalsP;
const signalsData = () => (signalsP ??= fetch("/api/signals").then((r) => r.json()).catch(() => null));
const pct0 = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
function signalsHtml(st) {
  if (!st?.signals?.length) return `<p class="empty">${t("Signals are scored once checked tokens reach {h} h: for each, how often a token with it fell 80%+ against tokens without it.", { h: st?.horizonH ?? 24 })}</p>`;
  return `<table class="tbl zebra sig-t"><thead><tr><th>Signal</th><th class="r">Tokens</th><th class="r">Fell 80%+ with it</th><th class="r">Without it</th><th class="r">Difference</th></tr></thead><tbody>
    ${st.signals.map((x) => {
      const d = x.rate != null && x.rateWithout != null ? x.rate - x.rateWithout : null;
      return `<tr class="${x.enough ? "" : "few"}"><td>${esc(t(x.name))}</td><td class="r mono">${x.n}</td><td class="r mono">${pct0(x.rate)}</td><td class="r mono">${pct0(x.rateWithout)}</td>
        <td class="r mono ${!x.enough ? "" : d >= 0.15 ? "up" : d <= 0.02 ? "flat" : ""}">${x.enough && d != null ? t("{n} pts", { n: `${d >= 0 ? "+" : ""}${Math.round(d * 100)}` }) : "few"}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="note">${t("{judged} judged tokens, {base} of them fell 80%+ in {h} h. A signal needs {min}+ tokens with it and without it before its difference counts; points are being re-weighted from this.", { judged: st.judged, base: pct0(st.base), h: st.horizonH, min: st.minN })}</p>`;
}

// Under each reason on a token page: how that signal has done so far
async function reasonRates() {
  const st = await signalsData();
  for (const el of document.querySelectorAll(".reason[data-signal]")) {
    const x = st?.signals?.find((y) => y.id === el.dataset.signal);
    const slot = el.querySelector(".sig-rate");
    if (!slot) continue;
    slot.innerHTML = !x
      ? t("Not measured yet: no checked token with this signal has reached {h} h.", { h: st?.horizonH ?? 24 })
      : !x.enough
        ? t("Not measured yet: {tokens} with this signal so far.", { tokens: plural(x.n, "token") })
        : t("Tokens with this signal fell 80%+ within {h} h in <b>{rate}</b> of cases ({fell} of {n}), without it in {wo}.", { h: st.horizonH, rate: pct0(x.rate), fell: x.fell, n: x.n, wo: pct0(x.rateWithout) });
  }
}

// Method: the rules in the open, with the sources and the live accuracy table
const SOURCES = [
  ["EVM wallet history", "Etherscan v2", "Free key: Ethereum, Arbitrum, Polygon. Paid: Base, BSC, Optimism"],
  ["Solana", "Helius Parsed Events", "Key, free plan"],
  ["Tron", "TronGrid", "Works without a key, faster with one"],
  ["Bitcoin", "mempool.space, blockstream.info", "No key"],
  ["THORChain", "Midgard, THORNode", "No key"],
  ["Bridges", "Wormholescan, Mayan, deBridge, Across, LayerZero Scan", "No key"],
  ["USD prices", "DefiLlama", "No key"],
  ["Labels", "eth-labels (open), exchanges' proof-of-reserves wallets, Dune, labels added by hand", "Dune needs a key"],
  ["Token markets", "DexScreener, GeckoTerminal", "No key"],
  ["Base and BSC contracts", "GoPlus Security", "No key"],
  ["Written report", "Built from the findings by a template", "No key"],
];
async function method() {
  mode("method");
  $("m-src").innerHTML = `<thead><tr><th>Data</th><th>Source</th><th>Access</th></tr></thead><tbody>${SOURCES.map(([d, src, k]) => `<tr><td>${d}</td><td class="muted">${src}</td><td class="muted">${k}</td></tr>`).join("")}</tbody>`;
  const [acc, st] = await Promise.all([fetch("/api/accuracy").then((r) => r.json()).catch(() => null), signalsData()]);
  $("m-accuracy").innerHTML = accuracyHtml(acc);
  $("m-signals").innerHTML = signalsHtml(st);
}

// The paper agent: its result against buying everything, the diary and every trade
const EXIT = { take_profit: ["2x, took profit", "good"], stop_loss: ["-50%, cut", "bad"], dev_sold: ["developer sold", "warn"], pool_gone: ["pool gone", "bad"], time: ["held a day", ""] };
for (const v of Object.values(EXIT)) v[0] = t(v[0]);
const signed = (n) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n) >= 1000 ? fmt(Math.abs(n)) : Math.abs(n).toFixed(2)}`);
const tone = (n) => (n == null ? "" : n > 0 ? "good" : n < 0 ? "hot" : "");

async function agent() {
  mode("agent");
  $("agentBody").innerHTML = `<p class="empty"><span class="spin sm"></span> Loading…</p>`;
  const v = await fetch("/api/agent").then((r) => r.json()).catch(() => null);
  if (document.body.className !== "agent") return;
  if (!v) return ($("agentBody").innerHTML = `<p class="empty">Could not load the agent.</p>`);
  const a = v.agent, n = v.naive, total = a.realized + a.open;
  const R = v.rules;
  $("agentBody").innerHTML = `
    <div class="tiles ag-tiles">
      ${kv("Agent", signed(total), tone(total))}${kv("Buying everything", signed(n.result), tone(n.result))}
      ${kv("Staked", `$${fmt(a.staked)}`)}${kv("Won", a.closed ? `${a.wins}/${a.closed}` : "—")}
    </div>
    <p class="ag-note">${t("Paper since {date}. Agent: closed trades {closed}, open ones {open} at the last hourly price. Baseline: {tokens} held a full day, $100 each. Both pay {fee}% each way for fees and slippage.", { date: new Date(v.since * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }), closed: signed(a.realized), open: signed(a.open), tokens: plural(n.judged, "token"), fee: Math.round(R.fee * 100) })}</p>
    <div class="sec-h"><h2>Diary</h2><span class="sec-n">one entry per day, with a post for X</span></div>
    ${v.diary.length ? `<div class="card diary">${v.diary.map((d, i) => `
      <div class="dy"><div class="dy-h"><b>${esc(d.day)}</b><span class="${tone(d.agent)}">${signed(d.agent)}</span><span class="muted">${t("vs")} ${signed(d.naive)}</span><button data-post="${i}">Copy post</button></div><p>${esc(d.text.replace(/^\d{4}-\d\d-\d\d\. /, ""))}</p></div>`).join("")}</div>`
      : `<p class="empty">The first entry is written after the first full day of trading.</p>`}
    <div class="sec-h"><h2>Trades</h2><span class="sec-n">${t("{tokens} seen", { tokens: plural(v.trades.length, "token") })}</span></div>
    ${v.trades.length ? `<div class="card"><table class="tbl zebra t-agent"><thead><tr><th>Bought</th><th>Token</th><th class="r">Risk</th><th class="r">Stake</th><th class="r">Entry FDV</th><th class="r">Exit / now</th><th>Why out</th><th class="r">Agent</th><th class="r">Baseline</th></tr></thead><tbody>
      ${v.trades.map((t) => `<tr data-check="${esc(t.check)}"><td class="time">${ago(t.openedAt)}</td><td>${tokImg("solana", t.mint)}<b class="sym">${esc(t.symbol)}</b></td>
        <td class="r">${riskC(t)}</td>
        <td class="r mono">${t.stake ? `$${t.stake}` : `<span class="muted" title="${esc(t.skip ?? "")}">skipped</span>`}</td>
        <td class="r mono">${usd(t.entryFdv)}</td><td class="r mono">${usd(t.exitFdv ?? t.lastFdv)}</td>
        <td>${t.exit ? `<span class="chip-s ${EXIT[t.exit][1]}"><b>${EXIT[t.exit][0]}</b></span>` : t.stake ? `<span class="muted">open</span>` : `<span class="muted">${esc(t.skip ?? "")}</span>`}</td>
        <td class="r mono ${tone(t.pnl)}">${t.stake ? signed(t.pnl) : ""}</td><td class="r mono ${tone(t.naivePnl)}">${signed(t.naivePnl)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">No trades yet. The agent buys from the tokens the sampler checks every few hours.</p>`}
    <div class="sec-h"><h2>Rules</h2><span class="sec-n">hand-set for now, tuned on the signal table later</span></div>
    <div class="card how">
      <div class="hrow"><span class="k">Buy</span><p>${t("Every sampled token the check does not call high risk, with a pool of at least ${liq}. Stake: ${stake} × (1 − risk / 100), at least ${min}.", { liq: fmt(R.minLiquidity), stake: R.stake, min: R.minStake })}</p></div>
      <div class="hrow"><span class="k">Sell</span><p>${t("At {tp}x, at −{sl}%, when the developer's wallets dumped {dev}% of what they held at the check, when the pool is gone, or after {h} hours. Prices are looked at hourly.", { tp: R.takeProfit, sl: Math.round(R.stopLoss * 100), dev: Math.round(R.devSold * 100), h: R.holdH })}</p></div>
    </div>`;
  for (const b of $("agentBody").querySelectorAll("[data-post]")) b.onclick = async () => {
    await navigator.clipboard.writeText(`${v.diary[b.dataset.post].post}\n\n${location.origin}/?agent`).catch(() => {});
    b.textContent = "Copied";
  };
  for (const tr of $("agentBody").querySelectorAll("tr[data-check]")) tr.onclick = () => openCheck(tr.dataset.check);
}

// Rings: every known pump ring, how it launches, what it pumped and how that ended
const STATUS = { alive: [t("alive"), "good"], drained: [t("drained"), "warn"], dead: [t("dead"), "bad"] };
const ringTokens = (r) => r.tokens.forEach((t) => (t.status ??= t.dead ? "dead" : "alive"));
const ringName = (r) => t("Ring {id}", { id: short(r.id) });
const endedBadly = (r) => r.tokens.filter((t) => t.status !== "alive").length;
const playLine = (p) => t("Developer gets exactly {amount} SOL minutes before launching on {pad}, each time from a different funder", { amount: p.amount, pad: p.launchpad });

async function rings() {
  mode("rings");
  $("ringsBody").innerHTML = `<p class="empty"><span class="spin sm"></span> Loading…</p>`;
  const rs = await fetch("/api/rings").then((r) => r.json()).catch(() => []);
  if (document.body.className !== "rings") return;
  rs.forEach(ringTokens);
  $("ringsBody").innerHTML = rs.length
    ? `<div class="ring-grid">${rs.map((r) => `
      <div class="card ring-c" data-ring="${esc(r.id)}">
        <div class="rc-h"><span class="rc-tag">RING</span><code>${esc(short(r.id))}</code><small>${t("seen {ago}", { ago: ago(r.lastSeen) })}</small></div>
        <div class="tiles rc-stats">${kv("Wallets", r.nWallets)}${kv("Funders", r.nFunders)}${kv("Tokens", r.tokens.length)}${kv("Ended badly", `${endedBadly(r)}/${r.tokens.length}`, endedBadly(r) ? "hot" : "")}</div>
        <div class="rc-toks">${r.tokens.map((t) => `<span class="rt ${STATUS[t.status][1]}">${tokImg("solana", t.mint, "ti sm")}${esc(t.symbol)}<i>${STATUS[t.status][0]}</i></span>`).join("")}</div>
        ${(r.playbook ?? []).map((p) => `<p class="rc-play"><b>Playbook</b> ${p.amount} SOL → ${esc(p.launchpad)}</p>`).join("")}
      </div>`).join("")}</div>`
    : `<p class="empty">${t("No rings found yet. The daily smart money scan (<code>npm run smart</code>) adds every ring it catches here.")}</p>`;
  for (const c of $("ringsBody").querySelectorAll("[data-ring]")) c.onclick = () => openRing(c.dataset.ring);
}

function openRing(id) {
  history.pushState(null, "", `?ring=${id}`);
  showRing(id);
}

async function showRing(id) {
  mode("rings");
  const r = await fetch(`/api/ring/${id}`).then((x) => x.json()).catch(() => ({ error: 1 }));
  if (r.error) return rings();
  ringTokens(r);
  const bad = endedBadly(r);
  $("ringsBody").innerHTML = `
    <div class="card thero ${bad ? "high" : "medium"} ring-hero">
      <div class="th-id"><div class="th-img th-ava">⛓</div><div class="th-names"><div class="th-name"><b>${esc(ringName(r))}</b><span>pump ring</span></div>
        <div class="th-meta">${chainName("solana")}<span>${t("first seen {ago}", { ago: ago(r.firstSeen) })}</span><span>${t("last seen {ago}", { ago: ago(r.lastSeen) })}</span></div></div></div>
      <div class="th-kv rh-kv">${kv("Wallets", r.wallets.length)}${kv("Funders", r.funders.length)}${kv("Tokens pumped", r.tokens.length)}${kv("Dead or drained", `${bad}/${r.tokens.length}`, bad ? "hot" : "")}</div>
      <p class="th-line">${t("A ring of {wallets} paid by {funders} bought early into {tokens}{bad}.", { wallets: plural(r.wallets.length, "wallet"), funders: plural(r.funders.length, "different funder"), tokens: list(r.tokens.map((x) => x.symbol)), bad: bad ? t("; {bad} of {n} are now dead or drained", { bad, n: r.tokens.length }) : "" })}</p>
      <div class="th-acts"><button id="ringBack">All rings</button><button class="main" id="shareRing">Share</button></div>
    </div>
    ${(r.playbook ?? []).length ? `<div class="sec-h"><h2>Playbook</h2><span class="sec-n">how its launches are set up</span></div>
      <div class="card how">${r.playbook.map((p) => `<div class="hrow"><span class="k">${esc(p.launchpad)}</span><p>${t("{line}. A new launch funded this way is flagged by the token check before the ring buys in.", { line: esc(playLine(p)) })}</p></div>`).join("")}</div>` : ""}
    <div class="sec-h"><h2>Tokens it pumped</h2><span class="sec-n">peak from hourly candles, now from DexScreener</span></div>
    <div class="card"><table class="tbl zebra t-ring"><thead><tr><th>Token</th><th class="r">Peak</th><th class="r">Now</th><th class="r">Liquidity</th><th>Status</th></tr></thead><tbody>
      ${r.tokens.map((t) => `<tr data-life="${esc(t.mint)}"><td>${tokImg("solana", t.mint)}<a target="_blank" href="https://dexscreener.com/solana/${esc(t.mint)}"><b class="sym">${esc(t.symbol)}</b></a> <span class="q muted">${esc(short(t.mint))}</span></td>
        <td class="r mono peak"><span class="spin sm"></span></td><td class="r mono">${usd(t.fdv)}</td><td class="r mono">${usd(t.liq)}</td>
        <td><span class="chip-s ${STATUS[t.status][1]}"><b>${STATUS[t.status][0]}</b></span></td></tr>`).join("")}
    </tbody></table></div>
    ${r.caught?.length ? `<div class="sec-h"><h2>Caught in token checks</h2><span class="sec-n">${plural(r.caught.length, "check")}</span></div>
      <div class="card"><table class="tbl zebra t-checks"><thead><tr><th>Time</th><th>Token</th><th class="r">Risk</th></tr></thead><tbody>
      ${r.caught.map((c) => `<tr data-check="${esc(c.id)}"><td class="time">${ago(c.checkedAt)}</td><td>${tokImg(c.chain, c.mint)}<b class="sym">${esc(c.symbol)}</b></td><td class="r">${riskC(c)}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
    <div class="grid2 ring-lists">
      <div class="col"><div class="sec-h"><h2>Wallets</h2><span class="sec-n">${r.wallets.length}</span></div>
        <div class="card addr-list">${r.wallets.map((w) => `<a target="_blank" href="${addrUrl("solana", w)}"><code>${esc(w)}</code><span>↗</span></a>`).join("")}</div></div>
      <div class="col"><div class="sec-h"><h2>Funders</h2><span class="sec-n">${r.funders.length}</span></div>
        <div class="card addr-list">${r.funders.map((w) => `<a target="_blank" href="${addrUrl("solana", w)}"><code>${esc(w)}</code><span>↗</span></a>`).join("")}</div></div>
    </div>`;
  $("ringBack").onclick = () => {
    history.pushState(null, "", "?rings");
    rings();
  };
  for (const tr of $("ringsBody").querySelectorAll("tr[data-check]")) tr.onclick = () => openCheck(tr.dataset.check);
  $("shareRing").onclick = async () => openShare(await ringCard(r), `${t("A pump ring of {w} wallets ({f} funders) pumped {tokens}. {bad} of {n} now dead or drained.", { w: r.wallets.length, f: r.funders.length, tokens: list(r.tokens.map((x) => `$${x.symbol}`)), bad, n: r.tokens.length })}\n\n${location.href}`, `tracehound-ring-${short(r.id)}`);
  // Peaks load one token at a time (GeckoTerminal allows about 30 calls a minute)
  for (const tr of $("ringsBody").querySelectorAll("tr[data-life]")) {
    const l = await fetch(`/api/life?mint=${tr.dataset.life}`).then((x) => x.json()).catch(() => ({}));
    if (!document.body.contains(tr)) return;
    tr.querySelector(".peak").textContent = l.peak ? usd(l.peak) : "—";
  }
}

async function ringCard(r) {
  const { cv, ctx } = await cardBase();
  const bad = endedBadly(r);
  text(ctx, t("PUMP RING · SOLANA"), 56, 140, `400 15px ${MONO}`, "#8f95a8");
  text(ctx, ringName(r), 56, 196, `600 46px ${SANS}`, "#ffffff");
  ctx.font = `300 21px ${SANS}`;
  wrap(ctx, t("{w} wallets paid by {f} different funders, early in the same tokens and in almost nothing else.", { w: r.wallets.length, f: r.funders.length }), 500, 3)
    .forEach((l, i) => text(ctx, l, 56, 244 + i * 29, `300 21px ${SANS}`, "#c3c8d4"));
  [["WALLETS", r.wallets.length], ["FUNDERS", r.funders.length], ["DEAD / DRAINED", `${bad}/${r.tokens.length}`]].forEach(([k, v], i) => {
    text(ctx, t(k), 56 + i * 170, 400, `400 14px ${MONO}`, "#8f95a8");
    text(ctx, String(v), 56 + i * 170, 446, `300 40px ${SANS}`, k.startsWith("DEAD") && bad ? "#ff5d6c" : "#ededed");
  });
  const p = r.playbook?.[0];
  if (p) {
    text(ctx, t("PLAYBOOK"), 56, 520, `400 14px ${MONO}`, "#8f95a8");
    ctx.font = `400 19px ${SANS}`;
    wrap(ctx, t("{amount} SOL to a fresh developer wallet minutes before each launch on {pad}", { amount: p.amount, pad: p.launchpad }), 500, 2).forEach((l, i) => text(ctx, l, 56, 550 + i * 27, `400 19px ${SANS}`, "#ffb547"));
  }
  rrect(ctx, 600, 112, 544, 520, 12);
  ctx.fillStyle = "#10111a";
  ctx.fill();
  ctx.strokeStyle = "#272c3a";
  ctx.stroke();
  text(ctx, t("TOKENS IT PUMPED"), 632, 156, `400 15px ${MONO}`, "#8f95a8");
  let y = 196;
  for (const t of r.tokens.slice(0, 7)) {
    const pic = new Image();
    pic.src = imgUrl("solana", t.mint);
    if (await pic.decode().then(() => true, () => false)) {
      ctx.save();
      rrect(ctx, 632, y - 26, 36, 36, 18);
      ctx.clip();
      ctx.drawImage(pic, 632, y - 26, 36, 36);
      ctx.restore();
    }
    text(ctx, `$${t.symbol}`, 684, y, `500 22px ${SANS}`, "#ffffff");
    text(ctx, t.fdv != null ? `$${fmt(t.fdv)}` : "—", 860, y, `400 18px ${MONO}`, "#c3c8d4");
    const [label] = STATUS[t.status];
    text(ctx, label.toUpperCase(), 1010, y, `500 16px ${MONO}`, { alive: "#3ccf8e", drained: "#ffb547", dead: "#ff5d6c" }[t.status]);
    y += 60;
  }
  return cv;
}

async function tokens() {
  mode("tokens");
  $("tok").classList.remove("has-result");
  const [rows, acc] = await Promise.all([fetch("/api/tokens").then((r) => r.json()).catch(() => []), fetch("/api/accuracy").then((r) => r.json()).catch(() => null)]);
  if (document.body.className !== "tokens" || new URLSearchParams(location.search).has("token")) return;
  const watching = watchList();
  $("tbody").innerHTML = `
    ${watching.length ? `<div class="sec-h"><h2>Watching</h2><span class="sec-n">checks every 2 min while the site is open</span></div>
    <div class="card"><table class="tbl zebra t-watch"><thead><tr><th>Token</th><th class="r">Dev wallets hold</th><th class="r">FDV now</th><th>Last alert</th></tr></thead><tbody>
      ${watching.map((w) => `<tr data-check="${esc(w.id)}"><td>${tokImg(w.chain ?? (w.mint.startsWith("0x") ? "bsc" : "solana"), w.mint)}<b class="sym">${esc(w.symbol)}</b> <span class="q muted">${esc(short(w.mint))}</span></td>
        <td class="r mono">${w.last ? fmt(w.last.held) : "…"}</td><td class="r mono">${w.last ? usd(w.last.fdv) : "…"}</td><td class="lead">${w.alerts?.[0] ? `${ago(w.alerts[0].at)}: ${esc(w.alerts[0].t)}` : "—"}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <div class="sec-h"><h2>Accuracy</h2><span class="sec-n">${t("value {h} h after the first check", { h: acc?.horizonH ?? 24 })}</span></div>
    <div class="card">${accuracyHtml(acc)}</div>
    <div class="sec-h"><h2>Signals</h2><span class="sec-n">which reasons came true</span></div>
    <div class="card" id="tokSignals"><p class="empty">Loading…</p></div>
    <div class="sec-h"><h2>Recent Checks</h2><span class="sec-n">${rows.length ? t("{n} shown", { n: rows.length }) : ""}</span></div>
    <div class="card"><table class="tbl zebra t-checks">
      <thead><tr><th>Time</th><th>Token</th><th class="r">Risk</th><th class="r">FDV</th><th>Main reason</th></tr></thead>
      <tbody>${rows.length
        ? rows.map((r) => `<tr data-check="${esc(r.id)}">
            <td class="time">${ago(r.checkedAt)}</td>
            <td>${tokImg(r.chain, r.mint)}<b class="sym">${esc(r.symbol)}</b> <span class="q muted">${esc(short(r.mint))}</span>${r.chain && r.chain !== "solana" ? ` <span class="q muted">${esc(CHAINS[r.chain]?.[1] ?? r.chain)}</span>` : ""}</td>
            <td class="r">${riskC(r)}</td>
            <td class="r mono">${usd(r.fdv)}</td>
            <td class="lead">${esc(r.top ? tf(r.top) : t("Nothing suspicious found"))}</td></tr>`).join("")
        : `<tr><td colspan="5" class="muted">Nothing checked yet. Paste a token mint above.</td></tr>`}</tbody>
    </table></div>`;
  for (const tr of $("tbody").querySelectorAll("tr[data-check]")) tr.onclick = () => openCheck(tr.dataset.check);
  signalsData().then((st) => $("tokSignals") && ($("tokSignals").innerHTML = signalsHtml(st)));
}

function checkStart(mint, fresh = false) {
  $("tok").classList.remove("has-result");
  tes?.close();
  clearInterval(ttimer);
  history.pushState(null, "", "?tokens");
  mode("tokens");
  $("tq").value = mint;
  $("tgo").disabled = true;
  $("tbody").innerHTML = `<div class="card running"><div class="run-h"><span class="spin"></span><span>Checking <code>${esc(short(mint))}</code></span><span class="muted" id="ttimer">0s</span></div><div id="tsteps" class="stepper"></div><pre id="tlog"></pre></div>`;
  const t0 = Date.now();
  ttimer = setInterval(() => $("ttimer") && ($("ttimer").textContent = `${Math.round((Date.now() - t0) / 1000)}s`), 500);
  const step = stepper($("tsteps"), CHECK_STEPS);
  buddy("sniff");
  const line = (s) => {
    step(s);
    if ($("tlog")) $("tlog").textContent += `${s}\n`;
  };
  const end = () => {
    tes?.close();
    clearInterval(ttimer);
    $("tgo").disabled = false;
    document.querySelector(".running .spin")?.remove();
    if (buddyState === "sniff") buddy("idle");
  };
  tes = new EventSource(`/api/token?${new URLSearchParams({ mint, ...(fresh ? { fresh: 1 } : {}) })}`);
  tes.addEventListener("log", (e) => line(JSON.parse(e.data)));
  tes.addEventListener("done", (e) => {
    end();
    ranCheck = true;
    openCheck(JSON.parse(e.data));
  });
  tes.addEventListener("fail", (e) => {
    line(`✖ ${JSON.parse(e.data)}`);
    end();
  });
  tes.onerror = () => end();
}

function openCheck(id) {
  history.pushState(null, "", `?token=${id}`);
  showCheck(id);
}

// What a trader reads first. Older checks keep some numbers only in their log, so those are read from there.
function checkFacts(c) {
  const log = c.log.join("\n");
  const num = (re) => {
    const m = log.match(re);
    return m ? Number(m[1]) : null;
  };
  const titles = c.reasons.map((r) => r.title).join(" | ");
  const tnum = (re) => {
    const m = titles.match(re);
    return m ? Number(m[1]) : null;
  };
  const bundle = (c.events ?? []).filter((e) => e.kind === "bundle_buy").reduce((s, e) => s + (e.amount ?? 0), 0);
  return {
    evm: (c.chain ?? "solana") !== "solana",
    devBuy: num(/dev bought ([\d.]+)% in the launch tx/),
    devSold: tnum(/sold (\d+)% of the launch bag/),
    devNow: num(/developer ([\d.]+)%, developer's circle/) ?? num(/creator ([\d.]+)%/),
    top10: num(/top-10 wallets hold ([\d.]+)%/) ?? num(/top holders that are people hold ([\d.]+)%/),
    snipers: num(/(\d+) wallet\(s\) bought within/),
    // The bundle reason counts the developer's own launch buy with the linked buyers; events hold only the buyers
    bundled: (() => {
      const m = c.reasons.map((r) => r.detail.match(/bought ([\d.]+)% of supply at launch/)).find(Boolean);
      if (m) return Number(m[1]);
      // On Base and BSC early buyers are only known when the trade list reached the launch
      if ((c.chain ?? "solana") !== "solana" && !bundle) return null;
      return c.supply && c.events ? (bundle / c.supply) * 100 : null;
    })(),
    fresh: c.locked ? c.locked.fresh : (c.holders ?? []).filter((h) => h.tags.includes("fresh")).length,
    mint: /can still mint|owner can mint/i.test(titles),
    freeze: /can be frozen/i.test(titles),
    honeypot: /cannot sell|honeypot/i.test(titles),
    ring: /pump ring|ring's playbook|same ring/i.test(titles),
    farm: /launched \d+ other token/i.test(titles),
    bots: /bot-made/i.test(titles),
    smart: (c.signals ?? []).some((s) => s.tone === "good" && /smart money/.test(s.text)),
  };
}

// The row of signals: each a short fact coloured good, watch or bad
function signalChips(c, f) {
  const pct = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
  const chips = [];
  const add = (label, value, tone, tip) => chips.push(`<span class="chip-s ${tone}" title="${esc(tip ?? "")}"><i>${tone === "good" ? "✓" : tone === "bad" ? "✕" : "!"}</i>${label}<b>${value}</b></span>`);
  if (f.evm) add("Sellable", f.honeypot ? "no" : "yes", f.honeypot ? "bad" : "good", "GoPlus simulated a sale");
  if (f.devBuy != null) add("Dev bought", pct(f.devBuy), f.devBuy >= 10 ? "warn" : "good", "Share of supply the developer bought in the launch tx");
  if (f.devSold != null) add("Dev sold", `${f.devSold}%`, "good", "Of the bag bought at launch: what the developer sold can no longer be dumped on holders");
  else if (f.devNow != null) add("Dev holds", pct(f.devNow), f.devNow >= 10 ? "bad" : f.devNow >= 5 ? "warn" : "good");
  if (f.bundled != null) add("Bundled", f.bundled ? pct(f.bundled) : "none", f.bundled >= 10 ? "bad" : f.bundled > 0 ? "warn" : "good", "Bought at launch by wallets funded from the developer's circle");
  if (f.snipers != null) add("Snipers", f.snipers, f.snipers >= 5 ? "warn" : "good", "Wallets that bought within 2 slots of the launch");
  if (f.top10 != null) add("Top 10", pct(f.top10), f.top10 >= 50 ? "bad" : f.top10 >= 30 ? "warn" : "good", "Pools and program accounts excluded");
  if (c.holders?.length || c.locked?.holders) add("Fresh holders", f.fresh, f.fresh >= 4 ? "warn" : "good", "Top holders whose wallets are under a day old");
  if (c.liquidity) add("Liquidity", c.liquidity.kind === "locked" ? "locked" : c.liquidity.kind === "pullable" ? "pullable" : "unknown", c.liquidity.kind === "locked" ? "good" : c.liquidity.kind === "pullable" ? "bad" : "warn", tf(c.liquidity.note));
  add(f.evm ? "Mint" : "Mint auth", f.mint ? "active" : "off", f.mint ? "bad" : "good");
  if (!f.evm) add("Freeze auth", f.freeze ? "active" : "off", f.freeze ? "bad" : "good");
  if (!f.evm) add("Launch farm", f.farm ? "yes" : "no", f.farm ? "bad" : "good", "The developer's circle launched tokens that are now dead");
  add("Pump ring", f.ring ? "linked" : "none", f.ring ? "bad" : "good");
  if (c.trading) add("Bot trading", f.bots ? "yes" : "no", f.bots ? "warn" : "good");
  if (f.smart) add("Smart money", "in", "good");
  return chips.join("");
}

// One sentence on what happened, from the strongest facts
function verdictLine(c, f) {
  if (f.honeypot) return t("Holders cannot sell this token.");
  const did = [];
  if (f.bundled > 0) did.push(t("bundled {pct}% at launch", { pct: f.bundled.toFixed(1) }));
  if (f.devSold >= 90) did.push(t("already sold the whole launch bag"));
  if (f.farm) did.push(t("runs a launch farm"));
  if (f.ring) did.push(t("is tied to a pump ring"));
  if (f.mint) did.push(t("can still mint"));
  if (did.length) return t("The developer {did}.", { did: list(did) });
  return c.reasons[0] ? `${tf(c.reasons[0].title)}.` : t("Nothing suspicious found.");
}

// Risk as a thin half-ring: a quiet track, the filled part in the verdict's colour, the score in the middle
function gauge(risk, verdict) {
  const col = { high: "#ff5d6c", medium: "#ffb547", low: "#3ccf8e" }[verdict];
  const pt = (v) => {
    const a = Math.PI * (1 - v / 100);
    return `${(60 + 48 * Math.cos(a)).toFixed(2)} ${(58 - 48 * Math.sin(a)).toFixed(2)}`;
  };
  const end = Math.max(0.5, Math.min(100, risk));
  return `<svg class="gauge" viewBox="0 0 120 66" aria-hidden="true">
    <path d="M ${pt(0)} A 48 48 0 0 1 ${pt(100)}" stroke="#ffffff14" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M ${pt(0)} A 48 48 0 0 1 ${pt(end)}" stroke="${col}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <text x="60" y="54" text-anchor="middle" fill="${col}" font-family="Inter Tight, sans-serif" font-weight="300" font-size="30">${risk}</text></svg>`;
}

// Launch tape: what happened after the token was created, on a log time scale so seconds and days both fit
function launchTape(c) {
  const ev = c.events ?? [];
  const t0 = ev.find((e) => e.kind === "launch")?.ts ?? c.createdAt;
  if (!t0 || ev.length < 2) return "";
  const supply = c.supply || 1;
  const f = checkFacts(c);
  const marks = [{ dt: 0, kind: "launch", text: f.devBuy != null ? t("Created · dev bought {pct}%", { pct: f.devBuy.toFixed(1) }) : t("Created"), hash: ev.find((e) => e.kind === "launch")?.hash }];
  const by = (kind, text) => {
    const groups = new Map();
    for (const e of ev.filter((e) => e.kind === kind)) {
      const k = Math.floor((e.ts - t0) / 30); // within 30 s counts as one move
      const g = groups.get(k) ?? { dt: e.ts - t0, amt: 0, n: 0, hash: e.hash };
      g.amt += e.amount ?? 0;
      g.n++;
      groups.set(k, g);
    }
    for (const g of groups.values()) marks.push({ dt: Math.max(0, g.dt), kind, text: text(g), hash: g.hash });
  };
  by("bundle_buy", (g) => `${plural(g.n, "bundled buy")} · ${((g.amt / supply) * 100).toFixed(1)}%`);
  by("dev_sell", (g) => t(g.n > 1 ? "Dev sold {pct}% in {n} txs" : "Dev sold {pct}%", { pct: ((g.amt / supply) * 100).toFixed(1), n: g.n }));
  marks.push({ dt: c.checkedAt - t0, kind: "check", text: t("Checked") });
  const span = Math.max(...marks.map((m) => m.dt), 60);
  const x = (dt) => (Math.log10(1 + dt) / Math.log10(1 + span)) * 100;
  const when = (dt) => (dt < 1 ? "+0s" : dt < 90 ? `+${Math.round(dt)}s` : `+${age(dt)}`);
  marks.sort((a, b) => a.dt - b.dt);
  return `<div class="card tape"><div class="tape-h"><span>Launch tape</span><small>log time since creation</small></div><div class="tape-track">
    ${marks.map((m, i) => `<div class="tm ${m.kind} ${i % 2 ? "down" : "up"}" style="left:${x(m.dt).toFixed(2)}%">${m.hash ? `<a target="_blank" href="${txUrl(tokChain, m.hash)}">` : "<span>"}<b>${when(m.dt)}</b>${esc(m.text)}${m.hash ? "</a>" : "</span>"}</div>`).join("")}
  </div></div>`;
}

// Live price and a 24 h sparkline in the header, fetched after the page is drawn
async function liveMarket(c) {
  const ch = c.chain ?? "solana";
  const p = (await fetch(`https://api.dexscreener.com/tokens/v1/${ch}/${c.mint}`).then((r) => r.json()).catch(() => []))
    ?.filter((x) => x.baseToken?.address?.toLowerCase() === c.mint.toLowerCase())
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!$("thMkt")) return;
  const chg = (v) => (v == null ? "—" : `<em class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</em>`);
  if (p) $("thMkt").innerHTML = kv("FDV now", usd(p.fdv ?? p.marketCap)) + kv("1h", chg(p.priceChange?.h1)) + kv("24h", chg(p.priceChange?.h24)) + kv("Liquidity", usd(p.liquidity?.usd));
  if (!c.market.pair) return;
  // Last 24 h in hourly candles; a thinly traded token has few of those, so 15-minute candles then
  const candles = (tf, agg, n) => fetch(ohlcvUrl(ch, c.market.pair, tf, agg, n))
    .then((r) => r.json()).then((j) => (j?.data?.attributes?.ohlcv_list ?? []).map((r) => r[4]).reverse()).catch(() => []);
  let rows = await candles("hour", 1, 24);
  if (rows.length < 6) rows = await candles("minute", 15, 96);
  if (rows.length < 2 || !$("thSpark")) return;
  const lo = Math.min(...rows), hi = Math.max(...rows);
  const pts = rows.map((v, i) => `${((i / (rows.length - 1)) * 160).toFixed(1)},${(36 - ((v - lo) / (hi - lo || 1)) * 32).toFixed(1)}`).join(" ");
  const up = rows[rows.length - 1] >= rows[0];
  $("thSpark").innerHTML = `<polyline points="${pts}" fill="none" stroke="${up ? "#3ccf8e" : "#ff5d6c"}" stroke-width="1.6" stroke-linejoin="round"/><polyline points="0,38 ${pts} 160,38" fill="${up ? "#3ccf8e18" : "#ff5d6c18"}" stroke="none"/>`;
}

async function showCheck(id) {
  mode("tokens");
  await meReady;
  const c = await getJson(`/api/check/${id}`);
  if (c.error) {
    buddy("idle", c.error === "network" ? t("No connection, try again") : t("Check not found"), 3500);
    return tokens();
  }
  checkNow = { ...c, id };
  reactCheck(c, ranCheck);
  ranCheck = false;
  tokChain = c.chain ?? "solana";
  $("tq").value = c.mint;
  const now = Date.now() / 1000;
  const reasons = c.reasons.map((r) => `
    <div class="reason ${r.points >= 25 ? "high" : r.points >= 10 ? "medium" : ""}" ${r.signal ? `data-signal="${esc(r.signal)}"` : ""}>
      <span class="pts ${r.points >= 25 ? "high" : r.points >= 10 ? "medium" : ""}">+${r.points}</span>
      <div>
        <div class="f-title">${esc(tf(r.title))}</div>
        <p class="f-detail">${esc(r.detail)}</p>
        ${r.signal ? `<p class="sig-rate"></p>` : ""}
        ${r.addresses.length || r.txs.length ? `<div class="f-links">${r.addresses.slice(0, 8).map((a) => sol(a)).join("")}${r.txs.slice(0, 3).map((h) => `<a target="_blank" href="${txUrl(tokChain, h)}">TX ${esc(short(h))} ↗</a>`).join("")}</div>` : ""}
      </div>
    </div>`).join("");
  const signals = (c.signals ?? []).map((s) => `<div class="signal ${s.tone}"><i></i><span>${esc(tf(s.text))}</span></div>`).join("");
  const tr0 = c.trading;
  const so = c.socials ?? {};
  const social = [
    so.twitter && `<a target="_blank" href="https://x.com/${so.twitter.startsWith("community/") ? `i/communities/${so.twitter.slice(10)}` : so.twitter}">X ${esc(so.twitter.startsWith("community/") ? "community" : `@${so.twitter}`)} ↗</a>`,
    so.telegram && `<a target="_blank" href="https://t.me/${esc(so.telegram)}">Telegram ↗</a>`,
    so.website && `<a target="_blank" href="https://${esc(so.website)}">${esc(so.website)} ↗</a>`,
  ].filter(Boolean).join("");
  const has = { chart: !!c.market.pair, holders: !!(c.holders?.length || c.locked?.holders), launches: !!(c.launches?.length || c.locked?.launches) };
  // Free plan: the same verdict and reasons; the holder map, past launches and chart are shown as locked tabs
  const locked = !isPaid();
  const lockTag = locked ? ` <span class="lock">${t("Standard")}</span>` : "";
  const f = checkFacts(c);
  const img = imgUrl(tokChain, c.mint);
  $("tok").classList.add("has-result");
  $("tbody").innerHTML = `
    <div class="card thero ${c.verdict}">
      <div class="th-id">
        ${img ? `<img class="th-img" src="${esc(img)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'th-img th-ava',textContent:'${esc(c.symbol.slice(0, 1).toUpperCase())}'}))" />` : `<div class="th-img th-ava">${esc(c.symbol.slice(0, 1).toUpperCase())}</div>`}
        <div class="th-names">
          <div class="th-name"><b>${esc(c.symbol)}</b>${c.name ? `<span>${esc(c.name)}</span>` : ""}</div>
          <div class="th-meta">${chainName(tokChain)}<code class="h" data-copy="${esc(c.mint)}" title="Copy the address">${esc(short(c.mint))}</code>${c.createdAt ? `<span>${t("{age} old", { age: age(now - c.createdAt) })}</span>` : ""}</div>
        </div>
      </div>
      <div class="th-market"><div class="th-kv" id="thMkt">${kv("FDV at check", usd(c.market.fdv))}${kv("Liquidity", usd(c.market.liquidityUsd))}</div><svg id="thSpark" class="spark" viewBox="0 0 160 38" preserveAspectRatio="none"></svg></div>
      <div class="th-verdict">${gauge(c.risk, c.verdict)}<span class="th-label ${c.verdict}">${VERDICT[c.verdict]}</span></div>
      <p class="th-line">${esc(verdictLine(c, f))}</p>
      <div class="th-acts">
        <details class="more tracem" id="traceM"><summary class="main">Trace ▾</summary><div class="more-m" id="traceL"></div></details>
        ${c.clusterHold ? `<button id="watch">${watched(id) ? "Watching ✓" : "Watch"}</button>` : ""}
        <button id="shareTok">Share</button>
        <details class="more"><summary title="More">⋯</summary><div class="more-m">
          ${c.market.url ? `<a target="_blank" href="${esc(c.market.url)}">DexScreener ↗</a>` : ""}
          <a target="_blank" href="${addrUrl(tokChain, c.mint)}">Explorer ↗</a>
          <a href="/api/check/${id}.md?download" ${locked ? "data-upsell" : ""}>Export .md</a>
          <button id="tokPdf" ${locked ? "data-upsell" : ""}>Print / PDF</button>
          <button id="recheck" ${locked ? "data-upsell" : ""}>Check again</button>
        </div></details>
      </div>
    </div>
    <div class="chips-s">${signalChips(c, f)}</div>
    ${launchTape(c)}
    <div class="tok-grid">
      <div class="col">
        <div id="watchBox"></div>
        <div class="card tiles">
          ${kv("FDV at check", usd(c.market.fdv))}${kv("Liquidity at check", usd(c.market.liquidityUsd))}
          ${kv("Age at check", c.createdAt ? age(c.checkedAt - c.createdAt) : "—")}${kv("Checked", ago(c.checkedAt))}
        </div>
        <div class="card dev">
          <div class="drow"><span>Developer</span><b>${c.dev ? sol(c.dev) : "unknown"}</b></div>
          <div class="drow"><span>Funded by</span><b>${c.devFunder ? sol(c.devFunder) : tokChain === "solana" ? "unknown" : `<span class="muted">${t("not checked on {chain}", { chain: CHAINS[tokChain][1] })}</span>`}</b></div>
          <div class="drow"><span>Developer's wallets</span><b>${c.cluster.length}</b></div>
          <div class="drow"><span>They hold now</span><b class="${c.clusterPct >= 10 ? "warn" : ""}">${c.clusterPct.toFixed(1)}%</b></div>
          ${c.liquidity ? `<div class="drow"><span>Liquidity</span><b class="${c.liquidity.kind === "locked" ? "ok" : c.liquidity.kind === "pullable" ? "warn" : ""}">${c.liquidity.kind === "locked" ? "Locked" : c.liquidity.kind === "pullable" ? "Can be pulled" : "Unknown"}</b></div>` : ""}
          ${tr0 ? `<div class="drow"><span>${t("Last {n} trades", { n: tr0.txs })}</span><b>${t("{buys} buys · {sells} sells · {traders} wallets", { buys: tr0.buys, sells: tr0.sells, traders: tr0.traders })}</b></div>
                 <div class="drow"><span>Bought and sold back</span><b class="${tr0.roundTrip >= 0.6 ? "warn" : ""}">${t("{pct}% of trades", { pct: Math.round(tr0.roundTrip * 100) })}</b></div>` : ""}
          ${c.socials ? `<div class="drow"><span>Links</span><b class="soc">${social || `<span class="muted">none of its own</span>`}</b></div>` : ""}
        </div>
      </div>
      <div class="col">
        <nav class="tabs ttabs">
          <button data-t="why" class="on">Why <span class="count">${c.reasons.length}</span></button>
          ${has.chart ? `<button data-t="chart" ${locked ? "data-lock" : ""}>Chart${lockTag}</button>` : ""}
          ${has.holders ? `<button data-t="holders" ${locked ? "data-lock" : ""}>Holders <span class="count">${c.holders?.length ?? c.locked.holders}</span>${lockTag}</button>` : ""}
          ${has.launches ? `<button data-t="launches" ${locked ? "data-lock" : ""}>Past launches <span class="count">${c.launches?.length ?? c.locked.launches}</span>${lockTag}</button>` : ""}
          <button data-t="tlog">Log</button>
        </nav>
        <div class="tpane" id="t-why">
          ${signals ? `<div class="card signals">${signals}</div>` : ""}
          <div class="card reasons">${reasons || `<p class="empty ok">Nothing suspicious found: no past launches around the developer, no bundled buyers, supply not concentrated.</p>`}</div>
        </div>
        <div class="tpane" id="t-chart" hidden><div class="card chart-c"><div id="chart"></div><div class="chart-f" id="chartLegend"></div></div></div>
        <div class="tpane" id="t-holders" hidden>
          <div class="card"><div id="hmap"></div><div class="chart-f">${HTAGS.map(([k, col, name]) => `<span><i style="background:${col}"></i>${name}</span>`).join("")}<span><i class="sq"></i>Shared funder</span></div></div>
          <div class="card"><table class="tbl zebra hold"><thead><tr><th>#</th><th>Holder</th><th class="r">Holds</th><th>Funded by</th><th>Wallet age</th></tr></thead><tbody>
            ${(c.holders ?? []).map((x, i) => `<tr><td class="muted">${i + 1}</td><td>${sol(x.owner)} ${x.tags.map((g) => `<span class="htag ${g}">${HTAG_NAME[g]}</span>`).join("")}</td>
              <td class="r mono">${x.pct.toFixed(2)}%</td><td>${x.funder ? sol(x.funder) : "—"}</td><td class="mono muted">${x.fundedAt ? age(c.checkedAt - x.fundedAt) : "—"}</td></tr>`).join("")}
          </tbody></table></div>
        </div>
        <div class="tpane" id="t-launches" hidden>
          <div class="card"><table class="tbl zebra t-launch"><thead><tr><th>Token</th><th>Launched</th><th class="r">Peak</th><th class="r">Now</th><th>Life</th></tr></thead><tbody>
            ${(c.launches ?? []).map((l) => `<tr data-life="${esc(l.mint)}"><td><a target="_blank" href="https://dexscreener.com/solana/${esc(l.mint)}"><b class="sym">${esc(l.symbol)}</b></a> <span class="q muted">${esc(short(l.mint))}</span></td>
              <td class="muted">${l.createdAt ? t("{age} ago", { age: age(now - l.createdAt) }) : "—"}</td><td class="r mono peak"><span class="spin sm"></span></td>
              <td class="r mono">${l.dead ? `<span class="dead">dead</span>` : usd(l.fdv)}</td><td class="mono muted life"></td></tr>`).join("")}
          </tbody></table><p class="note">Peak and lifetime come from hourly candles on GeckoTerminal and load one token at a time.</p></div>
        </div>
        <div class="tpane" id="t-tlog" hidden><pre class="tlogp">${esc(c.log.join("\n"))}</pre></div>
        <div class="tpane" id="t-locked" hidden><div class="card lockc">
          <b>${t("Holder map, past launches and chart")}</b>
          <p>${t("Who holds the supply and who funded them, what the developer launched before and how it ended, the price chart with the launch, bundles and developer sells marked. The verdict and every reason above are the same on every plan.")}</p>
          ${c.locked ? `<p class="muted">${t("This check found {h} top holders and {l} past launches.", { h: c.locked.holders, l: c.locked.launches })}</p>` : ""}
          <button class="main" data-upsell>${t("See plans")}</button></div></div>
      </div>
    </div>`;
  const opened = new Set();
  requestAnimationFrame(() => slideInd(document.querySelector(".ttabs"), "button.on", "tab-ind"));
  for (const b of document.querySelectorAll(".ttabs button")) b.onclick = () => {
    for (const x of document.querySelectorAll(".ttabs button")) x.classList.toggle("on", x === b);
    slideInd(document.querySelector(".ttabs"), "button.on", "tab-ind");
    for (const p of document.querySelectorAll(".tpane")) p.hidden = p.id !== `t-${"lock" in b.dataset ? "locked" : b.dataset.t}`;
    if ("lock" in b.dataset || opened.has(b.dataset.t)) return;
    opened.add(b.dataset.t);
    if (b.dataset.t === "chart") drawChart(c);
    if (b.dataset.t === "holders") drawHolders(c);
    if (b.dataset.t === "launches") loadLives(c);
  };
  if (!locked) $("recheck").onclick = () => checkStart(c.mint, true);
  if (!locked) $("tokPdf").onclick = () => printDoc(`/api/check/${id}.md`, `Tracehound token check ${c.symbol}`);
  $("shareTok").onclick = async () => openShare(await tokenCard(c), `${t("${symbol}: risk {risk}/100, {verdict}. {why}", { symbol: c.symbol, risk: c.risk, verdict: VERDICT[c.verdict].toLowerCase(), why: c.reasons[0] ? `${tf(c.reasons[0].title)}.` : t("Nothing suspicious found.") })}\n\n${location.href}`, `tracehound-${c.symbol}`);
  traceMenu(c, tokChain);
  if ($("watch")) $("watch").onclick = () => toggleWatch(c, id);
  if (watched(id)) pollWatch(id);
  liveMarket(c);
  reasonRates();
}

// Holder map: every top holder as a bubble sized by its share, linked to the wallet that funded it
const HTAGS = [["dev", "#ff5d6c", "Developer"], ["cluster", "#ffb547", "Linked by funding"], ["fresh", "#b48cff", "Fresh wallet"], ["smart", "#3ccf8e", "Smart money"], ["ring", "#ff4fa3", "Pump ring"]];
const HTAG_NAME = { dev: t("dev"), cluster: t("linked"), fresh: t("fresh"), smart: t("smart"), ring: t("ring") };
let hmap;
function drawHolders(c) {
  const color = (x) => HTAGS.find(([k]) => x.tags.includes(k))?.[1] ?? "#a6b0c3";
  const ids = new Set(c.holders.map((x) => x.owner));
  const fund = (c.funders ?? []).filter((f) => !ids.has(f.address));
  const els = [
    ...c.holders.map((x) => ({ data: { id: x.owner, label: `${x.pct.toFixed(1)}%`, color: color(x), size: Math.min(80, 18 + Math.sqrt(x.pct) * 16) } })),
    ...fund.map((f) => ({ data: { id: f.address, label: short(f.address), color: "#ffb547", size: 12, funder: 1 } })),
    ...c.holders.filter((x) => x.funder && (ids.has(x.funder) || fund.some((f) => f.address === x.funder))).map((x) => ({ data: { id: `${x.funder}>${x.owner}`, source: x.funder, target: x.owner } })),
  ];
  hmap?.destroy();
  hmap = cytoscape({
    container: $("hmap"), elements: els, wheelSensitivity: 0.25, minZoom: 0.3, maxZoom: 3, boxSelectionEnabled: false,
    style: [
      { selector: "node", style: { width: "data(size)", height: "data(size)", "background-color": "data(color)", "background-opacity": 0.22, "border-width": 1.5, "border-color": "data(color)", label: "data(label)", color: "#ededed", "font-family": "IBM Plex Mono, monospace", "font-size": 9, "text-valign": "center" } },
      { selector: "node[funder = 1]", style: { shape: "round-rectangle", "background-opacity": 0.1, "border-style": "dashed", "text-valign": "bottom", "text-margin-y": 4, color: "#8f95a8", "font-size": 8 } },
      { selector: "edge", style: { width: 1.2, "line-color": "#ffb54788", "target-arrow-color": "#ffb54788", "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": "bezier" } },
      { selector: "node:selected", style: { "border-width": 3, "border-color": "#5d9cf0" } },
    ],
    layout: { name: "cose", animate: false, padding: 30, nodeRepulsion: () => 9000, idealEdgeLength: () => 60, gravity: 0.6, componentSpacing: 40 },
  });
  hmap.on("tap", "node", (e) => window.open(addrUrl(tokChain, e.target.id()), "_blank"));
}

// Price chart from GeckoTerminal candles, with the launch, the developer's sells and bundled buys marked
let chart;
async function drawChart(c) {
  const box = $("chart");
  box.innerHTML = `<p class="empty"><span class="spin sm"></span> Loading candles…</p>`;
  const span = Date.now() / 1000 - (c.createdAt ?? c.checkedAt);
  const [tf, agg] = span < 12 * 3600 ? ["minute", 1] : span < 4 * 86400 ? ["minute", 5] : span < 30 * 86400 ? ["hour", 1] : ["day", 1];
  const resp = await fetch(ohlcvUrl(c.chain ?? "solana", c.market.pair, tf, agg, 1000)).catch(() => null);
  if (!resp?.ok) return (box.innerHTML = `<p class="empty">${t("The chart source is busy. Try again in a minute.")}</p>`);
  const j = await resp.json().catch(() => null);
  const supply = c.supply || 1e9;
  // The chart library draws timestamps as UTC; shifting them by the browser's offset shows local time
  const off = -new Date().getTimezoneOffset() * 60;
  const rows = (j?.data?.attributes?.ohlcv_list ?? []).map(([t, o, h, l, cl]) => ({ time: t + off, open: o * supply, high: h * supply, low: l * supply, close: cl * supply })).sort((a, b) => a.time - b.time);
  if (!rows.length) return (box.innerHTML = `<p class="empty">No candles for this pool on GeckoTerminal yet.</p>`);
  box.innerHTML = "";
  chart?.remove();
  chart = LightweightCharts.createChart(box, {
    autoSize: true, layout: { background: { color: "transparent" }, textColor: "#8f95a8", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
    grid: { vertLines: { color: "#20232e55" }, horzLines: { color: "#20232e55" } }, rightPriceScale: { borderColor: "#20232e" }, timeScale: { borderColor: "#20232e", timeVisible: true },
    localization: { priceFormatter: (p) => (p < 0 ? "" : `$${fmt(p)}`) },
  });
  const s = chart.addCandlestickSeries({ upColor: "#3ccf8e", downColor: "#ff5d6c", borderVisible: false, wickUpColor: "#3ccf8e88", wickDownColor: "#ff5d6c88" });
  s.setData(rows);
  // A marker sits on the candle its event falls into
  const step = rows.length > 1 ? rows[1].time - rows[0].time : 60;
  const at = (ts) => rows.find((r) => ts + off < r.time + step)?.time ?? rows[rows.length - 1].time;
  const marks = [];
  const ev = c.events ?? [];
  const launch = ev.find((e) => e.kind === "launch");
  if (launch && launch.ts + off >= rows[0].time - step) marks.push({ time: at(launch.ts), position: "belowBar", color: "#5d9cf0", shape: "arrowUp", text: t("launch") });
  const group = (kind, color, text, position, shape) => {
    const by = new Map();
    for (const e of ev.filter((e) => e.kind === kind && e.ts + off >= rows[0].time - step)) by.set(at(e.ts), (by.get(at(e.ts)) ?? 0) + (e.amount ?? 0));
    for (const [time, amt] of by) marks.push({ time, position, color, shape, text: `${text} ${((amt / supply) * 100).toFixed(1)}%` });
  };
  group("bundle_buy", "#ffb547", t("bundle"), "belowBar", "arrowUp");
  group("dev_sell", "#ff5d6c", t("dev sold"), "aboveBar", "arrowDown");
  s.setMarkers(marks.sort((a, b) => a.time - b.time));
  chart.timeScale().fitContent();
  $("chartLegend").innerHTML = `<span>${t("Market cap, {tf} candles, local time", { tf: `${agg}${tf === "minute" ? "m" : tf === "hour" ? "h" : "d"}` })}</span><span><i style="background:#5d9cf0"></i>Launch</span><span><i style="background:#ffb547"></i>Bundled buys</span><span><i style="background:#ff5d6c"></i>Developer sold</span>`;
}

// Past launches: peak value and how long each lived, fetched row by row
const hours = (h) => (h < 1 ? t("in hour 1") : t("after {age}", { age: age(h * 3600) }));
async function loadLives(c) {
  for (const tr of document.querySelectorAll("tr[data-life]")) {
    const l = await fetch(`/api/life?mint=${tr.dataset.life}`).then((r) => r.json()).catch(() => ({}));
    if (!document.body.contains(tr)) return;
    tr.querySelector(".peak").innerHTML = l.peak ? usd(l.peak) : "—";
    const born = c.launches.find((x) => x.mint === tr.dataset.life)?.createdAt;
    tr.querySelector(".life").textContent = l.peak
      ? t("peaked {when} · {then}", { when: hours(l.peakAfterH), then: l.deadAfterH !== null ? t("−90% {when}", { when: hours(l.deadAfterH) }) : t("traded for {age}", { age: born ? age(l.lastTradeAt - born) : "?" }) })
      : t("never traded");
  }
}

// Watch: while the site is open, the developer's wallets are re-read every 2 minutes and a sell raises a notification
const WATCH_MS = 120_000;
const watchList = () => {
  try {
    return JSON.parse(localStorage.getItem("watch") ?? "[]");
  } catch {
    return [];
  }
};
const saveWatch = (l) => {
  try {
    localStorage.setItem("watch", JSON.stringify(l));
  } catch {}
};
const watched = (id) => watchList().some((w) => w.id === id);
function toggleWatch(c, id) {
  const l = watchList();
  if (watched(id)) {
    saveWatch(l.filter((w) => w.id !== id));
    $("watch").textContent = "Watch";
    $("watchBox").innerHTML = "";
    return;
  }
  saveWatch([...l, { id, mint: c.mint, symbol: c.symbol, chain: c.chain ?? "solana" }]);
  $("watch").textContent = "Watching ✓";
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  pollWatch(id);
}
async function pollWatch(id) {
  const w = await fetch(`/api/watch?id=${id}`).then((r) => r.json()).catch(() => null);
  if (!w || w.error) return;
  const l = watchList();
  const me = l.find((x) => x.id === id);
  if (!me) return;
  const prev = me.last;
  // Alert on a fresh drop since the previous reading, not on the state the check already showed
  const sold = prev && prev.held > 0 ? 1 - w.held / prev.held : 0;
  const fell = prev?.fdv && w.fdv ? 1 - w.fdv / prev.fdv : 0;
  const alerts = [];
  if (sold >= 0.1) alerts.push(t("developer's wallets sold {pct}% of their bag", { pct: Math.round(sold * 100) }));
  if (fell >= 0.3) alerts.push(t("value fell {pct}% in {n} min", { pct: Math.round(fell * 100), n: Math.round((w.at - prev.at) / 60) }));
  me.last = { held: w.held, fdv: w.fdv, at: w.at };
  me.alerts = [...alerts.map((t) => ({ t, at: w.at })), ...(me.alerts ?? [])].slice(0, 5);
  saveWatch(l);
  if (alerts.length && "Notification" in window && Notification.permission === "granted") new Notification(`${me.symbol}: ${alerts.join(", ")}`, { body: t("Tracehound watch") });
  if (checkNow?.id === id && $("watchBox")) {
    const ch = w.heldAtCheck ? w.held / w.heldAtCheck - 1 : null;
    $("watchBox").innerHTML = `<div class="card watchc"><div class="wh"><span class="live"></span>${t("Watching · updated {time}", { time: new Date(w.at * 1000).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) })}</div>
      <div class="tiles">${kv("Dev wallets hold", w.supply ? `${((w.held / w.supply) * 100).toFixed(1)}%` : fmt(w.held), ch !== null && ch < -0.05 ? "hot" : "")}${kv("Since check", ch === null ? "—" : `${ch >= 0 ? "+" : ""}${Math.round(ch * 100)}%`)}${kv("FDV now", usd(w.fdv))}${kv("At check", usd(w.fdvAtCheck))}</div>
      ${(me.alerts ?? []).map((a) => `<div class="signal warn"><i></i><span>${ago(a.at)}: ${esc(a.t)}</span></div>`).join("")}</div>`;
  }
}
setInterval(() => watchList().forEach((w) => pollWatch(w.id)), WATCH_MS);

function openCase(id) {
  history.pushState(null, "", `?case=${id}`);
  show(id);
}

document.addEventListener("click", (e) => {
  // Anything marked data-upsell is a paid feature: it opens the plans instead
  const up = e.target.closest("[data-upsell]");
  if (up) {
    e.preventDefault();
    up.closest("details")?.removeAttribute("open");
    history.pushState(null, "", "?account");
    account();
    return scrollTo(0, 0);
  }
  const h = e.target.closest("[data-copy]");
  if (h) return navigator.clipboard.writeText(h.dataset.copy);
  const n = e.target.closest("[data-node]");
  if (n) return focusNode(n.dataset.node);
  const d = e.target.closest(".f-detail");
  if (d) d.classList.toggle("open");
});
for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => tab(b.dataset.tab);
for (const b of document.querySelectorAll(".examples a")) b.onclick = (e) => {
  e.preventDefault();
  $("q").value = b.dataset.q;
  start(b.dataset.q);
};
$("fit").onclick = () => cy?.animate({ fit: { padding: 60 } }, { duration: 650, easing: "ease-in-out-cubic" });
const zoomBy = (k) => cy?.animate({ zoom: { level: cy.zoom() * k, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 420, easing: "ease-out-cubic" });
$("zin").onclick = () => zoomBy(1.25);
$("zout").onclick = () => zoomBy(1 / 1.25);
$("copyQ").onclick = () => navigator.clipboard.writeText($("caseQ").textContent);
// "/" focuses the search, Esc closes the wallet card
document.addEventListener("keydown", (e) => {
  // "/" jumps to the search, unless it is being typed into a field
  if (e.key === "/" && !e.target.closest?.("input, textarea, select, [contenteditable]")) {
    e.preventDefault();
    $("q").focus();
  }
  // Escape closes whatever is open on top: a window, a menu, then the wallet card
  if (e.key === "Escape") {
    const open = ["share", "authModal", "payModal"].find((id) => !$(id).hidden);
    if (open) return ($(open).hidden = true);
    if (!$("bmenu").hidden) return ($("bmenu").hidden = true);
    const d = document.querySelector("details[open]");
    if (d) return d.removeAttribute("open");
    unselect();
  }
});
// The graph refits whenever the window changes size, so it always fills the screen
let resizing;
window.addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => {
    for (const g of [cy, preview]) {
      if (!g || g.destroyed()) continue;
      g.resize();
      const wait = Math.max(0, (g.scratch("bloomUntil") ?? 0) - Date.now());
      setTimeout(() => !g.destroyed() && g.fit(undefined, g === cy ? 60 : 24), wait);
    }
  }, 120);
});

// Share cards: a 1200×675 picture of a case or a verdict, sized for a post on X
const hound = new Image();
hound.src = "hound.png";
const SANS = '"Inter Tight", sans-serif', MONO = '"IBM Plex Mono", monospace';

// Lines of text that fit maxW, cut with an ellipsis after maxLines
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}
const text = (ctx, s, x, y, font, color) => {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
};
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function cardBase() {
  await Promise.all([`600 40px ${SANS}`, `300 20px ${SANS}`, `400 16px ${MONO}`, '700 20px "Martian Mono"'].map((f) => document.fonts.load(f)));
  if (!hound.complete) await new Promise((r) => (hound.onload = hound.onerror = r));
  const cv = document.createElement("canvas");
  cv.width = 1200;
  cv.height = 675;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0a0d16";
  ctx.fillRect(0, 0, 1200, 675);
  ctx.fillStyle = "#ffffff0d";
  for (let x = 12; x < 1200; x += 24) for (let y = 12; y < 675; y += 24) ctx.fillRect(x, y, 1.5, 1.5);
  // Pro cards carry no logo, so they can go out under the user's own name
  if (me?.plan !== "pro" || !me?.enforced) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(hound, 56, 40, 36, 36);
    text(ctx, "TRACEHOUND", 102, 66, '700 20px "Martian Mono"', "#ededed");
    ctx.textAlign = "right";
    text(ctx, t("on-chain evidence, every link cited"), 1144, 64, `400 15px ${MONO}`, "#6c7284");
    ctx.textAlign = "left";
  }
  return { cv, ctx };
}

// Hashes and addresses inside a sentence are cut to their ends, so they fit a line
const shortHashes = (t) => String(t).replace(/\b(0x[0-9a-fA-F]{16,}|[1-9A-HJ-NP-Za-km-z]{30,})\b/g, (m) => short(m));

async function caseCard(c) {
  const { cv, ctx } = await cardBase();
  const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
  // The graph as drawn on screen; a wide one gets the full width under the text
  let img = null;
  if (cy) {
    cy.elements().removeClass("dim hl hov").unselect();
    img = new Image();
    img.src = cy.png({ full: true, scale: 2, bg: "#0c0c14" });
    await img.decode();
  }
  const wide = img && img.width / img.height > 1.4;
  text(ctx, t("CASE"), 56, 140, `400 15px ${MONO}`, "#8f95a8");
  text(ctx, short(c.query), 56, 168, `400 20px ${MONO}`, "#ededed");
  let x = 56;
  c.chains.forEach((ch, i) => {
    if (i) x += text(ctx, " → ", x, 202, `300 18px ${SANS}`, "#6c7284");
    ctx.fillStyle = CHAINS[ch]?.[0] ?? "#8c96aa";
    ctx.beginPath();
    ctx.arc(x + 6, 196, 6, 0, 7);
    ctx.fill();
    x += 16 + text(ctx, CHAINS[ch]?.[1] ?? ch, x + 16, 202, `400 18px ${SANS}`, "#d6d8de");
  });
  ctx.font = `600 34px ${SANS}`;
  const tw = wide ? 680 : 500;
  const head = wrap(ctx, lead ? tf(lead.title) : t("{n} wallets traced", { n: c.nodes.length }), tw, wide ? 2 : 4);
  head.forEach((l, i) => text(ctx, l, 56, 262 + i * 44, `600 34px ${SANS}`, "#ffffff"));
  let bottom = 262 + (head.length - 1) * 44;
  if (lead) {
    ctx.font = `300 19px ${SANS}`;
    bottom += 22 + 27 * (wide ? 1 : 3);
    wrap(ctx, shortHashes(lead.detail.split(". ")[0]), tw, wide ? 1 : 3).forEach((l, i) => text(ctx, l, 56, 284 + head.length * 44 + i * 27, `300 19px ${SANS}`, "#8f95a8"));
  }
  const high = c.findings.filter((f) => f.confidence === "high").length;
  const stats = [["WALLETS", c.nodes.length], movedOut(c) ? ["MOVED OUT", `$${fmt(movedOut(c))}`] : ["FLOWS", c.edges.length], ["FINDINGS", c.findings.length], ["HIGH", high]];
  stats.forEach(([k, v], i) => {
    const [sx, sy] = wide ? [820 + (i % 2) * 170, 150 + Math.floor(i / 2) * 84] : [56 + i * 128, 586];
    text(ctx, t(k), sx, sy, `400 14px ${MONO}`, "#8f95a8");
    text(ctx, String(v), sx, sy + 36, `300 32px ${SANS}`, k === "HIGH" && v ? "#ff5d6c" : "#ededed");
  });
  const top = Math.max(250, bottom + 28);
  const [px, py, pw, ph] = wide ? [56, top, 1088, 632 - top] : [600, 112, 544, 520];
  rrect(ctx, px, py, pw, ph, 12);
  ctx.fillStyle = "#0c0c14";
  ctx.fill();
  ctx.strokeStyle = "#272c3a";
  ctx.stroke();
  if (img) {
    const k = Math.min((pw - 32) / img.width, (ph - 32) / img.height);
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    rrect(ctx, px, py, pw, ph, 12);
    ctx.clip();
    ctx.drawImage(img, px + (pw - img.width * k) / 2, py + (ph - img.height * k) / 2, img.width * k, img.height * k);
    ctx.restore();
  }
  return cv;
}

async function tokenCard(c) {
  const { cv, ctx } = await cardBase();
  const col = { high: "#ff5d6c", medium: "#ffb547", low: "#3ccf8e" }[c.verdict];
  text(ctx, t("TOKEN CHECK · {chain}", { chain: (CHAINS[c.chain ?? "solana"]?.[1] ?? "").toUpperCase() }), 56, 140, `400 15px ${MONO}`, "#8f95a8");
  // The token's picture beside its name, when we have one (same origin, so the canvas stays exportable)
  let tx = 56;
  const pic = new Image();
  pic.src = imgUrl(c.chain, c.mint);
  if (await pic.decode().then(() => true, () => false)) {
    ctx.save();
    rrect(ctx, 56, 160, 76, 76, 12);
    ctx.clip();
    ctx.drawImage(pic, 56, 160, 76, 76);
    ctx.restore();
    tx = 150;
  }
  const w = text(ctx, c.symbol, tx, 196, `600 46px ${SANS}`, "#ffffff");
  if (c.name) {
    ctx.font = `300 22px ${SANS}`;
    text(ctx, wrap(ctx, c.name, 540 - tx - w, 1)[0], tx + 16 + w, 194, `300 22px ${SANS}`, "#8f95a8");
  }
  text(ctx, short(c.mint), tx, 228, `400 17px ${MONO}`, "#8f95a8");
  const rw = text(ctx, String(c.risk), 52, 372, `300 132px ${SANS}`, col);
  text(ctx, "/100", 60 + rw, 372, `300 30px ${SANS}`, "#6c7284");
  // Verdict tag
  ctx.font = `400 17px ${MONO}`;
  const label = VERDICT[c.verdict].toUpperCase();
  const tw = ctx.measureText(label).width + 24;
  rrect(ctx, 58, 400, tw, 32, 5);
  ctx.fillStyle = `${col}1f`;
  ctx.fill();
  ctx.strokeStyle = `${col}88`;
  ctx.stroke();
  text(ctx, label, 70, 422, `400 17px ${MONO}`, col);
  // The scale under it, with the same thresholds as the page
  const bx = 58, by = 466, bw = 460;
  [["#3ccf8e66", 0, 0.25], ["#ffb54766", 0.25, 0.5], ["#ff5d6c66", 0.5, 1]].forEach(([f, a, b]) => {
    ctx.fillStyle = f;
    ctx.fillRect(bx + bw * a, by, bw * (b - a), 6);
  });
  ctx.fillStyle = "#ededed";
  ctx.beginPath();
  ctx.arc(bx + (bw * c.risk) / 100, by + 3, 8, 0, 7);
  ctx.fill();
  const now = Date.now() / 1000;
  [["FDV", usd(c.market.fdv)], ["LIQUIDITY", usd(c.market.liquidityUsd)], ["AGE", c.createdAt ? age(now - c.createdAt) : "—"]].forEach(([k, v], i) => {
    text(ctx, t(k), 56 + i * 160, 560, `400 14px ${MONO}`, "#8f95a8");
    text(ctx, v, 56 + i * 160, 596, `300 28px ${SANS}`, "#ededed");
  });
  // Why: the strongest reasons
  rrect(ctx, 600, 112, 544, 520, 12);
  ctx.fillStyle = "#10111a";
  ctx.fill();
  ctx.strokeStyle = "#272c3a";
  ctx.stroke();
  text(ctx, t("WHY"), 632, 156, `400 15px ${MONO}`, "#8f95a8");
  let y = 200;
  const reasons = c.reasons.slice(0, 5);
  if (!reasons.length) {
    ctx.font = `400 22px ${SANS}`;
    wrap(ctx, t("Nothing suspicious found: no past launches around the developer, no bundled buyers, supply not concentrated."), 470, 4).forEach((l, i) => text(ctx, l, 632, 204 + i * 30, `400 22px ${SANS}`, "#3ccf8e"));
  }
  for (const r of reasons) {
    if (y > 580) break;
    text(ctx, `+${r.points}`, 632, y, `500 20px ${MONO}`, r.points >= 25 ? "#ff5d6c" : r.points >= 10 ? "#ffb547" : "#8f95a8");
    ctx.font = `400 21px ${SANS}`;
    const lines = wrap(ctx, tf(r.title), 420, 2);
    lines.forEach((l, i) => text(ctx, l, 700, y + i * 28, `400 21px ${SANS}`, "#ededed"));
    y += lines.length * 28 + 26;
  }
  return cv;
}

let shareCanvas;
function openShare(cv, msg, name) {
  shareCanvas = cv;
  $("shareImg").src = cv.toDataURL("image/png");
  $("shareText").value = msg;
  $("shareNote").textContent = "";
  $("share").hidden = false;
  $("shareSave").onclick = () => {
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `${name}.png`;
    a.click();
  };
  $("shareCopy").onclick = () =>
    cv.toBlob(async (b) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
        $("shareNote").textContent = "Image copied. Paste it into the post.";
      } catch {
        $("shareNote").textContent = "This browser cannot copy images; use Download.";
      }
    });
  // X takes the text from the link; the picture is pasted or attached by hand
  $("sharePost").onclick = () => window.open(`https://x.com/intent/post?text=${encodeURIComponent($("shareText").value)}`, "_blank");
}
$("shareClose").onclick = () => ($("share").hidden = true);
$("share").onclick = (e) => e.target === $("share") && ($("share").hidden = true);
$("shareCase").onclick = async () => {
  if (!current) return;
  const lead = current.findings.find((f) => f.confidence === "high") ?? current.findings[0];
  openShare(await caseCard(current), `${lead ? tf(lead.title) : t("Traced {n} wallets", { n: current.nodes.length })}\n\n${location.href}`, `tracehound-${current.id}`);
};

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  start($("q").value.trim());
});

$("tform").addEventListener("submit", (e) => {
  e.preventDefault();
  checkStart($("tq").value.trim());
});
for (const a of [$("navMethod"), $("howMore")]) a.onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?method");
  method();
  scrollTo(0, 0);
};
for (const a of document.querySelectorAll(".m-toc a")) a.onclick = (e) => {
  e.preventDefault();
  document.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
};
$("homeTokMore").onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?tokens");
  tokens();
  scrollTo(0, 0);
};
$("navRings").onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?rings");
  rings();
  scrollTo(0, 0);
};
$("navAgent").onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?agent");
  agent();
  scrollTo(0, 0);
};
$("navTokens").onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?tokens");
  tokens();
};

// Accounts: sign in with a wallet. The wallet signs a one-time message from the server; the session is a cookie.
let me = null;
// Paid features are open when the plan is paid, or when the server enforces no plans (local development)
const isPaid = () => !me || !me.enforced || me.plan !== "free";
const ACCT_ICON = `<svg class="acct-i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5"/></svg>`;
async function loadMe() {
  me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
  const u = me?.user;
  $("signIn").hidden = !!u;
  // Account sits in the nav; signed in, the wallet and plan also show on the right
  $("acct").hidden = !u;
  if (u) $("acct").innerHTML = `${ACCT_ICON}<code>${esc(short(u.wallet))}</code><span class="pl ${u.plan}">${esc(me.plans[u.plan].name)}</span>`;
  return me;
}

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
async function walletSignIn(chain) {
  const say = (t, bad) => {
    $("authStatus").textContent = t;
    $("authStatus").classList.toggle("bad", !!bad);
  };
  try {
    let wallet, sign;
    if (chain === "solana") {
      const p = window.phantom?.solana ?? window.solflare ?? window.backpack ?? window.solana;
      if (!p) return say("No Solana wallet found in this browser. Install Phantom or Solflare and reload.", true);
      say("Connecting…");
      const r = await p.connect();
      wallet = (r?.publicKey ?? p.publicKey).toString();
      sign = async (m) => toB64((await p.signMessage(new TextEncoder().encode(m), "utf8")).signature ?? (await p.signMessage(new TextEncoder().encode(m))));
    } else {
      const p = window.ethereum;
      if (!p) return say("No Ethereum wallet found in this browser. Install MetaMask or Rabby and reload.", true);
      say("Connecting…");
      [wallet] = await p.request({ method: "eth_requestAccounts" });
      const hex = (m) => `0x${[...new TextEncoder().encode(m)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      sign = (m) => p.request({ method: "personal_sign", params: [hex(m), wallet] });
    }
    const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
    const n = await post("/api/auth/nonce", { wallet, chain });
    if (!n.ok) return say(n.j.error ?? "could not start sign-in", true);
    say("Sign the message in your wallet…");
    const signature = await sign(n.j.message);
    const v = await post("/api/auth/verify", { wallet, chain, message: n.j.message, signature });
    if (!v.ok) return say(v.j.error ?? "sign-in failed", true);
    say("Signed in.");
    await loadMe();
    setTimeout(() => ($("authModal").hidden = true), 500);
    if (document.body.className === "account") account();
  } catch (e) {
    say(e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? "") ? "You cancelled the signature." : t("Sign-in failed: {e}", { e: e?.message ?? e }), true);
  }
}

// What each plan gives; marked ones arrive with the features they depend on
const PLAN_FEATURES = {
  free: ["5 token checks a day, the full verdict and every reason", "A saved check up to 6 h old is shown instead of a new one", "1 trace a day", "Every public case and ring", "Share cards for X", "Watch 1 token while the site is open"],
  standard: ["100 token checks a day, a fresh check any time", "10 traces a day", "Holder map, developer's past tokens, chart", "Watch 25 tokens, Telegram alerts (soon)", "Markdown and PDF export"],
  pro: ["300 token checks a day", "20 deep traces a day", "Early signals: ring playbook launches, ring and smart money buys (soon)", "Watch 100 tokens and wallets", "API with keys (webhooks soon)", "Share cards without the logo"],
};
async function account() {
  mode("account");
  const m = await loadMe();
  const u = m?.user;
  const bar = (k, label) => {
    const used = m.usage[k], lim = m.limits[k];
    return `<div class="ubar"><div class="ub-h"><span>${label}</span><b>${used} / ${lim}</b></div><div class="ub-t"><i style="width:${Math.min(100, (used / lim) * 100)}%"></i></div></div>`;
  };
  $("accountBody").innerHTML = `
    <div class="card acc-me">
      ${u ? `<div class="acc-w">${chainIcon(u.chain === "evm" ? "ethereum" : "solana", "1.4em")}<div><code>${esc(u.wallet)}</code><small>${u.planUntil ? t("{plan} plan until {date}", { plan: esc(m.plans[u.plan].name), date: new Date(u.planUntil * 1000).toLocaleDateString(LOCALE) }) : t("{plan} plan", { plan: esc(m.plans[u.plan].name) })}</small></div><button id="signOut">Sign out</button></div>`
        : `<div class="acc-w"><div><b>Not signed in</b><small>Checks are counted by your IP on the Free plan. Sign in to keep your own count and upgrade.</small></div><button class="main" id="signIn2">Sign in</button></div>`}
      <div class="ubars">${bar("checks", "Token checks today")}${bar("traces", "Traces today")}</div>
      ${m.enforced ? "" : `<p class="note">Limits are off on this server (local development).</p>`}
    </div>
    ${u ? `<div class="sec-h"><h2>Telegram</h2></div><div class="card tgc">${m.telegram?.chats
      ? `<p>${t("Tied to {n} Telegram chat(s): the bot uses your plan there, and its checks count with the site's.", { n: m.telegram.chats })}</p><button id="tgUnlink">Unlink</button>`
      : `<p>Tie a Telegram chat to this account and the bot uses your plan: checks shared with the site, more tokens and wallets to watch.</p><button class="main" id="tgLink">Connect Telegram</button>`}
      <div id="tgBox"></div></div>` : ""}
    ${u ? `<div class="sec-h"><h2>API</h2><span class="sec-n">Pro</span></div><div class="card apic">${!m.enforced || m.plan === "pro" ? `
      ${(m.apiKeys ?? []).map((k) => `<div class="keyrow"><code>${esc(k.prefix)}…</code><span>${esc(k.name)}</span><small>${t("made {date}", { date: new Date(k.created * 1000).toLocaleDateString(LOCALE) })} · ${k.last_used ? t("used {ago}", { ago: ago(k.last_used) }) : t("never used")}</small><button data-revoke="${k.id}">Revoke</button></div>`).join("")}
      <div class="keynew"><input id="keyName" maxlength="40" placeholder="Key name, e.g. my bot" /><button class="main" id="keyMake">New key</button></div>
      <div id="keyBox"></div>
      <pre class="apidoc">curl -H "Authorization: Bearer th_…" ${esc(location.origin)}/api/v1/token/&lt;mint&gt;
curl -H "Authorization: Bearer th_…" "${esc(location.origin)}/api/v1/trace?q=&lt;address or tx&gt;"
/api/v1/check/&lt;id&gt;  /api/v1/case/&lt;id&gt;  /api/v1/alerts  /api/v1/usage</pre>
      <p class="note">Checks and traces through the API count against the same daily limits as the site. A new check takes up to a minute, a trace a few.</p>`
      : `<p>Scripts and bots can run token checks and traces through the API with a key, and read the live ring alerts. The API comes with the Pro plan.</p>`}</div>` : ""}
    <div class="sec-h"><h2>Plans</h2><span class="sec-n">${t("paid in USDC on Solana or Base")}${m.payChains?.length ? "" : t(" · coming soon")}</span></div>
    <div class="plans">${Object.entries(m.plans).map(([k, p]) => `
      <div class="card plan ${k} ${m.plan === k ? "cur" : ""}">
        <div class="pl-h"><b>${esc(p.name)}</b>${m.plan === k ? `<span class="cur-t">Current</span>` : ""}</div>
        <div class="pl-p">${p.price ? `$${p.price}<small>/month</small>` : "Free"}</div>
        ${p.price ? `<div class="pl-y">${t("or ${n} a year, two months free", { n: p.price * 10 })}</div>` : `<div class="pl-y">no sign-in needed</div>`}
        <ul>${PLAN_FEATURES[k].map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ${k === "free" ? "" : planButton(m, k)}
      </div>`).join("")}</div>`;
  $("signOut")?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadMe();
    account();
  });
  $("signIn2")?.addEventListener("click", () => openAuth());
  for (const b of document.querySelectorAll("[data-revoke]")) b.onclick = async () => {
    await fetch(`/api/keys/${b.dataset.revoke}/revoke`, { method: "POST" });
    account();
  };
  $("keyMake")?.addEventListener("click", async () => {
    const r = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("keyName").value.trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.key) return ($("keyBox").textContent = j.error ?? "could not make a key");
    await account();
    $("keyBox").innerHTML = `<p class="keyshow"><code data-copy="${esc(j.key)}">${esc(j.key)}</code><span>${t("Copy it now: it is not shown again.")}</span></p>`;
  });
  $("tgUnlink")?.addEventListener("click", async () => {
    await fetch("/api/tg/unlink", { method: "POST" });
    account();
  });
  $("tgLink")?.addEventListener("click", async () => {
    const j = await fetch("/api/tg/code", { method: "POST" }).then((r) => r.json()).catch(() => ({}));
    if (!j.code) return ($("tgBox").textContent = j.error ?? "could not make a code");
    $("tgBox").innerHTML = `<p class="tg-code">${j.bot ? `<a class="btn main" target="_blank" rel="noopener" href="https://t.me/${esc(j.bot)}?start=${j.code}">${t("Open the bot")}</a> ` : ""}${t("or send the bot")} <code data-copy="/link ${j.code}">/link ${j.code}</code> ${t("within 15 minutes.")}</p>`;
  });
  for (const b of document.querySelectorAll("[data-buy]")) b.onclick = () => (me?.user ? openPay(b.dataset.buy) : openAuth());
  if (m.payments?.length)
    $("accountBody").insertAdjacentHTML("beforeend", `<div class="sec-h"><h2>Payments</h2></div><div class="card pays">${m.payments.map((p) => `
      <div class="payrow"><span>${new Date(p.paid * 1000).toLocaleDateString(LOCALE)}</span><b>${t("{plan}, {n} days", { plan: esc(m.plans[p.plan].name), n: p.days })}</b><span>${esc(p.usdc)} USDC</span>${chainIcon(p.chain === "base" ? "base" : "solana", "0.95em")}<a href="${p.chain === "base" ? `https://basescan.org/tx/${p.tx}` : `https://solscan.io/tx/${p.tx}`}" target="_blank" rel="noopener">tx ↗</a></div>`).join("")}</div>`);
}

// The plan card's button: pay for it, extend it, or nothing when a higher plan is running
const RANK = { free: 0, standard: 1, pro: 2 };
function planButton(m, k) {
  if (!m.payChains?.length) return `<button class="${k === "pro" ? "main" : ""}" disabled title="Payments are not open yet">${m.plan === k ? "Your plan" : "Upgrade soon"}</button>`;
  if (RANK[m.plan] > RANK[k]) return `<button disabled>${t("Included in {plan}", { plan: esc(m.plans[m.plan].name) })}</button>`;
  return `<button class="${k === "pro" ? "main" : ""}" data-buy="${k}">${m.plan === k ? "Extend" : t(m.user ? "Get {plan}" : "Sign in to get {plan}", { plan: esc(m.plans[k].name) })}</button>`;
}

// Paying: pick a period and a chain, get an exact USDC amount, send it; the page waits for the transfer to land
let payState = null;
function openPay(plan) {
  payState = { plan, period: "month", chain: me.payChains.includes(me.user.chain === "evm" ? "base" : "solana") ? (me.user.chain === "evm" ? "base" : "solana") : me.payChains[0], inv: null };
  $("payModal").hidden = false;
  drawPay();
}
function drawPay() {
  const { plan, period, chain, inv } = payState;
  const p = me.plans[plan];
  $("payTitle").textContent = t("{plan} plan", { plan: p.name });
  if (!inv) {
    const opt = (k, v, label, sub) => `<button class="popt ${payState[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}"><b>${label}</b><small>${sub}</small></button>`;
    $("payBody").innerHTML = `
      <div class="pay-l">Period</div>
      <div class="popts">${opt("period", "month", `$${p.price}`, "30 days")}${opt("period", "year", `$${p.price * 10}`, "365 days · two months free")}</div>
      <div class="pay-l">Pay with USDC on</div>
      <div class="popts">${me.payChains.map((c) => opt("chain", c, `${chainIcon(c, "1em")} ${c === "base" ? "Base" : "Solana"}`, c === "base" ? "MetaMask, Rabby, Coinbase" : "Phantom, Solflare, Backpack")).join("")}</div>
      <button class="main pay-go" id="payGo">Continue</button>
      <p class="auth-s" id="payStatus"></p>`;
    for (const b of $("payBody").querySelectorAll(".popt")) b.onclick = () => ((payState[b.dataset.k] = b.dataset.v), drawPay());
    $("payGo").onclick = async () => {
      const r = await fetch("/api/pay/invoice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, period, chain }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return ($("payStatus").textContent = j.error ?? "could not start the payment"), $("payStatus").classList.add("bad");
      payState.inv = j;
      drawPay();
      waitPay();
    };
    return;
  }
  if (inv.status === "paid") {
    $("payBody").innerHTML = `<div class="pay-done"><div class="pd-i">✓</div><b>Payment received</b><p>${t("{plan} is on for {n} days.", { plan: esc(p.name), n: inv.days })}</p><a href="${inv.chain === "base" ? `https://basescan.org/tx/${inv.tx}` : `https://solscan.io/tx/${inv.tx}`}" target="_blank" rel="noopener">View the transaction ↗</a></div>`;
    return;
  }
  const solPay = `solana:${inv.address}?amount=${inv.usdc}&spl-token=${inv.mint}&label=Tracehound&message=${encodeURIComponent(`${p.name} plan`)}`;
  const left = Math.max(0, Math.round((inv.expires * 1000 - Date.now()) / 60000));
  $("payBody").innerHTML = `
    <p class="pay-n">${t("Send <b>exactly</b> this amount of USDC on {chain}. The odd digits at the end tell us the payment is yours; a different amount cannot be matched.", { chain: inv.chain === "base" ? "Base" : "Solana" })}</p>
    <div class="pay-f"><span>Amount</span><code>${esc(inv.usdc)} USDC</code><button class="txt" data-copy="${esc(inv.usdc)}">Copy</button></div>
    <div class="pay-f"><span>To</span><code>${esc(inv.address)}</code><button class="txt" data-copy="${esc(inv.address)}">Copy</button></div>
    <div class="pay-f"><span>Network</span><code>${inv.chain === "base" ? "Base (chain 8453), USDC 0x8335…2913" : "Solana, USDC EPjF…Dt1v"}</code></div>
    <div class="pay-acts">
      ${inv.chain === "base" ? `<button class="main" id="payWallet">Pay with my wallet</button>` : `<a class="btn main" href="${esc(solPay)}">Open in wallet (Solana Pay)</a>`}
      <button id="payCheck">I've paid, check now</button>
    </div>
    <p class="pay-w"><span class="spin"></span><span id="payStatus">${t("Waiting for the transfer… send within {n} min. It usually shows up a minute after it lands.", { n: left })}</span></p>`;
  for (const b of $("payBody").querySelectorAll("[data-copy]")) b.onclick = () => (navigator.clipboard.writeText(b.dataset.copy), (b.textContent = "Copied"), setTimeout(() => (b.textContent = "Copy"), 1200));
  $("payCheck").onclick = () => checkPay(true);
  $("payWallet") && ($("payWallet").onclick = payWithEvm);
}
// USDC transfer(to, amount) through the injected wallet, switched to Base first
async function payWithEvm() {
  const { inv } = payState, eth = window.ethereum, say = (t) => ($("payStatus").textContent = t);
  if (!eth) return say("No Ethereum wallet in this browser; send the amount by hand.");
  try {
    const [from] = await eth.request({ method: "eth_requestAccounts" });
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    const data = `0xa9059cbb${inv.address.slice(2).padStart(64, "0")}${BigInt(inv.amount).toString(16).padStart(64, "0")}`;
    await eth.request({ method: "eth_sendTransaction", params: [{ from, to: inv.mint, data }] });
    say("Sent. Waiting for it to land…");
    setTimeout(() => checkPay(true), 8000);
  } catch (e) {
    say(e?.code === 4001 ? "You cancelled it in the wallet." : `Wallet: ${e?.message ?? e}`);
  }
}
async function checkPay(now) {
  if (!payState?.inv) return;
  const j = await fetch(`/api/pay/invoice/${payState.inv.id}${now ? "?check" : ""}`).then((r) => r.json()).catch(() => null);
  if (!j || !payState?.inv) return;
  payState.inv = j;
  if (j.status === "paid") {
    drawPay();
    await loadMe();
    if (document.body.className === "account") account();
  } else if (now && $("payStatus")) $("payStatus").textContent = "Not seen yet. If you sent it, give it a minute; we keep looking for 6 hours.";
}
let payTimer = null;
function waitPay() {
  clearInterval(payTimer);
  payTimer = setInterval(() => (payState?.inv?.status === "open" && !$("payModal").hidden ? checkPay(false) : clearInterval(payTimer)), 10000);
}
$("payClose").onclick = () => ($("payModal").hidden = true);
$("payModal").onclick = (e) => e.target === $("payModal") && ($("payModal").hidden = true);
function openAuth() {
  $("authStatus").textContent = "";
  $("authModal").hidden = false;
}
$("signIn").onclick = openAuth;
$("authClose").onclick = () => ($("authModal").hidden = true);
$("authModal").onclick = (e) => e.target === $("authModal") && ($("authModal").hidden = true);
$("wSol").onclick = () => walletSignIn("solana");
$("wEvm").onclick = () => walletSignIn("evm");
$("acct").onclick = $("navAccount").onclick = (e) => {
  e.preventDefault();
  history.pushState(null, "", "?account");
  account();
  scrollTo(0, 0);
};
const meReady = loadMe();

// Interface language: remembered in the browser; the page reloads in the new one
$("lang").value = LANG;
$("lang").onchange = () => {
  try {
    localStorage.setItem("lang", $("lang").value);
  } catch {}
  location.reload();
};

// ── The hound beside the page ──────────────────────────────────────────────────────────────────────────────
// Idle it breathes and smokes; it sniffs while a trace or a check runs, barks at high risk or a strong finding,
// and hops when a token looks clean. A word bubble says why. Click it for a hint.
let buddyState = "idle", buddyT, ranCheck = false;
function buddy(state, say = "", ms = 0) {
  clearTimeout(buddyT);
  buddyState = state;
  $("buddy").className = `buddy ${state}`;
  const bub = $("buddyBub");
  if (say) {
    bub.hidden = false;
    bub.textContent = say;
    bub.className = `bub ${state}`;
  } else if (!bub.hidden) {
    bub.classList.add("out");
    setTimeout(() => bub.classList.contains("out") && (bub.hidden = true), 380);
  }
  if (ms) buddyT = setTimeout(() => buddy("idle"), ms);
}
function reactCheck(c, ran) {
  if (c.verdict === "high") buddy("bark", t("Woof! Risk {r}/100", { r: c.risk }), 5000);
  else if (c.verdict === "low") buddy("happy", t("Looks clean"), 4000);
  else buddy("idle", t("Hmm… careful"), 3500);
  if (ran) sfx(c.verdict === "high" ? "bark" : c.verdict === "low" ? "happy" : "done");
}
function reactCase(c) {
  const high = c.findings.filter((f) => f.confidence === "high").length;
  if (high) buddy("bark", t("Woof! {n} strong lead(s)", { n: high }), 5000);
  else buddy("happy", t("Trail mapped"), 3500);
  sfx(high ? "bark" : "done");
}
const HINTS = ["Press / to search from anywhere", "Click a flow on the graph to open its transaction", "Every link is a transaction you can open", "Paste a token address on the Token Check page"];
let hintN = 0;
$("buddy").onclick = () => buddyState === "idle" && buddy("happy", t(HINTS[hintN++ % HINTS.length]), 3500);

// ── Sounds: 8-bit blips made on the fly, off until switched on, remembered per browser ─────────────────────
let soundOn = false, actx;
try {
  soundOn = localStorage.getItem("sound") === "1";
} catch {}
const SPK = (on) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/>${on ? '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>' : '<path d="m16 9.5 5 5m0-5-5 5"/>'}</svg>`;
function drawSound() {
  $("soundT").innerHTML = SPK(soundOn);
  $("soundT").classList.toggle("on", soundOn);
  $("soundT").setAttribute("aria-pressed", String(soundOn));
}
drawSound();
$("soundT").onclick = () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem("sound", soundOn ? "1" : "0");
  } catch {}
  drawSound();
  if (soundOn) sfx("happy");
};
// Each sound is a few square-wave notes: [frequency, start, length] in seconds; the bark adds a burst of noise
const SFX = {
  step: [[880, 0, 0.04]],
  done: [[660, 0, 0.08], [990, 0.09, 0.14]],
  happy: [[660, 0, 0.07], [880, 0.08, 0.07], [1320, 0.16, 0.12]],
  bark: [[220, 0, 0.09], [165, 0.1, 0.13], [220, 0.32, 0.08], [150, 0.41, 0.15]],
};
function sfx(name) {
  if (!soundOn) return;
  try {
    actx ??= new AudioContext();
    const t0 = actx.currentTime + 0.01;
    for (const [f, at, len] of SFX[name]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(f, t0 + at);
      if (name === "bark") o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + at + len);
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(name === "step" ? 0.025 : 0.06, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(actx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.02);
    }
    if (name === "bark") {
      for (const at of [0, 0.32]) {
        const b = actx.createBuffer(1, actx.sampleRate * 0.06, actx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const n = actx.createBufferSource(), g = actx.createGain();
        n.buffer = b;
        g.gain.value = 0.05;
        n.connect(g).connect(actx.destination);
        n.start(t0 + at);
      }
    }
  } catch {}
}

// ── Home preview, live: the case replays in the order the money moved, then rests and starts again ───────────
function previewReplay(g) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const edges = g.edges().toArray().filter((e) => e.data("first")).sort((a, b) => a.data("first") - b.data("first"));
  if (edges.length < 2) return;
  const clock = $("previewClock");
  const day = (ts) => new Date(ts * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const run = () => {
    if (g.destroyed() || g !== preview) return;
    if (document.hidden || document.body.className.split(" ")[0] !== "home") return setTimeout(run, 2000);
    g.elements().not('[k = "suspect"]').style("opacity", 0);
    const dur = Math.min(8000, 1200 + edges.length * 110), t0 = performance.now();
    let i = 0;
    clock.hidden = false;
    const step = (now) => {
      if (g.destroyed() || g !== preview) return;
      const upto = Math.floor(Math.min(1, (now - t0) / dur) * edges.length);
      for (; i < upto; i++) {
        const e = edges[i];
        e.style("opacity", 0.95);
        for (const n of [e.source(), e.target()]) if (n.style("opacity") < 1) {
          n.style("opacity", 1).addClass("ping");
          setTimeout(() => !g.destroyed() && n.removeClass("ping"), 600);
        }
        clock.textContent = day(e.data("first"));
      }
      if (i < edges.length) return requestAnimationFrame(step);
      g.elements().removeStyle("opacity");
      setTimeout(() => (clock.hidden = true), 2500);
      setTimeout(run, 7000);
    };
    requestAnimationFrame(step);
  };
  setTimeout(run, 400);
}

// ── Navigation shared by the top bar, the phone's bottom bar and its "more" menu ──────────────────────────
for (const a of document.querySelectorAll(".bnav [data-go]")) a.onclick = (e) => {
  e.preventDefault();
  const href = a.getAttribute("href");
  history.pushState(null, "", href);
  router();
  if (href === "/#cases") setTimeout(() => $("cases").scrollIntoView({ behavior: "smooth" }), 300);
  else scrollTo(0, 0);
};
$("bmore").onclick = (e) => {
  e.stopPropagation();
  $("bmenu").hidden = !$("bmenu").hidden;
};
document.addEventListener("click", (e) => !$("bmenu").hidden && !$("bmenu").contains(e.target) && ($("bmenu").hidden = true));

const router = () => {
  const p = new URLSearchParams(location.search);
  if (p.get("case")) show(p.get("case"));
  else if (p.get("token")) showCheck(p.get("token"));
  else if (p.has("tokens")) tokens();
  else if (p.has("method")) method();
  else if (p.get("ring")) showRing(p.get("ring"));
  else if (p.has("rings")) rings();
  else if (p.has("agent")) agent();
  else if (p.has("account")) account();
  else home();
};
window.addEventListener("popstate", router);
router();
