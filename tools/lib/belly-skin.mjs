// A character's skin tone and a belly texture in it. The tone is sampled from her own texture (the
// lower half of her head's front face: cheeks and chin, where every Jenny-mod girl shows skin), and
// the belly texture is a 128 x 128 radial gradient of that tone, lighter in the middle and darker at
// the rim, with a navel below the middle: the round belly shell (tools/lib/belly-fit.mjs) maps each
// of its cubes onto this texture by position, so the gradient shades it round.
import { blank } from './png.mjs';

/** @typedef {import('./png.mjs').Image} Image */

export const SKIN_TEXTURE_SIZE = 128;

/** The north (front) face of a cube in texture pixels: box UVs follow Blockbench's layout, per-face UVs are read as given. */
function frontFace(/** @type {any} */ cube, /** @type {number} */ sx, /** @type {number} */ sy) {
  let u, v, w, h;
  if (Array.isArray(cube.uv)) {
    const [cw, ch, cd] = cube.size.map((/** @type {number} */ n) => Math.max(1, Math.ceil(n - 1e-6)));
    [u, v, w, h] = [cube.uv[0] + cd, cube.uv[1] + cd, cw, ch];
  } else if (cube.uv?.north) {
    const { uv, uv_size: size } = cube.uv.north;
    [u, v, w, h] = [Math.min(uv[0], uv[0] + size[0]), Math.min(uv[1], uv[1] + size[1]), Math.abs(size[0]), Math.abs(size[1])];
  } else return undefined;
  return { u: u * sx, v: v * sy, w: w * sx, h: h * sy };
}

/** The median (by brightness) of the opaque, not-too-dark texels of a region; undefined when there are too few. */
function sample(/** @type {Image} */ png, /** @type {{ u: number, v: number, w: number, h: number }} */ region) {
  /** @type {number[][]} */
  const texels = [];
  const x0 = Math.max(0, Math.floor(region.u)), x1 = Math.min(png.width, Math.ceil(region.u + region.w));
  const y0 = Math.max(0, Math.floor(region.v)), y1 = Math.min(png.height, Math.ceil(region.v + region.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      if (a < 200 || r + g + b < 150) continue;
      texels.push([r, g, b]);
    }
  }
  if (texels.length < 8) return undefined;
  texels.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
  return texels[Math.floor(texels.length / 2)];
}

/**
 * Her skin tone [r, g, b]: the cheeks and chin of the head's front face, else the middle of the
 * torso's front face, else the median of every opaque texel.
 * @param {Image} png her texture
 * @param {{ description: { texture_width: number, texture_height: number }, bones: any[] }} geometry
 */
export function skinTone(png, geometry) {
  const sx = png.width / geometry.description.texture_width;
  const sy = png.height / geometry.description.texture_height;
  const cubeOf = (/** @type {string} */ bone) => geometry.bones.find((b) => b.name === bone)?.cubes?.[0];
  const head = cubeOf('head') ? frontFace(cubeOf('head'), sx, sy) : undefined;
  if (head) {
    const tone = sample(png, { u: head.u + head.w * 0.15, v: head.v + head.h * 0.5, w: head.w * 0.7, h: head.h * 0.45 });
    if (tone) return tone;
  }
  const torso = cubeOf('torso') ? frontFace(cubeOf('torso'), sx, sy) : undefined;
  if (torso) {
    const tone = sample(png, { u: torso.u + torso.w * 0.25, v: torso.v + torso.h * 0.25, w: torso.w * 0.5, h: torso.h * 0.5 });
    if (tone) return tone;
  }
  return sample(png, { u: 0, v: 0, w: png.width, h: png.height }) ?? [224, 188, 160];
}

/**
 * A belly texture in a skin tone: a radial gradient (lighter in the middle, darker at the rim), a
 * highlight above the middle and a navel below it.
 * @param {number[]} tone [r, g, b]
 */
export function bellyTexture(tone, size = SKIN_TEXTURE_SIZE, /** @type {{ shell: number[], spots: number[] } | undefined} */ egg = undefined) {
  const image = blank(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / c, dy = (y + 0.5 - c) / c;
      let shade = Math.max(0.58, Math.min(1.1, 1.1 - 0.45 * (dx * dx + dy * dy)));
      // highlight up-left of the middle, navel below it
      const hx = dx + 0.18, hy = dy + 0.28;
      shade += 0.08 * Math.max(0, 1 - (hx * hx + hy * hy) / 0.09);
      const nx = dx / 0.075, ny = (dy - 0.22) / 0.1;
      const navel = nx * nx + ny * ny;
      if (navel < 1) shade *= 0.72 + 0.1 * navel;
      else if (navel < 1.6) shade *= 1.04;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) image.data[i + k] = Math.max(0, Math.min(255, Math.round(tone[k] * shade)));
      image.data[i + 3] = 255;
    }
  }
  if (egg) {
    // An egg-laying girl's egg (EGG_PATCH of tools/lib/belly-fit.mjs, the corner the belly never
    // uses): a shaded shell with a few speckles.
    const at = Math.round(size / 128), from = 1 * at, to = 11 * at;
    for (let y = from; y < to; y++) {
      for (let x = from; x < to; x++) {
        const u = (x - from + 0.5) / (to - from), w = (y - from + 0.5) / (to - from);
        const shade = 1.06 - 0.28 * ((u - 0.38) ** 2 + (w - 0.35) ** 2) * 2.2;
        const speckle = ((x * 7 + y * 13) % 11 === 0 || (x * 5 + y * 3) % 17 === 0) && u > 0.1 && u < 0.9;
        const colour = speckle ? egg.spots : egg.shell;
        const i = (y * size + x) * 4;
        for (let k = 0; k < 3; k++) image.data[i + k] = Math.max(0, Math.min(255, Math.round(colour[k] * shade)));
      }
    }
  }
  return image;
}

/**
 * Her hair colour [r, g, b]: the median of the top face of her head (where every Jenny-mod girl's
 * hair is), else a soft brown.
 * @param {Image} png her texture
 * @param {{ description: { texture_width: number, texture_height: number }, bones: any[] }} geometry
 */
export function hairTone(png, geometry) {
  const sx = png.width / geometry.description.texture_width;
  const sy = png.height / geometry.description.texture_height;
  const head = geometry.bones.find((b) => b.name === 'head')?.cubes?.[0];
  if (!head) return [110, 80, 60];
  let region;
  if (Array.isArray(head.uv)) {
    const [w, , d] = head.size.map((/** @type {number} */ n) => Math.max(1, Math.ceil(n - 1e-6)));
    region = { u: (head.uv[0] + d) * sx, v: head.uv[1] * sy, w: w * sx, h: d * sy };
  } else if (head.uv?.up) {
    const { uv, uv_size: size } = head.uv.up;
    region = { u: Math.min(uv[0], uv[0] + size[0]) * sx, v: Math.min(uv[1], uv[1] + size[1]) * sy, w: Math.abs(size[0]) * sx, h: Math.abs(size[1]) * sy };
  }
  return (region && sample(png, region)) ?? [110, 80, 60];
}
