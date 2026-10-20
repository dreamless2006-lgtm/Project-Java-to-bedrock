// Actions & Stuff (Oreville Studios' resource pack) draws players with its own player model, which
// replaces this pack's: a client entity file never merges with another pack's, the higher one wins.
// On a game running it (or any other pack with its own player model), the pregnant body, the poses
// and the births of packs/resource/entity/player.entity.json do not show. A server cannot tell which
// packs a client runs, so everything here works without knowing it:
//
//   * Poses reach every player near her, with no setting. They are compat copies of our pose
//     animations (animation.minepreggo.as.*, written by tools/gen/compat-poses.mjs) whose
//     blend_weight is 0 wherever our own model draws her (variable.mp_native) and in first person,
//     so they only move her on other player models. Each is played again in step with its loop
//     length (re-sending restarts it, so sooner would cut the birth short) and at once to players
//     who come near.
//   * The belly is an item locked in her off-hand (attachables/belly_pN[_tT].json), which any
//     player model draws on her body; it hides itself where our model draws her belly already. It
//     takes her off-hand, so she is asked once, in a popup, when she first shows (P2), and can
//     change her mind in the guide book's Settings, with a skin tone for it (an attachable cannot
//     use her skin).
//   * Crouching and looking down rubs her belly unless she turns that off: on Actions & Stuff the
//     same gesture sits her down. "Rub my belly" in the guide book always works.

import { EquipmentSlot, GameMode, ItemLockMode, ItemStack, system, world } from '@minecraft/server';
import { FormCancelationReason, MessageFormData } from '@minecraft/server-ui';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {{ belly: boolean | undefined, tone: number, rubGesture: boolean }} Settings */
/** @typedef {{ animation: string, stop: string, loop: number }} Pose a compat animation, the Molang that ends it on the client, and how often it is played again (ticks) */
/** @typedef {'pose' | 'walk'} Track */

/** Her belly consent: true, false, or undefined while she has never been asked. */
const BELLY = 'minepreggo:as_belly';
/** The skin tone of that belly, 0 (Alex) to 5. */
const TONE = 'minepreggo:as_tone';
/** false turns the crouch-and-look-down belly rub off; undefined means on. */
const GESTURE = 'minepreggo:rub_gesture';
/** The version whose join hint she has seen. */
const HINT = 'minepreggo:as_hint';
const HINT_VERSION = '0.7.0';
/** 0.6.0's "My game runs Actions & Stuff": it turned the rub gesture off, so it migrates to that. */
const VIEWER = 'minepreggo:as_viewer';

/** Alex (0) plus five skin tones, as in the guide book's dropdown. */
export const TONE_COUNT = 6;
/** Any belly item: one per phase, with a tone suffix for tones 1 to 5. */
export const BELLY_ITEM = /^minepreggo:belly_p\d(_t[1-5])?$/;
/** Players this close to her (blocks, same dimension) get her poses; she is one of them. */
export const RANGE = 128;
/** A popup she could not see (another form was open) is shown again this much later. */
export const ASK_RETRY_TICKS = 100;
/** The "off-hand is taken" hint is shown at most this often. */
const OFFHAND_HINT_TICKS = 1200;
/** Poses during which nothing pops up: she is busy giving birth. */
const LABOR = new Set(['water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage']);
const AS = 'animation.minepreggo.as.';
/**
 * The compat animation of each pose and how often it is played again: one or two of its loops,
 * so the restart lands where it would start over anyway (water breaking and back pain hold still).
 * @type {Record<string, [string, number]>}
 */
const POSES = {
  water_breaking: ['labor_water_breaking', 100],
  prebirth: ['labor_prebirth', 120],
  birth: ['labor_birth', 180],
  postbirth: ['labor_postbirth', 160],
  miscarriage: ['labor_miscarriage', 195],
  back_pain: ['back_pain', 100],
};
/** Poses and the heavy walk run on controllers of their own, so one never overwrites the other. */
const CONTROLLERS = /** @type {Record<Track, string>} */ ({ pose: 'minepreggo_pose', walk: 'minepreggo_walk' });

