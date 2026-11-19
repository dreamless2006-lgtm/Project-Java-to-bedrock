// Merges the World Alliance add-on (vendor/worldalliance/*.mcaddon: WorldBox's creatures, kingdoms
// and god powers, MIT per its manifest) into this pack's behavior and resource packs at import time,
// like the Jenny, goblins and MCA imports: nothing of it is committed, and a build without it simply
// has no World Alliance. Its own namespace (worldbox:) keeps it clear of ours.
//
// Files the game finds by identifier (entities, items, blocks, recipes, client entities, models,
// animations, controllers, attachables, particles) go into worldalliance_port/ sub-folders; files
// it finds by path (textures, loot tables, structures, functions) keep their paths, all of which sit
// under worldbox/ folders or carry worldbox names. The few files the game reads once per pack
// (item_texture.json, terrain_texture.json, blocks.json, the entity materials) are written as
// worldalliance_port overlays that tools/build.mjs merges into ours; its translations join our
// .lang files under a header. Its scripts load from scripts/worldalliance_port/ (main.js imports them).
//
// Run: node tools/import-worldalliance.mjs (part of npm run import).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const VENDOR = join(ROOT, 'vendor/worldalliance');
const PORT = 'worldalliance_port';
const LANG_HEADER = '## World Alliance (vendor/worldalliance, tools/import-worldalliance.mjs)';
/** The longest path inside a pack the consoles accept. */
const MAX_PATH = 100;

/** Folders whose files the game finds by identifier: they move under worldalliance_port/. */
const BY_ID = {
  behavior: ['entities', 'items', 'blocks', 'recipes'],
  resource: ['entity', 'models', 'animations', 'animation_controllers', 'render_controllers', 'attachables', 'particles'],
};
/** Folders whose files the game finds by path: they keep it. */
const BY_PATH = {
  behavior: ['loot_tables', 'structures', 'functions'],
  resource: ['textures'],
};
/** Files the game reads once per pack: written as overlays for tools/build.mjs. */
const OVERLAYS = {
  'textures/item_texture.json': `textures/${PORT}/item_texture.json`,
  'textures/terrain_texture.json': `textures/${PORT}/terrain_texture.json`,
  'blocks.json': `${PORT}/blocks.json`,
  'materials/entity.material': `${PORT}/entity.material`,
};
/** Its translations that are its own pack's name and description. */
const OWN_KEYS = /^pack\.(name|description)=/;
/** Leftovers of its build tools inside its scripts folder. */
const BUILD_LEFTOVERS = /\.(log|done)$/;

const write = (/** @type {string} */ file, /** @type {Uint8Array | string} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

/** Every file below a folder (relative paths). */
function walk(/** @type {string} */ dir, prefix = '') {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

/**
 * The two packs of the add-on (an .mcaddon of folders, or of .mcpack archives), each as a map of
 * its own relative paths to bytes, told apart by their manifest's module type.
 * @param {Record<string, Uint8Array>} zip
 */
function packsOf(zip) {
  /** @type {Record<string, Record<string, Uint8Array>>} */
  const packs = {};
  const nested = Object.entries(zip).filter(([name]) => name.endsWith('.mcpack'));
  const sources = nested.length ? nested.map(([, data]) => unzipSync(data)) : [zip];
  for (const files of sources) {
    for (const [name, data] of Object.entries(files)) {
      if (!name.endsWith('manifest.json')) continue;
      const root = name.slice(0, -'manifest.json'.length);
      const manifest = JSON.parse(strFromU8(data));
      const kind = manifest.modules?.some((/** @type {any} */ m) => m.type === 'resources') ? 'resource' : manifest.modules?.some((/** @type {any} */ m) => m.type === 'data' || m.type === 'script') ? 'behavior' : undefined;
      if (!kind) continue;
      packs[kind] = Object.fromEntries(Object.entries(files).filter(([n]) => n.startsWith(root) && !n.endsWith('/')).map(([n, d]) => [n.slice(root.length), d]));
    }
  }
  return packs;
}

/** Where a file of the add-on goes in our pack, or undefined when it is not taken. */
function destination(/** @type {'behavior' | 'resource'} */ kind, /** @type {string} */ path) {
  if (path in OVERLAYS && kind === 'resource') return OVERLAYS[/** @type {keyof typeof OVERLAYS} */ (path)];
  const [top, ...rest] = path.split('/');
  if (kind === 'behavior' && top === 'scripts') return BUILD_LEFTOVERS.test(path) ? undefined : `scripts/${PORT}/${rest.join('/')}`;
  if (BY_ID[kind].includes(top)) return `${top}/${PORT}/${rest.join('/')}`;
  if (BY_PATH[kind].includes(top)) return path;
  return undefined;
}

// ---- clean the previous import --------------------------------------------------------------------
// Its path-found files keep their paths, so no folder of ours holds them all: the last import left a
// list of them (a newer add-on may no longer have some).
const listFile = join(BP, PORT, 'files.json');
if (existsSync(listFile)) for (const path of JSON.parse(readFileSync(listFile, 'utf8'))) rmSync(join(ROOT, path), { force: true });
for (const [kind, base] of /** @type {const} */ ([['behavior', BP], ['resource', RP]])) {
  for (const top of BY_ID[kind]) rmSync(join(base, top, PORT), { recursive: true, force: true });
  rmSync(join(base, PORT), { recursive: true, force: true });
}
rmSync(join(BP, 'scripts', PORT), { recursive: true, force: true });
rmSync(join(RP, 'textures', PORT), { recursive: true, force: true });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at >= 0) writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n'));
}

