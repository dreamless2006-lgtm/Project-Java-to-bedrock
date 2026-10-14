// The preggo mob systems of the Java mod, for tamed and wild mobs: PreggoMobSystem (fullness,
// healing, savage state), PreggoMobPregnancySystemP0-P9 and AbstractPreggoMobPregnancySystem
// (phases, symptoms, pains, miscarriage, labor and the automatic birth), FemaleFertilitySystem
// (post-pregnancy recovery and post-partum lactation) and the hostile pregnant data.
//
// Java runs these every tick; here every loaded mob is processed once per STEP ticks and all
// timers advance by STEP, which keeps durations and per-second chances the same.
// The client sees the state only through the entity properties and events of DESIGN.md
// (minepreggo:phase / pose / kick / growth / savage).

import { EntityDamageCause, ItemStack, system, world } from '@minecraft/server';
import { BABIES_BY_FINAL_PHASE, BELLY_RUBS_TICKS, CONFIG, CRAVING_TICKS, MAX_LEVEL, MILKING_TICKS, PHASES, TICKS } from '../pregnancy/data.js';
import { accelerationDays, advancePhases, babiesFromPotion, createCommonPain, daysByPhase, gradualAccelerationSpeed, pregnancyDamage, randomCraving, sigmoid, symptomSeverity } from '../pregnancy/math.js';
import { clampLevel, newPregnancy } from '../pregnancy/state.js';
import { FAMILIES, FULLNESS, birthTicks, hungerTicks, postBirthTicks } from './families.js';
import { MobRecord } from './state.js';

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../pregnancy/state.js').Pregnancy} Pregnancy */
/** @typedef {import('../pregnancy/state.js').PainInstance} PainInstance */
/** @typedef {import('../pregnancy/math.js').CommonPain} CommonPain */
/** @typedef {import('./families.js').Family} Family */

/** Ticks between two updates of a mob. */
export const STEP = 20;
export const FAMILY_TAG = 'minepreggo_preggo_mob';

const COMMON_PAINS = new Set(['MORNING_SICKNESS', 'FETAL_MOVEMENT', 'CONTRACTION', 'BACK_PAIN']);
const LABOR_PAINS = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH', 'POSTBIRTH']);
/** PregnancyPain.incapacitate: these pains stop the mob (Java blocks all of its goals). */
const INCAPACITATING = new Set(['MORNING_SICKNESS', 'CONTRACTION', 'MISCARRIAGE', 'BIRTH', 'PREBIRTH', 'POSTBIRTH']);

/** Pains to the minepreggo:pose values the client animates. */
const POSE_OF_PAIN = {
  MORNING_SICKNESS: 'morning_sickness',
  FETAL_MOVEMENT: 'fetal_movement',
  CONTRACTION: 'contraction',
  BACK_PAIN: 'back_pain',
  WATER_BREAKING: 'water_breaking',
  PREBIRTH: 'prebirth',
  BIRTH: 'birth',
  POSTBIRTH: 'postbirth',
  MISCARRIAGE: 'miscarriage',
};

/** @type {Map<string, MobRecord>} */
const records = new Map();

/** @param {Entity} entity */
export function getRecord(entity) {
  let record = records.get(entity.id);
  if (!record || record.entity !== entity) {
    record = new MobRecord(entity);
    records.set(entity.id, record);
  }
  return record;
}

export const forgetRecord = (/** @type {string} */ id) => records.delete(id);
export const familyOf = (/** @type {Entity} */ entity) => FAMILIES[entity.typeId];
export const isTamed = (/** @type {Entity} */ entity) => entity.getComponent('minecraft:is_tamed') !== undefined;
const phaseProperty = (/** @type {Entity} */ entity) => /** @type {number} */ (entity.getProperty('minepreggo:phase') ?? -1);

// --- small helpers ---------------------------------------------------------------------------

/** The mob's name for chat messages: its name tag, or the translated entity name. */
export const nameOf = (/** @type {Entity} */ entity) =>
  entity.nameTag ? { text: entity.nameTag } : { translate: `entity.${entity.typeId}.name` };

/** @param {MobRecord} record @returns {Player | undefined} */
export function ownerOf(record) {
  const id = record.data.owner;
  const owner = id ? world.getEntity(id) : undefined;
  return owner?.typeId === 'minecraft:player' ? /** @type {Player} */ (owner) : undefined;
}

/** Sends `key` (with the mob's name as %s) to the owner, if she has one online. */
export function tellOwner(/** @type {MobRecord} */ record, /** @type {string} */ key) {
  ownerOf(record)?.sendMessage({ translate: key, with: { rawtext: [nameOf(record.entity)] } });
}

