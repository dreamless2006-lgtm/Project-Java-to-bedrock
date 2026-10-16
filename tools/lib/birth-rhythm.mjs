// The shared machinery of the per-mob births: each mother's own push rhythm (a loop length and the
// windows where she pushes), and what is built from it so that everything in her birth keeps time
// with her body:
//
//   * keyframes that are one value inside the push windows and another outside (windowKeys, pulse,
//     tremble, vec), for flair animations played on top of the pose;
//   * her crowning animation (crowningFor): the baby comes out further while she pushes and slips
//     back a little between pushes, and draws back while her legs are closed (the gates);
//   * the sound and particle timelines (effectsAt), and the white flash of the creeper girls
//     (flashLines, read by their render controllers' overlay colour);
//   * the way out (exitMount): a rotation for the crowning mount so the baby leaves her along a
//     chosen world direction in her posed birth, and how far it can come before it reaches the floor
//     (restDepth);
//   * how far a navel opening sits behind the front of the belly (navelInsetLine), so the baby
//     shows at the surface instead of inside her.
//
// All of it is plain data or Molang: the animations it builds are committed, the poses they ride on
// come from the solver.
import { openingOf } from './crowning.mjs';
import { rotateBedrock } from './bedrock-math.mjs';
import { poseAt, poseBones } from './geo-render.mjs';
import { eulerFromMat, rotationFromTo } from './pose-solve.mjs';

/**
 * A mother's push rhythm: the loop length, the windows where she pushes, the windows where her
 * legs close (the baby draws back), and how long a push takes to build up (default 0.25 s).
 * @typedef {{ length: number, pushes: [number, number][], gates?: [number, number][], ramp?: number }} Rhythm
 */
/** @typedef {number | string} KeyValue one axis: a number or a Molang expression */
/** @typedef {Record<string, any>} Keyframes time in seconds (as a key) -> value */

/** How long a push takes to build up and to die away, unless the rhythm says otherwise. */
export const DEFAULT_RAMP = 0.25;
/** How long before a gate the baby starts drawing back: the legs close fast. */
export const GATE_RAMP = 0.15;
/** How far the baby slips back between pushes (fetus units, at most), as in crowning.mjs. */
const SLIP = 'math.min(1.2, 0.45 * v.crown)';

const round = (/** @type {number} */ v, digits = 4) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k || 0;
};

/** A Molang number literal (always with a decimal point). */
export const num = (/** @type {number} */ v) => {
  const r = round(v);
  return Number.isInteger(r) ? `${r}.0` : `${r}`;
};

/** A keyframe time as a key ('0.0', '1.25'): never integer-like, so objects keep the keys in time order. */
export const timeKey = (/** @type {number} */ t) => num(t);

/** Checks a rhythm, so a typo in a mob's table fails the generator instead of the game. */
function windowsOf(/** @type {Rhythm} */ rhythm) {
  const { length, pushes, gates = [] } = rhythm;
  if (!(Number.isFinite(length) && length > 0)) throw new Error(`rhythm: bad length ${length}`);
  if (!Array.isArray(pushes) || !pushes.length) throw new Error('rhythm: no pushes');
  for (const [name, list] of /** @type {const} */ ([['pushes', pushes], ['gates', gates]])) {
    list.forEach(([a, b], i) => {
      if (!(a >= 0 && b > a && b <= length + 1e-9)) throw new Error(`rhythm: ${name} window [${a}, ${b}] is not inside 0..${length}`);
      if (i > 0 && a < list[i - 1][1] - 1e-9) throw new Error(`rhythm: ${name} windows overlap or are out of order at [${a}, ${b}]`);
    });
  }
  return { length, pushes, gates, ramp: rhythm.ramp ?? DEFAULT_RAMP };
}

/**
 * The key times of a set of windows: each window's edges, and its edges moved inward by the ramp
 * (half the window when it is shorter than two ramps), plus 0 and the loop's end.
 */
function windowTimes(/** @type {[number, number][]} */ windows, /** @type {number} */ ramp, /** @type {number} */ length) {
  const times = new Set([0, round(length)]);
  for (const [a, b] of windows) {
    const r = Math.min(ramp, (b - a) / 2);
    for (const t of [a, a + r, b - r, b]) times.add(round(Math.min(length, Math.max(0, t))));
  }
  return [...times].sort((x, y) => x - y);
}

