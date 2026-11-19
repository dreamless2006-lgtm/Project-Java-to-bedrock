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
import { addNewborn, babyScale, fitBelly, measureBody, smoothBelly } from './lib/belly-fit.mjs';
import { bellyTexture, skinTone } from './lib/belly-skin.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, bellyPreAnimation, initializers, kickPulseAnimations, kickRoomLines, kickShareLines, phaseEvents } from './lib/belly-render.mjs';
import { FETUS_SCALE, crowningLines } from './lib/crowning.mjs';
import { stringifyEntity } from './lib/entity-json.mjs';
import { GIRL_BIRTHS, girlBirthExit, girlEffects } from './lib/girl-births.mjs';
import { bellySwells } from './lib/jenny-poses.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { girlPoseAnimations } from './lib/scene-poses.mjs';
import { walkJiggleAnimation } from './lib/walk-jiggle.mjs';

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

// the shared sources: the mod's pregnant player bodies (every fitted belly), the humanoid creeper
// girl (the pregnancy and scene poses solved onto each rig) and the belly animations (how they swell)
const modelOf = (/** @type {string} */ name) => parse(readFileSync(join(RP, 'models/entity', MOD, `${name}.geo.json`), 'utf8'));
const playerBodies = PHASES.map((p) => modelOf(`player_body_predefined_p${p}`));
const creeperPrefix = `animation.${MOD}.humanoid_creeper_girl.`;
const creeper = {
  geometry: modelOf('humanoid_creeper_girl')['minecraft:geometry'][0],
  animations: Object.fromEntries(Object.entries(parse(readFileSync(join(RP, 'animations', MOD, 'humanoid_creeper_girl.animation.json'), 'utf8')).animations).map(([k, v]) => [k.startsWith(creeperPrefix) ? k.slice(creeperPrefix.length) : k, v])),
};
const swells = bellySwells(Object.assign({}, ...[join(RP, 'animations', MOD, 'belly.animation.json'), join(RP, 'animations/preggo_mob.animation.json')].map((f) => parse(readFileSync(f, 'utf8')).animations)));

/**
 * GeckoLib keyframes hold {vector, easing, lerp_mode}; Bedrock takes the vector, eased linearly, or
 * catmull-rom when constant (the mod's eased keyframes, the curve Bedrock has closest to them).
 */