/** @param {Entity} entity @param {string} sound */
export function playSound(entity, sound, volume = 1) {
  entity.dimension.playSound(sound, entity.location, { volume, pitch: 0.8 + Math.random() * 0.3 });
}

/** @param {Entity} entity @param {string} particle */
export function particles(entity, particle, count = 1, height = 1) {
  for (let i = 0; i < count; i++) {
    const { x, y, z } = entity.location;
    try {
      entity.dimension.spawnParticle(particle, { x: x + (Math.random() - 0.5) * 0.8, y: y + height + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.8 });
    } catch {
      // unloaded or invalid position
    }
  }
}

const health = (/** @type {Entity} */ entity) => entity.getComponent('minecraft:health');

/** Pregnancy pain damage. It is tagged so the hurt handler does not count it against the pregnancy. */
function hurt(/** @type {MobRecord} */ record, amount = 1) {
  const hp = health(record.entity);
  if (!hp || hp.currentValue < 1.5) return;
  record.selfHurtTick = system.currentTick;
  record.entity.applyDamage(amount, { cause: EntityDamageCause.magic });
}

/** AbstractPregnancySystem.tryHurt: the hurt that marks every stage of labor. */
const tryHurt = (/** @type {MobRecord} */ record) => hurt(record, 1);

/** tryHurtByCooldown: every 61 ticks, 10 % chance of 1 damage. */
function tryHurtByCooldown(/** @type {MobRecord} */ record) {
  record.data.hurtCooldown += STEP;
  if (record.data.hurtCooldown < 61) return;
  record.data.hurtCooldown = 0;
  if (Math.random() < 0.1) hurt(record, 1);
}

/** Drops an item at the mob, or slightly in front of her. */
export function dropItem(/** @type {Entity} */ entity, /** @type {string} */ item, inFront = false) {
  const { x, y, z } = entity.location;
  const view = entity.getViewDirection();
  const at = inFront ? { x: x + view.x * 0.8, y: y + 0.8, z: z + view.z * 0.8 } : { x, y: y + 0.5, z };
  entity.dimension.spawnItem(new ItemStack(item, 1), at);
}

/** Keeps an incapacitated mob in place and harmless until the next update. */
function incapacitate(/** @type {Entity} */ entity) {
  entity.addEffect('slowness', STEP + 10, { amplifier: 255, showParticles: false });
  entity.addEffect('weakness', STEP + 10, { amplifier: 255, showParticles: false });
}

const randomInt = (/** @type {number} */ min, /** @type {number} */ max) => min + Math.floor(Math.random() * (max - min + 1));

// --- starting and ending pregnancies -----------------------------------------------------------

/** Babies are the mother's species and creature (Java's litter of a potion pregnancy, simplified). */
function setWomb(/** @type {Pregnancy} */ p, /** @type {Family} */ family, /** @type {number} */ babies) {
  p.womb = /** @type {any} */ (Array.from({ length: babies }, () => family.species));
  p.originalBabies = babies;
}

/**
 * PreggoMobHelper.startPregnancy: P0 with `babies` babies. Tamed mobs keep their owner; wild
 * (untamed) ones stay wild and can still be tamed, like Java's untamed "tamable pregnant" types.
 * @param {MobRecord} record
 * @param {number} babies
 */
export function startPregnancy(record, babies) {
  const { data, entity } = record;
  const family = familyOf(entity);
  if (!family || data.pregnancy || data.wild || data.post || phaseProperty(entity) >= 0) return false;
  const p = newPregnancy(babies, 'HUMAN');
  setWomb(p, family, babies);
  data.pregnancy = p;
  data.lactation = null;
  entity.triggerEvent('minepreggo:set_phase_0');
  particles(entity, 'minecraft:heart_particle', 5);
  record.save();
  return true;
}

/** Moves to `phase` (commands and phase advance): days and timer restart like Java's conversion. */
export function setPhase(/** @type {MobRecord} */ record, /** @type {number} */ phase) {
  const p = record.data.pregnancy;
  if (!p || phase < 0 || phase > p.lastPhase) return false;
  p.phase = phase;
  p.daysPassed = 0;
  p.timer = 0;
  record.entity.triggerEvent(`minepreggo:set_phase_${phase}`);
  record.dirty = true;
  return true;
}