/** How far into its windows `t` is: 0 outside, rising to 1 over the ramp after a window opens, falling back to 0 by its end. */
function weightIn(/** @type {[number, number][]} */ windows, /** @type {number} */ ramp, /** @type {number} */ t) {
  let w = 0;
  for (const [a, b] of windows) {
    if (t <= a || t >= b) continue;
    const r = Math.min(ramp, (b - a) / 2);
    w = Math.max(w, t < a + r ? (t - a) / r : t > b - r ? (b - t) / r : 1);
  }
  return w;
}

/**
 * How hard she is pushing at time t of her loop: 0 between pushes, 1 once a push has built up.
 * @param {Rhythm} rhythm @param {number} t
 */
export function pushWeight(rhythm, t) {
  const { length, pushes, ramp } = windowsOf(rhythm);
  return weightIn(pushes, ramp, ((t % length) + length) % length);
}

/**
 * The middle of her n-th push (the moment to measure a pose at).
 * @param {Rhythm} rhythm
 */
export function midPush(rhythm, n = 0) {
  const { pushes } = windowsOf(rhythm);
  const [a, b] = pushes[Math.min(n, pushes.length - 1)];
  return round((a + b) / 2);
}

/**
 * Keyframes that hold `inside` while she pushes and `outside` elsewhere: keys at 0, the loop's end,
 * each push's start and end (outside) and each push's start plus the ramp and end minus the ramp
 * (inside), so a push builds up over the ramp and dies away by the end of its window. The game
 * joins the keys with straight lines (no lerp_mode), so the values may be numbers, Molang strings
 * or [x, y, z] arrays. The values at 0 and at the loop's end are the same.
 * @template T
 * @param {Rhythm} rhythm @param {T} inside @param {T} outside
 * @returns {Record<string, T>}
 */
export function windowKeys(rhythm, inside, outside) {
  const { length, pushes, ramp } = windowsOf(rhythm);
  /** @type {Record<string, T>} */
  const keys = {};
  for (const t of windowTimes(pushes, ramp, length)) {
    // a key clamped onto the loop's start or end keeps the loop seamless: it is outside
    const w = t <= 0 || t >= length ? 0 : weightIn(pushes, ramp, t);
    keys[timeKey(t)] = w > 0.5 ? inside : outside;
  }
  return keys;
}

/**
 * Her crowning animation, in step with her own pushes: the baby comes out to its depth (v.crown)
 * while she pushes and slips back a little between pushes; inside a gate (her legs closed) it draws
 * back to 15 % unless it is nearly out. The gate is fully on across its window and comes on over
 * GATE_RAMP before it, as in the player's crowning.
 *
 * `inset` (a Molang term, model units) moves the baby further out by how far the opening sits
 * behind the belly's surface (navelInsetLine). It is divided by v.crown_scale, because the slide
 * moves inside the scaled crowning bone. `bob` (a Molang term in slide units, positive = back in)
 * is added as it is, e.g. '0.4 * math.sin(q.anim_time * 720.0)' for the slime's wobble.
 * @param {Rhythm} rhythm
 * @param {{ inset?: string | null, bob?: string | null }} [options]
 */
export function crowningFor(rhythm, { inset = null, bob = null } = {}) {
  const { length, pushes, gates, ramp } = windowsOf(rhythm);
  const gateWindows = /** @type {[number, number][]} */ (gates.map(([a, b]) => [Math.max(0, a - GATE_RAMP), Math.min(length, b + GATE_RAMP)]));
  const times = [...new Set([...windowTimes(pushes, ramp, length), ...windowTimes(gateWindows, GATE_RAMP, length)])].sort((x, y) => x - y);
  /** @type {Keyframes} */
  const slide = {};
  for (const t of times) {
    const edge = t <= 0 || t >= length;
    const w = edge ? 0 : weightIn(pushes, ramp, t);
    const g = edge ? 0 : weightIn(gateWindows, GATE_RAMP, t);
    // (v.crown - slip * (1 - W)) * G, written out without the factors that are 1
    const depth = w >= 1 ? 'v.crown' : w <= 0 ? `v.crown - ${SLIP}` : `v.crown - ${SLIP} * ${num(1 - w)}`;
    const gate = g <= 0 ? '' : ` * (v.push >= 0.8 ? 1.0 : ${num(1 - 0.85 * g)})`;
    const y = `-(${depth})${gate}${inset ? ` - (${inset}) / v.crown_scale` : ''}${bob ? ` + ${bob}` : ''}`;
    slide[timeKey(t)] = [0, y, 0];
  }
  return {
    loop: true,
    animation_length: round(length),
    bones: {
      crowning: { scale: 'v.crowning ? v.crown_scale : 0.0' },
      crowning_slide: { position: slide },
    },
  };
}

