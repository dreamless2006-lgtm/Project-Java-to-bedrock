// Data the scripts keep for one preggo mob (Java: TamablePreggoMobDataImpl,
// TamablePregnantPreggoMobDataImpl, HostilePregnantPreggoMobDataImpl and the female entity data),
// persisted as JSON in the entity's dynamic property "minepreggo:mob".

import { FULLNESS } from './families.js';

/** @typedef {import('../pregnancy/state.js').Pregnancy} Pregnancy */

/**
 * @typedef {object} WildPregnancy naturally spawned hostile pregnant mob (HostilePregnantPreggoMobDataImpl)
 * @property {number} lastPhase
 * @property {number} babies
 * @property {number} totalDays days elapsed since P0 (used for death drops)
 * @property {number} painProbability chance that a hit incapacitates her
 * @property {number} cooldown ticks an incapacitation lasts
 * @property {number} painTimer
 * @property {boolean} incapacitated
 * @property {number} [kick] fetal movement intensity (0-2) shown while incapacitated by an inducement potion
 */

/**
 * @typedef {object} MobData
 * @property {number} fullness 0-30
 * @property {number} hungerTimer
 * @property {number} healTimer
 * @property {boolean} savage
 * @property {string | undefined} owner player id of the owner, recorded when she is tamed
 * @property {Pregnancy | null} pregnancy tamed (or wild-but-tamable) pregnancy, same shape as the player's
 * @property {WildPregnancy | null} wild
 * @property {{ type: 'PARTUM' | 'MISCARRIAGE', timer: number } | null} post
 * @property {{ level: number, timer: number, elapsed: number } | null} lactation
 * @property {{ endTick: number, amplifier: number } | null} pending pending impregnation from a potion
 * @property {number} moveTimer ticks walked since the last back pain (P4+)
 * @property {number} hurtCooldown pregnancy pain damage cooldown
 * @property {number} courting ticks a vanilla counterpart has been next to her
 */

const KEY = 'minepreggo:mob';

/** @returns {MobData} */
export function newMobData() {
  return {
    fullness: FULLNESS.initial,
    hungerTimer: 0,
    healTimer: 0,
    savage: false,
    owner: undefined,
    pregnancy: null,
    wild: null,
    post: null,
    lactation: null,
    pending: null,
    moveTimer: 0,
    hurtCooldown: 0,
    courting: 0,
  };
}

/** One loaded mob: its persisted data plus what was last sent to clients. */
export class MobRecord {
  /** @param {import('@minecraft/server').Entity} entity */
  constructor(entity) {
    this.entity = entity;
    /** @type {MobData} */
    this.data = { ...newMobData(), ...read(entity) };
    this.dirty = false;
    /** @type {{ pose?: string, kick?: number, growth?: number }} values last written to entity properties */
    this.sent = {};
    /** @type {{ x: number, z: number } | undefined} */
    this.lastPosition = undefined;
    this.moving = false;
    /** system.currentTick of the last pregnancy-pain damage, which must not hurt the pregnancy itself */
    this.selfHurtTick = -1;
    /** while in the future, the debug command owns the client properties */
    this.debugUntil = 0;
  }

  save() {
    this.entity.setDynamicProperty(KEY, JSON.stringify(this.data));
    this.dirty = false;
  }
}

/** @param {import('@minecraft/server').Entity} entity @returns {Partial<MobData>} */
function read(entity) {
  const raw = entity.getDynamicProperty(KEY);
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[minepreggo] discarding unreadable mob data of ${entity.typeId}`);
    return {};
  }
}
