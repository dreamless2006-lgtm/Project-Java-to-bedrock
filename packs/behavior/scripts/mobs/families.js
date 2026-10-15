// Per-family data of the preggo mobs, transcribed from the Java mod: the entity classes under
// world/entity/preggo/<species>/, PregnancySystemHelper (baby, fetus and milk items, birth
// durations), the item classes (nutrition, craving gratification) and MinepreggoConfig (hunger).
// Nothing here touches the game API.

import { CRAVING_ITEMS } from '../pregnancy/data.js';

/** @typedef {import('../pregnancy/data.js').Craving} Craving */
/** @typedef {'ZOMBIE' | 'CREEPER' | 'ENDER' | 'SLIME' | 'HUMAN'} MobSpecies */
/** @typedef {'HUMANOID' | 'MONSTER'} Creature */

/**
 * @typedef {object} Family
 * @property {MobSpecies} species
 * @property {Creature} creature
 * @property {string[]} tamingItems
 * @property {Record<string, number>} foods food items the tamed mob eats, with their nutrition
 * @property {Record<string, { craving: Craving, gratification: number }>} cravings
 * @property {string} babyItem
 * @property {string} deadFetusItem
 * @property {string} milkItem
 * @property {number} [hungerP0] ticks per fullness point in P0, when not the P1 value
 * @property {boolean} [external] a girl of another add-on (the Jenny Mod Java Port): her own taming, no hunger or savage state of ours
 */

/** PregnancySystemHelper.calculateBirthDuration / calculatePostBirthDuration, per baby (HUMAN: the player's values). */
const BIRTH_TICKS = { ZOMBIE: 300, CREEPER: 200, SLIME: 200, ENDER: 350, HUMAN: 250 };
const POST_BIRTH_TICKS = { ZOMBIE: 150, CREEPER: 100, SLIME: 100, ENDER: 200, HUMAN: 150 };

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

/** @param {Craving} craving @param {number} gratification */
const crave = (craving, gratification) => ({ craving, gratification });

const ENDER = {
  foods: {
    'minepreggo:ender_slime_jelly': 10,
    'minepreggo:refined_chorus_shards': 8,
    'minepreggo:ender_slime_jelly_with_chocolate': 14,
    'minepreggo:ender_slime_jelly_with_hot_sauce': 13,
    'minepreggo:ender_slime_jelly_with_salt': 11,
    'minepreggo:sour_ender_slime_jelly': 12,
    'minepreggo:chorus_fruit_with_chocolate': 8,
    'minepreggo:chorus_fruit_with_hot_sauce': 7,
    'minepreggo:sour_chorus_fruit': 6,
    'minepreggo:chorus_fruit_with_salt': 5,
    'minecraft:chorus_fruit': 4,
  },
  cravings: {
    'minepreggo:ender_slime_jelly_with_salt': crave('SALTY', 8),
    'minepreggo:ender_slime_jelly_with_chocolate': crave('SWEET', 14),
    'minepreggo:sour_ender_slime_jelly': crave('SOUR', 8),
    'minepreggo:ender_slime_jelly_with_hot_sauce': crave('SPICY', 12),
  },
};

