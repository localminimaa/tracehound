<p align="center">
  <img src="docs/screens/banner.png" alt="Tracehound" width="100%" />
</p>

<h3 align="center">Follow the money. Every link a transaction you can open.</h3>

<p align="center">
  Paste a hacker's address or an exploit transaction and get the money trail, who funded the attacker<br/>
  and the wallets tied to them, in minutes instead of hours of clicking through explorers.
</p>

<p align="center">
  <a href="https://tracehound.pro"><img src="https://img.shields.io/badge/live-demo-ffb547?style=for-the-badge&labelColor=0a0d16" alt="Live demo" /></a>
  <img src="https://img.shields.io/badge/chains-9%20traced%20%C2%B7%205%20exits-4fd1e0?style=for-the-badge&labelColor=0a0d16" alt="Chains" />
  <img src="https://img.shields.io/badge/node-24-3ccf8e?style=for-the-badge&labelColor=0a0d16&logo=nodedotjs&logoColor=white" alt="Node 24" />
  <img src="https://img.shields.io/badge/typescript-strict-6ea8ff?style=for-the-badge&labelColor=0a0d16&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/EN%20%C2%B7%20RU%20%C2%B7%20%E4%B8%AD%E6%96%87-interface-b48cff?style=for-the-badge&labelColor=0a0d16" alt="Languages" />
</p>

<p align="center">
  <a href="#-the-trace">The trace</a> ·
  <a href="#-token-check">Token check</a> ·
  <a href="#-pump-rings">Rings</a> ·
  <a href="#-share-cards">Share cards</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="docs/GUIDE.md">Full guide</a>
</p>

<br/>

<p align="center">
  <img src="docs/screens/case-path.png" alt="The Bybit exploiter traced: suspect, labeled exploiter wallets, amounts on every flow" width="100%" />
</p>

<br/>

## 🔎 The trace

One address or one transaction hash in, a case out. Tracehound walks the chain in both directions and keeps only what an investigator would write down.

<table>
  <tr>
    <td width="50%" valign="top">

**Funding source.** Who paid the attacker's first gas, followed back until an exchange withdrawal, a mixer or a bridge.

**Money trail.** Where the stolen funds went, hop by hop, ranked by share, with the USD value at the time each flow moved.

**Through swaps and pools.** A DEX swap paid to a fresh wallet is followed through; liquidity positions handed to another wallet are linked.

**Across chains.** THORChain, Wormhole, Mayan, deBridge, Across, Stargate, LayerZero OFT tokens and Circle's CCTP: what went in is matched to what came out on the other side, and the trace continues there.

**What it means.** Exchange deposit addresses that can be frozen, sibling wallets of the same operator, known exploiters on the path, loot that returns to the funder.

  </td>
    <td width="50%" valign="top">
      <img src="docs/screens/tracing.png" alt="The hound sniffing while a trace runs, steps lighting up" />
      <br/><br/>
      <img src="docs/screens/case.png" alt="Case page: graph, best lead, where the money ended up" />
    </td>
  </tr>
</table>

> Every link between two wallets points to the transaction that created it. Tracehound does not guess who anyone is.

<br/>

## 🧪 Token check

A risk score for any token on **Solana**, **Base** or **BSC**, built from what the chain shows about the people behind it.

<p align="center">
  <img src="docs/screens/token.png" alt="Token check: risk gauge, signal chips, launch tape and the reasons behind the score" width="100%" />
</p>

| Signal | What it looks at |
|---|---|
| 👤 **Developer** | First funding, past launches of the developer's circle, how many are dead, whether they already sold |
| 🎯 **Launch** | Bundled buys, snipers in the first slots, fresh wallets among the top holders |
| 🕸️ **Rings** | Early buyers and holders that belong to a known pump ring, launches that follow a ring's playbook |
| 💧 **Liquidity** | Pools that can be pulled, mint and freeze authorities, supply concentration |
| 🤖 **Trading** | Round-trip volume from bots, socials reused from earlier tokens |

Every reason links to its wallets and transactions, and each signal shows how often it was followed by an 80% drop within a day.

<br/>

## 🕸️ Pump rings

Wallets that buy the same launches together are clustered into rings, each with its funders, its launch playbook and how its tokens ended. A live watch follows ring wallets and alerts on new ring-style launches.

