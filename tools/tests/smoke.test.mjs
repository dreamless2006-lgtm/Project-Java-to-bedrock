// End-to-end smoke test: loads the behavior pack's real script entry point (scripts/main.js) under
// the mocked game API and plays through what a player does in a world: joining, choosing a gender,
// drinking the potions, watching a pregnancy on the player model, meeting the preggo mobs, the
// crops and drops, and the operator commands. It also checks the parts of the packs that decide
// whether they load on every platform (consoles included): manifests without experiments, every
// custom component used by an item or block registered by the scripts, and short file paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { decodePng } from '../lib/png.mjs';
import { join, relative } from 'node:path';
import { BlockTypes, EntityDamageCause, EntityTypes, InputPermissionCategory, ItemStack, ItemTypes, Mob, Player, customComponents, customComponentsOf, emit, startup, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { selfCheck } from '../../packs/behavior/scripts/world/banner.js';
import { getRecord } from '../../packs/behavior/scripts/pregnancy/system.js';
import * as mobs from '../../packs/behavior/scripts/mobs/system.js';
import { getRecord as getMobRecord, STEP } from '../../packs/behavior/scripts/mobs/system.js';
import { VERSION } from '../../packs/behavior/scripts/version.js';
import { finalPhaseForBabies } from '../../packs/behavior/scripts/pregnancy/math.js';
import { PHASE_SLOWNESS } from '../../packs/behavior/scripts/pregnancy/data.js';
import { FERTILE_SHARE, PORT_GIRLS, inPortScene } from '../../packs/behavior/scripts/jenny/port.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const MAX_PATH = 100; // Minecraft Creator Tools warns above this; long paths break packs on some platforms

const flush = () => new Promise((resolve) => setImmediate(resolve));
/** Decodes a PNG and offers alpha lookups. */
function png(/** @type {string} */ path) {
  const image = decodePng(new Uint8Array(readFileSync(path)));
  return { ...image, alpha: (/** @type {number} */ x, /** @type {number} */ y) => (x < 0 || y < 0 || x >= image.width || y >= image.height ? 0 : image.data[(y * image.width + x) * 4 + 3]) };
}
const json = (/** @type {string} */ path) => JSON.parse(readFileSync(path, 'utf8'));
const text = (/** @type {unknown} */ message) => JSON.stringify(message);

/** Every file under `dir`, relative to it. */
function* files(dir, base = dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, base);
    else yield relative(base, path);
  }
}

/** Runs a script event as if typed with /scriptevent. */
function command(player, id, message) {
  const before = player.messages.length;
  emit(system.afterEvents.scriptEventReceive, { id, message, sourceEntity: player, sourceType: 'Entity' });
  return player.messages.slice(before).map(text).join('\n');
}

/** Our own client / behavior entity files (the imported Jenny port's sit in jenny_port/ sub-folders). */
const entityFiles = () => readdirSync(join(RP, 'entity')).filter((f) => f.endsWith('.json'));
const behaviorEntityFiles = () => readdirSync(join(BP, 'entities')).filter((f) => f.endsWith('.json'));

const overworld = world.getDimension('minecraft:overworld');
const player = new Player('Steve');
world.players.push(player);

test('both manifests are console-safe: stable modules, no experiments, matching versions', () => {
  for (const pack of [BP, RP]) {
    const manifest = json(join(pack, 'manifest.json'));
    // Format 2 with [major, minor, patch] arrays is what the game and Mojang's samples use; the
    // in-game error "must conform to format version [2]" is what other formats produce.
    assert.equal(manifest.format_version, 2);
    const version = VERSION.split('.').map(Number);
    assert.deepEqual(manifest.header.version, version);
    assert.deepEqual(manifest.header.min_engine_version, [1, 26, 30]);
    assert.ok(!('capabilities' in manifest), 'no capabilities (experimental_custom_ui, script_eval...)');
    for (const module of manifest.modules) assert.deepEqual(module.version, version);
    for (const dependency of manifest.dependencies ?? []) {
      if (dependency.module_name) assert.doesNotMatch(dependency.version, /beta|preview|internal/, `${dependency.module_name} must be a stable module`);
    }
  }
  const bp = json(join(BP, 'manifest.json'));
  assert.deepEqual(
    bp.dependencies.filter((d) => d.module_name).map((d) => `${d.module_name}@${d.version}`),
    ['@minecraft/server@2.8.0', '@minecraft/server-ui@2.0.0']
  );
  assert.equal(bp.modules.find((m) => m.type === 'script')?.entry, 'scripts/main.js');
});

test('no pack file path is longer than the platforms allow', () => {
  const long = [...files(BP), ...files(RP)].filter((path) => path.length > MAX_PATH && !path.startsWith('textures/minepreggo/mobs/'));
  assert.deepEqual(long, [], `paths over ${MAX_PATH} characters`);
  // Shipped textures are the ones the entity files reference; the import keeps those short too.
  const referenced = new Set();
  for (const file of entityFiles()) {
    const client = json(join(RP, 'entity', file))['minecraft:client_entity'].description;
    for (const texture of Object.values(client.textures ?? {})) referenced.add(`${texture}.png`);
  }
  assert.ok(referenced.size >= 7, 'entity textures are referenced');
  assert.deepEqual([...referenced].filter((path) => path.length > MAX_PATH), []);
});

test('startup registers every custom component an item or block uses', () => {
  startup();
  for (const path of files(join(BP, 'items'))) {
    if (path.includes('jenny_port')) continue; // the Jenny port's items have their own scripts
    const item = json(join(BP, 'items', path))['minecraft:item'];
    for (const component of Object.keys(item.components).filter((k) => k.startsWith('minepreggo:'))) {
      assert.ok(customComponents.items.has(component), `${path} uses ${component}`);
    }
  }
  for (const path of files(join(BP, 'blocks'))) {
    const block = json(join(BP, 'blocks', path))['minecraft:block'];
    for (const component of Object.keys(block.components).filter((k) => k.startsWith('minepreggo:'))) {
      assert.ok(customComponents.blocks.has(component), `${path} uses ${component}`);
    }
  }
  assert.ok(customComponents.items.size >= 5);
  assert.deepEqual([...customComponents.blocks.keys()].sort(), ['minepreggo:crop', 'minepreggo:jenny_bed', 'minepreggo:kobold_egg']);
});

test('joining: banner, gender form, self-check green, body properties synced', async () => {
  player.formSelection = 1; // "Female (Alex skin)"
  emit(world.afterEvents.playerSpawn, { player, initialSpawn: true });
  await flush();
  const record = getRecord(player);
  assert.equal(record.gender, 'female');
  assert.equal(record.skin, 'alex');
  assert.match(text(player.messages[0]), /minepreggo\.loaded/);
  const check0 = selfCheck(player);
  assert.deepEqual([check0.entities.missing, check0.items.missing, check0.blocks.missing, check0.visuals], [[], [], [], true]);
  assert.ok(check0.entities.total >= 6 && check0.items.total >= 100 && check0.blocks.total >= 2, 'every definition of the pack is checked');

  system.tick(40);
  const check = player.messages.find((m) => text(m).includes('minepreggo.selfcheck"'));
  assert.ok(check, 'the self-check line is sent two seconds after joining');
  // mobs, items, crops, player visuals, and the Jenny port's girls when vendor/jenny/ was imported.
  assert.equal((text(check).match(/minepreggo\.selfcheck\.ok/g) ?? []).length, existsSync(join(BP, 'entities/jenny_port')) ? 5 : 4);
  assert.doesNotMatch(text(check), /selfcheck\.fail/);

  // player/body.js pushed the choice to the player entity (what the resource pack renders from).
  assert.equal(player.getProperty('minepreggo:gender'), 'female');
  assert.equal(player.getProperty('minepreggo:skin'), 'alex');
  assert.equal(player.getProperty('minepreggo:phase'), -1);
  assert.equal(player.messages.filter((m) => text(m).includes('minepreggo.gender.later')).length, 0);
});

test('a Potion of Impregnation starts a pregnancy that the player model shows and the HUD reports', () => {
  const [[component, params]] = customComponentsOf('minepreggo:impregnation_potion_2');
  assert.equal(component, 'minepreggo:impregnation_potion');
  customComponents.items.get(component).onConsume({ source: player, itemStack: new ItemStack('minepreggo:impregnation_potion_2') }, { params });
  const record = getRecord(player);
  assert.equal(record.pending?.amplifier, 2);
  assert.equal(record.pregnancy, null, 'the effect takes 15 seconds, like Java');

  system.tick(305); // the Impregnation effect counts game ticks, then the body sync runs
  const p = record.pregnancy;
  assert.ok(p, 'pregnant after the impregnation effect');
  assert.equal(p.phase, 0);
  assert.ok(p.womb.length >= 4 && p.womb.length <= 5, 'potion level II gives 4-5 babies');
  assert.equal(player.getProperty('minepreggo:phase'), 0);

  // Operator commands drive the phase; the entity properties follow within 5 ticks.
  assert.match(command(player, 'minepreggo:pregnancy', 'phase 5'), /phase P5/);
  system.tick(5);
  assert.equal(player.getProperty('minepreggo:phase'), 5);
  const growth = player.getProperty('minepreggo:growth');
  assert.ok(growth >= 0 && growth <= 1);

  assert.match(command(player, 'minepreggo:pregnancy', 'pain fetal_movement'), /FETAL_MOVEMENT/);
  system.tick(5);
  assert.equal(player.getProperty('minepreggo:pose'), 'fetal_movement');
  assert.ok([0, 1, 2].includes(player.getProperty('minepreggo:kick')));

  player.isSneaking = true;
  system.tick(5);
  const hud = player.messages.filter((m) => text(m).includes('effect.minepreggo.pregnancy_p5'));
  assert.ok(hud.length > 0, 'crouching shows the status bar');
  assert.match(text(hud.at(-1)), /minepreggo\.hud\.day/);
  player.isSneaking = false;
  assert.match(command(player, 'minepreggo:pregnancy', 'status'), /phase P5/);
});

test('acceleration potions move the pregnancy forward, gradual ones speed the timer', () => {
  const record = getRecord(player);
  const p = record.pregnancy;
  assert.ok(p);
  // A pain is active from the previous test: end it so the acceleration applies cleanly.
  p.pain = null;
  const before = p.phase;
  let [[, params]] = customComponentsOf('minepreggo:pregnancy_acceleration_potion_0');
  customComponents.items.get('minepreggo:pregnancy_acceleration').onConsume({ source: player, itemStack: new ItemStack('minepreggo:pregnancy_acceleration_potion_0') }, { params });
  assert.ok(record.pregnancy.phase > before || record.pregnancy.daysPassed >= 4 || record.pregnancy.pain, 'four pregnancy days passed at once');

  [[, params]] = customComponentsOf('minepreggo:gradual_pregnancy_acceleration_potion_1');
  customComponents.items.get('minepreggo:gradual_pregnancy_acceleration').onConsume({ source: player, itemStack: new ItemStack('minepreggo:gradual_pregnancy_acceleration_potion_1') }, { params });
  if (record.pregnancy && !record.pregnancy.pain) {
    assert.equal(record.pregnancy.acceleration?.amplifier, 1);
    const timer = record.pregnancy.timer;
    system.tick(1);
    assert.ok(record.pregnancy === null || record.pregnancy.timer !== timer + 1 || record.pregnancy.daysPassed > 0, 'the timer runs faster than one tick per tick');
  }
  assert.match(command(player, 'minepreggo:pregnancy', 'end'), /not pregnant/);
  system.tick(5);
  assert.equal(player.getProperty('minepreggo:phase'), -1);
  assert.equal(player.getProperty('minepreggo:pose'), 'none');
});

