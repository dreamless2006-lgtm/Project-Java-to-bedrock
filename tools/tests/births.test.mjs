// The births of the sixteen pregnant mobs: each with her own posture, push rhythm and way out.
// Section A checks the shared machinery on its own (tools/lib/birth-rhythm.mjs, molang-lite.mjs,
// vanilla-ids.mjs, poseAt's evaluate option and solveAnimation's lerp option); the other sections
// check the generated births and run where the generated files exist, else are skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// A: rhythm

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIRTH_LINE, GATE_RAMP, crowningFor, effectsAt, exitMount, flashLines, mergeEffects, midPush, navelInsetLine, navelInsets, pulse, pushWeight, restDepth, timeKey, tremble, vec, windowKeys } from '../lib/birth-rhythm.mjs';
import { compileMolang, evalMolang, evaluate, molangEvaluator, runMolang } from '../lib/molang-lite.mjs';
import { VANILLA_PARTICLES, VANILLA_SOUNDS, VANILLA_SOURCE } from '../lib/vanilla-ids.mjs';
import { animationTime, poseAt, poseBones } from '../lib/geo-render.mjs';
import { apply, matFromEuler, rigOf, solveAnimation } from '../lib/pose-solve.mjs';

const A_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const close = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => Math.abs(a - b) < eps;
/** A keyframe map's values in time order. */
const valuesOf = (/** @type {Record<string, any>} */ keys) => Object.entries(keys).sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => v);
const CREEPER = { length: 9, pushes: /** @type {[number, number][]} */ ([[0.5, 3.0], [7.25, 8.3]]), gates: /** @type {[number, number][]} */ ([[1.65, 2.1], [2.75, 3.15]]) };

test('A: window keys hold one value while she pushes and another between pushes, and loop seamlessly', () => {
  const keys = windowKeys({ length: 6, pushes: [[0.5, 2.6], [3.4, 5.5]] }, 1, 0);
  assert.deepEqual(keys, { '0.0': 0, '0.5': 0, '0.75': 1, '2.35': 1, '2.6': 0, '3.4': 0, '3.65': 1, '5.25': 1, '5.5': 0, '6.0': 0 });
  assert.deepEqual(Object.keys(keys), Object.keys(keys).sort((a, b) => Number(a) - Number(b)), 'keys in time order');
  // a window shorter than two ramps peaks in its middle; touching windows share their edge key
  assert.deepEqual(windowKeys({ length: 3, pushes: [[0.3, 0.6], [0.6, 1.0]], ramp: 0.25 }, 'in', 'out'), { '0.0': 'out', '0.3': 'out', '0.45': 'in', '0.6': 'out', '0.8': 'in', '1.0': 'out', '3.0': 'out' });
  // a push that runs to the end of the loop still meets the start
  const toEnd = valuesOf(windowKeys({ length: 4, pushes: [[0, 4]] }, [1, 2, 3], [0, 0, 0]));
  assert.deepEqual(toEnd[0], toEnd[toEnd.length - 1]);
  assert.throws(() => windowKeys({ length: 4, pushes: [[3, 5]] }, 1, 0), /not inside/);
  assert.throws(() => windowKeys({ length: 4, pushes: [[2, 3], [1, 1.5]] }, 1, 0), /overlap/);
  assert.throws(() => windowKeys({ length: 0, pushes: [[0, 1]] }, 1, 0), /length/);
  assert.equal(pushWeight(CREEPER, 0.625), 0.5);
  assert.equal(pushWeight(CREEPER, 2.0), 1);
  assert.equal(pushWeight(CREEPER, 9 + 2.0), 1, 'the loop starts over');
  assert.equal(pushWeight(CREEPER, 5), 0);
  assert.equal(midPush(CREEPER), 1.75);
  assert.equal(midPush(CREEPER, 1), 7.775);
  assert.equal(timeKey(1), '1.0');
  assert.equal(timeKey(9.04170001), '9.0417');
});

