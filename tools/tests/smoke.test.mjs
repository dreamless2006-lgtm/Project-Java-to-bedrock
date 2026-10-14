// End-to-end smoke test: loads the behavior pack's real script entry point (scripts/main.js) under
// the mocked game API and plays through what a player does in a world: joining, choosing a gender,
// drinking the potions, watching a pregnancy on the player model, meeting the preggo mobs, the
// crops and drops, and the operator commands. It also checks the parts of the packs that decide
// whether they load on every platform (consoles included): manifests without experiments, every
// custom component used by an item or block registered by the scripts, and short file paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { join, relative } from 'node:path';
import { BlockTypes, EntityDamageCause, EntityTypes, ItemStack, ItemTypes, Mob, Player, customComponents, customComponentsOf, emit, startup, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { selfCheck } from '../../packs/behavior/scripts/world/banner.js';
import { getRecord } from '../../packs/behavior/scripts/pregnancy/system.js';
import * as mobs from '../../packs/behavior/scripts/mobs/system.js';
import { getRecord as getMobRecord, STEP } from '../../packs/behavior/scripts/mobs/system.js';
import { VERSION } from '../../packs/behavior/scripts/version.js';
import { finalPhaseForBabies } from '../../packs/behavior/scripts/pregnancy/math.js';
import { PHASE_SLOWNESS } from '../../packs/behavior/scripts/pregnancy/data.js';

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
  assert.ok(referenced.size >= 7, 'entity textures are referenced');
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
  const notObjects = /^minepreggo:(phase|pose|kick|growth|gender|skin|savage|age|mob|crop|food_effects|impregnation_potion|pregnancy_acceleration|gradual_pregnancy_acceleration|breast_milk|pregnancy|female|pending|set_|on_tame|become_savage|calm_down|spawn_natural|hostile|tamed|tameable|fetal_movement_inducer|guide_given|guide$|forced|zero_gravity_belly$|metabolism_control$|eternal_pregnancy$|potion_effects$|debug|attack_impregnation|mob_courted|belly_touch|stomach_growls|pregnant_preggo_mob_death|player_|preggo_mob|loaded|selfcheck|hud|gender_)/;
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

test('one model per female carries every belly size, textured, shown by the render controller, no render-time switching', () => {
  const families = { zombie_girl: 'mobs/zombie/zombie_girl', humanoid_creeper_girl: 'mobs/creeper/humanoid/humanoid_creeper_girl', monster_creeper_girl: 'mobs/creeper/monster/monster_creeper_girl', ender_woman: 'mobs/ender/ender_woman', humanoid_slime_girl: 'mobs/slime/humanoid/humanoid_slime_girl', monster_slime_girl: 'mobs/slime/monster/monster_slime_girl' };
  assert.ok(!json(join(RP, 'animations/preggo_mob.animation.json')).animations['animation.minepreggo.belly_select'], 'no belly animation switch');
  for (const [family, texture] of Object.entries(families)) {
    const entity = json(join(RP, 'entity', `${family}.entity.json`))['minecraft:client_entity'].description;
    assert.equal(entity.geometry.default, `geometry.minepreggo.${family}_all`, `${family} renders one model`);
    assert.equal(entity.textures.default, `textures/minepreggo/${texture}_all`, `${family} renders one texture`);
    assert.ok(!JSON.stringify(entity).includes('belly_select'), `${family}: the belly is not an animation switch`);
    assert.ok(entity.render_controllers.includes(`controller.render.minepreggo.${family}`), `${family} renders through its own controller`);
    const controllers = json(join(RP, 'render_controllers', `${family}.render_controllers.json`)).render_controllers;
    const main = controllers[`controller.render.minepreggo.${family}`];
    assert.deepEqual(main.part_visibility[0], { '*': true }, `${family}: everything visible but the other bellies`);
    for (const [name, controller] of Object.entries(controllers)) if (!name.endsWith('_eyes')) assert.deepEqual(controller.part_visibility, main.part_visibility, `${name} shows the same belly`);
    const visibility = Object.assign({}, ...main.part_visibility);
    const geometry = json(join(RP, 'models/entity/minepreggo', `${family}_all.geo.json`))['minecraft:geometry'][0];
    const bones = new Map(geometry.bones.map((b) => [b.name, b]));
    const subtree = (/** @type {string} */ name) => [name, ...[...bones.values()].filter((b) => b.parent === name).flatMap((b) => subtree(b.name))];
    assert.ok(bones.has('belly'), `${family}: belly parent bone`);
    const image = png(join(RP, `textures/minepreggo/${texture}_all.png`));
    assert.equal(geometry.description.texture_width, image.width);
    assert.equal(geometry.description.texture_height, image.height);
    for (let phase = 0; phase <= 9; phase++) {
      const group = [...bones.values()].filter((b) => b.name === `belly_p${phase}` || b.name.endsWith(`_p${phase}`));
      const cubes = group.flatMap((b) => b.cubes ?? []);
      assert.ok(cubes.length > 0, `${family} P${phase}: belly cubes`);
      assert.equal(bones.get(`belly_p${phase}`).parent, 'belly');
      // every bone of the belly group, kick bones included, is visible in its phase only (part_visibility is per bone)
      for (const bone of subtree(`belly_p${phase}`)) assert.equal(visibility[bone], `v.phase == ${phase}`, `${family} ${bone} is visible in P${phase} only`);
      // the belly's front faces have their texture pixels in the composite (the mod leaves a few
      // small cubes of the slime girls untextured, so the check is per phase, not per cube)
      let opaque = 0, total = 0;
      for (const cube of cubes) {
        const [w, h, d] = cube.size.map((n) => Math.max(1, Math.ceil(n - 1e-6)));
        for (let y = cube.uv[1] + d; y < cube.uv[1] + d + h; y++) {
          for (let x = cube.uv[0] + d; x < cube.uv[0] + d + w; x++) {
            total++;
            if (image.alpha(x, y) > 0) opaque++;
          }
        }
      }
      assert.ok(opaque >= total * 0.5, `${family} P${phase}: ${opaque}/${total} textured belly pixels`);
      if (phase >= 3) {
        for (const kick of ['front_kick', 'left_kick', 'right_kick']) assert.ok(bones.has(`${kick}_p${phase}`), `${family} P${phase} ${kick}`);
      }
    }
  }
  // Every render controller of ours is a plain geometry + texture reference (no arrays, no property reads).
  for (const file of readdirSync(join(RP, 'render_controllers'))) {
    for (const [name, controller] of Object.entries(json(join(RP, 'render_controllers', file)).render_controllers)) {
      const text = JSON.stringify(controller);
      assert.doesNotMatch(text, /q(uery)?\.property/, `${name} reads a property`);
      assert.doesNotMatch(text, /!= '/, `${name} compares strings`);
      if (name !== 'controller.render.minepreggo.ender_woman_eyes') assert.ok(!controller.arrays, `${name} uses no arrays`);
    }
  }
  // The player's belly layers are merged the same way (custom on the skin, predefined on a composite).
  const player = json(join(RP, 'entity/player.entity.json'))['minecraft:client_entity'].description;
  assert.equal(player.geometry.minepreggo_belly_custom, 'geometry.minepreggo.player_belly_custom');
  assert.equal(player.geometry.minepreggo_belly_predefined, 'geometry.minepreggo.player_belly_predefined');
  for (const kind of ['custom', 'predefined']) {
    const geometry = json(join(RP, 'models/entity/minepreggo', `player_belly_${kind}.geo.json`))['minecraft:geometry'][0];
    for (let phase = 0; phase <= 9; phase++) assert.ok(geometry.bones.some((b) => b.name === `belly_p${phase}` && (b.cubes?.length ?? 0) > 0), `player ${kind} P${phase}`);
  }
  const extra = png(join(RP, 'textures/minepreggo/entity/player/predefined/alex/alex_extra_all.png'));
  const predefined = json(join(RP, 'models/entity/minepreggo/player_belly_predefined.geo.json'))['minecraft:geometry'][0];
  assert.equal(predefined.description.texture_height, extra.height);
  // The kick animations name the per-phase kick bones.
  const belly = json(join(RP, 'animations/minepreggo/belly.animation.json')).animations;
  assert.ok(belly['animation.minepreggo.belly.fetal_movement_p9_iii'].bones.left_kick_p9, 'per-phase kick bones in the mod animations');
  const pushes = json(join(RP, 'animations/preggo_mob.animation.json')).animations;
  assert.ok(pushes['animation.minepreggo.fetal_push'].bones.front_kick_p5 && pushes['animation.minepreggo.navel_birth'].bones.front_kick_p9);
  // The player's labor poses are the mod's humanoid animations on the flat labor geometry.
  const labor = json(join(RP, 'animations/minepreggo/player_labor.animation.json')).animations;
  for (const pose of ['water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage']) assert.ok(labor[`animation.minepreggo.player.labor_${pose}`], pose);
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
  assert.match(command(tester, 'minepreggo:debug', ''), /you: minecraft:player: phase=\d+ pose=\\"fetal_movement\\" kick=2/);
  system.tick(200);
  assert.equal(tester.getProperty('minepreggo:pose'), 'none', 'back to the real state after 10 s');
  for (const file of readdirSync(join(RP, 'entity'))) {
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
  for (const file of readdirSync(join(RP, 'entity'))) {
    const pre = json(join(RP, 'entity', file))['minecraft:client_entity'].description.scripts.pre_animation;
    if (file === 'player.entity.json') {
      const i = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_phase = variable.mp_phase >= 0 ?'));
      assert.ok(i > 0, 'player phase fallback');
      assert.ok(pre.slice(0, i).some((/** @type {string} */ line) => line.startsWith('variable.mp_pose =')), 'the pose is known before the fallback');
      assert.match(pre[i], /mp_pose == 'none'/);
    } else {
      const i = pre.findIndex((/** @type {string} */ line) => line.startsWith('v.phase = v.phase >= 0 ?'));
      assert.ok(i > 0, `${file} phase fallback`);
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
  const ids = new Set(ItemTypes.getAll().map((t) => t.id));
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
