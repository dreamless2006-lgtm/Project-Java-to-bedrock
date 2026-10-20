// The births of the ten Jenny Mod Java Port girls, each her own (docs: the births spec, section 5).
// They used to share the mod's birth on her back; now each girl has her own posture, push rhythm,
// way out for the baby and a touch of her kind:
//
//   Jenny      half-sitting, propped on her arms, knees up and wide; on each push she curls up
//              and reaches for her knees
//   Bia        a deep upright squat, hands under her belly, bouncing
//   Slime      kneeling back on her heels, knees wide, swaying and squashing like jelly
//   Luna       knee-chest on her forearms, hips high, rocking; the baby comes out behind her
//   Galath     half-kneeling, leaning back, wings spread and beating
//   Allie      floating upright, her smoke tail coiling, arms flung up on each push
//   Manglelie  lying on her side, holding her top leg up
//   Bee        hovering, legs dangling apart, wings buzzing nonstop, abdomen curled forward
//   Kobold     an egg-laying crouch on hands and feet, tail raised; the egg comes out behind her
//   Ellie      a standing horse stance, arched back, hands on her lower back
//
// Each birth is written as world orientations on the neutral humanoid (tools/lib/scene-poses.mjs
// NEUTRAL_RIG) and solved onto her rig absolutely, so her own idle stance (the Bee's hunch) cannot
// bend it, then set on the floor for her own proportions (scene-poses fitToFloor). The keyframes
// come from her rhythm (tools/lib/birth-rhythm.mjs): her pushes build up over a quarter second, so
// her body, her crowning and her sounds keep time. Everything here is our own data; the solved
// animations it becomes are written by tools/import-jenny.mjs (git-ignored).
import { effectsAt, exitMount, mergeEffects, midPush, restDepth, timeKey, tremble, vec, windowKeys } from './birth-rhythm.mjs';
import { EGG_DEPTH, HEAD_DEPTH } from './crowning.mjs';
import { poseAt, poseBones } from './geo-render.mjs';
import { apply, eulerFromMat, limbDirections as modelledDirections, matFromEuler, mul } from './pose-solve.mjs';

/** @typedef {import('./birth-rhythm.mjs').Rhythm} Rhythm */
/** @typedef {Record<string, any>} Keys a keyframe map: time -> value */
/** A bend in X degrees: one value, or a rest value and a push value. @typedef {number | { rest: number, push: number }} Bend */
/** @typedef {{ knee?: Bend, kneeR?: Bend, kneeL?: Bend, elbow?: Bend, elbowR?: Bend, elbowL?: Bend }} Bends */
/** @typedef {{ loop: true, animation_length: number, bends: Bends, bones: Record<string, any> }} AuthoredBirth her birth on NEUTRAL_RIG */
/**
 * What her extras and flair are built from: her rhythm, the bones her model has, and `post` (the
 * relaxed postbirth: every push value gives way to its rest value).
 * @typedef {{ rhythm: Rhythm, names: Set<string>, post?: boolean }} GirlContext
 */
/**
 * @typedef {object} GirlBirth
 * @property {string} name her short name (previews, messages)
 * @property {Rhythm} rhythm her loop length and push windows
 * @property {AuthoredBirth} authored her birth on NEUTRAL_RIG, with her knee and elbow bends
 * @property {number[] | ((dirOf: (bone: string) => number[]) => number[])} exitWant the way the baby comes out (world; her front is -z), or a function of her posed limbs' directions
 * @property {(ctx: GirlContext) => Record<string, any>} [extras] channels on bones the solver leaves alone (tails, wings, ears), Molang allowed; they replace her flavour channels in the birth
 * @property {(ctx: GirlContext) => Record<string, any>} [flair] additive channels played on top of the pose, in step with her rhythm
 * @property {Record<string, { event: string, at: number[] }>} sounds short name -> sound event and the loop times it plays at
 * @property {Record<string, { particle: string, at: number[] }>} particles short name -> particle effect and the loop times it starts at
 * @property {boolean} [handsFree] in her postbirth her hands may rest on her belly (her arms do not hold her up)
 * @property {'rest' | 'plant' | 'none'} [floor] how she is set on the floor (scene-poses fitToFloor): one lift measured between pushes (default), a lift per keyframe (feet planted while her knees bend), or none (she floats)
 * @property {number} [prebirthBlend] how far her prebirth leans from the shared crouch toward her birth's rest frame (default scene-poses PREBIRTH_BLEND; 0 keeps the shared crouch)
 * @property {boolean} [wholeBody] her trunk's orientation turns her whole body, hips and legs' roots too (lying on her side)
 * @property {number | [number, number]} [bellyHang] her belly turns back by this share of her forward bend (bent over the floor, it lies forward instead of through it); two shares: the P4 to P6 bellies, the P7 to P9 ones
 */

