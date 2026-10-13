// `minepreggo:food_effects` item component: applies mob effects when the item is eaten, e.g.
//   "minepreggo:food_effects": { "effects": [{ "effect": "minecraft:nausea", "duration": 200, "amplifier": 0 }] }
// Durations are in ticks, as in Java's MobEffectInstance. Bedrock food has no built-in effect list.

import { system, Player } from '@minecraft/server';

/**
 * @typedef {{ effect: string, duration: number, amplifier?: number }} FoodEffect
 */

/**
 * @param {unknown} params
 * @returns {FoodEffect[]}
 */
function readEffects(params) {
  const effects = /** @type {{ effects?: unknown }} */ (params)?.effects;
  if (!Array.isArray(effects)) throw new Error('minepreggo:food_effects needs an "effects" array');
  return effects;
}

system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
  itemComponentRegistry.registerCustomComponent('minepreggo:food_effects', {
    onConsume: ({ source }, { params }) => {
      // Java only applies these to players (StuffedMushroom.finishUsingItem). It also skips them
      // while the player has the Full Of Slimes pregnancy effect, which is not ported yet.
      if (!(source instanceof Player)) return;
      for (const { effect, duration, amplifier = 0 } of readEffects(params)) {
        source.addEffect(effect, duration, { amplifier });
      }
    },
  });
});
