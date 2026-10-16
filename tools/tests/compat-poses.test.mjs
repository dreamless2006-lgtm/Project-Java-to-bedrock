// The compat copies of the player's poses (tools/lib/compat-poses.mjs, written by
// tools/gen/compat-poses.mjs) that player/compat.js plays on players whose game runs another player
// model, and the stand-in player entity (tools/gen/standin-pack.mjs) that plays that other model for
// testing. The generated file is git-ignored (it comes with the jar's labor poses), so its checks
// run only once it exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BLEND_WEIGHT, COMPAT_FILE, COMPAT_SOURCES, LABOR_FILE, PLAYER_FILE, STANDIN_LEFTOVER, STANDIN_UUIDS, VANILLA_BONES, WALK_GATE,
  compatAnimation, compatAnimations, compatId, sourceId, standinEntity, standinManifest,
} from '../lib/compat-poses.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const json = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** A labor-like pose: catmull-rom keyframes on vanilla bones, our belly, kick and chest bones besides. */
const LABOR_LIKE = {
  loop: true,
  animation_length: 6,
  override_previous_animation: true,
  bones: {
    rightArm: { rotation: { '0.0': { post: [0, 12.5, 12.5], lerp_mode: 'catmullrom' }, '0.5833': { post: [-39.2429, -1.9896, 17.618], lerp_mode: 'catmullrom' }, '6.0': [0, 12.5, 12.5] } },
    head: { rotation: { '0.0': [5, 0, 0], '3.0': [7.5, 0, 0] }, position: { '0.0': [0, -0.5, 0] } },
    belly: { scale: { '0.0': ['1.0 + v.k_front_kick_z * 0.0', 1, 1] } },
    front_kick: { position: { '0.0': [0, 0, 'v.k_front_kick_z'] } },
    left_kick: { position: { '0.0': [0, 0, 0] } },
    boobs: { rotation: { '0.0': [-5, 0, 0] } },
  },
};

