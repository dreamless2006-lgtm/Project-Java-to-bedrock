// Tells each player once per join that the scripts are running and what loaded, so a pack that
// failed (no line, or a red entry) is easy to spot on any device, consoles included, without the
// content log. Every entity, item and block the pack defines is checked against what the game
// registered, and the ones it rejected are named.
import { BlockTypes, EntityTypes, ItemTypes, system, world } from '@minecraft/server';
import { BLOCK_IDS, ENTITY_IDS, ITEM_IDS } from '../generated/ids.js';
import { PORT_GIRL_IDS } from '../jenny/port.js';
import { VERSION } from '../version.js';

/** @typedef {{ total: number, missing: string[] }} Registry */

/** @param {string[]} ids @param {(id: string) => unknown} get */
function compare(ids, get) {
  const missing = [];
  for (const id of ids) {
    try {
      if (get(id) === undefined) missing.push(id.replace('minepreggo:', ''));
    } catch {
      missing.push(id.replace('minepreggo:', ''));
    }
  }
  return { total: ids.length, missing };
}

/** @param {import('@minecraft/server').Player} player */
export function selfCheck(player) {
  let visuals = false;
  try {
    // Reads undefined (or throws) when another pack's player override replaced ours.
    visuals = typeof player.getProperty('minepreggo:phase') === 'number';
  } catch {
    visuals = false;
  }
  // The Jenny Mod Java Port's girls, merged in by tools/import-jenny.mjs; a build without its packs has none and says nothing.
  const port = compare(PORT_GIRL_IDS, (id) => EntityTypes.get(id));
  return {
    entities: compare(ENTITY_IDS, (id) => EntityTypes.get(id)),
    items: compare(ITEM_IDS, (id) => ItemTypes.get(id)),
    blocks: compare(BLOCK_IDS, (id) => BlockTypes.get(id)),
    visuals,
    ...(port.missing.length < port.total ? { port } : {}),
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
    const missing = [];
    for (const [name, result] of Object.entries(results)) {
      if (parts.length) parts.push({ text: ' ' });
      const ok = typeof result === 'boolean' ? result : result.missing.length === 0;
      const label = typeof result === 'boolean' ? [{ translate: `minepreggo.selfcheck.${name}` }] : [{ translate: `minepreggo.selfcheck.${name}` }, { text: ` ${result.total - result.missing.length}/${result.total}` }];
      parts.push({ translate: ok ? 'minepreggo.selfcheck.ok' : 'minepreggo.selfcheck.fail', with: { rawtext: [{ rawtext: label }] } });
      if (typeof result !== 'boolean') missing.push(...result.missing);
    }
    player.sendMessage({ translate: 'minepreggo.selfcheck', with: { rawtext: [{ text: VERSION }, { rawtext: parts }] } });
    if (missing.length) player.sendMessage({ translate: 'minepreggo.selfcheck.missing', with: [missing.join(', ')] });
  }, 40);
});
