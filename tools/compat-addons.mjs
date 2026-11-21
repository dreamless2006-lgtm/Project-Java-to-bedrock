// Builds Minepreggo's compatibility add-ons for other add-ons: for each, a behavior and a resource pack
// of their own (compat/<add-on>/, packaged by tools/build.mjs as dist/minepreggo-<add-on>-<version>
// .mcaddon), made from the add-on in vendor/ at import time; nothing of it is committed. Players
// install one with Minepreggo and its add-on, above the add-on: it replaces that add-on's humanoid
// mobs' definitions with copies whose women are in Minepreggo's pregnancy system (it needs nothing else
// of ours than the Minepreggo packs: their pregnancy system, scripts/mobs/compat_women.js and the
// belly animations). A woman is a mob whose minepreggo:female property is 2 (and is grown).
//
// World Alliance (vendor/worldalliance/): a people keeps its mob type (its kingdoms, armies and scripts
// know their units by type), and the script rolls half of its units women. A woman is drawn on her own
// female model, a copy of her people's rig (the add-on's, or the vanilla one it borrows, from
// vendor/vanilla-models/: Mojang's bedrock-samples) with a woman's build: slimmer arms, a bust and wider
// hips, cut from her unit's own texture so they wear her outfit; a man keeps the rig as it is. Over
// her goes a blocky belly (like her people's boxes). Animals, vehicles, blobs, golems, dragons and tiny
// folk (pixies) are left out.
//
// Girl Mob (vendor/girlmob/: AntiGM's girl versions of the vanilla mobs): every grown mob of it is a
// girl. Each has her own way of carrying and giving birth (GIRL_MOB): a normal birth, through her
// navel, a belly burst, or a breast pregnancy (her breasts swell with it, her belly stays small, and
// the baby comes at her chest); a belly shape of her own (round, high, low, wide or pointed); one of
// the births made for them (tools/lib/girl-births.mjs 'girlmob:'); and a heavy pregnant waddle, a
// hand at the small of her back and one on her belly. Those too small for it (the bee, the vex, the
// cave spider, the slime) and babies are left out.
//
// For both: the Jenny-style pregnancy and scene poses and her birth, solved onto her rig
// (tools/lib/scene-poses.mjs), with her baby crowning, kicks and a walk jiggle.
//
// Pokédrock (vendor/pokedrock/pokedrock.zip: SERP's Pokédrock, its behavior pack and its resource packs,
// the 3D one over the base one): its popular two-legged Pokémon of a grown-up size (scripts/mobs/
// pokemon.js) are each female by her kind's share, on her own model with a bust and hips (arms as they
// are: its Pokémon hold theirs out); the rest are left as they are. Its HUD and ours both add to the
// HUD's root panel, where only the top pack's additions count: its packs carry both.
//
// Run: node tools/compat-addons.mjs <worldalliance | girlmob | pokedrock> (part of npm run import).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { POKEMON_WOMEN } from '../packs/behavior/scripts/mobs/pokemon.js';
import { strFromU8, unzipSync } from 'fflate';
import { CUBE_BELLY, addNewborn, babyScale, fitBelly, measureBody, roundBelly, smoothBelly } from './lib/belly-fit.mjs';
import { bellyTexture, skinTone } from './lib/belly-skin.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, SPAWN_PREGNANT, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
import { FETUS_SCALE, crowningLines } from './lib/crowning.mjs';
import { GIRL_BIRTHS, girlBirthExit, girlEffects } from './lib/girl-births.mjs';
import { girlSources, poseController } from './lib/girl-port.mjs';
import { stringifyEntity } from './lib/entity-json.mjs';
import { facesOf, part } from './lib/box-uv.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { girlPoseAnimations } from './lib/scene-poses.mjs';
import { walkJiggleAnimation } from './lib/walk-jiggle.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const VANILLA = join(ROOT, 'vendor/vanilla-models');
/** Whose birth each World Alliance people's women give birth like (tools/lib/girl-births.mjs), by rig. */
const BIRTHS = /** @type {[RegExp, string][]} */ ([[/elf/, 'kum:luna'], [/dwarf/, 'jhelliedev:ellie'], [/orc|piglin|troll/, 'kum:galath'], [/mushroom|spore/, 'jhallie4:allie'], [/enderman|skeleton|dread|colossus/, 'fapcraft:jenny'], [/./, 'kum:bia']]);
/** Each way of giving birth's own birth, for Girl Mob's girls. */
const TYPE_BIRTHS = { normal: 'girlmob:standing', navel: 'girlmob:arched', burst: 'girlmob:sprawl', breast: 'girlmob:cradle' };
/**
 * Girl Mob's girls, by their mob: how she carries and gives birth, her belly's shape. Normal births
 * for most; through the navel for the strange ones (the enderman, the evoker, the witch, the golem);
 * a belly burst for the fierce (the blaze, the warden, the brute, the wither skeleton); a breast
 * pregnancy for the milk-giving farm girls. Every undead girl and the enderman burst.
 * The skeletons, who have no flesh, carry in a cage of their ribs (ribs).
 * @type {Record<string, { type: 'normal' | 'navel' | 'burst' | 'breast', shape: keyof typeof SHAPES, tone?: number[], ribs?: boolean }>}
 */
