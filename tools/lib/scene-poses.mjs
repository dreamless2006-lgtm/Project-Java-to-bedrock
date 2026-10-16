// The pregnancy and scene poses every female gets, as data for tools/lib/pose-solve.mjs:
//
//   * the mod's own labor animations (contraction, pre-birth, birth, post-birth, sitting with the
//     babies kicking, morning sickness, back pain, water breaking, miscarriage), taken from the
//     humanoid creeper girl (a plain standing humanoid rig) and carried over onto each Jenny Mod
//     Java Port girl's rig from her own idle stance, with her own face, tail, wings and ears;
//   * each girl's own birth (tools/lib/girl-births.mjs: her posture, rhythm and touch of her kind),
//     solved the same way, with her crowning and flair beside it, and a relaxed postbirth after it;
//   * two scene poses authored here for every female, ours and the port's: on all fours on the
//     Jenny Bed (rocking to the scene's 0.52 s beat), and sitting back on her hands for the belly
//     scenes. They are written as world orientations on a neutral humanoid and solved absolutely,
//     so a girl's own stance does not bend them.
import { crowningFor, windowKeys as windowKeysOf } from './birth-rhythm.mjs';
import { GIRL_BIRTHS, bendsAt, girlFlair, inTrunk, restTime } from './girl-births.mjs';
import { cubeFaces, poseAt, poseBones } from './geo-render.mjs';
import { animationSource, keyTimes, limbDirections, rigOf, solveAnimation, solveAt } from './pose-solve.mjs';

/** A neutral flat humanoid (Minecraft's own proportions, no rest rotations): the authored poses' rig. */
export const NEUTRAL_RIG = rigOf({
  bones: [
    { name: 'body', pivot: [0, 24, 0] },
    { name: 'head', pivot: [0, 24, 0] },
    { name: 'right_arm', pivot: [-5, 22, 0] },
    { name: 'left_arm', pivot: [5, 22, 0] },
    { name: 'right_leg', pivot: [-1.9, 12, 0] },
    { name: 'left_leg', pivot: [1.9, 12, 0] },
  ],
});

/** The legs of a flat humanoid, whose pivots are the hip joints. */
export const LEGS = ['right_leg', 'left_leg'];

const ease = (/** @type {number[]} */ v) => ({ post: v, lerp_mode: 'catmullrom' });

/**
 * The authored scene poses on NEUTRAL_RIG (world orientations, the legs' position moving the pelvis).
 * `scene`: on all fours on the bed, her back level, head up, rocking back and forth to the 0.52 s
 * beat of the older Jenny pack's player animation. `scene_sit`: sitting on the ground, leaning back
 * on her hands with her legs out in front and apart, looking down at her belly, breathing.
 */
export const AUTHORED = {
  scene: {
    loop: true,
    animation_length: 0.52,
    bones: {
      body: { rotation: { '0.0': ease([88, 0, 0]), '0.26': ease([84, 0, 0]), '0.52': ease([88, 0, 0]) } },
      head: { rotation: { '0.0': ease([-14, 0, 0]), '0.26': ease([-22, 0, 0]), '0.52': ease([-14, 0, 0]) } },
      right_arm: { rotation: [-4, 0, 6] },
      left_arm: { rotation: [-4, 0, -6] },
      right_leg: { rotation: [0, 0, 5], position: { '0.0': ease([0, 0, 0]), '0.26': ease([0, 0, 0.7]), '0.52': ease([0, 0, 0]) } },
      left_leg: { rotation: [0, 0, -5], position: { '0.0': ease([0, 0, 0]), '0.26': ease([0, 0, 0.7]), '0.52': ease([0, 0, 0]) } },
    },
  },
  scene_sit: {
    loop: true,
    animation_length: 4,
    bones: {
      body: { rotation: { '0.0': ease([-16, 0, 0]), '2.0': ease([-19, 0, 0]), '4.0': ease([-16, 0, 0]) } },
      head: { rotation: { '0.0': ease([10, 0, 0]), '2.0': ease([14, 0, 0]), '4.0': ease([10, 0, 0]) } },
      right_arm: { rotation: [38, 0, 12] },
      left_arm: { rotation: [38, 0, -12] },
      right_leg: { rotation: [-88, 14, 0], position: [0, -9.8, 0] },
      left_leg: { rotation: [-88, -14, 0], position: [0, -9.8, 0] },
    },
  },
};

/** The scene poses every female gets (ours too); the other authored poses are the Jenny girls' labor. */
export const SCENE_POSES = ['scene', 'scene_sit'];

