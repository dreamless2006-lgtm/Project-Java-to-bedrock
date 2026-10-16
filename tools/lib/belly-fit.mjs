// Fits the mod's pregnant bellies onto another character's body. The belly subtree of each
// per-phase predefined player body (the belly cubes and the kick bones) is rescaled from the player
// torso (8 x 12 x 4 units, y 12..24, front face at z -2) onto the character's own waist box and
// hung under copies of her bones from the root down to the hip (pivots and rest rotations), so her
// own animations move it with her. Each belly size is its own geometry, drawn by one render
// controller per size (like the other females) with the mod's Alex "extra" texture of that phase.
// Measured from the Jenny-mod style of rig (body > upperBody > hip > torso ...), which every girl of
// the Jenny Mod Java Port uses.
import { anglesForFront, eulerFromMat, matFromEuler, rotateBedrock } from './bedrock-math.mjs';
import { crowningGeometry, simpleBaby, simpleEgg } from './crowning.mjs';

/** The player torso box the mod's bellies are built around. */
const PLAYER_BOX = [[-4, 4], [12, 24], [-2, 2]];
/** Bones under the torso and hip that are not the trunk itself (limbs, head, chest, clothes props, the scene partner). */
const NOT_TRUNK = /arm|leg|head|boob|booty|cheek|vagina|tail|wing|hair|eye|mouth|lash|smile|neck|choker|bell|flower|hat|ear|steve|cock|nut|item|shin|knee|foot|hand|finger|thigh|cape|hood|scarf|bag|lamp|cum|backpack|layer|stars|bra|string|asshole|fuckhole|pillow|bed|zipper|bone\d|cloth|skirt|slip|hotpants|dress/i;

const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;
const transposed = (/** @type {number[][]} */ m) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[c][r]));

const rotate = rotateBedrock;

/**
 * @typedef {object} Body what a belly is fitted to
 * @property {{ name: string, parent?: string, pivot: number[], rotation?: number[] }[]} chain her bones from the root to the hip
 * @property {number[][]} box the waist box [[x0, x1], [y0, y1], [z0, z1]] the player torso maps onto
 * @property {number[]} opening where a baby is born (her 'vagina' bone between her legs, else the bottom of her waist)
 */

/**
 * Measures a character geometry: the chain of bones from the root to `hip`, and the waist box the
 * player torso maps onto (as wide as her torso, from just below the hip pivot to the top of the
 * torso, as deep as her torso), or undefined when the rig has no hip.
 * @param {{ bones: any[] }} geometry
 * @returns {Body | undefined}
 */
