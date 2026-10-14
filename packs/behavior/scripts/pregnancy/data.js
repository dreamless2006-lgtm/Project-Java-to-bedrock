// Tables and tuning values of the player pregnancy system, transcribed from the Java mod:
// world/pregnancy/PregnancyPhaseConfigs, PregnancySystemHelper, PregnancyPhaseMap,
// world/entity/player/PlayerHelper and the defaults in config/MinepreggoConfig.
// Nothing here touches the game API, so it can be unit tested in Node.

export const MAX_PHASE = 9;
export const MAX_LEVEL = 20; // craving / milking / belly rubs meters

/** Server config defaults (MinepreggoConfig.Server). */
export const CONFIG = {
  totalPregnancyDays: 50,
  ticksPerPregnancyDay: 24000,
  ticksOfPostPregnancyPhase: 12000,
  ticksOfPostPartumLactation: 24000,
  postBirthLactationCooldown: 1200,
  pregnancyHungryCooldown: 20,
  ticksForPregnancyHealing: 6000,
  pregnancyHealingAmount: 25,
  pregnancyHealingReductionPerPhase: 0.05,
  ticksOfCravingP1: 4800,
  ticksOfMilkingP2: 3600,
  ticksOfBellyRubsP3: 3600,
};

/**
 * @typedef {object} PhaseConfig
 * @property {number} morningSicknessProb
 * @property {number} morningSicknessTicks
 * @property {number} exhaustion
 * @property {number} fetalMovementProb
 * @property {number} fetalMovementTicks
 * @property {number} randomWeaknessTicks
 * @property {number} preBirthTicks
 * @property {number} contractionProb
 * @property {number} contractionTicks
 * @property {number} backPainTicks
 */

/** @type {PhaseConfig} PregnancyPhaseConfig.Builder defaults */
const DEFAULT_PHASE = {
  morningSicknessProb: 0.001,
  morningSicknessTicks: 1200,
  exhaustion: 0.01,
  fetalMovementProb: 0.0015,
  fetalMovementTicks: 1200,
  randomWeaknessTicks: 3600,
  preBirthTicks: 600,
  contractionProb: 0.0025,
  contractionTicks: 1800,
  backPainTicks: 2400,
};

/** @type {PhaseConfig[]} PregnancyPhaseConfigs.P0 ... P9 */
export const PHASES = [
  {},
  { morningSicknessProb: 0.002, morningSicknessTicks: 1680, exhaustion: 0.05 },
  { morningSicknessProb: 0.0015, morningSicknessTicks: 1560, exhaustion: 0.1 },
  { fetalMovementProb: 0.0015, fetalMovementTicks: 1200, randomWeaknessTicks: 4100, morningSicknessProb: 0.001, exhaustion: 0.2 },
  { morningSicknessProb: 0.0008, preBirthTicks: 600, fetalMovementProb: 0.00275, fetalMovementTicks: 1400, randomWeaknessTicks: 4000, exhaustion: 0.3 },
  { morningSicknessProb: 0.0007, preBirthTicks: 800, fetalMovementTicks: 1600, randomWeaknessTicks: 3900, fetalMovementProb: 0.002875, exhaustion: 0.4 },
  { morningSicknessProb: 0.0006, preBirthTicks: 900, fetalMovementTicks: 1800, fetalMovementProb: 0.003125, randomWeaknessTicks: 3800, exhaustion: 0.5, backPainTicks: 2880 },
  { morningSicknessProb: 0.0005, preBirthTicks: 1000, fetalMovementTicks: 2000, randomWeaknessTicks: 3700, fetalMovementProb: 0.00325, exhaustion: 0.6, backPainTicks: 3360 },
  { morningSicknessProb: 0.0004, preBirthTicks: 1100, fetalMovementTicks: 2200, randomWeaknessTicks: 3600, fetalMovementProb: 0.003375, exhaustion: 0.7, backPainTicks: 3840 },
  { morningSicknessProb: 0.0003, preBirthTicks: 1200, fetalMovementTicks: 2200, randomWeaknessTicks: 3500, fetalMovementProb: 0.0035, exhaustion: 0.8, backPainTicks: 4320 },
].map((overrides) => ({ ...DEFAULT_PHASE, ...overrides }));

// MinepreggoConfig.calculate*Values: later phases scale the P1/P2/P3 timers down.
const f = Math.fround;
/** @param {number} base @param {number[]} factors first entry belongs to the base phase */
const scaled = (base, factors) => factors.map((k) => Math.ceil(f(base * f(k))));
/** Ticks for the meter to grow by one, per phase (undefined = meter not active yet). */
export const CRAVING_TICKS = [undefined, ...scaled(CONFIG.ticksOfCravingP1, [1, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55])];
export const MILKING_TICKS = [undefined, undefined, ...scaled(CONFIG.ticksOfMilkingP2, [1, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45])];
export const BELLY_RUBS_TICKS = [undefined, undefined, undefined, ...scaled(CONFIG.ticksOfBellyRubsP3, [1, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45])];

/** PlayerHelper.SPRINTING_TIMERS / SNEAKING_TIMERS: ticks of sprinting/sneaking before nausea. */
export const SPRINT_FATIGUE_TICKS = [undefined, undefined, undefined, 7200, 6800, 5400, 4800, 4200, 3800, 3200];
export const SNEAK_FATIGUE_TICKS = [undefined, undefined, undefined, undefined, 5800, 5000, 4200, 3600, 2800, 2400];

/**
 * Bedrock slowness amplifier per phase. Java stacks a Slowness effect with an extra -15 % speed
 * modifier on some phases; this is the Bedrock amplifier closest to the combined Java speed.
 */
export const PHASE_SLOWNESS = [-1, -1, 0, 1, 1, 2, 2, 3, 4, 4];

