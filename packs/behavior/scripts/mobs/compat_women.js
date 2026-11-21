// The women of other add-ons' mobs, through Minepreggo's compatibility add-ons for them
// (tools/compat-addons.mjs). With World Alliance's installed, each humanoid unit of World Alliance is
// rolled a woman or a man the first time it appears (half of each), on the minepreggo:female property
// (0 not yet, 1 a man, 2 a woman; written here, because the client sees only properties the script API
// writes); Girl Mob's girls are women from the start. Their hurt, death and removal reach the mob
// system like our own mobs' (whose events filter by our types).
import { system, world } from '@minecraft/server';
import { babiesFromPotion } from '../pregnancy/math.js';
import { FAMILIES } from './families.js';
import { POKEMON_WOMEN } from './pokemon.js';
import { accelerateGradually, familyOf, forgetRecord, getRecord, onDeath, onHurt, startPregnancy } from './system.js';

const PROPERTY = 'minepreggo:female';

/** Rolls a unit's sex once; units without the property (its animals, its vehicles) are left alone. */
function roll(/** @type {import('@minecraft/server').Entity} */ entity) {
  try {
    // a baby is never with child, whatever its spawn event rolled (its add-on's babies share its events)
    if (entity.getComponent('minecraft:is_baby') && /** @type {number} */ (entity.getProperty('minepreggo:phase') ?? -1) >= 0) entity.setProperty('minepreggo:phase', -1);
    // (a Pokémon by her kind's share of females: tools/compat-addons.mjs pokedrock)
    const chance = entity.typeId.startsWith('worldbox:') ? 0.5 : POKEMON_WOMEN[entity.typeId]?.female;
    if (chance === undefined) return;
    if (entity.getProperty(PROPERTY) !== 0) return;
    entity.setProperty(PROPERTY, !entity.getComponent('minecraft:is_baby') && Math.random() < chance ? 2 : 1);
  } catch {
    // no such property, or the unit is gone
  }
}

// Girl Mob's scenes: a defeated girl ridden by a player turns back into her girl when he gets off
// (tools/compat-addons.mjs), tagged: she comes out of it pregnant, at the strongest gradual
// acceleration (the Potion of Gradual Pregnancy Acceleration IV's)
const AFTER_SCENE = 'minepreggo_after_scene';
const MAX_GRADUAL = 4;
function afterScene(/** @type {import('@minecraft/server').Entity} */ entity) {
  if (!entity.isValid || !entity.hasTag(AFTER_SCENE)) return;
  entity.removeTag(AFTER_SCENE);
  if (!familyOf(entity)) return;
  const record = getRecord(entity);
  if (record.data.pregnancy) return;
  startPregnancy(record, babiesFromPotion(1));
  accelerateGradually(record, MAX_GRADUAL);
}

world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
  roll(entity);
  // (the transformation's own command tags her at the end of the tick)
  if (cause === 'Transformed') system.runTimeout(() => afterScene(entity), 2);
});
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
