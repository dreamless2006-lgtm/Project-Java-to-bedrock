// The kobold lays eggs (a kobold is a little dragon): every birth of hers is an egg
// (mobs/families.js eggItem), and her Mating scene, late in her pregnancy, becomes an egg-laying
// scene. Her labor comes on at the start of it: the belly hardens in contractions while her partner
// is with her; once he pulls back (23.9 s into her scene), an egg crowns between her legs and slides
// out with her pushes, and as her own animation lifts the egg in her hand (26.8 s) it is the
// partner's. A second egg follows before the scene ends. Eggs left when the scene is over come with
// the partner's help (the assisted birth of jenny/belly_scenes.js), or she lays them on her own.
// The egg on its way out is the crowning of her belly geometries (tools/lib/crowning.mjs, an egg
// instead of a baby), shown with the progress this module sends.

import { system, world } from '@minecraft/server';
import { CONFIG } from '../pregnancy/data.js';
import { deliverNext, enterBirth, getRecord, nameOf, particles, playSound, refreshClient, setSceneState, startLaying } from '../mobs/system.js';
import { playerBusy } from './occupancy.js';
import { carrying, sceneHooks } from './port.js';
import { startBellyScene } from './belly_scenes.js';

/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../mobs/state.js').MobRecord} MobRecord */

export const KOBOLD = 'jhkobold:kobold';
/**
 * The scenes that become an egg-laying scene, with the eggs they have time for: when each crowns,
 * when it is out, and when it is handed over (ticks from the scene's start event, after her
 * partner has pulled back, by the port's own animation).
 */
export const LAYING_SCENES = /** @type {Record<string, { crown: number, out: number, hand: number }[]>} */ ({
  'jhkobold:start_mating': [
    { crown: 479, out: 520, hand: 537 },
    { crown: 546, out: 590, hand: 598 },
  ],
});
const LABOR = new Set(['WATER_BREAKING', 'PREBIRTH', 'BIRTH']);
/** A contraction every few seconds while she waits to lay. */
const CONTRACTION_EVERY = 120;

/**
 * How likely a laying scene is to make her lay: always in labor or at the end of her birth phase,
 * from about a third of the time early in it, never before it.
 * @param {any} p her pregnancy
 */
export function layingChance(p) {
  if (!p || !carrying(p) || p.pain?.type === 'MISCARRIAGE' || p.pain?.type === 'POSTBIRTH') return 0;
  if (LABOR.has(p.pain?.type)) return 1;
  if (p.phase < 4 || p.phase < p.lastPhase) return 0;
  const days = p.daysByPhase[p.phase] || 1;
  const done = (p.daysPassed + p.timer / CONFIG.ticksPerPregnancyDay) / days;
  return done >= 1 ? 1 : 0.35 + 0.65 * Math.max(0, done);
}

/**
 * @typedef {object} Laying
 * @property {number} start the tick her scene started
 * @property {{ crown: number, out: number, hand: number }[]} slots
 * @property {number} slot the egg on its way now
 * @property {string | undefined} partnerId
 * @property {number} nextContraction
 * @property {number} calmAt when the contraction eases off
 * @property {number} nextPush
 * @property {number} laid eggs laid in this scene
 */

/** @type {Map<string, Laying>} by her entity id */
const layings = new Map();
export const layingOf = (/** @type {Entity} */ entity) => layings.get(entity.id);

const tell = (/** @type {Entity} */ girl, /** @type {string} */ key, /** @type {any[]} */ extra = []) => {
  for (const player of girl.dimension.getPlayers({ location: girl.location, maxDistance: 10 })) {
    player.onScreenDisplay.setActionBar({ translate: key, with: { rawtext: [nameOf(girl), ...extra] } });
  }
};

function nearestPlayer(/** @type {Entity} */ girl) {
  try {
    return girl.dimension.getPlayers({ location: girl.location, maxDistance: 6, closest: 1 })[0];
  } catch {
    return undefined;
  }
}

