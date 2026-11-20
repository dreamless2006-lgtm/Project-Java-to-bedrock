// Box UV as per-face UVs, and parts of a face: for changing a cube's size without its texture
// sliding (a resized box-UV cube takes its texture from elsewhere), and for cutting new cubes from a
// model's own texture (tools/compat-addons.mjs, tools/gen/curvy-girls.mjs).

const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** Box UV as per-face UVs (Blockbench's Bedrock layout), mirrored when the cube or its bone is. */
export function facesOf(/** @type {any} */ cube, /** @type {boolean} */ boneMirror = false) {
  if (!Array.isArray(cube.uv)) return cube.uv ?? {};
  const [u, v] = cube.uv;
  const [w, h, d] = cube.size;
  const face = (/** @type {number} */ fu, /** @type {number} */ fv, /** @type {number} */ su, /** @type {number} */ sv) => ({ uv: [round(fu), round(fv)], uv_size: [round(su), round(sv)] });
  if (cube.mirror ?? boneMirror) {
    return {
      north: face(u + d + w, v + d, -w, h), south: face(u + 2 * d + 2 * w, v + d, -w, h),
      east: face(u + 2 * d + w, v + d, -d, h), west: face(u + d, v + d, -d, h),
      up: face(u + d + w, v, -w, d), down: face(u + d + 2 * w, v + d, -w, -d),
    };
  }
  return {
    north: face(u + d, v + d, w, h), south: face(u + 2 * d + w, v + d, w, h),
    east: face(u, v + d, d, h), west: face(u + d + w, v + d, d, h),
    up: face(u + d, v, w, d), down: face(u + d + w, v + d, w, -d),
  };
}
/** Part of a face (fractions across and down it). */
export const part = (/** @type {any} */ face, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y0, /** @type {number} */ y1) => ({
  uv: [round(face.uv[0] + face.uv_size[0] * x0), round(face.uv[1] + face.uv_size[1] * y0)],
  uv_size: [round(face.uv_size[0] * (x1 - x0)), round(face.uv_size[1] * (y1 - y0))],
});

