// Port of the player pregnancy engine: AbstractPregnancySystem, AbstractPlayerPregnancySystem,
// PlayerPregnancySystemP0-P9 and FemalePlayerSystem. Java runs one system object per phase that
// inherits the behaviour of earlier phases; here each tick checks the phase instead.
// Custom Java mob effects become state plus vanilla effects (see effects.js).

import { system, world, EntityDamageCause, EquipmentSlot, GameMode, ItemStack } from '@minecraft/server';
import {
  BELLY_RUBS_TICKS,
  CONFIG,
  CRAVING_TICKS,
  MAX_LEVEL,
  MILKING_TICKS,
  PHASES,
  PUSH_LEVELS_PER_BABY,
  SNEAK_FATIGUE_TICKS,
  SPECIES,
  SPRINT_FATIGUE_TICKS,
  TICKS,
} from './data.js';
import { accelerationDays, advancePhases, babiesFromPotion, createCommonPain, gradualAccelerationSpeed, randomCraving, symptomSeverity } from './math.js';
import { PlayerRecord, clampLevel, newPregnancy } from './state.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('./state.js').Pregnancy} Pregnancy */
/** @typedef {import('./state.js').Pain} Pain */
/** @typedef {import('./math.js').CommonPain} CommonPain */
/** @typedef {import('./math.js').PainCause} PainCause */
/** @typedef {import('./math.js').Symptom} Symptom */

const COMMON_PAINS = new Set(['MORNING_SICKNESS', 'FETAL_MOVEMENT', 'CONTRACTION', 'BACK_PAIN']);
// Java PregnancyPain.Type.LABOR; isInLabor() below leaves out WATER_BREAKING like Java does.
const LABOR_PAINS = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH', 'POSTBIRTH']);

/** @type {Map<string, PlayerRecord>} */
const records = new Map();

/** @param {Player} player */
export function getRecord(player) {
  let record = records.get(player.id);
  if (!record || !record.player.isValid) {
    record = new PlayerRecord(player);
    records.set(player.id, record);
  }
  return record;
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => records.delete(playerId));

// --- small helpers -----------------------------------------------------------------------

/**
 * @param {Player} player
 * @param {string} key Java lang key
 * @param {(string | number | import('@minecraft/server').RawMessage)[]} [args]
 */
export function message(player, key, args = []) {
  player.sendMessage({ translate: key, with: { rawtext: args.map((a) => (typeof a === 'object' ? a : { text: String(a) })) } });
}

/**
 * @param {Player} player
 * @param {string} key
 * @param {(string | number)[]} [args]
 */
export function actionbar(player, key, args = []) {
  player.onScreenDisplay.setActionBar({ translate: key, with: args.map(String) });
}

/** @param {Player} player @param {string} sound @param {number} [volume] */
export function playSound(player, sound, volume = 1) {
  player.dimension.playSound(sound, player.location, { volume });
}

/** @param {Player} player @param {string} particle @param {number} heightFactor */
export function particle(player, particle, heightFactor) {
  const { x, y, z } = player.location;
  try {
    player.dimension.spawnParticle(particle, { x, y: y + 1.8 * heightFactor, z });
  } catch {
    // Location not loaded (e.g. right after a dimension change): skip the cosmetic.
  }
}

/** @param {Player} player */
const health = (player) => player.getComponent('minecraft:health')?.currentValue ?? 0;

const isInvincible = (/** @type {Player} */ player) => {
  const mode = player.getGameMode();
  return mode === GameMode.Creative || mode === GameMode.Spectator;
};

/** Damage tagged so the hurt handler doesn't count it against pregnancy health. */
function painDamage(/** @type {PlayerRecord} */ record) {
  record.selfHurtTick = system.currentTick;
  record.player.applyDamage(1, { cause: EntityDamageCause.magic });
}

/** AbstractPregnancySystem.tryHurt */
function tryHurt(/** @type {PlayerRecord} */ record) {
  if (health(record.player) > 1.5) painDamage(record);
}

/** AbstractPregnancySystem.tryHurtByCooldown: 10 % (times factor) chance every 60 ticks. */
function tryHurtByCooldown(/** @type {PlayerRecord} */ record, factor = 1) {
  if (health(record.player) < 1.5) return;
  if (record.cooldowns.hurt < 60) {
    record.cooldowns.hurt++;
    return;
  }
  record.cooldowns.hurt = 0;
  if (Math.random() < 0.1 * factor) painDamage(record);
}

