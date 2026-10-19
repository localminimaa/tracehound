import { randomBytes } from "node:crypto";
import type { Adapter, Case, Finding, GEdge, GNode, NodeKind, Transfer } from "./types.ts";
import { activeEvmChains, EVM_CHAINS, evmAdapter, findEvmTx } from "./chains/evm.ts";
import { isSolAddress, isSolSignature, solanaAdapter } from "./chains/solana.ts";
import { type Crossing, explorerAdapter, isThorchainInbound, thorchainCrossing } from "./chains/thorchain.ts";
import { isTronAddress, isTronTx, tronAdapter } from "./chains/tron.ts";
import { bitcoinAdapter, isBtcAddress, isBtcTx } from "./chains/bitcoin.ts";
import { bridgeCrossing } from "./chains/bridges.ts";
import { label, lookupDune } from "./labels.ts";
import { priceEdges } from "./prices.ts";
import { envInt, fmtAmount, short } from "./util.ts";

const MAX_DEPTH = envInt("MAX_DEPTH", 3);
const BRANCHES = envInt("BRANCHES", 4);
const MAX_NODES = envInt("MAX_NODES", 80);
const FUND_DEPTH = 4;
const OUT_TX = 300;
const MIN_SHARE = 0.02;
const MAX_HOPS = envInt("MAX_HOPS", 2); // how many times the trace may follow money onto another chain
const THROUGH_TX = 2; // largest txs per router or bridge that are opened up

const TERMINAL = new Set<NodeKind>(["cex", "mixer", "bridge", "hub", "contract"]);
const PRIORITY: Record<NodeKind, number> = {
  suspect: 10, attack_contract: 9, known_hacker: 8.5, mixer: 8, cex: 8, deposit: 7, bridge: 6, sibling: 5, funder: 4, hub: 3, contract: 2, wallet: 1,
};

type Log = (s: string) => void;

export class Ctx {
  nodes = new Map<string, GNode>();
  edges = new Map<string, GEdge>();
  findings: Finding[] = [];
  expanded = new Set<string>();
  leads: { a: Adapter; addr: string; hop: number }[] = []; // wallets on other chains, traced after this one
  lp = new Set<string>(); // liquidity positions already looked at
  adapters = new Map<string, Adapter | null>();
  log: Log;
  constructor(log: Log) {
    this.log = log;
  }

  id = (a: Adapter, addr: string) => `${a.chain}:${a.norm(addr)}`;

  // Adapter for a chain the money moved to; null when the chain is not supported or has no API key
  adapter(chain: string): Adapter | null {
    if (!this.adapters.has(chain)) {
      let a: Adapter | null = null;
      try {
        if (chain in EVM_CHAINS) a = evmAdapter(chain);
        else if (chain === "solana") a = solanaAdapter();
        else if (chain === "tron") a = tronAdapter();
        else if (chain === "bitcoin") a = bitcoinAdapter();
      } catch {}
      this.adapters.set(chain, a);
    }
    return this.adapters.get(chain)!;
  }

  node(a: Adapter, addr: string, kind: NodeKind, depth: number, name?: string): GNode {
    const id = this.id(a, addr);
    const prev = this.nodes.get(id);
    if (prev) {
      if (PRIORITY[kind] > PRIORITY[prev.kind]) prev.kind = kind;
      if (name && !prev.label) prev.label = name;
      return prev;
    }
    const n: GNode = { id, chain: a.chain, addr: a.norm(addr), kind, depth, url: a.addrUrl(addr), ...(name ? { label: name } : {}) };
    this.nodes.set(id, n);
    return n;
  }

  // b is the recipient's chain when the money crossed a bridge
  edge(a: Adapter, t: Transfer, dir: GEdge["dir"], b: Adapter = a) {
    const from = this.id(a, t.from), to = this.id(b, t.to);
    const k = `${from}|${to}|${t.asset}|${dir}`;
    const e = this.edges.get(k) ?? { from, to, chain: a.chain, asset: t.asset, amount: 0, txs: [], first: t.ts, last: t.ts, dir, ...(t.unverified ? { unverified: true } : {}) };
    e.amount += t.amount;
    if (e.txs.length < 20 && !e.txs.includes(t.hash)) e.txs.push(t.hash);
    e.first = Math.min(e.first, t.ts);
    e.last = Math.max(e.last, t.ts);
    this.edges.set(k, e);
  }

  find(f: Finding) {
    this.findings.push(f);
    this.log(`▶ ${f.title}`);
  }
}

// Label first (exchange / mixer / bridge), then on-chain shape (contract, very busy wallet).
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

