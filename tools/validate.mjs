// Static checks for the packs, since most mistakes in Bedrock JSON only show up as
// content-log errors in game:
//   * manifests, items, blocks, entities, spawn rules and trade tables against Mojang's official schemas
//   * cross references: icons/textures, sounds, loot tables, geometry, lang keys (including
//     those used by scripts), recipe and loot ingredients, script-registered custom components,
//     entity events/component groups/properties, and client entity animations, controllers and
//     the properties their Molang reads
// Texture and lang checks are skipped (with a notice) until `npm run import` has run.

import { integerFloatLiterals } from './lib/entity-json.mjs';
import { readEffects } from '../packs/behavior/scripts/items/food_effects_format.js';
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

// The Jenny Mod Java Port's files (merged by tools/import-jenny.mjs under jenny_port/ and ui/) are
// another add-on's, in its own formats: the game validates them, this does not.
const IMPORTED_DIRS = new Set(['jenny_port', 'ui']);
function* walk(dir, ext) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { if (!IMPORTED_DIRS.has(entry)) yield* walk(path, ext); }
    else if (path.endsWith(ext)) yield path;
  }
}

/** Every file, the merged Jenny port's included (but not its UI). */
function* walkAll(dir, ext) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { if (entry !== 'ui') yield* walkAll(path, ext); }
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
// Mojang's patterns are ECMAScript regexes that are invalid under the 'u' flag (e.g. \-), and many
// of their "oneOf"s have overlapping branches (a filter test matches two of them), so they are read
// as "anyOf".
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false });
for (const file of walk(SCHEMAS, '.json')) ajv.addSchema(JSON.parse(readFileSync(file, 'utf8').replaceAll('"oneOf"', '"anyOf"')));
const schema = (id) => {
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`schema ${id} missing from tools/bedrock-schemas`);
  return validate;
};
const SCHEMA = {
  item: schema('/server/item/1.26.30/ItemDocument.json'),
  block: schema('/server/block/1.26.20/Blocks.json'),
  trades: schema('/client_server/entity/1.21.30/Trade%20Table.json'),
  entity: schema('/server/entity/1.26.30/ActorDocument.json'),
};

// Mojang's component schemas accept unknown keys, so typos like "minecraft:fod" would pass silently.
const knownComponents = (id) => new Set(Object.keys(/** @type {any} */ (ajv.getSchema(id)?.schema)?.properties ?? {}));
const ITEM_COMPONENTS = knownComponents('/server/item/1.26.30/Item%20Components.json');
const BLOCK_COMPONENTS = knownComponents('/server/block/1.26.20/Components.json');
// Mojang's entity schema lacks a few components the game still accepts (vanilla slime uses "minecraft:pushable").
const ENTITY_COMPONENTS = new Set([...knownComponents('/server/entity/1.26.30/Entity%20component%20definitions.json'), 'minecraft:pushable']);
// Fields the game's parser (1.26.30) rejects although the published schemas accept them.
const REJECTED_FIELDS = [['minecraft:behavior.hurt_by_target', ['alert_same_type']], ['minecraft:leashable', ['soft_distance', 'hard_distance', 'max_distance']]];

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
/**
 * Manifest format 2, the one Mojang's samples use and every game version accepts (format 3 with
 * string versions is only in the newest schema and made the game report "must conform to format
 * version [2]"). Versions are [major, minor, patch]; script module dependencies use strings.
 * @param {any} m @param {string} file
 */
