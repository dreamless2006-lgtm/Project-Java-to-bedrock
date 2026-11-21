// The babies' own items and the grown children they become (all original art, drawn here pixel by
// pixel from the lines' colours in packs/behavior/scripts/items/lines.js): every mother that gave a
// plain human baby gets a baby item of her own, and every line a grown son's and a grown daughter's
// skin for minepreggo:grown_child, the adult companion a baby grows up into (items/babies.js).
// Run: node tools/gen/children.mjs
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { blank, encodePng } from '../lib/png.mjs';
import { babyIcon } from '../lib/baby-icon.mjs';
import { LINES } from '../../packs/behavior/scripts/items/lines.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const out = (/** @type {string} */ path, /** @type {string | Uint8Array} */ body) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
};
const json = (/** @type {string} */ path, /** @type {any} */ doc) => out(path, JSON.stringify(doc, null, 2) + '\n');
const shade = (/** @type {number[]} */ c, /** @type {number} */ f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const TRAITS = /** @type {Record<string, import('../lib/baby-icon.mjs').Trait>} */ ({ imp_girl: 'horns', jenny_slime_girl: 'slime', jenny_monster_slime_girl: 'slime', lopunny: 'cat_ears', lucario: 'cat_ears', gardevoir: 'flower', lycanroc: 'cat_ears', goblin_girl: 'cat_ears', daisy: 'flower', enny: 'streak' });

// ---- the baby items ---------------------------------------------------------------------------------
const textures = JSON.parse(readFileSync(join(RP, 'textures/item_texture.json'), 'utf8'));
const names = [];
for (const line of LINES.filter((l) => l.made)) {
  const id = `baby_${line.item}`;
  out(join(RP, `textures/port/children/${id}.png`), encodePng(babyIcon({ skin: line.skin, hair: line.hair, blanket: line.shirt, trim: line.trim, trait: TRAITS[line.item] ?? 'none' })));
  textures.texture_data[`minepreggo_${id}`] = { textures: `textures/port/children/${id}` };
  json(join(BP, `items/children/${id}.json`), {
    format_version: '1.26.30',
    'minecraft:item': {
      description: { identifier: `minepreggo:${id}`, menu_category: { category: 'items' } },
      components: { 'minecraft:icon': `minepreggo_${id}`, 'minecraft:display_name': { value: `item.minepreggo.${id}` }, 'minecraft:max_stack_size': 1 },
    },
  });
  names.push(`item.minepreggo.${id}=${line.name}'s Baby`);
}
json(join(RP, 'textures/item_texture.json'), textures);

// ---- the grown children's skins (64 x 64, the classic layout) -----------------------------------------
/** Paints a box-UV cube's faces: fill(face, x, y, w, h) for top, bottom, right, front, left, back. */
function box(/** @type {number} */ u, /** @type {number} */ v, /** @type {number[]} */ [w, h, d], /** @type {(face: string, x: number, y: number, w: number, h: number) => void} */ fill) {
  fill('top', u + d, v, w, d);
  fill('bottom', u + d + w, v, w, d);
  fill('right', u, v + d, d, h);
  fill('front', u + d, v + d, w, h);
  fill('left', u + d + w, v + d, d, h);
  fill('back', u + d + w + d, v + d, w, h);
}
function skin(/** @type {import('../../packs/behavior/scripts/items/lines.js').Line} */ line, /** @type {boolean} */ daughter) {
  const img = blank(64, 64);
  const put = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number[]} */ c) => img.data.set([c[0], c[1], c[2], 255], (y * 64 + x) * 4);
  const rect = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {(x: number, y: number) => number[]} */ c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c(i, j));
  };
  const flat = (/** @type {number[]} */ c) => (/** @type {number} */ i, /** @type {number} */ j) => ((i * 7 + j * 3) % 11 === 0 ? shade(c, 0.93) : c);
  const { skin: tone, hair, shirt, trim } = line;
  const pants = shade(trim, 0.8);
  const shoes = shade(trim, 0.45);
  // the head: her skin, eyes in her trim colour, brows of the hair, a mouth
  box(0, 0, [8, 8, 8], (face, x, y, w, h) => {
    rect(x, y, w, h, flat(tone));
    if (face === 'front') {
      put(x + 1, y + 4, [250, 250, 250]); put(x + 2, y + 4, shade(trim, 0.7));
      put(x + 5, y + 4, shade(trim, 0.7)); put(x + 6, y + 4, [250, 250, 250]);
      put(x + 1, y + 3, hair); put(x + 2, y + 3, hair); put(x + 5, y + 3, hair); put(x + 6, y + 3, hair);
      put(x + 3, y + 6, shade(tone, daughter ? 0.8 : 0.7)); put(x + 4, y + 6, shade(tone, daughter ? 0.8 : 0.7));
      if (daughter) { put(x + 1, y + 5, shade([236, 140, 150], 1)); put(x + 6, y + 5, shade([236, 140, 150], 1)); }
    }
  });
  // the hair, on the hat layer: a fringe, short at the sides for a son and to the jaw for a daughter
  box(32, 0, [8, 8, 8], (face, x, y, w, h) => {
    const rows = face === 'top' || face === 'back' ? h : face === 'front' ? 2 : daughter ? h : 3;
    rect(x, y, w, rows, flat(hair));
    if (face === 'front') { put(x, y + 2, hair); put(x + w - 1, y + 2, hair); if (daughter) for (let j = 2; j < h; j++) { put(x, y + j, hair); put(x + w - 1, y + j, hair); } }
  });
  // the body: her colours' shirt, a collar and a belt in the trim
  box(16, 16, [8, 12, 4], (face, x, y, w, h) => {
    rect(x, y, w, h, flat(shirt));
    if (face === 'front' || face === 'back') { rect(x, y + h - 2, w, 1, () => trim); if (face === 'front') rect(x + 2, y, w - 4, 1, () => daughter ? tone : trim); }
  });
  // the arms: sleeves of the shirt, then the skin (slim for a daughter)
  const aw = daughter ? 3 : 4;
  for (const [u, v] of [[40, 16], [32, 48]]) {
    box(u, v, [aw, 12, 4], (face, x, y, w, h) => {
      rect(x, y, w, h, flat(tone));
      if (face !== 'bottom') rect(x, y, w, face === 'top' ? h : daughter ? 3 : 4, flat(shirt));
      if (face !== 'top' && face !== 'bottom') rect(x, y + (daughter ? 3 : 4), w, 1, () => trim);
    });
  }
  // the legs: trousers for a son; a skirt over bare legs for a daughter; shoes
  for (const [u, v] of [[0, 16], [16, 48]]) {
    box(u, v, [4, 12, 4], (face, x, y, w, h) => {
      if (face === 'top') return rect(x, y, w, h, flat(daughter ? shirt : pants));
      if (face === 'bottom') return rect(x, y, w, h, () => shoes);
      rect(x, y, w, h, flat(daughter ? tone : pants));
      if (daughter) { rect(x, y, w, 4, flat(shirt)); rect(x, y + 4, w, 1, () => trim); }
      rect(x, y + h - 2, w, 2, () => shoes);
    });
  }
  return img;
}
const skins = [];
for (const line of LINES) {
  for (const daughter of [false, true]) {
    const file = `textures/port/children/skins/${line.item}_${daughter ? 'daughter' : 'son'}`;
    out(join(RP, `${file}.png`), encodePng(skin(line, daughter)));
    skins.push(file);
  }
}

