// The belly a pregnant player holds in her off-hand so that players whose game draws its own player
// model (Actions & Stuff and the like) still see her pregnant (packs/behavior/scripts/player/compat.js,
// attachables/belly_p<P>[_t<T>].json from tools/gen/belly-items.mjs). An attachable cannot use her
// skin and is drawn by one render controller, so everything it shows has to come from one geometry
// and one texture per item:
//
// - the geometry is the mod's predefined body of the phase (belly, kick cubes, chest, hips, butt)
//   under bones bound to her own body and legs, plus every baby species at the crotch (and, from
//   P4, at the navel) for the crowning, each species under a root of its own that the attachable's
//   animation scales to 0 unless that is the baby being born;
// - the texture is a 256 x 256 px atlas (128 x 128 UV units): the belly texture doubled into the
//   left half, so the body keeps its own UVs, and the six fetus textures in 32 x 32-unit slots on the
//   right, so each species' UVs only move by its slot;
// - the skin tones are the belly texture with its skin pixels recoloured toward one of five tones
//   (tone 0 is the mod's Alex as is), shading kept and clothes untouched.
//
// Everything here is pure (no I/O); tools/import-jar.mjs reads the mod's art and writes the files.
import { blank, blit } from './png.mjs';
import { rotateAbout } from './bedrock-math.mjs';
import { PLAYER_BABIES, openingOf } from './crowning.mjs';

/** @typedef {import('./png.mjs').Image} Image */
/** @typedef {{ name: string, parent?: string, pivot?: number[], rotation?: number[], binding?: string, cubes?: any[] }} Bone */
/** @typedef {{ species: string, i: number, bones: Bone[] }} Baby a species (its 0-based index in PLAYER_BABIES) and its fetus bones, already placed and UV-shifted to its slot */

/** The belly's skin tones by index: 0 is the mod's Alex texture unchanged, then Light, Medium, Tan, Brown and Dark. */
export const TONES = /** @type {ReadonlyArray<readonly number[] | null>} */ ([null, [246, 214, 190], [226, 177, 142], [198, 141, 102], [141, 96, 66], [92, 62, 44]]);

/** The atlas in pixels, and in the UV units its geometry declares (texture_width/height). */
export const ATLAS_PX = 256;
export const ATLAS_UV = 128;

/** Where species i (0-based, PLAYER_BABIES order) has its fetus texture: in UV units and in atlas pixels. */
export function fetusSlot(/** @type {number} */ i) {
  const col = i % 2, row = Math.floor(i / 2);
  return { uv: [64 + 32 * col, 32 * row], px: [128 + 64 * col, 64 * row] };
}

// ---- skin tones ----

/** Perceived brightness (Rec. 601), 0..255. */
const luma = (/** @type {ArrayLike<number>} */ c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Hue in degrees, saturation and value (0..1) of an RGB colour. */
function hsv(/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max > 0 ? d / max : 0, v: max / 255 };
}

