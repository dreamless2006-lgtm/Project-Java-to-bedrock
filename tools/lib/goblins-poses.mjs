// The pregnancy and scene poses of Expandable Goblins' three girls (tools/import-goblins.mjs),
// solved onto their own GeckoLib rigs with tools/lib/pose-solve.mjs, the way the Jenny girls' are
// (tools/lib/scene-poses.mjs):
//
//   * the mod's labor animations, taken from the humanoid creeper girl (a plain standing humanoid)
//     and carried over from each girl's own idle stance: morning sickness, kicking while sitting,
//     back pain and water breaking (both on top of her own walk), the birth on her back with her
//     knees up and apart, the post-birth and the miscarriage;
//   * the labor poses written for the Jenny girls (a contraction bent over her belly, a pre-birth
//     crouch) and the two scene poses every female has (on all fours on the Jenny Bed, sitting back
//     on her hands), solved absolutely;
//   * a belly hold written here (both hands on her belly, looking down at it, rubbing it slowly),
//     for the girl whose own animations have none.
//
// The goblin and imp girls share one rig: a root carrying the body (neck and head, arms with a
// forearm each, the nested belly cubes) and the legs, whose hips and thighs hang from the hip joints.
// The Bloatberry girl's is a small one of the same kind without forearms. Their arms are modelled
// held out sideways (cube along x), which the solver turns onto straight down before an authored pose.
// Every pose keeps her belly: none moves its cubes, which the pregnancy sizes (and the babies move).
import { FETUS_SCALE, chainOf, crowningGeometry, simpleBaby } from './crowning.mjs';
import { AUTHORED, AUTHORED_LABOR, LABOR_POSES, LEGS, NEUTRAL_RIG, fitToFloor } from './scene-poses.mjs';
import { cubeFaces, poseAt } from './geo-render.mjs';
import { rotateBedrock } from './bedrock-math.mjs';
import { animationSource, keyTimes, limbDirections, rigOf, solveAnimation } from './pose-solve.mjs';

const ease = (/** @type {number[]} */ v) => ({ post: v, lerp_mode: 'catmullrom' });

/**
 * @typedef {object} GoblinRig how a girl's bones play the flat humanoid's parts
 * @property {Record<string, string>} map flat humanoid bone -> her bone (her neck carries her head)
 * @property {string[]} pelvis her hip joints (the legs)
 * @property {string} mover the bone that places her pelvis (the root her body and legs hang from)
 * @property {{ R: string, L: string }} shins her knees (bent by a pose's knee bends)
 * @property {{ R: string, L: string }} arms her upper arms
 * @property {number} spread how far (degrees) her arms keep out from her sides: her hips are wider than her shoulders
 * @property {string[]} straighten forearms and shins, held in line with the limb above them
 * @property {string[]} limbs the bones whose modelled direction the solver needs (arms and the rest of each limb)
 * @property {string[]} roots the limbs (and her neck) that rest on the floor in a pose, with all that hangs from them
 * @property {string} trunk her trunk, whose own cubes rest on the floor too
 * @property {RegExp} loose parts that never rest on the floor (hair, ears, antennae, the hidden bottle)
 * @property {{ chain: string[], opening: number[] }} crowning the bones from the root to the one her baby comes out of, and where (model space)
 */

/** @type {Record<'goblin' | 'berry', GoblinRig>} */
export const GOBLIN_RIGS = {
  goblin: {
    map: { body: 'body', head: 'neck', right_arm: 'arm2', left_arm: 'arm1', right_leg: 'leg1', left_leg: 'leg2' },
    pelvis: ['leg1', 'leg2'],
    mover: 'root',
    shins: { R: 'bone', L: 'bone2' },
    arms: { R: 'arm2', L: 'arm1' },
    spread: 40,
    straighten: ['bone3', 'bone4', 'bone', 'bone2'],
    limbs: ['arm1', 'arm2', 'bone3', 'bone4', 'bone', 'bone2'],
    roots: ['leg1', 'leg2', 'arm1', 'arm2', 'neck'],
    trunk: 'body',
    loose: /hair|bang|ear|bottle|hand/,
    // between her thighs where they meet, under and just behind her belly (her biggest belly hangs
    // as low as her crotch); it rides on her body, as a flat humanoid's crotch does, since her
    // hips and thighs swing with her legs
    crowning: { chain: ['root', 'body'], opening: [0, 6.2, 0.2] },
  },
  berry: {
    map: { body: 'body', head: 'neck', right_arm: 'leftlarm', left_arm: 'rightarm', right_leg: 'leftlegass', left_leg: 'rightlegass' },
    pelvis: ['leftlegass', 'rightlegass'],
    mover: 'root',
    shins: { R: 'leftlegmain', L: 'rightlegmain' },
    arms: { R: 'leftlarm', L: 'rightarm' },
    spread: 35,
    straighten: ['leftlegmain', 'rightlegmain'],
    limbs: ['leftlarm', 'rightarm', 'leftlegmain', 'rightlegmain'],
    roots: ['leftlegass', 'rightlegass', 'leftlarm', 'rightarm', 'neck'],
    trunk: 'body',
    loose: /hair|bang|antena|eye|pupil|floof/,
    crowning: { chain: ['root', 'body'], opening: [0, 1, 0.6] },
  },
};

