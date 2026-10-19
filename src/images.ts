// A token's picture, found once and kept on disk: DexScreener's profile image, GeckoTerminal's, Helius's CDN copy of
// the metadata image (Solana), or the metadata image itself through a few IPFS gateways. Served from our own origin,
// so pages and the share-card canvas load it fast and without cross-origin trouble.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fetchJson } from "./util.ts";
import { allowed } from "./credits.ts";

const dir = new URL("../data/img/", import.meta.url);
mkdirSync(dir, { recursive: true });
const MAX = 2_000_000;
const missing = new Map<string, number>(); // key → when we last found nothing; retried after an hour
const pending = new Map<string, Promise<{ type: string; body: Buffer } | null>>();
const GT_NET: Record<string, string> = { solana: "solana", bsc: "bsc", base: "base", ethereum: "eth" };
const GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://w3s.link/ipfs/", "https://nftstorage.link/ipfs/", "https://ipfs.io/ipfs/"];

const keyOf = (chain: string, token: string) => `${chain}-${token}`.replace(/[^\w-]/g, "");

// Every IPFS link becomes the same file on each gateway, tried in turn
function variants(url: string): string[] {
  const cid = url.match(/ipfs\/(.+)$/)?.[1] ?? url.match(/^ipfs:\/\/(.+)$/)?.[1];
  return cid ? GATEWAYS.map((g) => g + cid) : [url];
}

function sniff(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("latin1", 4, 12) === "ftypavif") return "image/avif";
  return null;
}

async function download(url: string): Promise<{ type: string; body: Buffer } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "follow" });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/")) return null;
    const body = Buffer.from(await r.arrayBuffer());
    // The type comes from the bytes, not the header: only raster formats, never SVG, which can carry script and is
    // served from our own origin
    const kind = sniff(body);
    return kind && body.length <= MAX ? { type: kind, body } : null;
  } catch {
    return null;
  }
}

async function candidates(chain: string, token: string, hint?: string): Promise<string[]> {
  const out: string[] = [];
  const dex = await fetchJson(`https://api.dexscreener.com/tokens/v1/${chain}/${token}`, undefined, 1).catch(() => []);
  for (const p of dex ?? []) if (p.baseToken?.address?.toLowerCase() === token.toLowerCase() && p.info?.imageUrl) out.push(p.info.imageUrl);
  if (GT_NET[chain]) {
    const gt = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/${GT_NET[chain]}/tokens/${token}/info`, undefined, 1).catch(() => null);
    const a = gt?.data?.attributes;
    const u = a?.image?.small ?? a?.image_url;
    if (u && !/missing/.test(u)) out.push(u);
  }
  // Solana metadata through Helius: its CDN copy loads where IPFS gateways throttle. One DAS call (10 credits), background share.
  if (chain === "solana" && process.env.HELIUS_API_KEY && allowed("sample").ok) {
    const { helius } = await import("./chains/solana.ts");
    const asset = await helius().rpc("getAsset", { id: token }).catch(() => null);
    for (const f of asset?.content?.files ?? []) if (f.cdn_uri) out.push(f.cdn_uri);
    if (asset?.content?.links?.image) out.push(...variants(asset.content.links.image));
  }
  if (hint) out.push(...variants(hint));
  return [...new Set(out)];
}

export async function tokenImage(chain: string, token: string, hint?: string): Promise<{ type: string; body: Buffer } | null> {
  const key = keyOf(chain, token);
  const meta = new URL(`${key}.type`, dir), file = new URL(key, dir);
  if (existsSync(file) && existsSync(meta)) {
    // Cached before types were read from the bytes: an SVG or a broken file is fetched again
    const body = readFileSync(file), type = sniff(body);
    if (type) return { type, body };
  }
  if (Date.now() - (missing.get(key) ?? 0) < 3600_000) return null;
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      for (const url of await candidates(chain, token, hint)) {
        const img = await download(url);
        if (!img) continue;
        // Written aside and renamed, so a reader never gets half a file (another process, or a restart mid-write)
        writeFileSync(`${file.pathname}.tmp`, img.body);
        renameSync(`${file.pathname}.tmp`, file.pathname);
        writeFileSync(meta, img.type);
        return img;
      }
      missing.set(key, Date.now());
      return null;
    })().finally(() => pending.delete(key)));
  }
  return pending.get(key)!;
}
