// The pregnancy scenes: crouch and use an empty hand on a pregnant female (one of your own tamed
// Minepreggo females, or any of the Jenny Mod Java Port's girls) to open her pregnancy menu:
//
//   * Rub her belly: she sits back on her hands (the 'scene_sit' pose), you lean over and rub; the
//     babies answer with kicks, and her need for belly rubs eases.
//   * Feel the baby: you lay both hands on her belly; the babies kick hard into them, and at the end
//     you count their heartbeats.
//   * Help her give birth (in labor): you kneel in front of her and push with her: every sneak press
//     moves the labor on, and each baby is born into your arms (mobs/system.js deliverBaby). Jump
//     ends it.
//
// Like the Jenny Bed scene (scenes.js), each is shown from a camera beside the two of you with the
// player held in place playing a scene animation (animations/scene_player.animation.json).

import { ButtonState, EasingType, InputButton, InputPermissionCategory, system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { assistPush, familyOf, getRecord, isTamed, nameOf, ownerOf, particles, playSound, rubBelly, setScenePose, setSceneState } from '../mobs/system.js';
import { KICKS_FROM, Rhythm, announce, kickOf } from './rhythm.js';
import { claim, femaleBusy, lockInput, playerBusy, release } from './occupancy.js';

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Vector3} Vector3 */
/** @typedef {import('../mobs/state.js').MobRecord} MobRecord */
/** @typedef {'rub' | 'feel' | 'birth'} Kind */

/** How long the rub and the feel last; a birth lasts as long as her labor. */
export const BELLY_SCENE_TICKS = /** @type {Record<Kind, number>} */ ({ rub: 240, feel: 200, birth: 6000 });
/** How far one push moves the labor on, and how often one counts. */
export const PUSH_TICKS = 30;
const PUSH_EVERY = 5;
const PLAYER_ANIMATIONS = /** @type {Record<Kind, string>} */ ({
  rub: 'animation.minepreggo.scene.player_rub',
  feel: 'animation.minepreggo.scene.player_feel',
  birth: 'animation.minepreggo.scene.player_catch',
});
const CONTROLLER = 'minepreggo_belly_scene';
const LABOR = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH']);

/**
 * @typedef {object} BellyScene
 * @property {Kind} kind
 * @property {string} id her entity id
 * @property {string} playerId
 * @property {Vector3} her
 * @property {Vector3} him
 * @property {number} yaw her facing (toward the player)
 * @property {Vector3} camera
 * @property {Vector3} focus
 * @property {number} start
 * @property {number} until
 * @property {Rhythm} rhythm
 * @property {number} lastPush
 * @property {number} pushes
 * @property {boolean} felt a kick was announced
 * @property {number} nextHold the tick both are next put back in place
 * @property {number} nextRub the tick a rub next eases her need
 */

/** @type {Map<string, BellyScene>} by her entity id */
const scenes = new Map();
/** @type {Map<string, string>} player id -> her entity id */
const byPlayer = new Map();

export const bellySceneOf = (/** @type {Entity} */ entity) => scenes.get(entity.id);
export const inBellyScene = (/** @type {Player} */ player) => byPlayer.has(player.id);

const inLabor = (/** @type {MobRecord} */ record) => LABOR.has(/** @type {any} */ (record.data.pregnancy?.pain)?.type ?? '');

/**
 * Why her pregnancy menu cannot open for this player (a translation key with her name as %s), or null.
 * @param {MobRecord} record @param {Player} player
 */
export function pregnancyMenuBlock(record, player) {
  const { entity, data } = record;
  const family = familyOf(entity);
  if (!family) return 'minepreggo.bed.not_female';
  if (!data.pregnancy) return 'minepreggo.belly.not_pregnant';
  if (!family.external) {
    if (!isTamed(entity)) return 'minepreggo.bed.not_tamed';
    if (data.owner && data.owner !== player.id && ownerOf(record)?.id !== player.id) return 'minepreggo.bed.not_yours';
  }
  if (scenes.has(entity.id) || byPlayer.has(player.id) || femaleBusy(entity.id) || playerBusy(player.id)) return 'minepreggo.bed.busy';
  return null;
}

