// Per-family data of the preggo mobs, transcribed from the Java mod: the entity classes under
// world/entity/preggo/<species>/, PregnancySystemHelper (baby, fetus and milk items, birth
// durations), the item classes (nutrition, craving gratification) and MinepreggoConfig (hunger).
// Nothing here touches the game API.

/** @typedef {import('../pregnancy/data.js').Craving} Craving */
/** @typedef {'ZOMBIE' | 'CREEPER' | 'ENDER' | 'SLIME'} MobSpecies */
/** @typedef {'HUMANOID' | 'MONSTER'} Creature */

/**
 * @typedef {object} Family
 * @property {MobSpecies} species
 * @property {Creature} creature
 * @property {string} tamingItem
 * @property {Record<string, number>} foods food items the tamed mob eats, with their nutrition
 * @property {Record<string, { craving: Craving, gratification: number }>} cravings
 * @property {string} babyItem
 * @property {string} deadFetusItem
 * @property {string} milkItem
 */

/** PregnancySystemHelper.calculateBirthDuration / calculatePostBirthDuration, per baby. */
const BIRTH_TICKS = { ZOMBIE: 300, CREEPER: 200, SLIME: 200, ENDER: 350 };
const POST_BIRTH_TICKS = { ZOMBIE: 150, CREEPER: 100, SLIME: 100, ENDER: 200 };

/** Ticks one baby takes to be born: 200 + species + 100 for monster creatures. */
export const birthTicks = (/** @type {Family} */ family) => 200 + BIRTH_TICKS[family.species] + (family.creature === 'MONSTER' ? 100 : 0);
/** Ticks of the POSTBIRTH stage per baby. */
export const postBirthTicks = (/** @type {Family} */ family) => POST_BIRTH_TICKS[family.species];

const BRAINS = {
  foods: {
    'minepreggo:villager_brain': 12,
    'minepreggo:illager_brain': 8,
    'minepreggo:witch_brain': 10,
    'minepreggo:brain_with_chocolate': 16,
    'minepreggo:brain_with_salt': 13,
    'minepreggo:brain_with_hot_sauce': 15,
    'minepreggo:sour_brain': 14,
  },
  cravings: {
    'minepreggo:brain_with_chocolate': { craving: /** @type {Craving} */ ('SWEET'), gratification: 16 },
    'minepreggo:brain_with_salt': { craving: /** @type {Craving} */ ('SALTY'), gratification: 7 },
    'minepreggo:brain_with_hot_sauce': { craving: /** @type {Craving} */ ('SPICY'), gratification: 9 },
    'minepreggo:sour_brain': { craving: /** @type {Craving} */ ('SOUR'), gratification: 6 },
  },
};

const GUNPOWDER = {
  foods: {
    'minepreggo:activated_gunpowder': 8,
    'minepreggo:activated_gunpowder_with_chocolate': 12,
    'minepreggo:activated_gunpowder_with_salt': 9,
    'minepreggo:activated_gunpowder_with_hot_sauce': 11,
    'minepreggo:sour_activated_gunpowder': 10,
  },
  cravings: {
    'minepreggo:activated_gunpowder_with_chocolate': { craving: /** @type {Craving} */ ('SWEET'), gratification: 12 },
    'minepreggo:activated_gunpowder_with_salt': { craving: /** @type {Craving} */ ('SALTY'), gratification: 6 },
    'minepreggo:activated_gunpowder_with_hot_sauce': { craving: /** @type {Craving} */ ('SPICY'), gratification: 8 },
    'minepreggo:sour_activated_gunpowder': { craving: /** @type {Craving} */ ('SOUR'), gratification: 4 },
  },
};

/** @type {Record<string, Family>} */
export const FAMILIES = {
  'minepreggo:zombie_girl': {
    species: 'ZOMBIE',
    creature: 'HUMANOID',
    tamingItem: 'minepreggo:villager_brain',
    ...BRAINS,
    babyItem: 'minepreggo:baby_zombie',
    deadFetusItem: 'minepreggo:dead_zombie_fetus',
    milkItem: 'minepreggo:zombie_breast_milk_bottle',
  },
  'minepreggo:humanoid_creeper_girl': {
    species: 'CREEPER',
    creature: 'HUMANOID',
    tamingItem: 'minepreggo:activated_gunpowder',
    ...GUNPOWDER,
    babyItem: 'minepreggo:baby_humanoid_creeper',
    deadFetusItem: 'minepreggo:dead_humanoid_creeper_fetus',
    milkItem: 'minepreggo:creeper_breast_milk_bottle',
  },
  'minepreggo:monster_creeper_girl': {
    species: 'CREEPER',
    creature: 'MONSTER',
    tamingItem: 'minepreggo:activated_gunpowder',
    ...GUNPOWDER,
    babyItem: 'minepreggo:baby_creeper',
    deadFetusItem: 'minepreggo:dead_creeper_fetus',
    milkItem: 'minepreggo:creeper_breast_milk_bottle',
  },
};

/** Tamed mobs: fullness points per meal are capped like Java's DataHungry (0-30, eats below 20). */
export const FULLNESS = { initial: 14, max: 30, eatBelow: 20, healAbove: 14, calmAt: 12, angryAt: 4 };

/**
 * Ticks for one point of fullness to drain: non-pregnant 8400 (config totalTicksOfHungry), P0
 * like non-pregnant, then 8400 x {0.85 ... 0.45} for P1-P9 (MinepreggoConfig.calculateHungryValues).
 */
export const HUNGER_TICKS = [8400, 8400, 7140, 6720, 6300, 5880, 5460, 5040, 4620, 4200, 3780];
/** Index into HUNGER_TICKS for a phase (-1 = not pregnant). */
export const hungerTicks = (/** @type {number} */ phase) => HUNGER_TICKS[phase + 1];

/** Per-phase speed (movement) and size live in the entity JSON (component groups minepreggo:phase_N). */