test('A: her crowning keeps time with her pushes, draws back inside the gates and loops seamlessly', () => {
  const anim = crowningFor(CREEPER);
  assert.equal(anim.loop, true);
  assert.equal(anim.animation_length, 9);
  assert.equal(anim.bones.crowning.scale, 'v.crowning ? v.crown_scale : 0.0');
  const slide = anim.bones.crowning_slide.position;
  const times = Object.keys(slide).map(Number);
  assert.equal(times[0], 0);
  assert.equal(times[times.length - 1], 9);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]), 'keys in time order');
  for (const value of Object.values(slide)) assert.ok(Array.isArray(value) && value.length === 3 && value[0] === 0 && value[2] === 0, 'linear keys of [0, y, 0]: no lerp_mode next to Molang');
  const depth = (/** @type {number} */ t, /** @type {Record<string, number>} */ v) => {
    // the game joins the keys with straight lines between the evaluated values
    const keys = Object.entries(slide).map(([k, value]) => ({ t: Number(k), y: evalMolang(value[1], { v }) }));
    const i = keys.findIndex((k) => k.t >= t);
    if (keys[i].t === t || i === 0) return -keys[i].y;
    const a = keys[i - 1], b = keys[i];
    return -(a.y + ((b.y - a.y) * (t - a.t)) / (b.t - a.t));
  };
  const v = { crown: 4, push: 0.5, crown_scale: 0.875 };
  assert.ok(close(depth(0, v), depth(9, v)), 'the same at the start and end of the loop');
  assert.ok(close(depth(1.0, v), 4), 'all the way out while she pushes');
  assert.ok(close(depth(5.0, v), 4 - 1.2), 'slipped back between pushes');
  assert.ok(close(depth(1.8, v), 4 * 0.15), 'drawn back while her legs are closed');
  assert.ok(close(depth(1.8, { ...v, push: 0.85 }), 4), 'not drawn back once it is nearly out');
  assert.ok(close(depth(1.65 - GATE_RAMP, v), 4), 'the gate comes on just before her legs close');
  assert.ok(close(depth(3.3, v), 2.8), 'and is off again after they open');
  // the navel inset moves the baby out by the inset in model units, the bob back in
  const navel = crowningFor({ length: 9, pushes: [[0.5, 2.5], [6.4, 8.25]] }, { inset: 'v.ninset * (1.0 - 0.3 * v.push)' }).bones.crowning_slide.position;
  assert.ok(close(-evalMolang(navel['0.75'][1], { v: { crown: 4, push: 0.5, crown_scale: 0.8, ninset: 4 } }), 4 + (4 * 0.85) / 0.8));
  const bob = crowningFor({ length: 5, pushes: [[0.4, 1.9], [2.9, 4.4]] }, { bob: '0.4 * math.sin(q.anim_time * 720.0)' });
  assert.equal(bob.animation_length, 5);
  assert.ok(close(-evalMolang(bob.bones.crowning_slide.position['0.65'][1], { v: { crown: 4 }, q: { anim_time: 0.125 } }), 4 - 0.4));
});

test('A: pulses, trembles and combined channels are built from the rhythm', () => {
  const rh = { length: 9.0417, pushes: /** @type {[number, number][]} */ ([[1.2, 1.7], [2.3, 3.4]]) };
  assert.deepEqual(valuesOf(pulse(rh, 0.08, 1)), [1, 1, 1.08, 1, 1, 1.08, 1.08, 1, 1]);
  const shake = tremble(rh, 4, 14, -40);
  assert.equal(shake['1.45'], '4.0 * math.sin(q.anim_time * 5040.0 - 40.0)');
  assert.equal(shake['0.0'], '0.0');
  assert.ok(close(evalMolang(shake['1.45'], { q: { anim_time: 0.1 } }), 4 * Math.sin(((0.1 * 5040 - 40) * Math.PI) / 180)));
  assert.equal(tremble(rh, 3, 9)['1.45'], '3.0 * math.sin(q.anim_time * 3240.0)');
  // per-axis keys on the union of their times, constants copied, numbers interpolated, expressions blended
  const v3 = /** @type {Record<string, any[]>} */ (vec({ '0.0': 0, '1.0': 10 }, 2, { '0.0': 'a', '0.5': 'b' }));
  assert.deepEqual(v3, { '0.0': [0, 2, 'a'], '0.5': [5, 2, 'b'], '1.0': [10, 2, 'b'] });
  const blend = /** @type {Record<string, any[]>} */ (vec({ '0.0': 'a', '1.0': 'b' }, { '0.0': 0, '0.25': 1 }, 0));
  assert.equal(blend['0.25'][0], 'math.lerp(a, b, 0.25)');
  assert.deepEqual(vec(1, 'v.x', 0), [1, 'v.x', 0]);
});

