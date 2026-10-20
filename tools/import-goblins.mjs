// Merges the three girls of Expandable Goblins (an MCreator/GeckoLib mod for Forge 1.20.1, read
// from vendor/goblins/*.jar at import time; nothing of it is committed) into the packs as Minepreggo
// females: the Goblin, Imp and Bloatberry girls keep their own GeckoLib models, layered skins
// (body, hair, eyes, clothes, blush) and animations, and join the mob system (mobs/families.js
// GOBLIN_FAMILIES). Their pregnancy belly is their own: the nested belly cubes of their model
// (belly1 > belly2 > belly3, or belly > belly2 for the Bloatberry girl) grow with the phases in
// their own skin, and the babies move it. Everything written here is under git-ignored
// goblins_port/ folders. Run as part of `npm run import`, after tools/import-jenny.mjs.
//
// Their animations play as the mod plays them (its entity classes and tick procedures): the walk,
// idle, sit and attack of her size (the mod picks them by how full she is; here by how big her
// belly is, so she walks heavier late in her pregnancy), looping where GeckoLib loops them, the walk
// in step with how far she walks; she sits when told to stay or when riding, eats her treats with
// the mod's drinking animations (then hiccups), slumps when she dies, and the Bloatberry girl's
// growth transitions play as her belly reaches the next size. Every pregnancy and scene pose
// (minepreggo:pose) has an animation of hers: her own where she has one (holding her belly, sitting
// with it), the rest solved onto her rig (tools/lib/goblins-poses.mjs), her baby crowning between
// her thighs during the birth (tools/lib/crowning.mjs).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { crowningLines } from './lib/crowning.mjs';
import { stringifyEntity } from './lib/entity-json.mjs';
import { FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, POSES, bellyPreAnimation, initializers, phaseEvents } from './lib/belly-render.mjs';
import { GOBLIN_RIGS, goblinCrowning, goblinPoseAnimations, ownPose } from './lib/goblins-poses.mjs';
import { walkJiggleAnimation } from './lib/walk-jiggle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'goblins_port';
const NS = 'expandable_goblins';
const VENDOR = join(ROOT, 'vendor/goblins');
const LANG_HEADER = '## Expandable Goblins (vendor/goblins, tools/import-goblins.mjs)';

const write = (/** @type {string} */ path, /** @type {string | Uint8Array} */ data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};
const writeJson = (/** @type {string} */ path, /** @type {unknown} */ doc) => write(path, JSON.stringify(doc, null, 2) + '\n');

// ---- clean what the last run wrote -------------------------------------------------------------
for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(RP, 'entity', PORT), join(RP, 'models/entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) {
  rmSync(dir, { recursive: true, force: true });
}
// (only her own section, up to the next importer's header, so running this alone keeps theirs)
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at < 0) continue;
  const next = text.indexOf('\n## ', at + LANG_HEADER.length);
  writeFileSync(path, (text.slice(0, at) + (next >= 0 ? text.slice(next + 1) : '')).replace(/\n*$/, '\n'));
}

const jarFile = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => /^expandable_goblins.*\.jar$/.test(f)) : undefined;
if (!jarFile) {
  console.log('Expandable Goblins: not in vendor/goblins/, so not merged');
  process.exit(0);
}
const jar = unzipSync(new Uint8Array(readFileSync(join(VENDOR, jarFile))));
const asset = (/** @type {string} */ path) => {
  const data = jar[`assets/${NS}/${path}`];
  if (!data) throw new Error(`Expandable Goblins: ${path} missing from ${jarFile}`);
  return data;
};
const assetJson = (/** @type {string} */ path) => JSON.parse(strFromU8(asset(path)));

/** The mod's labor animations come from the humanoid creeper girl (a plain standing humanoid), as for the Jenny girls. */
const creeper = (() => {
  const geometryFile = join(RP, 'models/entity', MOD, 'humanoid_creeper_girl.geo.json');
  const animationFile = join(RP, 'animations', MOD, 'humanoid_creeper_girl.animation.json');
  if (!existsSync(geometryFile) || !existsSync(animationFile)) throw new Error('the humanoid creeper girl is missing: run tools/import-jar.mjs first');
  const prefix = `animation.${MOD}.humanoid_creeper_girl.`;
  const animations = Object.fromEntries(Object.entries(JSON.parse(readFileSync(animationFile, 'utf8')).animations).map(([k, v]) => [k.startsWith(prefix) ? k.slice(prefix.length) : k, v]));
  return { geometry: JSON.parse(readFileSync(geometryFile, 'utf8'))['minecraft:geometry'][0], animations };
})();

/**
 * @typedef {object} Girl
 * @property {string} id @property {string} file her model and animation files @property {string} name
 * @property {string[]} egg @property {string[]} skins the body skins @property {Record<string, string[]>} layers the layers drawn over them
 * @property {string[]} belly the bones of her belly from the smallest (always shown) outwards
 * @property {'goblin' | 'berry'} rig her rig (tools/lib/goblins-poses.mjs)
 * @property {string[]} sizes Molang conditions of her sizes, smallest first (the last is the rest): the mod's fullness levels, as belly sizes
 * @property {Record<string, (string | null)[]>} moves her animations by size: idle, walk, sit and the rest she has (attack, eat, eat_sitting, hiccup, grow)
 * @property {string} [death] what she plays when she dies
 * @property {number} stride animation seconds per unit of q.modified_distance_moved (her steps for her leg length)
 * @property {boolean} lookAt her head follows what she looks at (the mod turns her head bone)
 * @property {Record<string, { animation: string, bones?: string[] } | { solved: string, bones?: string[] } | { sizes: 'sit' }>} own the poses
 *   played by one of her own animations (all of it or some of its bones), by a solved pose (some of its bones), or by her sit of her size
 * @property {string[]} hidden @property {any} jiggle @property {number} jiggleStrength
 * @property {number[]} size her collision box (width, height), as the mod's
 * @property {string[]} biomes @property {string[]} treats what tames her (and what she eats once tamed)
 */

