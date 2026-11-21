// The Pokémon girls (Gardevoir, Lucario, Lopunny, Lycanroc) as curvy blocky girls in the Jenny mod's
// style: a body of our own built cube by cube (long legs, thick thighs to slim calves, wide hips and a
// full seat, a narrow waist, a big bust, slim arms) painted pixel by pixel with soft shading, and her
// Pokémon's own head (and tail) from Pokédrock's models where it is there (vendor/pokedrock/
// pokedrock.zip: tools/compat-addons.mjs), else heads of our own. Each has a dressed look (a bikini,
// Gardevoir's top) and her bare one. In the bone layout of Minepreggo's own girls (head, body with its
// hips, waist and chest, boobs, arms and legs), so tools/import-jenny-preggo.mjs makes them into curvy
// Jenny's Preggo Mobs like the others; generated at import time into its git-ignored port folder (they
// are fan likenesses of other people's characters).
import { existsSync, readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { blank, decodePng, encodePng } from './png.mjs';
import { facesOf } from './box-uv.mjs';

const TEX = 128;
/** @typedef {number[]} Colour */
/** @typedef {(face: string, x: number, y: number, i: number, j: number) => Colour | undefined} Paint a face's colour at (x, y) across and down it (0 to 1), at its pixel (i, j) */

const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
const hash = (/** @type {number} */ x, /** @type {number} */ y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Soft light from above and in front: the front brightest at its middle, the sides and back darker, the underside darkest. */
const light = (/** @type {string} */ face, /** @type {number} */ x, /** @type {number} */ y) => {
  if (face === 'up') return 1.06;
  if (face === 'down') return 0.7;
  const base = face === 'north' ? 1 : face === 'south' ? 0.86 : 0.8;
  return base * (1.05 - 0.12 * y) * (face === 'north' || face === 'south' ? 0.94 + 0.08 * (1 - Math.abs(2 * x - 1)) : 1);
};

/**
 * A model being built: bones, and box-UV cubes packed into one texture as they are painted (its bare
 * look and its dressed one), with room below for a Pokédrock texture its grafted parts use.
 */
function builder(/** @type {string} */ id, res = 1) {
  // (res: pixels to a unit, our own painting finer, for faces with detail; not with a grafted texture)
  const bones = /** @type {any[]} */ ([]);
  const bare = blank(TEX * res, TEX * res), dressed = blank(TEX * res, TEX * res);
  const shelf = { x: 0, y: 0, h: 0 };
  const byName = new Map();
  /** @type {{ width: number, height: number, data: Uint8Array } | undefined} */
  let attached;
  /** its size as its model declares it (its image is that times its resolution) */
  let declared = { width: 0, height: 0 };
  const put = (/** @type {any} */ img, /** @type {number} */ x, /** @type {number} */ y, /** @type {Colour} */ c, /** @type {number} */ k) =>
    img.data.set([...c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))), c[3] ?? 255], (y * TEX * res + x) * 4);
  return {
    has: (/** @type {string} */ name) => byName.has(name),
    bone(/** @type {string} */ name, /** @type {string | undefined} */ parent, /** @type {number[]} */ pivot, /** @type {number[]} */ rotation = [0, 0, 0]) {
      const bone = { name, ...(parent ? { parent } : {}), pivot, ...(rotation.some((r) => r !== 0) ? { rotation } : {}), cubes: [] };
      bones.push(bone);
      byName.set(name, bone);
      return name;
    },
    /** A cube painted bare by `paint` and dressed by `clothes` (else as bare). */
    cube(/** @type {string} */ bone, /** @type {number[]} */ origin, /** @type {number[]} */ size, /** @type {Paint} */ paint, /** @type {Paint | undefined} */ clothes = undefined) {
      const [w, h, d] = size.map(Math.ceil);
      const rw = 2 * (w + d), rh = d + h;
      if (shelf.x + rw > TEX) Object.assign(shelf, { x: 0, y: shelf.y + shelf.h, h: 0 });
      if (shelf.y + rh > TEX) throw new Error(`${id}: the texture is full`);
      const cube = { origin, size, uv: [shelf.x, shelf.y] };
      shelf.x += rw;
      shelf.h = Math.max(shelf.h, rh);
      byName.get(bone).cubes.push(cube);
      for (const [face, f] of Object.entries(facesOf(cube))) {
        // (in pixels: a face of a fractional size or place covers every pixel it touches)
        const u0 = Math.min(f.uv[0], f.uv[0] + f.uv_size[0]) * res, v0 = Math.min(f.uv[1], f.uv[1] + f.uv_size[1]) * res;
        const fw = Math.abs(f.uv_size[0]) * res, fh = Math.abs(f.uv_size[1]) * res;
        const x0 = Math.floor(u0), y0 = Math.floor(v0);
        for (let j = 0; j < Math.ceil(v0 + fh) - y0; j++) for (let i = 0; i < Math.ceil(u0 + fw) - x0; i++) {
          const x = Math.min(0.999, Math.max(0, (x0 + i + 0.5 - u0) / fw)), y = Math.min(0.999, Math.max(0, (y0 + j + 0.5 - v0) / fh));
          const pi = Math.floor(x * fw), pj = Math.floor(y * fh);
          const k = light(face, x, y) * (0.96 + 0.06 * hash(x0 + i, y0 + j));
          const c = paint(face, x, y, pi, pj);
          if (c) put(bare, x0 + i, y0 + j, c, k);
          const cd = clothes?.(face, x, y, pi, pj) ?? c;
          if (cd) put(dressed, x0 + i, y0 + j, cd, k);
        }
      }
      return cube;
    },
    /** Grafts bones of a Pokédrock model (with their texture, put below ours), moved and scaled into place. */
    graft(/** @type {{ geometry: any, png: Uint8Array }} */ source, /** @type {{ root: string, as: string, parent?: string, from: number[], to: number[], scale?: number, rotation?: number[] }} */ o) {
      const g = source.geometry;
      if (!attached) {
        attached = decodePng(source.png);
        declared = { width: g.description.texture_width ?? attached.width, height: g.description.texture_height ?? attached.height };
      }
      const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n && !/closed|closet|angry/.test(b.name)).flatMap((/** @type {any} */ b) => under(b.name))];
      const k = o.scale ?? 1;
      const move = (/** @type {number[]} */ p) => p.map((v, i) => r3(o.to[i] + (v - o.from[i]) * k));
      for (const name of under(o.root)) {
        const src = g.bones.find((/** @type {any} */ b) => b.name === name);
        const bone = {
          name: name === o.root ? o.as : `${o.as}_${name}`,
          ...(name === o.root ? (o.parent ? { parent: o.parent } : {}) : { parent: src.parent === o.root ? o.as : `${o.as}_${src.parent}` }),
          pivot: move(src.pivot ?? [0, 0, 0]),
          ...(name === o.root && o.rotation ? { rotation: o.rotation } : src.rotation ? { rotation: src.rotation } : {}),
          cubes: (src.cubes ?? []).map((/** @type {any} */ c) => {
            // (per-face, shifted below our texture, so it can be scaled without its texture sliding)
            const faces = Object.fromEntries(Object.entries(facesOf(c, src.mirror)).map(([f, uv]) => [f, { uv: [uv.uv[0], uv.uv[1] + TEX], uv_size: uv.uv_size }]));
            return { origin: move(c.origin), size: c.size.map((/** @type {number} */ s) => r3(s * k)), uv: faces, ...(c.inflate ? { inflate: r3(c.inflate * k) } : {}), ...(c.rotation ? { rotation: c.rotation, pivot: move(c.pivot ?? [0, 0, 0]) } : {}) };
          }),
        };
        bones.push(bone);
        byName.set(bone.name, bone);
      }
    },
    done() {
      for (const b of bones) if (!b.cubes?.length) delete b.cubes;
      if (res > 1) {
        if (attached) throw new Error(`${id}: a finer painting cannot take a grafted texture`);
        return { geometry: { description: { identifier: `geometry.minepreggo.${id}_source`, texture_width: TEX, texture_height: TEX }, bones }, png: encodePng(bare), dressed: encodePng(dressed) };
      }
      // (ours drawn up to the grafted texture's resolution, which is finer than its model declares)
      const up = attached ? Math.max(1, Math.round(attached.width / declared.width)) : 1;
      const width = Math.max(TEX, declared.width), height = TEX + declared.height;
      const sheet = (/** @type {any} */ ours) => {
        const img = blank(width * up, height * up);
        for (let y = 0; y < TEX * up; y++) for (let x = 0; x < TEX * up; x++) {
          const i = (Math.floor(y / up) * TEX + Math.floor(x / up)) * 4;
          img.data.set(ours.data.subarray(i, i + 4), (y * width * up + x) * 4);
        }
        if (attached) for (let y = 0; y < attached.height; y++) img.data.set(attached.data.subarray(y * attached.width * 4, (y + 1) * attached.width * 4), ((TEX * up + y) * width * up) * 4);
        return encodePng(img);
      };
      return {
        geometry: { description: { identifier: `geometry.minepreggo.${id}_source`, texture_width: width, texture_height: height }, bones },
        png: sheet(bare), dressed: sheet(dressed),
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
/** A paint over another where `where` says. */
const over = (/** @type {Paint} */ base, /** @type {Colour} */ c, /** @type {(face: string, x: number, y: number) => boolean} */ where) =>
  /** @type {Paint} */ ((face, x, y, i, j) => (where(face, x, y) ? c : base(face, x, y, i, j)));

/**
 * Her body, the Jenny mod's way: long legs (thick thighs, slim calves, small feet), wide hips and a
 * full seat (the import's curves flare them), a narrow waist, a chest with a big bust, slim arms.
 * Her head goes on top at y 27 (the head bone's pivot is her neck, at 26.5).
 * @param {ReturnType<typeof builder>} b
 * @param {{ chest: Paint, waist: Paint, hips: Paint, bust: Paint, upperArm: Paint, forearm: Paint, thigh: Paint, calf: Paint, foot: Paint, neck: Paint }} p bare
 * @param {{ bust?: Paint, chest?: Paint, hips?: Paint, waist?: Paint, upperArm?: Paint, thigh?: Paint, calf?: Paint, foot?: Paint }} [d] dressed, where it differs
 */
function curvyBody(b, p, d = {}) {
  b.bone('body', undefined, [0, 26, 0]);
  b.cube('body', [-4.2, 14, -2.1], [8.4, 3, 4.2], p.hips, d.hips);
  b.cube('body', [-3, 17, -1.8], [6, 3, 3.6], p.waist, d.waist);
  b.cube('body', [-3.8, 20, -2], [7.6, 6, 4], p.chest, d.chest);
  b.cube('body', [-1.2, 26, -1.2], [2.4, 1, 2.4], p.neck);
  b.bone('boobs', 'body', [0, 23, -2]);
  // (each breast grows about its middle: apart, with a cleavage between)
  b.bone('right_boob', 'boobs', [-1.9, 22.6, -3.2], [12, 6, 0]);
  b.cube('right_boob', [-3.6, 21, -4.4], [3.4, 3.2, 2.4], p.bust, d.bust);
  b.bone('left_boob', 'boobs', [1.9, 22.6, -3.2], [12, -6, 0]);
  b.cube('left_boob', [0.2, 21, -4.4], [3.4, 3.2, 2.4], p.bust, d.bust);
  for (const [arm, x, s] of /** @type {const} */ ([['right_arm', -5, -1], ['left_arm', 5, 1]])) {
    b.bone(arm, undefined, [x, 25, 0]);
    b.cube(arm, [s < 0 ? -6.4 : 4, 18.5, -1.2], [2.4, 7, 2.4], p.upperArm, d.upperArm);
    b.cube(arm, [s < 0 ? -6.3 : 4.1, 13.5, -1.1], [2.2, 5, 2.2], p.forearm);
  }
  for (const [leg, x, s] of /** @type {const} */ ([['right_leg', -2.1, -1], ['left_leg', 2.1, 1]])) {
    b.bone(leg, undefined, [x, 14, 0]);
    b.cube(leg, [s < 0 ? -4.2 : 0, 7.5, -2.1], [4.2, 6.5, 4.2], p.thigh, d.thigh);
    b.cube(leg, [s < 0 ? -3.75 : 0.45, 3, -1.7], [3.3, 4.5, 3.4], p.calf, d.calf);
    b.cube(leg, [s < 0 ? -3.6 : 0.6, 0, -2.3], [3, 3, 3.6], p.foot, d.foot);
  }
}
/** A bikini: its top over her bust (a halter at her chest) and its bottoms over her hips, a lighter edge. */
const bikini = (/** @type {Colour} */ c, /** @type {Paint} */ chest, /** @type {Paint} */ hips) => {
  const edge = c.map((v) => Math.min(255, v + 40));
  return {
    bust: /** @type {Paint} */ ((face, _x, y) => (face === 'up' ? undefined : y < 0.12 ? edge : c)),
    chest: over(chest, c, (face, x, y) => face === 'north' && y > 0.2 && y < 0.36 && Math.abs(x - 0.5) > 0.2 || (face === 'south' || face === 'east' || face === 'west') && y > 0.42 && y < 0.55),
    hips: over(hips, c, (face, x, y) => face === 'down' || (face === 'north' ? y > 0.25 && Math.abs(x - 0.5) < 0.2 + 0.32 * y : face === 'south' ? y > 0.15 : y > 0.45)),
  };
};

// ---- Pokédrock's models (vendor/pokedrock/pokedrock.zip), where they are there ---------------------------
const ZIP = new URL('../../vendor/pokedrock/pokedrock.zip', import.meta.url);
/** @type {Record<string, Uint8Array> | null | undefined} */
let pokedrock;
/** A Pokédrock geometry and its texture, or nothing without Pokédrock. */
function pokedrockModel(/** @type {string} */ id, /** @type {string} */ texture) {
  pokedrock ??= existsSync(ZIP) ? unzipSync(new Uint8Array(readFileSync(ZIP)), { filter: (f) => f.name.startsWith('R/models/') || f.name.startsWith('R/textures/entity/normal/') || f.name.startsWith('R/textures/entity/shiny/') }) : null;
  const png = pokedrock?.[`R/${texture}.png`];
  if (!pokedrock || !png) return undefined;
  for (const [name, data] of Object.entries(pokedrock)) {
    if (!name.startsWith('R/models/') || !name.endsWith('.json')) continue;
    const text = strFromU8(data);
    if (!text.includes(`"${id}"`)) continue;
    const geometry = JSON.parse(text.replace(/^﻿/, ''))['minecraft:geometry']?.find((/** @type {any} */ g) => g.description?.identifier === id);
    if (geometry) return { geometry, png };
  }
  return undefined;
}
/** Grafts a Pokédrock head (and what hangs from it) onto her neck, `scale` times its size: its main cube's bottom middle at her neck's top. */
function pokedrockHead(/** @type {ReturnType<typeof builder>} */ b, /** @type {{ geometry: any, png: Uint8Array }} */ source, scale = 1.3) {
  const head = source.geometry.bones.find((/** @type {any} */ x) => x.name === 'head1');
  const main = [...(head.cubes ?? [])].sort((a, c) => c.size[0] * c.size[1] * c.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
  const from = [main.origin[0] + main.size[0] / 2, main.origin[1], main.origin[2] + main.size[2] / 2];
  b.graft(source, { root: 'head1', as: 'head', from, to: [0, 27, 0], scale });
  b.bone('head_neck', 'head', [0, 26.5, 0]);
}

// ---- Gardevoir: white, her bob over one eye, green arms, the red horn rising between her breasts and a
// fin at her back, her long gown flaring from her hips, green within, open at the front over her thick
// thighs; dressed, a crop top and black leggings torn open at her thighs. Shiny (one in eight): blue -----
function gardevoir() {
  const W = [246, 246, 250], R = [230, 74, 96];
  return [
    { arms: [122, 212, 132], inner: [40, 92, 56], tex: 'textures/entity/normal/gardevoir' },
    { arms: [96, 162, 232], inner: [38, 78, 140], tex: 'textures/entity/shiny/gardevoir' },
  ].map(({ arms: G, inner: DG, tex }, n) => {
    const b = builder(`gardevoir_${n}`);
    const pd = pokedrockModel('geometry.serpgardevoir', tex);
    // (dressed: a pale crop top over her bust; leggings to her ankles, torn open on her thighs and calves)
    const TOP = [236, 226, 242], LEG = [54, 46, 62];
    const torn = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) => /** @type {Paint} */ ((face, x, y) =>
      face !== 'up' && face !== 'down' && (face === 'north' || face === 'east' || face === 'west') && ((x - cx) ** 2) / (r * r) + ((y - cy) ** 2) / (r * r * 1.4) < 1 ? W : LEG);
    curvyBody(b, {
      chest: solid(W), waist: solid(W), hips: solid(W), bust: solid(W), neck: solid(W),
      upperArm: solid(G), forearm: solid(G), thigh: solid(W), calf: solid(W), foot: solid(W),
    }, {
      bust: solid(TOP), chest: over(solid(W), TOP, (face, _x, y) => face !== 'up' && y > 0.2),
      hips: over(solid(W), LEG, (face, x, y) => face !== 'up' && (face !== 'north' || y > 0.3 || Math.abs(x - 0.5) > 0.3)),
      thigh: torn(0.5, 0.42, 0.3), calf: torn(0.45, 0.5, 0.26), foot: solid(LEG),
    });
    if (pd) pokedrockHead(b, pd, 1.35);
    else {
      b.bone('head', undefined, [0, 26.5, 0]);
      b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], (f, _x, _y, i, j) => (f === 'north' && j === 3 && (i === 2 || i === 4) ? [214, 28, 40] : W));
      b.cube('head', [-4, 30, -4], [8, 4.5, 8], solid(G));
      b.cube('head', [-4.4, 26, -3], [1, 6, 6], solid(G));
      b.cube('head', [3.4, 26, -3], [1, 6, 6], solid(G));
    }
    // her horn: a red blade from her breastbone between her breasts, up toward her chin
    b.bone('fin_front', 'body', [0, 23.4, -2.6], [-42, 0, 0]);
    b.cube('fin_front', [-0.6, 22.6, -8.4], [1.2, 3.2, 6], (f, _x, y) => (f === 'up' ? [244, 120, 136] : R));
    b.bone('fin_back', 'body', [0, 23, 2], [34, 0, 0]);
    b.cube('fin_back', [-0.6, 21.6, 2], [1.2, 3.6, 5], solid(R));
    // her gown: long panels from the sides of her hips, two at her sides and two trailing behind her,
    // flaring to the ground, lined within; between them her thighs and her seat show
    const lined = (/** @type {string} */ inner) => /** @type {Paint} */ ((f) => (f === inner || f === 'down' ? DG : W));
    b.bone('gown_r', 'body', [-6, 15.5, -0.5], [0, 0, -12]);
    b.cube('gown_r', [-7.2, 0.3, -3.6], [1.2, 15.2, 6.4], lined('west'));
    b.bone('gown_l', 'body', [6, 15.5, -0.5], [0, 0, 12]);
    b.cube('gown_l', [6, 0.3, -3.6], [1.2, 15.2, 6.4], lined('east'));
    b.bone('gown_br', 'body', [-4, 15, 3], [16, 28, 0]);
    b.cube('gown_br', [-7, 0, 3], [5.5, 15, 1.2], lined('north'));
    b.bone('gown_bl', 'body', [4, 15, 3], [16, -28, 0]);
    b.cube('gown_bl', [1.5, 0, 3], [5.5, 15, 1.2], lined('north'));
    return b.done();
  });
}

