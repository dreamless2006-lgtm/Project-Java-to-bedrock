// The Jenny Mod Java Port's girls in the Minepreggo mob system. tools/import-jenny.mjs merges that
// add-on into these packs and gives each girl the pregnancy properties, so the mob loop treats her
// like our own females (mobs/families.js marks them external: no taming, hunger or savage state of
// ours). What this file adds is the link the scenes make: when one of her own scenes that can get
// her pregnant finishes, she is. Her scenes fire data-driven entity events on her (and, for Ellie,
// on the stage entity that plays the scene), which is how they are recognised here. While one of
// her scenes plays and she is pregnant, her babies kick in bursts and, late in the pregnancy, her
// belly tightens in contractions (rhythm.js), on her and on the stage that plays it for her.

import { system, world } from '@minecraft/server';
import { babiesFromPotion } from '../pregnancy/math.js';
import { familyOf, getRecord, nameOf, particles, playSound, setSceneState, startPregnancy } from '../mobs/system.js';
import { KICKS_FROM, Rhythm, announce } from './rhythm.js';

/** @typedef {import('@minecraft/server').Entity} Entity */

/**
 * @typedef {object} Scenes how a girl's scenes announce themselves
 * @property {RegExp} starts the events that start one of her scenes (the last one is remembered)
 * @property {Record<string, number>} fertile the scenes that get her pregnant, with their length in ticks
 *   (the port's own durations): she conceives when one finishes after playing most of its length
 * @property {string[]} finish the events that end a scene (a stopped or interrupted one too)
 * @property {RegExp} intimate the events that start one of her intimate scenes (her belly joins in: kicks, contractions)
 */

/** @type {Record<string, Scenes>} */
export const PORT_GIRLS = {
  'fapcraft:jenny': { starts: /^jhjenjava:start_/, fertile: { 'jhjenjava:start_doggy_action': 845 }, finish: ['jhjenjava:finish_stage'], intimate: /^jhjenjava:start_(blowjob|boobjob|doggy_mount|doggy_action)$/ },
  'kum:bia': { starts: /^jh:start_/, fertile: { 'jh:start_prone': 698 }, finish: ['jh:finish'], intimate: /^jh:start_(anal|prone)$/ },
  'kum:slime_girl': { starts: /^jh:start_/, fertile: { 'jh:start_doggy': 759 }, finish: ['jh:finish'], intimate: /^jh:start_(blow|doggy)$/ },
  'kum:luna': { starts: /^jh:start_/, fertile: { 'jh:start_sitting': 528 }, finish: ['jh:finish'], intimate: /^jh:start_(touch|sitting)$/ },
  'kum:galath': { starts: /^jh:start_/, fertile: { 'jh:start_cowgirl': 332, 'jh:start_threesome': 554 }, finish: ['jh:finish'], intimate: /^jh:start_(anal|cowgirl|threesome)$/ },
  // Manglelie has no scenes of her own; she shares Galath's threesome.
  'kum:manglelie': { starts: /^$/, fertile: {}, finish: [], intimate: /^$/ },
  'jhallie4:allie': { starts: /^jhallie4:start_/, fertile: { 'jhallie4:start_reverse_cowgirl': 473 }, finish: ['jhallie4:finish_scene'], intimate: /^jhallie4:start_(deepthroat_first|deepthroat_repeat|reverse_cowgirl)$/ },
  'jhbee24:bee': { starts: /^jhbee24:start_/, fertile: { 'jhbee24:start_scene': 731 }, finish: ['jhbee24:finish'], intimate: /^jhbee24:start_(scene|blowjob)$/ },
  'jhkobold:kobold': { starts: /^jhkobold:start_/, fertile: { 'jhkobold:start_mating': 607 }, finish: ['jhkobold:finish'], intimate: /^jhkobold:start_(anal|blowjob|mating)$/ },
  // Ellie's scene is chosen on her stage entity. It ends with her recovery event (repeated until
  // she takes it), her hug with the stage's finish event, and either way her stage is removed.
  'jhelliedev:ellie': { starts: /^jhelliedev:start_scene_/, fertile: { 'jhelliedev:start_scene_cowgirl': 1019, 'jhelliedev:start_scene_missionary': 775 }, finish: ['jhelliedev:finish_stage', 'jhelliedev:finish_interaction'], intimate: /^jhelliedev:start_scene_(cowgirl|missionary|facefuck)$/ },
};
/** How much of a fertile scene has to play for her to conceive (one stopped at once does not count). */
export const FERTILE_SHARE = 0.75;
/** The scene stages that stand in for a girl while her scene plays: they show her belly size. */
export const PORT_STAGES = /** @type {Record<string, string>} */ ({ 'jhjenjava:jenny_stage': 'fapcraft:jenny', 'jhelliedev:ellie_stage': 'jhelliedev:ellie' });
export const PORT_GIRL_IDS = Object.keys(PORT_GIRLS);
const THREESOME = 'jh:start_threesome';
const STAGE_RANGE = 8;

