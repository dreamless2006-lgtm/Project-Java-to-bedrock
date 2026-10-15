// Poses as world-space bone orientations, solved onto any rig. The mod's labor animations are
// authored for a flat humanoid rig (head, body, arms and legs all top-level, each placed by its own
// position channel); the Jenny Mod Java Port's girls are hierarchical rigs (a root mover, upperBody
// with torso, hip, head and arms under it, legs under the root, forearms and shins). A pose is
// carried over as each limb's change of world orientation from its neutral stance (so a girl keeps
// her own stance: arms angled the way her model holds them, her idle's bends) plus the pelvis
// moving like the source's hip joints (scaled to her leg length), and solved back into Bedrock
// rotation and position channels for the target rig. Rotations follow the game's convention
// (tools/lib/geo-render.mjs: X, then Y, then Z, angles negated into right-handed formulas).
import { eulerFromMat, matFromEuler } from './bedrock-math.mjs';
import { poseAt } from './geo-render.mjs';

export { eulerFromMat, matFromEuler };

/** @typedef {number[][]} Mat3 row-major 3x3 */
/** @typedef {import('./geo-render.mjs').BonePose} BonePose */
/** @typedef {{ name: string, parent?: string, pivot: number[], rest: number[] }} RigBone */
/** @typedef {Map<string, RigBone> & { order: string[] }} Rig */

const vec = (/** @type {unknown} */ v, fallback = 0) => (Array.isArray(v) ? [0, 1, 2].map((k) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? v[k] : fallback)) : [fallback, fallback, fallback]);

export const mul = (/** @type {Mat3} */ a, /** @type {Mat3} */ b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
export const transpose = (/** @type {Mat3} */ m) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[c][r]));
export const apply = (/** @type {Mat3} */ m, /** @type {number[]} */ v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** A geometry's bones as a rig (parents before children). */
export function rigOf(/** @type {{ bones: any[] }} */ geometry) {
  /** @type {Rig} */
  const rig = /** @type {any} */ (new Map());
  for (const b of geometry.bones) rig.set(b.name, { name: b.name, ...(b.parent ? { parent: b.parent } : {}), pivot: vec(b.pivot), rest: vec(b.rotation) });
  const order = /** @type {string[]} */ ([]);
  const seen = new Set();
  const visit = (/** @type {string} */ name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const bone = rig.get(name);
    if (bone?.parent && rig.has(bone.parent)) visit(bone.parent);
    order.push(name);
  };
  for (const name of rig.keys()) visit(name);
  rig.order = order;
  return rig;
}

/**
 * World transforms of every bone under a pose: world(p) = R p + t for a point p of the bone's rest frame.
 * @param {Rig} rig @param {Record<string, BonePose>} pose
 */
export function worldOf(rig, pose) {
  /** @type {Map<string, { R: Mat3, t: number[] }>} */
  const out = new Map();
  for (const name of rig.order) {
    const bone = /** @type {RigBone} */ (rig.get(name));
    const anim = pose[name] ?? {};
    const Rl = matFromEuler(bone.rest.map((r, k) => r + vec(anim.rotation)[k]));
    const pos = vec(anim.position);
    // local: p -> Rl (p - pivot) + pivot + pos
    const tl = bone.pivot.map((v, k) => v + pos[k] - apply(Rl, bone.pivot)[k]);
    const parent = bone.parent ? out.get(bone.parent) : undefined;
    if (!parent) out.set(name, { R: Rl, t: tl });
    else out.set(name, { R: mul(parent.R, Rl), t: apply(parent.R, tl).map((v, k) => v + parent.t[k]) });
  }
  return out;
}

/** The world position of a bone's pivot under a pose. */
export const pivotOf = (/** @type {Rig} */ rig, /** @type {ReturnType<typeof worldOf>} */ world, /** @type {string} */ name) => {
  const w = world.get(name);
  const bone = rig.get(name);
  if (!w || !bone) throw new Error(`no bone ${name}`);
  return apply(w.R, bone.pivot).map((v, k) => v + w.t[k]);
};

const mean = (/** @type {number[][]} */ points) => [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k], 0) / points.length);

/**
 * @typedef {object} Source a pose source on the flat humanoid rig
 * @property {Rig} rig
 * @property {(time: number) => Record<string, BonePose>} poseAt
 * @property {Record<string, BonePose>} [neutral] its neutral stance (default: rest)
 * @property {string[]} pelvis the bones whose pivots are the hip joints (the legs)
 * @property {string} trunk the bone whose orientation is the trunk's
 */

