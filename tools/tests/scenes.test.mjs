// The scenes of 0.5.0 against the mocked game API: kicks and contractions through the Jenny Bed's
// intercourse scene and the Jenny port girls' own scenes, the belly scenes (rub, feel, an assisted
// birth with the babies caught by the helper), cuddling a baby, and the pose math they rest on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputButton, InputPermissionCategory, ItemStack, Mob, Player, emit, startup, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { STEP, getRecord, setPhase, startPregnancy } from '../../packs/behavior/scripts/mobs/system.js';
import { BELLY_SCENE_TICKS, PUSH_TICKS, bellySceneOf, onSceneButton, openPregnancyMenu, startBellyScene } from '../../packs/behavior/scripts/jenny/belly_scenes.js';
import { femaleBusy, playerBusy, releaseStale } from '../../packs/behavior/scripts/jenny/occupancy.js';
import { heatOf, requestScene, sceneOf } from '../../packs/behavior/scripts/jenny/scenes.js';
import { portRhythmOf } from '../../packs/behavior/scripts/jenny/port.js';
import { CONTRACTIONS_FROM, KICKS_FROM, Rhythm, nextBeat } from '../../packs/behavior/scripts/jenny/rhythm.js';
import { BABY, cuddle } from '../../packs/behavior/scripts/items/babies.js';
import { rotateBedrock, anglesForFront, eulerFromMat, matFromEuler } from '../lib/bedrock-math.mjs';
import { rigOf, solveAt, worldOf, pivotOf } from '../lib/pose-solve.mjs';
import { AUTHORED, NEUTRAL_RIG, LEGS, jennyRig } from '../lib/scene-poses.mjs';
import { poseAt } from '../lib/geo-render.mjs';

startup();
const overworld = world.getDimension('minecraft:overworld');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const text = (/** @type {unknown} */ message) => JSON.stringify(message);
const near = (/** @type {number[]} */ a, /** @type {number[]} */ b, eps = 0.02) => a.every((v, k) => Math.abs(v - b[k]) < eps);

/** Moves a pregnancy to `phase` (the pregnancy's own phase and the one the client shows). */
function atPhase(/** @type {any} */ record, /** @type {number} */ phase) {
  record.data.pregnancy.lastPhase = Math.max(record.data.pregnancy.lastPhase, phase);
  assert.ok(setPhase(record, phase));
}

/** A pregnant female of `owner`'s, standing next to them, at `phase`. */
function pregnantFemale(/** @type {string} */ type, /** @type {Player} */ owner, /** @type {number} */ phase, babies = 2) {
  const mob = new Mob(type, { tamed: true });
  mob.location = { x: owner.location.x + 1, y: 64, z: owner.location.z };
  overworld.entities.push(mob);
  const record = getRecord(/** @type {any} */ (mob));
  record.data.owner = owner.id;
  startPregnancy(record, babies);
  atPhase(record, phase);
  return { mob, record };
}

test('the game turns bones the way the vanilla animations say: sneaking leans forward, riding splays the legs out, bob swings the arms out', () => {
  assert.ok(near(rotateBedrock([0, 1, 0], [30, 0, 0]), [0, 0.866, -0.5]), '+X tilts the top forward (-z)');
  assert.ok(near(rotateBedrock([0, 0, -1], [0, 30, 0]), [-0.5, 0, -0.866]), '+Y turns the front toward -x');
  assert.ok(near(rotateBedrock([0, 1, 0], [0, 0, 30]), [0.5, 0.866, 0]), '+Z tilts the top toward +x');
  // animation.player.riding.legs: rightleg [-81, 18, 0] about [-1.9, 12, 0] puts the foot forward and outward
  const foot = rotateBedrock([0, -12, 0], [-81, 18, 0]).map((v, k) => v + [-1.9, 12, 0][k]);
  assert.ok(near(foot, [-5.56, 10.12, -11.27], 0.05), `right foot ${foot}`);
  for (let i = 0; i < 200; i++) {
    const e = [(i * 37) % 360 - 180, ((i * 53) % 170) - 85, (i * 71) % 360 - 180];
    const back = matFromEuler(eulerFromMat(matFromEuler(e)));
    assert.ok(matFromEuler(e).every((row, r) => row.every((v, c) => Math.abs(v - back[r][c]) < 1e-9)), `euler round trip ${e}`);
  }
  for (const n of [[0.6, 0, -0.8], [-0.36, 0.48, -0.8], [0, -0.6, -0.8]]) assert.ok(near(rotateBedrock([0, 0, -1], anglesForFront(n)), n), `slab faces ${n}`);
});

