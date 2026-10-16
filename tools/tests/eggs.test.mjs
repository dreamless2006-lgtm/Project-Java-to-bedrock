// The kobold lays eggs: her Mating scene late in her pregnancy becomes an egg-laying scene, the eggs
// left come with the partner's help, and a clutch of eggs cracks and hatches into her baby item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputButton, Mob, Player, customComponents, emit, startup, system, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { getRecord, setPhase, startPregnancy } from '../../packs/behavior/scripts/mobs/system.js';
import { FAMILIES, birthItemOf } from '../../packs/behavior/scripts/mobs/families.js';
import { LAYING_SCENES, layingChance, layingOf } from '../../packs/behavior/scripts/jenny/kobold_eggs.js';
import { bellySceneOf, onSceneButton } from '../../packs/behavior/scripts/jenny/belly_scenes.js';
import { BABY, BROODING_CHANCE, CRACK_CHANCE, EGG, addEgg, tickClutch } from '../../packs/behavior/scripts/blocks/kobold_egg.js';

const overworld = world.getDimension('minecraft:overworld');
const text = (/** @type {unknown} */ message) => JSON.stringify(message);
startup();

/** A pregnant kobold at the end of her birth phase, with `eggs` eggs. */
function koboldAtTerm(/** @type {number} */ eggs, /** @type {{ x: number, y: number, z: number }} */ at) {
  const kobold = new Mob('jhkobold:kobold', { families: ['minepreggo_preggo_mob', 'kobold'] });
  kobold.location = at;
  overworld.entities.push(kobold);
  const record = getRecord(/** @type {any} */ (kobold));
  assert.ok(startPregnancy(record, eggs));
  const p = /** @type {any} */ (record.data.pregnancy);
  assert.ok(setPhase(record, p.lastPhase));
  p.daysPassed = p.daysByPhase[p.phase];
  return { kobold, record, p };
}

test('a kobold lays eggs: every birth of hers is an egg, and a laying scene comes late in her pregnancy', () => {
  assert.equal(birthItemOf(/** @type {any} */ (FAMILIES['jhkobold:kobold'])), 'minepreggo:kobold_egg');
  assert.equal(birthItemOf(/** @type {any} */ (FAMILIES['fapcraft:jenny'])), 'minepreggo:baby_jenny', 'the others give birth');
  const days = [2, 2, 2, 2, 2];
  const base = { womb: ['HUMAN'], birth: null, phase: 4, lastPhase: 4, daysByPhase: days, daysPassed: 0, timer: 0, pain: null };
  assert.equal(layingChance({ ...base, phase: 3 }), 0, 'not before her birth phase');
  assert.equal(layingChance(base), 0.35, 'sometimes early in it');
  assert.equal(layingChance({ ...base, daysPassed: 2 }), 1, 'always at term');
  assert.equal(layingChance({ ...base, phase: 2, pain: { type: 'WATER_BREAKING' } }), 1, 'always in labor');
  assert.equal(layingChance({ ...base, womb: [] }), 0, 'nothing left to lay');
  // two eggs fit in her Mating scene, after her partner has pulled back
  assert.equal(LAYING_SCENES['jhkobold:start_mating'].length, 2);
  assert.ok(LAYING_SCENES['jhkobold:start_mating'].every((slot) => slot.crown >= 479 && slot.crown < slot.out && slot.out < slot.hand && slot.hand < 607));
});

test('her Mating scene at term: her belly hardens, two eggs crown and are handed to her partner, the third comes with his help', () => {
  const partner = new Player('Mate');
  partner.location = { x: 300, y: 64, z: 300 };
  world.players.push(partner);
  const { kobold, record, p } = koboldAtTerm(3, { x: 301, y: 64, z: 300 });
  try {
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:start_mating' });
    assert.ok(layingOf(/** @type {any} */ (kobold)), 'a laying scene');
    assert.equal(p.pain?.type, 'PREBIRTH');
    assert.ok(partner.messages.some((m) => text(m).includes('minepreggo.egg.coming')));
    system.tick(20);
    assert.equal(kobold.getProperty('minepreggo:scene'), 'contraction');
    assert.equal(kobold.getProperty('minepreggo:pose'), 'prebirth');
    // the first egg on its way out: the birth pose with its progress
    system.tick(479 + 20 - 20);
    assert.equal(p.pain?.type, 'BIRTH');
    assert.equal(kobold.getProperty('minepreggo:pose'), 'birth');
    const growth = Number(kobold.getProperty('minepreggo:growth'));
    assert.ok(growth > 0 && growth < 1, `on its way out (${growth})`);
    system.tick(537 - 499 + 2);
    assert.deepEqual(partner.inventory.filter((id) => id === 'minepreggo:kobold_egg').length, 1, `the first egg (${partner.inventory})`);
    assert.ok(partner.messages.some((m) => text(m).includes('minepreggo.egg.caught')));
    system.tick(600 - 539);
    assert.equal(partner.inventory.filter((id) => id === 'minepreggo:kobold_egg').length, 2, 'the second egg');
    // the scene is over with an egg left: he helps her push it out
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:finish' });
    assert.ok(!layingOf(/** @type {any} */ (kobold)));
    assert.equal(record.laying, undefined);
    system.tick(12);
    assert.equal(bellySceneOf(/** @type {any} */ (kobold))?.kind, 'birth');
    for (let i = 0; i < 200 && record.data.pregnancy?.womb.length + (record.data.pregnancy?.birth ? 1 : 0); i++) {
      system.tick(5);
      onSceneButton(/** @type {any} */ (partner), InputButton.Sneak);
    }
    assert.equal(partner.inventory.filter((id) => id === 'minepreggo:kobold_egg').length, 3, 'all three eggs');
    assert.ok(!partner.inventory.includes('minepreggo:baby_kobold'), 'eggs, not babies');
  } finally {
    world.players.splice(world.players.indexOf(partner), 1);
    kobold.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: kobold.id });
  }
});

