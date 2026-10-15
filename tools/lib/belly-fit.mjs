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