test('a pose solved onto a Jenny-mod rig keeps its pelvis where the source puts it, and limbs where the source points them', () => {
  // a small hierarchical rig like the port's girls: a root, a trunk with a head and arms, legs on the root
  // (her forearm is modelled folded and turned straight by a cube rotation that cancels its bone's)
  const geometry = {
    bones: [
      { name: 'body', pivot: [0, 0, 0] },
      { name: 'upperBody', parent: 'body', pivot: [0, 11, 0] },
      { name: 'torso', parent: 'upperBody', pivot: [0, 16, 0] },
      { name: 'hip', parent: 'upperBody', pivot: [0, 16, 0] },
      { name: 'head', parent: 'torso', pivot: [0, 23, 0] },
      { name: 'armR', parent: 'torso', pivot: [-4, 23, 0], rotation: [0, 0, 20], cubes: [{ origin: [-5, 17, -1], size: [2, 6, 2] }] },
      { name: 'lowerArmR', parent: 'armR', pivot: [-4, 17, 0], rotation: [-140, 0, 0], cubes: [{ origin: [-5, 11, -1], size: [2, 6, 2], pivot: [-4, 17, 0], rotation: [140, 0, 0] }] },
      { name: 'armL', parent: 'torso', pivot: [4, 23, 0], rotation: [0, 0, -20] },
      { name: 'legR', parent: 'body', pivot: [-2, 11, 0] },
      { name: 'shinR', parent: 'legR', pivot: [-2, 6, 0] },
      { name: 'legL', parent: 'body', pivot: [2, 11, 0] },
      { name: 'shinL', parent: 'legL', pivot: [2, 6, 0] },
    ],
  };
  const rig = rigOf(geometry);
  const parts = jennyRig(geometry);
  assert.ok(parts);
  assert.equal(parts.mover, 'body');
  assert.deepEqual(parts.pelvis, ['legR', 'legL']);
  const source = { rig: NEUTRAL_RIG, poseAt: (/** @type {number} */ t) => poseAt(AUTHORED.scene_sit, t), pelvis: LEGS, trunk: 'body' };
  const pose = solveAt(source, { rig, neutral: {}, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten, limbs: parts.limbs }, 0);
  const world0 = worldOf(rig, pose);
  // sitting: the hips drop by the source's 9.8, scaled to her leg length (11 / 12)
  const hip = pivotOf(rig, world0, 'legR');
  assert.ok(Math.abs(hip[1] - (11 - 9.8 * (11 / 12))) < 0.01, `hip at ${hip[1]}`);
  // the right leg points forward: its foot is in front of the hip (-z) and at the hip's height
  const foot = world0.get('legR');
  const footAt = foot ? foot.R.map((row) => row[0] * -2 + row[1] * 0 + row[2] * 0).map((v, k) => v + foot.t[k]) : [];
  assert.ok(footAt.length === 3);
  const R = /** @type {any} */ (world0.get('legR')).R;
  const down = [R[0][1] * -1, R[1][1] * -1, R[2][1] * -1];
  assert.ok(down[2] < -0.95 && Math.abs(down[1]) < 0.1, `the thigh points forward ${down}`);
  // the forearm as it is seen (its cube, folded back by the cube rotation) is straight in line with
  // the upper arm: here that is the rest pose, so no rotation
  const seen = (/** @type {string} */ name) => {
    const w = /** @type {any} */ (world0.get(name)).R, d = /** @type {number[]} */ (parts.limbs[name]), n = Math.hypot(...d);
    return w.map((/** @type {number[]} */ row) => (row[0] * d[0] + row[1] * d[1] + row[2] * d[2]) / n);
  };
  assert.ok(near(seen('lowerArmR'), seen('armR')), `forearm ${seen('lowerArmR')} along the arm ${seen('armR')}`);
  const turn = matFromEuler(/** @type {number[]} */ (pose.lowerArmR.rotation));
  assert.ok(turn.every((row, r) => row.every((v, c) => Math.abs(v - (r === c ? 1 : 0)) < 1e-6)), `forearm channel ${pose.lowerArmR.rotation}`);
  // a forearm with no cubes to go by is held at no rotation at all (its rest bend cancelled)
  const bare = solveAt(source, { rig, neutral: {}, map: parts.map, pelvis: parts.pelvis, mover: parts.mover, scale: parts.scale, absolute: true, straighten: parts.straighten }, 0);
  assert.ok(near(/** @type {number[]} */ (bare.lowerArmR.rotation), [140, 0, 0]), `bare forearm ${bare.lowerArmR.rotation}`);
});

