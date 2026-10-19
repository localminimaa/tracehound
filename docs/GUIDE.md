# Tracehound: the full guide

Everything about running, configuring and extending Tracehound. The overview is in the [README](../README.md).

Paste a hacker's address or the exploit transaction. In a few minutes you get what an investigator would otherwise spend hours clicking through explorers and Dune to find:

- **Funding source**: who paid the attacker's first gas. The trail is followed back until it hits an exchange withdrawal, a mixer or a bridge.
- **Money trail**: where the stolen funds went, hop by hop, until they reach exchanges, bridges or mixers.
- **Through swaps**: when a DEX swap pays its output to a different wallet, the trace follows that wallet instead of stopping at the router.
- **Across chains**: money sent into THORChain, Wormhole, Mayan, deBridge, Across, Stargate (and other LayerZero token bridges, such as USDT0) or Circle's CCTP is matched to what came out on the other side (for example ETH in, BTC out at this address) through each bridge's own index, and the trace continues there when that chain is supported.
- **Deposit addresses**: wallets that forward almost everything to an exchange. The exchange can identify the owner and freeze the funds.
- **Sibling wallets**: other wallets that the same funder created around the same time.
- **Known exploiters**: wallets on the trail that public label data already tags as exploiters.
- **Loot back to the funder**: stolen funds that return to the wallet that paid the attacker's gas, which proves one operator.
- **Time-zone hint**: the attacker's daily silent window.
- **Report and export**: every case has a written report built from its findings by a template (no key, no cost), with every address and tx linked to its explorer. It downloads as Markdown (`/api/case/<id>.md`) or prints to PDF; token checks export the same way (`/api/check/<id>.md`).

Chains: Ethereum, Base, Arbitrum, Optimism, BSC, Polygon (Etherscan v2), Solana (Helius), Tron (TronGrid, works without a key) and Bitcoin (mempool.space, keyless). Litecoin, Dogecoin and the other THORChain chains appear as end points with explorer links. Every flow of a known asset carries its USD value at the time it moved (DefiLlama).

## Run

```bash
cp .env.example .env   # fill in HELIUS_API_KEY, ETHERSCAN_API_KEY, DUNE_API_KEY (TRONGRID_API_KEY optional)
npm install
npm start              # http://localhost:8787
```

CLI: `npm run trace -- <address|tx> [chain]`

A fresh install starts with the demo set in `seed/` (traced hacks, token checks on Solana, Base and BSC, a pump ring): on start the server copies it into `data/cases`, `data/tokens` and `data/rings.json` only when those are empty, so collected data is never touched. `NO_SEED=1` skips it.

## Web app