const round = (/** @type {number} */ v, digits = 3) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k || 0;
};
/** [time, value] pairs as a keyframe map in time order. */
export const keys = (/** @type {[number, any][]} */ pairs) => Object.fromEntries([...pairs].sort((a, b) => a[0] - b[0]).map(([t, v]) => [timeKey(t), v]));
/** One axis that holds `rest` between pushes and `push` while she pushes (a constant when they agree). */
const hold = (/** @type {Rhythm} */ rhythm, /** @type {number} */ rest, /** @type {number} */ push) => (rest === push ? rest : windowKeys(rhythm, push, rest));
/** A channel [x, y, z] going from `rest` between pushes to `push` while she pushes. */
export const restPush = (/** @type {Rhythm} */ rhythm, /** @type {number[]} */ rest, /** @type {number[]} */ push = rest) =>
  vec(hold(rhythm, rest[0], push[0]), hold(rhythm, rest[1], push[1]), hold(rhythm, rest[2], push[2]));
/** The left side's copy of a right limb's orientation (Y and Z turn the other way). */
export const mirror = (/** @type {number[]} */ v) => [v[0], -v[1] || 0, -v[2] || 0];
/** Keyframes that sit at `rest`, rise to `peak` at a share `at` of each push window, and are back at `rest` by its end. */
export function peaks(/** @type {Rhythm} */ rhythm, /** @type {number} */ rest, /** @type {number} */ peak, at = 0.5) {
  /** @type {[number, number][]} */
  const pairs = [[0, rest], [rhythm.length, rest]];
  for (const [a, b] of rhythm.pushes) pairs.push([a, rest], [round(a + (b - a) * at), peak], [b, rest]);
  return keys(dedupe(pairs));
}
/** Keys of one axis that loop smoothly between two values on a sine-like wave: `cycles` whole waves over the loop. */
export function wave(/** @type {number} */ length, /** @type {number} */ centre, /** @type {number} */ amp, cycles = 1, phase = 0) {
  /** @type {[number, number][]} */
  const pairs = [];
  const steps = Math.round(cycles * 4);
  for (let i = 0; i <= steps; i++) pairs.push([round((length * i) / steps), round(centre + amp * Math.sin((i * Math.PI) / 2 + phase))]);
  return keys(pairs);
}
/** Later pairs at a time already taken win (keyframe maps hold one value per time). */
function dedupe(/** @type {[number, any][]} */ pairs) {
  /** @type {Map<number, any>} */
  const at = new Map();
  for (const [t, v] of pairs) at.set(round(t), v);
  return [...at.entries()];
}
/** In her extras and flair: `rest` in the postbirth, else `rest` between pushes and `push` in them. */
const by = (/** @type {GirlContext} */ ctx, /** @type {any} */ rest, /** @type {any} */ push) => (ctx.post || rest === push ? rest : windowKeys(ctx.rhythm, push, rest));
/** A sound or particle list as an effect timeline, every effect at a time of its own. */
const timeline = (/** @type {Record<string, { at: number[] }>} */ list) => mergeEffects(...Object.entries(list).map(([name, { at }]) => effectsAt(at, name)));

/**
 * A limb's world orientation given in her trunk's own frame (as if she stood upright), turned by
 * her trunk's world orientation: for a girl lying on her side, "arm raised over her head" is
 * written as it reads and lands along the floor.
 * @param {number[]} trunk her body's world orientation @param {number[]} local the limb in her trunk's frame
 */
export function inTrunk(trunk, local) {
  return eulerFromMat(mul(matFromEuler(trunk), matFromEuler(local))).map((v) => round(v, 2));
}