/**
 * The labor poses written here for the Jenny girls (the creeper girl's own contraction only throws
 * her head back, and her pre-birth only holds her arms out): a contraction bent over her belly with
 * both hands on it, rocking with the six-second wave the belly tightens in; pre-birth crouched with
 * her knees bent and apart, hands on her knees, panting. Knee and elbow bends are local (`bends`).
 */
export const AUTHORED_LABOR = {
  contraction: {
    loop: true,
    animation_length: 6,
    bends: { knee: [8, 0, 0], elbow: [-25, 0, 0] },
    bones: {
      body: { rotation: { '0.0': ease([12, 0, 0]), '3.0': ease([24, 0, 0]), '6.0': ease([12, 0, 0]) } },
      head: { rotation: { '0.0': ease([16, 0, 0]), '2.4': ease([30, 4, 0]), '3.6': ease([28, -4, 0]), '6.0': ease([16, 0, 0]) } },
      right_arm: { rotation: { '0.0': ease([-32, 0, -24]), '1.5': ease([-36, 6, -27]), '3.0': ease([-40, 0, -24]), '4.5': ease([-36, -6, -21]), '6.0': ease([-32, 0, -24]) } },
      left_arm: { rotation: { '0.0': ease([-30, 0, 22]), '1.5': ease([-34, -6, 19]), '3.0': ease([-38, 0, 22]), '4.5': ease([-34, 6, 25]), '6.0': ease([-30, 0, 22]) } },
      right_leg: { rotation: [-4, 0, 6], position: { '0.0': ease([0, -0.2, 0]), '3.0': ease([0, -0.6, 0]), '6.0': ease([0, -0.2, 0]) } },
      left_leg: { rotation: [-4, 0, -6], position: { '0.0': ease([0, -0.2, 0]), '3.0': ease([0, -0.6, 0]), '6.0': ease([0, -0.2, 0]) } },
    },
  },
  prebirth: {
    loop: true,
    animation_length: 2,
    bends: { knee: [80, 0, 0], elbow: [-10, 0, 0] },
    bones: {
      body: { rotation: { '0.0': ease([24, 0, 0]), '1.0': ease([29, 0, 0]), '2.0': ease([24, 0, 0]) } },
      head: { rotation: { '0.0': ease([4, 0, 0]), '0.5': ease([-6, 0, 0]), '1.0': ease([8, 0, 0]), '1.5': ease([-4, 0, 0]), '2.0': ease([4, 0, 0]) } },
      right_arm: { rotation: [-22, 0, -6] },
      left_arm: { rotation: [-22, 0, 6] },
      right_leg: { rotation: [-52, 18, 0], position: { '0.0': ease([0, -2.7, 0]), '1.0': ease([0, -3.0, 0]), '2.0': ease([0, -2.7, 0]) } },
      left_leg: { rotation: [-52, -18, 0], position: { '0.0': ease([0, -2.7, 0]), '1.0': ease([0, -3.0, 0]), '2.0': ease([0, -2.7, 0]) } },
    },
  },
};

/**
 * The labor poses a Jenny girl gets: the creeper girl's own (carried over from her stance) or the
 * ones written here (`authored`), `legs` replacing the source's leg orientations (the birth with her
 * knees up and apart) and `bends` her knees and elbows.
 */
export const LABOR_POSES = /** @type {Record<string, { source?: string, authored?: string, additive?: boolean, legs?: Record<string, number[]>, bends?: Record<string, number[]> }>} */ ({
  contraction: { authored: 'contraction' },
  incapacitated: { authored: 'contraction' },
  kicking_sit: { source: 'kicking_sit' },
  morning_sickness: { source: 'morning_sickness' },
  prebirth: { authored: 'prebirth' },
  birth: { source: 'birth', legs: { right_leg: [-122, 24, 0], left_leg: [-122, -24, 0] }, bends: { knee: [95, 0, 0] } },
  postbirth: { source: 'postbirth' },
  miscarriage: { source: 'miscarriage' },
  // She can walk with these, so they add to her own walk and idle instead of replacing them.
  back_pain: { source: 'back_pain', additive: true },
  water_breaking: { source: 'water_breaking', additive: true },
});

/** How a pose shows on her face (bones the Jenny-mod rigs share; a missing bone is skipped). */
const FACES = /** @type {Record<string, { eyes?: 'closed' | 'open', mouth?: string, blush?: boolean }>} */ ({
  contraction: { eyes: 'closed', mouth: 'suprisedPikatchu', blush: true },
  incapacitated: { eyes: 'closed', mouth: 'suprisedPikatchu', blush: true },
  kicking_sit: { eyes: 'open', mouth: 'suprisedPikatchu' },
  morning_sickness: { eyes: 'closed' },
  prebirth: { eyes: 'closed', mouth: 'suprisedPikatchu', blush: true },
  birth: { eyes: 'closed', mouth: 'suprisedPikatchu', blush: true },
  postbirth: { eyes: 'open', mouth: 'wideSmugSmile2', blush: true },
  miscarriage: { eyes: 'closed' },
  scene: { eyes: 'open', mouth: 'wideSmugSmile2', blush: true },
  scene_sit: { eyes: 'open', mouth: 'wideSmugSmile2', blush: true },
});