- **Case graph**: wallets as cards (type icon, name or address, dollar value, chain badge), one dollar pill per flow with amount, txs and dates on hover, each chain in its own lane. A wallet paying six or more dead-end wallets folds them into one group node (click to open). Selecting a wallet lights the whole way the money took to reach it. The toolbar hides small flows and gas funding, toggles groups and replays the flows in time order; larger graphs get a minimap.
- **The hound** in the corner sniffs while a trace or check runs, barks at high risk or strong leads, hops when a token looks clean. Optional 8-bit sounds (speaker button, off by default, made with WebAudio). The home preview replays the latest case in the order the money moved. Phones get a bottom bar instead of the top nav.
- **Link previews**: a shared case, token check or the site itself shows a picture in X, Telegram and Discord. `src/og.ts` draws it as SVG and rasterizes it with resvg (fonts in `public/fonts/`), served at `/og/case/<id>.png`, `/og/check/<id>.png` and `/og/site.png`, kept in `data/og/`; the page carries the matching `og:` and `twitter:` tags. Set `PUBLIC_URL` to have them point at the public domain (otherwise the request's host).
- **Token page**: a header with the token's picture, live value, 1h/24h change, a 24 h sparkline and the risk gauge; a row of signal chips (dev bought / sold, bundled, snipers, top 10, fresh holders, liquidity, mint and freeze, launch farm, ring, bot trading, smart money); a launch tape of creation, bundled buys and developer sells on a log time scale.
- **Token pictures**: `/api/img?chain=&token=` finds a token's picture once (DexScreener, GeckoTerminal, Helius CDN for Solana, IPFS gateways) and keeps it in `data/img/`.
- **Share cards** for X, a ticker of fresh findings, manual labels, Markdown/PDF export and the method page (`/?method`).

## Languages

The interface speaks English, Russian and Chinese (switch at the top right; remembered per browser, English by default). `public/i18n.js` holds the table: English text → Russian and Chinese. Plain text on the page is swapped in place as it appears; strings with values go through `t("… {name} …", { name })`, so new UI text needs an entry there. Titles of findings and reasons, signal lines and liquidity notes written by the server are translated on the page by pattern (`FINDINGS` in `i18n.js`; an unknown title shows in English, so a new finding needs a pattern there). Their longer descriptions, logs and the agent's diary stay English.

## Trace from a token check

The token page's **Trace ▾** menu lists every wallet the check found worth following: the developer, whoever funded the developer, the developer's other wallets, outside wallets that funded several top holders, and the top holders. Picking one runs a trace from it on the token's chain. `GET /api/traceable` says which chains this server's keys can trace (EVM chains are probed against the Etherscan plan once per six hours); on the others the menu explains why it is off.

## Solana RPC providers

Plain Solana RPC (signatures, transactions, accounts, token balances) goes first to the endpoints in `SOLANA_RPC_URLS`, other providers' free plans such as Chainstack and QuickNode, taking turns. A method a plan leaves out is learned on the first refusal and skipped for that provider; one that is down or rate-limited sits out a minute; Helius answers whatever none of them can and stays the only source of DAS and parsed transactions. On a token check this moves the plain calls (about a fifth of the Helius credits) off Helius; the ring watch's wallet polls and the bot's balance checks are plain calls too. The regression set stays on Helius so its recorded answers keep matching.

## Accounts and plans

Sign-in is a wallet signature: the site asks the server for a one-time message (domain, address, nonce, time), the wallet signs it (Phantom/Solflare ed25519, MetaMask personal_sign), the server checks it and sets an httpOnly session cookie for 30 days. No passwords or emails are stored; a user is a wallet, a plan and the day's usage, in SQLite (`data/app.db`, Node's built-in `node:sqlite`).

Plans: Free (5 token checks and 1 trace a day), Standard $19 (100 / 10), Pro $99 (300 / 20). A new check or trace counts against the day; showing a saved one does not. Without an account the count is per IP. Limits are on when `TRUST_PROXY` is set (behind Caddy, where the client IP comes from X-Forwarded-For) or `ENFORCE_LIMITS=1`; local development runs without them. `/?account` shows the plan, today's usage, the plans and past payments.

What a paid plan adds: every plan gets the same verdict and every reason (a safety check must not get worse when it is free). Paid plans also get the holder map, the developer's past launches and the chart (the API strips them from free responses, the page shows them as locked tabs), a fresh check any time (the free plan is shown a saved check up to 6 h old), and Markdown and PDF export; Pro share cards carry no logo. When limits are off (local development) everything is open.

Payments are USDC on Solana or Base, straight to our wallet (`PAY_SOLANA_ADDRESS`, `PAY_BASE_ADDRESS`; a chain with no address is not offered, none means payments are off). Picking a plan, a period (30 days, or 365 for the price of ten months) and a chain makes an invoice whose amount is the price plus up to a cent of micro-USDC unique among open invoices, e.g. `99.004372`; that tail is how a transfer is matched to its buyer, so the amount must be exact. The page offers a Solana Pay link or, on Base, a USDC transfer through MetaMask. While any invoice is open the server polls once a minute: Solana, new signatures on our USDC token account and the balance each added (Helius, else public RPC; the wallet needs its USDC account, which its first USDC creates); Base, USDC Transfer logs to our address on a public RPC. A match pays the invoice once per transaction and turns the plan on; the same plan extends from its end, a higher one starts now, a lower one cannot be bought over a running higher one. Late transfers count for 6 hours. Plans can still be set by hand (gifts, testers): `npm run plan -- <wallet> <free|standard|pro> [days]`.

## Token check (Solana)

`npm run token -- <mint>`, or the Token Check page of the web app, answers "should I touch this token?" in under a minute, with a 0–100 risk score and evidence for every point:

- **Launch farm**: what the developer and the other wallets of the developer's funder launched before, and how many of those tokens are dead now (DexScreener).
- **Developer exit**: how much of the launch-tx bag the developer has already sold.
- **Bundles**: first buyers whose money came from the developer, the developer's funder, or a shared funder. Snipers that bought in the launch block.
- **Holders**: share of supply held by the developer's wallets and by the top 10, with pools and bonding curves excluded.
- **Authorities**: mint or freeze authority still set.
- **Fresh holders**: top holders whose wallets got their first money in the last 24 h.
- **Liquidity**: whether the pool's liquidity can be pulled (pump.fun curve and PumpSwap are locked; Raydium by its burned LP share; Meteora and concentrated pools can be withdrawn).
- **Bot trading**: share of recent trades made by wallets that both bought and sold, and by the five busiest wallets.
- **Reused socials**: the same X account, Telegram, site or image as a token checked before.
- **Smart money**: early buyers or holders that the latest `npm run smart` scan rated as good traders (a note, no points).
- **Holder farm**: in the latest 100 transactions, one wallet sending the token to 30+ wallets outside any pool (fake holders), or 30+ wallets sending it to one (a wallet farm swept into one hand, usually before a sale). Stronger when that wallet is the developer's.
- **Pump ring**: early buyers that belong to a ring found by `npm run smart` (below). The same people who pumped other tokens together are buying this one. When the developer's money comes from the ring (its wallet or funder, up to two hops), developer and buyers are one operator. A ring also leaves a launch playbook: its developers get the same exact SOL amount minutes before launching on the same launchpad, each from a different funder. A new launch with that playbook is flagged before the ring buys in.

Launches are recognised on pump.fun, Meteora DBC and Raydium LaunchLab (letsbonk); the developer is the creator the launchpad names, not whoever paid the fee.

The web page adds a price chart with the launch, bundled buys and developer sells marked (GeckoTerminal candles), a holder map that links top holders to the wallets that funded them, the developer's past tokens with their peak and lifetime, and a watch: while the site is open, the developer's wallets are re-read every 2 minutes and a sell raises a browser notification. The Accuracy table shows how each verdict group did 24 h after the check; the server records those outcomes every hour, and `SAMPLE_EVERY_H` / `SAMPLE_N` make it also check fresh tokens on a schedule to grow the sample.

### Base and BSC

A 0x token address is checked on Base or BSC (whichever has a pool) from free sources only, since Etherscan serves these chains on paid plans: GoPlus for what the contract lets its owner do (honeypot, tax, mint, blacklist, pause, hidden owner, proxy), the creator, the top holders and who holds the pool's LP tokens; GeckoTerminal for the pool's last 300 trades (bot trading, and for a pool under a day old, wallets that bought in the first blocks); a public RPC for current balances in the watch. Wallet histories need an indexer, so the developer's funding and past launches are not checked there, and launchpad bonding curves (four.meme, Flap) have no trade list. `BASE_RPC_URL` and `BSC_RPC_URL` replace the default publicnode endpoints.

Every check is saved to `data/tokens/` so verdicts can later be compared with what happened to the token.

- `node scripts/sample.ts [N]` first records what happened to earlier checks 24 h later (`data/outcomes.json`, DexScreener only), then checks N fresh Solana tokens from DexScreener (about 15 s and 200–300 Helius credits each; it prints the cost). `N=0` only records outcomes. Run it every few hours to grow the sample.
- `npm run signals` scores every signal on the same set: of the tokens that had it, how many fell 80%+ in 24 h, against those without it (the site shows this on the method page, the token check page and under each reason). The basis for re-weighting the points.
- `node scripts/backtest.ts` compares each verdict group on that 24 h horizon: how many fell 80%+, halved, grew 2x+, the median change. `--now` uses the value right now instead, for tokens not yet 24 h old.

## Smart money and rings (Solana)

`npm run smart` (or `npm run smart -- <winner mint>...`) looks at who got into this week's winners early:

- **Winners**: Solana tokens under 7 days old now worth $250k+ with $20k+ in the pool (GeckoTerminal trending and top-volume lists). Look-alikes of real coins and printed supply are cut by a $100M ceiling.
- **Early buyers**: wallets that bought one of the first 100 transactions of a winner themselves (developer and bots that buy everything excluded). Those early in 2+ winners are the candidates.
- **Hit rate**: each candidate's other buys of young tokens in its last 300 transactions, and how many of those are now worth $250k+. The winners that selected the wallet are left out, so the rate is not self-fulfilling.
- **Clusters**: candidates are one hand when they share a funder, one funded another, or they buy nothing but the same 2+ winners.
- **Rings**: a cluster that buys almost nothing but these winners is the team pumping them, not smart money. First run found 21 wallets with 18 different funders all early in the same 4 "winners" and in nothing else.