// ---- Jenny: half-sitting, propped on her arms ----------------------------------------------------
const JENNY = /** @type {Rhythm} */ ({ length: 6, pushes: [[0.5, 2.6], [3.4, 5.5]] });
// ---- Bia: a deep squat, bouncing -------------------------------------------------------------------
const BIA = /** @type {Rhythm} */ ({ length: 4, pushes: [[0.4, 1.6], [2.4, 3.6]] });
// ---- Slime: kneeling back on her heels -------------------------------------------------------------
const SLIME = /** @type {Rhythm} */ ({ length: 3.5, pushes: [[0.3, 2.3]] });
// ---- Luna: knee-chest --------------------------------------------------------------------------------
const LUNA = /** @type {Rhythm} */ ({ length: 4.5, pushes: [[0.4, 2.0], [2.6, 4.2]] });
// ---- Galath: half-kneeling ---------------------------------------------------------------------------
const GALATH = /** @type {Rhythm} */ ({ length: 7.5, pushes: [[0.8, 3.2], [4.6, 6.8]] });
// ---- Allie: floating ---------------------------------------------------------------------------------
const ALLIE = /** @type {Rhythm} */ ({ length: 8.5, pushes: [[1.0, 3.8], [5.0, 7.6]] });
// ---- Manglelie: on her side --------------------------------------------------------------------------
const MANGLELIE = /** @type {Rhythm} */ ({ length: 6.5, pushes: [[0.6, 2.8], [3.8, 6.0]] });
// ---- Bee: hovering -----------------------------------------------------------------------------------
const BEE = /** @type {Rhythm} */ ({ length: 3, pushes: [[0.3, 1.3], [1.8, 2.8]] });
// ---- Kobold: the egg-laying crouch -------------------------------------------------------------------
const KOBOLD = /** @type {Rhythm} */ ({ length: 5.5, pushes: [[0.5, 2.2], [3.0, 4.9]] });
// ---- Ellie: the standing horse stance ----------------------------------------------------------------
const ELLIE = /** @type {Rhythm} */ ({ length: 7, pushes: [[0.6, 3.0], [3.8, 6.2]] });

/** A pair of legs from the right one's orientation and the pelvis height (both legs carry the same position: it moves her pelvis). */
function legs(/** @type {Rhythm} */ rhythm, /** @type {number[]} */ rest, /** @type {number[]} */ push, /** @type {any} */ position) {
  return {
    right_leg: { rotation: restPush(rhythm, rest, push), position },
    left_leg: { rotation: restPush(rhythm, mirror(rest), mirror(push)), position },
  };
}
/** A pair of arms from the right one's orientation. */
function arms(/** @type {Rhythm} */ rhythm, /** @type {number[]} */ rest, /** @type {number[]} */ push = rest) {
  return { right_arm: { rotation: restPush(rhythm, rest, push) }, left_arm: { rotation: restPush(rhythm, mirror(rest), mirror(push)) } };
}
/** The pelvis height as a position channel: `rest` between pushes, `push` in them. */
const pelvis = (/** @type {Rhythm} */ rhythm, /** @type {number} */ rest, /** @type {number} */ push = rest) => vec(0, hold(rhythm, rest, push), 0);

/** Her birth on NEUTRAL_RIG. */
const authored = (/** @type {Rhythm} */ rhythm, /** @type {Bends} */ bends, /** @type {Record<string, any>} */ bones) => /** @type {AuthoredBirth} */ ({ loop: true, animation_length: rhythm.length, bends, bones });

// Manglelie lies on her left side: her trunk rolled 85 degrees onto it (her head toward +x), her
// limbs written in her trunk's frame and turned with it.
const MANGLELIE_TRUNK = { rest: [0, 0, 85], push: [15, 0, 85] };
const manglelieLimb = (/** @type {number[]} */ rest, /** @type {number[]} */ push = rest) =>
  restPush(MANGLELIE, inTrunk(MANGLELIE_TRUNK.rest, rest), inTrunk(MANGLELIE_TRUNK.push, push));

