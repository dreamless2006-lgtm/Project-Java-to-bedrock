// Who is taken by a scene right now: the Jenny Bed's (a female walking to the bed, then the scene;
// jenny/scenes.js) and the belly scenes (jenny/belly_scenes.js). A female and a player are in at
// most one at a time, so two scenes can never fight over the same body, camera or input. A player
// whose input a scene locked is marked with a dynamic property, so the lock is lifted if they come
// back after leaving in the middle of one.

import { InputPermissionCategory, world } from '@minecraft/server';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {'walk' | 'bed' | 'rub' | 'feel' | 'birth'} SceneKind */

/** @type {Map<string, SceneKind>} female entity id -> what she is in */
const females = new Map();
/** @type {Map<string, SceneKind>} player id -> what they are in */
const players = new Map();
const LOCKED = 'minepreggo:scene_locked';
/** Every input category a scene may lock. */
const ALL = [InputPermissionCategory.Movement, InputPermissionCategory.LateralMovement, InputPermissionCategory.Camera, InputPermissionCategory.Jump, InputPermissionCategory.Sneak, InputPermissionCategory.Mount, InputPermissionCategory.Dismount];

export const femaleBusy = (/** @type {string} */ id) => females.get(id);
export const playerBusy = (/** @type {string} */ id) => players.get(id);

/** Takes a female and a player for a scene; false (and nothing taken) when either is in another one. */
export function claim(/** @type {SceneKind} */ kind, /** @type {string} */ femaleId, /** @type {string} */ playerId, { from } = /** @type {{ from?: SceneKind }} */ ({})) {
  const f = females.get(femaleId), p = players.get(playerId);
  if ((f && f !== from) || (p && p !== from)) return false;
  females.set(femaleId, kind);
  players.set(playerId, kind);
  return true;
}

/** Gives a female and a player back (only what this kind of scene took). */
export function release(/** @type {SceneKind} */ kind, /** @type {string} */ femaleId, /** @type {string} */ playerId) {
  if (females.get(femaleId) === kind) females.delete(femaleId);
  if (players.get(playerId) === kind) players.delete(playerId);
}

/** Locks or unlocks a player's input for a scene, remembering it on the player. */
export function lockInput(/** @type {Player} */ player, /** @type {number[]} */ categories, /** @type {boolean} */ locked) {
  for (const category of categories) {
    try {
      player.inputPermissions.setPermissionCategory(/** @type {any} */ (category), !locked);
    } catch {
      // not supported here
    }
  }
  try {
    player.setDynamicProperty(LOCKED, locked ? true : undefined);
  } catch {
    // no dynamic properties here
  }
}

/** A player who left in the middle of a scene comes back with their input and camera free. */
export function releaseStale(/** @type {Player} */ player) {
  if (!player.getDynamicProperty(LOCKED) || players.has(player.id)) return false;
  lockInput(player, ALL, false);
  try {
    player.camera.clear();
  } catch {
    // no camera here
  }
  return true;
}

world.afterEvents.playerSpawn.subscribe(({ player }) => void releaseStale(player));
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  // the scenes end their own scene on leave; this only forgets what is left over
  players.delete(playerId);
});
