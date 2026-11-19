// Wires the preggo mob systems into the game: one update per mob every STEP ticks, and the hurt,
// death and removal events.

import { system, world } from '@minecraft/server';
import { FAMILIES } from './families.js';
import { FAMILY_TAG, STEP, familyOf, forgetRecord, onDeath, onHurt, tickMob } from './system.js';
import './interact.js';
import './worldbox_women.js';

const DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];
const MOB_TYPES = Object.keys(FAMILIES);

system.runInterval(() => {
  for (const id of DIMENSIONS) {
    for (const entity of world.getDimension(id).getEntities({ families: [FAMILY_TAG] })) {
      // (World Alliance's men carry the family too: its peoples are one type for both sexes)
      if (!entity.isValid || !familyOf(entity)) continue;
      try {
        tickMob(entity);
      } catch (error) {
        console.warn(`[minepreggo] ${entity.typeId} update failed: ${error}`);
      }
    }
  }
}, STEP);

world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage, damageSource }) => onHurt(hurtEntity, { damage, cause: damageSource.cause }), {
  entityTypes: MOB_TYPES,
});

world.afterEvents.entityDie.subscribe(({ deadEntity }) => onDeath(deadEntity), { entityTypes: MOB_TYPES });

world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => forgetRecord(removedEntityId), { entityTypes: MOB_TYPES });
