// Known pump rings: wallets found by `npm run smart` that buy nothing but a few tokens they pump together.
// The token check looks its early buyers up here. Kept in data/rings.json, merged run after run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Ring {
  id: string; // first wallet seen, stable across merges
  wallets: string[];
  funders: string[];
  tokens: { mint: string; symbol: string }[]; // tokens the ring was caught pumping
  // How its tokens were launched: a fresh developer wallet paid this exact SOL amount minutes before the
  // launch. Different funders, same amount, same launchpad is how one operator repeats itself.
  playbook?: { launchpad: string; amount: number }[];
  firstSeen: number;
  lastSeen: number;
}

// RINGS_FILE swaps the registry, so the regression set runs on a fixed one
const file: string | URL = process.env.RINGS_FILE || new URL("../data/rings.json", import.meta.url);
let cache: Ring[] | null = null;
let index: Map<string, Ring> | null = null;

// Drop the cached registry, so a long-running process sees rings added by the daily scan
export function reloadRings() {
  cache = null;
  index = null;
}

export function loadRings(): Ring[] {
  if (!cache) cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  return cache!;
}

// Known rings whose launch playbook is this launchpad and this exact funding of the developer
export function ringsByPlaybook(launchpad: string, amount: number): Ring[] {
  return loadRings().filter((r) => r.playbook?.some((p) => p.launchpad === launchpad && Math.abs(p.amount - amount) < 0.0005));
}

export function ringOf(wallet: string): Ring | null {
  if (!index) index = new Map(loadRings().flatMap((r) => r.wallets.map((w) => [w, r] as const)));
  return index.get(wallet) ?? null;
}

// A new ring sharing a wallet with known ones is the same ring seen again: they are merged
export function addRing(r: { wallets: string[]; funders: string[]; tokens: { mint: string; symbol: string }[]; playbook?: Ring["playbook"] }) {
  const now = Math.floor(Date.now() / 1000);
  const rings = loadRings();
  const same = rings.filter((x) => x.wallets.some((w) => r.wallets.includes(w)));
  const merged: Ring = {
    id: same[0]?.id ?? r.wallets[0],
    wallets: [...new Set([...same.flatMap((x) => x.wallets), ...r.wallets])],
    funders: [...new Set([...same.flatMap((x) => x.funders), ...r.funders])],
    tokens: [...new Map([...same.flatMap((x) => x.tokens), ...r.tokens].map((t) => [t.mint, t])).values()],
    playbook: [...new Map([...same.flatMap((x) => x.playbook ?? []), ...(r.playbook ?? [])].map((p) => [`${p.launchpad}|${p.amount}`, p])).values()],
    firstSeen: Math.min(now, ...same.map((x) => x.firstSeen)),
    lastSeen: now,
  };
  cache = [...rings.filter((x) => !same.includes(x)), merged];
  index = null;
  writeFileSync(file, JSON.stringify(cache, null, 1));
  return merged;
}