/**
 * The scene each girl is in (the one she last started), by entity id.
 * @type {Map<string, { event: string, tick: number }>}
 */
const lastScene = new Map();
/** @type {Map<string, string>} a stage entity id -> the girl whose scene it plays */
const stageOf = new Map();
/** A port scene never runs longer than this (her finish event ends it sooner). */
export const PORT_SCENE_TICKS = 3600;
/**
 * The rhythm of a pregnant girl's belly during one of her scenes, by her entity id.
 * @type {Map<string, { rhythm: Rhythm, start: number, until: number }>}
 */
const rhythms = new Map();
export const portRhythmOf = (/** @type {Entity} */ entity) => rhythms.get(entity.id);

/** Whether one of her own scenes is playing (started, not finished; never longer than PORT_SCENE_TICKS). */
export function inPortScene(/** @type {Entity} */ entity) {
  const scene = lastScene.get(entity.id);
  return !!scene && system.currentTick - scene.tick < PORT_SCENE_TICKS;
}

/** The stages near her that stand in for her. */
function stagesOf(/** @type {Entity} */ girl) {
  /** @type {Entity[]} */
  const out = [];
  for (const [stage, standsFor] of Object.entries(PORT_STAGES)) {
    if (standsFor !== girl.typeId) continue;
    try {
      out.push(...girl.dimension.getEntities({ type: stage, location: girl.location, maxDistance: STAGE_RANGE }));
    } catch {
      // unloaded
    }
  }
  return out;
}

/** Shows a beat on a stage (it has no mob record of its own: the properties are written directly). */
function showOnStage(/** @type {Entity} */ stage, /** @type {Entity} */ girl, /** @type {string} */ state, /** @type {number} */ kick) {
  try {
    stage.setProperty('minepreggo:belly', girl.getProperty('minepreggo:belly') ?? 'none');
    stage.setProperty('minepreggo:phase', girl.getProperty('minepreggo:phase') ?? -1);
    stage.setProperty('minepreggo:growth', girl.getProperty('minepreggo:growth') ?? 0);
    stage.setProperty('minepreggo:kick', kick);
    stage.setProperty('minepreggo:scene', state);
  } catch {
    // a stage of a build without these properties
  }
}

/** One of her scenes started: if she is pregnant enough to feel the babies, her belly joins in. */
export function startPortRhythm(/** @type {Entity} */ girl) {
  const p = getRecord(girl).data.pregnancy;
  if (!p || p.phase < KICKS_FROM || !carrying(p)) return false;
  rhythms.set(girl.id, { rhythm: new Rhythm(), start: system.currentTick, until: system.currentTick + PORT_SCENE_TICKS });
  return true;
}

/** Her scene is over: her belly and her stage's are hers again. */
export function stopPortRhythm(/** @type {Entity} */ girl) {
  if (!rhythms.delete(girl.id)) return;
  if (!girl.isValid) return;
  setSceneState(getRecord(girl), 'none');
  for (const stage of stagesOf(girl)) showOnStage(stage, girl, 'none', 0);
}

system.runInterval(() => {
  for (const [id, run] of [...rhythms]) {
    const girl = world.getEntity(id);
    if (!girl?.isValid || system.currentTick >= run.until) {
      if (girl?.isValid) stopPortRhythm(girl);
      else rhythms.delete(id);
      continue;
    }
    const record = getRecord(girl);
    const p = record.data.pregnancy;
    if (!p) {
      stopPortRhythm(girl);
      continue;
    }
    // Her scenes build up: calm at first, intense after half a minute.
    const heat = Math.min(0.9, 0.3 + (system.currentTick - run.start) / 1000);
    const beat = run.rhythm.step(p.phase, heat, system.currentTick);
    if (!beat) continue;
    setSceneState(record, beat.state, beat.kick);
    for (const stage of stagesOf(girl)) showOnStage(stage, girl, beat.state, beat.kick);
    const said = announce(beat, p.womb.length + (p.birth ? 1 : 0));
    if (!said) continue;
    playSound(girl, said.sound, said.volume);
    for (const player of girl.dimension.getPlayers({ location: girl.location, maxDistance: 10 })) {
      player.onScreenDisplay.setActionBar({ translate: said.key, with: { rawtext: [nameOf(girl)] } });
    }
  }
}, 10);

