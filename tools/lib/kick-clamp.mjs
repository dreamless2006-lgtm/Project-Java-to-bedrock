// Makes every kick a visible bulge of the belly whatever the belly size. The mod's keyframed kicks
// move a kick bone by fixed amounts authored for one model; across the ten per-phase models (and
// the player's and Jenny's) the cube rests a different depth inside the belly, so a fixed amount
// either never reaches the skin (nothing shows) or shoots far out of it (a floating cube). Each
// position keyframe of a kick bone is therefore rewritten as its share of the channel's peak travel
// times the room the current belly size leaves on that axis plus a small bulge
// (v.k_<bone>_x/_y/_z, written per entity by tools/gen-belly-render.mjs): the kick's peak always
// sits just beyond the skin, never further, and the kick's scale is capped so it never grows into a
// block. Channels that barely move (a jitter) are only clamped, not stretched.
import { rotateAbout } from './bedrock-math.mjs';

export const KICK_BONES = ['front_kick', 'left_kick', 'right_kick', 'top_kick', 'bottom_kick'];
/** How far a kick shows beyond the skin at its peak, in model units: forward, sideways and up/down. */
export const BULGE = { z: 1.5, x: 1.25, y: 1.25 };
const MAX_SCALE = 1.25;
/** How far a skin-patch kick on a smooth shell bulges out at a clamped kick's peak, and slides along the skin. */
export const SHELL_KICK = { travel: 1.15, lateral: 0.2 };
/** A channel whose peak travel is below this (model units) is a jitter, kept inside but not stretched. */
export const MIN_TRAVEL = 0.5;

const number = (/** @type {unknown} */ v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : undefined);

/**
 * One position component of `bone`: its share of the channel's peak travel on that axis, over the
 * room plus the bulge (z only outward, which is negative; x and y both ways). Jitters are clamped.
 * @param {string} bone @param {'x' | 'y' | 'z'} axis @param {unknown} value @param {number} peak
 */
function scaleComponent(bone, axis, value, peak) {
  const n = number(value);
  if (n === undefined || n === 0) return value;
  const room = `(v.k_${bone}_${axis} + ${BULGE[axis].toFixed(2)})`;
  if (peak < MIN_TRAVEL) {
    if (axis === 'z') return n < 0 ? `math.max(-${room}, ${n})` : n;
    return `math.clamp(${n}, -${room}, ${room})`;
  }
  const share = Math.min(1, Math.abs(n) / peak).toFixed(4);
  if (axis === 'z') return n < 0 ? `(-${room} * ${share})` : n;
  return `(${n < 0 ? '-' : ''}${room} * ${share})`;
}

function scaleVector(/** @type {string} */ bone, /** @type {unknown} */ vector, /** @type {number[]} */ peaks) {
  if (!Array.isArray(vector) || vector.length !== 3) return vector;
  return [scaleComponent(bone, 'x', vector[0], peaks[0]), scaleComponent(bone, 'y', vector[1], peaks[1]), scaleComponent(bone, 'z', vector[2], peaks[2])];
}

/** Every keyframe vector of a channel (plain arrays, and the pre/post of stepped keyframes). */
function vectors(/** @type {unknown} */ channel) {
  if (Array.isArray(channel)) return [channel];
  if (!channel || typeof channel !== 'object') return [];
  return Object.values(channel).flatMap((frame) => (Array.isArray(frame) ? [frame] : frame && typeof frame === 'object' ? [/** @type {any} */ (frame).pre, /** @type {any} */ (frame).post].filter(Array.isArray) : []));
}

/** The peak travel of a position channel per axis: the largest outward (negative) z, the largest |x| and |y|. */
export function peakTravel(/** @type {unknown} */ channel) {
  const peaks = [0, 0, 0];
  for (const vector of vectors(channel)) {
    vector.forEach((component, axis) => {
      const n = number(component);
      if (n === undefined || (axis === 2 && n > 0)) return;
      peaks[axis] = Math.max(peaks[axis], Math.abs(n));
    });
  }
  return peaks;
}

function capVector(/** @type {unknown} */ vector) {
  if (!Array.isArray(vector)) return vector;
  return vector.map((v) => { const n = number(v); return n === undefined ? v : Math.min(MAX_SCALE, n); });
}

/** @param {unknown} channel @param {(vector: unknown) => unknown} map */
function mapChannel(channel, map) {
  if (Array.isArray(channel)) return map(channel);
  if (channel && typeof channel === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [time, frame] of Object.entries(channel)) {
      if (Array.isArray(frame)) out[time] = map(frame);
      else if (frame && typeof frame === 'object') out[time] = { .../** @type {object} */ (frame), ...('pre' in frame ? { pre: map(frame.pre) } : {}), ...('post' in frame ? { post: map(frame.post) } : {}) };
      else out[time] = frame;
    }
    return out;
  }
  return channel;
}

