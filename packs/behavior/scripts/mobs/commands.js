// Operator commands for testing preggo mobs. They act on the nearest preggo mob within 16 blocks
// of the player running them, e.g.
//   /scriptevent minepreggo:mob status
//   /scriptevent minepreggo:mob start 3
//   /scriptevent minepreggo:mob phase 4

import { system, Player } from '@minecraft/server';
import { MAX_LEVEL, PHASES } from '../pregnancy/data.js';
import { babiesFromPotion, clampBabies } from '../pregnancy/math.js';
import {
  FAMILY_TAG,
  accelerate,
  accelerateGradually,
  becomeSavage,
  endPregnancy,
  forceLabor,
  getRecord,
  isTamed,
  setPhase,
  startCommonPain,
  startMiscarriage,
  startPregnancy,
} from './system.js';

const USAGE = [
  'minepreggo:mob status | start [babies 1-10] | potion [level 0-5] | end',
  '  phase <0-9> | days <n> | labor | miscarry | feed | starve | accelerate <0-4> | gradual <0-4>',
  '  pain <morning_sickness|fetal_movement|contraction|back_pain>',
  '  symptom <craving|milking|belly_rubs>',
].join('\n');

const PAINS = { morning_sickness: 'MORNING_SICKNESS', fetal_movement: 'FETAL_MOVEMENT', contraction: 'CONTRACTION', back_pain: 'BACK_PAIN' };
const METERS = { craving: 'craving', milking: 'milking', belly_rubs: 'bellyRubs' };

/** @param {import('./state.js').MobRecord} record */
function status(record) {
  const { data, entity } = record;
  const p = data.pregnancy;
  const lines = [
    `${entity.typeId}${isTamed(entity) ? ' (tamed)' : ''}: fullness ${data.fullness}/30${data.savage ? ', savage' : ''}`,
  ];
  if (data.pending) lines.push(`impregnation pending (potion level ${data.pending.amplifier})`);
  if (data.wild) lines.push(`wild pregnant P${entity.getProperty('minepreggo:phase')}, ${data.wild.babies} babies, incapacitated: ${data.wild.incapacitated}`);
  if (data.post) lines.push(`recovering after ${data.post.type.toLowerCase()}: ${data.post.timer} ticks`);
  if (data.lactation) lines.push(`post-partum lactation level ${data.lactation.level}/20`);
  if (!p) return [...lines, data.wild ? '' : 'not pregnant'].filter(Boolean).join('\n');
  return [
    ...lines,
    `phase P${p.phase} (birth at P${p.lastPhase}), day ${p.daysPassed}/${p.daysByPhase[p.phase]}, timer ${p.timer}`,
    `babies: ${p.womb.length}, pregnancy health: ${p.health}`,
    `craving ${p.craving} (${p.cravingType ?? '-'}), milking ${p.milking}, belly rubs ${p.bellyRubs}`,
    `symptoms: ${JSON.stringify(p.symptoms)}, pain: ${p.pain ? `${p.pain.type} ${p.pain.elapsed}/${p.pain.duration}` : '-'}`,
  ].join('\n');
}

/** @param {Player} player @param {string} message @returns {string} */
function run(player, message) {
  const [target] = player.dimension.getEntities({ families: [FAMILY_TAG], location: player.location, maxDistance: 16, closest: 1 });
  if (!target) return 'No preggo mob within 16 blocks.';
  const record = getRecord(target);
  const { data } = record;
  const [command = 'status', arg] = message.trim().toLowerCase().split(/\s+/);
  const p = data.pregnancy;
  const n = Number(arg);

  switch (command) {
    case 'status':
      return status(record);
    case 'start':
      return startPregnancy(record, clampBabies(arg ? n : 1)) ? 'Pregnancy started.' : 'Cannot start: already pregnant, wild pregnant or recovering.';
    case 'potion':
      return startPregnancy(record, babiesFromPotion(arg ? n : 0)) ? 'Pregnancy started.' : 'Cannot start a pregnancy now.';
    case 'end':
      if (!p) return 'Not pregnant.';
      endPregnancy(record, null);
      return 'Pregnancy ended.';
    case 'feed':
      data.fullness = 30;
      record.save();
      return 'Fullness 30.';
    case 'starve':
      if (!isTamed(target)) return 'Only tamed mobs get hungry.';
      data.fullness = 0;
      becomeSavage(record);
      return 'She is savage now.';
  }
  if (!p) return 'Not pregnant.';
  switch (command) {
    case 'phase':
      return setPhase(record, n) ? `Phase P${n}.` : `Phase must be 0-${p.lastPhase}.`;
    case 'days':
      p.daysPassed = Math.max(0, Math.min(n || 0, p.daysByPhase[p.phase]));
      record.save();
      return `Day ${p.daysPassed} of P${p.phase}.`;
    case 'labor':
      return forceLabor(record) ? 'Water broke.' : 'Cannot start labor now.';
    case 'miscarry':
      return startMiscarriage(record) ? 'Miscarriage started.' : 'No miscarriage in P0 or during labor.';
    case 'accelerate':
      return accelerate(record, Math.min(4, Math.max(0, n || 0))) ? `Now P${p.phase}, day ${p.daysPassed}.` : 'Not during labor or a miscarriage.';
    case 'gradual':
      return accelerateGradually(record, Math.min(4, Math.max(0, n || 0))) ? 'Gradual acceleration for 3 minutes.' : 'Not during labor or a miscarriage.';
    case 'pain': {
      const pain = PAINS[/** @type {keyof typeof PAINS} */ (arg)];
      if (!pain) return USAGE;
      const config = PHASES[p.phase];
      /** @type {Record<string, number>} */
      const durations = { MORNING_SICKNESS: config.morningSicknessTicks, FETAL_MOVEMENT: config.fetalMovementTicks, CONTRACTION: config.contractionTicks, BACK_PAIN: config.backPainTicks };
      const base = durations[pain];
      return startCommonPain(record, /** @type {any} */ (pain), 'NATURAL', base) ? `${pain} started.` : 'Another pain is active.';
    }
    case 'symptom': {
      const meter = METERS[/** @type {keyof typeof METERS} */ (arg)];
      if (!meter) return USAGE;
      p[/** @type {'craving' | 'milking' | 'bellyRubs'} */ (meter)] = MAX_LEVEL;
      record.save();
      return `${arg} meter full; the symptom starts within a second.`;
    }
  }
  return USAGE;
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (id !== 'minepreggo:mob' || !(sourceEntity instanceof Player)) return;
  sourceEntity.sendMessage(run(sourceEntity, message));
});
