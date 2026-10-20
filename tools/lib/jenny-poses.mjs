// What the Jenny Mod Java Port girls do while they keep moving (tools/lib/scene-poses.mjs adds the
// poses to each girl's pose controller, tools/import-jenny.mjs the flight to the Bee):
//
//   * fetal_movement (the babies move: one hand pressed where they kick, the other holding her belly
//     from below, her head bent to look at it) and belly_rubs (she rubs her belly in slow circles
//     with both hands). Neither holds her still (packs/behavior/scripts/mobs/system.js stops a mob
//     only in the pains that incapacitate), so only her head and arms are posed: the animations
//     override her own on those bones alone, and her walk and idle go on moving her legs, hips,
//     tail and wings. Her hands rest on the belly
//     she has: for every belly size from P3 (v.bp; the babies move and her belly wants rubs from
//     P3 on) and at either end of its growth within that size (v.belly_growth) each hand's spot is
//     found on her fitted belly (tools/lib/belly-fit.mjs, at the top of its breath), and her arm
//     reaches it with a two-bone reach (the elbow out to her side and back). The channels are
//     Molang on plain keyframes: the size picks its values, the growth slides between its two ends.
//   * the flight of a girl who flies and has no walk of her own (the Bee hovers in her idle): she
//     leans into it as she speeds up, her legs trail and kick and her wings buzz harder. Additive
//     and expression-only, nothing when she hangs still.
//   * how far the shared belly controller swells her belly in each pose (bellySwells): the babies'
//     kicks push it a third to two thirds deeper for a moment, a contraction tightens it forward.
//     The hands that feel the babies rest partway into that swell, and handsInside measures a
//     pose's hands against its belly at its fullest, so the labor poses keep their hands out of it.
import { BELLY_ANIMATIONS, bellyController, kickStateLines } from './belly-render.mjs';
import { animationTime, cubeFaces, poseAt, poseBones } from './geo-render.mjs';
import { evalMolang, runMolang } from './molang-lite.mjs';
import { apply, eulerFromMat, matFromEuler, mul, pivotOf, rotationFromTo, transpose, worldOf } from './pose-solve.mjs';

/** @typedef {import('./pose-solve.mjs').Rig} Rig */
/** @typedef {import('./geo-render.mjs').BonePose} BonePose */
/** @typedef {number[][]} Mat3 */

const round = (/** @type {number} */ v, digits = 2) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k || 0;
};
const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => v - b[k]);
const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => v + b[k]);
const times = (/** @type {number[]} */ a, /** @type {number} */ s) => a.map((v) => v * s);
const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (/** @type {number[]} */ v) => times(v, 1 / (Math.hypot(...v) || 1));

/** The belly sizes her hands are placed on (a smaller belly takes P3's spots). */
export const TOUCH_SIZES = [3, 4, 5, 6, 7, 8, 9];
/** v.belly_growth at the end of a size's growth (tools/lib/belly-render.mjs bellyPreAnimation). */
export const fullGrowth = (/** @type {number} */ phase) => (phase <= 2 ? 1.0 : phase <= 4 ? 0.9 : phase === 5 ? 0.8 : phase <= 7 ? 0.7 : 0.6);
/** The belly bone's scale at a v.belly_growth (animation.minepreggo.belly_growth) at the top of its breath (the high inflation's peak). */
export const bellyScale = (/** @type {number} */ growth) => [(1 + 0.15 * growth) * 1.015, 1 + 0.05 * growth, (1 + 0.4 * growth) * 1.075];
/** The belly bone's scale from her growth alone (animation.minepreggo.belly_growth). */
export const growthScale = (/** @type {number} */ growth) => [1 + 0.15 * growth, 1 + 0.05 * growth, 1 + 0.4 * growth];

/**
 * How far the belly animations swell her belly beyond its growth at their fullest: a scale per
 * axis and a shift of the belly bone.
 * @typedef {{ scale: number[], position: number[] }} Swell
 */
/** The top of her breath (the high inflation's peak): the swell of a pose without kicks or contractions, the one bellyScale adds to her growth. */
export const BREATH = /** @type {Swell} */ ({ scale: [1.015, 1, 1.075], position: [0, 0, 0] });