/**
 * Her face for a pose, as position channels: the Jenny-mod rigs keep every expression inside the
 * head and slide the shown one a unit forward (their own blink moves the closed eyes forward and
 * the open ones back), so the pose's mouth and blush come forward, every other mouth goes back and
 * the eyes close or stay open.
 * @param {{ bones: any[] }} geometry @param {string} pose
 */
export function faceChannels(geometry, pose) {
  const face = FACES[pose];
  /** @type {Record<string, { position: number[] }>} */
  const out = {};
  if (!face) return out;
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const frontOf = (/** @type {any} */ bone) => Math.min(...(bone?.cubes ?? []).map((/** @type {any} */ c) => c.origin[2]));
  if (face.eyes === 'closed') {
    for (const n of ['closedL', 'closedR']) if (byName.has(n)) out[n] = { position: [0, 0, -1] };
    for (const n of ['openL', 'openR']) if (byName.has(n)) out[n] = { position: [0, 0, 1] };
  }
  const mouths = geometry.bones.filter((b) => b.parent === 'mouth' && b.cubes?.length);
  const shown = face.mouth && byName.get(face.mouth)?.cubes?.length ? byName.get(face.mouth) : undefined;
  if (shown && mouths.length) {
    const front = Math.min(...mouths.map(frontOf));
    for (const bone of mouths) {
      const z = frontOf(bone);
      if (bone === shown) out[bone.name] = { position: [0, 0, Math.round((front - z) * 1000) / 1000] };
      else if (z < front + 0.5) out[bone.name] = { position: [0, 0, 1] };
    }
  }
  const blush = byName.get('blush');
  if (face.blush && blush?.cubes?.length) {
    const head = byName.get('head')?.cubes?.[0];
    if (head && frontOf(blush) > head.origin[2] + 0.5) out.blush = { position: [0, 0, -1] };
  }
  return out;
}

/** Bones that follow the rhythm of a pose on their own (tails curl, wings droop or beat, ears flatten). */
export function flavourChannels(/** @type {{ bones: any[] }} */ geometry, /** @type {string} */ pose) {
  const names = new Set(geometry.bones.map((b) => b.name));
  /** @type {Record<string, any>} */
  const out = {};
  const labor = ['contraction', 'incapacitated', 'prebirth', 'birth', 'kicking_sit', 'morning_sickness', 'miscarriage'].includes(pose);
  const tails = [...names].filter((n) => /^tail\d*$/.test(n)).sort();
  tails.forEach((n, i) => {
    out[n] = labor
      ? { rotation: [`${(6 + i * 2).toFixed(1)} * math.sin(q.life_time * 120.0 + ${(i * 35).toFixed(1)})`, `${(5 + i * 2).toFixed(1)} * math.sin(q.life_time * 90.0 + ${(i * 50).toFixed(1)})`, 0] }
      : { rotation: [0, `${(4 + i).toFixed(1)} * math.sin(q.life_time * 60.0 + ${(i * 40).toFixed(1)})`, 0] };
  });
  // Galath's wings droop in labor; the bee's buzz in short bursts.
  for (const [name, side] of [['wingR', 1], ['wingL', -1]]) {
    if (names.has(name) && labor) out[name] = { rotation: [0, `${side * 6}.0 * math.sin(q.life_time * 45.0)`, `${side * -18}.0`] };
  }
  for (const name of ['wing', 'wing2']) {
    if (names.has(name)) out[name] = { rotation: [0, `(math.mod(q.life_time, 3.0) < 0.6 ? 25.0 * math.sin(q.life_time * 2400.0) : 0.0)`, 0] };
  }
  // Luna's (and Galath's) ears go flat in pain.
  if (labor) for (const name of ['earL', 'earR']) if (names.has(name)) out[name] = { rotation: [-25, 0, 0] };
  return out;
}

/** Bones a solved pose keeps straight (the mod's rigs have one-piece limbs). */
export const STRAIGHT = ['lowerArmR', 'lowerArmL', 'shinR', 'shinL'];

/**
 * A Jenny-mod rig's parts for the solver: her mapped bones, hip joints and the bone that places her
 * pelvis (the nearest common parent of her legs and upperBody), or undefined when she has no trunk.
 * @param {{ bones: any[] }} geometry
 */
