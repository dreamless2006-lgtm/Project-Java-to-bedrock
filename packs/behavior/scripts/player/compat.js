// Actions & Stuff (Oreville Studios' resource pack) draws players with its own player model, which
// replaces this pack's (a client entity file never merges with another pack's: the higher one
// wins), so on a game running it the pregnant body, the poses and the births of packs/resource/
// entity/player.entity.json do not show. Two opt-in settings (the guide book's Settings) bring the
// pregnancy back there without touching its files:
//
//   * "My game runs Actions & Stuff": the poses of pregnant players nearby (labor, birth, back pain,
//     rubbing her belly) reach this player's game through the Script API, which plays them on
//     whatever player model draws them (named controller, ended on the client by the pose
//     property). Belly rubs then come from the guide book ("Rub my belly"): crouching and looking
//     down is its sit gesture.
//   * "Show my belly to Actions & Stuff players": while she is pregnant she holds her belly in her
//     off-hand (an item locked there, attachables/belly_pN.json), drawn on her body by any player
//     model; it hides itself where this pack's own player model draws her belly already.

import { EquipmentSlot, ItemLockMode, ItemStack, system, world } from '@minecraft/server';

/** @typedef {import('@minecraft/server').Player} Player */

const VIEWER = 'minepreggo:as_viewer';
const BELLY = 'minepreggo:as_belly';
export const BELLY_ITEM = /^minepreggo:belly_p\d$/;
const CONTROLLER = 'minepreggo_pose';
/** Poses are played again now and then, for players who came near or back since. */
export const RESEND_TICKS = 100;
const RANGE = 96;
/** The pose animations of the player model, by pose. */
const POSES = /** @type {Record<string, string>} */ ({
  water_breaking: 'animation.minepreggo.player.labor_water_breaking',
  prebirth: 'animation.minepreggo.player.labor_prebirth',
  birth: 'animation.minepreggo.player.labor_birth',
  postbirth: 'animation.minepreggo.player.labor_postbirth',
  miscarriage: 'animation.minepreggo.player.labor_miscarriage',
  back_pain: 'animation.minepreggo.player.back_pain',
});

/** A player's Actions & Stuff settings. */
export function settingsOf(/** @type {Player} */ player) {
  return { viewer: !!player.getDynamicProperty(VIEWER), belly: !!player.getDynamicProperty(BELLY) };
}

export function setSettings(/** @type {Player} */ player, /** @type {{ viewer: boolean, belly: boolean }} */ { viewer, belly }) {
  player.setDynamicProperty(VIEWER, viewer || undefined);
  player.setDynamicProperty(BELLY, belly || undefined);
  syncBelly(player);
}

const property = (/** @type {Player} */ player, /** @type {string} */ name, /** @type {any} */ fallback) => {
  try {
    return player.getProperty(`minepreggo:${name}`) ?? fallback;
  } catch {
    return fallback; // another pack's player entity (behavior side) without our properties
  }
};

/** The pose animation to play on her now, and the client-side condition that ends it. */
export function poseOf(/** @type {Player} */ player) {
  const pose = String(property(player, 'pose', 'none'));
  const phase = Number(property(player, 'phase', -1));
  if (pose === 'rubbing' && phase >= 0) {
    return { animation: `animation.minepreggo.player.belly_rubbing_p${phase}`, stop: `q.property('minepreggo:pose') != 'rubbing' || q.property('minepreggo:phase') != ${phase}` };
  }
  const animation = POSES[pose];
  return animation ? { animation, stop: `q.property('minepreggo:pose') != '${pose}'` } : undefined;
}

const offhand = (/** @type {Player} */ player) => /** @type {any} */ (player.getComponent('minecraft:equippable'));
/** @type {Map<string, number>} player id -> the tick the "off-hand is taken" hint was last shown */
const hinted = new Map();

/** Her belly in her off-hand while she wants it and is visibly pregnant; gone otherwise. */
export function syncBelly(/** @type {Player} */ player) {
  const equipment = offhand(player);
  if (!equipment) return;
  const phase = Number(property(player, 'phase', -1));
  const want = settingsOf(player).belly && phase >= 2 ? `minepreggo:belly_p${phase}` : undefined;
  const held = equipment.getEquipment(EquipmentSlot.Offhand);
  if (!want) {
    if (held && BELLY_ITEM.test(held.typeId)) equipment.setEquipment(EquipmentSlot.Offhand, undefined);
    return;
  }
  if (held?.typeId === want) return;
  if (held && !BELLY_ITEM.test(held.typeId)) {
    // something else is in her off-hand: hers to put away
    const last = hinted.get(player.id) ?? -Infinity;
    if (system.currentTick - last >= 1200) {
      hinted.set(player.id, system.currentTick);
      player.onScreenDisplay.setActionBar({ translate: 'minepreggo.compat.offhand_taken' });
    }
    return;
  }
  const stack = new ItemStack(want, 1);
  stack.lockMode = ItemLockMode.slot;
  stack.keepOnDeath = true;
  equipment.setEquipment(EquipmentSlot.Offhand, stack);
}

/** @type {Map<string, { animation: string, at: number }>} the pose last played on each player */
const played = new Map();

/** Plays her pose on the games of the Actions & Stuff players near her (when it changed, and now and then). */
export function sendPose(/** @type {Player} */ player, /** @type {Player[]} */ viewers) {
  const pose = poseOf(player);
  if (!pose) {
    played.delete(player.id);
    return false;
  }
  const last = played.get(player.id);
  if (last?.animation === pose.animation && system.currentTick - last.at < RESEND_TICKS) return false;
  const near = viewers.filter((v) => v.dimension.id === player.dimension.id && Math.hypot(v.location.x - player.location.x, v.location.z - player.location.z) <= RANGE);
  if (!near.length) return false;
  try {
    player.playAnimation(pose.animation, { controller: CONTROLLER, blendOutTime: 0.25, stopExpression: pose.stop, players: near });
  } catch (error) {
    console.warn(`[minepreggo] Actions & Stuff pose: ${error}`);
  }
  played.set(player.id, { animation: pose.animation, at: system.currentTick });
  return true;
}

system.runInterval(() => {
  const players = world.getPlayers();
  const viewers = players.filter((p) => settingsOf(p).viewer);
  for (const player of players) {
    syncBelly(player);
    if (viewers.length) sendPose(player, viewers);
  }
}, 10);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  played.delete(playerId);
  hinted.delete(playerId);
});
// a player who comes back (or a new viewer) gets the poses again at once
world.afterEvents.playerSpawn.subscribe(() => played.clear());
