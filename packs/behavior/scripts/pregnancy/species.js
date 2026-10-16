// What carrying another species does to the mother (Java: the Full Of Zombies / Creepers /
// Enders / Slimes effects, applied by PlayerHelper.addInterspeciesPregnancy for the whole
// pregnancy, and the player event handlers that read them). Bedrock has no custom effects, so
// the father species in the pregnancy data stands in for the effect.
//
//   ZOMBIE  - burns in daylight without a helmet, like a zombie (FullOfZombies.tryBurn)
//   ENDER   - from time to time the babies teleport her 8-16(+phase) blocks away (FullOfEnders)
//   SLIME   - the babies cushion falls (PlayerEventHandler.onFall), on top of the extra fall
//             damage every pregnancy takes from P3 (PregnancySystemHelper.calculateExtraFallDamageMultiplier)
//   CREEPER - dying from P3 on explodes (PlayerHelper.calculateExplosionLevelByPregnancyPhase)
// Dying from P3 on also drops a dead fetus per baby (spawnBabiesOrFetuses; baby mobs are not ported).

import { EntityDamageCause, EquipmentSlot, ItemStack, system, world } from '@minecraft/server';
import { SPECIES } from './data.js';
import { sigmoid } from './math.js';
import { getRecord, isInvincible, playSound } from './system.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('./state.js').PlayerRecord} PlayerRecord */

const STEP = 20;
const TELEPORT_PERIOD = 2400;

/** How many babies of `species` are in the womb. */
const count = (/** @type {PlayerRecord} */ record, /** @type {string} */ species) => record.pregnancy?.womb.filter((b) => b === species).length ?? 0;

/** FullOfZombies.tryBurn: daytime, sky above, no helmet, not wet. Java rolls every tick (~4 %), here once a second. */
function tickZombies(/** @type {PlayerRecord} */ record) {
  const { player } = record;
  if (isInvincible(player) || player.isInWater) return;
  const time = world.getTimeOfDay();
  if (time > 12000) return; // night
  const helmet = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Head);
  if (helmet) return;
  let block;
  try {
    block = player.dimension.getBlock({ x: player.location.x, y: player.location.y + 1, z: player.location.z });
  } catch {
    return;
  }
  if (!block || block.getSkyLightLevel() < 15) return;
  if (Math.random() < 0.55) player.setOnFire(8, true);
}

/** FullOfEnders: every 2 minutes, chance = phase progress x share of ender babies. */
function tickEnders(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p || world.getAbsoluteTime() % TELEPORT_PERIOD !== 0) return;
  const progress = p.phase / Math.max(1, p.lastPhase);
  const enders = count(record, 'ENDER') / Math.max(1, p.womb.length);
  if (Math.random() >= Math.min(1, progress * enders)) return;
  randomTeleport(record.player, 8, 16 + Math.floor(Math.random() * (p.phase + 1)));
}

/** LivingEntityHelper.randomTeleport: a random spot between `min` and `max` blocks away with room to stand. */
function randomTeleport(/** @type {Player} */ player, /** @type {number} */ min, /** @type {number} */ max) {
  const { dimension, location } = player;
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = min + Math.random() * (max - min);
    const x = Math.floor(location.x + Math.cos(angle) * distance) + 0.5;
    const z = Math.floor(location.z + Math.sin(angle) * distance) + 0.5;
    for (let dy = 4; dy >= -4; dy--) {
      const y = Math.floor(location.y) + dy;
      try {
        const feet = dimension.getBlock({ x, y, z });
        const head = dimension.getBlock({ x, y: y + 1, z });
        const floor = dimension.getBlock({ x, y: y - 1, z });
        if (!feet?.isAir || !head?.isAir || !floor || floor.isAir || floor.isLiquid) continue;
      } catch {
        continue;
      }
      playSound(player, 'mob.endermen.portal', 0.8);
      player.teleport({ x, y, z });
      playSound(player, 'minepreggo.stomach_growls');
      return true;
    }
  }
  return false;
}

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const record = getRecord(player);
    const p = record.pregnancy;
    if (!p || p.father === 'HUMAN') continue;
    if (p.father === 'ZOMBIE' && count(record, 'ZOMBIE') > 0) tickZombies(record);
    if (p.father === 'ENDER') tickEnders(record);
  }
}, STEP);

/**
 * Fall damage: from P3 every pregnancy takes 1-1.6x (sigmoid over the phases); slime babies
 * cushion it (max(0.2, 1 - babies x 0.1 - progress x 0.15)). Bedrock reports the hit after the
 * fact, so the difference is applied (extra damage) or healed back (cushioning).
 */
world.afterEvents.entityHurt.subscribe(
  ({ hurtEntity, damage, damageSource }) => {
    if (damageSource.cause !== EntityDamageCause.fall || hurtEntity.typeId !== 'minecraft:player') return;
    const player = /** @type {Player} */ (hurtEntity);
    const record = getRecord(player);
    const p = record.pregnancy;
    if (!p || p.phase < 3 || isInvincible(player)) return;
    if (record.effects.zeroGravity) return; // Zero Gravity Belly: the belly weighs nothing
    let factor = sigmoid(1.0, 1.6, 1.0, p.phase, 5);
    const slimes = count(record, 'SLIME');
    if (slimes > 0) {
      const progress = p.phase / Math.max(1, p.lastPhase);
      factor *= Math.max(0.2, 1 - (slimes * 0.1 + progress * 0.15));
    }
    const wanted = damage * factor;
    const health = player.getComponent('minecraft:health');
    if (!health) return;
    if (wanted > damage + 0.5) {
      record.selfHurtTick = system.currentTick; // not counted against the pregnancy twice
      player.applyDamage(wanted - damage, { cause: EntityDamageCause.fall });
    } else if (wanted < damage - 0.5) {
      health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + (damage - wanted)));
    }
  },
  { entityTypes: ['minecraft:player'] }
);

/** PlayerEventHandler.onDeath: fetuses drop from P3, and a creeper pregnancy goes off. */
world.afterEvents.entityDie.subscribe(
  ({ deadEntity }) => {
    if (deadEntity.typeId !== 'minecraft:player') return;
    const player = /** @type {Player} */ (deadEntity);
    const record = getRecord(player);
    const p = record.pregnancy;
    if (!p || p.phase < 3) return;
    const { dimension, location } = player;
    try {
      if (count(record, 'CREEPER') > 0) {
        const level = Math.min(3, Math.round((p.phase * 3) / 9)); // calculateExplosionLevelByPregnancyPhase
        dimension.createExplosion(location, level + 1, { source: player, causesFire: false });
      }
      for (const species of p.womb) dimension.spawnItem(new ItemStack(SPECIES[species].deadBabyItem, 1), location);
      playSound(player, 'minepreggo.pregnant_preggo_mob_death', 0.8);
    } catch {
      // unloaded dimension
    }
  },
  { entityTypes: ['minecraft:player'] }
);
