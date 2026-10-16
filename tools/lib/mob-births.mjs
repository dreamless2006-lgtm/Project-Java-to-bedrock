// The births of our six Minepreggo mobs, each her own (docs: the births spec, section 4):
//
//   * zombie_girl stands stiff with her legs braced wide and bends forward at the hips in jerks,
//     her zombie reach dropping onto her thighs at each push (new, solved onto her rig);
//   * humanoid_slime_girl melts down into a splayed squat-puddle, squashing and wobbling (new,
//     solved onto her rig; her old birth was the creeper girl's, byte for byte);
//   * humanoid_creeper_girl, monster_creeper_girl, monster_slime_girl and ender_woman keep the mod's
//     own birth and get a species touch on top (fuse flash, hops, levitation) as additive flair.
//
// Every one of them gets a crowning in step with her own pushes (tools/lib/birth-rhythm.mjs), and
// her belly now shrinks as each baby comes out. The poses solved onto the mod's geometry are written
// by tools/gen-birth-poses.mjs into the git-ignored animations/minepreggo/ folder; the pure-Molang
// animations built here (crowning, flair) go into the committed animations/births.animation.json,
// written by tools/gen-belly-render.mjs together with the entity wiring below.
import { BIRTH_LINE, crowningFor, effectsAt, exitMount, flashLines, navelInsetLine, pulse, tremble, vec, windowKeys } from './birth-rhythm.mjs';
import { MOD, PHASES } from './belly-render.mjs';
import { openingOf } from './crowning.mjs';
import { animationSource, keyTimes, rigOf, solveAnimation } from './pose-solve.mjs';
import { LEGS, NEUTRAL_RIG, flatRig } from './scene-poses.mjs';

/** @typedef {import('./birth-rhythm.mjs').Rhythm} Rhythm */
/** @typedef {Record<string, any>} Keys a keyframe map: time -> value */
/** @typedef {{ loop: boolean, animation_length: number, bones: Record<string, any> }} AuthoredAnimation an animation on NEUTRAL_RIG */

/**
 * @typedef {object} MobBirth
 * @property {Rhythm} rhythm her loop length and push windows (the crowning slides out in these)
 * @property {string} [pose] the name of her solved birth (animation.minepreggo.<family>.<pose>[_pN]); none: the mod's birth
 * @property {AuthoredAnimation} [authored] her birth on NEUTRAL_RIG (world orientations, solved absolutely)
 * @property {'linear'} [lerp] how the solved keyframes ease (linear: the zombie's stepped jerks)
 * @property {string} [postPose] the name of her solved postbirth; none: the mod's
 * @property {AuthoredAnimation} [postAuthored]
 * @property {number[]} [exitWant] the way the baby comes out, in world space (her front is -z)
 * @property {number} [exitAt] the loop time the exit is aimed at (mid first push)
 * @property {{ windows: [number, number][], hz: number, level: number }} [flash] the creeper's white flash at the push peaks
 * @property {string} [inset] the navel births: how far the crown moves out to the belly surface (Molang)
 * @property {string} [bob] the crowning's own bob (Molang, added to the slide)
 * @property {Record<string, string>} sounds short name -> sound event, merged into her sound_effects
 * @property {Record<string, string>} particles short name -> particle id, merged into her particle_effects
 */

/** The six families, in the order the generators walk them. */
export const MOB_FAMILIES = /** @type {const} */ (['zombie_girl', 'humanoid_creeper_girl', 'humanoid_slime_girl', 'monster_creeper_girl', 'monster_slime_girl', 'ender_woman']);

const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
const lerp = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ f) => a.map((v, k) => round(v + (b[k] - v) * f));

/**
 * A keyframe map of one number channel from [time, value] pairs or another map, sampled linearly
 * at any time (the authored poses are read linearly by the solver too).
 * @param {number | Keys | [number, number][]} axis @param {number} t
 */
function sampleAxis(axis, t) {
  if (typeof axis === 'number') return axis;
  const frames = (Array.isArray(axis) ? axis : Object.entries(axis).map(([k, v]) => [Number(k), Number(v)])).slice().sort((a, b) => a[0] - b[0]);
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [ta, va] = frames[i], [tb, vb] = frames[i + 1];
    if (t <= tb) return tb === ta ? vb : va + ((vb - va) * (t - ta)) / (tb - ta);
  }
  return frames[frames.length - 1][1];
}
const timesOf = (/** @type {number | Keys | [number, number][]} */ axis) => (typeof axis === 'number' ? [] : Array.isArray(axis) ? axis.map(([t]) => t) : Object.keys(axis).map(Number));

