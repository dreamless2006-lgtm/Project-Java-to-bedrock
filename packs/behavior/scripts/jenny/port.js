// The Jenny Mod Java Port's girls in the Minepreggo mob system. tools/import-jenny.mjs merges that
// add-on into these packs and gives each girl the pregnancy properties, so the mob loop treats her
// like our own females (mobs/families.js marks them external: no taming, hunger or savage state of
// ours). What this file adds is the link the scenes make: when one of her own scenes that can get
// her pregnant finishes, she is. Her scenes fire data-driven entity events on her (and, for Ellie,
// on the stage entity that plays the scene), which is how they are recognised here.

import { system, world } from '@minecraft/server';
import { babiesFromPotion } from '../pregnancy/math.js';
import { familyOf, getRecord, nameOf, particles, startPregnancy } from '../mobs/system.js';

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
      if (girl && PORT_GIRLS[standsFor].starts.test(eventId)) lastScene.set(girl.id, eventId);
      return;
    }
    const scenes = PORT_GIRLS[entity.typeId];
    if (!scenes) return;
    if (scenes.starts.test(eventId)) {
      lastScene.set(entity.id, eventId);
      return;
    }
    if (eventId !== scenes.finish) return;
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
      if (girl) entity.setProperty('minepreggo:belly', girl.getProperty('minepreggo:belly') ?? 'none');
    } catch (error) {
      console.warn(`[minepreggo] cannot show the belly on ${entity.typeId}: ${error}`);
    }
  });
});

world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => lastScene.delete(removedEntityId));
