// Renders pictures of the Jenny-port girls (and our own females) with their bellies and poses, so
// what the generators produce can be looked at: `node tools/render-preview.mjs jenny --phase 7
// --pose birth --anim animation.minepreggo.jp_jenny.birth@3.0`. Pictures go to dist/preview/
// (git-ignored: they show third-party textures). Each picture is a sheet of four views: front,
// three-quarter, side and back.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contactSheet, mergePoses, poseAt, renderParts } from './lib/geo-render.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const OUT = join(ROOT, 'dist/preview');

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const who = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'jenny';
const phase = Number(flag('phase', '-1'));
const scale = Number(flag('scale', '7'));
const anims = args.flatMap((a, i) => (args[i - 1] === '--anim' ? [a] : []));
const geometryKey = flag('geometry', '');
const outName = flag('out', `${who}${phase >= 0 ? `_p${phase}` : ''}${anims.length ? '_' + anims.map((a) => a.split('.').pop()?.replace('@', '_')).join('_') : ''}`);

/** Every animation of the resource pack, by id. */
function allAnimations() {
  /** @type {Record<string, any>} */
  const out = {};
  const walk = (/** @type {string} */ dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith('.json')) {
        try {
          Object.assign(out, JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '')).animations ?? {});
        } catch {
          // not an animation file
        }
      }
    }
  };
  walk(join(RP, 'animations'));
  return out;
}

/** Every geometry of the resource pack, by id. */
function allGeometries() {
  /** @type {Map<string, any>} */
  const out = new Map();
  const walk = (/** @type {string} */ dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith('.json')) {
        try {
          for (const g of JSON.parse(readFileSync(path, 'utf8'))['minecraft:geometry'] ?? []) out.set(g.description.identifier, g);
        } catch {
          // not a geometry file
        }
      }
    }
  };
  walk(join(RP, 'models/entity'));
  return out;
}

/** The client entity file of a girl (by slug) or of one of our females. */
function clientEntity(/** @type {string} */ slug) {
  for (const path of [join(RP, 'entity/jenny_port', `${slug}.json`), join(RP, 'entity', `${slug}.entity.json`)]) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))['minecraft:client_entity'].description;
  }
  throw new Error(`no client entity for ${slug}`);
}

const geometries = allGeometries();
const d = clientEntity(who);
const bodyKey = geometryKey || ['default', 'normal', 'dressed'].find((k) => d.geometry?.[k]) || Object.keys(d.geometry)[0];
const body = geometries.get(d.geometry[bodyKey]);
if (!body) throw new Error(`geometry ${d.geometry[bodyKey]} of ${who} not found`);
const textureKey = ['default', 'normal', 'dressed'].find((k) => d.textures?.[k]) || Object.keys(d.textures)[0];
const texture = decodePng(new Uint8Array(readFileSync(join(RP, `${d.textures[textureKey]}.png`))));
/** @type {Parameters<typeof renderParts>[0]} */
const parts = [{ geometry: body, texture }];
if (phase >= 0) {
  const bellyId = d.geometry[`minepreggo_belly_0_p${phase}`] ?? d.geometry[`minepreggo_body_predefined_p${phase}`];
  const belly = bellyId ? geometries.get(bellyId) : undefined;
  if (!belly) console.warn(`no belly geometry for phase ${phase} on ${who}`);
  else {
    const bellyTexture = d.textures.minepreggo_belly ? decodePng(new Uint8Array(readFileSync(join(RP, `${d.textures.minepreggo_belly}.png`)))) : texture;
    parts.push({ geometry: belly, texture: bellyTexture });
  }
}
const animations = anims.length ? allAnimations() : {};
const extraPose = flag('pose', '') ? JSON.parse(flag('pose', '')) : {};
const pose = mergePoses([
  extraPose,
  ...anims.map((spec) => {
    const [id, at] = spec.split('@');
    const animation = animations[id];
    if (!animation) throw new Error(`animation ${id} not found`);
    return poseAt(animation, Number(at ?? 0));
  }),
]);
const views = [
  { yaw: 0, pitch: 10 },
  { yaw: 40, pitch: 15 },
  { yaw: 90, pitch: 5 },
  { yaw: 180, pitch: 10 },
];
const size = { width: Math.round(scale * 40), height: Math.round(scale * 48) };
const sheet = contactSheet(views.map((v) => renderParts(parts, pose, { ...v, scale }, size)), 4);
mkdirSync(OUT, { recursive: true });
const file = join(OUT, `${outName}.png`);
writeFileSync(file, encodePng(sheet));
console.log(`wrote ${file} (${sheet.width}x${sheet.height}, ${parts.length} parts, ${Object.keys(pose).length} posed bones)`);
