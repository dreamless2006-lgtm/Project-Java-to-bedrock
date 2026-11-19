// Brings "Skelly" (vendor/skelly/*.zip: a Java resource pack whose OptiFine CEM model of the
// skeleton, by b.ART.ek, design by Spookyonyx, is a skeleton woman) in as her own mob,
// minepreggo:skelly, at import time; nothing of it is committed, and the vanilla skeleton keeps its
// own looks. Her model goes onto the Jenny rig (tools/lib/girl-port.mjs, like the InsanityV women):
// she walks and idles like Jenny, with a belly of her own (bone-pale and ribbed) for every size,
// her own rattling kicks, the pregnancy and scene poses, and the only belly-burst birth: her belly
// swells and shakes as she pushes, then bursts in a puff of bone dust and her baby tumbles out the
// front (her bones knit back together when it is over).
//
// OptiFine's .jem: each top-level part names the vanilla part it replaces and translates by minus its
// pivot; a submodel's translate is its origin relative to its parent's origin, and its boxes sit
// relative to it. The JEM frame is the mirror image of Bedrock's (its right arm is at +x), so x is
// mirrored: boxes, pivots, the east and west faces, and the Y and Z rotations; its X rotations turn
// the other way round. Legs the model hangs from its body go on the walking leg bones instead.
//
// Run: node tools/import-skelly.mjs (part of npm run import; after tools/import-jenny.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { MOD } from './lib/belly-render.mjs';
import { GIRL_BIRTHS } from './lib/girl-births.mjs';
import { girlSources, portGirl } from './lib/girl-port.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const VENDOR = join(ROOT, 'vendor/skelly');
const PORT = 'skelly_port';
const ID = `${MOD}:skelly`;
const LANG_HEADER = '## Skelly (vendor/skelly, tools/import-skelly.mjs)';
/** Where an earlier import put her over the vanilla skeleton's texture (removed). */
const OLD_TEXTURE = join(RP, 'textures/entity/skeleton/skeleton.png');
/** JEM part -> Bedrock bone of the vanilla skeleton geometry. */
const PARTS = { head: 'head', headwear: 'hat', body: 'body', left_arm: 'leftArm', right_arm: 'rightArm', left_leg: 'leftLeg', right_leg: 'rightLeg' };
/** Her bones -> the Jenny rig's (her own little belly cube keeps out of the fitted belly's way). */
const RENAME = /** @type {Record<string, string>} */ ({ body: 'upperBody', leftArm: 'armL', rightArm: 'armR', leftLeg: 'legL', rightLeg: 'legR', belly: 'tummy' });

