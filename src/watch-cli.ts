// node src/watch-cli.ts   live watch on ring wallets and ring playbook launches (see src/watch.ts)
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}
if (!process.env.HELIUS_API_KEY) throw new Error("HELIUS_API_KEY is not set");

const { runWatch } = await import("./watch.ts");
runWatch();
