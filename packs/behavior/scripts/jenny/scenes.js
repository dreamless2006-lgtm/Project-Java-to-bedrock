// The Jenny Bed scene for the Minepreggo females (the Jenny Mod Java Port's girls have scenes of
// their own, see port.js): a tamed female of the player's lies on the bed, the player is held in
// place behind her playing the older Jenny pack's player animation, and 50 seconds later (the length
// of that pack's scene) she is pregnant. Her pose is the sitting one of her own model; nothing new
// is animated here.

import { InputPermissionCategory, system, world } from '@minecraft/server';
import { babiesFromPotion } from '../pregnancy/math.js';
import { familyOf, getRecord, isIncapacitated, isTamed, nameOf, ownerOf, particles, playSound, setScenePose, startPregnancy } from '../mobs/system.js';

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Vector3} Vector3 */
/** @typedef {import('../mobs/state.js').MobRecord} MobRecord */

/** The older Jenny pack's scene lasted 50 seconds. */
export const SCENE_TICKS = 1000;
const PLAYER_ANIMATION = 'animation.minepreggo.jenny_bed.player_scene';
const CONTROLLER = 'minepreggo_bed_scene';
const POSE = 'incapacitated';
const LOCKED = [InputPermissionCategory.Movement, InputPermissionCategory.Camera, InputPermissionCategory.Jump, InputPermissionCategory.Sneak];

/** A bed block's facing state (the placer's cardinal direction) -> the direction the bed extends in, and her yaw along it. */
const FACINGS = /** @type {Record<number, { x: number, z: number, yaw: number }>} */ ({
  2: { x: 0, z: 1, yaw: 0 },
  3: { x: 0, z: -1, yaw: 180 },
  4: { x: 1, z: 0, yaw: -90 },
  5: { x: -1, z: 0, yaw: 90 },
});

/**
 * @typedef {object} Scene
 * @property {string} id her entity id
 * @property {string} playerId
 * @property {Vector3} her where she lies
 * @property {Vector3} him where the player stands
 * @property {number} yaw
 * @property {number} until the tick the scene ends
 * @property {boolean} pregnantBefore
 */

/** @type {Map<string, Scene>} by her entity id */
const scenes = new Map();
/** @type {Map<string, string>} player id -> her entity id */
const byPlayer = new Map();

export const sceneOf = (/** @type {Entity} */ entity) => scenes.get(entity.id);
export const inScene = (/** @type {Player} */ player) => byPlayer.has(player.id);

/**
 * Why she cannot lie down now (a translation key with her name as %s), or null when she can.
 * Only the player's own tamed Minepreggo females can; a pregnant one still can (the scene then changes nothing).
 * @param {MobRecord} record @param {Player} player
 */
export function canStartScene(record, player) {
  const { entity, data } = record;
  const family = familyOf(entity);
  if (!family || family.external) return 'minepreggo.bed.not_female';
  if (scenes.has(entity.id) || byPlayer.has(player.id)) return 'minepreggo.bed.busy';
  if (data.wild) return 'minepreggo.bed.wild';
  if (!isTamed(entity)) return 'minepreggo.bed.not_tamed';
  const owner = ownerOf(record);
  if (!data.owner) {
    data.owner = player.id; // the first owner interaction records the owner, as mobs/interact.js does
    record.dirty = true;
  } else if (owner?.id !== player.id && data.owner !== player.id) return 'minepreggo.bed.not_yours';
  if (isIncapacitated(record) || data.savage) return 'minepreggo.bed.busy';
  return null;
}

function lock(/** @type {Player} */ player, /** @type {boolean} */ enabled) {
  for (const category of LOCKED) {
    try {
      player.inputPermissions.setPermissionCategory(category, enabled);
    } catch {
      // not a player, or not supported here
    }
  }
}

function hold(/** @type {Player} */ player, /** @type {Scene} */ scene) {
  try {
    player.teleport(scene.him, { facingLocation: { x: scene.her.x, y: scene.her.y + 0.6, z: scene.her.z }, keepVelocity: false });
  } catch {
    // unloaded
  }
}