async function classify(a: Adapter, addr: string): Promise<{ kind: NodeKind; name?: string }> {
  if (BURN.has(addr)) return { kind: "contract", name: "burn address" };
  const l = label(a.chain, addr);
  if (l) {
    if (l.kind === "cex") return { kind: "cex", name: l.name };
    if (l.kind === "swap") return { kind: "cex", name: `${l.name} (instant swap)` };
    if (l.kind === "mixer") return { kind: "mixer", name: l.name };
    if (l.kind === "bridge") return { kind: "bridge", name: l.name };
    if (l.kind === "dex") return { kind: "contract", name: l.name };
    if (l.kind === "hacker") return { kind: "known_hacker", name: l.name };
  }
  const p = await a.profile(addr);
  if (p.isContract) return { kind: "contract", ...(l ? { name: l.name } : {}) };
  if (p.hub) return { kind: "hub", name: l?.name ?? "high-volume wallet" };
  return { kind: "wallet", ...(l ? { name: l.name } : {}) };
}

const asset = (a: Adapter, s: string) => (s.length > 20 ? short(s) : s);

// Who received the money, ranked by their share of each asset leaving the wallet.
function topRecipients(addr: string, outs: Transfer[]) {
  const totals = new Map<string, number>();
  for (const t of outs) totals.set(t.asset, (totals.get(t.asset) ?? 0) + t.amount);
  const by = new Map<string, { to: string; share: number; transfers: Transfer[] }>();
  for (const t of outs) {
    if (t.to === addr) continue;
    const r = by.get(t.to) ?? { to: t.to, share: 0, transfers: [] };
    r.transfers.push(t);
    by.set(t.to, r);
  }
  for (const r of by.values()) {
    const per = new Map<string, number>();
    for (const t of r.transfers) per.set(t.asset, (per.get(t.asset) ?? 0) + t.amount);
    // A token of unknown value must not outrank real money just because it is 100% of itself
    const weight = (as: string) => (r.transfers.find((t) => t.asset === as)?.unverified ? 0.3 : 1);
    r.share = Math.max(...[...per].map(([as, amt]) => (amt / (totals.get(as) || 1)) * weight(as)));
  }
  return [...by.values()].filter((r) => r.share >= MIN_SHARE).sort((x, y) => y.share - x.share);
}

const sumLine = (a: Adapter, ts: Transfer[]) => {
  const per = new Map<string, number>();
  for (const t of ts) per.set(t.asset, (per.get(t.asset) ?? 0) + t.amount);
  return [...per].map(([as, amt]) => `${fmtAmount(amt)} ${asset(a, as)}`).join(" + ");
};

async function traceFunding(a: Adapter, suspect: string, ctx: Ctx) {
  ctx.log(`[${a.chain}] funding trail of ${short(suspect)}…`);
  const trail: { t: Transfer; kind: NodeKind; name?: string }[] = [];
  let cur = suspect;
  const seen = new Set([a.norm(suspect)]);
  for (let d = 1; d <= FUND_DEPTH; d++) {
    const t = await a.firstFunding(cur);
    if (!t || seen.has(a.norm(t.from))) break; // a loop means we are inside the operator's own wallets
    seen.add(a.norm(t.from));
    await lookupDune(a.chain, [t.from], ctx.log);
    const c = await classify(a, t.from);
    trail.push({ t, ...c });
    ctx.node(a, t.from, TERMINAL.has(c.kind) ? c.kind : "funder", -d, c.name);
    ctx.edge(a, t, "fund");
    ctx.log(`  ← ${short(t.from)} ${c.name ?? c.kind} sent ${fmtAmount(t.amount)} ${asset(a, t.asset)}`);
    if (TERMINAL.has(c.kind)) break;
    cur = t.from;
  }
  if (!trail.length) {
    ctx.log(`  no incoming funding found`);
    return null;
  }

  const last = trail[trail.length - 1];
  const path = [suspect, ...trail.map((x) => x.t.from)].map(short).join(" ← ");
  const txs = trail.map((x) => x.t.hash);
  const addrs = trail.map((x) => x.t.from);
  const src = last.name ?? short(last.t.from);
  const msg: Record<string, [string, Finding["confidence"], string]> = {
    cex: [`Gas came from an exchange withdrawal: ${src}`, "high",
      `The funding trail ends at ${src}. The exchange knows which account requested this withdrawal (tx ${last.t.hash}). Path: ${path}.`],
    mixer: [`Funded through a mixer: ${src}`, "high",
      `The funding trail is cut at ${src}. Compare the deposit timing and amounts into the pool around ${new Date(last.t.ts * 1000).toISOString()}. Path: ${path}.`],
    bridge: [`Funded through a bridge: ${src}`, "medium",
      `The money arrived via ${src}. Continue the trace on the source chain from tx ${last.t.hash}. Path: ${path}.`],
    contract: [`First incoming money came from a contract ${src}`, "low",
      `${src} is a contract, so it is most likely the victim or a protocol, not whoever paid the gas. If this is the exploit itself, look for an earlier funder of the attack contract's deployer. Path: ${path}.`],
    hub: [`Funded from an unlabeled high-volume wallet ${short(last.t.from)}`, "medium",
      `${short(last.t.from)} behaves like an exchange hot wallet or a service. Check it on the explorer. Path: ${path}.`],
  };
  const [title, confidence, detail] = msg[last.kind] ?? [`Funding trail: ${path}`, "low",
    `${trail.length} hop(s) back. The trail ended at a regular wallet ${short(last.t.from)}, which is probably the operator's own.`];
  ctx.find({ kind: "funding", title, detail, confidence, chain: a.chain, addresses: addrs, txs });
  return trail;
}