/** Every girl's birth, by her entity id. */
export const GIRL_BIRTHS = /** @type {Record<string, GirlBirth>} */ ({
  'fapcraft:jenny': {
    name: 'jenny',
    rhythm: JENNY,
    authored: authored(JENNY, { knee: 86, elbow: { rest: -30, push: -60 } }, {
      // half-sitting, propped on her arms; on each push she curls up toward her belly and reaches for her knees
      body: { rotation: restPush(JENNY, [-55, 0, 0], [-35, 0, 0]) },
      // looking down at her belly, rolling her head between pushes
      head: { rotation: vec(windowKeys(JENNY, 30, 5), keys([[0, -8], [0.5, 0], [2.6, 0], [3.0, 8], [3.4, 0], [5.5, 0], [5.75, -8], [6, -8]]), 0) },
      ...arms(JENNY, [42, 0, 20], [-35, 0, 15]),
      ...legs(JENNY, [-115, 40, 0], [-115, 40, 0], pelvis(JENNY, -7.5)),
    }),
    exitWant: [0, -0.45, -0.89],
    sounds: { mp_push: { event: 'minepreggo.player_push', at: [0.5, 3.4] }, mp_birth: { event: 'minepreggo.player_birth', at: [5.3] } },
    particles: {},
    handsFree: true,
  },
  'kum:bia': {
    name: 'bia',
    rhythm: BIA,
    authored: authored(BIA, { knee: 125, elbow: -80 }, {
      body: { rotation: restPush(BIA, [8, 0, 0], [14, 0, 0]) },
      head: { rotation: restPush(BIA, [25, 0, 0], [-20, 0, 0]) },
      // hands cupped under her belly
      ...arms(BIA, [-10, 25, 12]),
      // a deep squat, knees wide; she bounces on her heels through each push
      ...legs(BIA, [-70, 50, 0], [-70, 50, 0], vec(0, keys([[0, -6.2], [0.4, -6.2], [0.65, -6.8], [0.95, -6.4], [1.25, -6.8], [1.6, -6.2], [2.4, -6.2], [2.65, -6.8], [2.95, -6.4], [3.25, -6.8], [3.6, -6.2], [4, -6.2]]), 0)),
    }),
    exitWant: [0, -1, 0],
    sounds: { mp_pain: { event: 'minepreggo.pregnancy_pain', at: [0.4] }, mp_push: { event: 'minepreggo.player_push', at: [2.4] } },
    particles: {},
    handsFree: true,
  },
  'kum:slime_girl': {
    name: 'slime',
    rhythm: SLIME,
    authored: authored(SLIME, { knee: 160, elbow: -40 }, {
      // upright on her knees, swaying from side to side like jelly
      body: { rotation: vec(windowKeys(SLIME, 10, 0), 0, keys([[0, 0], [0.45, 8], [1.35, -8], [2.25, 8], [3.15, -8], [3.5, 0]])) },
      head: { rotation: restPush(SLIME, [0, 0, 0], [-15, 0, 0]) },
      ...arms(SLIME, [-50, 10, 5]),
      ...legs(SLIME, [-65, 30, 0], [-65, 30, 0], pelvis(SLIME, -8.5)),
    }),
    exitWant: [0, -0.5, -0.866],
    // her slime body squashes and stretches (the dress and figure follow upperBody)
    extras: () => ({ upperBody: { scale: ['1.0 + 0.07 * math.sin(q.anim_time * 411.4)', '1.0 - 0.1 * math.sin(q.anim_time * 411.4)', '1.0 + 0.07 * math.sin(q.anim_time * 411.4)'] } }),
    sounds: { mp_small: { event: 'mob.slime.small', at: [0.3] }, mp_squish: { event: 'mob.slime.squish', at: [1.6] } },
    particles: {},
    handsFree: true,
  },
  'kum:luna': {
    name: 'luna',
    rhythm: LUNA,
    authored: authored(LUNA, { knee: 95, elbow: -65 }, {
      // knee-chest: on her knees and forearms, her hips above her chest, rocking back and forth
      body: { rotation: restPush(LUNA, [105, 0, 0], [100, 0, 0]) },
      head: { rotation: restPush(LUNA, [0, 0, 0], [25, 0, 0]) },
      ...arms(LUNA, [-25, 0, 8]),
      // knees wide, so her belly can come down between them
      ...legs(LUNA, [-5, 0, 25], [-5, 0, 25], vec(0, -4.6, wave(LUNA.length, 0, 0.7, 2))),
    }),
    bellyHang: [-0.3, 1],
    exitWant: [0, -0.5, 0.87],
    sounds: { mp_contraction: { event: 'minepreggo.player_contraction', at: [0.4] }, mp_hiss: { event: 'mob.cat.hiss', at: [1.4] } },
    particles: {},
  },
  'kum:galath': {
    name: 'galath',
    rhythm: GALATH,
    authored: authored(GALATH, { kneeR: 100, kneeL: 95, elbowR: -70, elbowL: -30 }, {
      body: { rotation: restPush(GALATH, [-15, 0, 0], [-25, 0, 0]) },
      // her head thrown back at the peak of each push
      head: { rotation: vec(peaks(GALATH, 10, -30), 0, 0) },
      // her right hand on her belly, her left on her raised knee
      right_arm: { rotation: [-30, 25, -10] },
      left_arm: { rotation: [-60, -10, 0] },
      // right knee down, left foot planted
      right_leg: { rotation: [10, 0, 10], position: [0, -6, 0] },
      left_leg: { rotation: [-110, -15, 0], position: [0, -6, 0] },
    }),
    exitWant: [0, -0.9, -0.44],
    // her wings spread out and beat up and down, harder while she pushes (this replaces their
    // droop; turned about their own vertical they would only show their edge from behind)
    extras: (ctx) => {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [name, side] of /** @type {[string, number][]} */ ([['wingR', 1], ['wingL', -1]])) {
        const beat = (/** @type {number} */ a) => [0, `${side * -10}.0`, `${side * -25}.0 + ${side * a}.0 * math.sin(q.anim_time * 540.0)`];
        out[name] = { rotation: by(ctx, beat(8), beat(20)) };
      }
      return out;
    },
    sounds: { mp_flap: { event: 'mob.phantom.flap', at: [0.8, 1.6, 2.4, 4.6, 5.4, 6.2] }, mp_push: { event: 'minepreggo.player_push', at: [0.8] } },
    particles: {},
  },
  'jhallie4:allie': {
    name: 'allie',
    rhythm: ALLIE,
    authored: authored(ALLIE, { elbow: { rest: -60, push: 0 } }, {
      body: { rotation: restPush(ALLIE, [-10, 0, 0], [15, 0, 0]) },
      head: { rotation: restPush(ALLIE, [0, 0, 0], [-25, 0, 0]) },
      // her arms flung up on each push
      ...arms(ALLIE, [-35, 20, 0], [-170, 0, 20]),
      // floating, bobbing up and down (she has no legs: the legs' position lifts her whole body)
      ...legs(ALLIE, [0, 0, 0], [0, 0, 0], vec(0, wave(ALLIE.length, 3, 1.5, 4), 0)),
    }),
    exitWant: [0, -1, 0],
    floor: 'none',
    // her smoke tail coils in a slow spiral, lifted while she pushes
    extras: (ctx) => {
      /** @type {Record<string, any>} */
      const out = {};
      for (let i = 0; i <= 7; i++) out[`tail${i}`] = { rotation: vec(by(ctx, 16, 24), `14.0 * math.sin(q.anim_time * 120.0 + ${i * 45}.0)`, 0) };
      return out;
    },
    sounds: { mp_gust: { event: 'mob.breeze.idle_air', at: [1.0, 5.0] } },
    particles: { mp_wind: { particle: 'minecraft:wind_charged_ambient', at: [1.2, 1.8, 2.4, 3.0, 5.2, 5.8, 6.4, 7.0] } },
  },
  'kum:manglelie': {
    name: 'manglelie',
    rhythm: MANGLELIE,
    authored: authored(MANGLELIE, { kneeL: 25, kneeR: 80, elbowR: -30 }, {
      body: { rotation: restPush(MANGLELIE, MANGLELIE_TRUNK.rest, MANGLELIE_TRUNK.push) },
      // her head on her arm, curling forward with each push
      head: { rotation: manglelieLimb([0, 0, 0], [20, 0, 0]) },
      // her bottom arm under her head, her top hand holding her raised knee
      left_arm: { rotation: manglelieLimb([-170, 0, 0]) },
      right_arm: { rotation: manglelieLimb([-65, 0, 10]) },
      // her bottom leg in line with her body, her top leg drawn up and out (up, as she lies)
      left_leg: { rotation: manglelieLimb([-15, 0, 0]), position: [0, -9, 0] },
      right_leg: { rotation: manglelieLimb([-70, 0, 25]), position: [0, -9, 0] },
    }),
    wholeBody: true,
    // a crouch leaning toward lying on her side only tips over sideways: she keeps the shared one
    prebirthBlend: 0,
    // along her bottom thigh toward her feet, turned 15 degrees toward her front
    exitWant: (dirOf) => tiltToward(dirOf('legL'), [0, 0, -1], 15),
    // her top leg trembles while she pushes
    flair: (ctx) => ({ legR: { rotation: vec(tremble(ctx.rhythm, 3, 9), 0, 0) } }),
    sounds: { mp_pain: { event: 'minepreggo.pregnancy_pain', at: [0.6, 3.8] } },
    particles: {},
    handsFree: true,
  },
  'jhbee24:bee': {
    name: 'bee',
    rhythm: BEE,
    authored: authored(BEE, { knee: { rest: 30, push: 70 }, elbow: -60 }, {
      body: { rotation: restPush(BEE, [10, 0, 0], [30, 0, 0]) },
      head: { rotation: restPush(BEE, [0, 0, 0], [25, 0, 0]) },
      ...arms(BEE, [-40, 25, 0]),
      // hovering, bobbing twice a second, her legs dangling apart and drawn up in the pushes
      ...legs(BEE, [-15, 0, 25], [-50, 30, 0], vec(0, wave(BEE.length, 3, 1.2, 6), 0)),
    }),
    exitWant: [0, -1, 0],
    floor: 'none',
    // her wings buzz nonstop (not in bursts) and her abdomen curls forward under her
    extras: () => ({
      wing: { rotation: [0, '30.0 * math.sin(q.anim_time * 2400.0)', 0] },
      wing2: { rotation: [0, '-30.0 * math.sin(q.anim_time * 2400.0)', 0] },
      // (negative X swings it down from behind her; it stays above and behind the way out)
      tail: { rotation: ['-85.0 + 6.0 * math.sin(q.anim_time * 300.0)', 0, 0] },
    }),
    sounds: { mp_buzz: { event: 'mob.bee.loop', at: [0] }, mp_push: { event: 'minepreggo.player_push', at: [1.8] } },
    particles: {},
    handsFree: true,
  },
  'jhkobold:kobold': {
    name: 'kobold',
    rhythm: KOBOLD,
    authored: authored(KOBOLD, { knee: 140, elbow: -10 }, {
      body: { rotation: [55, 0, 0] },
      head: { rotation: restPush(KOBOLD, [-20, 0, 0], [15, 0, 0]) },
      // her hands on the ground in front of her
      ...arms(KOBOLD, [-20, 0, 10]),
      ...legs(KOBOLD, [-95, 45, 0], [-95, 45, 0], pelvis(KOBOLD, -7)),
    }),
    exitWant: [0, -0.8, 0.6],
    bellyHang: 0.7,
    // her tail raised high, lifting and quivering while she pushes
    extras: (ctx) => {
      /** @type {Record<string, any>} */
      // (her crouch already tips her hips forward, which lifts the tail; positive X lifts it further)
      const out = { tail: { rotation: vec(by(ctx, 5, 20), 0, 0) } };
      ['tail2', 'tail3', 'tail4', 'tail5'].forEach((name, i) => {
        out[name] = { rotation: vec(-4, by(ctx, '0.0', `4.0 * math.sin(q.anim_time * 1500.0 + ${(i + 2) * 40}.0)`), 0) };
      });
      return out;
    },
    sounds: { mp_push: { event: 'minepreggo.player_push', at: [0.5] }, mp_lay: { event: 'mob.frog.lay_spawn', at: [4.6] } },
    particles: { mp_sand: { particle: 'minecraft:falling_dust_sand_particle', at: [0.6, 1.0, 3.1, 3.5] } },
  },
  'jhelliedev:ellie': {
    name: 'ellie',
    rhythm: ELLIE,
    authored: authored(ELLIE, { knee: { rest: 65, push: 80 }, elbow: -100 }, {
      body: { rotation: restPush(ELLIE, [-12, 0, 0], [-20, 0, 0]) },
      // her head thrown back on each push
      head: { rotation: restPush(ELLIE, [0, 0, 0], [-40, 0, 0]) },
      // hands braced on her lower back
      ...arms(ELLIE, [35, 0, 25]),
      // a wide horse stance, thighs out to the sides; she sinks deeper as her knees bend in each push
      ...legs(ELLIE, [-65, 55, 0], [-72, 55, 0], pelvis(ELLIE, -5, -6)),
    }),
    exitWant: [0, -1, 0],
    floor: 'plant',
    // her legs tremble while she bears down
    flair: (ctx) => ({ legR: { rotation: vec(tremble(ctx.rhythm, 2, 11), 0, 0) }, legL: { rotation: vec(tremble(ctx.rhythm, 2, 11, 90), 0, 0) } }),
    sounds: { mp_push: { event: 'minepreggo.player_push', at: [0.6, 3.8] } },
    particles: {},
    handsFree: true,
  },
});

