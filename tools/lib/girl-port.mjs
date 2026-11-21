// One woman of another mod brought into the pregnancy system on the Jenny rig (head, upperBody with
// a torso, armL/armR, legL/legR and a hip): her outfits, a round belly fitted to her waist for every
// size (tools/lib/belly-fit.mjs) in her skin tone and her art style (blocky or smooth), kicks in her own style, the pregnancy and scene
// poses solved onto her rig (tools/lib/scene-poses.mjs), a birth of her own (tools/lib/girl-births.mjs)
// with her baby crowning, her client entity, her behaviour (tamed with her treats) and spawn rule.
// Used by tools/import-insanity.mjs and tools/import-skelly.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CUBE_BELLY, addNewborn, babyScale, chestStyle, fitBelly, measureBody, roundBelly, smoothBelly } from './belly-fit.mjs';
import { bellyTexture, skinTone } from './belly-skin.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, SPAWN_PREGNANT, bellyPreAnimation, initializers, kickPulseAnimations, kickRoomLines, kickShareLines, phaseEvents } from './belly-render.mjs';
import { FETUS_SCALE, crowningLines } from './crowning.mjs';
import { stringifyEntity } from './entity-json.mjs';
import { GIRL_BIRTHS, girlBirthExit, girlEffects } from './girl-births.mjs';
import { bellySwells } from './jenny-poses.mjs';
import { decodePng, encodePng } from './png.mjs';
import { girlPoseAnimations } from './scene-poses.mjs';
import { walkJiggleAnimation } from './walk-jiggle.mjs';

const write = (/** @type {string} */ file, /** @type {Uint8Array | string} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const writeJson = (/** @type {string} */ file, /** @type {unknown} */ doc) => write(file, JSON.stringify(doc, null, 2) + '\n');
const parse = (/** @type {string} */ text) => JSON.parse(text.replace(/^﻿/, ''));

/**
 * The shared sources: the mod's pregnant player bodies (every fitted belly), the humanoid creeper
 * girl (the pregnancy and scene poses solved onto each rig) and the belly animations (how they swell).
 * @param {string} RP the resource pack
 */
export function girlSources(RP) {
  const modelOf = (/** @type {string} */ name) => parse(readFileSync(join(RP, 'models/entity', MOD, `${name}.geo.json`), 'utf8'));
  const creeperPrefix = `animation.${MOD}.humanoid_creeper_girl.`;
  return {
    playerBodies: PHASES.map((p) => modelOf(`player_body_predefined_p${p}`)),
    creeper: {
      geometry: modelOf('humanoid_creeper_girl')['minecraft:geometry'][0],
      animations: Object.fromEntries(Object.entries(parse(readFileSync(join(RP, 'animations', MOD, 'humanoid_creeper_girl.animation.json'), 'utf8')).animations).map(([k, v]) => [k.startsWith(creeperPrefix) ? k.slice(creeperPrefix.length) : k, v])),
    },
    swells: bellySwells(Object.assign({}, ...[join(RP, 'animations', MOD, 'belly.animation.json'), join(RP, 'animations/preggo_mob.animation.json')].map((f) => parse(readFileSync(f, 'utf8')).animations))),
  };
}

/** A pose controller: one state per pose, while the pose property says so (Jenny port girls' too). */
export function poseController(/** @type {string[]} */ poses, /** @type {Record<string, string[]>} */ alongside = {}) {
  /** @type {Record<string, unknown>} */
  const states = { default: { transitions: poses.map((pose) => ({ [pose]: `v.pose == '${pose}'` })), blend_transition: 0.45 } };
  for (const pose of poses) states[pose] = { animations: [`mp_pose_${pose}`, ...(alongside[pose] ?? [])], transitions: [{ default: `!(v.pose == '${pose}')` }], blend_transition: 0.45 };
  return { initial_state: 'default', states };
}