// Wallets that the same funder created around the same time are usually the same operator.
async function traceSiblings(a: Adapter, suspect: string, funding: Transfer, ctx: Ctx) {
  const funder = funding.from;
  ctx.log(`[${a.chain}] other wallets funded by ${short(funder)}…`);
  const outs = await a.outflows(funder, OUT_TX);
  const near = [...new Map(outs.filter((t) => t.to !== suspect).map((t) => [t.to, t])).values()]
    .sort((x, y) => Math.abs(x.ts - funding.ts) - Math.abs(y.ts - funding.ts))
    .slice(0, 10);
  const sibs: Transfer[] = [];
  for (const t of near) {
    const first = await a.firstFunding(t.to);
    if (first && a.norm(first.from) === a.norm(funder) && !(await a.profile(t.to)).isContract) {
      sibs.push(first);
      ctx.node(a, t.to, "sibling", -1);
      ctx.edge(a, first, "fund");
    }
  }
  if (sibs.length) {
    ctx.find({
      kind: "siblings", confidence: "medium", chain: a.chain,
      title: `${sibs.length} more wallet(s) got their first funds from the same funder`,
      detail: `${short(funder)} also made the first deposit into ${sibs.map((s) => short(s.to)).join(", ")}. A shared first funder usually means the same operator. Check what these wallets did.`,
      addresses: sibs.map((s) => s.to), txs: sibs.map((s) => s.hash),
    });
  }
}

// A swap through a router or pool pays out in the same tx. When the output goes to another wallet, follow it.
async function swapOut(a: Adapter, parent: string, via: string, name: string | undefined, t: Transfer, depth: number, ctx: Ctx) {
  const legs = await a.txOutputs!(t.hash, t.ts);
  // Pools and routers pass funds along inside the tx, so anything that also sends is an intermediary
  const senders = new Set(legs.map((l) => l.from));
  const by = new Map<string, Transfer[]>();
  for (const l of legs) {
    if (l.to === parent || l.to === via || senders.has(l.to) || BURN.has(l.to)) continue;
    by.set(l.to, [...(by.get(l.to) ?? []), l]);
  }
  const picked = [...by].sort(([, x], [, y]) => Number(!!x[0].unverified) - Number(!!y[0].unverified) || y[0].amount - x[0].amount).slice(0, 2);
  const next: string[] = [];
  for (const [to, ts] of picked) {
    const c = await classify(a, to);
    if (c.kind === "contract") continue;
    // LP tokens minted to a wallet other than the one that paid in: liquidity added on someone else's behalf
    if (ts.every((l) => BURN.has(l.from))) {
      ctx.node(a, to, c.kind, depth + 2, c.name ?? "got the LP tokens");
      for (const l of ts) ctx.edge(a, { ...l, from: via }, "out");
      ctx.log(`  ≋ ${short(parent)} added liquidity through ${name ?? short(via)}, the LP tokens went to ${short(to)}`);
      ctx.find({
        kind: "lp_laundering", chain: a.chain, confidence: "high",
        title: `${sumLine(a, [t])} added as liquidity, the LP tokens went to another wallet ${short(to)}`,
        detail: `In tx ${t.hash} ${short(parent)} put ${sumLine(a, [t])} into ${name ?? short(via)}, and the LP tokens were minted to ${short(to)}. Whoever holds them can take the liquidity out, so the money now belongs to ${short(to)} without a transfer between the two. The trace continues from ${short(to)}.`,
        addresses: [parent, via, to], txs: [t.hash],
      });
      if (c.kind === "wallet" || c.kind === "known_hacker") next.push(to);
      continue;
    }
    ctx.node(a, to, c.kind, depth + 2, c.name);
    for (const l of ts) ctx.edge(a, { ...l, from: via }, "out");
    ctx.log(`  ⇄ ${short(via)} ${name ?? "contract"} swap paid ${sumLine(a, ts)} to ${short(to)} ${c.name ?? c.kind}`);
    ctx.find({
      kind: "swap_out", chain: a.chain, confidence: "medium",
      title: `${sumLine(a, [t])} swapped through ${name ?? short(via)}, ${sumLine(a, ts)} came out to another wallet ${short(to)}`,
      detail: `In tx ${t.hash} ${short(parent)} sent ${sumLine(a, [t])} into ${name ?? short(via)}, and the swap paid the output to ${short(to)}, not back to the sender. Swapping to a fresh wallet is a common way to break the trail. The trace continues from ${short(to)}.`,
      addresses: [parent, via, to], txs: [t.hash],
    });
    if (c.kind === "wallet" || c.kind === "known_hacker") next.push(to);
  }
  return next;
}

