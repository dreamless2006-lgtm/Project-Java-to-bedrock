// Wires the pregnancy engine into the game: the per-tick loop, the status HUD and the events
// that feed it (PlayerEventHandler, WorldEventHandler, FoodDataMixin and the key bindings of
// the Java mod). Java's keys become gestures: crouch to see the status, crouch and look down to
// rub the belly, tap sneak to push during birth.

import { tickPotionEffects } from './potions.js';
import { system, world, ButtonState, EntityDamageCause, EquipmentSlot, InputButton, ItemStack } from '@minecraft/server';
import { CRAVING_ITEMS, CRAVING_LANG, SPECIES, TICKS } from './data.js';
import { SPECIES_CRAVINGS, SPECIES_FOODS } from '../mobs/families.js';
import { applyEffects } from './effects.js';
import { pregnancyDamage } from './math.js';
import { clampLevel } from './state.js';
import { onNightSkipped as onMobsNightSkipped } from '../mobs/system.js';
import { settingsOf } from '../player/compat.js';
import {
  actionbar,
  chestItem,
  getRecord,
  isInvincible,
  isLaborOrMisbirth,
  message,
  onEatSpicyFood,
  onNightSkipped,
  onPush,
  particle,
  playSound,
  pushProgress,
  refreshSymptoms,
  tickPlayer,
  tryInitMiscarriage,
} from './system.js';

/** @typedef {import('./state.js').PlayerRecord} PlayerRecord */

const LOOKING_AT_BELLY_PITCH = 50;

/** Crouching shows the pregnancy status; during birth the push progress is always shown. */
function updateHud(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  if (!p) return;
  const { player } = record;
  if (p.pain?.type === 'BIRTH' && p.birth) {
    player.onScreenDisplay.setActionBar({
      translate: 'minepreggo.hud.push',
      with: { rawtext: [{ translate: 'key.sneak' }, { text: `${pushProgress(record)}%` }] },
    });
    return;
  }
  if (!player.isSneaking) return;

  const dayOfPregnancy = p.daysByPhase.slice(0, p.phase).reduce((a, b) => a + b, 0) + p.daysPassed + 1;
  const totalDays = p.daysByPhase.reduce((a, b) => a + b, 0);
  /** @type {import('@minecraft/server').RawMessage[]} */
  const parts = [
    { translate: `effect.minepreggo.pregnancy_p${p.phase}` },
    { text: ' §7|§r ' },
    { translate: 'minepreggo.hud.day', with: [String(Math.min(dayOfPregnancy, totalDays)), String(totalDays)] },
    { text: ' §7|§r ' },
    { translate: 'minepreggo.hud.health', with: [`${p.health}%`] },
  ];
  if (p.symptoms.CRAVING !== undefined && p.cravingType) {
    parts.push({ text: ' §7|§r ' }, { translate: 'effect.minepreggo.craving' }, { text: ': ' }, { translate: CRAVING_LANG[p.cravingType] });
  }
  if (p.symptoms.MILKING !== undefined) parts.push({ text: ' §7|§r ' }, { translate: 'effect.minepreggo.lactation' });
  if (p.symptoms.BELLY_RUBS !== undefined) parts.push({ text: ' §7|§r ' }, { translate: 'effect.minepreggo.belly_rubs' });
  if (p.pain) parts.push({ text: ' §7|§c ' }, { translate: `effect.minepreggo.${p.pain.type.toLowerCase()}` });
  if (p.acceleration) parts.push({ text: ' §7|§d ' }, { translate: 'effect.minepreggo.gradual_pregnancy_acceleration' });
  player.onScreenDisplay.setActionBar({ rawtext: parts });
}

/**
 * Rubbing your own belly (Java: key R plays an animation; every 120 animation ticks lowers the
 * belly-rub need by 4). Here: crouch and look down.
 */
/** A belly rub from the guide book ("Rub my belly"), for players whose crouch-and-look-down is taken. */
export function startBellyRub(/** @type {PlayerRecord} */ record, ticks = 240) {
  const p = record.pregnancy;
  if (!p || p.phase < 3 || isLaborOrMisbirth(p)) return false;
  record.rubUntil = system.currentTick + ticks;
  return true;
}

function tickBellyRub(/** @type {PlayerRecord} */ record) {
  const p = record.pregnancy;
  const { player } = record;
  const timed = (record.rubUntil ?? 0) > system.currentTick;
  // crouching and looking at her belly, unless that is Actions & Stuff's sit gesture on her game
  const gesture = player.isSneaking && player.getRotation().x >= LOOKING_AT_BELLY_PITCH && !settingsOf(player).viewer;
  if (!p || p.phase < 3 || isLaborOrMisbirth(p) || !(timed || gesture)) {
    record.bellyRubTicks = 0;
    return;
  }
  const chest = chestItem(player);
  if (chest && chest.typeId !== 'minecraft:elytra') {
    if (record.bellyRubTicks++ % 40 === 0) actionbar(player, 'chat.minepreggo.belly_rubs.wearing_armor');
    return;
  }
  if (++record.bellyRubTicks % TICKS.bellyRubCycle !== 0 || p.bellyRubs <= 0) return;
  p.bellyRubs = clampLevel(p.bellyRubs - 4);
  refreshSymptoms(record);
  playSound(player, 'minepreggo.belly_touch', 0.6);
  for (let i = 0; i < 3; i++) particle(player, 'minecraft:heart_particle', 0.6);
}

