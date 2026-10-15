// Merges Reign of Nether (SoLegendary's Java RTS mod, GPL-3.0) into the packs at import time, from
// its source tree in vendor/reign/reignofnether/ (or $REIGN_SRC): every unit becomes a Bedrock
// entity reignofnether:<id> with its own stats, look and team AI, its models are converted from
// the Java model source, its textures, sounds and names are copied, and the scripts in
// packs/behavior/scripts/reign/ get the numbers they need (scripts/reign_port/data.js). Nothing of
// it is committed: everything written here is under git-ignored reign_port/ folders.
// Run as part of `npm run import` (after the Jenny import, which rewrites the language files).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyEntity } from './lib/entity-json.mjs';
import { toBedrockAnimation, toBedrockGeometry } from './lib/java-models.mjs';
import { parseAnimations, parseLayer } from './lib/java-source.mjs';
import { extractReign } from './lib/reign-extract.mjs';
import { unitEntities } from './lib/reign-entities.mjs';
import { capitolBlocks } from './lib/reign-blocks.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'reign_port';
const MOD = 'reignofnether';
const SOURCE = process.env.REIGN_SRC ?? join(ROOT, 'vendor/reign/reignofnether');
const JAVA = join(SOURCE, 'src/main/java/com/solegendary/reignofnether');
const ASSETS = join(SOURCE, 'src/main/resources/assets/reignofnether');
const LANG_HEADER = '## Reign of Nether (vendor/reign, tools/import-reign.mjs)';
/** The locales the resource pack declares (texts/languages.json); RoN's file for each, else English. */
const LOCALES = { en_US: 'en_us', es_MX: 'es_mx', ko_KR: 'ko_kr', ru_RU: 'ru_ru' };

function writeFile(/** @type {string} */ path, /** @type {string | Uint8Array} */ data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
const writeJson = (/** @type {string} */ path, /** @type {unknown} */ doc) => writeFile(path, JSON.stringify(doc, null, 2) + '\n');
function* walk(/** @type {string} */ dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

// ---- clean what the last run wrote ------------------------------------------------------------
for (const dir of [
  join(BP, 'entities', PORT), join(BP, 'items', PORT), join(BP, 'blocks', PORT), join(BP, 'loot_tables', PORT), join(BP, 'scripts', PORT),
  join(RP, 'entity', PORT), join(RP, 'models/entity', PORT), join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT),
  join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT), join(RP, 'sounds', PORT), join(RP, PORT),
]) rmSync(dir, { recursive: true, force: true });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at >= 0) writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n'));
}

if (!existsSync(JAVA)) {
  console.log(`Reign of Nether: not in vendor/reign/ (or $REIGN_SRC), so not merged`);
  process.exit(0);
}

const counts = { units: 0, models: 0, animations: 0, textures: 0, sounds: 0, lang: 0 };
const data = extractReign(SOURCE);