const hueDistance = (/** @type {number} */ a, /** @type {number} */ b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Alpha-tested materials draw a texel only from half opacity up, so only those count. */
const OPAQUE = 128;

const median = (/** @type {number[]} */ list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * The texture's own skin colour: the per-channel median of the opaque pixels that look like light
 * skin (warm hue, moderate saturation, not dark), so hair (too saturated) and trousers (too dark)
 * stay out of it.
 * @param {Image} image
 * @returns {number[]} [r, g, b]
 */
export function skinBase(image) {
  /** @type {number[][]} */
  const channels = [[], [], []];
  for (let i = 0; i < image.width * image.height; i++) {
    const [r, g, b, a] = image.data.subarray(i * 4, i * 4 + 4);
    if (a < OPAQUE) continue;
    const { h, s, v } = hsv(r, g, b);
    if (h < 10 || h > 45 || s < 0.15 || s > 0.7 || v < 0.45) continue;
    channels[0].push(r);
    channels[1].push(g);
    channels[2].push(b);
  }
  if (!channels[0].length) throw new Error('the texture shows no skin to take a tone from');
  return channels.map(median);
}

/**
 * The texture with its skin in another tone: a pixel is skin when its hue and saturation are close
 * to the skin base's and it is not dark; it takes the tone, scaled by how much lighter or darker
 * than the base it was, so the shading of the belly survives. Everything else (clothes, hair, the
 * navel's shadow) is copied as is. A null tone (tone 0) returns an unchanged copy.
 * @param {Image} image
 * @param {readonly number[] | null} tone [r, g, b]
 * @param {number[]} base from skinBase
 * @returns {Image}
 */
export function recolor(image, tone, base) {
  const out = { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  if (!tone) return out;
  const ref = hsv(base[0], base[1], base[2]);
  const baseLuma = Math.max(1, luma(base));
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    const px = image.data.subarray(o, o + 4);
    if (px[3] < OPAQUE) continue;
    const { h, s, v } = hsv(px[0], px[1], px[2]);
    if (hueDistance(h, ref.h) > 14 || Math.abs(s - ref.s) > 0.25 || v < 0.3) continue;
    const shade = luma(px) / baseLuma;
    for (let k = 0; k < 3; k++) out.data[o + k] = Math.max(0, Math.min(255, Math.round(tone[k] * shade)));
  }
  return out;
}

// ---- the atlas ----

/** The image twice as large, each pixel a 2 x 2 block (nearest neighbour), so UV units keep their meaning at 2 px each. */
export function upscale2(/** @type {Image} */ image) {
  const out = blank(image.width * 2, image.height * 2);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = ((y >> 1) * image.width + (x >> 1)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * The attachable's texture: the belly texture (64 x 128 px, one px per UV unit) doubled into the
 * left half, and each species' fetus texture (64 x 64 px for a 32 x 32-unit layout, already two px
 * per unit) copied as is into its slot on the right.
 * @param {Image} belly the phase's belly texture, in its tone
 * @param {(Image | null | undefined)[]} fetuses by species index (PLAYER_BABIES order); a missing one leaves its slot empty
 * @returns {Image}
 */
export function atlas(belly, fetuses) {
  const out = blank(ATLAS_PX, ATLAS_PX);
  blit(upscale2(belly), 0, 0, ATLAS_PX / 2, ATLAS_PX, out, 0, 0);
  fetuses.forEach((fetus, i) => {
    if (!fetus) return;
    const [x, y] = fetusSlot(i).px;
    blit(fetus, 0, 0, 64, 64, out, x, y);
  });
  return out;
}

// ---- the geometry ----

const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

/**
 * The bones with every UV moved by [du, dv] (UV units): box UVs (`uv: [u, v]`) and each face of
 * per-face UVs, so a model drawn from its own small texture draws from a slot of a bigger one.
 * @param {Bone[]} bones
 * @param {number[]} offset [du, dv]
 * @returns {Bone[]}
 */
export function offsetUv(bones, [du, dv]) {
  const shift = (/** @type {number[]} */ uv) => [round(uv[0] + du), round(uv[1] + dv)];
  return bones.map((bone) => {
    if (!bone.cubes) return { ...bone };
    const cubes = bone.cubes.map((cube) => {
      if (Array.isArray(cube.uv)) return { ...cube, uv: shift(cube.uv) };
      if (cube.uv && typeof cube.uv === 'object') {
        /** @type {Record<string, any>} */
        const faces = {};
        for (const [face, spec] of Object.entries(cube.uv)) faces[face] = spec && Array.isArray(spec.uv) ? { ...spec, uv: shift(spec.uv) } : spec;
        return { ...cube, uv: faces };
      }
      return { ...cube };
    });
    return { ...bone, cubes };
  });
}

/**
 * The bones renamed `<prefix><name>` (parents too), so several copies of one model can share a
 * geometry; bones whose parent is not among them (the roots) hang from `newRootParent` instead.
 * @param {Bone[]} bones
 * @param {string} prefix
 * @param {string} [newRootParent] none: the roots stay roots
 * @returns {Bone[]}
 */
export function prefixBones(bones, prefix, newRootParent) {
  const names = new Set(bones.map((b) => b.name));
  return bones.map((bone) => {
    const { parent, ...rest } = bone;
    const to = parent && names.has(parent) ? prefix + parent : newRootParent;
    return { ...rest, name: prefix + bone.name, ...(to ? { parent: to } : {}) };
  });
}

/** The bones below `root` (its children, their children, ...), not `root` itself. */
export function descendants(/** @type {Bone[]} */ bones, /** @type {string} */ root) {
  const names = new Set([root]);
  let grown = true;
  while (grown) {
    grown = false;
    for (const b of bones) if (b.parent && names.has(b.parent) && !names.has(b.name)) { names.add(b.name); grown = true; }
  }
  return bones.filter((b) => b.name !== root && names.has(b.name));
}

/**
 * The front of the belly's skin at (x, y): the front-most z of the belly's own cubes (its kick
 * cubes left out) whose box covers that point, in the belly bone's frame (its rest rotation left
 * out, since a bone hung from the belly turns with it; the panels of the big bellies, on child
 * bones turned by 90 degrees, are turned into place). Undefined when no cube covers the point.
 * @param {{ bones: Bone[] }} body
 * @param {number} x
 * @param {number} y
 */
export function bellyFront(body, x, y) {
  const byName = new Map(body.bones.map((b) => [b.name, b]));
  const under = descendants(body.bones, 'belly').filter((b) => !/kick/.test(b.name));
  let front;
  for (const bone of [byName.get('belly'), ...under]) {
    if (!bone) continue;
    // the turns of the bones between this one and the belly, innermost first
    /** @type {Bone[]} */
    const turns = [];
    for (let /** @type {Bone | undefined} */ b = bone; b && b.name !== 'belly'; b = b.parent ? byName.get(b.parent) : undefined) if (b.rotation && b.pivot) turns.push(b);
    for (const cube of bone.cubes ?? []) {
      if (!Array.isArray(cube.size)) continue;
      const inflate = cube.inflate ?? 0;
      const lo = cube.origin.map((/** @type {number} */ o) => o - inflate);
      const hi = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] + inflate);
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => turns.reduce((p, b) => rotateAbout(p, /** @type {number[]} */ (b.rotation), /** @type {number[]} */ (b.pivot)), [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]));
      const min = [0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k])));
      const max = [0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k])));
      const eps = 1e-3;
      if (x < min[0] - eps || x > max[0] + eps || y < min[1] - eps || y > max[1] + eps) continue;
      front = front === undefined ? min[2] : Math.min(front, min[2]);
    }
  }
  return front === undefined ? undefined : round(front);
}