test('the mob loop finds a naturally pregnant mob and the potions work through interaction', () => {
  const wild = new Mob('minepreggo:zombie_girl', { phase: 3 });
  overworld.entities.push(wild);
  system.tick(STEP);
  const wildRecord = getMobRecord(wild);
  assert.ok(wildRecord.data.wild, 'a mob that spawned pregnant gets hostile pregnancy data');
  assert.equal(wild.getProperty('minepreggo:phase'), 3);

  const creeper = new Mob('minepreggo:humanoid_creeper_girl');
  creeper.location = { x: 3, y: 64, z: 0 };
  overworld.entities.push(creeper);
  const event = { player, target: creeper, itemStack: new ItemStack('minepreggo:impregnation_potion_0'), cancel: false };
  emit(world.beforeEvents.playerInteractWithEntity, event);
  assert.equal(event.cancel, true, 'the potion is used on her instead of the vanilla interaction');
  const creeperRecord = getMobRecord(creeper);
  assert.ok(creeperRecord.data.pending);
  system.tick(300 + STEP);
  assert.ok(creeperRecord.data.pregnancy, 'pregnant 15 seconds later');
  assert.equal(creeper.getProperty('minepreggo:phase'), 0);
  assert.ok(creeper.events.includes('minepreggo:set_phase_0'));

  // Nearest-mob operator commands.
  assert.match(command(player, 'minepreggo:mob', 'status'), /zombie_girl.*wild pregnant P3/s);
  player.location = { x: 3, y: 64, z: 0 };
  assert.match(command(player, 'minepreggo:mob', 'phase 4'), /Phase P4/);
  system.tick(STEP);
  assert.equal(creeper.getProperty('minepreggo:phase'), 4);
  assert.ok(creeper.getProperty('minepreggo:growth') >= 0);
  assert.match(command(player, 'minepreggo:mob', 'pain fetal_movement'), /FETAL_MOVEMENT started/);
  system.tick(STEP);
  assert.equal(creeper.getProperty('minepreggo:pose'), 'fetal_movement');
  player.location = { x: 0, y: 64, z: 0 };

  // Death while pregnant drops one dead fetus per baby.
  emit(world.afterEvents.entityHurt, { hurtEntity: wild, damage: 3, damageSource: { cause: 'entityAttack' } });
  emit(world.afterEvents.entityDie, { deadEntity: wild, damageSource: { damagingEntity: player } });
  assert.equal(wild.dropped.length, wildRecord.data.wild.babies);
  assert.ok(wild.dropped.every((item) => item === 'minepreggo:dead_zombie_fetus'));
  wild.isValid = false;
  emit(world.afterEvents.entityRemove, { removedEntityId: wild.id });
});

test('world hooks: brains from player kills, lemons from leaves, bone meal on the crops, food effects', () => {
  const villager = { typeId: 'minecraft:villager_v2', location: { x: 0, y: 64, z: 0 }, dimension: overworld };
  emit(world.afterEvents.entityDie, { deadEntity: villager, damageSource: { damagingEntity: player } });
  assert.deepEqual(overworld.spawned, ['minepreggo:villager_brain']);

  const random = Math.random;
  Math.random = () => 0;
  try {
    const block = { dimension: overworld, center: () => ({ x: 0.5, y: 70.5, z: 0.5 }) };
    emit(world.afterEvents.playerBreakBlock, { block, brokenBlockPermutation: { type: { id: 'minecraft:oak_leaves' } }, itemStackBeforeBreak: undefined, player });
    assert.deepEqual(overworld.spawned.at(-1), 'minepreggo:lemon');
  } finally {
    Math.random = random;
  }

  let age = 2;
  const crop = {
    typeId: 'minepreggo:chili_peppers',
    dimension: overworld,
    center: () => ({ x: 0.5, y: 64.5, z: 0.5 }),
    permutation: { getState: () => age, withState: (_, value) => ({ getState: () => value }) },
    setPermutation(permutation) {
      age = permutation.getState();
    },
  };
  player.held = new ItemStack('minecraft:bone_meal', 2);
  customComponents.blocks.get('minepreggo:crop').onPlayerInteract({ block: crop, player });
  assert.ok(age >= 4 && age <= 7, `bone meal adds 2-5 stages, got ${age}`);
  assert.equal(player.held.amount, 1, 'one bone meal used');
  player.held = undefined;

  const [[, params]] = customComponentsOf('minepreggo:stuffed_mushroom');
  customComponents.items.get('minepreggo:food_effects').onConsume({ source: player, itemStack: new ItemStack('minepreggo:stuffed_mushroom') }, { params });
  assert.ok(player.getEffect('minecraft:nausea'));
  assert.ok(player.getEffect('minecraft:hunger'));
});

test('every entity, item and block the scripts name exists in the pack', () => {
  const families = json(join(BP, 'entities/zombie_girl.json'));
  assert.equal(families['minecraft:entity'].description.identifier, 'minepreggo:zombie_girl');
  for (const id of ['minepreggo:zombie_girl', 'minepreggo:humanoid_creeper_girl', 'minepreggo:monster_creeper_girl', 'minepreggo:ender_woman', 'minepreggo:humanoid_slime_girl', 'minepreggo:monster_slime_girl']) {
    assert.ok(EntityTypes.get(id), id);
  }
  const scripts = [...files(join(BP, 'scripts'))].map((f) => readFileSync(join(BP, 'scripts', f), 'utf8')).join('\n');
  const named = new Set(scripts.match(/minepreggo:[a-z0-9_]+/g));
  const known = new Set([...ItemTypes.getAll(), ...BlockTypes.getAll(), ...EntityTypes.getAll()].map((t) => t.id));
  // Properties, dynamic properties, events, components, sounds and command ids are not game objects.
  const notObjects = /^minepreggo:(phase|pose|kick|growth|gender|skin|savage|age|mob|crop|food_effects|impregnation_potion|pregnancy_acceleration|gradual_pregnancy_acceleration|breast_milk|pregnancy|female|pending|set_|on_tame|become_savage|calm_down|spawn_natural|hostile|tamed|tameable|fetal_movement_inducer|guide_given|guide$|belly$|forced|zero_gravity_belly$|metabolism_control$|eternal_pregnancy$|potion_effects$|debug|attack_impregnation|mob_courted|belly_touch|stomach_growls|pregnant_preggo_mob_death|player_|preggo_mob|loaded|selfcheck|hud|gender_|facing|scene$|scene_locked|go_to_bed|leave_bed|bed_reached|jenny_scene|bed\.|port\.|baby$|eggs$|cracks$|egg\.|as_viewer|as_belly|belly_p$|compat\.)/;
  const missing = [...named].filter((id) => !notObjects.test(id) && !known.has(id) && !id.startsWith('minepreggo:baby_'));
  assert.deepEqual(missing, [], 'ids used by the scripts that no JSON defines');
});

test('a zombie pregnancy burns in daylight, a creeper one explodes on death, slime babies cushion falls', () => {
  const mother = new Player('Zombie-mother');
  world.players.push(mother);
  const record = getRecord(mother);
  record.setGender('female');
  const [[, params]] = customComponentsOf('minepreggo:zombie_impregnation_potion_0');
  assert.equal(params.species, 'ZOMBIE');
  customComponents.items.get('minepreggo:impregnation_potion').onConsume({ source: mother, itemStack: new ItemStack('minepreggo:zombie_impregnation_potion_0') }, { params });
  assert.equal(record.pending?.father, 'ZOMBIE');
  system.tick(305); // the Impregnation effect counts game ticks, then the body sync runs
  assert.equal(record.pregnancy?.father, 'ZOMBIE');
  const random = Math.random;
  Math.random = () => 0;
  try {
    world.setAbsoluteTime(1000); // daytime
    system.tick(20);
  } finally {
    Math.random = random;
  }
  assert.equal(mother.fireSeconds, 8, 'burns in daylight without a helmet');
  world.players.pop();

  const creeper = new Player('Creeper-mother');
  const c = getRecord(creeper);
  c.setGender('female');
  assert.match(command(creeper, 'minepreggo:pregnancy', 'potion 0 creeper'), /father species: CREEPER/);
  assert.match(command(creeper, 'minepreggo:pregnancy', 'phase 4'), /phase P4/);
  emit(world.afterEvents.entityDie, { deadEntity: creeper, damageSource: { cause: 'entityAttack' } });
  assert.equal(overworld.explosions.length, 1, 'a creeper pregnancy explodes from P3');
  assert.deepEqual(creeper.dropped, ['minepreggo:dead_humanoid_creeper_fetus'], 'the fetus drops');

  const slime = new Player('Slime-mother');
  const sRecord = getRecord(slime);
  sRecord.setGender('female');
  assert.match(command(slime, 'minepreggo:pregnancy', 'potion 2 slime'), /father species: SLIME/);
  assert.match(command(slime, 'minepreggo:pregnancy', 'phase 4'), /phase P4/);
  const health = slime.getComponent('minecraft:health');
  health.currentValue = 10;
  emit(world.afterEvents.entityHurt, { hurtEntity: slime, damage: 6, damageSource: { cause: EntityDamageCause.fall } });
  assert.ok(health.currentValue > 10, 'part of the fall damage is healed back by the slime babies');
});

test('the guide book opens a chapter menu and is given on the first join', async () => {
  const reader = new Player('Reader');
  world.players.push(reader);
  reader.formSelection = 3; // "Female (Steve)" is index 2; pick male to skip pregnancy
  emit(world.afterEvents.playerSpawn, { player: reader, initialSpawn: true });
  await flush();
  assert.ok(reader.inventory.includes('minepreggo:guide_book'), 'new players get the guide');
  const { CHAPTERS } = await import('../../packs/behavior/scripts/world/guide.js');
  assert.ok(CHAPTERS.length >= 7);
  reader.formSelection = 0;
  const event = { itemStack: new ItemStack('minepreggo:guide_book'), source: reader, cancel: false };
  emit(world.beforeEvents.itemUse, event);
  assert.equal(event.cancel, true, 'using the book opens the form instead');
  await flush();
  world.players.pop();
});

test('a potion used on a mob is not also drunk, and species foods only agree with the matching pregnancy', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  overworld.entities.push(mob);
  const owner = new Player('Owner2');
  world.players.push(owner);
  getMobRecord(mob).data.owner = owner.id;
  const potion = new ItemStack('minepreggo:impregnation_potion_0');
  const interact = { player: owner, target: mob, itemStack: potion, cancel: false };
  emit(world.beforeEvents.playerInteractWithEntity, interact);
  assert.equal(interact.cancel, true);
  const use = { source: owner, itemStack: potion, cancel: false };
  emit(world.beforeEvents.itemUse, use);
  assert.equal(use.cancel, true, 'the same tap does not start drinking the potion');
  system.tick(5);
  const later = { source: owner, itemStack: potion, cancel: false };
  emit(world.beforeEvents.itemUse, later);
  assert.equal(later.cancel, false, 'drinking it later is fine');

  // Brains are zombie food: a human pregnancy (or no pregnancy) cannot stomach them.
  const record = getRecord(owner);
  record.setGender('female');
  const hunger = owner.getComponent('minecraft:player.hunger');
  hunger.currentValue = 20;
  emit(world.afterEvents.itemCompleteUse, { itemStack: new ItemStack('minepreggo:villager_brain'), source: owner });
  assert.ok(owner.getEffect('nausea'), 'brains make a non-zombie mother sick');
  assert.equal(hunger.currentValue, 20 - 12, 'and feed nothing');
  owner.removeEffect('nausea');
  assert.match(command(owner, 'minepreggo:pregnancy', 'potion 0 zombie'), /father species: ZOMBIE/);
  assert.match(command(owner, 'minepreggo:pregnancy', 'phase 3'), /phase P3/);
  const p = record.pregnancy;
  p.symptoms.CRAVING = 2;
  p.cravingType = 'SWEET';
  p.craving = 10;
  hunger.currentValue = 20;
  emit(world.afterEvents.itemCompleteUse, { itemStack: new ItemStack('minepreggo:brain_with_chocolate'), source: owner });
  assert.equal(owner.getEffect('nausea'), undefined, 'a zombie mother eats brains');
  assert.ok(p.craving < 10, 'brain with chocolate satisfies her sweet craving');
  world.players.pop();
});

