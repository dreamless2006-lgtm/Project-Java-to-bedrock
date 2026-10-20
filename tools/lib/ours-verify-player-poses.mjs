// What the mod's own player animations do that our converted ones did not, as data for
// tools/gen-belly-render.mjs (which writes them into packs/resource/animations/player.animation.json
// and the player's animate list):
//
//   * PlayerAnimations.WALKING_HEAVY_P4..P9 swing her arms out for balance as well as splaying her
//     legs: each arm's zRot goes from 0 to a few degrees and back along a sine of the animation's
//     ticks (AnimationHelper.betweenAnglesMth), a little wider every phase. The converted heavy walk
//     had kept only the legs. It is an additive animation of its own family there (overrideVanilla
//     false), so it goes on through her pains and symptoms (a belly-rub need, a contraction, her back
//     pain); only the belly rubbing holds her arms (blockAdditiveParts), and in labor she cannot walk.
//   * The labor poses that PlayerAnimationInfos marks overrideVanilla (prebirth, birth, postbirth,
//     miscarriage) put her bones back to their rest pose before they move them
//     (PlayerAnimationCache.restoreOriginal), so the vanilla crouch, walk, bob and look do not add
//     to them. Ours add on top of the vanilla player's animations, and she taps sneak to push
//     during the birth: every push folded her legs another 28 degrees and lowered her body and head
//     (the vanilla sneaking pose, which also tilts the root). A rest pose in front of them does what
//     restoreOriginal does.
//   * In first person the game draws her arms from the same bones: a labor pose turning them (the
//     birth raises the right arm 137 degrees) threw them across her screen. Java draws the hands with
//     their xRot reset (PlayerRenderer.renderHand); like her back pain and belly rubbing, the labor
//     poses show from outside only.

/** Each arm's outward swing of the heavy walk, in degrees ([right arm zRot, left arm zRot]), by phase. */
export const HEAVY_WALK_ARMS = /** @type {Record<number, [number, number]>} */ ({ 4: [7.5, -7.5], 5: [8, -8], 6: [8.5, -8.5], 7: [9, -9], 8: [9.5, -9.5], 9: [10, -10.5] });
/** Radians per tick of the heavy walk's arm swing (the speed argument of betweenAnglesMth). */
export const HEAVY_WALK_ARM_SPEED = 0.075;

/** When the heavy walk of her phase plays besides walking: not over her belly rubbing, nor in labor. */
export const HEAVY_WALK_POSE_GATE = "!variable.mp_labor && !(variable.mp_pose == 'rubbing')";

/** The id of the rest pose in front of her overriding labor poses. */
export const LABOR_OVERRIDE_ID = 'animation.minepreggo.player.labor_override';
/** The labor poses that override the vanilla animations (PlayerAnimationInfos: overrideVanilla); water breaking adds to them. */
export const LABOR_OVERRIDE_POSES = ['prebirth', 'birth', 'postbirth', 'miscarriage'];
/** The bones the rest pose resets: the ones the labor poses move, and the root and waist the vanilla crouch tilts. */
export const LABOR_OVERRIDE_BONES = ['root', 'waist', 'body', 'head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
/** Only seen from outside, as the labor poses (Java skips them for a player lying in bed too). */
export const LABOR_OVERRIDE_WHEN = `!variable.is_first_person && !query.is_sleeping && variable.mp_labor && (${LABOR_OVERRIDE_POSES.map((pose) => `variable.mp_pose == '${pose}'`).join(' || ')})`;
/** The gate every pose of hers that turns her arms carries (her back pain and belly rubbing already did). */
export const THIRD_PERSON = '!variable.is_first_person';

const degrees = (/** @type {number} */ v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * Molang for AnimationHelper.betweenAnglesMth(a, b, tick, speed): from a to b and back along the sine
 * of the animation's ticks times speed (in degrees, as our other converted player poses write it).
 * @param {number} a @param {number} b @param {number} speed
 */
export function betweenAngles(a, b, speed) {
  return `((${degrees(a)} + (${degrees(b)} - (${degrees(a)})) * (math.sin((q.anim_time * 20 * ${speed} + 0.0) * 57.2958) + 1.0) * 0.5))`;
}

/**
 * The heavy walk of a phase with its arm swing: the legs as they are, each arm turning out about z.
 * @param {{ bones: Record<string, any> }} animation animation.minepreggo.player.walking_heavy_p<phase>
 * @param {number} phase 4..9
 */
export function withHeavyWalkArms(animation, phase) {
  const arms = HEAVY_WALK_ARMS[phase];
  if (!arms) throw new Error(`no heavy walk at P${phase}`);
  const [right, left] = arms;
  return {
    ...animation,
    bones: {
      ...animation.bones,
      rightArm: { rotation: [0, 0, betweenAngles(right, 0, HEAVY_WALK_ARM_SPEED)] },
      leftArm: { rotation: [0, 0, betweenAngles(left, 0, HEAVY_WALK_ARM_SPEED)] },
    },
  };
}

/** The rest pose in front of her overriding labor poses (an animation needs a channel per bone, so each is a zero). */
export function laborOverrideAnimation() {
  return {
    loop: true,
    override_previous_animation: true,
    bones: Object.fromEntries(LABOR_OVERRIDE_BONES.map((bone) => [bone, { rotation: [0, 0, 0], position: [0, 0, 0] }])),
  };
}
