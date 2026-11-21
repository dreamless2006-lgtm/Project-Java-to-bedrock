// Merges the women of the InsanityV mod (vendor/insanity/*.jar: an MCreator/GeckoLib mod by
// Missingnok) into the pregnancy system at import time, like the Jenny port's girls: nothing of it is
// committed. Molten (in her outfits), Daisy, Oxy, Stella and Enny keep their own models, textures and
// everyday animations; their mod's shared rig is renamed to the Jenny rig's bone names (head, torso,
// armL/armR, legL/legR, plus a hip at the top of her legs), so the Jenny girls' machinery fits them
// whole: a round belly fitted to her waist for every size (tools/lib/belly-fit.mjs) in her skin tone,
// kicks in her own style (tools/lib/belly-render.mjs kick styles), the pregnancy and scene poses solved
// onto her rig (tools/lib/scene-poses.mjs, so the Jenny Bed's and the belly scenes play with her), and
// a birth of her own (one of the Jenny girls' births, tools/lib/girl-births.mjs) with her baby crowning.
// Its plush, its monsters and its robed figures are left out.
//
// Run: node tools/import-insanity.mjs (part of npm run import; after tools/import-jar.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { GIRL_BIRTHS } from './lib/girl-births.mjs';
import { girlSources, portGirl } from './lib/girl-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'insanity_port';
const NS = 'insanityv';
const VENDOR = join(ROOT, 'vendor/insanity');
const LANG_HEADER = '## InsanityV (vendor/insanity, tools/import-insanity.mjs)';
const ASSETS = 'assets/insanityv/';

/** The mod's rig bones -> the Jenny rig's names the pose solver and the belly fitter know. */
const RENAME = /** @type {Record<string, string>} */ ({ Head: 'head', Body: 'upperBody', LeftArm: 'armL', RightArm: 'armR', LeftLeg: 'legL', RightLeg: 'legR' });

/**
 * The women: her outfits (each a geometry and texture of the mod: the first is the one her belly is
 * fitted to, the others share it), her everyday animations by the mod's names, the Jenny girl whose
 * birth she gives birth like (each her own), her babies' way of moving (tools/lib/belly-render.mjs
 * KickStyle: the order of kick, roll, stretch, hiccups and flutter, their pace and emphasis), her
 * treats and where she lives.
 */
const GIRLS = [
  { key: 'molten', name: 'Molten', outfits: ['moltenog', 'moltenbikini', 'moltencheese', 'moltenflan', 'moltenjob', 'moltenlove', 'moltenoliv', 'moltenw98', 'moltenwar'],
    moves: { idle: 'idle', walk: 'walk', sit: 'sitting', sleep: 'sleep2' }, birth: 'kum:galath',
    kicks: { name: 'insanity_molten', order: [0, 2, 1, 4, 3], rate: 1.25, emphasis: [1.25, 0.8, 1.2, 0.6, 0.8] },
    treats: ['minecraft:magma_cream', 'minecraft:blaze_powder', 'minecraft:cake'], biomes: ['nether'], fireproof: true },
  { key: 'daisy', name: 'Daisy', outfits: ['daisy'], moves: { idle: 'idle', walk: 'walk', sit: 'sitting', sleep: 'sleep2' }, birth: 'kum:bia',
    kicks: { name: 'insanity_daisy', order: [4, 0, 3, 1, 2], rate: 0.9, emphasis: [0.8, 0.9, 0.8, 1.0, 1.4] },
    treats: ['minecraft:honey_bottle', 'minecraft:sweet_berries', 'minecraft:cake'], biomes: ['flower_forest', 'meadow', 'plains'] },
  { key: 'oxy', name: 'Oxy', outfits: ['oxy'], moves: { idle: 'Idle', walk: 'walk', sit: 'Sit', sleep: 'Sleep' }, birth: 'fapcraft:jenny',
    kicks: { name: 'insanity_oxy', order: [1, 0, 2, 3, 4], rate: 1.1, emphasis: [1.0, 1.4, 1.0, 0.7, 0.8] },
    treats: ['minecraft:cookie', 'minecraft:pumpkin_pie', 'minecraft:cake'], biomes: ['forest', 'taiga'] },
  { key: 'stella', name: 'Stella', outfits: ['stella'], moves: { idle: 'idle', walk: 'walk', sit: 'sitting', sleep: 'sleep2' }, birth: 'kum:luna',
    kicks: { name: 'insanity_stella', order: [2, 1, 0, 4, 3], rate: 0.8, emphasis: [0.9, 1.1, 1.4, 0.6, 1.0] },
    treats: ['minecraft:tropical_fish', 'minecraft:cod', 'minecraft:cake'], biomes: ['swamp', 'lush_caves', 'beach'] },
  { key: 'enny', name: 'Enny', outfits: ['enny'], moves: { idle: 'idle', walk: 'walk', sit: 'sitting', sleep: 'sleep2' }, birth: 'jhallie4:allie',
    kicks: { name: 'insanity_enny', order: [3, 4, 0, 2, 1], rate: 1.35, emphasis: [1.0, 0.7, 0.9, 1.4, 1.2] },
    treats: ['minecraft:glow_berries', 'minecraft:golden_carrot', 'minecraft:cake'], biomes: ['dark_forest', 'birch'] },
];

