// Furry girls of our own: the Pokémon girls' curvy body (tools/lib/pokemon.mjs), painted at twice the
// detail, with an animal's head (anime eyes with lashes and a highlight, blush, her muzzle, ears or
// horns, cheek tufts, her hair), her kind's markings, a tail (and wings), and her outfit. Their babies'
// kicks press out of the belly as their kind's marks (tools/import-jenny-preggo.mjs withMarks): paw
// prints and puppy heads, kitten heads, hoof prints and lamb heads, claw prints and dragon heads, bird
// tracks and chick heads. All grown women. Made at import time like the others.
import { builder, curvyBody, solid, bands, front, over, bikini } from './pokemon.mjs';

/** @typedef {number[]} Colour */
/** @typedef {(face: string, x: number, y: number, i: number, j: number) => Colour | undefined} Paint */
/** @typedef {ReturnType<typeof builder>} Builder */

const RES = 2;
const W = [250, 250, 252], K = [22, 18, 22];
const mix = (/** @type {Colour} */ a, /** @type {Colour} */ b, /** @type {number} */ t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const shade = (/** @type {Colour} */ c, /** @type {number} */ k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

/**
 * Her face, on her head's front (14 x 14 at twice the detail): anime eyes (white, her iris with a dark
 * pupil and a highlight, a lash line with an outer flick), blush, her lower face lighter.
 * @param {{ fur: Colour, light: Colour, eye: Colour, skull?: boolean, mask?: Colour }} o
 */
function face(o) {
  return /** @type {Paint} */ ((f, x, y, i, j) => {
    if (f !== 'north') return f === 'down' ? o.light : (f === 'east' || f === 'west') && y > 0.62 && x < 0.55 ? o.light : o.fur;
    if (o.skull) {
      // a bone-white skull: dark sockets with glowing white points, a dark nose hole
      const socket = j >= 4 && j <= 8 && (i >= 2 && i <= 5 || i >= 8 && i <= 11);
      if (socket) return (j === 6 || j === 7) && (i === 4 || i === 9) ? W : [26, 16, 20];
      if (j >= 10 && j <= 11 && i >= 6 && i <= 7) return [26, 16, 20];
      return o.light;
    }
    for (const [c0, s] of /** @type {const} */ ([[2, -1], [8, 1]])) {
      const ci = i - c0;
      if (j === 4 && ci >= -1 && ci <= 4) return K;
      if (j === 5 && ((s < 0 && i === 1) || (s > 0 && i === 12))) return K;
      if (ci >= 0 && ci <= 3 && j >= 5 && j <= 8) {
        if (ci === 1 || ci === 2) {
          if (j === 5 && ci === (s < 0 ? 1 : 2)) return W;
          if ((j === 6 || j === 7) && ci === (s < 0 ? 2 : 1)) return shade(o.eye, 0.35);
          return j === 8 ? shade(o.eye, 0.75) : o.eye;
        }
        return j === 8 ? [214, 214, 222] : W;
      }
    }
    // (a raccoon's mask: a dark band across her eyes, pale between them)
    if (o.mask && j >= 3 && j <= 9) return i >= 6 && i <= 7 ? o.light : o.mask;
    const base = j >= 10 && i >= 3 && i <= 10 ? o.light : o.fur;
    if (j >= 9 && j <= 10 && (i >= 1 && i <= 3 || i >= 10 && i <= 12)) return mix(base, [244, 120, 150], 0.45);
    return base;
  });
}
/** Lumpy fluff (wool, a mane): brighter and dimmer puffs. */
const fluffy = (/** @type {Colour} */ c) => /** @type {Paint} */ ((_f, _x, _y, i, j) => (Math.sin(i * 1.7 + j * 0.9) + Math.cos(j * 1.3 - i * 0.6) > 0.9 ? shade(c, 0.9) : c));

/**
 * Her head: her face, a muzzle (or beak, or a skull's or a dragon's), ears or horns, cheek tufts, hair.
 * @param {Builder} b
 * @param {{ fur: Colour, light: Colour, eye: Colour, nose: Colour, inner: Colour, hair: Colour, tip?: Colour,
 *   muzzle: 'canine' | 'cat' | 'sheep' | 'beak' | 'skull' | 'dragon', ears: 'tall' | 'cat' | 'round' | 'floppy' | 'none',
 *   hairStyle: 'short' | 'long' | 'wool' | 'crest' | 'mane', tufts?: boolean, horns?: 'curl' | 'dragon', horn?: Colour, mask?: Colour }} o
 */
function animalHead(b, o) {
  b.bone('head', undefined, [0, 26.5, 0]);
  b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], face({ fur: o.fur, light: o.light, eye: o.eye, skull: o.muzzle === 'skull', mask: o.mask }));
  // her muzzle
  const nosed = (/** @type {Colour} */ c, /** @type {number} */ k = 0.4) => /** @type {Paint} */ ((f, x, y) => ((f === 'up' && y < k) || (f === 'north' && y < 0.4 && Math.abs(x - 0.5) < 0.24) ? o.nose : f === 'north' && y > 0.72 && Math.abs(x - 0.5) < 0.3 ? shade(c, 0.7) : c));
  if (o.muzzle === 'canine') b.cube('head', [-1.6, 27.2, -6.1], [3.2, 2.2, 2.6], nosed(o.light));
  else if (o.muzzle === 'cat') b.cube('head', [-1.4, 27.4, -4.6], [2.8, 1.8, 1.1], nosed(o.light, 0.6));
  else if (o.muzzle === 'sheep') b.cube('head', [-1.8, 27.2, -4.8], [3.6, 2.6, 1.3], nosed(o.light, 0.5));
  else if (o.muzzle === 'skull') b.cube('head', [-1.6, 27.2, -6], [3.2, 2.2, 2.5], (f, x, y) => (f === 'north' && y > 0.45 ? (Math.floor(x * 6) % 2 ? W : [30, 20, 24]) : f === 'up' && y < 0.35 ? [26, 16, 20] : o.light));
  else if (o.muzzle === 'dragon') b.cube('head', [-1.7, 27.2, -6.2], [3.4, 2.4, 2.7], (f, x, y) => (f === 'up' && y < 0.3 && Math.abs(x - 0.5) > 0.15 ? K : f === 'down' ? o.light : o.fur));
  else {
    b.cube('head', [-1.2, 28, -5.6], [2.4, 1.6, 2.1], solid(o.nose));
    b.cube('head', [-0.7, 28.2, -6.8], [1.4, 1.2, 1.2], solid(shade(o.nose, 0.85)));
  }
  // her ears
  for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
    const inner = /** @type {Paint} */ ((f, x2, y2) => (f === 'north' && x2 > 0.22 && x2 < 0.78 && y2 > 0.15 ? o.inner : o.fur));
    if (o.ears === 'tall' || o.ears === 'cat') {
      const tall = o.ears === 'tall';
      b.bone(`ear_${side}`, 'head', [s * 2.3, 34, 0], [0, 0, s * (tall ? -8 : -14)]);
      b.cube(`ear_${side}`, [s * 2.3 - 1.3, 34, -0.6], [2.6, tall ? 2.6 : 1.8, 1.2], inner);
      b.cube(`ear_${side}`, [s * 2.3 - 0.75, tall ? 36.6 : 35.8, -0.4], [1.5, tall ? 2 : 1.2, 0.8], o.tip ? solid(o.tip) : inner);
    } else if (o.ears === 'round') {
      b.bone(`ear_${side}`, 'head', [s * 2.4, 34, 0], [0, 0, s * -12]);
      b.cube(`ear_${side}`, [s * 2.4 - 1.3, 34, -0.5], [2.6, 2.2, 1], (f, x2, y2) => (f === 'north' && (x2 < 0.2 || x2 > 0.8 || y2 < 0.2) ? o.light : f === 'north' ? o.inner : o.fur));
    } else if (o.ears === 'floppy') {
      b.bone(`ear_${side}`, 'head', [s * 3.5, 32, 0], [0, 0, s * -22]);
      b.cube(`ear_${side}`, [s < 0 ? -6.6 : 3.5, 31.4, -1], [3.1, 1.2, 2], (f) => (f === 'down' ? o.inner : o.fur));
    }
  }
  // her horns
  // (out past her wool: curling forward and down by her cheeks)
  if (o.horns === 'curl') for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
    b.bone(`horn_${side}`, 'head', [s * 5, 32.8, 0.5]);
    b.cube(`horn_${side}`, [s < 0 ? -7 : 5.2, 31.8, -1], [1.8, 2, 2.8], solid(o.horn ?? K));
    b.cube(`horn_${side}`, [s < 0 ? -7.3 : 5.8, 29.6, -2.2], [1.5, 2.4, 1.6], solid(shade(o.horn ?? K, 0.85)));
    b.cube(`horn_${side}`, [s < 0 ? -6.9 : 5.6, 28.6, -3.4], [1.3, 1.4, 1.4], solid(shade(o.horn ?? K, 0.75)));
  }
  if (o.horns === 'dragon') for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
    b.bone(`horn_${side}`, 'head', [s * 2, 34, 1], [-38, 0, s * -12]);
    b.cube(`horn_${side}`, [s * 2 - 0.75, 34, 0.25], [1.5, 3.4, 1.5], solid(o.horn ?? W));
    b.cube(`horn_${side}`, [s * 2 - 0.45, 37.4, 0.55], [0.9, 2.2, 0.9], solid(shade(o.horn ?? W, 0.9)));
  }
  // cheek tufts
  if (o.tufts) for (const s of [-1, 1]) {
    b.cube('head', [s < 0 ? -4.5 : 3.5, 27.1, -2.2], [1, 2.4, 3.2], solid(o.light));
    b.cube('head', [s < 0 ? -4.9 : 3.9, 27.7, -1.6], [1, 1.2, 2], solid(o.light));
  }
  // her hair
  const H = solid(o.hair);
  if (o.hairStyle === 'wool') {
    const wool = fluffy(o.hair);
    b.cube('head', [-4.4, 32.6, -4.2], [8.8, 3.2, 8.6], wool);
    b.cube('head', [-3.8, 31.6, -4.6], [7.6, 1.8, 1.2], wool);
    for (const s of [-1, 1]) b.cube('head', [s < 0 ? -5.3 : 3.5, 26.6, -3], [1.8, 6, 6.6], wool);
    b.cube('head', [-4.4, 24.6, 3.2], [8.8, 8.4, 2], wool);
  } else if (o.hairStyle === 'crest') {
    b.bone('crest', 'head', [0, 34, 0], [-28, 0, 0]);
    b.cube('crest', [-0.6, 34, -1.4], [1.2, 4.4, 1.4], H);
    for (const x of [-1.8, 0.6]) b.cube('crest', [x, 33.8, -0.2], [1.2, 3.6, 1.2], H);
    b.cube('head', [-3.6, 32.8, -3.7], [7.2, 1.4, 7.4], H);
  } else {
    b.cube('head', [-3.7, 32.2, -3.8], [7.4, 2.2, 1], H);
    b.cube('head', [-3.7, 33.6, -3.6], [7.4, 0.8, 7.2], H);
    for (const s of [-1, 1]) b.cube('head', [s < 0 ? -3.95 : 3.05, 27.6, -3.4], [0.9, 5, 3], H);
    if (o.hairStyle === 'long') b.cube('head', [-3.7, 19.5, 3.3], [7.4, 14.5, 1.3], H);
    else if (o.hairStyle === 'mane') b.cube('head', [-4.2, 22, 3.2], [8.4, 11.5, 2.2], fluffy(o.hair));
    else b.cube('head', [-3.6, 26.8, 3.4], [7.2, 6.8, 0.9], H);
  }
}
/** Her tail, from the small of her back. */
function tail(/** @type {Builder} */ b, /** @type {'bushy' | 'ringed' | 'cat' | 'puff' | 'dragon' | 'fan'} */ kind, /** @type {Colour} */ fur, /** @type {Colour} */ tip, turn = 30) {
  b.bone('tail', 'body', [0, 15.5, 2.6], [turn, 0, 0]);
  if (kind === 'cat') {
    b.cube('tail', [-0.6, 8, 2], [1.2, 7.5, 1.2], solid(fur));
    b.bone('tail_tip', 'tail', [0, 8, 2.6], [-40, 0, 0]);
    b.cube('tail_tip', [-0.6, 1.5, 2], [1.2, 6.5, 1.2], bands(fur, tip, 0.7));
  } else if (kind === 'puff') {
    b.cube('tail', [-1.6, 13.6, 2.3], [3.2, 3, 2.4], fluffy(fur));
  } else if (kind === 'dragon') {
    const belly = /** @type {Paint} */ ((f, _x, y) => (f === 'north' ? (Math.floor(y * 6) % 2 ? tip : shade(tip, 0.88)) : fur));
    b.cube('tail', [-1.8, 8, 1.4], [3.6, 7.5, 3.4], belly);
    b.bone('tail_mid', 'tail', [0, 8, 3.1], [-22, 0, 0]);
    b.cube('tail_mid', [-1.3, 1.2, 1.8], [2.6, 7, 2.6], belly);
    b.bone('tail_tip', 'tail_mid', [0, 1.2, 3.1], [-18, 0, 0]);
    b.cube('tail_tip', [-0.8, -5, 2.3], [1.6, 6.4, 1.6], belly);
  } else if (kind === 'fan') {
    for (const [x, len] of [[-2.6, 8.5], [-0.8, 10], [1, 8.5]]) b.cube('tail', [x, 15.5 - len, 2.2], [1.6, len, 0.5], bands(fur, tip, 0.75));
  } else {
    const ringed = kind === 'ringed';
    b.cube('tail', [-1.5, 9.5, 1.8], [3, 6, 3], ringed ? (_f, _x, y) => (Math.floor(y * 3) % 2 ? tip : fur) : solid(fur));
    b.bone('tail_tip', 'tail', [0, 9.5, 3.3], [-18, 0, 0]);
    b.cube('tail_tip', [-2.2, 1.5, 2.2], [4.4, 8, 4.4], ringed ? (_f, _x, y) => (Math.floor(y * 4) % 2 ? tip : fur) : bands(fur, tip, 0.62));
  }
}
/** Wings from her upper back: a dragon's (bone and membrane) or feathered. */
function wings(/** @type {Builder} */ b, /** @type {'dragon' | 'feather'} */ kind, /** @type {Colour} */ main, /** @type {Colour} */ edge) {
  for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
    b.bone(`wing_${side}`, 'body', [s * 2, 24.5, 2], [6, s * 22, s * -16]);
    const x0 = (/** @type {number} */ w) => (s < 0 ? -2 - w : 2);
    if (kind === 'dragon') {
      b.cube(`wing_${side}`, [x0(10), 24, 1.6], [10, 1, 1], solid(edge));
      for (const [at, len] of [[3.4, 9], [6.6, 10], [9.6, 8]]) b.cube(`wing_${side}`, [s < 0 ? -2 - at - 0.4 : 2 + at - 0.4, 24 - len, 1.7], [0.8, len, 0.8], solid(edge));
      b.cube(`wing_${side}`, [x0(9.6), 15, 1.95], [9.6, 9, 0.4], solid(main));
    } else {
      b.cube(`wing_${side}`, [x0(11), 15, 2], [11, 10, 0.6], (_f, x, y) => (y > 0.7 ? edge : main));
      b.cube(`wing_${side}`, [x0(13), 11, 2.4], [13, 6, 0.6], (_f, x, y) => (y > 0.6 ? edge : main));
      b.cube(`wing_${side}`, [x0(8), 7.5, 2.8], [8, 5, 0.5], solid(edge));
    }
  }
}
/** Stockings: her calves, and her thighs below `from`. */
const stockings = (/** @type {Colour} */ c, /** @type {Paint} */ thigh, from = 0.45) => ({
  thigh: over(thigh, c, (f, _x, y) => f !== 'up' && y > from),
  calf: solid(c), foot: solid(c),
});
/** A top over her bust and chest, and shorts (or pants) on her hips and thighs. */
const topAndShorts = (/** @type {Colour} */ top, /** @type {Colour} */ shorts, /** @type {Paint} */ chest, /** @type {Paint} */ hips, /** @type {Paint} */ thigh, long = false) => ({
  bust: solid(top), chest: over(chest, top, (f, _x, y) => f !== 'up' && y > 0.16),
  hips: over(hips, shorts, (f, x, y) => f !== 'up' && (f !== 'north' || y > 0.35 || Math.abs(x - 0.5) > 0.32)),
  thigh: long ? solid(shorts) : over(thigh, shorts, (f, _x, y) => f !== 'down' && y < 0.42),
  ...(long ? { calf: solid(shorts) } : {}),
});
/** Talons: three toes forward at the front of each foot (and a dragon's claws). */
function toes(/** @type {Builder} */ b, /** @type {Colour} */ c, long = true) {
  for (const [leg, x] of /** @type {const} */ ([['right_leg', -3.6], ['left_leg', 0.6]])) {
    for (const dx of [0, 1.1, 2.2]) b.cube(leg, [x + dx, 0, long ? -4.2 : -3.2], [0.8, long ? 0.6 : 0.8, long ? 1.9 : 0.9], solid(c));
  }
}
/** A fluffy chest tuft at her collar. */
const tuft = (/** @type {Builder} */ b, /** @type {Colour} */ c) => b.cube('body', [-1.8, 25.1, -2.7], [3.6, 1.6, 0.9], fluffy(c));