function checkManifest(m, file) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const isVersion = (/** @type {unknown} */ v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0);
  if (m?.format_version !== 2) fail(file, 'manifest format_version must be 2');
  const h = m?.header ?? {};
  for (const key of ['name', 'description', 'uuid']) if (typeof h[key] !== 'string') fail(file, `header.${key} must be a string`);
  if (!uuid.test(h.uuid ?? '')) fail(file, 'header.uuid must be a lowercase uuid');
  if (!isVersion(h.version)) fail(file, 'header.version must be [major, minor, patch]');
  if (!isVersion(h.min_engine_version)) fail(file, 'header.min_engine_version must be [major, minor, patch]');
  if (!Array.isArray(m?.modules) || !m.modules.length) fail(file, 'modules must be a non-empty array');
  for (const mod of m?.modules ?? []) {
    if (!['data', 'resources', 'script', 'skin_pack', 'world_template'].includes(mod.type)) fail(file, `module type ${JSON.stringify(mod.type)} unknown`);
    if (!uuid.test(mod.uuid ?? '')) fail(file, 'module uuid must be a lowercase uuid');
    if (!isVersion(mod.version)) fail(file, 'module version must be [major, minor, patch]');
    if (mod.type === 'script' && (mod.language !== 'javascript' || typeof mod.entry !== 'string')) fail(file, 'script module needs language "javascript" and an entry');
  }
  for (const dep of m?.dependencies ?? []) {
    if (dep.module_name) {
      if (!/^@minecraft\/[a-z-]+$/.test(dep.module_name) || !/^\d+\.\d+\.\d+$/.test(String(dep.version))) fail(file, `module dependency ${JSON.stringify(dep)} needs a stable "x.y.z" version`);
    } else if (!uuid.test(dep.uuid ?? '') || !isVersion(dep.version)) {
      fail(file, `pack dependency ${JSON.stringify(dep)} needs a uuid and a [major, minor, patch] version`);
    }
  }
  if ('capabilities' in (m ?? {})) fail(file, 'capabilities (experimental features) are not allowed');
}
// Bedrock skips a pack whose uuid and version it has already imported, so every release must carry
// a new version: all of our own versions have to match package.json, which build.mjs names the file after.
const { version: VERSION } = readJson(join(ROOT, 'package.json'));
/** Manifest format 2 writes versions as [major, minor, patch]. */
const VERSION_ARRAY = JSON.stringify(VERSION.split('.').map(Number));
const manifests = [BP, RP].map((pack) => [join(pack, 'manifest.json'), readJson(join(pack, 'manifest.json'))]);
const ownUuids = new Set(manifests.map(([, m]) => m?.header?.uuid));
if (!readFileSync(join(BP, 'scripts/version.js'), 'utf8').includes(`'${VERSION}'`)) {
  fail(join(BP, 'scripts/version.js'), `VERSION should be package.json's ${VERSION}`);
}
for (const [file, manifest] of manifests) {
  checkManifest(manifest, file);
  const own = [manifest?.header, ...(manifest?.modules ?? []), ...(manifest?.dependencies ?? []).filter((d) => ownUuids.has(d.uuid))];
  for (const entry of own) {
    if (JSON.stringify(entry?.version) !== VERSION_ARRAY) fail(file, `version ${JSON.stringify(entry?.version)} of ${entry?.uuid} should be package.json's ${VERSION} as ${VERSION_ARRAY}`);
  }
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
  if (c['minepreggo:food_effects']) {
    try {
      for (const { effect } of readEffects(c['minepreggo:food_effects'])) if (!Object.values(MinecraftEffectTypes).includes(effect)) fail(file, `unknown effect ${effect}`);
    } catch (error) {
      fail(file, String(error));
    }
  }
  // Custom component parameters must be flat: the game refuses nested objects and arrays
  // ("Exceeded the object and array depth limit") and drops the item.
  for (const [name, params] of Object.entries(c)) {
    if (name.startsWith('minecraft:') || !params || typeof params !== 'object') continue;
    for (const [key, value] of Object.entries(params)) if (value !== null && typeof value === 'object') fail(file, `${name}.${key} is nested; custom component parameters must be flat values`);
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
  if (!Array.isArray(recipe.unlock) || recipe.unlock.length === 0) fail(file, 'recipes need unlock data (the game refuses the recipe without it)');
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

// The game's limits on entity properties: past them it drops every property of the entity.
const ENUM_VALUE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function checkPropertyLimits(/** @type {string} */ file, /** @type {Record<string, any>} */ properties) {
  const names = Object.keys(properties ?? {});
  if (names.length > 32) fail(file, `${names.length} entity properties (at most 32)`);
  for (const [name, def] of Object.entries(properties ?? {})) {
    if (def.type !== 'enum') continue;
    if ((def.values ?? []).length > 16) fail(file, `property ${name} has ${def.values.length} enum values (at most 16)`);
    for (const value of def.values ?? []) if (!ENUM_VALUE.test(value)) fail(file, `property ${name}: enum value "${value}" must be a letter then up to 31 letters, digits or _`);
    if (!def.values?.includes(def.default)) fail(file, `property ${name}: default "${def.default}" is not one of its values`);
  }
}

// --- entities ----------------------------------------------------------------------------
const entities = new Map(); // identifier -> { file, entity }
for (const file of walk(join(BP, 'entities'), '.json')) {
  const entity = readJson(file)?.['minecraft:entity'];
  if (!entity) { fail(file, 'missing "minecraft:entity"'); continue; }
  check(SCHEMA.entity, entity, file, 'entity');
  // The game's typed property parser: a float default or range written without a decimal point
  // fails the property, and with it every property of the entity.
  for (const name of integerFloatLiterals(readFileSync(file, 'utf8'))) fail(file, `float property ${name} must be written with decimal points (0.0, not 0)`);
  for (const group of [entity.components ?? {}, ...Object.values(entity.component_groups ?? {})]) {
    for (const [component, fields] of REJECTED_FIELDS) for (const field of fields) if (group[component] && field in group[component]) fail(file, `${component}.${field} is rejected by the game`);
  }
  const id = entity.description?.identifier;
  // The player override (player visuals) is the one vanilla entity the pack redefines.
  if (!id?.startsWith(`${NS}:`) && id !== 'minecraft:player') fail(file, 'entity identifier must use the minepreggo namespace');
  entities.set(id, { file, entity });

  const properties = entity.description?.properties ?? {};
  checkPropertyLimits(file, properties);
  const groups = entity.component_groups ?? {};
  const events = entity.events ?? {};
  for (const components of [entity.components, ...Object.values(groups)]) {
    for (const name of Object.keys(components ?? {})) if (!ENTITY_COMPONENTS.has(name)) fail(file, `unknown component "${name}"`);
    const loot = components?.['minecraft:loot']?.table;
    if (loot && !existsSync(join(BP, loot))) fail(file, `loot table ${loot} does not exist`);
    for (const tame of [components?.['minecraft:tameable']?.tame_items ?? []].flat()) checkItemRef(file, typeof tame === 'string' ? tame : tame.item);
  }
  // Event responses: groups they add or remove, properties they set, events they trigger.
  const checkResponse = (/** @type {any} */ response, /** @type {string} */ where) => {
    if (!response || typeof response !== 'object') return;
    for (const verb of ['add', 'remove']) {
      for (const group of response[verb]?.component_groups ?? []) if (!groups[group]) fail(file, `${where}: unknown component group "${group}"`);
    }
    for (const [name, value] of Object.entries(response.set_property ?? {})) {
      const def = properties[name];
      if (!def) { fail(file, `${where}: sets undefined property "${name}"`); continue; }
      if (def.type === 'enum' && typeof value === 'string' && !value.includes('.') && !def.values.includes(value)) fail(file, `${where}: "${value}" is not a value of ${name}`);
      if (def.type === 'int' && typeof value === 'number' && (value < def.range[0] || value > def.range[1])) fail(file, `${where}: ${name} = ${value} is out of range`);
    }
    const trigger = typeof response.trigger === 'string' ? response.trigger : response.trigger?.event;
    if (trigger && !events[trigger]) fail(file, `${where}: triggers unknown event "${trigger}"`);
    for (const list of ['sequence', 'randomize']) for (const entry of response[list] ?? []) checkResponse(entry, where);
  };
  for (const [name, event] of Object.entries(events)) checkResponse(event, `event ${name}`);
  // Events named by components (tame_event, environment sensors, ...).
  const stack = [entity.components, groups];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === 'object') {
      if (typeof node.event === 'string' && !node.event.startsWith('minecraft:') && !events[node.event]) fail(file, `component triggers unknown event "${node.event}"`);
      stack.push(...Object.values(node));
    }
  }
  if (id.startsWith(`${NS}:`)) {
    checkLangKey(file, `entity.${id}.name`);
    if (entity.description?.is_spawnable) checkLangKey(file, `item.spawn_egg.entity.${id}.name`);
  }
}

