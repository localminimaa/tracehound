// node src/smart-cli.ts [winner mint...]   no mints: winners are found on GeckoTerminal
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}

const { allowed } = await import("./credits.ts");
const gate = allowed("smart");
if (!gate.ok) {
  console.log(`skipped: ${gate.reason}`);
  process.exit(0);
}
const { findSmartMoney } = await import("./smart.ts");
const { heliusCredits } = await import("./chains/solana.ts");
const { short } = await import("./util.ts");

const r = await findSmartMoney({ winners: process.argv.slice(2), log: (s) => console.log(s) });
const sym = new Map(r.winners.map((w) => [w.mint, w.symbol]));
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
console.log("");
for (const c of r.clusters) {
  if (c.kind === "unknown") continue;
  const head = c.kind === "ring"
    ? `RING of ${c.wallets.length} wallets, all early in ${c.winners.map((m) => sym.get(m) ?? short(m)).join(", ")}; almost no other buys`
    : `traders (${c.wallets.length} wallet${c.wallets.length > 1 ? "s" : ""}): early in ${c.winners.length} winners, other buys hit ${c.hits}/${c.buys} (${pct(c.hitRate)})`;
  console.log(`${head}${c.funders.length ? `\n  funded by ${c.funders.map(short).join(", ")}` : ""}`);
  for (const w of c.wallets) console.log(`  ${w.wallet}  early in ${w.wins.length}, other buys ${w.hits}/${w.buys} (${pct(w.hitRate)})${w.funder ? `, funder ${short(w.funder)}` : ""}`);
}
console.log(`\nhelius: ${heliusCredits().total} credits`);
