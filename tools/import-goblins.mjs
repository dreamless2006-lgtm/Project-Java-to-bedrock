// Merges the three girls of Expandable Goblins (an MCreator/GeckoLib mod for Forge 1.20.1, read
// from vendor/goblins/*.jar at import time; nothing of it is committed) into the packs as Minepreggo
// females: the Goblin, Imp and Bloatberry girls keep their own GeckoLib models, layered skins
// (body, hair, eyes, clothes, blush) and animations, and join the mob system (mobs/families.js
// GOBLIN_FAMILIES). Their pregnancy belly is their own: the nested belly cubes of their model
// (belly1 > belly2 > belly3, or belly > belly2 for the Bloatberry girl) grow with the phases in
// their own skin, and the babies move it. Everything written here is under git-ignored
// goblins_port/ folders. Run as part of `npm run import`, after tools/import-jenny.mjs.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { stringifyEntity } from './lib/entity-json.mjs';
import { FAMILY_TAG, MINEPREGGO_PROPERTIES, bellyPreAnimation, initializers, phaseEvents } from './lib/belly-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'goblins_port';
const NS = 'expandable_goblins';
const VENDOR = join(ROOT, 'vendor/goblins');
const LANG_HEADER = '## Expandable Goblins (vendor/goblins, tools/import-goblins.mjs)';

const write = (/** @type {string} */ path, /** @type {string | Uint8Array} */ data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};
const writeJson = (/** @type {string} */ path, /** @type {unknown} */ doc) => write(path, JSON.stringify(doc, null, 2) + '\n');

// ---- clean what the last run wrote -------------------------------------------------------------
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

const jarFile = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => /^expandable_goblins.*\.jar$/.test(f)) : undefined;
if (!jarFile) {
  console.log('Expandable Goblins: not in vendor/goblins/, so not merged');
  process.exit(0);
}
const jar = unzipSync(new Uint8Array(readFileSync(join(VENDOR, jarFile))));
const asset = (/** @type {string} */ path) => {
  const data = jar[`assets/${NS}/${path}`];
  if (!data) throw new Error(`Expandable Goblins: ${path} missing from ${jarFile}`);
  return data;
};
const assetJson = (/** @type {string} */ path) => JSON.parse(strFromU8(asset(path)));

/**
 * The three girls: her model and animation files, the body skins and the layers drawn over them,
 * the bones of her belly from the smallest (always shown) outwards, her colours, where she spawns,
 * and what tames her.
 */
const GIRLS = [
  {
    id: 'goblin_girl', file: 'goblin', name: 'Goblin Girl', egg: ['#5d8f3a', '#c9a46b'],
    skins: ['goblin0', 'goblin1', 'goblin2', 'goblin3', 'goblin4'],
    layers: { hair: ['hair0', 'hair1', 'hair2', 'hair3', 'hair4', 'hair5', 'hair6', 'hair7', 'hair8', 'hair9', 'hair10', 'hair11'], eyes: ['eye0', 'eye1', 'eye2', 'eye3', 'eye4', 'eye5'], cloth: ['cloth0', 'cloth1', 'cloth2', 'cloth3'] },
    belly: ['belly1', 'belly2', 'belly3'], idle: 'idle', walk: 'walk_a', sit: 'sit1', hidden: ['bottle'],
    biomes: ['forest', 'plains', 'taiga'],
  },
  {
    id: 'imp_girl', file: 'imp', name: 'Imp Girl', egg: ['#9b2a2a', '#3b1c2c'],
    skins: ['imp0', 'imp1', 'imp2', 'imp3', 'imp4', 'imp5', 'imp6', 'imp7', 'imp8'],
    layers: { hair: ['imphair1', 'imphair2', 'imphair3', 'imphair4', 'imphair5', 'imphair6', 'imphair7', 'imphair8', 'imphair9', 'imphair10', 'imphair11', 'imphair12'], eyes: ['eye0', 'eye1', 'eye2', 'eye3', 'eye4', 'eye5'], cloth: ['cloth1_imp', 'cloth3_imp', 'cloth4_imp', 'cloth5_imp'] },
    belly: ['belly1', 'belly2', 'belly3'], idle: 'idle', walk: 'walk_a', sit: 'sit1', hidden: ['bottle'],
    biomes: ['nether_wastes', 'crimson_forest', 'soulsand_valley'],
  },
  {
    id: 'bloatberry_girl', file: 'berry', name: 'Bloatberry Girl', egg: ['#7a3fa0', '#e07ad0'],
    skins: ['berrygal', 'berrygal_a', 'berrygal_b', 'berrygal_c'],
    layers: {},
    belly: ['belly', 'belly2'], idle: 'idle1', walk: 'walk1', sit: 'sit1', hidden: [],
    biomes: ['forest', 'flower_forest', 'birch'],
  },
];