// ---- the grown child: geometry, render controller, animations, client and server entity ---------------
const cube = (/** @type {number[]} */ origin, /** @type {number[]} */ size, /** @type {any} */ uv, inflate = 0) => ({ origin, size, uv, ...(inflate ? { inflate } : {}) });
/** A per-face UV on one region for every face. */
const faces = (/** @type {number[]} */ uv, /** @type {number[]} */ uv_size, /** @type {number[]} */ side, main = 'north') =>
  Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, f === main ? { uv, uv_size } : { uv: side, uv_size: [1, 1] }]));
function geometry(/** @type {boolean} */ daughter) {
  const aw = daughter ? 3 : 4;
  return {
    description: { identifier: `geometry.minepreggo.grown_${daughter ? 'daughter' : 'son'}`, texture_width: 64, texture_height: 64, visible_bounds_width: 2, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] },
    bones: [
      { name: 'root', pivot: [0, 0, 0] },
      { name: 'waist', parent: 'root', pivot: [0, 12, 0] },
      { name: 'body', parent: 'waist', pivot: [0, 24, 0], cubes: [cube([-4, 12, -2], [8, 12, 4], [16, 16])] },
      { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [0, 0])] },
      { name: 'hat', parent: 'head', pivot: [0, 24, 0], cubes: [cube([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)] },
      { name: 'rightArm', parent: 'body', pivot: [-5, daughter ? 21.5 : 22, 0], cubes: [cube([-4 - aw, 12, -2], [aw, 12, 4], [40, 16])] },
      { name: 'rightItem', parent: 'rightArm', pivot: [-6, 15, 1] },
      { name: 'leftArm', parent: 'body', pivot: [5, daughter ? 21.5 : 22, 0], cubes: [cube([4, 12, -2], [aw, 12, 4], [32, 48])] },
      { name: 'rightLeg', parent: 'root', pivot: [-1.9, 12, 0], cubes: [cube([-3.9, 0, -2], [4, 12, 4], [0, 16])] },
      { name: 'leftLeg', parent: 'root', pivot: [1.9, 12, 0], cubes: [cube([-0.1, 0, -2], [4, 12, 4], [16, 48])] },
      // a grown daughter: a bust in her shirt and her hair down her back
      ...(daughter
        ? [
            { name: 'bust', parent: 'body', pivot: [0, 20, -2], rotation: [-8, 0, 0], cubes: [{ origin: [-3.5, 18.5, -3.6], size: [7, 3.2, 1.6], uv: faces([20.5, 22.5], [7, 3], [22, 23]) }] },
            { name: 'hair', parent: 'head', pivot: [0, 24, 0], cubes: [{ origin: [-4, 15, 3.6], size: [8, 9, 0.9], uv: faces([56, 8], [8, 8], [57, 9], 'south') }] },
          ]
        : []),
    ],
  };
}
json(join(RP, 'models/entity/grown_child.geo.json'), { format_version: '1.12.0', 'minecraft:geometry': [geometry(false), geometry(true)] });

