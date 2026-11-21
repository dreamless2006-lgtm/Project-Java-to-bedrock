// Bedrock can't add custom mob effects, so the Java pregnancy effects (PregnancyP0-P9, pains,
// symptoms, labor) are expressed as vanilla effects derived from the player's state and
// refreshed every second with a short duration. If the add-on stops, they simply run out.

import { PHASE_SLOWNESS } from './data.js';

/** @typedef {import('./state.js').PlayerRecord} PlayerRecord */

const REFRESH_TICKS = 60;
/** Slowness amplifier at which Bedrock movement speed reaches zero (Java's -100 % labor modifiers). */
const IMMOBILE = 6;

/** Extra slowness levels for pains (Java: -10..-30 % speed modifiers on top of the phase). */
const PAIN_SLOWNESS = { FETAL_MOVEMENT: 1, CONTRACTION: 1, BACK_PAIN: 2, WATER_BREAKING: 2 };
/** Weakness amplifiers used by the labor effects (PreBirth, Birth, PostBirth, Miscarriage). */
const LABOR_WEAKNESS = { PREBIRTH: 2, BIRTH: 3, POSTBIRTH: 3, MISCARRIAGE: 4 };

/**
 * Wanted amplifier per vanilla effect for this player, -1 for none.
 * @param {PlayerRecord} record
 * @returns {{ slowness: number, weakness: number, nausea: number }}
 */
export function desiredEffects(record) {
  const wanted = { slowness: -1, weakness: -1, nausea: -1 };
  const p = record.pregnancy;
  if (!p) {
    // Rehabilitation after birth or miscarriage: -10 % speed in Java.
    if (record.female.post) wanted.slowness = 0;
    return wanted;
  }
  const pain = p.pain?.type;
  wanted.slowness = record.effects.zeroGravity ? -1 : PHASE_SLOWNESS[p.phase]; // Zero Gravity Belly: no weight
  if (pain && pain in PAIN_SLOWNESS) {
    const extra = PAIN_SLOWNESS[/** @type {keyof typeof PAIN_SLOWNESS} */ (pain)];
    wanted.slowness = wanted.slowness < 0 ? extra - 1 : wanted.slowness + extra;
  }
  if (pain && pain in LABOR_WEAKNESS) {
    wanted.slowness = IMMOBILE;
    wanted.weakness = LABOR_WEAKNESS[/** @type {keyof typeof LABOR_WEAKNESS} */ (pain)];
  }
  if (pain === 'CONTRACTION' || p.symptoms.CRAVING !== undefined) wanted.weakness = Math.max(wanted.weakness, 0);
  if (pain === 'MORNING_SICKNESS') wanted.nausea = 0;
  return wanted;
}

/**
 * Applies `desiredEffects`. Only effects this system added (short remaining duration) are ever
 * removed, so potions and beacons the player has are left alone.
 * @param {PlayerRecord} record
 */
export function applyEffects(record) {
  const { player } = record;
  const wanted = desiredEffects(record);
  for (const [effect, amplifier] of Object.entries(wanted)) {
    const current = player.getEffect(effect);
    const ours = current !== undefined && current.duration <= REFRESH_TICKS;
    if (amplifier < 0) {
      if (ours) player.removeEffect(effect);
      continue;
    }
    if (current && !ours && current.amplifier >= amplifier) continue; // a longer effect already covers it
    if (ours && current.amplifier > amplifier) player.removeEffect(effect);
    player.addEffect(effect, REFRESH_TICKS, { amplifier, showParticles: false });
  }
}
