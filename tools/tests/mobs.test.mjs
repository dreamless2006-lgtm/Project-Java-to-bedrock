// Tests for the preggo mob systems (packs/behavior/scripts/mobs) against the mocked game API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mob, Player, ItemStack, system } from './mock-server.mjs';
import { STEP, accelerate, getRecord, onDeath, onHurt, startPregnancy, tickMob } from '../../packs/behavior/scripts/mobs/system.js';
import { chooseAction } from '../../packs/behavior/scripts/mobs/interact.js';
import { birthTicks, FAMILIES } from '../../packs/behavior/scripts/mobs/families.js';
import { PHASES } from '../../packs/behavior/scripts/pregnancy/data.js';

/** Runs `n` mob updates (STEP ticks each). */
function run(/** @type {Mob} */ mob, n) {
  for (let i = 0; i < n; i++) {
    system.currentTick += STEP;
    tickMob(/** @type {any} */ (mob));
  }
}

test('a tamed zombie girl carries one baby from P0 to an automatic birth', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const record = getRecord(/** @type {any} */ (mob));
  assert.ok(startPregnancy(record, 1));
  assert.equal(mob.getProperty('minepreggo:phase'), 0);
  const p = /** @type {any} */ (record.data.pregnancy);
  record.data.fullness = 30;

  for (let phase = 0; phase < 4; phase++) {
    p.daysPassed = p.daysByPhase[phase];
    run(mob, 1);
  }
  assert.equal(mob.getProperty('minepreggo:phase'), 4, 'the phase property follows the pregnancy');
  assert.ok(mob.events.includes('minepreggo:set_phase_4'));

  p.daysPassed = p.daysByPhase[4];
  run(mob, 1);
  assert.equal(p.pain.type, 'WATER_BREAKING');
  assert.equal(mob.getProperty('minepreggo:pose'), 'water_breaking');
  run(mob, 1200 / STEP + 1);
  assert.equal(p.pain.type, 'PREBIRTH');
  assert.ok(mob.effects.get('slowness')?.amplifier === 255, 'labor keeps her in place');
  run(mob, PHASES[4].preBirthTicks / STEP + 1);
  assert.equal(p.pain.type, 'BIRTH');
  run(mob, birthTicks(FAMILIES['minepreggo:zombie_girl']) / STEP + 1);
  assert.deepEqual(mob.dropped, ['minepreggo:baby_zombie']);
  run(mob, 2);
  assert.equal(p.pain.type, 'POSTBIRTH');
  run(mob, 150 / STEP + 1);
  assert.equal(record.data.pregnancy, null);
  assert.equal(record.data.post?.type, 'PARTUM');
  assert.ok(record.data.lactation);
  assert.equal(mob.getProperty('minepreggo:phase'), -1);
  assert.equal(startPregnancy(record, 1), false, 'no new pregnancy while recovering');
});

test('a naturally pregnant hostile mob gets fixed pregnancy data and drops fetuses on death', () => {
  const mob = new Mob('minepreggo:zombie_girl', { phase: 5 });
  run(mob, 1);
  const record = getRecord(/** @type {any} */ (mob));
  const wild = /** @type {any} */ (record.data.wild);
  assert.ok(wild);
  assert.ok(wild.lastPhase >= 5 && wild.lastPhase <= 9);
  assert.ok([2, 3, 4, 5, 6, 7, 8, 9, 10].includes(wild.babies));
  assert.equal(wild.cooldown, 160);
  assert.ok(mob.events.includes('minepreggo:hostile_pregnant_init'), 'she is made untamable');
  assert.equal(startPregnancy(record, 1), false);

  wild.painProbability = 1;
  onHurt(/** @type {any} */ (mob), { damage: 2, cause: 'entityAttack' });
  run(mob, 1);
  assert.equal(mob.getProperty('minepreggo:pose'), 'incapacitated');
  run(mob, 160 / STEP + 1);
  assert.equal(mob.getProperty('minepreggo:pose'), 'none');

  onDeath(/** @type {any} */ (mob));
  assert.equal(mob.dropped.length, wild.babies);
  assert.ok(mob.dropped.every((id) => id === 'minepreggo:dead_zombie_fetus'));
});

test('hunger makes a tamed mob savage and her food calms her down again', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const owner = new Player('Owner');
  const record = getRecord(/** @type {any} */ (mob));
  record.data.owner = owner.id;
  record.data.fullness = 1;
  record.data.hungerTimer = 8400;
  run(mob, 1);
  assert.equal(record.data.savage, true);
  assert.ok(mob.events.includes('minepreggo:become_savage'));

  const action = chooseAction(/** @type {any} */ (owner), /** @type {any} */ (mob), /** @type {any} */ (new ItemStack('minepreggo:villager_brain')));
  assert.ok(action, 'her food is accepted while savage');
  action();
  assert.equal(record.data.fullness, 12);
  assert.equal(record.data.savage, false);
  assert.ok(mob.events.includes('minepreggo:calm_down'));
});