json(join(RP, 'render_controllers/grown_child.render_controllers.json'), {
  format_version: '1.10.0',
  render_controllers: {
    'controller.render.minepreggo.grown_child': {
      arrays: { textures: { 'Array.skins': skins.map((_, i) => `Texture.s${i}`) } },
      geometry: "q.property('minepreggo:daughter') ? Geometry.daughter : Geometry.son",
      materials: [{ '*': 'Material.default' }],
      textures: ["Array.skins[q.property('minepreggo:line') * 2 + (q.property('minepreggo:daughter') ? 1 : 0)]"],
    },
  },
});

const A = 'animation.minepreggo.grown_child';
json(join(RP, 'animations/grown_child.animation.json'), {
  format_version: '1.8.0',
  animations: {
    [`${A}.move`]: { loop: true, bones: {
      rightArm: { rotation: ['-v.swing * 0.8', 0, 0] }, leftArm: { rotation: ['v.swing * 0.8', 0, 0] },
      rightLeg: { rotation: ['v.swing * 1.4', 0, 0] }, leftLeg: { rotation: ['-v.swing * 1.4', 0, 0] },
    } },
    [`${A}.look`]: { loop: true, bones: { head: { rotation: ['q.target_x_rotation', 'q.target_y_rotation', 0] } } },
    [`${A}.idle`]: { loop: true, bones: { rightArm: { rotation: [0, 0, 'math.cos(q.life_time * 115) * 2.5 + 2.5'] }, leftArm: { rotation: [0, 0, '-math.cos(q.life_time * 115) * 2.5 - 2.5'] } } },
    [`${A}.attack`]: { loop: true, bones: { rightArm: { rotation: ['-math.sin(v.attack_time * 180) * 110 - 10', 'math.sin(v.attack_time * 180) * 20', 0] }, body: { rotation: [0, 'math.sin(math.sqrt(v.attack_time) * 360) * 10', 0] } } },
    [`${A}.sit`]: { loop: true, bones: {
      root: { position: [0, -10, 0] },
      rightLeg: { rotation: [-88, 12, 0] }, leftLeg: { rotation: [-88, -12, 0] },
      rightArm: { rotation: [-32, 0, 4] }, leftArm: { rotation: [-32, 0, -4] },
    } },
  },
});