/**
 * Authored per-axis numbers (each a constant, a keyframe map or [time, value] pairs) as one
 * keyframe map of [x, y, z]: the union of their times, every axis sampled linearly at each.
 * @param {number | Keys | [number, number][]} x @param {number | Keys | [number, number][]} y @param {number | Keys | [number, number][]} z
 */
function track(x, y, z) {
  const times = [...new Set([0, ...timesOf(x), ...timesOf(y), ...timesOf(z)].map(round))].sort((a, b) => a - b);
  /** @type {Keys} */
  const out = {};
  for (const t of times) out[String(t)] = [x, y, z].map((axis) => round(sampleAxis(axis, t)));
  return out;
}

/**
 * The zombie girl's first half-loop repeated 4 s later (her two pushes are the same jerks).
 * @param {[number, number][]} frames 0 to 4 s
 */
const twice = (frames) => [...frames, ...frames.filter(([t]) => t > 0).map(([t, v]) => /** @type {[number, number]} */ ([round(t + 4), v]))];

/**
 * A pose of hers that steps from `rest` to `push` and back in jerks: three moves of 0.1 s with a
 * 0.1 s hold after each, starting at each push window's start and end.
 * @param {number[]} rest @param {number[]} push @param {number} start @param {number} end
 */
function jerks(rest, push, start, end) {
  /** @type {[number, number][]} */
  const f = [[start, 0], [start + 0.1, 1 / 3], [start + 0.2, 1 / 3], [start + 0.3, 2 / 3], [start + 0.4, 2 / 3], [start + 0.5, 1], [end, 1], [end + 0.1, 2 / 3], [end + 0.2, 2 / 3], [end + 0.3, 1 / 3], [end + 0.4, 1 / 3], [end + 0.5, 0]];
  return f.map(([t, k]) => /** @type {[number, number[]]} */ ([round(t), lerp(rest, push, k)]));
}

/** Per-axis pairs out of [time, vector] pairs. */
const axes = (/** @type {[number, number[]][]} */ frames) => [0, 1, 2].map((k) => frames.map(([t, v]) => /** @type {[number, number]} */ ([t, v[k]])));

// ---- zombie_girl: a stiff standing birth ----------------------------------------------------------
const ZOMBIE_RHYTHM = /** @type {Rhythm} */ ({ length: 8, pushes: [[0.6, 3.4], [4.6, 7.4]], gates: [[3.6, 4.4]] });
const ZOMBIE_ARM_REST = [-80, 0, 6];
const ZOMBIE_ARM_PUSH = [-25, 0, 14];
/** Her arms: the zombie reach at rest, dropped onto her thighs in jerks during each push. */
const zombieArm = (/** @type {number} */ side) => {
  const rest = ZOMBIE_ARM_REST.map((v, k) => (k === 2 ? v * side : v));
  const push = ZOMBIE_ARM_PUSH.map((v, k) => (k === 2 ? v * side : v));
  /** @type {[number, number[]][]} */
  const frames = [[0, rest], ...jerks(rest, push, 0.6, 3.4), ...jerks(rest, push, 4.6, 7.4), [8, rest]];
  const [x, y, z] = axes(frames);
  return track(x, y, z);
};
/** Her pelvis sinks a little as she bears down (locked knees: the legs only brace wider). */
const ZOMBIE_PELVIS = twice([[0, -0.3], [0.6, -0.3], [0.9, -0.55], [1.0, -0.55], [1.3, -0.8], [3.4, -0.8], [3.8, -0.3], [4.0, -0.3]]);
const zombieLeg = (/** @type {number} */ side) => ({ rotation: [4, 0, 20 * side], position: track(0, ZOMBIE_PELVIS, 0) });
const ZOMBIE_BIRTH = /** @type {AuthoredAnimation} */ ({
  loop: true,
  animation_length: 8,
  bones: {
    // bent forward at the hips in stepped jerks (each pair of equal keys 0.1 s apart is a hold)
    body: { rotation: track(twice([[0, 40], [0.4, 40], [0.6, 38], [0.9, 45], [1.0, 45], [1.3, 50], [1.4, 50], [2.2, 52], [3.0, 54], [3.4, 52], [3.8, 41], [4.0, 40]]), 0, 0) },
    // staring ahead at rest, hanging during a push, jerked up as each push ends; a twitch aside mid-push
    head: {
      rotation: track(
        twice([[0, 5], [0.6, 5], [0.7, 22], [0.8, 22], [0.9, 40], [3.3, 40], [3.4, 0], [3.6, 5], [4.0, 5]]),
        [[0, 0], [1.7, 0], [1.8, 6], [2.0, 6], [2.1, 0], [5.7, 0], [5.8, -6], [6.0, -6], [6.1, 0], [8, 0]],
        0
      ),
    },
    right_arm: { rotation: zombieArm(1) },
    left_arm: { rotation: zombieArm(-1) },
    right_leg: zombieLeg(1),
    left_leg: zombieLeg(-1),
  },
});