// ---- Lucario: blue, a cream chest and belly front, black forearms and paws, black calves and feet, white
// spikes on her chest and paws, her tail; a black bikini ----------------------------------------------------
function lucario() {
  const B = [70, 142, 218], K = [40, 40, 48], C = [240, 226, 186], S = [246, 246, 246];
  const b = builder('lucario');
  const pd = pokedrockModel('geometry.serplucario', 'textures/entity/normal/lucario');
  const chest = front(C, B), waist = front(C, B), hips = solid(B);
  curvyBody(b, {
    chest, waist, hips, bust: front(C, B), neck: solid(C),
    upperArm: solid(B), forearm: solid(K), thigh: solid(B), calf: solid(K), foot: solid(K),
  }, bikini(K, chest, hips));
  if (pd) {
    pokedrockHead(b, pd, 1.3);
    const tail = pd.geometry.bones.find((/** @type {any} */ x) => x.name === 'tail');
    if (tail) b.graft(pd, { root: 'tail', as: 'tail', parent: 'body', from: tail.pivot, to: [0, 15.5, 2.6], scale: 1.4 });
  } else {
    b.bone('head', undefined, [0, 26.5, 0]);
    b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], (f, _x, y) => (f === 'north' && y > 0.3 && y < 0.6 ? K : B));
    b.bone('tail', 'body', [0, 15.5, 2.6], [38, 0, 0]);
    b.cube('tail', [-1, 9.5, 2.1], [2, 6, 2], solid(B));
  }
  b.bone('spike', 'body', [0, 25, -2]);
  b.cube('spike', [-0.5, 25, -3.8], [1, 1, 2], solid(S));
  b.cube('right_arm', [-5.6, 15, 1.1], [1, 1, 1.6], solid(S));
  b.cube('left_arm', [4.6, 15, 1.1], [1, 1, 1.6], solid(S));
  return [b.done()];
}