// ---- models and animations, converted from the Java model source --------------------------------
const MODELS = join(JAVA, 'unit/modelling/models');
const ANIMATIONS = join(JAVA, 'unit/modelling/animations');
const snake = (/** @type {string} */ name) => name.replace(/Model$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** @type {Map<string, Set<string>>} geometry id -> its bone names */
const geometryBones = new Map();
const wanted = new Set(Object.values(data.units).map((u) => u.model?.javaModel).filter(Boolean));
for (const javaModel of wanted) {
  const file = join(MODELS, `${javaModel}.java`);
  if (!existsSync(file)) throw new Error(`Reign of Nether: no model source ${javaModel}`);
  const id = `geometry.${MOD}.${snake(javaModel)}`;
  const geometry = toBedrockGeometry(parseLayer(readFileSync(file, 'utf8')), id, {});
  geometryBones.set(id, new Set(geometry['minecraft:geometry'][0].bones.map((/** @type {any} */ b) => b.name)));
  writeJson(join(RP, 'models/entity', PORT, `${snake(javaModel)}.geo.json`), geometry);
  counts.models++;
}
for (const file of readdirSync(ANIMATIONS).filter((f) => f.endsWith('.java'))) {
  const owner = file.replace(/Animations?\.java$/, '');
  const model = [...wanted].find((m) => m.replace(/Model$/, '').replace(/Unit$/, '') === owner.replace(/Unit$/, ''));
  const bones = model ? geometryBones.get(`geometry.${MOD}.${snake(model)}`) : undefined;
  const animations = /** @type {Record<string, unknown>} */ ({});
  for (const [name, animation] of Object.entries(parseAnimations(readFileSync(join(ANIMATIONS, file), 'utf8')))) {
    // a channel for a bone the model does not have never runs in Java either (Wildfire's 'upperbodyParts')
    if (bones) for (const bone of [...animation.bones.keys()]) if (!bones.has(bone)) animation.bones.delete(bone);
    animations[`animation.${MOD}.${snake(owner)}.${name.toLowerCase()}`] = toBedrockAnimation(animation, bones ? [...bones] : undefined);
    counts.animations++;
  }
  writeJson(join(RP, 'animations', PORT, `${snake(owner)}.animation.json`), { format_version: '1.8.0', animations });
}

// ---- textures: the units' own, their portraits (menu icons) and item icons ----------------------
for (const [from, to] of [['textures/entities', 'entities'], ['textures/mobheads', 'mobheads'], ['textures/item', 'items'], ['textures/misc', 'misc']]) {
  for (const file of walk(join(ASSETS, from))) {
    if (!file.endsWith('.png')) continue;
    writeFile(join(RP, 'textures', PORT, to, relative(join(ASSETS, from), file)), readFileSync(file));
    counts.textures++;
  }
}

// ---- the units ----------------------------------------------------------------------------------
/** @type {Record<string, unknown>} */
const renderControllers = {};
/** @type {Record<string, unknown>} */
const extraAnimations = {};
for (const unit of Object.values(data.units)) {
  const built = unitEntities(unit, { modelIds: [...geometryBones.keys()] });
  writeFile(join(BP, 'entities', PORT, `${unit.id}.json`), stringifyEntity(built.behavior));
  writeJson(join(RP, 'entity', PORT, `${unit.id}.entity.json`), built.client);
  Object.assign(renderControllers, built.renderControllers ?? {});
  Object.assign(extraAnimations, built.extraAnimations ?? {});
  for (const [path, table] of Object.entries(built.lootTables ?? {})) writeJson(join(BP, path), table);
  counts.units++;
}
writeJson(join(RP, 'render_controllers', PORT, 'units.render_controllers.json'), { format_version: '1.10.0', render_controllers: renderControllers });
if (Object.keys(extraAnimations).length) writeJson(join(RP, 'animations', PORT, 'units.animation.json'), { format_version: '1.8.0', animations: extraAnimations });

// ---- the capitol blocks and the command horn ----------------------------------------------------
const mobhead = (/** @type {string} */ name) => {
  const file = join(ASSETS, 'textures/mobheads', `${name}.png`);
  return existsSync(file) ? decodePng(new Uint8Array(readFileSync(file))) : undefined;
};
const capitols = capitolBlocks(data.factions ?? ['villagers', 'monsters', 'piglins'], { villagers: mobhead('villager'), monsters: mobhead('zombie_villager'), piglins: mobhead('grunt') });
for (const [path, doc] of Object.entries(capitols.blocks)) writeJson(join(BP, path), doc);
for (const [path, doc] of Object.entries(capitols.items)) writeJson(join(BP, path), doc);
for (const [path, image] of Object.entries(capitols.textures)) writeFile(join(RP, path), encodePng(image));
writeJson(join(RP, 'textures', PORT, 'terrain_texture.json'), { resource_pack_name: 'minepreggo', texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: capitols.terrainTextures });
writeJson(join(RP, 'textures', PORT, 'item_texture.json'), { resource_pack_name: 'minepreggo', texture_name: 'atlas.items', texture_data: capitols.itemTextures });

// ---- sounds: its events, in-world ones in mono (Bedrock places only mono sounds in the world) ---
const soundsJson = JSON.parse(readFileSync(join(ASSETS, 'sounds.json'), 'utf8'));
const MUSIC = /^(main_menu|blood_moon|.*_calm)$/;
const UI = /^(victory|defeat|under_attack|chat|ally|enemy)$/;
/** @type {Record<string, unknown>} */
const definitions = {};
let ffmpeg = true;
for (const [event, def] of Object.entries(soundsJson)) {
  if (MUSIC.test(event)) continue;
  const files = [];
  for (const sound of def.sounds ?? []) {
    const name = String(typeof sound === 'string' ? sound : sound.name).replace(/^reignofnether:/, '');
    const from = join(ASSETS, 'sounds', `${name}.ogg`);
    if (!existsSync(from)) continue;
    const to = join(RP, 'sounds', PORT, `${name}.ogg`);
    mkdirSync(dirname(to), { recursive: true });
    if (!UI.test(event) && ffmpeg) {
      try {
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', from, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '4', to]);
      } catch {
        ffmpeg = false;
        console.warn('warning: ffmpeg could not downmix the sounds to mono; they are copied as they are');
        copyFileSync(from, to);
      }
    } else copyFileSync(from, to);
    files.push({ name: `sounds/${PORT}/${name}`, ...(UI.test(event) ? {} : { is3D: true }) });
    counts.sounds++;
  }
  if (files.length) definitions[`${MOD}.${event}`] = { category: UI.test(event) ? 'ui' : 'hostile', sounds: files };
}
writeJson(join(RP, 'sounds', PORT, 'sound_definitions.json'), { format_version: '1.20.20', sound_definitions: definitions });

// ---- names and texts: its lang keys, with the names Bedrock looks up for entities and eggs ------
const english = JSON.parse(readFileSync(join(ASSETS, 'lang/en_us.json'), 'utf8'));
const ownLines = capitols.langLines ?? [];
for (const [locale, javaLocale] of Object.entries(LOCALES)) {
  const path = join(RP, 'texts', `${locale}.lang`);
  if (!existsSync(path)) continue;
  const file = join(ASSETS, 'lang', `${javaLocale}.json`);
  /** @type {Record<string, string>} */
  let table = { ...english };
  try {
    if (existsSync(file)) table = { ...english, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // a broken translation file: English
  }
  const lines = [LANG_HEADER];
  for (const [key, raw] of Object.entries(table)) {
    // Bedrock fills only %s in a translate's 'with'; the mod's icon glyphs (U+E000-U+E015) have no font here
    const value = String(raw).replace(/%d/g, '%s').replace(/[-]/g, '').replace(/\r?\n/g, '~LINEBREAK~');
    lines.push(`${key}=${value}`);
    const entity = key.match(/^entity\.reignofnether\.([a-z0-9_]+)$/);
    if (entity) lines.push(`entity.${MOD}:${entity[1]}.name=${value}`);
    const egg = key.match(/^item\.reignofnether\.([a-z0-9_]+)_spawn_egg$/);
    if (egg) lines.push(`item.spawn_egg.entity.${MOD}:${egg[1]}.name=${value}`);
    counts.lang++;
  }
  lines.push(...ownLines);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lines.join('\n') + '\n');
}

// ---- what the scripts need ------------------------------------------------------------------------
const units = Object.fromEntries(Object.values(data.units).map((u) => [`${MOD}:${u.id}`, {
  id: u.id, faction: u.faction, role: u.role, stats: u.stats, cost: u.cost ?? null, producedAt: u.producedAt ?? null, egg: u.egg ?? null, name: `entity.${MOD}:${u.id}.name`,
}]));
const reign = {
  version: data.version,
  factions: ['villagers', 'monsters', 'piglins', 'neutral'],
  units,
  buildings: data.buildings ?? {},
  resourceItems: data.resourceItems ?? {},
  capitols: { villagers: `${MOD}:capitol_villagers`, monsters: `${MOD}:capitol_monsters`, piglins: `${MOD}:capitol_piglins` },
};
writeFile(join(BP, 'scripts', PORT, 'data.js'), `// Generated by tools/import-reign.mjs from Reign of Nether ${data.version} - do not edit\nexport const REIGN = ${JSON.stringify(reign, null, 1)};\n`);

console.log(`Reign of Nether ${data.version}: ${counts.units} units, ${counts.models} models, ${counts.animations} animations, ${counts.textures} textures, ${counts.sounds} sounds, ${counts.lang} names and texts`);
