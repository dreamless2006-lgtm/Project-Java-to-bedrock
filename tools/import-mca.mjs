// Brings Minecraft Comes Alive's women into the packs (MCA 6.1.0 for Forge 1.12.2, read from
// vendor/mca/*.jar at import time; nothing of it is committed): mca:villager_woman, an adult woman
// of the village in one of MCA's adult female skins of her profession (farmer, baker, miner,
// librarian, priest, guard, smith, warrior, butcher), trading like a villager of that trade, named
// from MCA's names. She is drawn like this pack's female player with a custom skin: the vanilla
// humanoid model, the mod's chest, and in pregnancy the mod's belly of each phase mapped onto her
// own skin pixels, so her belly is her skin and her clothes; the babies kick it and contractions
// tighten it. She walks and looks about with vanilla's humanoid animations, walks heavily late in
// pregnancy, sits when told to and rides seated, and has every pregnancy pose (tools/lib/mca-poses.mjs:
// the player's own poses, and the mod's and the authored ones on the player's flat labor model), the
// baby crowning at her birth as at the player's. She joins the mob system (mobs/families.js MCA_FAMILIES).
// Adults only: MCA's child skins and child mechanics are never read.
// Output goes under git-ignored mca_port/ folders. Run as part of `npm run import`, after
// tools/import-jar.mjs (her poses and crowning read the mod's converted models and animations).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { stringifyEntity } from './lib/entity-json.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, PHASES, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
import { crowningLines } from './lib/crowning.mjs';
import { LYING_LABOR, mcaPoseAnimations } from './lib/mca-poses.mjs';
import { blank, decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'mca_port';
const ID = 'mca:villager_woman';
const VENDOR = join(ROOT, 'vendor/mca');
const LANG_HEADER = '## Minecraft Comes Alive (vendor/mca, tools/import-mca.mjs)';

const write = (/** @type {string} */ path, /** @type {string | Uint8Array} */ data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};
const writeJson = (/** @type {string} */ path, /** @type {unknown} */ doc) => write(path, JSON.stringify(doc, null, 2) + '\n');

for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(BP, 'scripts', PORT), join(RP, 'entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) rmSync(dir, { recursive: true, force: true });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at >= 0) writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n'));
}

const jarFile = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => /^MCA.*\.jar$/i.test(f)) : undefined;
if (!jarFile) {
  console.log('Minecraft Comes Alive: not in vendor/mca/, so not merged');
  process.exit(0);
}
const jar = unzipSync(new Uint8Array(readFileSync(join(VENDOR, jarFile))));

/** Each profession: the vanilla trades she offers, and how many of the women take it up (its skins). */
const PROFESSIONS = /** @type {Record<string, string | null>} */ ({
  farmer: 'trading/economy_trades/farmer_trades.json',
  baker: 'trading/economy_trades/farmer_trades.json',
  miner: 'trading/economy_trades/tool_smith_trades.json',
  librarian: 'trading/economy_trades/librarian_trades.json',
  priest: 'trading/economy_trades/cleric_trades.json',
  guard: 'trading/economy_trades/armorer_trades.json',
  smith: 'trading/economy_trades/weapon_smith_trades.json',
  warrior: 'trading/economy_trades/weapon_smith_trades.json',
  butcher: 'trading/economy_trades/butcher_trades.json',
});
const TRADE_NAMES = /** @type {Record<string, string>} */ ({ farmer: 'entity.villager.farmer', baker: 'entity.villager.farmer', miner: 'entity.villager.tool', librarian: 'entity.villager.librarian',
  priest: 'entity.villager.cleric', guard: 'entity.villager.armor', smith: 'entity.villager.weapon', warrior: 'entity.villager.weapon', butcher: 'entity.villager.butcher' });

/**
 * A skin in the old 64x32 layout as a 64x64 one: the left arm and leg take the right ones' pixels
 * (each face mirrored across the limb, as the game itself converts old skins).
 * @param {import('./lib/png.mjs').Image} img
 */