// ---- Lopunny: brown, red eyes on black, a pink nose on a little muzzle, cream brow fins; her long ears
// up and hanging down her back into big cream clouds; cream cuffs of fluff at her wrists and cream fluff
// from her knees down; a cream tail puff. Dressed: a white crop top and jeans. Shiny (one in eight): pink
// fluff, in a black crop top and black leggings torn open -------------------------------------------------------
function lopunny() {
  const Br = [164, 108, 72], Pk = [242, 150, 172], EYE = [226, 52, 74], K = [26, 20, 22];
  return [
    { fluff: [248, 230, 176], top: [244, 244, 246], legs: [136, 176, 218], torn: false },
    { fluff: [250, 172, 200], top: [40, 36, 40], legs: [46, 40, 46], torn: true },
  ].map(({ fluff: Cr, top: TOP, legs: LEG, torn }, n) => {
    const b = builder(`lopunny_${n}`);
    const chest = solid(Br), hips = solid(Br);
    const holes = /** @type {Paint} */ ((face, x, y) => (torn && face !== 'up' && face !== 'down' && ((x - 0.5) ** 2) / 0.07 + ((y - 0.45) ** 2) / 0.1 < 1 ? Br : LEG));
    curvyBody(b, {
      chest, waist: solid(Br), hips, bust: solid(Br), neck: solid(Br),
      upperArm: solid(Br), forearm: solid(Br), thigh: solid(Br), calf: solid(Cr), foot: solid(Cr),
    }, {
      bust: solid(TOP), chest: over(chest, TOP, (face, _x, y) => face !== 'up' && y > 0.18),
      // (her jeans' band a shade darker, low on her hips under her belly)
      hips: over(hips, LEG, (face, x, y) => face !== 'up' && (face !== 'north' || y > 0.35 || Math.abs(x - 0.5) > 0.32)),
      thigh: holes,
    });
    // her head: red eyes on black with lashes, blush, a muzzle with a pink nose
    b.bone('head', undefined, [0, 26.5, 0]);
    const face = /** @type {Record<string, Colour>} */ ({ '1,3': K, '2,3': EYE, '4,3': EYE, '5,3': K, '1,2': K, '2,2': K, '4,2': K, '5,2': K, '1,4': [206, 120, 110], '5,4': [206, 120, 110] });
    b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], (f, _x, _y, i, j) => (f === 'north' ? face[`${i},${j}`] ?? Br : Br));
    b.cube('head', [-1.5, 27.2, -4.5], [3, 2, 1], (f, x, y) => (f === 'north' && y < 0.5 && x > 0.3 && x < 0.7 ? Pk : f === 'north' && y > 0.5 && Math.abs(x - 0.5) < 0.18 ? [110, 70, 50] : Br));
    // her brow fins, cream, from her forehead out and up over her eyes
    for (const [side, s] of /** @type {const} */ ([['r', -1], ['l', 1]])) {
      b.bone(`brow_${side}`, 'head', [s * 0.8, 32.4, -3.8], [0, 0, s * 26]);
      b.cube(`brow_${side}`, [s < 0 ? -6.2 : 0.8, 31.8, -4.6], [5.4, 1.6, 1.2], solid(Cr));
    }
    // her ears: up from her head, then hanging down her back, into a cloud of fluff
    for (const [side, x, turn] of /** @type {const} */ ([['r', -2, 12], ['l', 2, -12]])) {
      b.bone(`ear_${side}`, 'head', [x, 34, 0.5], [-8, 0, turn]);
      b.cube(`ear_${side}`, [x - 1.4, 34, -0.1], [2.8, 10, 1.2], (f, x2) => (f === 'north' && x2 > 0.22 && x2 < 0.78 ? Pk : Br));
      b.bone(`ear_${side}_droop`, `ear_${side}`, [x, 44, 0.5], [-168, 0, side === 'r' ? 6 : -6]);
      b.cube(`ear_${side}_droop`, [x - 1.4, 44, -0.1], [2.8, 16, 1.2], solid(Br));
      b.cube(`ear_${side}_droop`, [x - 2.3, 58.5, -1.2], [4.6, 10, 3.4], solid(Cr));
      b.cube(`ear_${side}_droop`, [x - 1.6, 67.5, -0.6], [3.2, 2, 2.2], solid(Cr));
    }
    // her wrists' cuffs of fluff, her knees' and her lower legs' fluff, her tail
    for (const [arm, x] of /** @type {const} */ ([['right_arm', -7], ['left_arm', 3.4]])) {
      b.cube(arm, [x, 13.2, -1.9], [3.6, 3.4, 3.6], solid(Cr));
      b.cube(arm, [x + 0.4, 16.4, -1.5], [2.8, 1.2, 2.8], solid(Cr));
    }
    for (const [leg, x] of /** @type {const} */ ([['right_leg', -4.5], ['left_leg', -0.1]])) b.cube(leg, [x, 5.6, -2.5], [4.6, 2.6, 4.6], solid(Cr));
    b.bone('tail', 'body', [0, 15, 2.5]);
    b.cube('tail', [-1.7, 13.6, 2.2], [3.4, 3.4, 2.4], solid(Cr));
    return b.done();
  });
}

