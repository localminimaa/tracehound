import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Case } from "./types.ts";

const dir = new URL("../data/cases/", import.meta.url);
mkdirSync(dir, { recursive: true });

// Same query within the TTL returns the saved case instead of spending API calls again.
const REUSE_SEC = (Number(process.env.CASE_REUSE_HOURS) || 6) * 3600;
const recent = new Map<string, { id: string; created: number }>();
const qkey = (query: string, chain: string) => `${chain}|${query.trim().toLowerCase()}`;

for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  try {
    const c: Case = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const k = qkey(c.query, c.chainParam ?? "auto");
    if ((recent.get(k)?.created ?? 0) < c.created) recent.set(k, { id: c.id, created: c.created });
  } catch {}
}

export function saveCase(c: Case) {
  writeFileSync(new URL(`${c.id}.json`, dir), JSON.stringify(c));
  recent.set(qkey(c.query, c.chainParam ?? "auto"), { id: c.id, created: c.created });
}

export function loadCase(id: string): Case | null {
  if (!/^[a-z0-9]+$/.test(id)) return null;
  try {
    return JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8"));
  } catch {
    return null;
  }
}

// Newest cases first, summarised for the home page, plus totals across all of them
export function listCases(limit: number) {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const c: Case = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
        const top = c.findings.find((x) => x.confidence === "high") ?? c.findings[0];
        const conf = (k: string) => c.findings.filter((x) => x.confidence === k).length;
        // Dollars that left the suspect wallets, when the flows are priced
        const out = c.edges.filter((e) => e.dir === "out" && c.suspects.includes(e.from));
        const usd = out.some((e) => e.usd) ? out.reduce((n, e) => n + (e.usd ?? 0), 0) : 0;
        const leads = c.findings.filter((x) => x.confidence === "high").slice(0, 2).map((x) => ({ title: x.title, kind: x.kind, chain: x.chain }));
        return [{
          id: c.id, query: c.query, created: c.created, chains: c.chains, wallets: c.nodes.length, flows: c.edges.length,
          high: conf("high"), medium: conf("medium"), low: conf("low"), crossings: c.findings.filter((x) => x.kind === "crossing").length,
          top: top?.title ?? null, topKind: top?.kind ?? null, usd, leads,
        }];
      } catch {
        return [];
      }
    })
    .sort((x, y) => y.created - x.created)
    .filter((c, i, list) => list.findIndex((x) => x.query.toLowerCase() === c.query.toLowerCase()) === i); // newest run per query
  const sum = (k: "wallets" | "flows" | "high" | "crossings" | "usd") => all.reduce((n, c) => n + c[k], 0);
  // The strongest findings across recent cases, newest first, for the home page
  const leads = all.flatMap((c) => c.leads.map((l) => ({ ...l, id: c.id, query: c.query, created: c.created }))).slice(0, 8);
  return {
    cases: all.slice(0, limit).map(({ leads: _, ...c }) => c), leads,
    totals: { cases: all.length, wallets: sum("wallets"), flows: sum("flows"), crossings: sum("crossings"), high: sum("high"), usd: sum("usd") },
  };
}

export function recentCase(query: string, chain: string): Case | null {
  const hit = recent.get(qkey(query, chain));
  return hit && Date.now() / 1000 - hit.created < REUSE_SEC ? loadCase(hit.id) : null;
}

// Token checks live in data/tokens/<mint>-<checkedAt>.json; the file name is the check's id
const tokens = new URL("../data/tokens/", import.meta.url);
mkdirSync(tokens, { recursive: true });
const CHECK_ID = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-f]{40})-\d+$/;
const TOKEN_REUSE_SEC = 1800; // a token changes fast, so a check is reused for half an hour (longer on the free plan)

export function loadCheck(id: string): any | null {
  if (!CHECK_ID.test(id)) return null;
  try {
    return JSON.parse(readFileSync(new URL(`${id}.json`, tokens), "utf8"));
  } catch {
    return null;
  }
}

// Newest check per token, summarised for the list
export function listChecks(limit: number) {
  const ids = readdirSync(tokens).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => CHECK_ID.test(id));
  const newest = new Map<string, string>();
  for (const id of ids) {
    const [mint, at] = id.split("-");
    if (Number(newest.get(mint)?.split("-")[1] ?? 0) < Number(at)) newest.set(mint, id);
  }
  return [...newest.values()]
    .sort((x, y) => Number(y.split("-")[1]) - Number(x.split("-")[1]))
    .slice(0, limit)
    .flatMap((id) => {
      const c = loadCheck(id);
      return c ? [{ id, chain: c.chain ?? "solana", mint: c.mint, symbol: c.symbol, name: c.name, checkedAt: c.checkedAt, createdAt: c.createdAt, risk: c.risk, verdict: c.verdict, fdv: c.market?.fdv ?? null, top: c.reasons[0]?.title ?? null }] : [];
    });
}

export function recentCheck(mint: string, maxAgeSec = TOKEN_REUSE_SEC): string | null {
  const hit = listChecks(1000).find((c) => c.mint === mint);
  return hit && Date.now() / 1000 - hit.checkedAt < maxAgeSec ? hit.id : null;
}