const isAtLastPhase = (/** @type {Pregnancy} */ p) => p.phase === p.lastPhase;
const canAdvancePhase = (/** @type {Pregnancy} */ p) => p.daysPassed >= p.daysByPhase[p.phase];
export const isInLabor = (/** @type {Pregnancy} */ p) => p.pain != null && LABOR_PAINS.has(p.pain.type) && p.pain.type !== 'WATER_BREAKING';
export const isMisbirth = (/** @type {Pregnancy} */ p) => p.pain?.type === 'MISCARRIAGE';
/** Labor (including water breaking) or miscarriage: nothing else may interrupt these. */
export const isLaborOrMisbirth = (/** @type {Pregnancy} */ p) => p.pain != null && (LABOR_PAINS.has(p.pain.type) || p.pain.type === 'MISCARRIAGE');
const painExpired = (/** @type {import('./state.js').PainInstance} */ pain) => pain.duration > -1 && pain.elapsed >= pain.duration;

/**
 * Gives items to the player: empty hands first (Java fills main and off hand), then inventory,
 * and drops what doesn't fit.
 * @param {Player} player
 * @param {string[]} itemIds
 */
function giveItems(player, itemIds) {
  const container = player.getComponent('minecraft:inventory')?.container;
  for (const id of itemIds) {
    const leftover = container ? container.addItem(new ItemStack(id, 1)) : new ItemStack(id, 1);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  }
}

/** @param {Player} player @param {string} effect @param {number} duration @param {number} amplifier */
function addEffect(player, effect, duration, amplifier = 0) {
  player.addEffect(effect, duration, { amplifier, showParticles: false });
}

// --- starting and ending -----------------------------------------------------------------

/**
 * PlayerHelper.tryToStartPrePregnancy + tryToStartPregnancy for potions and commands.
 * @param {PlayerRecord} record
 * @param {number} babies
 * @param {import('./data.js').Species} father
 */
export function startPregnancy(record, babies, father = 'HUMAN') {
  if (!record.isFemale() || record.pregnancy || record.female.post) return false;
  record.pregnancy = newPregnancy(babies, father);
  record.female.lactation = null; // femaleData.tryRemoveLactation()
  record.save();
  message(record.player, 'minepreggo.pregnancy.controls');
  message(record.player, 'minepreggo.pregnancy.belly');
  return true;
}

/** Impregnation potion: Java starts the pregnancy when the 15 s Impregnation effect ends. */
export function startPregnancyFromPotion(/** @type {PlayerRecord} */ record, /** @type {number} */ amplifier, /** @type {import('./data.js').Species} */ father = 'HUMAN') {
  return startPregnancy(record, babiesFromPotion(amplifier), father);
}

/**
 * Potion of Pregnancy Acceleration (world/effect/PregnancyAcceleration): skips 7 % of the
 * pregnancy per level, phase by phase, then starts labor if the birth phase is complete.
 * Nothing happens during labor or a miscarriage.
 */
export function accelerate(/** @type {PlayerRecord} */ record, /** @type {number} */ amplifier) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return false;
  const result = advancePhases(p.daysByPhase, p.phase, p.daysPassed, accelerationDays(amplifier, CONFIG.totalPregnancyDays), p.lastPhase);
  if (result.phase !== p.phase) setPhase(record, result.phase);
  p.daysPassed = result.daysPassed;
  record.dirty = true;
  if (!tryToStartLabor(record)) playSound(record.player, 'minepreggo.stomach_growls');
  record.save();
  return true;
}

/** Potion of Gradual Pregnancy Acceleration: the timer runs faster for `duration` ticks. */
export function accelerateGradually(/** @type {PlayerRecord} */ record, /** @type {number} */ amplifier, duration = 3600) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return false;
  p.acceleration = { amplifier, endTime: world.getAbsoluteTime() + duration };
  record.save();
  return true;
}

/** PlayerHelper.forceEndPregnancy */
export function endPregnancy(/** @type {PlayerRecord} */ record) {
  if (!record.pregnancy) return false;
  record.pregnancy = null;
  record.save();
  return true;
}

