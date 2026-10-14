// /scriptevent minepreggo:debug [kick|birth|off]: shows the values the client renders from (the
// entity properties read back from the game) for you and the nearest preggo mob, and forces a
// pose for 10 seconds so the belly animations can be checked without waiting for a pregnancy.

import { Player, system } from '@minecraft/server';
import { FAMILY_TAG, debugPose as debugMob, getRecord as getMobRecord } from '../mobs/system.js';
import { debugPose as debugPlayer } from '../player/body.js';
import { getRecord } from '../pregnancy/system.js';

const PROPS = ['minepreggo:phase', 'minepreggo:pose', 'minepreggo:kick', 'minepreggo:growth'];

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

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (id !== 'minepreggo:debug' || !(sourceEntity instanceof Player)) return;
  const player = sourceEntity;
  const mode = message.trim().toLowerCase();
  const [mob] = player.dimension.getEntities({ families: [FAMILY_TAG], location: player.location, maxDistance: 16, closest: 1 });
  if (mode === 'kick' || mode === 'birth') {
    const pose = mode === 'kick' ? 'fetal_movement' : 'birth';
    debugPlayer(getRecord(player), pose, 2);
    if (mob) debugMob(getMobRecord(mob), pose, 2);
    player.sendMessage(`[Minepreggo debug] ${pose} forced for 10 s on you${mob ? ' and the nearest mob' : ''}: the belly must kick now.`);
  } else if (mode === 'off') {
    getRecord(player).debugUntil = 0;
    if (mob) getMobRecord(mob).debugUntil = 0;
  }
  player.sendMessage(`[Minepreggo debug] you: ${describe(player)}`);
  if (mob) player.sendMessage(`[Minepreggo debug] nearest mob ${describe(mob)}`);
  else player.sendMessage('[Minepreggo debug] no preggo mob within 16 blocks');
});
