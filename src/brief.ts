// The case and the token check as plain markdown, written from the findings alone: no key, no cost.
// Every address and tx is a link to its explorer, so the file stands on its own in a ticket or an email.
import type { Case, GEdge } from "./types.ts";
import type { TokenCheck } from "./tokencheck.ts";
import { explorerAdapter } from "./chains/thorchain.ts";
import { fmtAmount, short } from "./util.ts";

const usd = (n?: number | null) => (n == null ? "" : `$${fmtAmount(n)}`);
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const addr = (chain: string, a: string, name?: string) => `[${name ? `${name} (${short(a)})` : short(a)}](${explorerAdapter(chain).addrUrl(a)})`;
const tx = (chain: string, h: string) => `[${short(h)}](${explorerAdapter(chain).txUrl(chain === "solana" || chain === "tron" || chain === "bitcoin" || h.startsWith("0x") ? h : `0x${h}`)})`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

// Hashes and addresses quoted inside a finding become links. A bridge payout reads "… on <chain> to <address> (tx <hash>)",
// so those two link to the destination chain; everything else to the finding's own chain.
const PAYOUT = /on ([a-z-]+) to ([0-9A-Za-z]{25,90})(?: \(tx ([0-9A-Za-z]{40,90})\))?/g;
const linkify = (chain: string, text: string) => {
  const kept: string[] = [];
  const keep = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  const t = text
    .replace(PAYOUT, (_m, ch, a, h) => keep(`on ${ch} to ${addr(ch, a)}${h ? ` (tx ${tx(ch, h)})` : ""}`))
    .replace(/\b(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{80,90})\b/g, (h) => keep(tx(chain, h)))
    .replace(/\b(0x[0-9a-fA-F]{40})\b/g, (a) => keep(addr(chain, a)));
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
};

export function caseBrief(c: Case): string {
  const node = new Map(c.nodes.map((n) => [n.id, n]));
  const name = (id: string) => {
    const n = node.get(id);
    return n ? addr(n.chain, n.addr, n.label && n.label !== "suspect" ? n.label : undefined) : short(id.split(":")[1] ?? id);
  };
  const out = c.edges.filter((e) => e.dir === "out" && c.suspects.includes(e.from));
  const moved = out.some((e) => e.usd) ? out.reduce((s, e) => s + (e.usd ?? 0), 0) : null;
  const lead = c.findings.find((f) => f.confidence === "high") ?? c.findings[0];
  const exits = c.nodes.filter((n) => ["cex", "deposit", "bridge", "mixer"].includes(n.kind));
  const into = (id: string) => c.edges.filter((e) => e.to === id && e.dir === "out");
  const sum = (es: GEdge[]) => {
    const per = new Map<string, number>();
    for (const e of es) per.set(e.asset, (per.get(e.asset) ?? 0) + e.amount);
    const v = es.some((e) => e.usd) ? es.reduce((s, e) => s + (e.usd ?? 0), 0) : null;
    return `${[...per].map(([a, n]) => `${fmtAmount(n)} ${a.length > 12 ? short(a) : a}`).join(" + ")}${v ? ` (${usd(v)})` : ""}`;
  };
  const funding = c.edges.filter((e) => e.dir === "fund").sort((x, y) => y.first - x.first);
  const flows = [...c.edges].filter((e) => e.dir === "out").sort((x, y) => (y.usd ?? -1) - (x.usd ?? -1) || y.amount - x.amount).slice(0, 25);
  const L: string[] = [];
  L.push(`# Tracehound case ${c.id}`, "");
  L.push(`**Query:** \`${c.query}\`  `, `**Chains:** ${c.chains.join(" → ")}  `, `**Traced:** ${day(c.created)}, ${c.nodes.length} wallets, ${c.edges.length} flows${moved ? `, ${usd(moved)} moved out of the suspect wallets` : ""}`, "");
  if (lead) L.push("## Summary", "", `${lead.title}. ${linkify(lead.chain, lead.detail.split(". ").slice(0, 2).join(". ").replace(/\.$/, ""))}.`, "");
  L.push("## Findings", "");
  if (!c.findings.length) L.push("Nothing conclusive was found automatically. The flows below are the raw trail.", "");
  for (const f of c.findings) {
    L.push(`### ${f.title}`, "", `*${f.confidence} confidence · ${f.kind.replace(/_/g, " ")} · ${f.chain}*`, "", linkify(f.chain, f.detail), "");
    const refs = [...f.addresses.slice(0, 6).map((a) => addr(f.chain, a)), ...f.txs.slice(0, 4).map((h) => `tx ${tx(f.chain, h)}`)];
    if (refs.length) L.push(refs.join(" · "), "");
  }
  if (exits.length) {
    L.push("## Where the money went", "", "| Destination | Kind | Received |", "|---|---|---|");
    for (const n of exits) L.push(`| ${addr(n.chain, n.addr, n.label)} | ${n.kind} · ${n.chain} | ${cell(sum(into(n.id)) || "—")} |`);
    L.push("");
  }
  if (funding.length) {
    L.push("## Funding trail", "");
    for (const e of funding) L.push(`- ${name(e.from)} → ${name(e.to)}: ${fmtAmount(e.amount)} ${e.asset}${e.usd ? ` (${usd(e.usd)})` : ""}, ${day(e.first)}, tx ${tx(e.chain, e.txs[0])}`);
    L.push("");
  }
  L.push("## Largest flows", "", "| From | To | Amount | USD | First tx |", "|---|---|---|---|---|");
  for (const e of flows) L.push(`| ${name(e.from)} | ${name(e.to)} | ${fmtAmount(e.amount)} ${cell(e.asset.length > 12 ? short(e.asset) : e.asset)} | ${e.usd ? `${e.usdNow ? "≈" : ""}${usd(e.usd)}` : "—"} | ${tx(e.chain, e.txs[0])} |`);
  L.push("", "---", "", "Generated by Tracehound from on-chain data. Every link above is a transaction or an address on its explorer. Tracehound does not identify people; exchanges and law enforcement can, from the deposit addresses and transactions listed here. USD values are the price when each flow moved (DefiLlama); ≈ marks today's price where no history exists.");
  return L.join("\n");
}

