// What players can do to a preggo mob by interacting with her (Java: the mobInteract chains of the
// tamable classes, PreggoMobSystem feeding, the pregnancy systems' onRightClick and
// FemaleFertilitySystem milking). Taming itself and sitting are left to the vanilla components.
//
// Order for the owner of a tamed mob, as in Java:
//   1. glass bottle -> milk (pregnant P2+ with milking >= 5, or post-partum lactation >= 5)
//   2. crouching with an empty hand -> belly touch (rubs relieve the P3+ need)
//   3. her food -> satisfy a craving and/or feed her (fullness)
// A Potion of Impregnation works on a mob that isn't pregnant or recovering: given by anyone to a
// wild one (Java: splash potions), by the owner to a tamed one. The acceleration potions work the
// same way on a pregnant mob.

import { EquipmentSlot, GameMode, ItemStack, system, world } from '@minecraft/server';
import { CRAVING_LANG } from '../pregnancy/data.js';
import { clampLevel } from '../pregnancy/state.js';
import { FULLNESS } from './families.js';
import { accelerate, accelerateGradually, calmDown, familyOf, getRecord, induceFetalMovement, isIncapacitated, isTamed, nameOf, onEatSpicyFood, particles, playSound } from './system.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('./state.js').MobRecord} MobRecord */

const IMPREGNATION_TICKS = 300;
const POTION = /^minepreggo:(?:(zombie|creeper|ender|slime|villager)_)?impregnation_potion_(\d)$/;
/** Which species potion a family accepts besides the human one (Java: the potion converts her own species only). */
const POTION_SPECIES = { ZOMBIE: 'zombie', CREEPER: 'creeper', ENDER: 'ender', SLIME: 'slime' };
const ACCELERATION = /^minepreggo:(gradual_)?pregnancy_acceleration_potion_(\d)$/;
const INDUCER = /^minepreggo:fetal_movement_inducer_potion_(\d)$/;

/** Uses up one of the item in the player's main hand (not in creative), optionally leaving `remainder`. */
function consumeHeld(/** @type {Player} */ player, /** @type {string | undefined} */ remainder = undefined) {
  if (player.getGameMode() === GameMode.Creative) return;
  const equipment = player.getComponent('minecraft:equippable');
  const held = equipment?.getEquipment(EquipmentSlot.Mainhand);
  if (!equipment || !held) return;
  if (held.amount > 1) {
    held.amount--;
    equipment.setEquipment(EquipmentSlot.Mainhand, held);
    if (remainder) give(player, remainder);
  } else {
    equipment.setEquipment(EquipmentSlot.Mainhand, remainder ? new ItemStack(remainder, 1) : undefined);
  }
}

function give(/** @type {Player} */ player, /** @type {string} */ item) {
  const leftover = player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(item, 1));
  if (leftover) player.dimension.spawnItem(leftover, player.location);
}

/** The owner is recorded the first time anyone interacts with her after taming (only the tamer can). */
function isOwner(/** @type {MobRecord} */ record, /** @type {Player} */ player) {
  if (!isTamed(record.entity)) return false;
  if (!record.data.owner) {
    record.data.owner = player.id;
    record.dirty = true;
  }
  return record.data.owner === player.id;
}

/** P2+ / post-partum: fill a glass bottle with the species' milk. */
function milk(/** @type {MobRecord} */ record, /** @type {Player} */ player) {
  const family = familyOf(record.entity);
  const { pregnancy: p, lactation } = record.data;
  if (!family) return;
  consumeHeld(player);
  give(player, family.milkItem);
  playSound(record.entity, 'mob.cow.milk', 0.8);
  particles(record.entity, 'minecraft:white_smoke_particle', 6, 1.2);
  if (p) {
    p.milking = clampLevel(p.milking - 5);
    if (p.milking <= 8) delete p.symptoms.MILKING;
  } else if (lactation) {
    lactation.level = clampLevel(lactation.level - 5);
  }
  record.save();
}

/** A belly touch: the pat sound from P2 and relief of the belly-rubs need from P3. */
function touchBelly(/** @type {MobRecord} */ record) {
  const p = record.data.pregnancy;
  if (!p) return;
  if (p.phase >= 2) playSound(record.entity, 'minepreggo.belly_touch', 0.7);
  if (p.phase >= 3 && p.symptoms.BELLY_RUBS !== undefined) {
    p.bellyRubs = clampLevel(p.bellyRubs - 4);
    if (p.bellyRubs <= 8) delete p.symptoms.BELLY_RUBS;
    particles(record.entity, 'minecraft:heart_particle', 3);
  }
  record.save();
}

