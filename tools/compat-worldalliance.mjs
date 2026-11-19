// Builds the Minepreggo x World Alliance compatibility add-on (compat/worldalliance/: a behavior and a
// resource pack of their own, packaged by tools/build.mjs as dist/minepreggo-worldalliance-<version>
// .mcaddon) from the World Alliance add-on in vendor/worldalliance/ at import time; nothing of it is
// committed. Players install it with both add-ons, above World Alliance: it replaces the add-on's
// humanoid peoples' definitions with copies that have women, and needs nothing else of ours than the
// Minepreggo packs (their pregnancy system, scripts/mobs/worldbox_women.js and the belly animations).
//
// A people keeps its mob type (its kingdoms, armies and scripts know their units by type): a unit is a
// woman when its minepreggo:female property is 2 (the script rolls half of them). A woman is drawn on
// her own female model, a copy of her people's rig (the add-on's, or the vanilla one it borrows, from
// vendor/vanilla-models/: Mojang's bedrock-samples) with a woman's build: slimmer arms, a bust and wider
// hips, cut from her unit's own texture so they wear her outfit; a man keeps the rig as it is. Over
// her goes a blocky belly (like her people's boxes) for every size in her skin tone, and on her the
// Jenny-style pregnancy and scene poses and a birth, solved onto her rig (tools/lib/scene-poses.mjs),
// with her baby crowning, kicks and a walk jiggle. Animals, vehicles, blobs, golems, dragons and tiny
// folk (pixies) are left out.
//
// Run: node tools/compat-worldalliance.mjs (part of npm run import; after tools/import-jar.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { CUBE_BELLY, addNewborn, babyScale, fitBelly, measureBody, roundBelly } from './lib/belly-fit.mjs';
import { bellyTexture, skinTone } from './lib/belly-skin.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
import { FETUS_SCALE, crowningLines } from './lib/crowning.mjs';
import { GIRL_BIRTHS, girlBirthExit, girlEffects } from './lib/girl-births.mjs';
import { girlSources, poseController } from './lib/girl-port.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { girlPoseAnimations } from './lib/scene-poses.mjs';
import { walkJiggleAnimation } from './lib/walk-jiggle.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const OUT = join(ROOT, 'compat/worldalliance');
const OBP = join(OUT, 'behavior');
const ORP = join(OUT, 'resource');
const VENDOR = join(ROOT, 'vendor/worldalliance');
const VANILLA = join(ROOT, 'vendor/vanilla-models');
const DIR = 'minepreggo_worldalliance';
/** This compatibility add-on's own pack and module ids. */
const IDS = { bp: '21ba7e65-b20f-4f1a-8605-f36f2484257d', bpData: '8a81c26f-a413-4d09-9af3-b8c0a19d20b7', rp: 'bdfcf66a-f890-4f6f-90cf-bac9423efa98', rpResources: 'b58afbd6-d8c1-48f6-9b97-d742f661bbe6' };
const FEMALE = `q.property('${MOD}:female') == 2`;
const MALE = `q.property('${MOD}:female') != 2`;
const JIGGLE = `animation.${MOD}.worldbox_woman.walk_jiggle`;
const RC_BELLY = `controller.render.${MOD}.worldbox_woman.belly`;
/** Rigs of the add-on's own that are not women's bodies (a fairy no taller than a sapling). */
const SKIPPED_RIGS = new Set(['geometry.pixie']);
/** Whose birth each people's women give birth like (tools/lib/girl-births.mjs), by rig. */
const BIRTHS = /** @type {[RegExp, string][]} */ ([[/elf/, 'kum:luna'], [/dwarf/, 'jhelliedev:ellie'], [/orc|piglin|troll/, 'kum:galath'], [/mushroom|spore/, 'jhallie4:allie'], [/enderman|skeleton|dread|colossus/, 'fapcraft:jenny'], [/./, 'kum:bia']]);