/** AbstractPlayerPregnancySystem.setPhase: jump to a phase (never past the birth phase). */
export function setPhase(/** @type {PlayerRecord} */ record, /** @type {number} */ phase) {
  const p = record.pregnancy;
  if (!p || phase < 0 || phase > p.lastPhase) return false;
  p.phase = phase;
  p.timer = 0;
  p.daysPassed = 0;
  record.dirty = true;
  return true;
}

/** AbstractPregnancySystem.tryToStartLabor(forceElapsedDays) */
export function tryToStartLabor(/** @type {PlayerRecord} */ record, force = false) {
  const p = record.pregnancy;
  if (!p || (!canAdvancePhase(p) && !force) || !isAtLastPhase(p)) return false;
  if (p.pain && !COMMON_PAINS.has(p.pain.type)) return false;
  p.daysPassed = p.daysByPhase[p.phase] + 1;
  breakWater(record);
  return true;
}

// --- pains ---------------------------------------------------------------------------------

/**
 * AbstractPlayerPregnancySystem.tryToStartCommonPregnancyPain
 * @param {PlayerRecord} record
 * @param {CommonPain} pain
 * @param {PainCause} cause
 * @param {number} baseDuration
 */
export function startCommonPain(record, pain, cause, baseDuration) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.pain && !COMMON_PAINS.has(p.pain.type)) return false;
  const { duration, severity } = createCommonPain(pain, p.phase, p.lastPhase, cause, baseDuration);
  if (pain === 'FETAL_MOVEMENT') {
    playSound(record.player, 'minepreggo.pregnancy_pain');
    actionbar(record.player, 'minepreggo.fetal_movement.felt');
  }
  if (pain === 'CONTRACTION') playSound(record.player, 'minepreggo.player_contraction');
  p.pain = { type: pain, duration, severity, elapsed: 0 };
  record.dirty = true;
  return true;
}

/**
 * Potion of Fetal Movement Inducement (a Bedrock addition): a fetal movement of the chosen severity
 * (0, 2 or 4 pick the I, II and III belly animations) from P3, lasting the phase's base duration
 * scaled like PregnancyPainInstanceFactory scales it (1 + severity x 0.25). Replaces a common pain
 * in progress; impossible during labor or a miscarriage.
 * @param {PlayerRecord} record
 * @param {number} severity 0-4
 */
export function induceFetalMovement(record, severity) {
  const p = record.pregnancy;
  if (!p || !canExperience(p, 'FETAL_MOVEMENT')) return false;
  if (p.pain && !COMMON_PAINS.has(p.pain.type)) return false;
  const level = Math.min(4, Math.max(0, Math.round(severity)));
  const duration = Math.round(baseDurationOf(p, 'FETAL_MOVEMENT') * (1 + level * 0.25));
  p.pain = { type: 'FETAL_MOVEMENT', duration, severity: level, elapsed: 0 };
  playSound(record.player, 'minepreggo.pregnancy_pain');
  record.dirty = true;
  return true;
}

/** AbstractPregnancySystem.canExperience: which pains a phase allows when forced. */
export function canExperience(/** @type {Pregnancy} */ p, /** @type {CommonPain} */ pain) {
  if (pain === 'CONTRACTION') return isAtLastPhase(p);
  if (pain === 'FETAL_MOVEMENT') return p.phase > 2;
  if (pain === 'BACK_PAIN') return p.phase > 3;
  return true;
}

/** Base durations used by tryToForceCommonPregnancyPain. */
export function baseDurationOf(/** @type {Pregnancy} */ p, /** @type {CommonPain} */ pain) {
  const config = PHASES[p.phase];
  return {
    MORNING_SICKNESS: config.morningSicknessTicks,
    FETAL_MOVEMENT: config.fetalMovementTicks,
    CONTRACTION: config.contractionTicks,
    BACK_PAIN: config.backPainTicks,
  }[pain];
}

/** P0/P3/P4 tryInitRandomPregnancyPain */
function tryInitRandomPain(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const config = PHASES[p.phase];
  if (p.phase >= 4 && isAtLastPhase(p) && Math.random() < config.contractionProb) {
    return startCommonPain(record, 'CONTRACTION', 'NATURAL', config.contractionTicks);
  }
  if (p.phase >= 3 && Math.random() < config.fetalMovementProb) {
    return startCommonPain(record, 'FETAL_MOVEMENT', 'NATURAL', config.fetalMovementTicks);
  }
  if (Math.random() < config.morningSicknessProb) {
    return startCommonPain(record, 'MORNING_SICKNESS', 'NATURAL', config.morningSicknessTicks);
  }
  return false;
}