test('the scene rhythm: kicks from P3, contractions from P6, more often the hotter the scene, each lasting a few seconds', () => {
  assert.equal(nextBeat(KICKS_FROM - 1, 1, 0, () => 0).state, 'calm', 'nothing to feel yet');
  assert.equal(nextBeat(5, 0.3, 0, () => 0.05).state, 'kicking', 'no contractions before P6');
  assert.equal(nextBeat(CONTRACTIONS_FROM, 0.3, 0, () => 0.05).state, 'contraction');
  const beat = nextBeat(9, 1, 100, () => 0.5);
  assert.equal(beat.state, 'kicking');
  assert.equal(beat.kick, 2);
  assert.ok(beat.until >= 160 && beat.until <= 210);
  const rhythm = new Rhythm();
  assert.ok(rhythm.step(7, 0.5, 0, () => 0.9));
  assert.equal(rhythm.step(7, 0.5, 10, () => 0.9), undefined, 'a beat lasts');
  assert.ok(heatOf(0) < heatOf(600) && heatOf(600) < heatOf(900));
});

test('the Jenny Bed with a pregnant female: on all fours, her babies kick and her belly tightens through the scene, and all of it is hers again after', async () => {
  const owner = new Player('Lover');
  owner.location = { x: 30, y: 64, z: 30 };
  world.players.push(owner);
  const { mob, record } = pregnantFemale('minepreggo:humanoid_creeper_girl', owner, 7);
  const random = Math.random;
  Math.random = () => 0.05; // every beat is a contraction at P7 (then kicks once it is hot)
  try {
    requestScene(record, /** @type {any} */ (owner), { location: { x: 31, y: 64, z: 30 }, facing: 2 });
    assert.ok(sceneOf(/** @type {any} */ (mob)));
    system.tick(STEP * 2);
    assert.equal(mob.getProperty('minepreggo:pose'), 'scene');
    const seen = new Set();
    for (let t = 0; t < 1000; t += STEP) {
      system.tick(STEP);
      seen.add(mob.getProperty('minepreggo:scene'));
    }
    assert.ok(seen.has('contraction'), `scene states seen: ${[...seen]}`);
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.scene.contraction')));
    system.tick(STEP * 3);
    assert.ok(!sceneOf(/** @type {any} */ (mob)));
    assert.equal(mob.getProperty('minepreggo:scene'), 'none');
    assert.notEqual(mob.getProperty('minepreggo:pose'), 'scene');
    assert.equal(record.data.pregnancy?.phase, 7, 'still the same pregnancy');
  } finally {
    Math.random = random;
    world.players.splice(world.players.indexOf(owner), 1);
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  }
});

test("a Jenny port girl's own scene: while it plays, her pregnant belly kicks on her and on the stage that plays it for her", () => {
  const watcher = new Player('Watcher');
  watcher.location = { x: 50, y: 64, z: 50 };
  world.players.push(watcher);
  const jenny = new Mob('fapcraft:jenny', { families: ['minepreggo_preggo_mob', 'jenny'] });
  jenny.location = { x: 51, y: 64, z: 50 };
  overworld.entities.push(jenny);
  const record = getRecord(/** @type {any} */ (jenny));
  startPregnancy(record, 1);
  atPhase(record, 5);
  const stage = new Mob('jhjenjava:jenny_stage', { families: ['jenny_stage'] });
  stage.location = { x: 52, y: 64, z: 50 };
  overworld.entities.push(stage);
  const random = Math.random;
  Math.random = () => 0.1; // kicks at P5
  try {
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: 'jhjenjava:start_doggy_action' });
    assert.ok(portRhythmOf(/** @type {any} */ (jenny)), 'her belly joins her scene');
    system.tick(STEP * 2);
    assert.equal(jenny.getProperty('minepreggo:scene'), 'kicking');
    assert.equal(stage.getProperty('minepreggo:scene'), 'kicking', 'the stage shows the kicks');
    assert.equal(stage.getProperty('minepreggo:belly'), 'p5');
    assert.ok(watcher.messages.some((m) => text(m).includes('minepreggo.scene.kick')));
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: 'jhjenjava:finish_stage' });
    assert.ok(!portRhythmOf(/** @type {any} */ (jenny)));
    assert.equal(stage.getProperty('minepreggo:scene'), 'none');
    system.tick(STEP * 2);
    assert.equal(jenny.getProperty('minepreggo:scene'), 'none');
    // a girl too early in her pregnancy feels nothing during a scene
    atPhase(record, 1);
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: 'jhjenjava:start_blowjob' });
    assert.ok(!portRhythmOf(/** @type {any} */ (jenny)));
  } finally {
    Math.random = random;
    world.players.splice(world.players.indexOf(watcher), 1);
    for (const e of [jenny, stage]) {
      e.isValid = false;
      emit(world.afterEvents.entityRemove, { removedEntityId: e.id });
    }
  }
});

