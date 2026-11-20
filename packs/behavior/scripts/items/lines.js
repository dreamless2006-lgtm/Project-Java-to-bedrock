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
];

/** A baby's line: by its item exactly, else by the kind its id names, else a human's. */
export function lineOf(/** @type {string} */ typeId) {
  const item = typeId.replace(/^minepreggo:baby_/, '');
  const exact = LINES.findIndex((l) => l.item === item);
  if (exact >= 0) return exact;
  const kind = LINES.findIndex((l) => l.kind && item.includes(l.item));
  return kind >= 0 ? kind : 0;
}