/** The belly controller's animations that are not a swell: her growth (measured on its own) and the belly hidden after the birth. */
const NOT_SWELL = new Set(['belly_growth', 'belly_hidden']);

/**
 * The swell her belly reaches in each pose and size as the shared belly controller plays it
 * (tools/lib/belly-render.mjs): whether the pose kicks and contracts comes from kickStateLines, at
 * every strength she may kick with, tamed or not (a tamed girl keeps breathing while the babies
 * kick); the animations of the size's state, but her growth, are sampled together from the state's
 * start (the birth halfway through a push). Each axis takes its fullest; the shift is the one of
 * the fullest moment.
 * @param {Record<string, any>} animations the belly animations by id (packs/resource/animations/minepreggo/belly.animation.json and preggo_mob.animation.json)
 * @returns {(pose: string, phase: number) => Swell}
 */
export function bellySwells(animations) {
  const states = /** @type {Record<string, { animations?: (string | Record<string, string>)[] }>} */ (bellyController(false).states);
  /** @type {Map<string, Swell>} */
  const cache = new Map();
  const measure = (/** @type {string} */ pose, /** @type {number} */ phase) => {
    const out = { scale: [1, 1, 1], position: [0, 0, 0] };
    let fullest = 0;
    for (const kick of [0, 1, 2]) {
      for (const tamed of [0, 1]) {
        /** @type {Record<string, any>} */
        const v = { pose, kick };
        const q = { property: () => 'none', delta_time: 0.1, is_tamed: tamed };
        // her kicks and contraction eased all the way in
        runMolang(kickStateLines(), { v, q }, { frames: 30 });
        Object.assign(v, { kl: 1 + Number(v.kick), push: pose === 'birth' ? 0.5 : 0, bp: phase, phase });
        /** @type {{ anim: any, weight: number }[]} */
        const layers = [];
        for (const entry of states[`p${phase}`]?.animations ?? []) {
          const name = typeof entry === 'string' ? entry : Object.keys(entry)[0];
          if (NOT_SWELL.has(name)) continue;
          const weight = typeof entry === 'string' ? 1 : evalMolang(entry[name], { v, q });
          const anim = animations[/** @type {Record<string, string>} */ (BELLY_ANIMATIONS)[name]];
          if (weight > 0 && anim?.bones?.belly) layers.push({ anim, weight });
        }
        // long enough for the slowest loop and the six-second contraction wave
        const span = Math.max(6, ...layers.map(({ anim }) => Number(anim.animation_length ?? 0)));
        for (let t = 0; t <= span; t += 0.04) {
          const scale = [1, 1, 1], position = [0, 0, 0];
          for (const { anim, weight } of layers) {
            const belly = poseAt(anim, animationTime(anim, t), { evaluate: { v, q: { ...q, life_time: t } } }).belly ?? {};
            (belly.scale ?? [1, 1, 1]).forEach((s, k) => (scale[k] *= 1 + (Number(s) - 1) * weight));
            (belly.position ?? [0, 0, 0]).forEach((p, k) => (position[k] += Number(p) * weight));
          }
          scale.forEach((s, k) => (out.scale[k] = Math.max(out.scale[k], s)));
          const volume = scale[0] * scale[1] * scale[2];
          if (volume > fullest) [fullest, out.position] = [volume, position];
        }
      }
    }
    return { scale: out.scale.map((s) => round(s, 3)), position: out.position.map((p) => round(p, 3)) };
  };
  return (pose, phase) => {
    const key = `${pose}/${phase}`;
    let swell = cache.get(key);
    if (!swell) cache.set(key, (swell = measure(pose, phase)));
    return swell;
  };
}

/** A swell `share` of the way from `a` to `b` (the scales geometrically). */
const mixSwell = (/** @type {Swell} */ a, /** @type {Swell} */ b, /** @type {number} */ share) => ({
  scale: a.scale.map((s, k) => s * (b.scale[k] / s) ** share),
  position: a.position.map((p, k) => p + (b.position[k] - p) * share),
});

