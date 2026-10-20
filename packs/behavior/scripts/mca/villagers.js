// Minecraft Comes Alive's women (tools/import-mca.mjs): each gets one of MCA's women's names the
// first time she is seen, unless a player named her. The names are generated at import time
// (scripts/mca_port/names.js); without them she keeps the game's name for her.
import { world } from '@minecraft/server';

const WOMAN = 'mca:villager_woman';
/** @type {string[]} */
let names = [];
import('../mca_port/names.js').then((m) => (names = m.NAMES)).catch(() => {});

function name(/** @type {import('@minecraft/server').Entity} */ entity) {
  if (entity.typeId !== WOMAN || !names.length || entity.nameTag) return;
  try {
    entity.nameTag = names[Math.floor(Math.random() * names.length)];
  } catch {
    // removed before the name was given
  }
}
world.afterEvents.entitySpawn.subscribe(({ entity }) => name(entity));
world.afterEvents.entityLoad.subscribe(({ entity }) => name(entity));