json(join(RP, 'entity/children/grown_child.entity.json'), {
  format_version: '1.10.0',
  'minecraft:client_entity': {
    description: {
      identifier: 'minepreggo:grown_child',
      materials: { default: 'entity_alphatest' },
      textures: Object.fromEntries(skins.map((file, i) => [`s${i}`, file])),
      geometry: { son: 'geometry.minepreggo.grown_son', daughter: 'geometry.minepreggo.grown_daughter' },
      animations: { move: `${A}.move`, look: `${A}.look`, idle: `${A}.idle`, attack: `${A}.attack`, sit: `${A}.sit` },
      scripts: {
        pre_animation: ['v.swing = math.cos(q.modified_distance_moved * 38.17) * math.min(q.modified_move_speed, 1.0) * 57.3;'],
        animate: ['look', 'idle', { move: '!q.is_sitting' }, { attack: 'v.attack_time > 0.0' }, { sit: 'q.is_sitting' }],
      },
      render_controllers: ['controller.render.minepreggo.grown_child'],
      enable_attachables: true,
      spawn_egg: { base_color: '#5d8ac9', overlay_color: '#f2c9a5' },
    },
  },
});

json(join(BP, 'loot_tables/entities/grown_child_gear.json'), { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'minecraft:iron_sword', weight: 1 }] }] });