/**
 * How far into her belly's swell (beyond her breath) the hands of a walking pose rest: two fifths of
 * the way, so her hands lie within about a pixel of her calm belly and a kick's fullest moment
 * presses into them by little more than a forearm's thickness (the swell's timing is the belly
 * controller's, which a pose cannot follow; on her breath alone a kick buries them, halfway leaves
 * them floating off her calm belly).
 */
export const TOUCH_SWELL = 0.4;

/**
 * Her belly as a solid under a pose: the cubes of the belly bone and of all that hangs from it
 * (the kick patches fill its kick spots), each as its corner and the inverse of its edges, and the
 * middle of its bounding box. `inside` tells whether a point (model space) is in any of them;
 * `toBelly` turns a direction given in the belly's own frame into model space.
 * @param {{ bones: any[] }} belly a fitted belly geometry @param {Record<string, BonePose>} pose
 */
export function bellySolid(belly, pose) {
  const inBelly = new Set(['belly']);
  for (const b of belly.bones) if (b.parent && inBelly.has(b.parent)) inBelly.add(b.name);
  const only = { bones: belly.bones.map((b) => (inBelly.has(b.name) ? b : { ...b, cubes: [] })) };
  const faces = cubeFaces(only, pose);
  /** @type {{ o: number[], inv: Mat3, lo: number[], hi: number[] }[]} */
  const cubes = [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  // six faces per cube: north is [c000, c100, c110, c010], south [c101, c001, c011, c111]
  for (let i = 0; i + 1 < faces.length; i += 6) {
    const [c000, c100, , c010] = faces[i].corners;
    const c001 = faces[i + 1].corners[1];
    const edges = [sub(c100, c000), sub(c010, c000), sub(c001, c000)];
    const inv = invert(transpose(edges));
    if (!inv) continue;
    const corners = faces.slice(i, i + 6).flatMap((f) => f.corners);
    const cLo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
    const cHi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], cLo[k]);
      hi[k] = Math.max(hi[k], cHi[k]);
    }
    cubes.push({ o: c000, inv, lo: cLo, hi: cHi });
  }
  // the cubes by the unit cells their bounding boxes touch, so a point is tested against a few
  /** @type {Map<string, typeof cubes>} */
  const grid = new Map();
  for (const cube of cubes) {
    const [a, b] = [cube.lo.map(Math.floor), cube.hi.map(Math.floor)];
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      const key = `${x},${y},${z}`;
      const list = grid.get(key);
      if (list) list.push(cube);
      else grid.set(key, [cube]);
    }
  }
  const inside = (/** @type {number[]} */ p) =>
    (grid.get(p.map(Math.floor).join(',')) ?? []).some(({ o, inv, lo: a, hi: b }) => {
      if (p.some((v, k) => v < a[k] - 1e-6 || v > b[k] + 1e-6)) return false;
      const q = apply(inv, sub(p, o));
      return q.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
    });
  const toWorld = poseBones(only, pose).get('belly');
  const pivot = belly.bones.find((b) => b.name === 'belly')?.pivot ?? [0, 0, 0];
  const toBelly = (/** @type {number[]} */ dir) => (toWorld ? unit(sub(toWorld(add(pivot, dir)), toWorld(pivot))) : unit(dir));
  const centre = lo.map((v, k) => (v + hi[k]) / 2);
  /**
   * In the skin, or in the hollow it closes (the way out from the belly's middle through the point
   * meets the skin beyond it), `slack` deep at least: the point moved that far out is in it still.
   */
  const within = (/** @type {number[]} */ point, slack = 0) => {
    const from = sub(point, centre);
    const p = slack ? add(point, times(unit(from), slack)) : point;
    if (inside(p)) return true;
    if (p.some((v, k) => v < lo[k] || v > hi[k])) return false;
    const r = Math.hypot(...sub(p, centre));
    const dir = r > 1e-6 ? times(sub(p, centre), 1 / r) : [0, 0, -1];
    for (let s = r + 0.1; ; s += 0.1) {
      const q = add(centre, times(dir, s));
      if (q.some((v, k) => v < lo[k] - 1e-6 || v > hi[k] + 1e-6)) return false;
      if (inside(q)) return true;
    }
  };
  return { inside, within, centre, toBelly, empty: !cubes.length };
}

