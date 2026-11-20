// The Jenny Bed block (the older Jenny pack's bed, minepreggo:jenny_bed): placed facing the player,
// it offers the player's tamed Minepreggo females standing near it a scene (jenny/scenes.js).

import { system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { FAMILY_TAG, duplicateBabies, enterBirth, familyOf, getRecord, nameOf, particles, playSound, refreshClient, startLaying } from '../mobs/system.js';
import { openPregnancyMenu } from './belly_scenes.js';
import { canStartScene, requestScene, sceneOf } from './scenes.js';

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

const UNDRESSED = 'minepreggo:undressed';
const undressedNow = (/** @type {import('@minecraft/server').Entity} */ entity) => {
  try {
    return entity.getProperty(UNDRESSED) === true;
  } catch {
    return false;
  }
};
const dress = (/** @type {import('@minecraft/server').Entity} */ entity, /** @type {boolean} */ undressed) => {
  try {
    entity.setProperty(UNDRESSED, undressed);
  } catch {
    // gone
  }
};

const NAVEL_SCENE = 'minepreggo:navel_scene';
const NAVEL_BURST = 'minepreggo:navel_burst';
const NAVEL_BIRTH = 'minepreggo:navel_birth';
const LABOR = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH']);
/** Late enough for her navel scene to end in a birth: full term (P9), or in labor. */
export const ripe = (/** @type {import('../mobs/state.js').MobRecord} */ record) => {
  const p = record.data.pregnancy;
  return !!p && (p.phase >= 9 || LABOR.has(/** @type {any} */ (p.pain)?.type ?? ''));
};

/**
 * Her navel birth, the fusion of her navel scene and a belly burst: her labor comes on at once and
 * each baby crowns out of her navel (not between her legs), her navel opening wide with every push;
 * with her last baby her belly bursts open at her navel, gone at once in a blast of smoke and hearts.
 * @param {import('../mobs/state.js').MobRecord} record
 */
function navelBirth(record) {
  const { entity } = record;
  if (!startLaying(record)) return;
  if (record.data.pregnancy?.pain?.type !== 'BIRTH') enterBirth(record);
  flag(entity, NAVEL_BIRTH, true);
  particles(entity, 'minecraft:heart_particle', 4);
  refreshClient(record);
  const run = system.runInterval(() => {
    if (!entity.isValid) return system.clearRun(run);
    const p = record.data.pregnancy;
    if (p?.birth && p.pain?.type === 'BIRTH') return;
    // her last baby is out: the burst
    system.clearRun(run);
    flag(entity, NAVEL_BIRTH, false);
    flag(entity, NAVEL_BURST, true);
    particles(entity, 'minecraft:large_explosion', 2);
    particles(entity, 'minecraft:heart_particle', 8);
    playSound(entity, 'random.explode', 0.4);
    playSound(entity, 'random.pop', 1);
    system.runTimeout(() => entity.isValid && flag(entity, NAVEL_BURST, false), 60);
  }, 5);
}
const flag = (/** @type {import('@minecraft/server').Entity} */ entity, /** @type {string} */ property, /** @type {boolean} */ value) => {
  try {
    entity.setProperty(property, value);
  } catch {
    // gone
  }
};

/**
 * Watches her scene to its end: she undresses for it (and dresses again after, as she was), and the
 * monster creeper girl's own (special: at her navel, which pulses to the scene's beat, her belly
 * rippling) ends with a pop and hearts, leaving her with a baby more.
 * @param {import('../mobs/state.js').MobRecord} record @param {boolean} clothes @param {string | undefined} special
 * @param {boolean} [birth] she is at term or in labor: the scene ends in her navel birth (navelBirth)
 */
function watchScene(record, clothes, special, birth = false) {
  const { entity } = record;
  // (her labor waits for the scene: it ends in her navel birth)
  if (birth) record.laying = { progress: 0 };
  const wasUndressed = undressedNow(entity);
  if (clothes) dress(entity, true);
  if (special === 'navel') flag(entity, NAVEL_SCENE, true);
  let ticks = 0;
  const run = system.runInterval(() => {
    ticks += 20;
    if (!entity.isValid) return system.clearRun(run);
    if (sceneOf(entity)) {
      if (special && ticks % 200 === 0) particles(entity, 'minecraft:heart_particle', 2);
      return;
    }
    system.clearRun(run);
    if (special) flag(entity, NAVEL_SCENE, false);
    if (birth) {
      record.laying = undefined;
      if (record.data.pregnancy) navelBirth(record);
    } else if (special && record.data.pregnancy) {
      particles(entity, 'minecraft:heart_particle', 6);
      playSound(entity, 'random.pop', 0.8);
      duplicateBabies(record, 0);
    }
    if (clothes && !wasUndressed) dress(entity, false);
  }, 20);
}

/**
 * The Wahoo menu (Jenny's Preggo Mobs, crouching with an empty hand on one you tamed): her positions,
 * like the Jenny girls' scenes; the scene plays where she stands, no bed needed, and she comes out of
 * it pregnant, as from the Jenny Bed.
 * @param {import('@minecraft/server').Player} player @param {import('../mobs/state.js').MobRecord} record
 */
export async function openWahooMenu(player, record) {
  const { entity } = record;
  const family = familyOf(entity);
  // at term or in labor (the monster creeper girl): her navel scene becomes her navel birth
  const late = !!family?.navelBirth && ripe(record);
  /** @type {{ label: string, pose?: string, special?: string, placement?: 'side', toggle?: boolean, menu?: boolean }[]} */
  const buttons = late ? [] : POSITIONS.map(([label, pose]) => ({ label, pose }));
  if (family?.special === 'navel') buttons.push({ label: late ? 'Navel Birth' : 'Navel', pose: 'scene_back', special: 'navel', placement: 'side' });
  if (late) buttons.push({ label: 'Pregnancy menu', menu: true });
  if (family?.clothes) buttons.push({ label: undressedNow(entity) ? 'Dress her' : 'Undress her', toggle: true });
  const menu = new ActionFormData().title('Wahoo').body('Choose a position.');
  for (const { label } of buttons) menu.button(label);
  const answer = await menu.show(/** @type {any} */ (player));
  if (answer.canceled || answer.selection === undefined || !entity.isValid) return;
  const chosen = buttons[answer.selection];
  if (chosen.toggle) return dress(entity, !undressedNow(entity));
  if (chosen.menu) return openPregnancyMenu(player, record);
  const busy = canStartScene(record, player, late);
  if (busy) {
    player.onScreenDisplay.setActionBar({ translate: busy, with: { rawtext: [nameOf(entity)] } });
    return;
  }
  const at = entity.location;
  // (where she stands, as if on a bed there: the scene sets her 9/16 above a bed's block)
  const bed = { location: { x: Math.floor(at.x), y: Math.floor(at.y) - 0.5625, z: Math.floor(at.z) }, facing: facingFromYaw(player.getRotation().y) };
  if (requestScene(record, player, bed, chosen.pose, chosen.placement) === 'now') watchScene(record, !!family?.clothes, chosen.special, late);
}
