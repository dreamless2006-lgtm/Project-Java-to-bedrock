// Item components of the pregnancy system: the mod's potions as drinkable items. Every outcome is
// reported, so a potion that cannot act never looks broken.
//
// "minepreggo:impregnation_potion": { "amplifier": 0-5, "species": "HUMAN" | "ZOMBIE" | "CREEPER" | "ENDER" | "SLIME" | "VILLAGER" }
//   Java's Potion of Impregnation gives a 15 s Impregnation effect; when it ends the drinker
//   becomes pregnant (world/effect/Impregnantion + PlayerHelper.tryToStartPregnancyThroughPotion).
//   The amplifier picks the number of babies. The 15 s count down on the action bar.
// "minepreggo:pregnancy_acceleration": { "amplifier": 0-4 } and
// "minepreggo:gradual_pregnancy_acceleration": { "amplifier": 0-4, "duration": ticks }
//   Java's instant and timed acceleration effects (world/effect/PregnancyAcceleration and the
//   gradual timer speed-up).
// "minepreggo:pregnancy_delay": { "amplifier": 0-4 }         PregnancyDelay: the pregnancy takes 7 % x level longer
// "minepreggo:baby_duplication": { "amplifier": 0-4 }        BabyDuplication: level + 1 more babies
// "minepreggo:pregnancy_healing": {}                          PregnancyHealing: pregnancy health 100
// "minepreggo:pregnancy_harming": {}                          PregnancyHarming: -30 pregnancy health
// "minepreggo:pregnancy_resistance": { "duration": ticks }    PregnancyResistance: hits do not harm the pregnancy
// "minepreggo:zero_gravity_belly": { "duration": ticks }      ZeroGravityBelly: no slowdown, no extra fall damage
// "minepreggo:metabolism_control": { "amplifier", "duration" } MetabolismControl: saturation refills
// "minepreggo:eternal_pregnancy": {}                          Eternal Pregnancy: birth never comes, until milk
// "minepreggo:fetal_movement_inducer": { "severity": 0-4 }
//   A Bedrock addition: drinking it while pregnant (P3+) makes the baby kick with that severity.
// "minepreggo:breast_milk": { "regeneration": ticks }
//   AbstractBreastMilk clears the drinker's effects like milk does, then the human variant adds
//   Regeneration.

import { system, world, Player } from '@minecraft/server';
import { promptGender } from '../player/gender.js';
import { POTION_SPECIES } from './data.js';
import { gradualAccelerationSpeed } from './math.js';
import { applyPotionEffect, curePotionEffects, delayPregnancy, duplicateBabies, EFFECT_LANG, harmPregnancy, healPregnancy } from './potions.js';
import { accelerate, accelerateGradually, actionbar, getRecord, induceFetalMovement, isLaborOrMisbirth, message } from './system.js';

export const IMPREGNATION_TICKS = 300;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** @param {unknown} params @param {string} key */
function numberParam(params, key) {
  const value = /** @type {Record<string, unknown> | undefined} */ (params)?.[key];
  if (typeof value !== 'number') throw new Error(`missing numeric "${key}" parameter`);
  return value;
}

/** The drinker as a player record, or undefined for anything else. */
const drinker = (/** @type {unknown} */ source) => (source instanceof Player ? getRecord(source) : undefined);

/** Reports why a potion that needs a pregnancy did nothing; true when it can act. */
function needsPregnancy(/** @type {import('./state.js').PlayerRecord} */ record, blockedInLabor = true) {
  if (!record.pregnancy) {
    message(record.player, 'minepreggo.potion.not_pregnant');
    return false;
  }
  if (blockedInLabor && isLaborOrMisbirth(record.pregnancy)) {
    message(record.player, 'minepreggo.potion.blocked_labor');
    return false;
  }
  return true;
}

const minutes = (/** @type {number} */ ticks) => Math.round(ticks / 1200);

