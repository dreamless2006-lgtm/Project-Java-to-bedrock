// The scene poses of our two monster bodies. The humanoid ones (tools/lib/scene-poses.mjs: on all
// fours for the Jenny Bed, sitting back on her hands for the belly scenes) are solved through a
// humanoid's legs and arms, which a creeper's four legs and a slime's jelly do not have, so each of
// these gets her own, built from her own animations where the mod has one:
//
//   * monster_creeper_girl stands on her four legs on the bed and rocks back and forth to the
//     scene's 0.52 s beat (her body and head ride over her planted feet, her head coming up on each
//     push); for a belly scene she lies down the way her own kicking_sit does, held at its quiet
//     middle between the kicks, breathing;
//   * monster_slime_girl settles low on her jelly the way her own wait does and rocks to the beat
//     on the bed; for a belly scene she sits in her wait.
//
// Like the mod's own animations they are relative to her rest pose, so one serves every belly size
// (the humanoid scene poses are solved absolutely, once per size). They replace her idle and walk on
// the bones they move, like the humanoid ones. Written by tools/gen-scene-poses.mjs next to the mod's
// animations (git-ignored: they are built from the mod's keyframes).
import { timeKey } from './birth-rhythm.mjs';
import { poseAt } from './geo-render.mjs';

/** @typedef {{ loop?: boolean | string, animation_length?: number, bones: Record<string, any> }} Animation */

/** The families whose scene poses are built here (the other four are solved by tools/lib/scene-poses.mjs). */
export const MONSTER_SCENE_FAMILIES = /** @type {const} */ (['monster_creeper_girl', 'monster_slime_girl']);

/** The bed scene's beat (the older Jenny pack's player animation, as AUTHORED.scene in tools/lib/scene-poses.mjs). */
export const BEAT = 0.52;
/** How far she rocks back into her partner on each push (as far as the humanoid pelvis travels in AUTHORED.scene). */
const ROCK = 0.7;
/** The monster creeper girl's legs, from the hip pivot (y 11) to the foot on the ground. */
const CREEPER_LEG = 11;
const CREEPER_LEGS = ['right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg'];
/** The quiet middle of the creeper's kicking_sit: lying down, between two kicks (5.6 s to 9.5 s is the plateau). */
const CREEPER_SIT_AT = 7.15;
/** The slime's upper half, which rocks over her settled jelly. */
const SLIME_UPPER = ['head', 'body', 'right_arm', 'left_arm'];

const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000 || 0;
const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => round(v + b[k]));
const ease = (/** @type {number[]} */ v) => ({ post: v, lerp_mode: 'catmullrom' });
/** A channel that eases from `rest` to `peak` and back once per `length` seconds. */
const swing = (/** @type {number[]} */ rest, /** @type {number[]} */ peak, /** @type {number} */ length) => ({
  [timeKey(0)]: ease(rest.map(round)),
  [timeKey(length / 2)]: ease(peak.map(round)),
  [timeKey(length)]: ease(rest.map(round)),
});

/**
 * One moment of an animation as a held pose (rotation and position channels only, numbers), for
 * the bones listed.
 * @param {Animation} animation @param {number} time @param {string[]} bones
 */
function heldAt(animation, time, bones) {
  const pose = poseAt(animation, time);
  /** @type {Record<string, { rotation: number[], position: number[] }>} */
  const out = {};
  for (const bone of bones) out[bone] = { rotation: (pose[bone]?.rotation ?? [0, 0, 0]).map(Number).map(round), position: (pose[bone]?.position ?? [0, 0, 0]).map(Number).map(round) };
  return out;
}

/**
 * The monster creeper girl on the bed: on her four legs, her body, head and hips rocking back by
 * ROCK on each beat while her feet stay where they are (each leg turns about its hip by the angle
 * that brings its foot back), her head coming up on the push.
 */
