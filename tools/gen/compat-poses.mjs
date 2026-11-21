// The compat copies of the player's pose animations (animation.minepreggo.as.*) that
// packs/behavior/scripts/player/compat.js plays on every player near a pregnant one, so that games
// with another player model (Actions & Stuff) see her labor, back pain, belly rubs and heavy walk.
// Each copy only moves the vanilla humanoid bones and turns itself off on our own model and in
// first person (tools/lib/compat-poses.mjs says why). The labor poses come from the mod jar, so the
// copies are written next to them, git-ignored; run by `npm run import` after tools/import-jar.mjs.
//   node tools/gen/compat-poses.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPAT_FILE, COMPAT_SOURCES, compatAnimations } from '../lib/compat-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RP = join(ROOT, 'packs/resource');

/** @type {Record<string, any>} */
const files = {};
for (const file of new Set(COMPAT_SOURCES.map((s) => s.file))) {
  const path = join(RP, file);
  if (!existsSync(path)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
  files[file] = JSON.parse(readFileSync(path, 'utf8'));
}
const { animations, skipped } = compatAnimations(files);
// A copy with no vanilla bone left would be an empty animation, which makes the game refuse the
// whole file, so it is left out (tools/validate.mjs then reports the id player/compat.js misses).
for (const name of skipped) console.warn(`compat poses: ${name} moves no vanilla bone, left out`);
const out = join(RP, COMPAT_FILE);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format_version: '1.8.0', animations }, null, 2) + '\n');
console.log(`Compat poses: ${Object.keys(animations).length} animations`);
