// Jenny's Preggo Mobs: curvy versions of Minepreggo's own girls (the zombie, creeper and slime girls
// and the ender woman, from the models tools/import-jar.mjs converts), as mobs of their own beside the
// originals, built like the Jenny Mod's and InsanityV's women: her pieces tapered instead of boxed (a
// drawn-in waist, hips flaring over her seat, full thighs slimming to the knee, a fuller bust rounded
// at top and bottom), her chest and belly jiggling as she walks, Jenny's own
// idle and walk, and the whole pregnancy of the imported girls (tools/lib/girl-port.mjs: a round belly
// fitted to her, kicks, the pregnancy and scene poses, a Jenny girl's birth). Made at import time from
// the imported models; nothing of them is committed.
//
// Run: node tools/import-jenny-preggo.mjs (part of npm run import; after tools/import-insanity.mjs).
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { facesOf, part } from './lib/box-uv.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { MOD } from './lib/belly-render.mjs';
import { GIRL_BIRTHS } from './lib/girl-births.mjs';
import { CROWN_DEPTH } from './lib/crowning.mjs';
import { POKEMON } from './lib/pokemon.mjs';
import { FURRY } from './lib/furry.mjs';
import { girlSources, portGirl } from './lib/girl-port.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'jennypreggo_port';
const LANG_HEADER = "## Jenny's Preggo Mobs (tools/import-jenny-preggo.mjs)";
const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** The girls: whose model and texture, whose birth, her babies' way of moving, her treats, where she lives. */
const GIRLS = [
  { source: 'zombie_girl', key: 'jenny_zombie_girl', name: "Jenny's Zombie Girl", birth: 'fapcraft:jenny',
    kicks: { name: 'jp_zombie', order: [0, 1, 2, 3, 4], rate: 1.0, emphasis: [1.2, 1.0, 1.0, 0.8, 0.8] },
    treats: ['minecraft:rotten_flesh', 'minecraft:cake'], biomes: ['plains', 'forest'], egg: { base_color: '#5c8a4a', overlay_color: '#f2c6a0' } },
  { source: 'humanoid_creeper_girl', key: 'jenny_creeper_girl', name: "Jenny's Creeper Girl", birth: 'kum:galath',
    kicks: { name: 'jp_creeper', order: [3, 0, 2, 1, 4], rate: 1.3, emphasis: [1.4, 0.8, 1.0, 1.2, 0.6] },
    treats: ['minecraft:gunpowder', 'minecraft:cake'], biomes: ['plains', 'forest', 'savanna'], egg: { base_color: '#4fa64a', overlay_color: '#2b2b2b' } },
  { source: 'humanoid_slime_girl', key: 'jenny_slime_girl', name: "Jenny's Slime Girl", birth: 'kum:slime_girl',
    kicks: { name: 'jp_slime', order: [4, 1, 0, 2, 3], rate: 0.8, emphasis: [0.8, 1.3, 0.9, 0.7, 1.4] },
    treats: ['minecraft:slime_ball', 'minecraft:cake'], biomes: ['swamp', 'jungle'], egg: { base_color: '#7cc46a', overlay_color: '#b8f0a8' } },
  { source: 'ender_woman', key: 'jenny_ender_woman', name: "Jenny's Ender Woman", birth: 'jhelliedev:ellie',
    kicks: { name: 'jp_ender', order: [2, 4, 1, 0, 3], rate: 1.15, emphasis: [1.0, 1.1, 1.3, 0.9, 1.0] },
    treats: ['minecraft:chorus_fruit', 'minecraft:ender_pearl', 'minecraft:cake'], biomes: ['plains', 'desert', 'the_end'], egg: { base_color: '#161616', overlay_color: '#cc66ff' },
    // her body is thin for all her height, her skin black (her face shows her eyes)
    grow: 1.05, tone: [34, 28, 40] },
  // the most curvaceous of them: her own clothes to take off, a navel that pops with every kick under
  // ripples across her belly, and a scene of her own (scripts: jenny/bed.js)
  { source: 'monster_creeper_girl', key: 'jenny_monster_creeper_girl', name: "Jenny's Monster Creeper Girl", birth: 'kum:bia',
    kicks: { name: 'jp_monster_creeper', order: [3, 2, 0, 1, 4], rate: 1.4, emphasis: [1.5, 1.0, 1.2, 1.4, 0.8] },
    treats: ['minecraft:gunpowder', 'minecraft:tnt', 'minecraft:cake'], biomes: ['plains', 'forest', 'meadow'], egg: { base_color: '#3da33a', overlay_color: '#ff66aa' },
    curves: 'most', clothes: true, navel: true, navelBirth: true, face: 'textures/minepreggo/mobs/creeper/monster/expressions/monster_creeper_girl' },
  // the monster creeper girl's treatment (her curves, clothes, navel and scene, her face) on the
  // monster slime girl, but no navel birth: hers is standing up on her jelly, and her baby crowns
  // out of the front of her jelly (her jelly has no legs: her poses and walk leave it be)
  { source: 'monster_slime_girl', key: 'jenny_monster_slime_girl', name: "Jenny's Monster Slime Girl", birth: 'girlmob:standing',
    kicks: { name: 'jp_monster_slime', order: [4, 0, 3, 1, 2], rate: 1.2, emphasis: [1.3, 1.1, 0.9, 1.2, 1.4] },
    treats: ['minecraft:slime_ball', 'minecraft:magma_cream', 'minecraft:cake'], biomes: ['swamp', 'jungle'], egg: { base_color: '#62c95a', overlay_color: '#ff66aa' },
    curves: 'most', clothes: true, navel: true, jelly: true, face: 'textures/minepreggo/mobs/slime/monster/expressions/monster_slime_girl' },
  // the Pokémon girls, modelled and painted by tools/lib/pokemon.mjs
  ...POKEMON,
  // the furry girls, theirs by tools/lib/furry.mjs (their babies' kicks press out as paw prints and puppy heads)
  ...FURRY,
];
/** How curvy: [bust growth, hips' slices across, hips' slices deep, waist, thighs' slices across, thighs' slices deep]. */
const CURVES = {
  curvy: { bust: 1.32, hips: [1.08, 1.18, 1.26, 1.3], hipsDeep: [1.04, 1.12, 1.18, 1.18], waist: 0.94, thighs: [1.3, 1.2, 1.1, 1.02], thighsDeep: [1.24, 1.16, 1.08, 1.0] },
  // (the Pokémon girls: a fuller bust, hips and thighs still)
  thick: { bust: 2, bustShape: [1.35, 1.75, 2.35], hips: [1.2, 1.42, 1.62, 1.76], hipsDeep: [1.12, 1.28, 1.42, 1.5], waist: 0.78, thighs: [1.72, 1.56, 1.34, 1.12], thighsDeep: [1.55, 1.42, 1.24, 1.08] },
  lush: { bust: 1.85, bustShape: [1.3, 1.65, 2.2], hips: [1.16, 1.34, 1.5, 1.58], hipsDeep: [1.1, 1.24, 1.36, 1.42], waist: 0.8, thighs: [1.5, 1.38, 1.22, 1.08], thighsDeep: [1.4, 1.3, 1.16, 1.04] },
  most: { bust: 1.55, hips: [1.14, 1.3, 1.42, 1.48], hipsDeep: [1.08, 1.2, 1.3, 1.32], waist: 0.84, thighs: [1.42, 1.3, 1.16, 1.04], thighsDeep: [1.32, 1.22, 1.1, 1.0] },
};
/** Her bones -> the Jenny rig's (her own belly bone keeps out of the fitted belly's way). */
const RENAME = /** @type {Record<string, string>} */ ({ body: 'upperBody', left_arm: 'armL', right_arm: 'armR', left_leg: 'legL', right_leg: 'legR', left_front_leg: 'legL', right_front_leg: 'legR', belly: 'tummy', leg: 'legL' });