/** A direction turned `degrees` toward another (in the plane they span). */
export function tiltToward(/** @type {number[]} */ from, /** @type {number[]} */ toward, /** @type {number} */ degrees) {
  const n = Math.hypot(...from) || 1;
  const f = from.map((v) => v / n);
  const along = toward.reduce((s, v, k) => s + v * f[k], 0);
  const perp = toward.map((v, k) => v - along * f[k]);
  const m = Math.hypot(...perp);
  if (m < 1e-9) return f;
  const a = (degrees * Math.PI) / 180;
  return f.map((v, k) => v * Math.cos(a) + (perp[k] / m) * Math.sin(a));
}

/** Her bends for one moment: the rest or the push value of each. */
export function bendsAt(/** @type {Bends} */ bends, /** @type {'rest' | 'push'} */ which) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [part, bend] of Object.entries(bends)) if (bend !== undefined) out[part] = typeof bend === 'number' ? bend : bend[which];
  return out;
}

/** A loop time between her pushes (the middle of the longest pause): the rest frame of her birth. */
export function restTime(/** @type {Rhythm} */ rhythm) {
  const pushes = [...rhythm.pushes].sort((a, b) => a[0] - b[0]);
  let best = { t: 0, gap: -1 };
  pushes.forEach(([, end], i) => {
    const next = i + 1 < pushes.length ? pushes[i + 1][0] : pushes[0][0] + rhythm.length;
    if (next - end > best.gap) best = { t: ((end + next) / 2) % rhythm.length, gap: next - end };
  });
  return round(best.t);
}

