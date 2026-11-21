// Packages packs/behavior and packs/resource into dist/minepreggo-<version>.mcaddon (and each
// compatibility add-on built, into dist/minepreggo-<add-on>-<version>.mcaddon).
// Run `npm run import` first: the resource pack is unusable without the jar's assets.
// Of the imported textures, sounds and models, only those referenced from a resource pack JSON file
// are shipped, so each release carries just the assets of features that have actually been ported.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, zipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = [
  { dir: 'packs/behavior', name: 'Minepreggo_BP' },
  { dir: 'packs/resource', name: 'Minepreggo_RP' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (!existsSync(join(ROOT, 'packs/resource/textures/minepreggo'))) {
  console.error('Imported assets are missing - run `npm run import` first.');
  process.exit(1);
}

// Converted models and animations are referenced by identifier rather than by path.
const DEFINITIONS = ['models/entity/minepreggo/', 'animations/minepreggo/'];
const IMPORTED = ['textures/minepreggo/', 'sounds/minepreggo/', ...DEFINITIONS];
const isImported = (path) => IMPORTED.some((prefix) => path.startsWith(prefix));
const isDefinitions = (path) => DEFINITIONS.some((prefix) => path.startsWith(prefix));

/** The geometry or animation identifiers a converted file defines. */
function definedIds(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return [...(json['minecraft:geometry'] ?? []).map((g) => g.description.identifier), ...Object.keys(json.animations ?? {})];
}

/**
 * Every "textures/minepreggo/..." or "sounds/minepreggo/..." path and "geometry.minepreggo...." or
 * "animation.minepreggo...." identifier used by the resource pack's own JSON files (the converted
 * files are not searched, so they don't count as referencing themselves).
 */
function referencedAssets(rpDir) {
  const refs = new Set();
  const visit = (node) => {
    if (typeof node === 'string') {
      if (isImported(node) || /^(geometry|animation)\.minepreggo\./.test(node)) refs.add(node);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  for (const file of walk(rpDir)) {
    const inner = relative(rpDir, file).split(sep).join('/');
    if (file.endsWith('.json') && !isDefinitions(inner)) visit(JSON.parse(readFileSync(file, 'utf8')));
  }
  // Blocks name their geometry from the behavior pack.
  for (const file of walk(join(ROOT, 'packs/behavior/blocks'))) if (file.endsWith('.json')) visit(JSON.parse(readFileSync(file, 'utf8')));
  return refs;
}

/** Whether an imported file is used: textures and sounds by path, models and animations by identifier. */
function isUsed(inner, file, used) {
  if (isDefinitions(inner)) return definedIds(file).some((id) => used.has(id));
  return used.has(inner.replace(/\.(png|tga|ogg|wav)$/, ''));
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const pack of PACKS) {
  const manifest = JSON.parse(readFileSync(join(ROOT, pack.dir, 'manifest.json'), 'utf8'));
  if (JSON.stringify(manifest.header.version) !== JSON.stringify(version.split('.').map(Number))) {
    console.error(`${pack.dir}/manifest.json is version ${JSON.stringify(manifest.header.version)}, package.json ${version} - run \`npm run check\`.`);
    process.exit(1);
  }
}
const used = referencedAssets(join(ROOT, 'packs/resource'));
const entries = {};
for (const pack of PACKS) {
  const base = join(ROOT, pack.dir);
  for (const file of walk(base)) {
    const inner = relative(base, file).split(sep).join('/');
    if (isImported(inner) && !isUsed(inner, file, used)) continue;
    entries[`${pack.name}/${inner}`] = new Uint8Array(readFileSync(file));
  }
}

// The imported Jenny Mod Java Port's definitions merge into our files the game reads once per pack
// (tools/import-jenny.mjs writes them as "jenny_port" overlays, which are not shipped themselves).
const OVERLAYS = [
  ['Minepreggo_RP/sounds/sound_definitions.json', 'Minepreggo_RP/sounds/jenny_port/sound_definitions.json', (/** @type {any} */ base, /** @type {any} */ add) => Object.assign(base.sound_definitions, add.sound_definitions ?? {})],
  ['Minepreggo_RP/sounds.json', 'Minepreggo_RP/jenny_port/sounds.json', (/** @type {any} */ base, /** @type {any} */ add) => {
    Object.assign(((base.entity_sounds ??= {}).entities ??= {}), add.entity_sounds?.entities ?? {});
    if (add.individual_event_sounds?.events) Object.assign(((base.individual_event_sounds ??= {}).events ??= {}), add.individual_event_sounds.events);
  }],
  ['Minepreggo_RP/textures/item_texture.json', 'Minepreggo_RP/textures/jenny_port/item_texture.json', (/** @type {any} */ base, /** @type {any} */ add) => Object.assign(base.texture_data, add.texture_data ?? {})],
];
for (const [target, overlay, merge] of OVERLAYS) {
  if (!entries[overlay]) continue;
  // (a file of ours the overlay adds to may not exist: the overlay is then the file)
  if (!entries[target]) {
    entries[target] = entries[overlay];
    delete entries[overlay];
    continue;
  }
  const base = JSON.parse(strFromU8(entries[target]));
  merge(base, JSON.parse(strFromU8(entries[overlay])));
  entries[target] = strToU8(JSON.stringify(base, null, 2) + '\n');
  delete entries[overlay];
}

// Add-ons merged into Minepreggo itself (tools/compat-addons.mjs builds each, with its pregnancy files
// over its own): Girl Mob. Their files join our packs; the few both have are combined (sounds,
// translations, texture lists, materials), ours winning anything else.
const MERGED = ['girlmob'];
/** JSON as add-ons write it (comments, trailing commas), which the game reads. */
function lenient(/** @type {string} */ text) {
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
      } else if (c === '/' && clean[i + 1] === '*') i = clean.indexOf('*/', i + 2) + 1 || clean.length;
      else out += c;
    }
    // (and a stray quote before a key's colon, as Girl Mob's sounds.json has: "name"," : {)
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1').replace(/"([^"\n]*)","\s*:/g, '"$1":'));
  }
}
/** @type {Record<string, (base: any, add: any) => void>} how a file both packs have is combined */
const COMBINE = {
  'sounds.json': (base, add) => {
    for (const key of ['entity_sounds', 'individual_event_sounds', 'block_sounds', 'interactive_sounds']) {
      if (!add[key]) continue;
      base[key] ??= {};
      for (const [k, v] of Object.entries(add[key])) base[key][k] = typeof v === 'object' && !Array.isArray(v) ? { ...(v ?? {}), ...(base[key][k] ?? {}) } : base[key][k] ?? v;
    }
  },
  'sounds/sound_definitions.json': (base, add) => { base.sound_definitions = { ...(add.sound_definitions ?? {}), ...(base.sound_definitions ?? {}) }; },
  'textures/item_texture.json': (base, add) => { base.texture_data = { ...(add.texture_data ?? {}), ...base.texture_data }; },
  'textures/terrain_texture.json': (base, add) => { base.texture_data = { ...(add.texture_data ?? {}), ...base.texture_data }; },
  'materials/entity.material': (base, add) => { base.materials = { ...(add.materials ?? {}), ...base.materials }; },
  'blocks.json': (base, add) => { for (const [k, v] of Object.entries(add)) base[k] ??= v; },
  'texts/languages.json': (base, add) => { for (const l of add) if (!base.includes(l)) base.push(l); },
  // (the HUD: the add-on's packs carry its additions and ours together, tools/compat-addons.mjs hud)
  'ui/hud_screen.json': (base, add) => { Object.assign(base, add); },
  'ui/_ui_defs.json': (base, add) => { base.ui_defs = [...new Set([...(base.ui_defs ?? []), ...(add.ui_defs ?? [])])]; },
};
for (const addon of MERGED) {
  for (const [dir, pack] of [['behavior', 'Minepreggo_BP'], ['resource', 'Minepreggo_RP']]) {
    const base = join(ROOT, 'compat', addon, dir);
    if (!existsSync(join(base, 'manifest.json'))) continue;
    for (const file of walk(base)) {
      const inner = relative(base, file).split(sep).join('/');
      if (inner === 'manifest.json' || inner === 'pack_icon.png') continue;
      const key = `${pack}/${inner}`;
      const data = new Uint8Array(readFileSync(file));
      if (!entries[key]) entries[key] = data;
      else if (/^texts\/.*\.lang$/.test(inner)) entries[key] = strToU8(strFromU8(entries[key]).replace(/\n*$/, '\n') + `## ${addon} (merged)\n` + strFromU8(data));
      else if (COMBINE[inner]) {
        try {
          const merged = lenient(strFromU8(entries[key]));
          COMBINE[inner](merged, lenient(strFromU8(data)));
          entries[key] = strToU8(JSON.stringify(merged, null, 2) + '\n');
        } catch (error) {
          console.warn(`warning: ${addon}'s ${inner} could not be read (${error}); ours is kept`);
        }
      }
    }
  }
  // its script, beside ours: one entry that runs ours, then its (a pack has one script entry)
  const theirs = join(ROOT, 'compat', addon, 'script.json');
  const entry = existsSync(theirs) ? JSON.parse(readFileSync(theirs, 'utf8')).entry : undefined;
  if (entry && entries[`Minepreggo_BP/${entry}`]) {
    const manifest = JSON.parse(strFromU8(entries['Minepreggo_BP/manifest.json']));
    const script = manifest.modules.find((/** @type {any} */ m) => m.type === 'script');
    const ours = script.entry.replace(/^scripts\//, '');
    if (!ours.startsWith('merged_')) {
      entries['Minepreggo_BP/scripts/merged_main.js'] = strToU8(`// Minepreggo's scripts, then the merged add-ons' (tools/build.mjs)\nimport './${ours}';\n`);
      script.entry = 'scripts/merged_main.js';
      entries['Minepreggo_BP/manifest.json'] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
    }
    entries['Minepreggo_BP/scripts/merged_main.js'] = strToU8(strFromU8(entries['Minepreggo_BP/scripts/merged_main.js']) + `import './${entry.replace(/^scripts\//, '')}';\n`);
  }
}

/**
 * An .mcaddon the way Minecraft imports it on every device: an .mcpack per pack (a zip with the
 * pack's manifest at its root and its folders listed), stored in the add-on's zip.
 * @param {Record<string, Uint8Array>} files 'Pack_Name/path/in/pack' -> its bytes
 */
function mcaddon(files) {
  /** @type {Record<string, Record<string, Uint8Array>>} */
  const packs = {};
  for (const [path, data] of Object.entries(files)) {
    const at = path.indexOf('/');
    (packs[path.slice(0, at)] ??= {})[path.slice(at + 1)] = data;
  }
  /** @type {Record<string, Uint8Array>} */
  const out = {};
  for (const [name, inner] of Object.entries(packs)) {
    /** @type {Record<string, Uint8Array>} */
    const listed = {};
    for (const path of Object.keys(inner).sort()) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) listed[`${parts.slice(0, i).join('/')}/`] ??= new Uint8Array(0);
      listed[path] = inner[path];
    }
    out[`${name}.mcpack`] = zipSync(listed, { level: 9 });
  }
  return zipSync(out, { level: 0 });
}