export function jennyRig(geometry) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  if (!byName.has('upperBody')) return undefined;
  const chain = (/** @type {string} */ n) => {
    const out = [];
    for (let b = byName.get(n); b; b = b.parent ? byName.get(b.parent) : undefined) out.push(b.name);
    return out;
  };
  const legs = ['legR', 'legL'].filter((n) => byName.has(n));
  const pelvis = legs.length === 2 ? legs : ['upperBody'];
  const up = chain('upperBody');
  const others = pelvis.map(chain);
  // the nearest bone above upperBody that every leg also hangs from (upperBody's parent at least)
  const mover = up.slice(1).find((n) => others.every((c) => c.includes(n))) ?? up[up.length - 1];
  /** @type {Record<string, string>} source (flat humanoid) -> her bone */
  const map = { body: 'upperBody' };
  for (const [s, g] of [['head', 'head'], ['right_arm', 'armR'], ['left_arm', 'armL'], ['right_leg', 'legR'], ['left_leg', 'legL']]) if (byName.has(g)) map[s] = g;
  const hipHeight = pelvis.reduce((sum, n) => sum + byName.get(n).pivot[1], 0) / pelvis.length;
  const limbs = limbDirections(geometry, ['armR', 'armL', 'legR', 'legL', 'lowerArmR', 'lowerArmL', 'shinR', 'shinL']);
  return { map, pelvis, mover, scale: Math.max(0.5, Math.min(1.6, hipHeight / 12)), straighten: STRAIGHT.filter((n) => byName.has(n)), limbs };
}

/**
 * One of our families' flat rigs (the mod's own females) for the solver.
 * @param {{ bones: any[] }} geometry
 */
export function flatRig(geometry) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  /** @type {Record<string, string>} */
  const map = {};
  for (const n of ['body', 'head', 'right_arm', 'left_arm', 'right_leg', 'left_leg']) if (byName.has(n)) map[n] = n;
  const hipHeight = LEGS.reduce((sum, n) => sum + (byName.get(n)?.pivot?.[1] ?? 12), 0) / 2;
  return { map, pelvis: LEGS.filter((n) => byName.has(n)), trunk: 'body', scale: hipHeight / 12 };
}

/**
 * The bones that rest on the floor in a pose: her limbs and all that hangs from them (feet, shoes,
 * hands) and her trunk's own cubes. Hair, tails, wings, horns and the flat decorations some rigs
 * draw mostly transparent (voxel cheeks, skirt sides) are left out, and so is anything parked out
 * of sight below her (the Kobold's tongue).
 * @param {{ bones: any[] }} geometry
 */
export function groundBones(geometry) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const SKIP = /cheek|curve|side|midsection|turnable|hair|tail|wing|ear|horn|tounge|tongue|pony/i;
  const ROOTS = new Set(['legR', 'legL', 'armR', 'armL']);
  const TRUNK = new Set(['upperBody', 'hip', 'torso']);
  const resting = (/** @type {any} */ bone) => {
    if (TRUNK.has(bone.name)) return true;
    for (let b = bone; b; b = b.parent ? byName.get(b.parent) : undefined) {
      if (SKIP.test(b.name)) return false;
      if (ROOTS.has(b.name)) return true;
    }
    return false;
  };
  return new Set(geometry.bones.filter((b) => b.cubes?.length && resting(b)).map((b) => b.name));
}

/** How low the floor-resting bones reach at time t of a pose (model units; the floor is 0). */
export function lowestAt(/** @type {{ bones: any[] }} */ geometry, /** @type {Set<string>} */ ground, /** @type {any} */ animation, /** @type {number} */ t) {
  // the other bones keep their place in the hierarchy, without their cubes
  const resting = { bones: geometry.bones.map((b) => (ground.has(b.name) ? b : { ...b, cubes: [] })) };
  const faces = cubeFaces(resting, poseAt(animation, t));
  let low = Infinity;
  for (const face of faces) for (const c of face.corners) low = Math.min(low, c[1]);
  return low;
}

/**
 * Sets her on the floor: moves the bone that places her pelvis up or down so the lowest of her
 * floor-resting bones touches the floor, whatever her proportions. `rest`: one lift for the whole
 * loop, measured between pushes (a bounce in the pushes may dip a little); `plant`: a lift at every
 * keyframe, so her feet stay planted while her knees bend and her pelvis sinks with them; `none`:
 * she floats where she was written.
 * @param {any} animation a solved pose (changed in place)
 * @param {{ bones: any[] }} geometry @param {Set<string>} ground @param {string} mover
 * @param {'rest' | 'plant' | 'none'} mode @param {number} restT
 */