export function tokenBrief(c: TokenCheck): string {
  const chain = c.chain ?? "solana";
  const L: string[] = [];
  L.push(`# Tracehound token check: ${c.symbol}${c.name ? ` (${c.name})` : ""}`, "");
  L.push(`**Token:** ${addr(chain, c.mint)} on ${chain}  `, `**Checked:** ${day(c.checkedAt)}  `, `**Risk:** ${c.risk}/100, ${c.verdict}  `,
    `**Market at check:** FDV ${usd(c.market.fdv) || "—"}, liquidity ${usd(c.market.liquidityUsd) || "—"}${c.market.url ? ` ([DexScreener](${c.market.url}))` : ""}`, "");
  L.push("## Why", "");
  if (!c.reasons.length) L.push("Nothing suspicious found.", "");
  for (const r of c.reasons) {
    L.push(`### +${r.points} ${r.title}`, "", r.detail, "");
    const refs = [...r.addresses.slice(0, 6).map((a) => addr(chain, a)), ...r.txs.slice(0, 3).map((h) => `tx ${tx(chain, h)}`)];
    if (refs.length) L.push(refs.join(" · "), "");
  }
  if (c.signals?.length) L.push("## Notes", "", ...c.signals.map((s) => `- ${s.text}`), "");
  L.push("## Developer", "", `- Developer: ${c.dev ? addr(chain, c.dev) : "unknown"}`, `- Funded by: ${c.devFunder ? addr(chain, c.devFunder) : "unknown"}`, `- Wallets linked to the developer: ${c.cluster.length}, holding ${c.clusterPct.toFixed(1)}% at check time`, "");
  if (c.holders?.length) {
    L.push("## Top holders", "", "| Holder | Share | Tags |", "|---|---|---|");
    for (const h of c.holders.slice(0, 15)) L.push(`| ${addr(chain, h.owner)} | ${h.pct.toFixed(2)}% | ${h.tags.join(", ") || "—"} |`);
    L.push("");
  }
  if (c.launches?.length) {
    L.push("## Developer's past launches", "", "| Token | Launched | Now |", "|---|---|---|");
    for (const l of c.launches.slice(0, 15)) L.push(`| ${addr(chain, l.mint, l.symbol)} | ${l.createdAt ? day(l.createdAt) : "—"} | ${l.dead ? "dead" : usd(l.fdv) || "—"} |`);
    L.push("");
  }
  L.push("---", "", "Generated by Tracehound from on-chain data. Points are set by hand and are being calibrated against what happened to checked tokens; this is not financial advice.");
  return L.join("\n");
}
