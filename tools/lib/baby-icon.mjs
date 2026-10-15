// A 16 x 16 item icon of a Jenny girl's baby: a swaddled newborn in her skin tone with a tuft of her
// hair colour, wrapped in a blanket of her colours, with her kind's trait (cat ears, horns,
// antennae, a tail, a flower). Drawn pixel by pixel at import time from her own texture's colours,
// so every girl's baby looks like hers.
import { blank } from './png.mjs';

/** @typedef {import('./png.mjs').Image} Image */
/** @typedef {'flower' | 'cat_ears' | 'horns' | 'antennae' | 'tail' | 'slime' | 'streak' | 'none'} Trait */

/** Each girl's baby: blanket colours (main, trim) and the trait it has from her. */
export const BABY_LOOKS = /** @type {Record<string, { name: string, blanket: number[], trim: number[], trait: Trait }>} */ ({
  'fapcraft:jenny': { name: 'Jenny', blanket: [176, 150, 214], trim: [120, 92, 168], trait: 'flower' },
  'kum:bia': { name: 'Bia', blanket: [240, 170, 196], trim: [206, 112, 150], trait: 'none' },
  'kum:slime_girl': { name: 'Slime', blanket: [130, 214, 120], trim: [78, 160, 70], trait: 'slime' },
  'kum:luna': { name: 'Luna', blanket: [244, 178, 112], trim: [200, 120, 60], trait: 'cat_ears' },
  'kum:galath': { name: 'Galath', blanket: [150, 96, 168], trim: [92, 52, 110], trait: 'horns' },
  'jhallie4:allie': { name: 'Allie', blanket: [120, 210, 230], trim: [60, 150, 186], trait: 'tail' },
  'kum:manglelie': { name: 'Manglelie', blanket: [226, 226, 232], trim: [170, 170, 184], trait: 'none' },
  'jhbee24:bee': { name: 'Bee', blanket: [246, 206, 64], trim: [52, 40, 30], trait: 'antennae' },
  'jhkobold:kobold': { name: 'Kobold', blanket: [110, 190, 176], trim: [56, 128, 118], trait: 'horns' },
  'jhelliedev:ellie': { name: 'Ellie', blanket: [58, 52, 60], trim: [190, 40, 52], trait: 'streak' },
});

const shade = (/** @type {number[]} */ c, /** @type {number} */ f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));

/**
 * @param {{ skin: number[], hair: number[], blanket: number[], trim: number[], trait: Trait }} look
 * @returns {Image}
 */
export function babyIcon({ skin, hair, blanket, trim, trait }) {
  const img = blank(16, 16);
  const put = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number[]} */ c) => {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    img.data.set([c[0], c[1], c[2], 255], (y * 16 + x) * 4);
  };
  const outline = shade(trim, 0.55);
  // the bundle: a rounded blanket from row 6 to 15, a fold across it
  for (let y = 6; y <= 15; y++) {
    const half = y <= 7 ? 4 + (y - 6) : y >= 14 ? 5 - (y - 14) : 6;
    for (let x = 8 - half; x < 8 + half; x++) put(x, y, (x + y) % 7 === 0 ? shade(blanket, 0.92) : blanket);
    put(8 - half - 1, y, outline);
    put(8 + half, y, outline);
  }
  for (let x = 3; x <= 12; x++) put(x, 15, outline);
  for (let x = 4; x <= 11; x++) put(x, 10, trim);
  for (let x = 5; x <= 10; x++) put(x, 11, shade(trim, 1.1));
  // the head: a 6 x 5 face in her skin, cheeks a little pink, closed sleepy eyes, a tuft of hair
  for (let y = 2; y <= 7; y++) for (let x = 5; x <= 10; x++) put(x, y, (y === 2 && (x === 5 || x === 10)) ? [0, 0, 0] : shade(skin, y >= 6 ? 0.92 : 1.0));
  for (let x = 5; x <= 10; x++) put(x, 1, outline);
  for (let y = 2; y <= 7; y++) {
    put(4, y, outline);
    put(11, y, outline);
  }
  img.data.set([0, 0, 0, 0], (2 * 16 + 5) * 4);
  img.data.set([0, 0, 0, 0], (2 * 16 + 10) * 4);
  for (let x = 6; x <= 9; x++) put(x, 2, hair);
  put(7, 1, hair);
  put(8, 0, hair);
  put(6, 4, shade(skin, 0.45));
  put(9, 4, shade(skin, 0.45));
  put(5, 5, [236, 140, 150]);
  put(10, 5, [236, 140, 150]);
  put(7, 6, shade(skin, 0.75));
  put(8, 6, shade(skin, 0.75));
  // her trait
  if (trait === 'cat_ears') {
    put(5, 0, hair); put(5, 1, hair); put(4, 0, outline); put(10, 0, hair); put(10, 1, hair); put(11, 0, outline);
  } else if (trait === 'horns') {
    const horn = [214, 206, 182];
    put(5, 1, horn); put(4, 0, horn); put(10, 1, horn); put(11, 0, horn);
  } else if (trait === 'antennae') {
    put(6, 0, outline); put(5, 0, [40, 30, 24]); put(9, 0, outline); put(10, 0, [40, 30, 24]);
    for (let y = 12; y <= 14; y += 2) for (let x = 3; x <= 12; x++) put(x, y, trim);
  } else if (trait === 'tail') {
    put(13, 13, skin); put(14, 12, skin); put(14, 11, skin); put(13, 10, skin);
  } else if (trait === 'flower') {
    put(10, 1, [222, 60, 140]); put(11, 1, [240, 200, 60]); put(11, 2, [222, 60, 140]); put(12, 1, [222, 60, 140]);
  } else if (trait === 'slime') {
    for (let y = 12; y <= 14; y++) for (let x = 4; x <= 11; x += 3) put(x, y, shade(blanket, 1.18));
  } else if (trait === 'streak') {
    put(9, 2, [200, 40, 50]); put(10, 3, [200, 40, 50]);
  }
  return img;
}