/**
 * Keyframes of one number: `base` between pushes, `base + amp` while she pushes.
 * @param {Rhythm} rhythm @param {number} amp
 */
export function pulse(rhythm, amp, base = 0) {
  return windowKeys(rhythm, round(base + amp), round(base));
}

/**
 * Keyframes of one axis that shake while she pushes: `amp * sin(t * hz * 360 + phase)` inside the
 * pushes (the shaking fades in over the ramp), 0 between them.
 * @param {Rhythm} rhythm @param {number} amp @param {number} hz @param {number} [phase] degrees
 */
export function tremble(rhythm, amp, hz, phase = 0) {
  const shift = phase > 0 ? ` + ${num(phase)}` : phase < 0 ? ` - ${num(-phase)}` : '';
  return windowKeys(rhythm, `${num(amp)} * math.sin(q.anim_time * ${num(hz * 360)}${shift})`, '0.0');
}

/** One axis's value at time t: its own key, else held before the first and after the last, else between its neighbours. */
function axisAt(/** @type {KeyValue | Keyframes} */ axis, /** @type {number} */ t) {
  if (typeof axis !== 'object' || axis === null) return axis;
  const frames = Object.entries(axis).map(([k, v]) => ({ t: round(Number(k)), v: /** @type {KeyValue} */ (v) })).sort((a, b) => a.t - b.t);
  const exact = frames.find((f) => f.t === t);
  if (exact) return exact.v;
  if (!frames.length) return 0;
  if (t < frames[0].t) return frames[0].v;
  const last = frames[frames.length - 1];
  if (t > last.t) return last.v;
  const i = frames.findIndex((f) => f.t > t);
  const a = frames[i - 1], b = frames[i];
  const f = (t - a.t) / (b.t - a.t);
  if (typeof a.v === 'number' && typeof b.v === 'number') return round(a.v + (b.v - a.v) * f);
  if (a.v === b.v) return a.v;
  return `math.lerp(${a.v}, ${b.v}, ${num(f)})`;
}

/**
 * Per-axis keyframes (or constants) as one channel of [x, y, z] keyframes, on the union of their
 * times; an axis without a key at one of those times takes its value there (numbers between, or
 * math.lerp of two expressions). All constants give a plain [x, y, z].
 * @param {KeyValue | Keyframes} x @param {KeyValue | Keyframes} y @param {KeyValue | Keyframes} z
 * @returns {KeyValue[] | Keyframes}
 */
export function vec(x, y, z) {
  const axes = [x, y, z];
  const maps = axes.filter((a) => typeof a === 'object' && a !== null);
  if (!maps.length) return /** @type {KeyValue[]} */ (axes);
  const times = [...new Set(maps.flatMap((m) => Object.keys(m).map((k) => round(Number(k)))))].sort((a, b) => a - b);
  /** @type {Keyframes} */
  const out = {};
  for (const t of times) out[timeKey(t)] = axes.map((a) => axisAt(a, t));
  return out;
}

/**
 * A sound_effects or particle_effects timeline: the effect at each time, a time already taken
 * moved on by 0.01 s (the game keys one effect per time).
 * @param {number[]} times @param {string} effect a short name the entity maps to an id
 */
export function effectsAt(times, effect) {
  return placeEffects(times.map((t) => ({ t, value: { effect } })));
}

/**
 * Several effect timelines (from effectsAt, or any { time: { effect } } objects) as one, in time
 * order; a time already taken moves on by 0.01 s.
 * @param {...Record<string, any>} timelines
 */
export function mergeEffects(...timelines) {
  return placeEffects(timelines.flatMap((timeline) => Object.entries(timeline).map(([k, value]) => ({ t: Number(k), value }))));
}

