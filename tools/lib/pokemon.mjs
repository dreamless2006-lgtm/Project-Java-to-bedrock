// The Pokémon girls (Gardevoir, Lucario, Lopunny) as blocky Minecraft models of our own, built here
// cube by cube and painted pixel by pixel, in the bone layout of Minepreggo's own girls (head, body
// with its hips, waist and chest, boobs, arms and legs), so tools/import-jenny-preggo.mjs makes them
// into curvy Jenny's Preggo Mobs like the others. Generated at import time into its git-ignored port
// folder (they are fan likenesses of other people's characters).
import { existsSync, readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { blank, encodePng } from './png.mjs';
import { facesOf, part } from './box-uv.mjs';

const TEX = 128;
/** @typedef {number[]} Colour */
/** @typedef {(face: string, x: number, y: number, i: number, j: number) => Colour | undefined} Paint a face's colour at (x, y) across and down it (0 to 1), at its pixel (i, j) */

const hash = (/** @type {number} */ x, /** @type {number} */ y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A model being built: bones, and box-UV cubes packed into one texture as they are painted. */
function builder(/** @type {string} */ id) {
  const bones = /** @type {any[]} */ ([]);
  const img = blank(TEX, TEX);
  const shelf = { x: 0, y: 0, h: 0 };
  const byName = new Map();
  return {
    bone(/** @type {string} */ name, /** @type {string | undefined} */ parent, /** @type {number[]} */ pivot, /** @type {number[]} */ rotation = [0, 0, 0]) {
      const bone = { name, ...(parent ? { parent } : {}), pivot, ...(rotation.some((r) => r !== 0) ? { rotation } : {}), cubes: [] };
      bones.push(bone);
      byName.set(name, bone);
      return name;
    },
    cube(/** @type {string} */ bone, /** @type {number[]} */ origin, /** @type {number[]} */ size, /** @type {Paint} */ paint) {
      const [w, h, d] = size.map(Math.ceil);
      const rw = 2 * (w + d), rh = d + h;
      if (shelf.x + rw > TEX) Object.assign(shelf, { x: 0, y: shelf.y + shelf.h, h: 0 });
      if (shelf.y + rh > TEX) throw new Error(`${id}: the texture is full`);
      const cube = { origin, size, uv: [shelf.x, shelf.y] };
      shelf.x += rw;
      shelf.h = Math.max(shelf.h, rh);
      byName.get(bone).cubes.push(cube);
      for (const [face, f] of Object.entries(facesOf(cube))) {
        const x0 = Math.min(f.uv[0], f.uv[0] + f.uv_size[0]), y0 = Math.min(f.uv[1], f.uv[1] + f.uv_size[1]);
        const fw = Math.abs(f.uv_size[0]), fh = Math.abs(f.uv_size[1]);
        for (let j = 0; j < Math.ceil(fh); j++) for (let i = 0; i < Math.ceil(fw); i++) {
          const c = paint(face, (i + 0.5) / fw, (j + 0.5) / fh, i, j);
          if (!c) continue;
          const n = 0.95 + 0.07 * hash(x0 + i, y0 + j);
          img.data.set([...c.slice(0, 3).map((v) => Math.min(255, Math.round(v * n))), c[3] ?? 255], ((Math.floor(y0) + j) * TEX + Math.floor(x0) + i) * 4);
        }
      }
    },
    done() {
      for (const b of bones) if (!b.cubes.length) delete b.cubes;
      return {
        geometry: { description: { identifier: `geometry.minepreggo.${id}_source`, texture_width: TEX, texture_height: TEX }, bones },
        png: encodePng(img),
      };
    },
  };
}

const solid = (/** @type {Colour} */ c) => /** @type {Paint} */ (() => c);
/** Two colours by height: the top `split` of each side (and its top face) in one, the rest in the other. */
const bands = (/** @type {Colour} */ top, /** @type {Colour} */ bottom, /** @type {number} */ split) =>
  /** @type {Paint} */ ((face, _x, y) => (face === 'up' ? top : face === 'down' ? bottom : y < split ? top : bottom));
/** A front of one colour, the rest of another. */
const front = (/** @type {Colour} */ f, /** @type {Colour} */ rest) => /** @type {Paint} */ ((face) => (face === 'north' ? f : rest));

/**
 * The girl's body in Minepreggo's layout: head, body (hips, waist, chest), boobs, arms and legs, each
 * painted by its own paint.
 * @param {ReturnType<typeof builder>} b
 * @param {{ head: Paint, chest: Paint, waist: Paint, hips: Paint, bust: Paint, arm: Paint, leg: Paint }} paint
 */
function body(b, paint) {
  b.bone('head', undefined, [0, 24, 0]);
  b.cube('head', [-4, 24, -4], [8, 8, 8], paint.head);
  b.bone('body', undefined, [0, 24, 0]);
  b.cube('body', [-4, 12, -2], [8, 3, 4], paint.hips);
  b.cube('body', [-3.5, 15, -2], [7, 3, 4], paint.waist);
  b.cube('body', [-4, 18, -2], [8, 6, 4], paint.chest);
  b.bone('boobs', 'body', [0, 20.5, -2]);
  b.bone('right_boob', 'boobs', [-2.2, 20.5, -2]);
  b.cube('right_boob', [-4.2, 19, -4], [4, 3, 2], paint.bust);
  b.bone('left_boob', 'boobs', [2.2, 20.5, -2]);
  b.cube('left_boob', [0.2, 19, -4], [4, 3, 2], paint.bust);
  b.bone('right_arm', undefined, [-5, 22, 0]);
  b.cube('right_arm', [-7, 12, -1.5], [3, 12, 3], paint.arm);
  b.bone('left_arm', undefined, [5, 22, 0]);
  b.cube('left_arm', [4, 12, -1.5], [3, 12, 3], paint.arm);
  b.bone('right_leg', undefined, [-2, 12, 0]);
  b.cube('right_leg', [-4, 0, -2], [4, 12, 4], paint.leg);
  b.bone('left_leg', undefined, [2, 12, 0]);
  b.cube('left_leg', [0, 0, -2], [4, 12, 4], paint.leg);
}

/** A face on a head's front: eyes (by column, at a row), and whatever else is drawn on it. */
const face = (/** @type {Colour} */ skin, /** @type {Record<string, Colour>} */ pixels, /** @type {Paint} */ rest = solid(skin)) =>
  /** @type {Paint} */ ((f, x, y, i, j) => (f === 'north' ? pixels[`${i},${j}`] ?? skin : rest(f, x, y, i, j)));

// ---- Gardevoir: white, her green bob over one eye, red eyes, the red fins at her chest and back, green
// arms, and her white gown open at the front, lined in dark green ----------------------------------------
function gardevoir() {
  const W = [244, 244, 248], G = [98, 214, 112], DG = [32, 74, 46], R = [226, 62, 76], EYE = [214, 28, 40], LASH = [40, 40, 48];
  const b = builder('gardevoir');
  body(b, {
    head: face(W, { '2,4': EYE, '5,4': EYE, '1,3': LASH, '2,3': LASH, '5,3': LASH, '6,3': LASH, '3,6': [210, 200, 206], '4,6': [210, 200, 206] }),
    chest: solid(W), waist: solid(W), hips: solid(W), bust: solid(W),
    arm: bands(G, W, 0.84), leg: solid(W),
  });
  b.bone('hair', 'head', [0, 24, 0]);
  b.cube('hair', [-4.5, 29, -4.5], [9, 4, 9], solid(G));
  b.cube('hair', [-5, 23, -3.5], [1, 7, 7], solid(G));
  b.cube('hair', [4, 23, -3.5], [1, 7, 7], solid(G));
  b.cube('hair', [-4.5, 23, 3.5], [9, 7, 1], solid(G));
  b.cube('hair', [-4.6, 25.5, -5], [5, 4, 1], solid(G));
  b.bone('fin_front', 'body', [0, 20, -3], [-32, 0, 0]);
  b.cube('fin_front', [-0.5, 19.5, -7], [1, 2, 5], solid(R));
  b.bone('fin_back', 'body', [0, 20, 2], [30, 0, 0]);
  b.cube('fin_back', [-0.5, 19, 2], [1, 3, 4], solid(R));
  // her gown: two side panels and a back flaring out from her waist to her ankles, white outside and
  // dark green within
  const lined = (/** @type {string} */ inner) => /** @type {Paint} */ ((f) => (f === inner ? DG : W));
  b.bone('gown_r', 'body', [-5.5, 15, 0], [0, 0, -7]);
  b.cube('gown_r', [-7.5, 1, -3.5], [2, 14, 7], lined('west'));
  b.bone('gown_l', 'body', [5.5, 15, 0], [0, 0, 7]);
  b.cube('gown_l', [5.5, 1, -3.5], [2, 14, 7], lined('east'));
  b.bone('gown_b', 'body', [0, 15, 2.5], [9, 0, 0]);
  b.cube('gown_b', [-6.5, 1, 2.5], [13, 14, 2], lined('north'));
  return b.done();
}

// ---- Lucario: blue, a black mask round her red eyes and a black snout, pointed ears, the four black
// tendrils at the back of her head, a cream chest, black paws and feet, white spikes on her chest and
// the backs of her paws, a blue tail --------------------------------------------------------------------
function lucario() {
  const B = [62, 138, 214], K = [38, 38, 46], C = [238, 224, 182], S = [244, 244, 244], EYE = [222, 44, 40];
  const b = builder('lucario');
  const head = /** @type {Paint} */ ((f, _x, y, i, j) => {
    if (f === 'up' || f === 'south') return B;
    if (f === 'down') return K;
    if (f === 'north' && j === 4 && (i === 2 || i === 5)) return EYE;
    if (f === 'north' && j === 4 && (i === 1 || i === 6)) return S;
    return y > 0.3 && y < 0.7 ? K : B;
  });
  body(b, {
    head, chest: front(C, B), waist: front(C, B), hips: solid(B), bust: front(C, B),
    arm: bands(B, K, 0.5), leg: bands(B, K, 0.55),
  });
  b.bone('snout', 'head', [0, 25, -4]);
  b.cube('snout', [-1.5, 24.5, -6.5], [3, 2.5, 2.5], (f, _x, y) => (f === 'down' ? C : f === 'north' && y < 0.4 ? [20, 20, 24] : K));
  for (const [side, x, turn] of /** @type {const} */ ([['r', -2.5, 12], ['l', 2.5, -12]])) {
    b.bone(`ear_${side}`, 'head', [x, 32, 0], [0, 0, turn]);
    b.cube(`ear_${side}`, [x - 1, 32, -0.5], [2, 5, 1], (f, x2, y) => (f === 'north' && y > 0.3 && x2 > 0.3 && x2 < 0.7 ? K : B));
  }
  b.bone('tendrils', 'head', [0, 28, 4], [14, 0, 0]);
  for (const x of [-3, -1.6, 0.6, 2]) b.cube('tendrils', [x, 21, 3.6], [1, 7, 1], solid(K));
  b.bone('spike', 'body', [0, 22.5, -2]);
  b.cube('spike', [-0.5, 22.4, -4], [1, 1, 2], solid(S));
  b.cube('right_arm', [-6, 13.5, 1.5], [1, 1, 2], solid(S));
  b.cube('left_arm', [5, 13.5, 1.5], [1, 1, 2], solid(S));
  b.bone('tail', 'body', [0, 13.5, 2], [38, 0, 0]);
  b.cube('tail', [-1, 7.5, 1.5], [2, 6, 2], solid(B));
  return b.done();
}

// ---- Lopunny: brown, red eyes on black, a pink nose, her long ears up and drooping, pink inside and
// cream-tufted, cream fluff at her wrists and from her knees down, a cream tail puff ----------------------
function lopunny() {
  const Br = [158, 104, 70], Cr = [246, 228, 172], Pk = [242, 150, 172], EYE = [226, 52, 74], K = [24, 20, 22];
  const b = builder('lopunny');
  body(b, {
    head: face(Br, { '1,4': K, '2,4': EYE, '5,4': EYE, '6,4': K, '1,3': K, '6,3': K, '3,5': Pk, '4,5': Pk, '3,6': [120, 76, 52], '4,6': [120, 76, 52] }),
    chest: solid(Br), waist: solid(Br), hips: solid(Br), bust: solid(Br),
    arm: solid(Br), leg: bands(Br, Cr, 0.55),
  });
  for (const [side, x, turn] of /** @type {const} */ ([['r', -2.5, 10], ['l', 2.5, -10]])) {
    b.bone(`ear_${side}`, 'head', [x, 31.5, 0.5], [-6, 0, turn]);
    b.cube(`ear_${side}`, [x - 1.5, 31.5, 0], [3, 9, 1], (f, x2, y) => (y < 0.25 && f !== 'down' ? Cr : f === 'north' && x2 > 0.2 && x2 < 0.8 ? Pk : Br));
    // (the rest of the ear droops from its top, down behind her head to her shoulders, a cream tuft at its end)
    b.bone(`ear_${side}_droop`, `ear_${side}`, [x, 40.5, 0.5], [-150, 0, side === 'r' ? 10 : -10]);
    b.cube(`ear_${side}_droop`, [x - 1.5, 40.5, 0], [3, 13, 1], (f, _x, y) => (f === 'up' || y > 0.78 ? Cr : Br));
  }
  for (const [arm, x] of /** @type {const} */ ([['right_arm', -7.5], ['left_arm', 3.5]])) b.cube(arm, [x, 12.5, -2], [4, 3, 4], solid(Cr));
  for (const [leg, x] of /** @type {const} */ ([['right_leg', -4.5], ['left_leg', -0.5]])) b.cube(leg, [x, 0.5, -2.5], [5, 4, 5], solid(Cr));
  b.bone('tail', 'body', [0, 13, 2]);
  b.cube('tail', [-1.5, 12, 2], [3, 3, 2], solid(Cr));
  return b.done();
}

// ---- from Pokédrock's models (vendor/pokedrock/pokedrock.zip: tools/compat-addons.mjs), where it is there --------
const ZIP = new URL('../../vendor/pokedrock/pokedrock.zip', import.meta.url);
/** @type {Record<string, Uint8Array> | null | undefined} its models and textures, once read */
let pokedrock;
const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
/**
 * A Pokédrock Pokémon's model in our girls' layout: its grouping bones gone (her head, arms and legs
 * hang from her body or loose, as ours), head1 her head, her blinking and angry eyes left out (they
 * would show over her open ones), her arms (held out, as its Pokémon stand) hanging at her sides, and
 * a bust in her torso's texture for the import's curves to fill out.
 * @param {string} id its geometry @param {string} texture its texture
 */
function fromPokedrock(id, texture) {
  pokedrock ??= existsSync(ZIP) ? unzipSync(new Uint8Array(readFileSync(ZIP)), { filter: (f) => f.name.startsWith('R/models/') || f.name.startsWith('R/textures/entity/normal/') }) : null;
  if (!pokedrock) return undefined;
  const png = pokedrock[`R/${texture}.png`];
  let source;
  for (const [name, data] of Object.entries(pokedrock)) {
    if (!name.endsWith('.json') || !name.startsWith('R/models/')) continue;
    const text = strFromU8(data);
    if (!text.includes(id.replace('geometry.', ''))) continue;
    source = JSON.parse(text.replace(/^\uFEFF/, ''))['minecraft:geometry']?.find((/** @type {any} */ g) => g.description?.identifier === id);
    if (source) break;
  }
  if (!source || !png) return undefined;
  const g = structuredClone(source);
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  const gone = new Set(['closed_eyes', 'angry_eyes'].filter((n) => byName.has(n)).flatMap(under));
  // (bones that only group others: no cubes, no turn)
  for (const b of g.bones) if (!b.cubes?.length && !b.rotation && ['body_root', 'arms', 'legs'].includes(b.name) || !b.parent && !b.cubes?.length && !b.rotation) gone.add(b.name);
  const keptParent = (/** @type {string | undefined} */ n) => { while (n && gone.has(n)) n = byName.get(n)?.parent; return n; };
  g.bones = g.bones.filter((/** @type {any} */ b) => !gone.has(b.name));
  for (const b of g.bones) {
    const parent = keptParent(b.parent);
    if (parent) b.parent = parent; else delete b.parent;
    if (b.name === 'head1') b.name = 'head';
    if (b.parent === 'head1') b.parent = 'head';
  }
  // her arms down at her sides (held out level, they would swing level in her walk and poses)
  for (const [name, side] of /** @type {const} */ ([['right_arm', -1], ['left_arm', 1]])) {
    const arm = g.bones.find((/** @type {any} */ b) => b.name === name);
    const cubes = arm ? under(name).flatMap((n) => g.bones.find((/** @type {any} */ b) => b.name === n)?.cubes ?? []) : [];
    if (!arm || !cubes.length) continue;
    const dx = cubes.reduce((s, c) => s + c.origin[0] + c.size[0] / 2 - arm.pivot[0], 0) / cubes.length;
    const dy = cubes.reduce((s, c) => s + c.origin[1] + c.size[1] / 2 - arm.pivot[1], 0) / cubes.length;
    if (Math.abs(dx) > Math.abs(dy)) arm.rotation = [0, 0, r3(side * 78 + (arm.rotation?.[2] ?? 0))];
  }
  // her bust: two breasts from the top of her torso's front, in its texture
  const body = g.bones.find((/** @type {any} */ b) => b.name === 'body');
  const torso = [...(body?.cubes ?? [])].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
  if (torso) {
    const [x0, y0, z0] = torso.origin, [w, h] = torso.size;
    const front = facesOf(torso).north;
    const b = r3(Math.max(1.6, w * 0.46)), top = y0 + h - h * 0.12, yb = r3(top - b);
    const patch = part(front, 0.1, 0.9, 0.1, 0.45);
    const uv = { north: patch, south: patch, east: patch, west: patch, up: patch, down: patch };
    g.bones.push({ name: 'boobs', parent: 'body', pivot: [0, r3(top - b / 2), z0] });
    for (const [side, s] of /** @type {const} */ ([['right_boob', -1], ['left_boob', 1]])) {
      g.bones.push({ name: side, parent: 'boobs', pivot: [r3(s * b / 2), r3(top - b / 2), z0], rotation: [12, s * -6, 0],
        cubes: [{ origin: [r3(s < 0 ? -b - 0.05 : 0.05), yb, r3(z0 - b * 0.85)], size: [b, b, r3(b * 0.95)], uv }] });
    }
  }
  return { geometry: g, png };
}

/** Each girl's model and texture, and how she is a Jenny's Preggo Mob (tools/import-jenny-preggo.mjs). */
export const POKEMON = [
  // (Gardevoir and Lucario on Pokédrock's models, where it is there; ours otherwise)
  { made: () => fromPokedrock('geometry.serpgardevoir', 'textures/entity/normal/gardevoir') ?? gardevoir(), minWidth: 8, key: 'gardevoir', name: 'Gardevoir', birth: 'kum:luna',
    kicks: { name: 'jp_gardevoir', order: [2, 0, 4, 1, 3], rate: 0.9, emphasis: [1.0, 1.2, 0.9, 1.1, 1.3] },
    treats: ['minecraft:amethyst_shard', 'minecraft:sweet_berries', 'minecraft:cake'], biomes: ['meadow', 'forest', 'plains'], egg: { base_color: '#f4f4f8', overlay_color: '#5ad46a' },
    curves: 'most', navel: true, tone: [244, 244, 248] },
  { made: () => fromPokedrock('geometry.serplucario', 'textures/entity/normal/lucario') ?? lucario(), minWidth: 8, key: 'lucario', name: 'Lucario', birth: 'fapcraft:jenny',
    kicks: { name: 'jp_lucario', order: [3, 1, 0, 4, 2], rate: 1.3, emphasis: [1.4, 1.2, 1.0, 1.3, 0.9] },
    treats: ['minecraft:cooked_beef', 'minecraft:bone', 'minecraft:cake'], biomes: ['taiga', 'extreme_hills', 'forest'], egg: { base_color: '#3e8ad6', overlay_color: '#26262e' },
    curves: 'most', navel: true, tone: [238, 224, 182] },
  { made: lopunny, key: 'lopunny', name: 'Lopunny', birth: 'kum:bia',
    kicks: { name: 'jp_lopunny', order: [1, 4, 2, 0, 3], rate: 1.1, emphasis: [1.1, 1.4, 1.0, 0.9, 1.2] },
    treats: ['minecraft:carrot', 'minecraft:golden_carrot', 'minecraft:cake'], biomes: ['plains', 'forest', 'meadow'], egg: { base_color: '#9e6846', overlay_color: '#f6e4ac' },
    curves: 'most', navel: true, tone: [158, 104, 70] },
];
