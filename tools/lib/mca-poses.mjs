// The pose animations of Minecraft Comes Alive's women (tools/import-mca.mjs). She is drawn like
// this pack's female player: the vanilla humanoid (geometry.humanoid.custom, her head and arms
// under her body, her legs under the root) with the player's chest and belly bodies on top, so she
// plays the player's own pose animations where the player has them. The ones the player plays on
// the humanoid (back pain, rubbing her belly, the heavy walk) she plays on it too; the mod's labor
// animations are written for its flat Java models (every part top-level, each placed by its own
// position), so for them she is drawn, like the player in labor, with the player's flat labor model
// (geometry.minepreggo.player_labor: the same parts and skin layout, all top-level). The poses the
// player has no animation for are made here for that flat model:
//   * morning sickness, sitting down with the babies kicking, and riding: the mod's own animations
//     of the humanoid creeper girl (a flat humanoid of the vanilla proportions), her limbs renamed;
//   * a contraction (and the incapacitation of a wild pregnant mob), the two scene poses and
//     sitting down when she is told to: the poses authored in tools/lib/scene-poses.mjs, solved
//     onto the flat model as the Jenny port's girls and our own females get them. On the floor a
//     big belly would go through it (on all fours on the Jenny Bed above all), so in those her
//     belly turns up along her trunk as far as each size needs (bellyLift), as the Jenny girls'
//     bellies lie forward along their trunks in their births on all fours.
import { AUTHORED, AUTHORED_LABOR, LEGS, NEUTRAL_RIG } from './scene-poses.mjs';
import { cubeFaces, poseAt } from './geo-render.mjs';
import { animationSource, keyTimes, rigOf, solveAnimation } from './pose-solve.mjs';

/** The flat model's limbs by the names the mod's rigs and the authored poses give them. */
export const LIMB_NAMES = /** @type {Record<string, string>} */ ({ right_arm: 'rightArm', left_arm: 'leftArm', right_leg: 'rightLeg', left_leg: 'leftLeg' });

/** Her poses taken from the humanoid creeper girl's own animations (pose -> her animation's short name). */
export const CREEPER_POSES = { morning_sickness: 'morning_sickness', kicking_sit: 'kicking_sit', riding: 'riding' };

/**
 * Her poses solved from the authored ones; `sit` is the belly scenes' sitting back on her hands
 * with her head left free, so she looks about as she sits (vanilla's look-at plays on top of it).
 * `planted`: her pelvis stays where it is (the authored contraction lowers it to bend the knees
 * of the Jenny girls' rigs; her legs are one piece, so it would sink her feet into the floor).
 * `floor`: a pose on the floor, whose belly is lifted off it (bellyLift) down to this height: on
 * all fours barely into the bed under her, sitting resting on the floor and her thighs.
 */
export const SOLVED_POSES = /** @type {Record<string, { authored: any, step: number, headFree?: boolean, planted?: boolean, floor?: number }>} */ ({
  contraction: { authored: AUTHORED_LABOR.contraction, step: 0.2, planted: true },
  scene: { authored: AUTHORED.scene, step: 0.13, floor: -1 },
  scene_sit: { authored: AUTHORED.scene_sit, step: 0.13, floor: -1.5 },
  sit: { authored: AUTHORED.scene_sit, step: 0.13, headFree: true, floor: -1.5 },
});

/** How much the belly controller may still grow her belly (belly_growth at full growth, the inflation's breath). */
const GROWN = (/** @type {number} */ phase) => {
  const g = phase <= 2 ? 1.0 : phase <= 4 ? 0.9 : phase === 5 ? 0.8 : phase <= 7 ? 0.7 : 0.6;
  return [(1 + 0.15 * g) * 1.015, 1 + 0.05 * g, (1 + 0.4 * g) * 1.075];
};

/**
 * Her belly's turn in a floor pose, for each belly size: the smallest turn up along her trunk
 * (toward her chest, about the belly's pivot, in steps of 3 degrees up to 90) that keeps all of
 * it above `floor` at every moment of the pose, fully grown. As a Molang channel picked by v.bp
 * (one value per size, no keyframes), or undefined when no size needs one.
 * @param {any} animation a solved pose on the flat model
 * @param {{ bones: any[] }[]} bodies her belly body of each size (0..9)
 * @param {number} [floor] how low its lowest point may reach (model units; the floor is 0)
 */
