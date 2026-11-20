// Port of net.minecraft.world.level.block.CropBlock as used by Minepreggo's ChilipepperBlock and
// CucumberBlock: growth on random ticks (same speed formula as Java) and bone meal.

import { system, EquipmentSlot, GameMode } from '@minecraft/server';

const AGE = 'minepreggo:age';
const MAX_AGE = 7;
const MIN_LIGHT = 9;
// Java runs 3 random ticks per chunk section per game tick, Bedrock 1 per sub-chunk, so each
// Bedrock random tick is given 3 Java-sized chances to keep growth time in line with Java.
const JAVA_RANDOM_TICKS_PER_BEDROCK_TICK = 3;

/**
 * @param {import('@minecraft/server').Block} block
 * @returns {number}
 */
function getAge(block) {
  return /** @type {number} */ (block.permutation.getState(/** @type {any} */ (AGE)));
}

/**
 * @param {import('@minecraft/server').Block} block
 * @param {number} age
 */
function setAge(block, age) {
  block.setPermutation(block.permutation.withState(/** @type {any} */ (AGE), Math.min(age, MAX_AGE)));
}

/**
 * Java CropBlock.getGrowthSpeed: farmland under and around the crop speeds it up, wet farmland
 * more so; crops of the same type planted in a cross or diagonal pattern halve it.
 * @param {import('@minecraft/server').Block} block
 * @returns {number}
 */
function growthSpeed(block) {
  let speed = 1;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const soil = block.offset({ x: dx, y: -1, z: dz });
      let bonus = 0;
      if (soil?.typeId === 'minecraft:farmland') {
        const moisture = /** @type {number} */ (soil.permutation.getState('moisturized_amount') ?? 0);
        bonus = moisture > 0 ? 3 : 1;
      }
      speed += dx === 0 && dz === 0 ? bonus : bonus / 4;
    }
  }

  const same = (/** @type {number} */ dx, /** @type {number} */ dz) => block.offset({ x: dx, y: 0, z: dz })?.typeId === block.typeId;
  const rowX = same(-1, 0) || same(1, 0);
  const rowZ = same(0, -1) || same(0, 1);
  const diagonal = same(-1, -1) || same(1, -1) || same(1, 1) || same(-1, 1);
  if ((rowX && rowZ) || diagonal) speed /= 2;
  return speed;
}

/** @param {import('@minecraft/server').Block} block */
function tryGrow(block) {
  const age = getAge(block);
  if (age >= MAX_AGE) return;
  if (Math.max(block.getLightLevel(), block.getSkyLightLevel()) < MIN_LIGHT) return;
  const oneIn = Math.floor(25 / growthSpeed(block)) + 1;
  for (let i = 0; i < JAVA_RANDOM_TICKS_PER_BEDROCK_TICK; i++) {
    if (Math.random() * oneIn < 1) return setAge(block, age + 1);
  }
}

/**
 * @param {import('@minecraft/server').Block} block
 * @param {import('@minecraft/server').Player} player
 */
function tryBoneMeal(block, player) {
  const equipment = player.getComponent('minecraft:equippable');
  const held = equipment?.getEquipment(EquipmentSlot.Mainhand);
  if (held?.typeId !== 'minecraft:bone_meal') return;

  const age = getAge(block);
  if (age >= MAX_AGE) return;
  // Java CropBlock.getBonemealAgeIncrease: uniform 2..5 stages.
  setAge(block, age + 2 + Math.floor(Math.random() * 4));

  if (player.getGameMode() !== GameMode.Creative) {
    if (held.amount > 1) {
      held.amount -= 1;
      equipment?.setEquipment(EquipmentSlot.Mainhand, held);
    } else {
      equipment?.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  }
  const center = block.center();
  block.dimension.spawnParticle('minecraft:crop_growth_emitter', center);
  block.dimension.playSound('item.bone_meal.use', center);
}

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent('minepreggo:crop', {
    onRandomTick: ({ block }) => tryGrow(block),
    onPlayerInteract: ({ block, player }) => {
      if (player) tryBoneMeal(block, player);
    },
  });
});
