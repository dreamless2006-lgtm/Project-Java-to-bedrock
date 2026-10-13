// Packages packs/behavior and packs/resource into dist/minepreggo-<version>.mcaddon.
// Run `npm run import` first: the resource pack is unusable without the jar's assets.
// Of the imported textures, only those referenced from a resource pack JSON file are shipped,
// so each release carries just the art for features that have actually been ported.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = [
  { dir: 'packs/behavior', name: 'Minepreggo_BP' },
  { dir: 'packs/resource', name: 'Minepreggo_RP' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (!existsSync(join(ROOT, 'packs/resource/textures/minepreggo'))) {
  console.error('Imported assets are missing - run `npm run import` first.');
  process.exit(1);
}

const IMPORTED = 'textures/minepreggo/';

/** Every "textures/minepreggo/..." string in the resource pack's JSON files. */
function referencedTextures(rpDir) {
  const refs = new Set();
  const visit = (node) => {
    if (typeof node === 'string') {
      if (node.startsWith(IMPORTED)) refs.add(node);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  for (const file of walk(rpDir)) if (file.endsWith('.json')) visit(JSON.parse(readFileSync(file, 'utf8')));
  return refs;
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const used = referencedTextures(join(ROOT, 'packs/resource'));
const entries = {};
for (const pack of PACKS) {
  const base = join(ROOT, pack.dir);
  for (const file of walk(base)) {
    const inner = relative(base, file).split(sep).join('/');
    if (inner.startsWith(IMPORTED) && !used.has(inner.replace(/\.(png|tga)$/, ''))) continue;
    entries[`${pack.name}/${inner}`] = new Uint8Array(readFileSync(file));
  }
}

const out = join(ROOT, 'dist', `minepreggo-${version}.mcaddon`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zipSync(entries, { level: 9 }));
console.log(`Wrote ${relative(ROOT, out)} (${Object.keys(entries).length} files)`);