test('cravings want the matching food; milking and belly rubs relieve their needs', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const owner = new Player('Mom');
  const record = getRecord(/** @type {any} */ (mob));
  record.data.owner = owner.id;
  startPregnancy(record, 2);
  const p = /** @type {any} */ (record.data.pregnancy);
  p.phase = 3;
  p.craving = 16;
  p.milking = 12;
  p.bellyRubs = 12;
  run(mob, 3);
  assert.ok(p.symptoms.CRAVING !== undefined && p.symptoms.MILKING !== undefined && p.symptoms.BELLY_RUBS !== undefined);

  p.cravingType = 'SWEET';
  chooseAction(/** @type {any} */ (owner), /** @type {any} */ (mob), /** @type {any} */ (new ItemStack('minepreggo:brain_with_chocolate')))?.();
  assert.equal(p.symptoms.CRAVING, undefined, 'a chocolate brain (16) satisfies a sweet craving');

  chooseAction(/** @type {any} */ (owner), /** @type {any} */ (mob), /** @type {any} */ (new ItemStack('minecraft:glass_bottle')))?.();
  assert.ok(owner.inventory.includes('minepreggo:zombie_breast_milk_bottle'));
  assert.equal(p.milking, 7);

  owner.isSneaking = true;
  chooseAction(/** @type {any} */ (owner), /** @type {any} */ (mob), undefined)?.();
  assert.equal(p.bellyRubs, 8);
  assert.equal(p.symptoms.BELLY_RUBS, undefined);
});

test('only the owner can care for a tamed mob, but anyone can give a wild one the potion', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const record = getRecord(/** @type {any} */ (mob));
  record.data.owner = 'player-Owner';
  const stranger = new Player('Stranger');
  assert.equal(chooseAction(/** @type {any} */ (stranger), /** @type {any} */ (mob), /** @type {any} */ (new ItemStack('minepreggo:villager_brain'))), undefined);

  const wild = new Mob('minepreggo:zombie_girl');
  const potion = chooseAction(/** @type {any} */ (stranger), /** @type {any} */ (wild), /** @type {any} */ (new ItemStack('minepreggo:impregnation_potion_2')));
  assert.ok(potion);
  potion();
  run(wild, 300 / STEP + 1);
  const p = getRecord(/** @type {any} */ (wild)).data.pregnancy;
  assert.ok(p && p.womb.length >= 3, 'potion level III means 3-4 babies');
  assert.equal(wild.getProperty('minepreggo:phase'), 0);
});

test('losing all pregnancy health makes her miscarry, dropping dead fetuses', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const record = getRecord(/** @type {any} */ (mob));
  startPregnancy(record, 2);
  const p = /** @type {any} */ (record.data.pregnancy);
  p.phase = 2;
  p.health = 1;
  mob.components['minecraft:health'].currentValue = 5;
  onHurt(/** @type {any} */ (mob), { damage: 4, cause: 'entityAttack' });
  assert.equal(p.pain?.type, 'MISCARRIAGE');
  run(mob, 800 / STEP + 1);
  assert.equal(record.data.pregnancy, null);
  assert.equal(record.data.post?.type, 'MISCARRIAGE');
  assert.deepEqual(mob.dropped, ['minepreggo:dead_zombie_fetus', 'minepreggo:dead_zombie_fetus']);
});

test('every family in the scripts has an entity, and every item it names exists', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const root = new URL('../../packs/behavior/', import.meta.url);
  const entities = readdirSync(new URL('entities/', root)).map((f) => JSON.parse(readFileSync(new URL(`entities/${f}`, root), 'utf8'))['minecraft:entity'].description.identifier);
  const items = new Set();
  const walk = (/** @type {URL} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
      else items.add(JSON.parse(readFileSync(new URL(entry.name, dir), 'utf8'))['minecraft:item'].description.identifier);
    }
  };
  walk(new URL('items/', root));
  for (const [id, family] of Object.entries(FAMILIES)) {
    assert.ok(entities.includes(id), `${id} has no entity file`);
    const named = [...family.tamingItems, ...Object.keys(family.foods), ...Object.keys(family.cravings), family.babyItem, family.deadFetusItem, family.milkItem];
    for (const item of named) assert.ok(item.startsWith('minecraft:') || items.has(item), `${id}: ${item} is not an item`);
  }
});

test('an acceleration potion moves a mob pregnancy forward and can start labor', () => {
  const mob = new Mob('minepreggo:zombie_girl', { tamed: true });
  const owner = new Player('Potion');
  const record = getRecord(/** @type {any} */ (mob));
  record.data.owner = owner.id;
  startPregnancy(record, 1);
  const p = /** @type {any} */ (record.data.pregnancy);
  const action = chooseAction(/** @type {any} */ (owner), /** @type {any} */ (mob), /** @type {any} */ (new ItemStack('minepreggo:pregnancy_acceleration_potion_4')));
  assert.ok(action, 'the owner can give the potion');
  action();
  assert.equal(p.phase, 2, '17 days from P0 of [3, 10, 10, 13, 15] lands in P2');
  assert.equal(p.daysPassed, 4);
  assert.equal(mob.getProperty('minepreggo:phase'), 2);
  p.phase = 4;
  p.daysPassed = 15;
  assert.ok(accelerate(record, 0));
  assert.equal(p.pain?.type, 'WATER_BREAKING');
});