const write = (/** @type {string} */ file, /** @type {Uint8Array | string} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const writeJson = (/** @type {string} */ file, /** @type {unknown} */ doc) => write(file, JSON.stringify(doc, null, 2) + '\n');
const parse = (/** @type {string} */ text) => JSON.parse(text.replace(/^﻿/, ''));

// ---- clean the previous import --------------------------------------------------------------------
for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(RP, 'entity', PORT), join(RP, 'models/entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) {
  rmSync(dir, { recursive: true, force: true });
}
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at >= 0) writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n'));
}

const jarFile = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => f.endsWith('.jar')) : undefined;
if (!jarFile) {
  console.warn('warning: no InsanityV jar in vendor/insanity/; its women are not imported');
  process.exit(0);
}
const jar = unzipSync(new Uint8Array(readFileSync(join(VENDOR, jarFile))));
const need = (/** @type {string} */ path) => {
  const data = jar[ASSETS + path];
  if (!data) throw new Error(`${jarFile}: no ${ASSETS}${path}`);
  return data;
};

const sources = girlSources(RP);

/**
 * GeckoLib keyframes hold {vector, easing, lerp_mode}; Bedrock takes the vector, eased linearly, or
 * catmull-rom when constant (the mod's eased keyframes, the curve Bedrock has closest to them).
 */