// The resource pack's JSON written compactly: the generated models and animations are most of its
// size pretty-printed (387 MB unpacked, which phones fail to import). Not the behavior pack: its actor
// files keep their float literals (tools/lib/entity-json.mjs). Files only the game's lenient parser
// reads (comments) stay as they are.
/** @param {Record<string, Uint8Array>} files */
function compactResources(files) {
  for (const [key, data] of Object.entries(files)) {
    if (!/_RP\/.*\.json$/.test(key) || /manifest\.json$/.test(key)) continue;
    try {
      files[key] = strToU8(JSON.stringify(JSON.parse(strFromU8(data).replace(/^\uFEFF/, ''))));
    } catch {
      // kept as written
    }
  }
}
compactResources(entries);

const out = join(ROOT, 'dist', `minepreggo-${version}.mcaddon`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, mcaddon(entries));
console.log(`Wrote ${relative(ROOT, out)} (${Object.keys(entries).length} files)`);

// Minepreggo's compatibility add-ons for other add-ons (tools/compat-addons.mjs), those built: each
// its own two packs, for players who have that add-on too, at this version (they need ours).
const COMPATS = join(ROOT, 'compat');
for (const addon of existsSync(COMPATS) ? readdirSync(COMPATS) : []) {
  if (MERGED.includes(addon)) continue;
  const COMPAT = join(COMPATS, addon);
  if (!existsSync(join(COMPAT, 'behavior/manifest.json'))) continue;
  const ours = Object.fromEntries(PACKS.map((pack) => [JSON.parse(readFileSync(join(ROOT, pack.dir, 'manifest.json'), 'utf8')).header.uuid, true]));
  const numbers = version.split('.').map(Number);
  const own = new Set(['behavior', 'resource'].map((dir) => JSON.parse(readFileSync(join(COMPAT, dir, 'manifest.json'), 'utf8')).header.uuid));
  /** @type {Record<string, Uint8Array>} */
  const compat = {};
  for (const [dir, kind] of [['behavior', 'BP'], ['resource', 'RP']]) {
    const base = join(COMPAT, dir);
    for (const file of walk(base)) {
      const inner = relative(base, file).split(sep).join('/');
      let data = new Uint8Array(readFileSync(file));
      if (inner === 'manifest.json') {
        const manifest = JSON.parse(strFromU8(data));
        manifest.header.version = numbers;
        for (const module of manifest.modules) module.version = numbers;
        for (const dependency of manifest.dependencies ?? []) if (ours[dependency.uuid] || own.has(dependency.uuid)) dependency.version = numbers;
        data = strToU8(JSON.stringify(manifest, null, 2) + '\n');
      }
      compat[`Minepreggo_${addon}_${kind}/${inner}`] = data;
    }
  }
  compactResources(compat);
  const compatOut = join(ROOT, 'dist', `minepreggo-${addon}-${version}.mcaddon`);
  writeFileSync(compatOut, mcaddon(compat));
  console.log(`Wrote ${relative(ROOT, compatOut)} (${Object.keys(compat).length} files)`);
}