export function measureBody(geometry) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const hip = byName.get('hip');
  if (!hip) return undefined;
  /** @type {Body['chain']} */
  const chain = [];
  for (let bone = hip; bone; bone = bone.parent ? byName.get(bone.parent) : undefined) {
    chain.unshift({ name: bone.name, ...(bone.parent ? { parent: bone.parent } : {}), pivot: [...bone.pivot], ...(bone.rotation ? { rotation: [...bone.rotation] } : {}) });
  }
  const children = (/** @type {string} */ n) => geometry.bones.filter((b) => b.parent === n);
  const bounds = (/** @type {string} */ root) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    const visit = (/** @type {any} */ bone, /** @type {number} */ depth) => {
      if (depth > 0 && NOT_TRUNK.test(bone.name)) return;
      for (const cube of bone.cubes ?? []) {
        const inflate = cube.inflate ?? 0;
        count++;
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], cube.origin[k] - inflate); hi[k] = Math.max(hi[k], cube.origin[k] + cube.size[k] + inflate); }
      }
      for (const child of children(bone.name)) visit(child, depth + 1);
    };
    const bone = byName.get(root);
    if (bone) visit(bone, 0);
    return count ? { lo, hi } : undefined;
  };
  const torso = bounds('torso');
  const waist = bounds('hip');
  const trunk = torso ?? waist;
  if (!trunk) return undefined;
  const halfWidth = Math.min(4, Math.max(1.5, Math.max(Math.abs(trunk.lo[0]), Math.abs(trunk.hi[0])) * (torso ? 1 : 0.8)));
  const top = torso ? torso.hi[1] : trunk.hi[1] + 6;
  let bottom = hip.pivot[1] - 5;
  if (waist) bottom = Math.max(bottom, waist.lo[1]);
  // A belly as tall as the player's (12 units), within a quarter either way, standing on the waist bottom.
  const height = Math.min(15, Math.max(9, top - bottom));
  const depth = Math.min(4.4, Math.max(2.4, trunk.hi[2] - trunk.lo[2]));
  // Where a baby is born: the rig's own 'vagina' bone when it sits between her legs (some rigs keep
  // spare ones elsewhere), else just above where her legs hang from, else the bottom of her waist.
  const legs = ['legR', 'legL'].map((n) => byName.get(n)).filter(Boolean);
  const legY = legs.length ? legs.reduce((sum, l) => sum + l.pivot[1], 0) / legs.length : undefined;
  const vagina = geometry.bones.find((b) => b.name === 'vagina' && Math.abs(b.pivot[0]) <= 0.5 && (legY === undefined ? b.pivot[1] <= bottom + 3 : Math.abs(b.pivot[1] - (legY - 0.5)) <= 2));
  const middleZ = trunk.lo[2] + depth * 0.4;
  const opening = vagina ? [0, vagina.pivot[1], vagina.pivot[2]] : [0, legY === undefined ? bottom + 0.4 : Math.max(bottom + 0.4, legY - 1.5), middleZ];
  return { chain, box: [[-halfWidth, halfWidth], [bottom, bottom + height], [trunk.lo[2], trunk.lo[2] + depth]], opening: opening.map((v) => Math.round(v * 1000) / 1000) };
}

/**
 * Box UV as the per-face UVs Bedrock derives from it (Blockbench's layout), so a cube can change
 * size and keep showing the same texels, scaled.
 * @param {number[]} uv @param {number[]} size
 */
function faceUvs(uv, size) {
  const [u, v] = uv;
  const [w, h, d] = size.map((n) => Math.max(1, Math.ceil(n - 1e-6)));
  return {
    east: { uv: [u, v + d], uv_size: [d, h] },
    north: { uv: [u + d, v + d], uv_size: [w, h] },
    west: { uv: [u + d + w, v + d], uv_size: [d, h] },
    south: { uv: [u + 2 * d + w, v + d], uv_size: [w, h] },
    up: { uv: [u + d, v], uv_size: [w, d] },
    down: { uv: [u + d + w, v + d], uv_size: [w, -d] },
  };
}

/** The axis-aligned bounds of cubes after their bone's rest rotation about its pivot. */
function bounds(/** @type {{ cube: any, bone: any }[]} */ items) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { cube, bone } of items) {
    const inflate = cube.inflate ?? 0;
    const min = cube.origin.map((/** @type {number} */ o) => o - inflate);
    const max = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] + inflate);
    for (let c = 0; c < 8; c++) {
      let corner = [c & 1 ? max[0] : min[0], c & 2 ? max[1] : min[1], c & 4 ? max[2] : min[2]];
      if (bone?.rotation && bone.pivot) corner = rotate(corner.map((v, k) => v - bone.pivot[k]), bone.rotation).map((v, k) => v + bone.pivot[k]);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], corner[k]); hi[k] = Math.max(hi[k], corner[k]); }
    }
  }
  return { lo, hi };
}

/** Texel coordinates on the skin texture for a horizontal span (-1..1 of the belly's half width) and a height (-1..1 of its half height). */
const SKIN = { size: 128, radius: 52 };
/** The corner of the belly texture the shell never uses: the egg-laying girls' egg shell. */
export const EGG_PATCH = { uv: [1, 1], size: [10, 10] };
const texel = (/** @type {number} */ f) => Math.round((SKIN.size / 2 + Math.max(-1, Math.min(1, f)) * SKIN.radius) * 100) / 100;