function frame(/** @type {any} */ value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if ('vector' in value) {
    const v = value.vector;
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
  return { format_version: '1.12.0', 'minecraft:geometry': [g] };
}

/** The mod's animation with her bones renamed (the hat follows her head). */
function renamed(/** @type {any} */ animation) {
  const bones = Object.fromEntries(Object.entries(animation.bones ?? {}).map(([bone, ch]) => [RENAME[bone] ?? bone, Object.fromEntries(Object.entries(/** @type {any} */ (ch)).map(([k, v]) => [k, channel(v)]))]));
  return { ...animation, ...(typeof animation.loop === 'string' && animation.loop !== 'hold_on_last_frame' ? { loop: true } : {}), bones };
}

/** A pose controller: one state per pose, while the pose property says so (Jenny port girls' too). */
function poseController(/** @type {string[]} */ poses, /** @type {Record<string, string[]>} */ alongside = {}) {
  /** @type {Record<string, unknown>} */
  const states = { default: { transitions: poses.map((pose) => ({ [pose]: `v.pose == '${pose}'` })), blend_transition: 0.45 } };
  for (const pose of poses) states[pose] = { animations: [`mp_pose_${pose}`, ...(alongside[pose] ?? [])], transitions: [{ default: `!(v.pose == '${pose}')` }], blend_transition: 0.45 };
  return { initial_state: 'default', states };
}

/** @type {Record<string, unknown>} */
const controllers = {};
/** @type {Record<string, unknown>} */
const renderControllers = {};
const lang = [LANG_HEADER];
let poseCount = 0;
for (const girl of GIRLS) {
  const id = `${NS}:${girl.key}`;
  const prefix = `animation.${MOD}.${PORT.replace('_port', '')}_${girl.key}`;
  // her outfits on the Jenny rig
  const outfits = girl.outfits.filter((o) => jar[`${ASSETS}geo/${o}.geo.json`] && jar[`${ASSETS}textures/entities/${o}.png`]);
  const geometries = outfits.map((o) => onJennyRig(parse(strFromU8(need(`geo/${o}.geo.json`))), `geometry.${NS}.${o}`));
  outfits.forEach((o, i) => {
    writeJson(join(RP, 'models/entity', PORT, `${o}.geo.json`), geometries[i]);
    write(join(RP, 'textures', PORT, `${o}.png`), need(`textures/entities/${o}.png`));
  });
  const main = geometries[0]['minecraft:geometry'][0];
  const measured = measureBody(main);
  if (!measured) throw new Error(`${id}: her waist could not be measured`);
  // the fitter's limits are a player-sized girl's: she is taller (her legs reach 1.3-1.5 times as
  // high), so her belly is as much bigger, from the same waist bottom
  const legTop = Math.max(...main.bones.filter((/** @type {any} */ b) => b.name === 'legL' || b.name === 'legR').map((/** @type {any} */ b) => b.pivot[1]));
  const grow = Math.min(1.5, Math.max(1, legTop / 16));
  const [[x0, x1], [y0, y1], [z0, z1]] = measured.box;
  const body = { ...measured, box: [[x0 * grow, x1 * grow], [y0, y0 + (y1 - y0) * grow], [z0, z0 + (z1 - z0) * grow]] };

  // her belly of each size, in her skin tone, with the crowning mount
  const tone = skinTone(decodePng(need(`textures/entities/${outfits[0]}.png`)), { ...main, bones: main.bones.map((/** @type {any} */ b) => (b.name === 'head' ? { ...b, cubes: b.cubes } : b)) });
  write(join(RP, 'textures', PORT, `${girl.key}_belly.png`), encodePng(bellyTexture(tone)));
  const bellies = PHASES.map((p) => addNewborn(smoothBelly(fitBelly(playerBodies[p], `geometry.${MOD}.${girl.key}_belly_p${p}`, body), body), body, {}));
  PHASES.forEach((p) => writeJson(join(RP, 'models/entity', PORT, `${girl.key}_belly_p${p}.geo.json`), bellies[p]));

  // her everyday animations, her babies' movements, her walk jiggle
  const source = parse(strFromU8(need(`animations/${outfits[0]}.animation.json`))).animations;
  /** @type {Record<string, any>} */
  const animations = {};
  const moveIds = /** @type {Record<string, string>} */ ({});
  for (const [move, name] of Object.entries(girl.moves)) {
    if (!source[name]) continue;
    const animation = renamed(source[name]);
    if (move === 'walk') animation.anim_time_update = 'q.modified_distance_moved * 0.06';
    moveIds[move] = `${prefix}.${move}`;
    animations[moveIds[move]] = animation;
  }
  Object.assign(animations, kickPulseAnimations(girl.kicks));
  animations[`${prefix}.walk_jiggle`] = walkJiggleAnimation({ chest: ['Breasts'], belly: ['belly'], buttRoot: ['Ass'] });

  // her pregnancy and scene poses, solved onto her rig, and her birth (a Jenny girl's, her own)
  GIRL_BIRTHS[id] = { ...GIRL_BIRTHS[girl.birth], name: girl.key };
  const poses = girlPoseAnimations({ id, geometry: main, idle: moveIds.idle ? animations[moveIds.idle] : undefined, sourceGeometry: creeper.geometry, sourceAnimations: creeper.animations, prefix, bellies: Object.fromEntries(PHASES.map((p) => [p, bellies[p]['minecraft:geometry'][0]])), swells });
  if (!poses) throw new Error(`${id}: no poses could be solved onto her rig`);
  const extras = poses.birthExtras;
  for (const [, { id: poseId, animation }] of Object.entries(poses)) if (poseId) animations[poseId] = animation;
  if (extras) for (const { id: extraId, animation } of [extras.flair, extras.crowning]) animations[extraId] = animation;
  poseCount += Object.keys(poses).filter((k) => k !== 'birthExtras').length;
  const crownScale = FETUS_SCALE * babyScale(body);
  const exit = poses.birth ? girlBirthExit({ spec: GIRL_BIRTHS[id], geometry: main, animation: poses.birth.animation, body, scale: crownScale }) : undefined;
  if (exit && poses.birth) poses.birth.animation.bones.crowning = { rotation: exit.rotation };
  writeJson(join(RP, 'animations', PORT, `${girl.key}.animation.json`), { format_version: '1.8.0', animations });

  // her everyday state (walking, sitting, sleeping) under her pregnancy poses
  const moveController = `controller.animation.${NS}.${girl.key}.move`;
  controllers[moveController] = {
    initial_state: 'idle',
    states: {
      idle: { animations: ['idle'], transitions: [{ sit: 'q.is_sitting || q.is_riding' }, { walk: 'q.modified_move_speed > 0.1' }], blend_transition: 0.25 },
      walk: { animations: ['walk'], transitions: [{ sit: 'q.is_sitting || q.is_riding' }, { idle: 'q.modified_move_speed < 0.05' }], blend_transition: 0.25 },
      sit: { animations: [moveIds.sit ? 'sit' : 'idle'], transitions: [{ idle: '!q.is_sitting && !q.is_riding' }], blend_transition: 0.3 },
    },
  };
  const poseControllerId = `controller.animation.${NS}.${girl.key}.pose`;
  controllers[poseControllerId] = poseController(Object.keys(poses).filter((k) => k !== 'birthExtras'), extras ? { birth: ['mp_birth_flair', 'mp_birth_crowning'] } : {});

  // the client entity: her outfit, her belly of the size, her animations and ours
  const rcBody = `controller.render.${NS}.${girl.key}`;
  const rcBelly = `controller.render.${NS}.${girl.key}_belly`;
  renderControllers[rcBody] = {
    arrays: { geometries: { 'Array.outfits': outfits.map((_, i) => `Geometry.o${i}`) }, textures: { 'Array.skins': outfits.map((_, i) => `Texture.o${i}`) } },
    geometry: `Array.outfits[math.clamp(q.variant, 0, ${outfits.length - 1})]`, materials: [{ '*': 'Material.default' }], textures: [`Array.skins[math.clamp(q.variant, 0, ${outfits.length - 1})]`],
  };
  renderControllers[rcBelly] = {
    arrays: { geometries: { 'Array.bellies': PHASES.map((p) => `Geometry.belly_p${p}`) } },
    geometry: 'Array.bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: ['Texture.belly'],
  };
  const pre = [...bellyPreAnimation().filter((l) => !l.startsWith('v.kp_')), ...kickShareLines('v', girl.kicks), ...kickRoomLines('v.bp', (p) => bellies[p]['minecraft:geometry'][0]), 'v.kick_grow = 0.35;',
    ...crowningLines({ when: "v.pose == 'birth'", scale: crownScale, ...(exit ? { head: exit.head, rest: exit.rest } : {}) })];
  const spec = GIRL_BIRTHS[id];
  writeJson(join(RP, 'entity', PORT, `${girl.key}.entity.json`), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: 'entity_alphatest' },
        textures: { ...Object.fromEntries(outfits.map((o, i) => [`o${i}`, `textures/${PORT}/${o}`])), belly: `textures/${PORT}/${girl.key}_belly` },
        geometry: { ...Object.fromEntries(outfits.map((o, i) => [`o${i}`, `geometry.${NS}.${o}`])), ...Object.fromEntries(PHASES.map((p) => [`belly_p${p}`, `geometry.${MOD}.${girl.key}_belly_p${p}`])) },
        animations: {
          ...Object.fromEntries(Object.entries(moveIds).map(([move, animId]) => [move, animId])),
          move_controller: moveController,
          ...BELLY_ANIMATIONS,
          kick_i: `animation.${MOD}.${girl.kicks.name}.kick_i`, kick_ii: `animation.${MOD}.${girl.kicks.name}.kick_ii`, kick_iii: `animation.${MOD}.${girl.kicks.name}.kick_iii`,
          belly_controller: `controller.animation.${MOD}.belly`,
          newborn: `animation.${MOD}.crowning_free`,
          walk_jiggle: `${prefix}.walk_jiggle`,
          mp_pose_controller: poseControllerId,
          ...Object.fromEntries(Object.entries(poses).filter(([k]) => k !== 'birthExtras').map(([pose, { id: poseId }]) => [`mp_pose_${pose}`, poseId])),
          ...(extras ? { mp_birth_flair: extras.flair.id, mp_birth_crowning: extras.crowning.id } : {}),
          look_at_target: 'animation.common.look_at_target',
        },
        ...(spec ? girlEffects(spec) : {}),
        scripts: {
          initialize: initializers(pre, []),
          pre_animation: pre,
          animate: [{ look_at_target: "v.pose == 'none'" }, 'move_controller', 'walk_jiggle', 'mp_pose_controller', { newborn: "v.pose == 'birth' && !v.crowning" }, 'belly_controller'],
        },
        render_controllers: [rcBody, { [rcBelly]: 'v.bp >= 0' }],
        spawn_egg: { base_color: '#d06a2c', overlay_color: '#f2c6a0' },
      },
    },
  });

  // the behaviour: a woman who can be tamed with her treats, in the mob system
  const variants = Object.fromEntries(outfits.map((_, i) => [`${NS}:variant_${i}`, { 'minecraft:variant': { value: i } }]));
  const height = Math.round((Math.max(...main.bones.flatMap((/** @type {any} */ b) => (b.cubes ?? []).map((/** @type {any} */ c) => c.origin[1] + c.size[1]))) / 16) * 100) / 100;
  writeJson(join(BP, 'entities', PORT, `${girl.key}.json`), JSON.parse(stringifyEntity({
    format_version: '1.21.0',
    'minecraft:entity': {
      description: { identifier: id, is_spawnable: true, is_summonable: true, properties: { ...MINEPREGGO_PROPERTIES } },
      component_groups: {
        ...variants,
        [`${NS}:wild`]: {
          'minecraft:tameable': { probability: 0.33, tame_items: girl.treats, tame_event: { event: `${NS}:on_tame`, target: 'self' } },
          'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.8 },
        },
        [`${NS}:tamed`]: {
          'minecraft:is_tamed': {},
          'minecraft:sittable': {},
          'minecraft:behavior.stay_while_sitting': { priority: 1 },
          'minecraft:behavior.follow_owner': { priority: 4, speed_multiplier: 1.0, start_distance: 8, stop_distance: 2 },
          'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.6 },
        },
      },
      components: {
        'minecraft:type_family': { family: ['insanity_girl', girl.key, 'mob', FAMILY_TAG] },
        'minecraft:health': { value: 20, max: 20 },
        'minecraft:collision_box': { width: 0.6, height: Math.min(2.9, Math.max(1.8, height)) },
        'minecraft:movement': { value: 0.25 },
        'minecraft:movement.basic': {},
        'minecraft:navigation.walk': { can_path_over_water: true, avoid_damage_blocks: true },
        'minecraft:jump.static': {},
        'minecraft:can_climb': {},
        'minecraft:physics': {},
        'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
        'minecraft:nameable': {},
        'minecraft:persistent': {},
        'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
        'minecraft:behavior.float': { priority: 0 },
        'minecraft:behavior.panic': { priority: 1, speed_multiplier: 1.25 },
        'minecraft:behavior.look_at_player': { priority: 8, look_distance: 8, probability: 0.02 },
        'minecraft:behavior.random_look_around': { priority: 9 },
        ...(girl.fireproof ? { 'minecraft:fire_immune': {} } : {}),
      },
      events: {
        'minecraft:entity_spawned': {
          sequence: [
            { add: { component_groups: [`${NS}:wild`] } },
            { randomize: outfits.map((_, i) => ({ weight: 1, add: { component_groups: [`${NS}:variant_${i}`] } })) },
          ],
        },
        [`${NS}:on_tame`]: { remove: { component_groups: [`${NS}:wild`] }, add: { component_groups: [`${NS}:tamed`] } },
        ...phaseEvents(),
      },
    },
  })));
  writeJson(join(BP, 'spawn_rules', PORT, `${girl.key}.json`), {
    format_version: '1.8.0',
    'minecraft:spawn_rules': {
      description: { identifier: id, population_control: 'animal' },
      conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:brightness_filter': girl.fireproof ? { min: 0, max: 15, adjust_for_weather: false } : { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 3 },
        'minecraft:herd': { min_size: 1, max_size: 1 },
        'minecraft:density_limit': { surface: 2 },
        'minecraft:biome_filter': { any_of: girl.biomes.map((b) => ({ test: 'has_biome_tag', value: b })) },
      }],
    },
  });
  lang.push(`entity.${id}.name=${girl.name}`, `item.spawn_egg.entity.${id}.name=${girl.name} Spawn Egg`);
}
writeJson(join(RP, 'animation_controllers', PORT, 'insanity.animation_controllers.json'), { format_version: '1.10.0', animation_controllers: controllers });
writeJson(join(RP, 'render_controllers', PORT, 'insanity.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`InsanityV: ${GIRLS.length} women, ${poseCount} pregnancy and scene poses`);