/** Ends the pregnancy: back to the non-pregnant model, optionally into post-pregnancy recovery. */
export function endPregnancy(/** @type {MobRecord} */ record, /** @type {'PARTUM' | 'MISCARRIAGE' | null} */ post) {
  const { data, entity } = record;
  data.pregnancy = null;
  data.post = post ? { type: post, timer: 0 } : null;
  data.lactation = post === 'PARTUM' ? { level: 0, timer: 0, elapsed: 0 } : null;
  entity.triggerEvent('minepreggo:set_not_pregnant');
  record.save();
}

/**
 * HostilePregnantPreggoMobDataImpl.init for a mob that spawned pregnant: birth phase, babies and
 * how likely a hit is to incapacitate her. Her phase never changes.
 */
export function initWild(/** @type {MobRecord} */ record, /** @type {number} */ phase) {
  const lastPhase = randomInt(Math.max(phase, 4), 9);
  const days = daysByPhase(70, lastPhase);
  const totalDays = days.slice(0, phase).reduce((a, b) => a + b, 0) + randomInt(0, days[phase] ?? 0);
  const counts = BABIES_BY_FINAL_PHASE[/** @type {4|5|6|7|8|9} */ (lastPhase)];
  record.data.wild = {
    lastPhase,
    babies: counts[randomInt(0, counts.length - 1)],
    totalDays,
    painProbability: sigmoid(0.05, 0.15, 0.1, Math.min(1, totalDays / 70), 0.6),
    cooldown: 60 + 20 * phase,
    painTimer: 0,
    incapacitated: false,
  };
  record.entity.triggerEvent('minepreggo:hostile_pregnant_init');
  record.save();
}

// --- pains -----------------------------------------------------------------------------------

/** AbstractPreggoMobPregnancySystem.tryToStartCommonPregnancyPain */
export function startCommonPain(/** @type {MobRecord} */ record, /** @type {CommonPain} */ pain, /** @type {import('../pregnancy/math.js').PainCause} */ cause, /** @type {number} */ baseDuration) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  if (p.pain && !COMMON_PAINS.has(p.pain.type)) return false;
  const { duration, severity } = createCommonPain(pain, p.phase, p.lastPhase, cause, baseDuration);
  // From P5, fetal movement can be strong enough to make her sit down (chance 0.04 x phase).
  const incapacitating = pain === 'FETAL_MOVEMENT' && p.phase >= 5 && Math.random() < 0.04 * p.phase;
  if (pain === 'FETAL_MOVEMENT' || pain === 'CONTRACTION') playSound(record.entity, 'minepreggo.stomach_growls');
  if (pain === 'BACK_PAIN') {
    tellOwner(record, 'chat.minepreggo.preggo_mob.pregnancy.back_pain.message');
    record.entity.getComponent('minecraft:rideable')?.ejectRiders();
  }
  p.pain = /** @type {PainInstance & { incapacitating?: boolean }} */ ({ type: pain, duration, severity, elapsed: 0, incapacitating });
  record.dirty = true;
  return true;
}

/**
 * Potion of Fetal Movement Inducement used on a pregnant mob (P3+): a fetal movement of the chosen
 * severity, with Java's chance of it being strong enough to sit her down from P5.
 * @param {MobRecord} record
 * @param {number} severity 0-4
 */
export function induceFetalMovement(record, severity) {
  const { wild } = record.data;
  if (wild) {
    // A hostile pregnant mob doubles over for her pain cooldown, the kick as strong as the potion.
    const level = Math.min(4, Math.max(0, Math.round(severity)));
    wild.incapacitated = true;
    wild.painTimer = 0;
    wild.kick = level <= 0 ? 0 : level < 3 ? 1 : 2;
    playSound(record.entity, 'minepreggo.stomach_growls');
    syncClient(record);
    record.save();
    return true;
  }
  const p = record.data.pregnancy;
  if (!p || p.phase < 3) return false;
  if (p.pain && !COMMON_PAINS.has(p.pain.type)) return false;
  const level = Math.min(4, Math.max(0, Math.round(severity)));
  const duration = Math.round(PHASES[p.phase].fetalMovementTicks * (1 + level * 0.25));
  const incapacitating = p.phase >= 5 && Math.random() < 0.04 * p.phase;
  playSound(record.entity, 'minepreggo.stomach_growls');
  p.pain = /** @type {PainInstance & { incapacitating?: boolean }} */ ({ type: 'FETAL_MOVEMENT', duration, severity: level, elapsed: 0, incapacitating });
  syncClient(record);
  record.save();
  return true;
}