// Sleeping through the night (WorldEventHandler.onSleepFinished) is detected as a jump in the
// time of day while someone was asleep.
let lastTimeOfDay = -1;
let sleptRecently = false;
function detectNightSkip() {
  const time = world.getTimeOfDay();
  const sleeping = world.getPlayers().some((p) => p.isSleeping);
  if (lastTimeOfDay >= 0) {
    const elapsed = (time - lastTimeOfDay + 24000) % 24000;
    if (elapsed > 40 && (sleptRecently || sleeping)) {
      onNightSkipped(elapsed - 20);
      onMobsNightSkipped(elapsed - 20);
    }
  }
  lastTimeOfDay = time;
  sleptRecently = sleeping;
}

system.runInterval(() => {
  const tick = system.currentTick;
  for (const player of world.getPlayers()) {
    const record = tickPlayer(player);
    if (!record.isFemale()) continue;
    tickPotionEffects(record);
    tickBellyRub(record);
    if (tick % 20 === 0) applyEffects(record);
    if (tick % 5 === 0) updateHud(record);
  }
  if (tick % 20 === 0) detectNightSkip();
}, 1);

// Tap sneak to push during birth (Java: the "push in birth" key).
world.afterEvents.playerButtonInput.subscribe(({ player }) => onPush(getRecord(player)), {
  buttons: [InputButton.Sneak],
  state: ButtonState.Pressed,
});

// Eating: cravings (PlayerEventHandler.onUseItemFinish) and unsatisfied cravings (FoodDataMixin).
world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source: player }) => {
  const record = getRecord(player);
  const p = record.pregnancy;
  const food = itemStack.getComponent('minecraft:food');
  if (!food) return;

  // Species foods (brains, activated gunpowder, ender slime jelly, rotten flesh...) only agree
  // with a mother carrying that species (Java: edible only with the Full Of effect).
  const foodSpecies = SPECIES_FOODS[itemStack.typeId];
  if (foodSpecies && p?.father !== foodSpecies) {
    const hunger = player.getComponent('minecraft:player.hunger');
    const saturation = player.getComponent('minecraft:player.saturation');
    hunger?.setCurrentValue(Math.max(0, hunger.currentValue - food.nutrition));
    saturation?.setCurrentValue(Math.max(0, saturation.currentValue - food.nutrition * food.saturationModifier * 2));
    player.addEffect('nausea', 200, { amplifier: 0 });
    actionbar(player, `minepreggo.species_food.${foodSpecies.toLowerCase()}`);
    return;
  }
  if (!p || p.phase < 1) return;

  // PregnancySystemHelper.CRAVING_ITEM: the father's species decides which foods satisfy a craving.
  const cravingItem = (SPECIES_CRAVINGS[p.father] ?? CRAVING_ITEMS)[itemStack.typeId];
  const severity = p.symptoms.CRAVING;
  const satisfies = cravingItem !== undefined && cravingItem.craving === p.cravingType;

  if (severity !== undefined && p.cravingType && !satisfies) {
    // Food that isn't craved feeds less; Java reduces it before eating, Bedrock corrects after.
    const reducedNutrition = Math.max(1, food.nutrition - (severity + 1) * 2);
    const reducedSaturation = Math.max(0.1, food.saturationModifier - severity * 0.1);
    const hunger = player.getComponent('minecraft:player.hunger');
    const saturation = player.getComponent('minecraft:player.saturation');
    hunger?.setCurrentValue(Math.max(0, hunger.currentValue - (food.nutrition - reducedNutrition)));
    const lostSaturation = food.nutrition * food.saturationModifier * 2 - reducedNutrition * reducedSaturation * 2;
    saturation?.setCurrentValue(Math.max(0, saturation.currentValue - lostSaturation));
    if (Math.random() >= 0.7) {
      message(player, `chat.minepreggo.player.pregnancy.message.craving.unsatisfied.${1 + Math.floor(Math.random() * 3)}`, [
        { translate: CRAVING_LANG[p.cravingType] },
      ]);
    }
  }

  if (cravingItem) {
    if (cravingItem.craving === 'SPICY') onEatSpicyFood(record);
    if (severity !== undefined && satisfies) {
      p.craving = clampLevel(p.craving - cravingItem.gratification);
      refreshSymptoms(record);
    }
  } else if (itemStack.typeId === 'minepreggo:chili_pepper') {
    onEatSpicyFood(record);
  }
});