test('feel the baby: both hands on her belly, the babies kick into them, and you count their heartbeats', () => {
  const owner = new Player('Feeler');
  owner.location = { x: 70, y: 64, z: 70 };
  world.players.push(owner);
  const { mob, record } = pregnantFemale('minepreggo:zombie_girl', owner, 6, 3);
  try {
    startBellyScene(record, /** @type {any} */ (owner), 'feel');
    assert.equal(owner.animations.at(-1)?.name, 'animation.minepreggo.scene.player_feel');
    assert.equal(owner.cameras.at(-1)?.preset, 'minecraft:free');
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), false);
    system.tick(STEP * 2);
    assert.equal(mob.getProperty('minepreggo:pose'), 'scene_sit', 'she sits back on her hands');
    assert.equal(mob.getProperty('minepreggo:scene'), 'kicking');
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.belly.feel_kick')));
    system.tick(BELLY_SCENE_TICKS.feel);
    assert.ok(!bellySceneOf(/** @type {any} */ (mob)));
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.belly.heartbeats') && text(m).includes('"3"')), 'three heartbeats');
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), true);
    assert.equal(owner.cameras.at(-1), 'clear');
    system.tick(STEP);
    assert.equal(mob.getProperty('minepreggo:scene'), 'none');
  } finally {
    world.players.splice(world.players.indexOf(owner), 1);
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  }
});

test("helping her give birth: every sneak press pushes with her, the babies are born into the helper's arms, jump stops", async () => {
  const owner = new Player('Midwife');
  owner.location = { x: 90, y: 64, z: 90 };
  world.players.push(owner);
  const { mob, record } = pregnantFemale('minepreggo:zombie_girl', owner, 7, 2);
  try {
    const p = /** @type {any} */ (record.data.pregnancy);
    p.pain = { type: 'PREBIRTH', duration: 600, severity: 0, elapsed: 0 };
    // the menu offers the birth only in labor
    owner.isSneaking = true;
    owner.formSelections = [0];
    emit(world.beforeEvents.playerInteractWithEntity, { player: owner, target: mob, itemStack: undefined, cancel: false });
    await flush();
    assert.equal(owner.forms.at(-1).buttons.length, 2, 'in labor: help with the birth, OK');
    owner.isSneaking = false;
    const scene = bellySceneOf(/** @type {any} */ (mob));
    assert.equal(scene?.kind, 'birth');
    assert.equal(owner.animations.at(-1)?.name, 'animation.minepreggo.scene.player_catch');
    assert.equal(owner.permissions.get(InputPermissionCategory.Sneak), undefined, 'sneak stays free to push');
    // pushes move the labor on
    for (let i = 0; i < 20; i++) {
      system.tick(5);
      onSceneButton(/** @type {any} */ (owner), InputButton.Sneak);
    }
    assert.ok(p.pain.type === 'BIRTH' || p.pain.elapsed >= 20 * PUSH_TICKS - PUSH_TICKS, `labor moved on (${p.pain.type} ${p.pain.elapsed})`);
    for (let i = 0; i < 400 && record.data.pregnancy; i++) {
      system.tick(5);
      onSceneButton(/** @type {any} */ (owner), InputButton.Sneak);
    }
    const babies = owner.inventory.filter((id) => id === 'minepreggo:baby_zombie');
    assert.equal(babies.length, 2, `both babies caught (${owner.inventory})`);
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.birth.caught')));
    system.tick(STEP * 30);
    assert.ok(!bellySceneOf(/** @type {any} */ (mob)), 'over once the babies are born');
    assert.equal(record.birthHelper, undefined);
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.belly.birth_done')), 'all born');
    assert.ok(!femaleBusy(mob.id) && !playerBusy(owner.id), 'both free again');
  } finally {
    world.players.splice(world.players.indexOf(owner), 1);
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  }
});