test('A: effect timelines give every effect a time of its own', () => {
  assert.deepEqual(effectsAt([4.6, 0.6], 'mp_groan'), { '0.6': { effect: 'mp_groan' }, '4.6': { effect: 'mp_groan' } });
  assert.deepEqual(effectsAt([0.8, 0.8], 'mp_flap'), { '0.8': { effect: 'mp_flap' }, '0.81': { effect: 'mp_flap' } });
  const merged = mergeEffects(effectsAt([0.8, 1.6, 2.4], 'mp_flap'), effectsAt([0.8], 'mp_push'));
  assert.deepEqual(merged, { '0.8': { effect: 'mp_flap' }, '0.81': { effect: 'mp_push' }, '1.6': { effect: 'mp_flap' }, '2.4': { effect: 'mp_flap' } });
  assert.deepEqual(Object.keys(merged), Object.keys(merged).sort((a, b) => Number(a) - Number(b)));
});

test('A: the birth flash flickers inside its windows only, on top of the fuse flash', () => {
  const lines = flashLines({ length: 9, windows: [[0.9, 1.5], [7.5, 8.0]], hz: 10, level: 0.6 });
  assert.equal(lines.length, 4);
  for (const line of lines) assert.match(line, BIRTH_LINE);
  assert.doesNotMatch('v.flash = q.fuse_time > 0.0 ? 0.5 : 0.0;', BIRTH_LINE, 'the fuse line is not ours');
  assert.match(navelInsetLine({ 4: { bones: [{ name: 'belly', pivot: [0, 0, 0] }] } }, [0, 0, 0]), BIRTH_LINE);
  // run the lines frame by frame as the game would, from the start of the birth pose
  const v = /** @type {Record<string, any>} */ ({ pose: 'birth', flash: 0 });
  const seen = /** @type {{ t: number, flash: number }[]} */ ([]);
  for (let frame = 1; frame <= 200; frame++) {
    v.flash = 0.1; // the entity's own fuse line, before ours
    runMolang(lines, { v, q: { delta_time: 0.05 } });
    seen.push({ t: v.bt, flash: v.flash });
  }
  const inWindow = (/** @type {number} */ t) => (t % 9 >= 0.9 && t % 9 < 1.5) || (t % 9 >= 7.5 && t % 9 < 8.0);
  for (const { t, flash } of seen) {
    if (!inWindow(t)) assert.equal(flash, 0.1, `no flash at ${t}`);
    else assert.equal(flash, Math.floor(t * 10) % 2 === 0 ? 0.6 : 0.1, `flicker at ${t}`);
  }
  assert.ok(seen.some(({ flash }) => flash === 0.6));
  v.pose = 'prebirth';
  runMolang(lines, { v, q: { delta_time: 0.05 } });
  assert.equal(v.bt, 0, 'the timer starts over outside the birth');
});

test('A: the exit mount sends the baby along the wanted direction in her posed birth', () => {
  // a flat humanoid lying on her back: the body turned -90 about x, the opening at the bottom of the torso
  const geometry = {
    bones: [
      { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4] }] },
      { name: 'right_leg', pivot: [-1.9, 12, 0] },
      { name: 'left_leg', pivot: [1.9, 12, 0] },
    ],
  };
  const lying = { loop: true, animation_length: 2, bones: { body: { rotation: { '0.0': [-90, 0, 0], '2.0': [-90, 0, 0] }, position: [0, -21.5, 3] } } };
  const opening = [0, 12, -0.5];
  const toWorld = /** @type {(p: number[]) => number[]} */ (poseBones(geometry, poseAt(lying, 1)).get('body'));
  const origin = toWorld(opening);
  for (const want of [[0, -0.97, 0.24], [0, -0.35, -0.94], [0, -1, 0], [0.4, -0.6, -0.2]]) {
    const { mount, clearance, origin: at } = exitMount(geometry, lying, 'body', opening, want, 1);
    assert.deepEqual(at.map((x) => Math.round(x * 1e6) / 1e6), origin.map((x) => Math.round(x * 1e6) / 1e6));
    // the mount hangs from the body: its -y, turned by the mount and then by the posed body
    const local = apply(matFromEuler(mount), [0, -1, 0]);
    const tip = toWorld(opening.map((x, k) => x + local[k]));
    const out = tip.map((x, k) => x - origin[k]);
    const n = Math.hypot(...want);
    const angle = (Math.acos(Math.min(1, out.reduce((s, x, k) => s + (x * want[k]) / n, 0))) * 180) / Math.PI;
    assert.ok(angle < 0.05, `want ${want}: ${angle.toFixed(3)} degrees off`);
    assert.ok(close(clearance, origin[1] / (-want[1] / n), 1e-6), `clearance ${clearance}`);
  }
  assert.equal(exitMount(geometry, lying, 'body', opening, [0, 0.2, -1], 1).clearance, Infinity, 'never reaches the floor going up');
  assert.throws(() => exitMount(geometry, lying, 'hip', opening, [0, -1, 0], 1), /no bone hip/);
  assert.equal(restDepth(10.8, 0.875), 8, 'room enough: the default depth');
  assert.equal(restDepth(6, 0.8), 4);
  assert.equal(restDepth(2, 0.8), 2, 'never less than 2');
  assert.equal(restDepth(Infinity, 0.8), 8);
});