function modernSkin(img) {
  if (img.height === 64) return img;
  const out = blank(64, 64);
  for (let y = 0; y < 32; y++) out.data.set(img.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), y * 64 * 4);
  const copyFace = (/** @type {number} */ sx, /** @type {number} */ sy, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ dx, /** @type {number} */ dy) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((sy + y) * 64 + sx + (w - 1 - x)) * 4;
      out.data.set(img.data.subarray(s, s + 4), ((dy + y) * 64 + dx + x) * 4);
    }
  };
  // a limb box at (u, v) of 4x12x4: top/bottom, then right, front, left, back faces
  const limb = (/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ du, /** @type {number} */ dv) => {
    copyFace(u + 4, v, 4, 4, du + 4, dv);
    copyFace(u + 8, v, 4, 4, du + 8, dv);
    copyFace(u + 8, v + 4, 4, 12, du + 0, dv + 4);
    copyFace(u + 4, v + 4, 4, 12, du + 4, dv + 4);
    copyFace(u + 0, v + 4, 4, 12, du + 8, dv + 4);
    copyFace(u + 12, v + 4, 4, 12, du + 12, dv + 4);
  };
  limb(0, 16, 16, 48); // right leg -> left leg
  limb(40, 16, 32, 48); // right arm -> left arm
  return out;
}

// ---- her skins: every adult female skin of every profession (never the child folder) ----------
/** @type {{ profession: string, path: string }[]} */
const skins = [];
for (const name of Object.keys(jar).sort()) {
  const m = name.match(/^assets\/mca\/skins\/female\/([a-z]+)\/([^/]+)\.png$/);
  if (!m || m[1] === 'child' || !(m[1] in PROFESSIONS)) continue;
  const path = `textures/${PORT}/skins/${m[1]}_${skins.filter((s) => s.profession === m[1]).length}`;
  write(join(RP, `${path}.png`), encodePng(modernSkin(decodePng(jar[name]))));
  skins.push({ profession: m[1], path });
}
if (skins.length > 256) throw new Error(`MCA: ${skins.length} skins, more than the skin property holds`);

// ---- names: MCA's women's names ----------------------------------------------------------------
const names = strFromU8(jar['assets/mca/lang/names.lang'] ?? new Uint8Array()).split(/\r?\n/).map((l) => l.match(/^name\.female\d+=(.+)$/)?.[1]?.trim()).filter(Boolean);
write(join(BP, 'scripts', PORT, 'names.js'), `// Generated by tools/import-mca.mjs from Minecraft Comes Alive's names - do not edit\nexport const NAMES = ${JSON.stringify(names)};\n`);

