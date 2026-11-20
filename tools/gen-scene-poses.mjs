// The scene poses of our own females (on all fours for the Jenny Bed, sitting back on her hands for
// the belly scenes), solved onto each humanoid family's own rig from the poses authored in
// tools/lib/scene-poses.mjs; the two monster bodies get theirs from their own animations
// (tools/lib/ours-monster-scenes.mjs). Written next to the mod's animations (git-ignored, they are
// rebuilt from the mod's geometry and keyframes); run by `npm run import` after tools/import-jar.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONSTER_SCENE_FAMILIES, monsterSceneAnimations } from './lib/ours-monster-scenes.mjs';
import { familySceneAnimations } from './lib/scene-poses.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const MOD = 'minepreggo';
/** The humanoid ones: the monster bodies (four legs, a jelly) have scene poses of their own, below. */
const FAMILIES = ['zombie_girl', 'humanoid_creeper_girl', 'ender_woman', 'humanoid_slime_girl'];

/** @type {Record<string, unknown>} */
const animations = {};
// Each belly size is its own model whose arms and head rest a little differently, so the poses are
// solved once per size (and once for her model when she is not pregnant).
for (const family of FAMILIES) {
  for (const suffix of ['', ...Array.from({ length: 10 }, (_, p) => `_p${p}`)]) {
    const file = join(RP, 'models/entity', MOD, `${family}${suffix}.geo.json`);
    if (!existsSync(file)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
    const geometry = JSON.parse(readFileSync(file, 'utf8'))['minecraft:geometry'][0];
    for (const [pose, animation] of Object.entries(familySceneAnimations(geometry))) animations[`animation.${MOD}.${family}.${pose}${suffix}`] = animation;
  }
}
// The monster creeper and slime girls: relative to their rest pose like the mod's own animations, so
// one of each serves every belly size.
for (const family of MONSTER_SCENE_FAMILIES) {
  const file = join(RP, 'animations', MOD, `${family}.animation.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
  const own = JSON.parse(readFileSync(file, 'utf8')).animations;
  for (const [pose, animation] of Object.entries(monsterSceneAnimations(family, (name) => own[`animation.${MOD}.${family}.${name}`]))) animations[`animation.${MOD}.${family}.${pose}`] = animation;
}
const out = join(RP, 'animations', MOD, 'scene_poses.animation.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format_version: '1.8.0', animations }, null, 2) + '\n');
console.log(`Scene poses: ${Object.keys(animations).length} animations for ${FAMILIES.length + MONSTER_SCENE_FAMILIES.length} families`);