<p align="center">
  <img src="docs/screens/rings.png" alt="Rings page" width="100%" />
</p>

<br/>

## 🖼️ Share cards

Every case and token check comes with a card for X, Telegram and Discord, drawn on the server, so a shared link carries its verdict.

<p align="center">
  <img src="docs/screens/card-case.png" alt="Case share card" width="49%" />
  <img src="docs/screens/card-token.png" alt="Token check share card" width="49%" />
</p>

<br/>

## 📱 On the phone

<p align="center">
  <img src="docs/screens/phone-home.png" alt="Home on a phone" width="30%" />
  &nbsp;
  <img src="docs/screens/phone-case.png" alt="A case on a phone" width="30%" />
  &nbsp;
  <img src="docs/screens/phone-token.png" alt="A token check on a phone" width="30%" />
</p>

<br/>

## ⛓️ Coverage

| | Chains | Source |
|---|---|---|
| **Traced** | Ethereum · Base · Arbitrum · Optimism · BSC · Polygon | Etherscan v2 |
| | Solana | Helius |
| | Tron | TronGrid |
| | Bitcoin | mempool.space |
| **Exit only** | Litecoin · Dogecoin · Bitcoin Cash · Avalanche · XRP | THORChain Midgard |

USD values come from DefiLlama at the time each flow moved. Exchange wallets come from public label sets and the exchanges' own proof-of-reserves reports.

<br/>

## ⚙️ How it works

```mermaid
flowchart LR
    Q([Address or tx]) --> F[Funding trail<br/>up to 4 hops back]
    Q --> O[Outflows<br/>3 levels, by share]
    F --> S[Siblings<br/>same funder, same time]
    O --> W[Swaps and pools<br/>followed through]
    O --> B[Bridges<br/>matched on the other chain]
    B --> O
    O --> D[Exchange deposits<br/>can be frozen]
    F & S & O & W & D --> C[(Case<br/>graph, findings, report)]
    C --> V[Web · API · Telegram · share cards]
```

<br/>

## 🚀 Quick start

```bash
git clone https://github.com/localminimaa/tracehound.git
cd tracehound
cp .env.example .env      # HELIUS_API_KEY, ETHERSCAN_API_KEY (TronGrid and Bitcoin work without keys)
npm install
npm start                 # http://localhost:8787
```

A fresh install starts with a demo set of traced hacks, token checks and a pump ring, so the pages are full on the first run.

```bash
npm run trace -- 0x47666fab8bd0ac7003bce3f5c3585383f09486e2   # trace from the terminal
npm run token -- <mint>                                       # token check from the terminal
npm run regress                                               # known hacks and tokens, recorded answers, ~10 s
```

<br/>

## 🔌 Public API

```bash
curl -H "Authorization: Bearer th_..." https://<host>/api/v1/token/<address>
curl -H "Authorization: Bearer th_..." https://<host>/api/v1/trace?q=<address-or-tx>
```

`/api/v1/token`, `trace`, `check`, `case`, `alerts` and `usage`, with keys made on the account page. Details in the [guide](docs/GUIDE.md#public-api).

<br/>

## 🧱 Built with

<p>
  <img src="https://img.shields.io/badge/Node.js-24-3ccf8e?style=flat-square&labelColor=0a0d16&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-type%20stripping-6ea8ff?style=flat-square&labelColor=0a0d16&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Cytoscape.js-graph-ffb547?style=flat-square&labelColor=0a0d16" alt="Cytoscape.js" />
  <img src="https://img.shields.io/badge/SQLite-accounts-4fd1e0?style=flat-square&labelColor=0a0d16&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/resvg-share%20cards-b48cff?style=flat-square&labelColor=0a0d16" alt="resvg" />
  <img src="https://img.shields.io/badge/Docker-compose-6ea8ff?style=flat-square&labelColor=0a0d16&logo=docker&logoColor=white" alt="Docker" />
</p>

No framework on the page: one HTML file, one script, one stylesheet. No build step on the server: Node runs the TypeScript directly.

<br/>

---

<p align="center">
  <img src="public/hound.png" width="56" alt="" /><br/>
  <sub>Made by <a href="https://github.com/localminimaa">localminimaa</a></sub>
</p>