const SLIME = {
  foods: {
    'minepreggo:rotten_flesh_with_chocolate': 4,
    'minepreggo:rotten_flesh_with_hot_sauce': 4,
    'minepreggo:rotten_flesh_with_salt': 4,
    'minepreggo:sour_rotten_flesh': 4,
    'minepreggo:spider_eye_with_chocolate': 4,
    'minepreggo:spider_eye_with_hot_sauce': 3,
    'minepreggo:spider_eye_with_salt': 3,
    'minepreggo:sour_spider_eye': 3,
    'minepreggo:stuffed_mushroom': 4,
    'minecraft:spider_eye': 2,
    'minecraft:rotten_flesh': 4,
  },
  cravings: {
    'minepreggo:rotten_flesh_with_salt': crave('SALTY', 8),
    'minepreggo:spider_eye_with_salt': crave('SALTY', 6),
    'minepreggo:rotten_flesh_with_chocolate': crave('SWEET', 12),
    'minepreggo:spider_eye_with_chocolate': crave('SWEET', 12),
    'minepreggo:sour_rotten_flesh': crave('SOUR', 8),
    'minepreggo:sour_spider_eye': crave('SOUR', 6),
    'minepreggo:rotten_flesh_with_hot_sauce': crave('SPICY', 10),
    'minepreggo:spider_eye_with_hot_sauce': crave('SPICY', 8),
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

/**
 * PregnancySystemHelper.CRAVING_ITEM: what satisfies a player's craving when she carries another
 * species (zombie babies want brains, creeper babies gunpowder, ender babies ender slime jelly,
 * slime babies rotten flesh and spider eyes). Humans and villagers use the human foods.
 * @type {Record<string, Record<string, { craving: Craving, gratification: number }>>}
 */
export const SPECIES_CRAVINGS = { ZOMBIE: BRAINS.cravings, CREEPER: GUNPOWDER.cravings, ENDER: ENDER.cravings, SLIME: SLIME.cravings };
/** Species foods and who can stomach them (Java: the items are only edible with the matching Full Of effect). */
export const SPECIES_FOODS = /** @type {Record<string, string>} */ ({});
for (const [species, table] of /** @type {[string, { foods: Record<string, number> }][]} */ ([['ZOMBIE', BRAINS], ['CREEPER', GUNPOWDER], ['ENDER', ENDER], ['SLIME', SLIME]])) {
  for (const item of Object.keys(table.foods)) if (item.startsWith('minepreggo:')) SPECIES_FOODS[item] = species;
}

/** Vanilla mobs that get a free female of the species pregnant by standing next to her (COURTING_TICKS). */
export const COURTERS = /** @type {Record<MobSpecies, string[]>} */ ({
  ZOMBIE: ['minecraft:zombie', 'minecraft:husk', 'minecraft:drowned', 'minecraft:zombie_villager', 'minecraft:zombie_villager_v2'],
  CREEPER: ['minecraft:creeper'],
  ENDER: ['minecraft:enderman'],
  SLIME: ['minecraft:slime'],
  HUMAN: [],
});

/** The human foods of the mod and plain vanilla meals, with their nutrition (the Jenny port's girls eat like the player). */
const HUMAN = {
  foods: {
    'minepreggo:candy_apple': 3,
    'minepreggo:chili_poppers': 5,
    'minepreggo:chocolate_bar': 3,
    'minepreggo:cucumber': 2,
    'minepreggo:french_fries': 4,
    'minepreggo:hot_chicken': 8,
    'minepreggo:lemon': 1,
    'minepreggo:lemon_drop': 2,
    'minepreggo:lemon_ice_cream': 3,
    'minepreggo:lemon_ice_popsicles': 3,
    'minepreggo:pickle': 2,
    'minepreggo:stuffed_mushroom': 4,
    'minepreggo:chili_pepper': 1,
    'minecraft:bread': 5,
    'minecraft:apple': 4,
    'minecraft:cooked_beef': 8,
    'minecraft:cooked_porkchop': 8,
    'minecraft:cooked_chicken': 6,
    'minecraft:baked_potato': 5,
    'minecraft:cookie': 2,
  },
  cravings: CRAVING_ITEMS,
  babyItem: 'minepreggo:baby_human',
  deadFetusItem: 'minepreggo:dead_human_fetus',
  milkItem: 'minepreggo:human_breast_milk_bottle',
};

/**
 * The Jenny Mod Java Port's girls (merged by tools/import-jenny.mjs): human women of another add-on.
 * Their own scenes get them pregnant (jenny/port.js); the pregnancy, belly, kicks and birth are ours.
 * @type {Record<string, Family>}
 */
export const PORT_GIRL_FAMILIES = Object.fromEntries(
  ['fapcraft:jenny', 'kum:bia', 'kum:slime_girl', 'kum:luna', 'kum:galath', 'jhallie4:allie', 'kum:manglelie', 'jhbee24:bee', 'jhkobold:kobold', 'jhelliedev:ellie'].map((id) => [
    id,
    // Her babies are her own (tools/import-jenny.mjs makes a baby item in her colours for each girl).
    /** @type {Family} */ ({ species: 'HUMAN', creature: 'HUMANOID', tamingItems: [], external: true, ...HUMAN, babyItem: `minepreggo:baby_${id.split(':')[1]}` }),
  ])
);
export const COURTING_TICKS = 60;
export const COURTING_RANGE = 2;

/** @type {Record<string, Family>} */
export const FAMILIES = {
  'minepreggo:zombie_girl': {
    species: 'ZOMBIE',
    creature: 'HUMANOID',
    tamingItems: ['minepreggo:villager_brain'],
    hungerP0: 8400,
    ...BRAINS,
    babyItem: 'minepreggo:baby_zombie',
    deadFetusItem: 'minepreggo:dead_zombie_fetus',
    milkItem: 'minepreggo:zombie_breast_milk_bottle',
  },
  'minepreggo:humanoid_creeper_girl': {
    species: 'CREEPER',
    creature: 'HUMANOID',
    tamingItems: ['minepreggo:activated_gunpowder'],
    ...GUNPOWDER,
    babyItem: 'minepreggo:baby_humanoid_creeper',
    deadFetusItem: 'minepreggo:dead_humanoid_creeper_fetus',
    milkItem: 'minepreggo:creeper_breast_milk_bottle',
  },
  'minepreggo:monster_creeper_girl': {
    species: 'CREEPER',
    creature: 'MONSTER',
    tamingItems: ['minepreggo:activated_gunpowder'],
    ...GUNPOWDER,
    babyItem: 'minepreggo:baby_creeper',
    deadFetusItem: 'minepreggo:dead_creeper_fetus',
    milkItem: 'minepreggo:creeper_breast_milk_bottle',
  },
  'minepreggo:ender_woman': {
    species: 'ENDER',
    creature: 'MONSTER',
    tamingItems: ['minepreggo:refined_chorus_shards', 'minepreggo:ender_slime_jelly'],
    ...ENDER,
    babyItem: 'minepreggo:baby_ender',
    deadFetusItem: 'minepreggo:dead_ender_fetus',
    milkItem: 'minepreggo:ender_breast_milk_bottle',
  },
  'minepreggo:humanoid_slime_girl': {
    species: 'SLIME',
    creature: 'HUMANOID',
    tamingItems: ['minepreggo:stuffed_mushroom'],
    ...SLIME,
    babyItem: 'minepreggo:baby_humanoid_slime',
    deadFetusItem: 'minepreggo:dead_humanoid_slime_fetus',
    milkItem: 'minepreggo:slime_breast_milk_bottle',
  },
  'minepreggo:monster_slime_girl': {
    species: 'SLIME',
    creature: 'MONSTER',
    tamingItems: ['minepreggo:stuffed_mushroom'],
    ...SLIME,
    babyItem: 'minepreggo:baby_slime',
    deadFetusItem: 'minepreggo:dead_slime_fetus',
    milkItem: 'minepreggo:slime_breast_milk_bottle',
  },
  ...PORT_GIRL_FAMILIES,
};

/** Tamed mobs: fullness points per meal are capped like Java's DataHungry (0-30, eats below 20). */
export const FULLNESS = { initial: 14, max: 30, eatBelow: 20, healAbove: 14, calmAt: 12, angryAt: 4 };

/**
 * Ticks for one point of fullness to drain: non-pregnant 8400 (config totalTicksOfHungry), then
 * 8400 x {0.85 ... 0.45} for P1-P9 (MinepreggoConfig.calculateHungryValues). P0 uses the P1 value
 * except for zombie girls (Family.hungerP0).
 */
export const HUNGER_TICKS = [8400, 7140, 7140, 6720, 6300, 5880, 5460, 5040, 4620, 4200, 3780];
/** @param {Family} family @param {number} phase -1 = not pregnant */
export const hungerTicks = (family, phase) => (phase === 0 && family.hungerP0 ? family.hungerP0 : HUNGER_TICKS[phase + 1]);

/** Per-phase speed (movement) and size live in the entity JSON (component groups minepreggo:phase_N). */