// Mojang publishes no schema for the classic spawn rule format, so conditions are checked against the
// keys vanilla's own spawn rules use.
const SPAWN_CONDITIONS = new Set(['minecraft:biome_filter', 'minecraft:brightness_filter', 'minecraft:delay_filter',
  'minecraft:density_limit', 'minecraft:difficulty_filter', 'minecraft:disallow_spawns_in_bubble', 'minecraft:distance_filter',
  'minecraft:height_filter', 'minecraft:herd', 'minecraft:mob_event_filter', 'minecraft:permute_type',
  'minecraft:player_in_village_filter', 'minecraft:spawn_event', 'minecraft:spawns_lava', 'minecraft:spawns_on_block_filter',
  'minecraft:spawns_on_block_prevented_filter', 'minecraft:spawns_on_surface', 'minecraft:spawns_underground',
  'minecraft:spawns_underwater', 'minecraft:weight', 'minecraft:world_age_filter']);
for (const file of walk(join(BP, 'spawn_rules'), '.json')) {
  const rules = readJson(file)?.['minecraft:spawn_rules'];
  const target = entities.get(rules?.description?.identifier);
  if (!target) fail(file, `spawn rules for unknown entity ${rules?.description?.identifier}`);
  for (const condition of rules?.conditions ?? []) {
    for (const key of Object.keys(condition)) if (!SPAWN_CONDITIONS.has(key)) fail(file, `unknown spawn condition "${key}"`);
    if (!condition['minecraft:weight']) fail(file, 'condition without minecraft:weight');
    const event = condition['minecraft:spawn_event']?.event;
    if (event && target && !target.entity.events?.[event]) fail(file, `spawn event "${event}" is not defined by the entity`);
  }
}

