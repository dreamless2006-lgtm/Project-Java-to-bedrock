// The walk jiggle (tools/lib/walk-jiggle.mjs) and the player's own view of her chest and belly in
// first person (animation.minepreggo.player.first_person_view, written by tools/gen-belly-render.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MINEPREGGO_JIGGLE_BONES, walkJiggleAnimation } from '../lib/walk-jiggle.mjs';
import { mergePoses, poseAt, poseBones } from '../lib/geo-render.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(join(RP, file), 'utf8'));
const animations = read('animations/walk_jiggle.animation.json').animations;

test('the walk jiggle: still when she stands, a bounce of every soft part when she walks', () => {
  const jiggle = walkJiggleAnimation(MINEPREGGO_JIGGLE_BONES);
  assert.deepEqual(animations['animation.minepreggo.walk_jiggle'], jiggle);
  const at = (/** @type {number} */ speed, /** @type {number} */ distance) => poseAt(jiggle, 0, { evaluate: { q: { modified_move_speed: speed, modified_distance_moved: distance } } });
  for (const [bone, pose] of Object.entries(at(0, 3.3))) for (const channel of Object.values(pose)) for (const v of /** @type {number[]} */ (channel)) assert.equal(Math.abs(v), 0, bone);
  const walking = at(0.4, 3.3);
  for (const bone of ['boobs', 'left_boob', 'right_boob', 'belly', 'left_butt', 'right_butt']) {
    const moved = Object.values(walking[bone]).flat().some((v) => Math.abs(/** @type {number} */ (v)) > 0.01);
    assert.ok(moved, `${bone} bounces`);
  }
  // the breasts and buttocks sway apart
  assert.ok(Math.abs(Number(walking.left_boob.rotation?.[2]) + Number(walking.right_boob.rotation?.[2])) < 1e-9);
  assert.ok(Math.abs(Number(walking.left_butt.rotation?.[0]) + Number(walking.right_butt.rotation?.[0])) < 1e-9);
});

test('every female and the player play the walk jiggle', () => {
  for (const family of ['zombie_girl', 'humanoid_creeper_girl', 'monster_creeper_girl', 'ender_woman', 'humanoid_slime_girl', 'monster_slime_girl']) {
    const d = read(`entity/${family}.entity.json`)['minecraft:client_entity'].description;
    assert.equal(d.animations.walk_jiggle, 'animation.minepreggo.walk_jiggle', family);
    assert.ok(d.scripts.animate.includes('walk_jiggle'), family);
  }
  const d = read('entity/player.entity.json')['minecraft:client_entity'].description;
  const entry = (/** @type {string} */ name) => d.scripts.animate.find((/** @type {any} */ a) => typeof a === 'object' && name in a)?.[name];
  assert.equal(entry('minepreggo_walk_jiggle'), 'variable.mp_female');
  assert.equal(entry('minepreggo_first_person_view'), 'variable.is_first_person && variable.mp_female');
  for (const rc of d.render_controllers) if (typeof rc === 'object') assert.doesNotMatch(Object.values(rc)[0], /player_x_rotation > 15/);
});

test('in first person her chest and belly stay where they are on her as the camera pitches (once imported)', (t) => {
  const models = join(RP, 'models/entity/minepreggo');
  if (!existsSync(join(models, 'player_body_custom_p9.geo.json'))) return t.skip('run npm run import first');
  const view = animations['animation.minepreggo.player.first_person_view'];
  for (const name of ['player_boobs_custom', 'player_boobs_predefined', 'player_body_custom_p5', 'player_body_custom_p9', 'player_body_predefined_p9']) {
    const g = read(`models/entity/minepreggo/${name}.geo.json`)['minecraft:geometry'][0];
    const offset = (/** @type {string} */ bone) => {
      const own = g.bones.find((/** @type {any} */ b) => b.name === bone);
      const body = g.bones.find((/** @type {any} */ b) => b.name === 'body');
      return own ? [own.pivot[1] - body.pivot[1], own.pivot[2] - body.pivot[2]] : [0, 0];
    };
    const v = { fp_belly_y: offset('belly')[0], fp_belly_z: offset('belly')[1], fp_boobs_y: offset('boobs')[0], fp_boobs_z: offset('boobs')[1] };
    for (const [pitch, yaw] of [[30, 0], [70, 25], [89, -40]]) {
      // the game's first-person base pose turns her body with the camera
      const posed = poseBones(g, mergePoses([{ body: { rotation: [pitch, yaw, 0] } }, poseAt(view, 0, { evaluate: { v, q: { target_x_rotation: pitch } } })]));
      const upright = poseBones(g, { body: { rotation: [0, yaw, 0] } });
      for (const bone of ['boobs', 'belly']) {
        if (!g.bones.some((/** @type {any} */ b) => b.name === bone)) continue;
        for (const p of [[0, 18, -6], [3, 12, -9], [-2, 22, -4]]) {
          const [got, want] = [posed.get(bone)?.(p), upright.get(bone)?.(p)];
          assert.ok(got && want && Math.hypot(...got.map((x, k) => x - want[k])) < 1e-6, `${name} ${bone} at ${pitch}°`);
        }
      }
    }
  }
});

test('the player: her heavy walk swings her arms too, and her labor poses play alone and never in first person', () => {
  const player = read('animations/player.animation.json').animations;
  for (let p = 4; p <= 9; p++) {
    const bones = player[`animation.minepreggo.player.walking_heavy_p${p}`].bones;
    for (const arm of ['rightArm', 'leftArm']) assert.ok(bones[arm]?.rotation?.[2], `P${p} ${arm} swings`);
  }
  assert.equal(player['animation.minepreggo.player.labor_override'].override_previous_animation, true);
  const d = read('entity/player.entity.json')['minecraft:client_entity'].description;
  const names = d.scripts.animate.map((/** @type {any} */ a) => (typeof a === 'string' ? a : Object.keys(a)[0]));
  assert.equal(names.indexOf('minepreggo_labor_override') + 1, names.indexOf('minepreggo_labor_water_breaking'), 'the rest pose comes right before the labor poses');
  for (const a of d.scripts.animate) {
    const name = typeof a === 'string' ? a : Object.keys(a)[0];
    if (/^minepreggo_(labor_|crowning)/.test(name)) assert.match(a[name], /^!variable\.is_first_person && /, name);
  }
});

test('her chest and belly layers hang from vanilla root > waist, so they follow her sneaking, swimming and crawling (once imported)', (t) => {
  const models = join(RP, 'models/entity/minepreggo');
  if (!existsSync(join(models, 'player_body_custom_p9.geo.json'))) return t.skip('run npm run import first');
  for (const name of ['player_boobs_custom', 'player_boobs_predefined', ...[0, 5, 9].flatMap((p) => [`player_body_custom_p${p}`, `player_body_predefined_p${p}`])]) {
    const bones = read(`models/entity/minepreggo/${name}.geo.json`)['minecraft:geometry'][0].bones;
    const parent = (/** @type {string} */ bone) => bones.find((/** @type {any} */ b) => b.name === bone)?.parent;
    assert.equal(parent('root'), undefined, name);
    assert.equal(parent('waist'), 'root', name);
    assert.equal(parent('body'), 'waist', name);
    for (const leg of ['rightLeg', 'leftLeg']) if (bones.some((/** @type {any} */ b) => b.name === leg)) assert.equal(parent(leg), 'root', `${name} ${leg}`);
    assert.deepEqual(bones.filter((/** @type {any} */ b) => !b.parent).map((/** @type {any} */ b) => b.name), ['root'], name);
  }
});
