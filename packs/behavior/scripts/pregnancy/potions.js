// The mod's other potions, on the player (world/effect/PregnancyDelay, BabyDuplication,
// PregnancyHealing, PregnancyHarming, PregnancyResistance, ZeroGravityBelly, MetabolismControl and
// the Eternal Pregnancy effect). Bedrock has no custom mob effects, so the timed ones live in the
// player record (record.effects, persisted) and the pregnancy code reads them from there:
//   resistance  - hits do no pregnancy damage (PregnancyDamageHelper returns 0 with the effect)
//   zeroGravity - the belly weighs nothing: no phase slowdown, no extra fall damage
//   metabolism  - saturation refills by 0.25 x level every 10 ticks (MetabolismControl.applyEffectTick)
//   eternal     - birth never comes (AbstractPregnancySystem.canGiveBirth); milk ends it

import { EntityDamageCause, Player, system, world } from '@minecraft/server';
import { CONFIG } from './data.js';
import { accelerationDays, distributeExtraDays, duplicateBabies as planDuplication } from './math.js';
import { getRecord, isLaborOrMisbirth, message, particle, playSound, tryInitMiscarriage } from './system.js';

/** @typedef {import('./state.js').PlayerRecord} PlayerRecord */
/** @typedef {'resistance' | 'zeroGravity' | 'metabolism' | 'eternal'} PotionEffect */

/** Durations of the mod's potions (MinepreggoPotions), in ticks. */
export const DURATIONS = { resistance: 9600, longResistance: 19200, zeroGravity: 9600, longZeroGravity: 19200, metabolism: 6000, longMetabolism: 12000 };

/** The mod's effect names, for messages. */
export const EFFECT_LANG = {
  resistance: 'effect.minepreggo.pregnancy_resistance',
  zeroGravity: 'effect.minepreggo.zero_gravity_belly',
  metabolism: 'effect.minepreggo.metabolism_control',
  eternal: 'effect.minepreggo.eternal_pregnancy',
};

/** PregnancyDelay: the same 7 % of the pregnancy per level that acceleration skips, added to the phases still to come. */
export function delayPregnancy(/** @type {PlayerRecord} */ record, /** @type {number} */ amplifier) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return 0;
  const days = accelerationDays(amplifier, CONFIG.totalPregnancyDays);
  distributeExtraDays(p, days);
  record.dirty = true;
  playSound(record.player, 'minepreggo.stomach_growls');
  return days;
}

/** BabyDuplication: level + 1 more babies (10 at most), a later birth and a jump forward. Returns the babies added. */
export function duplicateBabies(/** @type {PlayerRecord} */ record, /** @type {number} */ amplifier) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return 0;
  const before = p.womb.length;
  const phase = planDuplication(p, amplifier, CONFIG.totalPregnancyDays);
  if (phase < 0) return 0;
  if (phase !== p.phase) {
    p.phase = phase;
    p.daysPassed = 0;
    p.timer = 0;
  }
  record.dirty = true;
  playSound(record.player, 'minepreggo.stomach_growls');
  return p.womb.length - before;
}

/** PregnancyHealing: pregnancy health back to 100, with hearts. */
export function healPregnancy(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p) return false;
  p.health = 100;
  p.healthTimer = 0;
  record.dirty = true;
  for (let i = 0; i < 12; i++) particle(record.player, 'minecraft:heart_particle', 0.4 + Math.random() * 0.6);
  return true;
}

/** PregnancyHarming: 30 pregnancy health and 1 heart lost; at 0 the pregnancy miscarries. */
export function harmPregnancy(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p || isLaborOrMisbirth(p)) return false;
  p.health = Math.max(0, p.health - 30);
  record.dirty = true;
  playSound(record.player, 'minepreggo.pregnancy_pain');
  record.selfHurtTick = system.currentTick; // not counted against the pregnancy a second time
  record.player.applyDamage(1, { cause: EntityDamageCause.magic });
  if (p.health <= 0) tryInitMiscarriage(record);
  return true;
}

/**
 * Starts (or extends) a timed effect. Like vanilla, a stronger Metabolism Control replaces a weaker
 * one and a longer one extends it.
 * @param {PlayerRecord} record
 * @param {PotionEffect} effect
 * @param {number} ticks
 * @param {number} [amplifier]
 */
export function applyPotionEffect(record, effect, ticks, amplifier = 0) {
  const e = record.effects;
  if (effect === 'eternal') e.eternal = true;
  else if (effect === 'metabolism') {
    const current = e.metabolism;
    if (!current || amplifier > current.amplifier || (amplifier === current.amplifier && ticks > current.ticks)) e.metabolism = { ticks, amplifier };
  } else e[effect] = Math.max(ticks, e[effect] ?? 0);
  record.dirty = true;
}

/** @param {PlayerRecord} record @param {PotionEffect} effect */
export function hasPotionEffect(record, effect) {
  const e = record.effects;
  if (effect === 'eternal') return !!e.eternal;
  if (effect === 'metabolism') return (e.metabolism?.ticks ?? 0) > 0;
  return (e[effect] ?? 0) > 0;
}

/** Milk (a bucket, or the mod's breast milk) ends every potion effect. Returns whether there was one. */
export function curePotionEffects(/** @type {PlayerRecord} */ record) {
  const had = Object.keys(record.effects).length > 0;
  record.effects = {};
  record.dirty = true;
  return had;
}

/** MetabolismControl.applyEffectTick: saturation climbs by 0.25 x level, never above the food level. */
function refillSaturation(/** @type {Player} */ player, /** @type {number} */ amplifier) {
  const saturation = player.getComponent('minecraft:player.saturation');
  const hunger = player.getComponent('minecraft:player.hunger');
  if (!saturation || !hunger || saturation.currentValue <= 0) return;
  saturation.setCurrentValue(Math.min(hunger.currentValue, saturation.currentValue + 0.25 * (amplifier + 1)));
}

/** Runs the timed effects down by one tick; what remains is saved every 5 s. */
export function tickPotionEffects(/** @type {PlayerRecord} */ record) {
  const e = record.effects;
  const ended = (/** @type {PotionEffect} */ effect) => {
    record.dirty = true;
    message(record.player, 'minepreggo.potion.effect_ended', [{ translate: EFFECT_LANG[effect] }]);
  };
  for (const key of /** @type {('resistance' | 'zeroGravity')[]} */ (['resistance', 'zeroGravity'])) {
    const left = e[key];
    if (left === undefined) continue;
    if (left <= 1) {
      delete e[key];
      ended(key);
    } else e[key] = left - 1;
  }
  const m = e.metabolism;
  if (m) {
    if (m.ticks % 10 === 0) refillSaturation(record.player, m.amplifier);
    if (m.ticks <= 1) {
      delete e.metabolism;
      ended('metabolism');
    } else m.ticks--;
  }
  if (system.currentTick % 100 === 0 && (e.resistance || e.zeroGravity || e.metabolism)) record.dirty = true;
}

// A bucket of milk clears the mod's effects too, as it clears vanilla ones.
world.afterEvents.itemCompleteUse.subscribe(({ source, itemStack }) => {
  if (itemStack.typeId !== 'minecraft:milk_bucket' || !(source instanceof Player)) return;
  if (curePotionEffects(getRecord(source))) message(source, 'minepreggo.potion.cured');
});