// ---- the girls -------------------------------------------------------------------------------------------------
function wolf() {
  const F = [124, 126, 138], D = [92, 94, 106], L = [234, 234, 240];
  const b = builder('wolf_girl', RES);
  const back = (/** @type {Colour} */ c) => /** @type {Paint} */ ((f) => (f === 'north' ? L : f === 'south' ? D : c));
  const chest = back(F), hips = solid(F);
  curvyBody(b, { chest, waist: back(F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: bands(F, L, 0.75), thigh: front(mix(F, L, 0.35), F), calf: solid(F), foot: solid(D) },
    bikini([34, 34, 40], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [236, 172, 40], nose: [30, 28, 32], inner: [218, 172, 178], hair: [206, 210, 222], muzzle: 'canine', ears: 'tall', hairStyle: 'long', tufts: true });
  tuft(b, L);
  tail(b, 'bushy', F, L, 30);
  return [b.done()];
}
function fox() {
  const F = [236, 122, 44], L = [250, 244, 236], KS = [50, 38, 36];
  const b = builder('fox_girl', RES);
  const chest = front(L, F), hips = solid(F), thigh = solid(F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: bands(F, KS, 0.4), thigh, calf: solid(KS), foot: solid(KS) },
    { ...bikini([196, 30, 52], chest, hips), ...stockings([120, 60, 40], thigh, 0.55), calf: solid([120, 60, 40]) });
  animalHead(b, { fur: F, light: L, eye: [96, 200, 100], nose: [40, 30, 30], inner: [250, 236, 226], hair: [216, 88, 40], tip: KS, muzzle: 'canine', ears: 'tall', hairStyle: 'long', tufts: true });
  tuft(b, L);
  tail(b, 'bushy', F, L, 48);
  return [b.done()];
}
function cat() {
  const F = [238, 152, 72], D = [196, 102, 40], L = [250, 238, 222];
  const striped = /** @type {Paint} */ ((f, _x, y) => (f !== 'north' && f !== 'up' && f !== 'down' && Math.floor(y * 7) % 2 === 0 ? D : F));
  const b = builder('cat_girl', RES);
  const chest = front(L, F), hips = striped;
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: striped, forearm: striped, thigh: striped, calf: solid(F), foot: solid(L) },
    bikini([240, 112, 164], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [112, 204, 92], nose: [238, 140, 150], inner: [246, 178, 186], hair: [214, 110, 50], muzzle: 'cat', ears: 'cat', hairStyle: 'short' });
  tail(b, 'cat', F, D, 25);
  return [b.done()];
}
function husky() {
  const F = [70, 74, 90], L = [242, 244, 248];
  const b = builder('husky_girl', RES);
  const chest = front(L, F), hips = solid(F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(F), forearm: solid(L), thigh: front(L, F), calf: solid(L), foot: solid(L) },
    bikini([210, 48, 62], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [96, 184, 248], nose: [26, 26, 30], inner: [228, 188, 192], hair: [224, 228, 238], muzzle: 'canine', ears: 'tall', hairStyle: 'short', tufts: true });
  tuft(b, L);
  tail(b, 'bushy', F, L, 150);
  return [b.done()];
}
// the sheep: cream-pink skin, a big cloud of wool for hair, curled dark horns, floppy ears, wool at her
// wrists and ankles, dark hooves, a wool puff of a tail, a collar with a bell; a lavender bikini
function sheep() {
  const S = [250, 232, 222], Wo = [252, 248, 240], Ho = [70, 58, 58];
  const b = builder('sheep_girl', RES);
  const chest = solid(S), hips = solid(S);
  curvyBody(b, { chest, waist: solid(S), hips, bust: solid(S), neck: over(solid(S), [214, 150, 70], (f, _x, y) => f !== 'up' && f !== 'down' && y > 0.4), upperArm: solid(S), forearm: solid(S), thigh: solid(S), calf: solid(S), foot: solid(Ho) },
    bikini([196, 160, 230], chest, hips));
  animalHead(b, { fur: S, light: [252, 238, 230], eye: [110, 160, 236], nose: [232, 150, 140], inner: [246, 200, 196], hair: Wo, muzzle: 'sheep', ears: 'floppy', hairStyle: 'wool', horns: 'curl', horn: Ho });
  b.cube('body', [-0.5, 25.4, -2.4], [1, 1, 0.8], solid([246, 206, 72]));
  for (const [arm, x] of /** @type {const} */ ([['right_arm', -6.9], ['left_arm', 3.6]])) b.cube(arm, [x, 13.4, -1.6], [3.3, 2.6, 3.2], fluffy(Wo));
  for (const [leg, x] of /** @type {const} */ ([['right_leg', -4.3], ['left_leg', 0.1]])) b.cube(leg, [x, 2.6, -2.2], [4.2, 2.4, 4.2], fluffy(Wo));
  tail(b, 'puff', Wo, Wo, 0);
  return [b.done()];
}
// the raccoon: grey, a black mask across her eyes, white brows and muzzle, round ears rimmed white, dark
// hands and feet, a bushy ringed tail, long mauve hair; a black tank top and denim shorts
function raccoon() {
  const F = [132, 128, 136], L = [238, 236, 234], M = [40, 36, 42];
  const b = builder('raccoon_girl', RES);
  const chest = front(mix(F, L, 0.55), F), hips = solid(F), thigh = solid(F);
  curvyBody(b, { chest, waist: front(mix(F, L, 0.55), F), hips, bust: front(mix(F, L, 0.55), F), neck: solid(L), upperArm: solid(F), forearm: bands(F, M, 0.55), thigh, calf: solid(F), foot: solid(M) },
    topAndShorts([36, 34, 40], [96, 128, 176], chest, hips, thigh));
  animalHead(b, { fur: F, light: L, eye: [96, 170, 236], nose: [28, 24, 28], inner: [70, 64, 72], hair: [150, 94, 110], muzzle: 'canine', ears: 'round', hairStyle: 'long', tufts: true, mask: M });
  tuft(b, L);
  tail(b, 'ringed', F, M, 35);
  return [b.done()];
}
// the skull wolf: black fur, a bone-white skull for a face with glowing points for eyes and bared teeth,
// long black hair, claws; a red hoodie and red pants
function skullWolf() {
  const F = [36, 32, 38], B = [238, 230, 222], R = [214, 50, 48];
  const b = builder('skull_wolf_girl', RES);
  const chest = solid(F), hips = solid(F), thigh = solid(F);
  curvyBody(b, { chest, waist: solid(F), hips, bust: solid(F), neck: solid(F), upperArm: solid(F), forearm: solid(F), thigh, calf: solid(F), foot: solid(F) },
    { ...topAndShorts(R, R, chest, hips, thigh, true), waist: solid(R), upperArm: solid(R), forearm: bands(R, F, 0.7) });
  animalHead(b, { fur: F, light: B, eye: W, nose: K, inner: [70, 40, 50], hair: [24, 20, 26], muzzle: 'skull', ears: 'tall', hairStyle: 'long' });
  tail(b, 'bushy', F, [26, 22, 28], 28);
  return [b.done()];
}
// the dragon: dark scales with pale belly plates, glowing purple eyes, swept-back horns, purple sparkles on
// her thighs, wings of bone and dark membrane, a long tail pale beneath, claws; a purple bikini
function dragon() {
  const F = [48, 44, 58], P = [226, 220, 236], E = [204, 112, 244];
  const plates = /** @type {Paint} */ ((f, _x, y) => (f === 'north' ? (Math.floor(y * 5) % 2 ? P : shade(P, 0.9)) : F));
  const sparkle = /** @type {Paint} */ ((f, x, y) => (f === 'north' && Math.abs(x - 0.6) < 0.12 && Math.abs(y - 0.4) < 0.1 || f === 'west' && Math.abs(x - 0.4) < 0.1 && Math.abs(y - 0.55) < 0.08 ? [236, 200, 250] : F));
  const b = builder('dragon_girl', RES);
  const chest = plates, hips = solid(F);
  curvyBody(b, { chest, waist: plates, hips, bust: plates, neck: plates, upperArm: solid(F), forearm: solid(F), thigh: sparkle, calf: solid(F), foot: solid(F) },
    bikini([140, 70, 200], chest, hips));
  animalHead(b, { fur: F, light: P, eye: E, nose: K, inner: F, hair: F, muzzle: 'dragon', ears: 'none', hairStyle: 'short', horns: 'dragon', horn: [218, 214, 228] });
  wings(b, 'dragon', [76, 54, 100], [214, 208, 226]);
  tail(b, 'dragon', F, P, 52);
  toes(b, [222, 218, 230], false);
  return [b.done()];
}
// the harpy: pale gold feathers, long golden hair, great feathered wings, talons; black lingerie,
// stockings and gloves
function harpy() {
  const F = [250, 236, 206], G = [246, 214, 126], T = [90, 70, 50];
  const b = builder('harpy_girl', RES);
  const chest = solid(F), hips = solid(F), thigh = solid(F);
  curvyBody(b, { chest, waist: solid(F), hips, bust: solid(F), neck: solid(F), upperArm: solid(F), forearm: solid(F), thigh, calf: bands(F, [236, 176, 90], 0.55), foot: solid([236, 176, 90]) },
    { ...bikini([26, 24, 30], chest, hips), ...stockings([30, 28, 34], thigh, 0.4), forearm: solid([30, 28, 34]) });
  animalHead(b, { fur: F, light: [252, 244, 226], eye: [236, 150, 60], nose: [236, 176, 90], inner: F, hair: G, muzzle: 'beak', ears: 'none', hairStyle: 'long' });
  wings(b, 'feather', [252, 242, 220], [240, 210, 140]);
  tail(b, 'fan', F, G, 55);
  toes(b, T);
  return [b.done()];
}
// the bluebird: blue, a pale blue front, a dark blue crest and wing feathers along her arms, an orange
// beak and orange legs with talons, a fan of tail feathers; a yellow bikini
function bluebird() {
  const F = [58, 108, 204], L = [146, 204, 240], D = [36, 66, 156], O = [242, 152, 52];
  const b = builder('bluebird_girl', RES);
  const chest = front(L, F), hips = front(L, F);
  curvyBody(b, { chest, waist: front(L, F), hips, bust: front(L, F), neck: solid(L), upperArm: solid(D), forearm: solid(D), thigh: front(L, F), calf: solid(O), foot: solid(O) },
    bikini([248, 210, 60], chest, hips));
  animalHead(b, { fur: F, light: L, eye: [40, 30, 30], nose: O, inner: F, hair: D, muzzle: 'beak', ears: 'none', hairStyle: 'crest' });
  for (const [arm, x] of /** @type {const} */ ([['right_arm', -7.2], ['left_arm', 6.6]])) b.cube(arm, [x, 12.5, -1.6], [0.6, 11, 3.6], bands(D, L, 0.8));
  tail(b, 'fan', F, D, 62);
  toes(b, shade(O, 0.85));
  return [b.done()];
}

