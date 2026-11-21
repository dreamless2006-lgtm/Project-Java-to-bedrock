// The kobold's egg (a kobold is a little dragon, and lays eggs: jenny/kobold_eggs.js): an item that
// places a clutch of up to four eggs, which crack over time and hatch into her baby item
// (blocks/kobold_egg.js). Everything here is drawn by this script, in the cream shell and teal
// speckles of the kobold's own egg. Run: node tools/gen/kobold-egg.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { blank, encodePng } from '../lib/png.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = `${ROOT}packs/resource/`;
const BP = `${ROOT}packs/behavior/`;
const SHELL = [255, 236, 177];
const SPOTS = [96, 170, 152];
const CRACK = [92, 70, 48];
const write = (/** @type {string} */ file, /** @type {unknown} */ doc) => writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** A 16x16 shell: a soft gradient with a few speckles, and `cracks` lines of cracks (0-2). */
function shell(/** @type {number} */ cracks) {
  const image = blank(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const shade = 1.04 - 0.22 * (((x - 6) / 8) ** 2 + ((y - 5) / 8) ** 2);
      const speckle = (x * 7 + y * 13) % 11 === 0 || (x * 5 + y * 3) % 17 === 0;
      const colour = speckle ? SPOTS : SHELL;
      image.data.set([...colour.map((v) => Math.max(0, Math.min(255, Math.round(v * shade)))), 255], (y * 16 + x) * 4);
    }
  }
  const lines = [
    [[3, 6], [5, 7], [6, 6], [8, 8], [10, 7], [12, 8]],
    [[4, 10], [6, 9], [7, 11], [9, 10], [11, 12], [13, 11]],
  ];
  for (const line of lines.slice(0, cracks)) {
    for (let i = 0; i < line.length - 1; i++) {
      const [[x0, y0], [x1, y1]] = [line[i], line[i + 1]];
      for (let t = 0; t <= 1; t += 0.1) image.data.set([...CRACK, 255], (Math.round(y0 + (y1 - y0) * t) * 16 + Math.round(x0 + (x1 - x0) * t)) * 4);
    }
  }
  return image;
}

/** The item icon: an egg on its own. */
function icon() {
  const image = blank(16, 16);
  for (let y = 1; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // an egg: wider below its middle, narrower on top
      const dy = (y - 9) / (y < 9 ? 7.5 : 6.2);
      const dx = (x - 7.5) / 5.4;
      if (dx * dx + dy * dy > 1) continue;
      const shade = 1.08 - 0.32 * ((dx + 0.35) ** 2 + (dy + 0.35) ** 2) / 2;
      const speckle = ((x * 7 + y * 13) % 11 === 0 || (x * 5 + y * 3) % 17 === 0) && dx * dx + dy * dy < 0.8;
      const colour = speckle ? SPOTS : SHELL;
      image.data.set([...colour.map((v) => Math.max(0, Math.min(255, Math.round(v * shade)))), 255], (y * 16 + x) * 4);
    }
  }
  return image;
}

for (const cracks of [0, 1, 2]) writeFileSync(`${RP}textures/port/kobold_egg_c${cracks}.png`, encodePng(shell(cracks)));
writeFileSync(`${RP}textures/port/kobold_egg.png`, encodePng(icon()));

// The clutch: four eggs (an oval of three boxes each), the later ones shown as the clutch grows.
const SPOTS_AT = [[-3.5, -3], [3, -2.5], [-2.5, 3.5], [3.5, 3]];
const egg = (/** @type {number} */ n) => {
  const [x, z] = SPOTS_AT[n];
  const box = (/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ y0) => ({ origin: [x - w / 2, y0, z - w / 2], size: [w, h, w], uv: [0, 0] });
  return { name: `egg${n + 1}`, pivot: [x, 0, z], cubes: [box(4, 4, 0.5), box(3, 5.5, 0), box(2, 6.5, 0)] };
};
write(`${RP}models/blocks/kobold_egg.geo.json`, {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.minepreggo.kobold_egg', texture_width: 16, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 1.5, visible_bounds_offset: [0, 0.5, 0] },
      bones: [0, 1, 2, 3].map(egg),
    },
  ],
});

const terrain = read(`${RP}textures/terrain_texture.json`);
for (const cracks of [0, 1, 2]) terrain.texture_data[`minepreggo_kobold_egg_c${cracks}`] = { textures: `textures/port/kobold_egg_c${cracks}` };
write(`${RP}textures/terrain_texture.json`, terrain);
const items = read(`${RP}textures/item_texture.json`);
items.texture_data.minepreggo_kobold_egg = { textures: 'textures/port/kobold_egg' };
write(`${RP}textures/item_texture.json`, items);

const material = (/** @type {number} */ cracks) => ({ '*': { texture: `minepreggo_kobold_egg_c${cracks}`, render_method: 'alpha_test' } });
write(`${BP}blocks/kobold_egg.json`, {
  format_version: '1.26.30',
  'minecraft:block': {
    description: {
      identifier: 'minepreggo:kobold_egg',
      menu_category: { category: 'none' },
      states: { 'minepreggo:eggs': { values: { min: 1, max: 4 } }, 'minepreggo:cracks': { values: { min: 0, max: 2 } } },
    },
    components: {
      'minepreggo:kobold_egg': {},
      'minecraft:display_name': 'item.minepreggo.kobold_egg',
      'minecraft:geometry': {
        identifier: 'geometry.minepreggo.kobold_egg',
        bone_visibility: { egg2: "q.block_state('minepreggo:eggs') >= 2", egg3: "q.block_state('minepreggo:eggs') >= 3", egg4: "q.block_state('minepreggo:eggs') >= 4" },
      },
      'minecraft:material_instances': material(0),
      'minecraft:collision_box': { origin: [-6, 0, -6], size: [12, 7, 12] },
      'minecraft:selection_box': { origin: [-6, 0, -6], size: [12, 7, 12] },
      'minecraft:destructible_by_mining': { seconds_to_destroy: 0.4 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 0.5 },
      'minecraft:light_dampening': 0,
      'minecraft:map_color': '#ffecb1',
      // the eggs drop from the script (one per egg in the clutch)
      'minecraft:loot': 'loot_tables/empty.json',
      // a chance to crack (or hatch) every minute (blocks/kobold_egg.js)
      'minecraft:tick': { interval_range: [1200, 1200], looping: true },
    },
    permutations: [1, 2].map((cracks) => ({ condition: `q.block_state('minepreggo:cracks') == ${cracks}`, components: { 'minecraft:material_instances': material(cracks) } })),
  },
});
write(`${BP}items/kobold_egg.json`, {
  format_version: '1.26.30',
  'minecraft:item': {
    description: { identifier: 'minepreggo:kobold_egg', menu_category: { category: 'items' } },
    components: {
      'minecraft:icon': 'minepreggo_kobold_egg',
      'minecraft:display_name': { value: 'item.minepreggo.kobold_egg' },
      'minecraft:max_stack_size': 16,
      'minecraft:block_placer': { block: 'minepreggo:kobold_egg', replace_block_item: true },
    },
  },
});
console.log('kobold egg: item, clutch block, model and textures');