const write = (/** @type {string} */ file, /** @type {string | Uint8Array} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

// ---- clean the previous import ----------------------------------------------------------------------
for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(RP, 'entity', PORT), join(RP, 'models/entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) {
  rmSync(dir, { recursive: true, force: true });
}
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at < 0) continue;
  const next = text.slice(at + 1).search(/^## /m);
  writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n') + (next >= 0 ? text.slice(at + 1 + next) : ''));
}
const MODELS = join(RP, 'models/entity', MOD);
if (!existsSync(join(MODELS, 'zombie_girl.geo.json'))) {
  console.warn("warning: Minepreggo's models are not imported (tools/import-jar.mjs); no Jenny's Preggo Mobs");
  process.exit(0);
}

/**
 * Her model on the Jenny rig: a body root her upper body and legs hang from, her upper body turning at
 * her waist, her trunk's cubes a torso under it (what the belly fitter measures), a hip at the top of
 * her legs.
 */
function onJennyRig(/** @type {any} */ source, /** @type {string} */ id) {
  const g = structuredClone(source);
  g.description = { ...g.description, identifier: id };
  for (const bone of g.bones) {
    bone.name = RENAME[bone.name] ?? bone.name;
    if (bone.parent) bone.parent = RENAME[bone.parent] ?? bone.parent;
  }
  // (a slime's jelly is one leg: her left, with an empty right at its top)
  if (!g.bones.some((/** @type {any} */ b) => b.name === 'legR')) g.bones.push({ name: 'legR', pivot: [...g.bones.find((/** @type {any} */ b) => b.name === 'legL').pivot] });
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  const upper = byName.get('upperBody');
  const legTop = Math.max(byName.get('legL').pivot[1], byName.get('legR').pivot[1]);
  for (const name of ['head', 'armL', 'armR', 'flat_body']) if (byName.get(name) && !byName.get(name).parent) byName.get(name).parent = 'upperBody';
  for (const name of ['upperBody', 'legL', 'legR']) byName.get(name).parent = 'body';
  // (anything else loose, a creeper's hind legs, hangs from her root)
  for (const bone of g.bones) if (!bone.parent) bone.parent = 'body';
  g.bones.push({ name: 'torso', parent: 'upperBody', pivot: [...upper.pivot], cubes: upper.cubes ?? [] });
  delete upper.cubes;
  g.bones.unshift({ name: 'body', pivot: [0, legTop, 0] });
  g.bones.push({ name: 'hip', parent: 'upperBody', pivot: [0, legTop + 1, upper.pivot[2]] });
  upper.pivot = [upper.pivot[0], legTop, upper.pivot[2]];
  return { g, byName: new Map(g.bones.map((/** @type {any} */ b) => [b.name, b])), legTop };
}

/** A cube grown by [kx, ky, kz] about a point, its texture kept. */
function grow(/** @type {any} */ cube, /** @type {any} */ bone, /** @type {number[]} */ k, /** @type {number[]} */ about) {
  cube.uv = facesOf(cube, bone.mirror);
  cube.origin = cube.origin.map((/** @type {number} */ o, /** @type {number} */ i) => round(about[i] + (o - about[i]) * k[i]));
  cube.size = cube.size.map((/** @type {number} */ s, /** @type {number} */ i) => round(s * k[i]));
}
/**
 * A cube cut into horizontal slices (top first), each `widths[i]` as wide and `depths[i]` as deep,
 * about the cube's middle (or, `back`, keeping its front where it is and growing behind), each with
 * its own band of the cube's texture: a curve instead of a box.
 */
function taper(/** @type {any} */ cube, /** @type {any} */ bone, /** @type {number[]} */ widths, /** @type {number[]} */ depths, back = false) {
  const faces = Array.isArray(cube.uv) ? facesOf(cube, bone.mirror) : cube.uv;
  const [x, y, z] = cube.origin, [w, h, d] = cube.size;
  const n = widths.length;
  return widths.map((wk, i) => {
    const band = (/** @type {string} */ side) => (faces[side] ? part(faces[side], 0, 1, i / n, (i + 1) / n) : undefined);
    const sw = w * wk, sd = d * depths[i];
    /** @type {Record<string, any>} */
    const uv = { north: band('north'), south: band('south'), east: band('east'), west: band('west'), up: faces.up ?? band('north'), down: faces.down ?? band('north') };
    for (const k of Object.keys(uv)) if (!uv[k]) delete uv[k];
    return {
      ...(cube.inflate ? { inflate: cube.inflate } : {}),
      origin: [round(x + w / 2 - sw / 2), round(y + h - (h * (i + 1)) / n), round(back ? z : z + d / 2 - sd / 2)],
      size: [round(sw), round(h / n), round(sd)],
      uv,
    };
  });
}

/**
 * Her curves, each piece tapered rather than boxed: a fuller bust rounded at its top and bottom, a
 * waist drawn in, hips flaring out over her seat, thighs full at the top and slimming to the knee,
 * each in her own texture.
 */
function curvy(/** @type {any} */ g, /** @type {Map<string, any>} */ byName, /** @type {typeof CURVES.curvy} */ k, /** @type {number} */ legTop, hipsTop = legTop + 2.5) {
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  for (const bone of byName.has('boobs') ? under('boobs').map((n) => byName.get(n)) : []) {
    bone.cubes = (bone.cubes ?? []).flatMap((/** @type {any} */ cube) => {
      // (rounder and fuller forward than wide, where her curves say how)
      grow(cube, bone, /** @type {any} */ (k).bustShape ?? [k.bust, k.bust, k.bust], bone.pivot);
      return taper(cube, bone, [0.82, 1, 1, 0.88], [0.7, 0.96, 1, 0.82]);
    });
  }
  const torso = byName.get('torso');
  if (torso?.cubes?.length) {
    const byHeight = [...torso.cubes].sort((a, b) => a.origin[1] - b.origin[1]);
    // her hips: the lowest piece, and any other as low (a creeper's two); her waist the next above
    const hips = byHeight.filter((c, i) => i === 0 || c.origin[1] < hipsTop);
    const waist = byHeight[hips.length];
    torso.cubes = torso.cubes.flatMap((/** @type {any} */ cube) =>
      hips.includes(cube) ? taper(cube, torso, k.hips, k.hipsDeep, true)
        : cube === waist && waist.size[1] <= 3 ? taper(cube, torso, [k.waist], [1])
        : [cube]);
  }
  for (const bone of ['legL', 'legR'].map((n) => byName.get(n)).filter(Boolean)) {
    bone.cubes = (bone.cubes ?? []).flatMap((/** @type {any} */ cube) => (cube.size[1] >= 5 ? taper(cube, bone, k.thighs, k.thighsDeep) : [cube]));
  }
}

/**
 * Her clothes, painted over her own texture (she wore none): a dark crop top over her chest and bust,
 * a short skirt over her hips, each keeping a little of her skin's pattern, with a lighter hem.
 * @param {Uint8Array} png her texture @param {any} source her model (box UVs)
 */
function clothed(png, source) {
  const image = decodePng(png);
  const byName = new Map(source.bones.map((/** @type {any} */ b) => [b.name, b]));
  const under = (/** @type {string} */ n) => [n, ...source.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  const body = byName.get('body');
  const legTop = Math.max(...source.bones.filter((/** @type {any} */ b) => /leg/.test(b.name)).map((/** @type {any} */ b) => b.pivot[1]));
  const paint = (/** @type {any} */ cube, /** @type {any} */ bone, /** @type {number[]} */ colour) => {
    for (const face of Object.values(facesOf(cube, bone.mirror))) {
      const u0 = Math.min(face.uv[0], face.uv[0] + face.uv_size[0]), v0 = Math.min(face.uv[1], face.uv[1] + face.uv_size[1]);
      const w = Math.abs(face.uv_size[0]), h = Math.abs(face.uv_size[1]);
      for (let y = Math.floor(v0); y < Math.ceil(v0 + h); y++) for (let x = Math.floor(u0); x < Math.ceil(u0 + w); x++) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const i = (y * image.width + x) * 4;
        const shade = 0.75 + 0.25 * ((image.data[i] + image.data[i + 1] + image.data[i + 2]) / 765);
        const hem = y === Math.floor(v0) || y === Math.ceil(v0 + h) - 1 ? 1.6 : 1;
        for (let c = 0; c < 3; c++) image.data[i + c] = Math.min(255, Math.round(colour[c] * shade * hem));
        image.data[i + 3] = 255;
      }
    }
  };
  for (const cube of body?.cubes ?? []) paint(cube, body, cube.origin[1] < legTop + 2.5 ? [40, 34, 58] : [34, 34, 40]);
  for (const name of byName.has('boobs') ? under('boobs') : []) for (const cube of byName.get(name).cubes ?? []) paint(cube, byName.get(name), [34, 34, 40]);
  return encodePng(image);
}

/**
 * Her babies' kicks as marks (the furry girls'): each kick's bulge of skin gives way to a mark of the
 * same skin pressing out where it kicks, paw prints at her sides and top, a puppy's head (a kitten's for
 * the cat) at her front and bottom; sunk just inside her belly at rest, so only a kick brings it out.
 * Her kind's marks: a puppy's (paw prints, puppy heads), a kitten's, a lamb's (cloven hoof prints, a lamb's
 * head with its ears out to its sides), a dragon's (three-clawed prints, a horned head with a snout), a
 * chick's (bird tracks, a chick's round head with a beak).
 * @param {any} doc a belly geometry @param {'puppy' | 'kitten' | 'lamb' | 'dragon' | 'chick'} kind
 */
function withMarks(doc, kind) {
  const g = doc['minecraft:geometry'][0];
  const size = g.description.texture_width;
  const spot = { uv: [round(size / 2 - 1), round(size * 0.6)], uv_size: [2, 2] };
  const uv = { north: spot, south: spot, east: spot, west: spot, up: spot, down: spot };
  const HEADS = new Set(['front', 'bottom']);
  for (const where of ['front', 'left', 'right', 'top', 'bottom']) {
    const kick = g.bones.find((/** @type {any} */ b) => b.name === `${where}_kick`);
    const skin = g.bones.find((/** @type {any} */ b) => b.name === `${where}_kick_skin`);
    if (!kick || !skin?.cubes?.length) continue;
    // (the mark as big as the bulge was across)
    const xs = skin.cubes.flatMap((/** @type {any} */ c) => [c.origin[0], c.origin[0] + c.size[0]]);
    const k = Math.max(0.5, Math.min(1.3, (Math.max(...xs) - Math.min(...xs)) / 2.2));
    skin.cubes = [];
    const [px, py, pz] = kick.pivot;
    const z = pz + 0.1;
    /** @type {any[]} */
    const cubes = [];
    const box = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, dz = 0, d = 0.9) =>
      cubes.push({ origin: [round(px + x * k), round(py + y * k), round(z + dz)], size: [round(w * k), round(h * k), d], uv });
    if (!HEADS.has(where) && kind === 'lamb') {
      // a cloven hoof print: two halves side by side
      box(-1.05, -1.1, 0.95, 2.1);
      box(0.1, -1.1, 0.95, 2.1);
    } else if (!HEADS.has(where) && kind === 'dragon') {
      // a dragon's print: a pad and three long claws fanned forward
      box(-0.8, -1.1, 1.6, 1.1);
      for (const tx of [-1.1, -0.25, 0.6]) box(tx, 0.1, 0.5, 1.5, 0.1, 0.8);
    } else if (!HEADS.has(where) && kind === 'chick') {
      // a bird's track: three thin toes forward from a heel, one back
      box(-0.2, -1.3, 0.4, 0.9);
      box(-0.2, -0.4, 0.4, 1.6, 0.1, 0.8);
      box(-1.1, -0.1, 0.9, 0.4, 0.1, 0.8);
      box(0.2, -0.1, 0.9, 0.4, 0.1, 0.8);
    } else if (!HEADS.has(where)) {
      // a paw print: its pad and four toes
      box(-1, -1, 2, 1.5);
      for (const [tx, ty] of [[-1.2, 0.65], [-0.45, 1.05], [0.45, 1.05], [1.2, 0.65]]) box(tx - 0.33, ty, 0.66, 0.66, 0.1, 0.8);
    } else if (kind === 'lamb') {
      // a lamb's head: round, its ears straight out to its sides
      box(-1.1, -1, 2.2, 2.1, 0.3, 0.6);
      box(-2.3, 0.2, 1.2, 0.6, 0.35, 0.55);
      box(1.1, 0.2, 1.2, 0.6, 0.35, 0.55);
      box(-0.5, -1.15, 1, 0.8);
    } else if (kind === 'dragon') {
      // a little dragon's head: horns back, its snout leading
      box(-1.1, -0.8, 2.2, 1.9, 0.3, 0.6);
      box(-1, 1.1, 0.5, 0.9, 0.35, 0.55);
      box(0.5, 1.1, 0.5, 0.9, 0.35, 0.55);
      box(-0.65, -1.3, 1.3, 1);
    } else if (kind === 'chick') {
      // a chick's head: round, a beak leading
      box(-1.05, -0.9, 2.1, 2, 0.3, 0.6);
      box(-0.35, -0.5, 0.7, 0.55);
      box(-0.15, 1.1, 0.3, 0.5, 0.35, 0.55);
    } else if (kind === 'kitten') {
      // a kitten's head: pointed ears up, a little nose leading
      box(-1.2, -0.95, 2.4, 1.9, 0.3, 0.6);
      box(-1.25, 0.95, 0.75, 0.8, 0.35, 0.55);
      box(0.5, 0.95, 0.75, 0.8, 0.35, 0.55);
      box(-0.35, -0.6, 0.7, 0.5);
    } else {
      // a puppy's head: floppy ears at its sides, its snout leading
      box(-1.3, -1, 2.6, 2.2, 0.3, 0.6);
      box(-1.95, -0.35, 0.7, 1.4, 0.35, 0.55);
      box(1.25, -0.35, 0.7, 1.4, 0.35, 0.55);
      box(-0.6, -1.1, 1.2, 0.85);
    }
    g.bones.push({ name: `${where}_kick_mark`, parent: `${where}_kick`, pivot: [px, py, pz], cubes });
  }
}