/** PregnancyPhaseMap.PREGNANCY_PHASES_WEIGHTS: share of the total days spent in each phase. */
export const PHASE_DAY_WEIGHTS = {
  4: [0.05, 0.2, 0.2, 0.25, 0.3],
  5: [0.05, 0.1, 0.2, 0.2, 0.2, 0.25],
  6: [0.05, 0.1, 0.1, 0.1, 0.2, 0.2, 0.25],
  7: [0.05, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15, 0.2],
  8: [0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15],
  9: [0.05, 0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15],
};

/** PregnancySystemHelper.PHASE_TO_BABY_COUNT_MAP, keyed by final phase. */
export const BABIES_BY_FINAL_PHASE = { 4: [1], 5: [2, 3], 6: [4, 5], 7: [6, 7], 8: [8, 9], 9: [10] };
export const MAX_BABIES = 10;

/** @typedef {'SWEET' | 'SOUR' | 'SPICY' | 'SALTY'} Craving */
/** PregnancySystemHelper.CRAVING_WEIGHTS, in Java's iteration order. */
/** @type {[Craving, number][]} */
export const CRAVING_WEIGHTS = [['SWEET', 0.075], ['SOUR', 0.275], ['SPICY', 0.3], ['SALTY', 0.35]];
/** @type {Record<Craving, string>} */
export const CRAVING_LANG = {
  SWEET: 'craving.minepreggo.type.sweet',
  SOUR: 'craving.minepreggo.type.sour',
  SALTY: 'craving.minepreggo.type.salty',
  SPICY: 'craving.minepreggo.type.spicy',
};

/**
 * ICravingItem implementations (human foods). Gratification is how much one item lowers the
 * craving meter when it matches the current craving.
 * @type {Record<string, { craving: Craving, gratification: number }>}
 */
export const CRAVING_ITEMS = {
  'minepreggo:lemon_ice_cream': { craving: 'SOUR', gratification: 6 },
  'minepreggo:lemon_ice_popsicles': { craving: 'SOUR', gratification: 5 },
  'minepreggo:lemon_drop': { craving: 'SOUR', gratification: 4 },
  'minepreggo:chocolate_bar': { craving: 'SWEET', gratification: 14 },
  'minepreggo:candy_apple': { craving: 'SWEET', gratification: 8 },
  'minepreggo:hot_chicken': { craving: 'SPICY', gratification: 12 },
  'minepreggo:chili_poppers': { craving: 'SPICY', gratification: 5 },
  'minepreggo:pickle': { craving: 'SALTY', gratification: 7 },
  'minepreggo:french_fries': { craving: 'SALTY', gratification: 6 },
};

/** @typedef {'HUMAN' | 'ZOMBIE' | 'CREEPER' | 'ENDER' | 'SLIME' | 'VILLAGER'} Species species that can father a player's pregnancy (Java Species; DRAGON not ported) */
/**
 * Per-species birth data (PregnancySystemHelper.calculatePostBirthDuration, the baby and fetus
 * items of a humanoid-creature litter, and the "Full Of ..." effect the mother gets in Java).
 * @type {Record<Species, { babyItem: string, deadBabyItem: string, milkItem: string, postBirthTicks: number, pushesPerLevel: number, effect: string | null }>}
 */
export const SPECIES = {
  HUMAN: { babyItem: 'minepreggo:baby_human', deadBabyItem: 'minepreggo:dead_human_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 150, pushesPerLevel: 28, effect: null },
  ZOMBIE: { babyItem: 'minepreggo:baby_zombie', deadBabyItem: 'minepreggo:dead_zombie_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 150, pushesPerLevel: 28, effect: 'FULL_OF_ZOMBIES' },
  CREEPER: { babyItem: 'minepreggo:baby_humanoid_creeper', deadBabyItem: 'minepreggo:dead_humanoid_creeper_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 100, pushesPerLevel: 28, effect: 'FULL_OF_CREEPERS' },
  ENDER: { babyItem: 'minepreggo:baby_humanoid_ender', deadBabyItem: 'minepreggo:dead_humanoid_ender_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 200, pushesPerLevel: 28, effect: 'FULL_OF_ENDERS' },
  SLIME: { babyItem: 'minepreggo:baby_humanoid_slime', deadBabyItem: 'minepreggo:dead_humanoid_slime_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 100, pushesPerLevel: 28, effect: 'FULL_OF_SLIMES' },
  VILLAGER: { babyItem: 'minepreggo:baby_villager', deadBabyItem: 'minepreggo:dead_villager_fetus', milkItem: 'minepreggo:human_breast_milk_bottle', postBirthTicks: 150, pushesPerLevel: 28, effect: null },
};
/** Species a potion can name, by the "species" parameter of minepreggo:impregnation_potion. */
export const POTION_SPECIES = /** @type {Species[]} */ (['HUMAN', 'ZOMBIE', 'CREEPER', 'ENDER', 'SLIME', 'VILLAGER']);

/** BirthData default: push levels needed per baby. */
export const PUSH_LEVELS_PER_BABY = 4;
/** Java PulseTracker window: a push press is forgotten after this many ticks without pressing. */
export const PUSH_WINDOW_TICKS = 20;

/** Durations used when labor/miscarriage starts (AbstractPlayerPregnancySystem and P1/P4 systems). */
export const TICKS = {
  waterBreaking: 1200,
  miscarriage: 800,
  rehabilitation: CONFIG.ticksOfPostPregnancyPhase,
  weaknessAfterBirth: 3600,
  weaknessAfterMiscarriage: 4800,
  randomWeakness: 1200,
  nausea: 260,
  spicyContraction: 1800,
  spicyFetalMovement: 1200,
  bellyRubCycle: 120,
};
