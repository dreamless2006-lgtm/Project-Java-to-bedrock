// Shows the player's gender and pregnancy on the player model (Java: CustomPregnantBodyLayer,
// PredefinedPregnantBodyLayer and the boobs layers read the player capability on the client).
// Bedrock clients only see entity properties, so packs/behavior/entities/player.json overrides
// the player with the same properties the preggo mobs have (plus gender and skin type) and this
// file keeps them in sync with the PlayerRecord; packs/resource/entity/player.entity.json renders
// the converted body layers from them.

import { system, world } from '@minecraft/server';
import { CONFIG } from '../pregnancy/data.js';
import { getRecord, pushProgress } from '../pregnancy/system.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../pregnancy/state.js').PlayerRecord} PlayerRecord */

const SYNC_TICKS = 5;

/** Pains and symptoms to the minepreggo:pose values the client animates (same list as the mobs). */
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

let warned = false;

/** What the client should show for a player. */
export function playerVisuals(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  const gender = record.gender ?? 'unset';
  if (!p || gender !== 'female') return { phase: -1, pose: 'none', kick: 0, growth: 0, gender, skin: record.skin, navel: false };
  const pain = p.pain;
  // Rubbing (crouch + look down) plays Java's BELLY_RUBBING_Px arm animation; the belly-rub need
  // shows the belly animation; pains map to the labor/pain body animations.
  const pose = pain ? POSE_OF_PAIN[pain.type] ?? 'none' : record.bellyRubTicks > 0 ? 'rubbing' : p.symptoms.BELLY_RUBS !== undefined ? 'belly_rubs' : 'none';
  // FetalMovement.getAnimation: severity 0 -> I, 1-2 -> II, 3+ -> III
  const severity = pain?.type === 'PREBIRTH' || pain?.type === 'BIRTH' ? 4 : pain?.severity ?? 0; // hardest kicks on the way out
  const kick = severity <= 0 ? 0 : severity < 3 ? 1 : 2;
  const days = p.daysByPhase[p.phase] || 1;
  let growth = Math.min(1, (p.daysPassed + p.timer / CONFIG.ticksPerPregnancyDay) / days);
  // During birth the growth property carries the push progress of the current baby.
  if (pain?.type === 'BIRTH' && p.birth) growth = pushProgress(record) / 100;
  // Ender babies are born through the navel (a Bedrock addition): the client plays the navel animations.
  const navel = p.womb.includes('ENDER') || p.father === 'ENDER';
  return { phase: p.phase, pose, kick, growth: Math.round(growth * 100) / 100, gender, skin: record.skin, navel };
}

/** Writes the visuals to the player's entity properties, only the ones that changed. */
/** Forces the client state for `ticks` (the debug command). */
export function debugPose(/** @type {PlayerRecord} */ record, /** @type {string} */ pose, /** @type {number} */ kick, ticks = 200, phase = -1) {
  record.debugUntil = system.currentTick + ticks;
  record.player.setProperty('minepreggo:pose', pose);
  record.player.setProperty('minepreggo:kick', kick);
  // The kicks live in the P3+ bellies and P0-P2 are flat: a small or absent belly becomes a big
  // one for the duration; syncBody restores the real phase afterwards.
  if (phase >= 0) record.player.setProperty('minepreggo:phase', phase);
  else if (Number(record.player.getProperty('minepreggo:phase')) < 3) record.player.setProperty('minepreggo:phase', 7);
  record.sentVisuals = {};
}

/** Ends a forced client state: the real values are written back at once. */
export function clearDebug(/** @type {PlayerRecord} */ record) {
  record.debugUntil = 0;
  record.sentVisuals = {};
  syncBody(record);
}

export function syncBody(/** @type {PlayerRecord} */ record) {
  const { player } = record;
  if ((record.debugUntil ?? 0) > system.currentTick) return;
  const state = playerVisuals(record);
  const sent = (record.sentVisuals ??= {});
  try {
    for (const [key, value] of Object.entries(state)) {
      if (sent[key] === value) continue;
      player.setProperty(`minepreggo:${key}`, value);
      sent[key] = value;
    }
  } catch (error) {
    // Another pack that overrides the player entity drops our properties; the game still runs.
    if (!warned) {
      warned = true;
      console.warn(`[minepreggo] player properties unavailable, body visuals are off: ${error}`);
    }
  }
}

system.runInterval(() => {
  for (const player of world.getPlayers()) syncBody(getRecord(player));
}, SYNC_TICKS);