/** The inverse of a 3x3 matrix, or undefined when it is singular. */
function invert(/** @type {Mat3} */ m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return undefined;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Where a ray from the belly's middle leaves its skin (marched in from outside, so its shell's hollow does not stop it). */
export function skinAlong(/** @type {ReturnType<typeof bellySolid>} */ solid, /** @type {number[]} */ dir) {
  for (let s = 24; s >= 0; s -= 0.04) {
    const p = add(solid.centre, times(dir, s));
    if (solid.inside(p)) return p;
  }
  return solid.centre;
}

/**
 * A hand's spot on her skin: along `preferred` from the belly's middle (in the belly's frame),
 * `off` beyond the skin, or, when that is further from her shoulder than her arm reaches, the
 * first spot within reach on the way from it through each of `ways` in turn (the last one when
 * none is).
 * @param {ReturnType<typeof bellySolid>} solid @param {number[]} preferred @param {number[][]} ways
 * @param {{ shoulder: number[], length: number }} arm @param {number} off
 */
export function spotWithin(solid, preferred, ways, arm, off) {
  const spotOn = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ f) => {
    const dir = solid.toBelly(unit(add(times(unit(a), 1 - f), times(unit(b), f))));
    return add(skinAlong(solid, dir), times(dir, off));
  };
  const within = (/** @type {number[]} */ spot) => Math.hypot(...sub(spot, arm.shoulder)) <= arm.length - 0.2;
  let spot = spotOn(preferred, preferred, 0);
  if (within(spot)) return spot;
  let from = preferred;
  for (const way of ways) {
    const end = spotOn(from, way, 1);
    if (within(end)) {
      // the nearest reachable spot on this stretch (halving it between one out of reach and one within)
      let [out, inn] = [0, 1];
      spot = end;
      for (let n = 0; n < 5; n++) {
        const f = (out + inn) / 2;
        const mid = spotOn(from, way, f);
        if (within(mid)) [inn, spot] = [f, mid];
        else out = f;
      }
      return spot;
    }
    [from, spot] = [way, end];
  }
  return spot;
}

/**
 * One of her arms for the reach: the shoulder and elbow bones, the far end of her forearm (the
 * middle of its corners farthest from the elbow: her hand) in the rig's own coordinates, and half
 * the forearm's thickness (how far the hand's axis keeps off the skin).
 * @param {{ bones: any[] }} geometry @param {'R' | 'L'} side
 */
export function armOf(geometry, side) {
  const arm = `arm${side}`, fore = `lowerArm${side}`;
  const bone = geometry.bones.find((b) => b.name === fore);
  if (!bone || !geometry.bones.some((b) => b.name === arm)) return undefined;
  const pivot = bone.pivot ?? [0, 0, 0];
  const cubes = (bone.cubes ?? []).filter((/** @type {any} */ c) => Array.isArray(c.size));
  if (!cubes.length) return undefined;
  /** @type {number[][]} */
  const corners = [];
  for (const c of cubes) {
    const R = c.rotation && c.pivot ? matFromEuler(c.rotation) : undefined;
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      const p = [c.origin[0] + x * c.size[0], c.origin[1] + y * c.size[1], c.origin[2] + z * c.size[2]];
      corners.push(R ? add(apply(R, sub(p, c.pivot)), c.pivot) : p);
    }
  }
  const far = Math.max(...corners.map((p) => Math.hypot(...sub(p, pivot))));
  const end = corners.filter((p) => Math.hypot(...sub(p, pivot)) > far - 0.35);
  const tip = [0, 1, 2].map((k) => end.reduce((s, p) => s + p[k], 0) / end.length);
  const big = cubes.reduce((/** @type {any} */ a, /** @type {any} */ c) => (c.size[0] * c.size[1] * c.size[2] > a.size[0] * a.size[1] * a.size[2] ? c : a));
  return { arm, fore, tip, half: Math.min(big.size[0], big.size[2]) / 2 };
}

/** Euler angles kept within half a turn of a reference (no 359 -> -1 jumps between keyframes or sizes). */
const near = (/** @type {number[]} */ value, /** @type {number[]} */ ref) =>
  value.map((v, k) => {
    let x = v;
    while (x - ref[k] > 180) x -= 360;
    while (x - ref[k] < -180) x += 360;
    return x;
  });

