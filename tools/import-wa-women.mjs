// Gives every humanoid people of the World Alliance add-on (tools/import-worldalliance.mjs) its women,
// at import time like the add-on itself: nothing of it is committed. They stay the add-on's own mob
// types (its kingdoms, armies and scripts know their units by type), so a woman is a unit whose
// minepreggo:female property is 2: the script rolls it when the unit first appears
// (packs/behavior/scripts/mobs/worldbox_women.js, half of them), and the pregnancy system takes her
// as a woman of the HUMAN kind (mobs/families.js WORLDBOX_WOMAN).
//
// Each rig the add-on's people use (its own models, and the vanilla ones it borrows) gets two
// overlays the client draws over the unit with her own texture: a chest (cut from her shirt's front,
// so it wears her outfit) and a blocky belly, like her people's boxes, fitted to her waist for every size (tools/lib/belly-fit.mjs)
// in her skin tone, with the kicks, swelling and walk jiggle of our other women. Both hang from copies
// of her rig's bones (same names and pivots), so her own animations move them with her.
// Animals, vehicles, blobs, golems, dragons and tiny folk (pixies) are left as they are.
//
// Run: node tools/import-wa-women.mjs (part of npm run import; after tools/import-worldalliance.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CUBE_BELLY, fitBelly, measureBody, roundBelly } from './lib/belly-fit.mjs';
import { bellyTexture, skinTone } from './lib/belly-skin.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { walkJiggleAnimation } from './lib/walk-jiggle.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'worldalliance_port';
const FEMALE = `${MOD}:female`;
const JIGGLE = `animation.${MOD}.worldbox_woman.walk_jiggle`;
const RC_BELLY = `controller.render.${MOD}.worldbox_woman.belly`;
/** Rigs of the add-on's own that are not women's bodies (a fairy no taller than a sapling). */
const SKIPPED_RIGS = new Set(['geometry.pixie']);

/**
 * The vanilla rigs the add-on's people borrow (their files are the game's): the body's pivot and
 * torso cube, the head cube, the legs' pivots and the rig's texture size.
 */
const HUMANOID = { body: [0, 24, 0], torso: { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }, head: { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }, legs: [[-1.9, 12, 0], [1.9, 12, 0]] };
const ILLAGER = { body: [0, 24, 0], torso: { origin: [-4, 12, -3], size: [8, 12, 6], uv: [16, 20] }, head: { origin: [-4, 24, -4], size: [8, 10, 8], uv: [0, 0] }, legs: [[-2, 12, 0], [2, 12, 0]] };
const ENDERMAN = { body: [0, 38, 0], torso: { origin: [-4, 26, -2], size: [8, 12, 4], uv: [32, 16] }, head: { origin: [-4, 38, -4], size: [8, 8, 8], uv: [0, 0] }, legs: [[-2, 26, 0], [2, 26, 0]] };
const VANILLA = /** @type {Record<string, [typeof HUMANOID, number, number]>} */ ({
  'geometry.zombie.v1.8': [HUMANOID, 64, 64],
  'geometry.zombie.husk.v1.8': [HUMANOID, 64, 64],
  'geometry.zombie.drowned.v1.16': [HUMANOID, 64, 64],
  'geometry.humanoid.custom': [HUMANOID, 64, 64],
  'geometry.skeleton.v1.8': [HUMANOID, 64, 32],
  'geometry.skeleton.wither.v1.8': [HUMANOID, 64, 32],
  'geometry.piglin': [{ ...HUMANOID, head: { origin: [-5, 24, -4], size: [10, 8, 8], uv: [0, 0] } }, 64, 64],
  'geometry.pillager': [ILLAGER, 64, 64],
  'geometry.vindicator.v1.8': [ILLAGER, 64, 64],
  'geometry.evoker.v1.8': [ILLAGER, 64, 64],
  'geometry.villager_v2': [ILLAGER, 64, 64],
  'geometry.villager.witch.v1.8': [ILLAGER, 64, 128],
  'geometry.enderman.v1.8': [ENDERMAN, 64, 32],
});

