// Player data of the pregnancy system (Java: PlayerDataImpl, FemalePlayerImpl,
// PlayerPregnancyDataImpl), persisted as JSON in player dynamic properties so it survives
// relogging and death.

import { CONFIG, MAX_LEVEL } from './data.js';
import { daysByPhase, finalPhaseForBabies } from './math.js';

/** @typedef {import('./math.js').Craving} Craving */
/** @typedef {import('./math.js').CommonPain} CommonPain */
/** @typedef {import('./math.js').Symptom} Symptom */
/** @typedef {CommonPain | 'MISCARRIAGE' | 'WATER_BREAKING' | 'PREBIRTH' | 'BIRTH' | 'POSTBIRTH'} Pain */
/** @typedef {'female' | 'male'} Gender */
/** @typedef {'custom' | 'alex' | 'steve'} Skin the player's own skin, or the mod's predefined Alex/Steve female skins (Java SkinType) */

/**
 * @typedef {object} PainInstance
 * @property {Pain} type
 * @property {number} duration ticks; -1 never expires
 * @property {number} severity 0-4
 * @property {number} elapsed
 */

/**
 * @typedef {object} BirthData
 * @property {import('./data.js').Species} baby species of the baby being pushed out
 * @property {number} pushLevel
 * @property {number} pushesPerLevel
 * @property {number} babiesBorn
 */

/**
 * @typedef {object} Pregnancy
 * @property {number} phase current phase 0-9
 * @property {number} lastPhase phase in which birth happens (4-9)
 * @property {number[]} daysByPhase
 * @property {number} daysPassed days passed in the current phase
 * @property {number} timer ticks into the current day
 * @property {number} health pregnancy health 0-100
 * @property {number} healthTimer
 * @property {import('./data.js').Species[]} womb babies still inside
 * @property {number} originalBabies
 * @property {import('./data.js').Species} father species of the father
 * @property {number} craving
 * @property {number} cravingTimer
 * @property {Craving | null} cravingType
 * @property {number} milking
 * @property {number} milkingTimer
 * @property {number} bellyRubs
 * @property {number} bellyRubsTimer
 * @property {Partial<Record<Symptom, number>>} symptoms active symptoms and their severity
 * @property {PainInstance | null} pain
 * @property {BirthData | null} birth
 * @property {number} postBirthTicks
 * @property {number} sprintTimer
 * @property {number} sneakTimer
 * @property {{ amplifier: number, endTime: number } | null} [acceleration] gradual pregnancy acceleration in effect
 */

/**
 * @typedef {object} FemaleData
 * @property {{ type: 'PARTUM' | 'MISCARRIAGE', timer: number } | null} post post-pregnancy recovery; blocks a new pregnancy
 * @property {{ level: number, timer: number, elapsed: number } | null} lactation post-partum lactation
 */

/**
 * @typedef {object} PendingImpregnation the 15 s Impregnation effect
 * @property {number} amplifier
 * @property {import('./data.js').Species} father
 * @property {number} endTime absolute world time (older saves count on it)
 * @property {number} [ticksLeft] game ticks left, counted by the tick loop (robust to a frozen daylight cycle)
 */

/**
 * @typedef {object} PotionEffects the mod's timed potion effects (potions.js), ticks left
 * @property {number} [resistance] Pregnancy Resistance: hits do no pregnancy damage
 * @property {number} [zeroGravity] Zero Gravity Belly: no phase slowdown, no extra fall damage
 * @property {{ ticks: number, amplifier: number }} [metabolism] Metabolism Control: saturation refills
 * @property {boolean} [eternal] Eternal Pregnancy: birth never comes, until milk
 */

const KEYS = {
  gender: 'minepreggo:gender',
  pregnancy: 'minepreggo:pregnancy',
  female: 'minepreggo:female',
  pending: 'minepreggo:pending_impregnation',
  skin: 'minepreggo:skin',
  effects: 'minepreggo:potion_effects',
};

/**
 * @param {import('@minecraft/server').Player} player
 * @param {string} key
 */
