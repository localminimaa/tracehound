// Grows data/tokens for the backtest: records the 24 h outcome of earlier checks, then runs the token
// check on fresh Solana tokens from DexScreener. Every check spends 200-300 Helius credits.
// Usage: node scripts/sample.ts [N=5]   (N=0 only records outcomes)
import { existsSync, readdirSync } from "node:fs";
import { fetchJson } from "../src/util.ts";
import { heliusCredits } from "../src/chains/solana.ts";
import { recordDue } from "./outcomes.ts";

try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}
const { checkToken } = await import("../src/tokencheck.ts");

const recorded = await recordDue();
if (recorded) console.log(`recorded the 24 h outcome of ${recorded} token(s)`);

const { allowed } = await import("../src/credits.ts");
const gate = allowed("sample");
if (!gate.ok) console.log(`no new checks: ${gate.reason}`);
const n = gate.ok ? Number(process.argv[2] ?? 5) : 0;
const tokensDir = new URL("../data/tokens/", import.meta.url);
const seen = new Set(existsSync(tokensDir) ? readdirSync(tokensDir).filter((f) => !f.startsWith(".")).map((f) => f.split("-")[0]) : []);
const fresh: any[] = !n ? [] : await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1");
const mints = [...new Set(fresh.filter((t) => t.chainId === "solana").map((t) => t.tokenAddress as string))].filter((m) => !seen.has(m)).slice(0, n);

for (const mint of mints) {
  const t0 = Date.now();
  const c0 = heliusCredits().total;
  try {
    const c = await checkToken(mint, { source: "sample" });
    console.log(`${c.symbol.padEnd(12)} ${c.verdict.padEnd(6)} ${String(c.risk).padStart(3)}  fdv $${Math.round(c.market.fdv ?? 0).toLocaleString()}  ${Math.round((Date.now() - t0) / 1000)}s  ${heliusCredits().total - c0} cr  ${mint}`);
  } catch (e) {
    console.log(`failed ${mint}: ${(e as Error).message}`);
  }
}
const cr = heliusCredits();
if (mints.length) console.log(`helius: ${cr.total} credits (rpc ${cr.rpc}, das ${cr.das}×10, parsed ${cr.parsed}×10)`);
