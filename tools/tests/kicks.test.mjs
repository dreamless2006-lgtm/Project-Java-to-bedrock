// The babies' movements (animation.minepreggo.kick_i/ii/iii, tools/lib/belly-render.mjs) and the
// mod's keyframed kicks (clamped by tools/lib/kick-clamp.mjs) move the same kick bones: each alone
// crosses the cube's whole room to the skin, so the keyframed kick gives way by the movements' share
// (v.kp_<bone>) and the two together never carry a cube further out of the belly than either alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { poseAt } from '../lib/geo-render.mjs';
import { evalMolang } from '../lib/molang-lite.mjs';
import { BULGE, KICK_BONES } from '../lib/kick-clamp.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const walk = (/** @type {string} */ d) => /** @type {string[]} */ (readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }));
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
/** @type {Record<string, any>} */
const animations = {};
for (const file of walk(join(RP, 'animations'))) if (file.endsWith('.json')) Object.assign(animations, read(file).animations ?? {});
/** @type {Record<string, any>} */
const controllers = {};
for (const file of walk(join(RP, 'animation_controllers'))) if (file.endsWith('.json')) Object.assign(controllers, read(file).animation_controllers ?? {});

test('every body that plays a kick reading v.kp_<bone> or v.kick_grow writes it first', () => {
  let checked = 0;
  for (const file of [...walk(join(RP, 'entity')), ...walk(join(RP, 'attachables'))]) {
    if (!file.endsWith('.json')) continue;
    const doc = read(file);
    const d = (doc['minecraft:client_entity'] ?? doc['minecraft:attachable'])?.description;
    if (!d?.animations) continue;
    const ids = Object.values(d.animations).flatMap((id) => (controllers[/** @type {string} */ (id)] ? Object.values(controllers[/** @type {string} */ (id)].states ?? {}).flatMap((s) => (/** @type {any} */ (s).animations ?? []).map((/** @type {any} */ a) => d.animations[typeof a === 'string' ? a : Object.keys(a)[0]])) : [id]));
    const reads = new Set(ids.flatMap((id) => [...JSON.stringify(animations[/** @type {string} */ (id)] ?? {}).matchAll(/\bv\.(kp_[a-z_]+|kick_grow)\b/g)].map((m) => m[1])));
    if (!reads.size) continue;
    const written = new Set((d.scripts?.pre_animation ?? []).map((/** @type {string} */ line) => line.match(/^(?:v|variable)\.(\w+)\s*=/)?.[1]).filter(Boolean));
    for (const name of reads) assert.ok(written.has(name), `${file.slice(RP.length + 1)} reads v.${name} without writing it`);
    checked++;
  }
  assert.ok(checked > 0);
});

test('a kick cube never travels further out than its room and bulge, the movements and the keyframed kick together (once imported)', (t) => {
  const entityFile = join(RP, 'entity/zombie_girl.entity.json');
  if (!existsSync(join(RP, 'models/entity/minepreggo/zombie_girl_p9.geo.json'))) return t.skip('run npm run import first');
  const d = read(entityFile)['minecraft:client_entity'].description;
  for (const [p, strength, kick] of /** @type {[number, string, number][]} */ ([[9, 'iii', 2], [7, 'ii', 1], [5, 'i', 0]])) {
    const props = /** @type {Record<string, unknown>} */ ({ 'minepreggo:phase': p, 'minepreggo:pose': 'fetal_movement', 'minepreggo:belly': `p${p}`, 'minepreggo:kick': kick, 'minepreggo:growth': 0.5, 'minepreggo:scene': 'none' });
    /** @type {Record<string, any>} */
    const v = { kick_w: 1, kick_shown: kick, cw: 0 };
    const q = { life_time: 0, delta_time: 0.05, is_tamed: 1, property: (/** @type {string} */ n) => props[n] };
    const keyframed = animations[d.animations[`fetal_p${p}_${strength}`]];
    const pulses = animations[d.animations[`kick_${strength}`]];
    for (let time = 0; time <= 30; time += 0.05) {
      q.life_time = time;
      for (const line of d.scripts.pre_animation) {
        const m = line.match(/^(?:v|variable)\.(\w+)\s*=\s*(.+);$/);
        if (m) v[m[1]] = evalMolang(m[2], { v, q, variable: v, query: q });
      }
      v.kick_w = 1;
      const env = { evaluate: { v, q } };
      const a = poseAt(keyframed, time % (keyframed.animation_length ?? 1e9), env);
      const b = poseAt(pulses, time, env);
      for (const bone of KICK_BONES) {
        const z = (a[bone]?.position?.[2] ?? 0) + (b[bone]?.position?.[2] ?? 0);
        assert.ok(-z <= v[`k_${bone}_z`] + BULGE.z + 0.05, `P${p} ${strength} ${bone} at ${time.toFixed(2)} s: ${(-z).toFixed(2)} out, room ${v[`k_${bone}_z`]}`);
      }
    }
  }
});
