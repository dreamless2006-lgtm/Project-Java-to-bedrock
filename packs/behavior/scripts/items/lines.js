// The babies' lines: whose baby an item is, and how her child looks grown up (the colours of the
// child's skin, made by tools/gen/children.mjs, and of the baby's icon). Plain data: the scripts read
// it (items/children.js) and so does the generator.

/**
 * @typedef {object} Line
 * @property {string} item the baby item's id after minepreggo:baby_
 * @property {string} name whose child (Daisy's Child)
 * @property {number[]} skin @property {number[]} hair @property {number[]} shirt @property {number[]} trim
 * @property {boolean} [kind] one of Minepreggo's own kinds, matched by the kind a baby's id names
 * @property {boolean} [made] its baby item is made by tools/gen/children.mjs (the others come with their mother's import)
 */

/** @type {Line[]} the first is everyone's fallback (a human child) */
export const LINES = [
  { item: 'human', name: 'Human', skin: [232, 190, 160], hair: [110, 80, 60], shirt: [70, 110, 170], trim: [40, 70, 120] },
  { item: 'molten', name: 'Molten', skin: [236, 168, 120], hair: [222, 82, 34], shirt: [60, 50, 50], trim: [230, 120, 40], made: true },
  { item: 'daisy', name: 'Daisy', skin: [244, 208, 176], hair: [250, 226, 120], shirt: [236, 200, 90], trim: [120, 170, 80], made: true },
  { item: 'oxy', name: 'Oxy', skin: [236, 202, 178], hair: [92, 160, 228], shirt: [60, 110, 180], trim: [200, 220, 240], made: true },
  { item: 'stella', name: 'Stella', skin: [242, 196, 206], hair: [248, 150, 192], shirt: [236, 236, 240], trim: [200, 120, 200], made: true },
  { item: 'enny', name: 'Enny', skin: [232, 198, 172], hair: [42, 42, 52], shirt: [40, 40, 48], trim: [170, 90, 200], made: true },
  { item: 'skelly', name: 'Skelly', skin: [226, 226, 214], hair: [184, 184, 194], shirt: [80, 80, 90], trim: [200, 200, 190], made: true },
  { item: 'jenny_zombie_girl', name: "Jenny's Zombie Girl", skin: [112, 172, 104], hair: [44, 120, 110], shirt: [60, 140, 150], trim: [40, 70, 120], made: true },
  { item: 'jenny_creeper_girl', name: "Jenny's Creeper Girl", skin: [238, 206, 178], hair: [226, 120, 40], shirt: [70, 170, 70], trim: [30, 30, 30], made: true },
  { item: 'jenny_slime_girl', name: "Jenny's Slime Girl", skin: [140, 220, 120], hair: [90, 180, 80], shirt: [110, 200, 100], trim: [60, 140, 60], made: true },
  { item: 'jenny_ender_woman', name: "Jenny's Ender Woman", skin: [44, 38, 54], hair: [22, 22, 28], shirt: [30, 26, 36], trim: [200, 100, 240], made: true },
  { item: 'jenny_monster_creeper_girl', name: "Jenny's Monster Creeper Girl", skin: [96, 196, 92], hair: [40, 120, 40], shirt: [36, 36, 42], trim: [250, 110, 170], made: true },
  { item: 'goblin_girl', name: 'Goblin Girl', skin: [124, 172, 92], hair: [62, 42, 30], shirt: [120, 90, 60], trim: [80, 60, 40], made: true },
  { item: 'imp_girl', name: 'Imp Girl', skin: [204, 84, 82], hair: [52, 22, 22], shirt: [60, 30, 30], trim: [240, 160, 60], made: true },
  { item: 'bloatberry_girl', name: 'Bloatberry Girl', skin: [222, 152, 202], hair: [120, 60, 140], shirt: [160, 80, 170], trim: [90, 180, 90], made: true },
  { item: 'villager_woman', name: 'Villager', skin: [232, 192, 162], hair: [112, 82, 60], shirt: [140, 100, 70], trim: [90, 60, 40], made: true },
  { item: 'girl_mob', name: 'Mob Girl', skin: [240, 202, 182], hair: [200, 120, 172], shirt: [220, 120, 160], trim: [120, 60, 100], made: true },
  { item: 'world_alliance', name: 'Alliance Woman', skin: [226, 186, 152], hair: [92, 72, 52], shirt: [160, 50, 50], trim: [230, 200, 80], made: true },
  // the babies of Minepreggo's own kinds, by their kind
  { item: 'zombie', kind: true, name: 'Zombie Girl', skin: [112, 168, 100], hair: [50, 90, 50], shirt: [70, 110, 160], trim: [40, 60, 100] },
  { item: 'creeper', kind: true, name: 'Creeper Girl', skin: [120, 200, 110], hair: [40, 120, 40], shirt: [60, 150, 60], trim: [30, 30, 30] },
  { item: 'ender', kind: true, name: 'Ender Woman', skin: [44, 38, 54], hair: [22, 22, 28], shirt: [30, 26, 36], trim: [200, 100, 240] },
  { item: 'slime', kind: true, name: 'Slime Girl', skin: [140, 220, 120], hair: [90, 180, 80], shirt: [110, 200, 100], trim: [60, 140, 60] },
  // (new lines go last: a grown child keeps its line's number)
  { item: 'jenny_monster_slime_girl', name: "Jenny's Monster Slime Girl", skin: [118, 214, 110], hair: [70, 170, 70], shirt: [40, 36, 54], trim: [250, 110, 170], made: true },
  // the Jenny girls' babies (their items come with tools/import-jenny.mjs), in their mothers' colours
  { item: 'jenny', name: 'Jenny', skin: [240, 202, 172], hair: [150, 90, 50], shirt: [176, 150, 214], trim: [120, 92, 168] },
  { item: 'bia', name: 'Bia', skin: [236, 196, 170], hair: [70, 46, 34], shirt: [240, 170, 196], trim: [206, 112, 150] },
  { item: 'slime_girl', name: 'Slime', skin: [130, 214, 120], hair: [78, 160, 70], shirt: [110, 190, 100], trim: [60, 130, 56] },
  { item: 'luna', name: 'Luna', skin: [244, 214, 190], hair: [96, 72, 60], shirt: [244, 178, 112], trim: [200, 120, 60] },
  { item: 'galath', name: 'Galath', skin: [214, 170, 200], hair: [60, 30, 70], shirt: [150, 96, 168], trim: [92, 52, 110] },
  { item: 'allie', name: 'Allie', skin: [236, 200, 180], hair: [120, 210, 230], shirt: [120, 210, 230], trim: [60, 150, 186] },
  { item: 'manglelie', name: 'Manglelie', skin: [240, 230, 230], hair: [226, 226, 232], shirt: [200, 60, 70], trim: [170, 170, 184] },
  { item: 'bee', name: 'Bee', skin: [242, 210, 170], hair: [52, 40, 30], shirt: [246, 206, 64], trim: [52, 40, 30] },
  { item: 'kobold', name: 'Kobold', skin: [110, 190, 176], hair: [56, 128, 118], shirt: [90, 70, 50], trim: [56, 128, 118] },
  { item: 'ellie', name: 'Ellie', skin: [236, 206, 190], hair: [58, 52, 60], shirt: [58, 52, 60], trim: [190, 40, 52] },
  // the Pokémon girls' babies
  { item: 'gardevoir', name: 'Gardevoir', skin: [244, 244, 248], hair: [98, 214, 112], shirt: [244, 244, 248], trim: [226, 62, 76], made: true },
  { item: 'lucario', name: 'Lucario', skin: [238, 224, 182], hair: [38, 38, 46], shirt: [62, 138, 214], trim: [38, 38, 46], made: true },
  { item: 'lopunny', name: 'Lopunny', skin: [214, 170, 130], hair: [158, 104, 70], shirt: [158, 104, 70], trim: [246, 228, 172], made: true },
  // Pokédrock's Pokémon's babies (Minepreggo × Pokédrock)
  { item: 'blaziken', name: 'Blaziken', skin: [236, 120, 60], hair: [244, 226, 160], shirt: [210, 60, 40], trim: [244, 210, 90], made: true },
  { item: 'nidoqueen', name: 'Nidoqueen', skin: [228, 214, 170], hair: [100, 150, 190], shirt: [100, 150, 190], trim: [228, 214, 170], made: true },
  { item: 'greninja', name: 'Greninja', skin: [60, 90, 160], hair: [30, 40, 80], shirt: [60, 90, 160], trim: [230, 120, 160], made: true },
  { item: 'pokemon', name: 'Pokémon', skin: [236, 214, 180], hair: [200, 60, 60], shirt: [230, 60, 60], trim: [250, 250, 250], made: true },
  { item: 'lycanroc', name: 'Lycanroc', skin: [244, 238, 230], hair: [204, 44, 56], shirt: [206, 168, 128], trim: [250, 250, 250], made: true },
];

/** A baby's line: by its item exactly, else by the kind its id names, else a human's. */
export function lineOf(/** @type {string} */ typeId) {
  const item = typeId.replace(/^minepreggo:baby_/, '');
  const exact = LINES.findIndex((l) => l.item === item);
  if (exact >= 0) return exact;
  const kind = LINES.findIndex((l) => l.kind && item.includes(l.item));
  return kind >= 0 ? kind : 0;
}