// What a liquidity pull paid out, and to whom: the pool, the burn address and intermediaries (routers, the position
// manager, which all pass funds on inside the tx) are not recipients; the wallet that pulled is, even though it also sent
// the LP tokens. Fee mints from the zero address are left out.
function payouts(legs: Transfer[], owner: string, pool: string) {
  const senders = new Set(legs.map((l) => l.from));
  return legs.filter((l) => !BURN.has(l.from) && !BURN.has(l.to) && l.to !== pool && l.from !== owner && (l.to === owner || !senders.has(l.to)));
}

// Liquidity laundering: money goes into a pool from one wallet and comes out to another. The LP tokens or the V3
// position NFT are handed over (or the pull pays a different wallet), so the trail through the pool looks like it ends.
async function followLiquidity(a: Adapter, owner: string, depth: number, ctx: Ctx): Promise<string[]> {
  if (!a.positions) return [];
  const ps = await a.positions(owner).catch((e) => {
    ctx.log(`  liquidity of ${short(owner)}: ${(e as Error).message.slice(0, 120)}`);
    return [];
  });
  const next: string[] = [];
  for (const p of ps) {
    const key = `${a.chain}:${p.pool}:${p.id ?? ""}`;
    if (ctx.lp.has(key)) continue;
    ctx.lp.add(key);
    const pulls = p.pulls.map((x) => ({ ...x, paid: payouts(x.legs, x.owner, p.pool) }));
    // Pulled by whoever held it after the handover, or paid to a wallet other than the one that pulled
    const foreign = pulls.filter((x) => x.owner !== p.adder || x.paid.some((l) => l.to !== x.owner));
    const handed = p.moves.filter((m) => !(p.v === 3 && p.empty && !pulls.some((x) => x.owner === m.to)));
    if (!handed.length && !foreign.length) continue; // an ordinary LP: the wallet added and took back its own liquidity
    const what = p.v === 3 ? `${p.name} position #${p.id}` : `${p.name} pool`;
    ctx.node(a, p.pool, "contract", depth + 1, p.v === 3 ? `${p.name} V3 positions` : `${p.name} pool`);
    for (const m of handed) {
      const c = await classify(a, m.to);
      ctx.node(a, m.to, c.kind, depth + 1, c.name ?? (p.v === 3 ? "got the LP position" : "got the LP tokens"));
      ctx.edge(a, m, "out");
      if (c.kind === "wallet" || c.kind === "known_hacker") next.push(m.to);
    }
    const paid = foreign.flatMap((x) => x.paid);
    for (const l of paid) {
      const c = await classify(a, l.to);
      ctx.node(a, l.to, c.kind, depth + 2, c.name);
      ctx.edge(a, { ...l, from: p.pool }, "out");
      if (c.kind === "wallet" || c.kind === "known_hacker") next.push(l.to);
    }
    const to = [...new Set(paid.map((l) => l.to))];
    const out = paid.length ? sumLine(a, paid) : "";
    ctx.log(`  ≋ ${short(p.adder)} added liquidity to ${what}${handed.length ? `, handed to ${handed.map((m) => short(m.to)).join(", ")}` : ""}${out ? `, ${out} pulled out to ${to.map(short).join(", ")}` : ""}`);
    ctx.find({
      kind: "lp_laundering", chain: a.chain, confidence: handed.length || to.some((t) => t !== p.adder) ? "high" : "medium",
      title: handed.length
        ? `Liquidity added to ${what} by ${short(p.adder)} was handed to ${handed.map((m) => short(m.to)).join(", ")}${out ? `, ${out} pulled out` : ", still in the pool"}`
        : `Liquidity added to ${what} by ${short(p.adder)} came out to another wallet: ${out} to ${to.map(short).join(", ")}`,
      detail: `${short(p.adder)} put money into ${what} (tx ${p.addTx}). `
        + (handed.length ? `The ${p.v === 3 ? "position NFT" : "LP tokens"} then went to ${handed.map((m) => `${short(m.to)} (tx ${m.hash})`).join(", ")}. ` : "")
        + (foreign.length ? `Liquidity was taken out in ${foreign.map((x) => `tx ${x.hash} by ${short(x.owner)}`).join(", ")}${out ? `, paying ${out} to ${to.map(short).join(", ")}` : ""}. ` : `Nothing has been pulled since, so the money is still in the pool and whoever holds the ${p.v === 3 ? "position" : "LP tokens"} can take it out. `)
        + `Passing liquidity to another wallet moves the money without a transfer between the two, so a trace that stops at the pool loses it. The trace continues from the new holder.`,
      addresses: [p.adder, p.pool, ...handed.map((m) => m.to), ...to], txs: [p.addTx, ...handed.map((m) => m.hash), ...foreign.map((x) => x.hash)],
    });
  }
  return next;
}

