// Static checks for the packs, since most mistakes in Bedrock JSON only show up as
// content-log errors in game:
//   * manifests, items, blocks and trade tables against Mojang's official schemas
//   * cross references: icons/textures, sounds, loot tables, geometry, lang keys (including
//     those used by scripts), recipe and loot ingredients, and script-registered custom components
// Texture and lang checks are skipped (with a notice) until `npm run import` has run.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { MinecraftBlockTypes, MinecraftEffectTypes, MinecraftItemTypes } from '@minecraft/vanilla-data';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const SCHEMAS = join(ROOT, 'tools/bedrock-schemas');
const NS = 'minepreggo';

const errors = [];
const fail = (file, msg) => errors.push(`${relative(ROOT, file).split(sep).join('/')}: ${msg}`);

function* walk(dir, ext) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path, ext);
    else if (path.endsWith(ext)) yield path;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(file, `invalid JSON (${e.message})`);
    return undefined;
  }
}

// --- schemas ---------------------------------------------------------------------------
// Mojang's patterns are ECMAScript regexes that are invalid under the 'u' flag (e.g. \-).
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
for (const file of walk(SCHEMAS, '.json')) ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')));
const schema = (id) => {
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`schema ${id} missing from tools/bedrock-schemas`);
  return validate;
};
const SCHEMA = {
  manifest: schema('/client_server/packaging/3.0.0/Manifest.json'),
  item: schema('/server/item/1.26.30/ItemDocument.json'),
  block: schema('/server/block/1.26.20/Blocks.json'),
  trades: schema('/client_server/entity/1.21.30/Trade%20Table.json'),
};

// Mojang's component schemas accept unknown keys, so typos like "minecraft:fod" would pass silently.
const knownComponents = (id) => new Set(Object.keys(/** @type {any} */ (ajv.getSchema(id)?.schema)?.properties ?? {}));
const ITEM_COMPONENTS = knownComponents('/server/item/1.26.30/Item%20Components.json');
const BLOCK_COMPONENTS = knownComponents('/server/block/1.26.20/Components.json');

function check(validate, data, file, what) {
  if (validate(data)) return;
  for (const e of validate.errors ?? []) fail(file, `${what}${e.instancePath} ${e.message}`);
}

// --- load everything --------------------------------------------------------------------
const itemTextures = readJson(join(RP, 'textures/item_texture.json'))?.texture_data ?? {};
const terrainTextures = readJson(join(RP, 'textures/terrain_texture.json'))?.texture_data ?? {};
const imported = existsSync(join(RP, 'textures', NS));
const langFile = join(RP, 'texts/en_US.lang');
const langKeys = existsSync(langFile)
  ? new Set(readFileSync(langFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('##')).map((l) => l.split('=')[0]))
  : undefined;

const geometries = new Set(['minecraft:geometry.full_block', 'minecraft:geometry.cross']);
for (const file of walk(join(RP, 'models'), '.json')) {
  for (const geo of readJson(file)?.['minecraft:geometry'] ?? []) geometries.add(geo.description?.identifier);
}