/** Her pregnancy menu: how far along she is, and the scenes she can have now. */
export async function openPregnancyMenu(/** @type {Player} */ player, /** @type {MobRecord} */ record) {
  const reason = pregnancyMenuBlock(record, player);
  const name = nameOf(record.entity);
  if (reason) {
    player.onScreenDisplay.setActionBar({ translate: reason, with: { rawtext: [name] } });
    return;
  }
  const p = /** @type {NonNullable<typeof record.data.pregnancy>} */ (record.data.pregnancy);
  // In labor there is only one thing to do; otherwise a rub, and from P3 a feel of the babies.
  /** @type {Kind[]} */
  const kinds = inLabor(record) ? ['birth'] : p.phase >= KICKS_FROM ? ['rub', 'feel'] : ['rub'];
  const left = p.womb.length + (p.birth ? 1 : 0);
  const body = inLabor(record)
    ? { translate: left === 1 ? 'minepreggo.belly.menu.labor_one' : 'minepreggo.belly.menu.labor', with: { rawtext: [name, { text: String(left) }] } }
    : { translate: 'minepreggo.belly.menu.body', with: { rawtext: [name, { text: `P${p.phase}` }] } };
  const form = new ActionFormData().title({ translate: 'minepreggo.belly.menu.title', with: { rawtext: [name] } }).body(body);
  for (const kind of kinds) form.button({ translate: `minepreggo.belly.menu.${kind}` });
  form.button({ translate: 'minepreggo.ok' });
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined || response.selection >= kinds.length) return;
  if (!record.entity.isValid || !player.isValid) return;
  // Someone else (or a bed scene) may have taken her or the player while the menu was open.
  const late = pregnancyMenuBlock(record, player);
  if (late) {
    player.onScreenDisplay.setActionBar({ translate: late, with: { rawtext: [name] } });
    return;
  }
  startBellyScene(record, player, kinds[response.selection]);
}

/** The player stays put with the camera on the scene; jump (to stop) stays free, and in a birth sneak (to push). */
const LOCK_ALL = [InputPermissionCategory.LateralMovement, InputPermissionCategory.Camera, InputPermissionCategory.Sneak, InputPermissionCategory.Mount, InputPermissionCategory.Dismount];
const LOCK_BIRTH = [InputPermissionCategory.LateralMovement, InputPermissionCategory.Camera, InputPermissionCategory.Mount, InputPermissionCategory.Dismount];

const lock = (/** @type {Player} */ player, /** @type {Kind} */ kind, /** @type {boolean} */ enabled) => lockInput(player, kind === 'birth' ? LOCK_BIRTH : LOCK_ALL, !enabled);

function hold(/** @type {Entity} */ entity, /** @type {Player} */ player, /** @type {BellyScene} */ scene) {
  try {
    entity.teleport(scene.her, { rotation: { x: 0, y: scene.yaw }, keepVelocity: false });
    player.teleport(scene.him, { facingLocation: { x: scene.her.x, y: scene.her.y + 0.6, z: scene.her.z }, keepVelocity: false });
  } catch {
    // unloaded
  }
}

function frame(/** @type {Player} */ player, /** @type {BellyScene} */ scene, /** @type {number} */ easeTime) {
  try {
    player.camera.setCamera('minecraft:free', { location: scene.camera, facingLocation: scene.focus, easeOptions: { easeTime, easeType: EasingType.InOutSine } });
  } catch {
    // no camera here
  }
}

/**
 * Starts a belly scene where she stands: she turns to the player, who stands in front of her.
 * Returns false when she or the player is already in a scene.
 * @param {MobRecord} record @param {Player} player @param {Kind} kind
 */