/**
 * Turns a fitted belly (fitBelly) into a round one: the mod's boxes make way for a stepped
 * half-ellipsoid shell of axis-aligned cubes (rows of height, steps of depth), each mapped onto the
 * skin texture (tools/lib/belly-skin.mjs) by its position so the gradient shades it round. The kick
 * bones stay inside, on the same texture. Axis-aligned cubes only, so nothing depends on the game's
 * rotation conventions.
 * @param {any} fitted a geometry file from fitBelly
 * @param {{ rows?: number, steps?: number }} [options]
 */
export function roundBelly(fitted, { rows = 8, steps = 7 } = {}) {
  const doc = JSON.parse(JSON.stringify(fitted));
  const g = doc['minecraft:geometry'][0];
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  const belly = byName.get('belly');
  if (!belly) throw new Error(`${g.description.identifier}: no belly bone`);
  const children = (/** @type {string} */ n) => g.bones.filter((/** @type {any} */ b) => b.parent === n).map((/** @type {any} */ b) => b.name);
  const subtree = (/** @type {string} */ n) => [n, ...children(n).flatMap(subtree)];
  const names = subtree('belly');
  const isKick = (/** @type {string} */ n) => /kick/.test(n);
  const boxes = names.filter((n) => !isKick(n)).flatMap((n) => (byName.get(n)?.cubes ?? []).map((/** @type {any} */ cube) => ({ cube, bone: byName.get(n) })));
  if (!boxes.length) throw new Error(`${g.description.identifier}: the belly has no cubes`);
  const { lo, hi } = bounds(boxes);
  const rx = (hi[0] - lo[0]) / 2, ry = (hi[1] - lo[1]) / 2, cy = (lo[1] + hi[1]) / 2;
  const back = hi[2], rz = Math.max(0.5, back - lo[2]);
  /** @type {any[]} */
  const cubes = [];
  for (let i = 0; i < rows; i++) {
    const y0 = lo[1] + (i / rows) * 2 * ry, y1 = y0 + (2 * ry) / rows;
    const fy = ((y0 + y1) / 2 - cy) / ry;
    const row = Math.sqrt(Math.max(0, 1 - fy * fy));
    if (row < 0.12) continue;
    for (let k = 0; k < steps; k++) {
      // angle from the forward axis: thin slabs at the front cap, wider ones toward the sides
      const a0 = (k / steps) * (Math.PI / 2), a1 = ((k + 1) / steps) * (Math.PI / 2);
      const front = back - rz * row * Math.cos(a0);
      const rear = k === steps - 1 ? back + 0.5 : back - rz * row * Math.cos(a1) + 0.3;
      const half = rx * row * Math.sin(a1);
      if (half < 0.25) continue;
      const u0 = texel(-half / rx), u1 = texel(half / rx), v0 = texel(-(y1 - cy) / ry), v1 = texel(-(y0 - cy) / ry);
      const strip = { uv: [u0, v0], uv_size: [round(u1 - u0), round(Math.max(0.5, v1 - v0))] };
      cubes.push({
        origin: [round(-half), round(y0), round(front)],
        size: [round(2 * half), round(y1 - y0), round(rear - front)],
        inflate: 0.05,
        uv: {
          north: strip,
          south: strip,
          up: { uv: [u0, v0], uv_size: [round(u1 - u0), 1] },
          down: { uv: [u0, round(v1 - 1)], uv_size: [round(u1 - u0), 1] },
          east: { uv: [round(u1 - 1), v0], uv_size: [1, round(Math.max(0.5, v1 - v0))] },
          west: { uv: [u0, v0], uv_size: [1, round(Math.max(0.5, v1 - v0))] },
        },
      });
    }
  }
  belly.cubes = cubes;
  delete belly.rotation;
  // The mod's rotated side and bottom boxes go; the kick cubes stay inside and take the skin texture.
  g.bones = g.bones.filter((/** @type {any} */ b) => !names.includes(b.name) || b.name === 'belly' || isKick(b.name));
  const centre = { uv: [SKIN.size / 2 - 2, SKIN.size / 2 - 2], uv_size: [4, 4] };
  for (const name of names.filter(isKick)) {
    for (const cube of byName.get(name)?.cubes ?? []) cube.uv = { north: centre, south: centre, east: centre, west: centre, up: centre, down: centre };
  }
  g.description.texture_width = SKIN.size;
  g.description.texture_height = SKIN.size;
  return doc;
}

