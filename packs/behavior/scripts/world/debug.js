// /scriptevent minepreggo:debug [kick|birth|belly <0-9>|off]: shows the values the client renders
// from (the entity properties read back from the game) for you and the nearest preggo mob, and
// forces a belly size or a pose for 10 seconds so the belly and its animations can be checked
// without waiting for a pregnancy to grow (P0 and P1 bellies are flat, the kicks start at P3).

import { Player, system } from '@minecraft/server';
import { FAMILY_TAG, clearDebug as clearMob, debugPose as debugMob, getRecord as getMobRecord } from '../mobs/system.js';
import { clearDebug as clearPlayer, debugPose as debugPlayer } from '../player/body.js';
import { getRecord } from '../pregnancy/system.js';
import { VERSION } from '../version.js';

const PROPS = ['minepreggo:phase', 'minepreggo:pose', 'minepreggo:kick', 'minepreggo:growth'];
const TICKS = 200;

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
function isFemale(player) {
  try {
    return player.getProperty('minepreggo:gender') === 'female';
  } catch {
    return false;
  }
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (id !== 'minepreggo:debug' || !(sourceEntity instanceof Player)) return;
  const player = sourceEntity;
  const [mode = '', argument] = message.trim().toLowerCase().split(/\s+/);
  const [mob] = player.dimension.getEntities({ families: [FAMILY_TAG], location: player.location, maxDistance: 16, closest: 1 });
  const targets = `you${mob ? ' and the nearest mob' : ''}`;
  if (mode === 'kick' || mode === 'birth') {
    const pose = mode === 'kick' ? 'fetal_movement' : 'birth';
    debugPlayer(getRecord(player), pose, 2, TICKS);
    if (mob) debugMob(getMobRecord(mob), pose, 2, TICKS);
    player.sendMessage(`[Minepreggo debug] ${pose} forced for 10 s on ${targets}: the belly must kick now (a flat belly is shown as P7 meanwhile).`);
  } else if (mode === 'belly') {
    const size = argument === undefined ? 7 : Math.max(0, Math.min(9, Math.trunc(Number(argument)) || 0));
    debugPlayer(getRecord(player), 'none', 0, TICKS, size);
    if (mob) debugMob(getMobRecord(mob), 'none', 0, TICKS, size);
    player.sendMessage(`[Minepreggo debug] belly P${size} forced for 10 s on ${targets}: that belly must show now${size <= 1 ? ' (P0 and P1 are flat by design)' : ''}.`);
  } else if (mode === 'off') {
    clearPlayer(getRecord(player));
    if (mob) clearMob(getMobRecord(mob));
  } else if (mode !== '') {
    player.sendMessage('[Minepreggo debug] usage: /scriptevent minepreggo:debug kick | birth | belly <0-9> | off');
  }
  player.sendMessage(`[Minepreggo debug ${VERSION}] you: ${describe(player)}`);
  if (!isFemale(player)) player.sendMessage('[Minepreggo debug] your character is not female, so nothing shows on you: /scriptevent minepreggo:gender female');
  if (mob) player.sendMessage(`[Minepreggo debug] nearest mob ${describe(mob)}`);
  else player.sendMessage('[Minepreggo debug] no preggo mob within 16 blocks');
});
