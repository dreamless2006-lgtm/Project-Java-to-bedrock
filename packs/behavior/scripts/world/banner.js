// Tells each player once per join that the scripts are running and what loaded, so a pack that
// failed (no line, or a red entry) is easy to spot on any device, consoles included, without the
// content log.
import { BlockTypes, EntityTypes, ItemTypes, system, world } from '@minecraft/server';
import { VERSION } from '../version.js';

/** @param {import('@minecraft/server').Player} player */
export function selfCheck(player) {
  let visuals = false;
  try {
    // Reads undefined (or throws) when another pack's player override replaced ours.
    visuals = typeof player.getProperty('minepreggo:phase') === 'number';
  } catch {
    visuals = false;
  }
  return {
    entities: EntityTypes.get('minepreggo:zombie_girl') !== undefined,
    items: ItemTypes.get('minepreggo:villager_brain') !== undefined,
    blocks: BlockTypes.get('minepreggo:chili_peppers') !== undefined,
    visuals,
  };
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  player.sendMessage({ translate: 'minepreggo.loaded', with: [VERSION] });
  system.runTimeout(() => {
    if (!player.isValid) return;
    const results = selfCheck(player);
    /** @type {import('@minecraft/server').RawMessage[]} */
    const parts = [];
    for (const [name, ok] of Object.entries(results)) {
      if (parts.length) parts.push({ text: ' ' });
      parts.push({ translate: ok ? 'minepreggo.selfcheck.ok' : 'minepreggo.selfcheck.fail', with: { rawtext: [{ translate: `minepreggo.selfcheck.${name}` }] } });
    }
    player.sendMessage({ translate: 'minepreggo.selfcheck', with: { rawtext: [{ text: VERSION }, { rawtext: parts }] } });
  }, 40);
});