/** The armour she can wear (scripts: mobs/armor.js): by the minepreggo:armor property, 1 to 5. */
const ARMORS = [[150, 96, 56], [204, 208, 214], [248, 208, 72], [96, 222, 222], [72, 66, 74]];
/** An armour plate's texture: its colour, a darker rim, a light bevel, rivets at its corners. */
function armorTexture(/** @type {number[]} */ c) {
  const img = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const rim = x === 0 || y === 0 || x === 15 || y === 15, bevel = x === 1 || y === 1, rivet = (x === 2 || x === 13) && (y === 2 || y === 13);
    const k = rim ? 0.62 : rivet ? 1.35 : bevel ? 1.18 : 0.95 + 0.1 * (((x * 7 + y * 13) % 5) / 5) - 0.04 * (y / 16);
    img.data.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))), 255], (y * 16 + x) * 4);
  }
  return encodePng(img);
}
/**
 * Her armour: a shell over her torso, bust, arms and legs and a helmet over her head, on her own bones
 * (so it moves with her), each piece a little bigger than her, drawn with the plate texture.
 */
function armorLayer(/** @type {any} */ g, /** @type {string} */ id) {
  const plate = { uv: [0, 0], uv_size: [16, 16] };
  const uv = { north: plate, south: plate, east: plate, west: plate, up: plate, down: plate };
  const wear = new Set(['torso', 'right_boob', 'left_boob', 'armR', 'armL', 'legR', 'legL']);
  const bones = g.bones.map((/** @type {any} */ b) => {
    const largest = [...(b.cubes ?? [])].sort((a, c) => c.size[0] * c.size[1] * c.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    // (her helmet a cap over the top of her head, above her eyes: her face shows)
    const cap = largest && b.name === 'head' ? { ...largest, origin: [largest.origin[0], round(largest.origin[1] + largest.size[1] * 0.74), largest.origin[2]], size: [largest.size[0], round(largest.size[1] * 0.26), largest.size[2]] } : undefined;
    const cubes = wear.has(b.name) ? b.cubes ?? [] : cap ? [cap] : [];
    return {
      name: b.name, ...(b.parent ? { parent: b.parent } : {}), pivot: b.pivot, ...(b.rotation ? { rotation: b.rotation } : {}),
      ...(cubes.length ? { cubes: cubes.map((/** @type {any} */ c) => ({ origin: c.origin, size: c.size, uv, inflate: round((c.inflate ?? 0) + (b.name === 'head' ? 0.45 : 0.3)), ...(c.rotation ? { rotation: c.rotation, pivot: c.pivot } : {}) })) } : {}),
    };
  });
  return { format_version: '1.16.0', 'minecraft:geometry': [{ description: { identifier: id, texture_width: 16, texture_height: 16, visible_bounds_width: 3, visible_bounds_height: 4, visible_bounds_offset: [0, 1.5, 0] }, bones }] };
}

/**
 * Her navel: a little knot on the front of each belly, at its middle a little below, in the belly's
 * skin (the navel the belly texture draws), that pops out with every kick.
 */
function withNavel(/** @type {any} */ doc) {
  const g = doc['minecraft:geometry'][0];
  const belly = g.bones.find((/** @type {any} */ b) => b.name === 'belly');
  const cubes = belly?.cubes ?? [];
  if (!cubes.length) return;
  const lo = Math.min(...cubes.map((/** @type {any} */ c) => c.origin[1])), hi = Math.max(...cubes.map((/** @type {any} */ c) => c.origin[1] + c.size[1]));
  const y = lo + (hi - lo) * 0.42;
  const front = Math.min(...cubes.filter((/** @type {any} */ c) => c.origin[0] <= 0 && c.origin[0] + c.size[0] >= 0 && c.origin[1] <= y && c.origin[1] + c.size[1] >= y).map((/** @type {any} */ c) => c.origin[2]));
  if (!Number.isFinite(front)) return;
  const size = g.description.texture_width;
  const spot = { uv: [round(size / 2 - 1), round(size * 0.6)], uv_size: [2, 2] };
  g.bones.push({ name: 'mp_navel', parent: 'belly', pivot: [0, round(y), round(front)],
    cubes: [{ origin: [-0.6, round(y - 0.6), round(front - 0.45)], size: [1.2, 1.2, 0.6], uv: { north: spot, south: spot, east: spot, west: spot, up: spot, down: spot } }] });
  // her navel birth's crowning: the belly's own crowning baby, moved from between her legs to her
  // navel and turned to come out of it, forward (its -y the way out)
  const crowning = g.bones.find((/** @type {any} */ b) => b.name === 'crowning');
  if (!crowning) return;
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  const navel = [0, round(y), round(front - 0.2)];
  const shift = navel.map((v, i) => v - crowning.pivot[i]);
  const moved = (/** @type {number[]} */ p) => p.map((v, i) => round(v + shift[i]));
  for (const name of under('crowning')) {
    const bone = structuredClone(g.bones.find((/** @type {any} */ b) => b.name === name));
    bone.name = `navel_${name}`;
    bone.parent = name === 'crowning' ? 'belly' : `navel_${bone.parent}`;
    if (name === 'crowning') bone.rotation = [-90, 0, 0];
    bone.pivot = moved(bone.pivot ?? [0, 0, 0]);
    for (const cube of bone.cubes ?? []) {
      cube.origin = moved(cube.origin);
      if (cube.pivot) cube.pivot = moved(cube.pivot);
    }
    g.bones.push(bone);
  }
}

/** Her faces (Minepreggo's expression textures, each only her face), by the index v.face picks. */
const FACES = ['closed_eyes', 'face_horny1', 'face_horny2', 'face_pain1', 'face_pain2', 'face_pain3', 'face_pain4', 'face_post_partum', 'face_sad1', 'face_surprised1', 'face_angry1'];
/**
 * Her face, alive: which of FACES she wears (-1: her own), from what she is doing. She blinks every
 * few seconds (her own moment, so no two blink together); in a scene her face turns lustful, its two
 * looks alternating with the beat; pains in labor (the hardest while she gives birth), worn out after
 * it, sad after a loss, surprised by a hard kick, angry when savage.
 */
const FACE_LINES = [
  'v.mp_blink = math.mod(q.life_time + v.mp_blink_at, 4.3) < 0.16;',
  "v.mp_lust = v.pose == 'scene' || v.pose == 'scene_back' || v.pose == 'scene_sit';",
  "v.mp_pain = v.pose == 'prebirth' || v.pose == 'contraction' || v.pose == 'water_breaking' || v.pose == 'back_pain' || v.pose == 'morning_sickness' || v.pose == 'incapacitated' || v.pose == 'kicking_sit';",
  "v.face = v.mp_lust ? 1 + math.mod(math.floor(q.life_time * 1.92), 2) : (v.pose == 'birth' ? 5 + math.mod(math.floor(q.life_time * 1.5), 2) : (v.mp_pain ? 3 + math.mod(math.floor(q.life_time * 0.8), 2) : (v.pose == 'postbirth' ? 7 : (v.pose == 'miscarriage' ? 8 : (q.property('minepreggo:savage') ? 10 : (v.kick_w > 0.6 ? 9 : (v.mp_blink ? 0 : -1)))))));",
];
/** Her face's layer: her head again, a hair larger, drawn in the face she wears (transparent but her face). */
function faceLayer(/** @type {any} */ g, /** @type {string} */ id) {
  const head = g.bones.find((/** @type {any} */ b) => b.name === 'head');
  const chain = [];
  for (let bone = head; bone; bone = bone.parent ? g.bones.find((/** @type {any} */ b) => b.name === bone.parent) : undefined) chain.unshift(bone);
  return {
    format_version: '1.16.0',
    'minecraft:geometry': [{
      description: { ...g.description, identifier: id },
      bones: chain.map((/** @type {any} */ b) => ({ name: b.name, ...(b.parent ? { parent: b.parent } : {}), pivot: b.pivot, ...(b.rotation ? { rotation: b.rotation } : {}),
        ...(b === head ? { cubes: [{ ...head.cubes[0], inflate: (head.cubes[0].inflate ?? 0) + 0.06 }] } : {}) })),
    }],
  };
}

const jennyFile = join(RP, 'animations/jenny_port/jenny.animation.json');
const jenny = existsSync(jennyFile) ? JSON.parse(readFileSync(jennyFile, 'utf8')).animations : {};
const swing = (/** @type {number} */ k) => [`math.cos(q.modified_distance_moved * 38.17) * ${k}`, 0, 0];
const moves = {
  idle: jenny['animation.jhjenjava.jenny.idle'] ?? { loop: true, bones: { upperBody: { rotation: ['math.sin(q.anim_time * 90.0) * 1.5', 0, 0] } } },
  walk: jenny['animation.jhjenjava.jenny.walk'] ?? { loop: true, bones: { legL: { rotation: swing(30) }, legR: { rotation: swing(-30) }, armL: { rotation: swing(-25) }, armR: { rotation: swing(25) } } },
};

const sources = girlSources(RP);
/** @type {Record<string, unknown>} */
const controllers = {};
/** @type {Record<string, unknown>} */
const renderControllers = {};
const lang = [LANG_HEADER];
let poses = 0;
for (const girl of GIRLS) {
  // (her model and texture: Minepreggo's, or made for her)
  // (her looks, made for her: one each spawns as, each bare and dressed)
  const looks = 'made' in girl ? girl.made() : undefined;
  const made = looks?.[0];
  const source = made ? made.geometry : JSON.parse(readFileSync(join(MODELS, `${girl.source}.geo.json`), 'utf8'))['minecraft:geometry'][0];
  const client = made ? undefined : JSON.parse(readFileSync(join(RP, 'entity', `${girl.source}.entity.json`), 'utf8'))['minecraft:client_entity'].description;
  const texturePath = client ? Object.values(client.textures).find((t) => !/expression|_p\d|ill_|_all/.test(String(t))) ?? Object.values(client.textures)[0] : '';
  const { g, byName, legTop } = onJennyRig(source, `geometry.${MOD}.${girl.key}`);
  curvy(g, byName, CURVES[girl.curves ?? 'curvy'], legTop, girl.jelly ? legTop + 2 : undefined);
  // (a slime's baby comes out of the front of her jelly, forward)
  GIRL_BIRTHS[`${MOD}:${girl.key}`] = { ...GIRL_BIRTHS[girl.birth], name: girl.key, ...(girl.jelly ? { exitWant: [0, -0.2, -0.98] } : {}) };
  const jelly = girl.jelly ? byName.get('leg_part_2')?.cubes?.[0] : undefined;
  const skin = made ? made.png : new Uint8Array(readFileSync(join(RP, `${texturePath}.png`)));
  const prefix = `animation.${MOD}.${PORT.replace('_port', '')}_${girl.key}`;
  // her navel's pop and the ripples over her belly while her babies kick
  const navel = girl.navel ? {
    animations: { [`${prefix}.navel`]: { loop: true, bones: {
      // (in her navel scene, its pulse and her belly's ripples keep the scene's 0.52 s beat)
      // (her navel birth: it opens wide as each baby crowns out of it)
      mp_navel: {
        scale: `q.property('${MOD}:navel_birth') ? 1.3 + 0.9 * v.crown_x : q.property('${MOD}:navel_scene') ? 1.25 + 0.55 * math.abs(math.sin(q.life_time * 346.0)) : 1.0 + v.kick_w * 0.9 * math.pow(math.max(0.0, math.sin(q.life_time * 300.0)), 4.0)`,
        position: [0, 0, `q.property('${MOD}:navel_scene') ? -0.5 * math.abs(math.sin(q.life_time * 346.0)) : -v.kick_w * 0.7 * math.pow(math.max(0.0, math.sin(q.life_time * 300.0)), 4.0)`],
      },
      // (her navel birth: her belly bursts open at her navel, gone at once)
      navel_crowning: { scale: `v.navel_crowning ? v.crown_scale : 0.0` },
      navel_crowning_slide: { position: [0, `-${CROWN_DEPTH}`, 0] },
      belly: { scale: [`q.property('${MOD}:navel_burst') ? 0.0 : (q.property('${MOD}:navel_scene') ? 1.0 + 0.03 * math.sin(q.life_time * 692.0) : 1.0 + 0.035 * v.kick_w * math.sin(q.life_time * 170.0))`, `q.property('${MOD}:navel_burst') ? 0.0 : (q.property('${MOD}:navel_scene') ? 1.0 - 0.03 * math.sin(q.life_time * 692.0) : 1.0 + 0.035 * v.kick_w * math.sin(q.life_time * 170.0 + 90.0))`, `q.property('${MOD}:navel_burst') ? 0.0 : 1.0`] },
    } },
    // (the girls made for us: her tail wagging, her ears flicking, her wings stirring, all livelier in her
    // scenes, and her bust bouncing to a scene's beat)
    ...(made ? { [`${prefix}.flair`]: { loop: true, bones: Object.fromEntries([
      ['tail', { rotation: [0, 'math.sin(q.life_time * (v.mp_scene ? 420.0 : 150.0)) * (v.mp_scene ? 20.0 : 9.0)', 0] }],
      ['ear_r', { rotation: ['math.pow(math.max(0.0, math.sin(q.life_time * 70.0)), 16.0) * -22.0 + (v.mp_scene ? -8.0 : 0.0)', 0, 0] }],
      ['ear_l', { rotation: ['math.pow(math.max(0.0, math.sin(q.life_time * 70.0 + 50.0)), 16.0) * -22.0 + (v.mp_scene ? -8.0 : 0.0)', 0, 0] }],
      ['wing_r', { rotation: [0, 'math.sin(q.life_time * (v.mp_scene ? 300.0 : 80.0)) * (v.mp_scene ? 16.0 : 5.0)', 0] }],
      ['wing_l', { rotation: [0, '-math.sin(q.life_time * (v.mp_scene ? 300.0 : 80.0)) * (v.mp_scene ? 16.0 : 5.0)', 0] }],
      ['boobs', { position: [0, 'v.mp_scene ? math.sin(q.life_time * 692.0) * 0.4 : 0.0', 'v.mp_scene ? -math.abs(math.sin(q.life_time * 692.0)) * 0.15 : 0.0'] }],
    ].filter(([bone]) => g.bones.some((/** @type {any} */ b) => b.name === bone))) } } : {}),
    },
    ids: { mp_navel: `${prefix}.navel`, ...(made ? { mp_flair: `${prefix}.flair` } : {}) },
    animate: [{ mp_navel: 'v.bp >= 0' }, ...(made ? ['mp_flair'] : [])],
    // (in her navel birth, her baby crowns at her navel, not between her legs)
    pre: [`v.navel_crowning = v.crowning && q.property('${MOD}:navel_birth');`, `v.crowning = v.crowning && !q.property('${MOD}:navel_birth');`, ...(made ? ["v.mp_scene = v.pose == 'scene' || v.pose == 'scene_sit' || v.pose == 'scene_back';"] : []), ...(girl.face ? FACE_LINES : [])],
    // (each her own moment to blink)
    initialize: girl.face ? ['v.mp_blink_at = math.random(0.0, 4.3);'] : [],
  } : undefined;
  // her face's layer and its looks
  const faceRc = `controller.render.${MOD}.${girl.key}_face`;
  const face = girl.face ? {
    extraGeometries: { face: faceLayer(g, `geometry.${MOD}.${girl.key}_face`) },
    extraRenderControllers: [{ id: faceRc, when: 'v.face >= 0', def: {
      arrays: { textures: { 'Array.faces': FACES.map((f) => `Texture.${f}`) } },
      geometry: 'Geometry.face', materials: [{ '*': 'Material.default' }], textures: ['Array.faces[math.clamp(v.face, 0, ' + (FACES.length - 1) + ')]'],
    } }],
  } : {};
  const faceTextures = girl.face ? Object.fromEntries(FACES.map((f) => [f, new Uint8Array(readFileSync(join(RP, `${girl.face}_${f}.png`)))])) : {};
  const out = portGirl(sources, { BP, RP, port: PORT, ns: MOD }, {
    key: girl.key, name: girl.name,
    outfits: [
      { name: girl.key, geometry: { format_version: '1.16.0', 'minecraft:geometry': [g] }, texture: girl.clothes ? made?.dressed ?? clothed(skin, source) : skin },
      // (her other looks, each on the rig and curved as her first)
      ...(looks ?? []).slice(1).map((look, i) => {
        const other = onJennyRig(look.geometry, `geometry.${MOD}.${girl.key}_${i + 1}`);
        curvy(other.g, other.byName, CURVES[girl.curves ?? 'curvy'], other.legTop);
        return { name: `${girl.key}_${i + 1}`, geometry: { format_version: '1.16.0', 'minecraft:geometry': [other.g] }, texture: girl.clothes ? look.dressed : look.png };
      }),
    ],
    ...(girl.clothes ? {
      // dressed, or her own skin once undressed (the Wahoo menu, scripts: jenny/bed.js), in the look she has
      extraTextures: { nude: skin, ...Object.fromEntries((looks ?? []).slice(1).map((look, i) => [`nude_${i + 1}`, look.png])), ...faceTextures, ...(made ? Object.fromEntries(ARMORS.map((c, i) => [`armor_${i + 1}`, armorTexture(c)])) : {}) },
      textureExpression: (looks?.length ?? 0) > 1
        ? `q.property('${MOD}:undressed') ? (${(looks ?? []).slice(1).map((_, i) => `q.variant == ${i + 1} ? Texture.nude_${i + 1} : `).join('')}Texture.nude) : Array.skins[math.clamp(q.variant, 0, ${(looks ?? []).length - 1})]`
        : `q.property('${MOD}:undressed') ? Texture.nude : Texture.o0`,
    } : {}),
    // (her navel's animation reads these, clothes or not)
    ...(girl.clothes || girl.navel ? { properties: {
      ...Object.fromEntries(['undressed', 'navel_scene', 'navel_burst', 'navel_birth'].map((p) => [`${MOD}:${p}`, { type: 'bool', default: false, client_sync: true }])),
      // (the armour she wears: none, leather, iron, gold, diamond, netherite; scripts: mobs/armor.js)
      ...(made ? { [`${MOD}:armor`]: { type: 'int', range: [0, ARMORS.length], default: 0, client_sync: true } } : {}),
    } } : {}),
    ...(girl.navel || 'marks' in girl ? { bellyHook: (/** @type {any} */ doc) => { if (girl.navel) withNavel(doc); if ('marks' in girl) withMarks(doc, /** @type {any} */ (girl).marks); } } : {}),
    ...(girl.navel ? { extra: navel } : {}),
    ...face,
    // (her armour, over her: her own bones, the plate of the armour she wears)
    ...(made ? {
      extraGeometries: { ...(face.extraGeometries ?? {}), armor: armorLayer(g, `geometry.${MOD}.${girl.key}_armor`) },
      extraRenderControllers: [...(face.extraRenderControllers ?? []), { id: `controller.render.${MOD}.${girl.key}_armor`, when: `q.property('${MOD}:armor') > 0`, def: {
        arrays: { textures: { 'Array.armors': ARMORS.map((_, i) => `Texture.armor_${i + 1}`) } },
        geometry: 'Geometry.armor', materials: [{ '*': 'Material.default' }], textures: [`Array.armors[math.clamp(q.property('${MOD}:armor') - 1, 0, ${ARMORS.length - 1})]`],
      } }],
    } : {}),
    moves, jiggle: { chest: ['boobs'], belly: ['belly'] },
    birth: `${MOD}:${girl.key}`, kicks: girl.kicks, treats: girl.treats, biomes: girl.biomes,
    ...(jelly ? { opening: () => [0, round(jelly.origin[1] + jelly.size[1] * 0.7), round(jelly.origin[2])], stillBones: ['legL', 'legR'], material: 'entity_alphablend' } : {}),
    ...('minWidth' in girl ? { minWidth: girl.minWidth } : {}),
    ...('weights' in girl ? { weights: girl.weights } : {}),
    family: 'jenny_preggo_mob', egg: girl.egg, bellyStyle: 'round', ...(girl.grow ? { grow: girl.grow } : {}), ...(girl.tone ? { tone: girl.tone } : {}),
  });
  Object.assign(controllers, out.controllers);
  Object.assign(renderControllers, out.renderControllers);
  lang.push(...out.lang);
  poses += out.poses;
}
write(join(RP, 'animation_controllers', PORT, 'jenny_preggo.animation_controllers.json'), JSON.stringify({ format_version: '1.10.0', animation_controllers: controllers }, null, 2) + '\n');
write(join(RP, 'render_controllers', PORT, 'jenny_preggo.render_controllers.json'), JSON.stringify({ format_version: '1.8.0', render_controllers: renderControllers }, null, 2) + '\n');
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`Jenny's Preggo Mobs: ${GIRLS.length} curvy girls, ${poses} pregnancy and scene poses`);