/** PlayerPregnancySystemP0.evaluatePregnancyPains */
function evaluateCommonPain(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const pain = p.pain;
  if (!pain || !COMMON_PAINS.has(pain.type)) return;
  if (painExpired(pain)) {
    p.pain = null;
    return;
  }
  pain.elapsed++;
  if (pain.type === 'FETAL_MOVEMENT' || pain.type === 'CONTRACTION') {
    const factor = 1 + (pain.severity + 1) * 0.5 + (pain.type === 'FETAL_MOVEMENT' ? 1 : 2);
    tryHurtByCooldown(record, Math.max(1, factor));
  }
}

/**
 * AbstractPregnancySystem.onEatSpicyFood (pregnancy P4+ is sensitive to spice).
 * @returns {boolean} whether a pain was triggered
 */
export function onEatSpicyFood(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p || p.phase < 4) return false;
  const { player } = record;
  if (isAtLastPhase(p) && Math.random() < 0.2 + p.phase * 0.05) {
    startCommonPain(record, 'CONTRACTION', 'FOOD', TICKS.spicyContraction);
    tryHurt(record);
    playSound(player, 'minepreggo.stomach_growls');
    if (p.pain?.type === 'CONTRACTION') message(player, 'chat.minepreggo.player.pregnancy.message.craving.spicy_food.contraction');
    return true;
  }
  if (Math.random() < 0.2 + p.phase * 0.025) {
    startCommonPain(record, 'FETAL_MOVEMENT', 'FOOD', TICKS.spicyFetalMovement);
    tryHurt(record);
    playSound(player, 'minepreggo.stomach_growls');
    if (p.pain?.type === 'FETAL_MOVEMENT') message(player, 'chat.minepreggo.player.pregnancy.message.craving.spicy_food.fetal_movement');
    return true;
  }
  return false;
}

// --- symptoms ------------------------------------------------------------------------------

/** Symptoms each phase can develop (P1 craving, P2 lactation, P3 belly rubs). */
const symptomsOfPhase = (/** @type {number} */ phase) =>
  /** @type {Symptom[]} */ (['CRAVING', 'MILKING', 'BELLY_RUBS'].slice(0, Math.min(phase, 3)));

/** AbstractPlayerPregnancySystem.tryToStartPregnancySymptom */
export function startSymptom(/** @type {PlayerRecord} */ record, /** @type {Symptom} */ symptom) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.symptoms[symptom] !== undefined) return false;
  // Java only scales craving severity; milking and belly rubs always start at severity 0.
  p.symptoms[symptom] = symptom === 'CRAVING' ? symptomSeverity(symptom, p.phase, p.lastPhase) : 0;
  if (symptom === 'CRAVING') p.cravingType = randomCraving();
  record.dirty = true;
  return true;
}

/** P1-P3 tryInitPregnancySymptom */
function tryInitSymptom(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.phase >= 1 && p.craving >= MAX_LEVEL && p.symptoms.CRAVING === undefined) return startSymptom(record, 'CRAVING');
  if (p.phase >= 2 && p.milking >= 12 && p.symptoms.MILKING === undefined) return startSymptom(record, 'MILKING');
  if (p.phase >= 3 && p.bellyRubs >= MAX_LEVEL && p.symptoms.BELLY_RUBS === undefined) return startSymptom(record, 'BELLY_RUBS');
  return false;
}

/** refreshPregnancySymtoms: symptoms end once their meter is low enough again. */
export function refreshSymptoms(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.symptoms.CRAVING !== undefined && p.craving <= 2) {
    delete p.symptoms.CRAVING;
    p.cravingType = null;
  }
  if (p.symptoms.MILKING !== undefined && p.milking <= 8) delete p.symptoms.MILKING;
  if (p.symptoms.BELLY_RUBS !== undefined && p.bellyRubs <= 8) delete p.symptoms.BELLY_RUBS;
  record.dirty = true;
}