// ---- humanoid_slime_girl: melting into a squat-puddle ---------------------------------------------
const HSLIME_RHYTHM = /** @type {Rhythm} */ ({ length: 5, pushes: [[0.4, 1.9], [2.9, 4.4]] });
const hslimeLeg = (/** @type {number} */ side) => ({ rotation: [-25, 0, 72 * side], position: track(0, windowKeys(HSLIME_RHYTHM, -9.6, -8.6), 0) });
const hslimeArm = (/** @type {number} */ side) => ({ rotation: track(windowKeys(HSLIME_RHYTHM, -35, -50), windowKeys(HSLIME_RHYTHM, -30 * side, -18 * side), 0) });
const HSLIME_BIRTH = /** @type {AuthoredAnimation} */ ({
  loop: true,
  animation_length: 5,
  bones: {
    // leaning over her belly in the pushes, swaying side to side like jelly
    body: { rotation: track(windowKeys(HSLIME_RHYTHM, 22, 10), 0, [[0, -5], [1.25, 5], [2.5, -5], [3.75, 5], [5, -5]]) },
    // looking down at her belly, thrown back at each push's peak
    head: { rotation: track([[0, 15], [0.8, 15], [1.2, -28], [1.7, 15], [3.3, 15], [3.7, -28], [4.2, 15], [5, 15]], 0, 0) },
    // cupping under her belly, hugging its sides in the pushes
    right_arm: hslimeArm(1),
    left_arm: hslimeArm(-1),
    // legs splayed flat to the sides, her hips almost on the floor
    right_leg: hslimeLeg(1),
    left_leg: hslimeLeg(-1),
  },
});
/** After the last baby: slumped forward in her puddle, arms limp, breathing. */
const HSLIME_POSTBIRTH = /** @type {AuthoredAnimation} */ ({
  loop: true,
  animation_length: 4,
  bones: {
    body: { rotation: track([[0, 33], [2, 37], [4, 33]], 0, 0) },
    head: { rotation: [40, 0, 0] },
    right_arm: { rotation: [-10, 0, 20] },
    left_arm: { rotation: [-10, 0, -20] },
    right_leg: { rotation: [-25, 0, 72], position: [0, -10, 0] },
    left_leg: { rotation: [-25, 0, -72], position: [0, -10, 0] },
  },
});

