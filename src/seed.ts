// A fresh install starts with the demo set in seed/ (cases, token checks, rings found while building the site),
// so the pages are not empty on day one. Only empty data folders are filled: data already collected is never touched.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = (dir: URL) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")) : []);

export function seed(log: (s: string) => void = console.log) {
  if (process.env.NO_SEED) return;
  for (const kind of ["cases", "tokens"]) {
    const from = new URL(`seed/${kind}/`, root), to = new URL(`data/${kind}/`, root);
    if (json(to).length || !json(from).length) continue;
    mkdirSync(to, { recursive: true });
    for (const f of json(from)) copyFileSync(new URL(f, from), new URL(f, to));
    log(`seeded data/${kind} with ${json(from).length} demo files`);
  }
  const rings = new URL("data/rings.json", root), demo = new URL("seed/rings.json", root);
  if (!existsSync(rings) && existsSync(demo) && !process.env.RINGS_FILE) {
    copyFileSync(demo, rings);
    log("seeded data/rings.json with the demo rings");
  }
}
