// Debug tools, shared by /scriptevent minepreggo:debug and the guide book's "Debug tools" chapter:
// they show the values the client renders from (the entity properties read back from the game)
// for the player and the nearest preggo mob, and force a belly size or a pose for a while so the
// belly and its animations can be checked without waiting for a pregnancy to grow (P0 and P1
// bellies are flat, the kicks start at P3).
//   /scriptevent minepreggo:debug kick | birth | belly <0-9> | off

import { Player, system } from '@minecraft/server';
import { FAMILY_TAG, clearDebug as clearMob, debugPose as debugMob, getRecord as getMobRecord } from '../mobs/system.js';
import { clearDebug as clearPlayer, debugPose as debugPlayer } from '../player/body.js';
import { getRecord } from '../pregnancy/system.js';
import { VERSION } from '../version.js';

const PROPS = ['minepreggo:phase', 'minepreggo:pose', 'minepreggo:kick', 'minepreggo:growth'];
/** How long a forced state lasts when asked for with the command (10 s). */
export const COMMAND_TICKS = 200;

/** @param {import('@minecraft/server').Entity} entity */
function describe(entity) {
  const values = PROPS.map((id) => {
    try {
      return `${id.split(':')[1]}=${JSON.stringify(entity.getProperty(id))}`;
    } catch {
      return `${id.split(':')[1]}=missing`;
    }
  });
  const variant = /** @type {any} */ (entity.getComponent('minecraft:variant'))?.value;
  return `${entity.typeId}: ${values.join(' ')}${variant === undefined ? '' : ` variant=${variant}`}`;
}

/** @param {Player} player */
export function isFemale(player) {
  try {
    return player.getProperty('minepreggo:gender') === 'female';
  } catch {
    return false;
  }
}

/** The preggo mob the debug tools act on: the nearest one within 16 blocks. */
export function nearestMob(/** @type {Player} */ player) {
  const [mob] = player.dimension.getEntities({ families: [FAMILY_TAG], location: player.location, maxDistance: 16, closest: 1 });
  return mob;
}

const targets = (/** @type {Player} */ player) => `you${nearestMob(player) ? ' and the nearest mob' : ''}`;
const seconds = (/** @type {number} */ ticks) => `${Math.round(ticks / 20)} s`;

/** Forces a kick or a birth push on the player and the nearest mob (on a P7 belly when theirs is small). */
export function forcePose(/** @type {Player} */ player, /** @type {'kick' | 'birth'} */ mode, ticks = COMMAND_TICKS) {
  const pose = mode === 'kick' ? 'fetal_movement' : 'birth';
  debugPlayer(getRecord(player), pose, 2, ticks);
  const mob = nearestMob(player);
  if (mob) debugMob(getMobRecord(mob), pose, 2, ticks);
  return `${pose} forced for ${seconds(ticks)} on ${targets(player)}: the belly must kick now (a flat belly is shown as P7 meanwhile).`;
}

/** Shows belly size P`size` on the player and the nearest mob for a while. */
export function forceBelly(/** @type {Player} */ player, /** @type {number} */ size, ticks = COMMAND_TICKS) {
  const phase = Math.max(0, Math.min(9, Math.trunc(size) || 0));
  debugPlayer(getRecord(player), 'none', 0, ticks, phase);
  const mob = nearestMob(player);
  if (mob) debugMob(getMobRecord(mob), 'none', 0, ticks, phase);
  return `belly P${phase} forced for ${seconds(ticks)} on ${targets(player)}: that belly must show now${phase <= 1 ? ' (P0 and P1 are flat by design)' : phase === 2 ? ' (a small bump; the monster creeper girl has none before P3)' : ''}.`;
}

/** Ends every forced state; the real values come back at once. */
export function stopForcing(/** @type {Player} */ player) {
  clearPlayer(getRecord(player));
  const mob = nearestMob(player);
  if (mob) clearMob(getMobRecord(mob));
  return 'Forced states ended; the real pregnancy shows again.';
}

/** What the client renders from, for the player and the nearest mob, with the running version. */
export function report(/** @type {Player} */ player) {
  const mob = nearestMob(player);
  return [
    `[Minepreggo ${VERSION}] you: ${describe(player)}`,
    ...(isFemale(player) ? [] : ['your character is not female, so nothing shows on you: choose the female body (/scriptevent minepreggo:gender female or the Debug tools in the guide book)']),
    mob ? `nearest mob ${describe(mob)}` : 'no preggo mob within 16 blocks',
    `the join message must say resources ${VERSION} too; if not, remove Minepreggo (Resources) from the world's Resource Packs and add it again`,
  ];
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (id !== 'minepreggo:debug' || !(sourceEntity instanceof Player)) return;
  const player = sourceEntity;
  const [mode = '', argument] = message.trim().toLowerCase().split(/\s+/);
  const say = (/** @type {string} */ line) => player.sendMessage(`[Minepreggo debug] ${line}`);
  if (mode === 'kick' || mode === 'birth') say(forcePose(player, mode));
  else if (mode === 'belly' && (argument === undefined || !Number.isNaN(Number(argument)))) say(forceBelly(player, argument === undefined ? 7 : Number(argument)));
  else if (mode === 'off') say(stopForcing(player));
  else if (mode !== '') say('usage: /scriptevent minepreggo:debug kick | birth | belly <0-9> | off');
  for (const line of report(player)) player.sendMessage(line);
});