// Why the trace cannot go on there: a supported chain without its API key, or a chain not supported yet
const untracedWhy = (chain: string) =>
  chain in EVM_CHAINS ? (process.env.ETHERSCAN_API_KEY ? "the Etherscan API plan does not cover it" : "set ETHERSCAN_API_KEY to follow it") : chain === "solana" ? "set HELIUS_API_KEY to follow it" : "not traced yet";

const outHash = (chain: string, h: string) => (!h ? "" : chain === "solana" ? h : chain in EVM_CHAINS ? `0x${h.toLowerCase().replace(/^0x/, "")}` : h.toLowerCase());

// A bridge or THORChain takes the money on one chain and pays out on another; its index links the two sides.
const INDEX: Record<string, string> = { THORChain: "THORChain's index (Midgard)", Wormhole: "Wormholescan", Mayan: "Mayan's explorer", deBridge: "deBridge's order index", Across: "Across's deposit index" };
async function cross(a: Adapter, via: string, t: Transfer, x: Crossing, depth: number, hop: number, ctx: Ctx, bridge = "THORChain") {
  ctx.node(a, via, "bridge", depth + 1, bridge);
  const lines: string[] = [];
  for (const o of x.out) {
    let traced = ctx.adapter(o.chain);
    let c: { kind: NodeKind; name?: string } | null = null;
    try {
      if (traced) c = await classify(traced, traced.norm(o.address));
    } catch (e) {
      // The chain has an adapter but its API refuses (an Etherscan plan without that chain): show the payout, stop there
      ctx.log(`  [${o.chain}] not traced: ${(e as Error).message.slice(0, 120)}`);
      ctx.adapters.set(o.chain, (traced = null));
    }
    const b = traced ?? explorerAdapter(o.chain);
    const to = b.norm(o.address);
    c ??= { kind: "wallet", name: `${o.chain} · not traced` };
    ctx.node(b, to, c.kind, depth + 2, c.name ?? `${o.chain} wallet`);
    ctx.edge(a, { from: via, to, amount: o.amount, asset: o.asset, hash: t.hash, ts: t.ts }, "out", b);
    const out = outHash(o.chain, o.hash);
    lines.push(`${fmtAmount(o.amount)} ${o.asset} on ${o.chain} to ${o.address}${out ? ` (tx ${out})` : ""}`);
    ctx.log(`  ⇢ ${bridge} paid ${fmtAmount(o.amount)} ${o.asset} on ${o.chain} to ${short(to)}`);
    const next = ctx.id(b, to);
    if (traced && (c.kind === "wallet" || c.kind === "known_hacker") && hop < MAX_HOPS && !ctx.expanded.has(next) && !ctx.leads.some((l) => ctx.id(l.a, l.addr) === next)) ctx.leads.push({ a: b, addr: to, hop: hop + 1 });
  }
  const where = x.out.map((o) => `${fmtAmount(o.amount)} ${o.asset} on ${o.chain}`).join(" + ") || "nothing yet";
  const untraced = [...new Set(x.out.filter((o) => !ctx.adapter(o.chain)).map((o) => o.chain))];
  ctx.find({
    kind: "crossing", chain: a.chain, confidence: "high",
    title: `${fmtAmount(x.in.amount || t.amount)} ${x.in.amount ? x.in.asset : t.asset} crossed ${bridge}${x.status === "refund" ? " and was refunded" : ""}: ${where}`,
    detail: `${x.index ?? INDEX[bridge] ?? bridge} matches inbound tx ${t.hash} to: ${lines.join("; ") || "no outbound yet, the swap is " + x.status}.`
      + (untraced.length ? ` ${untraced.map((c) => `${c}: ${untracedWhy(c)}`).join("; ")}. Until then, continue from the address above on that chain's explorer.` : x.out.length ? " The trace continues on the destination chain." : ""),
    addresses: [via], txs: [t.hash],
  });
}

// Money sent to a router, pool, bridge or busy wallet did not necessarily stop there. Look inside the tx.
async function passThrough(a: Adapter, parent: string, via: string, c: { kind: NodeKind; name?: string }, sent: Transfer[], depth: number, hop: number, ctx: Ctx) {
  const txs = [...new Map(sent.map((t) => [t.hash, t])).values()].sort((x, y) => y.amount - x.amount).slice(0, THROUGH_TX);
  // Ask Midgard only where THORChain is plausible: its router, or an unlabeled contract / vault-like hot wallet
  const thor = /thorchain/i.test(c.name ?? "") || (!label(a.chain, via) && !BURN.has(via) && (c.kind === "contract" || c.kind === "hub"));
  // Other bridges: a contract labeled as one, or any unlabeled contract (DEX routers are skipped)
  const l = label(a.chain, via);
  const bridges = !BURN.has(via) && l?.kind !== "dex" && l?.kind !== "cex" && (c.kind === "bridge" || c.kind === "contract");
  const next: string[] = [];
  let crossed = false;
  for (const t of txs) {
    const x = thor ? await thorchainCrossing(t.hash) : null;
    const b = !x && bridges ? await bridgeCrossing(a.chain, t.hash, c.name ?? l?.name, a.logs && (() => a.logs!(t.hash))) : null;
    if (x) {
      crossed = true;
      await cross(a, via, t, x, depth, hop, ctx);
    } else if (b) {
      crossed = true;
      await cross(a, via, t, b, depth, hop, ctx, b.bridge);
    } else if (c.kind === "contract" && a.txOutputs) {
      next.push(...(await swapOut(a, parent, via, c.name, t, depth, ctx)));
    }
  }
  return { crossed, next };
}