test('A: the navel inset is how far the opening sits behind the front of the belly', () => {
  /** A belly tilted forward, a shell in front of the opening, a kick bone further out (ignored) and a cube off to the side (ignored). */
  const model = (/** @type {number} */ front) => ({
    description: { identifier: 'geometry.test' },
    bones: [
      { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4] }] },
      { name: 'belly', parent: 'body', pivot: [0, 18, -2], rotation: [10, 0, 0], cubes: [{ origin: [-3, 15, front], size: [6, 6, -2 - front] }] },
      { name: 'front_kick', parent: 'belly', pivot: [0, 18, -4], cubes: [{ origin: [-1, 17, -4], size: [2, 2, 1] }] },
      { name: 'side_kick', parent: 'belly', pivot: [0, 18, -4], cubes: [{ origin: [-1, 17, -20], size: [2, 2, 1] }] },
      { name: 'lump', parent: 'belly', pivot: [6, 18, -2], cubes: [{ origin: [5, 17, -30], size: [2, 2, 2] }] },
    ],
  });
  const insets = navelInsets({ 4: model(-6), 7: model(-9.5) });
  assert.deepEqual(insets, { 4: 2, 7: 5.5 }, 'measured in the belly frame (opening: the front of the front kick)');
  assert.equal(navelInsetLine({ 4: model(-6), 7: model(-9.5) }), 'v.ninset = (v.bp == 4 ? 2.0 : (v.bp == 7 ? 5.5 : 0.0));');
  assert.deepEqual(navelInsets({ 5: model(-6) }, [0, 18, -3]), { 5: 3 }, 'an opening of the caller');
  for (const [p, value] of Object.entries(insets)) assert.equal(evalMolang(navelInsetLine({ 4: model(-6), 7: model(-9.5) }).replace(/^v\.ninset = |;$/g, ''), { v: { bp: Number(p) } }), value);
});

