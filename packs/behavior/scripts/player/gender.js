// Gender choice (Java: PlayerJoinsWorldScreen, asked once when a player first joins). Only
// female characters can become pregnant. The Java skin choice is part of the player visuals,
// which aren't ported yet.

import { system, world } from '@minecraft/server';
import { ActionFormData, FormCancelationReason } from '@minecraft/server-ui';
import { getRecord } from '../pregnancy/system.js';

/** @typedef {import('@minecraft/server').Player} Player */

/** @param {Player} player */
export function promptGender(player, attempt = 0) {
  const form = new ActionFormData()
    .title({ translate: 'gui.minepreggo.player_main_menu.label.title' })
    .body({ translate: 'minepreggo.gender.body' })
    .button({ translate: 'gui.minepreggo.player_main_menu.checkbox.female' })
    .button({ translate: 'gui.minepreggo.player_main_menu.checkbox.male' });

  form.show(player).then((response) => {
    if (response.canceled) {
      // Forms can't open while another screen (or the loading screen) is up; try again shortly.
      if (response.cancelationReason === FormCancelationReason.UserBusy && attempt < 30 && player.isValid) {
        system.runTimeout(() => promptGender(player, attempt + 1), 20);
      } else if (player.isValid) {
        player.sendMessage({ translate: 'minepreggo.gender.later' });
      }
      return;
    }
    const gender = response.selection === 0 ? 'female' : 'male';
    getRecord(player).setGender(gender);
  });
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn && !getRecord(player).gender) promptGender(player);
});
