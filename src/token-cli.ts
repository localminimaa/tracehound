// node src/token-cli.ts <mint>
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}

const { checkToken } = await import("./tokencheck.ts");

const mint = process.argv[2];
if (!mint) {
  console.error("usage: node src/token-cli.ts <solana mint>");
  process.exit(1);
}
const c = await checkToken(mint, { log: (s) => console.log(s) });
console.log(`\n${c.symbol}: risk ${c.risk}/100 (${c.verdict})${c.market.fdv ? `, fdv $${Math.round(c.market.fdv).toLocaleString()}` : ""}`);
for (const r of c.reasons) console.log(`+${r.points} ${r.title}\n    ${r.detail}`);