/** P0/P3/P4 tryInitRandomPregnancyPain (a draw every ~21 ticks in Java, every STEP here). */
function tryInitRandomPain(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  const config = PHASES[p.phase];
  if (p.phase >= 4 && p.phase === p.lastPhase && Math.random() < config.contractionProb) {
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

/** PreggoMobPregnancySystemP0.evaluatePregnancyPains */
function evaluateCommonPain(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  const pain = /** @type {PainInstance} */ (p.pain);
  if (pain.duration > -1 && pain.elapsed >= pain.duration) {
    p.pain = null;
    return;
  }
  pain.elapsed += STEP;
  if (pain.type === 'FETAL_MOVEMENT' || pain.type === 'CONTRACTION') tryHurtByCooldown(record);
  else if (pain.type === 'BACK_PAIN' && pain.elapsed % 200 < STEP) particles(record.entity, 'minecraft:villager_angry', 3);
}

/**
 * AbstractPregnancySystem.onEatSpicyFood for mobs: from P4, spicy food can bring on contractions
 * (last phase) or fetal movement.
 */
export function onEatSpicyFood(/** @type {MobRecord} */ record) {
  const p = record.data.pregnancy;
  if (!p || p.phase < 4) return false;
  if (p.phase === p.lastPhase && Math.random() < 0.2 + p.phase * 0.05) {
    if (startCommonPain(record, 'CONTRACTION', 'FOOD', TICKS.spicyContraction)) {
      tryHurt(record);
      tellOwner(record, 'chat.minepreggo.preggo_mob.pregnancy.message.craving.spicy_food.contraction');
      return true;
    }
  } else if (Math.random() < 0.2 + p.phase * 0.025) {
    if (startCommonPain(record, 'FETAL_MOVEMENT', 'FOOD', TICKS.spicyFetalMovement)) {
      tryHurt(record);
      tellOwner(record, 'chat.minepreggo.preggo_mob.pregnancy.message.craving.spicy_food.fetal_movement');
      return true;
    }
  }
  return false;
}

// --- symptoms and needs ------------------------------------------------------------------------

/** P1 craving at 16, P2 milking at 12, P3 belly rubs at 12 (mob thresholds). */
function tryInitSymptom(/** @type {Pregnancy} */ p) {
  if (p.phase >= 1 && p.craving >= 16 && p.symptoms.CRAVING === undefined) {
    p.symptoms.CRAVING = symptomSeverity('CRAVING', p.phase, p.lastPhase);
    p.cravingType = randomCraving();
  } else if (p.phase >= 2 && p.milking >= 12 && p.symptoms.MILKING === undefined) {
    p.symptoms.MILKING = 0;
  } else if (p.phase >= 3 && p.bellyRubs >= 12 && p.symptoms.BELLY_RUBS === undefined) {
    p.symptoms.BELLY_RUBS = 0;
  }
}

/** evaluateCravingTimer / evaluateMilkingTimer / evaluateBellyRubsTimer */
function evaluateNeeds(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  /** @param {'craving' | 'milking' | 'bellyRubs'} meter @param {(number | undefined)[]} table */
  const grow = (meter, table) => {
    const total = table[p.phase];
    if (total === undefined || p[meter] >= MAX_LEVEL) return;
    const timerKey = /** @type {'cravingTimer' | 'milkingTimer' | 'bellyRubsTimer'} */ (`${meter}Timer`);
    p[timerKey] += STEP;
    if (p[timerKey] >= total) {
      p[meter] = clampLevel(p[meter] + 1);
      p[timerKey] = 0;
    }
  };
  grow('craving', CRAVING_TICKS);
  grow('milking', MILKING_TICKS);
  grow('bellyRubs', BELLY_RUBS_TICKS);
  if (p.milking >= 12 && p.symptoms.MILKING !== undefined && system.currentTick % 300 < STEP) {
    particles(record.entity, 'minecraft:white_smoke_particle', 3, 1.2);
  }
}

/** P1 evaluatePregnancyHealing: pregnancy health comes back slowly. */
function evaluateHealing(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  if (p.health >= 100) return;
  p.healthTimer += STEP;
  if (p.healthTimer <= CONFIG.ticksForPregnancyHealing) return;
  p.health = Math.min(100, p.health + Math.ceil(CONFIG.pregnancyHealingAmount * (1 - CONFIG.pregnancyHealingReductionPerPhase * p.phase)));
  p.healthTimer = 0;
  particles(record.entity, 'minecraft:villager_happy', 5);
}

// --- miscarriage, labor and birth -------------------------------------------------------------

/** PreggoMobPregnancySystemP1.startMiscarriage (no miscarriage in P0). */
export function startMiscarriage(/** @type {MobRecord} */ record) {
  const p = record.data.pregnancy;
  if (!p || p.phase < 1 || (p.pain && (LABOR_PAINS.has(p.pain.type) || p.pain.type === 'MISCARRIAGE'))) return false;
  tryHurt(record);
  p.pain = { type: 'MISCARRIAGE', duration: TICKS.miscarriage, severity: 0, elapsed: 0 };
  tellOwner(record, 'chat.minepreggo.preggo_mob.miscarriage.message.init');
  record.entity.getComponent('minecraft:rideable')?.ejectRiders();
  record.save();
  return true;
}

function evaluateMiscarriage(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  const pain = /** @type {PainInstance} */ (p.pain);
  if (pain.elapsed < pain.duration) {
    pain.elapsed += STEP;
    particles(record.entity, 'minecraft:redstone_ore_dust_particle', 3, 0.4);
    return;
  }
  const family = /** @type {Family} */ (familyOf(record.entity));
  for (let i = 0; i < p.womb.length; i++) dropItem(record.entity, family.deadFetusItem);
  tellOwner(record, 'chat.minepreggo.preggo_mob.miscarriage.message.post');
  endPregnancy(record, 'MISCARRIAGE');
}

/** PreggoMobPregnancySystemP4.breakWater */
function breakWater(/** @type {MobRecord} */ record) {
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  tryHurt(record);
  p.pain = { type: 'WATER_BREAKING', duration: TICKS.waterBreaking, severity: 0, elapsed: 0 };
  tellOwner(record, 'chat.minepreggo.preggo_mob.birth.message.init');
  record.save();
}

/** Starts labor right away (commands): the last phase's days are treated as done. */
export function forceLabor(/** @type {MobRecord} */ record) {
  const p = record.data.pregnancy;
  if (!p || (p.pain && !COMMON_PAINS.has(p.pain.type))) return false;
  setPhase(record, p.lastPhase);
  p.daysPassed = p.daysByPhase[p.phase];
  breakWater(record);
  return true;
}

/** Potion of Pregnancy Acceleration on a mob (PregnancyAcceleration.applyEffectTick, mob branch). */
export function accelerate(/** @type {MobRecord} */ record, /** @type {number} */ amplifier) {
  const p = record.data.pregnancy;
  if (!p || (p.pain && (LABOR_PAINS.has(p.pain.type) || p.pain.type === 'MISCARRIAGE'))) return false;
  const result = advancePhases(p.daysByPhase, p.phase, p.daysPassed, accelerationDays(amplifier, CONFIG.totalPregnancyDays), p.lastPhase);
  if (result.phase !== p.phase) setPhase(record, result.phase);
  p.daysPassed = result.daysPassed;
  if (p.phase === p.lastPhase && p.daysPassed >= p.daysByPhase[p.phase] && p.phase >= 4) breakWater(record);
  else playSound(record.entity, 'minepreggo.stomach_growls');
  record.save();
  return true;
}

/** Potion of Gradual Pregnancy Acceleration on a mob: faster timer for `duration` ticks. */
export function accelerateGradually(/** @type {MobRecord} */ record, /** @type {number} */ amplifier, duration = 3600) {
  const p = record.data.pregnancy;
  if (!p || (p.pain && (LABOR_PAINS.has(p.pain.type) || p.pain.type === 'MISCARRIAGE'))) return false;
  p.acceleration = { amplifier, endTime: system.currentTick + duration };
  record.save();
  return true;
}

/** PreggoMobPregnancySystemP4.evaluateWaterBreaking / evaluateBirth: automatic, no pushing. */
function evaluateLabor(/** @type {MobRecord} */ record) {
  const { entity } = record;
  const p = /** @type {Pregnancy} */ (record.data.pregnancy);
  const pain = /** @type {PainInstance} */ (p.pain);
  const family = /** @type {Family} */ (familyOf(entity));
  const expired = pain.duration > -1 && pain.elapsed >= pain.duration;

  switch (pain.type) {
    case 'WATER_BREAKING':
      if (!expired) {
        pain.elapsed += STEP;
        particles(entity, 'minecraft:water_drip_particle', 3, 0.4);
        return;
      }
      // startLabor
      tryHurt(record);
      p.pain = { type: 'PREBIRTH', duration: PHASES[p.phase].preBirthTicks, severity: 0, elapsed: 0 };
      tellOwner(record, 'chat.minepreggo.preggo_mob.birth.message.warning');
      entity.getComponent('minecraft:rideable')?.ejectRiders();
      record.save();
      return;
    case 'PREBIRTH':
      if (!expired) {
        pain.elapsed += STEP;
        particles(entity, 'minecraft:water_drip_particle', 3, 0.4);
        return;
      }
      tryHurt(record);
      p.postBirthTicks = p.womb.length * postBirthTicks(family);
      p.originalBabies = p.womb.length;
      p.womb.shift();
      p.pain = { type: 'BIRTH', duration: -1, severity: 0, elapsed: 0 };
      p.birth = /** @type {any} */ ({ remaining: birthTicks(family), babiesBorn: 0 });
      tellOwner(record, 'chat.minepreggo.preggo_mob.birth.message.pre');
      record.save();
      return;
    case 'BIRTH': {
      const birth = /** @type {{ remaining: number, babiesBorn: number } | null} */ (/** @type {unknown} */ (p.birth));
      if (!birth) {
        p.pain = { type: 'POSTBIRTH', duration: p.postBirthTicks || 200, severity: 0, elapsed: 0 };
        record.save();
        return;
      }
      birth.remaining -= STEP;
      if (birth.remaining > 0) {
        particles(entity, 'minecraft:redstone_ore_dust_particle', 2, 0.4);
        return;
      }
      tryHurt(record);
      dropItem(entity, family.babyItem, true);
      particles(entity, 'minecraft:redstone_ore_dust_particle', 10, 0.4);
      playSound(entity, 'minepreggo.splash', 0.3);
      const next = p.womb.shift();
      p.birth = next ? /** @type {any} */ ({ remaining: birthTicks(family), babiesBorn: birth.babiesBorn + 1 }) : null;
      record.save();
      return;
    }
    case 'POSTBIRTH':
      if (!expired) {
        pain.elapsed += STEP;
        return;
      }
      tellOwner(record, 'chat.minepreggo.preggo_mob.birth.message.post');
      endPregnancy(record, 'PARTUM');
  }
}

// --- per-update logic --------------------------------------------------------------------------

/** One update of a pregnancy (PreggoMobPregnancySystemP0-P9.evaluatePregnancySystem). */
function tickPregnancy(/** @type {MobRecord} */ record) {
  const { entity, data } = record;
  const p = /** @type {Pregnancy} */ (data.pregnancy);
  record.dirty = true;
  const atLast = p.phase === p.lastPhase;
  const daysDone = p.daysPassed >= p.daysByPhase[p.phase];

  if (p.pain?.type === 'MISCARRIAGE') return evaluateMiscarriage(record);
  if (p.pain && LABOR_PAINS.has(p.pain.type)) return evaluateLabor(record);
  if (p.phase >= 4 && atLast && daysDone) return breakWater(record);

  if (p.phase >= 4 && record.moving && entity.isOnGround && !entity.getComponent('minecraft:riding')) {
    // Long walks bring on back pain (monster slime girls bounce: 5x as fast).
    const { species, creature } = /** @type {Family} */ (familyOf(entity));
    data.moveTimer += species === 'SLIME' && creature === 'MONSTER' ? STEP * 5 : STEP;
    if (data.moveTimer > 7200 - 350 * p.phase) {
      startCommonPain(record, 'BACK_PAIN', 'TIRENESS', PHASES[p.phase].backPainTicks);
      data.moveTimer = 0;
    }
  }
  if (p.phase >= 1) {
    tryInitSymptom(p);
    evaluateNeeds(record);
    evaluateHealing(record);
  }
  if (!p.pain) tryInitRandomPain(record);
  else evaluateCommonPain(record);
  if (p.phase >= 3 && Math.random() < 0.01) playSound(entity, 'minepreggo.stomach_growls', 0.2);

  // The clock stops once the birth phase is complete; a gradual acceleration speeds it up.
  if (!(atLast && daysDone)) {
    if (p.acceleration && system.currentTick >= p.acceleration.endTime) p.acceleration = null;
    p.timer += STEP * (p.acceleration ? gradualAccelerationSpeed(p.acceleration.amplifier, CONFIG.ticksPerPregnancyDay) : 1);
    if (p.timer >= CONFIG.ticksPerPregnancyDay) {
      p.timer -= CONFIG.ticksPerPregnancyDay;
      p.daysPassed++;
    }
  }
  if (p.daysPassed >= p.daysByPhase[p.phase] && !atLast) {
    setPhase(record, p.phase + 1);
    record.save();
  }
}

/** FemaleFertilitySystem: post-pregnancy recovery and post-partum lactation. */
function tickNotPregnant(/** @type {MobRecord} */ record) {
  const { data } = record;
  if (data.post) {
    data.post.timer += STEP;
    if (data.post.timer >= CONFIG.ticksOfPostPregnancyPhase) data.post = null;
    record.dirty = true;
  }
  const lactation = data.lactation;
  if (lactation) {
    if (lactation.level < MAX_LEVEL) {
      lactation.timer += STEP;
      if (lactation.timer >= CONFIG.postBirthLactationCooldown) {
        lactation.timer = 0;
        lactation.level = clampLevel(lactation.level + 1);
      }
    }
    lactation.elapsed += STEP;
    if (lactation.elapsed >= CONFIG.ticksOfPostPartumLactation) data.lactation = null;
    record.dirty = true;
  }
}

/** PreggoMobSystem: hunger, healing and the savage state of a tamed mob. */
function tickTamed(/** @type {MobRecord} */ record) {
  const { entity, data } = record;
  if (data.savage) {
    if (system.currentTick % 200 < STEP) particles(entity, 'minecraft:villager_angry', 2);
    return;
  }
  if (data.fullness > 0) {
    data.hungerTimer += STEP * (record.moving ? (entity.isInWater ? 4 : 2) : 1);
    if (data.hungerTimer >= hungerTicks(/** @type {Family} */ (familyOf(entity)), data.pregnancy ? data.pregnancy.phase : -1)) {
      data.fullness--;
      data.hungerTimer = 0;
      record.dirty = true;
    }
  }
  if (data.fullness <= 0) {
    becomeSavage(record);
    return;
  }
  // Heals 1 HP per second while well fed, at the cost of fullness.
  const hp = health(entity);
  if (hp && data.fullness >= FULLNESS.healAbove && hp.currentValue < hp.effectiveMax) {
    hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + 1));
    data.fullness--;
    record.dirty = true;
  }
}