export function fitToFloor(animation, geometry, ground, mover, mode, restT) {
  if (mode === 'none') return;
  const channels = (animation.bones[mover] ??= {});
  const base = channels.position ?? [0, 0, 0];
  /** the lift as a position in the mover's parent's frame (its parents carry no rotation in these rigs, but in case one does) */
  const upIn = (/** @type {number} */ t) => {
    const bone = geometry.bones.find((b) => b.name === mover);
    const parent = bone?.parent ? poseBones(geometry, poseAt(animation, t)).get(bone.parent) : undefined;
    if (!parent) return [0, 1, 0];
    const o = parent([0, 0, 0]);
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => parent(e).map((v, k) => v - o[k]));
    return axes.map((a) => a[1]);
  };
  const lift = (/** @type {number[]} */ value, /** @type {number} */ dy, /** @type {number} */ t) => {
    const up = upIn(t);
    return value.map((v, k) => Math.round((Number(v) + up[k] * dy) * 1000) / 1000);
  };
  if (mode === 'rest') {
    const dy = -lowestAt(geometry, ground, animation, restT);
    if (Array.isArray(base)) channels.position = lift(base, dy, restT);
    else for (const [t, frame] of Object.entries(base)) base[t] = Array.isArray(frame) ? lift(frame, dy, Number(t)) : { ...frame, post: lift(frame.post, dy, Number(t)) };
    return;
  }
  // every keyframe time of the pose, so the lift follows each change of her legs
  const times = keyTimes(animation);
  const at = (/** @type {number} */ t) => {
    if (Array.isArray(base)) return base;
    return poseAt({ bones: { m: { position: base } } }, t).m.position ?? [0, 0, 0];
  };
  /** @type {Record<string, any>} */
  const frames = {};
  for (const t of times) frames[String(t)] = { post: lift(/** @type {number[]} */ (at(t)), -lowestAt(geometry, ground, animation, t), t), lerp_mode: 'catmullrom' };
  channels.position = frames;
}

/**
 * Her belly's turn against her trunk's forward bend, so a belly carried on a trunk bent over toward
 * the floor lies forward along it instead of down through it. `hang` is the share of the bend, or
 * a share for the P4 to P6 bellies and one for the P7 to P9 ones: the smaller ones turn about their
 * top (their bulk hangs below it, so they turn the other way, along her thighs), the bigger ones
 * about their bottom. The shares are picked per size by v.bp, so the channel is Molang on plain
 * (straight-line) keyframes.
 * @param {{ bones: Record<string, any> }} authored her pose on NEUTRAL_RIG @param {any} solved
 * @param {number | [number, number]} hang
 */
function bellyHang(authored, solved, hang) {
  const [early, late] = Array.isArray(hang) ? hang : [hang, hang];
  const round = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  /** @type {Record<string, any>} */
  const frames = {};
  for (const t of keyTimes(solved)) {
    const x = Number(poseAt(authored, t).body?.rotation?.[0] ?? 0);
    const a = round(-early * x), b = round(-late * x);
    frames[String(t)] = [a === b ? a : `v.bp <= 6 ? ${a.toFixed(2)} : ${b.toFixed(2)}`, 0, 0];
  }
  const values = Object.values(frames).map((f) => f[0]);
  return values.every((v) => v === values[0]) ? frames[String(keyTimes(solved)[0])] : frames;
}

/** How far her prebirth leans from the shared crouch toward the rest frame of her own birth. */
export const PREBIRTH_BLEND = 0.4;

/**
 * The shared prebirth crouch leaning a share of the way toward the rest frame of her own birth
 * (each angle, the pelvis and the bends), so her labor already hints at the birth to come.
 * @param {{ loop: boolean, animation_length: number, bends: Record<string, number[]>, bones: Record<string, any> }} anim the shared prebirth
 * @param {import('./girl-births.mjs').GirlBirth} spec @param {number} share
 */
export function towardBirth(anim, spec, share) {
  const rest = poseAt(spec.authored, restTime(spec.rhythm));
  const mix = (/** @type {any} */ v, /** @type {number[]} */ goal) => (Array.isArray(v) ? v.map((x, k) => Math.round((Number(x) + share * (goal[k] - Number(x))) * 100) / 100) : v);
  /** @type {Record<string, any>} */
  const bones = {};
  for (const [bone, channels] of Object.entries(anim.bones)) {
    bones[bone] = {};
    for (const [channel, value] of Object.entries(/** @type {Record<string, any>} */ (channels))) {
      const goal = /** @type {number[]} */ ((/** @type {any} */ (rest[bone] ?? {}))[channel] ?? [0, 0, 0]).map(Number);
      bones[bone][channel] = Array.isArray(value)
        ? mix(value, goal)
        : Object.fromEntries(Object.entries(value).map(([t, frame]) => [t, Array.isArray(frame) ? mix(frame, goal) : { ...frame, post: mix(frame.post, goal) }]));
    }
  }
  const birthBends = bendsAt(spec.authored.bends, 'rest');
  /** @type {Record<string, number>} */
  const bends = {};
  for (const part of ['knee', 'elbow']) {
    const shared = anim.bends[part]?.[0] ?? 0;
    for (const side of ['R', 'L']) {
      const goal = birthBends[part + side] ?? birthBends[part] ?? 0;
      bends[part + side] = Math.round((shared + share * (goal - shared)) * 100) / 100;
    }
  }
  return { loop: true, animation_length: anim.animation_length, bends, bones };
}