/**
 * Her arm reaching a point: the shoulder turns the elbow onto its place on the circle of the
 * two-bone reach nearest `pole` (a direction: where the elbow points), the forearm turns the
 * shortest way from its own bend onto the point. Out of reach, the arm points at it. Returns the
 * shoulder's and forearm's rotation channels (the game adds them to the rest rotations), with
 * the rest of her pose as it is.
 * @param {Rig} rig @param {Record<string, BonePose>} pose her stance (the arms' parents posed by it)
 * @param {NonNullable<ReturnType<typeof armOf>>} arm @param {number[]} target @param {number[]} pole
 */
export function reach(rig, pose, arm, target, pole) {
  const world = worldOf(rig, pose);
  const armW = /** @type {{ R: Mat3, t: number[] }} */ (world.get(arm.arm));
  const foreW = /** @type {{ R: Mat3, t: number[] }} */ (world.get(arm.fore));
  const S = pivotOf(rig, world, arm.arm), E0 = pivotOf(rig, world, arm.fore);
  const H0 = add(apply(foreW.R, arm.tip), foreW.t);
  const L1 = Math.hypot(...sub(E0, S)), L2 = Math.hypot(...sub(H0, E0));
  const toward = unit(sub(target, S));
  const D = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, Math.hypot(...sub(target, S))));
  const along = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const out = unit(sub(pole, times(toward, dot(pole, toward))));
  const E = add(S, add(times(toward, along), times(out, Math.sqrt(Math.max(0, L1 * L1 - along * along)))));
  const T = add(S, times(toward, D));
  const armR = mul(rotationFromTo(sub(E0, S), sub(E, S)), armW.R);
  const bent = mul(armR, mul(transpose(armW.R), foreW.R));
  const foreR = mul(rotationFromTo(apply(bent, sub(arm.tip, /** @type {any} */ (rig.get(arm.fore)).pivot)), sub(T, E)), bent);
  const parent = rig.get(arm.arm)?.parent;
  const parentR = parent && world.get(parent) ? /** @type {{ R: Mat3 }} */ (world.get(parent)).R : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const channel = (/** @type {string} */ name, /** @type {Mat3} */ local) => {
    const rest = /** @type {any} */ (rig.get(name)).rest;
    const was = (pose[name]?.rotation ?? [0, 0, 0]).map(Number);
    return near(eulerFromMat(local).map((v, k) => v - rest[k]), was);
  };
  return { [arm.arm]: channel(arm.arm, mul(transpose(parentR), armR)), [arm.fore]: channel(arm.fore, mul(transpose(armR), foreR)) };
}

/**
 * Where her hands go in a walking pose, at a moment of its loop: for each side, a direction from
 * her belly's middle in the belly's own frame (her right is -x, her front -z) whose skin the hand
 * rests on, and the ways it gives toward when that spot is out of her reach (a big belly sticks out
 * further than her arm is long: her hands then rest on its side, its upper slope or, on a girl whose
 * belly sits low under short arms (Luna), its top against her body). `head`: her
 * head's turn added to her stance.
 * @typedef {{ length: number, keys: number[], hands: (t: number) => { R: number[], L: number[] }, fallback: { R: number[][], L: number[][] }, head: (t: number) => number[] }} TouchPose
 */

/** The belly rubs: both hands on its front, circling slowly against each other. */
const RUBS = /** @type {TouchPose} */ ({
  length: 2.4,
  keys: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4],
  hands: (t) => {
    const a = (t / 2.4) * 2 * Math.PI;
    const circle = (/** @type {number[]} */ base, /** @type {number} */ phase) => unit(add(base, [0.24 * Math.cos(a + phase), 0.2 * Math.sin(a + phase), 0]));
    return { R: circle([-0.38, -0.05, -0.92], 0), L: circle([0.38, 0.1, -0.92], Math.PI) };
  },
  fallback: { R: [[-0.9, 0.45, -0.2], [-0.45, 0.9, -0.1], [-0.25, 0.95, 0.3]], L: [[0.9, 0.45, -0.2], [0.45, 0.9, -0.1], [0.25, 0.95, 0.3]] },
  head: (t) => [16, 5 * Math.sin((t / 2.4) * 2 * Math.PI), 0],
});

