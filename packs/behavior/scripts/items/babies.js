// Babies are carried as items (no baby mobs). Using one cuddles it: hearts around you and a word on
// the action bar with its name, ours (a human, zombie, creeper, ender or slime baby), the Jenny
// girls' own (tools/import-jenny.mjs gives each of them a baby in her colours) and the other mothers'
// (tools/gen/children.mjs). A baby is stamped with its birth; a Minecraft day later, crouch and use it
// and it has grown up: a grown son or daughter in its mother's colours (minepreggo:grown_child, an
// adult), tamed to you, who follows you and fights for you. Never pregnant, never in a scene.
import { EquipmentSlot, system, world } from '@minecraft/server';
import { lineOf } from './lines.js';

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

const BORN = 'minepreggo:born';
/** A Minecraft day: how long a baby takes to grow up. */
export const GROWING_TICKS = 24000;
const SONS = ['Alex', 'Ben', 'Caleb', 'Dorian', 'Eli', 'Finn', 'Gabe', 'Hugo', 'Ivan', 'Jasper', 'Kai', 'Leo', 'Milo', 'Noah', 'Owen', 'Rowan', 'Silas', 'Theo'];
const DAUGHTERS = ['Ada', 'Bella', 'Clara', 'Daphne', 'Ember', 'Freya', 'Gwen', 'Hazel', 'Iris', 'Juno', 'Lyra', 'Maya', 'Nora', 'Olive', 'Piper', 'Rose', 'Sage', 'Wren'];
const pick = (/** @type {string[]} */ names) => names[Math.floor(Math.random() * names.length)];

/** Stamps a baby item with its birth (babies are one to a stack, so each keeps its own). */
export function stampBirth(/** @type {import('@minecraft/server').ItemStack} */ stack) {
  try {
    if (BABY.test(stack.typeId)) stack.setDynamicProperty(BORN, world.getAbsoluteTime());
  } catch {
    // not a stack that keeps properties
  }
  return stack;
}

/**
 * The baby in a crouching player's hand grows up when a day old (a baby with no birth stamp, given or
 * from before, is old enough): the grown child stands by them, tamed to them. Returns whether it did.
 */
export function growUp(/** @type {import('@minecraft/server').Player} */ player) {
  const slot = player.getComponent('minecraft:equippable')?.getEquipmentSlot(EquipmentSlot.Mainhand);
  const stack = slot?.getItem();
  if (!slot || !stack || !BABY.test(stack.typeId)) return false;
  const born = stack.getDynamicProperty(BORN);
  const age = typeof born === 'number' ? world.getAbsoluteTime() - born : GROWING_TICKS;
  if (age < GROWING_TICKS) {
    player.onScreenDisplay.setActionBar({ translate: 'minepreggo.child.too_young', with: [String(Math.max(1, Math.ceil((GROWING_TICKS - age) / 1200)))] });
    return false;
  }
  const daughter = Math.random() < 0.5;
  const name = pick(daughter ? DAUGHTERS : SONS);
  const child = player.dimension.spawnEntity('minepreggo:grown_child', player.location);
  child.setProperty('minepreggo:line', lineOf(stack.typeId));
  child.setProperty('minepreggo:daughter', daughter);
  child.nameTag = name;
  if (!child.getComponent('minecraft:tameable')?.tame(player)) child.triggerEvent('minepreggo:tamed');
  slot.setItem(undefined);
  const { x, y, z } = player.location;
  for (let i = 0; i < 8; i++) {
    try {
      player.dimension.spawnParticle('minecraft:heart_particle', { x: x + (Math.random() - 0.5) * 1.4, y: y + 1 + Math.random(), z: z + (Math.random() - 0.5) * 1.4 });
    } catch {
      // unloaded
    }
  }
  player.playSound('random.levelup');
  player.sendMessage({ translate: daughter ? 'minepreggo.child.daughter' : 'minepreggo.child.son', with: [name] });
  return true;
}

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (source?.typeId !== 'minecraft:player' || !itemStack) return;
  if (source.isSneaking && BABY.test(itemStack.typeId)) {
    if (!growUp(source)) cuddle(source, itemStack.typeId);
    return;
  }
  cuddle(source, itemStack.typeId);
});