test('A: molang-lite reads Molang the way the game does', () => {
  const env = { v: { push: 0.5, pose: 'birth' }, q: { anim_time: 0.25, property: (/** @type {string} */ n) => ({ 'minepreggo:growth': 0.4 })[n] } };
  /** @type {[string, number][]} */
  const cases = [
    ['1 + 2 * 3 - 4 / 2', 5], ['-2 * -3', 6], ['math.sin(90.0) + math.cos(180.0)', 0], ['math.atan2(1, 1)', 45],
    ["v.pose == 'birth'", 1], ["v.pose != 'birth'", 0], ['0.5 && 0.7', 1], ['0.0 || 0.3', 1], ['!v.push', 0],
    ['v.unset ?? 9.0', 9], ['(v.push ?? 9.0) + 1.0', 1.5], ["q.property('minepreggo:growth') * 2.0", 0.8], ['query.anim_time * 4', 1],
    ['Math.Sin(30) * 2', 1], ['math.mod(7.5, 2.0)', 1.5], ['math.clamp(5, 0, 1)', 1], ['v.unknown + 1', 1], ['1 / 0', 0],
    ['v.push < 0.8 ? 1 : 2', 1], ['0 ? 2 : 0 ? 3 : 4', 4], ['1 ? 3', 3], ['0 ? 3', 0], ['math.pi', Math.PI], ['.5 + 1.0', 1.5],
    ['v.a = 3; v.b = v.a * 2; return v.b + 1;', 7], ['v.pose', 0], ['not molang (((', 0],
  ];
  for (const [expr, want] of cases) assert.ok(close(evalMolang(expr, env), want), `${expr} = ${evalMolang(expr, env)}, not ${want}`);
  assert.equal(evaluate('v.pose', env), 'birth');
  assert.equal(evaluate('v.nothing', env), undefined);
  // statements, blocks and eased variables, frame by frame
  const v = /** @type {Record<string, any>} */ ({});
  runMolang(['v.t = (v.t ?? 0.0) + q.delta_time;', '(v.t > 0.12) ? { v.late = 1.0; v.n = (v.n ?? 0.0) + 1.0; };', 'bad (((;', 'v.after = v.t * 2.0;'], { v, q: { delta_time: 0.05 } }, { frames: 4 });
  assert.ok(close(v.t, 0.2) && v.late === 1 && v.n === 2 && close(v.after, 0.4));
  const read = molangEvaluator({ q: { property: () => 7 } });
  assert.equal(read('q.anim_time * 2.0 + q.property(\'x\')', 1.5), 10);
  // every Molang string of the resource pack parses (the previews would read it as 0 otherwise)
  const failures = [];
  /** @param {unknown} node */
  const visit = (node) => {
    if (typeof node === 'string') {
      if (/\b(v|q|variable|query|math)\.\w/i.test(node) && !/^(animation|controller|geometry|texture|material)\./i.test(node)) {
        try {
          compileMolang(node);
        } catch (e) {
          failures.push(`${node}: ${/** @type {Error} */ (e).message}`);
        }
      }
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') for (const [k, x] of Object.entries(node)) { visit(k); visit(x); }
  };
  /** @param {string} dir */
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.json')) {
        try {
          visit(JSON.parse(readFileSync(p, 'utf8')));
        } catch {
          // not JSON this test can read: validate.mjs reports it
        }
      }
    }
  };
  for (const d of ['entity', 'animations', 'animation_controllers', 'render_controllers']) walk(join(A_ROOT, 'packs/resource', d));
  assert.deepEqual(failures, []);
});

test('A: poseAt evaluates Molang only when asked, and loops with wrap', () => {
  const anim = {
    loop: true,
    animation_length: 2,
    bones: {
      a: { rotation: [10, 'v.x * 2.0', 'q.anim_time'], scale: 'v.s' },
      b: { position: { '0.0': [0, 0, 0], '1.0': { pre: [0, 'v.x', 0], post: [0, 4, 0] }, '2.0': [0, 4, 0] } },
      c: { rotation: { '0.0': 'v.x', '2.0': 0 } },
    },
  };
  const plain = poseAt(anim, 0.5);
  assert.deepEqual(plain.a, { rotation: [10, 0, 0], scale: [1, 1, 1] }, 'without evaluate Molang is 0 (1 for scale), as before');
  assert.deepEqual(plain.b.position, [0, 0, 0]);
  assert.deepEqual(plain.c.rotation, [0, 0, 0]);
  const env = { v: { x: 3, s: 1.5 } };
  const lit = poseAt(anim, 0.5, { evaluate: env });
  assert.deepEqual(lit.a, { rotation: [10, 6, 0.5], scale: [1.5, 1.5, 1.5] });
  assert.deepEqual(lit.b.position, [0, 1.5, 0], 'pre frames evaluated');
  assert.deepEqual(lit.c.rotation, [2.25, 2.25, 2.25], 'a single keyframe value counts for all three axes');
  assert.deepEqual(poseAt(anim, 2.5, { evaluate: env, wrap: true }).a.rotation, [10, 6, 0.5], 'wrapped to 0.5 s, anim_time too');
  assert.deepEqual(poseAt(anim, 0.5, { evaluate: (expr, t) => (expr === 'q.anim_time' ? t * 10 : 1) }).a.rotation, [10, 1, 5]);
  assert.equal(animationTime(anim, 5.5), 1.5);
  assert.equal(animationTime({ loop: 'hold_on_last_frame', animation_length: 2 }, 5), 2);
  assert.equal(animationTime({ animation_length: 2 }, 5), 5);
});