// base: depth of the starting wallet, so a trace continued on another chain keeps counting steps from there
async function traceOutflows(a: Adapter, suspect: string, ctx: Ctx, hop = 0, base = 0) {
  ctx.log(`[${a.chain}] following the money from ${short(suspect)}…`);
  let frontier = [suspect];
  const suspectOuts: Transfer[] = [];
  const exits = new Map<string, Transfer[]>();
  const crossed = new Set<string>();

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const level: { parent: string; recips: ReturnType<typeof topRecipients> }[] = [];
    const liquid: string[] = []; // wallets that got liquidity this level's wallets put into pools
    for (const addr of frontier) {
      const id = ctx.id(a, addr);
      if (ctx.expanded.has(id) || ctx.nodes.size >= MAX_NODES) continue;
      ctx.expanded.add(id);
      const outs = await a.outflows(addr, OUT_TX);
      if (depth === 0) suspectOuts.push(...outs);
      level.push({ parent: addr, recips: topRecipients(addr, outs).slice(0, BRANCHES) });
      liquid.push(...(await followLiquidity(a, addr, base + depth, ctx)));
    }
    await lookupDune(a.chain, level.flatMap((l) => l.recips.map((r) => r.to)), ctx.log);

    const next: string[] = [];
    for (const { parent, recips } of level) {
      for (const r of recips) {
        if (r.to === suspect) continue; // money coming back to the suspect is not a new lead
        const before = ctx.nodes.get(ctx.id(a, r.to))?.kind;
        const c = await classify(a, r.to);
        // A THORChain vault looks like a plain wallet; following it as one would chase other people's swaps
        if (c.kind !== "cex" && c.kind !== "mixer" && (await isThorchainInbound(a.chain, r.to, r.transfers))) Object.assign(c, { kind: "bridge", name: "THORChain" });
        // The wallet that paid the attacker's gas now receives the loot: same operator
        if ((before === "funder" || before === "sibling") && c.kind === "wallet") {
          ctx.find({
            kind: "loop", chain: a.chain, confidence: "high",
            title: `Stolen funds went back to the attacker's ${before === "funder" ? "funder" : "sibling wallet"} ${short(r.to)}`,
            detail: `${short(r.to)} ${before === "funder" ? "paid the first funds into the attack wallets" : "was funded by the same wallet as the suspect"}, and later received ${sumLine(a, r.transfers)} from ${short(parent)}. Funding and loot meeting in one wallet means one operator controls both. Everything this wallet does next belongs to the attacker.`,
            addresses: [r.to, parent], txs: r.transfers.slice(0, 5).map((t) => t.hash),
          });
        }
        ctx.node(a, r.to, c.kind, base + depth + 1, c.name);
        for (const t of r.transfers) ctx.edge(a, t, "out");
        ctx.log(`  → ${short(r.to)} ${c.name ?? c.kind} ${sumLine(a, r.transfers)} (${Math.round(r.share * 100)}%)`);

        // A labeled exploiter wallet is still the attacker's: keep following it
        if (c.kind === "wallet" || c.kind === "known_hacker") next.push(r.to);
        else {
          exits.set(r.to, [...(exits.get(r.to) ?? []), ...r.transfers]);
          if (c.kind === "contract" || c.kind === "bridge" || c.kind === "hub") {
            const p = await passThrough(a, parent, r.to, c, r.transfers, base + depth, hop, ctx);
            if (p.crossed) crossed.add(r.to);
            next.push(...p.next);
          }
        }

        // A small wallet that forwards nearly everything to an exchange is a deposit address
        const pnode = ctx.nodes.get(ctx.id(a, parent));
        if (pnode && pnode.kind === "wallet" && r.share >= 0.6 && (c.kind === "cex" || c.kind === "hub")) {
          pnode.kind = "deposit";
          pnode.label = c.kind === "cex" ? `${c.name} deposit` : "likely exchange deposit";
          ctx.find({
            kind: "deposit", chain: a.chain,
            confidence: c.kind === "cex" ? "high" : "medium",
            title: c.kind === "cex" ? `Funds reached a ${c.name} deposit address` : `Funds reached a likely exchange deposit address`,
            detail: `${short(parent)} forwarded ${Math.round(r.share * 100)}% of what it received to ${c.name ?? short(r.to)}. Deposit addresses are issued to one exchange account, so the exchange can identify the owner and freeze the funds. Send them the address together with tx ${r.transfers[0].hash}.`,
            addresses: [parent, r.to], txs: r.transfers.slice(0, 5).map((t) => t.hash),
          });
        }
      }
    }
    frontier = [...new Set([...next, ...liquid])];
  }

  for (const [addr, ts] of exits) {
    const n = ctx.nodes.get(ctx.id(a, addr));
    if (!n || crossed.has(addr) || !["cex", "mixer", "bridge"].includes(n.kind)) continue;
    const what = { cex: "exchange", mixer: "mixer", bridge: "bridge" }[n.kind as "cex" | "mixer" | "bridge"];
    ctx.find({
      kind: `exit_${n.kind}`, chain: a.chain, confidence: n.kind === "cex" ? "high" : "medium",
      title: `${sumLine(a, ts)} went into ${n.label ?? short(addr)} (${what})`,
      detail: n.kind === "bridge"
        ? `The money left ${a.chain} through ${n.label}. Continue the trace on the destination chain from these transactions.`
        : n.kind === "mixer"
          ? `The money entered ${n.label}. Look for withdrawals of the same amounts shortly afterwards.`
          : `The money landed at ${n.label}. The exchange can freeze it and identify the account.`,
      addresses: [addr], txs: ts.slice(0, 5).map((t) => t.hash),
    });
  }
  return suspectOuts;
}