/** evaluateCravingTimer / evaluateMilkingTimer / evaluateBellyRubsTimer */
function evaluateNeeds(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const grow = (/** @type {'craving'|'milking'|'bellyRubs'} */ meter, /** @type {(number|undefined)[]} */ table) => {
    const total = table[p.phase];
    if (total === undefined || p[meter] >= MAX_LEVEL) return;
    const timerKey = /** @type {'cravingTimer'|'milkingTimer'|'bellyRubsTimer'} */ (`${meter}Timer`);
    if (p[timerKey] >= total) {
      p[meter] = clampLevel(p[meter] + 1);
      p[timerKey] = 0;
    } else {
      p[timerKey]++;
    }
  };
  grow('craving', CRAVING_TICKS);
  grow('milking', MILKING_TICKS);
  grow('bellyRubs', BELLY_RUBS_TICKS);
  if (p.milking >= 12 && p.symptoms.MILKING !== undefined && system.currentTick % 300 === 0) {
    particle(record.player, 'minecraft:white_smoke_particle', 0.7);
  }
}

// --- miscarriage ---------------------------------------------------------------------------

/** PlayerPregnancySystemP1.startMiscarriage */
function startMiscarriage(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.phase < 1) return false;
  tryHurt(record);
  playSound(record.player, 'minepreggo.player_miscarriage', 0.7);
  message(record.player, 'chat.minepreggo.player.miscarriage.message.start', [record.player.name]);
  p.pain = { type: 'MISCARRIAGE', duration: TICKS.miscarriage, severity: 0, elapsed: 0 };
  record.dirty = true;
  return true;
}

/** AbstractPlayerPregnancySystem.tryInitMiscarriage */
export function tryInitMiscarriage(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return false;
  return startMiscarriage(record);
}

/** PlayerPregnancySystemP1.evaluateMiscarriage + initPostMiscarriage */
function evaluateMiscarriage(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const pain = /** @type {import('./state.js').PainInstance} */ (p.pain);
  if (!painExpired(pain)) {
    tryHurtByCooldown(record);
    pain.elapsed++;
    if (system.currentTick % 3 === 0) particle(record.player, 'minecraft:redstone_ore_dust_particle', 0.35);
    return;
  }
  const { player } = record;
  giveItems(player, p.womb.map((species) => SPECIES[species].deadBabyItem));
  message(player, 'chat.minepreggo.player.miscarriage.message.post', [player.name]);
  record.female.post = { type: 'MISCARRIAGE', timer: 0 };
  record.pregnancy = null;
  addEffect(player, 'weakness', TICKS.weaknessAfterMiscarriage);
  tryHurt(record);
  record.save();
}

// --- labor and birth (P4+) -----------------------------------------------------------------

/** PlayerPregnancySystemP4.breakWater */
function breakWater(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  tryHurt(record);
  playSound(record.player, 'minepreggo.pregnancy_pain');
  actionbar(record.player, 'chat.minepreggo.player.birth.message.start', [record.player.name]);
  p.pain = { type: 'WATER_BREAKING', duration: TICKS.waterBreaking, severity: 0, elapsed: 0 };
  record.save();
}

/** PlayerPregnancySystemP4.startLabor */
function startLabor(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  tryHurt(record);
  playSound(record.player, 'minepreggo.pregnancy_pain');
  actionbar(record.player, 'chat.minepreggo.player.birth.message.pre', [record.player.name]);
  p.pain = { type: 'PREBIRTH', duration: PHASES[p.phase].preBirthTicks, severity: 0, elapsed: 0 };
  record.save();
}

/** Starts pushing out the next baby, or returns false when the womb is empty. */
function nextBaby(/** @type {PlayerRecord} */ record, /** @type {number} */ babiesBorn) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const baby = p.womb.shift();
  p.birth = baby ? { baby, pushLevel: 0, pushesPerLevel: SPECIES[baby].pushesPerLevel, babiesBorn } : null;
  record.pushes = { count: 0, lastPressTick: 0 };
  return p.birth != null;
}

