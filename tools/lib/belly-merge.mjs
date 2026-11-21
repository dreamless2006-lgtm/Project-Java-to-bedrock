// Merges the per-phase belly of ten converted models into one model, so the pregnant belly never
// depends on switching geometry or texture at render time: the base model keeps everything else,
// and belly_p0 .. belly_p9 (with their kick bones, suffixed _pN) hang under the `belly` bone. An
// animation scales all but the current phase's belly to zero. The belly pixels live only in the
// per-phase textures, so their box-UV rectangles are copied into one composite texture below the
// base texture and the cubes' UVs point there.
import { blank, blit } from './png.mjs';

/** @typedef {import('./png.mjs').Image} Image */

const subtree = (/** @type {any[]} */ bones, /** @type {string} */ root) => {
  const names = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of bones) if (b.parent && names.has(b.parent) && !names.has(b.name)) { names.add(b.name); changed = true; }
  }
  return bones.filter((b) => names.has(b.name));
};

/** Box-UV rectangle of a cube: [x, y, width, height] in texture pixels. */
export function boxRect(/** @type {any} */ cube) {
  const [w, h, d] = cube.size.map((n) => Math.max(1, Math.ceil(n - 1e-6)));
  return [Math.floor(cube.uv[0]), Math.floor(cube.uv[1]), 2 * (w + d), d + h];
}

/**
 * @param {{ base: any, phases: any[], baseTexture: Image | null, phaseTextures: (Image | null)[], relocate?: boolean, bellyPivot?: number[] }} input
 * @returns {{ geometry: any, texture: Image | null, rects: Record<number, number[][]> }}
 */
export function mergeBellies({ base, phases, baseTexture, phaseTextures, relocate = true, bellyPivot }) {
  const geometry = JSON.parse(JSON.stringify(base));
  const g = geometry['minecraft:geometry'][0];
  const bones = g.bones;
  const names = new Set(bones.map((b) => b.name));
  let belly = bones.find((b) => b.name === 'belly');
  if (!belly) {
    belly = { name: 'belly', parent: 'body', pivot: bellyPivot ?? phases[0]['minecraft:geometry'][0].bones.find((b) => b.name === 'belly')?.pivot ?? [0, 19, -2] };
    bones.push(belly);
  }
  delete belly.cubes;
  const width = baseTexture?.width ?? g.description.texture_width;
  let canvas = baseTexture ? blank(width, baseTexture.height) : null;
  if (canvas && baseTexture) blit(baseTexture, 0, 0, baseTexture.width, baseTexture.height, canvas, 0, 0);
  let shelfY = baseTexture?.height ?? 0, shelfX = 0, shelfH = 0;
  const rects = {};
  const grow = (/** @type {number} */ height) => {
    if (!canvas || height <= canvas.height) return;
    const bigger = blank(canvas.width, height);
    blit(canvas, 0, 0, canvas.width, canvas.height, bigger, 0, 0);
    canvas = bigger;
  };
  phases.forEach((phase, n) => {
    const src = phase['minecraft:geometry'][0];
    const texture = phaseTextures[n];
    const part = subtree(src.bones, 'belly');
    const rename = new Map(part.map((b) => [b.name, b.name === 'belly' ? `belly_p${n}` : `${b.name}_p${n}`]));
    rects[n] = [];
    for (const b of part) {
      const bone = JSON.parse(JSON.stringify(b));
      bone.name = rename.get(b.name);
      bone.parent = b.name === 'belly' ? 'belly' : rename.get(b.parent) ?? b.parent;
      if (names.has(bone.name)) throw new Error(`duplicate bone ${bone.name}`);
      names.add(bone.name);
      for (const cube of bone.cubes ?? []) {
        if (!Array.isArray(cube.uv)) continue;
        const [u, v, w, h] = boxRect(cube);
        if (relocate && canvas && texture) {
          if (shelfX + w > canvas.width) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
          grow(shelfY + h);
          blit(texture, u, v, w, h, canvas, shelfX, shelfY);
          cube.uv = [shelfX, shelfY];
          rects[n].push([shelfX, shelfY, w, h]);
          shelfX += w;
          shelfH = Math.max(shelfH, h);
        } else {
          rects[n].push([u, v, w, h]);
        }
      }
      bones.push(bone);
    }
  });
  if (canvas) {
    // power-of-two height keeps the UV maths exact on every platform
    let height = 1;
    while (height < canvas.height) height *= 2;
    grow(height);
    g.description.texture_width = canvas.width;
    g.description.texture_height = canvas.height;
  }
  return { geometry, texture: canvas, rects };
}

/** Gives every `*_kick` bone channel of an animation copies for the per-phase kick bones. */
export function replicateKickBones(/** @type {any} */ animation, phases = [3, 4, 5, 6, 7, 8, 9]) {
  const bones = animation.bones ?? {};
  for (const [name, channels] of Object.entries(bones)) {
    if (!name.endsWith('_kick')) continue;
    for (const n of phases) bones[`${name}_p${n}`] = JSON.parse(JSON.stringify(channels));
  }
  return animation;
}