export function becomeSavage(/** @type {MobRecord} */ record) {
  record.data.savage = true;
  record.entity.triggerEvent('minepreggo:become_savage');
  record.entity.getComponent('minecraft:rideable')?.ejectRiders();
  tellOwner(record, 'chat.minepreggo.preggo_mob.message.is_savage');
  record.save();
}

export function calmDown(/** @type {MobRecord} */ record) {
  record.data.savage = false;
  record.entity.triggerEvent('minepreggo:calm_down');
  tellOwner(record, 'chat.minepreggo.preggo_mob.message.is_no_longer_savage');
  record.save();
}

/** Hostile pregnant mobs: an incapacitation wears off after its cooldown. */
function tickWild(/** @type {MobRecord} */ record) {
  const wild = /** @type {import('./state.js').WildPregnancy} */ (record.data.wild);
  if (!wild.incapacitated) return;
  wild.painTimer += STEP;
  if (wild.painTimer > wild.cooldown) {
    wild.incapacitated = false;
    wild.painTimer = 0;
    delete wild.kick;
  }
  record.dirty = true;
}

/** What the client should show: the animation pose, fetal movement intensity and belly growth. */
function clientState(/** @type {MobRecord} */ record) {
  const { pregnancy: p, wild } = record.data;
  if (wild) return { pose: wild.incapacitated ? 'incapacitated' : 'none', kick: wild.incapacitated ? wild.kick ?? 1 : 1, growth: 0 };
  if (!p) return { pose: 'none', kick: 0, growth: 0 };
  const pain = /** @type {(PainInstance & { incapacitating?: boolean }) | null} */ (p.pain);
  let pose = pain ? POSE_OF_PAIN[pain.type] : p.symptoms.BELLY_RUBS !== undefined ? 'belly_rubs' : 'none';
  if (pain?.type === 'FETAL_MOVEMENT' && pain.incapacitating) pose = 'kicking_sit';
  // FetalMovement.getAnimation: severity 0 -> I, 1-2 -> II, 3+ -> III
  const severity = pain?.severity ?? 0;
  const kick = severity <= 0 ? 0 : severity < 3 ? 1 : 2;
  const days = p.daysByPhase[p.phase] || 1;
  const growth = Math.min(1, (p.daysPassed + p.timer / CONFIG.ticksPerPregnancyDay) / days);
  return { pose, kick, growth: Math.round(growth * 100) / 100 };
}