/** PlayerPregnancySystemP4.evaluateBirth */
function evaluateBirth(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const pain = /** @type {import('./state.js').PainInstance} */ (p.pain);
  const { player } = record;

  if (pain.type === 'PREBIRTH') {
    if (!painExpired(pain)) {
      pain.elapsed++;
      if (system.currentTick % 3 === 0) particle(player, 'minecraft:water_drip_particle', 0.35);
      return;
    }
    tryHurt(record);
    p.postBirthTicks = p.womb.reduce((sum, species) => sum + SPECIES[species].postBirthTicks, 0);
    p.originalBabies = p.womb.length;
    p.pain = { type: 'BIRTH', duration: -1, severity: 0, elapsed: 0 };
    playSound(player, 'minepreggo.player_birth');
    nextBaby(record, 0);
    message(player, 'chat.minepreggo.player.birth.message.pre', [player.name]);
    message(player, 'minepreggo.birth.push_hint');
    record.save();
    return;
  }

  if (pain.type === 'BIRTH') {
    const birth = p.birth;
    if (!birth) {
      p.pain = { type: 'POSTBIRTH', duration: p.postBirthTicks || 200, severity: 0, elapsed: 0 };
      record.save();
      return;
    }
    if (birth.pushLevel >= PUSH_LEVELS_PER_BABY) {
      tryHurt(record);
      const view = player.getViewDirection();
      const { x, y, z } = player.location;
      player.dimension.spawnItem(new ItemStack(SPECIES[birth.baby].babyItem, 1), { x: x + view.x * 0.4, y: y + 0.5, z: z + view.z * 0.4 });
      for (let i = 0; i < 5; i++) particle(player, 'minecraft:redstone_ore_dust_particle', 0.35);
      playSound(player, 'minepreggo.player_birth');
      playSound(player, 'minepreggo.splash', 0.3);
      nextBaby(record, birth.babiesBorn + 1);
      record.save();
      return;
    }
    if (record.cooldowns.push < 60) {
      record.cooldowns.push++;
    } else {
      record.cooldowns.push = 0;
      if (Math.random() < 0.5) playSound(player, 'minepreggo.player_push');
    }
    if (system.currentTick % 10 === 0) particle(player, 'minecraft:redstone_ore_dust_particle', 0.35);
    return;
  }

  if (pain.type === 'POSTBIRTH') {
    if (!painExpired(pain)) {
      pain.elapsed++;
      return;
    }
    // initPostPartum
    message(player, 'chat.minepreggo.player.birth.message.post', [p.originalBabies]);
    record.female.post = { type: 'PARTUM', timer: 0 };
    record.female.lactation = { level: 0, timer: 0, elapsed: 0 };
    record.pregnancy = null;
    addEffect(player, 'weakness', TICKS.weaknessAfterBirth);
    tryHurt(record);
    record.save();
  }
}

/**
 * One press of the push button during birth (client PulseTracker + PulsePushInBirthC2SPacket):
 * `pushesPerLevel` quick presses raise the push level; pausing lets it drop.
 */
export function onPush(/** @type {PlayerRecord} */ record) {
  const birth = record.pregnancy?.pain?.type === 'BIRTH' ? record.pregnancy.birth : null;
  if (!birth) return;
  const reduced = decayPushes(record) > 0;
  record.pushes.count++;
  record.pushes.lastPressTick = system.currentTick;
  if (record.pushes.count >= birth.pushesPerLevel) {
    record.pushes.count = 0;
    birth.pushLevel++;
  } else if (reduced) {
    birth.pushLevel = Math.max(0, birth.pushLevel - 1);
  }
  record.dirty = true;
}

/** PulseTracker.applyTimedReduction: every idle second forgets one press. */
function decayPushes(/** @type {PlayerRecord} */ record) {
  const { pushes } = record;
  if (pushes.lastPressTick === 0 || pushes.count === 0) return 0;
  const windows = Math.floor((system.currentTick - pushes.lastPressTick) / 20);
  if (windows <= 0) return 0;
  const before = pushes.count;
  pushes.count = Math.max(0, pushes.count - windows);
  pushes.lastPressTick = pushes.count === 0 ? 0 : pushes.lastPressTick + windows * 20;
  return before - pushes.count;
}

/** Client tick of the push tracker: idle decay also costs a push level. */
function tickPushDecay(/** @type {PlayerRecord} */ record) {
  const birth = record.pregnancy?.birth;
  if (birth && decayPushes(record) > 0 && birth.pushLevel > 0) {
    birth.pushLevel--;
    record.dirty = true;
  }
}

/** Progress towards the next baby, 0-100. */
export function pushProgress(/** @type {PlayerRecord} */ record) {
  const birth = record.pregnancy?.birth;
  if (!birth) return 0;
  const level = birth.pushLevel + record.pushes.count / birth.pushesPerLevel;
  return Math.min(100, Math.floor((level / PUSH_LEVELS_PER_BABY) * 100));
}

// --- the per-tick engine -------------------------------------------------------------------