/**
 * The belly of one per-phase predefined player body fitted onto `body`, as a geometry file.
 * @param {any} playerBody a converted player_body_predefined_pN geometry file
 * @param {string} id the geometry identifier to give it
 * @param {Body} body
 */
export function fitBelly(playerBody, id, body) {
  const src = playerBody['minecraft:geometry'][0];
  const scale = PLAYER_BOX.map(([a, b], k) => (body.box[k][1] - body.box[k][0]) / (b - a));
  const mapPoint = (/** @type {number[]} */ p) => p.map((v, k) => body.box[k][0] + (v - PLAYER_BOX[k][0]) * scale[k]);
  /** The scale factor of each local axis of a bone turned by `rotations` (its own, then its parents'). */
  const axisFactors = (/** @type {number[][]} */ rotations) =>
    [0, 1, 2].map((axis) => {
      let v = [0, 0, 0];
      v[axis] = 1;
      for (const r of rotations) v = rotate(v, r);
      const dominant = v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)));
      return scale[dominant];
    });

  /** @type {any[]} */
  const bones = src.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  /** @type {any[]} */
  const ordered = [];
  const visit = (/** @type {string} */ name) => {
    const bone = byName.get(name);
    if (!bone) return;
    ordered.push(bone);
    for (const child of bones.filter((b) => b.parent === name)) visit(child.name);
  };
  visit('belly');
  if (!ordered.length) throw new Error(`no belly bone in ${src.description.identifier}`);
  /** @type {Map<string, { pivot: number[], rotations: number[][] }>} */
  const placed = new Map();
  const out = [];
  for (const bone of ordered) {
    const parent = bone.name === 'belly' ? undefined : placed.get(bone.parent);
    const parentBone = bone.name === 'belly' ? undefined : byName.get(bone.parent);
    const rotations = [bone.rotation ?? [0, 0, 0], ...(parent?.rotations ?? [])];
    const pivot = parent && parentBone
      ? parent.pivot.map((v, k) => v + (bone.pivot[k] - parentBone.pivot[k]) * axisFactors(parent.rotations)[k])
      : mapPoint(bone.pivot);
    placed.set(bone.name, { pivot, rotations });
    const f = axisFactors(rotations);
    const cubes = (bone.cubes ?? []).map((/** @type {any} */ cube) => {
      const rel = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o - bone.pivot[k]);
      /** @type {any} */
      const copy = {
        ...cube,
        origin: rel.map((/** @type {number} */ r, /** @type {number} */ k) => round(pivot[k] + r * f[k])),
        size: cube.size.map((/** @type {number} */ s, /** @type {number} */ k) => round(s * f[k])),
      };
      if (cube.inflate !== undefined) copy.inflate = round(cube.inflate * Math.min(...f));
      if (Array.isArray(cube.uv)) copy.uv = faceUvs(cube.uv, cube.size);
      return copy;
    });
    out.push({ ...bone, parent: bone.name === 'belly' ? 'hip' : bone.parent, pivot: pivot.map(round), cubes });
  }
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: id,
          texture_width: src.description.texture_width,
          texture_height: src.description.texture_height,
          visible_bounds_width: 3,
          visible_bounds_height: 3,
          visible_bounds_offset: [0, 1.5, 0],
        },
        bones: [...body.chain.map((b) => ({ ...b, pivot: [...b.pivot], ...(b.rotation ? { rotation: [...b.rotation] } : {}) })), ...out],
      },
    ],
  };
}

