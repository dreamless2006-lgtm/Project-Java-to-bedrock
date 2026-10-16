// The Jenny Bed scene for the Minepreggo females (the Jenny Mod Java Port's girls have scenes of
// their own, see port.js). Chosen on the bed, a tamed female of the player's walks to it on her own
// (her entity file's move_to_block goal, like the fapcraft Jenny walks to a real bed) and lies on
// it, the player is held in place behind her playing the older Jenny pack's player animation, a
// scene camera frames the two (the way the fapcraft Jenny's scenes are shown from a camera instead
// of the player's eyes), the fapcraft Jenny's scene sounds are cued like her bed scene, and 50
// seconds later (the length of that pack's scene) she is pregnant. She is on all fours on the bed
// (the 'scene' pose, solved onto each family's rig by tools/gen-scene-poses.mjs), rocking to the
// beat of the player's animation. When she is already pregnant, her babies kick in bursts and, late
// in the pregnancy, her belly tightens in contractions through the scene (rhythm.js).

import { EasingType, EntityTypes, InputPermissionCategory, system, world } from '@minecraft/server';
import { ENTITY_IDS } from '../generated/ids.js';
import { babiesFromPotion } from '../pregnancy/math.js';
import { familyOf, getRecord, isIncapacitated, isTamed, nameOf, ownerOf, particles, playSound, setScenePose, setSceneState, startPregnancy } from '../mobs/system.js';
import { claim, femaleBusy, lockInput, playerBusy, release } from './occupancy.js';
import { KICKS_FROM, Rhythm, announce } from './rhythm.js';

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Vector3} Vector3 */
/** @typedef {import('../mobs/state.js').MobRecord} MobRecord */
/** @typedef {{ location: Vector3, facing: number }} Bed a bed block's location and facing state */

/** The older Jenny pack's scene lasted 50 seconds. */
export const SCENE_TICKS = 1000;
/** How long she gets to walk to the bed before she is placed on it. */
export const WALK_TICKS = 400;
const PLAYER_ANIMATION = 'animation.minepreggo.jenny_bed.player_scene';
const CONTROLLER = 'minepreggo_bed_scene';
const POSE = 'scene';
/** When the scene speeds up (the cues' fast part) and when it peaks. */
const FAST_FROM = 26 * 20;
const PEAK_FROM = 44 * 20;
const LOCKED = [InputPermissionCategory.Movement, InputPermissionCategory.Camera, InputPermissionCategory.Jump, InputPermissionCategory.Sneak];
/** The distance from the bed's middle within which she lies down at once instead of walking. */
const NEAR = 2.5;

/** A bed block's facing state (the placer's cardinal direction) -> the direction the bed extends in, and her yaw along it. */
const FACINGS = /** @type {Record<number, { x: number, z: number, yaw: number }>} */ ({
  2: { x: 0, z: 1, yaw: 0 },
  3: { x: 0, z: -1, yaw: 180 },
  4: { x: 1, z: 0, yaw: -90 },
  5: { x: -1, z: 0, yaw: 90 },
});

/**
 * The fapcraft Jenny's scene sounds (merged in by tools/import-jenny.mjs), cued the way her own bed
 * scene cues them: bed rustle and breathing, a slow phase, a fast phase, the finish and the tail.
 * An unknown sound id plays nothing, so a build without the port stays quiet here.
 */
function cueList() {
  /** @type {{ tick: number, id: string, volume: number }[]} */
  const cues = [];
  const add = (/** @type {number} */ seconds, /** @type {string} */ id, volume = 1) => cues.push({ tick: Math.round(seconds * 20), id: `jhjenjava.audio.${id}`, volume });
  add(0, 'misc.bedrustle0');
  add(2.5, 'jenny.lightbreathing', 0.8);
  add(5, 'misc.smallinserts', 0.8);
  add(5, 'jenny.mmm1', 0.7);
  const slow = ['jenny.moan', 'jenny.heavybreathing', 'jenny.mmm'];
  let n = 0;
  for (let t = 7; t < 25; t += 2.32) {
    add(t, 'misc.pounding033', 0.9);
    add(t + 0.2, slow[n++ % slow.length], 0.7);
    add(t + 1.2, 'jenny.lightbreathing_quiet', 0.6);
  }
  const fast = ['jenny.ahh', 'jenny.moan', 'jenny.heavybreathing'];
  n = 0;
  for (let t = 26; t < 44; t += 1.08) {
    add(t, 'misc.pounding075', 1);
    if (n % 2 === 0) add(t + 0.1, fast[(n / 2) % fast.length], 0.8);
    n++;
  }
  add(45.5, 'misc.cuminflation0_loud');
  add(45.5, 'misc.pounding200');
  add(45.6, 'jenny.moan');
  add(47, 'jenny.heavybreathing4', 0.8);
  add(48, 'jenny.heavybreathing5', 0.8);
  add(49, 'jenny.heavybreathing6', 0.7);
  return cues.sort((a, b) => a.tick - b.tick);
}
const CUES = cueList();
/** @type {boolean | undefined} */
let portPresent;
/** Whether the Jenny Mod Java Port is merged into this build (its sounds then exist). */
export function hasPort() {
  if (portPresent === undefined) {
    try {
      portPresent = EntityTypes.get('jhjenjava:jenny_stage') !== undefined;
    } catch {
      portPresent = false;
    }
  }
  return portPresent;
}

