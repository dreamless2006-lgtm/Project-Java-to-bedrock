// Jenny's Preggo Mobs: curvy versions of Minepreggo's own girls (the zombie, creeper and slime girls
// and the ender woman, from the models tools/import-jar.mjs converts), as mobs of their own beside the
// originals, built like the Jenny Mod's and InsanityV's women: wider hips and a rounded seat, thicker
// thighs, a fuller bust rounded off instead of a box, all of it jiggling as she walks, Jenny's own
// idle and walk, and the whole pregnancy of the imported girls (tools/lib/girl-port.mjs: a round belly
// fitted to her, kicks, the pregnancy and scene poses, a Jenny girl's birth). Made at import time from
// the imported models; nothing of them is committed.
//
// Run: node tools/import-jenny-preggo.mjs (part of npm run import; after tools/import-insanity.mjs).
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { facesOf, part } from './lib/box-uv.mjs';
import { MOD } from './lib/belly-render.mjs';
import { GIRL_BIRTHS } from './lib/girl-births.mjs';
import { girlSources, portGirl } from './lib/girl-port.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const PORT = 'jennypreggo_port';
const LANG_HEADER = "## Jenny's Preggo Mobs (tools/import-jenny-preggo.mjs)";
const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/** The girls: whose model and texture, whose birth, her babies' way of moving, her treats, where she lives. */
const GIRLS = [
  { source: 'zombie_girl', key: 'jenny_zombie_girl', name: "Jenny's Zombie Girl", birth: 'fapcraft:jenny',
    kicks: { name: 'jp_zombie', order: [0, 1, 2, 3, 4], rate: 1.0, emphasis: [1.2, 1.0, 1.0, 0.8, 0.8] },
    treats: ['minecraft:rotten_flesh', 'minecraft:cake'], biomes: ['plains', 'forest'], egg: { base_color: '#5c8a4a', overlay_color: '#f2c6a0' } },
  { source: 'humanoid_creeper_girl', key: 'jenny_creeper_girl', name: "Jenny's Creeper Girl", birth: 'kum:galath',
    kicks: { name: 'jp_creeper', order: [3, 0, 2, 1, 4], rate: 1.3, emphasis: [1.4, 0.8, 1.0, 1.2, 0.6] },
    treats: ['minecraft:gunpowder', 'minecraft:cake'], biomes: ['plains', 'forest', 'savanna'], egg: { base_color: '#4fa64a', overlay_color: '#2b2b2b' } },
  { source: 'humanoid_slime_girl', key: 'jenny_slime_girl', name: "Jenny's Slime Girl", birth: 'kum:slime_girl',
    kicks: { name: 'jp_slime', order: [4, 1, 0, 2, 3], rate: 0.8, emphasis: [0.8, 1.3, 0.9, 0.7, 1.4] },
    treats: ['minecraft:slime_ball', 'minecraft:cake'], biomes: ['swamp', 'jungle'], egg: { base_color: '#7cc46a', overlay_color: '#b8f0a8' } },
  { source: 'ender_woman', key: 'jenny_ender_woman', name: "Jenny's Ender Woman", birth: 'jhelliedev:ellie',
    kicks: { name: 'jp_ender', order: [2, 4, 1, 0, 3], rate: 1.15, emphasis: [1.0, 1.1, 1.3, 0.9, 1.0] },
    treats: ['minecraft:chorus_fruit', 'minecraft:ender_pearl', 'minecraft:cake'], biomes: ['plains', 'desert', 'the_end'], egg: { base_color: '#161616', overlay_color: '#cc66ff' },
    // her body is thin for all her height, her skin black (her face shows her eyes)
    grow: 1.05, tone: [34, 28, 40] },
];
/** Her bones -> the Jenny rig's (her own belly bone keeps out of the fitted belly's way). */
const RENAME = /** @type {Record<string, string>} */ ({ body: 'upperBody', left_arm: 'armL', right_arm: 'armR', left_leg: 'legL', right_leg: 'legR', belly: 'tummy' });