/** GeckoLib keyframes hold {vector, easing, lerp_mode}; Bedrock takes the vector (eased linearly, or catmull-rom when constant). */
function frame(/** @type {any} */ value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if ('vector' in value) {
    const v = value.vector;
    const constant = [v].flat().every((c) => typeof c === 'number');
    return value.lerp_mode === 'catmullrom' && constant ? { post: v, lerp_mode: 'catmullrom' } : v;
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
  const molang = Object.values(frames).some((f) => [Array.isArray(f) ? f : [f?.pre, f?.post]].flat(2).some((c) => typeof c === 'string'));
  if (molang) for (const [t, f] of Object.entries(frames)) if (f && typeof f === 'object' && !Array.isArray(f) && f.lerp_mode) frames[t] = f.post ?? f.pre;
  return frames;
}

/** Her belly through the phases: the smallest cube is her waist; the next ones swell out of it. */
function bellyAnimation(/** @type {string[]} */ bones) {
  /** @type {Record<string, any>} */
  const out = {};
  // growth within a phase (0..1) eases the size towards the next one
  const at = (/** @type {number} */ from, /** @type {number} */ step, /** @type {number} */ top) => `math.min(${top}, ${from} + ${step} * (v.bp - %S + v.belly_growth))`;
  // the smallest cube: a soft tummy from the first phase (hidden when she is not pregnant, as the mod hides it)
  out[bones[0]] = { scale: `v.bp >= 0 ? math.min(1.0, 0.7 + 0.15 * (v.bp + v.belly_growth)) : 0.0` };
  if (bones.length === 3) {
    // (each cube hangs under the one before, so its scale multiplies theirs)
    out[bones[1]] = { scale: `v.bp >= 2 ? ${at(0.45, 0.1, 1.0).replace('%S', '2')} : 0.0` };
    out[bones[2]] = { scale: `v.bp >= 6 ? ${at(0.6, 0.07, 0.86).replace('%S', '6')} : 0.0` };
  } else {
    out[bones[1]] = { scale: `v.bp >= 2 ? ${at(0.5, 0.09, 1.15).replace('%S', '2')} : 0.0` };
  }
  return { loop: true, bones: out };
}

/**
 * The babies moving her belly: the outermost shown cube swells, sways and lifts on a broad kick of
 * the kick strength, in her own skin, so it reads as the belly moving rather than a block.
 */
function kickAnimation(/** @type {string[]} */ bones) {
  const pulse = 'math.pow(math.max(0.0, math.sin(q.life_time * (90.0 + 30.0 * v.kick_shown))), 3.0)';
  const sway = 'math.sin(q.life_time * 41.0)';
  /** @type {Record<string, any>} */
  const out = {};
  const outer = bones.length === 3 ? ['v.bp >= 6', bones[2]] : ['v.bp >= 2', bones[1]];
  out[outer[1]] = {
    position: [`${outer[0]} ? 0.35 * ${sway} * ${pulse} * v.kick_w : 0.0`, `${outer[0]} ? 0.25 * ${pulse} * v.kick_w : 0.0`, `${outer[0]} ? -0.5 * ${pulse} * v.kick_w : 0.0`],
    rotation: [0, 0, `${outer[0]} ? 4.0 * ${sway} * ${pulse} * v.kick_w : 0.0`],
    scale: [`${outer[0]} ? 1.0 + 0.05 * ${pulse} * v.kick_w : 1.0`, 1, `${outer[0]} ? 1.0 + 0.09 * ${pulse} * v.kick_w : 1.0`],
  };
  if (bones.length === 3) {
    // before the outer cube shows, the middle one moves
    out[bones[1]] = {
      position: [`(v.bp >= 3 && v.bp < 6) ? 0.3 * ${sway} * ${pulse} * v.kick_w : 0.0`, 0, `(v.bp >= 3 && v.bp < 6) ? -0.4 * ${pulse} * v.kick_w : 0.0`],
      scale: [1, 1, `(v.bp >= 3 && v.bp < 6) ? 1.0 + 0.08 * ${pulse} * v.kick_w : 1.0`],
    };
  }
  return { loop: true, bones: out };
}

/** Her belly tightens in waves during contractions and labor. */
function contractionAnimation(/** @type {string[]} */ bones) {
  const wave = '(v.cw * (0.5 - 0.5 * math.cos(q.life_time * 60.0)))';
  const outer = bones.length === 3 ? bones[2] : bones[1];
  return { loop: true, bones: { [outer]: { scale: [`1.0 - 0.04 * ${wave}`, `1.0 + 0.05 * ${wave}`, `1.0 - 0.03 * ${wave}`] } } };
}

/** The labor poses: she sits for the contractions and the birth, and pushes. */
function laborAnimation(/** @type {string[]} */ bones) {
  const outer = bones.length === 3 ? bones[2] : bones[1];
  return { loop: true, bones: { [outer]: { scale: ['1.0 + 0.05 * v.push', '1.0 - 0.04 * v.push', '1.0 + 0.08 * v.push + 0.03 * math.max(0.0, math.sin(q.anim_time * 600.0))'] } } };
}

const textures = new Set();
const lang = [LANG_HEADER];
let animationCount = 0;
/** @type {Record<string, unknown>} */
const renderControllers = {};
/** @type {Record<string, unknown>} */
const controllers = {};

for (const girl of GIRLS) {
  const id = `${NS}:${girl.id}`;
  const slug = girl.id;
  // ---- geometry and animations ----
  const geoDoc = assetJson(`geo/${girl.file}.geo.json`);
  const geometry = geoDoc['minecraft:geometry'][0];
  const geometryId = `geometry.${NS}.${slug}`;
  geometry.description.identifier = geometryId;
  writeJson(join(RP, 'models/entity', PORT, `${slug}.geo.json`), { format_version: '1.12.0', 'minecraft:geometry': [geometry] });
  const bones = new Set(geometry.bones.map((/** @type {any} */ b) => b.name));
  const source = assetJson(`animations/${girl.file}.animation.json`).animations;
  /** @type {Record<string, any>} */
  const animations = {};
  const animId = (/** @type {string} */ name) => `animation.${NS}.${slug}.${name}`;
  // Her own animations size her belly by how bloated she is (scaled away when she is not): the
  // pregnancy decides its size here, so their belly scales go and only their sway stays.
  const bellyBones = new Set([...girl.belly, 'navel']);
  for (const [name, def] of Object.entries(source)) {
    const keep = (/** @type {string} */ bone, /** @type {string} */ k) => !(bellyBones.has(bone) && k === 'scale');
    const out = { ...def, bones: Object.fromEntries(Object.entries(def.bones ?? {}).filter(([bone]) => bones.has(bone)).map(([bone, ch]) => [bone, Object.fromEntries(Object.entries(/** @type {any} */ (ch)).filter(([k]) => keep(bone, k)).map(([k, v]) => [k, channel(v)]))]).filter(([, ch]) => Object.keys(ch).length)) };
    if (!Object.keys(out.bones).length) continue;
    animations[animId(name)] = out;
    animationCount++;
  }
  animations[animId('mp_belly')] = bellyAnimation(girl.belly);
  animations[animId('mp_kicks')] = kickAnimation(girl.belly);
  animations[animId('mp_contraction')] = contractionAnimation(girl.belly);
  animations[animId('mp_push')] = laborAnimation(girl.belly);
  if (girl.hidden.length) animations[animId('mp_hidden')] = { loop: true, bones: Object.fromEntries(girl.hidden.map((b) => [b, { scale: 0 }])) };
  writeJson(join(RP, 'animations', PORT, `${slug}.animation.json`), { format_version: '1.8.0', animations });

  // ---- what she plays when: idle and walk, sitting for the labor, and the belly always ----
  const controllerId = `controller.animation.${NS}.${slug}.move`;
  controllers[controllerId] = {
    initial_state: 'idle',
    states: {
      idle: { animations: ['idle'], transitions: [{ walk: 'q.modified_move_speed > 0.1 && !v.labor' }, { sit: 'q.is_sitting || v.labor' }], blend_transition: 0.2 },
      walk: { animations: [{ walk: 'q.modified_move_speed' }], transitions: [{ idle: 'q.modified_move_speed <= 0.1 || v.labor' }], blend_transition: 0.2 },
      sit: { animations: ['sit'], transitions: [{ idle: '!q.is_sitting && !v.labor' }], blend_transition: 0.3 },
    },
  };

  // ---- skins: the body and its layers, picked once per girl ----
  const copy = (/** @type {string} */ name) => {
    const path = `textures/${PORT}/${name}`;
    if (!textures.has(name)) write(join(RP, `${path}.png`), asset(`textures/entities/${name}.png`));
    textures.add(name);
    return path;
  };
  /** @type {Record<string, string>} */
  const textureMap = {};
  girl.skins.forEach((s, i) => (textureMap[`skin${i}`] = copy(s)));
  const layerNames = Object.keys(girl.layers);
  for (const layer of layerNames) /** @type {string[]} */ (girl.layers[layer]).forEach((s, i) => (textureMap[`${layer}${i}`] = copy(s)));
  const rcBase = `controller.render.${NS}.${slug}`;
  renderControllers[rcBase] = {
    arrays: { textures: { 'Array.skins': girl.skins.map((_, i) => `Texture.skin${i}`) } },
    geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Array.skins[q.variant]'],
  };
  /** @type {any[]} */
  const rcs = [rcBase];
  // each layer is the same model drawn again with its overlay (GeckoLib's layer renderers), picked by
  // the girl's mark variant and skin id
  layerNames.forEach((layer, n) => {
    const list = /** @type {string[]} */ (girl.layers[layer]);
    const pick = n === 0 ? 'q.mark_variant' : n === 1 ? 'math.mod(q.skin_id, ' + list.length + ')' : 'math.mod(q.mark_variant + q.skin_id, ' + list.length + ')';
    renderControllers[`${rcBase}.${layer}`] = {
      arrays: { textures: { [`Array.${layer}`]: list.map((_, i) => `Texture.${layer}${i}`) } },
      geometry: 'Geometry.default', materials: [{ '*': 'Material.layer' }], textures: [`Array.${layer}[${pick}]`],
    };
    rcs.push(`${rcBase}.${layer}`);
  });
  writeJson(join(RP, 'entity', PORT, `${slug}.entity.json`), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: 'entity_alphatest', layer: 'entity_alphatest' },
        textures: textureMap,
        geometry: { default: geometryId },
        animations: {
          idle: animId(girl.idle), walk: animId(girl.walk), sit: animId(girl.sit),
          move_controller: controllerId,
          belly: animId('mp_belly'), kicks: animId('mp_kicks'), contraction: animId('mp_contraction'), push: animId('mp_push'),
          ...(girl.hidden.length ? { hidden: animId('mp_hidden') } : {}),
          look_at_target: 'animation.common.look_at_target',
        },
        scripts: {
          initialize: initializers([...bellyPreAnimation(), "v.labor = v.pose == 'prebirth' || v.pose == 'birth' || v.pose == 'water_breaking';"], []),
          pre_animation: [...bellyPreAnimation(), "v.labor = v.pose == 'prebirth' || v.pose == 'birth' || v.pose == 'water_breaking';"],
          animate: ['move_controller', 'belly', { kicks: 'v.kick_w' }, 'contraction', { push: "v.pose == 'birth'" }, ...(girl.hidden.length ? ['hidden'] : [])],
        },
        render_controllers: rcs,
        spawn_egg: { base_color: girl.egg[0], overlay_color: girl.egg[1] },
      },
    },
  });

  // ---- the behaviour: a gentle woman of the wilds, tamed with her food, in the mob system ----
  const variants = (/** @type {string} */ kind, /** @type {number} */ count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${NS}:${kind}_${i}`, { [`minecraft:${kind}`]: { value: i } }]));
  const markCount = layerNames.length ? /** @type {string[]} */ (girl.layers[layerNames[0]]).length : 1;
  write(join(BP, 'entities', PORT, `${slug}.json`), stringifyEntity({
    format_version: '1.21.0',
    'minecraft:entity': {
      description: { identifier: id, is_spawnable: true, is_summonable: true, properties: { ...MINEPREGGO_PROPERTIES } },
      component_groups: {
        ...variants('variant', girl.skins.length),
        ...variants('mark_variant', markCount),
        ...variants('skin_id', 6),
        [`${NS}:wild`]: {
          'minecraft:tameable': { probability: 0.33, tame_items: ['minecraft:sweet_berries', 'minecraft:glow_berries', 'minecraft:cake'], tame_event: { event: `${NS}:on_tame`, target: 'self' } },
          'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.8 },
        },
        [`${NS}:tamed`]: {
          'minecraft:is_tamed': {},
          'minecraft:sittable': {},
          'minecraft:behavior.follow_owner': { priority: 4, speed_multiplier: 1.0, start_distance: 8, stop_distance: 2 },
          'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.6 },
        },
      },
      components: {
        'minecraft:type_family': { family: ['goblin_girl', girl.id, 'mob', FAMILY_TAG] },
        'minecraft:health': { value: 20, max: 20 },
        'minecraft:collision_box': { width: 0.6, height: girl.id === 'bloatberry_girl' ? 1.2 : 1.5 },
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
        ...(girl.id === 'imp_girl' ? { 'minecraft:fire_immune': {} } : {}),
      },
      events: {
        'minecraft:entity_spawned': {
          sequence: [
            { add: { component_groups: [`${NS}:wild`] } },
            { randomize: Array.from({ length: girl.skins.length }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:variant_${i}`] } })) },
            { randomize: Array.from({ length: markCount }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:mark_variant_${i}`] } })) },
            { randomize: Array.from({ length: 6 }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:skin_id_${i}`] } })) },
          ],
        },
        [`${NS}:on_tame`]: { remove: { component_groups: [`${NS}:wild`] }, add: { component_groups: [`${NS}:tamed`] } },
        ...phaseEvents(),
      },
    },
  }));
  writeJson(join(BP, 'spawn_rules', PORT, `${slug}.json`), {
    format_version: '1.8.0',
    'minecraft:spawn_rules': {
      description: { identifier: id, population_control: 'animal' },
      conditions: [{
        'minecraft:spawns_on_surface': {},
        ...(girl.id === 'imp_girl' ? { 'minecraft:spawns_underground': {} } : {}),
        'minecraft:brightness_filter': girl.id === 'imp_girl' ? { min: 0, max: 15, adjust_for_weather: false } : { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 4 },
        'minecraft:herd': { min_size: 1, max_size: 2 },
        'minecraft:density_limit': { surface: 2, underground: 2 },
        'minecraft:biome_filter': { any_of: girl.biomes.map((b) => ({ test: 'has_biome_tag', value: b })) },
      }],
    },
  });
  lang.push(`entity.${id}.name=${girl.name}`, `item.spawn_egg.entity.${id}.name=${girl.name} Spawn Egg`);
}
writeJson(join(RP, 'animation_controllers', PORT, 'goblins.animation_controllers.json'), { format_version: '1.10.0', animation_controllers: controllers });
writeJson(join(RP, 'render_controllers', PORT, 'goblins.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`Expandable Goblins: ${GIRLS.length} girls, ${animationCount} animations, ${textures.size} textures`);
