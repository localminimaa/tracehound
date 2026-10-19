// node src/cli.ts <address|tx> [chain]
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}

const { investigate } = await import("./engine.ts");
const { saveCase } = await import("./store.ts");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!args[0]) {
  console.error("usage: node src/cli.ts <address|tx> [chain]");
  process.exit(1);
}
const c = await investigate(args[0], { chain: args[1], log: (s) => console.log(s) });
saveCase(c);
console.log(`\ncase ${c.id}: ${c.findings.length} findings`);
for (const f of c.findings) console.log(`[${f.confidence}] ${f.title}`);
