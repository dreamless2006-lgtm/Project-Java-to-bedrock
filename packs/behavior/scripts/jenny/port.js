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
 * @property {string[]} fertile the scenes that get her pregnant when they finish
 * @property {string} finish the event that ends a scene
 */

/** @type {Record<string, Scenes>} */
export const PORT_GIRLS = {
  'fapcraft:jenny': { starts: /^jhjenjava:start_/, fertile: ['jhjenjava:start_doggy_action'], finish: 'jhjenjava:finish_stage' },
  'kum:bia': { starts: /^jh:start_/, fertile: ['jh:start_prone'], finish: 'jh:finish' },
  'kum:slime_girl': { starts: /^jh:start_/, fertile: ['jh:start_doggy'], finish: 'jh:finish' },
  'kum:luna': { starts: /^jh:start_/, fertile: ['jh:start_sitting'], finish: 'jh:finish' },
  'kum:galath': { starts: /^jh:start_/, fertile: ['jh:start_cowgirl', 'jh:start_threesome'], finish: 'jh:finish' },
  // Manglelie has no scenes of her own; she shares Galath's threesome.
  'kum:manglelie': { starts: /^$/, fertile: [], finish: '' },
  'jhallie4:allie': { starts: /^jhallie4:start_/, fertile: ['jhallie4:start_reverse_cowgirl'], finish: 'jhallie4:finish_scene' },
  'jhbee24:bee': { starts: /^jhbee24:start_/, fertile: ['jhbee24:start_scene'], finish: 'jhbee24:finish' },
  'jhkobold:kobold': { starts: /^jhkobold:start_/, fertile: ['jhkobold:start_mating'], finish: 'jhkobold:finish' },
  // Ellie's scene is chosen on her stage entity; her own finish event ends it.
  'jhelliedev:ellie': { starts: /^jhelliedev:start_scene_/, fertile: ['jhelliedev:start_scene_cowgirl', 'jhelliedev:start_scene_missionary'], finish: 'jhelliedev:finish_stage' },
};
/** The scene stages that stand in for a girl while her scene plays: they show her belly size. */
export const PORT_STAGES = /** @type {Record<string, string>} */ ({ 'jhjenjava:jenny_stage': 'fapcraft:jenny', 'jhelliedev:ellie_stage': 'jhelliedev:ellie' });
export const PORT_GIRL_IDS = Object.keys(PORT_GIRLS);
const THREESOME = 'jh:start_threesome';
const STAGE_RANGE = 8;

/** The scene each girl last started, by entity id. */
const lastScene = new Map();
/** A port scene never runs longer than this (her finish event ends it sooner). */
export const PORT_SCENE_TICKS = 3600;
/**
 * The rhythm of a pregnant girl's belly during one of her scenes, by her entity id.
 * @type {Map<string, { rhythm: Rhythm, start: number, until: number }>}
 */
const rhythms = new Map();
export const portRhythmOf = (/** @type {Entity} */ entity) => rhythms.get(entity.id);

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
    stage.setProperty('minepreggo:kick', kick);
    stage.setProperty('minepreggo:scene', state);
  } catch {
    // a stage of a build without these properties
  }
}

/** One of her scenes started: if she is pregnant enough to feel the babies, her belly joins in. */
export function startPortRhythm(/** @type {Entity} */ girl) {
  const p = getRecord(girl).data.pregnancy;
  if (!p || p.phase < KICKS_FROM) return false;
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
    const said = announce(beat);
    if (!said) continue;
    playSound(girl, said.sound, said.volume);
    for (const player of girl.dimension.getPlayers({ location: girl.location, maxDistance: 10 })) {
      player.onScreenDisplay.setActionBar({ translate: said.key, with: { rawtext: [nameOf(girl)] } });
    }
  }
}, 10);

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

world.afterEvents.dataDrivenEntityTrigger.subscribe(
  ({ entity, eventId }) => {
    if (!entity?.isValid) return;
    const standsFor = PORT_STAGES[entity.typeId];
    if (standsFor) {
      const girl = nearest(entity, standsFor, STAGE_RANGE);
      if (girl && PORT_GIRLS[standsFor].starts.test(eventId)) {
        lastScene.set(girl.id, eventId);
        startPortRhythm(girl);
      }
      return;
    }
    const scenes = PORT_GIRLS[entity.typeId];
    if (!scenes) return;
    if (scenes.starts.test(eventId)) {
      lastScene.set(entity.id, eventId);
      startPortRhythm(entity);
      return;
    }
    if (eventId !== scenes.finish) return;
    stopPortRhythm(entity);
    const started = lastScene.get(entity.id);
    lastScene.delete(entity.id);
    if (!started || !scenes.fertile.includes(started)) return;
    conceive(entity);
    if (started === THREESOME) {
      const manglelie = nearest(entity, 'kum:manglelie', 6);
      if (manglelie) conceive(manglelie);
    }
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
});