test('a stranger cannot open the pregnancy menu of your tamed female, a Jenny girl lets anyone, and jump ends a rub', async () => {
  const owner = new Player('Owner2');
  owner.location = { x: 110, y: 64, z: 110 };
  const stranger = new Player('Stranger2');
  stranger.location = { x: 110, y: 64, z: 111 };
  world.players.push(owner, stranger);
  const { mob, record } = pregnantFemale('minepreggo:ender_woman', owner, 4);
  try {
    stranger.isSneaking = true;
    emit(world.beforeEvents.playerInteractWithEntity, { player: stranger, target: mob, itemStack: undefined, cancel: false });
    await flush();
    assert.ok(stranger.messages.some((m) => text(m).includes('minepreggo.bed.not_yours')));
    startBellyScene(record, /** @type {any} */ (owner), 'rub');
    assert.equal(record.data.pregnancy?.phase, 4);
    onSceneButton(/** @type {any} */ (owner), InputButton.Jump);
    assert.ok(!bellySceneOf(/** @type {any} */ (mob)), 'jump stops it');
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), true);
  } finally {
    world.players.splice(world.players.indexOf(owner), 1);
    world.players.splice(world.players.indexOf(stranger), 1);
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  }
});

test('babies are cuddled when used, and every baby item is one (not the duplication potion)', () => {
  const player = new Player('Parent');
  assert.ok(BABY.test('minepreggo:baby_human') && BABY.test('minepreggo:baby_jenny') && !BABY.test('minepreggo:baby_duplication_potion_1'));
  system.tick(40);
  emit(world.afterEvents.itemUse, { source: player, itemStack: new ItemStack('minepreggo:baby_zombie') });
  assert.ok(player.messages.some((m) => text(m).includes('minepreggo.baby.cuddle') && text(m).includes('item.minepreggo.baby_zombie')));
  assert.equal(cuddle(/** @type {any} */ (player), 'minepreggo:baby_zombie'), false, 'one cuddle a second');
});

