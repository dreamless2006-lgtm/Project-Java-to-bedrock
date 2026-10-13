// Shows the player's gender and pregnancy on the player model (Java: CustomPregnantBodyLayer,
// PredefinedPregnantBodyLayer and the boobs layers read the player capability on the client).
// Bedrock clients only see entity properties, so packs/behavior/entities/player.json overrides
// the player with the same properties the preggo mobs have (plus gender and skin type) and this
// file keeps them in sync with the PlayerRecord; packs/resource/entity/player.entity.json renders
// the converted body layers from them.

import { system, world } from '@minecraft/server';
import { CONFIG } from '../pregnancy/data.js';
import { getRecord } from '../pregnancy/system.js';

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
  if (!p || gender !== 'female') return { phase: -1, pose: 'none', kick: 0, growth: 0, gender, skin: record.skin };
  const pain = p.pain;
  const pose = pain ? POSE_OF_PAIN[pain.type] ?? 'none' : p.symptoms.BELLY_RUBS !== undefined ? 'belly_rubs' : 'none';
  // FetalMovement.getAnimation: severity 0 -> I, 1-2 -> II, 3+ -> III
  const severity = pain?.severity ?? 0;
  const kick = severity <= 0 ? 0 : severity < 3 ? 1 : 2;
  const days = p.daysByPhase[p.phase] || 1;
  const growth = Math.min(1, (p.daysPassed + p.timer / CONFIG.ticksPerPregnancyDay) / days);
  return { phase: p.phase, pose, kick, growth: Math.round(growth * 100) / 100, gender, skin: record.skin };
}

/** Writes the visuals to the player's entity properties, only the ones that changed. */
export function syncBody(/** @type {PlayerRecord} */ record) {
  const { player } = record;
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
