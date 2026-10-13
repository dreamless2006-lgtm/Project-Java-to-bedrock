// Item components of the pregnancy system.
//
// "minepreggo:impregnation_potion": { "amplifier": 0-5 }
//   Java's Potion of Impregnation gives a 15 s Impregnation effect; when it ends the drinker
//   becomes pregnant (world/effect/Impregnantion + PlayerHelper.tryToStartPregnancyThroughPotion).
//   The amplifier picks the number of babies.
// "minepreggo:pregnancy_acceleration": { "amplifier": 0-4 } and
// "minepreggo:gradual_pregnancy_acceleration": { "amplifier": 0-4, "duration": ticks }
//   Java's instant and timed acceleration effects (world/effect/PregnancyAcceleration and the
//   gradual timer speed-up); drinking them as a pregnant player applies them to yourself.
// "minepreggo:breast_milk": { "regeneration": ticks }
//   AbstractBreastMilk clears the drinker's effects like milk does, then the human variant adds
//   Regeneration.

import { system, world, Player } from '@minecraft/server';
import { promptGender } from '../player/gender.js';
import { accelerate, accelerateGradually, getRecord } from './system.js';

const IMPREGNATION_TICKS = 300;

/** @param {unknown} params @param {string} key */
function numberParam(params, key) {
  const value = /** @type {Record<string, unknown> | undefined} */ (params)?.[key];
  if (typeof value !== 'number') throw new Error(`missing numeric "${key}" parameter`);
  return value;
}

system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
  itemComponentRegistry.registerCustomComponent('minepreggo:impregnation_potion', {
    onConsume: ({ source }, { params }) => {
      if (!(source instanceof Player)) return;
      const record = getRecord(source);
      if (!record.gender) {
        promptGender(source);
        return;
      }
      if (!record.isFemale() || record.pregnancy || record.female.post) return;
      record.pending = { amplifier: numberParam(params, 'amplifier'), father: 'HUMAN', endTime: world.getAbsoluteTime() + IMPREGNATION_TICKS };
      record.save();
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:pregnancy_acceleration', {
    onConsume: ({ source }, { params }) => {
      if (source instanceof Player) accelerate(getRecord(source), numberParam(params, 'amplifier'));
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:gradual_pregnancy_acceleration', {
    onConsume: ({ source }, { params }) => {
      if (source instanceof Player) accelerateGradually(getRecord(source), numberParam(params, 'amplifier'), numberParam(params, 'duration'));
    },
  });

  itemComponentRegistry.registerCustomComponent('minepreggo:breast_milk', {
    onConsume: ({ source }, { params }) => {
      // Pregnancy effects are among those cleared; the pregnancy system re-applies them.
      for (const effect of source.getEffects()) source.removeEffect(effect.typeId);
      source.addEffect('regeneration', numberParam(params, 'regeneration'));
    },
  });
});
