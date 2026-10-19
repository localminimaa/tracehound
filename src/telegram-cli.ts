// node src/telegram-cli.ts   the Telegram bot (see src/telegram.ts); idles without TELEGRAM_BOT_TOKEN
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}

const { runBot } = await import("./telegram.ts");
await runBot();