/**
 * @typedef {object} Girl
 * @property {string} key her short name (files, ids)
 * @property {string} name her display name
 * @property {{ name: string, geometry: any, texture: Uint8Array }[]} outfits each a geometry file on the Jenny rig and its texture; her belly is fitted to the first
 * @property {Record<string, any>} moves her everyday animations (idle, walk, sit) on the Jenny rig
 * @property {{ chest?: string[], belly?: string[], buttRoot?: string[] }} jiggle her walk jiggle's bones
 * @property {string} birth the GIRL_BIRTHS entry she gives birth like
 * @property {import('./belly-render.mjs').KickStyle} kicks her babies' way of moving
 * @property {string[]} treats what tames her
 * @property {string[]} biomes the biome tags she spawns in
 * @property {boolean} [fireproof]
 * @property {string} family her own type family
 * @property {{ base_color: string, overlay_color: string }} [egg] her spawn egg's colours
 * @property {(doc: any, phase: number) => void} [bellyHook] changes each of her belly geometries before it is written
 * @property {Record<string, Uint8Array>} [extraTextures] more textures of hers (her undressed one), as Texture.<name>
 * @property {string} [textureExpression] which texture her body is drawn with, instead of her outfit's
 * @property {Record<string, any>} [extraGeometries] more models of hers, as Geometry.<name> (her face layer)
 * @property {{ id: string, def: any, when: string }[]} [extraRenderControllers] more of her layers, drawn while `when`
 * @property {Record<string, any>} [properties] more actor properties of hers
 * @property {number} [grow] how much bigger than a player's her belly is (else by how tall she is: a thin, long-legged girl's stays smaller)
 * @property {number[]} [tone] her belly's skin tone, where her face is no guide to it
 * @property {'cube' | 'round'} [bellyStyle] her belly's style, instead of the one her chest suggests (tools/lib/belly-fit.mjs chestStyle)
 * @property {(image: any) => any} [bellySkin] changes her belly texture (given her skin-tone one)
 * @property {(body: import('./belly-fit.mjs').Body) => number[]} [opening] where her baby comes out instead of between her legs
 * @property {number} [minWidth] her belly at least this wide (a slim body's)
 * @property {string[]} [stillBones] bones her poses and moves leave alone (a slime's jelly, which has no legs to bend)
 * @property {string} [material] her material, if not entity_alphatest (a slime's see-through jelly)
 * @property {{ animations?: Record<string, any>, ids?: Record<string, string>, pre?: string[], initialize?: string[], animate?: any[], controllers?: Record<string, any>, effects?: { sound_effects?: Record<string, any>, particle_effects?: Record<string, any> } }} [extra] more of her client entity
 */

/**
 * Writes one woman's models, textures, animations, client entity, behaviour and spawn rule.
 * @param {ReturnType<typeof girlSources>} sources
 * @param {{ BP: string, RP: string, port: string, ns: string }} where
 * @param {Girl} girl
 * @returns {{ controllers: Record<string, unknown>, renderControllers: Record<string, unknown>, lang: string[], poses: number, style: 'cube' | 'round' }}
 */