/** @type {Set<string>} what has been logged already: a broken call would otherwise log every 10 ticks */
const warned = new Set();
const warnOnce = (/** @type {string} */ what, /** @type {unknown} */ error) => {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[minepreggo] Actions & Stuff ${what}: ${error}`);
};

const property = (/** @type {Player} */ player, /** @type {string} */ name, /** @type {any} */ fallback) => {
  try {
    return player.getProperty(`minepreggo:${name}`) ?? fallback;
  } catch {
    return fallback; // another pack's player entity (behavior side) without our properties
  }
};

// --- settings -------------------------------------------------------------------------------

/** Her Actions & Stuff settings. @returns {Settings} */
export function settingsOf(/** @type {Player} */ player) {
  const belly = player.getDynamicProperty(BELLY);
  const tone = Number(player.getDynamicProperty(TONE) ?? 0);
  return {
    belly: typeof belly === 'boolean' ? belly : undefined,
    tone: Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT ? tone : 0,
    rubGesture: player.getDynamicProperty(GESTURE) !== false,
  };
}

/** Saves the settings given (the others stay as they are) and puts her belly in or out of her off-hand. */
export function setSettings(/** @type {Player} */ player, /** @type {Partial<Settings>} */ changes) {
  const { belly, tone, rubGesture } = { ...settingsOf(player), ...changes };
  player.setDynamicProperty(BELLY, belly);
  const t = Math.trunc(Number(tone));
  player.setDynamicProperty(TONE, t > 0 && t < TONE_COUNT ? t : undefined);
  player.setDynamicProperty(GESTURE, rubGesture ? undefined : false);
  syncBelly(player);
}

/** Whether crouching and looking down rubs her belly. */
export const rubGesture = (/** @type {Player} */ player) => player.getDynamicProperty(GESTURE) !== false;

/** 0.6.0's viewer toggle meant "my crouch-and-look-down sits me down"; it becomes the gesture setting. */
export function migrate(/** @type {Player} */ player) {
  const viewer = player.getDynamicProperty(VIEWER);
  if (viewer === undefined) return;
  if (viewer === true) player.setDynamicProperty(GESTURE, false);
  player.setDynamicProperty(VIEWER, undefined);
}

// --- the off-hand belly ---------------------------------------------------------------------

/** The belly item of a phase and skin tone. */
export const bellyItemId = (/** @type {number} */ phase, /** @type {number} */ tone) => (tone > 0 ? `minepreggo:belly_p${phase}_t${tone}` : `minepreggo:belly_p${phase}`);

/** @type {Map<string, number>} player id -> the tick the "off-hand is taken" hint was last shown */
const hinted = new Map();

/** Her belly in her off-hand while she said yes and shows a belly (not as a spectator); gone otherwise. */
export function syncBelly(/** @type {Player} */ player) {
  const equipment = player.getComponent('minecraft:equippable');
  if (!equipment) return;
  const { belly, tone } = settingsOf(player);
  const phase = Number(property(player, 'phase', -1));
  const want = belly === true && phase >= 2 && phase <= 9 && player.getGameMode() !== GameMode.Spectator ? bellyItemId(phase, tone) : undefined;
  const held = equipment.getEquipment(EquipmentSlot.Offhand);
  if (!want) {
    if (held && BELLY_ITEM.test(held.typeId)) equipment.setEquipment(EquipmentSlot.Offhand, undefined);
    return;
  }
  if (held?.typeId === want) return;
  if (held && !BELLY_ITEM.test(held.typeId)) {
    // something else is in her off-hand: hers to put away
    const last = hinted.get(player.id) ?? -Infinity;
    if (system.currentTick - last >= OFFHAND_HINT_TICKS) {
      hinted.set(player.id, system.currentTick);
      player.onScreenDisplay.setActionBar({ translate: 'minepreggo.compat.offhand_taken' });
    }
    return;
  }
  // nothing there, or the belly of another phase or tone: swap it
  const stack = new ItemStack(want, 1);
  stack.lockMode = ItemLockMode.slot;
  stack.keepOnDeath = true;
  equipment.setEquipment(EquipmentSlot.Offhand, stack);
}

/** Clears belly items out of her inventory: they belong in the off-hand only (and a copy could be given away). */
export function sweep(/** @type {Player} */ player) {
  const container = player.getComponent('minecraft:inventory')?.container;
  if (!container) return;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack && BELLY_ITEM.test(stack.typeId)) container.setItem(slot, undefined);
  }
}

// --- consent --------------------------------------------------------------------------------

/** @type {Map<string, number>} player id -> the phase she was last asked at (also while the popup is open) */
const asked = new Map();
/** @type {Map<string, number>} player id -> the tick before which she is not asked again (she was busy) */
const askAfter = new Map();

/**
 * Asks her once per phase, from P2 and never in labor, whether her belly may take her off-hand.
 * She is asked again at the next phase if she closes the popup, and soon if another form was open.
 */
export function askBelly(/** @type {Player} */ player) {
  if (settingsOf(player).belly !== undefined) return false;
  const phase = Number(property(player, 'phase', -1));
  if (phase < 2 || LABOR.has(String(property(player, 'pose', 'none')))) return false;
  if (asked.get(player.id) === phase || (askAfter.get(player.id) ?? -Infinity) > system.currentTick) return false;
  asked.set(player.id, phase);
  const busy = () => {
    asked.delete(player.id);
    askAfter.set(player.id, system.currentTick + ASK_RETRY_TICKS);
  };
  try {
    new MessageFormData()
      .title({ translate: 'minepreggo.compat.ask_title' })
      .body({ translate: 'minepreggo.compat.ask_body' })
      .button1({ translate: 'minepreggo.compat.ask_yes' })
      .button2({ translate: 'minepreggo.compat.ask_no' })
      .show(player)
      .then((response) => {
        if (!player.isValid) return;
        if (response.canceled) {
          // closed: left unanswered until the next phase; busy: she never saw it
          if (response.cancelationReason === FormCancelationReason.UserBusy) busy();
          return;
        }
        if (response.selection === 0) {
          setSettings(player, { belly: true });
          player.onScreenDisplay.setActionBar({ translate: 'minepreggo.compat.belly_on' });
        } else if (response.selection === 1) {
          setSettings(player, { belly: false });
        }
      })
      .catch((error) => {
        busy();
        warnOnce('belly popup', error);
      });
  } catch (error) {
    busy();
    warnOnce('belly popup', error);
  }
  return true;
}

// --- poses ----------------------------------------------------------------------------------

/** The compat pose to play on her now, or undefined. @returns {Pose | undefined} */
export function poseOf(/** @type {Player} */ player) {
  const pose = String(property(player, 'pose', 'none'));
  const phase = Number(property(player, 'phase', -1));
  // the stop expressions end on v.mp_native too, in case a game ignored the blend weight on our model
  if (pose === 'rubbing') {
    if (phase < 0 || phase > 9) return undefined;
    return { animation: `${AS}belly_rubbing_p${phase}`, stop: `q.property('minepreggo:pose') != 'rubbing' || q.property('minepreggo:phase') != ${phase} || v.mp_native`, loop: 100 };
  }
  const entry = POSES[pose];
  return entry ? { animation: AS + entry[0], stop: `q.property('minepreggo:pose') != '${pose}' || v.mp_native`, loop: entry[1] } : undefined;
}

/**
 * The poses the heavy walk stops for: belly rubbing and her labor. Through the others (morning
 * sickness, fetal movement, a contraction, back pain) she keeps walking heavily, as in Java, where
 * the heavy walk is an additive animation of its own (and on our own player model).
 */
const STOPS_HEAVY_WALK = ['rubbing', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage'];

/** The heavy walk from P4 (it only shows while she walks). @returns {Pose | undefined} */
export function walkOf(/** @type {Player} */ player) {
  const pose = String(property(player, 'pose', 'none'));
  const phase = Number(property(player, 'phase', -1));
  if (STOPS_HEAVY_WALK.includes(pose) || phase < 4 || phase > 9) return undefined;
  const stops = STOPS_HEAVY_WALK.map((p) => `q.property('minepreggo:pose') == '${p}'`).join(' || ');
  return { animation: `${AS}walking_heavy_p${phase}`, stop: `q.property('minepreggo:phase') != ${phase} || ${stops} || v.mp_native`, loop: 100 };
}

/** @type {Map<string, Map<Track, { animation: string, at: number, seen: Set<string> }>>} mother id -> what each track last played, when, and to whom */
const sent = new Map();

const inRange = (/** @type {Player} */ mother, /** @type {Player} */ player) =>
  player.dimension.id === mother.dimension.id &&
  Math.hypot(player.location.x - mother.location.x, player.location.y - mother.location.y, player.location.z - mother.location.z) <= RANGE;

/**
 * Plays her pose (or heavy walk) on the games of the players near her: to all of them when it
 * changed or a loop has gone by, otherwise only to those who came near since. True if it played.
 */
export function deliver(/** @type {Player} */ mother, /** @type {Track} */ track, /** @type {Player[]} */ players) {
  const want = track === 'pose' ? poseOf(mother) : walkOf(mother);
  let tracks = sent.get(mother.id);
  if (!want) {
    tracks?.delete(track);
    if (tracks && !tracks.size) sent.delete(mother.id);
    return false;
  }
  const near = players.filter((p) => inRange(mother, p));
  const now = system.currentTick;
  const last = tracks?.get(track);
  /** @type {Player[]} */
  let to;
  if (!last || last.animation !== want.animation || now - last.at >= want.loop) {
    to = near;
    if (!tracks) sent.set(mother.id, (tracks = new Map()));
    tracks.set(track, { animation: want.animation, at: now, seen: new Set(near.map((p) => p.id)) });
  } else {
    to = near.filter((p) => !last.seen.has(p.id));
    for (const p of to) last.seen.add(p.id);
  }
  if (!to.length) return false;
  try {
    mother.playAnimation(want.animation, { controller: CONTROLLERS[track], blendOutTime: 0.25, stopExpression: want.stop, players: to });
  } catch (error) {
    warnOnce('pose', error);
  }
  return true;
}

/** A player who respawned or changed dimension: her own pose goes out again, and everyone else's reaches her again. */
function forget(/** @type {string} */ id) {
  sent.delete(id);
  for (const tracks of sent.values()) for (const state of tracks.values()) state.seen.delete(id);
}

// --- the loop and the events ----------------------------------------------------------------

system.runInterval(() => {
  const players = world.getPlayers();
  for (const player of players) {
    // one player's error (half loaded, just left) must not stop the others' bellies and poses
    try {
      syncBelly(player);
      askBelly(player);
      deliver(player, 'pose', players);
      deliver(player, 'walk', players);
    } catch (error) {
      warnOnce('update', error);
    }
  }
}, 10);

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  try {
    migrate(player);
    sweep(player);
  } catch (error) {
    warnOnce('spawn', error);
  }
  forget(player.id);
  // a one-time hint, after the join banner
  if (initialSpawn && player.getDynamicProperty(HINT) !== HINT_VERSION) {
    system.runTimeout(() => {
      if (!player.isValid) return;
      player.sendMessage({ translate: 'minepreggo.compat.hint' });
      player.setDynamicProperty(HINT, HINT_VERSION);
    }, 200);
  }
});

world.afterEvents.playerDimensionChange.subscribe(({ player }) => forget(player.id));

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  forget(playerId);
  hinted.delete(playerId);
  asked.delete(playerId);
  askAfter.delete(playerId);
});
