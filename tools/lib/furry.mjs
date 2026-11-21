// Furry girls of our own (a wolf, a fox, a cat and a husky): the Pokémon girls' curvy body
// (tools/lib/pokemon.mjs) with an animal's head (a muzzle and nose, her ears, cheek fluff, a fringe of
// hair), her fur's markings and her tail, a bikini or a top and shorts. Their babies' kicks press out
// of the belly as paw prints and puppy heads (the cat's: kitten heads) instead of bumps
// (tools/import-jenny-preggo.mjs withMarks). Made at import time like the others.
import { builder, curvyBody, solid, bands, front, over, bikini } from './pokemon.mjs';

/** @typedef {number[]} Colour */
/** @typedef {(face: string, x: number, y: number, i: number, j: number) => Colour | undefined} Paint */

/**
 * Her head: fur above, her light fur on her lower face and muzzle, eyes with dark lids, a nose, her ears
 * (tall and pointed, or a cat's), cheek fluff, and a fringe and back of hair.
 * @param {ReturnType<typeof builder>} b
 * @param {{ fur: Colour, light: Colour, eye: Colour, nose: Colour, inner: Colour, hair: Colour, tip?: Colour, ears: 'tall' | 'cat', snout: number, cheeks: boolean }} o
 */
function animalHead(b, o) {
  const K = [28, 24, 26], W = [250, 250, 250];
  b.bone('head', undefined, [0, 26.5, 0]);
  const eyes = /** @type {Record<string, Colour>} */ ({ '1,3': W, '2,3': o.eye, '4,3': o.eye, '5,3': W, '1,2': K, '2,2': K, '4,2': K, '5,2': K });
  b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], (f, x, y, i, j) =>
    f === 'north' ? eyes[`${i},${j}`] ?? (j >= 4 ? o.light : o.fur) : f === 'down' ? o.light : (f === 'east' || f === 'west') && y > 0.6 && x < 0.5 ? o.light : o.fur);
  // her muzzle and nose
  const len = o.snout;
  b.cube('head', [-1.6, 27.2, -3.5 - len], [3.2, 2.2, len], (f, x, y) => (f === 'up' && y < 0.4 ? o.nose : f === 'north' && y < 0.4 && Math.abs(x - 0.5) < 0.25 ? o.nose : o.light));
  // her ears
  for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
    b.bone(`ear_${side}`, 'head', [s * 2.3, 34, 0], [0, 0, s * (o.ears === 'cat' ? -14 : -8)]);
    const tall = o.ears === 'tall';
    const inner = /** @type {Paint} */ ((f, x2) => (f === 'north' && x2 > 0.25 && x2 < 0.75 ? o.inner : o.fur));
    b.cube(`ear_${side}`, [s * 2.3 - 1.3, 34, -0.6], [2.6, tall ? 2.6 : 1.8, 1.2], inner);
    b.cube(`ear_${side}`, [s * 2.3 - 0.75, tall ? 36.6 : 35.8, -0.4], [1.5, tall ? 2 : 1.2, 0.8], o.tip ? solid(o.tip) : inner);
  }
  // cheek fluff, and her hair: a fringe and down the back of her head
  if (o.cheeks) for (const s of [-1, 1]) b.cube('head', [s < 0 ? -4.6 : 3.5, 27, -2.2], [1.1, 2.6, 3.4], solid(o.light));
  b.cube('head', [-3.7, 32.2, -3.8], [7.4, 2.2, 1], solid(o.hair));
  b.cube('head', [-3.7, 33.6, -3.6], [7.4, 0.8, 7.2], solid(o.hair));
  b.cube('head', [-3.6, 26.8, 3.4], [7.2, 6.8, 0.9], solid(o.hair));
}
/** A bushy tail from the small of her back (a cat's thin and long), its last part another colour. */
function tail(/** @type {ReturnType<typeof builder>} */ b, /** @type {Colour} */ fur, /** @type {Colour} */ tip, /** @type {number} */ turn, cat = false) {
  b.bone('tail', 'body', [0, 15.5, 2.6], [turn, 0, 0]);
  if (cat) {
    b.cube('tail', [-0.6, 8, 2], [1.2, 7.5, 1.2], solid(fur));
    b.bone('tail_tip', 'tail', [0, 8, 2.6], [-40, 0, 0]);
    b.cube('tail_tip', [-0.6, 1.5, 2], [1.2, 6.5, 1.2], bands(fur, tip, 0.7));
    return;
  }
  b.cube('tail', [-1.5, 9.5, 1.8], [3, 6, 3], solid(fur));
  b.bone('tail_tip', 'tail', [0, 9.5, 3.3], [-18, 0, 0]);
  b.cube('tail_tip', [-2.2, 1.5, 2.2], [4.4, 8, 4.4], bands(fur, tip, 0.62));
}
/** A top over her bust and shorts low on her hips and the tops of her thighs. */
const topAndShorts = (/** @type {Colour} */ top, /** @type {Colour} */ shorts, /** @type {Paint} */ chest, /** @type {Paint} */ hips, /** @type {Paint} */ thigh) => ({
  bust: solid(top), chest: over(chest, top, (face, _x, y) => face !== 'up' && y > 0.18),
  hips: over(hips, shorts, (face, x, y) => face !== 'up' && (face !== 'north' || y > 0.35 || Math.abs(x - 0.5) > 0.32)),
  thigh: over(thigh, shorts, (face, _x, y) => face !== 'down' && y < 0.4),
});