export function portGirl(sources, { BP, RP, port, ns }, girl) {
  const { playerBodies, creeper, swells } = sources;
  const id = `${ns}:${girl.key}`;
  const prefix = `animation.${MOD}.${port.replace('_port', '')}_${girl.key}`;
  const { outfits } = girl;
  outfits.forEach((o) => {
    writeJson(join(RP, 'models/entity', port, `${o.name}.geo.json`), o.geometry);
    write(join(RP, 'textures', port, `${o.name}.png`), o.texture);
  });
  const main = outfits[0].geometry['minecraft:geometry'][0];
  const measured = measureBody(main);
  if (!measured) throw new Error(`${id}: her waist could not be measured`);
  // the fitter's limits are a player-sized girl's: a taller girl (legs reaching higher) gets as much
  // bigger a belly, from the same waist bottom
  const legTop = Math.max(...main.bones.filter((/** @type {any} */ b) => b.name === 'legL' || b.name === 'legR').map((/** @type {any} */ b) => b.pivot[1]));
  const grow = girl.grow ?? Math.min(1.5, Math.max(1, legTop / 16));
  // and a girl wider than a player (her torso's main box) as much wider and deeper a belly
  const trunk = [...(main.bones.find((/** @type {any} */ b) => b.name === 'torso')?.cubes ?? [])].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
  const wide = Math.min(1.6, Math.max(grow, trunk ? (trunk.size[0] + 2 * (trunk.inflate ?? 0)) / 8 : 1));
  const [[x0, x1], [y0, y1], [z0, z1]] = measured.box;
  const sized = { ...measured, box: [[x0 * wide, x1 * wide], [y0, y0 + (y1 - y0) * grow], [z0, z0 + (z1 - z0) * wide]] };
  // (a slim body, a Pokémon's, still carries a belly as wide as a girl's)
  const across = sized.box[0][1] - sized.box[0][0];
  const k = girl.minWidth && across < girl.minWidth ? girl.minWidth / across : 1;
  const wider = k > 1 ? { ...sized, box: [[sized.box[0][0] * k, sized.box[0][1] * k], sized.box[1], [sized.box[2][0], sized.box[2][0] + (sized.box[2][1] - sized.box[2][0]) * k]] } : sized;
  const body = girl.opening ? { ...wider, opening: girl.opening(wider) } : wider;

  // her belly of each size, in her skin tone, with the crowning mount
  const tone = girl.tone ?? skinTone(decodePng(outfits[0].texture), main);
  const skin = bellyTexture(tone);
  write(join(RP, 'textures', port, `${girl.key}_belly.png`), encodePng(girl.bellySkin ? girl.bellySkin(skin) : skin));
  // in her art style: blocky for a girl of boxes (cube breasts), smooth for a rounded one, unless
  // her importer says which
  const style = girl.bellyStyle ?? chestStyle(main) ?? 'round';
  const shell = (/** @type {any} */ fitted) => (style === 'cube' ? roundBelly(fitted, CUBE_BELLY) : smoothBelly(fitted, body));
  const bellies = PHASES.map((p) => addNewborn(shell(fitBelly(playerBodies[p], `geometry.${MOD}.${girl.key}_belly_p${p}`, body)), body, {}));
  if (girl.bellyHook) bellies.forEach((doc, p) => girl.bellyHook?.(doc, p));
  PHASES.forEach((p) => writeJson(join(RP, 'models/entity', port, `${girl.key}_belly_p${p}.geo.json`), bellies[p]));
  for (const [name, data] of Object.entries(girl.extraTextures ?? {})) write(join(RP, 'textures', port, `${girl.key}_${name}.png`), data);
  for (const [name, doc] of Object.entries(girl.extraGeometries ?? {})) writeJson(join(RP, 'models/entity', port, `${girl.key}_${name}.geo.json`), doc);

  // her everyday animations, her babies' movements, her walk jiggle
  /** @type {Record<string, any>} */
  const animations = {};
  const moveIds = /** @type {Record<string, string>} */ ({});
  // (a copy without her still bones: the moves are shared between girls)
  // (an animation left with nothing to move keeps a still channel: the game refuses an empty one)
  const still = (/** @type {any} */ a) => {
    if (!girl.stillBones || !a?.bones) return a;
    const bones = Object.fromEntries(Object.entries(a.bones).filter(([b]) => !girl.stillBones?.includes(b)));
    return { ...a, bones: Object.keys(bones).length ? bones : { body: { rotation: [0, 0, 0] } } };
  };
  for (const [move, animation] of Object.entries(girl.moves)) {
    if (!animation) continue;
    moveIds[move] = `${prefix}.${move}`;
    animations[moveIds[move]] = still(animation);
  }
  Object.assign(animations, kickPulseAnimations(girl.kicks));
  animations[`${prefix}.walk_jiggle`] = walkJiggleAnimation(girl.jiggle);
  Object.assign(animations, girl.extra?.animations ?? {});

  // her pregnancy and scene poses, solved onto her rig, and her birth
  const poses = girlPoseAnimations({ id, geometry: main, idle: moveIds.idle ? animations[moveIds.idle] : undefined, sourceGeometry: creeper.geometry, sourceAnimations: creeper.animations, prefix, bellies: Object.fromEntries(PHASES.map((p) => [p, bellies[p]['minecraft:geometry'][0]])), swells });
  if (!poses) throw new Error(`${id}: no poses could be solved onto her rig`);
  const extras = poses.birthExtras;
  for (const [name, pose] of Object.entries(poses)) if (name !== 'birthExtras' && pose?.animation) pose.animation = still(pose.animation);
  if (extras) for (const extra of [extras.flair, extras.crowning]) extra.animation = still(extra.animation);
  for (const [, { id: poseId, animation }] of Object.entries(poses)) if (poseId) animations[poseId] = animation;
  if (extras) for (const { id: extraId, animation } of [extras.flair, extras.crowning]) animations[extraId] = animation;
  const crownScale = FETUS_SCALE * babyScale(body);
  const spec = GIRL_BIRTHS[id];
  const exit = poses.birth && spec ? girlBirthExit({ spec, geometry: main, animation: poses.birth.animation, body, scale: crownScale }) : undefined;
  if (exit && poses.birth) poses.birth.animation.bones.crowning = { rotation: exit.rotation };
  writeJson(join(RP, 'animations', port, `${girl.key}.animation.json`), { format_version: '1.8.0', animations });

  // her everyday state (walking, sitting) under her pregnancy poses
  /** @type {Record<string, unknown>} */
  const controllers = { ...(girl.extra?.controllers ?? {}) };
  const moveController = `controller.animation.${ns}.${girl.key}.move`;
  controllers[moveController] = {
    initial_state: 'idle',
    states: {
      idle: { animations: ['idle'], transitions: [{ sit: 'q.is_sitting || q.is_riding' }, { walk: 'q.modified_move_speed > 0.1' }], blend_transition: 0.25 },
      walk: { animations: ['walk'], transitions: [{ sit: 'q.is_sitting || q.is_riding' }, { idle: 'q.modified_move_speed < 0.05' }], blend_transition: 0.25 },
      sit: { animations: [moveIds.sit ? 'sit' : 'idle'], transitions: [{ idle: '!q.is_sitting && !q.is_riding' }], blend_transition: 0.3 },
    },
  };
  const poseNames = Object.keys(poses).filter((k) => k !== 'birthExtras');
  const poseControllerId = `controller.animation.${ns}.${girl.key}.pose`;
  controllers[poseControllerId] = poseController(poseNames, extras ? { birth: ['mp_birth_flair', 'mp_birth_crowning'] } : {});

  // the client entity: her outfit, her belly of the size, her animations and ours
  const rcBody = `controller.render.${ns}.${girl.key}`;
  const rcBelly = `controller.render.${ns}.${girl.key}_belly`;
  /** @type {Record<string, unknown>} */
  const renderControllers = {
    ...Object.fromEntries((girl.extraRenderControllers ?? []).map(({ id: rc, def }) => [rc, def])),
    [rcBody]: {
      arrays: { geometries: { 'Array.outfits': outfits.map((_, i) => `Geometry.o${i}`) }, textures: { 'Array.skins': outfits.map((_, i) => `Texture.o${i}`) } },
      geometry: `Array.outfits[math.clamp(q.variant, 0, ${outfits.length - 1})]`, materials: [{ '*': 'Material.default' }], textures: [girl.textureExpression ?? `Array.skins[math.clamp(q.variant, 0, ${outfits.length - 1})]`],
    },
    [rcBelly]: {
      arrays: { geometries: { 'Array.bellies': PHASES.map((p) => `Geometry.belly_p${p}`) } },
      geometry: 'Array.bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: ['Texture.belly'],
    },
  };
  const pre = [...bellyPreAnimation().filter((l) => !l.startsWith('v.kp_')), ...kickShareLines('v', girl.kicks), ...kickRoomLines('v.bp', (p) => bellies[p]['minecraft:geometry'][0]),
    // (a blocky belly kicks with the mod's own cubes, swelling fully; a smooth one's skin patches less)
    `v.kick_grow = ${style === 'cube' ? '1.0' : '0.35'};`,
    ...crowningLines({ when: "v.pose == 'birth'", scale: crownScale, ...(exit ? { head: exit.head, rest: exit.rest } : {}) }), ...(girl.extra?.pre ?? [])];
  const effects = spec ? girlEffects(spec) : { sound_effects: {}, particle_effects: {} };
  const sound_effects = { ...effects.sound_effects, ...(girl.extra?.effects?.sound_effects ?? {}) };
  const particle_effects = { ...effects.particle_effects, ...(girl.extra?.effects?.particle_effects ?? {}) };
  writeJson(join(RP, 'entity', port, `${girl.key}.entity.json`), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: girl.material ?? 'entity_alphatest' },
        textures: { ...Object.fromEntries(outfits.map((o, i) => [`o${i}`, `textures/${port}/${o.name}`])), belly: `textures/${port}/${girl.key}_belly`, ...Object.fromEntries(Object.keys(girl.extraTextures ?? {}).map((n) => [n, `textures/${port}/${girl.key}_${n}`])) },
        geometry: { ...Object.fromEntries(outfits.map((o, i) => [`o${i}`, o.geometry['minecraft:geometry'][0].description.identifier])), ...Object.fromEntries(PHASES.map((p) => [`belly_p${p}`, `geometry.${MOD}.${girl.key}_belly_p${p}`])), ...Object.fromEntries(Object.entries(girl.extraGeometries ?? {}).map(([name, doc]) => [name, doc['minecraft:geometry'][0].description.identifier])) },
        animations: {
          ...Object.fromEntries(Object.entries(moveIds).map(([move, animId]) => [move, animId])),
          move_controller: moveController,
          ...BELLY_ANIMATIONS,
          kick_i: `animation.${MOD}.${girl.kicks.name}.kick_i`, kick_ii: `animation.${MOD}.${girl.kicks.name}.kick_ii`, kick_iii: `animation.${MOD}.${girl.kicks.name}.kick_iii`,
          belly_controller: `controller.animation.${MOD}.belly`,
          newborn: `animation.${MOD}.crowning_free`,
          walk_jiggle: `${prefix}.walk_jiggle`,
          mp_pose_controller: poseControllerId,
          ...Object.fromEntries(poseNames.map((pose) => [`mp_pose_${pose}`, poses[pose].id])),
          ...(extras ? { mp_birth_flair: extras.flair.id, mp_birth_crowning: extras.crowning.id } : {}),
          look_at_target: 'animation.common.look_at_target',
          ...(girl.extra?.ids ?? {}),
        },
        // (the game refuses an empty map of either)
        ...(Object.keys(sound_effects).length ? { sound_effects } : {}),
        ...(Object.keys(particle_effects).length ? { particle_effects } : {}),
        scripts: {
          initialize: [...initializers(pre, []), ...(girl.extra?.initialize ?? [])],
          pre_animation: pre,
          animate: [{ look_at_target: "v.pose == 'none'" }, 'move_controller', 'walk_jiggle', 'mp_pose_controller', { newborn: "v.pose == 'birth' && !v.crowning" }, 'belly_controller', ...(girl.extra?.animate ?? [])],
        },
        render_controllers: [rcBody, { [rcBelly]: 'v.bp >= 0' }, ...(girl.extraRenderControllers ?? []).map(({ id: rc, when }) => ({ [rc]: when }))],
        spawn_egg: girl.egg ?? { base_color: '#d06a2c', overlay_color: '#f2c6a0' },
      },
    },
  });

  // the behaviour: a woman who can be tamed with her treats, in the mob system
  const variants = Object.fromEntries(outfits.map((_, i) => [`${ns}:variant_${i}`, { 'minecraft:variant': { value: i } }]));
  const height = Math.round((Math.max(...main.bones.flatMap((/** @type {any} */ b) => (b.cubes ?? []).map((/** @type {any} */ c) => c.origin[1] + c.size[1]))) / 16) * 100) / 100;
  // (written as stringifyEntity writes it: a float property's 0.0 must stay 0.0, or the game drops every property)
  write(join(BP, 'entities', port, `${girl.key}.json`), stringifyEntity({
    format_version: '1.21.0',
    'minecraft:entity': {
      description: { identifier: id, is_spawnable: true, is_summonable: true, properties: { ...MINEPREGGO_PROPERTIES, ...(girl.properties ?? {}) } },
      component_groups: {
        ...variants,
        [`${ns}:wild`]: {
          'minecraft:tameable': { probability: 0.33, tame_items: girl.treats, tame_event: { event: `${ns}:on_tame`, target: 'self' } },
          'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.8 },
        },
        [`${ns}:tamed`]: {
          'minecraft:is_tamed': {},
          'minecraft:sittable': {},
          'minecraft:behavior.stay_while_sitting': { priority: 1 },
          'minecraft:behavior.follow_owner': { priority: 4, speed_multiplier: 1.0, start_distance: 8, stop_distance: 2 },
          'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.6 },
        },
      },
      components: {
        'minecraft:type_family': { family: [girl.family, girl.key, 'mob', FAMILY_TAG] },
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
            { add: { component_groups: [`${ns}:wild`] } },
            { randomize: outfits.map((_, i) => ({ weight: 1, add: { component_groups: [`${ns}:variant_${i}`] } })) },
            SPAWN_PREGNANT,
          ],
        },
        [`${ns}:on_tame`]: { remove: { component_groups: [`${ns}:wild`] }, add: { component_groups: [`${ns}:tamed`] } },
        ...phaseEvents(),
      },
    },
  }));
  writeJson(join(BP, 'spawn_rules', port, `${girl.key}.json`), {
    format_version: '1.8.0',
    'minecraft:spawn_rules': {
      description: { identifier: id, population_control: 'animal' },
      conditions: [{
        'minecraft:spawns_on_surface': {},
        'minecraft:brightness_filter': girl.fireproof ? { min: 0, max: 15, adjust_for_weather: false } : { min: 7, max: 15, adjust_for_weather: false },
        // (as common as the farm animals, now and then two together: rarer, players never met them)
        'minecraft:weight': { default: 15 },
        'minecraft:herd': { min_size: 1, max_size: 2 },
        'minecraft:density_limit': { surface: 4 },
        'minecraft:biome_filter': { any_of: girl.biomes.map((b) => ({ test: 'has_biome_tag', value: b })) },
      }],
    },
  });
  return { controllers, renderControllers, lang: [`entity.${id}.name=${girl.name}`, `item.spawn_egg.entity.${id}.name=${girl.name} Spawn Egg`], poses: poseNames.length, style };
}