// People sleep: the longest silent stretch of UTC hours hints at the operator's time zone.
function timezoneHint(a: Adapter, suspect: string, ts: number[], ctx: Ctx) {
  if (ts.length < 15) return;
  const hours = new Array(24).fill(0);
  for (const t of ts) hours[new Date(t * 1000).getUTCHours()]++;
  let best = { len: 0, start: 0 };
  for (let s = 0; s < 24; s++) {
    let len = 0;
    while (len < 24 && hours[(s + len) % 24] === 0) len++;
    if (len > best.len) best = { len, start: s };
  }
  if (best.len < 5 || best.len > 14) return;
  const mid = (best.start + best.len / 2) % 24;
  let offset = Math.round(4 - mid); // sleep is centred around 04:00 local
  if (offset > 12) offset -= 24;
  if (offset < -11) offset += 24;
  ctx.find({
    kind: "timezone", chain: a.chain, confidence: "low",
    title: `Never active ${String(best.start).padStart(2, "0")}:00–${String((best.start + best.len) % 24).padStart(2, "0")}:00 UTC → likely UTC${offset >= 0 ? "+" : ""}${offset}`,
    detail: `Across ${ts.length} transactions ${short(suspect)} has a ${best.len}-hour window with no activity. If that is sleep, the operator is around UTC${offset >= 0 ? "+" : ""}${offset}. This is weak evidence. Treat it only as a hint to cross-check.`,
    addresses: [suspect], txs: [],
  });
}

export async function traceSuspect(a: Adapter, suspect: string, ctx: Ctx) {
  ctx.node(a, suspect, "suspect", 0, "suspect");
  const trail = await traceFunding(a, suspect, ctx);
  const direct = trail?.[0];
  if (direct && direct.kind === "wallet") await traceSiblings(a, suspect, direct.t, ctx);
  const outs = await traceOutflows(a, suspect, ctx);
  timezoneHint(a, suspect, [...outs.map((t) => t.ts), ...(trail ?? []).map((x) => x.t.ts)], ctx);
}