export function bellyLift(animation, bodies, floor = -0.25) {
  const length = Number(animation.animation_length ?? 0);
  const times = [...new Set([...keyTimes(animation), ...Array.from({ length: 9 }, (_, k) => (length * k) / 8)])];
  const lowest = (/** @type {{ bones: any[] }} */ body, /** @type {number} */ phase, /** @type {number} */ angle) => {
    // the belly and what hangs from it, the rest of the body without cubes
    const inBelly = new Set(['belly']);
    for (const b of body.bones) if (b.parent && inBelly.has(b.parent)) inBelly.add(b.name);
    const belly = { bones: body.bones.map((b) => (inBelly.has(b.name) ? b : { ...b, cubes: [] })) };
    let low = Infinity;
    for (const t of times) {
      const pose = poseAt(animation, t);
      pose.belly = { rotation: [angle, 0, 0], scale: GROWN(phase) };
      for (const face of cubeFaces(belly, pose)) for (const c of face.corners) low = Math.min(low, c[1]);
    }
    return low;
  };
  const turns = bodies.map((body, phase) => {
    if (!body.bones.some((b) => b.name === 'belly') || lowest(body, phase, 0) >= floor) return 0;
    for (let angle = -3; angle >= -90; angle -= 3) if (lowest(body, phase, angle) >= floor) return angle;
    return -90;
  });
  if (turns.every((a) => a === 0)) return undefined;
  let expr = '0.0';
  for (let p = turns.length - 1; p >= 0; p--) if (turns[p]) expr = `(v.bp == ${p} ? ${turns[p].toFixed(1)} : ${expr})`;
  return { rotation: [expr, 0, 0], turns };
}

/**
 * A flat-rig animation of the mod's with the vanilla humanoid's limb names (its belly, chest and
 * kick channels keep theirs: they are the player bodies' bones too).
 * @param {{ bones?: Record<string, any> }} animation
 */
export function renameLimbs(animation) {
  return { ...animation, bones: Object.fromEntries(Object.entries(animation.bones ?? {}).map(([bone, channels]) => [LIMB_NAMES[bone] ?? bone, channels])) };
}

/**
 * Every pose animation of hers made here, by pose: the creeper girl's renamed and the authored
 * ones solved onto the flat model.
 * @param {object} options
 * @param {{ bones: any[] }} options.flat the player's flat labor model
 * @param {{ bones: any[] }} options.creeperGeometry the humanoid creeper girl's model
 * @param {Record<string, any>} options.creeperAnimations her animations by short name (morning_sickness, ...)
 * @param {{ bones: any[] }[]} options.bodies her belly body of each size (0..9), for the floor poses
 * @returns {Record<string, any>}
 */
export function mcaPoseAnimations({ flat, creeperGeometry, creeperAnimations, bodies }) {
  const pivotOf = (/** @type {{ bones: any[] }} */ g, /** @type {string} */ name) => g.bones.find((b) => b.name === name)?.pivot;
  // the creeper girl's animations move her parts about their pivots and place them by position, so
  // they carry over unchanged only onto parts at the same pivots
  for (const name of ['body', 'head', ...Object.keys(LIMB_NAMES)]) {
    const mine = pivotOf(flat, LIMB_NAMES[name] ?? name), hers = pivotOf(creeperGeometry, name);
    if (!mine || !hers || mine.some((/** @type {number} */ v, /** @type {number} */ k) => Math.abs(v - hers[k]) > 1e-6)) throw new Error(`MCA: the creeper girl's ${name} is not at the flat model's pivot`);
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [pose, source] of Object.entries(CREEPER_POSES)) {
    const animation = creeperAnimations[source];
    if (!animation) throw new Error(`MCA: the humanoid creeper girl has no ${source} animation`);
    out[pose] = renameLimbs(animation);
  }
  const rig = rigOf(flat);
  const target = {
    rig, neutral: {}, map: { body: 'body', head: 'head', ...LIMB_NAMES }, pelvis: LEGS.map((n) => LIMB_NAMES[n]), trunk: 'body',
    scale: (Number(pivotOf(flat, 'rightLeg')?.[1] ?? 12) + Number(pivotOf(flat, 'leftLeg')?.[1] ?? 12)) / 24, absolute: true,
  };
  for (const [pose, { authored, step, headFree, planted, floor }] of Object.entries(SOLVED_POSES)) {
    const solved = solveAnimation(animationSource(NEUTRAL_RIG, authored, { pelvis: LEGS, trunk: 'body' }), planted ? { ...target, scale: 0 } : target, { length: authored.animation_length, loop: true, times: keyTimes(authored), step });
    const lift = floor !== undefined ? bellyLift(solved, bodies, floor) : undefined;
    if (lift) solved.bones.belly = { rotation: lift.rotation };
    if (headFree) {
      // the head keeps its place on her leaning trunk but not its turn, and nothing before it is
      // overridden (the look-at before it turns her head)
      delete solved.bones.head?.rotation;
      delete solved.override_previous_animation;
    }
    out[pose] = solved;
  }
  return out;
}
