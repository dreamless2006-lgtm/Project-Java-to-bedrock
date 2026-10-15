// The scene poses of our own females (on all fours for the Jenny Bed, sitting back on her hands for
// the belly scenes), solved onto each family's own rig from the poses authored in
// tools/lib/scene-poses.mjs. Written next to the mod's animations (git-ignored, they are rebuilt
// from the mod's geometry); run by `npm run import` after tools/import-jar.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { familySceneAnimations } from './lib/scene-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const MOD = 'minepreggo';
/** The humanoid ones: the monster bodies (four legs, a jelly) keep their own stance in a scene. */
const FAMILIES = ['zombie_girl', 'humanoid_creeper_girl', 'ender_woman', 'humanoid_slime_girl'];

/** @type {Record<string, unknown>} */
const animations = {};
for (const family of FAMILIES) {
  const file = join(RP, 'models/entity', MOD, `${family}.geo.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
  const geometry = JSON.parse(readFileSync(file, 'utf8'))['minecraft:geometry'][0];
  for (const [pose, animation] of Object.entries(familySceneAnimations(geometry))) animations[`animation.${MOD}.${family}.${pose}`] = animation;
}
const out = join(RP, 'animations', MOD, 'scene_poses.animation.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format_version: '1.8.0', animations }, null, 2) + '\n');
console.log(`Scene poses: ${Object.keys(animations).length} animations for ${FAMILIES.length} families`);
