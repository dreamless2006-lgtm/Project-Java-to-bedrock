// Tests for the pregnancy port: the Java formulas, and whole pregnancies simulated tick by tick
// against tools/tests/mock-server.mjs. Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player, system } from './mock-server.mjs';
import { CRAVING_TICKS, MILKING_TICKS, PHASES } from '../../packs/behavior/scripts/pregnancy/data.js';
import {
  babiesFromPotion,
  createCommonPain,
  daysByPhase,
  finalPhaseForBabies,
  pregnancyDamage,
  randomCraving,
  symptomSeverity,
} from '../../packs/behavior/scripts/pregnancy/math.js';
import { PlayerRecord } from '../../packs/behavior/scripts/pregnancy/state.js';
import {
  getRecord,
  onPush,
  setPhase,
  startPregnancy,
  tickPlayer,
  tryInitMiscarriage,
} from '../../packs/behavior/scripts/pregnancy/system.js';

const fixed = (/** @type {number} */ value) => () => value;

test('days per phase follow PregnancyPhaseMap (including its rounding)', () => {
  assert.deepEqual(daysByPhase(50, 4), [3, 10, 10, 13, 15]);
  assert.deepEqual(daysByPhase(50, 9), [3, 3, 5, 5, 5, 5, 5, 5, 8, 8]);
  assert.deepEqual(daysByPhase(70, 6), [4, 7, 7, 7, 14, 14, 18]);
  assert.equal(daysByPhase(50, 2).length, 5, 'phases before P4 use the P4 table');
});

test('baby counts map to the phase of birth', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(finalPhaseForBabies), [4, 5, 5, 6, 6, 7, 7, 8, 8, 9]);
  assert.equal(babiesFromPotion(0, fixed(0.9)), 1);
  assert.equal(babiesFromPotion(1, fixed(0)), 2);
  assert.equal(babiesFromPotion(1, fixed(0.99)), 3);
  assert.equal(babiesFromPotion(5, fixed(0.5)), 10);
  assert.equal(babiesFromPotion(9, fixed(0.5)), 10);
});

test('craving weights and per-phase timers match the Java config', () => {
  assert.deepEqual([0, 0.1, 0.5, 0.9].map((r) => randomCraving(fixed(r))), ['SWEET', 'SOUR', 'SPICY', 'SALTY']);
  assert.deepEqual(CRAVING_TICKS, [undefined, 4800, 4320, 4080, 3840, 3600, 3360, 3120, 2880, 2640]);
  assert.equal(MILKING_TICKS[2], 3600);
  assert.equal(MILKING_TICKS[9], 1620);
});

test('pain severity and duration stay within the factory bounds', () => {
  for (let phase = 0; phase <= 9; phase++) {
    for (const pain of /** @type {const} */ (['MORNING_SICKNESS', 'FETAL_MOVEMENT', 'CONTRACTION', 'BACK_PAIN'])) {
      const base = 1200;
      for (const r of [0, 0.5, 1]) {
        const { duration, severity } = createCommonPain(pain, phase, 9, 'NATURAL', base, fixed(r));
        assert.ok(severity >= 0 && severity <= 4);
        assert.ok(duration >= 120 && duration <= 1680, `${pain} P${phase}: ${duration}`);
      }
    }
  }
  // Morning sickness is worst early on, contractions late.
  assert.ok(createCommonPain('MORNING_SICKNESS', 1, 9, 'NATURAL', 1200).severity > createCommonPain('MORNING_SICKNESS', 9, 9, 'NATURAL', 1200).severity);
  assert.ok(createCommonPain('CONTRACTION', 9, 9, 'NATURAL', 1200).severity > createCommonPain('CONTRACTION', 2, 9, 'NATURAL', 1200).severity);
  assert.ok(symptomSeverity('CRAVING', 9, 9) >= symptomSeverity('CRAVING', 1, 9));
});

test('pregnancy damage ignores P0 and healthy players unless it is an explosion', () => {
  const healthy = { explosion: false, healthBeforeHit: 20, maxHealth: 20 };
  assert.equal(pregnancyDamage(0, 4, { ...healthy, explosion: true }), 0);
  assert.equal(pregnancyDamage(3, 4, healthy), 0);
  assert.ok(pregnancyDamage(3, 4, { ...healthy, healthBeforeHit: 10 }, fixed(0)) >= 1);
  // Explosions add 10 raw damage before Java's 0.5x-2x phase scaling.
  const explosion = pregnancyDamage(3, 4, { ...healthy, explosion: true }, fixed(0));
  assert.ok(explosion >= Math.round(11 * 0.5) && explosion <= 11 * 2, String(explosion));
  assert.ok(explosion > pregnancyDamage(3, 4, { ...healthy, healthBeforeHit: 10 }, fixed(0)));
});

/** @returns {{ player: Player, record: PlayerRecord }} */
function femalePlayer(name = 'Alex') {
  const player = new Player(name);
  const record = getRecord(/** @type {any} */ (player));
  record.setGender('female');
  return { player, record };
}

/** Runs `n` game ticks for one player. */
function run(/** @type {Player} */ player, n) {
  for (let i = 0; i < n; i++) {
    system.currentTick++;
    tickPlayer(/** @type {any} */ (player));
  }
}