const writeJson = (/** @type {string} */ file, /** @type {unknown} */ doc) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
};
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
function walk(/** @type {string} */ dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

if (!existsSync(join(BP, 'entities', PORT))) {
  console.warn('warning: World Alliance is not imported; it has no women to give');
  process.exit(0);
}

// ---- the rigs ----------------------------------------------------------------------------------------
/** @type {Map<string, any>} the add-on's own geometries by identifier */
const geometries = new Map();
for (const file of walk(join(RP, 'models', PORT))) {
  if (!file.endsWith('.json')) continue;
  try {
    for (const g of read(file)['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, g);
  } catch { /* not a geometry file */ }
}

/**
 * @typedef {object} Rig a people's body as the overlays need it
 * @property {string} key short name for files and ids
 * @property {{ name: string, parent?: string, pivot: number[], rotation?: number[] }[]} chain the bones from the root down to the body
 * @property {any} torso the body's torso cube
 * @property {any} head the head's cube
 * @property {number[][]} legs the legs' pivots
 * @property {number} width @property {number} height the rig's texture size
 */
/** @type {Map<string, Rig | null>} */
const rigs = new Map();
/** A people's rig by geometry identifier, or null when it is no woman's body. */
function rigOf(/** @type {string} */ id) {
  if (rigs.has(id)) return /** @type {Rig | null} */ (rigs.get(id));
  /** @type {Rig | null} */
  let rig = null;
  const key = id.replace(/^geometry\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  if (VANILLA[id]) {
    const [shape, width, height] = VANILLA[id];
    rig = { key, chain: [{ name: 'body', pivot: shape.body }], torso: shape.torso, head: shape.head, legs: shape.legs, width, height };
  } else if (geometries.has(id) && !SKIPPED_RIGS.has(id)) {
    const g = geometries.get(id);
    const find = (/** @type {RegExp} */ re) => g.bones.find((/** @type {any} */ b) => re.test(b.name));
    const body = find(/^body$/i);
    const head = find(/^head$/i);
    const legs = g.bones.filter((/** @type {any} */ b) => /^(left|right)_?leg$|^leg_?(left|right|l|r)$/i.test(b.name));
    // the torso is the body's biggest cube
    const torso = [...(body?.cubes ?? [])].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    if (body && head?.cubes?.length && legs.length === 2 && torso) {
      const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
      /** @type {Rig['chain']} */
      const chain = [];
      for (let bone = body; bone; bone = bone.parent ? byName.get(bone.parent) : undefined) {
        chain.unshift({ name: bone.name, ...(bone.parent ? { parent: bone.parent } : {}), pivot: [...bone.pivot], ...(bone.rotation ? { rotation: [...bone.rotation] } : {}) });
      }
      rig = { key, chain, torso, head: head.cubes[0], legs: legs.map((/** @type {any} */ l) => l.pivot), width: g.description.texture_width, height: g.description.texture_height };
    }
  }
  rigs.set(id, rig);
  return rig;
}

/** The torso cube's front face in texture pixels (box UV or per-face UV). */
function frontOf(/** @type {any} */ cube) {
  if (Array.isArray(cube.uv)) {
    const [w, h, d] = cube.size.map((/** @type {number} */ s) => Math.max(1, Math.floor(s)));
    return { u: cube.uv[0] + d, v: cube.uv[1] + d, w, h };
  }
  const north = cube.uv?.north;
  return north ? { u: north.uv[0], v: north.uv[1], w: north.uv_size[0], h: north.uv_size[1] } : { u: 0, v: 0, w: 1, h: 1 };
}

/** Her chest: a bust over the top of her torso's front, cut from her shirt there. */
function chestGeometry(/** @type {Rig} */ rig) {
  const body = rig.chain[rig.chain.length - 1];
  const [x, y, z] = rig.torso.origin;
  const [w, h] = rig.torso.size;
  const k = w / 8;
  const face = frontOf(rig.torso);
  const fu = face.w / w, fv = face.h / h;
  // the top fifth of her torso is her collar; the bust sits below it, a third of her torso tall
  const top = y + h * 0.82, tall = h * 0.34, deep = 3 * k;
  const region = (/** @type {number} */ from, /** @type {number} */ rows) => ({ uv: [round(face.u + 0.5 * fu), round(face.v + from * fv)], uv_size: [round((w - 1) * fu), round(rows * fv)] });
  const front = region(h * 0.2, tall);
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: `geometry.${MOD}.worldbox_${rig.key}_chest`, texture_width: rig.width, texture_height: rig.height, visible_bounds_width: 2, visible_bounds_height: 3, visible_bounds_offset: [0, 1.5, 0] },
      bones: [
        ...rig.chain,
        {
          name: 'mp_chest', parent: body.name, pivot: [0, round(top), round(z)], rotation: [-8, 0, 0],
          cubes: [{
            origin: [round(x + 0.5), round(top - tall), round(z - deep)], size: [round(w - 1), round(tall), round(deep)],
            uv: { north: front, south: front, east: region(h * 0.2, tall), west: region(h * 0.2, tall), up: region(h * 0.15, 1), down: region(h * 0.2 + tall - 1, 1) },
          }],
        },
      ],
    }],
  };
}

