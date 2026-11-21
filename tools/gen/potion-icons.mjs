// Icons for the port's potion items. The mod's potions are vanilla potion items tinted with each
// effect's colour, so the port draws its own bottle (textures/port/impregnation_potion.png) and
// tints the liquid with the mod's effect colours (MinepreggoMobEffects). Run: node tools/gen/potion-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../lib/png.mjs';

const DIR = new URL('../../packs/resource/textures/port/', import.meta.url);
/** A Java ARGB int to RGB. */
const java = (/** @type {number} */ argb) => [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255];
const scale = (/** @type {number[]} */ c, /** @type {number} */ f) => c.map((v) => Math.round(Math.min(255, v * f)));

/** name -> liquid colour. Healing and harming share a colour in the mod; harming is darkened so they can be told apart. */
export const POTION_COLOURS = {
  pregnancy_delay: java(-39220),
  baby_duplication: scale(java(-39220), 1.15),
  pregnancy_healing: java(-3407821),
  pregnancy_harming: scale(java(-3407821), 0.45),
  pregnancy_resistance: java(-6710785),
  zero_gravity_belly: java(-16724737),
  metabolism_control: java(-39424),
  eternal_pregnancy: [110, 30, 160],
};

// The template's liquid tones: main, shadow and highlight.
const TEMPLATE = { main: [170, 40, 160], dark: [110, 10, 105], light: [255, 210, 250] };
const same = (/** @type {Uint8Array} */ d, /** @type {number} */ i, /** @type {number[]} */ c) => d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2];

export function tintedIcon(/** @type {{width:number,height:number,data:Uint8Array}} */ template, /** @type {number[]} */ colour) {
  const data = new Uint8Array(template.data);
  const dark = scale(colour, 0.62);
  const light = colour.map((v) => Math.round(v + (255 - v) * 0.65));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const tone = same(data, i, TEMPLATE.main) ? colour : same(data, i, TEMPLATE.dark) ? dark : same(data, i, TEMPLATE.light) ? light : undefined;
    if (tone) data.set(tone, i);
  }
  return { width: template.width, height: template.height, data };
}

const template = decodePng(new Uint8Array(readFileSync(new URL('impregnation_potion.png', DIR))));
for (const [name, colour] of Object.entries(POTION_COLOURS)) {
  writeFileSync(new URL(`${name}_potion.png`, DIR), encodePng(tintedIcon(template, colour)));
  console.log(`${name}_potion.png rgb(${colour.join(',')})`);
}