// --- client entities, render controllers, animations ---------------------------------------
// Definitions from the game itself that client entities may use.
const VANILLA_RP_IDS = new Set(['animation.common.look_at_target', 'controller.render.default']);
const rpIds = new Set(VANILLA_RP_IDS);
const controllers = new Map(); // animation controller id -> definition
for (const file of walk(join(RP, 'animations'), '.json')) Object.keys(readJson(file)?.animations ?? {}).forEach((id) => rpIds.add(id));
for (const file of walk(join(RP, 'animation_controllers'), '.json')) {
  for (const [id, def] of Object.entries(readJson(file)?.animation_controllers ?? {})) { rpIds.add(id); controllers.set(id, def); }
}
for (const file of walk(join(RP, 'render_controllers'), '.json')) Object.keys(readJson(file)?.render_controllers ?? {}).forEach((id) => rpIds.add(id));
const convertedImported = existsSync(join(RP, 'animations', NS));
const molangProperties = (/** @type {string} */ text) => [...text.matchAll(/q(?:uery)?\.property\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
/** Names an animate list, controller state or animation list refers to. */
const animationRefs = (/** @type {any[]} */ list) => (list ?? []).flatMap((a) => (typeof a === 'string' ? [a] : Object.keys(a)));

for (const file of walk(join(RP, 'entity'), '.json')) {
  const description = readJson(file)?.['minecraft:client_entity']?.description;
  if (!description) { fail(file, 'missing "minecraft:client_entity"'); continue; }
  const server = entities.get(description.identifier);
  if (!server) { fail(file, `no behavior pack entity ${description.identifier}`); continue; }
  // In the player override only our own additions are checked; vanilla ids come from the game.
  const ours = (/** @type {string} */ ref) => description.identifier !== 'minecraft:player' || ref.includes(`.${NS}.`) || ref.includes(`/${NS}/`);
  for (const path of Object.values(description.textures ?? {})) {
    if (imported && ours(path) && !existsSync(join(RP, `${path}.png`))) fail(file, `texture ${path}.png does not exist`);
  }
  for (const geo of Object.values(description.geometry ?? {})) {
    if (ours(geo) && !geometries.has(geo) && (imported || !geo.startsWith(`geometry.${NS}.`))) fail(file, `geometry "${geo}" not found in packs/resource/models`);
  }
  const shortNames = description.animations ?? {};
  for (const [name, id] of Object.entries(shortNames)) {
    const generated = id.startsWith(`animation.${NS}.`) && !rpIds.has(id) && !convertedImported;
    if (ours(id) && !rpIds.has(id) && !generated) fail(file, `animation "${name}" refers to unknown ${id}`);
    for (const state of Object.values(controllers.get(id)?.states ?? {})) {
      for (const ref of animationRefs(state.animations)) if (!shortNames[ref]) fail(file, `controller ${id} plays "${ref}", which this entity does not define`);
    }
  }
  for (const ref of animationRefs(description.scripts?.animate)) if (!shortNames[ref]) fail(file, `animate uses undefined "${ref}"`);
  for (const id of description.render_controllers ?? []) {
    const rc = typeof id === 'string' ? id : Object.keys(id)[0];
    if (ours(rc) && !rpIds.has(rc)) fail(file, `unknown render controller ${rc}`);
  }
  // Properties read by Molang here or in the shared controllers must exist and be synced to clients.
  const used = new Set(molangProperties(JSON.stringify(description)));
  for (const id of [...Object.values(shortNames), ...(description.render_controllers ?? [])]) {
    if (typeof id !== 'string') continue;
    for (const f of [...walk(join(RP, 'animation_controllers'), '.json'), ...walk(join(RP, 'render_controllers'), '.json'), ...walk(join(RP, 'animations'), '.json')]) {
      const json = readJson(f);
      const def = json?.animation_controllers?.[id] ?? json?.render_controllers?.[id] ?? json?.animations?.[id];
      if (def) molangProperties(JSON.stringify(def)).forEach((p) => used.add(p));
    }
  }
  for (const name of used) {
    const def = server.entity.description?.properties?.[name];
    if (!def) fail(file, `Molang reads undefined property "${name}"`);
    else if (!def.client_sync) fail(file, `property "${name}" is read by the client but not client_sync`);
  }
  const egg = description.spawn_egg?.texture;
  if (egg) checkTexture(file, itemTextures, egg, 'spawn egg');
}

// --- what the game refuses outright ------------------------------------------------------------
// Each of these drops more than the line at fault (a whole animation file, a client entity's
// variables), and none fails a JSON schema, so they are checked over every animation and client
// entity, the merged Jenny port's included.
const CLIENT_DESCRIPTION_KEYS = new Set(['identifier', 'min_engine_version', 'materials', 'textures', 'geometry', 'scripts', 'animations',
  'animation_controllers', 'render_controllers', 'particle_effects', 'particle_emitters', 'sound_effects', 'spawn_egg', 'enable_attachables',
  'hide_armor', 'held_item_ignores_lighting', 'locators', 'queryable_geometry']);
const holdsMolang = (/** @type {unknown} */ frame) => {
  const vectors = Array.isArray(frame) ? [frame] : frame && typeof frame === 'object' ? [/** @type {any} */ (frame).pre, /** @type {any} */ (frame).post] : [frame];
  return vectors.some((v) => typeof v === 'string' || (Array.isArray(v) && v.some((c) => typeof c === 'string')));
};
for (const file of walkAll(join(RP, 'animations'), '.json')) {
  for (const [id, animation] of Object.entries(readJson(file)?.animations ?? {})) {
    // an empty bones object fails the file's schema check, and the game then loads none of its animations
    if (animation?.bones && !Object.keys(animation.bones).length) fail(file, `${id}: "bones" is empty (the game then refuses every animation of this file)`);
    for (const [bone, channels] of Object.entries(animation?.bones ?? {})) {
      for (const [channel, frames] of Object.entries(channels ?? {})) {
        if (!frames || typeof frames !== 'object' || Array.isArray(frames)) continue;
        const values = Object.values(frames);
        if (values.some((f) => /** @type {any} */ (f)?.lerp_mode === 'catmullrom') && values.some(holdsMolang)) fail(file, `${id}: ${bone}.${channel} mixes catmull-rom keyframes with Molang (the game refuses the animation)`);
      }
    }
  }
}
for (const file of walkAll(join(RP, 'entity'), '.json')) {
  const description = readJson(file)?.['minecraft:client_entity']?.description;
  for (const key of Object.keys(description ?? {})) if (!CLIENT_DESCRIPTION_KEYS.has(key)) fail(file, `description.${key} is not valid in a client entity${key === 'variables' ? ' (public variables go under scripts.variables)' : ''}`);
}
// the merged Jenny port's recipes too: a 1.20+ recipe without unlock data is refused
for (const file of walkAll(join(BP, 'recipes', 'jenny_port'), '.json')) {
  const recipe = Object.entries(readJson(file) ?? {}).find(([k]) => k.startsWith('minecraft:recipe_'))?.[1];
  if (recipe && (!Array.isArray(recipe.unlock) || !recipe.unlock.length)) fail(file, 'recipes need unlock data (the game refuses the recipe without it)');
}

// --- the Jenny port: what tools/import-jenny.mjs adds to its girls ------------------------------
// The port's own definitions are the game's to check; ours (minepreggo properties, belly and pose
// animations, controllers, the babies) are checked here like the rest of the pack.
const PORT = 'jenny_port';
if (existsSync(join(RP, 'entity', PORT))) {
  const allIds = new Set(VANILLA_RP_IDS);
  const allControllers = new Map();
  /** @type {Map<string, any>} every animation, controller and render controller by id */
  const allDefs = new Map();
  for (const file of walkAll(join(RP, 'animations'), '.json')) for (const [id, def] of Object.entries(readJson(file)?.animations ?? {})) { allIds.add(id); allDefs.set(id, def); }
  for (const file of walkAll(join(RP, 'animation_controllers'), '.json')) {
    for (const [id, def] of Object.entries(readJson(file)?.animation_controllers ?? {})) { allIds.add(id); allControllers.set(id, def); allDefs.set(id, def); }
  }
  for (const file of walkAll(join(RP, 'render_controllers'), '.json')) for (const [id, def] of Object.entries(readJson(file)?.render_controllers ?? {})) { allIds.add(id); allDefs.set(id, def); }
  const allGeometries = new Set(geometries);
  for (const file of walkAll(join(RP, 'models'), '.json')) for (const geo of readJson(file)?.['minecraft:geometry'] ?? []) allGeometries.add(geo.description?.identifier);
  const portEntities = new Map();
  for (const file of walk(join(BP, 'entities', PORT), '.json')) {
    const entity = readJson(file)?.['minecraft:entity'];
    if (entity) { portEntities.set(entity.description?.identifier, entity); checkPropertyLimits(file, entity.description?.properties); }
  }
  for (const file of walkAll(join(RP, 'entity', PORT), '.json')) {
    const description = readJson(file)?.['minecraft:client_entity']?.description;
    if (!description) continue;
    const server = portEntities.get(description.identifier);
    const shortNames = description.animations ?? {};
    const ours = (/** @type {string} */ id) => id.includes(`.${NS}.`);
    for (const [name, id] of Object.entries(shortNames)) {
      if (ours(id) && !allIds.has(id)) fail(file, `animation "${name}" refers to unknown ${id}`);
      if (!ours(id)) continue;
      for (const state of Object.values(allControllers.get(id)?.states ?? {})) {
        for (const ref of animationRefs(state.animations)) if (!shortNames[ref]) fail(file, `controller ${id} plays "${ref}", which this entity does not define`);
      }
    }
    for (const ref of animationRefs(description.scripts?.animate)) if (!shortNames[ref]) fail(file, `animate uses undefined "${ref}"`);
    for (const geo of Object.values(description.geometry ?? {})) if (geo.includes(`.${NS}`) && !allGeometries.has(geo)) fail(file, `geometry "${geo}" not found`);
    for (const id of description.render_controllers ?? []) {
      const rc = typeof id === 'string' ? id : Object.keys(id)[0];
      if (ours(rc) && !allIds.has(rc)) fail(file, `unknown render controller ${rc}`);
    }
    // Our properties read by Molang here or in what this entity plays must be defined and synced.
    const used = new Set(molangProperties(JSON.stringify(description)));
    for (const id of [...Object.values(shortNames), ...(description.render_controllers ?? []).map((r) => (typeof r === 'string' ? r : Object.keys(r)[0]))]) {
      molangProperties(JSON.stringify(allDefs.get(id) ?? {})).forEach((p) => used.add(p));
    }
    for (const name of [...used].filter((p) => p.startsWith(`${NS}:`))) {
      const def = server?.description?.properties?.[name];
      if (!def) fail(file, `Molang reads undefined property "${name}"`);
      else if (!def.client_sync) fail(file, `property "${name}" is read by the client but not client_sync`);
    }
  }
  // Each girl's baby: its icon in the merged item atlas and its name.
  const portTextures = { ...itemTextures, ...(readJson(join(RP, 'textures', PORT, 'item_texture.json'))?.texture_data ?? {}) };
  for (const file of walkAll(join(BP, 'items', PORT, NS), '.json')) {
    const item = readJson(file)?.['minecraft:item'];
    if (!item) { fail(file, 'missing "minecraft:item"'); continue; }
    check(SCHEMA.item, item, file, 'item');
    const icon = item.components?.['minecraft:icon'];
    if (typeof icon === 'string') checkTexture(file, portTextures, icon, 'item');
    else fail(file, 'has no icon');
    const name = item.components?.['minecraft:display_name']?.value;
    if (name) checkLangKey(file, name);
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
  for (const [, key] of source.matchAll(/(?:translate:\s*|(?:message|actionbar|tellOwner)\([^,]+,\s*)'([^'$]+)'/g)) {
    checkLangKey(file, key);
  }
}

// Message keys passed around before reaching a translate (ternaries, tables, tell(...)).
const sceneKinds = Object.keys(Object.fromEntries([...(scriptSource.match(/BELLY_SCENE_TICKS\s*=.*\{([^{}]*)\}\)?;/)?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => [m[1], 1])));
if (!sceneKinds.length) fail(join(BP, 'scripts/jenny/belly_scenes.js'), 'BELLY_SCENE_TICKS (the belly scene kinds) not found');
for (const file of walk(join(BP, 'scripts'), '.js')) {
  const source = readFileSync(file, 'utf8');
  for (const [, key] of source.matchAll(/'(minepreggo\.(?:belly|scene|birth|baby|bed)\.[A-Za-z0-9_.]+)'/g)) checkLangKey(file, key);
  for (const [, prefix] of source.matchAll(/`(minepreggo\.(?:belly|scene|birth|baby|bed)\.[A-Za-z0-9_.]*)\$\{kind\}`/g)) {
    for (const kind of sceneKinds) checkLangKey(file, `${prefix}${kind}`);
  }
}
if (langKeys) {
  const seen = new Set();
  for (const line of readFileSync(langFile, 'utf8').split('\n')) {
    if (!line || line.startsWith('##') || !line.includes('=')) continue;
    const key = line.split('=')[0];
    if (seen.has(key) && key.includes(NS)) fail(langFile, `lang key "${key}" is defined twice`);
    seen.add(key);
  }
}

if (!imported || !langKeys) console.warn('note: texture and lang checks skipped - run `npm run import` to enable them');
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) found`);
  process.exit(1);
}
console.log(`OK: ${items.length} items, ${blocks.length} blocks, ${entities.size} entities validated`);