/** Effects keyed by time in time order, each on a time of its own (+0.01 s while taken). */
function placeEffects(/** @type {{ t: number, value: any }[]} */ entries) {
  const taken = new Set();
  const placed = [...entries]
    .sort((a, b) => a.t - b.t)
    .map(({ t, value }) => {
      let at = round(t, 2);
      while (taken.has(at)) at = round(at + 0.01, 2);
      taken.add(at);
      return { at, value };
    })
    .sort((a, b) => a.at - b.at);
  return Object.fromEntries(placed.map(({ at, value }) => [timeKey(at), value]));
}

/**
 * The pre_animation lines of the creeper girls' birth flash: a timer that runs while she is in
 * the birth pose (v.bt), its place in her loop (v.bph), a flicker at `hz` inside the windows
 * (v.bflash), folded into the fuse flash her render controllers already read (v.flash). The last
 * line must come after the entity's own `v.flash =` line.
 * @param {{ length: number, windows: [number, number][], hz?: number, level?: number }} options
 */
export function flashLines({ length, windows, hz = 10, level = 0.6 }) {
  windowsOf({ length, pushes: windows });
  const inside = windows.map(([a, b]) => `(v.bph >= ${num(a)} && v.bph < ${num(b)})`).join(' || ');
  return [
    "v.bt = v.pose == 'birth' ? v.bt + q.delta_time : 0.0;",
    `v.bph = math.mod(v.bt, ${num(length)});`,
    `v.bflash = (${inside}) && math.mod(math.floor(v.bt * ${num(hz)}), 2.0) == 0.0 ? ${num(level)} : 0.0;`,
    'v.flash = math.max(v.flash, v.bflash);',
  ];
}

const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (/** @type {number[]} */ v) => {
  const n = Math.hypot(...v);
  if (!(n > 1e-9)) throw new Error(`not a direction: ${v}`);
  return v.map((x) => x / n);
};

/**
 * The crowning mount's rotation that sends the baby out along `want` (a world direction; her
 * front is -z) when she is posed at time t of `animation`: her geometry posed (poseBones +
 * poseAt), `want` turned into the frame of the bone the mount hangs from, and the rotation taking
 * the mount's -y onto it. Also how far the opening is from the floor along `want` (Infinity when
 * `want` does not point down; negative when the opening is below the floor), and where the
 * posed opening is.
 * @param {{ bones: any[] }} geometry her geometry (the bones the crowning geometry copies)
 * @param {{ bones?: Record<string, any> }} animation her solved birth
 * @param {string} parentBone the bone the crowning mount hangs from
 * @param {number[]} opening where the baby comes out (model space, the parent's rest frame)
 * @param {number[]} want world direction, need not be normalised
 * @param {number} t seconds into the animation
 * @returns {{ mount: number[], clearance: number, origin: number[] }}
 */
export function exitMount(geometry, animation, parentBone, opening, want, t) {
  if (!geometry.bones.some((b) => b.name === parentBone)) throw new Error(`exitMount: no bone ${parentBone}`);
  const toWorld = /** @type {(p: number[]) => number[]} */ (poseBones(geometry, poseAt(animation, t)).get(parentBone));
  const origin = toWorld(opening);
  // the parent's axes in the world (its columns), unscaled
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => unit(toWorld(opening.map((v, k) => v + e[k])).map((v, k) => v - origin[k])));
  const w = unit(want);
  const local = axes.map((axis) => dot(axis, w));
  const mount = eulerFromMat(rotationFromTo([0, -1, 0], local)).map((v) => round(v, 3));
  const clearance = w[1] >= -1e-9 ? Infinity : origin[1] / -w[1];
  return { mount, clearance, origin };
}

/**
 * How much further than the head the baby may come (crowningLines' `rest`, fetus units) so that,
 * fully out, it stops half a unit short of the floor: clearance in model units over the baby's
 * scale, less the head, within 2..8.
 * @param {number} clearance from exitMount @param {number} crownScale v.crown_scale @param {number} [head] crowningLines' `head`
 */
export function restDepth(clearance, crownScale, head = 3) {
  const free = Number.isFinite(clearance) ? clearance / crownScale - head - 0.5 : Infinity;
  return round(Math.min(8, Math.max(2, free)), 3);
}