function syncClient(/** @type {MobRecord} */ record) {
  const { entity, sent } = record;
  const state = clientState(record);
  if (sent.pose !== state.pose) entity.setProperty('minepreggo:pose', (sent.pose = state.pose));
  if (sent.kick !== state.kick) entity.setProperty('minepreggo:kick', (sent.kick = state.kick));
  if (sent.growth !== state.growth) entity.setProperty('minepreggo:growth', (sent.growth = state.growth));
}

/** Whether a pain or labor keeps her from moving and fighting right now. */
export function isIncapacitated(/** @type {MobRecord} */ record) {
  const { pregnancy: p, wild } = record.data;
  if (wild) return wild.incapacitated;
  const pain = /** @type {(PainInstance & { incapacitating?: boolean }) | null | undefined} */ (p?.pain);
  return !!pain && (INCAPACITATING.has(pain.type) || !!pain.incapacitating);
}

function updateMovement(/** @type {MobRecord} */ record) {
  const { x, z } = record.entity.location;
  const last = record.lastPosition;
  record.moving = last !== undefined && (x - last.x) ** 2 + (z - last.z) ** 2 > 0.01;
  record.lastPosition = { x, z };
}

/** One update of a loaded preggo mob. */
export function tickMob(/** @type {Entity} */ entity) {
  const record = getRecord(entity);
  const { data } = record;
  if (!familyOf(entity)) return record;
  updateMovement(record);

  // A mob that spawned pregnant (natural spawn) gets her hostile pregnancy data once.
  if (!data.pregnancy && !data.wild && phaseProperty(entity) >= 0) initWild(record, phaseProperty(entity));

  if (data.pending && system.currentTick >= data.pending.endTick) {
    const { amplifier } = data.pending;
    data.pending = null;
    record.dirty = true;
    startPregnancy(record, babiesFromPotion(amplifier));
  }
  if (data.wild) tickWild(record);
  if (isTamed(entity)) tickTamed(record);
  if (data.pregnancy) tickPregnancy(record);
  else if (!data.wild) tickNotPregnant(record);

  if (entity.isValid) {
    if (isIncapacitated(record)) incapacitate(entity);
    syncClient(record);
    // Timers are saved every 5 s; state changes save right away.
    if (record.dirty && system.currentTick % 100 < STEP) record.save();
  }
  return record;
}