/** One tick of the active phase's system (AbstractPlayerPregnancySystem.evaluatePregnancySystem). */
function tickPregnancy(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const { player } = record;
  record.dirty = true;

  // Java checks labor before miscarriage, so a miscarriage in the last phase could be replaced by
  // the water breaking; here an ongoing miscarriage always runs its course.
  if (p.phase >= 4 && !isMisbirth(p)) {
    if (isInLabor(p)) {
      tickPushDecay(record);
      evaluateBirth(record);
      return;
    }
    if (p.pain?.type === 'WATER_BREAKING') {
      const pain = p.pain;
      if (painExpired(pain)) startLabor(record);
      else {
        pain.elapsed++;
        if (system.currentTick % 3 === 0) particle(player, 'minecraft:water_drip_particle', 0.35);
      }
      return;
    }
    if (canAdvancePhase(p) && isAtLastPhase(p)) {
      breakWater(record);
      return;
    }
    // Long walks cause back pain (P4 evaluatePregnancySystem).
    if (!player.getComponent('minecraft:riding') && player.isOnGround && record.moving) {
      if (record.cooldowns.move > 7200 - 500 * p.phase) {
        startCommonPain(record, 'BACK_PAIN', 'TIRENESS', PHASES[p.phase].backPainTicks);
        record.cooldowns.move = 0;
      } else {
        record.cooldowns.move++;
      }
    }
  }

  if (p.phase >= 1) {
    if (isMisbirth(p)) {
      evaluateMiscarriage(record);
      return;
    }
    const allSymptoms = symptomsOfPhase(p.phase).every((s) => p.symptoms[s] !== undefined);
    if (!allSymptoms) {
      if (record.cooldowns.symptom > 20) {
        tryInitSymptom(record);
        record.cooldowns.symptom = 0;
      } else {
        record.cooldowns.symptom++;
      }
    }
    if (Object.keys(p.symptoms).length > 0) refreshSymptoms(record);
    evaluateHealing(record);
    evaluateNeeds(record);
    if (p.phase >= 3) evaluateRandomWeakness(record);
    evaluateExhaustion(record);
  }

  if (!p.pain) {
    if (record.cooldowns.pain > 20) {
      tryInitRandomPain(record);
      record.cooldowns.pain = 0;
    } else {
      record.cooldowns.pain++;
    }
  } else {
    evaluateCommonPain(record);
  }

  // evaluatePregnancyTimer: the clock stops once the birth phase is complete. A Potion of
  // Gradual Pregnancy Acceleration makes it run (1 + level) x 120 ticks per tick while it lasts.
  if (!(isAtLastPhase(p) && canAdvancePhase(p))) {
    if (p.timer > CONFIG.ticksPerPregnancyDay) {
      p.timer = 0;
      p.daysPassed++;
    } else if (p.acceleration && world.getAbsoluteTime() < p.acceleration.endTime) {
      p.timer += gradualAccelerationSpeed(p.acceleration.amplifier, CONFIG.ticksPerPregnancyDay);
    } else {
      if (p.acceleration) p.acceleration = null;
      p.timer++;
    }
  }
  if (canAdvancePhase(p) && !isAtLastPhase(p)) {
    setPhase(record, p.phase + 1);
    record.save();
  }

  // PlayerPregnancySystemP3: stomach growls.
  if (p.phase >= 3) {
    if (record.cooldowns.growl < 20) record.cooldowns.growl++;
    else {
      record.cooldowns.growl = 0;
      if (Math.random() < 0.01) playSound(player, 'minepreggo.stomach_growls', 0.2);
    }
  }
}

function evaluateHealing(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (p.health >= 100) return;
  if (p.healthTimer > CONFIG.ticksForPregnancyHealing) {
    const amount = Math.ceil(CONFIG.pregnancyHealingAmount * (1 - CONFIG.pregnancyHealingReductionPerPhase * p.phase));
    p.health = Math.min(100, p.health + amount);
    p.healthTimer = 0;
    particle(record.player, 'minecraft:villager_happy', 0.5);
  } else {
    p.healthTimer++;
  }
}

function evaluateRandomWeakness(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  if (record.cooldowns.weakness < PHASES[p.phase].randomWeaknessTicks) {
    record.cooldowns.weakness++;
    return;
  }
  record.cooldowns.weakness = 0;
  if (Math.random() < 0.3) addEffect(record.player, 'weakness', TICKS.randomWeakness);
}