/**
 * Her birth flair: additive channels in step with her rhythm, and her sounds and particles. An
 * animation without a bone is refused by the game, so a girl with sounds only carries a still one.
 * @param {GirlBirth} spec @param {Set<string>} names the bones of her model @param {string} still a bone she has
 */
export function girlFlair(spec, names, still) {
  const ctx = { rhythm: spec.rhythm, names };
  const bones = Object.fromEntries(Object.entries(spec.flair?.(ctx) ?? {}).filter(([bone]) => names.has(bone)));
  if (!Object.keys(bones).length) bones[still] = { rotation: [0, 0, 0] };
  const sound_effects = timeline(spec.sounds);
  const particle_effects = timeline(spec.particles);
  return {
    loop: true,
    animation_length: spec.rhythm.length,
    bones,
    ...(Object.keys(sound_effects).length ? { sound_effects } : {}),
    ...(Object.keys(particle_effects).length ? { particle_effects } : {}),
  };
}

/** Her sound and particle maps for the client entity (short name -> id). */
export function girlEffects(/** @type {GirlBirth} */ spec) {
  return {
    sound_effects: Object.fromEntries(Object.entries(spec.sounds).map(([name, { event }]) => [name, event])),
    particle_effects: Object.fromEntries(Object.entries(spec.particles).map(([name, { particle }]) => [name, particle])),
  };
}