const write = (/** @type {string} */ file, /** @type {string | Uint8Array} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

// ---- clean the previous import ----------------------------------------------------------------------
for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(RP, 'entity', PORT), join(RP, 'models/entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) {
  rmSync(dir, { recursive: true, force: true });
}
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at < 0) continue;
  const next = text.slice(at + 1).search(/^## /m);
  writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n') + (next >= 0 ? text.slice(at + 1 + next) : ''));
}
const MODELS = join(RP, 'models/entity', MOD);
if (!existsSync(join(MODELS, 'zombie_girl.geo.json'))) {
  console.warn("warning: Minepreggo's models are not imported (tools/import-jar.mjs); no Jenny's Preggo Mobs");
  process.exit(0);
}

/**
 * Her model on the Jenny rig: a body root her upper body and legs hang from, her upper body turning at
 * her waist, her trunk's cubes a torso under it (what the belly fitter measures), a hip at the top of
 * her legs.
 */
function onJennyRig(/** @type {any} */ source, /** @type {string} */ id) {
  const g = structuredClone(source);
  g.description = { ...g.description, identifier: id };
  for (const bone of g.bones) {
    bone.name = RENAME[bone.name] ?? bone.name;
    if (bone.parent) bone.parent = RENAME[bone.parent] ?? bone.parent;
  }
  const byName = new Map(g.bones.map((/** @type {any} */ b) => [b.name, b]));
  const upper = byName.get('upperBody');
  const legTop = Math.max(byName.get('legL').pivot[1], byName.get('legR').pivot[1]);
  for (const name of ['head', 'armL', 'armR']) if (!byName.get(name).parent) byName.get(name).parent = 'upperBody';
  for (const name of ['upperBody', 'legL', 'legR']) byName.get(name).parent = 'body';
  g.bones.push({ name: 'torso', parent: 'upperBody', pivot: [...upper.pivot], cubes: upper.cubes ?? [] });
  delete upper.cubes;
  g.bones.unshift({ name: 'body', pivot: [0, legTop, 0] });
  g.bones.push({ name: 'hip', parent: 'upperBody', pivot: [0, legTop + 1, upper.pivot[2]] });
  upper.pivot = [upper.pivot[0], legTop, upper.pivot[2]];
  return { g, byName: new Map(g.bones.map((/** @type {any} */ b) => [b.name, b])), legTop };
}

/** A cube grown by [kx, ky, kz] about a point, its texture kept. */
function grow(/** @type {any} */ cube, /** @type {any} */ bone, /** @type {number[]} */ k, /** @type {number[]} */ about) {
  cube.uv = facesOf(cube, bone.mirror);
  cube.origin = cube.origin.map((/** @type {number} */ o, /** @type {number} */ i) => round(about[i] + (o - about[i]) * k[i]));
  cube.size = cube.size.map((/** @type {number} */ s, /** @type {number} */ i) => round(s * k[i]));
}
/** A smaller cube on one side of a cube, in the same texture (for rounding a box off). */
function cap(/** @type {any} */ cube, /** @type {number[]} */ size, /** @type {number[]} */ origin, /** @type {string} */ face) {
  const f = cube.uv[face] ?? cube.uv.north;
  const p = part(f, 0.15, 0.85, 0.15, 0.85);
  return { origin: origin.map(round), size: size.map(round), uv: { north: p, south: p, east: p, west: p, up: p, down: p } };
}

/**
 * Her curves: a fuller bust rounded off (each breast's box grown, with a smaller cap on its front and
 * one under it), wider hips (her torso's lowest piece), a rounded seat behind them, thicker thighs
 * (her legs, and a fuller piece at their top), each in her own texture.
 */
function curvy(/** @type {any} */ g, /** @type {Map<string, any>} */ byName, /** @type {number} */ legTop) {
  const under = (/** @type {string} */ n) => [n, ...g.bones.filter((/** @type {any} */ b) => b.parent === n).flatMap((/** @type {any} */ b) => under(b.name))];
  for (const bone of byName.has('boobs') ? under('boobs').map((n) => byName.get(n)) : []) {
    const caps = [];
    for (const cube of bone.cubes ?? []) {
      grow(cube, bone, [1.42, 1.42, 1.42], bone.pivot);
      const [x, y, z] = cube.origin, [w, h, d] = cube.size;
      caps.push(cap(cube, [w * 0.72, h * 0.72, d * 0.3], [x + w * 0.14, y + h * 0.12, z - d * 0.26], 'north'));
      caps.push(cap(cube, [w * 0.8, h * 0.28, d * 0.8], [x + w * 0.1, y - h * 0.2, z + d * 0.08], 'down'));
    }
    bone.cubes = [...(bone.cubes ?? []), ...caps];
  }
  const torso = byName.get('torso');
  const hips = [...(torso?.cubes ?? [])].sort((a, b) => a.origin[1] - b.origin[1])[0];
  if (hips) {
    grow(hips, torso, [1.38, 1, 1.18], [0, hips.origin[1], hips.origin[2] + hips.size[2] / 2]);
    // her seat: a rounded piece behind her hips, cut from their back
    const [x, y, z] = hips.origin, [w, h, d] = hips.size;
    const back = hips.uv.south ?? hips.uv.north;
    const seat = part(back, 0.1, 0.9, 0.2, 1);
    g.bones.push({ name: 'mp_seat', parent: 'upperBody', pivot: [0, round(legTop), round(z + d)],
      cubes: [{ origin: [round(x + w * 0.08), round(y - 1.2), round(z + d - 0.4)], size: [round(w * 0.84), round(Math.max(3, h + 1)), 1.8], uv: { north: seat, south: seat, east: seat, west: seat, up: seat, down: seat } }] });
  }
  for (const bone of ['legL', 'legR'].map((n) => byName.get(n)).filter(Boolean)) {
    const main = [...(bone.cubes ?? [])].sort((a, b) => b.size[1] - a.size[1])[0];
    for (const cube of bone.cubes ?? []) grow(cube, bone, [1.22, 1, 1.2], [cube.origin[0] + cube.size[0] / 2, cube.origin[1], cube.origin[2] + cube.size[2] / 2]);
    if (!main) continue;
    // a fuller thigh: the top of her leg, wider still
    const [x, y, z] = main.origin, [w, h, d] = main.size;
    const front = part(main.uv.north, 0, 1, 0, 0.4);
    const top = Math.min(5, h * 0.45);
    bone.cubes.push({ origin: [round(x - w * 0.16), round(y + h - top), round(z - d * 0.12)], size: [round(w * 1.32), round(top), round(d * 1.24)], uv: { north: front, south: front, east: front, west: front, up: front, down: front } });
  }
}

const jennyFile = join(RP, 'animations/jenny_port/jenny.animation.json');
const jenny = existsSync(jennyFile) ? JSON.parse(readFileSync(jennyFile, 'utf8')).animations : {};
const swing = (/** @type {number} */ k) => [`math.cos(q.modified_distance_moved * 38.17) * ${k}`, 0, 0];
const moves = {
  idle: jenny['animation.jhjenjava.jenny.idle'] ?? { loop: true, bones: { upperBody: { rotation: ['math.sin(q.anim_time * 90.0) * 1.5', 0, 0] } } },
  walk: jenny['animation.jhjenjava.jenny.walk'] ?? { loop: true, bones: { legL: { rotation: swing(30) }, legR: { rotation: swing(-30) }, armL: { rotation: swing(-25) }, armR: { rotation: swing(25) } } },
};

const sources = girlSources(RP);
/** @type {Record<string, unknown>} */
const controllers = {};
/** @type {Record<string, unknown>} */
const renderControllers = {};
const lang = [LANG_HEADER];
let poses = 0;
for (const girl of GIRLS) {
  const source = JSON.parse(readFileSync(join(MODELS, `${girl.source}.geo.json`), 'utf8'))['minecraft:geometry'][0];
  const client = JSON.parse(readFileSync(join(RP, 'entity', `${girl.source}.entity.json`), 'utf8'))['minecraft:client_entity'].description;
  const texturePath = Object.values(client.textures).find((t) => !/expression|_p\d|ill_|_all/.test(String(t))) ?? Object.values(client.textures)[0];
  const { g, byName, legTop } = onJennyRig(source, `geometry.${MOD}.${girl.key}`);
  curvy(g, byName, legTop);
  GIRL_BIRTHS[`${MOD}:${girl.key}`] = { ...GIRL_BIRTHS[girl.birth], name: girl.key };
  const out = portGirl(sources, { BP, RP, port: PORT, ns: MOD }, {
    key: girl.key, name: girl.name,
    outfits: [{ name: girl.key, geometry: { format_version: '1.16.0', 'minecraft:geometry': [g] }, texture: new Uint8Array(readFileSync(join(RP, `${texturePath}.png`))) }],
    moves, jiggle: { chest: ['boobs'], belly: ['belly'], buttRoot: ['mp_seat'] },
    birth: `${MOD}:${girl.key}`, kicks: girl.kicks, treats: girl.treats, biomes: girl.biomes,
    family: 'jenny_preggo_mob', egg: girl.egg, bellyStyle: 'round', ...(girl.grow ? { grow: girl.grow } : {}), ...(girl.tone ? { tone: girl.tone } : {}),
  });
  Object.assign(controllers, out.controllers);
  Object.assign(renderControllers, out.renderControllers);
  lang.push(...out.lang);
  poses += out.poses;
}
write(join(RP, 'animation_controllers', PORT, 'jenny_preggo.animation_controllers.json'), JSON.stringify({ format_version: '1.10.0', animation_controllers: controllers }, null, 2) + '\n');
write(join(RP, 'render_controllers', PORT, 'jenny_preggo.render_controllers.json'), JSON.stringify({ format_version: '1.8.0', render_controllers: renderControllers }, null, 2) + '\n');
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + lang.join('\n') + '\n');
}
console.log(`Jenny's Preggo Mobs: ${GIRLS.length} curvy girls, ${poses} pregnancy and scene poses`);