/** Every family's birth: rhythm, authored poses, exit, species effects. */
export const MOB_BIRTHS = /** @type {Record<typeof MOB_FAMILIES[number], MobBirth>} */ ({
  zombie_girl: {
    rhythm: ZOMBIE_RHYTHM,
    pose: 'birth_standing',
    authored: ZOMBIE_BIRTH,
    lerp: 'linear',
    exitWant: [0, -0.97, 0.24],
    exitAt: 2.0,
    sounds: { mp_groan: 'mob.zombie.say' },
    particles: {},
  },
  humanoid_creeper_girl: {
    // the mod's own head-raise windows; the gates are where her legs close in the mod's birth
    rhythm: { length: 9, pushes: [[0.5, 3.0], [7.25, 8.3]], gates: [[1.65, 2.1], [2.75, 3.15]] },
    flash: { windows: [[0.9, 1.5], [7.5, 8.0]], hz: 10, level: 0.6 },
    sounds: { mp_hiss: 'random.fuse', mp_push: 'minepreggo.player_push' },
    particles: {},
  },
  humanoid_slime_girl: {
    rhythm: HSLIME_RHYTHM,
    pose: 'birth_melting',
    authored: HSLIME_BIRTH,
    postPose: 'postbirth_puddle',
    postAuthored: HSLIME_POSTBIRTH,
    exitWant: [0, -0.35, -0.94],
    exitAt: 1.2,
    bob: '0.4 * math.sin(q.anim_time * 720.0)',
    sounds: { mp_squish: 'mob.slime.squish', mp_small: 'mob.slime.small' },
    particles: { mp_bubble: 'minecraft:cauldron_bubble_particle' },
  },
  monster_creeper_girl: {
    // her four kicks in the mod's side birth
    rhythm: { length: 9.0417, pushes: [[1.2, 1.7], [2.3, 3.4], [4.5, 5.0], [6.0, 6.5]] },
    flash: { windows: [[0.6, 1.2], [1.7, 2.3], [3.9, 4.5], [5.4, 6.0]], hz: 14, level: 0.7 },
    inset: 'v.ninset * (1.0 - 0.3 * v.push)',
    sounds: { mp_hiss: 'random.fuse' },
    particles: {},
  },
  monster_slime_girl: {
    rhythm: { length: 9, pushes: [[0.9, 1.7], [3.1, 4.8], [6.4, 6.9], [7.9, 8.6]] },
    sounds: { mp_big: 'mob.slime.big' },
    particles: { mp_plume: 'minecraft:dust_plume' },
  },
  ender_woman: {
    rhythm: { length: 9, pushes: [[0.5, 2.5], [6.4, 8.25]] },
    inset: 'v.ninset * (1.0 - 0.3 * v.push)',
    sounds: { mp_portal: 'mob.endermen.portal', mp_idle: 'mob.endermen.idle' },
    particles: { mp_portal: 'minecraft:basic_portal_particle' },
  },
});

/**
 * One sound or particle timeline out of several (times, effect) lists; two effects at the same
 * moment are kept 0.01 s apart (a timeline has one effect per time).
 * @param {[number[], string][]} lists
 */