export async function investigate(query: string, opts: { chain?: string; log?: Log } = {}): Promise<Case> {
  const started = Date.now();
  const logLines: string[] = [];
  const log: Log = (s) => {
    logLines.push(s);
    opts.log?.(s);
  };
  const ctx = new Ctx(log);
  const q = query.trim();
  const want = opts.chain && opts.chain !== "auto" ? opts.chain : null;
  const work: { a: Adapter; suspect: string }[] = [];

  if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    log("exploit tx — looking it up…");
    const hit = want ? { chain: want, tx: await evmAdapter(want).resolveTx(q) } : await findEvmTx(q);
    if (!hit?.tx) throw new Error("transaction not found on supported EVM chains");
    const a = evmAdapter(hit.chain);
    log(`found on ${hit.chain}: sent by ${short(hit.tx.from)}${hit.tx.to ? ` to ${short(hit.tx.to)}` : ""}`);
    if (hit.tx.to) ctx.node(a, hit.tx.to, "attack_contract", 0, "called contract");
    work.push({ a, suspect: hit.tx.from });
  } else if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    const chains = want ? [want] : (await activeEvmChains(q)).slice(0, 2);
    if (!chains.length) throw new Error("no activity found for this address on supported EVM chains");
    log(`active on: ${chains.join(", ")}`);
    for (const c of chains) work.push({ a: evmAdapter(c), suspect: q.toLowerCase() });
  } else if (isBtcAddress(q) || (want === "bitcoin" && isBtcTx(q))) {
    const a = bitcoinAdapter();
    if (isBtcTx(q)) {
      const tx = await a.resolveTx(q);
      if (!tx) throw new Error("bitcoin transaction not found");
      log(`bitcoin tx, largest input from ${short(tx.from)}`);
      work.push({ a, suspect: tx.from });
    } else work.push({ a, suspect: a.norm(q) });
  } else if (want === "tron" || isTronAddress(q) || isTronTx(q)) {
    const a = tronAdapter();
    if (isTronTx(q)) {
      const tx = await a.resolveTx(q);
      if (!tx) throw new Error("tron transaction not found");
      log(`tron tx sent by ${short(tx.from)}`);
      work.push({ a, suspect: tx.from });
    } else work.push({ a, suspect: q });
  } else if (isSolSignature(q)) {
    const a = solanaAdapter();
    const tx = await a.resolveTx(q);
    if (!tx) throw new Error("solana transaction not found");
    log(`solana tx signed by ${short(tx.from)}`);
    work.push({ a, suspect: tx.from });
  } else if (isSolAddress(q)) {
    work.push({ a: solanaAdapter(), suspect: q });
  } else {
    throw new Error("paste an EVM, Solana, Tron or Bitcoin address or transaction hash");
  }

  for (const { a } of work) ctx.adapters.set(a.chain, a);
  for (const { a, suspect } of work) {
    try {
      await traceSuspect(a, suspect, ctx);
    } catch (e) {
      // One chain failing (an API plan without it, a dead endpoint) must not lose the others
      if (work.length === 1) throw e;
      log(`[${a.chain}] could not trace ${short(suspect)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  // Money that crossed to another chain is followed there, breadth-first, within MAX_HOPS
  while (ctx.leads.length && ctx.nodes.size < MAX_NODES) {
    const { a, addr, hop } = ctx.leads.shift()!;
    try {
      await traceOutflows(a, addr, ctx, hop, ctx.nodes.get(ctx.id(a, addr))?.depth ?? 0);
    } catch (e) {
      log(`[${a.chain}] could not continue from ${short(addr)}: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  // Final pass: label whatever the trace discovered, so the graph shows names
  const byChain = new Map<string, string[]>();
  for (const n of ctx.nodes.values()) byChain.set(n.chain, [...(byChain.get(n.chain) ?? []), n.addr]);
  for (const [chain, addrs] of byChain) await lookupDune(chain, addrs, log);
  const linked: GNode[] = [];
  for (const n of ctx.nodes.values()) {
    const l = label(n.chain, n.addr);
    if (l && !n.label) n.label = l.name;
    if (l?.kind !== "hacker") continue;
    if (n.kind !== "suspect") {
      n.kind = "known_hacker";
      linked.push(n);
      continue;
    }
    ctx.find({
      kind: "known_hacker", chain: n.chain, confidence: "high",
      title: `The suspect is already labeled: ${l.name}`,
      detail: `${short(n.addr)} is tagged as "${l.name}" in public label data (${l.source}). Earlier reports and freezes may already exist for it.`,
      addresses: [n.addr], txs: [],
    });
  }
  if (linked.length) {
    const names = linked.map((n) => n.label).slice(0, 6).join(", ") + (linked.length > 6 ? ` and ${linked.length - 6} more` : "");
    ctx.find({
      kind: "known_hacker", chain: linked[0].chain, confidence: "high",
      title: `${linked.length} wallet(s) on the trail are labeled exploiters: ${names}`,
      detail: `Public label data already tags these wallets as exploiter addresses. If they belong to this incident, the attacker's wallet set is confirmed. If they come from another incident, the same operator may be behind both. Compare the two.`,
      addresses: linked.map((n) => n.addr), txs: [],
    });
  }

  const priced = await priceEdges([...ctx.edges.values()]).catch(() => 0);
  log(`priced ${priced} of ${ctx.edges.size} flows in USD (DefiLlama, at the time they moved)`);

  const order = { high: 0, medium: 1, low: 2 };
  ctx.findings.sort((x, y) => order[x.confidence] - order[y.confidence]);
  log(`done: ${ctx.nodes.size} wallets, ${ctx.edges.size} flows, ${ctx.findings.length} findings in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  return {
    id: `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    query: q,
    chainParam: opts.chain || "auto",
    created: Math.floor(started / 1000),
    durationMs: Date.now() - started,
    chains: [...new Set([...work.map((w) => w.a.chain), ...[...ctx.nodes.values()].map((n) => n.chain)])],
    suspects: work.map((w) => `${w.a.chain}:${w.a.norm(w.suspect)}`),
    nodes: [...ctx.nodes.values()],
    edges: [...ctx.edges.values()],
    findings: ctx.findings,
    log: logLines,
    priced: true,
  };
}