// --- damage and death --------------------------------------------------------------------------

/**
 * A hit on a preggo mob: hostile pregnant ones may be incapacitated (with a stomach growl),
 * pregnant tamed ones lose pregnancy health (PregnancyDamageHelper, same as players).
 * @param {Entity} entity
 * @param {{ damage: number, cause: string }} hit
 */
export function onHurt(entity, hit) {
  const record = getRecord(entity);
  const { data } = record;
  if (record.selfHurtTick === system.currentTick) return;
  if (data.wild && !data.wild.incapacitated && Math.random() < data.wild.painProbability) {
    data.wild.incapacitated = true;
    data.wild.painTimer = 0;
    playSound(entity, 'minepreggo.stomach_growls');
    record.save();
    return;
  }
  const p = data.pregnancy;
  if (!p || p.phase < 1 || (p.pain && (LABOR_PAINS.has(p.pain.type) || p.pain.type === 'MISCARRIAGE'))) return;
  const hp = health(entity);
  const maxHealth = hp?.effectiveMax ?? 20;
  const explosion = hit.cause === 'entityExplosion' || hit.cause === 'blockExplosion';
  const damage = pregnancyDamage(p.phase, p.lastPhase, { explosion, healthBeforeHit: (hp?.currentValue ?? 0) + hit.damage, maxHealth });
  if (damage <= 0) return;
  p.health = Math.max(0, p.health - damage);
  if (p.health <= 0) startMiscarriage(record);
  else if (p.health < 40) tellOwner(record, 'chat.minepreggo.preggo_mob.miscarriage.message.warning');
  record.save();
}

/** Death while pregnant: one dead fetus per baby still inside (Java may spawn baby mobs; not ported). */
export function onDeath(/** @type {Entity} */ entity) {
  const record = records.get(entity.id);
  const family = familyOf(entity);
  if (!record || !family) return;
  const count = record.data.pregnancy?.womb.length ?? record.data.wild?.babies ?? 0;
  for (let i = 0; i < count; i++) dropItem(entity, family.deadFetusItem);
  if (count > 0) playSound(entity, 'minepreggo.pregnant_preggo_mob_death');
  records.delete(entity.id);
}

/**
 * WorldEventHandler.onSleepFinished: skipping the night moves loaded pregnancies forward, but never
 * past the end of the current phase.
 */
export function onNightSkipped(/** @type {number} */ ticksSkipped) {
  for (const record of records.values()) {
    const p = record.data.pregnancy;
    if (!p || !record.entity.isValid) continue;
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

export { records };