/** The babies moving: her right hand pressed on the front of her belly sliding after the kicks, her left holding it from below. */
const FEEL = /** @type {TouchPose} */ ({
  length: 3,
  keys: [0, 0.75, 1.5, 2.25, 3],
  hands: (t) => {
    const s = 0.5 - 0.5 * Math.cos((t / 3) * 2 * Math.PI);
    return { R: unit([-0.55 + 0.2 * s, 0.15 - 0.12 * s, -0.82]), L: unit([0.3, -0.72 + 0.06 * s, -0.62]) };
  },
  fallback: { R: [[-0.9, 0.45, -0.2], [-0.45, 0.9, -0.1], [-0.25, 0.95, 0.3]], L: [[0.95, -0.25, -0.2], [0.9, 0.45, -0.2], [0.45, 0.9, -0.1], [0.25, 0.95, 0.3]] },
  head: (t) => {
    const s = 0.5 - 0.5 * Math.cos((t / 3) * 2 * Math.PI);
    return [22 + 4 * s, 10 - 5 * s, 0];
  },
});

/** The walking poses by their minepreggo:pose value. */
export const TOUCH_POSES = { fetal_movement: FEEL, belly_rubs: RUBS };

/**
 * A Molang value picked by the belly size and slid by its growth: per size its values at no growth
 * and at full growth, as one number when they all agree.
 * @param {Record<number, [number, number]>} bySize size -> [at no growth, at full growth]
 */
export function sizedValue(bySize) {
  const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
  const terms = sizes.map((p) => {
    const [a, b] = bySize[p];
    const slope = round((b - a) / fullGrowth(p), 2);
    return { a: round(a), slope, text: slope ? `${round(a).toFixed(2)} + ${slope.toFixed(2)} * v.belly_growth` : round(a).toFixed(2) };
  });
  if (terms.every((x) => x.a === terms[0].a && !x.slope)) return terms[0].a;
  let expr = terms[terms.length - 1].text;
  for (let n = terms.length - 2; n >= 0; n--) expr = `v.bp <= ${sizes[n]} ? (${terms[n].text}) : (${expr})`;
  return expr;
}

/**
 * Her two walking poses: her arms reaching the spots of each moment on each belly size, her head
 * bent to look at her belly. Head and arm channels only (the face and clothes are scene-poses'),
 * overriding hers on those bones.
 * @param {object} options
 * @param {{ bones: any[] }} options.geometry her main body
 * @param {Rig} options.rig her rig (tools/lib/pose-solve.mjs rigOf)
 * @param {Record<string, BonePose>} options.neutral her stance (her idle's first frame)
 * @param {Record<number, { bones: any[] }>} options.bellies her fitted belly of each size
 * @param {(pose: string, phase: number) => Swell} [options.swell] how each pose swells her belly (bellySwells; without it, her breath only):
 *   her hands rest TOUCH_SWELL of the way into the swell beyond her breath
 * @returns {Record<string, any>} pose -> animation (none when she has no arms or bellies to reach)
 */