const write = (/** @type {string} */ file, /** @type {Uint8Array | string} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

for (const dir of [join(BP, 'entities', PORT), join(BP, 'spawn_rules', PORT), join(RP, 'entity', PORT), join(RP, 'models/entity', PORT),
  join(RP, 'animations', PORT), join(RP, 'animation_controllers', PORT), join(RP, 'render_controllers', PORT), join(RP, 'textures', PORT)]) {
  rmSync(dir, { recursive: true, force: true });
}
rmSync(OLD_TEXTURE, { force: true });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(LANG_HEADER);
  if (at >= 0) writeFileSync(path, text.slice(0, at).replace(/\n*$/, '\n'));
}
const archive = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => f.endsWith('.zip')) : undefined;
if (!archive) {
  console.warn('warning: no Skelly resource pack in vendor/skelly/; she is not imported');
  process.exit(0);
}
const zip = unzipSync(new Uint8Array(readFileSync(join(VENDOR, archive))));
const jemFile = Object.keys(zip).find((n) => n.endsWith('optifine/cem/skeleton.jem'));
const pngFile = Object.keys(zip).find((n) => n.endsWith('textures/entity/skeleton/skeleton.png'));
if (!jemFile || !pngFile) throw new Error(`${archive}: no optifine/cem/skeleton.jem or skeleton texture`);
const jem = JSON.parse(strFromU8(zip[jemFile]));
const [width, height] = jem.textureSize ?? [64, 64];

/** One JEM box (absolute JEM origin of its part given) as a Bedrock cube. */
function cube(/** @type {any} */ box, /** @type {number[]} */ origin) {
  const [x, y, z, w, h, d] = box.coordinates;
  /** @type {Record<string, any>} */
  const out = { origin: [round(-(origin[0] + x + w)), round(origin[1] + y), round(origin[2] + z)], size: [w, h, d] };
  if (box.sizeAdd) out.inflate = box.sizeAdd;
  if (box.textureOffset) {
    out.uv = box.textureOffset;
    out.mirror = true;
    return out;
  }
  // per-face UVs [u1, v1, u2, v2], mirrored: east and west change places and every face flips across
  /** @type {Record<string, any>} */
  const faces = {};
  const FACE = { uvNorth: 'north', uvSouth: 'south', uvEast: 'west', uvWest: 'east', uvUp: 'up', uvDown: 'down' };
  for (const [key, face] of Object.entries(FACE)) {
    const uv = box[key];
    if (!uv) continue;
    faces[face] = { uv: [uv[2], uv[1]], uv_size: [uv[0] - uv[2], uv[3] - uv[1]] };
  }
  out.uv = faces;
  return out;
}

/** @type {any[]} */
const bones = [];
/**
 * A JEM submodel and its own submodels as bones under `parent`.
 * @param {any} model @param {string} parent @param {number[]} parentOrigin its parent's JEM origin
 */
function submodel(model, parent, parentOrigin) {
  const t = model.translate ?? [0, 0, 0];
  const origin = parentOrigin.map((v, k) => v + t[k]);
  const r = model.rotate ?? [0, 0, 0];
  const name = model.id ?? `part${bones.length}`;
  // her legs hang from the walking leg bones, so they step (the model hangs them from her body)
  const under = parent === 'body' && /^leg(\d)$/.test(name) ? (-origin[0] > 0 ? 'leftLeg' : 'rightLeg') : parent;
  bones.push({
    name,
    parent: under,
    pivot: [round(-origin[0]), round(origin[1]), round(origin[2])],
    ...(r.some(Boolean) ? { rotation: [-r[0], -r[1], r[2]] } : {}),
    ...(model.boxes?.length ? { cubes: model.boxes.map((/** @type {any} */ b) => cube(b, origin)) } : {}),
  });
  for (const sub of model.submodels ?? []) submodel(sub, name, origin);
}
for (const model of jem.models) {
  const name = PARTS[/** @type {keyof typeof PARTS} */ (model.part)];
  if (!name) continue;
  // a top-level part translates by minus its pivot; its own boxes are in the model's frame
  const t = model.translate ?? [0, 0, 0];
  bones.push({
    name,
    ...(name === 'hat' ? { parent: 'head' } : {}),
    pivot: [round(t[0]), round(-t[1]), round(-t[2])],
    ...(model.boxes?.length ? { cubes: model.boxes.map((/** @type {any} */ b) => cube(b, [0, 0, 0])) } : {}),
  });
  for (const sub of model.submodels ?? []) submodel(sub, name, [0, 0, 0]);
}
for (const needed of Object.values(PARTS)) if (!bones.some((b) => b.name === needed)) throw new Error(`skeleton.jem: no ${needed}`);

// ---- her model on the Jenny rig: a body root her upper body and legs hang from, her trunk's cubes a
// torso under the upper body (what the belly fitter measures), a hip at the top of her legs
for (const bone of bones) {
  bone.name = RENAME[bone.name] ?? bone.name;
  if (bone.parent) bone.parent = RENAME[bone.parent] ?? bone.parent;
}
const byName = new Map(bones.map((b) => [b.name, b]));
const upper = byName.get('upperBody');
const legTop = Math.max(byName.get('legL').pivot[1], byName.get('legR').pivot[1]);
for (const name of ['head', 'armL', 'armR']) byName.get(name).parent = 'upperBody';
for (const name of ['upperBody', 'legL', 'legR']) byName.get(name).parent = 'body';
const trunk = upper.cubes ?? [];
delete upper.cubes;
const front = Math.min(...trunk.map((/** @type {any} */ c) => c.origin[2]));
const top = Math.max(...trunk.map((/** @type {any} */ c) => c.origin[1] + c.size[1]));
bones.unshift({ name: 'body', pivot: [0, legTop, 0] });
// where her belly bursts: the middle of her waist, a hand in front of it
bones.push({ name: 'torso', parent: 'upperBody', pivot: [...upper.pivot], cubes: trunk, locators: { burst: [0, round((legTop + top) / 2), round(front - 5)] } });
bones.push({ name: 'hip', parent: 'upperBody', pivot: [0, legTop + 1, upper.pivot[2]] });
const geometry = {
  format_version: '1.12.0',
  'minecraft:geometry': [{ description: { identifier: 'geometry.skelly.skelly', texture_width: width, texture_height: height, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1.5, 0] }, bones }],
};

