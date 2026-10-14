// Gender and skin choice (Java: PlayerJoinsWorldScreen, asked once when a player first joins).
// Only female characters can become pregnant. A female character either keeps her own skin
// (Java SkinType DEFAULT: the belly uses the skin's pixels) or uses the mod's Alex/Steve
// female skins (SkinType PREDEFINED, drawn by player/body.js through the player override).

import { system, world } from '@minecraft/server';
import { ActionFormData, FormCancelationReason } from '@minecraft/server-ui';
import { getRecord } from '../pregnancy/system.js';
import { syncBody } from './body.js';

/** @typedef {import('@minecraft/server').Player} Player */

/** @param {Player} player */
export function promptGender(player, attempt = 0) {
  const form = new ActionFormData()
    .title({ translate: 'gui.minepreggo.player_main_menu.label.title' })
    .body({ translate: 'minepreggo.gender.body' })
    .button({ translate: 'minepreggo.gender.female_custom' })
    .button({ translate: 'minepreggo.gender.female_alex' })
    .button({ translate: 'minepreggo.gender.female_steve' })
    .button({ translate: 'gui.minepreggo.player_main_menu.checkbox.male' });

  form.show(player).then((response) => {
    if (response.canceled) {
      if (!player.isValid || getRecord(player).gender) return;
      if (response.cancelationReason === FormCancelationReason.UserBusy) {
        // Forms can't open while another screen (or the loading screen) is up; try again shortly.
        system.runTimeout(() => promptGender(player, attempt + 1), 20);
      } else {
        // Closed without choosing: Java's screen can't be dismissed, so the form comes back.
        if (attempt % 6 === 0) player.sendMessage({ translate: 'minepreggo.gender.later' });
        system.runTimeout(() => {
          if (player.isValid && !getRecord(player).gender) promptGender(player, attempt + 1);
        }, 200);
      }
      return;
    }
    const record = getRecord(player);
    const choice = response.selection ?? 3;
    record.setGender(choice === 3 ? 'male' : 'female');
    record.setSkin(choice === 1 ? 'alex' : choice === 2 ? 'steve' : 'custom');
    syncBody(record);
  });
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn && !getRecord(player).gender) promptGender(player);
});
