// A clutch of kobold eggs (the item places it, tools/gen/kobold-egg.mjs): up to four eggs that crack
// over time and hatch, one at a time, into the kobold's baby item (babies are items, never mobs).
// Every minute each clutch has a chance to crack further, better with a kobold nearby to brood it;
// after two cracks the next one hatches an egg. Using an egg on a clutch adds it; breaking the
// clutch gives its eggs back.

import { GameMode, ItemStack, system } from '@minecraft/server';

/** @typedef {import('@minecraft/server').Block} Block */
/** @typedef {import('@minecraft/server').Player} Player */

export const EGG = 'minepreggo:kobold_egg';
export const BABY = 'minepreggo:baby_kobold';
const KOBOLD = 'jhkobold:kobold';
export const CRACK_CHANCE = 0.15;
/** A kobold nearby broods the clutch: it cracks twice as often. */
export const BROODING_CHANCE = 0.3;
const MAX_EGGS = 4;

const state = (/** @type {Block} */ block, /** @type {string} */ name) => Number(block.permutation.getState(/** @type {any} */ (`minepreggo:${name}`)) ?? 0);
const setState = (/** @type {Block} */ block, /** @type {Record<string, number>} */ states) => {
  let permutation = block.permutation;
  for (const [name, value] of Object.entries(states)) permutation = permutation.withState(/** @type {any} */ (`minepreggo:${name}`), value);
  block.setPermutation(permutation);
};

/** The baby, or a human one when the Jenny add-ons (her baby item) are not in this build. */
function babyStack() {
  try {
    return new ItemStack(BABY, 1);
  } catch {
    return new ItemStack('minepreggo:baby_human', 1);
  }
}

/** One minute of the clutch: maybe a crack, and after two cracks a hatch. Returns what happened. */
export function tickClutch(/** @type {Block} */ block, random = Math.random) {
  const center = block.center();
  let brooding = false;
  try {
    brooding = block.dimension.getEntities({ type: KOBOLD, location: center, maxDistance: 6 }).length > 0;
  } catch {
    // unloaded
  }
  if (random() >= (brooding ? BROODING_CHANCE : CRACK_CHANCE)) return 'none';
  const cracks = state(block, 'cracks');
  if (cracks < 2) {
    setState(block, { cracks: cracks + 1 });
    block.dimension.playSound('block.turtle_egg.crack', center);
    return 'cracked';
  }
  // the egg hatches: the baby comes out as her baby item, and the rest of the clutch waits
  const eggs = state(block, 'eggs');
  block.dimension.spawnItem(babyStack(), center);
  block.dimension.playSound('block.turtle_egg.hatch', center);
  try {
    block.dimension.spawnParticle('minecraft:crop_growth_emitter', center);
  } catch {
    // no particle here
  }
  for (const player of block.dimension.getPlayers({ location: center, maxDistance: 16 })) player.onScreenDisplay.setActionBar({ translate: 'minepreggo.egg.hatched' });
  if (eggs <= 1) block.setType('minecraft:air');
  else setState(block, { eggs: eggs - 1, cracks: 0 });
  return 'hatched';
}

/** An egg in hand used on a clutch joins it (up to four). */
export function addEgg(/** @type {Block} */ block, /** @type {Player} */ player) {
  const equipment = /** @type {any} */ (player.getComponent('minecraft:equippable'));
  const held = equipment?.getEquipment('Mainhand');
  if (held?.typeId !== EGG) return false;
  const eggs = state(block, 'eggs');
  if (eggs >= MAX_EGGS) return false;
  setState(block, { eggs: eggs + 1 });
  if (player.getGameMode?.() !== GameMode.Creative) {
    if (held.amount > 1) {
      held.amount -= 1;
      equipment.setEquipment('Mainhand', held);
    } else equipment.setEquipment('Mainhand', undefined);
  }
  block.dimension.playSound('block.turtle_egg.drop', block.center());
  return true;
}

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent('minepreggo:kobold_egg', {
    onTick: ({ block }) => void tickClutch(block),
    onPlayerInteract: ({ block, player }) => {
      if (player) addEgg(block, player);
    },
    onPlayerBreak: ({ block, brokenBlockPermutation, player }) => {
      if (player?.getGameMode?.() === GameMode.Creative) return;
      const eggs = Number(brokenBlockPermutation.getState(/** @type {any} */ ('minepreggo:eggs')) ?? 1);
      block.dimension.spawnItem(new ItemStack(EGG, eggs), block.center());
    },
  });
});