const sources = PHASES.map((p) => read(join(RP, 'models/entity', MOD, `player_body_predefined_p${p}.geo.json`)));
/** Her bellies of every size: the player's, fitted to her waist (as big as her torso is wide). */
function bellyGeometries(/** @type {Rig} */ rig) {
  const body = rig.chain[rig.chain.length - 1];
  const legTop = Math.max(...rig.legs.map((l) => l[1]));
  const measured = measureBody({
    bones: [
      ...rig.chain,
      { name: 'hip', parent: body.name, pivot: [0, legTop + 1, body.pivot[2]] },
      { name: 'torso', parent: body.name, pivot: [...body.pivot], cubes: [rig.torso] },
      { name: 'legL', pivot: rig.legs[1] }, { name: 'legR', pivot: rig.legs[0] },
    ],
  });
  if (!measured) return undefined;
  // a big people's torso (a colossus) gets as much bigger a belly, from the same waist bottom
  const grow = Math.max(1, Math.min(8, rig.torso.size[0] / 8));
  const [[x0, x1], [y0, y1], [z0, z1]] = measured.box;
  const fitted = { ...measured, box: [[x0 * grow, x1 * grow], [y0, y0 + (y1 - y0) * grow], [z0, z0 + (z1 - z0) * grow]] };
  // her people are drawn in big boxes, so is her belly (tools/lib/belly-fit.mjs chestStyle 'cube')
  return PHASES.map((p) => roundBelly(fitBelly(sources[p], `geometry.${MOD}.worldbox_${rig.key}_belly_p${p}`, fitted), CUBE_BELLY));
}