const scriptSource = [...walk(join(BP, 'scripts'), '.js')].map((f) => readFileSync(f, 'utf8')).join('\n');
const customComponents = new Set([...scriptSource.matchAll(/registerCustomComponent\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));

const defined = new Set();
const items = [...walk(join(BP, 'items'), '.json')].map((f) => [f, readJson(f)]);
const blocks = [...walk(join(BP, 'blocks'), '.json')].map((f) => [f, readJson(f)]);
for (const [, doc] of items) defined.add(doc?.['minecraft:item']?.description?.identifier);
for (const [, doc] of blocks) defined.add(doc?.['minecraft:block']?.description?.identifier);

function checkTexture(file, map, key, kind) {
  const entry = map[key];
  if (!entry) return fail(file, `${kind} texture key "${key}" is not defined`);
  const paths = [entry.textures].flat().map((t) => (typeof t === 'string' ? t : t.path));
  if (!imported) return;
  for (const path of paths) if (!existsSync(join(RP, `${path}.png`))) fail(file, `texture ${path}.png does not exist`);
}

// Keys from the game's own language files that the port reuses.
const VANILLA_LANG_KEYS = new Set(['key.sneak']);

function checkLangKey(file, key) {
  if (langKeys && !langKeys.has(key) && !VANILLA_LANG_KEYS.has(key)) fail(file, `lang key "${key}" is missing from en_US.lang`);
}

function checkComponentNames(file, components, known) {
  for (const name of Object.keys(components ?? {})) {
    if (name.startsWith('minecraft:')) {
      if (!known.has(name)) fail(file, `unknown component "${name}"`);
    } else if (!customComponents.has(name)) {
      fail(file, `custom component "${name}" is never registered by a script`);
    }
  }
}

const VANILLA_IDS = new Set([...Object.values(MinecraftItemTypes), ...Object.values(MinecraftBlockTypes)]);

// Vanilla ids are only checked in files we write ourselves: Mojang's own trade tables still use
// legacy aliases such as "minecraft:muttonraw" that the game accepts but vanilla-data omits.
function checkItemRef(file, id, { vanilla = true } = {}) {
  const name = id.replace(/:\d+$/, '');
  if (name.startsWith(`${NS}:`) && !defined.has(name)) fail(file, `references undefined ${name}`);
  if (vanilla && name.startsWith('minecraft:') && !VANILLA_IDS.has(name)) fail(file, `unknown vanilla id ${name}`);
}

// --- manifests ---------------------------------------------------------------------------
for (const pack of [BP, RP]) {
  const file = join(pack, 'manifest.json');
  check(SCHEMA.manifest, readJson(file), file, 'manifest');
}

// --- items -------------------------------------------------------------------------------
for (const [file, doc] of items) {
  const item = doc?.['minecraft:item'];
  if (!item) { fail(file, 'missing "minecraft:item"'); continue; }
  check(SCHEMA.item, item, file, 'item');
  const c = item.components ?? {};
  const icon = c['minecraft:icon'];
  const iconKey = typeof icon === 'string' ? icon : icon?.textures?.default;
  if (iconKey) checkTexture(file, itemTextures, iconKey, 'item');
  else if (!c['minecraft:block_placer']) fail(file, 'has no icon');
  if (c['minecraft:display_name']) checkLangKey(file, c['minecraft:display_name'].value);
  if (c['minecraft:food'] && !c['minecraft:use_modifiers']) fail(file, 'food without minecraft:use_modifiers cannot be eaten');
  const placer = c['minecraft:block_placer'];
  if (placer) {
    checkItemRef(file, typeof placer.block === 'string' ? placer.block : placer.block.name);
    for (const target of placer.use_on ?? []) checkItemRef(file, typeof target === 'string' ? target : target.name);
  }
  checkComponentNames(file, c, ITEM_COMPONENTS);
  for (const { effect } of c['minepreggo:food_effects']?.effects ?? []) {
    if (!Object.values(MinecraftEffectTypes).includes(effect)) fail(file, `unknown effect ${effect}`);
  }
}

// --- blocks ------------------------------------------------------------------------------
for (const [file, doc] of blocks) {
  const block = doc?.['minecraft:block'];
  if (!block) { fail(file, 'missing "minecraft:block"'); continue; }
  check(SCHEMA.block, block, file, 'block');
  for (const components of [block.components, ...(block.permutations ?? []).map((p) => p.components)]) {
    if (!components) continue;
    const geometry = components['minecraft:geometry'];
    const geoId = typeof geometry === 'string' ? geometry : geometry?.identifier;
    if (geoId && !geometries.has(geoId)) fail(file, `geometry "${geoId}" not found in packs/resource/models`);
    for (const material of Object.values(components['minecraft:material_instances'] ?? {})) {
      if (typeof material === 'object' && material.texture) checkTexture(file, terrainTextures, material.texture, 'terrain');
    }
    const loot = components['minecraft:loot'];
    if (loot && !existsSync(join(BP, loot))) fail(file, `loot table ${loot} does not exist`);
    if (components['minecraft:display_name']) checkLangKey(file, components['minecraft:display_name']);
    for (const condition of components['minecraft:placement_filter']?.conditions ?? []) {
      for (const target of condition.block_filter ?? []) checkItemRef(file, typeof target === 'string' ? target : target.name);
    }
    checkComponentNames(file, components, BLOCK_COMPONENTS);
  }
}

// --- recipes -----------------------------------------------------------------------------
for (const file of walk(join(BP, 'recipes'), '.json')) {
  const doc = readJson(file);
  if (!doc) continue;
  const [type, recipe] = Object.entries(doc).find(([k]) => k.startsWith('minecraft:recipe_')) ?? [];
  if (!recipe) { fail(file, 'no minecraft:recipe_* object'); continue; }
  if (!recipe.description?.identifier?.startsWith(`${NS}:`)) fail(file, 'recipe identifier must use the minepreggo namespace');
  const refs = [];
  const add = (x) => x && refs.push(typeof x === 'string' ? x : x.item);
  if (type === 'minecraft:recipe_shaped') {
    const keys = new Set(Object.keys(recipe.key ?? {}));
    for (const row of recipe.pattern ?? []) for (const ch of row) if (ch !== ' ' && !keys.has(ch)) fail(file, `pattern uses undefined key "${ch}"`);
    Object.values(recipe.key ?? {}).forEach(add);
  }
  [recipe.ingredients ?? []].flat().forEach(add);
  [recipe.result, recipe.input, recipe.output].flat().forEach(add);
  refs.filter(Boolean).forEach((r) => checkItemRef(file, r));
}

// --- loot tables -------------------------------------------------------------------------
for (const file of walk(join(BP, 'loot_tables'), '.json')) {
  for (const pool of readJson(file)?.pools ?? []) {
    for (const entry of pool.entries ?? []) if (entry.type === 'item') checkItemRef(file, entry.name);
  }
}

// --- trades ------------------------------------------------------------------------------
for (const file of walk(join(BP, 'trading'), '.json')) {
  const doc = readJson(file);
  check(SCHEMA.trades, doc?.tiers, file, 'trades');
  const stack = [doc];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === 'object') {
      if (typeof node.item === 'string') checkItemRef(file, node.item, { vanilla: false });
      stack.push(...Object.values(node));
    }
  }
}