function readJson(player, key) {
  const raw = player.getDynamicProperty(key);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[minepreggo] discarding unreadable ${key} for ${player.name}`);
    return null;
  }
}

/**
 * @param {import('@minecraft/server').Player} player
 * @param {string} key
 * @param {unknown} value
 */
function writeJson(player, key, value) {
  player.setDynamicProperty(key, value == null ? undefined : JSON.stringify(value));
}

/** Everything the system keeps for one player: persisted data plus per-session counters. */
export class PlayerRecord {
  /** @param {import('@minecraft/server').Player} player */
  constructor(player) {
    this.player = player;
    const gender = player.getDynamicProperty(KEYS.gender);
    /** @type {Gender | undefined} */
    this.gender = gender === 'female' || gender === 'male' ? gender : undefined;
    const skin = player.getDynamicProperty(KEYS.skin);
    /** @type {Skin} */
    this.skin = skin === 'alex' || skin === 'steve' ? skin : 'custom';
    /** @type {Record<string, unknown>} entity property values last sent to the client (player/body.js) */
    this.sentVisuals = {};
    /** @type {Pregnancy | null} */
    this.pregnancy = readJson(player, KEYS.pregnancy);
    /** @type {FemaleData} */
    this.female = readJson(player, KEYS.female) ?? { post: null, lactation: null };
    /** @type {PendingImpregnation | null} */
    this.pending = readJson(player, KEYS.pending);
    /** @type {PotionEffects} */
    this.effects = readJson(player, KEYS.effects) ?? {};
    this.dirty = false;
    // Per-session cooldowns, like the fields of Java's per-player pregnancy system objects.
    this.cooldowns = { pain: 0, symptom: 0, exhaustion: 0, weakness: 0, growl: 0, hurt: 0, push: 0, move: 0 };
    this.bellyRubTicks = 0;
    this.pushes = { count: 0, lastPressTick: 0 };
    /** @type {{ x: number, z: number } | undefined} */
    this.lastPosition = undefined;
    this.moving = false;
    /** system.currentTick of the last pregnancy-pain damage, which must not hurt the pregnancy itself */
    this.selfHurtTick = -1;
    /** while in the future, the debug command owns the entity properties */
    this.debugUntil = 0;
    /** hits taken from each vanilla species since the last impregnation (attacks.js) */
    this.attacks = /** @type {Partial<Record<string, number>>} */ ({});
  }

  isFemale() {
    return this.gender === 'female';
  }

  /** @param {Gender} gender */
  setGender(gender) {
    this.gender = gender;
    this.player.setDynamicProperty(KEYS.gender, gender);
  }

  /** @param {Skin} skin */
  setSkin(skin) {
    this.skin = skin;
    this.player.setDynamicProperty(KEYS.skin, skin);
  }

  save() {
    writeJson(this.player, KEYS.pregnancy, this.pregnancy);
    writeJson(this.player, KEYS.female, this.female.post || this.female.lactation ? this.female : null);
    writeJson(this.player, KEYS.pending, this.pending);
    writeJson(this.player, KEYS.effects, Object.keys(this.effects).length ? this.effects : null);
    this.dirty = false;
  }
}

/**
 * PlayerHelper.tryToStartPregnancy: fresh pregnancy data for `babies` babies.
 * @param {number} babies
 * @param {import('./data.js').Species} father
 * @returns {Pregnancy}
 */
export function newPregnancy(babies, father) {
  const lastPhase = finalPhaseForBabies(babies);
  return {
    phase: 0,
    lastPhase,
    daysByPhase: daysByPhase(CONFIG.totalPregnancyDays, lastPhase),
    daysPassed: 0,
    timer: 0,
    health: 100,
    healthTimer: 0,
    womb: Array.from({ length: babies }, () => father),
    originalBabies: babies,
    father,
    craving: 0,
    cravingTimer: 0,
    cravingType: null,
    milking: 0,
    milkingTimer: 0,
    bellyRubs: 0,
    bellyRubsTimer: 0,
    symptoms: {},
    pain: null,
    birth: null,
    postBirthTicks: 0,
    sprintTimer: 0,
    sneakTimer: 0,
  };
}

/** Clamp helper for the 0-20 meters. */
export const clampLevel = (/** @type {number} */ n) => Math.min(MAX_LEVEL, Math.max(0, n));