const hostile = { all_of: [
  { test: 'is_family', subject: 'other', value: 'monster' },
  { test: 'is_family', subject: 'other', operator: '!=', value: 'creeper' },
  { test: 'has_tag', subject: 'other', operator: '!=', value: 'minepreggo_preggo_mob' },
  { test: 'is_family', subject: 'other', operator: '!=', value: 'minepreggo_child' },
] };
const food = [['bread', 6], ['cooked_beef', 8], ['cooked_porkchop', 8], ['cooked_chicken', 6], ['cooked_mutton', 6], ['baked_potato', 5], ['golden_apple', 20], ['apple', 4], ['cookie', 2]];
json(join(BP, 'entities/children/grown_child.json'), {
  format_version: '1.21.40',
  'minecraft:entity': {
    description: {
      identifier: 'minepreggo:grown_child', is_spawnable: true, is_summonable: true,
      properties: {
        'minepreggo:line': { type: 'int', range: [0, 63], default: 0, client_sync: true },
        'minepreggo:daughter': { type: 'bool', default: false, client_sync: true },
      },
    },
    component_groups: {
      'minepreggo:tamed': {
        'minecraft:is_tamed': {},
        'minecraft:sittable': {},
        'minecraft:behavior.stay_while_sitting': { priority: 3 },
        'minecraft:behavior.owner_hurt_by_target': { priority: 1 },
        'minecraft:behavior.owner_hurt_target': { priority: 2 },
        'minecraft:behavior.follow_owner': { priority: 5, speed_multiplier: 1.15, start_distance: 9, stop_distance: 3 },
      },
    },
    components: {
      'minecraft:type_family': { family: ['minepreggo_child', 'mob'] },
      'minecraft:health': { value: 40, max: 40 },
      'minecraft:attack': { damage: 5 },
      'minecraft:movement': { value: 0.32 },
      'minecraft:navigation.walk': { can_path_over_water: true, can_open_doors: true, can_pass_doors: true, avoid_damage_blocks: true, avoid_water: true },
      'minecraft:movement.basic': {},
      'minecraft:jump.static': {},
      'minecraft:can_climb': {},
      'minecraft:collision_box': { width: 0.6, height: 1.8 },
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
      'minecraft:nameable': { always_show: true, allow_name_tag_renaming: true },
      'minecraft:persistent': {},
      'minecraft:experience_reward': { on_death: '0' },
      'minecraft:tameable': { probability: 1.0, tame_items: 'minecraft:golden_apple', tame_event: { event: 'minepreggo:tamed', target: 'self' } },
      'minecraft:healable': { items: food.map(([item, heal]) => ({ item: `minecraft:${item}`, heal_amount: heal })) },
      'minecraft:equipment': { table: 'loot_tables/entities/grown_child_gear.json', slot_drop_chance: [{ slot: 'slot.weapon.mainhand', drop_chance: 0.0 }] },
      'minecraft:damage_sensor': { triggers: [
        { on_damage: { filters: { test: 'is_owner', subject: 'other' } }, deals_damage: 'no' },
        { cause: 'fall', damage_multiplier: 0.5 },
      ] },
      'minecraft:behavior.float': { priority: 0 },
      'minecraft:behavior.hurt_by_target': { priority: 1, entity_types: { filters: { test: 'is_family', subject: 'other', operator: '!=', value: 'player' } } },
      'minecraft:behavior.melee_attack': { priority: 2, speed_multiplier: 1.25, track_target: true },
      'minecraft:behavior.nearest_attackable_target': { priority: 3, must_see: true, reselect_targets: true, within_radius: 16, entity_types: [{ filters: hostile, max_dist: 16 }] },
      'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.8 },
      'minecraft:behavior.look_at_player': { priority: 8, look_distance: 8, probability: 0.02 },
      'minecraft:behavior.random_look_around': { priority: 9 },
    },
    events: { 'minepreggo:tamed': { add: { component_groups: ['minepreggo:tamed'] } } },
  },
});

// ---- their names, in every language (tools/lang carries them into the next import) --------------------
const LANG = [
  'entity.minepreggo:grown_child.name=Grown Child',
  'item.spawn_egg.entity.minepreggo:grown_child.name=Grown Child Spawn Egg',
  'minepreggo.child.too_young=Your baby is too young to grow up yet: about %s more minutes.',
  'minepreggo.child.son=%s, your son, has grown up! He follows you and fights at your side. Use him to tell him to stay or follow, feed him to heal him.',
  'minepreggo.child.daughter=%s, your daughter, has grown up! She follows you and fights at your side. Use her to tell her to stay or follow, feed her to heal her.',
  ...names,
];
const HEADER = '## Babies and grown children (tools/gen/children.mjs)';
function withLines(/** @type {string} */ text) {
  const cut = text.indexOf(HEADER);
  const base = cut >= 0 ? text.slice(0, cut).replace(/\n*$/, '\n') : text.replace(/\n*$/, '\n');
  const rest = cut >= 0 ? text.slice(cut).split('\n').slice(1) : [];
  const after = rest.findIndex((l) => l.startsWith('## '));
  return base + [HEADER, ...LANG].join('\n') + '\n' + (after >= 0 ? rest.slice(after).join('\n') : '');
}
writeFileSync(join(ROOT, 'tools/lang/en_US.lang'), withLines(readFileSync(join(ROOT, 'tools/lang/en_US.lang'), 'utf8')));
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  writeFileSync(join(RP, 'texts', file), withLines(readFileSync(join(RP, 'texts', file), 'utf8')));
}
console.log(`children: ${names.length} baby items, ${skins.length} skins`);
