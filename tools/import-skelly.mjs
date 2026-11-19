// Converts the "Skelly" Java resource pack (vendor/skelly/*.zip: an OptiFine CEM model of the
// skeleton, by b.ART.ek, design by Spookyonyx) into the Bedrock skeleton's own geometry and texture
// at import time; nothing of it is committed, and a build without it keeps the vanilla skeleton.
// The geometry takes the vanilla skeleton's identifier (geometry.skeleton.v1.8, which strays, wither
// skeletons and bogged do not use) and its bone names, so the vanilla animations and the bow still work.
//
// OptiFine's .jem: each top-level part names the vanilla part it replaces and translates by minus its
// pivot; a submodel's translate is its origin relative to its parent's origin, and its boxes sit
// relative to it. The JEM frame is the mirror image of Bedrock's (its right arm is at +x), so x is
// mirrored: boxes, pivots, the east and west faces, and the Y and Z rotations; its X rotations turn
// the other way round. Legs the model hangs from its body go on the walking leg bones instead.
//
// Run: node tools/import-skelly.mjs (part of npm run import).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = new URL('../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const VENDOR = join(ROOT, 'vendor/skelly');
const MODEL = join(RP, 'models/entity/skelly_port/skeleton.geo.json');
const TEXTURE = join(RP, 'textures/entity/skeleton/skeleton.png');
/** JEM part -> Bedrock bone of the vanilla skeleton geometry. */
const PARTS = { head: 'head', headwear: 'hat', body: 'body', left_arm: 'leftArm', right_arm: 'rightArm', left_leg: 'leftLeg', right_leg: 'rightLeg' };

const write = (/** @type {string} */ file, /** @type {Uint8Array | string} */ data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

rmSync(dirname(MODEL), { recursive: true, force: true });
rmSync(TEXTURE, { force: true });
const archive = existsSync(VENDOR) ? readdirSync(VENDOR).find((f) => f.endsWith('.zip')) : undefined;
if (!archive) {
  console.warn('warning: no Skelly resource pack in vendor/skelly/; the skeleton keeps its vanilla model');
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
// where the vanilla skeleton holds its bow and whatever it picks up
bones.push({ name: 'rightItem', parent: 'rightArm', pivot: [-6, 15, 1] }, { name: 'leftItem', parent: 'leftArm', pivot: [6, 15, 1] });
for (const needed of Object.values(PARTS)) if (!bones.some((b) => b.name === needed)) throw new Error(`skeleton.jem: no ${needed}`);

write(MODEL, JSON.stringify({
  format_version: '1.12.0',
  'minecraft:geometry': [{
    description: { identifier: 'geometry.skeleton.v1.8', texture_width: width, texture_height: height, visible_bounds_width: 2, visible_bounds_height: 3, visible_bounds_offset: [0, 1.5, 0] },
    bones,
  }],
}, null, 2) + '\n');
write(TEXTURE, zip[pngFile]);
console.log(`Skelly: the skeleton's model (${bones.length} bones, ${bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0)} cubes) and texture`);
