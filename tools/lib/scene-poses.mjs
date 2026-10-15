// The pregnancy and scene poses every female gets, as data for tools/lib/pose-solve.mjs:
//
//   * the mod's own labor animations (contraction, pre-birth, birth, post-birth, sitting with the
//     babies kicking, morning sickness, back pain, water breaking, miscarriage), taken from the
//     humanoid creeper girl (a plain standing humanoid rig) and carried over onto each Jenny Mod
//     Java Port girl's rig from her own idle stance, with her own face, tail, wings and ears;
//   * two scene poses authored here for every female, ours and the port's: on all fours on the
//     Jenny Bed (rocking to the scene's 0.52 s beat), and sitting back on her hands for the belly
//     scenes. They are written as world orientations on a neutral humanoid and solved absolutely,
//     so a girl's own stance does not bend them.
import { poseAt } from './geo-render.mjs';
import { animationSource, keyTimes, rigOf, solveAnimation } from './pose-solve.mjs';

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
  return { map, pelvis, mover, scale: Math.max(0.5, Math.min(1.6, hipHeight / 12)), straighten: STRAIGHT.filter((n) => byName.has(n)) };
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
 * Every pose animation of one Jenny girl, solved onto her rig: the mod's labor animations from her
 * idle stance, the authored scene poses, her face and flavour on top.
 * @param {object} options
 * @param {{ bones: any[] }} options.geometry her main body geometry
 * @param {any} [options.idle] her idle animation (its first frame is her neutral stance)
 * @param {{ bones: any[] }} options.sourceGeometry the humanoid creeper girl's geometry
 * @param {Record<string, any>} options.sourceAnimations the creeper girl's animations by short name (contraction, birth, ...)
 * @param {string} options.prefix animation ids start with this (animation.minepreggo.jp_<slug>)
 * @returns {Record<string, any> | undefined} animation id -> animation, keyed by pose in `pose`
 */
export function girlPoseAnimations({ geometry, idle, sourceGeometry, sourceAnimations, prefix }) {
  const parts = jennyRig(geometry);
  if (!parts) return undefined;
  const rig = rigOf(geometry);
  const neutral = idle ? poseAt(idle, 0) : {};
  // only the bones of her rig count in her neutral stance
  for (const name of Object.keys(neutral)) if (!rig.has(name)) delete neutral[name];
  /** @type {Record<string, any>} */
  const out = {};
  const sourceRig = rigOf(sourceGeometry);
  const extraFor = (/** @type {string} */ pose) => ({ ...faceChannels(geometry, pose) });
  // Clothes some girls wear as a second chain beside their body (the slime girl's dress, hat and
  // top hang from a root of their own) take the same motion as the bones they cover.
  const aliases = [['figure', parts.mover], ['dress', 'upperBody'], ['hat', 'head'], ['boobsSlime', 'boobs']].filter(([alias, of]) => rig.has(alias) && rig.has(of) && !rig.get(alias)?.parent?.match(/^(upperBody|torso|head)$/));
  const finish = (/** @type {any} */ animation, /** @type {string} */ pose) => {
    for (const [alias, of] of aliases) if (animation.bones[of]) animation.bones[alias] = { ...animation.bones[of] };
    // her face holds its expression; tails, wings and ears move on their own clock
    for (const [bone, channels] of Object.entries(extraFor(pose))) animation.bones[bone] = { ...(animation.bones[bone] ?? {}), ...channels };
    for (const [bone, channels] of Object.entries(flavourChannels(geometry, pose))) animation.bones[bone] = { ...(animation.bones[bone] ?? {}), ...channels };
    return animation;
  };
  /** her knee and elbow bones bent as a pose says (the rest kept straight) */
  const bendsOf = (/** @type {Record<string, number[]> | undefined} */ bends) => {
    /** @type {Record<string, number[]>} */
    const out = {};
    if (!bends) return out;
    for (const [part, bones] of [['knee', ['shinR', 'shinL']], ['elbow', ['lowerArmR', 'lowerArmL']]]) {
      for (const bone of bones) if (bends[part] && rig.has(bone)) out[bone] = bends[part];
    }
    return out;
  };
  for (const [pose, { source, authored, additive, legs, bends }] of Object.entries(LABOR_POSES)) {
    if (authored) {
      const anim = /** @type {any} */ (AUTHORED_LABOR)[authored];
      const solved = solveAnimation(
        animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }),
        { rig, neutral, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten, bends: bendsOf(anim.bends) },
        { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.2 }
      );
      out[pose] = finish(solved, pose);
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
      { rig, neutral, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, straighten: additive ? [] : parts.straighten, bends: bendsOf(bends) },
      { length, loop: anim.loop ?? true, times: keyTimes(anim), step: 0.2, additive, passThrough }
    );
    out[pose] = finish(solved, pose);
  }
  for (const [pose, anim] of Object.entries(AUTHORED)) {
    const solved = solveAnimation(
      animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }),
      { rig, neutral, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten },
      { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.13 }
    );
    out[pose] = finish(solved, pose);
  }
  return Object.fromEntries(Object.entries(out).map(([pose, animation]) => [pose, { id: `${prefix}.${pose}`, animation }]));
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