/** Babies still inside her (none after the birth, while she rests). */
export const carrying = (/** @type {any} */ p) => p.womb.length > 0 || !!p.birth;

function nearest(/** @type {Entity} */ from, /** @type {string} */ type, /** @type {number} */ range) {
  try {
    return from.dimension.getEntities({ type, location: from.location, maxDistance: range, closest: 1 })[0];
  } catch {
    return undefined;
  }
}

/** The scene got her pregnant: P0 now, like a Potion of Impregnation I. */
export function conceive(/** @type {Entity} */ entity) {
  if (!entity.isValid || !familyOf(entity)) return false;
  const record = getRecord(entity);
  if (!startPregnancy(record, babiesFromPotion(0))) return false;
  particles(entity, 'minecraft:heart_particle', 8, 1.5);
  for (const player of entity.dimension.getPlayers({ location: entity.location, maxDistance: 12 })) {
    player.sendMessage({ translate: 'minepreggo.port.pregnant', with: { rawtext: [nameOf(entity)] } });
  }
  return true;
}

/** One of her scenes started (on her, or on the stage that plays it for her). */
function sceneStarted(/** @type {Entity} */ girl, /** @type {string} */ eventId) {
  lastScene.set(girl.id, { event: eventId, tick: system.currentTick });
  // Only her intimate scenes bring her belly in (not a fight, a walk or a chat).
  if (!PORT_GIRLS[girl.typeId].intimate.test(eventId)) return;
  startPortRhythm(girl);
  if (eventId === THREESOME) {
    const manglelie = nearest(girl, 'kum:manglelie', 6);
    if (manglelie) startPortRhythm(manglelie);
  }
}

/** Her scene is over: her belly calms down, and a fertile scene that played out gets her pregnant. */
export function sceneFinished(/** @type {Entity} */ girl) {
  stopPortRhythm(girl);
  const started = lastScene.get(girl.id);
  lastScene.delete(girl.id);
  const length = started && PORT_GIRLS[girl.typeId]?.fertile[started.event];
  if (!started || !length || system.currentTick - started.tick < length * FERTILE_SHARE) return;
  conceive(girl);
  if (started.event === THREESOME) {
    const manglelie = nearest(girl, 'kum:manglelie', 6);
    if (manglelie) {
      stopPortRhythm(manglelie);
      conceive(manglelie);
    }
  }
}

world.afterEvents.dataDrivenEntityTrigger.subscribe(
  ({ entity, eventId }) => {
    if (!entity?.isValid) return;
    const standsFor = PORT_STAGES[entity.typeId];
    if (standsFor) {
      const girl = nearest(entity, standsFor, STAGE_RANGE);
      if (girl && PORT_GIRLS[standsFor].starts.test(eventId)) {
        stageOf.set(entity.id, girl.id);
        sceneStarted(girl, eventId);
      }
      return;
    }
    const scenes = PORT_GIRLS[entity.typeId];
    if (!scenes) return;
    if (scenes.starts.test(eventId)) sceneStarted(entity, eventId);
    else if (scenes.finish.includes(eventId) && lastScene.has(entity.id)) sceneFinished(entity);
  },
  { entityTypes: [...PORT_GIRL_IDS, ...Object.keys(PORT_STAGES)] }
);

// A stage shows the belly of the girl it stands in for.
world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  const standsFor = PORT_STAGES[entity.typeId];
  if (!standsFor) return;
  system.run(() => {
    try {
      if (!entity.isValid) return;
      const girl = nearest(entity, standsFor, STAGE_RANGE);
      if (girl) showOnStage(entity, girl, rhythms.get(girl.id)?.rhythm.beat?.state ?? 'none', rhythms.get(girl.id)?.rhythm.beat?.kick ?? 0);
    } catch (error) {
      console.warn(`[minepreggo] cannot show the belly on ${entity.typeId}: ${error}`);
    }
  });
});

world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  lastScene.delete(removedEntityId);
  rhythms.delete(removedEntityId);
  // A stage removed at the end of her scene (Ellie's are removed without an event of their own).
  const girlId = stageOf.get(removedEntityId);
  if (!girlId) return;
  stageOf.delete(removedEntityId);
  system.run(() => {
    const girl = world.getEntity(girlId);
    if (girl?.isValid && lastScene.has(girlId)) sceneFinished(girl);
  });
});