const GIRL_MOB = {
  creeper: { type: 'burst', shape: 'round' }, zombie: { type: 'burst', shape: 'round' }, husk: { type: 'burst', shape: 'low' }, drowned: { type: 'burst', shape: 'pointed' },
  skeleton: { type: 'burst', shape: 'high', ribs: true }, stray: { type: 'burst', shape: 'high', ribs: true }, wither_skeleton: { type: 'burst', shape: 'pointed', ribs: true },
  pillager: { type: 'normal', shape: 'wide' }, vindicator: { type: 'normal', shape: 'round' }, evocation_illager: { type: 'navel', shape: 'high' },
  witch: { type: 'navel', shape: 'low' }, wandering_trader: { type: 'normal', shape: 'wide' }, villager_v2: { type: 'normal', shape: 'round' },
  piglin: { type: 'normal', shape: 'wide' }, piglin_brute: { type: 'burst', shape: 'wide' }, enderman: { type: 'burst', shape: 'round', tone: [38, 28, 48] },
  warden: { type: 'burst', shape: 'wide' }, iron_golem: { type: 'navel', shape: 'wide' }, blaze: { type: 'burst', shape: 'round' },
  spider: { type: 'normal', shape: 'low' }, fox: { type: 'normal', shape: 'pointed' }, wolf: { type: 'normal', shape: 'pointed' }, horse: { type: 'normal', shape: 'low' },
  cow: { type: 'breast', shape: 'low' }, pig: { type: 'breast', shape: 'round' }, sheep: { type: 'breast', shape: 'wide' }, chicken: { type: 'breast', shape: 'high' },
};
/** Belly shapes: the waist box the belly is fitted to, moved and stretched ([[x0, x1], [y0, y1], [z0, z1]], her front at z0). */
const SHAPES = {
  round: (/** @type {number[][]} */ b) => b,
  // carried high and forward
  high: ([[x0, x1], [y0, y1], [z0, z1]]) => [[x0 * 0.95, x1 * 0.95], [y0 + (y1 - y0) * 0.15, y1 + (y1 - y0) * 0.15], [z0, z0 + (z1 - z0) * 1.15]],
  // dropped low and heavy
  low: ([[x0, x1], [y0, y1], [z0, z1]]) => [[x0 * 1.08, x1 * 1.08], [y0 - (y1 - y0) * 0.12, y1 - (y1 - y0) * 0.12], [z0, z0 + (z1 - z0) * 1.1]],
  // broad from side to side
  wide: ([[x0, x1], [y0, y1], [z0, z1]]) => [[x0 * 1.3, x1 * 1.3], [y0, y1], [z0, z0 + (z1 - z0) * 0.95]],
  // narrow and sticking far out
  pointed: ([[x0, x1], [y0, y1], [z0, z1]]) => [[x0 * 0.82, x1 * 0.82], [y0, y1], [z0, z0 + (z1 - z0) * 1.35]],
};
/** Girl Mob's mobs too small to be with child (the slime by its smaller sizes). */
const CHILD_SIZED = new Set(['minecraft:bee', 'minecraft:vex', 'minecraft:cave_spider', 'minecraft:slime']);
const GROWN = `q.property('${MOD}:female') == 2 && !q.is_baby`;
/**
 * @typedef {object} Addon
 * @property {string} title @property {string} name @property {string} description its packs' own
 * @property {string} vendor where its .mcaddon (or a .zip of its .mcpack files) is
 * @property {string} dir its files' folder in our packs @property {string} prefix its ids'
 * @property {{ bp: string, bpData: string, rp: string, rpResources: string }} ids our packs' and modules' ids
 * @property {string} female @property {string} male who is drawn a woman, who not
 * @property {number} femaleDefault the minepreggo:female property's default (0: the script rolls it)
 * @property {boolean} build a woman's build (slimmer arms, bust, hips) on her model
 * @property {'cube' | 'round'} bellyStyle @property {Set<string>} skipRigs
 * @property {string} [separate] its mobs replace vanilla ones: give them their own ids in this namespace instead (the vanilla mobs stay as they are)
 * @property {boolean} [merge] the add-on itself goes into our packs, under our files: one add-on to install instead of two
 * @property {boolean} [armless] its girls may have no arms (the creeper: her belly, kicks and burst, poses if they solve)
 * @property {boolean} [keepArms] a woman's build leaves her arms as they are (arms held out, not hanging: slimming would shorten them)
 * @property {number} [bust] her bust this much bigger than her torso's width makes it
 * @property {number} [minWidth] her belly at least this wide (a slim body's)
 * @property {boolean} [hud] its HUD adds to the root panel as ours does: its packs carry both additions
 * @property {(id: string) => boolean} skip mob types left as they are
 * @property {(rig: { key: string }, id: string) => { birth: string, type: 'normal' | 'navel' | 'burst' | 'breast', shape: keyof typeof SHAPES }} women how they carry and give birth
 */
/** @type {Record<string, Addon>} */
const ADDONS = {
  worldalliance: {
    title: 'World Alliance', name: 'Minepreggo × World Alliance', description: "World Alliance's peoples get their women in Minepreggo's pregnancy system. Needs Minepreggo and World Alliance; put it above World Alliance.",
    vendor: 'vendor/worldalliance', dir: 'minepreggo_worldalliance', prefix: 'worldbox',
    ids: { bp: '21ba7e65-b20f-4f1a-8605-f36f2484257d', bpData: '8a81c26f-a413-4d09-9af3-b8c0a19d20b7', rp: 'bdfcf66a-f890-4f6f-90cf-bac9423efa98', rpResources: 'b58afbd6-d8c1-48f6-9b97-d742f661bbe6' },
    female: `q.property('${MOD}:female') == 2`, male: `q.property('${MOD}:female') != 2`, femaleDefault: 0, build: true, bellyStyle: 'cube',
    // (a fairy no taller than a sapling)
    skipRigs: new Set(['geometry.pixie']), skip: () => false,
    women: (rig) => ({ birth: /** @type {string} */ (BIRTHS.find(([re]) => re.test(rig.key))?.[1]), type: 'normal', shape: 'round' }),
  },
  girlmob: {
    title: 'Girl Mob', name: 'Girl Mob + Minepreggo', description: "AntiGM's Girl Mob (v0.4.7), its girls pregnant in Minepreggo's pregnancy system, each in her own way. Needs Minepreggo; use it instead of Girl Mob.", merge: true,
    vendor: 'vendor/girlmob', dir: 'minepreggo_girlmob', prefix: 'girlmob', separate: 'girlmob',
    ids: { bp: '07598f2c-d0b0-4c7d-889c-e742806b6089', bpData: '5e748bbb-4a63-4b0f-87f7-4e2f2d38ea52', rp: 'dbda3fe3-4dc1-45ee-99de-5006a256f65d', rpResources: 'df822d24-9290-4ce8-b496-368d35603a06' },
    female: GROWN, male: `!(${GROWN})`, femaleDefault: 2, build: false, bellyStyle: 'round', armless: true,
    skipRigs: new Set(), skip: (id) => !id.startsWith('girlmob:') || CHILD_SIZED.has(id.replace(/^girlmob:/, 'minecraft:')),
    women: (_, id) => {
      const girl = GIRL_MOB[id.replace(/^(minecraft|girlmob):/, '')] ?? { type: 'normal', shape: 'round' };
      return { ...girl, birth: TYPE_BIRTHS[girl.type] };
    },
  },
  pokedrock: {
    title: 'Pokédrock', name: 'Minepreggo × Pokédrock', description: "SERP's Pokédrock's Gardevoir, Lucario, Blaziken, Nidoqueen and Greninja: their females in Minepreggo's pregnancy system. Needs Minepreggo and Pokédrock (with its 3D pack); put it above both.",
    vendor: 'vendor/pokedrock', dir: 'minepreggo_pokedrock', prefix: 'pokemon',
    ids: { bp: '5b0c2d4e-7a61-4f3b-9c58-2e1d6a8f4b97', bpData: 'c3e9a1f2-6d4b-4e87-a215-9b7c3d0e5f18', rp: '8f4a6c1e-2b9d-4d73-b6e0-5a1c7f3e9d24', rpResources: 'e1d7b3a9-4c62-4f05-8e9b-36a2d5c7f810' },
    female: `q.property('${MOD}:female') == 2`, male: `q.property('${MOD}:female') != 2`, femaleDefault: 0, build: true, keepArms: true, bust: 1.5, minWidth: 8, bellyStyle: 'round', hud: true,
    skipRigs: new Set(), skip: (id) => !POKEMON_WOMEN[id],
    women: (_, id) => ({ birth: POKEMON_WOMEN[id].birth, type: 'normal', shape: 'round' }),
  },
};
const addon = ADDONS[process.argv[2]];
if (!addon) throw new Error(`usage: node tools/compat-addons.mjs <${Object.keys(ADDONS).join(' | ')}>`);
const OUT = join(ROOT, 'compat', process.argv[2]);
const OBP = join(OUT, 'behavior');
const ORP = join(OUT, 'resource');
const VENDOR = join(ROOT, addon.vendor);
const DIR = addon.dir;
const IDS = addon.ids;
const FEMALE = addon.female;
const MALE = addon.male;
const WOMAN = `${addon.prefix}_woman`;
const JIGGLE = `animation.${MOD}.${WOMAN}.walk_jiggle`;
const RC_BELLY = `controller.render.${MOD}.${WOMAN}.belly`;