/**
 * The game precomputes catmull-rom curves, so it refuses them on keyframes holding Molang (and drops
 * the animation): a channel with expressions in it is eased linearly instead.
 * @param {unknown} channel
 */
export function linearWhereExpressions(channel) {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return channel;
  const frames = Object.values(channel);
  const holdsExpression = vectors(channel).some((vector) => vector.some((v) => typeof v === 'string'));
  if (!holdsExpression || !frames.some((frame) => frame && typeof frame === 'object' && /** @type {any} */ (frame).lerp_mode === 'catmullrom')) return channel;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [time, frame] of Object.entries(channel)) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || /** @type {any} */ (frame).lerp_mode !== 'catmullrom') { out[time] = frame; continue; }
    const { lerp_mode: _, ...rest } = /** @type {any} */ (frame);
    out[time] = 'pre' in rest ? rest : rest.post;
  }
  return out;
}

/** Returns a copy of a Bedrock animation whose kick bones bulge out of the belly of any size, and never float off it. */
export function clampKicks(/** @type {any} */ animation) {
  if (!animation?.bones) return animation;
  const bones = { ...animation.bones };
  for (const bone of KICK_BONES) {
    const channels = bones[bone];
    if (!channels) continue;
    const peaks = peakTravel(channels.position);
    bones[bone] = { ...channels, ...(channels.position ? { position: linearWhereExpressions(mapChannel(channels.position, (v) => scaleVector(bone, v, peaks))) } : {}), ...(channels.scale ? { scale: mapChannel(channels.scale, capVector) } : {}) };
  }
  return { ...animation, bones };
}

/**
 * The room each kick cube has inside the belly of one model, per axis: how far it can move before
 * it leaves the belly's box (0 when it already touches the side). z is the distance from the cube's
 * front face to the belly's front face.
 * @param {{ bones: any[] }} geometry
 */
export function kickRoom(geometry) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const children = (/** @type {string} */ n) => geometry.bones.filter((b) => b.parent === n).map((b) => b.name);
  const subtree = (/** @type {string} */ n) => [n, ...children(n).flatMap(subtree)];
  // A cube's box after its bone's rotation about the bone's pivot (the big bellies are built from
  // cubes turned by 90 degrees), as the axis-aligned bounds of its eight corners, turned the game's way.
  const rotate = rotateAbout;
  const box = (/** @type {any} */ cube, /** @type {any} */ bone) => {
    const i = cube.inflate ?? 0;
    const lo = cube.origin.map((/** @type {number} */ o) => o - i);
    const hi = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] + i);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
    const rotated = bone?.rotation && bone.pivot ? corners.map((v) => rotate(v, bone.rotation, bone.pivot)) : corners;
    const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
    return { min: [0, 1, 2].map((k) => round(Math.min(...rotated.map((v) => v[k])))), max: [0, 1, 2].map((k) => round(Math.max(...rotated.map((v) => v[k])))) };
  };
  const union = (/** @type {{ cube: any, bone: any }[]} */ items) => items.map(({ cube, bone }) => box(cube, bone)).reduce((a, b) => ({ min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])) }));
  const bellyCubes = subtree('belly').filter((n) => !/kick/.test(n)).flatMap((n) => (byName.get(n)?.cubes ?? []).map((cube) => ({ cube, bone: byName.get(n) })));
  /** @type {Record<string, { x: number, y: number, z: number }>} */
  const room = {};
  if (!bellyCubes.length) return room;
  const belly = union(bellyCubes);
  for (const bone of KICK_BONES) {
    // A kick on a mount (the smooth shells of tools/lib/belly-fit.mjs) is a patch of the skin that
    // bulges along the mount's own -z: its "room" is set so that the clamped kicks (room plus the
    // bulge) lift it SHELL_KICK.travel out and let it slide only SHELL_KICK.lateral along the skin.
    if (byName.has(`${bone}_mount`)) {
      room[bone] = { x: SHELL_KICK.lateral - BULGE.x, y: SHELL_KICK.lateral - BULGE.y, z: SHELL_KICK.travel - BULGE.z };
      continue;
    }
    const cubes = byName.get(bone)?.cubes;
    if (!cubes?.length) continue;
    const kick = union(cubes.map((cube) => ({ cube, bone: undefined })));
    const r = (/** @type {number} */ v) => Math.max(0, Math.round(v * 100) / 100);
    room[bone] = {
      x: r(Math.min(kick.min[0] - belly.min[0], belly.max[0] - kick.max[0])),
      y: r(Math.min(kick.min[1] - belly.min[1], belly.max[1] - kick.max[1])),
      z: r(kick.min[2] - belly.min[2]),
    };
  }
  return room;
}
