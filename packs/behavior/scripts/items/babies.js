// Babies are carried as items (no baby mobs). Using one cuddles it: hearts around you and a word on
// the action bar with its name, ours (a human, zombie, creeper, ender or slime baby) and the Jenny
// girls' own (tools/import-jenny.mjs gives each of them a baby in her colours).
import { system, world } from '@minecraft/server';

/** A baby item: every minepreggo:baby_* but the Potion of Baby Duplication. */
export const BABY = /^minepreggo:baby_(?!duplication)[a-z_]+$/;
const COOLDOWN = 20;
/** @type {Map<string, number>} player id -> tick of their last cuddle */
const last = new Map();

/** Cuddles the baby a player holds; returns whether it did. */
export function cuddle(/** @type {import('@minecraft/server').Player} */ player, /** @type {string} */ typeId) {
  if (!BABY.test(typeId)) return false;
  if (system.currentTick - (last.get(player.id) ?? -COOLDOWN) < COOLDOWN) return false;
  last.set(player.id, system.currentTick);
  const { x, y, z } = player.location;
  for (let i = 0; i < 4; i++) {
    try {
      player.dimension.spawnParticle('minecraft:heart_particle', { x: x + (Math.random() - 0.5) * 0.8, y: y + 1.6 + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.8 });
    } catch {
      // unloaded
    }
  }
  player.onScreenDisplay.setActionBar({ translate: 'minepreggo.baby.cuddle', with: { rawtext: [{ translate: `item.${typeId.replace(':', '.')}` }] } });
  return true;
}

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (source?.typeId === 'minecraft:player' && itemStack) cuddle(source, itemStack.typeId);
});
