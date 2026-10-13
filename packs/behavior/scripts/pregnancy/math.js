// Formulas of the pregnancy system: utils/MathHelper, PregnancyProbabilityHelper,
// PregnancyPainInstanceFactory, PregnancySymptomInstanceFactory, PregnancyDamageHelper,
// PregnancyPhaseMap and the baby-count helpers of PregnancySystemHelper.
// Pure functions; `random` is injectable so tests can make them deterministic.

import { BABIES_BY_FINAL_PHASE, CRAVING_WEIGHTS, MAX_BABIES, MAX_PHASE, PHASE_DAY_WEIGHTS } from './data.js';

/** @typedef {() => number} Random */
/** @typedef {import('./data.js').Craving} Craving */
/** @typedef {'MORNING_SICKNESS' | 'FETAL_MOVEMENT' | 'CONTRACTION' | 'BACK_PAIN'} CommonPain */
/** @typedef {'CRAVING' | 'MILKING' | 'BELLY_RUBS'} Symptom */
/** @typedef {'NATURAL' | 'DAMAGE' | 'FOOD' | 'TIRENESS'} PainCause */

const clamp = (/** @type {number} */ x, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, x));

/** MathHelper.sigmoid */
export function sigmoid(/** @type {number} */ yMin, /** @type {number} */ yMax, /** @type {number} */ k, /** @type {number} */ x, /** @type {number} */ x0) {
  return yMin + (yMax - yMin) / (1 + Math.exp(-k * (x - x0)));
}

