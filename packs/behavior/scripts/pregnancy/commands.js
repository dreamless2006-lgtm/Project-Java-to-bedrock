// Operator commands for testing, the Bedrock stand-in for Java's /pregnancy command
// (event/PregnancyCommand). They act on the player running them, e.g.
//   /scriptevent minepreggo:pregnancy start 3
//   /execute as @p run scriptevent minepreggo:pregnancy phase 4
//   /scriptevent minepreggo:gender female

import { system, Player } from '@minecraft/server';
import { MAX_LEVEL, POTION_SPECIES } from './data.js';
import { babiesFromPotion, clampBabies } from './math.js';
import {
  accelerate,
  accelerateGradually,
  baseDurationOf,
  canExperience,
  endPregnancy,
  getRecord,
  induceFetalMovement,
  setPhase,
  startCommonPain,
  startPregnancy,
  startSymptom,
  tryInitMiscarriage,
  tryToStartLabor,
} from './system.js';

const USAGE = [
  'minepreggo:pregnancy start [babies 1-10] | potion [level 0-5] [human|zombie|creeper|ender|slime|villager] | end | status',
  '  phase <0-9> | days <n> | labor | miscarry | accelerate <0-4> | gradual <0-4> | induce <0-4>',
  '  pain <morning_sickness|fetal_movement|contraction|back_pain>',
  '  symptom <craving|milking|belly_rubs>',
  'minepreggo:gender <female|male>',
  'minepreggo:skin <custom|alex|steve>',
].join('\n');

const PAINS = ['MORNING_SICKNESS', 'FETAL_MOVEMENT', 'CONTRACTION', 'BACK_PAIN'];
const SYMPTOMS = { CRAVING: 'craving', MILKING: 'milking', BELLY_RUBS: 'bellyRubs' };

/** @param {import('./state.js').PlayerRecord} record @returns {string} */
function status(record) {
  const p = record.pregnancy;
  const lines = [`gender: ${record.gender ?? 'not chosen'}`];
  if (p && p.father !== 'HUMAN') lines.push(`father species: ${p.father}`);
  if (record.pending) lines.push(`impregnation pending (potion level ${record.pending.amplifier})`);
  if (record.female.post) lines.push(`recovering after ${record.female.post.type.toLowerCase()}: ${record.female.post.timer} ticks`);
  if (record.female.lactation) lines.push(`post-partum lactation level ${record.female.lactation.level}/20`);
  if (!p) return [...lines, 'not pregnant'].join('\n');
  return [
    ...lines,
    `phase P${p.phase} (birth at P${p.lastPhase}), day ${p.daysPassed}/${p.daysByPhase[p.phase]} of this phase, timer ${p.timer}`,
    `days per phase: ${p.daysByPhase.join(', ')}`,
    `babies: ${p.womb.length}, pregnancy health: ${p.health}`,
    `craving ${p.craving} (${p.cravingType ?? '-'}), milking ${p.milking}, belly rubs ${p.bellyRubs}`,
    ...(p.acceleration ? [`gradual acceleration ${p.acceleration.amplifier + 1}x for ${p.acceleration.endTime} (absolute time)`] : []),
    `symptoms: ${JSON.stringify(p.symptoms)}, pain: ${p.pain ? `${p.pain.type} ${p.pain.elapsed}/${p.pain.duration} sev ${p.pain.severity}` : '-'}`,
  ].join('\n');
}

/**
 * @param {Player} player
 * @param {string} message
 * @returns {string}
 */
function run(player, message) {
  const record = getRecord(player);
  const [command = 'status', arg, arg2] = message.trim().toLowerCase().split(/\s+/);
  const p = record.pregnancy;
  const ok = (/** @type {boolean} */ done, /** @type {string} */ failure) => (done ? status(record) : failure);

  switch (command) {
    case 'start':
      return ok(startPregnancy(record, clampBabies(Number(arg ?? 1) || 1)), 'cannot start: needs a female player who is not pregnant or recovering');
    case 'potion': {
      const father = POTION_SPECIES.find((species) => species === (arg2 ?? 'human').toUpperCase()) ?? 'HUMAN';
      return ok(startPregnancy(record, babiesFromPotion(Number(arg ?? 0) || 0), father), 'cannot start: needs a female player who is not pregnant or recovering');
    }
    case 'end':
      record.female.post = null;
      return ok(endPregnancy(record), 'not pregnant');
    case 'status':
      return status(record);
  }
  if (!p) return 'not pregnant';

  switch (command) {
    case 'phase':
      return ok(setPhase(record, Number(arg)), `phase must be between 0 and ${p.lastPhase}`);
    case 'days': {
      const days = Math.max(0, Number(arg) || 1);
      p.daysPassed = Math.min(p.daysByPhase[p.phase], p.daysPassed + days);
      record.dirty = true;
      return status(record);
    }
    case 'labor':
      if (p.phase !== p.lastPhase) setPhase(record, p.lastPhase);
      return ok(tryToStartLabor(record, true), 'labor already started or another pain blocks it');
    case 'miscarry':
      return ok(tryInitMiscarriage(record), 'cannot miscarry now (P0, labor or already miscarrying)');
    case 'accelerate':
      return ok(accelerate(record, Math.min(4, Math.max(0, Number(arg) || 0))), 'not during labor or a miscarriage');
    case 'gradual':
      return ok(accelerateGradually(record, Math.min(4, Math.max(0, Number(arg) || 0))), 'not during labor or a miscarriage');
    case 'induce':
      return ok(induceFetalMovement(record, Math.min(4, Math.max(0, Number(arg) || 0))), 'fetal movement needs P3+ and no labor or miscarriage');
    case 'pain': {
      const pain = /** @type {import('./math.js').CommonPain} */ ((arg ?? '').toUpperCase());
      if (!PAINS.includes(pain)) return USAGE;
      if (!canExperience(p, pain)) return `${pain} is not possible in P${p.phase}`;
      return ok(startCommonPain(record, pain, 'NATURAL', baseDurationOf(p, pain)), 'another pain is active');
    }
    case 'symptom': {
      const symptom = /** @type {import('./math.js').Symptom} */ ((arg ?? '').toUpperCase());
      if (!(symptom in SYMPTOMS)) return USAGE;
      p[/** @type {'craving'|'milking'|'bellyRubs'} */ (SYMPTOMS[symptom])] = MAX_LEVEL;
      return ok(startSymptom(record, symptom), 'symptom already active');
    }
    default:
      return USAGE;
  }
}

export { run as runPregnancyCommand };

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (!(sourceEntity instanceof Player)) return;
  if (id === 'minepreggo:pregnancy') {
    sourceEntity.sendMessage(run(sourceEntity, message));
  } else if (id === 'minepreggo:gender') {
    const gender = message.trim().toLowerCase();
    if (gender !== 'female' && gender !== 'male') {
      sourceEntity.sendMessage(USAGE);
      return;
    }
    const record = getRecord(sourceEntity);
    if (gender === 'male' && record.pregnancy) endPregnancy(record);
    record.setGender(gender);
    sourceEntity.sendMessage(`gender: ${gender}`);
  } else if (id === 'minepreggo:skin') {
    const skin = message.trim().toLowerCase();
    if (skin !== 'custom' && skin !== 'alex' && skin !== 'steve') {
      sourceEntity.sendMessage(USAGE);
      return;
    }
    getRecord(sourceEntity).setSkin(skin);
    sourceEntity.sendMessage(`skin: ${skin}`);
  }
});