function evaluateExhaustion(/** @type {PlayerRecord} */ record) {
  if (record.cooldowns.exhaustion < CONFIG.pregnancyHungryCooldown) {
    record.cooldowns.exhaustion++;
    return;
  }
  record.cooldowns.exhaustion = 0;
  const exhaustion = record.player.getComponent('minecraft:player.exhaustion');
  if (!exhaustion) return;
  const phase = /** @type {Pregnancy} */ (record.pregnancy).phase;
  exhaustion.setCurrentValue(Math.min(exhaustion.effectiveMax, exhaustion.currentValue + PHASES[phase].exhaustion));
}

/** FemalePlayerSystem.tickSprintFatigue / tickSneakFatigue */
function tickFatigue(/** @type {PlayerRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.pregnancy);
  const { player } = record;
  const sprintLimit = SPRINT_FATIGUE_TICKS[p.phase];
  if (sprintLimit !== undefined && player.isSprinting) {
    if (p.sprintTimer > sprintLimit) {
      p.sprintTimer = 0;
      addEffect(player, 'nausea', TICKS.nausea);
    } else p.sprintTimer++;
  }
  const sneakLimit = SNEAK_FATIGUE_TICKS[p.phase];
  if (sneakLimit !== undefined && player.isSneaking) {
    if (p.sneakTimer > sneakLimit) {
      p.sneakTimer = 0;
      addEffect(player, 'nausea', TICKS.nausea);
    } else p.sneakTimer++;
  }
}

/** FemalePlayerSystem.tickNotPregnant: recovery timer and post-partum lactation. */
function tickNotPregnant(/** @type {PlayerRecord} */ record) {
  const { female } = record;
  if (female.post) {
    female.post.timer++;
    if (female.post.timer >= CONFIG.ticksOfPostPregnancyPhase) female.post = null;
    record.dirty = true;
  }
  const lactation = female.lactation;
  if (lactation) {
    if (lactation.level < MAX_LEVEL) {
      if (lactation.timer < CONFIG.postBirthLactationCooldown) lactation.timer++;
      else {
        lactation.timer = 0;
        lactation.level = clampLevel(lactation.level + 1);
      }
    }
    lactation.elapsed++;
    if (lactation.elapsed >= CONFIG.ticksOfPostPartumLactation) female.lactation = null;
    record.dirty = true;
  }
}

/** @param {PlayerRecord} record */
function updateMovement(record) {
  const { x, z } = record.player.location;
  const last = record.lastPosition;
  record.moving = last !== undefined && (x - last.x) ** 2 + (z - last.z) ** 2 > 1e-6;
  record.lastPosition = { x, z };
}

/** @param {Player} player */
export function tickPlayer(player) {
  const record = getRecord(player);
  if (record.pending && world.getAbsoluteTime() >= record.pending.endTime) {
    const { amplifier, father } = record.pending;
    record.pending = null;
    startPregnancyFromPotion(record, amplifier, father ?? 'HUMAN');
    record.dirty = true;
  }
  if (!record.isFemale()) return record;

  updateMovement(record);
  if (record.pregnancy) {
    tickFatigue(record);
    tickPregnancy(record);
  } else {
    tickNotPregnant(record);
  }
  if (record.dirty && system.currentTick % 20 === 0) record.save();
  return record;
}

/**
 * WorldEventHandler.onSleepFinished: skipping the night also moves pregnancies forward, but never
 * past the end of the current phase.
 * @param {number} ticksSkipped
 */
export function onNightSkipped(ticksSkipped) {
  for (const record of records.values()) {
    const p = record.pregnancy;
    if (!p || !record.player.isValid) continue;
    const total = p.timer + ticksSkipped;
    const days = Math.min(Math.floor(total / CONFIG.ticksPerPregnancyDay), p.daysByPhase[p.phase] - p.daysPassed);
    if (days > 0) {
      p.timer = total % CONFIG.ticksPerPregnancyDay;
      p.daysPassed = Math.min(p.daysByPhase[p.phase], p.daysPassed + days);
    } else {
      p.timer = total;
    }
    record.save();
  }
}

/** Equipped chest item, used to block belly rubs through armor. */
export function chestItem(/** @type {Player} */ player) {
  return player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Chest);
}

export { isInvincible, records };
