// Link previews: the picture X, Telegram and Discord show under a shared case or token check. Drawn here as SVG and
// rasterized with resvg, so a link carries its verdict even when nobody opened the share dialog on the page.
// 1200x630, the size every preview reader takes. Files are kept in data/og/: a case and a check never change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import type { Case } from "./types.ts";
import { fmtAmount } from "./util.ts";

const W = 1200, H = 630;
const pub = new URL("../public/", import.meta.url);
const dir = new URL("../data/og/", import.meta.url);
const fontFiles = ["inter-tight-300", "inter-tight-400", "inter-tight-600", "ibm-plex-mono-400", "ibm-plex-mono-500", "martian-mono-700"].map((f) => new URL(`fonts/${f}.ttf`, pub).pathname);
const hound = `data:image/png;base64,${readFileSync(new URL("hound.png", pub)).toString("base64")}`;

const SANS = "Inter Tight", MONO = "IBM Plex Mono";
const CHAINS: Record<string, [string, string]> = {
  ethereum: ["#8c9eff", "Ethereum"], base: ["#3b7bff", "Base"], arbitrum: ["#35a7f0", "Arbitrum"], optimism: ["#ff4d5e", "Optimism"],
  bsc: ["#f0b90b", "BSC"], polygon: ["#9b6dff", "Polygon"], solana: ["#2fe3a6", "Solana"], tron: ["#ff3b3b", "Tron"], bitcoin: ["#f7931a", "Bitcoin"],
  litecoin: ["#a6b4c8", "Litecoin"], dogecoin: ["#c9a43a", "Dogecoin"], "bitcoin-cash": ["#4cc47a", "BCH"], avalanche: ["#e84142", "Avalanche"], xrp: ["#cfd6e4", "XRP"],
};
const VERDICT: Record<string, [string, string]> = { high: ["#ff5d6c", "HIGH RISK"], medium: ["#ffb547", "MEDIUM RISK"], low: ["#3ccf8e", "LOW RISK"] };

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const shortHashes = (t: string) => t.replace(/\b(0x[0-9a-fA-F]{16,}|[1-9A-HJ-NP-Za-km-z]{30,})\b/g, (m) => short(m));
const usd = (n?: number | null) => (n ? `$${fmtAmount(n)}` : "—");
const text = (x: number, y: number, s: string, size: number, fill: string, font = SANS, weight = 400, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(s)}</text>`;

// Lines that fit a width, by an average glyph width: close enough for a preview, no font metrics needed
function wrap(s: string, width: number, size: number, max: number, em = 0.52) {
  const per = Math.floor(width / (size * em));
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > per) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = `${lines[max - 1].slice(0, per - 1).replace(/[\s,.;:]+$/, "")}…`;
  }
  return lines;
}

function frame(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><rect x="11" y="11" width="1.5" height="1.5" fill="#ffffff10"/></pattern>
  <radialGradient id="glow" cx="0.85" cy="0" r="0.9"><stop offset="0" stop-color="#ffb547" stop-opacity="0.09"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="#0a0d16"/><rect width="${W}" height="${H}" fill="url(#dots)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
  <image href="${hound}" x="56" y="40" width="36" height="36" image-rendering="optimizeSpeed"/>
  ${text(102, 66, "TRACEHOUND", 20, "#ededed", "Martian Mono", 700)}
  ${text(1144, 64, "on-chain evidence, every link cited", 15, "#6c7284", MONO, 400, 'text-anchor="end"')}
  ${body}</svg>`;
}

const render = (svg: string) => Buffer.from(new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: SANS }, fitTo: { mode: "width", value: W } }).render().asPng());

function cached(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  const f = new URL(`${key.replace(/[^\w.-]/g, "_")}.png`, dir);
  if (existsSync(f)) return Promise.resolve(readFileSync(f));
  return make().then((png) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(f, png);
    return png;
  });
}

