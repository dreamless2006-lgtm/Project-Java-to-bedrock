// `minepreggo:food_effects` item component: applies mob effects when the item is eaten, e.g.
//   "minepreggo:food_effects": { "effects": "minecraft:nausea 200 0; minecraft:hunger 600" }
// See food_effects_format.js for the parameter format.

import { system, Player } from '@minecraft/server';
import { readEffects } from './food_effects_format.js';

system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
  itemComponentRegistry.registerCustomComponent('minepreggo:food_effects', {
    onConsume: ({ source }, { params }) => {
      // Java only applies these to players (StuffedMushroom.finishUsingItem). It also skips them
      // while the player has the Full Of Slimes pregnancy effect, which is not ported yet.
      if (!(source instanceof Player)) return;
      for (const { effect, duration, amplifier } of readEffects(params)) {
        source.addEffect(effect, duration, { amplifier });
      }
    },
  });
});