/** The mod's sounds its animations play, as the game's own (the mod's sounds are not merged): her gulps. */
const SOUNDS = /** @type {Record<string, string>} */ ({ gulps1: 'random.drink' });

/** The goblin and imp girls: by size, not pregnant, a soft tummy (P0-P1), a growing belly (P2-P5), a big one (P6-P8), about to give birth (P9). */
const GOBLIN_SIZES = ['v.bp < 0', 'v.bp <= 1', 'v.bp <= 5', 'v.bp <= 8', 'true'];
const GOBLIN_MOVES = {
  // the mod's fullness 0 to 4 (idle_d2, resting on the ground with her belly, is its fullest)
  idle: ['idle', 'idle_b', 'idle_c', 'idle_d', 'idle_d2'],
  walk: ['walk_a', 'walk_b', 'walk_c', 'walk_d', 'walk_d'],
  sit: ['sit1', 'sit2', 'sit3', 'sit4', 'sit4'],
  attack: ['attack1', 'attack2', 'attack3', 'attack4', 'attack4'],
  // her beer in the mod, here her treats (drink5 ends on the ground, where her fullest idle rests)
  eat: ['drink1', 'drink2', 'drink3', 'drink3', 'drink5'],
  eat_sitting: ['drink1a', 'drink2a', 'drink3a', 'drink4b', 'drink4a'],
  hiccup: ['hic1', 'hic2', 'hic3', 'hic3', 'hic4'],
};
/** Her arms and head in her own belly idle: she holds her belly while the babies move, walking or not. */
const GOBLIN_BELLY_HOLD = ['arm1', 'bone3', 'arm2', 'bone4', 'neck'];

/** @type {Girl[]} */
const GIRLS = [
  {
    id: 'goblin_girl', file: 'goblin', name: 'Goblin Girl', egg: ['#5d8f3a', '#c9a46b'],
    skins: ['goblin0', 'goblin1', 'goblin2', 'goblin3', 'goblin4'],
    layers: { hair: ['hair0', 'hair1', 'hair2', 'hair3', 'hair4', 'hair5', 'hair6', 'hair7', 'hair8', 'hair9', 'hair10', 'hair11'], eyes: ['eye0', 'eye1', 'eye2', 'eye3', 'eye4', 'eye5'], cloth: ['cloth0', 'cloth1', 'cloth2', 'cloth3'] },
    belly: ['belly1', 'belly2', 'belly3'], rig: 'goblin', sizes: GOBLIN_SIZES, moves: GOBLIN_MOVES, death: 'idle2', stride: 0.06, lookAt: true,
    own: { fetal_movement: { animation: 'idle_belly', bones: GOBLIN_BELLY_HOLD }, belly_rubs: { animation: 'idle_belly' }, kicking_sit: { sizes: 'sit' } },
    hidden: ['bottle'], jiggle: { chest: ['tits'], breasts: ['tit6', 'tit5'], belly: ['belly1'] }, jiggleStrength: 0.8, size: [0.6, 1.4],
    biomes: ['forest', 'plains', 'taiga'], treats: ['minecraft:sweet_berries', 'minecraft:glow_berries', 'minecraft:cake'],
  },
  {
    id: 'imp_girl', file: 'imp', name: 'Imp Girl', egg: ['#9b2a2a', '#3b1c2c'],
    skins: ['imp0', 'imp1', 'imp2', 'imp3', 'imp4', 'imp5', 'imp6', 'imp7', 'imp8'],
    layers: { hair: ['imphair1', 'imphair2', 'imphair3', 'imphair4', 'imphair5', 'imphair6', 'imphair7', 'imphair8', 'imphair9', 'imphair10', 'imphair11', 'imphair12'], eyes: ['eye0', 'eye1', 'eye2', 'eye3', 'eye4', 'eye5'], cloth: ['cloth1_imp', 'cloth3_imp', 'cloth4_imp', 'cloth5_imp'] },
    belly: ['belly1', 'belly2', 'belly3'], rig: 'goblin', sizes: GOBLIN_SIZES, moves: GOBLIN_MOVES, death: 'idle2', stride: 0.06, lookAt: true,
    own: { fetal_movement: { animation: 'idle_belly', bones: GOBLIN_BELLY_HOLD }, belly_rubs: { animation: 'idle_belly' }, kicking_sit: { sizes: 'sit' } },
    hidden: ['bottle'], jiggle: { chest: ['tits'], breasts: ['tit6', 'tit5'], belly: ['belly1'] }, jiggleStrength: 0.8, size: [0.6, 1.4],
    biomes: ['nether_wastes', 'crimson_forest', 'soulsand_valley'], treats: ['minecraft:sweet_berries', 'minecraft:glow_berries', 'minecraft:cake'],
  },
  {
    id: 'bloatberry_girl', file: 'berry', name: 'Bloatberry Girl', egg: ['#7a3fa0', '#e07ad0'],
    skins: ['berrygal', 'berrygal_a', 'berrygal_b', 'berrygal_c'],
    layers: {},
    // the mod's sizes 0, 1 and 2+: a small belly (to P1), a big one (P2-P5), and so big she sits to rest (P6-P9)
    belly: ['belly', 'belly2'], rig: 'berry', sizes: ['v.bp < 2', 'v.bp <= 5', 'true'],
    moves: { idle: ['idle1', 'idle2', 'sit3'], walk: ['walk1', 'walk2', 'walk2'], sit: ['sit1', 'sit2', 'sit3'], grow: [null, 'transit', 'transit1'] },
    stride: 0.12, lookAt: false,
    // her own animations hold no belly: the belly hold, her arms and head only while the babies move (so she walks on)
    own: { fetal_movement: { solved: 'belly_hold', bones: ['leftlarm', 'rightarm', 'neck'] }, belly_rubs: { solved: 'belly_hold' }, kicking_sit: { sizes: 'sit' } },
    hidden: [], jiggle: { chest: ['tit3'], belly: ['belly'] }, jiggleStrength: 0.6, size: [0.35, 0.65],
    biomes: ['forest', 'flower_forest', 'birch'], treats: ['minecraft:sweet_berries', 'minecraft:glow_berries', 'minecraft:cake'],
  },
];