// ---- Lycanroc, her three forms (one each spawns as): Midday (tan, cream front), Midnight (red, white
// front), Dusk (orange, cream front), a white mane at her chest and shoulders, her own head and tail from
// Pokédrock; a bikini each (blue, red, black) ---------------------------------------------------------------
function lycanroc() {
  const FORMS = [
    { geo: 'geometry.serplycanroc_1', tex: 'textures/entity/normal/lycanroc', fur: [206, 168, 128], belly: [242, 236, 226], suit: [60, 172, 232] },
    { geo: 'geometry.serplycanroc_2', tex: 'textures/entity/normal/lycanroc_2', fur: [204, 44, 56], belly: [244, 242, 242], suit: [234, 72, 96] },
    { geo: 'geometry.serplycanroc_3', tex: 'textures/entity/normal/lycanroc_3', fur: [240, 134, 44], belly: [246, 234, 212], suit: [42, 42, 46] },
  ];
  return FORMS.map((form, n) => {
    const b = builder(`lycanroc_${n}`);
    const F = form.fur, W = form.belly;
    const chest = front(W, F), waist = front(W, F), hips = solid(F);
    curvyBody(b, {
      chest, waist, hips, bust: front(W, F), neck: solid(W),
      upperArm: solid(F), forearm: solid(F), thigh: solid(F), calf: bands(F, W, 0.35), foot: solid(W),
    }, bikini(form.suit, chest, hips));
    // her mane: white fluff over her shoulders and the top of her chest
    b.bone('mane', 'body', [0, 25, 0]);
    b.cube('mane', [-4.6, 24.2, -2.6], [9.2, 2.4, 5.2], solid([250, 250, 250]));
    b.cube('mane', [-3.2, 22.6, -3], [6.4, 1.8, 1.2], solid([250, 250, 250]));
    const pd = pokedrockModel(form.geo, form.tex);
    if (pd) {
      pokedrockHead(b, pd, 1.25);
      const tail = pd.geometry.bones.find((/** @type {any} */ x) => x.name === 'tail');
      // (Midnight's own tail; the four-legged forms' tails are a beast's, so theirs are ours)
      if (tail && n === 1) b.graft(pd, { root: 'tail', as: 'tail', parent: 'body', from: tail.pivot, to: [0, 15.5, 2.6], scale: 1.4, rotation: [20, 0, 0] });
    } else {
      b.bone('head', undefined, [0, 26.5, 0]);
      b.cube('head', [-3.5, 27, -3.5], [7, 7, 7], solid(F));
      b.cube('head', [-1.5, 27.5, -6], [3, 2.5, 2.6], solid(F));
      for (const x of [-3, 1.5]) b.cube('head', [x, 34, -0.5], [1.5, 3, 1], solid(F));
    }
    if (!b.has('tail')) {
      b.bone('tail', 'body', [0, 15.5, 2.6], [40, 0, 0]);
      b.cube('tail', [-1.6, 7.5, 2.1], [3.2, 8, 3.2], bands(F, W, 0.6));
    }
    return b.done();
  });
}