// ---- the smooth shell -----------------------------------------------------------------------------

// A kick on the smooth shell is a patch of the skin itself bulging out, not a block pushing through
// it: tiles shaped and shaded like the shell around the spot rest just under it, the middle ones
// shallow and the rim ones deeper, so when the kick pushes them all out together the middle rises
// most and the rim barely clears the skin - a round bump that follows the belly's curve.
/** How far under the skin the middle of a kick patch rests. */
export const KICK_REST = 0.25;
/** How much deeper the patch's rim rests than its middle. */
const KICK_RIM = 0.7;
/**
 * Where each kick shows on a smooth belly: [height as a share of the belly from the bottom, angle
 * round it in radians, 0 straight ahead and positive toward her left]. Spread over the front and the
 * sides, clear of the navel (straight ahead just below the middle).
 */
export const SHELL_KICK_SPOTS = /** @type {Record<string, [number, number]>} */ ({
  front_kick: [0.58, 0.32],
  top_kick: [0.76, -0.22],
  bottom_kick: [0.27, -0.3],
  left_kick: [0.46, 0.92],
  right_kick: [0.42, -0.95],
});
/** The terraces of a kick patch: [reach as a share of its radius, depth as a share of KICK_RIM]. */
const TERRACES = [[1, 0.5], [0.6, 0]];
/** Tile thickness: enough that no gap opens under a tile at the strongest kick's peak. */
const KICK_THICK = 1.8;
/** How much a skin-patch kick swells as it pushes, next to the mod's cubes (v.kick_grow of the kick pulses). */
export const SHELL_KICK_GROW = 0.35;
/** Where the belly is fullest, as a fraction of its height from the bottom: below the navel. */
const FULLEST = 0.45;

/** The radius of the belly's horizontal section at height fraction t (0 bottom .. 1 top), as a fraction of its widest. */
function profile(/** @type {number} */ t) {
  const u = (t - FULLEST) / (t < FULLEST ? FULLEST : 1 - FULLEST);
  return Math.pow(Math.max(0, 1 - u * u), 0.62);
}

export const anglesForNormal = anglesForFront;

/**
 * Turns a fitted belly (fitBelly) into a smooth one: the mod's boxes make way for a shell of thin
 * slabs, each turned to lie tangent to a pregnant profile (an ellipsoid-like surface fullest below
 * the navel, as wide as a bit more than her torso, as deep as the mod's belly of that size would be
 * on her), each slab's outer face mapped onto the skin texture (tools/lib/belly-skin.mjs) by its
 * position so the gradient shades the whole thing round. Each kick bone becomes a patch of that skin
 * resting just under it on a mount turned to the local normal, so a kick bulges the skin straight
 * out wherever it is.
 * @param {any} fitted a geometry file from fitBelly
 * @param {Body} body the waist box the belly was fitted to
 * @param {{ rows?: number, steps?: number }} [options]
 */
