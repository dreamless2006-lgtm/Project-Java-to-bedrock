// The walk jiggle: a body's chest, belly and butt bounce with her steps, a little behind them, and
// sway from side to side with her stride, so walking reads on every female body (the springs of
// animation.minepreggo.jiggle settle her afterwards on the bodies that have them). Expression-only,
// driven by how far and how fast she moves (still: nothing), additive to every other animation.

/** Degrees of the stride per block walked (vanilla's limb swing): a bounce on every step is twice that. */
const STRIDE = 38.17;

/**
 * @typedef {object} JiggleBones the bones of one rig that bounce (any may be empty)
 * @property {string[]} [chest] the chest root(s): bounce and pitch with each step
 * @property {string[]} [breasts] the left and right breast: sway apart with the stride
 * @property {string[]} [belly] the belly root(s): a heavier, slower bounce
 * @property {string[]} [butt] the left and right buttock: lift in turn with the legs
 * @property {string[]} [buttRoot] a single butt bone: rolls with the stride
 */

/**
 * The walk-jiggle animation for one rig.
 * @param {JiggleBones} bones
 * @param {{ owner?: boolean, strength?: number, step?: number }} [options] owner: the walk of the owning
 *   entity, read into variables by OWNER_WALK_LINES (an attachable); strength: scales every amount;
 *   step: degrees of the bounce per unit walked, one bounce a step (vanilla's 2 x STRIDE, for a rig
 *   whose own walk takes longer or shorter steps); the side sway takes half of it
 */
export function walkJiggleAnimation(bones, { owner = false, strength = 1, step: perUnit = 2 * STRIDE } = {}) {
  const moving = `math.min(1.0, ${owner ? 'v.owner_move_speed' : 'q.modified_move_speed'} * 2.5)`;
  const d = owner ? 'v.owner_distance_moved' : 'q.modified_distance_moved';
  // the bounce lags the step by a few degrees, so the soft parts follow the body
  const step = (/** @type {number} */ lag) => `math.sin(${d} * ${perUnit.toFixed(2)} - ${lag.toFixed(1)})`;
  const side = (/** @type {number} */ lag) => `math.sin(${d} * ${(perUnit / 2).toFixed(2)} - ${lag.toFixed(1)})`;
  const k = (/** @type {number} */ amount) => (amount * strength).toFixed(2);
  /** @type {Record<string, any>} */
  const out = {};
  for (const bone of bones.chest ?? []) {
    out[bone] = { position: [0, `${k(0.35)} * ${moving} * ${step(40)}`, 0], rotation: [`${k(-4.0)} * ${moving} * ${step(70)}`, 0, 0] };
  }
  (bones.breasts ?? []).forEach((bone, i) => {
    const sign = i === 0 ? 1 : -1;
    out[bone] = { rotation: [`${k(-2.5)} * ${moving} * ${step(90)}`, 0, `${k(3.0 * sign)} * ${moving} * ${side(60)}`] };
  });
  for (const bone of bones.belly ?? []) {
    out[bone] = { position: [0, `${k(0.22)} * ${moving} * ${step(60)}`, 0], rotation: [`${k(1.8)} * ${moving} * ${step(90)}`, 0, `${k(1.5)} * ${moving} * ${side(50)}`] };
  }
  (bones.butt ?? []).forEach((bone, i) => {
    const sign = i === 0 ? 1 : -1;
    out[bone] = { rotation: [`${k(4.0 * sign)} * ${moving} * ${side(30)}`, 0, 0], position: [0, `${k(0.15)} * ${moving} * ${step(50)}`, 0] };
  });
  for (const bone of bones.buttRoot ?? []) {
    out[bone] = { rotation: [0, 0, `${k(3.0)} * ${moving} * ${side(30)}`], position: [0, `${k(0.15)} * ${moving} * ${step(50)}`, 0] };
  }
  return { loop: true, bones: out };
}

/** An attachable's pre_animation lines: its owner's walk, for walkJiggleAnimation(bones, { owner: true }). */
export const OWNER_WALK_LINES = ['v.owner_move_speed = c.owning_entity->q.modified_move_speed;', 'v.owner_distance_moved = c.owning_entity->q.modified_distance_moved;'];

/** The bones of this pack's female bodies (the player, the mod's females, the MCA women). */
export const MINEPREGGO_JIGGLE_BONES = /** @type {JiggleBones} */ ({ chest: ['boobs'], breasts: ['left_boob', 'right_boob'], belly: ['belly'], butt: ['left_butt', 'right_butt'] });
/** The Jenny Mod Java Port's rigs (and our belly hung under them). */
export const JENNY_JIGGLE_BONES = /** @type {JiggleBones} */ ({ chest: ['boobs'], breasts: ['boobL', 'boobR'], belly: ['belly'], buttRoot: ['booty'] });