function timeline(lists) {
  /** @type {Record<string, { effect: string }>} */
  const out = {};
  for (const [times, effect] of lists) {
    for (const [key, value] of Object.entries(effectsAt(times, effect))) {
      let t = Number(key);
      while (String(round(t)) in out) t += 0.01;
      out[String(round(t))] = value;
    }
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
}

/** A position channel [0, y, 0] or a scale channel from per-time numbers (linear keyframes). */
const yKeys = (/** @type {[number, number][]} */ frames) => Object.fromEntries(frames.map(([t, y]) => [String(round(t)), [0, round(y), 0]]));

/**
 * Her flair: additive channels on top of her birth pose, in step with her rhythm.
 * @param {typeof MOB_FAMILIES[number]} family
 * @param {Set<string>} bones the bones of her model (channels on missing bones are left out)
 */
function birthFlair(family, bones) {
  const { rhythm } = MOB_BIRTHS[family];
  const L = rhythm.length;
  /** @type {Record<string, any>} */
  let channels = {};
  /** @type {Record<string, any>} */
  let sound_effects = {};
  /** @type {Record<string, any> | undefined} */
  let particle_effects;
  const starts = rhythm.pushes.map(([s]) => s);
  if (family === 'zombie_girl') {
    // the stiffness is her character: only a groan at each push
    channels = { body: { rotation: [0, 0, 0] } };
    sound_effects = timeline([[[0.6, 4.6], 'mp_groan']]);
  } else if (family === 'humanoid_creeper_girl') {
    // she swells with the white flash at the push peaks (the belly rides on her body)
    const flash = /** @type {Rhythm} */ ({ length: L, pushes: /** @type {any} */ (MOB_BIRTHS.humanoid_creeper_girl.flash).windows });
    channels = { body: { scale: vec(pulse(flash, 0.06, 1), pulse(flash, -0.03, 1), pulse(flash, 0.06, 1)) } };
    sound_effects = timeline([[[0.5, 7.25], 'mp_hiss'], [[1.0], 'mp_push']]);
  } else if (family === 'humanoid_slime_girl') {
    // squash and stretch: a wobble that starts strong at each push and dies out over 1.2 s
    const S = 'math.sin(q.anim_time * 720.0)';
    /** @type {Keys} */
    const scale = { '0.0': [1, 1, 1] };
    for (const s of starts) {
      scale[String(round(s - 0.1))] = [1, 1, 1];
      scale[String(round(s))] = [`1.0 + 0.12 * ${S}`, `1.0 - 0.18 * ${S}`, `1.0 + 0.12 * ${S}`];
      scale[String(round(s + 1.2))] = [1, 1, 1];
    }
    scale[String(L)] = [1, 1, 1];
    channels = {
      body: { scale: Object.fromEntries(Object.entries(scale).sort((a, b) => Number(a[0]) - Number(b[0]))) },
      head: { rotation: [0, 0, `6.0 * ${S}`] },
      ...hairSway(1),
    };
    sound_effects = timeline([[[0.4, 2.9], 'mp_squish'], [[1.2, 3.7], 'mp_small']]);
    particle_effects = timeline([[[1.0, 1.2, 3.5, 3.7], 'mp_bubble']]);
  } else if (family === 'monster_creeper_girl') {
    // her legs tremble in the kicks, her body swells; the fuse hisses just before each kick
    for (const leg of ['right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg']) channels[leg] = { rotation: vec(tremble(rhythm, 4, 14), 0, 0) };
    channels.body = { scale: vec(pulse(rhythm, 0.08, 1), pulse(rhythm, -0.05, 1), pulse(rhythm, 0.08, 1)) };
    sound_effects = timeline([[[0.6, 1.7, 3.9, 5.4], 'mp_hiss']]);
  } else if (family === 'monster_slime_girl') {
    // a hop at each push: up, a squashed landing, settled
    /** @type {[number, number][]} */
    const hop = [[0, 0]];
    /** @type {Keys} */
    const land = { '0.0': [1, 1, 1] };
    /** @type {Keys} */
    const spread = { '0.0': [1, 1, 1] };
    let wide = 1;
    for (const s of starts) {
      hop.push([s, 0], [s + 0.25, 2.0], [s + 0.5, -1.0], [s + 0.8, 0]);
      land[String(round(s + 0.25))] = [1, 1, 1];
      land[String(round(s + 0.5))] = [1.15, 0.8, 1.15];
      land[String(round(s + 0.8))] = [1, 1, 1];
      // the jelly base spreads like a puddle, a little more with every push
      spread[String(round(s + 0.25))] = [round(wide), 1, round(wide)];
      wide = Math.min(1.5, wide + 0.12);
      spread[String(round(s + 0.5))] = [round(wide), 1, round(wide)];
    }
    hop.push([L, 0]);
    land[String(L)] = [1, 1, 1];
    spread[String(round(L - 0.4))] = [round(wide), 1, round(wide)];
    spread[String(L)] = [1, 1, 1];
    const position = yKeys(hop);
    for (const root of ['leg', 'body', 'head', 'right_arm', 'left_arm']) channels[root] = { position };
    channels.leg = { ...channels.leg, scale: land };
    channels.leg_part_5 = { scale: spread };
    sound_effects = timeline([[starts, 'mp_big'], [starts.map((s) => s + 0.5), 'squish']]);
    particle_effects = timeline([[starts.map((s) => s + 0.5), 'mp_plume']]);
  } else if (family === 'ender_woman') {
    // she levitates a little in the pushes, highest as she throws herself back (the crowning's
    // copy of her body rises with her)
    const position = yKeys([[0, 0], [0.5, 0], [1.5, 2.0], [2.5, 2.5], [3.0, 1.0], [4.0, 0.5], [6.3, 1.0], [6.6, 4.0], [8.25, 3.5], [8.6, 0], [L, 0]]);
    for (const root of ['body', 'head', 'right_arm', 'left_arm', 'right_leg', 'left_leg']) channels[root] = { position };
    sound_effects = timeline([[[0.5], 'mp_idle'], [[6.4], 'mp_portal']]);
    particle_effects = timeline([[[0.6, 1.0, 1.4, 1.8, 2.2, 6.4, 6.45, 6.5, 6.55, 6.6, 6.65], 'mp_portal']]);
  }
  for (const name of Object.keys(channels)) if (!bones.has(name)) delete channels[name];
  if (!Object.keys(channels).length) channels = { body: { rotation: [0, 0, 0] } };
  return { loop: true, animation_length: L, bones: channels, sound_effects, ...(particle_effects ? { particle_effects } : {}) };
}

/** The humanoid slime girl's hair chain whipping behind her (`k` scales the amplitude). */
function hairSway(/** @type {number} */ k) {
  const a = (/** @type {number} */ v) => round(v * k).toFixed(1);
  return {
    hair: { rotation: [`${a(8)} * math.sin(q.anim_time * 360.0)`, 0, 0] },
    middle_hair: { rotation: [`${a(10)} * math.sin(q.anim_time * 360.0 - 40.0)`, 0, 0] },
    end_hair: { rotation: [`${a(12)} * math.sin(q.anim_time * 360.0 - 80.0)`, 0, 0] },
  };
}

/**
 * The humanoid slime girl's water breaking and pre-birth wobble (they were the creeper girl's).
 * @param {Set<string>} bones
 */
function slimeLaborFlair(bones) {
  const s = 'math.sin(q.anim_time * 540.0)';
  /** @type {Record<string, any>} */
  const channels = { body: { scale: [`1.0 + 0.04 * ${s}`, `1.0 - 0.04 * ${s}`, `1.0 + 0.04 * ${s}`] }, ...hairSway(0.5) };
  for (const name of Object.keys(channels)) if (!bones.has(name)) delete channels[name];
  return { loop: true, animation_length: 4, bones: channels };
}

/**
 * The committed animations of births.animation.json: every family's crowning in step with her own
 * pushes, her birth flair, and the humanoid slime girl's labor wobble.
 * @param {{ models: (family: string, phase: number) => { bones: any[] } }} options her per-size models (P7 says which bones she has)
 * @returns {Record<string, any>}
 */
export function mobBirthAnimations({ models }) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const family of MOB_FAMILIES) {
    const spec = MOB_BIRTHS[family];
    const bones = new Set(models(family, 7).bones.map((b) => b.name));
    out[`animation.${MOD}.crowning.${family}`] = crowningFor(spec.rhythm, { ...(spec.inset ? { inset: spec.inset } : {}), ...(spec.bob ? { bob: spec.bob } : {}) });
    out[`animation.${MOD}.${family}.birth_flair`] = birthFlair(family, bones);
    if (family === 'humanoid_slime_girl') out[`animation.${MOD}.${family}.labor_flair`] = slimeLaborFlair(bones);
  }
  return out;
}

