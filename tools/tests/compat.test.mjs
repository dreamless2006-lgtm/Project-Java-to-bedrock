// Actions & Stuff (or any pack with its own player model) replaces our player model, so the
// pregnancy reaches its players through the Script API: compat poses played to every nearby game
// (they do nothing where our model draws her), and an off-hand belly she agrees to once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FormCancelationReason } from './mock-server-ui.mjs';
import { GameMode, ItemLockMode, ItemStack, Player, emit, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import {
  ASK_RETRY_TICKS,
  BELLY_ITEM,
  RANGE,
  askBelly,
  bellyItemId,
  deliver,
  poseOf,
  rubGesture,
  setSettings,
  settingsOf,
  syncBelly,
  walkOf,
} from '../../packs/behavior/scripts/player/compat.js';
import { openSettings } from '../../packs/behavior/scripts/world/guide.js';
import { getRecord } from '../../packs/behavior/scripts/pregnancy/system.js';
import { runPregnancyCommand } from '../../packs/behavior/scripts/pregnancy/commands.js';
import { startBellyRub } from '../../packs/behavior/scripts/pregnancy/index.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};
const said = (/** @type {Player} */ player, /** @type {string} */ key) => player.messages.some((m) => JSON.stringify(m).includes(key));
const ids = (/** @type {Player[] | undefined} */ players) => (players ?? []).map((p) => p.id);
const any = (/** @type {unknown} */ x) => /** @type {any} */ (x);

test('no belly until she says yes; the popup comes once at P2 and "Show it" locks her belly in her off-hand, kept on death', async () => {
  const mother = new Player('Asked');
  assert.deepEqual(settingsOf(any(mother)), { belly: undefined, tone: 0, rubGesture: true }, 'never asked, Alex tone, gesture on');
  mother.setProperty('minepreggo:phase', 1);
  assert.equal(askBelly(any(mother)), false, 'nothing to show at P1');
  mother.setProperty('minepreggo:phase', 2);
  syncBelly(any(mother));
  assert.equal(mother.offhand, undefined, 'her off-hand is not taken without a yes');

  mother.formSelections = [0];
  assert.ok(askBelly(any(mother)));
  await flush();
  assert.equal(mother.forms.length, 1);
  const [form] = mother.forms;
  assert.deepEqual(form.title, { translate: 'minepreggo.compat.ask_title' });
  assert.deepEqual(form.body, { translate: 'minepreggo.compat.ask_body' });
  assert.deepEqual(form.buttons, [{ translate: 'minepreggo.compat.ask_yes' }, { translate: 'minepreggo.compat.ask_no' }]);
  assert.equal(settingsOf(any(mother)).belly, true);
  const held = any(mother.offhand);
  assert.equal(held?.typeId, 'minepreggo:belly_p2');
  assert.equal(held.lockMode, ItemLockMode.slot);
  assert.equal(held.keepOnDeath, true);
  assert.ok(said(mother, 'minepreggo.compat.belly_on'), 'told where to change it');
  mother.setProperty('minepreggo:phase', 3);
  assert.equal(askBelly(any(mother)), false, 'asked once');
  assert.equal(mother.forms.length, 1);
});

test('"Not now" is remembered (no popup at P3); a closed popup comes back at the next phase, a busy one 100 ticks later; never in labor', async () => {
  const no = new Player('Declines');
  no.setProperty('minepreggo:phase', 2);
  no.formSelections = [1];
  assert.ok(askBelly(any(no)));
  await flush();
  assert.equal(settingsOf(any(no)).belly, false);
  syncBelly(any(no));
  assert.equal(no.offhand, undefined);
  no.setProperty('minepreggo:phase', 3);
  assert.equal(askBelly(any(no)), false, 'no second popup');
  assert.equal(no.forms.length, 1);

  const busy = new Player('Busy');
  busy.setProperty('minepreggo:phase', 2);
  busy.formCancel = FormCancelationReason.UserBusy;
  assert.ok(askBelly(any(busy)));
  await flush();
  assert.equal(settingsOf(any(busy)).belly, undefined);
  assert.equal(askBelly(any(busy)), false, 'not again at once');
  system.tick(ASK_RETRY_TICKS - 1);
  assert.equal(askBelly(any(busy)), false, 'not before 100 ticks');
  system.tick(1);
  busy.formCancel = undefined;
  assert.ok(askBelly(any(busy)), 'asked again after 100 ticks');
  await flush(); // closed this time
  assert.equal(busy.forms.length, 2);
  assert.equal(settingsOf(any(busy)).belly, undefined, 'closing it answers nothing');
  system.tick(ASK_RETRY_TICKS);
  assert.equal(askBelly(any(busy)), false, 'not again in the same phase');
  busy.setProperty('minepreggo:phase', 3);
  busy.setProperty('minepreggo:pose', 'birth');
  assert.equal(askBelly(any(busy)), false, 'never in labor');
  busy.setProperty('minepreggo:pose', 'none');
  busy.formSelections = [0];
  assert.ok(askBelly(any(busy)), 'asked again at the next phase');
  await flush();
  assert.equal(any(busy.offhand)?.typeId, 'minepreggo:belly_p3');
});

test('the belly follows her phase and tone, makes way for a shield with a hint, never goes to a spectator, and is swept from her inventory', () => {
  const mother = new Player('Toned');
  mother.setProperty('minepreggo:phase', 6);
  setSettings(any(mother), { belly: true, tone: 3 });
  assert.deepEqual(settingsOf(any(mother)), { belly: true, tone: 3, rubGesture: true });
  assert.equal(any(mother.offhand)?.typeId, 'minepreggo:belly_p6_t3');
  setSettings(any(mother), { tone: 5 });
  assert.equal(any(mother.offhand)?.typeId, 'minepreggo:belly_p6_t5', 'a new tone swaps the item');
  setSettings(any(mother), { tone: 0 });
  assert.equal(any(mother.offhand)?.typeId, 'minepreggo:belly_p6', 'tone 0 is the Alex belly');
  mother.setProperty('minepreggo:phase', 7);
  syncBelly(any(mother));
  assert.equal(any(mother.offhand)?.typeId, 'minepreggo:belly_p7', 'it grows with her');
  mother.setProperty('minepreggo:phase', -1);
  syncBelly(any(mother));
  assert.equal(mother.offhand, undefined, 'gone once she is not pregnant');

  // her shield stays where it is; she is told to put it away
  mother.setProperty('minepreggo:phase', 5);
  mother.offhand = any(new ItemStack('minecraft:shield', 1));
  syncBelly(any(mother));
  assert.equal(any(mother.offhand).typeId, 'minecraft:shield');
  assert.ok(said(mother, 'minepreggo.compat.offhand_taken'));
  mother.offhand = undefined;

  // spectators hold nothing
  syncBelly(any(mother));
  assert.equal(any(mother.offhand)?.typeId, 'minepreggo:belly_p5');
  mother.gameMode = GameMode.Spectator;
  syncBelly(any(mother));
  assert.equal(mother.offhand, undefined, 'no belly for a spectator');
  mother.gameMode = GameMode.Survival;

  // stray copies in her inventory go on spawn; other items stay
  mother.inventory = ['minepreggo:belly_p4_t2', 'minecraft:bread', 'minepreggo:belly_p9'];
  emit(world.afterEvents.playerSpawn, { player: mother, initialSpawn: false });
  assert.deepEqual(mother.inventory.filter(Boolean), ['minecraft:bread']);

  assert.equal(bellyItemId(4, 0), 'minepreggo:belly_p4');
  assert.equal(bellyItemId(4, 2), 'minepreggo:belly_p4_t2');
  assert.ok(BELLY_ITEM.test('minepreggo:belly_p0') && BELLY_ITEM.test('minepreggo:belly_p9_t5'));
  assert.ok(!BELLY_ITEM.test('minepreggo:belly_p9_t6') && !BELLY_ITEM.test('minepreggo:baby_human') && !BELLY_ITEM.test('minepreggo:belly_p9_t0'));
});

test('her pose reaches every player in range without any setting: again after its loop, at once to a newcomer, never out of range or in another dimension', () => {
  const mother = new Player('Laboring');
  mother.location = { x: 5000, y: 64, z: 0 };
  const viewer = new Player('Viewer');
  viewer.location = { x: 5010, y: 64, z: 5 };
  const far = new Player('Far');
  far.location = { x: 5000 + RANGE + 1, y: 64, z: 0 };
  const above = new Player('Above');
  above.location = { x: 5000, y: 64 + RANGE + 1, z: 0 };
  const nether = new Player('Nether');
  nether.location = { ...viewer.location };
  nether.dimension = { ...nether.dimension, id: 'minecraft:nether' };
  const players = [mother, viewer, far, above, nether];
  mother.setProperty('minepreggo:pose', 'birth');
  mother.setProperty('minepreggo:phase', 7);

  const pose = poseOf(any(mother));
  assert.equal(pose?.animation, 'animation.minepreggo.as.labor_birth');
  assert.equal(pose?.loop, 180);
  assert.ok(deliver(any(mother), 'pose', any(players)));
  const call = mother.animations.at(-1);
  assert.ok(call?.name.startsWith('animation.minepreggo.as.'));
  assert.equal(call?.options.controller, 'minepreggo_pose');
  assert.equal(call?.options.blendOutTime, 0.25);
  assert.match(call?.options.stopExpression, /q\.property\('minepreggo:pose'\) != 'birth'/);
  assert.match(call?.options.stopExpression, /v\.mp_native/, 'it ends itself where our model draws her');
  assert.deepEqual(ids(call?.options.players), [mother.id, viewer.id], 'her and the player near her, in 3D');

  system.tick(179);
  assert.equal(deliver(any(mother), 'pose', any(players)), false, 'not before its loop is over (it would restart)');
  const late = new Player('Late');
  late.location = { x: 4990, y: 70, z: 0 };
  players.push(late);
  assert.ok(deliver(any(mother), 'pose', any(players)));
  assert.deepEqual(ids(mother.animations.at(-1)?.options.players), [late.id], 'a newcomer gets it at once, alone');
  assert.equal(deliver(any(mother), 'pose', any(players)), false);
  system.tick(1);
  assert.ok(deliver(any(mother), 'pose', any(players)), 'again after a loop');
  assert.deepEqual(ids(mother.animations.at(-1)?.options.players), [mother.id, viewer.id, late.id]);

  // a new pose goes out at once; no pose, nothing
  mother.setProperty('minepreggo:pose', 'postbirth');
  assert.ok(deliver(any(mother), 'pose', any(players)));
  assert.equal(mother.animations.at(-1)?.name, 'animation.minepreggo.as.labor_postbirth');
  mother.setProperty('minepreggo:pose', 'none');
  assert.equal(poseOf(any(mother)), undefined);
  assert.equal(deliver(any(mother), 'pose', any(players)), false);
  mother.setProperty('minepreggo:pose', 'rubbing');
  const rub = poseOf(any(mother));
  assert.equal(rub?.animation, 'animation.minepreggo.as.belly_rubbing_p7');
  assert.match(rub?.stop ?? '', /q\.property\('minepreggo:phase'\) != 7/);
  assert.match(rub?.stop ?? '', /v\.mp_native/);

  for (const call of mother.animations) {
    for (const outside of [far, above, nether]) assert.ok(!call.options.players.includes(outside), `${outside.name} is out of range`);
  }

  // a viewer who changes dimension or respawns gets it again at once; her own respawn re-sends it to all
  mother.setProperty('minepreggo:pose', 'birth');
  deliver(any(mother), 'pose', any(players));
  emit(world.afterEvents.playerDimensionChange, { player: viewer });
  assert.ok(deliver(any(mother), 'pose', any(players)));
  assert.deepEqual(ids(mother.animations.at(-1)?.options.players), [viewer.id]);
  getRecord(any(mother)).setGender('female');
  emit(world.afterEvents.playerSpawn, { player: mother, initialSpawn: false });
  assert.ok(deliver(any(mother), 'pose', any(players)));
  assert.deepEqual(ids(mother.animations.at(-1)?.options.players), [mother.id, viewer.id, late.id]);
});

test('the heavy walk has a track of its own from P4, and a failing playAnimation is logged once', () => {
  const mother = new Player('Walker');
  const viewer = new Player('Watcher');
  mother.setProperty('minepreggo:phase', 5);
  assert.ok(deliver(any(mother), 'walk', any([mother, viewer])));
  const call = mother.animations.at(-1);
  assert.equal(call?.name, 'animation.minepreggo.as.walking_heavy_p5');
  assert.equal(call?.options.controller, 'minepreggo_walk');
  assert.match(call?.options.stopExpression, /v\.mp_native/);
  assert.equal(deliver(any(mother), 'pose', any([mother, viewer])), false, 'no pose meanwhile');
  // as in Java, the heavy walk goes on through back pain (an additive of its own); belly rubbing and labor stop it
  mother.setProperty('minepreggo:pose', 'back_pain');
  assert.equal(walkOf(any(mother))?.animation, 'animation.minepreggo.as.walking_heavy_p5', 'she walks heavily with back pain');
  assert.equal(poseOf(any(mother))?.animation, 'animation.minepreggo.as.back_pain');
  for (const pose of ['rubbing', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage']) {
    mother.setProperty('minepreggo:pose', pose);
    assert.equal(walkOf(any(mother)), undefined, `${pose} takes over`);
  }
  assert.match(String(call?.options.stopExpression), /q\.property\('minepreggo:pose'\) == 'rubbing'/);
  mother.setProperty('minepreggo:pose', 'none');
  mother.setProperty('minepreggo:phase', 3);
  assert.equal(walkOf(any(mother)), undefined);
  assert.equal(deliver(any(mother), 'walk', any([mother, viewer])), false, 'nothing at P3');

  const thrower = new Player('Thrower');
  thrower.playAnimation = () => {
    throw new Error('no such animation');
  };
  thrower.setProperty('minepreggo:pose', 'prebirth');
  const warn = console.warn;
  let warnings = 0;
  console.warn = (/** @type {unknown} */ message) => void (String(message).includes('Actions & Stuff pose') && warnings++);
  try {
    assert.ok(deliver(any(thrower), 'pose', any([thrower])));
    system.tick(120);
    assert.ok(deliver(any(thrower), 'pose', any([thrower])));
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings, 1, 'once per session');
});

test('0.6.0 settings migrate on spawn, and every player gets the join hint once, after the banner', () => {
  const old = new Player('Migrated');
  getRecord(any(old)).setGender('female');
  old.setDynamicProperty('minepreggo:as_viewer', true);
  old.setDynamicProperty('minepreggo:as_belly', true);
  emit(world.afterEvents.playerSpawn, { player: old, initialSpawn: false });
  assert.equal(rubGesture(any(old)), false, 'her game sat her down on the gesture: it stays off');
  assert.equal(old.getDynamicProperty('minepreggo:as_viewer'), undefined);
  assert.equal(settingsOf(any(old)).belly, true, 'her belly yes is kept');
  const plain = new Player('Unmigrated');
  getRecord(any(plain)).setGender('female');
  plain.setDynamicProperty('minepreggo:as_viewer', false);
  emit(world.afterEvents.playerSpawn, { player: plain, initialSpawn: false });
  assert.equal(rubGesture(any(plain)), true);
  assert.equal(plain.getDynamicProperty('minepreggo:as_viewer'), undefined);

  const joining = new Player('Joining');
  getRecord(any(joining)).setGender('female');
  emit(world.afterEvents.playerSpawn, { player: joining, initialSpawn: true });
  system.tick(199);
  assert.ok(!said(joining, 'minepreggo.compat.hint'), 'after the banner and the self-check');
  system.tick(1);
  assert.ok(said(joining, 'minepreggo.compat.hint'));
  assert.equal(joining.getDynamicProperty('minepreggo:as_hint'), '0.7.0');
  joining.messages.length = 0;
  emit(world.afterEvents.playerSpawn, { player: joining, initialSpawn: true });
  system.tick(200);
  assert.ok(!said(joining, 'minepreggo.compat.hint'), 'only once');
  for (const p of [old, plain, joining]) p.isValid = false;
});

test('the book rub always works, the gesture can be turned off, and the settings page saves all three choices', async () => {
  const player = new Player('Rubber');
  getRecord(any(player)).setGender('female');
  runPregnancyCommand(any(player), 'start 1');
  runPregnancyCommand(any(player), 'phase 3');
  const record = getRecord(any(player));
  assert.equal(record.pregnancy?.phase, 3);
  setSettings(any(player), { belly: false }); // no popup while the loop runs
  player.isSneaking = true;
  player.getRotation = () => ({ x: 70, y: 0 });
  world.players.push(player);
  try {
    system.tick(3);
    assert.ok(record.bellyRubTicks > 0, 'crouching and looking down rubs her belly');
    setSettings(any(player), { rubGesture: false });
    system.tick(3);
    assert.equal(record.bellyRubTicks, 0, 'not with the gesture off');
    assert.ok(startBellyRub(record), 'the book still does');
    system.tick(3);
    assert.ok(record.bellyRubTicks > 0);
    player.isSneaking = false;

    // the settings page: an explainer, the belly, its tone, the gesture, the F5 check
    setSettings(any(player), { tone: 2, rubGesture: true });
    player.formValues = [[true, 3, false]];
    let back = false;
    openSettings(any(player), () => (back = true));
    await flush();
    const form = player.forms.at(-1);
    assert.equal(form?.controls.length, 5);
    assert.deepEqual(form?.controls.map((/** @type {any} */ c) => c.type), ['label', 'toggle', 'dropdown', 'toggle', 'label']);
    assert.equal(form?.controls[1].value, false, 'her belly answer (no)');
    assert.equal(form?.controls[2].value, 2, 'her tone');
    assert.equal(form?.controls[2].items.length, 6);
    assert.equal(form?.controls[3].value, true, 'the gesture');
    assert.deepEqual(settingsOf(any(player)), { belly: true, tone: 3, rubGesture: false });
    assert.ok(back);
    assert.ok(said(player, 'minepreggo.compat.saved'));
    assert.equal(any(player.offhand)?.typeId, 'minepreggo:belly_p3_t3', 'saved and held at once');
    // labels that take a slot (undefined) change nothing
    player.formValues = [[undefined, false, 0, true, undefined]];
    openSettings(any(player), () => {});
    await flush();
    assert.deepEqual(settingsOf(any(player)), { belly: false, tone: 0, rubGesture: true });
    assert.equal(player.offhand, undefined);
  } finally {
    world.players.splice(world.players.indexOf(player), 1);
    emit(world.afterEvents.playerLeave, { playerId: player.id });
  }
});

test('our player model marks itself for the compat poses, and every one the scripts can play is in the generated compat file', () => {
  const description = JSON.parse(readFileSync(ROOT + 'packs/resource/entity/player.entity.json', 'utf8'))['minecraft:client_entity'].description;
  assert.equal(description.scripts.variables['variable.mp_native'], 'public', 'readable by the belly attachable');
  assert.ok(description.scripts.initialize.includes('variable.mp_native = 1.0;'), 'set from the first frame: the poses weigh 0 there');
  const file = ROOT + 'packs/resource/animations/minepreggo/player_compat.animation.json';
  if (!existsSync(file)) return; // written by tools/gen/compat-poses.mjs during npm run import
  const defined = new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8')).animations));
  const player = new Player('Catalog');
  const played = new Set();
  for (let phase = -1; phase <= 9; phase++) {
    for (const pose of ['none', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'back_pain', 'rubbing', 'fetal_movement', 'contraction']) {
      player.setProperty('minepreggo:phase', phase);
      player.setProperty('minepreggo:pose', pose);
      for (const anim of [poseOf(any(player)), walkOf(any(player))]) if (anim) played.add(anim.animation);
    }
  }
  for (let p = 0; p <= 9; p++) assert.ok(played.has(`animation.minepreggo.as.belly_rubbing_p${p}`));
  for (let p = 4; p <= 9; p++) assert.ok(played.has(`animation.minepreggo.as.walking_heavy_p${p}`));
  for (const id of played) assert.ok(defined.has(id), `${id} is in player_compat.animation.json`);
});
