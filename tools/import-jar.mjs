// Pulls the third-party assets (textures, sounds, translations, entity models and animations, pack
// icon) out of the original Minepreggo Forge jar and converts them into the Bedrock resource pack
// layout. Strings the port adds itself live in tools/lang/ and are merged into the generated .lang
// files.
//
// The jar is "All Rights Reserved", so nothing produced here is committed: every output
// path is listed in .gitignore. Re-run this whenever the jar is updated.
//
// Usage: node tools/import-jar.mjs [path/to/minepreggo.jar]
//   (falls back to $MINEPREGGO_JAR, then to the single *.jar inside vendor/)

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { createModelRunner, toBedrockAnimation, toBedrockGeometry } from './lib/java-models.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const BP = join(ROOT, 'packs/behavior');
const MOD_ID = 'minepreggo';

function findJar() {
  const explicit = process.argv[2] ?? process.env.MINEPREGGO_JAR;
  if (explicit) return resolve(explicit);
  const vendor = join(ROOT, 'vendor');
  const jars = existsSync(vendor) ? readdirSync(vendor).filter((f) => f.endsWith('.jar')) : [];
  if (jars.length === 1) return join(vendor, jars[0]);
  throw new Error(
    jars.length > 1
      ? `vendor/ holds several jars (${jars.join(', ')}); pass the one to import as an argument`
      : 'No jar found: pass its path, set MINEPREGGO_JAR, or copy it into vendor/'
  );
}

// Java locale ids are lower case (es_mx); Bedrock wants the region upper case (es_MX).
function bedrockLocale(javaLocale) {
  const [lang, region] = javaLocale.split('_');
  return `${lang}_${region.toUpperCase()}`;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Java keys are kept verbatim so item/block JSON can point `minecraft:display_name` at them.
// Entities and spawn eggs get their names from fixed Bedrock keys, so those are aliased too.
// Java potions are vanilla potions with NBT; in Bedrock each strength is its own item, so
// "item.minecraft.potion.effect.<name>_<n>" also becomes "item.minepreggo.<name>_potion_<n>"
// with the strength appended, since Bedrock shows no effect tooltip for custom items.
function bedrockAliases(key, value) {
  const aliases = [[key, value]];
  const entity = key.match(/^entity\.minepreggo\.([a-z0-9_]+)$/);
  if (entity) aliases.push([`entity.${MOD_ID}:${entity[1]}.name`, value]);
  const egg = key.match(/^item\.minepreggo\.([a-z0-9_]+)_spawn_egg$/);
  if (egg) aliases.push([`item.spawn_egg.entity.${MOD_ID}:${egg[1]}.name`, value]);
  const potion = key.match(/^item\.minecraft\.potion\.effect\.([a-z_]+)_(\d)$/);
  if (potion) aliases.push([`item.${MOD_ID}.${potion[1]}_potion_${potion[2]}`, `${value} ${ROMAN[Number(potion[2])]}`]);
  return aliases;
}

/** Port-specific strings from tools/lang/<locale>.lang; locales without a file get English. */
function extraLines(locale) {
  const dir = join(ROOT, 'tools/lang');
  const file = [join(dir, `${locale}.lang`), join(dir, 'en_US.lang')].find(existsSync);
  if (!file) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('##'));
}

function toLangLine(key, value) {
  // .lang files are line based; Bedrock renders ~LINEBREAK~ as a new line.
  const flat = value.replace(/\r?\n/g, '~LINEBREAK~');
  return `${key}=${flat}`;
}

function writeFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

const jarPath = findJar();
const files = unzipSync(new Uint8Array(readFileSync(jarPath)));

const modsToml = files['META-INF/mods.toml'];
if (!modsToml || !strFromU8(modsToml).includes(`modId="${MOD_ID}"`)) {
  throw new Error(`${jarPath} does not look like the ${MOD_ID} mod jar`);
}
const modVersion = strFromU8(modsToml).match(/^version="([^"]+)"/m)?.[1] ?? 'unknown';