/**
 * Both hands on her belly and her eyes on it, the hands circling slowly (a 4-second rub), standing
 * (on NEUTRAL_RIG, world orientations, solved absolutely).
 */
export const BELLY_HOLD = {
  loop: true,
  animation_length: 4,
  bones: {
    body: { rotation: { '0.0': ease([4, 0, 0]), '2.0': ease([7, 0, 0]), '4.0': ease([4, 0, 0]) } },
    head: { rotation: { '0.0': ease([20, 0, 0]), '1.0': ease([24, 5, 0]), '3.0': ease([24, -5, 0]), '4.0': ease([20, 0, 0]) } },
    right_arm: { rotation: { '0.0': ease([-38, 0, -24]), '1.0': ease([-44, 8, -28]), '2.0': ease([-48, 0, -24]), '3.0': ease([-44, -8, -20]), '4.0': ease([-38, 0, -24]) } },
    left_arm: { rotation: { '0.0': ease([-38, 0, 24]), '1.0': ease([-44, -8, 20]), '2.0': ease([-48, 0, 24]), '3.0': ease([-44, 8, 28]), '4.0': ease([-38, 0, 24]) } },
    right_leg: { rotation: [0, 0, 0] },
    left_leg: { rotation: [0, 0, 0] },
  },
};

/**
 * The poses solved onto every girl: the creeper girl's own animations (`source`, with `legs` and
 * `bends` as for the Jenny girls: her birth with her knees up and apart), the authored ones
 * (`authored`), and `additive` ones laid on her own walk and idle. The rest of the fourteen
 * (fetal movement, kicking while sitting, belly rubs) are her own animations where she has them
 * (tools/import-goblins.mjs), else the belly hold.
 */
export const SOLVED_POSES = /** @type {Record<string, { source?: string, authored?: string, additive?: boolean, legs?: Record<string, number[]>, bends?: Record<string, number[]> }>} */ ({
  ...LABOR_POSES,
  scene: { authored: 'scene' },
  scene_sit: { authored: 'scene_sit' },
  belly_hold: { authored: 'belly_hold' },
});
const AUTHORED_POSES = /** @type {Record<string, any>} */ ({ ...AUTHORED_LABOR, ...AUTHORED, belly_hold: BELLY_HOLD });

/** Her skeleton: the bones a solved pose moves (the rest, hair, ears, eyes, belly, keep her own animations). */
export function skeletonOf(/** @type {GoblinRig} */ parts) {
  return new Set([...Object.values(parts.map), ...parts.pelvis, parts.mover, ...parts.straighten, 'head']);
}

/** The bones of hers that rest on the floor in a pose: her limbs and what hangs from them, her trunk's own cubes. */
export function goblinGround(/** @type {{ bones: any[] }} */ geometry, /** @type {GoblinRig} */ parts) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const roots = new Set(parts.roots);
  const resting = (/** @type {any} */ bone) => {
    if (bone.name === parts.trunk) return true;
    for (let b = bone; b; b = b.parent ? byName.get(b.parent) : undefined) {
      if (parts.loose.test(b.name)) return false;
      if (roots.has(b.name)) return true;
    }
    return false;
  };
  return new Set(geometry.bones.filter((b) => b.cubes?.length && resting(b)).map((b) => b.name));
}

