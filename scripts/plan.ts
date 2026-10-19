// Set a user's plan by hand until payments exist. Usage: npm run plan -- <wallet> <free|standard|pro> [days]
const { setPlan, PLANS } = await import("../src/auth.ts");
const [wallet, plan, days] = process.argv.slice(2);
if (!wallet || !(plan in PLANS)) {
  console.error("usage: npm run plan -- <wallet> <free|standard|pro> [days]");
  process.exit(1);
}
console.log(setPlan(wallet, plan as any, days ? Number(days) : undefined) ? `${wallet} is on ${plan}${days ? ` for ${days} days` : ""}` : "no user with this wallet yet: they need to sign in once first");