// ---- Jenny's own idle and walk (tools/import-jenny.mjs), or a plain walk without the Jenny port
const jennyFile = join(RP, 'animations/jenny_port/jenny.animation.json');
const jenny = existsSync(jennyFile) ? JSON.parse(readFileSync(jennyFile, 'utf8')).animations : {};
const swing = (/** @type {number} */ k) => [`math.cos(q.modified_distance_moved * 38.17) * ${k}`, 0, 0];
const moves = {
  idle: jenny['animation.jhjenjava.jenny.idle'] ?? { loop: true, bones: { upperBody: { rotation: ['math.sin(q.anim_time * 90.0) * 1.5', 0, 0] } } },
  walk: jenny['animation.jhjenjava.jenny.walk'] ?? { loop: true, bones: { legL: { rotation: swing(30) }, legR: { rotation: swing(-30) }, armL: { rotation: swing(-25) }, armR: { rotation: swing(25) } } },
};

// ---- her birth: Ellie's wide, leaning-back stance, but her baby comes out of her belly's front
GIRL_BIRTHS[ID] = {
  ...GIRL_BIRTHS['jhelliedev:ellie'],
  name: 'skelly',
  exitWant: [0, -0.26, -0.97],
  sounds: { mp_push: { event: 'minepreggo.player_push', at: [0.6, 3.8] }, rattle: { event: 'mob.skeleton.say', at: [2.2] } },
};
// the burst: her belly swells and shakes as the birth goes on, and at four fifths of it bursts (gone
// at once, with a puff of bone dust and a rattle), the baby already half out in front of her
const BURST = `animation.${MOD}.skelly.belly_burst`;
const BURST_CONTROLLER = `controller.animation.${MOD}.skelly.burst`;
const extra = {
  pre: ["v.burst = v.pose == 'birth' && v.push >= 0.8;"],
  animations: { [BURST]: { loop: true, bones: { belly: { scale: 'v.burst ? 0.0 : 1.0 + 0.3 * math.pow(math.clamp(v.push / 0.8, 0.0, 1.0), 2.0) + 0.04 * v.push * math.sin(q.life_time * 2400.0)' } } } },
  controllers: {
    [BURST_CONTROLLER]: {
      initial_state: 'whole',
      states: {
        whole: { transitions: [{ burst: 'v.burst' }] },
        burst: { particle_effects: [{ effect: 'burst_dust', locator: 'burst' }, { effect: 'burst_bones', locator: 'burst' }], sound_effects: [{ effect: 'burst' }], transitions: [{ whole: '!v.burst' }] },
      },
    },
  },
  ids: { belly_burst: BURST, burst_controller: BURST_CONTROLLER },
  animate: [{ belly_burst: "v.pose == 'birth'" }, 'burst_controller'],
  effects: { particle_effects: { burst_dust: 'minecraft:large_explosion', burst_bones: 'minecraft:critical_hit_emitter' }, sound_effects: { burst: 'mob.skeleton.death' } },
};

/** Her belly: bone-pale (her skin tone is her bones'), ribbed with darker bands. */
function ribbed(/** @type {{ width: number, data: Uint8Array }} */ image) {
  for (let i = 0; i < image.data.length; i += 4) {
    const row = Math.floor(i / 4 / image.width) % 6;
    const shade = row === 0 ? 0.72 : row === 1 ? 0.86 : 1;
    for (let k = 0; k < 3; k++) image.data[i + k] = Math.round(image.data[i + k] * shade);
  }
  return image;
}

const out = portGirl(girlSources(RP), { BP, RP, port: PORT, ns: MOD }, {
  key: 'skelly',
  name: 'Skelly',
  outfits: [{ name: 'skelly', geometry, texture: zip[pngFile] }],
  moves,
  jiggle: { chest: ['boobs'], belly: ['belly'] },
  birth: ID,
  // rattling: quick hiccups and kicks first, then rolls
  kicks: { name: 'skelly', order: [3, 0, 1, 2, 4], rate: 1.5, emphasis: [1.3, 1.1, 0.9, 1.4, 0.7] },
  treats: ['minecraft:bone', 'minecraft:bone_meal', 'minecraft:cake'],
  biomes: ['plains', 'desert', 'savanna', 'forest'],
  family: 'skelly_girl',
  egg: { base_color: '#c1c1c1', overlay_color: '#494949' },
  bellySkin: ribbed,
  // her baby comes out of the middle of her belly
  opening: (body) => [0, round((body.box[1][0] + body.box[1][1]) / 2), round(body.box[2][0] + 1)],
  extra,
});
write(join(RP, 'animation_controllers', PORT, 'skelly.animation_controllers.json'), JSON.stringify({ format_version: '1.10.0', animation_controllers: out.controllers }, null, 2) + '\n');
write(join(RP, 'render_controllers', PORT, 'skelly.render_controllers.json'), JSON.stringify({ format_version: '1.8.0', render_controllers: out.renderControllers }, null, 2) + '\n');
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + [LANG_HEADER, ...out.lang].join('\n') + '\n');
}
console.log(`Skelly: ${ID} (${bones.length} bones), ${out.poses} pregnancy and scene poses, a belly-burst birth`);
