// Actions & Stuff: its player model replaces ours, so the pregnancy reaches its players through the
// Script API (poses) and an off-hand belly (an attachable that follows any player model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ItemLockMode, Player, emit, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { BELLY_ITEM, RESEND_TICKS, poseOf, sendPose, setSettings, settingsOf, syncBelly } from '../../packs/behavior/scripts/player/compat.js';
import { openSettings } from '../../packs/behavior/scripts/world/guide.js';
import { getRecord } from '../../packs/behavior/scripts/pregnancy/system.js';
import { startBellyRub } from '../../packs/behavior/scripts/pregnancy/index.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const json = (/** @type {string} */ f) => JSON.parse(readFileSync(ROOT + f, 'utf8'));
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the off-hand belly: held while she wants it and shows a belly, locked there and kept on death, put away after', () => {
  const mother = new Player('Holder');
  assert.deepEqual(settingsOf(/** @type {any} */ (mother)), { viewer: false, belly: false }, 'both off by default');
  mother.setProperty('minepreggo:phase', 6);
  syncBelly(/** @type {any} */ (mother));
  assert.equal(mother.offhand, undefined, 'only when she asks for it');
  setSettings(/** @type {any} */ (mother), { viewer: false, belly: true });
  const held = /** @type {any} */ (mother.offhand);
  assert.equal(held?.typeId, 'minepreggo:belly_p6');
  assert.equal(held.lockMode, ItemLockMode.slot);
  assert.equal(held.keepOnDeath, true);
  mother.setProperty('minepreggo:phase', 7);
  syncBelly(/** @type {any} */ (mother));
  assert.equal(/** @type {any} */ (mother.offhand).typeId, 'minepreggo:belly_p7', 'it grows with her');
  mother.setProperty('minepreggo:phase', -1);
  syncBelly(/** @type {any} */ (mother));
  assert.equal(mother.offhand, undefined, 'gone once she is not pregnant');
  // her shield stays where it is; she is told to put it away
  mother.setProperty('minepreggo:phase', 5);
  mother.offhand = /** @type {any} */ ({ typeId: 'minecraft:shield', amount: 1 });
  syncBelly(/** @type {any} */ (mother));
  assert.equal(/** @type {any} */ (mother.offhand).typeId, 'minecraft:shield');
  assert.ok(mother.messages.some((m) => JSON.stringify(m).includes('minepreggo.compat.offhand_taken')));
  assert.ok(BELLY_ITEM.test('minepreggo:belly_p0') && !BELLY_ITEM.test('minepreggo:baby_human'));
});

