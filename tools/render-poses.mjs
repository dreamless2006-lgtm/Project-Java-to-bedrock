// Renders every pose of a Jenny girl (or one of our families' scene poses) as one sheet, from the
// generated animation files: `node tools/render-poses.mjs jenny [--phase 7] [--view 40]`. Each row is
// a pose at two moments, seen from the front-side and the side. Pictures go to dist/preview/.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contactSheet, poseAt, renderParts } from './lib/geo-render.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const args = process.argv.slice(2);
const flag = (/** @type {string} */ n, /** @type {string} */ d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const who = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'jenny';
const phase = Number(flag('phase', '7'));
const scale = Number(flag('scale', '5'));
const only = flag('poses', '');

const walk = (/** @type {string} */ dir, /** @type {(doc: any) => void} */ fn) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else if (e.name.endsWith('.json')) {
      try {
        fn(JSON.parse(readFileSync(p, 'utf8')));
      } catch {
        // not JSON we read
      }
    }
  }
};
/** @type {Map<string, any>} */
const geometries = new Map();
walk(join(RP, 'models/entity'), (doc) => {
  for (const g of doc['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, g);
});
/** @type {Record<string, any>} */
const animations = {};
walk(join(RP, 'animations'), (doc) => Object.assign(animations, doc.animations ?? {}));

/** @param {string} who @param {boolean} compact */
function sheetOf(who, compact) {
  const port = existsSync(join(RP, 'entity/jenny_port', `${who}.json`));
  const d = JSON.parse(readFileSync(port ? join(RP, 'entity/jenny_port', `${who}.json`) : join(RP, 'entity', `${who}.entity.json`), 'utf8'))['minecraft:client_entity'].description;
  const bodyKey = port ? ['default', 'normal', 'dressed'].find((k) => d.geometry[k]) : `p${phase}`;
  const body = geometries.get(d.geometry[bodyKey]);
  const textureKey = port ? ['default', 'normal', 'dressed'].find((k) => d.textures[k]) : `p${phase}`;
  const texture = decodePng(new Uint8Array(readFileSync(join(RP, `${d.textures[textureKey]}.png`))));
  /** @type {any[]} */
  const parts = [{ geometry: body, texture }];
  if (port) {
    const belly = geometries.get(d.geometry[`minepreggo_belly_0_p${phase}`]);
    if (belly) parts.push({ geometry: belly, texture: decodePng(new Uint8Array(readFileSync(join(RP, `${d.textures.minepreggo_belly}.png`)))) });
  }
  const poses = Object.entries(d.animations)
    .filter(([key]) => (port ? key.startsWith('mp_pose_') && key !== 'mp_pose_controller' : /^scene(_sit)?_pose$/.test(key)))
    .filter(([key]) => !only || only.split(',').some((p) => key === `mp_pose_${p}` || key === `${p}_pose`));
  /** @type {import('./lib/png.mjs').Image[]} */
  const images = [];
  const size = { width: Math.round(scale * 44), height: Math.round(scale * 44) };
  for (const [key, id] of poses) {
    const anim = animations[id];
    if (!anim) throw new Error(`${key}: ${id} not found`);
    const len = Number(anim.animation_length ?? 0);
    for (const t of compact ? [len * 0.45] : [0, len * 0.45]) {
      const pose = poseAt(anim, t);
      // the newborn shows half-way through a push
      if (port && key.endsWith('birth') && !key.endsWith('postbirth')) pose.newborn = { scale: [1, 1, 1], position: [0, -1.8, -0.4] };
      else if (port) pose.newborn = { scale: [0, 0, 0] };
      for (const yaw of compact ? [40] : [35, 90]) images.push(renderParts(parts, pose, { yaw, pitch: 12, scale }, size));
    }
    console.log(`${key}: ${id} (${len}s)`);
  }
  return images;
}
mkdirSync(join(ROOT, 'dist/preview'), { recursive: true });
const compact = args.includes('--compact');
const girls = who === 'all' ? readdirSync(join(RP, 'entity/jenny_port')).map((f) => f.replace(/\.json$/, '')).filter((n) => existsSync(join(RP, 'animations/jenny_port/minepreggo', `${n === 'slime' ? 'slime_girl' : n}_poses.animation.json`))) : [who];
const all = girls.flatMap((g) => sheetOf(g, compact));
const columns = compact ? Math.max(1, all.length / girls.length) : 4;
const file = join(ROOT, 'dist/preview', `poses_${who}${only ? '_' + only.replace(/,/g, '_') : ''}.png`);
writeFileSync(file, encodePng(contactSheet(all, columns)));
console.log(`wrote ${file}`);