test('the 22 poses of §2, each from its own file', () => {
  const labor = ['labor_water_breaking', 'labor_prebirth', 'labor_birth', 'labor_postbirth', 'labor_miscarriage'];
  const player = ['back_pain', ...Array.from({ length: 10 }, (_, p) => `belly_rubbing_p${p}`), ...Array.from({ length: 6 }, (_, i) => `walking_heavy_p${i + 4}`)];
  assert.deepEqual(COMPAT_SOURCES.map((s) => s.name), [...labor, ...player]);
  for (const s of COMPAT_SOURCES) assert.equal(s.file, labor.includes(s.name) ? LABOR_FILE : PLAYER_FILE, s.name);
  assert.deepEqual(COMPAT_SOURCES.filter((s) => s.walk).map((s) => s.name), player.filter((n) => n.startsWith('walking_heavy_')));
  assert.equal(compatId('labor_birth'), 'animation.minepreggo.as.labor_birth');
  assert.equal(sourceId('labor_birth'), 'animation.minepreggo.player.labor_birth');
  assert.deepEqual(VANILLA_BONES, ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']);
});

test('a copy keeps only the vanilla bones, verbatim, and is gated by its blend weight', () => {
  const copy = compatAnimation(LABOR_LIKE);
  assert.ok(copy);
  assert.deepEqual(Object.keys(copy.bones).sort(), ['head', 'rightArm']);
  // byte-identical channels: catmull-rom keyframes stay exactly as they were (no Molang creeps in)
  assert.equal(JSON.stringify(copy.bones.rightArm), JSON.stringify(LABOR_LIKE.bones.rightArm));
  assert.equal(JSON.stringify(copy.bones.head), JSON.stringify(LABOR_LIKE.bones.head));
  assert.equal(copy.blend_weight, '(1.0 - v.mp_native) * (1.0 - v.is_first_person)');
  assert.equal(copy.blend_weight, BLEND_WEIGHT);
  assert.equal(copy.loop, true);
  assert.equal(copy.animation_length, 6);
  assert.ok(!('override_previous_animation' in copy), 'the copy adds on top of the other model, as the pose does on ours');
  // a deep copy: changing it leaves the source alone
  copy.bones.rightArm.rotation['0.0'].post[0] = 99;
  assert.equal(LABOR_LIKE.bones.rightArm.rotation['0.0'].post[0], 0);
});

test('the heavy walk only shows while she walks, and a copy with no vanilla bone is dropped', () => {
  const walk = compatAnimation({ loop: true, bones: { rightLeg: { rotation: [0, '(-6.0)', '(6.0)'] }, leftLeg: { rotation: [0, '(6.0)', '(-6.0)'] } } }, { walk: true });
  assert.equal(walk?.blend_weight, BLEND_WEIGHT + WALK_GATE);
  assert.match(walk?.blend_weight ?? '', /q\.modified_move_speed > 0\.05 && q\.is_on_ground/);
  assert.equal(compatAnimation({ loop: true, bones: { belly: { scale: [1, 1, 1] }, front_kick: { position: [0, 0, 1] }, boobs: { rotation: [1, 0, 0] } } }), null);
  assert.equal(compatAnimation({ loop: true }), null);
});

test('every pose must exist in its source file', () => {
  /** @type {Record<string, any>} */
  const files = { [LABOR_FILE]: { animations: {} }, [PLAYER_FILE]: { animations: {} } };
  for (const s of COMPAT_SOURCES) files[s.file].animations[sourceId(s.name)] = { loop: true, bones: { body: { rotation: [1, 0, 0] } } };
  const { animations, skipped } = compatAnimations(files);
  assert.equal(Object.keys(animations).length, 22);
  assert.deepEqual(skipped, []);
  files[PLAYER_FILE].animations[sourceId('belly_rubbing_p3')] = { loop: true, bones: { belly: { rotation: [1, 0, 0] } } };
  assert.deepEqual(compatAnimations(files).skipped, ['belly_rubbing_p3']);
  delete files[LABOR_FILE].animations[sourceId('labor_birth')];
  assert.throws(() => compatAnimations(files), /labor_birth is missing/);
});

test('the tracked player poses copy cleanly', () => {
  const player = json(join(RP, PLAYER_FILE)).animations;
  for (const { name, file, walk } of COMPAT_SOURCES.filter((s) => s.file === PLAYER_FILE)) {
    const source = player[sourceId(name)];
    assert.ok(source, `${name} in ${file}`);
    const copy = compatAnimation(source, { walk });
    assert.ok(copy, name);
    for (const [bone, channels] of Object.entries(copy.bones)) assert.deepEqual(channels, source.bones[bone], `${name}.${bone}`);
  }
});

test('the generated compat file holds all 22 copies', { skip: !existsSync(join(RP, COMPAT_FILE)) && 'run node tools/gen/compat-poses.mjs (npm run import) first' }, () => {
  const doc = json(join(RP, COMPAT_FILE));
  assert.equal(doc.format_version, '1.8.0');
  const ids = Object.keys(doc.animations);
  assert.equal(ids.length, 22);
  assert.deepEqual(ids.sort(), COMPAT_SOURCES.map((s) => compatId(s.name)).sort());
  const labor = existsSync(join(RP, LABOR_FILE)) ? json(join(RP, LABOR_FILE)).animations : {};
  for (const [id, animation] of Object.entries(doc.animations)) {
    assert.match(animation.blend_weight, /v\.mp_native/, id);
    assert.match(animation.blend_weight, /v\.is_first_person/, id);
    assert.ok(Object.keys(animation.bones).length, id);
    for (const bone of Object.keys(animation.bones)) assert.ok(VANILLA_BONES.includes(bone), `${id}: ${bone}`);
    const source = labor[id.replace('animation.minepreggo.as.', 'animation.minepreggo.player.')];
    if (source) for (const [bone, channels] of Object.entries(animation.bones)) assert.equal(JSON.stringify(channels), JSON.stringify(source.bones[bone]), `${id}.${bone}`);
  }
});

test('the stand-in player entity is a plain player model', () => {
  const doc = json(join(RP, 'entity/player.entity.json'));
  const before = JSON.stringify(doc);
  const standin = standinEntity(doc);
  assert.equal(JSON.stringify(doc), before, 'our own entity is left alone');
  const text = JSON.stringify(standin);
  assert.doesNotMatch(text, STANDIN_LEFTOVER);
  assert.doesNotMatch(text, /minepreggo|\bmp_/);
  const d = standin['minecraft:client_entity'].description;
  assert.equal(d.identifier, 'minecraft:player');
  assert.equal(d.enable_attachables, true, 'the off-hand belly still shows on it');
  assert.deepEqual(d.geometry, { default: 'geometry.humanoid.custom', cape: 'geometry.cape' });
  assert.deepEqual(Object.keys(d.textures).sort(), ['cape', 'default']);
  // the vanilla player keeps everything of its own
  const ours = doc['minecraft:client_entity'].description;
  for (const [name, id] of Object.entries(ours.animations)) if (!/minepreggo/.test(name + id)) assert.equal(d.animations[name], id, name);
  for (const ref of d.scripts.animate) assert.ok(d.animations[typeof ref === 'string' ? ref : Object.keys(ref)[0]], 'animate refers to a kept animation');
  const third = d.render_controllers.find((/** @type {any} */ rc) => rc['controller.render.player.third_person']);
  assert.equal(third['controller.render.player.third_person'], '!variable.is_first_person && !variable.map_face_icon && !query.is_spectator');
  assert.equal(d.render_controllers.length, 5);
  // pre_animation stops before our first line, and nothing initializes a variable it no longer sets
  const cut = ours.scripts.pre_animation.findIndex((/** @type {string} */ l) => l.includes('variable.mp_'));
  assert.deepEqual(d.scripts.pre_animation, ours.scripts.pre_animation.slice(0, cut));
  assert.ok(!('variable.mp_native' in (d.scripts.variables ?? {})));
  assert.ok(d.scripts.initialize.length > 0 && d.scripts.initialize.length < ours.scripts.initialize.length);
  assert.ok(d.scripts.initialize.includes('variable.hand_bob = 0.0;'), 'vanilla initializers are kept');
  assert.ok(!d.scripts.initialize.some((/** @type {string} */ l) => /belly_growth|kick_w|crown|\bv(ariable)?\.j[a-z]/.test(l)));
});

test('the stand-in manifest', () => {
  const m = standinManifest('0.7.0', [1, 26, 30]);
  assert.equal(m.format_version, 2);
  assert.equal(m.header.name, 'Minepreggo test: other player model');
  assert.equal(m.header.uuid, 'b3f0c6de-6a1e-4c55-9d43-7a0e5f1c2a71');
  assert.equal(m.modules[0].uuid, '5d2e8f41-0c7b-4f3a-a9e6-1b4c7d9e3f20');
  assert.deepEqual(STANDIN_UUIDS, { header: m.header.uuid, module: m.modules[0].uuid });
  assert.deepEqual(m.header.version, [0, 7, 0]);
  assert.deepEqual(m.modules[0].version, [0, 7, 0]);
  assert.equal(m.modules[0].type, 'resources');
  assert.deepEqual(m.header.min_engine_version, [1, 26, 30]);
  // never the same pack as ours
  const ownUuids = ['behavior', 'resource'].flatMap((pack) => {
    const own = json(join(ROOT, 'packs', pack, 'manifest.json'));
    return [own.header.uuid, ...own.modules.map((/** @type {any} */ mod) => mod.uuid)];
  });
  for (const uuid of Object.values(STANDIN_UUIDS)) assert.ok(!ownUuids.includes(uuid));
});