// A case: the lead finding as the headline, the route, and where the money went as bars
export function ogCase(c: Case): Promise<Buffer> {
  return cached(`case-${c.id}`, async () => {
    const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
    const byId = new Map(c.nodes.map((n) => [n.id, n]));
    let x = 56;
    const route = c.chains.map((ch, i) => {
      const [col, name] = CHAINS[ch] ?? ["#8c96aa", ch];
      let s = i ? text(x, 202, "›", 20, "#6c7284") : "";
      if (i) x += 22;
      s += `<circle cx="${x + 6}" cy="196" r="6" fill="${col}"/>${text(x + 18, 202, name, 18, "#d6d8de")}`;
      x += 30 + name.length * 9.5;
      return s;
    }).join("");
    const head = wrap(lead ? shortHashes(lead.title) : `${c.nodes.length} wallets traced`, 620, 36, 3, 0.5);
    const detail = lead ? wrap(shortHashes(lead.detail.split(". ")[0]), 620, 19, 2) : [];
    const hy = 262;
    // Where the money went: the destinations that took the most, by USD when priced
    const dest = new Map<string, number>();
    for (const e of c.edges) if (e.dir === "out" && e.usd) dest.set(e.to, (dest.get(e.to) ?? 0) + e.usd);
    const top = [...dest].filter(([id]) => !c.suspects.includes(id)).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = top[0]?.[1] ?? 1;
    const KIND_COL: Record<string, string> = { cex: "#6ea8ff", deposit: "#6ea8ff", bridge: "#4fd1e0", mixer: "#b48cff", known_hacker: "#ff5d6c", suspect: "#ff5d6c" };
    const bars = top.map(([id, v], i) => {
      const n = byId.get(id);
      const name = n?.label ?? (n ? short(n.addr) : short(id));
      const col = KIND_COL[n?.kind ?? ""] ?? "#8f95a8";
      const y = 196 + i * 72;
      return text(752, y, name.length > 28 ? `${name.slice(0, 27)}…` : name, 19, "#ededed") + text(1112, y, usd(v), 19, "#ededed", MONO, 400, 'text-anchor="end"')
        + `<rect x="752" y="${y + 14}" width="360" height="6" rx="3" fill="#ffffff12"/><rect x="752" y="${y + 14}" width="${Math.max(6, (360 * v) / max)}" height="6" rx="3" fill="${col}"/>`;
    }).join("");
    const high = c.findings.filter((f) => f.confidence === "high").length;
    const moved = c.edges.filter((e) => e.dir === "out" && c.suspects.includes(e.from)).reduce((s, e) => s + (e.usd ?? 0), 0);
    const stats: [string, string][] = [["WALLETS", String(c.nodes.length)], moved ? ["MOVED OUT", usd(moved)] : ["FLOWS", String(c.edges.length)], ["FINDINGS", String(c.findings.length)], ["HIGH", String(high)]];
    const body = `${text(56, 140, "CASE", 15, "#8f95a8", MONO)}${text(56, 168, short(c.query), 20, "#ededed", MONO)}${route}
      ${head.map((l, i) => text(56, hy + i * 46, l, 36, "#ffffff", SANS, 600)).join("")}
      ${detail.map((l, i) => text(56, hy + head.length * 46 + 4 + i * 28, l, 19, "#8f95a8", SANS, 300)).join("")}
      ${stats.map(([k, v], i) => text(56 + i * 170, 548, k, 14, "#8f95a8", MONO) + text(56 + i * 170, 586, v, 32, k === "HIGH" && high ? "#ff5d6c" : "#ededed", SANS, 300)).join("")}
      ${top.length ? `<rect x="720" y="112" width="424" height="${Math.max(170, 104 + top.length * 72 - 30)}" rx="12" fill="#10111a" stroke="#272c3a"/>${text(752, 152, "WHERE THE MONEY WENT", 15, "#8f95a8", MONO)}${bars}` : ""}`;
    return render(frame(body));
  });
}