/**
 * Starts the scene on the bed at `bed` (its block location and facing state).
 * @param {MobRecord} record @param {Player} player @param {{ location: Vector3, facing: number }} bed
 */
export function startScene(record, player, bed) {
  const { entity, data } = record;
  const facing = FACINGS[bed.facing] ?? FACINGS[2];
  const top = bed.location.y + 0.5625; // the bed is 9/16 high
  const her = { x: bed.location.x + 0.5 + facing.x * 0.75, y: top, z: bed.location.z + 0.5 + facing.z * 0.75 };
  const him = { x: her.x - facing.x, y: top, z: her.z - facing.z };
  /** @type {Scene} */
  const scene = { id: entity.id, playerId: player.id, her, him, yaw: facing.yaw, until: system.currentTick + SCENE_TICKS, pregnantBefore: !!(data.pregnancy || data.wild || data.pending) };
  scenes.set(entity.id, scene);
  byPlayer.set(player.id, entity.id);
  setScenePose(record, POSE);
  try {
    entity.teleport(her, { rotation: { x: 0, y: facing.yaw }, keepVelocity: false });
  } catch {
    // unloaded
  }
  hold(player, scene);
  lock(player, false);
  try {
    player.playAnimation(PLAYER_ANIMATION, { controller: CONTROLLER, blendOutTime: 0.3 });
  } catch (error) {
    console.warn(`[minepreggo] scene animation: ${error}`);
  }
  playSound(entity, 'minepreggo.jenny_scene', 0.8);
  player.onScreenDisplay.setActionBar({ translate: 'minepreggo.bed.started', with: { rawtext: [nameOf(entity)] } });
}

/** Ends a scene: the player is released, she gets her pose back and, when the scene ran its course, is pregnant. */
export function endScene(/** @type {Scene} */ scene, /** @type {boolean} */ finished) {
  scenes.delete(scene.id);
  byPlayer.delete(scene.playerId);
  const player = world.getEntity(scene.playerId);
  if (player?.isValid && player.typeId === 'minecraft:player') {
    const p = /** @type {Player} */ (player);
    lock(p, true);
    try {
      // The older pack ended its scene the same way: the base pose takes the controller over and ends at once.
      p.playAnimation('animation.humanoid.base_pose', { controller: CONTROLLER, blendOutTime: 0.3, stopExpression: 'q.any_animation_finished' });
    } catch {
      // nothing to stop
    }
  }
  const entity = world.getEntity(scene.id);
  if (!entity?.isValid) return;
  const record = getRecord(entity);
  setScenePose(record, null);
  if (!finished) return;
  const name = nameOf(entity);
  const tell = (/** @type {string} */ key) => player?.isValid && /** @type {Player} */ (player).sendMessage({ translate: key, with: { rawtext: [name] } });
  if (scene.pregnantBefore) tell('minepreggo.bed.already_pregnant');
  else if (startPregnancy(record, babiesFromPotion(0))) {
    particles(entity, 'minecraft:heart_particle', 8, 1.5);
    tell('minepreggo.bed.pregnant');
  } else tell('minepreggo.bed.finished');
}

system.runInterval(() => {
  for (const scene of [...scenes.values()]) {
    const entity = world.getEntity(scene.id);
    const player = world.getEntity(scene.playerId);
    if (!entity?.isValid || !player?.isValid || entity.dimension.id !== player.dimension.id) {
      endScene(scene, false);
      continue;
    }
    if (system.currentTick >= scene.until) {
      endScene(scene, true);
      continue;
    }
    // Both are kept in place (a push, a slide down the bed).
    if (system.currentTick % 20 === 0) {
      hold(/** @type {Player} */ (player), scene);
      try {
        entity.teleport(scene.her, { rotation: { x: 0, y: scene.yaw }, keepVelocity: false });
      } catch {
        // unloaded
      }
    }
  }
}, 10);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const id = byPlayer.get(playerId);
  const scene = id ? scenes.get(id) : undefined;
  if (scene) endScene(scene, false);
});
world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  const scene = scenes.get(removedEntityId);
  if (scene) endScene(scene, false);
});