/** MCreator writes "linear" into some keyframe values (its easing, where a number belongs): it is 0. */
const unlinear = (/** @type {any} */ c) => {
  if (typeof c !== 'string' || !/\blinear\b/.test(c)) return c;
  const s = c.replace(/\blinear\b/g, '0');
  return /^[\d.+\-\s]+$/.test(s) ? Number(Function(`return (${s})`)()) : s;
};
function frame(/** @type {any} */ value) {
  if (Array.isArray(value)) return value.map(unlinear);
  if (!value || typeof value !== 'object') return unlinear(value);
  if ('vector' in value) {
    const v = [value.vector].flat().map(unlinear);
    const constant = [v].flat().every((c) => typeof c === 'number');
    return (value.lerp_mode === 'catmullrom' || /^easeInOut/.test(value.easing ?? '')) && constant ? { post: v, lerp_mode: 'catmullrom' } : v;
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === 'pre' || k === 'post' ? frame(v) : v;
  if (out.lerp_mode === 'catmullrom' && [out.pre, out.post].flat().some((c) => typeof c === 'string')) delete out.lerp_mode;
  return out;
}
function channel(/** @type {any} */ value) {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return value;
  if ('vector' in value) return frame(value).post ?? frame(value);
  const frames = Object.fromEntries(Object.entries(value).map(([t, f]) => [t, frame(f)]));
  // catmull-rom needs every keyframe of the channel constant (the game refuses the animation otherwise)
  if (Object.values(frames).some((f) => [Array.isArray(f) ? f : [f?.pre, f?.post]].flat(2).some((c) => typeof c === 'string'))) {
    for (const [t, f] of Object.entries(frames)) if (f && typeof f === 'object' && !Array.isArray(f) && f.lerp_mode) frames[t] = f.post ?? f.pre;
  }
  return frames;
}

/**
 * Her geometry on the Jenny rig: her Body becomes the upperBody her head and arms hang from (so they
 * go along when she leans), its cubes a torso under it (what the belly fitter measures), with a hip at
 * the top of her legs her belly hangs from. Nothing moves at rest.
 */
function onJennyRig(/** @type {any} */ doc, /** @type {string} */ id) {
  const g = structuredClone(doc['minecraft:geometry'][0]);
  g.description.identifier = id;
  for (const bone of g.bones) {
    bone.name = RENAME[bone.name] ?? bone.name;
    if (bone.parent) bone.parent = RENAME[bone.parent] ?? bone.parent;
  }
  const upper = g.bones.find((/** @type {any} */ b) => b.name === 'upperBody');
  const legs = g.bones.filter((/** @type {any} */ b) => b.name === 'legL' || b.name === 'legR');
  if (!upper || legs.length !== 2) throw new Error(`${id}: not the mod's shared rig (no Body or legs)`);
  for (const bone of g.bones) if (['head', 'armL', 'armR'].includes(bone.name) && bone.parent !== 'upperBody' && !upper.rotation) bone.parent = 'upperBody';
  g.bones.push({ name: 'torso', parent: 'upperBody', pivot: [...upper.pivot], cubes: upper.cubes ?? [] });
  delete upper.cubes;
  const legTop = Math.max(...legs.map((/** @type {any} */ l) => l.pivot[1]));
  g.bones.push({ name: 'hip', parent: 'upperBody', pivot: [0, legTop + 1, upper.pivot[2]] });
  // her upper body turns at her waist, like a Jenny girl's (the mod's Body turns at her neck, which
  // swung her hips and belly out of place in every pose that bends her)
  upper.pivot = [upper.pivot[0], legTop, upper.pivot[2]];
  return { format_version: '1.12.0', 'minecraft:geometry': [g] };
}

/** The mod's animation with her bones renamed (the hat follows her head). */
function renamed(/** @type {any} */ animation) {
  const bones = Object.fromEntries(Object.entries(animation.bones ?? {}).map(([bone, ch]) => [RENAME[bone] ?? bone, Object.fromEntries(Object.entries(/** @type {any} */ (ch)).map(([k, v]) => [k, channel(v)]))]));
  return { ...animation, ...(typeof animation.loop === 'string' && animation.loop !== 'hold_on_last_frame' ? { loop: true } : {}), bones };
}

/** @type {Record<string, unknown>} */
const controllers = {};
/** @type {Record<string, unknown>} */
const renderControllers = {};
const lang = [LANG_HEADER];
let poseCount = 0;
/** @type {string[]} */
const styles = [];
for (const girl of GIRLS) {
  // her outfits on the Jenny rig, her everyday animations, her birth (a Jenny girl's, her own)
  const outfits = girl.outfits.filter((o) => jar[`${ASSETS}geo/${o}.geo.json`] && jar[`${ASSETS}textures/entities/${o}.png`])
    .map((o) => ({ name: o, geometry: onJennyRig(parse(strFromU8(need(`geo/${o}.geo.json`))), `geometry.${NS}.${o}`), texture: need(`textures/entities/${o}.png`) }));
  const source = parse(strFromU8(need(`animations/${outfits[0].name}.animation.json`))).animations;
  /** @type {Record<string, any>} */
  const moves = {};
  for (const [move, name] of Object.entries(girl.moves)) {
    if (!source[name]) continue;
    moves[move] = renamed(source[name]);
    if (move === 'walk') moves[move].anim_time_update = 'q.modified_distance_moved * 0.06';
  }
  GIRL_BIRTHS[`${NS}:${girl.key}`] = { ...GIRL_BIRTHS[girl.birth], name: girl.key };
  const out = portGirl(sources, { BP, RP, port: PORT, ns: NS }, {
    ...girl, outfits, moves, family: 'insanity_girl', jiggle: { chest: ['Breasts'], belly: ['belly'], buttRoot: ['Ass'] },
    // round and smooth, though they are drawn in boxes: a blocky belly takes the charm out of them
    bellyStyle: 'round',
  });
  Object.assign(controllers, out.controllers);
  Object.assign(renderControllers, out.renderControllers);
  lang.push(...out.lang);
  poseCount += out.poses;
  styles.push(`${girl.name} ${out.style}`);
}
writeJson(join(RP, 'animation_controllers', PORT, 'insanity.animation_controllers.json'), { format_version: '1.10.0', animation_controllers: controllers });
writeJson(join(RP, 'render_controllers', PORT, 'insanity.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`InsanityV: ${GIRLS.length} women, ${poseCount} pregnancy and scene poses; bellies ${styles.join(', ')}`);