One run costs about 2k Helius credits and is saved to `data/smart/`. Rings are kept in `data/rings.json`, merged run after run (a new ring sharing a wallet with a known one is the same ring), and the token check looks its first 100 transactions up there.

## Live watch (Solana)

`npm run watch` runs two sources, each with a price fixed by design rather than by how busy the market is:

- **Known ring wallets, polled** every `RING_POLL_MIN` minutes (default 15): the tokens each wallet holds, two plain RPC calls a wallet (~4.8k credits a day for 25 wallets). A token a wallet did not hold at the last look is checked against that wallet's last 50 transactions (10 credits): if the ring paid SOL or a stablecoin for it, alert `ring_buy` ("bought it", or "bought it and sold it back in one transaction: volume farming"); tokens that arrived for free (spam) do not alert. Streaming these wallets was tried first and cost ~100k credits a day: a ring wash-trading around the clock is about one event a second.
- **Launches over Helius Parsed Streams** (1 credit per event), only on launchpads where a known ring has a playbook (now Meteora DBC, ~1.9k launches a day; LaunchLab ~1k when a playbook needs it; pump.fun, ~35k a day, is never streamed). A creator with 4 transactions or fewer whose first SOL matches the playbook amount within 5 min of the launch is a `playbook_launch` alert (two plain RPC calls a launch).

Alerts get a token check (source `watch`, one at a time, 5 min cap, at most `WATCH_CHECKS_A_DAY` a day, default 8: an active ring buys a dozen new tokens a day and a check is ~500 credits) and goes to `data/alerts.jsonl`; `GET /api/alerts` lists them newest first. The same token does not alert twice within 6 h. Both sources stop at 55% of the day's credit budget (the stream is closed within a minute of crossing it) and come back after midnight UTC. Wallet holdings are kept in `data/watch-state.json`, so a restart does not alert on old holdings.

## Public API

Pro accounts make API keys on the account page (3 at most; a key is shown once and stored only as a hash). A request with `Authorization: Bearer th_...` (or `x-api-key`) acts as its account: the same plan, the same daily limits as the site, counted together; a check or trace that fails is not counted. Plain JSON, CORS open:

- `GET /api/v1/token/<mint>[?fresh]`: a token check (a saved one under 30 min old unless `fresh`); `{ id, url, check }`. Up to a minute.
- `GET /api/v1/trace?q=<address or tx>[&chain=]`: a trace; `{ id, url, case }`. A few minutes.
- `GET /api/v1/check/<id>`, `GET /api/v1/case/<id>`: saved results.
- `GET /api/v1/alerts[?limit=]`: the live ring alerts, newest first.
- `GET /api/v1/usage`: plan and today's use.