test('every female renders the mod\'s own model of her belly size, chosen by the belly property the scripts write, with the belly animations in a state controller', () => {
  const families = { zombie_girl: 'mobs/zombie/zombie_girl', humanoid_creeper_girl: 'mobs/creeper/humanoid/humanoid_creeper_girl', monster_creeper_girl: 'mobs/creeper/monster/monster_creeper_girl', ender_woman: 'mobs/ender/ender_woman', humanoid_slime_girl: 'mobs/slime/humanoid/humanoid_slime_girl', monster_slime_girl: 'mobs/slime/monster/monster_slime_girl' };
  const controllers = json(join(RP, 'animation_controllers/belly.animation_controllers.json')).animation_controllers;
  for (const [family, texture] of Object.entries(families)) {
    const entity = json(join(RP, 'entity', `${family}.entity.json`))['minecraft:client_entity'].description;
    const rcs = json(join(RP, 'render_controllers', `${family}.render_controllers.json`)).render_controllers;
    const main = `controller.render.minepreggo.${family}`;
    assert.equal(entity.geometry.default, `geometry.minepreggo.${family}`);
    assert.deepEqual(rcs[main].geometry, 'Geometry.default');
    assert.ok(entity.render_controllers.some((rc) => rc[main] === 'v.bp < 0'), `${family}: the base model without a belly`);
    for (let phase = 0; phase <= 9; phase++) {
      assert.equal(entity.geometry[`p${phase}`], `geometry.minepreggo.${family}_p${phase}`);
      assert.equal(entity.textures[`p${phase}`], `textures/minepreggo/${texture}_p${phase}`);
      assert.ok(statSync(join(RP, 'models/entity/minepreggo', `${family}_p${phase}.geo.json`)).size > 0);
      assert.ok(statSync(join(RP, `textures/minepreggo/${texture}_p${phase}.png`)).size > 0);
      assert.deepEqual([rcs[`${main}_p${phase}`].geometry, rcs[`${main}_p${phase}`].textures], [`Geometry.p${phase}`, [`Texture.p${phase}`]], `${family} P${phase}: a plain controller`);
      assert.ok(entity.render_controllers.some((rc) => rc[`${main}_p${phase}`] === `v.bp == ${phase}`), `${family} P${phase} chosen by the belly value`);
      const geometry = json(join(RP, 'models/entity/minepreggo', `${family}_p${phase}.geo.json`))['minecraft:geometry'][0];
      const names = new Set(geometry.bones.map((b) => b.name));
      assert.ok(names.has('belly'), `${family} P${phase}: belly bone`);
      if (phase >= 3) for (const kick of ['front_kick', 'left_kick', 'right_kick']) assert.ok(names.has(kick), `${family} P${phase} ${kick}`);
    }
    for (const [name, rc] of Object.entries(rcs)) if (!name.endsWith('_eyes')) assert.ok(!rc.arrays && !rc.part_visibility, `${name}: no arrays, no part visibility`);
    // The belly enum drives everything: the pre_animation reads it like the pose, falls back to the phase, the variant and the pose.
    const pre = entity.scripts.pre_animation;
    const bp = pre.findIndex((line) => line.startsWith("v.bp = (q.property('minepreggo:belly') == 'p0' ? 0 :"));
    assert.ok(bp > 0, `${family}: belly read from the enum property`);
    assert.equal(pre[bp + 1], 'v.bp = v.bp >= 0 ? v.bp : (v.phase >= 0 ? v.phase : (q.variant > 0 ? q.variant - 1 : (v.pregnant_pose ? 5 : -1)));');
    assert.equal(pre[bp + 2], 'v.phase = v.bp;');
    assert.ok(pre.slice(0, bp).some((line) => line.startsWith('v.pregnant_pose =')));
    // The belly animations run from a state controller, one state per belly size, like the pain controller.
    assert.ok(entity.scripts.animate.includes('belly_controller'), `${family}: belly controller animated`);
    const controller = controllers[entity.animations.belly_controller];
    assert.ok(controller, `${family}: ${entity.animations.belly_controller}`);
    assert.equal(controller.initial_state, 'none');
    for (let phase = 0; phase <= 9; phase++) {
      const state = controller.states[`p${phase}`];
      assert.ok(state, `${family}: state p${phase}`);
      assert.ok(state.transitions.some((t) => t.none === 'v.bp < 0'));
      const played = state.animations.map((a) => (typeof a === 'string' ? a : Object.keys(a)[0]));
      for (const short of played) assert.ok(entity.animations[short], `${family} P${phase}: plays ${short}`);
      assert.ok(played.includes('fetal_push') && played.includes('birth_push') && played.includes('belly_growth'));
      if (phase >= 3) assert.ok(played.includes(`fetal_p${phase}_i`) && played.includes(`fetal_p${phase}_iii`), `${family} P${phase}: the mod's fetal movements`);
    }
    assert.ok(!entity.scripts.animate.some((a) => typeof a === 'object' && /^(fetal_p|belly_|birth_push|fetal_push)/.test(Object.keys(a)[0])), `${family}: belly animations only through the controller`);
    // The behavior side defines the enum and sets it with the phase.
    const bp2 = json(join(BP, 'entities', `${family}.json`))['minecraft:entity'];
    assert.deepEqual(bp2.description.properties['minepreggo:belly'].values, ['none', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    const setBy = (/** @type {any} */ event) => (event.sequence ?? [event]).map((s) => s.set_property?.['minepreggo:belly']).find((v) => v !== undefined);
    assert.equal(setBy(bp2.events['minepreggo:set_phase_5']), 'p5', `${family}: set_phase_5 sets the belly`);
    assert.equal(setBy(bp2.events['minepreggo:set_not_pregnant']), 'none', `${family}: set_not_pregnant clears the belly`);
  }
  // The player: her own per-phase bodies, chosen the same way.
  const player = json(join(RP, 'entity/player.entity.json'))['minecraft:client_entity'].description;
  const playerRcs = json(join(RP, 'render_controllers/player.render_controllers.json')).render_controllers;
  for (let phase = 0; phase <= 9; phase++) {
    for (const kind of ['custom', 'predefined']) {
      const name = `controller.render.minepreggo.player_belly_${kind}_p${phase}`;
      assert.equal(playerRcs[name].geometry, `Geometry.minepreggo_body_${kind}_p${phase}`);
      assert.equal(player.geometry[`minepreggo_body_${kind}_p${phase}`], `geometry.minepreggo.player_body_${kind}_p${phase}`);
      const condition = player.render_controllers.find((rc) => typeof rc === 'object' && rc[name])?.[name];
      assert.ok(condition?.includes(`variable.mp_bp == ${phase}`) && condition.includes('variable.mp_pregnant'), `player ${kind} P${phase}`);
    }
    assert.equal(player.textures[`minepreggo_alex_p${phase}_extra`], `textures/minepreggo/entity/player/predefined/alex/alex_p${phase}_extra`);
  }
  assert.ok(player.scripts.pre_animation.some((line) => line.startsWith("variable.mp_bp = (query.property('minepreggo:belly') == 'p0' ? 0 :")));
  assert.deepEqual(json(join(BP, 'entities/player.json'))['minecraft:entity'].description.properties['minepreggo:belly'].default, 'none');
  // The scripts write the enum next to the phase, on mobs and on the player.
  const girl = new Mob('minepreggo:zombie_girl', { tamed: true });
  girl.location = { x: 900, y: 64, z: 900 };
  overworld.entities.push(girl);
  mobs.startPregnancy(getMobRecord(girl), 1);
  assert.equal(girl.getProperty('minepreggo:belly'), 'p0');
  mobs.setPhase(getMobRecord(girl), 3);
  assert.equal(girl.getProperty('minepreggo:belly'), 'p3');
  girl.setProperty('minepreggo:belly', 'none');
  system.tick(STEP + 1);
  assert.equal(girl.getProperty('minepreggo:belly'), 'p3', 'the belly value is kept equal to the phase every tick');
  const mother = new Player('BellyEnum');
  mother.location = { x: 950, y: 64, z: 950 };
  world.players.push(mother);
  getRecord(mother).setGender('female');
  command(mother, 'minepreggo:pregnancy', 'start 1');
  command(mother, 'minepreggo:pregnancy', 'phase 4');
  system.tick(40);
  assert.equal(mother.getProperty('minepreggo:belly'), 'p4');
  world.players.pop();
});

test('the debug command forces a kick the client renders from and reports the properties', () => {
  const tester = new Player('Tester');
  tester.location = { x: 50, y: 64, z: 50 };
  world.players.push(tester);
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  mob.location = { x: 51, y: 64, z: 50 };
  overworld.entities.push(mob);
  const out = command(tester, 'minepreggo:debug', 'kick');
  assert.match(out, /forced for 10 s/);
  assert.equal(tester.getProperty('minepreggo:pose'), 'fetal_movement');
  assert.equal(tester.getProperty('minepreggo:kick'), 2);
  assert.equal(mob.getProperty('minepreggo:pose'), 'fetal_movement');
  system.tick(20);
  assert.equal(tester.getProperty('minepreggo:pose'), 'fetal_movement', 'the sync loop leaves the forced pose alone');
  assert.equal(mob.getProperty('minepreggo:kick'), 2);
  assert.match(command(tester, 'minepreggo:debug', ''), /you: minecraft:player: phase=\d+ belly=\\"p\d\\" pose=\\"fetal_movement\\" kick=2/);
  system.tick(200);
  assert.equal(tester.getProperty('minepreggo:pose'), 'none', 'back to the real state after 10 s');
  for (const file of entityFiles()) {
    const entity = json(join(RP, 'entity', file))['minecraft:client_entity'].description;
    const monster = /^(monster_|ender_woman)/.test(file);
    assert.ok(Object.values(entity.animations).includes(monster ? 'animation.minepreggo.fetal_push_monster' : 'animation.minepreggo.fetal_push'), `${file} plays its kind's fetal movement`);
    assert.ok(Object.values(entity.animations).includes(monster ? 'animation.minepreggo.birth_push_monster' : 'animation.minepreggo.birth_push'), `${file} plays its kind's birth push`);
  }
  world.players.pop();
});

test('vanilla attackers impregnate a female player after enough hits, and a counterpart next to a mob', async () => {
  const { onAttacked, HITS_NEEDED } = await import('../../packs/behavior/scripts/pregnancy/attacks.js');
  const victim = new Player('Victim');
  victim.location = { x: 100, y: 64, z: 100 };
  world.players.push(victim);
  const record = getRecord(victim);
  record.setGender('female');
  const zombie = { typeId: 'minecraft:zombie', getComponent: () => undefined };
  for (let i = 1; i < HITS_NEEDED.ZOMBIE; i++) assert.equal(onAttacked(record, /** @type {any} */ (zombie), () => 0), false);
  assert.equal(onAttacked(record, /** @type {any} */ (zombie), () => 0), true, 'the eighth zombie hit');
  assert.equal(record.pending?.father, 'ZOMBIE');
  system.tick(305); // the Impregnation effect counts game ticks, then the body sync runs
  assert.equal(record.pregnancy?.father, 'ZOMBIE');
  world.players.pop();

  const girl = new Mob('minepreggo:zombie_girl', { tamed: true });
  girl.location = { x: 200, y: 64, z: 200 };
  overworld.entities.push(girl);
  const suitor = { typeId: 'minecraft:zombie', id: 'vanilla-1', isValid: true, location: { x: 201, y: 64, z: 200 }, getComponent: () => undefined };
  overworld.entities.push(/** @type {any} */ (suitor));
  system.tick(80);
  const girlRecord = getMobRecord(girl);
  assert.ok(girlRecord.data.pending, 'three seconds next to a zombie');
  system.tick(320);
  assert.ok(girlRecord.data.pregnancy, 'pregnant 15 seconds later');
  assert.equal(girl.getProperty('minepreggo:phase'), 0);
});

test('the belly follows the real phase every tick, and the debug command can force any belly size', () => {
  const tester = new Player('BellyTester');
  tester.location = { x: 300, y: 64, z: 300 };
  world.players.push(tester);
  const girl = new Mob('minepreggo:zombie_girl', { tamed: true });
  girl.location = { x: 301, y: 64, z: 300 };
  overworld.entities.push(girl);
  const record = getMobRecord(girl);

  // A kick forced on a mob without a visible belly shows a big one for the duration.
  command(tester, 'minepreggo:debug', 'kick');
  assert.equal(girl.getProperty('minepreggo:phase'), 7, 'the kicks live in the P3+ bellies');
  assert.equal(tester.getProperty('minepreggo:phase'), 7);
  system.tick(220);
  assert.equal(girl.getProperty('minepreggo:phase'), -1, 'not pregnant again once the debug time is over');

  // Any belly size, and the output names the version so a stale pack is recognisable.
  const out = command(tester, 'minepreggo:debug', 'belly 9');
  assert.match(out, /belly P9 forced for 10 s on you and the nearest mob/);
  assert.match(out, new RegExp(`\\[Minepreggo ${VERSION.replaceAll('.', '\\.')}\\] you:`));
  assert.equal(girl.getProperty('minepreggo:phase'), 9);
  assert.equal(tester.getProperty('minepreggo:phase'), 9);
  assert.match(command(tester, 'minepreggo:debug', 'belly 42'), /belly P9 forced/);
  assert.match(command(tester, 'minepreggo:debug', 'belly'), /belly P7 forced/);
  assert.match(command(tester, 'minepreggo:debug', 'nonsense'), /usage/);
  assert.match(command(tester, 'minepreggo:debug', 'belly abc'), /usage/);
  assert.match(command(tester, 'minepreggo:debug', 'off'), /you: minecraft:player: phase=-1/);
  assert.equal(girl.getProperty('minepreggo:phase'), -1, 'off restores the real phase at once');
  system.tick(STEP + 1);
  assert.equal(record.data.wild, null, 'a forced belly never turns her into a wild pregnant mob');

  // A pregnant mob whose property was never written (saves from before 0.2.6) gets it back.
  const { startPregnancy } = mobs;
  assert.ok(startPregnancy(record, 2));
  assert.equal(girl.getProperty('minepreggo:phase'), 0);
  girl.setProperty('minepreggo:phase', -1);
  system.tick(STEP + 1);
  assert.equal(girl.getProperty('minepreggo:phase'), 0, 'the property is re-synced from the pregnancy');
  record.data.pregnancy.phase = 6;
  system.tick(STEP + 1);
  assert.equal(girl.getProperty('minepreggo:phase'), 6);

  // A wild pregnant mob keeps her spawn phase too, even when only the variant survived.
  const wild = new Mob('minepreggo:humanoid_creeper_girl', { variant: 6 });
  wild.location = { x: 303, y: 64, z: 300 };
  overworld.entities.push(wild);
  system.tick(STEP + 1);
  const wildRecord = getMobRecord(wild);
  assert.equal(wildRecord.data.wild?.phase, 5);
  assert.equal(wild.getProperty('minepreggo:phase'), 5);
  wild.setProperty('minepreggo:phase', -1);
  delete wildRecord.data.wild.phase;
  system.tick(STEP + 1);
  assert.equal(wild.getProperty('minepreggo:phase'), 5, 'recovered from the variant');

  // A forced belly never makes a mob wild pregnant, not even when her record is lost during the
  // window (chunk unload, rejoin): the forced flag persists with her and the next tick restores her.
  const stray = new Mob('minepreggo:zombie_girl', { tamed: true });
  stray.location = { x: 300.2, y: 64, z: 300 };
  overworld.entities.push(stray);
  command(tester, 'minepreggo:debug', 'kick');
  assert.equal(stray.getProperty('minepreggo:phase'), 7);
  mobs.forgetRecord(stray.id);
  system.tick(STEP + 1);
  assert.equal(getMobRecord(stray).data.wild, null, 'a lost record does not make her wild pregnant');
  assert.equal(stray.getProperty('minepreggo:phase'), -1, 'the real phase is back');
  assert.equal(stray.getDynamicProperty('minepreggo:forced'), undefined);
  world.players.pop();
});

test('the client renders a belly even when the phase property never arrives', () => {
  for (const file of entityFiles()) {
    const pre = json(join(RP, 'entity', file))['minecraft:client_entity'].description.scripts.pre_animation;
    if (file === 'player.entity.json') {
      const i = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_bp = variable.mp_bp >= 0 ?'));
      assert.ok(i > 0, 'player belly fallback');
      assert.ok(pre.slice(0, i).some((/** @type {string} */ line) => line.startsWith('variable.mp_pose =')), 'the pose is known before the fallback');
      assert.match(pre[i], /mp_pose == 'none'/);
    } else {
      const i = pre.findIndex((/** @type {string} */ line) => line.startsWith('v.bp = v.bp >= 0 ?'));
      assert.ok(i > 0, `${file} belly fallback`);
      assert.match(pre[i], /q\.variant > 0 \? q\.variant - 1/);
      assert.match(pre[i], /v\.pregnant_pose \? 5 : -1/);
      assert.ok(pre.slice(0, i).some((/** @type {string} */ line) => line.startsWith('v.pregnant_pose =')), 'the pose test is known before the fallback');
      assert.ok(pre.slice(0, i).some((/** @type {string} */ line) => line.startsWith('v.pose =')));
    }
  }
});

test('the guide book has working debug tools: belly sizes, phase jumps and the real state', async () => {
  const { CHAPTERS, DEBUG_MENU } = await import('../../packs/behavior/scripts/world/guide.js');
  const debugChapter = CHAPTERS.findIndex((chapter) => chapter.debug);
  assert.ok(debugChapter > 0, 'the last chapter is the debug tools');
  const reader = new Player('Operator');
  reader.location = { x: 400, y: 64, z: 400 };
  world.players.push(reader);
  const girl = new Mob('minepreggo:zombie_girl', { tamed: true });
  girl.location = { x: 401, y: 64, z: 400 };
  overworld.entities.push(girl);
  const open = async (/** @type {number[]} */ choices) => {
    reader.forms.length = 0;
    reader.formSelections = choices;
    const event = { itemStack: new ItemStack('minepreggo:guide_book'), source: reader, cancel: false };
    emit(world.beforeEvents.itemUse, event);
    for (let i = 0; i < 8; i++) await flush();
  };

  // Debug tools -> Show a belly size -> P7: a P7 belly on the reader and on the mob, result shown in the book.
  const bellyMenu = DEBUG_MENU.findIndex((item) => /belly size/i.test(item.label));
  await open([debugChapter, bellyMenu, 7]);
  assert.equal(reader.getProperty('minepreggo:phase'), 7);
  assert.equal(girl.getProperty('minepreggo:phase'), 7);
  const result = reader.forms.find((form) => /belly P7 forced for 30 s/.test(form.body));
  assert.ok(result, `the result page: ${JSON.stringify(reader.forms.map((form) => form.body))}`);
  assert.deepEqual(result.buttons, ['Back']);
  assert.equal(reader.forms.at(-1)?.title, 'P7 (big)', 'closing the result page closes the book, so the player can look at the belly');

  // Nearest mob -> Start a pregnancy, then Jump to a phase -> P5: real pregnancy state, not a forced one.
  const mobMenu = DEBUG_MENU.findIndex((item) => item.label === 'Nearest mob');
  const mobItems = DEBUG_MENU[mobMenu].menu ?? [];
  await open([debugChapter, mobMenu, mobItems.findIndex((item) => /1 baby/.test(item.label))]);
  const record = getMobRecord(girl);
  assert.ok(record.data.pregnancy, 'pregnant from the book');
  await open([debugChapter, mobMenu, mobItems.findIndex((item) => /Jump/.test(item.label)), 4]); // one baby: birth at P4
  assert.equal(record.data.pregnancy?.phase, 4);
  await open([debugChapter, DEBUG_MENU.findIndex((item) => /Stop forcing/.test(item.label))]);
  assert.equal(girl.getProperty('minepreggo:phase'), 4, 'the real phase shows once forcing stops');

  // My pregnancy -> female body, start, jump to P3.
  const myMenu = DEBUG_MENU.findIndex((item) => item.label === 'My pregnancy');
  const myItems = DEBUG_MENU[myMenu].menu ?? [];
  await open([debugChapter, myMenu, myItems.findIndex((item) => /female/.test(item.label))]);
  await open([debugChapter, myMenu, myItems.findIndex((item) => /1 baby/.test(item.label))]);
  await open([debugChapter, myMenu, myItems.findIndex((item) => /Jump/.test(item.label)), 3]);
  assert.equal(getRecord(reader).pregnancy?.phase, 3);
  system.tick(40); // the body sync runs on its own interval
  assert.equal(reader.getProperty('minepreggo:phase'), 3, 'the real P3 reaches the client, nothing forced is left');

  // The render report names the version; every menu ends with Back.
  await open([debugChapter, DEBUG_MENU.findIndex((item) => /renders from/.test(item.label))]);
  assert.ok(reader.forms.some((form) => form.body.includes(`[Minepreggo ${VERSION}] you:`)));
  for (const form of reader.forms) if (form.title !== 'Minepreggo guide') assert.equal(form.buttons.at(-1), 'Back', form.title);

  // The tools need no operator: a player without cheats gets the same menu.
  reader.commandPermissionLevel = 0;
  await open([debugChapter]);
  assert.equal(reader.forms.at(-1)?.body, 'Choose an action.', 'the debug menu opens for everyone');

  // The book again on request.
  const books = reader.inventory.filter((item) => item === 'minepreggo:guide_book').length;
  assert.match(command(reader, 'minepreggo:guide', ''), /Guide book given/);
  assert.equal(reader.inventory.filter((item) => item === 'minepreggo:guide_book').length, books + 1);
  world.players.pop();
});

/** Drinks one of the add-on's potions as `player` and returns what it said. */
function drinkPotion(player, id) {
  const [[component, params]] = customComponentsOf(id);
  const before = player.messages.length;
  customComponents.items.get(component).onConsume({ source: player, itemStack: new ItemStack(id) }, { params });
  return player.messages.slice(before).map(text).join('\n');
}

test('every potion reports what it did or why not: impregnation countdown, delay, duplication, healing, harming', () => {
  const drinker = new Player('Drinker');
  drinker.location = { x: 500, y: 64, z: 500 };
  world.players.push(drinker);
  const record = getRecord(drinker);
  const drink = (/** @type {string} */ id) => drinkPotion(drinker, id);
  assert.match(drink('minepreggo:impregnation_potion_0'), /minepreggo\.potion\.choose_gender/);
  record.setGender('male');
  assert.match(drink('minepreggo:impregnation_potion_0'), /minepreggo\.potion\.male/);
  record.setGender('female');
  assert.match(drink('minepreggo:pregnancy_acceleration_potion_0'), /minepreggo\.potion\.not_pregnant/);
  assert.match(drink('minepreggo:pregnancy_healing_potion'), /minepreggo\.potion\.not_pregnant/);
  assert.match(drink('minepreggo:impregnation_potion_0'), /minepreggo\.potion\.impregnation"/);
  assert.equal(record.pending?.ticksLeft, 300);
  assert.match(drink('minepreggo:impregnation_potion_0'), /minepreggo\.potion\.already_pregnant/);
  const before = drinker.messages.length;
  system.tick(20);
  assert.ok(drinker.messages.slice(before).some((m) => text(m).includes('minepreggo.potion.impregnation.countdown')), 'the action bar counts down');
  assert.equal(record.pregnancy, null);
  system.tick(285);
  const p = record.pregnancy;
  assert.ok(p, 'pregnant when the countdown ends');
  p.pain = null;

  // Pregnancy Delay I: 7 % of 50 days = 4 more days, spread over the phases to come.
  const total = () => p.daysByPhase.reduce((a, b) => a + b, 0);
  const days = total();
  assert.match(drink('minepreggo:pregnancy_delay_potion_0'), /minepreggo\.potion\.delayed/);
  assert.equal(total(), days + 4);

  // Baby Duplication I: one more baby and a birth phase for the new litter; never beyond 10.
  const babies = p.womb.length;
  assert.match(drink('minepreggo:baby_duplication_potion_0'), /minepreggo\.potion\.duplicated"/);
  assert.equal(p.womb.length, babies + 1);
  assert.equal(p.lastPhase, finalPhaseForBabies(p.womb.length));
  assert.equal(p.daysByPhase.length, p.lastPhase + 1, "one day count per phase up to the birth phase");
  p.pain = null;
  const said = [drink('minepreggo:baby_duplication_potion_4')];
  p.pain = null;
  said.push(drink('minepreggo:baby_duplication_potion_4'));
  assert.equal(p.womb.length, 10, `two Baby Duplication V: ${said.join(' / ')} (phase ${p.phase}, pain ${p.pain?.type})`);
  p.pain = null;
  assert.match(drink('minepreggo:baby_duplication_potion_0'), /duplicated_full/);
  assert.equal(p.lastPhase, 9);

  // Harming takes 30 pregnancy health and a heart; healing restores it; at 0 she miscarries.
  p.pain = null;
  assert.match(drink('minepreggo:pregnancy_harming_potion'), /minepreggo\.potion\.harmed/);
  assert.equal(p.health, 70);
  assert.match(drink('minepreggo:pregnancy_healing_potion'), /minepreggo\.potion\.healed/);
  assert.equal(p.health, 100);
  for (let i = 0; i < 3; i++) drink('minepreggo:pregnancy_harming_potion');
  assert.equal(p.health, 10);
  drink('minepreggo:pregnancy_harming_potion');
  assert.equal(p.health, 0);
  assert.equal(p.pain?.type, 'MISCARRIAGE', 'at 0 the pregnancy miscarries');
  assert.match(drink('minepreggo:pregnancy_harming_potion'), /blocked_labor/);
  command(drinker, 'minepreggo:pregnancy', 'end');
  world.players.pop();
});

test('timed potion effects: resistance stops pregnancy damage, zero gravity lifts the weight, metabolism refills saturation, eternal blocks birth, milk cures', async () => {
  const { desiredEffects } = await import('../../packs/behavior/scripts/pregnancy/effects.js');
  const mother = new Player('Timed');
  mother.location = { x: 600, y: 64, z: 600 };
  world.players.push(mother);
  const record = getRecord(mother);
  record.setGender('female');
  command(mother, 'minepreggo:pregnancy', 'start 1');
  command(mother, 'minepreggo:pregnancy', 'phase 4');
  const p = record.pregnancy;
  assert.ok(p);
  const drink = (/** @type {string} */ id) => drinkPotion(mother, id);

  assert.equal(desiredEffects(record).slowness, PHASE_SLOWNESS[4]);
  assert.match(drink('minepreggo:zero_gravity_belly_potion'), /minepreggo\.potion\.zero_gravity/);
  assert.equal(record.effects.zeroGravity, 9600);
  assert.equal(desiredEffects(record).slowness, -1, 'Zero Gravity Belly: no phase slowdown');

  assert.match(drink('minepreggo:long_pregnancy_resistance_potion'), /minepreggo\.potion\.resistance/);
  assert.equal(record.effects.resistance, 19200);
  const explosion = () => emit(world.afterEvents.entityHurt, { hurtEntity: mother, damage: 8, damageSource: { cause: EntityDamageCause.entityExplosion } });
  explosion();
  assert.equal(p.health, 100, 'Pregnancy Resistance: the explosion did no pregnancy damage');

  const saturation = mother.getComponent('minecraft:player.saturation');
  saturation.setCurrentValue(1);
  assert.match(drink('minepreggo:strong_metabolism_control_potion'), /minepreggo\.potion\.metabolism/);
  assert.deepEqual(record.effects.metabolism, { ticks: 6000, amplifier: 1 });
  drink('minepreggo:metabolism_control_potion');
  assert.equal(record.effects.metabolism.amplifier, 1, 'a weaker potion does not replace a stronger one');
  system.tick(20);
  assert.ok(saturation.currentValue > 1 && saturation.currentValue <= 20, 'saturation climbs');

  assert.match(drink('minepreggo:eternal_pregnancy_potion'), /minepreggo\.potion\.eternal/);
  assert.equal(record.effects.eternal, true);
  assert.match(command(mother, 'minepreggo:pregnancy', 'labor'), /another pain blocks it/);
  assert.equal(p.pain, null, 'Eternal Pregnancy: birth never comes');
  assert.match(command(mother, 'minepreggo:pregnancy', 'status'), /potion effects: .*eternal/);

  system.tick(100);
  assert.ok(record.effects.zeroGravity < 9600 && record.effects.resistance < 19200, 'the effects run down');
  p.pain = null; // a random pain of P4 (back pain, weakness) may have come while the effects ran down
  emit(world.afterEvents.itemCompleteUse, { source: mother, itemStack: new ItemStack('minecraft:milk_bucket') });
  assert.deepEqual(record.effects, {});
  assert.ok(mother.messages.some((m) => text(m).includes('minepreggo.potion.cured')));
  assert.equal(desiredEffects(record).slowness, PHASE_SLOWNESS[4], 'the weight is back');
  explosion();
  assert.ok(p.health < 100, 'without resistance the explosion harms the pregnancy');
  assert.match(command(mother, 'minepreggo:pregnancy', 'labor'), /phase P4/);
  assert.equal(p.pain?.type, 'WATER_BREAKING', 'birth comes again once the effect is gone');
  command(mother, 'minepreggo:pregnancy', 'end');
  world.players.pop();
});

test('the mod potions work on mobs through interaction and say why when they cannot', () => {
  const owner = new Player('PotionOwner');
  owner.location = { x: 700, y: 64, z: 700 };
  world.players.push(owner);
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  mob.location = { x: 701, y: 64, z: 700 };
  overworld.entities.push(mob);
  const record = getMobRecord(mob);
  record.data.owner = owner.id;
  const use = (/** @type {string} */ id, target = mob) => {
    const event = { player: owner, target, itemStack: new ItemStack(id), cancel: false };
    const before = owner.messages.length;
    emit(world.beforeEvents.playerInteractWithEntity, event);
    system.tick(1);
    return { cancelled: event.cancel, said: owner.messages.slice(before).map(text).join('\n') };
  };
  let result = use('minepreggo:pregnancy_healing_potion');
  assert.equal(result.cancelled, true, 'a potion tapped onto her is never drunk');
  assert.match(result.said, /minepreggo\.mob\.potion\.not_pregnant/);
  assert.equal(use('minepreggo:impregnation_potion_0').cancelled, true);
  assert.match(use('minepreggo:impregnation_potion_0').said, /already_pregnant/);
  system.tick(300 + STEP);
  const p = record.data.pregnancy;
  assert.ok(p, 'pregnant 15 s after the potion');
  const total = () => p.daysByPhase.reduce((a, b) => a + b, 0);
  const days = total();
  use('minepreggo:pregnancy_delay_potion_1');
  assert.equal(total(), days + 7, 'Delay II: 14 % of 50 days');
  use('minepreggo:baby_duplication_potion_0');
  assert.equal(p.womb.length, 2);
  assert.equal(p.lastPhase, 5);
  use('minepreggo:pregnancy_harming_potion');
  assert.equal(p.health, 70);
  use('minepreggo:pregnancy_healing_potion');
  assert.equal(p.health, 100);
  assert.match(command(owner, 'minepreggo:mob', 'harm'), /Pregnancy health 70/);
  assert.match(command(owner, 'minepreggo:mob', 'heal'), /Pregnancy health 100/);
  assert.match(command(owner, 'minepreggo:mob', 'delay 0'), /Delayed by 4 days/);
  assert.match(command(owner, 'minepreggo:mob', 'duplicate 0'), /1 more babies/);

  // A wild pregnant mob carries more babies after a duplication potion from anyone.
  const wild = new Mob('minepreggo:humanoid_creeper_girl', { variant: 6 });
  wild.location = { x: 704, y: 64, z: 700 };
  overworld.entities.push(wild);
  system.tick(STEP + 1);
  const wildRecord = getMobRecord(wild);
  const babies = wildRecord.data.wild.babies;
  use('minepreggo:baby_duplication_potion_1', wild);
  assert.equal(wildRecord.data.wild.babies, Math.min(10, babies + 2));
  world.players.pop();
});

test('the guide book gives every potion and the book itself', async () => {
  const { CHAPTERS, GIVE_MENU } = await import('../../packs/behavior/scripts/world/guide.js');
  const reader = new Player('Giver');
  reader.location = { x: 800, y: 64, z: 800 };
  world.players.push(reader);
  const ids = new Set([...ItemTypes.getAll(), ...BlockTypes.getAll()].map((t) => t.id));
  const flat = (/** @type {any[]} */ items) => items.flatMap((i) => (i.menu ? flat(i.menu) : [i]));
  const leaves = flat(GIVE_MENU);
  assert.ok(leaves.length >= 40, `${leaves.length} items to give`);
  for (const leaf of leaves) {
    const before = reader.inventory.length;
    assert.match(String(leaf.run(reader)), /^Given: /);
    const id = reader.inventory[before];
    assert.ok(id && ids.has(id), `${leaf.label} gives an existing item (${id})`);
  }
  for (const potion of readdirSync(join(BP, 'items/potions'))) {
    const id = `minepreggo:${potion.replace('.json', '')}`;
    assert.ok(leaves.some((leaf) => reader.inventory.includes(id)), `${id} can be given from the book`);
  }
  // Through the book: Debug tools -> Give items -> Potion of Impregnation -> I.
  reader.forms.length = 0;
  reader.inventory.length = 0;
  reader.formSelections = [CHAPTERS.findIndex((chapter) => chapter.debug), 0, 0, 0];
  emit(world.beforeEvents.itemUse, { itemStack: new ItemStack('minepreggo:guide_book'), source: reader, cancel: false });
  for (let i = 0; i < 8; i++) await flush();
  assert.deepEqual(reader.inventory, ['minepreggo:impregnation_potion_0']);
  world.players.pop();
});

test("the game's own parser rules hold: float literals, flat component parameters, recipe unlocks, no rejected fields, initialized Molang variables", async () => {
  const { integerFloatLiterals, stringifyEntity } = await import('../lib/entity-json.mjs');
  for (const file of behaviorEntityFiles()) {
    const text = readFileSync(join(BP, 'entities', file), 'utf8');
    assert.deepEqual(integerFloatLiterals(text), [], `${file}: float properties written as floats`);
    assert.match(text, /"minepreggo:growth": \{[^}]*"default": 0\.0/, `${file}: growth default 0.0`);
    assert.doesNotMatch(text, /alert_same_type|soft_distance|hard_distance|max_distance/, `${file}: no field the game rejects`);
  }
  // The writer keeps 0.0 as 0.0 and [0, 1] as [0.0, 1.0] for float properties.
  const written = stringifyEntity({ 'minecraft:entity': { description: { properties: { 'x:f': { type: 'float', range: [0, 1], default: 0 }, 'x:i': { type: 'int', range: [0, 9], default: 0 } } } } });
  assert.match(written, /"x:f": \{\s*"type": "float",\s*"range": \[\s*0\.0,\s*1\.0\s*\],\s*"default": 0\.0/);
  assert.match(written, /"x:i": \{\s*"type": "int",\s*"range": \[\s*0,\s*9\s*\],\s*"default": 0/);
  assert.deepEqual(integerFloatLiterals('"x:f": { "type": "float", "range": [0, 1], "default": 0 }'), ['x:f']);
  // Custom component parameters are flat.
  for (const file of files(join(BP, 'items'))) {
    const components = json(join(BP, 'items', file))['minecraft:item'].components ?? {};
    for (const [name, params] of Object.entries(components)) {
      if (name.startsWith('minecraft:') || !params || typeof params !== 'object') continue;
      for (const [key, value] of Object.entries(params)) assert.ok(value === null || typeof value !== 'object', `${file}: ${name}.${key} must be a flat value`);
    }
  }
  // Every recipe unlocks.
  for (const file of readdirSync(join(BP, 'recipes')).filter((f) => f.endsWith('.json'))) {
    const doc = json(join(BP, 'recipes', file));
    const recipe = Object.entries(doc).find(([k]) => k.startsWith('minecraft:recipe_'))?.[1];
    assert.ok(Array.isArray(recipe?.unlock) && recipe.unlock.length > 0, `${file}: unlock data`);
  }
  // The stuffed mushroom's effects still apply through the flat format.
  const eater = new Player('Eater');
  world.players.push(eater);
  const [[component, params]] = customComponentsOf('minepreggo:stuffed_mushroom');
  customComponents.items.get(component).onConsume({ source: eater, itemStack: new ItemStack('minepreggo:stuffed_mushroom') }, { params });
  assert.ok(eater.getEffect('minecraft:nausea') && eater.getEffect('minecraft:hunger'), 'both effects from the string');
  world.players.pop();
  // Every variable a pre_animation keeps between frames is initialized, so the first frame never reads an unknown one.
  for (const file of entityFiles()) {
    const scripts = json(join(RP, 'entity', file))['minecraft:client_entity'].description.scripts;
    const initialized = new Set((scripts.initialize ?? []).map((/** @type {string} */ line) => line.match(/^(?:v|variable)\.([a-z_0-9]+)/)?.[1]));
    for (const line of scripts.pre_animation ?? []) for (const m of line.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/g)) assert.ok(initialized.has(m[1]), `${file}: variable.${m[1]} initialized`);
    if (file === 'player.entity.json') assert.ok(initialized.has('melee_spear_equipped'), 'the vanilla animations read melee_spear_equipped');
  }
});

test('kicks are bulges, not loose cubes: the push layers only move the belly, the navel crowning travels by the measured reach of each belly size', () => {
  const animations = json(join(RP, 'animations/preggo_mob.animation.json')).animations;
  for (const name of ['fetal_push', 'fetal_push_monster', 'birth_push', 'birth_push_monster']) {
    const bones = Object.keys(animations[`animation.minepreggo.${name}`].bones);
    assert.deepEqual(bones, ['belly'], `${name} leaves the kick cubes to the mod's keyframed kicks`);
  }
  for (const name of ['navel_prebirth', 'navel_birth', 'navel_birth_light']) {
    const bones = animations[`animation.minepreggo.${name}`].bones;
    assert.match(JSON.stringify(bones.front_kick.position), /v\.kr_f/, `${name}: the crowning travels by the reach of the belly size`);
    const scales = JSON.stringify(bones.front_kick.scale ?? []);
    assert.ok(!/[2-9]\.\d+ \* v\.push/.test(scales), `${name}: the crowning never grows into a block`);
  }
  for (const anim of Object.values(animations)) for (const bone of Object.keys(anim.bones ?? {})) assert.doesNotMatch(bone, /_p\d$/, 'no channels for the old merged-model bones');
  // Every female and the player know how deep their kick cube rests for every belly size that has one.
  for (const file of entityFiles()) {
    const pre = json(join(RP, 'entity', file))['minecraft:client_entity'].description.scripts.pre_animation;
    const line = pre.find((/** @type {string} */ l) => l.startsWith('v.k_front_kick_z ='));
    assert.ok(line, `${file}: kick reach`);
    assert.ok(pre.includes('v.kr_f = v.k_front_kick_z;'), `${file}: the navel reach is the front kick's room`);
    for (let phase = 3; phase <= 9; phase++) assert.match(line, new RegExp(`== ${phase} \\? \\d+\\.\\d+`), `${file}: reach for P${phase}`);
    const values = [...line.matchAll(/== \d \? (\d+\.\d+)/g)].map((m) => Number(m[1]));
    assert.ok(values.every((v) => v >= 0.5 && v <= 16), `${file}: reaches within the belly depth (${values.join(', ')})`);
  }
  // The monster creeper girl's own birth animation moves her kick cubes, so her crowning only grows in place; the ender woman's does not, so hers travels.
  const creeper = json(join(RP, 'entity/monster_creeper_girl.entity.json'))['minecraft:client_entity'].description.animations;
  const ender = json(join(RP, 'entity/ender_woman.entity.json'))['minecraft:client_entity'].description.animations;
  assert.equal(creeper.navel_birth, 'animation.minepreggo.navel_birth_light');
  assert.equal(ender.navel_birth, 'animation.minepreggo.navel_birth');
  // The mod's own kicks are what move the kick cubes, per belly size and kick strength.
  const mod = Object.assign({}, ...readdirSync(join(RP, 'animations/minepreggo')).map((f) => json(join(RP, 'animations/minepreggo', f)).animations));
  for (let phase = 3; phase <= 9; phase++) for (const strength of ['ii', 'iii']) assert.ok(mod[`animation.minepreggo.belly.fetal_movement_p${phase}_${strength}`]?.bones?.front_kick, `the mod's P${phase} ${strength} kick moves the front kick`);
});

test('kicks and contractions are smooth: rolling kick pulses, eased in and out, a contraction wave, on every female, every port girl and the player', () => {
  const animations = json(join(RP, 'animations/preggo_mob.animation.json')).animations;
  const expected = { kick_i: ['front_kick', 'right_kick'], kick_ii: ['front_kick', 'left_kick', 'right_kick'], kick_iii: ['front_kick', 'left_kick', 'right_kick', 'top_kick', 'bottom_kick'] };
  const pulse = '\\* math\\.pow\\(math\\.max\\(0\\.0, math\\.sin\\(q\\.life_time \\* \\d+\\.0 \\+ \\d+\\.0\\)\\), 3\\.0\\)';
  for (const [name, bones] of Object.entries(expected)) {
    const anim = animations[`animation.minepreggo.${name}`];
    assert.ok(anim?.loop === true && !JSON.stringify(anim.bones).includes('"0.0"'), `${name} stays active with no keyframes to restart: its expressions pulse on the entity's clock`);
    assert.deepEqual(Object.keys(anim.bones), bones, name);
    for (const [bone, channels] of Object.entries(anim.bones)) {
      const z = String(channels.position[2]);
      // Out by the measured room plus a bulge on a broad, smooth bump (a sine cubed): it rises, settles and rests.
      assert.match(z, new RegExp(`^-\\(v\\.k_${bone}_z \\+ [12]\\.\\d\\d\\) ${pulse}$`), `${name} ${bone}: ${z}`);
      assert.equal(channels.position[0], 0);
      // ...drifting a little along the skin as it rolls
      assert.match(String(channels.position[1]), new RegExp(`^0\\.\\d\\d \\* math\\.sin\\(q\\.life_time \\* \\d+\\.\\d \\+ \\d+\\.0\\) ${pulse}$`), `${name} ${bone} drifts`);
      assert.match(String(channels.scale[0]), /^1\.0 \+ 0\.\d\d \* math\.pow/, `${name} ${bone} grows as it pushes`);
      assert.equal(channels.scale[2], '1.0', 'never deeper');
    }
    const bulges = Object.values(anim.bones).map((c) => Number(/\+ (\d\.\d\d)\)/.exec(String(c.position[2]))?.[1]));
    assert.ok(bulges.every((b) => b >= 1.2 && b <= 2.0), `${name} bulges ${bulges.join(', ')}`);
  }
  // The contraction wave: the belly lifts, rounds forward and narrows in six-second waves while v.cw rises.
  const wave = animations['animation.minepreggo.contraction_wave'];
  assert.ok(wave?.loop && wave.bones.belly.scale.every((/** @type {string} */ c) => c.includes('v.cw') && c.includes('math.cos(q.life_time * 60.0)')));
  // Every belly size that kicks weights its kick layers by the eased v.kick_w, and runs the wave.
  const controller = Object.values(json(join(RP, 'animation_controllers/belly.animation_controllers.json')).animation_controllers)[0];
  for (let phase = 3; phase <= 9; phase++) {
    const state = controller.states[`p${phase}`].animations.map((/** @type {any} */ a) => (typeof a === 'string' ? [a, ''] : Object.entries(a)[0]));
    for (const [n, strength] of [['i', 0], ['ii', 1], ['iii', 2]]) {
      // weighted by the strength last kicked with, so a burst fades out in the strength it had
      assert.deepEqual(state.find(([a]) => a === `kick_${n}`), [`kick_${n}`, `v.kick_w * (v.kick_shown == ${strength})`], `p${phase}`);
      assert.deepEqual(state.find(([a]) => a === `fetal_p${phase}_${n}`), [`fetal_p${phase}_${n}`, `v.kick_w * (v.kick_shown == ${strength})`], `p${phase}`);
    }
    assert.ok(state.some(([a]) => a === 'contraction_wave'), `p${phase} contraction wave`);
    assert.ok(controller.states[`p${phase}`].blend_transition >= 0.3, 'sizes cross-fade');
  }
  for (const file of entityFiles()) {
    const d = json(join(RP, 'entity', file))['minecraft:client_entity'].description;
    // The player's entries carry the mod prefix like the rest of the player's animations.
    for (const kick of ['kick_i', 'kick_ii', 'kick_iii', 'contraction_wave']) assert.equal(d.animations[kick] ?? d.animations[`minepreggo_${kick}`], `animation.minepreggo.${kick}`, `${file}: ${kick}`);
    if (file === 'player.entity.json') continue;
    // The kick and contraction state eases in and out: frame-rate independent, never jumping a whole fade on a hitch.
    const pre = d.scripts.pre_animation;
    assert.ok(pre.some((/** @type {string} */ l) => l.startsWith("v.scene = q.property('minepreggo:scene')")), `${file}: scene state`);
    assert.ok(pre.some((/** @type {string} */ l) => /^v\.kick_w = math\.clamp\(v\.kick_w \+ \(v\.kicking \? 1\.6 : -1\.1\) \* math\.clamp\(q\.delta_time, 0\.0, 0\.1\), 0\.0, 1\.0\);$/.test(l)), `${file}: eased kicks`);
    assert.ok(pre.some((/** @type {string} */ l) => l.startsWith('v.cw = math.clamp(v.cw + (v.contracting ?')), `${file}: eased contractions`);
    assert.ok(pre.some((/** @type {string} */ l) => l.includes("v.scene == 'kicking'") && l.startsWith('v.kicking =')), `${file}: a scene's kicks`);
    assert.ok(pre.includes('v.kick_shown = v.kicking ? v.kick : v.kick_shown;'), `${file}: the strength holds while kicks fade`);
    assert.ok(d.scripts.initialize.includes('variable.kick_w = 0.0;') && d.scripts.initialize.includes('variable.cw = 0.0;'));
  }
  const player = json(join(RP, 'entity/player.entity.json'))['minecraft:client_entity'].description;
  for (const [n, kick] of ['kick_i', 'kick_ii', 'kick_iii'].entries()) {
    assert.equal(player.animations[`minepreggo_${kick}`], `animation.minepreggo.${kick}`);
    const entry = player.scripts.animate.find((/** @type {any} */ a) => typeof a === 'object' && `minepreggo_${kick}` in a);
    assert.equal(entry?.[`minepreggo_${kick}`], `variable.kick_w * (variable.mp_pregnant && variable.mp_phase >= 3 && variable.kick_shown == ${n})`);
  }
  const fetal = player.scripts.animate.find((/** @type {any} */ a) => typeof a === 'object' && 'minepreggo_fetal_p7_ii' in a);
  assert.equal(fetal.minepreggo_fetal_p7_ii, 'variable.kick_w * (variable.mp_phase == 7 && variable.kick_shown == 1)');
  assert.equal(player.scripts.initialize.filter((/** @type {string} */ l) => l === 'variable.melee_spear_equipped = 0.0;').length, 1, 'no duplicated init lines');
  assert.ok(player.scripts.pre_animation.some((/** @type {string} */ l) => l.startsWith('variable.kick_w = math.clamp(')));
});

test('no kick cube can leave the belly: every kick keyframe is clamped to the measured room of the belly size, on every female and the player', async () => {
  const { clampKicks, kickRoom, KICK_BONES } = await import('../lib/kick-clamp.mjs');
  // The clamp wraps the mod's numbers in Molang that cannot exceed the room plus the bulge.
  const clamped = clampKicks({ bones: { left_kick: { position: { '1.0': { post: [8, 0, -4] } }, scale: { '1.0': { post: [1.6, 1, 1] } } }, belly: { scale: [1, 1, 1] } } });
  // The peak of a kick is its share of the room plus the bulge: it always surfaces, never floats.
  assert.deepEqual(clamped.bones.left_kick.position['1.0'].post, ['((v.k_left_kick_x + 1.25) * 1.0000)', 0, '(-(v.k_left_kick_z + 1.50) * 1.0000)']);
  assert.deepEqual(clamped.bones.left_kick.scale['1.0'].post, [1.25, 1, 1]);
  assert.deepEqual(clamped.bones.belly, { scale: [1, 1, 1] }, 'the belly itself is untouched');
  // Half-way keyframes keep the kick's own curve; a jitter (under half a unit) is only clamped.
  const curve = clampKicks({ bones: { front_kick: { position: { '0.0': [0, 0, 0], '0.5': [0, 0, -2], '1.0': [0, 0, -4] } } } });
  assert.deepEqual(curve.bones.front_kick.position['0.5'], [0, 0, '(-(v.k_front_kick_z + 1.50) * 0.5000)']);
  // The game precomputes catmull-rom curves and refuses them on Molang keyframes (dropping the whole
  // animation), so a clamped channel eases linearly; a channel left constant keeps its curve.
  const eased = clampKicks({ bones: { front_kick: { position: { '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' }, '0.5': { post: [0, 0, -2], lerp_mode: 'catmullrom' }, '1.0': { pre: [0, 0, -4], post: [0, 0, -4], lerp_mode: 'catmullrom' } } }, belly: { position: { '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' } } } } });
  assert.deepEqual(eased.bones.front_kick.position['0.0'], [0, 0, 0]);
  assert.deepEqual(eased.bones.front_kick.position['0.5'], [0, 0, '(-(v.k_front_kick_z + 1.50) * 0.5000)']);
  assert.deepEqual(eased.bones.front_kick.position['1.0'], { pre: [0, 0, '(-(v.k_front_kick_z + 1.50) * 1.0000)'], post: [0, 0, '(-(v.k_front_kick_z + 1.50) * 1.0000)'] });
  assert.equal(eased.bones.belly.position['0.0'].lerp_mode, 'catmullrom');
  const jitter = clampKicks({ bones: { top_kick: { position: [0.2, 0, -0.3] } } });
  assert.deepEqual(jitter.bones.top_kick.position, ['math.clamp(0.2, -(v.k_top_kick_x + 1.25), (v.k_top_kick_x + 1.25))', 0, 'math.max(-(v.k_top_kick_z + 1.50), -0.3)']);
  // The room is measured from the belly's box, cubes rotated as the game rotates them.
  const room = kickRoom({ bones: [
    { name: 'belly', pivot: [0, 0, 0] },
    { name: 'skin', parent: 'belly', pivot: [0, 0, 0], cubes: [{ origin: [-4, 10, -10], size: [8, 6, 8] }] },
    { name: 'turned', parent: 'belly', pivot: [0, 13, -6], rotation: [0, 90, 0], cubes: [{ origin: [-1, 12, -6], size: [2, 2, 6] }] },
    { name: 'front_kick', parent: 'belly', pivot: [0, 0, 0], cubes: [{ origin: [-1.5, 12, -7], size: [3, 3, 3], inflate: -0.1 }] },
  ] });
  assert.deepEqual(room.front_kick, { x: 2.6, y: 1.1, z: 3.1 });
  // Every converted animation that moves a kick cube is clamped.
  const mod = Object.assign({}, ...readdirSync(join(RP, 'animations/minepreggo')).map((f) => json(join(RP, 'animations/minepreggo', f)).animations));
  let clampedChannels = 0;
  for (const [name, anim] of Object.entries(mod)) for (const bone of KICK_BONES) {
    const position = anim.bones?.[bone]?.position;
    if (!position) continue;
    // Every non-zero component of every keyframe is a clamp expression, never a bare number.
    const vectors = Array.isArray(position) ? [position] : Object.values(position).flatMap((frame) => (Array.isArray(frame) ? [frame] : [frame.pre, frame.post].filter(Boolean)));
    for (const vector of vectors) vector.forEach((component, axis) => {
      // z may stay a bare positive number: that is a move backwards, deeper into the belly.
      if (typeof component === 'number') assert.ok(component === 0 || (axis === 2 && component > 0), `${name} ${bone}: a bare outward position value escaped the clamp (${component})`);
      else assert.match(String(component), /^(math\.(clamp|max)\(|\(-?\(v\.k_)/, `${name} ${bone}: ${component}`);
    });
    if (vectors.some((vector) => vector.some((component) => typeof component === 'string'))) clampedChannels++;
    const scale = anim.bones[bone].scale;
    const scales = !scale ? [] : Array.isArray(scale) ? [scale] : Object.values(scale).flatMap((frame) => (Array.isArray(frame) ? [frame] : [frame.pre, frame.post].filter(Boolean)));
    for (const vector of scales) for (const component of vector) if (typeof component === 'number') assert.ok(component <= 1.25, `${name} ${bone}: scale ${component}`);
  }
  assert.ok(clampedChannels >= 20, `${clampedChannels} clamped kick channels`);
  // Every female and the player carry the room of every kick cube for every belly size that has it.
  for (const file of entityFiles()) {
    const pre = json(join(RP, 'entity', file))['minecraft:client_entity'].description.scripts.pre_animation;
    for (const bone of KICK_BONES) for (const axis of ['x', 'y', 'z']) {
      const line = pre.find((/** @type {string} */ l) => l.startsWith(`v.k_${bone}_${axis} =`));
      assert.ok(line, `${file}: room ${bone} ${axis}`);
      for (let phase = 3; phase <= 9; phase++) assert.match(line, new RegExp(`== ${phase} \\? \\d+\\.\\d+`));
    }
    assert.ok(pre.some((/** @type {string} */ l) => l === 'v.kr_f = v.k_front_kick_z;'), `${file}: the navel reach is the front kick's room`);
  }
});

test('the Jenny Bed: a tamed female of yours lies down, the player is held and animated, and 50 seconds later she is pregnant', async () => {
  const girl = new Mob('minepreggo:humanoid_slime_girl', { tamed: true });
  girl.location = { x: 10, y: 64, z: 10 };
  overworld.entities.push(girl);
  const owner = new Player('Bedder');
  owner.location = { x: 11, y: 64, z: 10 };
  world.players.push(owner);
  const bed = customComponents.blocks.get('minepreggo:jenny_bed');
  assert.ok(bed, 'the bed block component is registered');
  // Placing the bed turns it the way the player faces (the old pack's rotation values).
  const placing = { player: { getRotation: () => ({ x: 0, y: 90 }) }, permutationToPlace: { withState: (/** @type {string} */ k, /** @type {number} */ v) => ({ state: { [k]: v } }) } };
  bed.beforeOnPlayerPlace(placing);
  assert.equal(placing.permutationToPlace.state['minepreggo:facing'], 4);
  const block = { location: { x: 10, y: 64, z: 10 }, center: () => ({ x: 10.5, y: 64.5, z: 10.5 }), dimension: overworld, permutation: { getState: () => 3 } };
  owner.formSelections = [0];
  bed.onPlayerInteract({ block, player: owner });
  await flush();
  assert.ok(owner.forms.at(-1).buttons.length >= 1, 'the bed lists the female next to it');
  assert.equal(owner.permissions.get(InputPermissionCategory.Movement), false, 'the player is held in place');
  assert.equal(owner.animations.at(-1)?.name, 'animation.minepreggo.jenny_bed.player_scene', "the old pack's player animation plays");
  // The scene is watched from a free camera beside the bed (the fapcraft Jenny's observer idea, without her invisible stand-in).
  const camera = owner.cameras.at(-1);
  assert.equal(camera?.preset, 'minecraft:free', 'a free camera frames the scene');
  assert.ok(camera.options.facingLocation && camera.options.location && camera.options.easeOptions, 'placed, aimed at the pair and eased in');
  system.tick(STEP);
  assert.equal(girl.getProperty('minepreggo:pose'), 'scene', 'she goes on all fours for the scene');
  assert.ok(girl.teleports.length >= 1, 'she is placed on the bed');
  system.tick(1000 + STEP);
  const record = getMobRecord(girl);
  assert.ok(record.data.pregnancy, 'pregnant when the scene is over');
  assert.equal(girl.getProperty('minepreggo:phase'), 0);
  assert.equal(owner.permissions.get(InputPermissionCategory.Movement), true, 'the player is released');
  assert.equal(owner.animations.at(-1)?.name, 'animation.humanoid.base_pose');
  assert.equal(owner.cameras.at(-1), 'clear', 'the player gets their own eyes back');
  assert.notEqual(girl.getProperty('minepreggo:pose'), 'scene', 'her pose is hers again');
  assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.bed.pregnant')));
  world.players.pop();
  girl.isValid = false;
  emit(world.afterEvents.entityRemove, { removedEntityId: girl.id });
});

test('the Jenny Bed: a female further away walks to it on her own (the port Jenny\'s way), the scene starts when she arrives or when she takes too long', async () => {
  const { requestScene, isWalking, sceneOf, WALK_TICKS } = await import('../../packs/behavior/scripts/jenny/scenes.js');
  // Every female can walk to a bed: a goal that targets the bed block and reports arrival.
  for (const file of behaviorEntityFiles().filter((f) => f !== 'player.json')) {
    const entity = json(join(BP, 'entities', file))['minecraft:entity'];
    const goal = entity.component_groups['minepreggo:go_to_bed']?.['minecraft:behavior.move_to_block'];
    assert.ok(goal, `${file}: walks to the bed`);
    assert.deepEqual(goal.target_blocks, ['minepreggo:jenny_bed']);
    assert.deepEqual(goal.on_reach, [{ event: 'minepreggo:bed_reached', target: 'self' }]);
    for (const event of ['minepreggo:go_to_bed', 'minepreggo:bed_reached', 'minepreggo:leave_bed']) assert.ok(entity.events[event], `${file}: ${event}`);
  }
  const owner = new Player('Patient');
  owner.location = { x: 11, y: 64, z: 10 };
  world.players.push(owner);
  const bed = { location: { x: 10, y: 64, z: 10 }, facing: 3 };
  const far = new Mob('minepreggo:zombie_girl', { tamed: true });
  far.location = { x: 22, y: 64, z: 10 };
  overworld.entities.push(far);
  assert.equal(requestScene(getMobRecord(far), owner, bed), 'walking');
  assert.ok(far.events.includes('minepreggo:go_to_bed') && isWalking(far), 'she sets off');
  assert.ok(owner.messages.some((m) => text(m).includes('minepreggo.bed.coming')));
  assert.equal(owner.permissions.get(InputPermissionCategory.Movement), undefined, 'the player is free while she walks');
  system.tick(STEP);
  assert.ok(!sceneOf(far), 'no scene before she arrives');
  // Her goal reports the arrival: the scene starts, the goal is taken away.
  emit(world.afterEvents.dataDrivenEntityTrigger, { entity: far, eventId: 'minepreggo:bed_reached' });
  assert.ok(sceneOf(far) && !isWalking(far), 'the scene starts as she arrives');
  assert.ok(far.events.includes('minepreggo:leave_bed'));
  assert.equal(owner.cameras.at(-1)?.preset, 'minecraft:free');
  system.tick(1000 + STEP * 2);
  assert.ok(getMobRecord(far).data.pregnancy, 'pregnant after the scene');
  // One who never arrives is placed on the bed when her time is up.
  const slow = new Mob('minepreggo:ender_woman', { tamed: true });
  slow.location = { x: 40, y: 64, z: 10 };
  overworld.entities.push(slow);
  assert.equal(requestScene(getMobRecord(slow), owner, bed), 'walking');
  system.tick(WALK_TICKS + STEP);
  assert.ok(sceneOf(slow) && slow.teleports.length >= 1, 'placed on the bed');
  system.tick(1000 + STEP * 2);
  assert.ok(getMobRecord(slow).data.pregnancy);
  assert.equal(owner.cameras.at(-1), 'clear');
  world.players.pop();
  for (const e of [far, slow]) {
    e.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: e.id });
  }
});

test('the Jenny Mod Java Port girls: a scene that can get her pregnant does when it plays out, others do not, her looks never count as a pregnancy, and her stage shows her belly', () => {
  const jenny = new Mob('fapcraft:jenny', { variant: 3 }); // her variant is her own skin, not a phase
  jenny.location = { x: 20, y: 64, z: 20 };
  overworld.entities.push(jenny);
  system.tick(STEP);
  assert.equal(getMobRecord(jenny).data.wild, null, 'her variant is not a wild pregnancy');
  const scene = (/** @type {Mob} */ entity, /** @type {string} */ eventId) => emit(world.afterEvents.dataDrivenEntityTrigger, { entity, eventId });
  scene(jenny, 'jhjenjava:start_blowjob');
  scene(jenny, 'jhjenjava:finish_stage');
  assert.equal(getMobRecord(jenny).data.pregnancy, null, 'an oral scene changes nothing');
  /** Plays most of a fertile scene (FERTILE_SHARE of its length). */
  const play = (/** @type {Mob} */ girl, /** @type {string} */ eventId) => system.tick(Math.ceil(PORT_GIRLS[girl.typeId].fertile[eventId] * FERTILE_SHARE));
  scene(jenny, 'jhjenjava:start_doggy_action');
  assert.ok(inPortScene(/** @type {any} */ (jenny)));
  system.tick(40);
  scene(jenny, 'jhjenjava:finish_stage');
  assert.equal(getMobRecord(jenny).data.pregnancy, null, 'a scene stopped at once gets her nothing');
  assert.ok(!inPortScene(/** @type {any} */ (jenny)));
  scene(jenny, 'jhjenjava:start_doggy_action');
  play(jenny, 'jhjenjava:start_doggy_action');
  scene(jenny, 'jhjenjava:finish_stage');
  assert.ok(getMobRecord(jenny).data.pregnancy, 'pregnant after her doggy scene');
  assert.equal(jenny.getProperty('minepreggo:phase'), 0);
  assert.ok(jenny.events.includes('minepreggo:set_phase_0'));
  // Ellie's scene is chosen on her stage entity.
  const ellie = new Mob('jhelliedev:ellie');
  ellie.location = { x: 30, y: 64, z: 30 };
  const stage = new Mob('jhelliedev:ellie_stage', { families: ['jhelliedev_stage'] });
  stage.location = { x: 31, y: 64, z: 30 };
  overworld.entities.push(ellie, stage);
  // Her scenes end with her recovery event (what the port fires), not the stage's finish event.
  scene(stage, 'jhelliedev:start_scene_missionary');
  play(ellie, 'jhelliedev:start_scene_missionary');
  scene(ellie, 'jhelliedev:finish_interaction');
  assert.ok(getMobRecord(ellie).data.pregnancy, 'Ellie is pregnant after her missionary scene');
  // ... and when only her stage goes away, that ends the scene as well.
  const ellie2 = new Mob('jhelliedev:ellie');
  ellie2.location = { x: 60, y: 64, z: 60 };
  const stage2 = new Mob('jhelliedev:ellie_stage', { families: ['jhelliedev_stage'] });
  stage2.location = { x: 61, y: 64, z: 60 };
  overworld.entities.push(ellie2, stage2);
  scene(stage2, 'jhelliedev:start_scene_cowgirl');
  play(ellie2, 'jhelliedev:start_scene_cowgirl');
  stage2.isValid = false;
  emit(world.afterEvents.entityRemove, { removedEntityId: stage2.id, typeId: stage2.typeId });
  system.tick(1);
  assert.ok(getMobRecord(ellie2).data.pregnancy, 'pregnant once her stage is removed at the end of the scene');
  ellie2.isValid = false;
  emit(world.afterEvents.entityRemove, { removedEntityId: ellie2.id });
  // Galath's threesome gets Manglelie pregnant too; her anal scene gets nobody pregnant.
  const galath = new Mob('kum:galath');
  galath.location = { x: 40, y: 64, z: 40 };
  const manglelie = new Mob('kum:manglelie');
  manglelie.location = { x: 41, y: 64, z: 40 };
  overworld.entities.push(galath, manglelie);
  scene(galath, 'jh:start_anal');
  scene(galath, 'jh:finish');
  assert.equal(getMobRecord(galath).data.pregnancy, null);
  scene(galath, 'jh:start_threesome');
  play(galath, 'jh:start_threesome');
  scene(galath, 'jh:finish');
  assert.ok(getMobRecord(galath).data.pregnancy && getMobRecord(manglelie).data.pregnancy);
  // A stage spawned next to a pregnant girl shows her belly size.
  const jennyStage = new Mob('jhjenjava:jenny_stage', { families: ['jenny_stage'] });
  jennyStage.location = { x: 21, y: 64, z: 20 };
  overworld.entities.push(jennyStage);
  mobs.setPhase(getMobRecord(jenny), 3);
  emit(world.afterEvents.entitySpawn, { entity: jennyStage, cause: 'Spawned' });
  assert.equal(jennyStage.getProperty('minepreggo:belly'), 'p3');
  // Her own undressed state flags is_tamed: no hunger or savage state of ours.
  jenny.tamed = true;
  system.tick(STEP);
  assert.equal(getMobRecord(jenny).data.fullness, 14, 'fullness untouched');
  for (const e of [jenny, ellie, stage, galath, manglelie, jennyStage]) {
    e.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: e.id });
  }
});

test('the merged Jenny Mod Java Port: patched entities, bellies under every body, scripts for Script API 2.x, the house without its NPC', async () => {
  const dir = join(BP, 'entities/jenny_port');
  if (!existsSync(dir)) {
    console.log('  (vendor/jenny/ not imported, skipped)');
    return;
  }
  const jenny = json(join(dir, 'jenny.json'))['minecraft:entity'];
  for (const p of ['minepreggo:phase', 'minepreggo:belly', 'minepreggo:pose', 'minepreggo:kick', 'minepreggo:growth']) assert.ok(jenny.description.properties[p], p);
  assert.ok(jenny.components['minecraft:type_family'].family.includes('minepreggo_preggo_mob'));
  assert.ok(jenny.events['minepreggo:set_phase_5'] && jenny.events['minepreggo:set_not_pregnant']);
  assert.match(readFileSync(join(dir, 'jenny.json'), 'utf8'), /"default": 0\.0/, 'the float default keeps its decimal point');
  const client = json(join(RP, 'entity/jenny_port/jenny.json'))['minecraft:client_entity'].description;
  const bellyRcs = client.render_controllers.filter((/** @type {any} */ rc) => typeof rc === 'object' && Object.keys(rc)[0].includes('.jp_jenny_'));
  assert.ok(bellyRcs.length >= 10, 'ten belly render controllers per body');
  for (const rc of bellyRcs) assert.match(Object.values(rc)[0], /^v\.bp == \d( && \(.*\))?$/);
  assert.ok(client.animations.belly_controller && client.scripts.animate.includes('belly_controller'));
  assert.ok(client.scripts.pre_animation.some((/** @type {string} */ l) => l.startsWith('v.k_front_kick_z =')), 'kick room lines');
  assert.ok(client.scripts.initialize.includes('variable.bp = 0.0;'));
  const belly = json(join(RP, 'models/entity/jenny_port/minepreggo/jenny_0_belly_p7.geo.json'))['minecraft:geometry'][0];
  const names = belly.bones.map((/** @type {any} */ b) => b.name);
  assert.deepEqual(names.slice(0, 3), ['body', 'upperBody', 'hip'], 'the belly hangs under her own bone chain');
  assert.equal(belly.bones.find((/** @type {any} */ b) => b.name === 'belly').parent, 'hip');
  assert.ok(names.includes('front_kick') && names.includes('top_kick'));
  // The belly is a smooth shell: thin slabs each turned to lie on a pregnant profile fitted to her waist.
  const bellyBone = belly.bones.find((/** @type {any} */ b) => b.name === 'belly');
  assert.ok(bellyBone.cubes.length >= 100 && !bellyBone.rotation, `${bellyBone.cubes.length} shell slabs`);
  const slabs = bellyBone.cubes.filter((/** @type {any} */ c) => c.rotation);
  assert.ok(slabs.length >= 100 && slabs.every((/** @type {any} */ c) => c.pivot && c.rotation[2] === 0 && c.uv.north), 'slabs turned about their own pivot, per-face UVs');
  const { cubeFaces } = await import('../lib/geo-render.mjs');
  const corners = cubeFaces({ bones: belly.bones.filter((/** @type {any} */ b) => b.name === 'belly' || ['body', 'upperBody', 'hip'].includes(b.name)) }).flatMap((f) => f.corners);
  const lo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
  assert.ok(hi[0] - lo[0] > 6 && hi[0] - lo[0] < 12, `fitted to her torso (${(hi[0] - lo[0]).toFixed(2)} wide)`);
  assert.ok(hi[1] - lo[1] > 7 && hi[1] - lo[1] < 16, `as tall as her waist (${(hi[1] - lo[1]).toFixed(2)})`);
  assert.ok(lo[2] < -5.5, `bulging forward (${lo[2].toFixed(2)})`);
  // In her own skin: a gradient texture in her tone, bound as her belly texture on every belly render controller.
  assert.equal(belly.description.texture_width, 128);
  assert.equal(client.textures.minepreggo_belly, 'textures/jenny_port/minepreggo/jenny_belly');
  assert.ok(existsSync(join(RP, 'textures/jenny_port/minepreggo/jenny_belly.png')));
  const rcs = json(join(RP, 'render_controllers/jenny_port/minepreggo_bellies.render_controllers.json')).render_controllers;
  for (const rc of bellyRcs) assert.deepEqual(rcs[Object.keys(rc)[0]].textures, ['Texture.minepreggo_belly'], Object.keys(rc)[0]);
  // Her kicks are domes on mounts turned to the skin, so a kick pushes straight out of it.
  for (const kick of ['kick_i', 'kick_ii', 'kick_iii', 'contraction_wave']) assert.equal(client.animations[kick], `animation.minepreggo.${kick}`);
  const frontKick = belly.bones.find((/** @type {any} */ b) => b.name === 'front_kick');
  assert.equal(frontKick.parent, 'front_kick_mount');
  assert.equal(belly.bones.find((/** @type {any} */ b) => b.name === 'front_kick_mount').parent, 'belly');
  assert.equal(frontKick.cubes.length, 3, 'a dome of three layers');
  // The crowning: her baby under her hip at her opening, head first, shown only while she pushes during the birth.
  const bone = (/** @type {string} */ name) => belly.bones.find((/** @type {any} */ b) => b.name === name);
  assert.equal(bone('crowning')?.parent, 'hip');
  assert.equal(bone('crowning_slide')?.parent, 'crowning');
  assert.deepEqual(bone('crowning_baby')?.rotation, [180, 0, 0], 'head first');
  assert.ok(bone('fetus_head') && !bone('newborn'));
  assert.equal(client.animations.newborn, 'animation.minepreggo.crowning_free');
  assert.ok(client.scripts.pre_animation.some((/** @type {string} */ l) => l.startsWith("v.crowning = (v.pose == 'birth')")));
  const crowning = json(join(RP, 'animations/preggo_mob.animation.json')).animations['animation.minepreggo.crowning_free'].bones;
  assert.equal(crowning.crowning.scale, 'v.crowning ? v.crown_scale : 0.0');
  // The kobold lays eggs: an egg crowns instead of a baby.
  const kobold = json(join(RP, 'models/entity/jenny_port/minepreggo/kobold_0_belly_p4.geo.json'))['minecraft:geometry'][0];
  assert.ok(kobold.bones.some((/** @type {any} */ b) => b.name === 'fetus_egg') && !kobold.bones.some((/** @type {any} */ b) => b.name === 'fetus_head'));
  // Her poses: the mod's labor and the scene poses, solved onto her rig, in a controller that only plays in her everyday state.
  const poses = json(join(RP, 'animations/jenny_port/minepreggo/jenny_poses.animation.json')).animations;
  for (const pose of ['contraction', 'incapacitated', 'kicking_sit', 'morning_sickness', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'back_pain', 'water_breaking', 'scene', 'scene_sit']) {
    const id = `animation.minepreggo.jp_jenny.${pose}`;
    assert.ok(poses[id], pose);
    assert.equal(client.animations[`mp_pose_${pose}`], id);
    const additive = pose === 'back_pain' || pose === 'water_breaking';
    assert.equal(!!poses[id].override_previous_animation, !additive, `${pose}: ${additive ? 'adds to her walk' : 'replaces her own animations on its bones'}`);
  }
  assert.ok(poses['animation.minepreggo.jp_jenny.birth'].bones.upperBody.rotation, 'she lies back for the birth');
  assert.deepEqual(poses['animation.minepreggo.jp_jenny.birth'].bones.closedL.position, [0, 0, -1], 'eyes squeezed shut');
  const controllers = json(join(RP, 'animation_controllers/jenny_port/minepreggo_poses.animation_controllers.json')).animation_controllers;
  const poseController = controllers[client.animations.mp_pose_controller];
  assert.deepEqual(poseController.states.default.transitions.find((/** @type {any} */ t) => 'birth' in t), { birth: "v.jp_normal && v.pose == 'birth'" });
  assert.ok(client.scripts.pre_animation.includes('v.jp_normal = q.skin_id == 0;'));
  assert.deepEqual(client.scripts.animate.slice(-3), ['mp_pose_controller', 'newborn', 'belly_controller']);
  // Her own interactions are hers as the port wrote them (our pregnancy menu answers sneak-use with an empty hand from a script).
  const interact = jenny.components['minecraft:interact'].interactions[0].on_interact;
  assert.ok(!JSON.stringify(interact.filters ?? {}).includes('"test":"is_sneaking","subject":"other","value":false'));
  // Her baby: an item with an icon in her colours and a name.
  const baby = json(join(BP, 'items/jenny_port/minepreggo/baby_jenny.json'))['minecraft:item'];
  assert.equal(baby.description.identifier, 'minepreggo:baby_jenny');
  assert.equal(json(join(RP, 'textures/jenny_port/item_texture.json')).texture_data.minepreggo_baby_jenny.textures, 'textures/jenny_port/minepreggo/baby_jenny');
  assert.ok(existsSync(join(RP, 'textures/jenny_port/minepreggo/baby_jenny.png')));
  assert.match(readFileSync(join(RP, 'texts/en_US.lang'), 'utf8'), /^item\.minepreggo\.baby_jenny=Jenny's Baby$/m);
  // Their scripts: patched for Script API 2.x and still valid JavaScript.
  for (const f of readdirSync(join(BP, 'scripts/jenny_port'))) {
    const source = readFileSync(join(BP, 'scripts/jenny_port', f), 'utf8');
    assert.doesNotMatch(source, /getAllPlayers/, f);
    assert.doesNotMatch(source, /applyKnockback\([^{]/, f);
    const check = spawnSync(process.execPath, ['--check', join(BP, 'scripts/jenny_port', f)]);
    assert.equal(check.status, 0, `${f}: ${check.stderr}`);
  }
  // The stage entities carry the belly size and render it.
  const stage = json(join(dir, 'jenny_stage.json'))['minecraft:entity'];
  for (const property of ['minepreggo:belly', 'minepreggo:kick', 'minepreggo:scene', 'minepreggo:phase']) assert.ok(stage.description.properties[property], property);
  const stageClient = json(join(RP, 'entity/jenny_port/jenny_stage.json'))['minecraft:client_entity'].description;
  assert.ok(stageClient.render_controllers.some((/** @type {any} */ rc) => typeof rc === 'object' && Object.keys(rc)[0].includes('jp_jenny_stage')));
  // The house: blocks only, with our bed block and state.
  const { parseNbt, get } = await import('../lib/nbt.mjs');
  const house = readFileSync(join(BP, 'structures/minepreggo/jenny_house.mcstructure'));
  const tree = parseNbt(new Uint8Array(house));
  assert.equal(get(get(tree[0][1].value, 'structure').value, 'entities').value.items.length, 0, 'no entity in the house');
  assert.ok(house.includes('minepreggo:jenny_bed') && house.includes('minepreggo:facing') && !house.includes('bridge:block_rotation'));
  // The UI and the overlays the build merges are in place; nothing imported is tracked by git.
  assert.ok(existsSync(join(RP, 'ui/_ui_defs.json')) && existsSync(join(RP, 'sounds/jenny_port/sound_definitions.json')) && existsSync(join(RP, 'textures/jenny_port/item_texture.json')));
  const tracked = spawnSync('git', ['ls-files', '--', 'packs/behavior/entities/jenny_port', 'packs/resource/entity/jenny_port', 'packs/resource/ui', 'packs/behavior/structures'], { cwd: ROOT });
  assert.equal(tracked.stdout.toString().trim(), '', 'imported Jenny files are git-ignored');
});