// Textures: copied 1:1 under textures/minepreggo/ so Java paths map predictably.
const textureOut = join(RP, 'textures', MOD_ID);
rmSync(textureOut, { recursive: true, force: true });
const texturePrefix = `assets/${MOD_ID}/textures/`;
let textureCount = 0;
for (const [name, data] of Object.entries(files)) {
  if (!name.startsWith(texturePrefix) || !name.endsWith('.png')) continue;
  // Mob textures move from entity/preggo/ to mobs/ to keep paths short (some devices refuse long ones).
  writeFile(join(textureOut, name.slice(texturePrefix.length).replace(/^entity\/preggo\//, 'mobs/')), data);
  textureCount++;
}

// Sounds: copied 1:1 under sounds/minepreggo/; packs/resource/sounds/sound_definitions.json maps them.
const soundOut = join(RP, 'sounds', MOD_ID);
rmSync(soundOut, { recursive: true, force: true });
const soundPrefix = `assets/${MOD_ID}/sounds/`;
let soundCount = 0;
for (const [name, data] of Object.entries(files)) {
  if (!name.startsWith(soundPrefix) || !name.endsWith('.ogg')) continue;
  writeFile(join(soundOut, name.slice(soundPrefix.length)), data);
  soundCount++;
}

// Translations.
const langPrefix = `assets/${MOD_ID}/lang/`;
const locales = [];
for (const [name, data] of Object.entries(files)) {
  if (!name.startsWith(langPrefix) || !name.endsWith('.json')) continue;
  const locale = bedrockLocale(name.slice(langPrefix.length, -'.json'.length));
  const entries = JSON.parse(strFromU8(data));
  const lines = [`## Generated by tools/import-jar.mjs from ${MOD_ID} ${modVersion} - do not edit`];
  for (const [key, value] of Object.entries(entries)) {
    for (const [k, v] of bedrockAliases(key, value)) lines.push(toLangLine(k, v));
  }
  lines.push('## Strings added by the Bedrock port (tools/lang)', ...extraLines(locale));
  writeFile(join(RP, 'texts', `${locale}.lang`), lines.join('\n') + '\n');
  locales.push(locale);
}

const declared = JSON.parse(readFileSync(join(RP, 'texts/languages.json'), 'utf8'));
const undeclared = locales.filter((l) => !declared.includes(l));
if (undeclared.length) console.warn(`warning: add ${undeclared.join(', ')} to packs/resource/texts/languages.json`);

// Entity models: the mod builds them in code, so they are converted by running the jar's model
// factories (tools/lib/java-models.mjs) instead of being copied.
const MODEL_PACKAGE = 'dev/dixmk/minepreggo/client/model/entity/preggo/';
const withPhases = (id, javaClass, baseMethod) => [
  [id, javaClass, baseMethod],
  ...Array.from({ length: 10 }, (_, p) => [`${id}_p${p}`, javaClass, `createP${p}BodyLayer`]),
];
const MODELS = [
  ...withPhases('zombie_girl', 'zombie/AbstractZombieGirlModel', 'createBodyLayer'),
  ...withPhases('humanoid_creeper_girl', 'creeper/AbstractHumanoidCreeperGirlModel', 'createBodyLayer'),
  ...withPhases('monster_creeper_girl', 'creeper/AbstractMonsterCreeperGirlModel', 'createBasicBodyLayer'),
  ...withPhases('ender_woman', 'ender/AbstractMonsterEnderWomanModel', 'createBodyLayer'),
  ...withPhases('humanoid_slime_girl', 'slime/AbstractHumanoidSlimeGirlModel', 'createNonPregBodyLayer'),
  ...withPhases('monster_slime_girl', 'slime/AbstractMonsterSlimeGirlModel', 'createNonPregBodyLayer'),
];
const modelOut = join(RP, 'models/entity', MOD_ID);
rmSync(modelOut, { recursive: true, force: true });
const models = createModelRunner(files, 'dev/dixmk/minepreggo/');
for (const [id, javaClass, method] of MODELS) {
  const layer = models.layer(MODEL_PACKAGE + javaClass, method);
  const parts = new Set();
  const collect = (part) => part.children.forEach((child, name) => { parts.add(name); collect(child); });
  collect(layer.root);
  const geometry = toBedrockGeometry(layer, `geometry.${MOD_ID}.${id}`, {
    // Java copies the head pose onto the hat every frame; in Bedrock the hat simply follows the head.
    reparent: parts.has('hat') && parts.has('head') ? { hat: 'head' } : {},
    // Bedrock draws held items at these bones (same placement as vanilla's humanoid geometry).
    extraBones: parts.has('right_arm') && parts.has('left_arm')
      ? [
          { name: 'rightItem', parent: 'right_arm', pivot: [-6, 15, 1] },
          { name: 'leftItem', parent: 'left_arm', pivot: [6, 15, 1] },
        ]
      : [],
  });
  writeFile(join(modelOut, `${id}.geo.json`), JSON.stringify(geometry, null, 2) + '\n');
}

// Keyframe animations, one file per Java animation class: e.g. ZombieGirlAnimations.IDLE becomes
// "animation.minepreggo.zombie_girl.idle". They animate the Java part names, which the converted
// geometry keeps.
const ANIMATION_PACKAGE = 'dev/dixmk/minepreggo/client/animation/preggo/';
const ANIMATIONS = {
  ZombieGirlAnimations: 'zombie_girl',
  HumanoidCreeperGirlAnimations: 'humanoid_creeper_girl',
  MonsterCreeperGirlAnimations: 'monster_creeper_girl',
  MonsterEnderWomanAnimations: 'ender_woman',
  HumanoidSlimeGirlAnimations: 'humanoid_slime_girl',
  MonsterSlimeGirlAnimations: 'monster_slime_girl',
  BellyAnimation: 'belly',
};
const animationOut = join(RP, 'animations', MOD_ID);
rmSync(animationOut, { recursive: true, force: true });
let animationCount = 0;
for (const [javaClass, id] of Object.entries(ANIMATIONS)) {
  const animations = {};
  for (const [field, animation] of Object.entries(models.animations(ANIMATION_PACKAGE + javaClass))) {
    const bedrock = toBedrockAnimation(animation);
    // Java plays walk cycles with HierarchicalModel.animateWalk, which advances them by distance
    // walked (limbSwing * 50 ms) instead of time; Bedrock's equivalent of limbSwing is
    // query.modified_distance_moved (vanilla's humanoid walk uses both with the same factor).
    if (/^(WALK\d*|AGGRESSION)$/.test(field)) bedrock.anim_time_update = 'query.modified_distance_moved * 0.05';
    // Java copies the head's pose onto the hat after animating (hat.copyFrom(head)), overwriting
    // any hat keyframes; the converted hat is a child of the head, so it follows on its own.
    delete bedrock.bones.hat;
    animations[`animation.${MOD_ID}.${id}.${field.toLowerCase()}`] = bedrock;
    animationCount++;
  }
  writeFile(join(animationOut, `${id}.animation.json`), JSON.stringify({ format_version: '1.8.0', animations }, null, 2) + '\n');
}

// Pack icons.
const logo = files['logo.png'];
if (logo) {
  writeFile(join(RP, 'pack_icon.png'), logo);
  writeFile(join(BP, 'pack_icon.png'), logo);
}

console.log(
  `Imported ${MOD_ID} ${modVersion} from ${jarPath}: ${textureCount} textures, ${soundCount} sounds, ${MODELS.length} models, ${animationCount} animations, ` +
    `${locales.length} languages (${locales.sort().join(', ')})${logo ? ', pack icons' : ''}`
);