/** How low her floor-resting bones reach under a pose (model units). */
export function lowestOf(/** @type {{ bones: any[] }} */ geometry, /** @type {Set<string>} */ ground, /** @type {Record<string, any>} */ pose) {
  const resting = { bones: geometry.bones.map((b) => (ground.has(b.name) ? b : { ...b, cubes: [] })) };
  let low = Infinity;
  for (const face of cubeFaces(resting, pose)) for (const c of face.corners) low = Math.min(low, c[1]);
  return low;
}

/**
 * Her arms kept out from her sides in a pose solved absolutely (where a flat humanoid's arm hangs
 * straight down, hers would go through her hips): each arm turned outward about her trunk's
 * forward axis (the last of the game's three turns, so its Z angle) by her spread, fully while it
 * hangs down and less as it rises, none once it is level or raised (a hand at her mouth stays there).
 * @param {any} animation a solved pose (changed in place) @param {GoblinRig} parts
 * @param {import('./pose-solve.mjs').Rig} rig @param {Record<string, number[]>} limbs
 */
export function spreadArms(animation, parts, rig, limbs) {
  for (const [side, sign] of /** @type {const} */ ([['R', 1], ['L', -1]])) {
    const arm = parts.arms[side];
    const channel = animation.bones[arm]?.rotation;
    const dir = limbs[arm];
    const rest = rig.get(arm)?.rest ?? [0, 0, 0];
    if (!channel || !dir) continue;
    const spread = (/** @type {number[]} */ v) => {
      const d = rotateBedrock(dir, v.map((x, k) => Number(x) + rest[k]));
      const down = Math.max(0, Math.min(1, -d[1] / (Math.hypot(...d) || 1)));
      return [Number(v[0]), Number(v[1]), Math.round((Number(v[2]) + sign * parts.spread * down) * 1000) / 1000];
    };
    if (Array.isArray(channel)) animation.bones[arm].rotation = spread(channel);
    else for (const [t, frame] of Object.entries(channel)) channel[t] = Array.isArray(frame) ? spread(frame) : { ...frame, post: spread(frame.post) };
  }
  return animation;
}

/**
 * Every solved pose of one girl, keyed by pose name ({ id, animation }).
 * @param {object} options
 * @param {{ bones: any[] }} options.geometry her geometry
 * @param {GoblinRig} options.parts her rig
 * @param {any} options.idle her idle animation (its first moment is her neutral stance)
 * @param {{ bones: any[] }} options.sourceGeometry the humanoid creeper girl's geometry
 * @param {Record<string, any>} options.sourceAnimations the creeper girl's animations by short name
 * @param {string} options.prefix animation ids start with this
 * @param {string[]} [options.only] the poses to solve (default all of SOLVED_POSES)
 */