/**
 * Her relaxed postbirth: her birth's rest frame held (every push value gives way to its rest
 * value), her head turned aside, her hands on her belly when her arms are free (they hold her up in
 * the knee-chest, the crouch and the float), her trunk breathing slowly.
 * @param {import('./girl-births.mjs').GirlBirth} spec
 * @returns {{ loop: true, animation_length: number, bends: import('./girl-births.mjs').Bends, bones: Record<string, any> }}
 */
export function relaxed(spec) {
  const at = poseAt(spec.authored, restTime(spec.rhythm));
  const r = (/** @type {string} */ bone) => (at[bone]?.rotation ?? [0, 0, 0]).map((v) => Math.round(Number(v) * 100) / 100);
  const body = r('body');
  const head = r('head');
  const breathe = (/** @type {number} */ dx) => [body[0] + dx, body[1], body[2]];
  /** @type {Record<string, any>} */
  const bones = {
    body: { rotation: { '0.0': breathe(-2), '2.0': breathe(2), '4.0': breathe(-2) } },
    head: { rotation: [head[0], head[1] + 20, head[2]] },
  };
  for (const [arm, side] of /** @type {[string, number][]} */ ([['right_arm', 1], ['left_arm', -1]])) {
    bones[arm] = { rotation: spec.handsFree ? inTrunk(body, [-40, 20 * side, 0]) : r(arm) };
  }
  for (const leg of LEGS) bones[leg] = { rotation: r(leg), position: (at[leg]?.position ?? [0, 0, 0]).map((v) => Math.round(Number(v) * 100) / 100) };
  /** @type {import('./girl-births.mjs').Bends} */
  const bends = bendsAt(spec.authored.bends, 'rest');
  return { loop: true, animation_length: 4, bends, bones };
}

/**
 * Every pose animation of one Jenny girl, solved onto her rig: the mod's labor animations from her
 * idle stance, the authored scene poses, her own birth and relaxed postbirth (tools/lib/girl-births.mjs,
 * when her id has one), her face and flavour on top.
 *
 * The result also carries `birthExtras` (not enumerable, so it is never taken for a pose): her
 * birth's flair and crowning animations, which play beside the birth pose and start with it.
 * @param {object} options
 * @param {string} [options.id] her entity id (her own birth in GIRL_BIRTHS; none: the shared birth)
 * @param {{ bones: any[] }} options.geometry her main body geometry
 * @param {any} [options.idle] her idle animation (its first frame is her neutral stance)
 * @param {{ bones: any[] }} options.sourceGeometry the humanoid creeper girl's geometry
 * @param {Record<string, any>} options.sourceAnimations the creeper girl's animations by short name (contraction, birth, ...)
 * @param {string} options.prefix animation ids start with this (animation.minepreggo.jp_<slug>)
 * @returns {Record<string, any> | undefined} animation id -> animation, keyed by pose in `pose`
 */