function creeperScene() {
  const lean = round(-Math.atan2(ROCK, CREEPER_LEG) * (180 / Math.PI));
  /** @type {Record<string, any>} */
  const bones = {
    body: { position: swing([0, 0, 0], [0, 0, ROCK], BEAT) },
    head: { rotation: swing([-4, 0, 0], [-10, 0, 0], BEAT), position: swing([0, 0, 0], [0, 0, ROCK], BEAT) },
  };
  for (const leg of CREEPER_LEGS) bones[leg] = { rotation: swing([0, 0, 0], [lean, 0, 0], BEAT), position: swing([0, 0, 0], [0, 0, ROCK], BEAT) };
  return { loop: true, animation_length: BEAT, override_previous_animation: true, bones };
}

/**
 * The monster creeper girl in a belly scene: lying down as in the middle of her own kicking_sit
 * (legs folded out front and back, body on the ground), breathing slowly and looking at her belly.
 * @param {Animation} kickingSit her own animation.minepreggo.monster_creeper_girl.kicking_sit
 */
function creeperSit(kickingSit) {
  const held = heldAt(kickingSit, CREEPER_SIT_AT, ['head', 'body', ...CREEPER_LEGS]);
  /** @type {Record<string, any>} */
  const bones = {
    body: { rotation: swing(held.body.rotation, add(held.body.rotation, [-2, 0, 0]), 4), position: held.body.position },
    head: { rotation: swing(add(held.head.rotation, [6, 0, 0]), add(held.head.rotation, [10, 0, 0]), 4), position: held.head.position },
  };
  for (const leg of CREEPER_LEGS) bones[leg] = held[leg];
  return { loop: true, animation_length: 4, override_previous_animation: true, bones };
}

/**
 * The monster slime girl on the bed: settled low on her jelly as at the start of her own wait, her
 * upper half rocking back by ROCK on each beat, her head coming up on the push.
 * @param {Animation} wait her own animation.minepreggo.monster_slime_girl.wait
 */
function slimeScene(wait) {
  const settled = heldAt(wait, 0, Object.keys(wait.bones));
  /** @type {Record<string, any>} */
  const bones = {};
  for (const [bone, { rotation, position }] of Object.entries(settled)) {
    if (!SLIME_UPPER.includes(bone)) {
      bones[bone] = { rotation, position };
      continue;
    }
    bones[bone] = { rotation: bone === 'head' ? swing(rotation, add(rotation, [-6, 0, 0]), BEAT) : rotation, position: swing(position, add(position, [0, 0, ROCK]), BEAT) };
  }
  // her boobs keep the wait's shape, not its sway
  for (const [bone, channels] of Object.entries(wait.bones)) if (channels.scale && bones[bone]) bones[bone].scale = poseAt(wait, 0)[bone]?.scale?.map(round);
  return { loop: true, animation_length: BEAT, override_previous_animation: true, bones };
}

/**
 * The monster slime girl in a belly scene: her own wait (she settles on her jelly and rests her
 * arms), replacing her idle so the two do not add up.
 * @param {Animation} wait
 */
function slimeSit(wait) {
  return { ...structuredClone(wait), loop: true, override_previous_animation: true };
}

/**
 * Both scene poses of one monster family.
 * @param {typeof MONSTER_SCENE_FAMILIES[number]} family
 * @param {(name: string) => Animation | undefined} own her own animation by short name (kicking_sit, wait)
 * @returns {{ scene: Animation, scene_sit: Animation }}
 */
export function monsterSceneAnimations(family, own) {
  const need = (/** @type {string} */ name) => {
    const animation = own(name);
    if (!animation?.bones) throw new Error(`${family}: no ${name} animation to build her scene poses from (run tools/import-jar.mjs first)`);
    return animation;
  };
  if (family === 'monster_creeper_girl') return { scene: creeperScene(), scene_sit: creeperSit(need('kicking_sit')) };
  if (family === 'monster_slime_girl') return { scene: slimeScene(need('wait')), scene_sit: slimeSit(need('wait')) };
  throw new Error(`no monster scene poses for ${family}`);
}