/**
 * How deep the baby has to be out before its mount may turn all the way to the exit, so that the
 * part still inside her never sticks out of her back by more than a quarter pixel: the baby starts
 * along her hip's own way down (along her trunk) and turns to the exit as it comes out, like the
 * curve of the birth canal. 0 when the part inside leans toward her front (into her belly) or
 * hardly leans at all.
 * @param {number[][]} box her waist box (belly-fit measureBody) @param {number[]} opening @param {number[]} mount
 * @param {number} scale v.crown_scale @param {number} full head + rest depth (fetus units)
 */
export function turnDepth(box, opening, mount, scale, full) {
  // the baby inside lies along the mount's +y, in the hip's frame (her back is +z)
  const inside = apply(matFromEuler(mount), [0, 1, 0]);
  const tilt = Math.acos(Math.max(-1, Math.min(1, inside[1])));
  const sideways = Math.hypot(inside[0], inside[2]);
  if (!(tilt > (3 * Math.PI) / 180) || sideways < 1e-6) return 0;
  // how far the part inside may lean before it leaves her: her back (z) or her side (x)
  const backward = inside[2] / sideways, across = Math.abs(inside[0]) / sideways;
  if (backward <= 0 && across < 0.5) return 0;
  const room = Math.min(backward > 0 ? (box[2][1] - opening[2]) / backward : Infinity, across > 1e-6 ? box[0][1] / across : Infinity);
  const fits = (/** @type {number} */ turn) => {
    for (let d = 0; d <= full; d += 0.25) if ((full - d) * scale * Math.sin(tilt * Math.min(1, d / turn)) - room > 0.25) return false;
    return true;
  };
  for (let turn = 1; turn < full; turn += 0.5) if (fits(turn)) return turn;
  return full;
}