/** The phased entries of a pain state: her own pose for each belly size from P4, else the fallback. */
const phased = (/** @type {string} */ name) => [{ [name]: 'v.bp < 4' }, ...PHASES.filter((p) => p >= 4).map((p) => ({ [`${name}_p${p}`]: `v.bp == ${p}` }))];

/**
 * The shared pain controller's labor states: the birth pose solved for her belly size (the solve
 * cancels each size's own rest pose), the crowning and flair started with it so they stay in step.
 * @param {{ states: Record<string, { animations?: any[] }> }} pain
 */
export function mobBirthPainStates(pain) {
  for (const state of ['water_breaking', 'prebirth', 'birth', 'postbirth']) if (!pain.states[state]) throw new Error(`the pain controller has no ${state} state`);
  pain.states.water_breaking.animations = ['water_breaking', 'labor_flair'];
  pain.states.prebirth.animations = ['prebirth', 'labor_flair'];
  pain.states.birth.animations = [...phased('birth'), 'crowning', 'birth_flair'];
  pain.states.postbirth.animations = phased('postbirth');
}

/** The belly's growth during the birth: it goes on from the prebirth size and shrinks as each baby comes out. */
const BELLY_LINE = /^v\.belly_growth = (.*) \* (?:q\.property\('minepreggo:growth'\)|\(v\.pose == 'birth' \? 1\.0 - v\.push : q\.property\('minepreggo:growth'\)\));$/;

/**
 * Wires one family's client entity to her birth: the pain-state animation keys, the flash and
 * navel-inset lines, the shrinking belly, and her sound and particle maps.
 * @param {typeof MOB_FAMILIES[number]} family
 * @param {any} d her client entity's description (its pre_animation already rebuilt)
 * @param {{ models: (phase: number) => { bones: any[], description?: any } }} ctx her per-size models
 */