export function smoothBelly(fitted, body, { rows = 16, steps = 12 } = {}) {
  const doc = JSON.parse(JSON.stringify(fitted));
  const g = doc['minecraft:geometry'][0];
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  const belly = byName.get('belly');
  if (!belly) throw new Error(`${g.description.identifier}: no belly bone`);
  const children = (/** @type {string} */ n) => g.bones.filter((/** @type {any} */ b) => b.parent === n).map((/** @type {any} */ b) => b.name);
  const subtree = (/** @type {string} */ n) => [n, ...children(n).flatMap(subtree)];
  const names = subtree('belly');
  const isKick = (/** @type {string} */ n) => /kick$/.test(n);
  const boxes = names.filter((n) => !isKick(n) && !/_mount$/.test(n)).flatMap((n) => (byName.get(n)?.cubes ?? []).map((/** @type {any} */ cube) => ({ cube, bone: byName.get(n) })));
  if (!boxes.length) throw new Error(`${g.description.identifier}: the belly has no cubes`);
  const { lo, hi } = bounds(boxes);
  const [bx, by, bz] = body.box;
  const torsoHalf = bx[1], boxHeight = by[1] - by[0], torsoDepth = bz[1] - bz[0];
  const sx = (bx[1] - bx[0]) / (PLAYER_BOX[0][1] - PLAYER_BOX[0][0]);
  const sz = torsoDepth / (PLAYER_BOX[2][1] - PLAYER_BOX[2][0]);
  // Width: the fitted belly's, but never much more than her torso; height: from just under the
  // waist bottom to where the fitted belly ends under her chest; depth: the mod's belly on her,
  // scaled by her width rather than her (shallow) torso, measured from a plane inside the torso.
  const W = Math.min((hi[0] - lo[0]) / 2, torsoHalf * 1.15);
  const y0 = Math.max(lo[1], by[0] - 0.1 * boxHeight);
  const y1 = Math.max(y0 + 2, Math.min(hi[1], by[1] - 0.15 * boxHeight));
  const H = y1 - y0;
  const zBack = bz[0] + torsoDepth * 0.45;
  // The mod's depth on her, eased toward (never past) her belly's height: every size is deeper than
  // the one before, and a late belly stays round instead of growing into a tube.
  const reach = Math.max(0.35, (hi[2] - lo[2]) * (sx / sz) * 0.85 - (zBack - hi[2]) * 0.5);
  const D = Math.max(0.35, 0.98 * H * Math.tanh((1.1 * reach) / H));
  /** A point of the surface at height fraction t and angle phi (0 = straight ahead, +/- pi/2 = the sides). */
  const point = (/** @type {number} */ t, /** @type {number} */ phi) => {
    const r = profile(t);
    return [W * r * Math.sin(phi), y0 + t * H, zBack - D * r * Math.cos(phi)];
  };
  const normal = (/** @type {number} */ t, /** @type {number} */ phi) => {
    const e = 1e-3;
    const a = point(t, phi + e).map((v, k) => v - point(t, phi - e)[k]);
    const b = point(Math.min(1, t + e), phi).map((v, k) => v - point(Math.max(0, t - e), phi)[k]);
    let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    // outward: away from the belly's axis (which runs up the back plane)
    const out = [point(t, phi)[0], 0, point(t, phi)[2] - zBack];
    if (n[0] * out[0] + n[2] * out[2] < 0) n = n.map((v) => -v);
    return n;
  };
  const dist = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const R = SKIN.radius, C = SKIN.size / 2;
  /**
   * The texture rectangle a patch of the shell shows: the part of the gradient between its own
   * angles (left to right) and heights (bottom to top), kept inside the texture.
   */
  const clampU = (/** @type {number} */ u) => Math.max(0, Math.min(SKIN.size, u));
  const patchUv = (/** @type {number} */ ta, /** @type {number} */ tb, /** @type {number} */ pa, /** @type {number} */ pb) => {
    let u0 = clampU(C + Math.sin(pa) * R), u1 = clampU(C + Math.sin(pb) * R);
    let v0 = clampU(C - (2 * tb - 1) * R), v1 = clampU(C - (2 * ta - 1) * R);
    if (u1 - u0 < 0.5) [u0, u1] = [Math.min(u0, SKIN.size - 0.5), Math.min(u0, SKIN.size - 0.5) + 0.5];
    if (v1 - v0 < 0.5) [v0, v1] = [Math.min(v0, SKIN.size - 0.5), Math.min(v0, SKIN.size - 0.5) + 0.5];
    const face = { uv: [round(u0), round(v0)], uv_size: [round(u1 - u0), round(v1 - v0)] };
    const um = round(Math.min(SKIN.size - 1, (u0 + u1) / 2)), vm = round(Math.min(SKIN.size - 1, (v0 + v1) / 2));
    const strip = { uv: [um, round(v0)], uv_size: [1, round(v1 - v0)] };
    const flat = { uv: [round(u0), vm], uv_size: [round(u1 - u0), 1] };
    return { north: face, south: face, east: strip, west: strip, up: flat, down: flat };
  };
  const THICK = 0.6, OVERLAP = 1.12;
  /** @type {any[]} */
  const cubes = [];
  const T0 = 0.035, T1 = 0.965;
  // The shell wraps from side to side and ends on the plane inside the torso, where the torso hides its rim.
  const PHI = Math.PI / 2;
  for (let i = 0; i < rows; i++) {
    const ta = T0 + ((T1 - T0) * i) / rows, tb = T0 + ((T1 - T0) * (i + 1)) / rows, tc = (ta + tb) / 2;
    for (let j = 0; j < steps; j++) {
      const pa = -PHI + (2 * PHI * j) / steps, pb = -PHI + (2 * PHI * (j + 1)) / steps, pc = (pa + pb) / 2;
      const centre = point(tc, pc);
      const n = normal(tc, pc);
      const a = dist(point(tc, pa), point(tc, pb)) * OVERLAP;
      const b = dist(point(ta, pc), point(tb, pc)) * OVERLAP;
      if (a < 0.15 || b < 0.15) continue;
      // the slab sits a little inside the surface, its outer face just proud of it
      const pivot = centre.map((v, k) => v - n[k] * 0.2);
      cubes.push({
        origin: [round(pivot[0] - a / 2), round(pivot[1] - b / 2), round(pivot[2] - THICK / 2)],
        size: [round(a), round(b), THICK],
        pivot: pivot.map(round),
        rotation: anglesForNormal(n),
        uv: patchUv(ta, tb, pa, pb),
      });
    }
  }
  // The underside: a flat cap closing the bottom.
  const rb = profile(T0 + 0.02);
  if (W * rb > 0.3) {
    const a = 2 * W * rb * 1.05, b = D * rb * 1.1;
    cubes.push({ origin: [round(-a / 2), round(y0), round(zBack - b)], size: [round(a), 0.5, round(b)], uv: patchUv(0, 0.06, -0.4, 0.4) });
  }
  belly.cubes = cubes;
  delete belly.rotation;
  // The kicks: patches of the skin on mounts turned to the local normal (so a kick's push, along the
  // mount's -z, goes straight out of the skin), drawn by a child bone that turns them back, so each
  // tile keeps its place and slant on the shell.
  const kickBones = names.filter(isKick);
  /** @type {any[]} */
  const mounts = [];
  /** @type {any[]} */
  const skins = [];
  const speed = (/** @type {number} */ t, /** @type {number} */ phi, /** @type {'t' | 'phi'} */ along) => {
    const e = 1e-3;
    const [a, b] = along === 't' ? [point(Math.min(1, t + e), phi), point(Math.max(0, t - e), phi)] : [point(t, phi + e), point(t, phi - e)];
    return Math.max(1e-3, dist(a, b) / (2 * e));
  };
  for (const name of kickBones) {
    const bone = byName.get(name);
    const cube = bone?.cubes?.[0];
    if (!bone || !cube) continue;
    // her own spot on the round belly (the mod's kick cubes huddle low in its box belly)
    const [t, phi] = SHELL_KICK_SPOTS[name] ?? [0.5, 0];
    const surface = point(t, phi);
    const n = normal(t, phi);
    // the bump's radius: about a seventh of the belly's smaller extent, within reason
    const radius = Math.max(0.85, Math.min(1.45, 0.15 * Math.min(2 * W, H, 2.4 * D)));
    const step = radius / 3.5;
    const dt = step / speed(t, phi, 't'), dphi = step / speed(t, phi, 'phi');
    /** @type {any[]} */
    const tiles = [];
    // Three terraces, each a continuous piece of the skin at its own depth: the widest deepest, the
    // smallest shallowest, so a push raises a round bump stepped only at two soft rims.
    for (const [reach, depth] of TERRACES) {
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          if (Math.hypot(i, j) * step > reach * radius + 1e-6) continue;
          const ti = Math.max(0.04, Math.min(0.96, t + i * dt)), pi = Math.max(-1.45, Math.min(1.45, phi + j * dphi));
          const p = point(ti, pi);
          const ni = normal(ti, pi);
          const inset = KICK_REST + KICK_RIM * depth;
          // the tile's outer face rests `inset` under the shell's outer face (which stands 0.1 proud of the surface)
          const centre = p.map((v, k) => v + ni[k] * (0.1 - inset - KICK_THICK / 2));
          const side = step * 1.2;
          tiles.push({
            origin: [round(centre[0] - side / 2), round(centre[1] - side / 2), round(centre[2] - KICK_THICK / 2)],
            size: [round(side), round(side), KICK_THICK],
            pivot: centre.map(round),
            rotation: anglesForNormal(ni),
            uv: patchUv(ti - dt * 0.6, ti + dt * 0.6, pi - dphi * 0.6, pi + dphi * 0.6),
          });
        }
      }
    }
    const turn = anglesForNormal(n);
    const back = eulerFromMat(transposed(matFromEuler(turn))).map(round);
    mounts.push({ name: `${name}_mount`, parent: 'belly', pivot: surface.map(round), rotation: turn });
    bone.parent = `${name}_mount`;
    bone.pivot = surface.map(round);
    delete bone.rotation;
    delete bone.cubes;
    skins.push({ name: `${name}_skin`, parent: name, pivot: surface.map(round), rotation: back, cubes: tiles });
  }
  // The mod's rotated side and bottom boxes go; the kicks stay on their mounts.
  g.bones = [...g.bones.filter((/** @type {any} */ b) => !names.includes(b.name) || b.name === 'belly'), ...mounts, ...kickBones.map((n) => byName.get(n)).filter(Boolean), ...skins];
  g.description.texture_width = SKIN.size;
  g.description.texture_height = SKIN.size;
  return doc;
}