const archive = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => f.endsWith('.mcaddon')) : undefined;
if (!archive) {
  console.warn('warning: no World Alliance .mcaddon in vendor/worldalliance/; it is not imported');
  process.exit(0);
}
const packs = packsOf(unzipSync(new Uint8Array(readFileSync(join(VENDOR, archive)))));
if (!packs.behavior || !packs.resource) throw new Error(`${archive}: expected a behavior and a resource pack`);

/** @type {string[]} the path-found files written, for the next import's cleanup */
const written = [];
const counts = { behavior: 0, resource: 0, scripts: 0, skipped: 0 };
/** @type {string[]} */
const tooLong = [];
for (const kind of /** @type {const} */ (['behavior', 'resource'])) {
  const base = kind === 'behavior' ? BP : RP;
  for (const [path, data] of Object.entries(packs[kind])) {
    const to = destination(kind, path);
    if (!to) {
      counts.skipped++;
      continue;
    }
    if (to.length > MAX_PATH) tooLong.push(to);
    write(join(base, to), data);
    if (to === path) written.push(`packs/${kind}/${to}`);
    if (to.startsWith('scripts/')) counts.scripts++;
    else counts[kind]++;
  }
}
write(listFile, JSON.stringify(written.sort(), null, 2) + '\n');
if (tooLong.length) console.warn(`warning: ${tooLong.length} World Alliance paths are over ${MAX_PATH} characters (consoles refuse them), e.g. ${tooLong[0]}`);

// ---- its animations' sounds: a sound an animation plays must be named in the entity's sound_effects, or
// the game logs it every time. A name another of its entities maps gets that sound; one none maps can
// never play, so it leaves the animation.
{
  const entityDir = join(RP, 'entity', PORT);
  const animationDir = join(RP, 'animations', PORT);
  const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const entities = walk(entityDir).filter((f) => f.endsWith('.json')).map((f) => ({ file: join(entityDir, f), doc: read(join(entityDir, f)) }));
  const animationFiles = walk(animationDir).filter((f) => f.endsWith('.json')).map((f) => ({ file: join(animationDir, f), doc: read(join(animationDir, f)) }));
  /** @type {Map<string, any>} animation id -> its definition */
  const animations = new Map(animationFiles.flatMap(({ doc }) => Object.entries(doc.animations ?? {})));
  /** @type {Map<string, unknown>} sound name -> the effect some entity maps it to */
  const known = new Map();
  for (const { doc } of entities) for (const [name, effect] of Object.entries(doc['minecraft:client_entity']?.description?.sound_effects ?? {})) if (!known.has(name)) known.set(name, effect);
  const soundsOf = (/** @type {any} */ animation) => Object.values(animation?.sound_effects ?? {}).flatMap((k) => (Array.isArray(k) ? k : [k])).map((k) => k?.effect).filter(Boolean);
  let mapped = 0;
  for (const { file, doc } of entities) {
    const d = doc['minecraft:client_entity']?.description;
    if (!d) continue;
    const played = new Set(Object.values(d.animations ?? {}).flatMap((id) => soundsOf(animations.get(/** @type {string} */ (id)))));
    const missing = [...played].filter((name) => !(name in (d.sound_effects ?? {})) && known.has(name));
    if (!missing.length) continue;
    d.sound_effects = { ...(d.sound_effects ?? {}), ...Object.fromEntries(missing.map((name) => [name, known.get(name)])) };
    mapped += missing.length;
    writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  let dropped = 0;
  for (const { file, doc } of animationFiles) {
    let changed = false;
    for (const animation of Object.values(doc.animations ?? {})) {
      if (!animation.sound_effects) continue;
      for (const [time, keys] of Object.entries(animation.sound_effects)) {
        const kept = (Array.isArray(keys) ? keys : [keys]).filter((k) => known.has(k?.effect));
        if (kept.length === (Array.isArray(keys) ? keys.length : 1)) continue;
        changed = true;
        dropped++;
        if (kept.length) animation.sound_effects[time] = Array.isArray(keys) ? kept : kept[0];
        else delete animation.sound_effects[time];
      }
      if (!Object.keys(animation.sound_effects).length) delete animation.sound_effects;
    }
    if (changed) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  if (mapped || dropped) console.log(`World Alliance sounds: ${mapped} mapped from its other entities, ${dropped} keyframes of sounds none of them has dropped`);
}

// ---- translations: its own lines (not its pack's name and description) after ours -------------------
const lang = strFromU8(packs.resource['texts/en_US.lang'] ?? new Uint8Array()).split(/\r?\n/).filter((line) => line.trim() && !OWN_KEYS.test(line));
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + [LANG_HEADER, ...lang].join('\n') + '\n');
}

console.log(`World Alliance: ${counts.behavior} behavior and ${counts.resource} resource files, ${counts.scripts} scripts, ${lang.length} translations (${counts.skipped} of its pack files not needed)`);
