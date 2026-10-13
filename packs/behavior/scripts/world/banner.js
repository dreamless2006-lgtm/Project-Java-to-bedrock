// Tells each player once per join that the scripts are running, so a pack that failed to load
// (no banner) is easy to tell apart from one that loaded.
import { world } from '@minecraft/server';
import { VERSION } from '../version.js';

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) player.sendMessage({ translate: 'minepreggo.loaded', with: [VERSION] });
});