// ---- the people -------------------------------------------------------------------------------------
/** @type {Map<string, { chest: string, bellies: any[] }>} the overlays written, by rig */
const written = new Map();
/** @type {Map<string, any[] | undefined>} the bellies fitted, by the shape of the rig's waist */
const bellyShapes = new Map();
/** @type {Map<string, string>} belly textures by skin tone */
const bellySkins = new Map();
/** @type {Record<string, unknown>} */
const renderControllers = {
  [RC_BELLY]: {
    arrays: { geometries: { 'Array.mp_bellies': PHASES.map((p) => `Geometry.mp_belly_p${p}`) } },
    geometry: 'Array.mp_bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: ['Texture.mp_belly'],
  },
};
/** The add-on's render controllers, for the textures her chest takes from her unit's. */
const theirControllers = Object.assign({}, ...walk(join(RP, 'render_controllers', PORT)).filter((f) => f.endsWith('.json')).map((f) => read(f).render_controllers ?? {}));
let women = 0;
for (const file of walk(join(RP, 'entity', PORT)).filter((f) => f.endsWith('.json'))) {
  const doc = read(file);
  const d = doc['minecraft:client_entity']?.description;
  if (!d?.geometry || d.geometry.mp_chest) continue;
  const [geoKey, geoId] = Object.entries(d.geometry)[0];
  const rig = rigOf(/** @type {string} */ (geoId));
  const bpFile = join(BP, 'entities', PORT, file.slice(file.lastIndexOf('/') + 1).replace(/\.entity\.json$/, '.json'));
  if (!rig || !existsSync(bpFile)) continue;
  const firstRc = [d.render_controllers ?? []].flat()[0];
  const rcName = String(typeof firstRc === 'string' ? firstRc : Object.keys(firstRc ?? {})[0]);
  // the game's own render controllers (the vanilla mobs it borrows) draw their default texture
  const theirs = theirControllers[rcName] ?? (d.textures?.default ? { geometry: `Geometry.${geoKey}`, textures: ['Texture.default'] } : undefined);
  if (!theirs || (Object.keys(d.geometry).length > 1 && theirs.geometry !== `Geometry.${geoKey}`)) continue;

  // her overlays (one set per rig)
  if (!written.has(rig.key)) {
    // rigs with the same bones down to the body and the same torso share their bellies
    const shape = JSON.stringify([rig.chain, rig.torso.origin, rig.torso.size, rig.legs]);
    if (!bellyShapes.has(shape)) {
      const fitted = bellyGeometries(rig);
      fitted?.forEach((b, p) => writeJson(join(RP, 'models', PORT, MOD, `${rig.key}_belly_p${p}.geo.json`), b));
      bellyShapes.set(shape, fitted);
    }
    const bellies = bellyShapes.get(shape);
    if (!bellies) {
      rigs.set(/** @type {string} */ (geoId), null);
      continue;
    }
    writeJson(join(RP, 'models', PORT, MOD, `${rig.key}_chest.geo.json`), chestGeometry(rig));
    written.set(rig.key, { chest: `geometry.${MOD}.worldbox_${rig.key}_chest`, bellies });
  }
  const overlay = /** @type {{ chest: string, bellies: any[] }} */ (written.get(rig.key));

  // her belly's skin: the tone of her unit's face
  const texturePath = /** @type {string | undefined} */ (Object.values(d.textures ?? {})[0]);
  const png = texturePath && existsSync(join(RP, `${texturePath}.png`)) ? decodePng(new Uint8Array(readFileSync(join(RP, `${texturePath}.png`)))) : undefined;
  const tone = png ? skinTone(png, { description: { texture_width: rig.width, texture_height: rig.height }, bones: [{ name: 'head', cubes: [rig.head] }, { name: 'torso', cubes: [rig.torso] }] }) : [224, 188, 160];
  const toneKey = tone.map((c) => c.toString(16).padStart(2, '0')).join('');
  if (!bellySkins.has(toneKey)) {
    const path = `textures/${PORT}/${MOD}/belly_${toneKey}`;
    mkdirSync(dirname(join(RP, path)), { recursive: true });
    writeFileSync(join(RP, `${path}.png`), encodePng(bellyTexture(tone)));
    bellySkins.set(toneKey, path);
  }

  // her chest takes her unit's textures, as its own render controller draws them
  const rcChest = `controller.render.${MOD}.worldbox_woman.chest_${rcName.replace(/^controller\.render\./, '').replace(/[^a-z0-9]+/gi, '_')}`;
  renderControllers[rcChest] ??= {
    ...(theirs.arrays?.textures ? { arrays: { textures: theirs.arrays.textures } } : {}),
    geometry: 'Geometry.mp_chest', materials: [{ '*': 'Material.default' }], textures: theirs.textures,
  };

  // the client entity: her overlays, the belly animations, her pregnancy's state
  const pre = [`v.mp_female = q.property('${FEMALE}') == 2;`, ...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => overlay.bellies[p]['minecraft:geometry'][0]), 'v.kick_grow = 0.35;'];
  d.materials = { default: 'entity_alphatest', ...(d.materials ?? {}) };
  d.textures = { ...d.textures, mp_belly: /** @type {string} */ (bellySkins.get(toneKey)) };
  d.geometry = { ...d.geometry, mp_chest: overlay.chest, ...Object.fromEntries(PHASES.map((p) => [`mp_belly_p${p}`, overlay.bellies[p]['minecraft:geometry'][0].description.identifier])) };
  d.animations = { ...d.animations, ...BELLY_ANIMATIONS, belly_controller: `controller.animation.${MOD}.belly`, mp_walk_jiggle: JIGGLE };
  d.scripts = {
    ...(d.scripts ?? {}),
    initialize: initializers(pre, d.scripts?.initialize ?? []),
    pre_animation: [...(d.scripts?.pre_animation ?? []), ...pre],
    animate: [...(d.scripts?.animate ?? []), { mp_walk_jiggle: 'v.mp_female' }, { belly_controller: 'v.mp_female' }],
  };
  d.render_controllers = [...[d.render_controllers ?? []].flat(), { [rcChest]: 'v.mp_female' }, { [RC_BELLY]: 'v.mp_female && v.bp >= 0' }];
  writeJson(file, doc);

  // the behaviour: the pregnancy's properties and events, and the family our mob system looks for
  const bp = read(bpFile);
  const e = bp['minecraft:entity'];
  e.description.properties = { ...(e.description.properties ?? {}), ...MINEPREGGO_PROPERTIES, [FEMALE]: { type: 'int', range: [0, 2], default: 0, client_sync: true } };
  for (const group of [e.components, ...Object.values(e.component_groups ?? {})]) {
    const family = group?.['minecraft:type_family'];
    if (family && !family.family.includes(FAMILY_TAG)) family.family.push(FAMILY_TAG);
  }
  if (!e.components['minecraft:type_family']) e.components['minecraft:type_family'] = { family: ['mob', FAMILY_TAG] };
  e.events = { ...(e.events ?? {}), ...phaseEvents() };
  writeJson(bpFile, bp);
  women++;
}
writeJson(join(RP, 'render_controllers', PORT, `${MOD}_women.render_controllers.json`), { format_version: '1.8.0', render_controllers: renderControllers });
writeJson(join(RP, 'animations', PORT, `${MOD}_women.animation.json`), { format_version: '1.8.0', animations: { [JIGGLE]: walkJiggleAnimation({ chest: ['mp_chest'], belly: ['belly'] }) } });
console.log(`World Alliance women: ${women} peoples, on ${written.size} rigs sharing ${[...bellyShapes.values()].filter(Boolean).length} belly sets (${[...rigs].filter(([, r]) => r === null).length} rigs left as they are), ${bellySkins.size} belly skin tones`);
