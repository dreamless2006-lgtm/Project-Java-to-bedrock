// Fits the mod's pregnant bellies onto another character's body. The belly subtree of each
// per-phase predefined player body (the belly cubes and the kick bones) is rescaled from the player
// torso (8 x 12 x 4 units, y 12..24, front face at z -2) onto the character's own waist box and
// hung under copies of her bones from the root down to the hip (pivots and rest rotations), so her
// own animations move it with her. Each belly size is its own geometry, drawn by one render
// controller per size (like the other females) with the mod's Alex "extra" texture of that phase.
// Measured from the Jenny-mod style of rig (body > upperBody > hip > torso ...), which every girl of
// the Jenny Mod Java Port uses.

/** The player torso box the mod's bellies are built around. */
const PLAYER_BOX = [[-4, 4], [12, 24], [-2, 2]];
/** Bones under the torso and hip that are not the trunk itself (limbs, head, chest, clothes props, the scene partner). */
const NOT_TRUNK = /arm|leg|head|boob|booty|cheek|vagina|tail|wing|hair|eye|mouth|lash|smile|neck|choker|bell|flower|hat|ear|steve|cock|nut|item|shin|knee|foot|hand|finger|thigh|cape|hood|scarf|bag|lamp|cum|backpack|layer|stars|bra|string|asshole|fuckhole|pillow|bed|zipper|bone\d|cloth|skirt|slip|hotpants|dress/i;

const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

/** Rotates a vector by Bedrock bone angles (degrees, x then y then z), as tools/lib/kick-clamp.mjs does. */
function rotate(/** @type {number[]} */ v, /** @type {number[]} */ deg) {
  const rad = deg.map((d) => (d * Math.PI) / 180);
  let [x, y, z] = v;
  [y, z] = [y * Math.cos(rad[0]) - z * Math.sin(rad[0]), y * Math.sin(rad[0]) + z * Math.cos(rad[0])];
  [x, z] = [x * Math.cos(rad[1]) + z * Math.sin(rad[1]), -x * Math.sin(rad[1]) + z * Math.cos(rad[1])];
  [x, y] = [x * Math.cos(rad[2]) - y * Math.sin(rad[2]), x * Math.sin(rad[2]) + y * Math.cos(rad[2])];
  return [x, y, z];
}

/**
 * @typedef {object} Body what a belly is fitted to
 * @property {{ name: string, parent?: string, pivot: number[], rotation?: number[] }[]} chain her bones from the root to the hip
 * @property {number[][]} box the waist box [[x0, x1], [y0, y1], [z0, z1]] the player torso maps onto
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
  return { chain, box: [[-halfWidth, halfWidth], [bottom, bottom + height], [trunk.lo[2], trunk.lo[2] + depth]] };
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
const SKIN = { size: 64, radius: 26 };
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