/** Milking into a glass bottle (PlayerEventHandler.onRightClickItem). */
function milk(/** @type {PlayerRecord} */ record) {
  const { player } = record;
  const p = record.pregnancy;
  const lactation = record.female.lactation;
  if (p ? p.phase < 2 || p.milking < 5 : !lactation || lactation.level < 5) return;
  const equipment = player.getComponent('minecraft:equippable');
  const held = equipment?.getEquipment(EquipmentSlot.Mainhand);
  if (held?.typeId !== 'minecraft:glass_bottle') return;
  if (held.amount > 1) {
    held.amount--;
    equipment?.setEquipment(EquipmentSlot.Mainhand, held);
  } else {
    equipment?.setEquipment(EquipmentSlot.Mainhand, undefined);
  }
  // PregnancySystemHelper.MILK_ITEM: a mother carrying another species gives that species' milk.
  const bottle = new ItemStack(p ? SPECIES[p.father].milkItem : 'minepreggo:human_breast_milk_bottle', 1);
  const leftover = player.getComponent('minecraft:inventory')?.container.addItem(bottle);
  if (leftover) player.dimension.spawnItem(leftover, player.location);
  playSound(player, 'bottle.fill', 0.7);
  for (let i = 0; i < 4; i++) particle(player, 'minecraft:white_smoke_particle', 0.7);
  if (p) {
    p.milking = clampLevel(p.milking - 5);
    refreshSymptoms(record);
  } else if (lactation) {
    lactation.level = clampLevel(lactation.level - 5);
    record.dirty = true;
  }
}

world.beforeEvents.itemUse.subscribe((event) => {
  const { source: player, itemStack } = event;
  const record = getRecord(player);
  const p = record.pregnancy;
  if (p && (p.pain?.type === 'BIRTH' || p.pain?.type === 'MISCARRIAGE')) {
    event.cancel = true;
    system.run(() => actionbar(player, 'chat.minepreggo.player.pregnancy.message.cannot_in_labor'));
    return;
  }
  if (itemStack.typeId !== 'minecraft:glass_bottle' || !record.isFemale()) return;
  const canMilk = p ? p.phase >= 2 && p.milking >= 5 : (record.female.lactation?.level ?? 0) >= 5;
  if (!canMilk) return;
  event.cancel = true;
  system.run(() => milk(record));
});

// Someone else rubbing a pregnant player's belly (PregnancySystemHelper.tryRubBelly): crouch
// and interact with an empty hand.
world.afterEvents.playerInteractWithEntity.subscribe(({ player, target, beforeItemStack }) => {
  if (target.typeId !== 'minecraft:player' || !player.isSneaking || beforeItemStack) return;
  const record = getRecord(/** @type {import('@minecraft/server').Player} */ (target));
  const p = record.pregnancy;
  if (!p || chestItem(record.player)) return;
  playSound(record.player, 'minepreggo.belly_touch', 0.6);
  if (p.phase >= 3 && p.bellyRubs >= 1) {
    p.bellyRubs = clampLevel(p.bellyRubs - 1);
    refreshSymptoms(record);
    for (let i = 0; i < 3; i++) particle(record.player, 'minecraft:heart_particle', 0.6);
  }
});

// Getting hurt can harm the pregnancy (PlayerEventHandler.onHurt + PregnancyDamageHelper).
world.afterEvents.entityHurt.subscribe(
  ({ hurtEntity, damage, damageSource }) => {
    const player = /** @type {import('@minecraft/server').Player} */ (hurtEntity);
    const record = getRecord(player);
    const p = record.pregnancy;
    if (!p || isLaborOrMisbirth(p) || isInvincible(player)) return;
    if (record.effects.resistance) return; // Pregnancy Resistance: PregnancyDamageHelper returns 0
    if (damageSource.cause === EntityDamageCause.magic && system.currentTick - record.selfHurtTick <= 1) return;
    const healthComponent = player.getComponent('minecraft:health');
    if (!healthComponent) return;
    const explosion = damageSource.cause === EntityDamageCause.entityExplosion || damageSource.cause === EntityDamageCause.blockExplosion;
    const lost = pregnancyDamage(p.phase, p.lastPhase, {
      explosion,
      healthBeforeHit: healthComponent.currentValue + damage,
      maxHealth: healthComponent.effectiveMax,
    });
    if (lost <= 0) return;
    p.health = Math.max(0, p.health - lost);
    record.dirty = true;
    if (p.health <= 0) tryInitMiscarriage(record);
    else if (p.health < 50 && Math.random() < 0.5) actionbar(player, 'chat.minepreggo.player.miscarriage.message.warning');
  },
  { entityTypes: ['minecraft:player'] }
);