/**
 * GeckoLib keyframes hold {vector, easing, lerp_mode}; Bedrock takes the vector, eased linearly, or
 * catmull-rom when constant (the mod's catmull-rom keyframes, and its ease-in-out ones, the curve
 * Bedrock has that is closest to them).
 */
function frame(/** @type {any} */ value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if ('vector' in value) {
    const v = value.vector;
    const constant = [v].flat().every((c) => typeof c === 'number');
    const smooth = value.lerp_mode === 'catmullrom' || /^easeInOut/.test(value.easing ?? '');
    return smooth && constant ? { post: v, lerp_mode: 'catmullrom' } : v;
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === 'pre' || k === 'post' ? frame(v) : v;
  if (out.lerp_mode === 'catmullrom' && [out.pre, out.post].flat().some((c) => typeof c === 'string')) delete out.lerp_mode;
  return out;
}
function channel(/** @type {any} */ value) {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return value;
  if ('vector' in value) return frame(value).post ?? frame(value);
  const frames = Object.fromEntries(Object.entries(value).map(([t, f]) => [t, frame(f)]));
  // catmull-rom needs every keyframe of the channel constant (the game refuses the animation otherwise)
  const molang = Object.values(frames).some((f) => [Array.isArray(f) ? f : [f?.pre, f?.post]].flat(2).some((c) => typeof c === 'string'));
  if (molang) for (const [t, f] of Object.entries(frames)) if (f && typeof f === 'object' && !Array.isArray(f) && f.lerp_mode) frames[t] = f.post ?? f.pre;
  return frames;
}

/** Her belly through the phases: the smallest cube is her waist; the next ones swell out of it, and are gone once she has given birth. */
function bellyAnimation(/** @type {string[]} */ bones) {
  /** @type {Record<string, any>} */
  const out = {};
  // growth within a phase (0..1) eases the size towards the next one
  const at = (/** @type {number} */ from, /** @type {number} */ step, /** @type {number} */ top) => `math.min(${top}, ${from} + ${step} * (v.bp - %S + v.belly_growth))`;
  const born = "!(v.pose == 'postbirth')";
  // the smallest cube: a soft tummy from the first phase (hidden when she is not pregnant, as the mod hides it)
  out[bones[0]] = { scale: `v.bp >= 0 ? math.min(1.0, 0.7 + 0.15 * (v.bp + v.belly_growth)) : 0.0` };
  if (bones.length === 3) {
    // (each cube hangs under the one before, so its scale multiplies theirs)
    out[bones[1]] = { scale: `v.bp >= 2 && ${born} ? ${at(0.45, 0.1, 1.0).replace('%S', '2')} : 0.0` };
    out[bones[2]] = { scale: `v.bp >= 6 && ${born} ? ${at(0.6, 0.07, 0.86).replace('%S', '6')} : 0.0` };
  } else {
    out[bones[1]] = { scale: `v.bp >= 2 && ${born} ? ${at(0.5, 0.09, 1.15).replace('%S', '2')} : 0.0` };
  }
  return { loop: true, bones: out };
}

/**
 * The babies moving her belly, in her own skin: the outermost shown cube moves in five ways that
 * take turns on a 30 s cycle (as the other bellies' kicks do, tools/lib/belly-render.mjs): a kick
 * (it swells and lifts), a roll (it sways across as the baby turns), a stretch (a push held
 * forward), hiccups (small rhythmic jolts) and a flutter (quick little stirs). Small amounts, so the
 * belly moves without stretching out of shape.
 */
function kickAnimation(/** @type {string[]} */ bones) {
  const t = 'math.mod(q.life_time, 30.0)';
  const w = (/** @type {number} */ i) => `math.clamp(math.min(${t} - ${(i * 6).toFixed(1)}, ${((i + 1) * 6).toFixed(1)} - ${t}), 0.0, 1.0)`;
  const kick = `${w(0)} * math.pow(math.max(0.0, math.sin(q.life_time * (90.0 + 30.0 * v.kick_shown))), 3.0)`;
  const roll = `${w(1)} * math.sin(q.life_time * 72.0)`;
  const stretch = `${w(2)} * math.clamp(1.6 * math.sin(q.life_time * 90.0) - 0.5, 0.0, 1.0)`;
  const hiccups = `${w(3)} * math.pow(math.max(0.0, math.sin(q.life_time * 330.0)), 10.0)`;
  const flutter = `${w(4)} * math.pow(math.max(0.0, math.sin(q.life_time * 260.0)), 4.0)`;
  const k = (/** @type {string} */ when, /** @type {string} */ expr, /** @type {string} */ rest) => `${when} ? ${expr} : ${rest}`;
  /** @type {Record<string, any>} */
  const out = {};
  /** @param {string} bone @param {string} when */
  const moves = (bone, when) => {
    out[bone] = {
      position: [k(when, `(0.4 * ${roll} + 0.1 * ${flutter}) * v.kick_w`, '0.0'), k(when, `(0.2 * ${kick} + 0.08 * ${hiccups}) * v.kick_w`, '0.0'), k(when, `-(0.45 * ${kick} + 0.35 * ${stretch} + 0.15 * ${hiccups} + 0.12 * ${flutter}) * v.kick_w`, '0.0')],
      rotation: [0, 0, k(when, `5.0 * ${roll} * v.kick_w`, '0.0')],
      scale: [k(when, `1.0 + (0.04 * ${kick} + 0.03 * ${stretch}) * v.kick_w`, '1.0'), k(when, `1.0 + (0.02 * ${kick} + 0.05 * ${stretch}) * v.kick_w`, '1.0'), k(when, `1.0 + (0.07 * ${kick} + 0.05 * ${stretch} + 0.03 * ${hiccups}) * v.kick_w`, '1.0')],
    };
  };
  if (bones.length === 3) {
    moves(bones[2], 'v.bp >= 6');
    // before the outer cube shows, the middle one moves
    moves(bones[1], '(v.bp >= 3 && v.bp < 6)');
  } else moves(bones[1], 'v.bp >= 3');
  return { loop: true, bones: out };
}

/** Her belly tightens in waves during contractions and labor. */
function contractionAnimation(/** @type {string[]} */ bones) {
  const wave = '(v.cw * (0.5 - 0.5 * math.cos(q.life_time * 60.0)))';
  const outer = bones.length === 3 ? bones[2] : bones[1];
  return { loop: true, bones: { [outer]: { scale: [`1.0 - 0.04 * ${wave}`, `1.0 + 0.05 * ${wave}`, `1.0 - 0.03 * ${wave}`] } } };
}

/** Her belly bears down with each push of the birth. */
function laborAnimation(/** @type {string[]} */ bones) {
  const outer = bones.length === 3 ? bones[2] : bones[1];
  return { loop: true, bones: { [outer]: { scale: ['1.0 + 0.05 * v.push', '1.0 - 0.04 * v.push', '1.0 + 0.08 * v.push + 0.03 * math.max(0.0, math.sin(q.anim_time * 600.0))'] } } };
}

/**
 * During a birth her belly goes on from its prebirth size and shrinks as each baby comes out
 * (v.push is the birth progress), instead of growing with the progress (as the Jenny girls' do).
 */
const birthBelly = (/** @type {string} */ line) =>
  line.replace(/^(v\.belly_growth = .*) \* q\.property\('minepreggo:growth'\);$/, "$1 * (v.pose == 'birth' ? 1.0 - v.push : q.property('minepreggo:growth'));");

/** Molang: which of her sizes she is (0 smallest), from the size conditions. */
function sizeExpression(/** @type {string[]} */ sizes) {
  let expr = String(sizes.length - 1);
  for (let i = sizes.length - 2; i >= 0; i--) expr = `${sizes[i]} ? ${i} : (${expr})`;
  return expr;
}

/**
 * A state's animations for her size: each animation once, weighted by the sizes it plays at (and a
 * factor). `short` names them in the entity's animations map.
 * @param {(string | null)[]} names by size @param {(name: string) => string} short @param {string} [factor]
 */
function bySize(names, short, factor) {
  /** @type {Map<string, number[]>} */
  const sizes = new Map();
  names.forEach((name, i) => { if (name) sizes.set(name, [...(sizes.get(name) ?? []), i]); });
  return [...sizes].map(([name, at]) => {
    const when = at.length === names.length ? '1.0' : at.map((i) => `v.size == ${i}`).join(' || ');
    return { [short(name)]: factor ? (when === '1.0' ? factor : `(${when}) * ${factor}`) : when };
  });
}

const textures = new Set();
const lang = [LANG_HEADER];
let animationCount = 0;
let poseCount = 0;
/** @type {Record<string, unknown>} */
const renderControllers = {};
/** @type {Record<string, unknown>} */
const controllers = {};

for (const girl of GIRLS) {
  const id = `${NS}:${girl.id}`;
  const slug = girl.id;
  const parts = GOBLIN_RIGS[girl.rig];
  // ---- geometry and animations ----
  const geoDoc = assetJson(`geo/${girl.file}.geo.json`);
  const geometry = geoDoc['minecraft:geometry'][0];
  const geometryId = `geometry.${NS}.${slug}`;
  geometry.description.identifier = geometryId;
  writeJson(join(RP, 'models/entity', PORT, `${slug}.geo.json`), { format_version: '1.12.0', 'minecraft:geometry': [geometry] });
  const bones = new Set(geometry.bones.map((/** @type {any} */ b) => b.name));
  const source = assetJson(`animations/${girl.file}.animation.json`).animations;
  /** @type {Record<string, any>} */
  const animations = {};
  const animId = (/** @type {string} */ name) => `animation.${NS}.${slug}.${name}`;
  // GeckoLib loops what her movement controller plays (RawAnimation.thenLoop) whatever its file
  // says; her attacks play once, and so does what her procedures play (drinking, hiccups, growing)
  // unless the file loops it.
  const looping = new Set(['idle', 'walk', 'sit'].flatMap((m) => girl.moves[m] ?? []).filter(Boolean));
  if (girl.death) looping.add(girl.death);
  const walks = new Set(girl.moves.walk);
  // Her own animations size her belly by how bloated she is (scaled away when she is not): the
  // pregnancy decides its size here, so their belly scales go and only their sway stays.
  const bellyBones = new Set([...girl.belly, 'navel']);
  for (const [name, def] of Object.entries(source)) {
    const keep = (/** @type {string} */ bone, /** @type {string} */ k) => !(bellyBones.has(bone) && k === 'scale');
    const out = { ...def, bones: Object.fromEntries(Object.entries(def.bones ?? {}).filter(([bone]) => bones.has(bone)).map(([bone, ch]) => [bone, Object.fromEntries(Object.entries(/** @type {any} */ (ch)).filter(([k]) => keep(bone, k)).map(([k, v]) => [k, channel(v)]))]).filter(([, ch]) => Object.keys(ch).length)) };
    if (!Object.keys(out.bones).length) continue;
    // the sounds it plays that she has, mapped below (the mod's particles are not merged)
    delete out.particle_effects;
    if (out.sound_effects) {
      const kept = Object.entries(out.sound_effects).filter(([, k]) => [k].flat().every((e) => SOUNDS[e?.effect]));
      if (kept.length) out.sound_effects = Object.fromEntries(kept);
      else delete out.sound_effects;
    }
    if (looping.has(name)) out.loop = true;
    // Her walk advances with the distance she walks (the vanilla walk's q.modified_distance_moved),
    // at the mod's own pace for her steps, so her feet keep up however fast she goes and stop with her.
    if (walks.has(name)) out.anim_time_update = `q.modified_distance_moved * ${girl.stride}`;
    // An attack takes over the bones it moves, as the mod's attack controller does.
    if ((girl.moves.attack ?? []).includes(name)) out.override_previous_animation = true;
    animations[animId(name)] = out;
    animationCount++;
  }
  const has = (/** @type {string | null} */ name) => !!name && !!animations[animId(name)];
  for (const [move, names] of Object.entries(girl.moves)) for (const name of names) if (name && !has(name)) throw new Error(`${slug}: her ${move} animation ${name} is missing from ${girl.file}.animation.json`);
  animations[animId('mp_belly')] = bellyAnimation(girl.belly);
  animations[animId('mp_kicks')] = kickAnimation(girl.belly);
  animations[animId('mp_contraction')] = contractionAnimation(girl.belly);
  animations[animId('mp_push')] = laborAnimation(girl.belly);
  // her chest and belly bounce as she walks (tools/lib/walk-jiggle.mjs), a little less on a smaller body
  animations[animId('mp_walk_jiggle')] = walkJiggleAnimation(girl.jiggle, { strength: girl.jiggleStrength });
  if (girl.hidden.length) animations[animId('mp_hidden')] = { loop: true, bones: Object.fromEntries(girl.hidden.map((b) => [b, { scale: 0 }])) };

  // ---- her pregnancy and scene poses: her own where she has them, the rest solved onto her rig ----
  const idle = animations[animId(girl.moves.idle[0] ?? '')];
  const solved = goblinPoseAnimations({ geometry, parts, idle, sourceGeometry: creeper.geometry, sourceAnimations: creeper.animations, prefix: animId('mp_pose') });
  /** @type {Record<string, (string | Record<string, string>)[]>} pose -> what its state plays (short names) */
  const poseStates = {};
  /** @type {Record<string, string>} short name -> animation id */
  const poseAnimations = {};
  for (const pose of POSES.filter((p) => p !== 'none')) {
    const own = girl.own[pose];
    if (own && 'sizes' in own) {
      // her own sit of her size, taking over from her walk and idle
      const names = girl.moves[own.sizes];
      for (const name of new Set(names)) if (name) animations[animId(`mp_pose_${pose}_${name}`)] = ownPose(animations[animId(name)]);
      poseStates[pose] = bySize(names, (name) => `pose_${pose}_${name}`);
      for (const name of new Set(names)) if (name) poseAnimations[`pose_${pose}_${name}`] = animId(`mp_pose_${pose}_${name}`);
    } else {
      const animation = !own ? solved[pose]?.animation : 'solved' in own ? ownPose(solved[own.solved].animation, own.bones) : ownPose(animations[animId(own.animation)], own.bones);
      if (!animation) throw new Error(`${slug}: no animation for the ${pose} pose`);
      animations[animId(`mp_pose_${pose}`)] = animation;
      poseStates[pose] = [`pose_${pose}`];
      poseAnimations[`pose_${pose}`] = animId(`mp_pose_${pose}`);
    }
    poseCount++;
  }
  // her baby crowns between her thighs with each push of her birth, in step with it (the mod's birth on her back)
  poseStates.birth.push('crowning');
  const crown = goblinCrowning(geometry, parts, `geometry.${NS}.${slug}.crowning`);
  writeJson(join(RP, 'models/entity', PORT, `${slug}_crowning.geo.json`), crown.doc);

  // ---- what she plays when ----
  const move = (/** @type {string} */ name) => `m_${name}`;
  /** @type {Record<string, string>} */
  const moveAnimations = {};
  for (const names of Object.values(girl.moves)) for (const name of names) if (name) moveAnimations[move(name)] = animId(name);
  if (girl.death) moveAnimations[move(girl.death)] = animId(girl.death);
  const sizes = girl.sizes.map((_, i) => i);
  const eats = !!girl.moves.eat;
  const dies = girl.death ? [{ death: '!q.is_alive' }] : [];
  // she eats her treat (tamed, fed by her owner), standing or sitting, then hiccups when standing
  const eatStanding = eats ? sizes.map((i) => ({ [`eat_${i}`]: `v.eating && v.size == ${i}` })) : [];
  const eatSitting = eats ? sizes.map((i) => ({ [`eat_sitting_${i}`]: `v.eating && v.size == ${i}` })) : [];
  /** @type {Record<string, any>} */
  const states = {
    idle: { animations: bySize(girl.moves.idle, move), transitions: [...dies, ...eatStanding, { sit: 'q.is_sitting || q.is_riding' }, { walk: 'q.modified_move_speed > 0.1' }], blend_transition: 0.25 },
    // her walk weighs in with her speed over her idle, so she eases into it and out of it
    walk: { animations: [...bySize(girl.moves.idle, move, '(1.0 - v.walk_w)'), ...bySize(girl.moves.walk, move, 'v.walk_w')], transitions: [...dies, ...eatStanding, { sit: 'q.is_sitting || q.is_riding' }, { idle: 'q.modified_move_speed < 0.05' }], blend_transition: 0.25 },
    sit: { animations: bySize(girl.moves.sit, move), transitions: [...dies, ...eatSitting, { idle: '!q.is_sitting && !q.is_riding' }], blend_transition: 0.3 },
  };
  if (eats) {
    for (const i of sizes) {
      states[`eat_${i}`] = { animations: [move(girl.moves.eat[i] ?? '')], transitions: [...dies, { [`hiccup_${i}`]: 'q.all_animations_finished' }], blend_transition: 0.2 };
      states[`hiccup_${i}`] = { animations: [move(girl.moves.hiccup[i] ?? '')], transitions: [...dies, { idle: 'q.all_animations_finished || q.modified_move_speed > 0.1' }], blend_transition: 0.3 };
      states[`eat_sitting_${i}`] = { animations: [move(girl.moves.eat_sitting[i] ?? '')], transitions: [...dies, { sit: 'q.all_animations_finished' }], blend_transition: 0.2 };
    }
  }
  if (girl.death) states.death = { animations: [move(girl.death)], transitions: [{ idle: 'q.is_alive' }], blend_transition: 0.2 };
  const controllerId = (/** @type {string} */ kind) => `controller.animation.${NS}.${slug}.${kind}`;
  controllers[controllerId('move')] = { initial_state: 'idle', states };
  /** @type {Record<string, string>} */
  const controllerNames = { move_controller: controllerId('move') };
  if (girl.moves.attack) {
    // her swing (v.attack_time, the game's melee swing), with her attack of her size
    /** @type {Record<string, any>} */
    const attack = { default: { transitions: sizes.map((i) => ({ [`attacking_${i}`]: `v.attack_time > 0.0 && v.size == ${i}` })) } };
    for (const i of sizes) attack[`attacking_${i}`] = { animations: [move(girl.moves.attack[i] ?? '')], transitions: [{ default: 'q.all_animations_finished' }], blend_transition: 0.1 };
    controllers[controllerId('attack')] = { initial_state: 'default', states: attack };
    controllerNames.attack_controller = controllerId('attack');
  }
  if (girl.moves.grow) {
    // her belly reaching the next size, as the mod's feeding grows her (not when she is first seen)
    /** @type {Record<string, any>} */
    const grow = {};
    for (const i of sizes) {
      grow[`size_${i}`] = {
        transitions: sizes.filter((j) => j !== i).flatMap((j) => [
          ...(j === i + 1 && girl.moves.grow[j] ? [{ [`growing_${j}`]: `v.size == ${j} && q.life_time > 3.0` }] : []),
          { [`size_${j}`]: `v.size == ${j}` },
        ]),
      };
      if (girl.moves.grow[i]) grow[`growing_${i}`] = { animations: [move(`grow_${girl.moves.grow[i]}`)], transitions: [{ [`size_${i}`]: 'q.all_animations_finished || !(v.pose == \'none\')' }], blend_transition: 0.3 };
    }
    for (const name of girl.moves.grow) {
      if (!name) continue;
      animations[animId(`mp_grow_${name}`)] = { ...animations[animId(name)], loop: false, override_previous_animation: true };
      moveAnimations[move(`grow_${name}`)] = animId(`mp_grow_${name}`);
    }
    controllers[controllerId('grow')] = { initial_state: 'size_0', states: grow };
    controllerNames.grow_controller = controllerId('grow');
  }
  // one state per pose, cross-faded in and out
  /** @type {Record<string, any>} */
  const poseController = { default: { transitions: Object.keys(poseStates).map((pose) => ({ [pose]: `v.pose == '${pose}'` })) } };
  for (const [pose, list] of Object.entries(poseStates)) poseController[pose] = { animations: list, transitions: [{ default: `!(v.pose == '${pose}')` }], blend_transition: 0.4 };
  controllers[controllerId('pose')] = { initial_state: 'default', states: poseController };
  controllerNames.pose_controller = controllerId('pose');
  writeJson(join(RP, 'animations', PORT, `${slug}.animation.json`), { format_version: '1.8.0', animations });

  // ---- skins: the body and its layers, picked once per girl ----
  const copy = (/** @type {string} */ name) => {
    const path = `textures/${PORT}/${name}`;
    if (!textures.has(name)) write(join(RP, `${path}.png`), asset(`textures/entities/${name}.png`));
    textures.add(name);
    return path;
  };
  /** @type {Record<string, string>} */
  const textureMap = {};
  girl.skins.forEach((s, i) => (textureMap[`skin${i}`] = copy(s)));
  const layerNames = Object.keys(girl.layers);
  for (const layer of layerNames) /** @type {string[]} */ (girl.layers[layer]).forEach((s, i) => (textureMap[`${layer}${i}`] = copy(s)));
  const rcBase = `controller.render.${NS}.${slug}`;
  const skins = { 'Array.skins': girl.skins.map((_, i) => `Texture.skin${i}`) };
  renderControllers[rcBase] = { arrays: { textures: skins }, geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Array.skins[q.variant]'] };
  /** @type {any[]} */
  const rcs = [rcBase];
  // each layer is the same model drawn again with its overlay (GeckoLib's layer renderers), picked by
  // the girl's mark variant and skin id
  layerNames.forEach((layer, n) => {
    const list = /** @type {string[]} */ (girl.layers[layer]);
    const pick = n === 0 ? 'q.mark_variant' : n === 1 ? 'math.mod(q.skin_id, ' + list.length + ')' : 'math.mod(q.mark_variant + q.skin_id, ' + list.length + ')';
    renderControllers[`${rcBase}.${layer}`] = {
      arrays: { textures: { [`Array.${layer}`]: list.map((_, i) => `Texture.${layer}${i}`) } },
      geometry: 'Geometry.default', materials: [{ '*': 'Material.layer' }], textures: [`Array.${layer}[${pick}]`],
    };
    rcs.push(`${rcBase}.${layer}`);
  });
  // her baby, in her own skin, only while it crowns
  renderControllers[`${rcBase}.crowning`] = { arrays: { textures: skins }, geometry: 'Geometry.crowning', materials: [{ '*': 'Material.default' }], textures: ['Array.skins[q.variant]'] };
  rcs.push({ [`${rcBase}.crowning`]: 'v.crowning' });
  const pre = [
    ...bellyPreAnimation().map(birthBelly),
    `v.size = ${sizeExpression(girl.sizes)};`,
    'v.walk_w = math.clamp(q.modified_move_speed * 4.0, 0.0, 1.0);',
    ...(eats ? [`v.eating = q.property('${NS}:eating');`] : []),
    ...crowningLines({ when: "v.pose == 'birth'", scale: crown.scale }),
  ];
  writeJson(join(RP, 'entity', PORT, `${slug}.entity.json`), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: 'entity_alphatest', layer: 'entity_alphatest' },
        textures: textureMap,
        geometry: { default: geometryId, crowning: `geometry.${NS}.${slug}.crowning` },
        animations: {
          ...moveAnimations,
          ...controllerNames,
          ...poseAnimations,
          crowning: `animation.${MOD}.crowning`,
          belly: animId('mp_belly'), kicks: animId('mp_kicks'), contraction: animId('mp_contraction'), push: animId('mp_push'), walk_jiggle: animId('mp_walk_jiggle'),
          ...(girl.hidden.length ? { hidden: animId('mp_hidden') } : {}),
          ...(girl.lookAt ? { look_at_target: 'animation.common.look_at_target' } : {}),
        },
        scripts: {
          initialize: initializers(pre, []),
          pre_animation: pre,
          // What takes over her bones (her attack, growing, the poses) sets them back to their rest
          // pose first, their scale too: her belly's size, its kicks and her hidden bottle come after.
          animate: [
            'move_controller',
            ...(controllerNames.attack_controller ? ['attack_controller'] : []),
            ...(controllerNames.grow_controller ? ['grow_controller'] : []),
            ...(girl.lookAt ? [{ look_at_target: "q.is_alive && (v.pose == 'none' || v.pose == 'belly_rubs')" }] : []),
            'pose_controller',
            'belly', { kicks: 'v.kick_w' }, 'contraction', { push: "v.pose == 'birth'" }, 'walk_jiggle',
            ...(girl.hidden.length ? ['hidden'] : []),
          ],
        },
        render_controllers: rcs,
        ...(Object.values(animations).some((a) => a.sound_effects) ? { sound_effects: Object.fromEntries(Object.entries(SOUNDS).map(([name, event]) => [name, { effect: event }])) } : {}),
        spawn_egg: { base_color: girl.egg[0], overlay_color: girl.egg[1] },
      },
    },
  });

  // ---- the behaviour: a woman of the wilds, tamed with her treats, in the mob system ----
  const variants = (/** @type {string} */ kind, /** @type {number} */ count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${NS}:${kind}_${i}`, { [`minecraft:${kind}`]: { value: i } }]));
  const markCount = layerNames.length ? /** @type {string[]} */ (girl.layers[layerNames[0]]).length : 1;
  const fights = !!girl.moves.attack;
  // As in the mod, the goblin and imp girls fight back when hurt and for their owner (not when far
  // along or in labor); they do not hunt players here. The Bloatberry girl runs.
  const calm = { all_of: [{ test: 'enum_property', subject: 'self', domain: `${MOD}:pose`, value: 'none' }, { test: 'int_property', subject: 'self', domain: `${MOD}:phase`, operator: '<', value: 7 }] };
  const eating = { [`${NS}:eating`]: { 'minecraft:timer': { looping: false, time: 1.0, time_down_event: { event: `${NS}:eaten`, target: 'self' } } } };
  write(join(BP, 'entities', PORT, `${slug}.json`), stringifyEntity({
    format_version: '1.21.0',
    'minecraft:entity': {
      description: {
        identifier: id, is_spawnable: true, is_summonable: true,
        properties: { ...MINEPREGGO_PROPERTIES, ...(eats ? { [`${NS}:eating`]: { type: 'bool', default: false, client_sync: true } } : {}) },
      },
      component_groups: {
        ...variants('variant', girl.skins.length),
        ...variants('mark_variant', markCount),
        ...variants('skin_id', 6),
        [`${NS}:wild`]: {
          'minecraft:tameable': { probability: 0.33, tame_items: girl.treats, tame_event: { event: `${NS}:on_tame`, target: 'self' } },
          'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 0.8 },
        },
        [`${NS}:tamed`]: {
          'minecraft:is_tamed': {},
          'minecraft:sittable': {},
          'minecraft:behavior.follow_owner': { priority: 4, speed_multiplier: 1.0, start_distance: 8, stop_distance: 2 },
          'minecraft:behavior.random_stroll': { priority: 7, speed_multiplier: 0.6 },
          ...(fights ? { 'minecraft:behavior.owner_hurt_by_target': { priority: 2 }, 'minecraft:behavior.owner_hurt_target': { priority: 3 } } : {}),
          ...(eats ? {
            'minecraft:interact': {
              interactions: [{
                on_interact: { filters: { all_of: [{ test: 'is_family', subject: 'other', value: 'player' }, { any_of: girl.treats.map((item) => ({ test: 'has_equipment', subject: 'other', domain: 'hand', value: item })) }] }, event: `${NS}:eat`, target: 'self' },
                use_item: true, swing: true, interact_text: 'action.interact.feed',
              }],
            },
          } : {}),
        },
        ...(eats ? eating : {}),
      },
      components: {
        'minecraft:type_family': { family: ['goblin_girl', girl.id, 'mob', FAMILY_TAG] },
        'minecraft:health': { value: 20, max: 20 },
        'minecraft:collision_box': { width: girl.size[0], height: girl.size[1] },
        'minecraft:movement': { value: 0.25 },
        'minecraft:movement.basic': {},
        'minecraft:navigation.walk': { can_path_over_water: true, avoid_damage_blocks: true },
        'minecraft:jump.static': {},
        'minecraft:can_climb': {},
        'minecraft:physics': {},
        'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
        'minecraft:nameable': {},
        'minecraft:persistent': {},
        'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
        'minecraft:behavior.float': { priority: 0 },
        ...(fights
          ? {
            'minecraft:attack': { damage: 3 },
            'minecraft:behavior.hurt_by_target': { priority: 1, entity_types: [{ filters: calm, max_dist: 16 }] },
            'minecraft:behavior.melee_attack': { priority: 2, speed_multiplier: 1.2, track_target: true },
          }
          : { 'minecraft:behavior.panic': { priority: 1, speed_multiplier: 1.25 } }),
        'minecraft:behavior.look_at_player': { priority: 8, look_distance: 8, probability: 0.02 },
        'minecraft:behavior.random_look_around': { priority: 9 },
        ...(girl.id === 'imp_girl' ? { 'minecraft:fire_immune': {} } : {}),
      },
      events: {
        'minecraft:entity_spawned': {
          sequence: [
            { add: { component_groups: [`${NS}:wild`] } },
            { randomize: Array.from({ length: girl.skins.length }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:variant_${i}`] } })) },
            { randomize: Array.from({ length: markCount }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:mark_variant_${i}`] } })) },
            { randomize: Array.from({ length: 6 }, (_, i) => ({ weight: 1, add: { component_groups: [`${NS}:skin_id_${i}`] } })) },
          ],
        },
        // tamed with her treat, she eats it
        [`${NS}:on_tame`]: { remove: { component_groups: [`${NS}:wild`] }, add: { component_groups: [`${NS}:tamed`, ...(eats ? [`${NS}:eating`] : [])] }, ...(eats ? { set_property: { [`${NS}:eating`]: true } } : {}) },
        ...(eats ? {
          [`${NS}:eat`]: { add: { component_groups: [`${NS}:eating`] }, set_property: { [`${NS}:eating`]: true } },
          [`${NS}:eaten`]: { remove: { component_groups: [`${NS}:eating`] }, set_property: { [`${NS}:eating`]: false } },
        } : {}),
        ...phaseEvents(),
      },
    },
  }));
  writeJson(join(BP, 'spawn_rules', PORT, `${slug}.json`), {
    format_version: '1.8.0',
    'minecraft:spawn_rules': {
      description: { identifier: id, population_control: 'animal' },
      conditions: [{
        'minecraft:spawns_on_surface': {},
        ...(girl.id === 'imp_girl' ? { 'minecraft:spawns_underground': {} } : {}),
        'minecraft:brightness_filter': girl.id === 'imp_girl' ? { min: 0, max: 15, adjust_for_weather: false } : { min: 7, max: 15, adjust_for_weather: false },
        'minecraft:weight': { default: 4 },
        'minecraft:herd': { min_size: 1, max_size: 2 },
        'minecraft:density_limit': { surface: 2, underground: 2 },
        'minecraft:biome_filter': { any_of: girl.biomes.map((b) => ({ test: 'has_biome_tag', value: b })) },
      }],
    },
  });
  lang.push(`entity.${id}.name=${girl.name}`, `item.spawn_egg.entity.${id}.name=${girl.name} Spawn Egg`);
}
writeJson(join(RP, 'animation_controllers', PORT, 'goblins.animation_controllers.json'), { format_version: '1.10.0', animation_controllers: controllers });
writeJson(join(RP, 'render_controllers', PORT, 'goblins.render_controllers.json'), { format_version: '1.8.0', render_controllers: renderControllers });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`Expandable Goblins: ${GIRLS.length} girls, ${animationCount} animations, ${poseCount} pregnancy and scene poses, ${textures.size} textures`);