// ---- the client: the humanoid model in her skin, the mod's chest and bellies on her skin -------
const readGeometry = (/** @type {string} */ file) => {
  if (!existsSync(join(RP, file))) throw new Error(`MCA: ${file} is missing (run tools/import-jar.mjs first)`);
  return JSON.parse(readFileSync(join(RP, file), 'utf8'))['minecraft:geometry'][0];
};
const model = (/** @type {string} */ name) => readGeometry(`models/entity/minepreggo/${name}.geo.json`);
const bodies = PHASES.map((p) => model(`player_body_custom_p${p}`));
const chest = model('player_boobs_custom');
// the player's flat labor model and her baby crowning at it (tools/import-jar.mjs), the baby a human one
const flat = readGeometry('models/entity/player_labor.geo.json');
const crowning = model('crowning/player_crowning_humanoid');
const FETUS = 'textures/minepreggo/entity/fetus/human_fetus';
const SKIN = "Array.skins[math.clamp(q.property('mca:skin'), 0, " + (skins.length - 1) + ')]';
const skinArray = { 'Array.skins': skins.map((_, i) => `Texture.s${i}`) };
const renderControllers = {
  [`controller.render.${PORT}.woman`]: { arrays: { textures: skinArray }, geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: [SKIN] },
  // the same body with every part top-level, for the poses written for the mod's flat models
  [`controller.render.${PORT}.woman_flat`]: { arrays: { textures: skinArray }, geometry: 'Geometry.flat', materials: [{ '*': 'Material.default' }], textures: [SKIN] },
  // her chest, while she is not pregnant (each belly geometry has its own)
  [`controller.render.${PORT}.chest`]: { arrays: { textures: skinArray }, geometry: 'Geometry.chest', materials: [{ '*': 'Material.default' }], textures: [SKIN] },
  [`controller.render.${PORT}.belly`]: {
    arrays: { textures: skinArray, geometries: { 'Array.bellies': PHASES.map((p) => `Geometry.belly_p${p}`) } },
    geometry: 'Array.bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: [SKIN],
  },
  // the baby's head coming out during the birth, a little further with each push
  [`controller.render.${PORT}.crowning`]: { geometry: 'Geometry.crowning', materials: [{ '*': 'Material.default' }], textures: ['Texture.fetus'] },
};
writeJson(join(RP, 'render_controllers', PORT, 'mca.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });

// her poses made from the mod's humanoid creeper girl, the authored ones and the player's labor (tools/lib/mca-poses.mjs)
const readAnimations = (/** @type {string} */ file, /** @type {string} */ prefix) => {
  if (!existsSync(join(RP, file))) throw new Error(`MCA: ${file} is missing (run tools/import-jar.mjs first)`);
  const all = Object.entries(JSON.parse(readFileSync(join(RP, file), 'utf8')).animations);
  return Object.fromEntries(all.filter(([id]) => id.startsWith(prefix)).map(([id, a]) => [id.slice(prefix.length), a]));
};
const creeperAnimations = readAnimations('animations/minepreggo/humanoid_creeper_girl.animation.json', 'animation.minepreggo.humanoid_creeper_girl.');
const laborAnimations = readAnimations('animations/minepreggo/player_labor.animation.json', 'animation.minepreggo.player.labor_');
const own = mcaPoseAnimations({ flat, creeperGeometry: model('humanoid_creeper_girl'), creeperAnimations, laborAnimations, bodies });
const ownId = (/** @type {string} */ pose) => `animation.minepreggo.mca.${pose}`;
writeJson(join(RP, 'animations', PORT, 'villager_woman.animation.json'), { format_version: '1.8.0', animations: Object.fromEntries(Object.entries(own).map(([pose, a]) => [ownId(pose), a])) });

/** The pregnancy poses written for the mod's flat models: she is drawn with the flat body in them. */
const FLAT_POSES = ['morning_sickness', 'kicking_sit', 'contraction', 'incapacitated', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'scene', 'scene_sit'];
/** The player's labor poses she plays as they are (the lying ones are hers: LYING_LABOR). */
const STANDING_LABOR = ['water_breaking', 'prebirth', 'miscarriage'];
const anyPose = (/** @type {string[]} */ poses) => poses.map((p) => `v.pose == '${p}'`).join(' || ');
const HEAVY = PHASES.filter((p) => p >= 4);
const pre = [
  ...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => bodies[p]),
  // vanilla's walk swings her arms and legs by this (as the zombie's pre_animation sets it)
  'v.tcos0 = math.cos(q.modified_distance_moved * 38.17) * q.modified_move_speed / v.gliding_speed_value * 57.3;',
  // and seated in a vehicle she sinks into boats and minecarts as far as the zombie does
  "v.riding_y_offset = 1.0 + (q.is_riding_any_entity_of_type('minecraft:minecart', 'minecraft:boat', 'minecraft:chest_boat') ? -3.0 : 0.0);",
  // in a pose of the mod's, sitting or riding she is drawn flat; she walks only in the poses she can walk in
  `v.posed = ${anyPose(FLAT_POSES)};`,
  'v.flat = v.posed || q.is_sitting || q.is_riding;',
  "v.walks = !v.flat || v.pose == 'water_breaking';",
  ...crowningLines({ when: "v.pose == 'birth'" }),
];
const vanilla = {
  look_at_target_default: 'animation.humanoid.look_at_target.default', look_at_target_gliding: 'animation.humanoid.look_at_target.gliding', look_at_target_swimming: 'animation.humanoid.look_at_target.swimming',
  move: 'animation.humanoid.move', bob: 'animation.humanoid.bob', holding: 'animation.humanoid.holding', 'attack.rotations': 'animation.humanoid.attack.rotations',
  look_at_target_controller: 'controller.animation.humanoid.look_at_target', move_controller: 'controller.animation.humanoid.move', bob_controller: 'controller.animation.humanoid.bob',
  holding_controller: 'controller.animation.humanoid.holding', attack_controller: 'controller.animation.humanoid.attack',
};
/** @type {Record<string, string>} */
const animations = {
  ...vanilla, ...BELLY_ANIMATIONS, belly_controller: 'controller.animation.minepreggo.belly',
  // her chest, belly and butt bounce as she walks: the bones of this pack's player bodies
  walk_jiggle: 'animation.minepreggo.walk_jiggle',
  // the player's own poses (the same humanoid bones): on the humanoid her back pain, her hands
  // rubbing her belly and the heavy walk late in pregnancy; on the flat body her labor (her birth
  // and the rest after it are hers, the player's with her head out of the floor)
  back_pain: 'animation.minepreggo.player.back_pain',
  ...Object.fromEntries(PHASES.map((p) => [`belly_rubbing_p${p}`, `animation.minepreggo.player.belly_rubbing_p${p}`])),
  ...Object.fromEntries(HEAVY.map((p) => [`walking_heavy_p${p}`, `animation.minepreggo.player.walking_heavy_p${p}`])),
  belly_rubs_i: 'animation.minepreggo.belly.belly_rubs_needs_i', belly_rubs_ii: 'animation.minepreggo.belly.belly_rubs_needs_ii', belly_rubs_iii: 'animation.minepreggo.belly.belly_rubs_needs_iii',
  ...Object.fromEntries(STANDING_LABOR.map((p) => [`labor_${p}`, `animation.minepreggo.player.labor_${p}`])),
  // the baby's head at her opening, in the rhythm of the mod's birth on her back
  crowning: 'animation.minepreggo.crowning',
  // the rest of her poses, sitting down, riding and lying in labor (tools/lib/mca-poses.mjs)
  ...Object.fromEntries(Object.keys(own).map((pose) => [`pose_${pose}`, ownId(pose)])),
};
const animate = [
  // vanilla's head, walk, breathing arms, holding and swing while her limbs are her own
  { look_at_target_controller: '!v.posed' }, { move_controller: 'v.walks' }, { bob_controller: '!v.flat' }, { holding_controller: '!v.flat' }, { attack_controller: '!v.flat' },
  // then her poses (the ones solved here override what came before them on their bones)
  { pose_sit: '!v.posed && q.is_sitting && !q.is_riding' }, { pose_riding: '!v.posed && q.is_riding' },
  ...HEAVY.map((p) => ({ [`walking_heavy_p${p}`]: `!v.flat && v.pose == 'none' && v.bp == ${p} && q.modified_move_speed > 0.05 && q.is_on_ground` })),
  { pose_morning_sickness: "v.pose == 'morning_sickness'" }, { pose_kicking_sit: "v.pose == 'kicking_sit'" },
  { pose_contraction: "v.pose == 'contraction' || v.pose == 'incapacitated'" },
  { back_pain: "!v.flat && v.pose == 'back_pain'" },
  ...STANDING_LABOR.map((p) => ({ [`labor_${p}`]: `v.pose == '${p}'` })),
  ...LYING_LABOR.map((p) => ({ [`pose_${p}`]: `v.pose == '${p}'` })),
  { crowning: "v.pose == 'birth'" },
  // she wants her belly rubbed: it stirs under her hands
  { belly_rubs_i: "v.pose == 'belly_rubs' && v.phase <= 2" }, { belly_rubs_ii: "v.pose == 'belly_rubs' && v.phase >= 3 && v.phase <= 6" }, { belly_rubs_iii: "v.pose == 'belly_rubs' && v.phase >= 7" },
  ...PHASES.map((p) => ({ [`belly_rubbing_p${p}`]: `v.pose == 'belly_rubs' && v.bp == ${p}` })),
  { pose_scene: "v.pose == 'scene'" }, { pose_scene_sit: "v.pose == 'scene_sit'" },
  // and her belly on top of whatever pose she is in: its size, breath, kicks and contractions, the bounce of her walk
  'belly_controller', 'walk_jiggle',
];
const geometry = {
  default: 'geometry.humanoid.custom', flat: 'geometry.minepreggo.player_labor', chest: 'geometry.minepreggo.player_boobs_custom',
  ...Object.fromEntries(PHASES.map((p) => [`belly_p${p}`, `geometry.minepreggo.player_body_custom_p${p}`])), crowning: 'geometry.minepreggo.player_crowning_humanoid',
};
checkPoses();
writeJson(join(RP, 'entity', PORT, 'villager_woman.entity.json'), {
  format_version: '1.10.0',
  'minecraft:client_entity': {
    description: {
      identifier: ID,
      materials: { default: 'entity_alphatest' },
      textures: { ...Object.fromEntries(skins.map((s, i) => [`s${i}`, s.path])), fetus: FETUS },
      geometry,
      animations,
      scripts: {
        // vanilla's walk divides by the gliding speed and its swimming head reads the swim amount,
        // which the game sets only for players
        initialize: initializers(pre, ['variable.gliding_speed_value = 1.0;', 'variable.swim_amount = 0.0;']),
        pre_animation: pre,
        animate,
      },
      render_controllers: [
        { [`controller.render.${PORT}.woman`]: '!v.flat' }, { [`controller.render.${PORT}.woman_flat`]: 'v.flat' },
        { [`controller.render.${PORT}.chest`]: 'v.bp < 0' }, { [`controller.render.${PORT}.belly`]: 'v.bp >= 0' }, { [`controller.render.${PORT}.crowning`]: 'v.crowning' },
      ],
      spawn_egg: { base_color: '#a8763e', overlay_color: '#e7c3a6' },
      enable_attachables: true,
    },
  },
});

/**
 * What the game would refuse or show wrong, checked before she is written: every animate entry has
 * a short name, every animation of ours exists, every bone of her poses is in what she draws in
 * them (the humanoid's limbs, the flat body's, the chest, bellies and crowning).
 */
function checkPoses() {
  /** @type {Record<string, any>} */
  const defs = {};
  const scan = (/** @type {string} */ dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) scan(join(dir, e.name));
      else if (e.name.endsWith('.json')) Object.assign(defs, JSON.parse(readFileSync(join(dir, e.name), 'utf8')).animations ?? {});
    }
  };
  scan(join(RP, 'animations'));
  for (const [pose, a] of Object.entries(own)) defs[ownId(pose)] = a;
  const drawn = new Set([flat, chest, crowning, ...bodies].flatMap((g) => g.bones.map((/** @type {any} */ b) => b.name.toLowerCase())));
  for (const entry of animate) for (const name of typeof entry === 'string' ? [entry] : Object.keys(entry)) if (!animations[name]) throw new Error(`MCA: animate plays undefined "${name}"`);
  for (const [name, id] of Object.entries(animations)) {
    if (!id.startsWith('animation.minepreggo.')) continue;
    const def = defs[id];
    if (!def) throw new Error(`MCA: ${name} refers to unknown ${id}`);
    // the mod's belly animations also move a left_arm of its own rigs, which she does not have
    const missing = Object.keys(def.bones ?? {}).filter((b) => !drawn.has(b.toLowerCase()) && !(id.includes('.belly.belly_rubs') && b === 'left_arm'));
    if (missing.length) throw new Error(`MCA: ${id} moves ${missing.join(', ')}, which she does not have`);
  }
}