/**
 * Her way out: the crowning mount's rotation that sends the baby out along her exitWant in the
 * middle of her first push, as a channel of her birth animation (the belly geometries share her
 * bone names; the geometry's own mount stays unturned, so the Kobold's scene egg is untouched),
 * and how far the baby may come before it reaches the floor.
 * @param {object} options
 * @param {GirlBirth} options.spec
 * @param {{ bones: any[] }} options.geometry her main body
 * @param {any} options.animation her solved birth
 * @param {{ box: number[][], opening: number[] }} options.body the waist box and opening her bellies were fitted to
 * @param {number} options.scale v.crown_scale
 * @param {boolean} [options.egg] she lays an egg
 * @returns {{ rotation: (number | string)[], mount: number[], want: number[], clearance: number, head: number, rest: number, turn: number, at: number }}
 */
export function girlBirthExit({ spec, geometry, animation, body, scale, egg = false }) {
  const at = midPush(spec.rhythm, 0);
  const want = typeof spec.exitWant === 'function' ? spec.exitWant(limbDirections(geometry, animation, at)) : spec.exitWant;
  const { mount, clearance } = exitMount(geometry, animation, 'hip', body.opening, want, at);
  const head = egg ? EGG_DEPTH.head : HEAD_DEPTH;
  const rest = egg ? EGG_DEPTH.rest : restDepth(clearance, scale, head);
  const turn = turnDepth(body.box, body.opening, mount, scale, head + rest);
  const rotation = turn > 0 ? mount.map((v) => (v === 0 ? 0 : `${v} * math.clamp(v.crown / ${turn.toFixed(1)}, 0.0, 1.0)`)) : mount;
  return { rotation, mount, want: want.map((v) => round(v, 4)), clearance: round(clearance), head, rest, turn, at };
}

/**
 * Where each of her limbs points in the world at time t of an animation (from its pivot toward the
 * middle of its biggest cube), for exits given along a limb.
 * @param {{ bones: any[] }} geometry @param {any} animation @param {number} t
 */
export function limbDirections(geometry, animation, t) {
  const transforms = poseBones(geometry, poseAt(animation, t));
  return (/** @type {string} */ name) => {
    const bone = geometry.bones.find((b) => b.name === name);
    const toWorld = transforms.get(name);
    const dir = modelledDirections(geometry, [name])[name];
    if (!bone || !toWorld || !dir) throw new Error(`no limb ${name} to point with`);
    const a = toWorld(bone.pivot), b = toWorld(bone.pivot.map((/** @type {number} */ v, /** @type {number} */ k) => v + dir[k]));
    const d = b.map((v, k) => v - a[k]);
    const n = Math.hypot(...d) || 1;
    return d.map((v) => v / n);
  };
}
