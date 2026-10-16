// The births of our own that are solved onto the mod's rigs (the zombie girl standing, the humanoid
// slime girl melting into a puddle; tools/lib/mob-births.mjs authors them), once per belly size:
// each size is its own model whose arms and head rest a little differently, and the solve is
// absolute, so it cancels each one's rest pose. Written next to the mod's animations (git-ignored,
// they are rebuilt from the mod's geometry); run by `npm run import` after tools/gen-scene-poses.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOB_BIRTHS, MOB_FAMILIES, mobBirthPoses } from './lib/mob-births.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const MOD = 'minepreggo';
/** The fetus's full length out of her, scaled (head 3 + body 8 fetus units at 0.875). */
const BABY_LENGTH = 11 * 0.875;

const geometryOf = (/** @type {string} */ name) => {
  const file = join(RP, 'models/entity', MOD, `${name}.geo.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
  return JSON.parse(readFileSync(file, 'utf8'))['minecraft:geometry'][0];
};

/** @type {Record<string, unknown>} */
const animations = {};
const families = MOB_FAMILIES.filter((family) => MOB_BIRTHS[family].authored);
for (const family of families) {
  // P4 to P9 each get their own; the fallback (a birth below P4) is solved on the P3 model
  for (const [suffix, model] of [['', `${family}_p3`], ...[4, 5, 6, 7, 8, 9].map((p) => [`_p${p}`, `${family}_p${p}`])]) {
    const { animations: solved, clearance, bend, bellyLow, mount, turn } = mobBirthPoses(family, geometryOf(model));
    console.log(`${family}${suffix}: exit mount [${mount}], turned to it by depth ${turn}, ${clearance.toFixed(1)} px to the floor along it`);
    if (bend < 1) console.log(`${family}${suffix}: bent ${Math.round(bend * 100)} % as far as written, so her belly stays off the floor`);
    if (bellyLow < 0) console.warn(`${family}${suffix}: her belly reaches ${bellyLow.toFixed(1)} px below the floor`);
    // the baby slides out along the exit until it is fully out; short of the floor it would sink in
    if (clearance < BABY_LENGTH) console.warn(`${family}${suffix}: only ${clearance.toFixed(1)} px from her opening to the floor along the exit (the baby is ${BABY_LENGTH.toFixed(1)})`);
    for (const [pose, animation] of Object.entries(solved)) animations[`animation.${MOD}.${family}.${pose}${suffix}`] = animation;
  }
}
const out = join(RP, 'animations', MOD, 'birth_poses.animation.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format_version: '1.8.0', animations }, null, 2) + '\n');
console.log(`Birth poses: ${Object.keys(animations).length} animations for ${families.join(', ')}`);