// ---- the behaviour: a villager woman of her trade, tamed with flowers and cake, in the mob system ----
const professions = Object.keys(PROFESSIONS).filter((p) => skins.some((s) => s.profession === p));
/** @type {Record<string, unknown>} */
const groups = {
  [`${PORT}:wild`]: {
    'minecraft:tameable': { probability: 0.25, tame_items: ['minecraft:poppy', 'minecraft:dandelion', 'minecraft:cornflower', 'minecraft:cake'], tame_event: { event: `${PORT}:on_tame`, target: 'self' } },
    'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.6 },
  },
  [`${PORT}:tamed`]: {
    'minecraft:is_tamed': {},
    'minecraft:sittable': {},
    // told to sit, she stays sitting (without it she would follow and stroll in her sitting pose)
    'minecraft:behavior.stay_while_sitting': { priority: 1 },
    'minecraft:behavior.follow_owner': { priority: 5, speed_multiplier: 1.0, start_distance: 8, stop_distance: 2 },
    'minecraft:behavior.random_stroll': { priority: 8, speed_multiplier: 0.5 },
  },
};
for (const p of professions) {
  groups[`${PORT}:${p}`] = {
    'minecraft:economy_trade_table': { display_name: TRADE_NAMES[p], table: PROFESSIONS[p], new_screen: true, persist_trades: true, convert_trades_economy: true },
  };
}
const skinPicks = (/** @type {string} */ p) => skins.map((s, i) => [s, i]).filter(([s]) => /** @type {any} */ (s).profession === p).map(([, i]) => ({ weight: 1, set_property: { 'mca:skin': i } }));
write(join(BP, 'entities', PORT, 'villager_woman.json'), stringifyEntity({
  format_version: '1.21.0',
  'minecraft:entity': {
    description: { identifier: ID, is_spawnable: true, is_summonable: true, properties: { ...MINEPREGGO_PROPERTIES, 'mca:skin': { type: 'int', range: [0, Math.max(1, skins.length - 1)], default: 0, client_sync: true } } },
    component_groups: groups,
    components: {
      'minecraft:type_family': { family: ['villager_woman', 'mob', FAMILY_TAG] },
      'minecraft:health': { value: 20, max: 20 },
      'minecraft:collision_box': { width: 0.6, height: 1.9 },
      'minecraft:movement': { value: 0.5 },
      'minecraft:movement.basic': {},
      'minecraft:navigation.walk': { can_path_over_water: true, can_pass_doors: true, can_open_doors: true, avoid_water: true },
      'minecraft:annotation.open_door': {},
      'minecraft:jump.static': {},
      'minecraft:can_climb': {},
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:nameable': { always_show: false, allow_name_tag_renaming: true },
      'minecraft:persistent': {},
      'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
      'minecraft:behavior.float': { priority: 0 },
      'minecraft:behavior.panic': { priority: 1, speed_multiplier: 0.6 },
      'minecraft:behavior.trade_with_player': { priority: 2 },
      'minecraft:behavior.look_at_trading_player': { priority: 3 },
      'minecraft:behavior.look_at_player': { priority: 9, look_distance: 8, probability: 0.02 },
      'minecraft:behavior.random_look_around': { priority: 10 },
    },
    events: {
      'minecraft:entity_spawned': {
        sequence: [
          { add: { component_groups: [`${PORT}:wild`] } },
          { randomize: professions.map((p) => ({ weight: skins.filter((s) => s.profession === p).length, sequence: [{ add: { component_groups: [`${PORT}:${p}`] } }, { randomize: skinPicks(p) }] })) },
        ],
      },
      [`${PORT}:on_tame`]: { remove: { component_groups: [`${PORT}:wild`] }, add: { component_groups: [`${PORT}:tamed`] } },
      ...phaseEvents(),
    },
  },
}));
writeJson(join(BP, 'spawn_rules', PORT, 'villager_woman.json'), {
  format_version: '1.8.0',
  'minecraft:spawn_rules': {
    description: { identifier: ID, population_control: 'animal' },
    conditions: [{
      'minecraft:spawns_on_surface': {},
      'minecraft:brightness_filter': { min: 7, max: 15, adjust_for_weather: false },
      'minecraft:weight': { default: 12 },
      'minecraft:herd': { min_size: 1, max_size: 2 },
      'minecraft:density_limit': { surface: 3 },
      'minecraft:player_in_village_filter': { distance: 48, village_border_tolerance: 32 },
      'minecraft:biome_filter': { any_of: ['plains', 'desert', 'savanna', 'taiga', 'cold', 'meadow'].map((b) => ({ test: 'has_biome_tag', value: b })) },
    }],
  },
});
const lang = [LANG_HEADER, `entity.${ID}.name=Villager Woman`, `item.spawn_egg.entity.${ID}.name=Villager Woman Spawn Egg`];
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`Minecraft Comes Alive: ${skins.length} adult women's skins in ${professions.length} trades, ${names.length} names`);