const translated = (/** @type {Player} */ player) =>
  player.messages.map((m) => /** @type {{ translate?: string }} */ (m).translate).filter(Boolean);

test('a single-baby pregnancy runs from P0 through labor and birth to recovery', () => {
  const { player, record } = femalePlayer('Mom');
  assert.ok(startPregnancy(record, 1));
  assert.equal(startPregnancy(record, 1), false, 'cannot get pregnant twice');
  const p = /** @type {import('../../packs/behavior/scripts/pregnancy/state.js').Pregnancy} */ (record.pregnancy);
  assert.equal(p.lastPhase, 4);

  // Skip through the phases by marking each one's days as passed.
  for (let phase = 0; phase < 4; phase++) {
    assert.equal(p.phase, phase);
    p.daysPassed = p.daysByPhase[phase];
    run(player, 1);
  }
  assert.equal(p.phase, 4);

  p.daysPassed = p.daysByPhase[4];
  run(player, 1);
  assert.equal(p.pain?.type, 'WATER_BREAKING');

  run(player, 1201);
  assert.equal(p.pain?.type, 'PREBIRTH');
  run(player, PHASES[4].preBirthTicks + 1);
  assert.equal(p.pain?.type, 'BIRTH');
  assert.equal(p.birth?.baby, 'HUMAN');
  assert.equal(p.womb.length, 0);

  // Four rounds of 28 quick presses push the baby out.
  for (let i = 0; i < 28 * 4; i++) {
    onPush(record);
    run(player, 1);
  }
  assert.ok(player.dropped.includes('minepreggo:baby_human'));
  run(player, 1);
  assert.equal(p.pain?.type, 'POSTBIRTH');
  run(player, 151);

  assert.equal(record.pregnancy, null);
  assert.equal(record.female.post?.type, 'PARTUM');
  assert.ok(record.female.lactation);
  assert.ok(translated(player).includes('chat.minepreggo.player.birth.message.post'));
  assert.equal(startPregnancy(record, 1), false, 'recovering mothers cannot get pregnant');
});

test('pausing while pushing loses progress', () => {
  const { player, record } = femalePlayer('Slow');
  startPregnancy(record, 1);
  const p = /** @type {any} */ (record.pregnancy);
  setPhase(record, 4);
  p.daysPassed = p.daysByPhase[4];
  run(player, 1 + 1201 + PHASES[4].preBirthTicks + 1);
  assert.equal(p.pain.type, 'BIRTH');
  for (let i = 0; i < 28; i++) {
    onPush(record);
    run(player, 1);
  }
  assert.equal(p.birth.pushLevel, 1);
  for (let i = 0; i < 10; i++) {
    onPush(record);
    run(player, 1);
  }
  run(player, 100); // idle for five seconds
  assert.equal(p.birth.pushLevel, 0);
});

test('losing all pregnancy health leads to a miscarriage', () => {
  const { player, record } = femalePlayer('Unlucky');
  startPregnancy(record, 3);
  setPhase(record, 0);
  assert.equal(tryInitMiscarriage(record), false, 'Java has no miscarriage in P0');
  setPhase(record, 2);
  assert.ok(tryInitMiscarriage(record));
  run(player, 801);
  assert.equal(record.pregnancy, null);
  assert.equal(record.female.post?.type, 'MISCARRIAGE');
  assert.deepEqual(player.inventory, ['minepreggo:dead_human_fetus', 'minepreggo:dead_human_fetus', 'minepreggo:dead_human_fetus']);
});

test('cravings start once the meter is full and pick a craving type', () => {
  const { player, record } = femalePlayer('Hungry');
  startPregnancy(record, 1);
  const p = /** @type {any} */ (record.pregnancy);
  setPhase(record, 1);
  p.craving = 20;
  run(player, 22);
  assert.ok(p.symptoms.CRAVING !== undefined);
  assert.ok(['SWEET', 'SOUR', 'SPICY', 'SALTY'].includes(p.cravingType));
});

test('state survives a reload from dynamic properties', () => {
  const { player, record } = femalePlayer('Saved');
  startPregnancy(record, 2);
  setPhase(record, 3);
  record.save();
  const reloaded = new PlayerRecord(/** @type {any} */ (player));
  assert.equal(reloaded.gender, 'female');
  assert.equal(reloaded.pregnancy?.phase, 3);
  assert.equal(reloaded.pregnancy?.womb.length, 2);
});

test('male players and players without a gender cannot get pregnant', () => {
  const male = getRecord(/** @type {any} */ (new Player('Steve')));
  male.setGender('male');
  assert.equal(startPregnancy(male, 1), false);
  const unset = getRecord(/** @type {any} */ (new Player('Unset')));
  assert.equal(startPregnancy(unset, 1), false);
});

test('a miscarriage in the last phase is not replaced by labor', () => {
  const { player, record } = femalePlayer('LastPhase');
  startPregnancy(record, 1);
  const p = /** @type {any} */ (record.pregnancy);
  setPhase(record, 4);
  p.daysPassed = p.daysByPhase[4];
  assert.ok(tryInitMiscarriage(record));
  run(player, 5);
  assert.equal(p.pain.type, 'MISCARRIAGE');
});
