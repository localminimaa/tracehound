// Regression set: known tokens and hacks with the findings they must and must not produce.
// Runs on recorded API answers (data/regress-cache, HTTP_CACHE) and a fixed ring registry, so it costs no
// credits after the first run and tests the code, not how the chain moved since. Run before every push.
// Usage: npm run regress              replay (records only answers it has not seen yet)
//        npm run regress -- --fresh   drop the recordings and record everything again (~4k Helius credits)
// Expectations rest on history that does not change (launch, funding, first buyers, where loot went),
// except ALLOX's sweep, which is tied to the recording.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const cache = fileURLToPath(new URL("data/regress-cache/", root));
if (process.argv.includes("--fresh")) rmSync(cache, { recursive: true, force: true });
process.env.HTTP_CACHE = cache;
process.env.RINGS_FILE = fileURLToPath(new URL("scripts/regress/rings.json", root));
process.env.CASE_REUSE_HOURS = "0";
try { process.loadEnvFile(new URL(".env", root)); } catch {}

const { checkToken } = await import("../src/tokencheck.ts");
const { investigate } = await import("../src/engine.ts");
const { cacheMissCount } = await import("../src/util.ts");

interface Case { name: string; kind: "token" | "trace"; query: string; chain?: string; must: RegExp[]; mustNot: RegExp[] }

const CASES: Case[] = [
  { name: "ALLOX: ring token on Meteora DBC", kind: "token", query: "DneSmn3NenxC8CMm4vTJUpTYfigZZKWWbyymq8MjFkw3",
    must: [/launched on Meteora DBC/, /belong to a known pump ring/, /funded from the same ring/, /known pump ring's playbook/, /wallets are sending the token to the developer/],
    mustNot: [/Top 10 wallets hold/] }, // the DBC pool authority is a PDA, not a holder
  { name: "FABLES: ring token", kind: "token", query: "H73g7ybHwtY4A4U4pxMS9xv9s3BQMPrtz82Ugd8VQskN",
    must: [/launched on Meteora DBC/, /belong to a known pump ring/, /known pump ring's playbook/],
    mustNot: [/Top 10 wallets hold [5-9]\d%/] },
  { name: "NOISED: DBC launch farm, not the ring", kind: "token", query: "BMECgGkv5cApMCKbZirVFWDsfBceYovqywanSUScsyuq",
    must: [/launched on Meteora DBC/, /circle launched \d+ other token/],
    mustNot: [/playbook/, /pump ring/] },
  { name: "SLOPTECH: pump.fun launch farm", kind: "token", query: "FaT5xC6KPJVvALYJYzbBQqhRz7Ldg13DaRdbDN6mpump",
    must: [/launched on pump\.fun/, /circle launched \d+ other token/, /already sold/],
    mustNot: [/pump ring/] },
  { name: "NULLA: bundle funded by the developer's circle", kind: "token", query: "4c7Q9YXKVqQy5deud3VVxnVaEqqKmCqTKhsypUCxpump",
    must: [/funded by the developer's circle/],
    mustNot: [/pump ring/] },
  { name: "BLAST: no ring, no holder farm", kind: "token", query: "4xrX186AZGVTUv3PFZHJRd3fhtWjFh91ra8Xvtzpump",
    must: [/launched on pump\.fun/],
    mustNot: [/pump ring/, /handing the token out/, /sending the token to/] },
  { name: "Bybit exploiter: labeled, out through THORChain", kind: "trace", query: "0x47666fab8bd0ac7003bce3f5c3585383f09486e2",
    must: [/already labeled: Bybit Exploiter/, /THORChain/],
    mustNot: [] },
  { name: "DAI/WETH LP handed to another wallet and pulled there", kind: "trace", query: "0xc20e222da813a413cb490b7fdfd60ec8bb9548f4", chain: "ethereum",
    must: [/Liquidity added to DAI\/WETH pool by 0xc20e…48f4 was handed to 0x83b8…44bc, .*109\.67 DAI pulled out/],
    mustNot: [] },
  { name: "USDT0 over LayerZero to Polygon, followed there", kind: "trace", query: "0x140f4f7d4da43c9da34f5ee9a217290c945afd14", chain: "ethereum",
    must: [/crossed LayerZero \(USDT0\): [\d.]+k USDT0 on polygon/, /\[polygon\] following the money from 0xa0a0…ae73/],
    mustNot: [] },
  { name: "USDC burned over CCTP to Base", kind: "trace", query: "0x490632638389f5e29bed11a35b8cc56726bea895", chain: "ethereum",
    must: [/USDC crossed CCTP: [\d.]+k USDC on base/],
    mustNot: [] },
  { name: "OTC desk on Tron: USDT lands in a Binance wallet from proof of reserves", kind: "trace", query: "TPwXAPwYaDCm7GrzNFiMmNnofrxEVURXRM", chain: "tron",
    must: [/USDT went into Binance \(exchange\)/, /Funds reached a Binance deposit address/],
    mustNot: [] },
  { name: "Mango exploiter: gas from a Binance hot wallet, stops at the Mango vault", kind: "trace", query: "yUJw9a2PyoqKkH47i4yEGf4WXomSHMiK7Lp29Xs2NqM",
    must: [/Gas came from an exchange withdrawal: Binance/],
    mustNot: [/went back to the attacker's funder/] }, // that path ran through Mango's shared vault (a PDA)
];

const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
let failed = 0;
for (const c of CASES.filter((c) => !only || c.name.toLowerCase().includes(only.toLowerCase()))) {
  const t0 = Date.now();
  const lines: string[] = [];
  try {
    if (c.kind === "token") {
      const r = await checkToken(c.query, { log: (s) => lines.push(s), save: false });
      lines.push(...r.reasons.map((x) => x.title));
    } else {
      const r = await investigate(c.query, { chain: c.chain, log: (s) => lines.push(s) });
      lines.push(...r.findings.map((f) => f.title));
    }
  } catch (e) {
    lines.push(`ERROR ${(e as Error).message}`);
  }
  const text = lines.join("\n");
  const bad = [...c.must.filter((re) => !re.test(text)).map((re) => `missing ${re}`), ...c.mustNot.filter((re) => re.test(text)).map((re) => `unexpected ${re}`)];
  if (/^ERROR/m.test(text)) bad.push(text.match(/^ERROR.*$/m)![0]);
  console.log(`${bad.length ? "FAIL" : "ok  "} ${c.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const b of bad) console.log(`     ${b}`);
  failed += bad.length ? 1 : 0;
}
console.log(`\n${failed ? `${failed} case(s) failed` : "all passed"}; ${cacheMissCount()} answer(s) fetched live and recorded`);
process.exit(failed ? 1 : 0);
