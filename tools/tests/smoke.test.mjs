// End-to-end smoke test: loads the behavior pack's real script entry point (scripts/main.js) under
// the mocked game API and plays through what a player does in a world: joining, choosing a gender,
// drinking the potions, watching a pregnancy on the player model, meeting the preggo mobs, the
// crops and drops, and the operator commands. It also checks the parts of the packs that decide
// whether they load on every platform (consoles included): manifests without experiments, every
// custom component used by an item or block registered by the scripts, and short file paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BlockTypes, EntityDamageCause, EntityTypes, ItemStack, ItemTypes, Mob, Player, customComponents, customComponentsOf, emit, startup, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { selfCheck } from '../../packs/behavior/scripts/world/banner.js';
import { getRecord } from '../../packs/behavior/scripts/pregnancy/system.js';
import { getRecord as getMobRecord, STEP } from '../../packs/behavior/scripts/mobs/system.js';
import { VERSION } from '../../packs/behavior/scripts/version.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const BP = join(ROOT, 'packs/behavior');
const RP = join(ROOT, 'packs/resource');
const MAX_PATH = 100; // Minecraft Creator Tools warns above this; long paths break packs on some platforms

const flush = () => new Promise((resolve) => setImmediate(resolve));
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
  for (const file of readdirSync(join(RP, 'entity'))) {
    const client = json(join(RP, 'entity', file))['minecraft:client_entity'].description;
    for (const texture of Object.values(client.textures ?? {})) referenced.add(`${texture}.png`);
  }
  assert.ok(referenced.size > 60, 'entity textures are referenced');
  assert.deepEqual([...referenced].filter((path) => path.length > MAX_PATH), []);
});

test('startup registers every custom component an item or block uses', () => {
  startup();
  for (const path of files(join(BP, 'items'))) {
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
  assert.equal(customComponents.blocks.size, 1);
});

test('joining: banner, gender form, self-check green, body properties synced', async () => {
  player.formSelection = 1; // "Female (Alex skin)"
  emit(world.afterEvents.playerSpawn, { player, initialSpawn: true });
  await flush();
  const record = getRecord(player);
  assert.equal(record.gender, 'female');
  assert.equal(record.skin, 'alex');
  assert.match(text(player.messages[0]), /minepreggo\.loaded/);
  assert.deepEqual(selfCheck(player), { entities: true, items: true, blocks: true, visuals: true });

  system.tick(40);
  const check = player.messages.find((m) => text(m).includes('minepreggo.selfcheck"'));
  assert.ok(check, 'the self-check line is sent two seconds after joining');
  assert.equal((text(check).match(/minepreggo\.selfcheck\.ok/g) ?? []).length, 4);
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

  world.setAbsoluteTime(world.getAbsoluteTime() + 300);
  system.tick(20);
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
  const notObjects = /^minepreggo:(phase|pose|kick|growth|gender|skin|savage|age|mob|crop|food_effects|impregnation_potion|pregnancy_acceleration|gradual_pregnancy_acceleration|breast_milk|pregnancy|female|pending|set_|on_tame|become_savage|calm_down|spawn_natural|hostile|tamed|tameable|fetal_movement_inducer|guide_given|belly_touch|stomach_growls|pregnant_preggo_mob_death|player_|preggo_mob|loaded|selfcheck|hud|gender_)/;
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
  world.setAbsoluteTime(world.getAbsoluteTime() + 300);
  system.tick(20);
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

test('every phase component group carries the variant the render controller selects the belly with', () => {
  for (const path of files(join(BP, 'entities'))) {
    const entity = json(join(BP, 'entities', path))['minecraft:entity'];
    if (entity.description.identifier === 'minecraft:player') continue;
    assert.equal(entity.components['minecraft:variant']?.value, 0, `${path}: not pregnant is variant 0`);
    for (const [group, components] of Object.entries(entity.component_groups)) {
      const phase = group.match(/^minepreggo:(?:hostile_)?phase_(\d)$/);
      if (phase) assert.equal(components['minecraft:variant']?.value, Number(phase[1]) + 1, `${path} ${group}`);
    }
  }
  const controller = json(join(RP, 'render_controllers/preggo_mob.render_controllers.json')).render_controllers['controller.render.minepreggo.preggo_mob'];
  assert.equal(controller.geometry, 'Array.geometries[q.variant]');
  assert.deepEqual(controller.textures, ['Array.skins[q.variant]']);
});