/** MathHelper.asymmetricGaussian */
function asymmetricGaussian(/** @type {number} */ yMin, /** @type {number} */ yMax, /** @type {number} */ x, /** @type {number} */ center, /** @type {number} */ sigmaRise, /** @type {number} */ sigmaFall) {
  const sigma = x <= center ? sigmaRise : sigmaFall;
  const d = x - center;
  return yMin + (yMax - yMin) * Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** PregnancyProbabilityHelper.globalSeverity */
const globalSeverity = (/** @type {number} */ finalPhase) => finalPhase / MAX_PHASE;

/** PregnancyProbabilityHelper.effectiveK */
function effectiveK(/** @type {number} */ finalPhase) {
  const lateBoost = finalPhase < 5 ? 0 : (finalPhase - 5) / (MAX_PHASE - 5);
  return 7 + 8 * globalSeverity(finalPhase) + 6 * lateBoost;
}

/** PregnancyProbabilityHelper.normalizeLocalPhase */
export function normalizeLocalPhase(/** @type {number} */ current, /** @type {number} */ finalPhase) {
  if (finalPhase < current) return 1;
  return finalPhase === 0 ? 0 : clamp(current / finalPhase, 0, 1);
}

/** PregnancyProbabilityHelper.normalizePhase (local weight 0.3, global weight 0.7) */
export function normalizePhase(/** @type {number} */ current, /** @type {number} */ finalPhase) {
  const phase = current - finalPhase > 1 ? finalPhase : current;
  const realNorm = phase / Math.max(finalPhase, 1);
  const globalNorm = phase / MAX_PHASE;
  return clamp(realNorm * 0.3 + globalNorm * 0.7, 0, 1);
}

/** PregnancyProbabilityHelper.calculate(current, P9): how close the pregnancy is to the end. */
const globalProximity = (/** @type {number} */ current) => sigmoid(0, 1, effectiveK(MAX_PHASE), normalizeLocalPhase(current, MAX_PHASE), 0.5);

function combinedFactor(/** @type {number} */ current, /** @type {number} */ finalPhase, /** @type {[number, number, number]} */ [g, l, s]) {
  return globalProximity(current) * g + normalizeLocalPhase(current, finalPhase) * l + globalSeverity(finalPhase) * s;
}

const CAUSE_FACTOR = { NATURAL: 1.0, FOOD: 1.1, TIRENESS: 1.2, DAMAGE: 1.4 };

/**
 * PregnancyPainInstanceFactory.createCommon
 * @param {CommonPain} pain
 * @param {number} current
 * @param {number} finalPhase
 * @param {PainCause} cause
 * @param {number} baseDuration
 * @param {Random} [random]
 * @returns {{ duration: number, severity: number }}
 */
export function createCommonPain(pain, current, finalPhase, cause, baseDuration, random = Math.random) {
  const proximity = globalProximity(current);
  const combined = combinedFactor(current, finalPhase, [0.7, 0.2, 0.1]);

  let scale = 1;
  if (pain === 'MORNING_SICKNESS') scale = asymmetricGaussian(0.05, 0.9, combined, normalizePhase(2, finalPhase), 0.33, 0.1);
  else scale = sigmoid(0, 1, 7, combined, normalizePhase(current, finalPhase));

  const raw = (pain === 'MORNING_SICKNESS' ? 1 - proximity : proximity) * 4 * CAUSE_FACTOR[cause];
  const severity = clamp(Math.round(raw), 0, 4);

  if (baseDuration <= 0) return { duration: 0, severity };
  const variation = 1 + random() * 0.3;
  const calculated = Math.round(baseDuration * scale * (1 + severity * 0.25) * variation);
  const duration = clamp(calculated, Math.trunc(baseDuration * 0.1), Math.trunc(baseDuration * 1.4));
  return { duration, severity };
}

/** Phase whose arrival centres each symptom's severity curve (PregnancySymptomInstanceFactory). */
const SYMPTOM_CENTER = { CRAVING: 0, MILKING: 2, BELLY_RUBS: 3 };

/** PregnancySymptomInstanceFactory.create: severity 0-4 */
export function symptomSeverity(/** @type {Symptom} */ symptom, /** @type {number} */ current, /** @type {number} */ finalPhase) {
  const combined = combinedFactor(current, finalPhase, [0.7, 0.2, 0.1]);
  const scale = sigmoid(0, 1, 7, combined, normalizePhase(SYMPTOM_CENTER[symptom], finalPhase));
  return clamp(Math.round(globalProximity(current) * scale * 4), 0, 4);
}

/**
 * PregnancyDamageHelper.calculate: how much pregnancy health a hit costs, or 0 if none.
 * Java ignores hits at P0 and, unless it is an explosion, while health is above 60 %.
 * @param {number} current
 * @param {number} finalPhase
 * @param {{ explosion: boolean, healthBeforeHit: number, maxHealth: number }} hit
 * @param {Random} [random]
 */
export function pregnancyDamage(current, finalPhase, hit, random = Math.random) {
  if (current === 0) return 0;
  if (!hit.explosion && hit.healthBeforeHit >= hit.maxHealth * 0.6) return 0;
  const rawDamage = (hit.explosion ? 10 : 0) + 1 + Math.floor(random() * (current + 1));
  const combined = combinedFactor(current, finalPhase, [0.5, 0.3, 0.2]);
  const scale = sigmoid(0.5, 2, 7, combined, normalizePhase(current, finalPhase));
  return Math.max(1, Math.round(rawDamage * scale));
}

/**
 * PregnancyPhaseMap(totalDays, lastPhase): days spent in each phase P0..lastPhase.
 * @returns {number[]}
 */
export function daysByPhase(/** @type {number} */ totalDays, /** @type {number} */ lastPhase) {
  const weights = PHASE_DAY_WEIGHTS[/** @type {4|5|6|7|8|9} */ (Math.max(4, Math.min(MAX_PHASE, lastPhase)))];
  const days = weights.map((w) => Math.round(Math.fround(totalDays * Math.fround(w))));
  const rest = totalDays - days.reduce((a, b) => a + b, 0);
  if (rest > 0) days[days.length - 1] += rest;
  return days;
}

/** PregnancySystemHelper.getMinPhaseForNumOfBabies */
export function finalPhaseForBabies(/** @type {number} */ babies) {
  for (const [phase, counts] of Object.entries(BABIES_BY_FINAL_PHASE)) {
    if (counts.includes(babies)) return Number(phase);
  }
  return MAX_PHASE;
}

/** PregnancySystemHelper.calculateNumOfBabiesByPotion */
export function babiesFromPotion(/** @type {number} */ amplifier, random = Math.random) {
  const phase = Math.min(4 + Math.abs(amplifier), MAX_PHASE);
  const counts = BABIES_BY_FINAL_PHASE[/** @type {4|5|6|7|8|9} */ (phase)];
  return counts[Math.floor(random() * counts.length)];
}

export const clampBabies = (/** @type {number} */ n) => clamp(Math.trunc(n), 1, MAX_BABIES);

/** PregnancySystemHelper.getRandomCraving @returns {Craving} */
export function randomCraving(random = Math.random) {
  const roll = random();
  let cumulative = 0;
  for (const [craving, weight] of CRAVING_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return craving;
  }
  return 'SALTY';
}
