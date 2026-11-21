// Vanilla mobs impregnate a female player by attacking her (Java: PlayerHelper.tryImpregnateByMobAttack
// and FemalePlayerImpl.tryImpregnateByHurting). Each hit that passes the 65 % roll counts; after
// 8 zombie, 2 creeper, 10 enderman or 6 slime hits she is impregnated with that species, 15 s
// later like a potion. The fertility cycle of the mod is not ported, so every hit can count.

import { world } from '@minecraft/server';
import { babiesFromPotion } from './math.js';
import { getRecord, message } from './system.js';

/** @typedef {import('@minecraft/server').Player} Player */

/** Vanilla attackers and the species they father. */
export const ATTACKERS = /** @type {Record<string, import('./data.js').Species>} */ ({
  'minecraft:zombie': 'ZOMBIE',
  'minecraft:husk': 'ZOMBIE',
  'minecraft:drowned': 'ZOMBIE',
  'minecraft:zombie_villager': 'ZOMBIE',
  'minecraft:zombie_villager_v2': 'ZOMBIE',
  'minecraft:creeper': 'CREEPER',
  'minecraft:enderman': 'ENDER',
  'minecraft:slime': 'SLIME',
});
/** Hits of a species it takes (FemalePlayerImpl.tryImpregnateByHurting). */
export const HITS_NEEDED = /** @type {Partial<Record<import('./data.js').Species, number>>} */ ({ ZOMBIE: 8, CREEPER: 2, ENDER: 10, SLIME: 6 });
const IMPREGNATION_TICKS = 300;

/**
 * @param {import('./state.js').PlayerRecord} record
 * @param {import('@minecraft/server').Entity} attacker
 * @param {() => number} [random]
 * @returns {boolean} whether this hit impregnated her
 */
export function onAttacked(record, attacker, random = Math.random) {
  const species = ATTACKERS[attacker.typeId];
  if (!species || !record.isFemale() || record.pregnancy || record.female.post || record.pending) return false;
  if (attacker.getComponent('minecraft:is_baby')) return false;
  if (random() >= 0.65) return false;
  const attacks = (record.attacks ??= {});
  attacks[species] = (attacks[species] ?? 0) + 1;
  if (attacks[species] < (HITS_NEEDED[species] ?? Infinity)) return false;
  attacks[species] = 0;
  record.pending = { amplifier: random() < 0.5 ? 0 : 1, father: species, endTime: world.getAbsoluteTime() + IMPREGNATION_TICKS, ticksLeft: IMPREGNATION_TICKS };
  record.save();
  message(record.player, 'minepreggo.attack_impregnation', [{ translate: `entity.${attacker.typeId}.name` }]);
  return true;
}

world.afterEvents.entityHurt.subscribe(
  ({ hurtEntity, damageSource }) => {
    const attacker = damageSource.damagingEntity;
    if (!attacker || hurtEntity.typeId !== 'minecraft:player') return;
    onAttacked(getRecord(/** @type {Player} */ (hurtEntity)), attacker);
  },
  { entityTypes: ['minecraft:player'] }
);

export { babiesFromPotion };
