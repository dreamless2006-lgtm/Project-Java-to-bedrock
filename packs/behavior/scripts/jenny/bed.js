// The Jenny Bed block (the older Jenny pack's bed, minepreggo:jenny_bed): placed facing the player,
// it offers the player's tamed Minepreggo females standing near it a scene (jenny/scenes.js).

import { system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { FAMILY_TAG, familyOf, getRecord, nameOf } from '../mobs/system.js';
import { canStartScene, requestScene } from './scenes.js';

/** @typedef {import('@minecraft/server').Block} Block */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */

const FACING = 'minepreggo:facing';
const RANGE = 5;

/** The placer's cardinal direction as the old pack's rotation state: 2 north, 3 south, 4 west, 5 east. */
export function facingFromYaw(/** @type {number} */ yaw) {
  const y = ((yaw % 360) + 540) % 360 - 180; // -180 .. 180, 0 = south
  if (y > -45 && y <= 45) return 3;
  if (y > 45 && y <= 135) return 4;
  if (y > -135 && y <= -45) return 5;
  return 2;
}

/** The block state's name as the typings want it (they only know vanilla states). */
const STATE = /** @type {any} */ (FACING);
const bedOf = (/** @type {Block} */ block) => ({ location: block.location, facing: Number(block.permutation.getState(STATE) ?? 2) });

/** The Minepreggo females near the bed, nearest first. */
function femalesNear(/** @type {Block} */ block) {
  const center = block.center();
  /** @type {Entity[]} */
  const found = block.dimension.getEntities({ families: [FAMILY_TAG], location: center, maxDistance: RANGE });
  return found.filter((entity) => familyOf(entity) && (!familyOf(entity)?.external || familyOf(entity)?.scenes));
}

async function openBedMenu(/** @type {Player} */ player, /** @type {Block} */ block) {
  const females = femalesNear(block);
  const form = new ActionFormData().title({ translate: 'minepreggo.bed.title' }).body({ translate: females.length ? 'minepreggo.bed.body' : 'minepreggo.bed.nobody' });
  for (const female of females) form.button({ translate: 'minepreggo.bed.take', with: { rawtext: [nameOf(female)] } });
  if (!females.length) form.button({ translate: 'minepreggo.ok' });
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  const female = females[response.selection];
  if (!female?.isValid || !player.isValid) return;
  const record = getRecord(female);
  const reason = canStartScene(record, player);
  if (reason) {
    player.onScreenDisplay.setActionBar({ translate: reason, with: { rawtext: [nameOf(female)] } });
    return;
  }
  const result = requestScene(record, player, bedOf(block));
  if (result === 'busy' || result === 'bed_taken') player.onScreenDisplay.setActionBar({ translate: result === 'busy' ? 'minepreggo.bed.busy' : 'minepreggo.bed.taken', with: { rawtext: [nameOf(female)] } });
}

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent('minepreggo:jenny_bed', {
    beforeOnPlayerPlace(event) {
      const yaw = event.player?.getRotation().y ?? 0;
      event.permutationToPlace = event.permutationToPlace.withState(STATE, facingFromYaw(yaw));
    },
    onPlayerInteract({ block, player }) {
      if (!player) return;
      system.run(() => void openBedMenu(player, block).catch((error) => console.warn(`[minepreggo] bed menu: ${error}`)));
    },
  });
});

export { world };

/** The Wahoo menu's positions: her pose (tools/lib/scene-poses.mjs), as the Jenny girls' scenes offer. */
const POSITIONS = /** @type {[string, string][]} */ ([['Doggy', 'scene'], ['Missionary', 'scene_back'], ['Sitting', 'scene_sit']]);

/**
 * The Wahoo menu (Jenny's Preggo Mobs, crouching with an empty hand on one you tamed): her positions,
 * like the Jenny girls' scenes; the scene plays where she stands, no bed needed, and she comes out of
 * it pregnant, as from the Jenny Bed.
 * @param {import('@minecraft/server').Player} player @param {import('../mobs/state.js').MobRecord} record
 */
export async function openWahooMenu(player, record) {
  const busy = canStartScene(record, player);
  if (busy) {
    player.onScreenDisplay.setActionBar({ translate: busy, with: { rawtext: [nameOf(record.entity)] } });
    return;
  }
  const menu = new ActionFormData().title('Wahoo').body('Choose a position.');
  for (const [label] of POSITIONS) menu.button(label);
  const answer = await menu.show(/** @type {any} */ (player));
  const { entity } = record;
  if (answer.canceled || answer.selection === undefined || !entity.isValid || canStartScene(record, player)) return;
  const at = entity.location;
  // (where she stands, as if on a bed there: the scene sets her 9/16 above a bed's block)
  const bed = { location: { x: Math.floor(at.x), y: Math.floor(at.y) - 0.5625, z: Math.floor(at.z) }, facing: facingFromYaw(player.getRotation().y) };
  requestScene(record, player, bed, POSITIONS[answer.selection][1]);
}