const writeJson = (/** @type {string} */ file, /** @type {unknown} */ doc) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
};
const writeBytes = (/** @type {string} */ file, /** @type {Uint8Array} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
/**
 * JSON as add-ons write it, which the game reads: a byte-order mark, comments (whole lines or after a
 * value), trailing commas.
 */
function parse(/** @type {string} */ text) {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(clean);
  } catch {
    let out = '';
    for (let i = 0, string = false; i < clean.length; i++) {
      const c = clean[i];
      if (string) {
        out += c;
        if (c === '\\') out += clean[++i] ?? '';
        else if (c === '"') string = false;
      } else if (c === '"') {
        string = true;
        out += c;
      } else if (c === '/' && clean[i + 1] === '/') {
        while (i < clean.length && clean[i] !== '\n') i++;
        out += '\n';
      } else if (c === '/' && clean[i + 1] === '*') {
        i = clean.indexOf('*/', i + 2) + 1 || clean.length;
      } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
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

const archive = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => /\.(mcaddon|zip)$/.test(f)) : undefined;
if (!archive) {
  console.warn(`warning: no ${addon.title} add-on in ${addon.vendor}/; no compatibility add-on for it`);
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

// ---- its own mobs, apart from the vanilla ones they replaced (separate) ---------------------------------
// Each vanilla mob it redefines becomes a mob of its own (minecraft:zombie -> girlmob:zombie), throughout
// its files: definitions, transformations, commands' selectors, translations. It keeps the vanilla
// mob's built-in behaviour (runtime_identifier), and gets a spawn rule and a spawn egg.
/** @type {Map<string, string>} vanilla id -> its own */
const renamed = new Map();
if (addon.separate) {
  for (const [path, data] of Object.entries(packs.behavior.files)) {
    if (!path.startsWith('entities/') || !path.endsWith('.json')) continue;
    const id = parse(strFromU8(data))['minecraft:entity']?.description?.identifier;
    if (id?.startsWith('minecraft:') && id !== 'minecraft:player') renamed.set(id, `${addon.separate}:${id.slice(10)}`);
  }
  const names = [...renamed.keys()].map((id) => id.slice(10)).sort((a, b) => b.length - a.length).join('|');
  const ids = new RegExp(`(^|[^a-z_:])minecraft:(${names})(?![a-z_0-9])`, 'g');
  const types = new RegExp(`(type\\s*=\\s*!?)(${names})(?![a-z_0-9:])`, 'g');
  for (const kind of /** @type {const} */ (['behavior', 'resource'])) {
    for (const [path, data] of Object.entries(packs[kind].files)) {
      if (!/\.(json|lang|mcfunction)$/.test(path) || path === 'manifest.json') continue;
      const text = strFromU8(data);
      const out = text.replace(ids, `$1${addon.separate}:$2`).replace(types, `$1${addon.separate}:$2`);
      if (out !== text) packs[kind].files[path] = new TextEncoder().encode(out);
    }
  }
}
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
  const g = addon.skipRigs.has(id) ? undefined : geometryOf(id);
  /** @type {Rig | null} */
  let rig = null;
  if (g) {
    const find = (/** @type {RegExp} */ re) => g.bones.filter((/** @type {any} */ b) => re.test(b.name));
    const body = find(/^body$/i)[0];
    // (Pokédrock's heads are head1)
    const head = find(/^head1?$/i)[0];
    // sides by where they hang (right is -x), whatever the rig calls them
    const sides = (/** @type {any[]} */ pair) => (pair.length === 2 ? [...pair].sort((a, b) => a.pivot[0] - b.pivot[0]) : []);
    const arms = sides(find(/^(right|left)_?arm$|^arm_?(right|left|r|l)$/i));
    // (four legs, a creeper's: her front two, toward -z)
    const allLegs = find(/^(right|left)_?leg$|^leg_?(right|left|r|l)$|^leg[0-3]$/i);
    const legs = sides(allLegs.length === 4 && addon.armless ? [...allLegs].sort((a, b) => a.pivot[2] - b.pivot[2]).slice(0, 2) : allLegs.filter((/** @type {any} */ b) => !/^leg[23]$/i.test(b.name)));
    // (a rig that hangs its torso from bones under the body: their cubes, but the head's, limbs' and chest's, on bones square to her)
    const limbs = new Set([head, ...arms, ...legs].filter(Boolean).map((b) => b.name));
    const square = (/** @type {any} */ bone) => !bone.rotation || bone.rotation.every((/** @type {number} */ a) => Math.abs(a) <= 35);
    const trunkCubes = (/** @type {any} */ bone) => [...(square(bone) ? bone.cubes ?? [] : []), ...g.bones.filter((/** @type {any} */ b) => b.parent === bone.name && !limbs.has(b.name) && !/breast|boob|bust|chest|hair|skirt|tail|wing/i.test(b.name)).flatMap(trunkCubes)];
    // (only pieces between the top of her legs and her shoulders: not a skirt, not a collar)
    const shoulders = arms.length ? Math.max(...arms.map((/** @type {any} */ a) => a.pivot[1])) + 2 : Infinity;
    const legsTop = legs.length ? Math.max(...legs.map((/** @type {any} */ l) => l.pivot[1])) : -Infinity;
    const between = (/** @type {any} */ c) => c.origin[1] >= legsTop - 1.5 && c.origin[1] + c.size[1] <= shoulders + 1;
    const found = [...(body?.cubes?.length ? body.cubes : body ? trunkCubes(body).filter(between) : [])].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    // else the usual torso, between her shoulders and from the top of her legs (in the usual skin's place)
    const legTop = legs.length ? Math.max(...legs.map((/** @type {any} */ l) => l.pivot[1])) : 0;
    const half = arms.length ? Math.max(2, Math.abs(arms[0].pivot[0]) - 1) : 4;
    const torso = found ?? (arms.length && legs.length ? { origin: [-half, legTop, -2], size: [2 * half, Math.max(6, arms[0].pivot[1] + 2 - legTop), 4], uv: [16, 16] } : undefined);
    if (body && head && (arms.length || addon.armless) && legs.length && torso && !g.bones.some((/** @type {any} */ b) => ['mp_root', 'mp_waist', 'mp_bust', 'mp_hips', 'mp_hip'].includes(b.name))) {
      rig = { key: id.replace(/^geometry\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase(), geometry: g, body: body.name, head: head.name, armR: arms[0]?.name ?? 'mp_no_arm_r', armL: arms[1]?.name ?? 'mp_no_arm_l', legR: legs[0].name, legL: legs[1].name, torso };
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
function femaleGeometry(/** @type {Rig} */ rig, /** @type {Women['opts']} */ opts) {
  const g = structuredClone(rig.geometry);
  g.description = { ...g.description, identifier: `geometry.${MOD}.${addon.prefix}_${rig.key}${opts.suffix}_female` };
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
  // where a belly bursts: the middle of her waist, a hand in front of it
  if (opts.type === 'burst') {
    const [, y0, z0] = rig.torso.origin;
    g.bones[1].locators = { mp_burst: [0, round(y0 + rig.torso.size[1] * 0.3), round(z0 - 5)] };
  }
  // slimmer arms (on a woman's build)
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  for (const [arm, side] of addon.build && !addon.keepArms ? [[rig.armR, -1], [rig.armL, 1]] : []) {
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
  // her bust and hips, in her torso's texture (a breast pregnancy's bust only, swelling with it)
  if (!addon.build && opts.type !== 'breast') return g;
  const faces = facesOf(rig.torso, trunk.mirror);
  const front = faces.north ?? Object.values(faces)[0];
  if (!front) return undefined;
  const [x0, y0, z0] = rig.torso.origin;
  const [w, h, d] = rig.torso.size;
  // (an inflated torso, armour drawn over it, stands out as much further)
  const k = (w / 8) * (addon.bust ?? 1), top = y0 + h, out = rig.torso.inflate ?? 0;
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
  );
  if (addon.build) g.bones.push(
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
  // (her own bones of the names the solver gives ours stand aside, and ours go back under names of ours)
  const own = new Set(female.bones.map((/** @type {any} */ b) => b.name));
  const aside = ['hip', 'torso', 'trunk', 'upperBody', 'boobs', 'head', 'armR', 'armL', 'legR', 'legL'].filter((n) => own.has(n) && ![rig.head, rig.armR, rig.armL, rig.legR, rig.legL].includes(n));
  const to = /** @type {Record<string, string>} */ ({ ...Object.fromEntries(aside.map((n) => [n, `${n}_own`])), mp_root: 'body', mp_waist: 'upperBody', [rig.body]: 'trunk', [rig.head]: 'head', [rig.armR]: 'armR', [rig.armL]: 'armL', [rig.legR]: 'legR', [rig.legL]: 'legL', mp_bust: 'boobs' });
  const back = Object.fromEntries(Object.entries(to).map(([k, v]) => [v, k]));
  if (aside.includes('hip')) back.hip = 'mp_hip';
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
/**
 * A client entity in the 1.10.0 format, which conditions on render controllers and scripts.animate
 * need: an older file's animation controllers (1.8.0's list) become animations it plays always.
 */
function toFormat110(/** @type {any} */ doc) {
  const d = doc['minecraft:client_entity'].description;
  if (Number(String(doc.format_version ?? '1.8.0').split('.')[1]) >= 10) return;
  doc.format_version = '1.10.0';
  d.animations ??= {};
  d.scripts ??= {};
  d.scripts.animate ??= [];
  for (const entry of /** @type {Record<string, string>[]} */ (d.animation_controllers ?? [])) for (const [short, id] of Object.entries(entry)) {
    d.animations[short] = id;
    d.scripts.animate.unshift(short);
  }
  delete d.animation_controllers;
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
 * @property {{ birth: string, type: string, shape: keyof typeof SHAPES, suffix: string }} opts how they carry and give birth
 * @property {Record<string, string>} ids @property {any[]} animate @property {string[]} pre their own animations, how they play, their variables
 * @property {string} female her model's identifier
 * @property {any[]} bellies her bellies (her rig's names)
 * @property {{ pose: string, id: string }[]} poses @property {{ flair: string, crowning: string } | undefined} extras
 * @property {string | undefined} controller her pose controller @property {any} spec her birth
 * @property {number} crownScale @property {any} exit
 */
/** @type {Map<string, Women | null>} */
const made = new Map();
let poseCount = 0;
function womenOf(/** @type {Rig} */ rig, /** @type {Women['opts']} */ opts) {
  const key = `${rig.key}${opts.suffix}`;
  if (made.has(key)) return /** @type {Women | null} */ (made.get(key));
  const female = femaleGeometry(rig, opts);
  const jenny = female && onJennyNames(rig, female);
  const measured = jenny && measureBody(jenny.geometry);
  if (!female || !jenny || !measured) {
    made.set(key, null);
    return null;
  }
  // a big people's torso (a colossus) gets as much bigger a belly, from the same waist bottom
  const legTop = Math.max(...[rig.legR, rig.legL].map((n) => rig.geometry.bones.find((/** @type {any} */ b) => b.name === n)?.pivot[1] ?? 0));
  const grow = Math.max(1, Math.min(8, rig.torso.size[0] / 8));
  const [[x0, x1], [y0, y1], [z0, z1]] = measured.box;
  /** @type {number[][]} */
  let box = [[x0 * grow, x1 * grow], [y0, y0 + (y1 - y0) * grow], [z0, z0 + (z1 - z0) * grow]];
  // a girl's belly runs from her hips (just under the top of her legs) to under her bust, whatever
  // pieces her rig builds her torso of (the measured one is often her chest alone)
  if (!addon.build) {
    const bottom = legTop - 1;
    const bust = rig.torso.origin[1] + rig.torso.size[1] - 2.5;
    box = [box[0], [bottom, bottom + Math.min(13, Math.max(9, bust - bottom))], box[2]];
  }
  // (a slim body, a Pokémon's, still carries a belly as wide as a girl's)
  const across = box[0][1] - box[0][0];
  if (addon.minWidth && across < addon.minWidth) {
    const k = addon.minWidth / across;
    box = [[box[0][0] * k, box[0][1] * k], box[1], [box[2][0], box[2][0] + (box[2][1] - box[2][0]) * k]];
  }
  box = SHAPES[opts.shape](box);
  // a breast pregnancy leaves her belly small
  if (opts.type === 'breast') box = [[box[0][0] * 0.6, box[0][1] * 0.6], [box[1][0], box[1][0] + (box[1][1] - box[1][0]) * 0.75], [box[2][0], box[2][0] + (box[2][1] - box[2][0]) * 0.6]];
  // where her baby comes out: between her legs, her navel (a burst's too: mid-belly) or her chest
  const [, ty, tz] = rig.torso.origin;
  const front = tz - (rig.torso.inflate ?? 0);
  const opening = opts.type === 'navel' || opts.type === 'burst' ? [0, round((box[1][0] + box[1][1]) / 2), round(box[2][0] + 1)]
    : opts.type === 'breast' ? [0, round(ty + rig.torso.size[1] - 3.5 * (rig.torso.size[0] / 8)), round(front + 0.5)] : measured.opening;
  const body = { ...measured, box, opening };
  // her people drawn in boxes get a blocky belly (tools/lib/belly-fit.mjs chestStyle 'cube'), girls a round one
  const shell = (/** @type {any} */ fitted) => (addon.bellyStyle === 'cube' ? roundBelly(fitted, CUBE_BELLY) : smoothBelly(fitted, body));
  const onJenny = PHASES.map((p) => addNewborn(shell(fitBelly(sources.playerBodies[p], `geometry.${MOD}.${addon.prefix}_${key}_belly_p${p}`, body)), body, {}));
  const id = `${MOD}:${addon.prefix}_${key}`;
  const prefix = `animation.${MOD}.${addon.prefix}_${key}`;
  GIRL_BIRTHS[id] = { ...GIRL_BIRTHS[opts.birth], name: key };
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
  const controller = poses.length ? `controller.animation.${MOD}.${addon.prefix}_${key}.pose` : undefined;
  if (controller) animationControllers[controller] = poseController(poses.map((p) => p.pose), extras ? { birth: ['mp_birth_flair', 'mp_birth_crowning'] } : {});

  // her own ways (Girl Mob's girls): the pregnant waddle, her swelling breasts, her belly's burst
  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {any[]} */
  const animate = [];
  /** @type {string[]} */
  const pre = [];
  if (!addon.build) {
    // heavier from P4 on: her hips sway as she walks, she leans back, a hand at the small of her back
    // and one on her belly
    pre.push('v.mp_heavy = math.clamp((v.bp - 3.0) / 6.0, 0.0, 1.0);');
    ids.mp_pregnant = `${prefix}.pregnant`;
    animations[ids.mp_pregnant] = {
      loop: true,
      bones: {
        mp_root: { rotation: [0, 0, 'math.sin(q.modified_distance_moved * 19.0) * 5.0 * v.mp_heavy * math.clamp(q.modified_move_speed * 4.0, 0.0, 1.0)'] },
        mp_waist: { rotation: ['-7.0 * v.mp_heavy', 0, 0] },
        [rig.armR]: { rotation: ['28.0 * v.mp_heavy', '-12.0 * v.mp_heavy', '-18.0 * v.mp_heavy'] },
        [rig.armL]: { rotation: ['-32.0 * v.mp_heavy', '-22.0 * v.mp_heavy', '6.0 * v.mp_heavy'] },
      },
    };
    animate.push({ mp_pregnant: "v.mp_female && v.bp >= 4 && v.pose == 'none'" });
  }
  if (opts.type === 'breast') {
    // none before she is with child, then fuller at every size, fullest giving birth
    ids.mp_breasts = `${prefix}.breasts`;
    animations[ids.mp_breasts] = { loop: true, bones: { mp_bust: { scale: "v.bp < 0 ? 0.0 : 0.8 + 0.09 * v.bp + (v.pose == 'birth' ? 0.2 : 0.0)" } } };
    animate.push({ mp_breasts: 'v.mp_female' });
  }
  if (opts.type === 'burst') {
    // her belly swells and shakes as she pushes, and at four fifths of the birth bursts (gone at once,
    // with a puff and a pop), the baby already half out in front of her
    pre.push(`v.mp_burst = v.mp_female && v.pose == 'birth' && v.push >= 0.8;`);
    ids.mp_belly_burst = `${prefix}.belly_burst`;
    animations[ids.mp_belly_burst] = { loop: true, bones: { belly: { scale: 'v.mp_burst ? 0.0 : 1.0 + 0.3 * math.pow(math.clamp(v.push / 0.8, 0.0, 1.0), 2.0) + 0.04 * v.push * math.sin(q.life_time * 2400.0)' } } };
    ids.mp_burst_controller = `controller.animation.${MOD}.${WOMAN}.burst`;
    animationControllers[ids.mp_burst_controller] = {
      initial_state: 'whole',
      states: {
        whole: { transitions: [{ burst: 'v.mp_burst' }] },
        burst: { particle_effects: [{ effect: 'mp_burst_dust', locator: 'mp_burst' }, { effect: 'mp_burst_sparks', locator: 'mp_burst' }], sound_effects: [{ effect: 'mp_burst' }], transitions: [{ whole: '!v.mp_burst' }] },
      },
    };
    animate.push({ mp_belly_burst: "v.mp_female && v.pose == 'birth'" }, 'mp_burst_controller');
  }

  // (1.16.0: the add-ons' rigs write locators as objects, which 1.12.0 refuses, losing the whole model)
  writeJson(join(ORP, 'models/entity', DIR, `${key}_female.geo.json`), { format_version: '1.16.0', 'minecraft:geometry': [female] });
  const bellies = onJenny.map((doc, p) => {
    const mine = renameBones(doc, jenny.back);
    writeJson(join(ORP, 'models/entity', DIR, `${key}_belly_p${p}.geo.json`), mine);
    return mine;
  });
  if (Object.keys(animations).length) writeJson(join(ORP, 'animations', DIR, `${key}.animation.json`), { format_version: '1.8.0', animations });
  /** @type {Women} */
  const women = { opts, ids, animate, pre, female: female.description.identifier, bellies, poses, extras: extras ? { flair: extras.flair.id, crowning: extras.crowning.id } : undefined, controller, spec, crownScale, exit };
  made.set(key, women);
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
/**
 * A skeleton's belly: her ribs, bands of bone with gaps between them (the cutout material shows her
 * through them), the edge of each band shaded.
 */
function ribcage(/** @type {{ width: number, height: number, data: Uint8Array }} */ image) {
  for (let y = 0; y < image.height; y++) {
    const band = y % 6;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (band >= 4) image.data[i + 3] = 0;
      else if (band === 0 || band === 3) for (let k = 0; k < 3; k++) image.data[i + k] = Math.round(image.data[i + k] * 0.78);
    }
  }
  return image;
}
/** @type {Map<string, string>} belly textures by skin tone */
const bellySkins = new Map();
const both = (/** @type {string | undefined} */ a, /** @type {string} */ b) => (a ? `(${a}) && ${b}` : b);
let peoples = 0;
/** @type {Set<string>} the mobs with women */
const withWomen = new Set();
for (const { path, doc } of theirs('resource', 'entity')) {
  const d = doc['minecraft:client_entity']?.description;
  const behavior = d && behaviors.get(d.identifier);
  if (!d?.geometry || !behavior || addon.skip(d.identifier)) continue;
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
    // (one that draws her body, among others perhaps: a baby's, a sheared one's; hers wherever it does)
    const body = new RegExp(`\\bGeometry\\.${geoKey}\\b`, 'gi');
    if (!def || !body.test(JSON.stringify([def.geometry, def.arrays?.geometries ?? {}]))) {
      list.push(entry);
      continue;
    }
    const hers = `controller.render.${MOD}.${WOMAN}.${name.replace(/^controller\.render\./, '').replace(/[^a-z0-9]+/gi, '_')}`;
    renderControllers[hers] ??= def.geometry === `Geometry.${geoKey}` ? { ...structuredClone(def), geometry: 'Geometry.mp_female' } : JSON.parse(JSON.stringify(def).replace(body, 'Geometry.mp_female'));
    list.push({ [name]: both(/** @type {string | undefined} */ (condition), MALE) }, { [hers]: both(/** @type {string | undefined} */ (condition), FEMALE) });
    drawn = true;
  }
  if (!drawn) continue;
  const how = addon.women(rig, d.identifier);
  const women = womenOf(rig, { ...how, suffix: `${how.type === 'normal' ? '' : `_${how.type}`}${how.shape === 'round' ? '' : `_${how.shape}`}` });
  if (!women) continue;

  // her belly's skin: the tone of her unit's face (the vanilla textures are the game's: a usual tone)
  const texturePath = /** @type {string | undefined} */ (d.textures?.default ?? Object.values(d.textures ?? {})[0]);
  const png = texturePath && packs.resource.files[`${texturePath}.png`];
  // (a girl whose face is no guide to her skin has hers given)
  const tone = GIRL_MOB[d.identifier.replace(/^(minecraft|girlmob):/, '')]?.tone ?? POKEMON_WOMEN[d.identifier]?.tone ?? (png ? skinTone(decodePng(png), rig.geometry) : [224, 188, 160]);
  const ribs = GIRL_MOB[d.identifier.replace(/^(minecraft|girlmob):/, '')]?.ribs && !addon.build;
  const toneKey = tone.map((c) => c.toString(16).padStart(2, '0')).join('') + (ribs ? '_ribs' : '');
  if (!bellySkins.has(toneKey)) {
    const skin = `textures/${DIR}/belly_${toneKey}`;
    writeBytes(join(ORP, `${skin}.png`), encodePng(ribs ? ribcage(bellyTexture(tone)) : bellyTexture(tone)));
    bellySkins.set(toneKey, skin);
  }

  // the client entity: her model and bellies, the belly animations, her poses
  const pre = [
    `v.mp_female = ${FEMALE};`, ...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => women.bellies[p]['minecraft:geometry'][0]),
    // (a blocky belly kicks with the mod's own cubes, swelling fully; a round one's skin patches less)
    `v.kick_grow = ${addon.bellyStyle === 'cube' ? '1.0' : '0.35'};`,
    ...crowningLines({ when: "v.mp_female && v.pose == 'birth'", scale: women.crownScale, ...(women.exit ? { head: women.exit.head, rest: women.exit.rest } : {}) }),
    ...women.pre,
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
    ...women.ids,
  };
  if (women.poses.length) {
    const effects = girlEffects(women.spec);
    d.sound_effects = { ...(d.sound_effects ?? {}), ...effects.sound_effects };
    d.particle_effects = { ...(d.particle_effects ?? {}), ...effects.particle_effects };
  }
  if (women.opts.type === 'burst') {
    d.particle_effects = { ...(d.particle_effects ?? {}), mp_burst_dust: 'minecraft:large_explosion', mp_burst_sparks: 'minecraft:critical_hit_emitter' };
    d.sound_effects = { ...(d.sound_effects ?? {}), mp_burst: 'random.pop' };
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
      ...women.animate,
    ],
  };
  d.render_controllers = [...list, { [RC_BELLY]: `${FEMALE} && v.bp >= 0` }];
  // (the game refuses an empty map of effects)
  for (const key of ['sound_effects', 'particle_effects']) if (d[key] && !Object.keys(d[key]).length) delete d[key];
  toFormat110(doc);
  writeJson(join(ORP, path), doc);

  // the behaviour: the pregnancy's properties and events, and the family our mob system looks for
  const e = behavior.doc['minecraft:entity'];
  const vanilla = [...renamed].find(([, own]) => own === d.identifier)?.[0];
  if (vanilla) e.description.runtime_identifier = vanilla;
  e.description.properties = { ...(e.description.properties ?? {}), ...MINEPREGGO_PROPERTIES, [`${MOD}:female`]: { type: 'int', range: [0, 2], default: addon.femaleDefault, client_sync: true } };
  for (const group of [e.components, ...Object.values(e.component_groups ?? {})]) {
    const family = group?.['minecraft:type_family'];
    if (family && !family.family.includes(FAMILY_TAG)) family.family.push(FAMILY_TAG);
  }
  e.components['minecraft:type_family'] ??= { family: ['mob', FAMILY_TAG] };
  e.events = { ...(e.events ?? {}), ...phaseEvents() };
  // (back from a scene, tagged for the script to make her pregnant: scripts/mobs/compat_women.js)
  if (addon.separate) e.events[`${MOD}:after_scene`] = { queue_command: { command: ['tag @s add minepreggo_after_scene'] } };
  withWomen.add(d.identifier);
  // (some come into the world pregnant: their spawn event, then ours)
  const spawned = e.events['minecraft:entity_spawned'];
  e.events['minecraft:entity_spawned'] = spawned ? { sequence: [spawned, SPAWN_PREGNANT] } : SPAWN_PREGNANT;
  // (a float property's 0.0 must stay 0.0, or the game drops every property: stringifyEntity)
  writeBytes(join(OBP, behavior.path), new TextEncoder().encode(stringifyEntity(behavior.doc)));
  peoples++;
}
// ---- its scenes (separate): the defeated girl it turns a girl into lies on her back, and when the
// player gets off her she turns back into her girl, pregnant (scripts/mobs/compat_women.js)
let scenes = 0;
if (addon.separate) {
  /** @type {Map<string, string>} the defeated girl -> the girl she was */
  const sceneOf = new Map();
  for (const { doc } of theirs('behavior', 'entities')) {
    const id = doc['minecraft:entity']?.description?.identifier;
    if (!withWomen.has(id)) continue;
    for (const m of JSON.stringify(doc).matchAll(/"into":"([a-z_]+:[a-z_0-9]+)</g)) if (!m[1].startsWith(`${addon.separate}:`)) sceneOf.set(m[1], id);
  }
  const LIE = `animation.${MOD}.${WOMAN}.lie`;
  /** @type {Set<string>} */
  const lying = new Set();
  for (const { path, doc } of theirs('behavior', 'entities')) {
    const e = doc['minecraft:entity'];
    const girl = sceneOf.get(e?.description?.identifier);
    if (!girl || !e.events?.no_ride) continue;
    e.component_groups ??= {};
    e.component_groups['mp_after_scene'] = { 'minecraft:transformation': { into: `${girl}<${MOD}:after_scene>`, delay: { value: 0.5 }, drop_equipment: false } };
    const add = (e.events.no_ride.add ??= {});
    add.component_groups = [...(add.component_groups ?? []), 'mp_after_scene'];
    // the rider sits astride her hips, she lying on her back
    for (const group of [e.components, ...Object.values(e.component_groups)]) {
      const seats = group?.['minecraft:rideable']?.seats;
      if (Array.isArray(seats)) for (const seat of seats) seat.position = [0, 0.4, -0.75];
    }
    writeBytes(join(OBP, path), new TextEncoder().encode(stringifyEntity(doc)));
    lying.add(e.description.identifier);
    scenes++;
  }
  // her model under a root that lays her on her back
  for (const { path, doc } of theirs('resource', 'entity')) {
    const d = doc['minecraft:client_entity']?.description;
    if (!d || !lying.has(d.identifier)) continue;
    for (const [key, id] of Object.entries(d.geometry ?? {})) {
      const g = geometryOf(/** @type {string} */ (id));
      if (!g) continue;
      const lain = structuredClone(g);
      lain.description = { ...lain.description, identifier: `geometry.${MOD}.${addon.prefix}_lying_${String(id).replace(/^geometry\./, '').replace(/[^a-z0-9]+/gi, '_')}` };
      for (const bone of lain.bones) if (!bone.parent) bone.parent = 'mp_lie';
      lain.bones.unshift({ name: 'mp_lie', pivot: [0, 0, 0] });
      writeJson(join(ORP, 'models/entity', DIR, `${lain.description.identifier.replace(/^geometry\./, '')}.geo.json`), { format_version: '1.16.0', 'minecraft:geometry': [lain] });
      d.geometry[key] = lain.description.identifier;
    }
    toFormat110(doc);
    d.animations = { ...(d.animations ?? {}), mp_lie: LIE };
    d.scripts = { ...(d.scripts ?? {}), animate: [...(d.scripts?.animate ?? []), 'mp_lie'] };
    writeJson(join(ORP, path), doc);
  }
  writeJson(join(ORP, 'animations', DIR, 'lie.animation.json'), { format_version: '1.8.0', animations: { [LIE]: { loop: true, bones: { mp_lie: { rotation: [-90, 0, 0], position: [0, 3, 0] } } } } });
}
writeJson(join(ORP, 'render_controllers', `${DIR}.render_controllers.json`), { format_version: '1.8.0', render_controllers: renderControllers });
writeJson(join(ORP, 'animation_controllers', `${DIR}.animation_controllers.json`), { format_version: '1.10.0', animation_controllers: animationControllers });
writeJson(join(ORP, 'animations', DIR, 'walk_jiggle.animation.json'), { format_version: '1.8.0', animations: { [JIGGLE]: walkJiggleAnimation({ chest: ['mp_bust'], belly: ['belly'], buttRoot: ['mp_hips'] }) } });

// ---- its HUD and ours (hud): both add to the root panel, where the top pack's additions replace the
// others', so its packs (on top) carry both
if (addon.hud) {
  const theirsHud = packs.resource.files['ui/hud_screen.json'];
  const oursHud = join(RP, 'ui/hud_screen.json');
  if (theirsHud && existsSync(oursHud)) {
    const a = parse(readFileSync(oursHud, 'utf8'));
    const b = parse(strFromU8(theirsHud));
    const merged = { ...b, ...a, root_panel: { ...b.root_panel, ...a.root_panel, modifications: [...(b.root_panel?.modifications ?? []), ...(a.root_panel?.modifications ?? [])] } };
    writeJson(join(ORP, 'ui/hud_screen.json'), merged);
  }
}

// ---- the packs' manifests ----------------------------------------------------------------------------------
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version.split('.').map(Number);
const ours = { bp: JSON.parse(readFileSync(join(BP, 'manifest.json'), 'utf8')).header, rp: JSON.parse(readFileSync(join(RP, 'manifest.json'), 'utf8')).header };
const { name, description } = addon;
// a merged add-on: its own files under ours (its manifests, ours instead), on its own engine version
// (its files were written for it)
if (addon.merge) {
  for (const [kind, out] of /** @type {const} */ ([['behavior', OBP], ['resource', ORP]])) {
    for (const [path, data] of Object.entries(packs[kind].files)) {
      if (path === 'manifest.json' || existsSync(join(out, path))) continue;
      // (apart from the vanilla mobs: its client entities of vanilla ones are left out; the player's
      // is ours, with her belly. Its player behaviour stays: its scenes run through it)
      if (addon.separate && kind === 'resource' && path.startsWith('entity/') && /"identifier"\s*:\s*"minecraft:/.test(strFromU8(data))) continue;
      writeBytes(join(out, path), data);
    }
  }
}
const engine = addon.merge ? packs.behavior.manifest.header.min_engine_version : ours.bp.min_engine_version;
// her own mobs' finishing (separate): the vanilla mob's built-in behaviour, a spawn rule, a spawn egg,
// a name ("Zombie Girl")
if (addon.separate) {
  /** Where each spawns: [biome tags, monster (dark) or animal (daylight), weight]; none: not on its own (summoned, like the vex). */
  const WHERE = /** @type {Record<string, [string[], 'monster' | 'animal', number] | undefined>} */ ({
    zombie: [['monster'], 'monster', 15], skeleton: [['monster'], 'monster', 15], spider: [['monster'], 'monster', 12], creeper: [['monster'], 'monster', 12],
    enderman: [['monster', 'the_end'], 'monster', 6], witch: [['monster'], 'monster', 4], husk: [['desert'], 'monster', 15], stray: [['frozen'], 'monster', 15],
    drowned: [['ocean', 'river'], 'monster', 10], cave_spider: [['monster'], 'monster', 4], slime: [['swamp'], 'monster', 6],
    pillager: [['taiga', 'roofed'], 'monster', 4], vindicator: [['roofed', 'taiga'], 'monster', 3], evocation_illager: [['roofed'], 'monster', 2],
    blaze: [['nether'], 'monster', 8], piglin: [['nether'], 'monster', 10], piglin_brute: [['nether'], 'monster', 3], wither_skeleton: [['nether'], 'monster', 6],
    cow: [['animal'], 'animal', 8], pig: [['animal'], 'animal', 8], sheep: [['animal'], 'animal', 8], chicken: [['animal'], 'animal', 8],
    horse: [['plains', 'savanna'], 'animal', 6], fox: [['taiga'], 'animal', 8], wolf: [['forest', 'taiga'], 'animal', 6], bee: [['flower_forest', 'plains'], 'animal', 4],
    villager_v2: [['plains', 'desert', 'savanna', 'taiga'], 'animal', 4], wandering_trader: [['plains', 'savanna'], 'animal', 2],
    iron_golem: [['plains'], 'animal', 2], snow_golem: [['frozen'], 'animal', 2],
  });
  const title = (/** @type {string} */ n) => n.replace(/_v2$/, '').replace('evocation_illager', 'evoker').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const lang = [`## ${addon.title}'s girls, their own mobs (tools/compat-addons.mjs)`];
  for (const file of walk(join(OBP, 'entities')).filter((f) => f.endsWith('.json'))) {
    const doc = parse(readFileSync(join(OBP, 'entities', file), 'utf8'));
    const e = doc['minecraft:entity'];
    const vanilla = [...renamed].find(([, own]) => own === e?.description?.identifier)?.[0];
    if (!vanilla) continue;
    if (!e.description.runtime_identifier) {
      e.description.runtime_identifier = vanilla;
      writeBytes(join(OBP, 'entities', file), new TextEncoder().encode(stringifyEntity(doc)));
    }
    const name = vanilla.slice(10);
    lang.push(`entity.${e.description.identifier}.name=${title(name)} Girl`, `item.spawn_egg.entity.${e.description.identifier}.name=${title(name)} Girl Spawn Egg`);
    const where = WHERE[name];
    const hasRule = walk(join(OBP, 'spawn_rules')).some((f) => readFileSync(join(OBP, 'spawn_rules', f), 'utf8').includes(`"${e.description.identifier}"`));
    if (!where || hasRule) continue;
    const [biomes, kind, weight] = where;
    writeJson(join(OBP, 'spawn_rules', DIR, `${name}.json`), {
      format_version: '1.8.0',
      'minecraft:spawn_rules': {
        description: { identifier: e.description.identifier, population_control: kind },
        conditions: [{
          ...(name === 'drowned' ? { 'minecraft:spawns_underwater': {} } : { 'minecraft:spawns_on_surface': {} }),
          ...(kind === 'monster' && name !== 'drowned' ? { 'minecraft:spawns_underground': {} } : {}),
          'minecraft:brightness_filter': kind === 'monster' && !biomes.includes('nether') ? { min: 0, max: 7, adjust_for_weather: true } : { min: 0, max: 15, adjust_for_weather: false },
          ...(kind === 'monster' ? { 'minecraft:difficulty_filter': { min: 'easy', max: 'hard' } } : {}),
          'minecraft:weight': { default: weight },
          'minecraft:herd': { min_size: 1, max_size: 2 },
          'minecraft:biome_filter': { any_of: biomes.map((b) => ({ test: 'has_biome_tag', value: b })) },
        }],
      },
    });
  }
  // a spawn egg for each, where its client entity has none
  for (const file of walk(join(ORP, 'entity')).filter((f) => f.endsWith('.json'))) {
    const doc = parse(readFileSync(join(ORP, 'entity', file), 'utf8'));
    const d = doc['minecraft:client_entity']?.description;
    if (!d || !/^[a-z_]+:/.test(d.identifier) || !d.identifier.startsWith(`${addon.separate}:`) || d.spawn_egg) continue;
    d.spawn_egg = { base_color: '#f2b8c6', overlay_color: '#7a3b52' };
    writeJson(join(ORP, 'entity', file), doc);
  }
  const langFile = join(ORP, 'texts/en_US.lang');
  writeBytes(langFile, new TextEncoder().encode((existsSync(langFile) ? readFileSync(langFile, 'utf8').replace(/\n*$/, '\n') : '') + lang.join('\n') + '\n'));
}
writeJson(join(OBP, 'manifest.json'), {
  format_version: 2,
  header: { name, description, uuid: IDS.bp, version, min_engine_version: engine },
  modules: [{ type: 'data', uuid: IDS.bpData, version }],
  // (only its own resource pack: one on Minepreggo's or the add-on's exact versions is refused as a
  // missing dependency whenever the player has another; the description says what it needs)
  dependencies: [{ uuid: IDS.rp, version }],
});
writeJson(join(ORP, 'manifest.json'), {
  format_version: 2,
  header: { name, description, uuid: IDS.rp, version, min_engine_version: engine },
  modules: [{ type: 'resources', uuid: IDS.rpResources, version }],
});
for (const [file, out] of [['pack_icon.png', OBP], ['pack_icon.png', ORP]]) if (existsSync(join(BP, file))) writeBytes(join(out, file), new Uint8Array(readFileSync(join(BP, file))));
const usable = [...made.values()].filter(Boolean);
console.log(`${addon.title} compatibility: ${scenes ? `${scenes} scenes leading to pregnancy, ` : ''}${peoples} ${addon.build ? 'peoples' : 'mobs'} with women, on ${usable.length} rigs (${usable.filter((w) => w?.poses.length).length} with poses, ${poseCount} poses), ${bellySkins.size} belly skin tones`);
