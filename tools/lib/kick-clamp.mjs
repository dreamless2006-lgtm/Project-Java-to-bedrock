// Makes every kick a visible bulge of the belly whatever the belly size. The mod's keyframed kicks
// move a kick bone by fixed amounts authored for one model; across the ten per-phase models (and
// the player's and Jenny's) the cube rests a different depth inside the belly, so a fixed amount
// either never reaches the skin (nothing shows) or shoots far out of it (a floating cube). Each
// position keyframe of a kick bone is therefore rewritten as its share of the channel's peak travel
// times the room the current belly size leaves on that axis plus a small bulge
// (v.k_<bone>_x/_y/_z, written per entity by tools/gen-belly-render.mjs): the kick's peak always
// sits just beyond the skin, never further, and the kick's scale is capped so it never grows into a
// block. Channels that barely move (a jitter) are only clamped, not stretched.

export const KICK_BONES = ['front_kick', 'left_kick', 'right_kick', 'top_kick', 'bottom_kick'];
/** How far a kick shows beyond the skin at its peak, in model units: forward, sideways and up/down. */
export const BULGE = { z: 1.5, x: 1.25, y: 1.25 };
const MAX_SCALE = 1.25;
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

/** Returns a copy of a Bedrock animation whose kick bones bulge out of the belly of any size, and never float off it. */
export function clampKicks(/** @type {any} */ animation) {
  if (!animation?.bones) return animation;
  const bones = { ...animation.bones };
  for (const bone of KICK_BONES) {
    const channels = bones[bone];
    if (!channels) continue;
    const peaks = peakTravel(channels.position);
    bones[bone] = { ...channels, ...(channels.position ? { position: mapChannel(channels.position, (v) => scaleVector(bone, v, peaks)) } : {}), ...(channels.scale ? { scale: mapChannel(channels.scale, capVector) } : {}) };
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
  // cubes turned by 90 degrees), as the axis-aligned bounds of its eight corners.
  const rotate = (/** @type {number[]} */ v, /** @type {number[]} */ deg, /** @type {number[]} */ pivot) => {
    const rad = deg.map((d) => (d * Math.PI) / 180);
    let [x, y, z] = v.map((c, k) => c - pivot[k]);
    const rx = (/** @type {number} */ a) => { const [cy, cz] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]; y = cy; z = cz; };
    const ry = (/** @type {number} */ a) => { const [cx, cz] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)]; x = cx; z = cz; };
    const rz = (/** @type {number} */ a) => { const [cx, cy] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; x = cx; y = cy; };
    rx(rad[0]); ry(rad[1]); rz(rad[2]);
    return [x + pivot[0], y + pivot[1], z + pivot[2]];
  };
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
