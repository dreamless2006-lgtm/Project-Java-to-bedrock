// A stand-in for Actions & Stuff, to test what its players see without owning it (it is a paid,
// encrypted Marketplace pack, and nothing of it is used here). The stand-in is a one-file resource
// pack: our own player client entity with every Minepreggo part taken out
// (tools/lib/compat-poses.mjs standinEntity), so a game that puts it ABOVE Minepreggo (Resources)
// draws players with a plain model, exactly where Actions & Stuff sits in the pack stack. On it, a
// pregnant player shows only what crosses over to other player models: the compat poses and the
// off-hand belly. Development aid only; written to dist/ (git-ignored), never shipped.
//   npm run standin   ->  dist/standin-rp/ and dist/minepreggo-standin-player.mcpack
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { standinEntity, standinManifest } from '../lib/compat-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RP = join(ROOT, 'packs/resource');
const OUT = join(ROOT, 'dist/standin-rp');
const PACK = join(ROOT, 'dist/minepreggo-standin-player.mcpack');
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

const manifest = standinManifest(read(join(ROOT, 'package.json')).version, read(join(RP, 'manifest.json')).header.min_engine_version);
const entity = standinEntity(read(join(RP, 'entity/player.entity.json')));

/** @type {Record<string, string>} path inside the pack -> contents */
const files = {
  'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
  'entity/player.entity.json': JSON.stringify(entity, null, 2) + '\n',
};
// Start from an empty folder, so nothing of an older stand-in lingers next to the new files.
rmSync(OUT, { recursive: true, force: true });
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), text);
}
writeFileSync(PACK, zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])), { level: 9 }));
console.log(`Wrote ${relative(ROOT, OUT)}/ and ${relative(ROOT, PACK)}: import it and put it ABOVE Minepreggo (Resources) in the world's resource packs`);