// A token check: the score, its verdict and scale, the market, and the strongest reasons
export function ogCheck(c: any, image?: { type: string; body: Buffer } | null): Promise<Buffer> {
  return cached(`check-${c.id ?? `${c.mint}-${c.checkedAt}`}`, async () => {
    const [col, label] = VERDICT[c.verdict] ?? VERDICT.medium;
    const pic = image && /png|jpe?g/.test(image.type) ? `data:${image.type};base64,${image.body.toString("base64")}` : null;
    const tx = pic ? 150 : 56;
    const sym = String(c.symbol ?? "?").slice(0, 14);
    const bx = 58, by = 466, bw = 460;
    const now = Date.now() / 1000;
    const ageS = c.createdAt ? now - c.createdAt : 0;
    const age = !c.createdAt ? "—" : ageS < 5400 ? `${Math.max(1, Math.round(ageS / 60))} min` : ageS < 2 * 86400 ? `${Math.round(ageS / 3600)} h` : `${Math.round(ageS / 86400)} days`;
    let y = 200;
    const reasons = (c.reasons ?? []).filter((r: any) => r.points > 0).slice(0, 5).map((r: any) => {
      if (y > 540) return "";
      const lines = wrap(shortHashes(r.title), 410, 21, 2);
      const pc = r.points >= 25 ? "#ff5d6c" : r.points >= 10 ? "#ffb547" : "#8f95a8";
      const s = text(632, y, `+${r.points}`, 20, pc, MONO, 500) + lines.map((l, i) => text(700, y + i * 28, l, 21, "#ededed")).join("");
      y += lines.length * 28 + 26;
      return s;
    }).join("");
    const body = `${text(56, 140, `TOKEN CHECK · ${(CHAINS[c.chain ?? "solana"]?.[1] ?? "").toUpperCase()}`, 15, "#8f95a8", MONO)}
      ${pic ? `<clipPath id="pc"><rect x="56" y="160" width="76" height="76" rx="12"/></clipPath><image href="${pic}" x="56" y="160" width="76" height="76" clip-path="url(#pc)" preserveAspectRatio="xMidYMid slice"/>` : ""}
      ${text(tx, 200, sym, 46, "#ffffff", SANS, 600)}
      ${text(tx, 230, short(c.mint), 17, "#8f95a8", MONO)}
      ${text(52, 372, String(c.risk), 132, col, SANS, 300)}${text(64 + String(c.risk).length * 74, 372, "/100", 30, "#6c7284", SANS, 300)}
      <rect x="58" y="400" width="${label.length * 10.4 + 24}" height="32" rx="5" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-opacity="0.55"/>${text(70, 422, label, 17, col, MONO)}
      <rect x="${bx}" y="${by}" width="${bw * 0.25}" height="6" fill="#3ccf8e" fill-opacity="0.4"/><rect x="${bx + bw * 0.25}" y="${by}" width="${bw * 0.25}" height="6" fill="#ffb547" fill-opacity="0.4"/><rect x="${bx + bw * 0.5}" y="${by}" width="${bw * 0.5}" height="6" fill="#ff5d6c" fill-opacity="0.4"/>
      <circle cx="${bx + (bw * Math.min(100, c.risk)) / 100}" cy="${by + 3}" r="8" fill="#ededed"/>
      ${[["FDV", usd(c.market?.fdv)], ["LIQUIDITY", usd(c.market?.liquidityUsd)], ["AGE", age]].map(([k, v], i) => text(56 + i * 160, 548, k, 14, "#8f95a8", MONO) + text(56 + i * 160, 586, v, 28, "#ededed", SANS, 300)).join("")}
      <rect x="600" y="112" width="544" height="${reasons ? Math.max(200, y - 112) : 220}" rx="12" fill="#10111a" stroke="#272c3a"/>${text(632, 156, "WHY", 15, "#8f95a8", MONO)}
      ${reasons || wrap("Nothing suspicious found: no past launches around the developer, no bundled buyers, supply not concentrated.", 470, 22, 4).map((l, i) => text(632, 204 + i * 30, l, 22, "#3ccf8e")).join("")}`;
    return render(frame(body));
  });
}

// The site itself: the name, what it does, the hound large on the right
export function ogSite(): Promise<Buffer> {
  return cached("site-v3", async () => {
    const lines = wrap("Paste a hacker's address or an exploit tx. Get the money trail, who funded it and the wallets tied to it, every link a transaction you can open.", 700, 26, 4);
    const body = `<image href="${hound}" x="760" y="150" width="400" height="400" image-rendering="optimizeSpeed" opacity="0.95"/>
      <text x="54" y="300" font-family="${SANS}" font-size="84" font-weight="400" fill="#ffffff">TRACE<tspan fill="#ffb547">HOUND</tspan></text>
      ${lines.map((l, i) => text(58, 370 + i * 38, l, 26, "#8f95a8", SANS, 300)).join("")}
      ${text(58, 560, "Hack tracing · token risk checks · 14 chains", 17, "#6c7284", MONO)}`;
    return render(frame(body));
  });
}