system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
  itemComponentRegistry.registerCustomComponent('minepreggo:impregnation_potion', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record) return;
      if (!record.gender) {
        message(record.player, 'minepreggo.potion.choose_gender');
        promptGender(record.player);
        return;
      }
      if (!record.isFemale()) return message(record.player, 'minepreggo.potion.male');
      if (record.pregnancy || record.pending) return message(record.player, 'minepreggo.potion.already_pregnant');
      if (record.female.post) return message(record.player, 'minepreggo.potion.recovering');
      const species = /** @type {Record<string, unknown> | undefined} */ (params)?.species;
      const father = POTION_SPECIES.find((s) => s === species) ?? 'HUMAN';
      record.pending = { amplifier: numberParam(params, 'amplifier'), father, endTime: world.getAbsoluteTime() + IMPREGNATION_TICKS, ticksLeft: IMPREGNATION_TICKS };
      record.save();
      message(record.player, 'minepreggo.potion.impregnation', [IMPREGNATION_TICKS / 20]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_acceleration', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record)) return;
      const p = /** @type {import('./state.js').Pregnancy} */ (record.pregnancy);
      if (accelerate(record, numberParam(params, 'amplifier'))) message(record.player, 'minepreggo.potion.accelerated', [p.phase, p.daysPassed]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:gradual_pregnancy_acceleration', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record)) return;
      const amplifier = numberParam(params, 'amplifier');
      const duration = numberParam(params, 'duration');
      if (accelerateGradually(record, amplifier, duration)) message(record.player, 'minepreggo.potion.gradual', [gradualAccelerationSpeed(amplifier), minutes(duration)]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_delay', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record)) return;
      const days = delayPregnancy(record, numberParam(params, 'amplifier'));
      if (days > 0) message(record.player, 'minepreggo.potion.delayed', [days]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:baby_duplication', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record)) return;
      const p = /** @type {import('./state.js').Pregnancy} */ (record.pregnancy);
      const added = duplicateBabies(record, numberParam(params, 'amplifier'));
      if (added > 0) message(record.player, 'minepreggo.potion.duplicated', [added, p.womb.length, p.lastPhase, p.phase]);
      else message(record.player, 'minepreggo.potion.duplicated_full');
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_healing', {
    onConsume: ({ source }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record, false)) return;
      if (healPregnancy(record)) message(record.player, 'minepreggo.potion.healed');
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_harming', {
    onConsume: ({ source }) => {
      const record = drinker(source);
      if (!record || !needsPregnancy(record)) return;
      if (harmPregnancy(record)) message(record.player, 'minepreggo.potion.harmed', [record.pregnancy?.health ?? 0]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_resistance', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record) return;
      const duration = numberParam(params, 'duration');
      applyPotionEffect(record, 'resistance', duration);
      message(record.player, 'minepreggo.potion.resistance', [minutes(duration)]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:zero_gravity_belly', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record) return;
      const duration = numberParam(params, 'duration');
      applyPotionEffect(record, 'zeroGravity', duration);
      message(record.player, 'minepreggo.potion.zero_gravity', [minutes(duration)]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:metabolism_control', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record) return;
      const amplifier = numberParam(params, 'amplifier');
      const duration = numberParam(params, 'duration');
      applyPotionEffect(record, 'metabolism', duration, amplifier);
      message(record.player, 'minepreggo.potion.metabolism', [ROMAN[amplifier] ?? String(amplifier + 1), minutes(duration)]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:eternal_pregnancy', {
    onConsume: ({ source }) => {
      const record = drinker(source);
      if (!record) return;
      applyPotionEffect(record, 'eternal', -1);
      message(record.player, 'minepreggo.potion.eternal', [{ translate: EFFECT_LANG.eternal }]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:fetal_movement_inducer', {
    onConsume: ({ source }, { params }) => {
      const record = drinker(source);
      if (!record) return;
      const severity = numberParam(params, 'severity');
      if (!record.pregnancy) actionbar(record.player, 'minepreggo.fetal_movement_inducer.not_pregnant');
      else if (!induceFetalMovement(record, severity)) actionbar(record.player, 'minepreggo.fetal_movement_inducer.too_early');
      else message(record.player, 'minepreggo.fetal_movement_inducer.kick', [ROMAN[Math.min(2, Math.floor(severity / 2))]]);
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:breast_milk', {
    onConsume: ({ source }, { params }) => {
      // Pregnancy effects are among those cleared; the pregnancy system re-applies them.
      for (const effect of source.getEffects()) source.removeEffect(effect.typeId);
      source.addEffect('regeneration', numberParam(params, 'regeneration'));
      const record = drinker(source);
      if (record && curePotionEffects(record)) message(record.player, 'minepreggo.potion.cured');
    },
  });
});