const writeJson = (/** @type {string} */ file, /** @type {unknown} */ doc) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
};
const writeBytes = (/** @type {string} */ file, /** @type {Uint8Array} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
/** JSON that may carry a byte-order mark or line comments (Mojang's samples do). */
function parse(/** @type {string} */ text) {
  const clean = text.replace(/^﻿/, '');
  try {
    return JSON.parse(clean);
  } catch {
    return JSON.parse(clean.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'));
  }
}
const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
function walk(/** @type {string} */ dir, prefix = '') {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

// ---- clean: the last build, and what earlier versions merged of World Alliance into our packs -----
rmSync(OUT, { recursive: true, force: true });
{
  const PORT = 'worldalliance_port';
  const listFile = join(BP, PORT, 'files.json');
  if (existsSync(listFile)) for (const path of JSON.parse(readFileSync(listFile, 'utf8'))) rmSync(join(ROOT, path), { force: true });
  for (const top of ['entities', 'items', 'blocks', 'recipes', 'scripts', PORT]) rmSync(join(BP, top === PORT ? PORT : `${top}/${PORT}`), { recursive: true, force: true });
  for (const top of ['entity', 'models', 'animations', 'animation_controllers', 'render_controllers', 'attachables', 'particles', 'textures', PORT]) rmSync(join(RP, top === PORT ? PORT : `${top}/${PORT}`), { recursive: true, force: true });
  for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
    const path = join(RP, 'texts', file);
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf('## World Alliance (vendor/worldalliance');
    if (at < 0) continue;
    // its block runs to the next import's header (its own lines have "## " comments of their own)
    const next = text.slice(at + 1).search(/^## [^\n]*\(vendor\//m);
    writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n') + (next >= 0 ? text.slice(at + 1 + next) : ''));
  }
}

const archive = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => f.endsWith('.mcaddon')) : undefined;
if (!archive) {
  console.warn('warning: no World Alliance .mcaddon in vendor/worldalliance/; no compatibility add-on for it');
  process.exit(0);
}

/**
 * The two packs of the add-on (an .mcaddon of folders, or of .mcpack archives), each as its own
 * relative paths to bytes, with its manifest.
 * @param {Record<string, Uint8Array>} zip
 */
function packsOf(zip) {
  /** @type {Record<string, { files: Record<string, Uint8Array>, manifest: any }>} */
  const packs = {};
  const nested = Object.entries(zip).filter(([name]) => name.endsWith('.mcpack'));
  for (const files of nested.length ? nested.map(([, data]) => unzipSync(data)) : [zip]) {
    for (const [name, data] of Object.entries(files)) {
      if (!name.endsWith('manifest.json')) continue;
      const root = name.slice(0, -'manifest.json'.length);
      const manifest = parse(strFromU8(data));
      const kind = manifest.modules?.some((/** @type {any} */ m) => m.type === 'resources') ? 'resource' : manifest.modules?.some((/** @type {any} */ m) => m.type === 'data' || m.type === 'script') ? 'behavior' : undefined;
      if (kind) packs[kind] = { manifest, files: Object.fromEntries(Object.entries(files).filter(([n]) => n.startsWith(root) && !n.endsWith('/')).map(([n, d]) => [n.slice(root.length), d])) };
    }
  }
  return packs;
}
const packs = packsOf(unzipSync(new Uint8Array(readFileSync(join(VENDOR, archive)))));
if (!packs.behavior || !packs.resource) throw new Error(`${archive}: expected a behavior and a resource pack`);
const theirs = (/** @type {'behavior' | 'resource'} */ kind, /** @type {string} */ top) => Object.entries(packs[kind].files).filter(([path]) => path.startsWith(`${top}/`) && path.endsWith('.json')).map(([path, data]) => ({ path, doc: parse(strFromU8(data)) }));

// ---- the geometries: the add-on's own and the vanilla ones it borrows ------------------------------
/** @type {Map<string, { raw: any, parent?: string }>} legacy-format geometries (format 1.8), unresolved */
const legacy = new Map();
/** @type {Map<string, any>} geometries in the current format, by identifier */
const geometries = new Map();
function addGeometries(/** @type {any} */ doc) {
  for (const g of doc['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, g);
  for (const [key, raw] of Object.entries(doc)) {
    if (!key.startsWith('geometry.')) continue;
    const [id, parent] = key.split(':');
    legacy.set(id, { raw, parent });
  }
}
for (const file of walk(VANILLA).filter((f) => f.endsWith('.json') && !f.startsWith('render_controllers/'))) addGeometries(parse(readFileSync(join(VANILLA, file), 'utf8')));
for (const { doc } of theirs('resource', 'models')) addGeometries(doc);
/** A geometry by identifier, a legacy one resolved through what it inherits (bones of the same name replaced). */
function geometryOf(/** @type {string} */ id) {
  if (geometries.has(id)) return geometries.get(id);
  const entry = legacy.get(id);
  if (!entry) return undefined;
  const base = entry.parent ? geometryOf(entry.parent) : undefined;
  const own = (entry.raw.bones ?? []).map((/** @type {any} */ b) => ({
    name: b.name,
    ...(b.parent ? { parent: b.parent } : {}),
    pivot: b.pivot ?? [0, 0, 0],
    ...(b.rotation ? { rotation: b.rotation } : {}),
    ...(b.mirror ? { mirror: true } : {}),
    ...(b.cubes?.length && !b.neverRender ? { cubes: b.cubes } : {}),
  }));
  const bones = [...(base?.bones ?? []).map((/** @type {any} */ b) => own.find((/** @type {any} */ o) => o.name === b.name) ?? b), ...own.filter((/** @type {any} */ o) => !base?.bones.some((/** @type {any} */ b) => b.name === o.name))];
  const g = {
    description: { identifier: id, texture_width: entry.raw.texturewidth ?? base?.description.texture_width ?? 64, texture_height: entry.raw.textureheight ?? base?.description.texture_height ?? 64, visible_bounds_width: 2, visible_bounds_height: 3, visible_bounds_offset: [0, 1.5, 0] },
    bones,
  };
  geometries.set(id, g);
  return g;
}
/** @type {Record<string, any>} render controllers by id: the add-on's and the vanilla ones it uses */
const controllers = {};
for (const file of walk(join(VANILLA, 'render_controllers')).filter((f) => f.endsWith('.json'))) Object.assign(controllers, parse(readFileSync(join(VANILLA, 'render_controllers', file), 'utf8')).render_controllers ?? {});
for (const { doc } of theirs('resource', 'render_controllers')) Object.assign(controllers, doc.render_controllers ?? {});

// ---- a woman's build ----------------------------------------------------------------------------------
/** Box UV as per-face UVs (Blockbench's Bedrock layout), mirrored when the cube or its bone is. */
function facesOf(/** @type {any} */ cube, /** @type {boolean} */ boneMirror = false) {
  if (!Array.isArray(cube.uv)) return cube.uv ?? {};
  const [u, v] = cube.uv;
  const [w, h, d] = cube.size;
  const face = (/** @type {number} */ fu, /** @type {number} */ fv, /** @type {number} */ su, /** @type {number} */ sv) => ({ uv: [round(fu), round(fv)], uv_size: [round(su), round(sv)] });
  if (cube.mirror ?? boneMirror) {
    return {
      north: face(u + d + w, v + d, -w, h), south: face(u + 2 * d + 2 * w, v + d, -w, h),
      east: face(u + 2 * d + w, v + d, -d, h), west: face(u + d, v + d, -d, h),
      up: face(u + d + w, v, -w, d), down: face(u + d + 2 * w, v + d, -w, -d),
    };
  }
  return {
    north: face(u + d, v + d, w, h), south: face(u + 2 * d + w, v + d, w, h),
    east: face(u, v + d, d, h), west: face(u + d + w, v + d, d, h),
    up: face(u + d, v, w, d), down: face(u + d + w, v + d, w, -d),
  };
}
/** Part of a face (fractions across and down it). */
const part = (/** @type {any} */ face, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y0, /** @type {number} */ y1) => ({
  uv: [round(face.uv[0] + face.uv_size[0] * x0), round(face.uv[1] + face.uv_size[1] * y0)],
  uv_size: [round(face.uv_size[0] * (x1 - x0)), round(face.uv_size[1] * (y1 - y0))],
});

/**
 * @typedef {object} Rig a people's body
 * @property {string} key short name for files and ids
 * @property {any} geometry the rig
 * @property {string} body @property {string} head @property {string} armR @property {string} armL @property {string} legR @property {string} legL its bones
 * @property {any} torso the body's torso cube (its biggest)
 */
/** @type {Map<string, Rig | null>} */
const rigs = new Map();
function rigOf(/** @type {string} */ id) {
  if (rigs.has(id)) return /** @type {Rig | null} */ (rigs.get(id));
  const g = SKIPPED_RIGS.has(id) ? undefined : geometryOf(id);
  /** @type {Rig | null} */
  let rig = null;
  if (g) {
    const find = (/** @type {RegExp} */ re) => g.bones.filter((/** @type {any} */ b) => re.test(b.name));
    const body = find(/^body$/i)[0];
    const head = find(/^head$/i)[0];
    // sides by where they hang (right is -x), whatever the rig calls them
    const sides = (/** @type {any[]} */ pair) => (pair.length === 2 ? [...pair].sort((a, b) => a.pivot[0] - b.pivot[0]) : []);
    const arms = sides(find(/^(right|left)_?arm$|^arm_?(right|left|r|l)$/i));
    const legs = sides(find(/^(right|left)_?leg$|^leg_?(right|left|r|l)$/i));
    const torso = [...(body?.cubes ?? [])].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    if (body && head && arms.length && legs.length && torso && !g.bones.some((/** @type {any} */ b) => ['mp_root', 'mp_waist', 'mp_bust', 'mp_hips', 'hip', 'torso', 'trunk', 'upperBody'].includes(b.name))) {
      rig = { key: id.replace(/^geometry\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase(), geometry: g, body: body.name, head: head.name, armR: arms[0].name, armL: arms[1].name, legR: legs[0].name, legL: legs[1].name, torso };
    }
  }
  rigs.set(id, rig);
  return rig;
}

/**
 * Her model: the rig under a root of its own (her poses move her whole) and a waist (her poses bend
 * her there), head and arms hung from her body where the rig leaves them loose (so they go along), slimmer arms (three
 * quarters as wide, toward her shoulders, their texture squeezed to fit), a bust and wider hips cut
 * from her torso's texture.
 */
function femaleGeometry(/** @type {Rig} */ rig) {
  const g = structuredClone(rig.geometry);
  g.description = { ...g.description, identifier: `geometry.${MOD}.worldbox_${rig.key}_female` };
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  for (const bone of g.bones) {
    if (bone.parent) continue;
    bone.parent = [rig.head, rig.armR, rig.armL].includes(bone.name) ? rig.body : /^(hat|helmet|nose)$/i.test(bone.name) && byName.has(rig.head) ? rig.head : 'mp_root';
  }
  g.bones.unshift({ name: 'mp_root', pivot: [0, 0, 0] });
  // a waist her poses bend her at (her people's body turns at the neck; a Jenny girl's at the waist)
  const trunk = byName.get(rig.body);
  g.bones.splice(1, 0, { name: 'mp_waist', parent: trunk.parent, pivot: [0, rig.torso.origin[1], trunk.pivot[2]] });
  trunk.parent = 'mp_waist';
  // slimmer arms
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  for (const [arm, side] of [[rig.armR, -1], [rig.armL, 1]]) {
    for (const name of under(/** @type {string} */ (arm))) {
      const bone = byName.get(name);
      for (const cube of bone?.cubes ?? []) {
        const w = cube.size[0];
        if (w < 3.5) continue;
        cube.uv = facesOf(cube, bone.mirror);
        const slim = round(w * 0.75);
        if (side < 0) cube.origin = [round(cube.origin[0] + w - slim), cube.origin[1], cube.origin[2]];
        cube.size = [slim, cube.size[1], cube.size[2]];
      }
    }
  }
  // her bust and hips, in her torso's texture
  const faces = facesOf(rig.torso, trunk.mirror);
  const front = faces.north ?? Object.values(faces)[0];
  if (!front) return undefined;
  const [x0, y0, z0] = rig.torso.origin;
  const [w, h, d] = rig.torso.size;
  // (an inflated torso, armour drawn over it, stands out as much further)
  const k = w / 8, top = y0 + h, out = rig.torso.inflate ?? 0;
  const patch = (/** @type {number} */ xa, /** @type {number} */ xb, /** @type {number} */ ya, /** @type {number} */ yb) => {
    const p = part(front, (xa - x0) / w, (xb - x0) / w, (top - yb) / h, (top - ya) / h);
    return { north: p, south: p, east: p, west: p, up: p, down: p };
  };
  // two breasts, like the mod's girls' (each 3 across, turned down and out), as big as her torso is wide
  const breast = (/** @type {number} */ s) => {
    const b = 3.4 * k, xa = s < 0 ? -b - 0.05 * k : 0.05 * k, xb = xa + b, ya = top - 1.4 * k - b, yb = ya + b;
    return {
      name: `mp_bust_${s < 0 ? 'r' : 'l'}`, parent: 'mp_bust', pivot: [round(s * k), round(top - 1.7 * k), round(z0 - out + 0.1 * k)], rotation: [20, s * -7.5, s * -2.5],
      cubes: [{ origin: [round(xa), round(ya), round(z0 - out - b + 0.2 * k)], size: [round(b), round(b), round(b)], uv: patch(Math.max(x0, xa), Math.min(x0 + w, xb), ya, yb) }],
    };
  };
  const low = (/** @type {any} */ face) => (face ? part(face, 0, 1, 0.72, 1) : part(front, 0, 1, 0.72, 1));
  g.bones.push(
    { name: 'mp_bust', parent: rig.body, pivot: [0, round(top - 1.5 * k), round(z0 - out)] },
    breast(-1), breast(1),
    {
      name: 'mp_hips', parent: rig.body, pivot: [0, round(y0), round(z0 + d / 2)],
      cubes: [{
        origin: [round(x0 - out - 0.9 * k), round(y0 - out), round(z0 - out - 0.4 * k)], size: [round(w + 2 * out + 1.8 * k), round(3.6 * k), round(d + 2 * out + 1.6 * k)],
        uv: { north: low(front), south: low(faces.south), east: low(faces.east), west: low(faces.west), up: part(front, 0, 1, 0.72, 0.8), down: part(front, 0, 1, 0.92, 1) },
      }],
    },
  );
  return g;
}

/** Her model on the Jenny rig's names (what the pose solver and belly fitter know), and the way back. */
function onJennyNames(/** @type {Rig} */ rig, /** @type {any} */ female) {
  const to = /** @type {Record<string, string>} */ ({ mp_root: 'body', mp_waist: 'upperBody', [rig.body]: 'trunk', [rig.head]: 'head', [rig.armR]: 'armR', [rig.armL]: 'armL', [rig.legR]: 'legR', [rig.legL]: 'legL', mp_bust: 'boobs' });
  const back = Object.fromEntries(Object.entries(to).map(([k, v]) => [v, k]));
  const g = structuredClone(female);
  for (const bone of g.bones) {
    bone.name = to[bone.name] ?? bone.name;
    if (bone.parent) bone.parent = to[bone.parent] ?? bone.parent;
  }
  if (new Set(g.bones.map((/** @type {any} */ b) => b.name)).size !== g.bones.length) return undefined;
  // (her torso and hip hang from her body, under the waist her poses bend)
  const trunk = g.bones.find((/** @type {any} */ b) => b.name === 'trunk');
  const legTop = Math.max(...g.bones.filter((/** @type {any} */ b) => b.name === 'legL' || b.name === 'legR').map((/** @type {any} */ b) => b.pivot[1]));
  g.bones.push({ name: 'torso', parent: 'trunk', pivot: [...trunk.pivot], cubes: [rig.torso] }, { name: 'hip', parent: 'trunk', pivot: [0, legTop + 1, trunk.pivot[2]] });
  return { geometry: g, back };
}
const renameBones = (/** @type {any} */ doc, /** @type {Record<string, string>} */ back) => {
  for (const bone of doc['minecraft:geometry'][0].bones) {
    bone.name = back[bone.name] ?? bone.name;
    if (bone.parent) bone.parent = back[bone.parent] ?? bone.parent;
  }
  return doc;
};

// ---- each rig's women: model, bellies, poses ---------------------------------------------------------
const sources = girlSources(RP);
/** @type {Record<string, unknown>} */
const animationControllers = {};
/**
 * @typedef {object} Women what a rig's women have
 * @property {string} female her model's identifier
 * @property {any[]} bellies her bellies (her rig's names)
 * @property {{ pose: string, id: string }[]} poses @property {{ flair: string, crowning: string } | undefined} extras
 * @property {string | undefined} controller her pose controller @property {any} spec her birth
 * @property {number} crownScale @property {any} exit
 */
/** @type {Map<string, Women | null>} */
const made = new Map();
let poseCount = 0;
function womenOf(/** @type {Rig} */ rig) {
  if (made.has(rig.key)) return /** @type {Women | null} */ (made.get(rig.key));
  const female = femaleGeometry(rig);
  const jenny = female && onJennyNames(rig, female);
  const measured = jenny && measureBody(jenny.geometry);
  if (!female || !jenny || !measured) {
    made.set(rig.key, null);
    return null;
  }
  // a big people's torso (a colossus) gets as much bigger a belly, from the same waist bottom
  const grow = Math.max(1, Math.min(8, rig.torso.size[0] / 8));
  const [[x0, x1], [y0, y1], [z0, z1]] = measured.box;
  const body = { ...measured, box: [[x0 * grow, x1 * grow], [y0, y0 + (y1 - y0) * grow], [z0, z0 + (z1 - z0) * grow]] };
  // her people are drawn in boxes, so is her belly (tools/lib/belly-fit.mjs chestStyle 'cube')
  const onJenny = PHASES.map((p) => addNewborn(roundBelly(fitBelly(sources.playerBodies[p], `geometry.${MOD}.worldbox_${rig.key}_belly_p${p}`, body), CUBE_BELLY), body, {}));
  const id = `${MOD}:worldbox_${rig.key}`;
  const prefix = `animation.${MOD}.worldbox_${rig.key}`;
  const birth = /** @type {string} */ (BIRTHS.find(([re]) => re.test(rig.key))?.[1]);
  GIRL_BIRTHS[id] = { ...GIRL_BIRTHS[birth], name: rig.key };
  const solved = girlPoseAnimations({ id, geometry: jenny.geometry, sourceGeometry: sources.creeper.geometry, sourceAnimations: sources.creeper.animations, prefix, bellies: Object.fromEntries(PHASES.map((p) => [p, onJenny[p]['minecraft:geometry'][0]])), swells: sources.swells });
  const crownScale = FETUS_SCALE * babyScale(body);
  const spec = GIRL_BIRTHS[id];
  const exit = solved?.birth ? girlBirthExit({ spec, geometry: jenny.geometry, animation: solved.birth.animation, body, scale: crownScale }) : undefined;
  if (exit && solved?.birth) solved.birth.animation.bones.crowning = { rotation: exit.rotation };
  /** @type {Record<string, any>} */
  const animations = {};
  const back = (/** @type {any} */ animation) => ({ ...animation, bones: Object.fromEntries(Object.entries(animation.bones ?? {}).filter(([bone]) => bone !== 'torso').map(([bone, ch]) => [jenny.back[bone] ?? bone, ch])) });
  const poses = solved ? Object.entries(solved).filter(([k]) => k !== 'birthExtras').map(([pose, { id: poseId, animation }]) => {
    animations[poseId] = back(animation);
    return { pose, id: poseId };
  }) : [];
  const extras = solved?.birthExtras;
  if (extras) for (const { id: extraId, animation } of [extras.flair, extras.crowning]) animations[extraId] = back(animation);
  poseCount += poses.length;
  const controller = poses.length ? `controller.animation.${MOD}.worldbox_${rig.key}.pose` : undefined;
  if (controller) animationControllers[controller] = poseController(poses.map((p) => p.pose), extras ? { birth: ['mp_birth_flair', 'mp_birth_crowning'] } : {});

  writeJson(join(ORP, 'models/entity', DIR, `${rig.key}_female.geo.json`), { format_version: '1.12.0', 'minecraft:geometry': [female] });
  const bellies = onJenny.map((doc, p) => {
    const mine = renameBones(doc, jenny.back);
    writeJson(join(ORP, 'models/entity', DIR, `${rig.key}_belly_p${p}.geo.json`), mine);
    return mine;
  });
  if (Object.keys(animations).length) writeJson(join(ORP, 'animations', DIR, `${rig.key}.animation.json`), { format_version: '1.8.0', animations });
  /** @type {Women} */
  const women = { female: female.description.identifier, bellies, poses, extras: extras ? { flair: extras.flair.id, crowning: extras.crowning.id } : undefined, controller, spec, crownScale, exit };
  made.set(rig.key, women);
  return women;
}

// ---- the peoples ---------------------------------------------------------------------------------------
/** @type {Map<string, { path: string, doc: any }>} the add-on's behavior entities by identifier */
const behaviors = new Map(theirs('behavior', 'entities').map((e) => [e.doc['minecraft:entity']?.description?.identifier, e]));
/** @type {Record<string, unknown>} */
const renderControllers = {
  [RC_BELLY]: {
    arrays: { geometries: { 'Array.mp_bellies': PHASES.map((p) => `Geometry.mp_belly_p${p}`) } },
    geometry: 'Array.mp_bellies[math.clamp(v.bp, 0, 9)]', materials: [{ '*': 'Material.default' }], textures: ['Texture.mp_belly'],
  },
};
/** @type {Map<string, string>} belly textures by skin tone */
const bellySkins = new Map();
const both = (/** @type {string | undefined} */ a, /** @type {string} */ b) => (a ? `(${a}) && ${b}` : b);
let peoples = 0;
for (const { path, doc } of theirs('resource', 'entity')) {
  const d = doc['minecraft:client_entity']?.description;
  const behavior = d && behaviors.get(d.identifier);
  if (!d?.geometry || !behavior) continue;
  const [geoKey, geoId] = Object.entries(d.geometry)[0];
  const rig = rigOf(/** @type {string} */ (geoId));
  if (!rig) continue;
  // her own render controllers: each of her unit's that draws its body, drawing hers instead
  /** @type {any[]} */
  const list = [];
  let drawn = false;
  for (const entry of [d.render_controllers ?? []].flat()) {
    const [name, condition] = typeof entry === 'string' ? [entry, undefined] : Object.entries(entry)[0];
    const def = controllers[name] ?? (name.startsWith('controller.render.') && d.textures?.default ? { geometry: `Geometry.${geoKey}`, materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] } : undefined);
    if (def?.geometry !== `Geometry.${geoKey}`) {
      list.push(entry);
      continue;
    }
    const hers = `controller.render.${MOD}.worldbox_woman.${name.replace(/^controller\.render\./, '').replace(/[^a-z0-9]+/gi, '_')}`;
    renderControllers[hers] ??= { ...structuredClone(def), geometry: 'Geometry.mp_female' };
    list.push({ [name]: both(/** @type {string | undefined} */ (condition), MALE) }, { [hers]: both(/** @type {string | undefined} */ (condition), FEMALE) });
    drawn = true;
  }
  if (!drawn) continue;
  const women = womenOf(rig);
  if (!women) continue;

  // her belly's skin: the tone of her unit's face (the vanilla textures are the game's: a usual tone)
  const texturePath = /** @type {string | undefined} */ (d.textures?.default ?? Object.values(d.textures ?? {})[0]);
  const png = texturePath && packs.resource.files[`${texturePath}.png`];
  const tone = png ? skinTone(decodePng(png), rig.geometry) : [224, 188, 160];
  const toneKey = tone.map((c) => c.toString(16).padStart(2, '0')).join('');
  if (!bellySkins.has(toneKey)) {
    const skin = `textures/${DIR}/belly_${toneKey}`;
    writeBytes(join(ORP, `${skin}.png`), encodePng(bellyTexture(tone)));
    bellySkins.set(toneKey, skin);
  }

  // the client entity: her model and bellies, the belly animations, her poses
  const pre = [
    `v.mp_female = ${FEMALE};`, ...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => women.bellies[p]['minecraft:geometry'][0]),
    // (her blocky belly kicks with the mod's own cubes)
    'v.kick_grow = 1.0;',
    ...crowningLines({ when: "v.mp_female && v.pose == 'birth'", scale: women.crownScale, ...(women.exit ? { head: women.exit.head, rest: women.exit.rest } : {}) }),
  ];
  d.materials = { default: 'entity_alphatest', ...(d.materials ?? {}) };
  d.textures = { ...d.textures, mp_belly: /** @type {string} */ (bellySkins.get(toneKey)) };
  d.geometry = { ...d.geometry, mp_female: women.female, ...Object.fromEntries(PHASES.map((p) => [`mp_belly_p${p}`, women.bellies[p]['minecraft:geometry'][0].description.identifier])) };
  d.animations = {
    ...Object.fromEntries(Object.entries(BELLY_ANIMATIONS).filter(([k]) => !(k in (d.animations ?? {})))),
    ...d.animations,
    belly_controller: `controller.animation.${MOD}.belly`,
    mp_walk_jiggle: JIGGLE,
    newborn: `animation.${MOD}.crowning_free`,
    ...(women.controller ? { mp_pose_controller: women.controller } : {}),
    ...Object.fromEntries(women.poses.map(({ pose, id }) => [`mp_pose_${pose}`, id])),
    ...(women.extras ? { mp_birth_flair: women.extras.flair, mp_birth_crowning: women.extras.crowning } : {}),
  };
  if (women.poses.length) {
    const effects = girlEffects(women.spec);
    d.sound_effects = { ...(d.sound_effects ?? {}), ...effects.sound_effects };
    d.particle_effects = { ...(d.particle_effects ?? {}), ...effects.particle_effects };
  }
  d.scripts = {
    ...(d.scripts ?? {}),
    initialize: initializers(pre, d.scripts?.initialize ?? []),
    pre_animation: [...(d.scripts?.pre_animation ?? []), ...pre],
    animate: [
      ...(d.scripts?.animate ?? []),
      { mp_walk_jiggle: 'v.mp_female' }, { belly_controller: 'v.mp_female' },
      ...(women.controller ? [{ mp_pose_controller: 'v.mp_female' }] : []),
      { newborn: "v.mp_female && v.pose == 'birth' && !v.crowning" },
    ],
  };
  d.render_controllers = [...list, { [RC_BELLY]: `${FEMALE} && v.bp >= 0` }];
  writeJson(join(ORP, path), doc);

  // the behaviour: the pregnancy's properties and events, and the family our mob system looks for
  const e = behavior.doc['minecraft:entity'];
  e.description.properties = { ...(e.description.properties ?? {}), ...MINEPREGGO_PROPERTIES, [`${MOD}:female`]: { type: 'int', range: [0, 2], default: 0, client_sync: true } };
  for (const group of [e.components, ...Object.values(e.component_groups ?? {})]) {
    const family = group?.['minecraft:type_family'];
    if (family && !family.family.includes(FAMILY_TAG)) family.family.push(FAMILY_TAG);
  }
  e.components['minecraft:type_family'] ??= { family: ['mob', FAMILY_TAG] };
  e.events = { ...(e.events ?? {}), ...phaseEvents() };
  writeJson(join(OBP, behavior.path), behavior.doc);
  peoples++;
}
writeJson(join(ORP, 'render_controllers', `${DIR}.render_controllers.json`), { format_version: '1.8.0', render_controllers: renderControllers });
writeJson(join(ORP, 'animation_controllers', `${DIR}.animation_controllers.json`), { format_version: '1.10.0', animation_controllers: animationControllers });
writeJson(join(ORP, 'animations', DIR, 'walk_jiggle.animation.json'), { format_version: '1.8.0', animations: { [JIGGLE]: walkJiggleAnimation({ chest: ['mp_bust'], belly: ['belly'], buttRoot: ['mp_hips'] }) } });

// ---- the packs' manifests: they need Minepreggo's packs and World Alliance's ---------------------------
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version.split('.').map(Number);
const ours = { bp: JSON.parse(readFileSync(join(BP, 'manifest.json'), 'utf8')).header, rp: JSON.parse(readFileSync(join(RP, 'manifest.json'), 'utf8')).header };
const name = 'Minepreggo × World Alliance';
const description = "World Alliance's peoples get their women in Minepreggo's pregnancy system. Needs Minepreggo and World Alliance; put it above World Alliance.";
writeJson(join(OBP, 'manifest.json'), {
  format_version: 2,
  header: { name, description, uuid: IDS.bp, version, min_engine_version: ours.bp.min_engine_version },
  modules: [{ type: 'data', uuid: IDS.bpData, version }],
  dependencies: [{ uuid: IDS.rp, version }, { uuid: ours.bp.uuid, version: ours.bp.version }, { uuid: packs.behavior.manifest.header.uuid, version: packs.behavior.manifest.header.version }],
});
writeJson(join(ORP, 'manifest.json'), {
  format_version: 2,
  header: { name, description, uuid: IDS.rp, version, min_engine_version: ours.bp.min_engine_version },
  modules: [{ type: 'resources', uuid: IDS.rpResources, version }],
  dependencies: [{ uuid: ours.rp.uuid, version: ours.rp.version }, { uuid: packs.resource.manifest.header.uuid, version: packs.resource.manifest.header.version }],
});
for (const [file, out] of [['pack_icon.png', OBP], ['pack_icon.png', ORP]]) if (existsSync(join(BP, file))) writeBytes(join(out, file), new Uint8Array(readFileSync(join(BP, file))));
const usable = [...made.values()].filter(Boolean);
console.log(`World Alliance compatibility: ${peoples} peoples with women, on ${usable.length} rigs (${usable.filter((w) => w?.poses.length).length} with poses, ${poseCount} poses), ${bellySkins.size} belly skin tones`);