test('every generated pose: each Jenny girl has her labor and scene poses and a baby, every humanoid family her scene poses, monsters keep their stance', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const RP = new URL('../../packs/resource/', import.meta.url).pathname;
  const BP = new URL('../../packs/behavior/', import.meta.url).pathname;
  const json = (/** @type {string} */ f) => JSON.parse(readFileSync(f, 'utf8'));
  // our families: the pain controller enters the scene poses, each humanoid family has them solved onto her rig
  const pain = json(join(RP, 'animation_controllers/preggo_mob.animation_controllers.json')).animation_controllers['controller.animation.minepreggo.preggo_mob.pain'];
  for (const pose of ['scene', 'scene_sit']) {
    // the pose solved onto her body at her phase (each phase's belly sits on a body of its own)
    const played = pain.states[pose].animations;
    assert.deepEqual(played[0], { [`${pose}_pose`]: 'v.bp < 0' });
    for (let n = 0; n < played.length - 1; n++) assert.deepEqual(played[n + 1], { [`${pose}_pose_p${n}`]: `v.bp == ${n}` });
    assert.ok(pain.states.default.transitions.some((/** @type {any} */ t) => t[pose] === `v.pose == '${pose}'`));
  }
  const scenePoses = existsSync(join(RP, 'animations/minepreggo/scene_poses.animation.json')) ? json(join(RP, 'animations/minepreggo/scene_poses.animation.json')).animations : undefined;
  for (const family of ['zombie_girl', 'humanoid_creeper_girl', 'ender_woman', 'humanoid_slime_girl', 'monster_creeper_girl', 'monster_slime_girl']) {
    const d = json(join(RP, 'entity', `${family}.entity.json`))['minecraft:client_entity'].description;
    if (family.startsWith('monster_')) {
      assert.equal(d.animations.scene_pose, 'animation.minepreggo.no_pose', `${family} keeps her stance (no second copy of her idle)`);
      continue;
    }
    assert.equal(d.animations.scene_pose, `animation.minepreggo.${family}.scene`);
    const phased = Object.keys(d.animations).filter((n) => /^scene_pose_p\d+$/.test(n));
    assert.ok(phased.length > 0, `${family} has her scene pose per phase body`);
    if (scenePoses) {
      for (const suffix of ['', ...phased.map((n) => n.slice('scene_pose'.length))]) {
        assert.equal(d.animations[`scene_pose${suffix}`], `animation.minepreggo.${family}.scene${suffix}`);
        const scene = scenePoses[`animation.minepreggo.${family}.scene${suffix}`];
        assert.ok(scene?.override_previous_animation && scene.bones.body && scene.bones.right_leg, `${family}${suffix}`);
        assert.equal(scene.animation_length, 0.52, 'rocking to the beat of the player animation');
      }
    }
  }
  const BIRTH_BONES = ['upperBody', 'head', 'armR', 'armL'];
  const girls = { jenny: 'jenny', bia: 'bia', slime: 'slime_girl', luna: 'luna', galath: 'galath', allie: 'allie', manglelie: 'manglelie', bee: 'bee', kobold: 'kobold', ellie: 'ellie' };
  for (const [file, slug] of Object.entries(girls)) {
    const client = join(RP, 'entity/jenny_port', `${file}.json`);
    if (!existsSync(client)) return; // the Jenny add-ons are not imported
    const d = json(client)['minecraft:client_entity'].description;
    const poses = json(join(RP, `animations/jenny_port/minepreggo/${slug}_poses.animation.json`)).animations;
    for (const pose of ['contraction', 'prebirth', 'birth', 'postbirth', 'scene', 'scene_sit']) {
      const animation = poses[`animation.minepreggo.jp_${slug}.${pose}`];
      assert.ok(animation, `${slug} ${pose}`);
      assert.equal(d.animations[`mp_pose_${pose}`], `animation.minepreggo.jp_${slug}.${pose}`);
      if (pose === 'birth') assert.ok(BIRTH_BONES.filter((b) => animation.bones[b]).length >= 2, `${slug} birth moves her`);
    }
    assert.ok(d.scripts.animate.includes('mp_pose_controller') && d.scripts.pre_animation.some((/** @type {string} */ l) => l.startsWith('v.jp_normal = ')));
    assert.ok(existsSync(join(BP, `items/jenny_port/minepreggo/baby_${slug}.json`)), `${slug}'s baby`);
    assert.ok(existsSync(join(RP, `textures/jenny_port/minepreggo/baby_${slug}.png`)), `${slug}'s baby icon`);
  }
  // the slime girl's dress and hat follow her body (a second chain of bones beside it)
  const slime = json(join(RP, 'animations/jenny_port/minepreggo/slime_girl_poses.animation.json')).animations['animation.minepreggo.jp_slime_girl.birth'];
  assert.deepEqual(slime.bones.dress, slime.bones.upperBody);
  assert.deepEqual(slime.bones.hat, slime.bones.head);
});