Errors are `{ error }` with 401 (no or unknown key), 403 (not Pro), 400 (not an address), 429 (daily limit), 503 (busy or the day's budget spent).

## Telegram bot

`npm run bot` (the `bot` service in production) answers in Telegram and sends alerts:

- `/check <token>`: verdict, top reasons and a link to the token page (Solana, Base, BSC). Counts against the plan's checks a day.
- `/watch <token>`: a message each time the developer's wallets sell another 20% of what they held at the check, and any ring alert about that token. A Solana token costs 2 plain RPC calls a poll (the largest holders and their owners), however many developer wallets it has. 40 tokens in all.
- `/wallet <address> [chain]`: a message when money leaves the wallet (Solana: 1 call a poll, parsing only when something moved; EVM chains through Etherscan). A busy wallet gets at most one message in 30 min, with the rest counted. Tokens and wallets together: 1 on Free, 25 on Standard, 100 on Pro.
- `/rings on|off`: the live ring feed from `data/alerts.jsonl`.
- `/plan`: the plan this chat is on and what is left today. `/link <code>` (or the `t.me/<bot>?start=<code>` link) ties the chat to a site account: the account page (Account, Telegram) makes a one-time code good for 15 minutes. A tied chat uses the account's plan and its checks count with the site's; any other chat is on the Free plan by itself. Set `TELEGRAM_BOT_NAME` (the bot's username) so the account page links straight to the bot.

Polls run every `TG_POLL_MIN` minutes (default 5) and stop with the day's credit budget like the watch. State is in `data/telegram.json`; a chat that blocks the bot is dropped. It needs `TELEGRAM_BOT_TOKEN` in `.env` (from @BotFather) and idles without it.

## Paper agent

`/?agent` and `GET /api/agent`. A trading agent on paper, run hourly by the web server (`src/agent.ts`, state in `data/agent.json`). It trades only the tokens the sampler checks (`SAMPLE_EVERY_H`), so it costs no extra checks:

- **Buy**: anything the check does not call high risk, with a pool of at least $3k; stake $100 × (1 − risk / 100), at least $10.
- **Sell**: at 2x, at −50%, when the developer's wallets dumped half of what they held at the check (two RPC calls per open position, under the watch budget), when the pool is gone, or after 24 h. Prices from DexScreener, looked at hourly; 2% fee and slippage each way.
- **Baseline**: the same tokens, all of them, $100 each, held 24 h. The agent is worth real money only after it beats this for weeks.
- **Diary**: one entry per finished UTC day, with a short version sized for an X post and a copy button. Nothing is posted automatically.

The rules sit in `RULES` and are hand-set; they get tuned once the signal table (`npm run signals`) has enough judged tokens. The agent starts from the moment `data/agent.json` is first written; earlier checks are not traded in hindsight.

## Production

Live at https://tracehound.193-233-233-118.sslip.io (behind Caddy; a real domain comes later).

- `/opt/tracehound`, `docker compose -f deploy/compose.yaml`: `web` (site and API on 127.0.0.1:8797, `TRUST_PROXY=1` so daily limits count real IPs, samples 3 fresh tokens every 3 h and records 24 h outcomes hourly) and `watch` (live watch). Memory caps 400 MB and 300 MB.
- `data/` is a host volume: labels from the repo plus everything the app collects (checks, outcomes, rings, alerts, accounts, credit log). A deploy never overwrites it; only the label files are synced.
- Daily ring scan: host cron `17 12 * * * /opt/tracehound/deploy/cron.sh smart`, output in `data/cron.log`.
- Deploy from a checkout: `deploy/deploy.sh` (type check, rsync code, rebuild, restart, health check). Keys live in `/opt/tracehound/.env` (600), never in the repo.
- Background jobs run only on the server now; the Mac launchd jobs are parked in `~/Library/LaunchAgents/disabled/`. Two machines on one Helius key would split the budget and the data.

## Regression set

`npm run regress` runs known tokens and hacks (ALLOX and FABLES of the known ring, a DBC and a pump.fun launch farm, a bundle, a clean token, the Bybit and Mango exploiters) and fails when a finding they must produce is missing or one they must not produce appears. It replays API answers recorded in `data/regress-cache` (`HTTP_CACHE`) against a fixed ring registry (`scripts/regress/rings.json`): about 10 s and no credits once recorded. The first run on a new machine records them (~4k Helius credits); `-- --fresh` records everything again, `-- <name>` runs one case, `HTTP_CACHE_LOG=1` prints the answers fetched live.

A pre-push hook runs it: `git config core.hooksPath .githooks` once per clone.

## How it works

| Step | What it does |
|---|---|
| resolve | A tx hash is turned into its sender. For an EVM address, the chains it was active on are detected. |
| funding | Earliest incoming value, repeated up to 4 hops back. Stops at an exchange, mixer, bridge or busy hot wallet. |
| siblings | The funder's other early recipients whose *first* deposit also came from it. |
| outflows | Breadth-first trace, `MAX_DEPTH` levels deep and `BRANCHES` largest recipients per wallet. Stops at labeled services and contracts. |
| swaps | Money sent to a router or pool: the tx is opened (token Transfer logs and internal transfers), and an output paid to a wallet other than the sender becomes the next hop. |
| bridges | Money sent to a THORChain router or vault (known from THORNode's active vaults, or a THORChain memo on the deposit) is looked up in Midgard by its tx hash. The outbound address on the destination chain becomes a lead, traced up to `MAX_HOPS` chains away. |
| labels | `data/labels.json` (seed), then `data/labels-open.json`: about 41k exchange, mixer, bridge and exploiter addresses from the open [eth-labels](https://github.com/dawsbot/eth-labels) dataset, then `data/labels-cex.json`: about 2k exchange wallets on every chain, Solana and Tron included, from the exchanges' proof-of-reserves reports. Dune `labels.addresses` is used if a key is set. Unlabeled wallets with very high activity count as hot wallets. |

Every edge keeps its transaction hashes. Click a node for its explorer and Arkham pages, or an edge for its transaction.

Refresh the open labels: download `data/csv/accounts.csv` from eth-labels and run `node scripts/import-labels.ts accounts.csv`. Refresh the exchange wallets with `npm run labels:cex` (Binance and Bybit from their own proof-of-reserves reports, OKX, KuCoin, Bitget, HTX, Gate, Bitfinex and smaller exchanges from DefiLlama's lists of those reports; only the addresses are read, nothing from those files runs). Exchanges add wallets over time, so once a month is enough.

## Limits (v0.1)

- Amounts are per asset, with no USD pricing. Branches are ranked by each recipient's share of the outflow of each asset.
- Swaps are followed only when the output goes to another wallet. Output back to the sender is covered by that wallet's own outflows. Liquidity laundering is linked on EVM chains: for every traced wallet, the LP tokens minted to it (a contract answering token0/token1) and the Uniswap V3 style position NFTs minted to it are followed. LP or a position handed to another wallet, LP minted straight to another wallet when adding, and pulls (LP sent back to the pair, or V3 Collect events by position id) that pay a wallet other than the adder become `lp_laundering` findings, graph edges through the pool, and new wallets to trace. Up to 3 positions per wallet and 3 pulls each; one handover step for V2. A V3 position handed over empty is ignored. Not on Solana yet.
- Bridges crossed: THORChain, Wormhole, Mayan, deBridge, Across, Stargate v1 and v2 (taxi and bus), LayerZero OFT tokens (USDT0 and the like, through LayerZero Scan), Circle's CCTP (read from the burn event itself, since Circle's API is blocked in some regions). Exchange-run bridges still end the trace on the source chain. A payout on a chain the Etherscan plan does not cover (Base, BSC and Optimism on the free plan) is shown and the trace stops there. An unlabeled contract is asked about every bridge, which adds about a second per tx.
- Litecoin, Dogecoin and the rest are end points: the address and outbound tx are shown, but the trace does not continue there.
- On Bitcoin the sender of a tx is its largest input and outputs back to any input are change. CoinJoin and batched exchange payouts break that reading, and an address with 2000+ txs is treated as a service.
- Tron has no public label data here, so exchanges on Tron are recognised only as busy wallets. Dune Spellbook lists exchange wallets for Tron, Solana and Bitcoin, but its license (BSL 1.1) forbids using it in a data platform until March 2027.
- Labels can be added from the wallet card ("Label"). They are stored in `data/labels-manual.json`, shared through the repo, override every other source and show on older cases too. With `LABEL_TOKEN` set, only requests carrying it in `x-label-token` may write.
- Without a TronGrid key Tron is rate limited, and a full trace takes a few minutes.
- Etherscan's free tier does not cover every chain. If a chain is not on your plan, it is skipped.
- Spare Helius keys go in `HELIUS_FALLBACK_KEYS` (comma separated). A key that keeps refusing (429 after the retries, a usage or credit error) sits out an hour, a rejected one (401/403) a day, and the next key takes over, the live watch's stream included.
- Helius credits have a daily budget shared by every process (`HELIUS_DAILY_CREDITS`, default 33k, a 30th of the free plan). Each process appends its spend to `data/credits/<day>.log`; the sampler stops starting checks at 40% of the day, the ring scan at 50%, the live watch at 55%, free Solana checks and traces (site and bot) at 85%, paid ones at 100% (until midnight UTC). Background work cannot stop the site, and the last 15% of the day is kept for paying users. `GET /api/credits` shows today's use.
- Solana runs on Helius Parsed Events (10 credits a request). A Solana trace costs about 300 credits and a token check 200–300, so the free plan (~1M credits a month) covers a few thousand of them.
- A token check looks for past launches in the last 300 transactions of each wallet around the developer and stops after 15 found. Older launches of a busy wallet are missed.
