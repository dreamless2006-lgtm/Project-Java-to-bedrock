// Brings Minecraft Comes Alive's women into the packs (MCA 6.1.0 for Forge 1.12.2, read from
// vendor/mca/*.jar at import time; nothing of it is committed): mca:villager_woman, an adult woman
// of the village in one of MCA's adult female skins of her profession (farmer, baker, miner,
// librarian, priest, guard, smith, warrior, butcher), trading like a villager of that trade, named
// from MCA's names. She is drawn like this pack's female player with a custom skin: the vanilla
// humanoid model, the mod's chest, and in pregnancy the mod's belly of each phase mapped onto her
// own skin pixels, so her belly is her skin and her clothes; the babies kick it and contractions
// tighten it. She joins the mob system (mobs/families.js MCA_FAMILIES).
// Adults only: MCA's child skins and child mechanics are never read.
// Output goes under git-ignored mca_port/ folders. Run as part of `npm run import`.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { stringifyEntity } from './lib/entity-json.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, PHASES, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
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
  join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) rmSync(dir, { recursive: true, force: true });
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
const model = (/** @type {string} */ name) => JSON.parse(readFileSync(join(RP, 'models/entity/minepreggo', `${name}.geo.json`), 'utf8'))['minecraft:geometry'][0];
const bodies = PHASES.map((p) => model(`player_body_custom_p${p}`));
const SKIN = "Array.skins[math.clamp(q.property('mca:skin'), 0, " + (skins.length - 1) + ')]';
const renderControllers = {
  [`controller.render.${PORT}.woman`]: {
    arrays: { textures: { 'Array.skins': skins.map((_, i) => `Texture.s${i}`) } },
    geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: [SKIN],
  },
  // her chest, while she is not pregnant (each belly geometry has its own)
  [`controller.render.${PORT}.chest`]: {
    arrays: { textures: { 'Array.skins': skins.map((_, i) => `Texture.s${i}`) } },
    geometry: 'Geometry.chest', materials: [{ '*': 'Material.default' }], textures: [SKIN],
  },
  [`controller.render.${PORT}.belly`]: {
    arrays: { textures: { 'Array.skins': skins.map((_, i) => `Texture.s${i}`) }, geometries: { 'Array.bellies': PHASES.map((p) => `Geometry.belly_p${p}`) } },
    geometry: 'Array.bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: [SKIN],
  },
};
writeJson(join(RP, 'render_controllers', PORT, 'mca.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });

const LABOR = "v.labor = v.pose == 'water_breaking' || v.pose == 'prebirth' || v.pose == 'birth' || v.pose == 'postbirth';";
const pre = [...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => bodies[p]), LABOR];
const vanilla = {
  look_at_target_default: 'animation.humanoid.look_at_target.default', look_at_target_gliding: 'animation.humanoid.look_at_target.gliding', look_at_target_swimming: 'animation.humanoid.look_at_target.swimming',
  move: 'animation.humanoid.move', bob: 'animation.humanoid.bob', holding: 'animation.humanoid.holding', 'attack.rotations': 'animation.humanoid.attack.rotations',
  look_at_target_controller: 'controller.animation.humanoid.look_at_target', move_controller: 'controller.animation.humanoid.move', bob_controller: 'controller.animation.humanoid.bob',
  holding_controller: 'controller.animation.humanoid.holding', attack_controller: 'controller.animation.humanoid.attack',
};
writeJson(join(RP, 'entity', PORT, 'villager_woman.entity.json'), {
  format_version: '1.10.0',
  'minecraft:client_entity': {
    description: {
      identifier: ID,
      materials: { default: 'entity_alphatest' },
      textures: Object.fromEntries(skins.map((s, i) => [`s${i}`, s.path])),
      geometry: { default: 'geometry.humanoid.custom', chest: 'geometry.minepreggo.player_boobs_custom', ...Object.fromEntries(PHASES.map((p) => [`belly_p${p}`, `geometry.minepreggo.player_body_custom_p${p}`])) },
      animations: {
        ...vanilla, ...BELLY_ANIMATIONS, belly_controller: 'controller.animation.minepreggo.belly',
        // her labor: the poses of this pack's player (the same humanoid bones)
        labor_water_breaking: 'animation.minepreggo.player.labor_water_breaking', labor_prebirth: 'animation.minepreggo.player.labor_prebirth',
        labor_birth: 'animation.minepreggo.player.labor_birth', labor_postbirth: 'animation.minepreggo.player.labor_postbirth',
      },
      scripts: {
        initialize: initializers(pre, []),
        pre_animation: pre,
        animate: [
          'look_at_target_controller', { move_controller: '!v.labor' }, 'bob_controller', 'holding_controller', 'attack_controller', 'belly_controller',
          { labor_water_breaking: "v.pose == 'water_breaking'" }, { labor_prebirth: "v.pose == 'prebirth'" }, { labor_birth: "v.pose == 'birth'" }, { labor_postbirth: "v.pose == 'postbirth'" },
        ],
      },
      render_controllers: [`controller.render.${PORT}.woman`, { [`controller.render.${PORT}.chest`]: 'v.bp < 0' }, { [`controller.render.${PORT}.belly`]: 'v.bp >= 0' }],
      spawn_egg: { base_color: '#a8763e', overlay_color: '#e7c3a6' },
      enable_attachables: true,
    },
  },
});

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