// --- sounds and script references ------------------------------------------------------------
const soundFile = join(RP, 'sounds/sound_definitions.json');
const soundDefs = existsSync(soundFile) ? readJson(soundFile)?.sound_definitions ?? {} : {};
for (const [event, def] of Object.entries(soundDefs)) {
  for (const sound of def.sounds ?? []) {
    const path = typeof sound === 'string' ? sound : sound.name;
    if (imported && !existsSync(join(RP, `${path}.ogg`))) fail(soundFile, `${event}: ${path}.ogg does not exist`);
  }
}
for (const file of walk(join(BP, 'scripts'), '.js')) {
  const source = readFileSync(file, 'utf8');
  for (const [, sound] of source.matchAll(/playSound\([^,]+,\s*'(minepreggo\.[^']+)'/g)) {
    if (!soundDefs[sound]) fail(file, `sound "${sound}" is not in sound_definitions.json`);
  }
  for (const [, key] of source.matchAll(/(?:translate:\s*|message\([^,]+,\s*|actionbar\([^,]+,\s*)'([^'$]+)'/g)) {
    checkLangKey(file, key);
  }
}

if (!imported || !langKeys) console.warn('note: texture and lang checks skipped - run `npm run import` to enable them');
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) found`);
  process.exit(1);
}
console.log(`OK: ${items.length} items, ${blocks.length} blocks validated`);