/**
 * @typedef {object} Target a rig to solve onto
 * @property {Rig} rig
 * @property {Record<string, BonePose>} neutral her neutral stance (her idle's first frame)
 * @property {Record<string, string>} map source bone -> target bone
 * @property {string[]} pelvis her hip-joint bones (the legs)
 * @property {string} [mover] the bone moved to place the pelvis (hierarchical rigs); flat rigs place every mapped bone
 * @property {number} scale her leg length over the source's
 * @property {string} [trunk] her trunk bone (flat rigs: the bone the head and arms ride on)
 * @property {Record<string, BonePose>} [extra] channels added on top at every time (her own flavour: tails, wings, ears)
 * @property {boolean} [absolute] mapped bones take the source's world orientation as it is (authored poses), not its change from neutral
 * @property {string[]} [straighten] bones held straight in line with their parent (forearms and shins: the mod's limbs are one piece)
 * @property {Record<string, number[]>} [bends] bones bent by this local rotation from straight (knees, elbows)
 * @property {Record<string, number[]>} [limbs] each limb's modelled direction in its own frame at no rotation (from its cubes, cube rotations included): straight and absolute mean that direction, not a zero rotation
 */

/**
 * Solves one moment of a source pose onto a target rig: the target bones' animation channels
 * (rotation and position, as the game adds them to the rest pose).
 * @param {Source} source @param {Target} target @param {number} time
 * @returns {Record<string, BonePose>}
 */
export function solveAt(source, target, time) {
  const S0 = worldOf(source.rig, source.neutral ?? {});
  const St = worldOf(source.rig, source.poseAt(time));
  /** World-space change of orientation of each mapped source bone. */
  const D = new Map(Object.keys(target.map).filter((s) => S0.has(s)).map((s) => [s, mul(/** @type {any} */ (St.get(s)).R, transpose(/** @type {any} */ (S0.get(s)).R))]));
  const pelvisS0 = mean(source.pelvis.map((b) => pivotOf(source.rig, S0, b)));
  const pelvisSt = mean(source.pelvis.map((b) => pivotOf(source.rig, St, b)));
  const shift = pelvisSt.map((v, k) => (v - pelvisS0[k]) * target.scale);
  const T0 = worldOf(target.rig, target.neutral);
  const inverse = Object.fromEntries(Object.entries(target.map).map(([s, g]) => [g, s]));
  /** @type {Record<string, BonePose>} */
  const pose = {};
  for (const [name, p] of Object.entries(target.neutral)) pose[name] = { ...(p.rotation ? { rotation: [...vec(p.rotation)] } : {}), ...(p.position ? { position: [...vec(p.position)] } : {}) };

  if (target.mover) {
    // Hierarchical: orientations bone by bone, parents first, then the mover places the pelvis.
    /** @type {Map<string, Mat3>} */
    const posedR = new Map();
    for (const name of target.rig.order) {
      const bone = /** @type {RigBone} */ (target.rig.get(name));
      const parentR = bone.parent ? posedR.get(bone.parent) ?? I3() : I3();
      const s = inverse[name];
      const d = s ? D.get(s) : undefined;
      const bend = target.bends?.[name];
      if (bend || target.straighten?.includes(name)) {
        // In line with its parent limb as the cubes are modelled (some rigs model a forearm folded
        // and turn it straight with a cube rotation that cancels its rest rotation), then bent.
        const own = target.limbs?.[name];
        const parentDir = bone.parent ? target.limbs?.[bone.parent] : undefined;
        const align = own && parentDir ? rotationFromTo(own, parentDir) : I3();
        const local = bend ? mul(matFromEuler(bend), align) : align;
        (pose[name] ??= {}).rotation = eulerFromMat(local).map((v, k) => v - bone.rest[k]);
      } else if (d) {
        const want = target.absolute ? limbFix(/** @type {any} */ (St.get(/** @type {string} */ (s))).R, target.limbs?.[name]) : mul(d, /** @type {any} */ (T0.get(name)).R);
        const local = mul(transpose(parentR), want);
        const total = eulerFromMat(local);
        (pose[name] ??= {}).rotation = total.map((v, k) => v - bone.rest[k]);
      }
      const anim = pose[name] ?? {};
      posedR.set(name, mul(parentR, matFromEuler(bone.rest.map((r, k) => r + vec(anim.rotation)[k]))));
    }
    const posed = worldOf(target.rig, pose);
    const pelvisT0 = mean(target.pelvis.map((b) => pivotOf(target.rig, T0, b)));
    const pelvisNow = mean(target.pelvis.map((b) => pivotOf(target.rig, posed, b)));
    const delta = pelvisT0.map((v, k) => v + shift[k] - pelvisNow[k]);
    const mover = /** @type {RigBone} */ (target.rig.get(target.mover));
    const parentR = mover.parent ? /** @type {any} */ (posed.get(mover.parent)).R : I3();
    const local = apply(transpose(parentR), delta);
    const m = (pose[target.mover] ??= {});
    m.position = vec(m.position).map((v, k) => v + local[k]);
  } else {
    // Flat: every mapped bone is top-level and placed on its own, as if the head and arms rode on
    // the trunk and the legs on the pelvis.
    const pelvisT0 = mean(target.pelvis.map((b) => pivotOf(target.rig, T0, b)));
    const pelvisT = pelvisT0.map((v, k) => v + shift[k]);
    const trunkSource = Object.entries(target.map).find(([, g]) => g === target.trunk)?.[0] ?? source.trunk;
    const dTrunk = D.get(trunkSource) ?? I3();
    for (const [s, g] of Object.entries(target.map)) {
      const bone = target.rig.get(g);
      const d = D.get(s);
      if (!bone || !d) continue;
      const want = target.absolute ? limbFix(/** @type {any} */ (St.get(s)).R, target.limbs?.[g]) : mul(d, /** @type {any} */ (T0.get(g)).R);
      const total = eulerFromMat(want);
      const restPivot = pivotOf(target.rig, T0, g);
      const onLegs = target.pelvis.includes(g);
      const pivot = onLegs ? restPivot.map((v, k) => v + shift[k]) : apply(dTrunk, restPivot.map((v, k) => v - pelvisT0[k])).map((v, k) => v + pelvisT[k]);
      pose[g] = { rotation: total.map((v, k) => v - bone.rest[k]), position: pivot.map((v, k) => v - bone.pivot[k]) };
    }
  }
  for (const [name, p] of Object.entries(target.extra ?? {})) {
    const o = (pose[name] ??= {});
    if (p.rotation) o.rotation = vec(o.rotation).map((v, k) => v + vec(p.rotation)[k]);
    if (p.position) o.position = vec(o.position).map((v, k) => v + vec(p.position)[k]);
  }
  return pose;
}