// ---- the wolf: grey, her front, muzzle and cheeks pale, silver hair, amber eyes; a black bikini ----------
function wolf() {
  const F = [126, 128, 140], L = [232, 232, 238], H = [204, 208, 220];
  const b = builder('wolf_girl');
  const chest = front(L, F), hips = solid(F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: solid(F), thigh: solid(F), calf: solid(F), foot: solid([96, 98, 108]) },
    bikini([36, 36, 40], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [232, 168, 40], nose: [30, 28, 32], inner: [214, 170, 176], hair: H, ears: 'tall', snout: 2.6, cheeks: true });
  tail(b, F, L, 30);
  return [b.done()];
}
// ---- the fox: orange, white front and muzzle, black stockings and gloves, black ear tips, a white tail
// tip, green eyes; a white top and denim shorts ---------------------------------------------------------------
function fox() {
  const F = [234, 120, 42], L = [248, 242, 234], K = [48, 38, 36];
  const b = builder('fox_girl');
  const chest = front(L, F), hips = solid(F), thigh = solid(F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: solid(K), thigh, calf: solid(K), foot: solid(K) },
    topAndShorts([246, 246, 248], [92, 130, 190], chest, hips, thigh));
  animalHead(b, { fur: F, light: L, eye: [92, 196, 96], nose: [36, 28, 28], inner: [248, 236, 226], hair: [214, 84, 40], tip: K, ears: 'tall', snout: 2.4, cheeks: true });
  tail(b, F, L, 48);
  return [b.done()];
}
// ---- the cat: a ginger tabby, cream front and muzzle, green eyes, a long thin tail; a pink bikini ----------
function cat() {
  const F = [238, 152, 72], D = [198, 104, 40], L = [250, 238, 222];
  const striped = /** @type {Paint} */ ((face, _x, y) => (face !== 'north' && face !== 'up' && face !== 'down' && Math.floor(y * 7) % 2 === 0 ? D : F));
  const b = builder('cat_girl');
  const chest = front(L, F), hips = striped;
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: striped, forearm: striped, thigh: striped, calf: solid(F), foot: solid(L) },
    bikini([240, 112, 164], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [110, 200, 90], nose: [236, 140, 150], inner: [244, 176, 184], hair: [214, 110, 50], ears: 'cat', snout: 1.2, cheeks: false });
  tail(b, F, D, 25, true);
  return [b.done()];
}
// ---- the husky: dark grey above, white face mask, front and legs, ice-blue eyes, her tail curled up her
// back; a red bikini ------------------------------------------------------------------------------------------
function husky() {
  const F = [72, 76, 90], L = [240, 242, 246];
  const b = builder('husky_girl');
  const chest = front(L, F), hips = solid(F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: solid(L), thigh: front(L, F), calf: solid(L), foot: solid(L) },
    bikini([210, 50, 62], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [96, 180, 244], nose: [28, 28, 32], inner: [226, 186, 190], hair: [222, 226, 236], ears: 'tall', snout: 2.6, cheeks: true });
  tail(b, F, L, 150);
  return [b.done()];
}

/** The furry girls (tools/import-jenny-preggo.mjs), each with her kicks' marks. */
export const FURRY = [
  { made: wolf, key: 'wolf_girl', name: 'Wolf Girl', birth: 'fapcraft:jenny', marks: 'puppy',
    kicks: { name: 'jp_wolf', order: [0, 2, 4, 1, 3], rate: 1.2, emphasis: [1.3, 1.1, 1.2, 1.0, 1.1] },
    treats: ['minecraft:bone', 'minecraft:cooked_beef', 'minecraft:cake'], biomes: ['taiga', 'forest', 'extreme_hills'], egg: { base_color: '#7e808c', overlay_color: '#e8e8ee' },
    curves: 'thick', navel: true, clothes: true, tone: [232, 232, 238], grow: 1.2 },
  { made: fox, key: 'fox_girl', name: 'Fox Girl', birth: 'kum:luna', marks: 'puppy',
    kicks: { name: 'jp_fox', order: [3, 0, 1, 4, 2], rate: 1.15, emphasis: [1.1, 1.3, 1.0, 1.2, 1.0] },
    treats: ['minecraft:sweet_berries', 'minecraft:cooked_chicken', 'minecraft:cake'], biomes: ['taiga', 'forest'], egg: { base_color: '#ea782a', overlay_color: '#f8f2ea' },
    curves: 'thick', navel: true, clothes: true, tone: [248, 242, 234], grow: 1.2 },
  { made: cat, key: 'cat_girl', name: 'Cat Girl', birth: 'kum:bia', marks: 'kitten',
    kicks: { name: 'jp_cat', order: [1, 3, 0, 2, 4], rate: 1.0, emphasis: [1.0, 1.2, 1.1, 0.9, 1.3] },
    treats: ['minecraft:cod', 'minecraft:salmon', 'minecraft:cake'], biomes: ['plains', 'forest', 'jungle'], egg: { base_color: '#ee9848', overlay_color: '#faeede' },
    curves: 'thick', navel: true, clothes: true, tone: [250, 238, 222], grow: 1.2 },
  { made: husky, key: 'husky_girl', name: 'Husky Girl', birth: 'girlmob:standing', marks: 'puppy',
    kicks: { name: 'jp_husky', order: [4, 1, 3, 0, 2], rate: 1.25, emphasis: [1.2, 1.0, 1.3, 1.1, 1.0] },
    treats: ['minecraft:bone', 'minecraft:cooked_mutton', 'minecraft:cake'], biomes: ['frozen', 'cold', 'taiga'], egg: { base_color: '#484c5a', overlay_color: '#f0f2f6' },
    curves: 'thick', navel: true, clothes: true, tone: [240, 242, 246], grow: 1.2 },
];