/** Her scene starts: whether it becomes an egg-laying scene. */
export function beginLaying(/** @type {Entity} */ girl, /** @type {string} */ eventId, random = Math.random) {
  if (girl.typeId !== KOBOLD || !LAYING_SCENES[eventId]) return false;
  const record = getRecord(girl);
  if (random() >= layingChance(record.data.pregnancy)) return false;
  if (!startLaying(record)) return false;
  const partner = nearestPlayer(girl);
  record.laying = { progress: 0 };
  record.birthHelper = partner?.id;
  layings.set(girl.id, { start: system.currentTick, slots: LAYING_SCENES[eventId], slot: 0, partnerId: partner?.id, nextContraction: system.currentTick, calmAt: 0, nextPush: 0, laid: 0 });
  tell(girl, 'minepreggo.egg.coming');
  refreshClient(record);
  return true;
}

/** Her laying scene is over: eggs left come with the partner's help, or she lays them on her own. */
export function endLaying(/** @type {Entity} */ girl) {
  const lay = layings.get(girl.id);
  if (!lay) return;
  layings.delete(girl.id);
  const record = getRecord(girl);
  record.laying = undefined;
  setSceneState(record, 'none');
  const p = record.data.pregnancy;
  if (!p || !carrying(p)) {
    record.birthHelper = undefined;
    return;
  }
  record.birthHelper = undefined;
  refreshClient(record);
  const partner = lay.partnerId ? world.getEntity(lay.partnerId) : undefined;
  if (!partner?.isValid || partner.typeId !== 'minecraft:player') return;
  // once the port has given the player back (their own body and input), they can help her push
  system.runTimeout(() => {
    if (!girl.isValid || !partner.isValid || playerBusy(partner.id)) return;
    if (startBellyScene(getRecord(girl), /** @type {Player} */ (partner), 'birth')) {
      /** @type {Player} */ (partner).sendMessage({ translate: 'minepreggo.egg.more', with: { rawtext: [nameOf(girl)] } });
    }
  }, 10);
}

/** One step of a laying scene (every 2 ticks). */
function step(/** @type {Entity} */ girl, /** @type {Laying} */ lay) {
  const record = getRecord(girl);
  const p = record.data.pregnancy;
  if (!p || !carrying(p)) return endLaying(girl);
  const now = system.currentTick;
  const t = now - lay.start;
  const slot = lay.slots[lay.slot];
  if (!slot || t < slot.crown) {
    // waiting to lay: her belly hardens in contractions
    if (lay.calmAt && now >= lay.calmAt) {
      lay.calmAt = 0;
      setSceneState(record, 'calm');
    }
    if (now >= lay.nextContraction) {
      lay.nextContraction = now + CONTRACTION_EVERY;
      lay.calmAt = now + 70;
      setSceneState(record, 'contraction');
      playSound(girl, 'minepreggo.pregnancy_pain', 0.35);
      if (lay.laid === 0) tell(girl, 'minepreggo.egg.contraction');
    }
    return;
  }
  if (p.pain?.type !== 'BIRTH') enterBirth(record);
  const laying = /** @type {{ progress: number }} */ (record.laying);
  if (t < slot.out) {
    // her pushes: the egg crowns and slides out between her legs
    laying.progress = Math.round(Math.min(1, (t - slot.crown) / (slot.out - slot.crown)) * 100) / 100;
    if (now >= lay.nextPush) {
      lay.nextPush = now + 14;
      playSound(girl, 'minepreggo.pregnancy_pain', 0.3);
    }
    refreshClient(record);
    return;
  }
  if (t < slot.hand) {
    laying.progress = 1;
    refreshClient(record);
    return;
  }
  // she lifts it: into her partner's hands
  const last = deliverNext(record);
  lay.laid++;
  lay.slot++;
  laying.progress = 0;
  particles(girl, 'minecraft:heart_particle', 4, 0.8);
  if (last) {
    tell(girl, 'minepreggo.egg.all_laid');
    layings.delete(girl.id);
    record.laying = undefined;
    record.birthHelper = undefined;
    setSceneState(record, 'none');
  } else tell(girl, 'minepreggo.egg.laid');
  refreshClient(record);
}

sceneHooks.started.push((girl, eventId) => beginLaying(girl, eventId));
sceneHooks.finished.push((girl) => endLaying(girl));

system.runInterval(() => {
  for (const [id, lay] of [...layings]) {
    const girl = world.getEntity(id);
    if (!girl?.isValid) {
      layings.delete(id);
      continue;
    }
    step(girl, lay);
  }
}, 2);

world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => void layings.delete(removedEntityId));