/**
 * @typedef {object} Scene
 * @property {string} id her entity id
 * @property {string} playerId
 * @property {Vector3} her where she lies
 * @property {Vector3} him where the player stands
 * @property {Vector3} camera where the scene camera stands
 * @property {Vector3} focus what it looks at
 * @property {number} yaw
 * @property {number} start the tick the scene began
 * @property {number} until the tick the scene ends
 * @property {number} cue the next sound cue to play
 * @property {boolean} pregnantBefore
 * @property {Rhythm} rhythm what her belly does through the scene when she is pregnant
 * @property {number} nextHold the tick both are next put back in place
 * @property {string} bed the bed it takes (bedKey)
 */

/** @type {Map<string, Scene>} by her entity id */
const scenes = new Map();
/** @type {Map<string, string>} player id -> her entity id */
const byPlayer = new Map();
/** @type {Map<string, { playerId: string, bed: Bed, until: number }>} females walking to a bed, by entity id */
const walking = new Map();

export const sceneOf = (/** @type {Entity} */ entity) => scenes.get(entity.id);
/** One bed, one scene: a bed by dimension and block. */
const bedKey = (/** @type {Entity} */ entity, /** @type {Bed} */ bed) => `${entity.dimension.id}:${bed.location.x},${bed.location.y},${bed.location.z}`;
/** Whether a scene plays on this bed, or a female is on her way to it. */
export function bedTaken(/** @type {Entity} */ entity, /** @type {Bed} */ bed) {
  const key = bedKey(entity, bed);
  for (const scene of scenes.values()) if (scene.bed === key) return true;
  for (const [id, wait] of walking) {
    const walker = world.getEntity(id);
    if (walker?.isValid && bedKey(walker, wait.bed) === key) return true;
  }
  return false;
}
/** Labor and the rest after it: no bed scene then. */
const LABOR_PAINS = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH', 'POSTBIRTH']);
export const inScene = (/** @type {Player} */ player) => byPlayer.has(player.id);
export const isWalking = (/** @type {Entity} */ entity) => walking.has(entity.id);

/**
 * Why she cannot lie down now (a translation key with her name as %s), or null when she can.
 * Only the player's own tamed Minepreggo females can; a pregnant one still can (the scene then changes nothing).
 * @param {MobRecord} record @param {Player} player
 */
export function canStartScene(record, player) {
  const { entity, data } = record;
  const family = familyOf(entity);
  if (!family || family.external) return 'minepreggo.bed.not_female';
  if (byPlayer.has(player.id) || playerBusy(player.id)) return 'minepreggo.bed.player_busy';
  if (scenes.has(entity.id) || walking.has(entity.id) || femaleBusy(entity.id)) return 'minepreggo.bed.busy';
  if (data.wild) return 'minepreggo.bed.wild';
  if (!isTamed(entity)) return 'minepreggo.bed.not_tamed';
  const owner = ownerOf(record);
  if (!data.owner) {
    data.owner = player.id; // the first owner interaction records the owner, as mobs/interact.js does
    record.dirty = true;
  } else if (owner?.id !== player.id && data.owner !== player.id) return 'minepreggo.bed.not_yours';
  if (isIncapacitated(record) || data.savage || LABOR_PAINS.has(/** @type {any} */ (data.pregnancy?.pain)?.type ?? '')) return 'minepreggo.bed.busy';
  return null;
}

const lock = (/** @type {Player} */ player, /** @type {boolean} */ enabled) => lockInput(player, LOCKED, !enabled);

function hold(/** @type {Player} */ player, /** @type {Scene} */ scene) {
  try {
    player.teleport(scene.him, { facingLocation: { x: scene.her.x, y: scene.her.y + 0.6, z: scene.her.z }, keepVelocity: false });
  } catch {
    // unloaded
  }
}

/** The scene camera: beside and a little behind the two, looking at them (eased in, held in place). */
function frame(/** @type {Player} */ player, /** @type {Scene} */ scene, /** @type {number} */ easeTime) {
  try {
    player.camera.setCamera('minecraft:free', { location: scene.camera, facingLocation: scene.focus, easeOptions: { easeTime, easeType: EasingType.InOutSine } });
  } catch {
    // no camera here
  }
}

