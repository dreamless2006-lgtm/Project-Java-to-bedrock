// The women of other add-ons' mobs, through Minepreggo's compatibility add-ons for them
// (tools/compat-addons.mjs). With World Alliance's installed, each humanoid unit of World Alliance is
// rolled a woman or a man the first time it appears (half of each), on the minepreggo:female property
// (0 not yet, 1 a man, 2 a woman; written here, because the client sees only properties the script API
// writes); Girl Mob's girls are women from the start. Their hurt, death and removal reach the mob
// system like our own mobs' (whose events filter by our types).
import { world } from '@minecraft/server';
import { FAMILIES } from './families.js';
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

// (any other add-on's mob of ours: our own mobs' events are wired in mobs/index.js)
const theirs = (/** @type {string | undefined} */ typeId) => typeId !== undefined && !FAMILIES[typeId] && typeId !== 'minecraft:player';
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => {
  if (theirs(hurtEntity.typeId) && familyOf(hurtEntity)) onHurt(hurtEntity, { damage, cause: damageSource.cause });
});
world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (theirs(deadEntity.typeId)) onDeath(deadEntity);
});
world.afterEvents.entityRemove.subscribe(({ removedEntityId, typeId }) => {
  if (theirs(typeId)) forgetRecord(removedEntityId);
});