/** The rotation taking unit direction `a` onto `b` (the shortest one). */
export function rotationFromTo(/** @type {number[]} */ a, /** @type {number[]} */ b) {
  const na = Math.hypot(...a) || 1, nb = Math.hypot(...b) || 1;
  const u = a.map((v) => v / na), w = b.map((v) => v / nb);
  const axis = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const s = Math.hypot(...axis), c = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  if (s < 1e-9) return c > 0 ? I3() : [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const [x, y, z] = axis.map((v) => v / s);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/**
 * An absolute world orientation for a limb whose cubes do not hang straight down at no rotation:
 * the authored orientation is where a straight-down limb would point, so the limb's own modelled
 * direction is first turned onto straight down.
 */
function limbFix(/** @type {Mat3} */ want, /** @type {number[] | undefined} */ limb) {
  if (!limb) return want;
  const n = Math.hypot(...limb) || 1;
  if (limb[1] / n < -0.985) return want;
  return mul(want, rotationFromTo(limb, [0, -1, 0]));
}

/**
 * Each limb's modelled direction in its own frame at no rotation: from its pivot to the middle of
 * its biggest cube, after that cube's own rotation.
 * @param {{ bones: any[] }} geometry @param {string[]} names
 */
export function limbDirections(geometry, names) {
  /** @type {Record<string, number[]>} */
  const out = {};
  for (const name of names) {
    const bone = geometry.bones.find((b) => b.name === name);
    const cubes = (bone?.cubes ?? []).filter((/** @type {any} */ c) => Array.isArray(c.size));
    if (!bone || !cubes.length) continue;
    const cube = cubes.reduce((/** @type {any} */ big, /** @type {any} */ c) => (c.size[0] * c.size[1] * c.size[2] > big.size[0] * big.size[1] * big.size[2] ? c : big));
    let centre = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] / 2);
    if (cube.rotation && cube.pivot) centre = apply(matFromEuler(vec(cube.rotation)), centre.map((/** @type {number} */ v, /** @type {number} */ k) => v - cube.pivot[k])).map((v, k) => v + cube.pivot[k]);
    const dir = centre.map((/** @type {number} */ v, /** @type {number} */ k) => v - vec(bone.pivot)[k]);
    if (Math.hypot(...dir) > 0.3) out[name] = dir;
  }
  return out;
}