export function startBellyScene(record, player, kind) {
  const { entity } = record;
  if (scenes.has(entity.id) || byPlayer.has(player.id) || !claim(kind, entity.id, player.id)) return false;
  const her = { ...entity.location };
  let dx = player.location.x - her.x, dz = player.location.z - her.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) [dx, dz] = [0, 1];
  else [dx, dz] = [dx / length, dz / length];
  // Minecraft yaw: 0 faces +z, 90 faces -x
  const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
  const him = { x: her.x + dx * (kind === 'birth' ? 1.35 : 1.1), y: her.y, z: her.z + dz * (kind === 'birth' ? 1.35 : 1.1) };
  const side = { x: -dz, z: dx };
  const mid = { x: (her.x + him.x) / 2, y: her.y, z: (her.z + him.z) / 2 };
  /** @type {BellyScene} */
  const scene = {
    kind,
    id: entity.id,
    playerId: player.id,
    her,
    him,
    yaw,
    camera: { x: mid.x + side.x * 2.7, y: her.y + 1.5, z: mid.z + side.z * 2.7 },
    focus: { x: mid.x, y: her.y + 0.55, z: mid.z },
    start: system.currentTick,
    until: system.currentTick + BELLY_SCENE_TICKS[kind],
    rhythm: new Rhythm(),
    lastPush: -PUSH_EVERY,
    pushes: 0,
    felt: false,
    nextHold: system.currentTick + 20,
    nextRub: system.currentTick + 60,
  };
  scenes.set(entity.id, scene);
  byPlayer.set(player.id, entity.id);
  // In labor she keeps her own labor pose; for the rub and the feel she sits back on her hands.
  if (kind !== 'birth') setScenePose(record, 'scene_sit');
  else record.birthHelper = player.id;
  hold(entity, player, scene);
  lock(player, kind, false);
  frame(player, scene, 0.8);
  try {
    player.playAnimation(PLAYER_ANIMATIONS[kind], { controller: CONTROLLER, blendOutTime: 0.3 });
  } catch (error) {
    console.warn(`[minepreggo] belly scene animation: ${error}`);
  }
  player.onScreenDisplay.setActionBar({ translate: `minepreggo.belly.started.${kind}`, with: { rawtext: [nameOf(entity)] } });
  if (kind === 'rub') rubBelly(record, 2);
  return true;
}

/** Ends a belly scene: the player is released and her pose and belly are hers again. */
export function endBellyScene(/** @type {BellyScene} */ scene, /** @type {boolean} */ finished) {
  scenes.delete(scene.id);
  byPlayer.delete(scene.playerId);
  release(scene.kind, scene.id, scene.playerId);
  const player = world.getEntity(scene.playerId);
  const entity = world.getEntity(scene.id);
  if (player?.isValid && player.typeId === 'minecraft:player') {
    const p = /** @type {Player} */ (player);
    lock(p, scene.kind, true);
    try {
      p.camera.clear();
    } catch {
      // no camera here
    }
    try {
      p.playAnimation('animation.humanoid.base_pose', { controller: CONTROLLER, blendOutTime: 0.3, stopExpression: 'q.any_animation_finished' });
    } catch {
      // nothing to stop
    }
  }
  if (!entity?.isValid) return;
  const record = getRecord(entity);
  setSceneState(record, 'none');
  if (scene.kind !== 'birth') setScenePose(record, null);
  record.birthHelper = undefined;
  if (!finished || !player?.isValid) return;
  const tell = (/** @type {string} */ key, /** @type {any[]} */ extra = []) => /** @type {Player} */ (player).sendMessage({ translate: key, with: { rawtext: [nameOf(entity), ...extra] } });
  const p = record.data.pregnancy;
  if (scene.kind === 'rub') {
    rubBelly(record, 6);
    particles(entity, 'minecraft:heart_particle', 6, 1.0);
    tell('minepreggo.belly.rub_done');
  } else if (scene.kind === 'feel') {
    const babies = p ? p.womb.length + (p.birth ? 1 : 0) : 0;
    tell(babies === 1 ? 'minepreggo.belly.heartbeat' : 'minepreggo.belly.heartbeats', [{ text: String(babies) }]);
  } else {
    // done once the last baby is out (she rests after the birth, or the pregnancy is over)
    const done = !p || /** @type {any} */ (p.pain)?.type === 'POSTBIRTH';
    tell(done ? 'minepreggo.belly.birth_done' : 'minepreggo.belly.birth_paused');
  }
}