const trigger = (/** @type {Entity} */ entity, /** @type {string} */ event) => {
  try {
    entity.triggerEvent(event);
  } catch {
    // unloaded, or not one of ours
  }
};
const distance = (/** @type {Vector3} */ a, /** @type {Vector3} */ b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Takes her to the bed: at once when she stands next to it, else she walks there on her own and
 * the scene starts when she arrives (or she is placed on it after WALK_TICKS).
 * @param {MobRecord} record @param {Player} player @param {Bed} bed
 * @returns {'now' | 'walking' | 'busy' | 'bed_taken'}
 */
export function requestScene(record, player, bed) {
  const { entity } = record;
  if (bedTaken(entity, bed)) return 'bed_taken';
  if (!claim('walk', entity.id, player.id)) return 'busy';
  const middle = { x: bed.location.x + 0.5, y: bed.location.y + 0.5, z: bed.location.z + 0.5 };
  if (distance(entity.location, middle) <= NEAR) {
    startScene(record, player, bed);
    return 'now';
  }
  trigger(entity, 'minepreggo:go_to_bed');
  walking.set(entity.id, { playerId: player.id, bed, until: system.currentTick + WALK_TICKS });
  player.onScreenDisplay.setActionBar({ translate: 'minepreggo.bed.coming', with: { rawtext: [nameOf(entity)] } });
  return 'walking';
}

/**
 * Starts the scene on the bed at `bed`.
 * @param {MobRecord} record @param {Player} player @param {Bed} bed
 */
export function startScene(record, player, bed) {
  const { entity, data } = record;
  walking.delete(entity.id);
  trigger(entity, 'minepreggo:leave_bed');
  // (the player may have gone through a portal while she walked: the bed is in her dimension)
  if (player.dimension.id !== entity.dimension.id || !claim('bed', entity.id, player.id, { from: 'walk' })) {
    release('walk', entity.id, player.id);
    return;
  }
  const facing = FACINGS[bed.facing] ?? FACINGS[2];
  const top = bed.location.y + 0.5625; // the bed is 9/16 high
  const her = { x: bed.location.x + 0.5 + facing.x * 0.75, y: top, z: bed.location.z + 0.5 + facing.z * 0.75 };
  const him = { x: her.x - facing.x, y: top, z: her.z - facing.z };
  // The camera stands beside the bed, a little behind the pair, and looks at the two of them.
  const side = { x: -facing.z, z: facing.x };
  const camera = { x: her.x - facing.x * 0.9 + side.x * 2.4, y: top + 1.7, z: her.z - facing.z * 0.9 + side.z * 2.4 };
  const focus = { x: (her.x + him.x) / 2, y: top + 0.9, z: (her.z + him.z) / 2 };
  /** @type {Scene} */
  const scene = {
    id: entity.id,
    playerId: player.id,
    her,
    him,
    camera,
    focus,
    yaw: facing.yaw,
    start: system.currentTick,
    until: system.currentTick + SCENE_TICKS,
    cue: 0,
    pregnantBefore: !!(data.pregnancy || data.wild || data.pending),
    rhythm: new Rhythm(),
    nextHold: system.currentTick + 20,
    bed: bedKey(entity, bed),
  };
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
  frame(player, scene, 0.8);
  try {
    player.playAnimation(PLAYER_ANIMATION, { controller: CONTROLLER, blendOutTime: 0.3 });
  } catch (error) {
    console.warn(`[minepreggo] scene animation: ${error}`);
  }
  if (!hasPort()) playSound(entity, 'minepreggo.jenny_scene', 0.8);
  player.onScreenDisplay.setActionBar({ translate: 'minepreggo.bed.started', with: { rawtext: [nameOf(entity)] } });
}

/** Ends a scene: the player is released, she gets her pose back and, when the scene ran its course, is pregnant. */
export function endScene(/** @type {Scene} */ scene, /** @type {boolean} */ finished) {
  scenes.delete(scene.id);
  byPlayer.delete(scene.playerId);
  release('bed', scene.id, scene.playerId);
  const player = world.getEntity(scene.playerId);
  if (player?.isValid && player.typeId === 'minecraft:player') {
    const p = /** @type {Player} */ (player);
    lock(p, true);
    try {
      p.camera.clear();
    } catch {
      // no camera here
    }
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
  setSceneState(record, 'none');
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

/** How intense the scene is now, 0..1: slow at first, fast later, peaking at the end. */
export function heatOf(/** @type {number} */ elapsed) {
  return elapsed >= PEAK_FROM ? 1 : elapsed >= FAST_FROM ? 0.75 : 0.3;
}

/** A pregnant female's belly through the scene: kicks in bursts, contractions late in the pregnancy. */
function beat(/** @type {Entity} */ entity, /** @type {Player} */ player, /** @type {Scene} */ scene) {
  const record = getRecord(entity);
  const p = record.data.pregnancy;
  if (!p || p.phase < KICKS_FROM) return;
  const next = scene.rhythm.step(p.phase, heatOf(system.currentTick - scene.start), system.currentTick);
  if (!next) return;
  setSceneState(record, next.state, next.kick);
  const said = announce(next, p.womb.length + (p.birth ? 1 : 0));
  if (!said) return;
  player.onScreenDisplay.setActionBar({ translate: said.key, with: { rawtext: [nameOf(entity)] } });
  playSound(entity, said.sound, said.volume);
}

/** Plays the sound cues due since the last check, at her. */
function playCues(/** @type {Entity} */ entity, /** @type {Scene} */ scene) {
  const elapsed = system.currentTick - scene.start;
  while (scene.cue < CUES.length && CUES[scene.cue].tick <= elapsed) {
    const cue = CUES[scene.cue++];
    try {
      entity.dimension.playSound(cue.id, entity.location, { volume: cue.volume });
    } catch {
      // unknown sound or unloaded
    }
  }
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
    if (hasPort()) playCues(entity, scene);
    beat(entity, /** @type {Player} */ (player), scene);
    // Both are kept in place (a push, a slide down the bed), and the camera stays where it is.
    if (system.currentTick >= scene.nextHold) {
      scene.nextHold = system.currentTick + 20;
      hold(/** @type {Player} */ (player), scene);
      frame(/** @type {Player} */ (player), scene, 0);
      try {
        entity.teleport(scene.her, { rotation: { x: 0, y: scene.yaw }, keepVelocity: false });
      } catch {
        // unloaded
      }
    }
  }
  // Walkers: the bed's on_reach event starts their scene; one who takes too long is placed on the bed.
  for (const [id, wait] of [...walking]) {
    const entity = world.getEntity(id);
    const player = world.getEntity(wait.playerId);
    if (!entity?.isValid || !player?.isValid || player.typeId !== 'minecraft:player' || player.dimension.id !== entity.dimension.id) {
      cancelWalk(id, wait.playerId);
      continue;
    }
    if (system.currentTick >= wait.until) startScene(getRecord(entity), /** @type {Player} */ (player), wait.bed);
  }
}, 10);

// She arrived at the bed on her own (minecraft:behavior.move_to_block's on_reach in her entity file).
world.afterEvents.dataDrivenEntityTrigger.subscribe(
  ({ entity, eventId }) => {
    if (eventId !== 'minepreggo:bed_reached') return;
    const wait = walking.get(entity.id);
    if (!wait) return;
    const player = world.getEntity(wait.playerId);
    if (!player?.isValid || player.typeId !== 'minecraft:player' || player.dimension.id !== entity.dimension.id) {
      cancelWalk(entity.id, wait.playerId);
      return;
    }
    startScene(getRecord(entity), /** @type {Player} */ (player), wait.bed);
  },
  { entityTypes: ENTITY_IDS }
);

/** She stops walking to the bed: the player and she are free again. */
function cancelWalk(/** @type {string} */ entityId, /** @type {string} */ playerId) {
  walking.delete(entityId);
  release('walk', entityId, playerId);
  const entity = world.getEntity(entityId);
  if (entity?.isValid) trigger(entity, 'minepreggo:leave_bed');
}

/** Everything a player is part of here ends (they left, or died). */
function freePlayer(/** @type {string} */ playerId) {
  const id = byPlayer.get(playerId);
  const scene = id ? scenes.get(id) : undefined;
  if (scene) endScene(scene, false);
  for (const [entityId, wait] of [...walking]) if (wait.playerId === playerId) cancelWalk(entityId, playerId);
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => freePlayer(playerId));
// A player who dies in a scene respawns free (not pulled back to the bed); so does she if she dies.
world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  if (deadEntity.typeId === 'minecraft:player') freePlayer(deadEntity.id);
  else {
    const scene = scenes.get(deadEntity.id);
    if (scene) endScene(scene, false);
    if (walking.has(deadEntity.id)) cancelWalk(deadEntity.id, /** @type {any} */ (walking.get(deadEntity.id)).playerId);
  }
});
world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  const scene = scenes.get(removedEntityId);
  if (scene) endScene(scene, false);
  const wait = walking.get(removedEntityId);
  if (wait) release('walk', removedEntityId, wait.playerId);
  walking.delete(removedEntityId);
});