/**
 * Where a navel baby comes out of this belly: the crowning's navel opening (the height of the front
 * kick, the way out straight ahead), brought forward onto the front of the belly's skin. The front
 * kick cube rests inside the belly, 4 to 10 units behind the skin of the predefined bellies (its
 * kicks push it out), so a baby mounted there stayed hidden inside her until it was nearly born.
 * @param {{ description?: any, bones: Bone[] }} body the predefined body of the phase
 * @returns {{ opening: number[], mount?: number[] }}
 */
export function navelOpening(body) {
  const { opening, mount } = openingOf(body, 'navel');
  const front = bellyFront(body, opening[0], opening[1]);
  return { opening: [opening[0], opening[1], front !== undefined && front < opening[2] ? front : opening[2]], ...(mount ? { mount } : {}) };
}

/** Her bones the attachable binds to (the player's own bone names) and what they are called in it. */
const BOUND = /** @type {Record<string, string>} */ ({ body: 'mp_body', rightLeg: 'mp_right_leg', leftLeg: 'mp_left_leg' });

/**
 * One mount with its baby species: `<mount>` at the opening (turned so its -y is the way out),
 * `<mount>_slide` that the crowning animation slides out, `<mount>_baby` turning the babies head
 * first, then a root per species (pivot at the opening, so scaling it to 0 hides that baby) holding
 * that species' fetus bones as `<letter>_<species>_<bone>`.
 * @param {{ mount: string, parent: string, letter: string, opening: number[], rotation?: number[], babies: Baby[] }} spec
 * @returns {Bone[]}
 */
function mountBones({ mount, parent, letter, opening, rotation, babies }) {
  const pivot = opening.map(round);
  const ordered = [...babies].sort((a, b) => a.i - b.i);
  return [
    { name: mount, parent, pivot, ...(rotation ? { rotation } : {}) },
    { name: `${mount}_slide`, parent: mount, pivot },
    { name: `${mount}_baby`, parent: `${mount}_slide`, pivot, rotation: [180, 0, 0] },
    ...ordered.flatMap(({ species, bones }) => {
      const root = `${letter}_${species}`;
      return [{ name: root, parent: `${mount}_baby`, pivot }, ...prefixBones(bones, `${root}_`, root)];
    }),
  ];
}

/**
 * The attachable geometry of one phase.
 * @param {object} options
 * @param {string} options.id the geometry identifier (geometry.minepreggo.belly_attachable_p<P>)
 * @param {{ bones: Bone[] }} options.body the mod's predefined body of the phase (one entry of "minecraft:geometry")
 * @param {{ opening: number[], babies: Baby[] }} options.crotch the crotch opening (model space, her body's pivot at [0, 24, 0]) and every species placed there
 * @param {{ opening: number[], mount?: number[], babies: Baby[] }} [options.navel] the belly's front opening (P4 and up) and the species born there
 */
export function attachableGeometry({ id, body, crotch, navel }) {
  const rename = (/** @type {string | undefined} */ name) => (name && name in BOUND ? BOUND[name] : name);
  /** @type {Bone[]} */
  const bones = body.bones.map((b) => ({
    ...b,
    name: /** @type {string} */ (rename(b.name)),
    ...(b.parent ? { parent: rename(b.parent) } : {}),
    // a bound bone follows her bone of that name, whatever model and animations draw her
    ...(b.name in BOUND ? { binding: `'${b.name}'` } : {}),
  }));
  if (!bones.some((b) => b.name === 'mp_body')) throw new Error(`${id}: the body has no body bone to bind`);
  bones.push(...mountBones({ mount: 'crowning', parent: 'mp_body', letter: 'c', opening: crotch.opening, babies: crotch.babies }));
  if (navel) {
    if (!bones.some((b) => b.name === 'belly')) throw new Error(`${id}: a navel mount needs a belly bone`);
    bones.push(...mountBones({ mount: 'crowning_navel', parent: 'belly', letter: 'n', opening: navel.opening, rotation: navel.mount, babies: navel.babies }));
  }
  const seen = new Set();
  for (const b of bones) {
    if (seen.has(b.name)) throw new Error(`${id}: two bones named ${b.name}`);
    seen.add(b.name);
  }
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: id,
          texture_width: ATLAS_UV,
          texture_height: ATLAS_UV,
          visible_bounds_width: 3,
          visible_bounds_height: 3.5,
          visible_bounds_offset: [0, 1.25, 0],
        },
        bones,
      },
    ],
  };
}

/** The species born at the navel: the humanoid babies (PLAYER_BABIES 0..3), as the native model's navel crowning. */
export const NAVEL_SPECIES = PLAYER_BABIES.slice(0, 4).map(([species]) => species);