export function touchPoses({ geometry, rig, neutral, bellies, swell }) {
  const arms = { R: armOf(geometry, 'R'), L: armOf(geometry, 'L') };
  const sizes = TOUCH_SIZES.filter((p) => bellies[p]);
  if (!arms.R || !arms.L || !sizes.length || !rig.has('head')) return {};
  /** @type {Map<string, ReturnType<typeof bellySolid>>} */
  const solids = new Map();
  const solidOf = (/** @type {string} */ pose, /** @type {number} */ p, /** @type {number} */ growth) => {
    const s = swell ? mixSwell(BREATH, swell(pose, p), TOUCH_SWELL) : BREATH;
    const key = `${p}/${growth}/${s.scale.join(',')}/${s.position.join(',')}`;
    if (!solids.has(key)) solids.set(key, bellySolid(bellies[p], { ...neutral, belly: { scale: growthScale(growth).map((v, k) => v * s.scale[k]), position: s.position } }));
    return /** @type {ReturnType<typeof bellySolid>} */ (solids.get(key));
  };
  const head = (neutral.head?.rotation ?? [0, 0, 0]).map(Number);
  // each shoulder and how far its arm reaches, in her stance
  const world = worldOf(rig, neutral);
  const reachOf = Object.fromEntries(
    Object.entries(arms).map(([side, arm]) => {
      const a = /** @type {NonNullable<ReturnType<typeof armOf>>} */ (arm);
      const fore = /** @type {{ R: Mat3, t: number[] }} */ (world.get(a.fore));
      const shoulder = pivotOf(rig, world, a.arm), elbow = pivotOf(rig, world, a.fore);
      const length = Math.hypot(...sub(elbow, shoulder)) + Math.hypot(...sub(add(apply(fore.R, a.tip), fore.t), elbow));
      return [side, { shoulder, length }];
    })
  );
  /** @type {Record<string, any>} */
  const out = {};
  for (const [pose, spec] of Object.entries(TOUCH_POSES)) {
    /** @type {Record<string, Record<string, (number | string)[]>>} bone -> time -> channel */
    const frames = {};
    for (const t of spec.keys) {
      const spots = spec.hands(t);
      /** @type {Record<string, Record<number, [number, number][]>>} bone -> size -> axis values at [no, full] growth */
      const values = {};
      for (const p of sizes) {
        for (const [g, end] of [[0, 0], [fullGrowth(p), 1]]) {
          const solid = solidOf(pose, p, g);
          if (solid.empty) continue;
          for (const side of /** @type {const} */ (['R', 'L'])) {
            const arm = /** @type {NonNullable<ReturnType<typeof armOf>>} */ (arms[side]);
            const target = spotWithin(solid, spots[side], spec.fallback[side], reachOf[side], arm.half + 0.1);
            const pole = solid.toBelly([side === 'R' ? -0.8 : 0.8, -0.3, 0.6]);
            for (const [bone, rotation] of Object.entries(reach(rig, neutral, arm, target, pole))) {
              const perSize = ((values[bone] ??= {})[p] ??= [[0, 0], [0, 0], [0, 0]]);
              rotation.forEach((v, k) => (perSize[k][end] = v));
            }
          }
        }
      }
      const key = String(round(t, 3));
      for (const [bone, bySize] of Object.entries(values)) {
        (frames[bone] ??= {})[key] = [0, 1, 2].map((k) => sizedValue(Object.fromEntries(Object.entries(bySize).map(([p, axes]) => [p, axes[k]]))));
      }
      (frames.head ??= {})[key] = spec.head(t).map((v, k) => round(head[k] + v));
    }
    out[pose] = {
      loop: true,
      animation_length: spec.length,
      override_previous_animation: true,
      bones: Object.fromEntries(Object.entries(frames).map(([bone, rotation]) => [bone, { rotation }])),
    };
  }
  return out;
}

/**
 * How many moments of a pose put one of her hands (or the middle of a forearm) inside her belly
 * (more than PRESS deep in its skin, or in the hollow the skin closes): eight moments of its loop on her P5, P7 and P9
 * bellies at either end of their growth, with the pose's own turn of the belly and the swell the
 * belly controller gives it in that pose (its kicks and contractions at their fullest; without
 * `swell`, the top of her breath). Her whole stance must be in the animation (a solved pose
 * overriding her own).
 * @param {object} options
 * @param {{ bones: any[] }} options.geometry @param {Rig} options.rig @param {any} options.animation
 * @param {Record<number, { bones: any[] }>} options.bellies her fitted belly of each size
 * @param {(phase: number) => Swell} [options.swell] the pose's swell by size (bellySwells)
 */