test('her poses reach the games running Actions & Stuff (and only them), are played again now and then, and end with her pose', () => {
  const mother = new Player('Laboring');
  const ans = new Player('Viewer');
  const plain = new Player('Plain');
  setSettings(/** @type {any} */ (ans), { viewer: true, belly: false });
  mother.setProperty('minepreggo:pose', 'birth');
  mother.setProperty('minepreggo:phase', 7);
  const pose = poseOf(/** @type {any} */ (mother));
  assert.equal(pose?.animation, 'animation.minepreggo.player.labor_birth');
  assert.equal(pose?.stop, "q.property('minepreggo:pose') != 'birth'");
  assert.ok(sendPose(/** @type {any} */ (mother), /** @type {any} */ ([ans])));
  const call = mother.animations.at(-1);
  assert.equal(call?.name, 'animation.minepreggo.player.labor_birth');
  assert.deepEqual(call?.options.players, [ans], 'only to the Actions & Stuff player');
  assert.equal(call?.options.controller, 'minepreggo_pose');
  assert.ok(!sendPose(/** @type {any} */ (mother), /** @type {any} */ ([ans])), 'not again at once');
  system.tick(RESEND_TICKS);
  assert.ok(sendPose(/** @type {any} */ (mother), /** @type {any} */ ([ans])), 'again after a while');
  mother.setProperty('minepreggo:pose', 'rubbing');
  assert.equal(poseOf(/** @type {any} */ (mother))?.animation, 'animation.minepreggo.player.belly_rubbing_p7');
  mother.setProperty('minepreggo:pose', 'none');
  assert.equal(poseOf(/** @type {any} */ (mother)), undefined);
  assert.equal(plain.animations.length, 0);
  // every pose it plays is one of the player model's own
  const ids = new Set(Object.keys(json('packs/resource/animations/player.animation.json').animations));
  const labor = ROOT + 'packs/resource/animations/minepreggo/player_labor.animation.json';
  if (existsSync(labor)) for (const id of Object.keys(JSON.parse(readFileSync(labor, 'utf8')).animations)) ids.add(id);
  for (const p of ['water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'back_pain']) {
    mother.setProperty('minepreggo:pose', p);
    const id = /** @type {any} */ (poseOf(/** @type {any} */ (mother))).animation;
    assert.ok(!existsSync(labor) || ids.has(id), `${p}: ${id}`);
  }
});

test('on an Actions & Stuff game the belly rub comes from the guide book, and the settings page saves both choices', async () => {
  const player = new Player('Rubber');
  world.players.push(player);
  try {
    const record = getRecord(/** @type {any} */ (player));
    record.setGender('female');
    record.pregnancy = /** @type {any} */ ({ phase: 5, pain: null, symptoms: {}, womb: ['HUMAN'], daysByPhase: [1, 1, 1, 1, 1, 1], daysPassed: 0, timer: 0 });
    setSettings(/** @type {any} */ (player), { viewer: true, belly: false });
    assert.ok(startBellyRub(record));
    assert.ok(record.rubUntil > system.currentTick);
    // the settings page
    player.formValues = [[false, true]];
    let back = false;
    openSettings(/** @type {any} */ (player), () => (back = true));
    await flush();
    assert.deepEqual(settingsOf(/** @type {any} */ (player)), { viewer: false, belly: true });
    assert.ok(back);
    assert.equal(player.forms.at(-1)?.controls.length, 2);
  } finally {
    world.players.splice(world.players.indexOf(player), 1);
    emit(world.afterEvents.playerLeave, { playerId: player.id });
  }
});

test('the native player model marks itself, and each belly item has an attachable that hides there and in first person', () => {
  const player = json('packs/resource/entity/player.entity.json')['minecraft:client_entity'].description;
  assert.equal(player.scripts.variables['variable.mp_native'], 'public');
  assert.equal(player.variables, undefined, 'public variables belong under scripts');
  assert.ok(player.scripts.initialize.includes('variable.mp_native = 1.0;'));
  for (let p = 0; p <= 9; p++) {
    const item = json(`packs/behavior/items/belly/belly_p${p}.json`)['minecraft:item'];
    assert.equal(item.description.identifier, `minepreggo:belly_p${p}`);
    assert.deepEqual(item.components['minecraft:allow_off_hand'], { value: true });
    const attachable = json(`packs/resource/attachables/belly_p${p}.json`)['minecraft:attachable'].description;
    assert.equal(attachable.identifier, `minepreggo:belly_p${p}`);
    assert.equal(attachable.geometry.default, `geometry.minepreggo.belly_attachable_p${p}`);
    assert.ok(attachable.scripts.pre_animation[0].includes('c.owning_entity->v.mp_native') && attachable.scripts.pre_animation[0].includes('c.is_first_person'));
  }
  const model = ROOT + 'packs/resource/models/entity/minepreggo/attachable/belly_p7.geo.json';
  if (existsSync(model)) {
    const bones = JSON.parse(readFileSync(model, 'utf8'))['minecraft:geometry'][0].bones;
    assert.equal(bones.find((/** @type {any} */ b) => b.name === 'mp_body')?.binding, "'body'", 'bound to her body');
    assert.equal(bones.find((/** @type {any} */ b) => b.name === 'belly')?.parent, 'mp_body');
  }
});