/** One step of a rub or a feel: the babies answer in kicks. */
function stepBelly(/** @type {Entity} */ entity, /** @type {Player} */ player, /** @type {BellyScene} */ scene) {
  const record = getRecord(entity);
  const p = record.data.pregnancy;
  if (!p || p.phase < KICKS_FROM) return;
  const now = system.currentTick;
  if (scene.kind === 'feel') {
    // Hands on her belly: they kick hard into them, a burst every few seconds.
    const kicking = Math.floor((now - scene.start) / 50) % 2 === 0;
    const state = kicking ? 'kicking' : 'calm';
    if (record.scene?.state !== state) {
      setSceneState(record, state, Math.max(1, kickOf(p.phase)));
      if (kicking) {
        player.onScreenDisplay.setActionBar({ translate: scene.felt ? 'minepreggo.scene.kick_hard' : 'minepreggo.belly.feel_kick', with: { rawtext: [nameOf(entity)] } });
        playSound(entity, 'minepreggo.belly_touch', 0.6);
        scene.felt = true;
      }
    }
    return;
  }
  const next = scene.rhythm.step(p.phase, 0.45, now);
  if (next) {
    // a rub calms her: no contractions while you rub
    const state = next.state === 'contraction' ? 'calm' : next.state;
    setSceneState(record, state, next.kick);
    const said = state === 'kicking' ? announce(next) : undefined;
    if (said) player.onScreenDisplay.setActionBar({ translate: said.key, with: { rawtext: [nameOf(entity)] } });
  }
  if (now >= scene.nextRub) {
    scene.nextRub = now + 60;
    rubBelly(record, 2);
    particles(entity, 'minecraft:heart_particle', 2, 1.0);
  }
}

system.runInterval(() => {
  for (const scene of [...scenes.values()]) {
    const entity = world.getEntity(scene.id);
    const player = world.getEntity(scene.playerId);
    if (!entity?.isValid || !player?.isValid || entity.dimension.id !== player.dimension.id) {
      endBellyScene(scene, false);
      continue;
    }
    const record = getRecord(entity);
    if (scene.kind === 'birth') {
      // over when the last baby is born (or her labor stopped)
      if (!record.data.pregnancy || !inLabor(record) || system.currentTick >= scene.until) {
        endBellyScene(scene, true);
        continue;
      }
    } else if (system.currentTick >= scene.until || !record.data.pregnancy) {
      endBellyScene(scene, true);
      continue;
    }
    if (scene.kind !== 'birth') stepBelly(entity, /** @type {Player} */ (player), scene);
    if (system.currentTick >= scene.nextHold) {
      scene.nextHold = system.currentTick + 20;
      hold(entity, /** @type {Player} */ (player), scene);
      frame(/** @type {Player} */ (player), scene, 0);
    }
  }
}, 10);

/** During a birth scene, sneak pushes with her and jump stops helping; jump also ends a rub or a feel. */
export function onSceneButton(/** @type {Player} */ player, /** @type {string} */ button) {
  const id = byPlayer.get(player.id);
  const scene = id ? scenes.get(id) : undefined;
  if (!scene) return false;
  if (button === InputButton.Jump) {
    endBellyScene(scene, false);
    return true;
  }
  if (button !== InputButton.Sneak || scene.kind !== 'birth') return false;
  if (system.currentTick - scene.lastPush < PUSH_EVERY) return false;
  const entity = world.getEntity(scene.id);
  if (!entity?.isValid) return false;
  scene.lastPush = system.currentTick;
  const record = getRecord(entity);
  if (!assistPush(record, PUSH_TICKS)) return false;
  scene.pushes++;
  particles(entity, 'minecraft:water_drip_particle', 2, 0.4);
  if (scene.pushes % 4 === 1) playSound(entity, 'minepreggo.pregnancy_pain', 0.35);
  player.onScreenDisplay.setActionBar({ translate: 'minepreggo.belly.push', with: { rawtext: [nameOf(entity)] } });
  return true;
}

world.afterEvents.playerButtonInput.subscribe(({ player, button }) => void onSceneButton(player, button), {
  buttons: [InputButton.Sneak, InputButton.Jump],
  state: ButtonState.Pressed,
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  const id = byPlayer.get(playerId);
  const scene = id ? scenes.get(id) : undefined;
  if (scene) endBellyScene(scene, false);
});
world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  const scene = scenes.get(removedEntityId);
  if (scene) endBellyScene(scene, false);
});