export function girlPoseAnimations({ id, geometry, idle, sourceGeometry, sourceAnimations, prefix }) {
  const parts = jennyRig(geometry);
  if (!parts) return undefined;
  const rig = rigOf(geometry);
  const names = new Set(rig.keys());
  const neutral = idle ? poseAt(idle, 0) : {};
  // only the bones of her rig count in her neutral stance
  for (const name of Object.keys(neutral)) if (!rig.has(name)) delete neutral[name];
  const spec = id ? GIRL_BIRTHS[id] : undefined;
  /** @type {Record<string, any>} */
  const out = {};
  const sourceRig = rigOf(sourceGeometry);
  const extraFor = (/** @type {string} */ pose) => ({ ...faceChannels(geometry, pose) });
  // Clothes some girls wear as a second chain beside their body (the slime girl's dress, hat and
  // top hang from a root of their own) take the same motion as the bones they cover.
  const aliases = [['figure', parts.mover], ['dress', 'upperBody'], ['hat', 'head'], ['boobsSlime', 'boobs']].filter(([alias, of]) => rig.has(alias) && rig.has(of) && !rig.get(alias)?.parent?.match(/^(upperBody|torso|head)$/));
  /**
   * Her clothes, face and flavour on a solved pose. `own` are her birth's own channels (tails,
   * wings, ears, the slime's squash): laid on before the clothes copy her body, and in place of
   * the flavour channels of the same bones.
   */
  const finish = (/** @type {any} */ animation, /** @type {string} */ pose, /** @type {Record<string, any>} */ own = {}) => {
    for (const [bone, channels] of Object.entries(own)) if (names.has(bone)) animation.bones[bone] = { ...(animation.bones[bone] ?? {}), ...channels };
    for (const [alias, of] of aliases) if (animation.bones[of]) animation.bones[alias] = { ...animation.bones[of] };
    // her face holds its expression; tails, wings and ears move on their own clock
    for (const [bone, channels] of Object.entries(extraFor(pose))) animation.bones[bone] = { ...(animation.bones[bone] ?? {}), ...channels };
    for (const [bone, channels] of Object.entries(flavourChannels(geometry, pose))) if (!own[bone]) animation.bones[bone] = { ...(animation.bones[bone] ?? {}), ...channels };
    return animation;
  };
  /**
   * Her knee and elbow bones bent as a pose says (the rest kept straight): `knee`/`elbow` for both
   * sides, `kneeR`/`kneeL`/`elbowR`/`elbowL` for one, as [x, y, z] or X degrees.
   */
  const bendsOf = (/** @type {Record<string, number[] | number> | undefined} */ bends) => {
    /** @type {Record<string, number[]>} */
    const out = {};
    if (!bends) return out;
    for (const [part, bones] of /** @type {[string, [string, string][]][]} */ ([['knee', [['shinR', 'R'], ['shinL', 'L']]], ['elbow', [['lowerArmR', 'R'], ['lowerArmL', 'L']]]])) {
      for (const [bone, side] of bones) {
        const bend = bends[part + side] ?? bends[part];
        if (bend !== undefined && rig.has(bone)) out[bone] = typeof bend === 'number' ? [bend, 0, 0] : bend;
      }
    }
    return out;
  };
  const target = (/** @type {Record<string, number[]>} */ bends) => ({ rig, neutral, limbs: parts.limbs, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten, bends });
  /** An authored pose on NEUTRAL_RIG solved onto her rig as world orientations. */
  const solveAuthored = (/** @type {any} */ anim, /** @type {number} */ step) =>
    solveAnimation(animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }), target(bendsOf(anim.bends)), { length: anim.animation_length, loop: true, times: keyTimes(anim), step });
  for (const [pose, { source, authored, additive, legs, bends }] of Object.entries(LABOR_POSES)) {
    // her own birth and postbirth (and her prebirth leaning toward it) replace the shared ones below
    if (spec && (pose === 'birth' || pose === 'postbirth' || (pose === 'prebirth' && (spec.prebirthBlend ?? PREBIRTH_BLEND) > 0))) continue;
    if (authored) {
      out[pose] = finish(solveAuthored(/** @type {any} */ (AUTHORED_LABOR)[authored], 0.2), pose);
      continue;
    }
    let anim = source ? sourceAnimations[source] : undefined;
    if (!anim) continue;
    if (legs) anim = { ...anim, bones: { ...anim.bones, ...Object.fromEntries(Object.entries(legs).map(([bone, rotation]) => [bone, { ...(anim.bones?.[bone] ?? {}), rotation }])) } };
    const length = Number(anim.animation_length ?? 0) || Math.max(0, ...keyTimes(anim));
    /** @type {Record<string, any>} the belly's own channels (the creeper girl's belly is a bone of hers too) */
    const passThrough = {};
    for (const bone of ['belly', 'boobs']) {
      const channels = anim.bones?.[bone];
      if (!channels) continue;
      passThrough[bone] = {};
      if (channels.rotation) passThrough[bone].rotation = channels.rotation;
      if (channels.scale) passThrough[bone].scale = channels.scale;
    }
    const solved = solveAnimation(
      animationSource(sourceRig, anim),
      { rig, neutral, limbs: parts.limbs, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, straighten: additive ? [] : parts.straighten, bends: bendsOf(bends) },
      { length, loop: anim.loop ?? true, times: keyTimes(anim), step: 0.2, additive, passThrough }
    );
    out[pose] = finish(solved, pose);
  }
  /** @type {{ flair: { id: string, animation: any }, crowning: { id: string, animation: any } } | undefined} */
  let birthExtras;
  if (spec) {
    const { rhythm } = spec;
    // Lying on her side, her hips roll with her trunk: the trunk's orientation turns her whole body
    // (the bone her legs and trunk hang from), not only her upper body above the hips.
    const map = spec.wholeBody ? { ...parts.map, body: parts.mover } : parts.map;
    const birthTarget = (/** @type {Record<string, number[]>} */ bends) => ({ ...target(bends), map });
    const source = animationSource(NEUTRAL_RIG, spec.authored, { pelvis: LEGS, trunk: 'body' });
    const restBends = bendsOf(bendsAt(spec.authored.bends, 'rest'));
    const birth = solveAnimation(source, birthTarget(restBends), { length: rhythm.length, loop: true, times: keyTimes(spec.authored), step: 0.2 });
    // A bend that changes in the pushes (the Bee draws her knees up, Allie straightens her arms):
    // a knee or elbow is bent in its own frame, so its channel is the same at every moment of the
    // pose and only follows the push windows.
    const pushBends = bendsOf(bendsAt(spec.authored.bends, 'push'));
    for (const [bone, bend] of Object.entries(pushBends)) {
      if (restBends[bone] && bend.every((v, k) => v === restBends[bone][k])) continue;
      const channel = (/** @type {Record<string, number[]>} */ bends) => solveAt(source, birthTarget(bends), 0)[bone].rotation.map((/** @type {any} */ v) => Math.round(Number(v) * 1000) / 1000);
      (birth.bones[bone] ??= {}).rotation = windowKeysOf(rhythm, channel(pushBends), channel(restBends));
    }
    const ground = groundBones(geometry);
    const floor = spec.floor ?? 'rest';
    fitToFloor(birth, geometry, ground, parts.mover, floor, restTime(rhythm));
    if (spec.bellyHang) birth.bones.belly = { rotation: bellyHang(spec.authored, birth, spec.bellyHang) };
    const ctx = { rhythm, names };
    out.birth = finish(birth, 'birth', spec.extras?.(ctx) ?? {});
    const post = relaxed(spec);
    const postbirth = solveAnimation(animationSource(NEUTRAL_RIG, post, { pelvis: LEGS, trunk: 'body' }), birthTarget(bendsOf(post.bends)), { length: post.animation_length, loop: true, times: keyTimes(post), step: 0.25 });
    fitToFloor(postbirth, geometry, ground, parts.mover, floor === 'none' ? 'none' : 'rest', 0);
    if (spec.bellyHang) postbirth.bones.belly = { rotation: bellyHang(post, postbirth, spec.bellyHang) };
    out.postbirth = finish(postbirth, 'postbirth', spec.extras?.({ ...ctx, post: true }) ?? {});
    const blend = spec.prebirthBlend ?? PREBIRTH_BLEND;
    if (blend > 0) {
      const pre = towardBirth(AUTHORED_LABOR.prebirth, spec, blend);
      const prebirth = solveAnimation(animationSource(NEUTRAL_RIG, pre, { pelvis: LEGS, trunk: 'body' }), target(bendsOf(pre.bends)), { length: pre.animation_length, loop: true, times: keyTimes(pre), step: 0.2 });
      fitToFloor(prebirth, geometry, ground, parts.mover, floor === 'none' ? 'none' : 'rest', 0);
      if (spec.bellyHang) prebirth.bones.belly = { rotation: bellyHang(pre, prebirth, spec.bellyHang) };
      out.prebirth = finish(prebirth, 'prebirth');
    }
    birthExtras = {
      flair: { id: `${prefix}.birth_flair`, animation: girlFlair(spec, names, parts.mover) },
      crowning: { id: `${prefix}.birth_crowning`, animation: crowningFor(rhythm) },
    };
  }
  for (const [pose, anim] of Object.entries(AUTHORED)) {
    const solved = solveAnimation(
      animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }),
      { rig, neutral, limbs: parts.limbs, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten },
      { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.13 }
    );
    out[pose] = finish(solved, pose);
  }
  const result = Object.fromEntries(Object.entries(out).map(([pose, animation]) => [pose, { id: `${prefix}.${pose}`, animation }]));
  if (birthExtras) Object.defineProperty(result, 'birthExtras', { value: birthExtras, enumerable: false });
  return result;
}

/**
 * The scene poses of one of our families, solved onto her flat rig (her rest pose, e.g. the zombie
 * girl's raised arms, is cancelled: the poses are absolute).
 * @param {{ bones: any[] }} geometry
 */
export function familySceneAnimations(geometry) {
  const parts = flatRig(geometry);
  const rig = rigOf(geometry);
  /** @type {Record<string, any>} */
  const out = {};
  for (const pose of SCENE_POSES) {
    const anim = /** @type {any} */ (AUTHORED)[pose];
    out[pose] = solveAnimation(
      animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }),
      { rig, neutral: {}, map: parts.map, pelvis: parts.pelvis, trunk: parts.trunk, scale: parts.scale, absolute: true },
      { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.13 }
    );
  }
  return out;
}