test('scenes never overlap: a second player choosing late, a female walking to the bed, a belly scene on a player already in one', async () => {
  const a = new Player('FirstA');
  a.location = { x: 130, y: 64, z: 130 };
  const b = new Player('SecondB');
  b.location = { x: 130, y: 64, z: 131 };
  world.players.push(a, b);
  const jenny = new Mob('fapcraft:jenny', { families: ['minepreggo_preggo_mob', 'jenny'] });
  jenny.location = { x: 131, y: 64, z: 130 };
  overworld.entities.push(jenny);
  const record = getRecord(/** @type {any} */ (jenny));
  startPregnancy(record, 1);
  atPhase(record, 4);
  try {
    // both open her menu before either chooses; the second choice finds her taken
    a.formSelections = [0];
    b.formSelections = [1];
    const first = openPregnancyMenu(/** @type {any} */ (a), record);
    const second = openPregnancyMenu(/** @type {any} */ (b), record);
    await Promise.all([first, second]);
    assert.equal(bellySceneOf(/** @type {any} */ (jenny))?.playerId, a.id);
    assert.ok(b.messages.some((m) => text(m).includes('minepreggo.bed.busy')), 'the late chooser is told she is busy');
    assert.equal(b.permissions.get(InputPermissionCategory.LateralMovement), undefined, 'and is never locked');
    assert.equal(startBellyScene(record, /** @type {any} */ (b), 'feel'), false);
    onSceneButton(/** @type {any} */ (a), InputButton.Jump);
    assert.ok(!femaleBusy(jenny.id));
    // a hold every second whatever tick the scene started on
    system.tick(3);
    startBellyScene(record, /** @type {any} */ (a), 'rub');
    jenny.teleports.length = 0;
    system.tick(65);
    assert.ok(jenny.teleports.length >= 2, `held in place (${jenny.teleports.length})`);
    onSceneButton(/** @type {any} */ (a), InputButton.Jump);
    // a female walking to the bed is taken: no belly scene for her or her player meanwhile
    const owner = new Player('Walker');
    owner.location = { x: 140, y: 64, z: 140 };
    world.players.push(owner);
    const { mob, record: ours } = pregnantFemale('minepreggo:zombie_girl', owner, 4);
    assert.equal(requestScene(ours, /** @type {any} */ (owner), { location: { x: 150, y: 64, z: 140 }, facing: 2 }), 'walking');
    assert.equal(startBellyScene(ours, /** @type {any} */ (owner), 'rub'), false, 'she is on her way to the bed');
    owner.isSneaking = true;
    emit(world.beforeEvents.playerInteractWithEntity, { player: owner, target: mob, itemStack: undefined, cancel: false });
    await flush();
    assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.bed.busy')));
    world.players.splice(world.players.indexOf(owner), 1);
    emit(world.afterEvents.playerLeave, { playerId: owner.id });
    assert.ok(!femaleBusy(mob.id), 'the walk is given back when the player leaves');
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  } finally {
    world.players.splice(world.players.indexOf(a), 1);
    world.players.splice(world.players.indexOf(b), 1);
    jenny.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: jenny.id });
  }
});

test('a player who leaves in the middle of a scene gets their input and camera back when they return', () => {
  const owner = new Player('Leaver');
  owner.location = { x: 160, y: 64, z: 160 };
  world.players.push(owner);
  const { mob, record } = pregnantFemale('minepreggo:zombie_girl', owner, 5);
  try {
    startBellyScene(record, /** @type {any} */ (owner), 'feel');
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), false);
    world.players.splice(world.players.indexOf(owner), 1);
    emit(world.afterEvents.playerLeave, { playerId: owner.id });
    assert.ok(!bellySceneOf(/** @type {any} */ (mob)));
    // still locked (the game keeps it with the player), until they spawn again
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), false);
    world.players.push(owner);
    emit(world.afterEvents.playerSpawn, { player: owner, initialSpawn: true });
    assert.equal(owner.permissions.get(InputPermissionCategory.LateralMovement), true);
    assert.equal(owner.cameras.at(-1), 'clear');
    assert.equal(releaseStale(/** @type {any} */ (owner)), false, 'only once');
  } finally {
    world.players.splice(world.players.indexOf(owner), 1);
    mob.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: mob.id });
  }
});

test("a Jenny girl's belly joins only her intimate scenes, not a fight, a walk or a chat", () => {
  const jenny = new Mob('fapcraft:jenny', { families: ['minepreggo_preggo_mob', 'jenny'] });
  jenny.location = { x: 170, y: 64, z: 170 };
  overworld.entities.push(jenny);
  const record = getRecord(/** @type {any} */ (jenny));
  startPregnancy(record, 1);
  atPhase(record, 6);
  try {
    for (const event of ['jhjenjava:start_combat', 'jhjenjava:start_strip', 'jhjenjava:start_payment', 'jhjenjava:start_doggy_stage']) {
      emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: event });
      assert.ok(!portRhythmOf(/** @type {any} */ (jenny)), event);
    }
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: 'jhjenjava:start_boobjob' });
    assert.ok(portRhythmOf(/** @type {any} */ (jenny)), 'an intimate scene');
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: jenny, eventId: 'jhjenjava:finish_stage' });
    assert.ok(!portRhythmOf(/** @type {any} */ (jenny)));
  } finally {
    jenny.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: jenny.id });
  }
});