/** How big her baby is next to her (her waist width; the mod's fetus is for a player-sized body). */
export const babyScale = (/** @type {Body} */ body) => Math.max(0.6, Math.min(1.1, (body.box[0][1] - body.box[0][0]) / 6.5));

/**
 * Adds the crowning to a belly geometry (tools/lib/crowning.mjs): a small baby in her skin tone (the
 * middle of the belly texture), or an egg for an egg-laying girl (the corner of the texture), under
 * her hip at her birth opening, head first. The crowning animation shows it only during the birth
 * and slides it out with her pushes.
 * @param {any} doc a belly geometry file from smoothBelly
 * @param {Body} body the waist box the belly was fitted to (and her opening)
 * @param {{ egg?: boolean, mount?: number[] }} [options] an egg instead of a baby; the mount's rotation (the way out)
 */
export function addNewborn(doc, body, { egg = false, mount = /** @type {number[] | undefined} */ (undefined) } = {}) {
  const g = doc['minecraft:geometry'][0];
  if (g.bones.some((/** @type {any} */ b) => b.name === 'crowning')) return doc;
  const c = SKIN.size / 2;
  const baby = egg ? simpleEgg({ uv: EGG_PATCH.uv, uv_size: EGG_PATCH.size }) : simpleBaby({ uv: [c - 4, c - 4], uv_size: [8, 8] });
  const built = crowningGeometry({ id: g.description.identifier, chain: [{ name: 'hip', pivot: [0, 0, 0] }], opening: body.opening, mount, baby })['minecraft:geometry'][0];
  g.bones.push(...built.bones.filter((/** @type {any} */ b) => b.name !== 'hip'));
  return doc;
}