const girl = (/** @type {any} */ o) => ({ curves: 'thick', navel: true, clothes: true, grow: 1.2, ...o });
/** The furry girls (tools/import-jenny-preggo.mjs), each with her kicks' marks. */
export const FURRY = [
  girl({ made: wolf, key: 'wolf_girl', name: 'Wolf Girl', birth: 'fapcraft:jenny', marks: 'puppy', tone: [234, 234, 240],
    kicks: { name: 'jp_wolf', order: [0, 2, 4, 1, 3], rate: 1.2, emphasis: [1.3, 1.1, 1.2, 1.0, 1.1] },
    treats: ['minecraft:bone', 'minecraft:cooked_beef', 'minecraft:cake'], biomes: ['taiga', 'forest', 'extreme_hills'], egg: { base_color: '#7c7e8a', overlay_color: '#eaeaf0' } }),
  girl({ made: fox, key: 'fox_girl', name: 'Fox Girl', birth: 'kum:luna', marks: 'puppy', tone: [250, 244, 236],
    kicks: { name: 'jp_fox', order: [3, 0, 1, 4, 2], rate: 1.15, emphasis: [1.1, 1.3, 1.0, 1.2, 1.0] },
    treats: ['minecraft:sweet_berries', 'minecraft:cooked_chicken', 'minecraft:cake'], biomes: ['taiga', 'forest'], egg: { base_color: '#ec7a2c', overlay_color: '#faf4ec' } }),
  girl({ made: cat, key: 'cat_girl', name: 'Cat Girl', birth: 'kum:bia', marks: 'kitten', tone: [250, 238, 222],
    kicks: { name: 'jp_cat', order: [1, 3, 0, 2, 4], rate: 1.0, emphasis: [1.0, 1.2, 1.1, 0.9, 1.3] },
    treats: ['minecraft:cod', 'minecraft:salmon', 'minecraft:cake'], biomes: ['plains', 'forest', 'jungle'], egg: { base_color: '#ee9848', overlay_color: '#faeede' } }),
  girl({ made: husky, key: 'husky_girl', name: 'Husky Girl', birth: 'girlmob:standing', marks: 'puppy', tone: [242, 244, 248],
    kicks: { name: 'jp_husky', order: [4, 1, 3, 0, 2], rate: 1.25, emphasis: [1.2, 1.0, 1.3, 1.1, 1.0] },
    treats: ['minecraft:bone', 'minecraft:cooked_mutton', 'minecraft:cake'], biomes: ['frozen', 'cold', 'taiga'], egg: { base_color: '#464a5a', overlay_color: '#f2f4f8' } }),
  girl({ made: sheep, key: 'sheep_girl', name: 'Sheep Girl', birth: 'kum:bia', marks: 'lamb', tone: [250, 232, 222],
    kicks: { name: 'jp_sheep', order: [2, 4, 0, 3, 1], rate: 0.9, emphasis: [1.0, 1.1, 1.2, 0.9, 1.1] },
    treats: ['minecraft:wheat', 'minecraft:hay_block', 'minecraft:cake'], biomes: ['plains', 'meadow', 'extreme_hills'], egg: { base_color: '#fcf8f0', overlay_color: '#463a3a' } }),
  girl({ made: raccoon, key: 'raccoon_girl', name: 'Raccoon Girl', birth: 'kum:luna', marks: 'puppy', tone: [238, 236, 234],
    kicks: { name: 'jp_raccoon', order: [1, 0, 3, 2, 4], rate: 1.2, emphasis: [1.2, 1.0, 1.1, 1.3, 0.9] },
    treats: ['minecraft:sweet_berries', 'minecraft:cookie', 'minecraft:cake'], biomes: ['forest', 'swamp', 'plains'], egg: { base_color: '#848088', overlay_color: '#28242a' } }),
  girl({ made: skullWolf, key: 'skull_wolf_girl', name: 'Skull Wolf Girl', birth: 'girlmob:standing', marks: 'puppy', tone: [60, 54, 62],
    kicks: { name: 'jp_skull_wolf', order: [3, 4, 1, 0, 2], rate: 1.35, emphasis: [1.4, 1.2, 1.1, 1.3, 1.0] },
    treats: ['minecraft:bone', 'minecraft:rotten_flesh', 'minecraft:cake'], biomes: ['taiga', 'roofed', 'extreme_hills'], egg: { base_color: '#242026', overlay_color: '#eee6de' } }),
  girl({ made: dragon, key: 'dragon_girl', name: 'Dragon Girl', birth: 'fapcraft:jenny', marks: 'dragon', tone: [226, 220, 236],
    kicks: { name: 'jp_dragon', order: [0, 4, 2, 1, 3], rate: 1.1, emphasis: [1.4, 1.1, 1.3, 1.0, 1.2] },
    treats: ['minecraft:chorus_fruit', 'minecraft:golden_apple', 'minecraft:cake'], biomes: ['the_end', 'extreme_hills', 'mesa'], egg: { base_color: '#302c3a', overlay_color: '#cc70f4' } }),
  girl({ made: harpy, key: 'harpy_girl', name: 'Harpy Girl', birth: 'kum:luna', marks: 'chick', tone: [250, 236, 206],
    kicks: { name: 'jp_harpy', order: [4, 2, 0, 1, 3], rate: 1.05, emphasis: [1.0, 1.2, 1.1, 1.3, 0.9] },
    treats: ['minecraft:wheat_seeds', 'minecraft:melon_slice', 'minecraft:cake'], biomes: ['extreme_hills', 'meadow', 'savanna'], egg: { base_color: '#faecce', overlay_color: '#f6d67e' } }),
  girl({ made: bluebird, key: 'bluebird_girl', name: 'Bluebird Girl', birth: 'kum:bia', marks: 'chick', tone: [146, 204, 240],
    kicks: { name: 'jp_bluebird', order: [2, 1, 4, 3, 0], rate: 1.3, emphasis: [1.1, 1.3, 1.0, 1.2, 1.1] },
    treats: ['minecraft:wheat_seeds', 'minecraft:sweet_berries', 'minecraft:cake'], biomes: ['desert', 'savanna', 'plains'], egg: { base_color: '#3a6ccc', overlay_color: '#f29834' } }),
];