test('a laying scene too early in her pregnancy is a scene like any other, and her other scenes never lay', () => {
  const { kobold, record, p } = koboldAtTerm(1, { x: 320, y: 64, z: 320 });
  try {
    p.daysPassed = 0;
    const random = Math.random;
    Math.random = () => 0.9; // above the early chance
    try {
      emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:start_mating' });
    } finally {
      Math.random = random;
    }
    assert.ok(!layingOf(/** @type {any} */ (kobold)));
    assert.equal(p.pain, null);
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:finish' });
    p.daysPassed = p.daysByPhase[p.phase];
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:start_blowjob' });
    assert.ok(!layingOf(/** @type {any} */ (kobold)), 'only her Mating scene lays');
    emit(world.afterEvents.dataDrivenEntityTrigger, { entity: kobold, eventId: 'jhkobold:finish' });
    assert.ok(record.data.pregnancy);
  } finally {
    kobold.isValid = false;
    emit(world.afterEvents.entityRemove, { removedEntityId: kobold.id });
  }
});

/** A clutch block of the mock world. */
function clutch(/** @type {number} */ eggs, /** @type {number} */ cracks = 0) {
  const states = { 'minepreggo:eggs': eggs, 'minepreggo:cracks': cracks };
  const sounds = /** @type {string[]} */ ([]);
  const permutation = (/** @type {Record<string, number>} */ s) => ({ getState: (/** @type {string} */ k) => s[k], withState: (/** @type {string} */ k, /** @type {number} */ v) => permutation({ ...s, [k]: v }) });
  const block = {
    typeId: EGG,
    permutation: permutation(states),
    setPermutation(/** @type {any} */ p) { this.permutation = p; },
    setType(/** @type {string} */ t) { this.typeId = t; },
    center: () => ({ x: 400.5, y: 64.5, z: 400.5 }),
    dimension: { ...overworld, playSound: (/** @type {string} */ id) => void sounds.push(id), spawnParticle: () => {}, spawnItem: (/** @type {any} */ stack) => void overworld.spawned.push(stack.typeId), getPlayers: () => [], getEntities: (/** @type {any} */ o) => overworld.getEntities(o) },
  };
  return { block, sounds };
}

test('a clutch of kobold eggs cracks, hatches one baby at a time (an item, never a mob), and takes eggs up to four', () => {
  assert.ok(customComponents.blocks.has(EGG), 'registered at startup');
  const { block, sounds } = clutch(2);
  assert.equal(tickClutch(/** @type {any} */ (block), () => CRACK_CHANCE + 0.01), 'none');
  assert.equal(tickClutch(/** @type {any} */ (block), () => 0), 'cracked');
  assert.equal(tickClutch(/** @type {any} */ (block), () => 0), 'cracked');
  assert.equal(block.permutation.getState('minepreggo:cracks'), 2);
  const before = overworld.spawned.length;
  assert.equal(tickClutch(/** @type {any} */ (block), () => 0), 'hatched');
  assert.deepEqual(overworld.spawned.slice(before), [BABY], 'her baby, as an item');
  assert.equal(block.permutation.getState('minepreggo:eggs'), 1);
  assert.equal(block.permutation.getState('minepreggo:cracks'), 0);
  assert.ok(sounds.includes('block.turtle_egg.hatch'));
  // a kobold nearby broods it: a better chance
  const kobold = new Mob('jhkobold:kobold', { families: ['minepreggo_preggo_mob', 'kobold'] });
  kobold.location = { x: 401, y: 64, z: 401 };
  overworld.entities.push(kobold);
  assert.equal(tickClutch(/** @type {any} */ (block), () => (CRACK_CHANCE + BROODING_CHANCE) / 2), 'cracked');
  kobold.isValid = false;
  // the last egg hatching leaves nothing behind
  const last = clutch(1, 2).block;
  tickClutch(/** @type {any} */ (last), () => 0);
  assert.equal(last.typeId, 'minecraft:air');
  // an egg in hand joins a clutch
  const player = new Player('Egger');
  player.held = /** @type {any} */ ({ typeId: EGG, amount: 2 });
  const small = clutch(3).block;
  assert.ok(addEgg(/** @type {any} */ (small), /** @type {any} */ (player)));
  assert.equal(small.permutation.getState('minepreggo:eggs'), 4);
  assert.equal(/** @type {any} */ (player.held).amount, 1);
  assert.ok(!addEgg(/** @type {any} */ (small), /** @type {any} */ (player)), 'four at most');
});
