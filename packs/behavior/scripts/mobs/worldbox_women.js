// World Alliance's women (tools/import-wa-women.mjs): each humanoid unit of the add-on is rolled a
// woman or a man the first time it appears (half of each), on the minepreggo:female property
// (0 not yet, 1 a man, 2 a woman; written here, because the client sees only properties the script
// API writes). Her hurt, death and removal reach the mob system like our own mobs' (whose events
// filter by type, and World Alliance's types hold both sexes).
import { world } from '@minecraft/server';
import { familyOf, forgetRecord, onDeath, onHurt } from './system.js';

const PROPERTY = 'minepreggo:female';

/** Rolls a unit's sex once; units without the property (its animals, its vehicles) are left alone. */
function roll(/** @type {import('@minecraft/server').Entity} */ entity) {
  if (!entity.typeId.startsWith('worldbox:')) return;
  try {
    if (entity.getProperty(PROPERTY) !== 0) return;
    entity.setProperty(PROPERTY, !entity.getComponent('minecraft:is_baby') && Math.random() < 0.5 ? 2 : 1);
  } catch {
    // no such property, or the unit is gone
  }
}

world.afterEvents.entitySpawn.subscribe(({ entity }) => roll(entity));
world.afterEvents.entityLoad.subscribe(({ entity }) => roll(entity));

const isHers = (/** @type {import('@minecraft/server').Entity} */ entity) => entity.typeId.startsWith('worldbox:') && familyOf(entity) !== undefined;
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => {
  if (isHers(hurtEntity)) onHurt(hurtEntity, { damage, cause: damageSource.cause });
});
world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (deadEntity.typeId.startsWith('worldbox:')) onDeath(deadEntity);
});
world.afterEvents.entityRemove.subscribe(({ removedEntityId, typeId }) => {
  if (typeId?.startsWith('worldbox:')) forgetRecord(removedEntityId);
});