export function handsInside({ geometry, rig, animation, bellies, swell }) {
  const arms = [armOf(geometry, 'R'), armOf(geometry, 'L')].filter((a) => !!a);
  const length = Number(animation.animation_length ?? 0);
  let hits = 0;
  for (const p of [5, 7, 9]) {
    const belly = bellies[p];
    if (!belly) continue;
    // her belly as it is modelled, and where the pose carries its bone (her trunk, its turn, its growth)
    let rest = restSolids.get(belly);
    if (!rest) restSolids.set(belly, (rest = { solid: bellySolid(belly, {}), frame: affine(poseBones(belly, {}).get('belly')) }));
    const s = swell?.(p) ?? BREATH;
    for (const growth of [0, fullGrowth(p)]) for (let i = 0; i < 8; i++) {
      const pose = poseAt(animation, (length * i) / 8, { evaluate: { v: { bp: p, belly_growth: growth }, q: {} } });
      const own = /** @type {{ scale?: number[], position?: number[] }} */ (pose.belly ?? {});
      const scale = growthScale(growth).map((v, k) => v * s.scale[k] * Number(own.scale?.[k] ?? 1));
      const position = s.position.map((v, k) => v + Number(own.position?.[k] ?? 0));
      const frame = affine(poseBones(belly, { ...pose, belly: { ...own, scale, position } }).get('belly'));
      const world = worldOf(rig, pose);
      for (const arm of /** @type {NonNullable<ReturnType<typeof armOf>>[]} */ (arms)) {
        const fore = world.get(arm.fore);
        if (!fore || !frame.inverse) continue;
        // her hand and the middle of her forearm in the belly bone's own frame, then where that is on the belly as modelled
        const elbow = /** @type {any} */ (rig.get(arm.fore)).pivot;
        const through = [arm.tip, times(add(arm.tip, elbow), 0.5)].some((point) => {
          const local = apply(/** @type {Mat3} */ (frame.inverse), sub(add(apply(fore.R, point), fore.t), frame.origin));
          return rest.solid.within(add(apply(rest.frame.matrix, local), rest.frame.origin), PRESS);
        });
        if (through) hits++;
      }
    }
  }
  return hits;
}

/** How deep a hand may press into her skin before it counts as inside (model units): a hand laid on her belly touches it. */
export const PRESS = 0.3;

/** Each fitted belly's solid as modelled, and its bone's place (handsInside poses only that place). */
const restSolids = /** @type {WeakMap<object, { solid: ReturnType<typeof bellySolid>, frame: ReturnType<typeof affine> }>} */ (new WeakMap());

/** A bone's placement (geo-render poseBones) as a matrix and an origin, with the matrix's inverse. */
function affine(/** @type {((p: number[]) => number[]) | undefined} */ place) {
  const at = place ?? ((/** @type {number[]} */ p) => p);
  const origin = at([0, 0, 0]);
  const matrix = transpose([[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => sub(at(e), origin)));
  return { origin, matrix, inverse: invert(matrix) };
}

/** How fast she moves, 0..1 (vanilla's flying allay reads the same query). */
const MOVING = 'math.min(1.0, q.modified_move_speed * 2.5)';

/**
 * The flight of a girl who flies without a walk of her own, on the bones she has: her body leans
 * into it and her head comes up to look ahead, her arms and legs trail behind (her legs kicking
 * in turn), her wings buzz harder. Additive; nothing while she hangs still.
 * @param {Set<string>} names the bones of her model
 */
export function flightAnimation(names) {
  /** @type {Record<string, { rotation: (number | string)[] }>} */
  const bones = {};
  const put = (/** @type {string} */ bone, /** @type {(number | string)[]} */ rotation) => {
    if (names.has(bone)) bones[bone] = { rotation };
  };
  put('body', [`14.0 * ${MOVING}`, 0, 0]);
  put('head', [`-12.0 * ${MOVING}`, 0, 0]);
  put('armR', [`12.0 * ${MOVING}`, 0, 0]);
  put('armL', [`12.0 * ${MOVING}`, 0, 0]);
  put('legR', [`(14.0 + 9.0 * math.sin(q.life_time * 540.0)) * ${MOVING}`, 0, 0]);
  put('legL', [`(14.0 - 9.0 * math.sin(q.life_time * 540.0)) * ${MOVING}`, 0, 0]);
  put('wing', [0, `-20.0 * ${MOVING} * math.sin(q.life_time * 2400.0)`, 0]);
  put('wing2', [0, `20.0 * ${MOVING} * math.sin(q.life_time * 2400.0)`, 0]);
  return { loop: true, bones };
}