/** Each girl's looks (model, bare and dressed textures), and how she is a Jenny's Preggo Mob (tools/import-jenny-preggo.mjs). */
export const POKEMON = [
  { made: gardevoir, key: 'gardevoir', name: 'Gardevoir', birth: 'kum:luna',
    kicks: { name: 'jp_gardevoir', order: [2, 0, 4, 1, 3], rate: 0.9, emphasis: [1.0, 1.2, 0.9, 1.1, 1.3] },
    treats: ['minecraft:amethyst_shard', 'minecraft:sweet_berries', 'minecraft:cake'], biomes: ['meadow', 'forest', 'plains'], egg: { base_color: '#f4f4f8', overlay_color: '#5ad46a' },
    // (her shiny form one in eight; thicker still, and a bigger belly)
    curves: 'thick', navel: true, clothes: true, tone: [246, 246, 250], weights: [7, 1], grow: 1.25 },
  { made: lucario, key: 'lucario', name: 'Lucario', birth: 'fapcraft:jenny',
    kicks: { name: 'jp_lucario', order: [3, 1, 0, 4, 2], rate: 1.3, emphasis: [1.4, 1.2, 1.0, 1.3, 0.9] },
    treats: ['minecraft:cooked_beef', 'minecraft:bone', 'minecraft:cake'], biomes: ['taiga', 'extreme_hills', 'forest'], egg: { base_color: '#3e8ad6', overlay_color: '#26262e' },
    curves: 'lush', navel: true, clothes: true, tone: [240, 226, 186] },
  { made: lopunny, key: 'lopunny', name: 'Lopunny', birth: 'kum:bia',
    kicks: { name: 'jp_lopunny', order: [1, 4, 2, 0, 3], rate: 1.1, emphasis: [1.1, 1.4, 1.0, 0.9, 1.2] },
    treats: ['minecraft:carrot', 'minecraft:golden_carrot', 'minecraft:cake'], biomes: ['plains', 'forest', 'meadow'], egg: { base_color: '#9e6846', overlay_color: '#f6e4ac' },
    // (her shiny form one in eight; as thick as Gardevoir, and a bigger belly)
    curves: 'thick', navel: true, clothes: true, tone: [164, 108, 72], weights: [7, 1], grow: 1.25 },
  { made: lycanroc, key: 'lycanroc', name: 'Lycanroc', birth: 'fapcraft:jenny',
    kicks: { name: 'jp_lycanroc', order: [0, 3, 1, 4, 2], rate: 1.25, emphasis: [1.3, 1.0, 1.2, 1.1, 1.0] },
    treats: ['minecraft:cooked_beef', 'minecraft:cooked_porkchop', 'minecraft:cake'], biomes: ['plains', 'savanna', 'extreme_hills', 'taiga'], egg: { base_color: '#c94a38', overlay_color: '#f4f0ea' },
    curves: 'lush', navel: true, clothes: true, tone: [244, 238, 230] },
];

export { builder, curvyBody, solid, bands, front, over, bikini };