/** Keeps a run of Euler triples continuous (no 359 -> -1 jumps between keyframes). */
function unwrap(/** @type {number[]} */ previous, /** @type {number[]} */ value) {
  return value.map((v, k) => {
    let x = v;
    while (x - previous[k] > 180) x -= 360;
    while (x - previous[k] < -180) x += 360;
    return x;
  });
}

const r3 = (/** @type {number[]} */ v) => v.map((x) => Math.round(x * 1000) / 1000);

/**
 * A whole Bedrock animation for the target: the source sampled at its keyframe times (and every
 * `step` seconds between them), solved at each, with smooth (Catmull-Rom) keyframes.
 * @param {Source} source
 * @param {Target} target
 * @param {{ length: number, loop?: boolean | string, times?: number[], step?: number, override?: boolean, additive?: boolean, passThrough?: Record<string, any> }} options
 *   additive: channels relative to her neutral stance (played on top of her own animations); passThrough: source channels copied as they are (belly, boobs)
 */
export function solveAnimation(source, target, { length, loop = true, times = [], step = 0.25, override = true, additive = false, passThrough = {} }) {
  const grid = new Set(times.map((t) => Math.round(t * 1000) / 1000));
  if (length > 0) for (let t = 0; t <= length + 1e-6; t += step) grid.add(Math.round(Math.min(t, length) * 1000) / 1000);
  grid.add(0);
  const sorted = [...grid].filter((t) => t >= 0 && t <= Math.max(length, 0)).sort((a, b) => a - b);
  /** @type {Record<string, { rotation?: Record<string, any>, position?: Record<string, any> }>} */
  const bones = {};
  /** @type {Record<string, number[]>} */
  const last = {};
  for (const t of sorted) {
    const pose = solveAt(source, target, t);
    for (const [name, p] of Object.entries(pose)) {
      const neutral = target.neutral[name] ?? {};
      for (const channel of /** @type {const} */ (['rotation', 'position'])) {
        let value = p[channel] ? vec(p[channel]) : undefined;
        if (!value) continue;
        if (additive) value = value.map((v, k) => v - vec(neutral[channel])[k]);
        if (channel === 'rotation') {
          const key = `${name}.r`;
          value = last[key] ? unwrap(last[key], value) : value;
          last[key] = value;
        }
        const frames = ((bones[name] ??= {})[channel] ??= {});
        frames[String(t)] = { post: r3(value), lerp_mode: 'catmullrom' };
      }
    }
  }
  // Channels that never change collapse to one value; additive channels that stay at zero go.
  for (const [name, channels] of Object.entries(bones)) {
    for (const channel of /** @type {const} */ (['rotation', 'position'])) {
      const frames = channels[channel];
      if (!frames) continue;
      const values = Object.values(frames).map((f) => f.post);
      const constant = values.every((v) => v.every((x, k) => Math.abs(x - values[0][k]) < 1e-3));
      if (constant) {
        if (additive && values[0].every((x) => Math.abs(x) < 1e-3)) delete channels[channel];
        else channels[channel] = values[0];
      }
    }
    if (!channels.rotation && !channels.position) delete bones[name];
  }
  for (const [name, channels] of Object.entries(passThrough)) bones[name] = { ...(bones[name] ?? {}), ...channels };
  return {
    loop,
    ...(length > 0 ? { animation_length: Math.round(length * 10000) / 10000 } : {}),
    ...(override && !additive ? { override_previous_animation: true } : {}),
    bones,
  };
}

/** A source from a Bedrock animation on a flat rig. */
export function animationSource(/** @type {Rig} */ rig, /** @type {any} */ animation, { pelvis = ['right_leg', 'left_leg'], trunk = 'body' } = {}) {
  return { rig, poseAt: (/** @type {number} */ t) => poseAt(animation, t), pelvis, trunk };
}

/** Every keyframe time of an animation's channels. */
export function keyTimes(/** @type {any} */ animation) {
  const times = new Set([0]);
  for (const channels of Object.values(animation?.bones ?? {})) {
    for (const channel of Object.values(/** @type {Record<string, any>} */ (channels))) {
      if (channel && typeof channel === 'object' && !Array.isArray(channel)) for (const t of Object.keys(channel)) if (Number.isFinite(Number(t))) times.add(Number(t));
    }
  }
  return [...times].sort((a, b) => a - b);
}