test('A: solveAnimation writes plain linear keyframes when asked, and catmull-rom ones by default', () => {
  const rig = rigOf({ bones: [{ name: 'body', pivot: [0, 24, 0] }, { name: 'right_leg', pivot: [-1.9, 12, 0] }, { name: 'left_leg', pivot: [1.9, 12, 0] }] });
  const stepped = { bones: { body: { rotation: { '0.0': [38, 0, 0], '0.6': [38, 0, 0], '0.9': [45, 0, 0], '1.0': [45, 0, 0] } }, right_leg: { rotation: [4, 0, 20] } } };
  const source = { rig, poseAt: (/** @type {number} */ t) => poseAt(stepped, t), pelvis: ['right_leg', 'left_leg'], trunk: 'body' };
  const target = { rig, neutral: {}, map: { body: 'body', right_leg: 'right_leg', left_leg: 'left_leg' }, pelvis: ['right_leg', 'left_leg'], scale: 1, absolute: true };
  const linear = solveAnimation(source, target, { length: 1, times: [0.6, 0.9], step: 0.5, lerp: 'linear' });
  const frames = /** @type {Record<string, number[]>} */ (linear.bones.body.rotation);
  assert.deepEqual(Object.keys(frames).map(Number).sort((a, b) => a - b), [0, 0.5, 0.6, 0.9, 1]);
  for (const f of Object.values(frames)) assert.ok(Array.isArray(f) && f.length === 3, 'a plain [x, y, z], no lerp_mode');
  assert.ok(close(frames['0.9'][0], 45, 1e-3) && close(frames['0.6'][0], 38, 1e-3));
  assert.deepEqual(/** @type {number[]} */ (linear.bones.right_leg.rotation).map((x) => x + 0), [4, 0, 20], 'a channel that never changes is one value');
  const smooth = solveAnimation(source, target, { length: 1, times: [0.6, 0.9], step: 0.5 });
  const first = /** @type {Record<string, any>} */ (smooth.bones.body.rotation)['0.9'];
  assert.equal(first.lerp_mode, 'catmullrom');
  assert.ok(close(first.post[0], 45, 1e-3));
});

test('A: the vanilla sound events and particles we allow exist in bedrock-samples, and the particles work from an animation', (t) => {
  const repo = process.env.BEDROCK_SAMPLES ?? resolve(A_ROOT, '../mojang/bedrock-samples');
  /** @param {string} path */
  const show = (path) => execFileSync('git', ['-C', repo, 'show', `HEAD:${path}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  let sounds;
  try {
    sounds = JSON.parse(show('resource_pack/sounds/sound_definitions.json')).sound_definitions;
  } catch {
    return t.skip('bedrock-samples not found (../mojang/bedrock-samples or $BEDROCK_SAMPLES)');
  }
  assert.match(VANILLA_SOURCE, /^bedrock-samples \d+\.\d+\.\d+/);
  for (const id of VANILLA_SOUNDS) assert.ok(sounds[id], `sound event ${id}`);
  const loose = (/** @type {string} */ text) => JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : '')));
  const files = execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', 'HEAD', 'resource_pack/particles/'], { encoding: 'utf8' }).trim().split('\n');
  const found = new Map(files.map((f) => {
    const effect = loose(show(f)).particle_effect;
    return [effect.description.identifier, effect];
  }));
  for (const id of VANILLA_PARTICLES) {
    const effect = found.get(id);
    assert.ok(effect, `particle ${id}`);
    const kinds = Object.keys(effect.components ?? {});
    assert.ok(kinds.some((k) => k === 'minecraft:emitter_rate_instant' || k === 'minecraft:emitter_rate_steady'), `${id} emits by itself`);
    assert.ok(kinds.some((k) => k === 'minecraft:emitter_lifetime_once' || k === 'minecraft:emitter_lifetime_expression'), `${id} stops by itself`);
    const vars = [...JSON.stringify(effect).matchAll(/\b(?:variable|v)\.([a-z_0-9]+)/g)].map((m) => m[1]).filter((v) => !/^(particle_|emitter_)/.test(v));
    assert.deepEqual(vars, [], `${id} needs no variables from the caller`);
  }
});
