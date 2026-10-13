// Packages packs/behavior and packs/resource into dist/minepreggo-<version>.mcaddon.
// Run `npm run import` first: the resource pack is unusable without the jar's assets.
// Of the imported textures, sounds and models, only those referenced from a resource pack JSON file
// are shipped, so each release carries just the assets of features that have actually been ported.

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

// Converted models and animations are referenced by identifier rather than by path.
const DEFINITIONS = ['models/entity/minepreggo/', 'animations/minepreggo/'];
const IMPORTED = ['textures/minepreggo/', 'sounds/minepreggo/', ...DEFINITIONS];
const isImported = (path) => IMPORTED.some((prefix) => path.startsWith(prefix));
const isDefinitions = (path) => DEFINITIONS.some((prefix) => path.startsWith(prefix));

/** The geometry or animation identifiers a converted file defines. */
function definedIds(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return [...(json['minecraft:geometry'] ?? []).map((g) => g.description.identifier), ...Object.keys(json.animations ?? {})];
}

/**
 * Every "textures/minepreggo/..." or "sounds/minepreggo/..." path and "geometry.minepreggo...." or
 * "animation.minepreggo...." identifier used by the resource pack's own JSON files (the converted
 * files are not searched, so they don't count as referencing themselves).
 */
function referencedAssets(rpDir) {
  const refs = new Set();
  const visit = (node) => {
    if (typeof node === 'string') {
      if (isImported(node) || /^(geometry|animation)\.minepreggo\./.test(node)) refs.add(node);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  for (const file of walk(rpDir)) {
    const inner = relative(rpDir, file).split(sep).join('/');
    if (file.endsWith('.json') && !isDefinitions(inner)) visit(JSON.parse(readFileSync(file, 'utf8')));
  }
  return refs;
}

/** Whether an imported file is used: textures and sounds by path, models and animations by identifier. */
function isUsed(inner, file, used) {
  if (isDefinitions(inner)) return definedIds(file).some((id) => used.has(id));
  return used.has(inner.replace(/\.(png|tga|ogg|wav)$/, ''));
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const pack of PACKS) {
  const manifest = JSON.parse(readFileSync(join(ROOT, pack.dir, 'manifest.json'), 'utf8'));
  if (manifest.header.version !== version) {
    console.error(`${pack.dir}/manifest.json is version ${manifest.header.version}, package.json ${version} - run \`npm run check\`.`);
    process.exit(1);
  }
}
const used = referencedAssets(join(ROOT, 'packs/resource'));
const entries = {};
for (const pack of PACKS) {
  const base = join(ROOT, pack.dir);
  for (const file of walk(base)) {
    const inner = relative(base, file).split(sep).join('/');
    if (isImported(inner) && !isUsed(inner, file, used)) continue;
    entries[`${pack.name}/${inner}`] = new Uint8Array(readFileSync(file));
  }
}

const out = join(ROOT, 'dist', `minepreggo-${version}.mcaddon`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zipSync(entries, { level: 9 }));
console.log(`Wrote ${relative(ROOT, out)} (${Object.keys(entries).length} files)`);