export function mobBirthEntity(family, d, { models }) {
  const spec = MOB_BIRTHS[family];
  if (!spec) throw new Error(`no birth for ${family}`);
  const pre = /** @type {string[]} */ (d.scripts.pre_animation).filter((line) => !BIRTH_LINE.test(line));
  if (spec.flash) {
    // after the fuse's own flash, so the birth flash only ever brightens it
    const at = pre.findIndex((line) => line.startsWith('v.flash ='));
    if (at < 0) throw new Error(`${family}: no v.flash line`);
    pre.splice(at + 1, 0, ...flashLines({ length: spec.rhythm.length, ...spec.flash }));
  }
  if (spec.inset) {
    const at = pre.findIndex((line) => line.startsWith('v.phase = v.bp'));
    if (at < 0) throw new Error(`${family}: no v.phase = v.bp line`);
    const byPhase = Object.fromEntries(PHASES.filter((p) => p >= 4).map((p) => [p, models(p)]));
    pre.splice(at + 1, 0, navelInsetLine(byPhase, (/** @type {any} */ geometry) => openingOf(geometry, 'navel').opening));
  }
  const belly = pre.findIndex((line) => BELLY_LINE.test(line));
  if (belly < 0) throw new Error(`${family}: no v.belly_growth line`);
  pre[belly] = pre[belly].replace(BELLY_LINE, "v.belly_growth = $1 * (v.pose == 'birth' ? 1.0 - v.push : q.property('minepreggo:growth'));");
  if (pre.findIndex((line) => line.startsWith('v.push =')) > belly) throw new Error(`${family}: v.push is read before it is set`);
  d.scripts.pre_animation = pre;

  const A = d.animations;
  const birth = spec.pose ? `animation.${MOD}.${family}.${spec.pose}` : `animation.${MOD}.${family}.birth`;
  const postbirth = spec.postPose ? `animation.${MOD}.${family}.${spec.postPose}` : `animation.${MOD}.${family}.postbirth`;
  for (const [key, id, solved] of /** @type {[string, string, boolean][]} */ ([['birth', birth, !!spec.pose], ['postbirth', postbirth, !!spec.postPose]])) {
    A[key] = id;
    for (const p of PHASES.filter((n) => n >= 4)) A[`${key}_p${p}`] = solved ? `${id}_p${p}` : id;
  }
  A.crowning = `animation.${MOD}.crowning.${family}`;
  A.birth_flair = `animation.${MOD}.${family}.birth_flair`;
  A.labor_flair = family === 'humanoid_slime_girl' ? `animation.${MOD}.${family}.labor_flair` : `animation.${MOD}.no_pose`;

  // her effects, merged into what she maps already (the monster slime's own jump and squish)
  for (const [key, ours] of /** @type {const} */ ([['sound_effects', spec.sounds], ['particle_effects', spec.particles]])) {
    const merged = Object.fromEntries(Object.entries(d[key] ?? {}).filter(([name]) => !name.startsWith('mp_')));
    Object.assign(merged, ours);
    if (Object.keys(merged).length) d[key] = merged;
    else delete d[key];
  }
}

/**
 * Her solved birth (and postbirth) on one of her per-size models: the authored poses taken as
 * world orientations (her rest pose cancelled), and the way out as a constant rotation of the
 * crowning mount (her crowning geometry's mount is turned nowhere, so it is not doubled).
 * @param {typeof MOB_FAMILIES[number]} family
 * @param {{ bones: any[], description?: any }} geometry
 * @returns {{ animations: Record<string, any>, clearance: number, mount?: number[] }}
 */
export function mobBirthPoses(family, geometry) {
  const spec = MOB_BIRTHS[family];
  /** @type {Record<string, any>} */
  const animations = {};
  if (!spec.authored || !spec.pose) return { animations, clearance: Infinity };
  const parts = flatRig(geometry);
  const target = { rig: rigOf(geometry), neutral: {}, map: parts.map, pelvis: parts.pelvis, trunk: parts.trunk, scale: parts.scale, absolute: true };
  const solve = (/** @type {AuthoredAnimation} */ anim, /** @type {'linear' | undefined} */ ease) =>
    solveAnimation(animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }), target, { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.2, ...(ease ? { lerp: ease } : {}) });
  const birth = solve(spec.authored, spec.lerp);
  const { opening } = openingOf(geometry, 'crotch');
  const { mount, clearance } = exitMount(geometry, birth, 'body', opening, /** @type {number[]} */ (spec.exitWant), /** @type {number} */ (spec.exitAt));
  birth.bones.crowning = { rotation: mount };
  animations[spec.pose] = birth;
  if (spec.postAuthored && spec.postPose) animations[spec.postPose] = solve(spec.postAuthored, undefined);
  return { animations, clearance, mount };
}