/** Craving check and feeding with one of her foods. */
function feed(/** @type {MobRecord} */ record, /** @type {Player} */ player, /** @type {string} */ item) {
  const family = familyOf(record.entity);
  if (!family) return;
  const { data, entity } = record;
  const p = data.pregnancy;
  const craving = family.cravings[item];
  const severity = p?.symptoms.CRAVING;
  let nutrition = family.foods[item];

  if (p && severity !== undefined && p.cravingType && p.craving > 2) {
    if (craving?.craving === p.cravingType) {
      p.craving = clampLevel(p.craving - craving.gratification);
      if (p.craving <= 2) {
        delete p.symptoms.CRAVING;
        p.cravingType = null;
      }
      particles(entity, 'minecraft:heart_particle', 4);
    } else {
      // Not what she craves: she's annoyed and the food does her less good.
      particles(entity, 'minecraft:villager_angry', 3);
      nutrition = Math.max(1, nutrition - (severity + 1) * 2);
      if (Math.random() < 0.3) {
        ownerMessage(record, `chat.minepreggo.preggo_mob.pregnancy.message.craving.unsatisfied.${1 + Math.floor(Math.random() * 3)}`, CRAVING_LANG[p.cravingType]);
      }
    }
  }
  if (craving?.craving === 'SPICY') onEatSpicyFood(record);

  if (data.fullness < FULLNESS.eatBelow || craving) {
    consumeHeld(player);
    data.fullness = Math.min(FULLNESS.max, data.fullness + nutrition);
    playSound(entity, 'random.eat', 0.8);
    particles(entity, 'minecraft:heart_particle', 2);
    if (data.savage && data.fullness >= FULLNESS.calmAt) calmDown(record);
  }
  record.save();
}

/** Owner chat with the mob's name and a translated craving as the two arguments. */
function ownerMessage(/** @type {MobRecord} */ record, /** @type {string} */ key, /** @type {string} */ cravingKey) {
  const name = nameOf(record.entity);
  const owner = record.data.owner ? world.getEntity(record.data.owner) : undefined;
  if (owner?.typeId === 'minecraft:player') {
    /** @type {Player} */ (owner).sendMessage({ translate: key, with: { rawtext: [name, { translate: cravingKey }] } });
  }
}

/** Potion of Impregnation: like Java's Impregnation effect, the pregnancy starts 15 s later. */
function givePotion(/** @type {MobRecord} */ record, /** @type {Player} */ player, /** @type {number} */ amplifier) {
  consumeHeld(player, 'minecraft:glass_bottle');
  record.data.pending = { endTick: system.currentTick + IMPREGNATION_TICKS, amplifier };
  playSound(record.entity, 'random.drink', 0.8);
  particles(record.entity, 'minecraft:mobspell_emitter', 4);
  record.save();
}

/**
 * Decides what an interaction does, without changing anything (before events are read-only).
 * @param {Player} player
 * @param {Entity} target
 * @param {ItemStack | undefined} item
 * @returns {(() => void) | undefined}
 */
export function chooseAction(player, target, item) {
  const family = familyOf(target);
  if (!family) return undefined;
  const record = getRecord(target);
  const { data } = record;
  const id = item?.typeId;

  const tamed = isTamed(target);
  if (tamed && !isOwner(record, player)) return undefined;
  const potion = id?.match(POTION);
  if (potion) {
    if (data.pregnancy || data.wild || data.post || data.pending) return undefined;
    if (potion[1] && potion[1] !== POTION_SPECIES[family.species]) {
      return () => {
        consumeHeld(player, 'minecraft:glass_bottle');
        target.applyDamage(1);
        particles(target, 'minecraft:villager_angry', 2);
      };
    }
    return () => givePotion(record, player, Number(potion[2]));
  }
  const acceleration = id?.match(ACCELERATION);
  if (acceleration) {
    if (!data.pregnancy) return undefined;
    const amplifier = Number(acceleration[2]);
    return () => {
      const applied = acceleration[1] ? accelerateGradually(record, amplifier) : accelerate(record, amplifier);
      if (!applied) return;
      consumeHeld(player, 'minecraft:glass_bottle');
      playSound(record.entity, 'random.drink', 0.8);
    };
  }
  const inducer = id?.match(INDUCER);
  if (inducer) {
    if (!data.pregnancy) return undefined;
    return () => {
      if (!induceFetalMovement(record, Number(inducer[1]) * 2)) return;
      consumeHeld(player, 'minecraft:glass_bottle');
      playSound(record.entity, 'random.drink', 0.8);
    };
  }
  if (!tamed) return undefined;
  if (isIncapacitated(record)) return () => particles(target, 'minecraft:villager_angry', 2);

  const p = data.pregnancy;
  if (id === 'minecraft:glass_bottle') {
    const canMilk = p ? p.phase >= 2 && p.milking >= 5 : (data.lactation?.level ?? 0) >= 5;
    return canMilk ? () => milk(record, player) : undefined;
  }
  if (!id && player.isSneaking && p) return () => touchBelly(record);
  if (id && family.foods[id] !== undefined) {
    const craving = p?.symptoms.CRAVING !== undefined && p.craving > 2;
    if (data.fullness < FULLNESS.eatBelow || craving || data.savage) return () => feed(record, player, id);
  }
  return undefined;
}

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const action = chooseAction(event.player, event.target, event.itemStack);
  if (!action) return;
  event.cancel = true;
  system.run(action);
});

// Record who tamed her. Vanilla taming happens during the interaction, but the tamed component
// group may only be applied a moment later, so the owner is confirmed a few ticks after.
world.afterEvents.playerInteractWithEntity.subscribe(({ player, target, beforeItemStack }) => {
  const family = familyOf(target);
  if (!family || !beforeItemStack || !family.tamingItems.includes(beforeItemStack.typeId)) return;
  const record = getRecord(target);
  if (record.data.owner) return;
  system.runTimeout(() => {
    if (!target.isValid || record.data.owner || !isTamed(target)) return;
    record.data.owner = player.id;
    record.save();
  }, 2);
});