/**
 * How far each phase's navel opening sits behind the front of her belly: the opening's z less the
 * front-most z of the belly's cubes (kick bones left out: they move) within 2 units of the opening
 * across and up, measured in the belly bone's own frame (the frame the opening is given in).
 * @param {Record<string | number, { bones: any[], description?: any }>} geometriesByPhase her P4..P9 models
 * @param {number[] | Record<string | number, number[]> | ((geometry: any, phase: number) => number[])} [opening] default: the front of the front kick (crowning.mjs openingOf 'navel')
 * @param {{ bone?: string }} [options] the bone the opening hangs from
 * @returns {Record<string, number>}
 */
export function navelInsets(geometriesByPhase, opening, { bone = 'belly' } = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, geometry] of Object.entries(geometriesByPhase)) {
    const phase = Number(key);
    const at = typeof opening === 'function' ? opening(geometry, phase) : Array.isArray(opening) ? opening : opening?.[key] ?? openingOf(geometry, 'navel').opening;
    out[key] = insetOf(geometry, at, bone);
  }
  return out;
}

/** The inset of one model (see navelInsets). */
function insetOf(/** @type {{ bones: any[], description?: any }} */ geometry, /** @type {number[]} */ opening, /** @type {string} */ bone) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  if (!byName.has(bone)) throw new Error(`${geometry.description?.identifier ?? 'geometry'}: no bone ${bone}`);
  // her rest rotations from the root down to the belly undone, so its subtree comes out in its own frame
  /** @type {Record<string, { rotation: number[] }>} */
  const undo = {};
  for (let b = byName.get(bone); b; b = b.parent ? byName.get(b.parent) : undefined) {
    if (Array.isArray(b.rotation)) undo[b.name] = { rotation: b.rotation.map((/** @type {number} */ r) => -r) };
  }
  const transforms = poseBones(geometry, undo);
  const inside = (/** @type {any} */ b) => {
    for (let x = b; x; x = x.parent ? byName.get(x.parent) : undefined) {
      if (/kick/i.test(x.name)) return false;
      if (x.name === bone) return true;
    }
    return false;
  };
  let front = Infinity;
  for (const b of geometry.bones.filter(inside)) {
    const toWorld = /** @type {(p: number[]) => number[]} */ (transforms.get(b.name));
    for (const cube of b.cubes ?? []) {
      if (!Array.isArray(cube.size) || !Array.isArray(cube.origin)) continue;
      const inflate = typeof cube.inflate === 'number' ? cube.inflate : 0;
      const lo = cube.origin.map((/** @type {number} */ o) => o - inflate);
      const hi = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] + inflate);
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => {
        let p = [n & 1 ? hi[0] : lo[0], n & 2 ? hi[1] : lo[1], n & 4 ? hi[2] : lo[2]];
        if (Array.isArray(cube.rotation) && Array.isArray(cube.pivot)) p = rotateBedrock(p.map((v, k) => v - cube.pivot[k]), cube.rotation).map((v, k) => v + cube.pivot[k]);
        return toWorld(p);
      });
      const min = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
      const max = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
      if (min[0] < opening[0] + 2 && max[0] > opening[0] - 2 && min[1] < opening[1] + 2 && max[1] > opening[1] - 2) front = Math.min(front, min[2]);
    }
  }
  return Number.isFinite(front) ? round(Math.max(0, opening[2] - front), 2) : 0;
}

/**
 * The pre_animation line of the navel inset, per belly size: 'v.ninset = (v.bp == 4 ? a : (v.bp ==
 * 5 ? b : ... 0.0));' with the insets of navelInsets.
 * @param {Parameters<typeof navelInsets>[0]} geometriesByPhase
 * @param {Parameters<typeof navelInsets>[1]} [opening]
 * @param {Parameters<typeof navelInsets>[2]} [options]
 */
export function navelInsetLine(geometriesByPhase, opening, options) {
  const insets = navelInsets(geometriesByPhase, opening, options);
  const phases = Object.keys(insets).map(Number).sort((a, b) => b - a);
  let expr = '0.0';
  for (const p of phases) expr = `(v.bp == ${p} ? ${num(insets[p])} : ${expr})`;
  return `v.ninset = ${expr};`;
}

/** The pre_animation lines this module writes (to filter them out before writing them again). */
export const BIRTH_LINE = /^v\.(bt|bph|bflash|ninset) =|^v\.flash = math\.max\(v\.flash, v\.bflash\)/;
