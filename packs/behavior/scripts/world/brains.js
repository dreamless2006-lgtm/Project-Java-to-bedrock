// Villagers, illagers and witches killed by a player drop their brain (Java global loot
// modifiers villager_brain_loot, illager_brain_loot and witch_brain_loot). Brains tame and feed
// zombie girls.

import { ItemStack, world } from '@minecraft/server';

/** @type {Record<string, string>} */
const BRAINS = {
  'minecraft:villager': 'minepreggo:villager_brain',
  'minecraft:villager_v2': 'minepreggo:villager_brain',
  'minecraft:wandering_trader': 'minepreggo:villager_brain',
  'minecraft:pillager': 'minepreggo:illager_brain',
  'minecraft:vindicator': 'minepreggo:illager_brain',
  'minecraft:evocation_illager': 'minepreggo:illager_brain',
  'minecraft:witch': 'minepreggo:witch_brain',
};

world.afterEvents.entityDie.subscribe(
  ({ deadEntity, damageSource }) => {
    if (damageSource.damagingEntity?.typeId !== 'minecraft:player') return;
    const brain = BRAINS[deadEntity.typeId];
    if (brain) deadEntity.dimension.spawnItem(new ItemStack(brain, 1), deadEntity.location);
  },
  { entityTypes: Object.keys(BRAINS) }
);