export function goblinPoseAnimations({ geometry, parts, idle, sourceGeometry, sourceAnimations, prefix, only }) {
  const rig = rigOf(geometry);
  const skeleton = skeletonOf(parts);
  // her neutral stance: the first moment of her idle, Molang read as at that moment, on her skeleton only
  const neutral = Object.fromEntries(Object.entries(poseAt(idle, 0, { evaluate: { v: {}, q: {} } })).filter(([bone]) => skeleton.has(bone) && rig.has(bone)));
  for (const p of Object.values(neutral)) delete p.scale;
  const limbs = limbDirections(geometry, parts.limbs);
  const hip = parts.pelvis.reduce((sum, n) => sum + (rig.get(n)?.pivot[1] ?? 12), 0) / parts.pelvis.length;
  const scale = hip / 12;
  const ground = goblinGround(geometry, parts);
  const sourceRig = rigOf(sourceGeometry);
  /** her knees bent as a pose says (her elbows stay straight: her forearms are modelled sideways) */
  const bendsOf = (/** @type {Record<string, number[] | number> | undefined} */ bends) => {
    /** @type {Record<string, number[]>} */
    const out = {};
    for (const side of /** @type {const} */ (['R', 'L'])) {
      const bend = bends?.[`knee${side}`] ?? bends?.knee;
      if (bend !== undefined) out[parts.shins[side]] = typeof bend === 'number' ? [bend, 0, 0] : bend;
    }
    return out;
  };
  const target = (/** @type {boolean} */ absolute, /** @type {Record<string, number[]>} */ bends, /** @type {boolean} */ straight) =>
    ({ rig, neutral, limbs, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale, absolute, straighten: straight ? parts.straighten : [], bends });
  /** @type {Record<string, { id: string, animation: any }>} */
  const out = {};
  for (const [pose, { source, authored, additive, legs, bends }] of Object.entries(SOLVED_POSES)) {
    if (only && !only.includes(pose)) continue;
    let animation;
    if (authored) {
      const anim = AUTHORED_POSES[authored];
      animation = solveAnimation(animationSource(NEUTRAL_RIG, anim, { pelvis: LEGS, trunk: 'body' }), target(true, bendsOf(anim.bends), true), { length: anim.animation_length, loop: true, times: keyTimes(anim), step: 0.2 });
    } else {
      let anim = source ? sourceAnimations[source] : undefined;
      if (!anim) continue;
      if (legs) anim = { ...anim, bones: { ...anim.bones, ...Object.fromEntries(Object.entries(legs).map(([bone, rotation]) => [bone, { ...(anim.bones?.[bone] ?? {}), rotation }])) } };
      const length = Number(anim.animation_length ?? 0) || Math.max(0, ...keyTimes(anim));
      // her limbs take the creeper girl's own orientations (her stance would bend them: her arms are held out),
      // but what plays on her own walk only adds the creeper girl's changes to it
      animation = solveAnimation(animationSource(sourceRig, anim), target(!additive, bendsOf(bends), !additive), { length, loop: anim.loop ?? true, times: keyTimes(anim), step: 0.2, additive });
    }
    if (!additive) spreadArms(animation, parts, rig, limbs);
    // on the floor whatever her proportions: her feet, knees, hands or back where the pose puts them
    if (!additive) fitToFloor(animation, geometry, ground, parts.mover, 'plant', 0);
    out[pose] = { id: `${prefix}.${pose}`, animation };
  }
  return out;
}

/**
 * Her crowning geometry (tools/lib/crowning.mjs): her bones from the root to her body (no cubes, so
 * her own animations move it as they move her), the mount between her thighs and a small baby in
 * her own skin (a plain patch of her body's front), drawn with her skin texture. Its size for her
 * height: the mod's fetus scale for a player's 32 units.
 * @param {{ description: any, bones: any[] }} geometry @param {GoblinRig} parts @param {string} id
 * @returns {{ doc: any, scale: number }}
 */
export function goblinCrowning(geometry, parts, id) {
  const body = geometry.bones.find((b) => b.name === parts.trunk);
  const cube = (body?.cubes ?? []).filter((/** @type {any} */ c) => Array.isArray(c.uv)).reduce((/** @type {any} */ big, /** @type {any} */ c) => (!big || c.size[0] * c.size[1] > big.size[0] * big.size[1] ? c : big), undefined);
  if (!cube) throw new Error(`${id}: her body has no box-UV cube for the baby's skin`);
  // the middle of the front (north) face of her body: plain skin
  const [w, h, d] = cube.size.map((/** @type {number} */ n) => Math.max(1, Math.ceil(n)));
  const patch = { uv: [cube.uv[0] + d + Math.floor(w / 2) - 1, cube.uv[1] + d + Math.floor(h / 2) - 1], uv_size: [2, 2] };
  const top = Math.max(...geometry.bones.flatMap((b) => (b.cubes ?? []).filter(() => !parts.loose.test(b.name)).map((/** @type {any} */ c) => c.origin[1] + c.size[1])));
  const doc = crowningGeometry({
    id,
    chain: chainOf(geometry, parts.crowning.chain),
    opening: parts.crowning.opening,
    baby: simpleBaby(patch),
    textureSize: [geometry.description.texture_width, geometry.description.texture_height],
  });
  return { doc, scale: Math.round(FETUS_SCALE * (top / 32) * 1000) / 1000 };
}

/**
 * One of her own animations as a pose: only `bones` of it (all of them by default), each set back
 * to its rest pose first, so it replaces what her walk and idle do with those bones and leaves
 * the others to them.
 * @param {any} animation @param {string[]} [bones]
 */
export function ownPose(animation, bones) {
  const kept = Object.fromEntries(Object.entries(animation.bones ?? {}).filter(([bone]) => !bones || bones.includes(bone)));
  return { ...animation, loop: true, override_previous_animation: true, bones: kept };
}
