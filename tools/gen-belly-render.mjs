// Rebuilds how the females and the player show their belly, around the one path that is proven in
// game: an enum entity property written by the scripts (like the pose), compared as a string in
// Molang, driving plain render-controller conditions (one controller per belly size, each a plain
// geometry + texture of the mod's own per-phase model) and a state-machine animation controller
// (like the pain controller) for the belly animations. Run: node tools/gen-belly-render.mjs
// The Jenny Mod Java Port's girls get the same treatment from tools/import-jenny.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeEntityJson } from './lib/entity-json.mjs';
import { BELLY_ANIMATIONS, BELLY_PROPERTY, MINEPREGGO_PROPERTIES, MOD, PHASES, POSES, bellyController, bellyIndex, contractionWaveAnimation, NO_POSE, initializers, kickPulseAnimations, kickRoomLines, kickStateLines, playerKickStateLines } from './lib/belly-render.mjs';
import { BABY_PROPERTY, FAMILY_CROWNING, PLAYER_BABIES, crowningAnimations, crowningLines } from './lib/crowning.mjs';
import { mobBirthAnimations, mobBirthPainStates, mobBirthEntity } from './lib/mob-births.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const BP = join(ROOT, 'packs/behavior');

/** Family -> base texture (the mod's per-phase textures are <texture>_pN). */
const FAMILIES = {
  zombie_girl: 'mobs/zombie/zombie_girl',
  humanoid_creeper_girl: 'mobs/creeper/humanoid/humanoid_creeper_girl',
  monster_creeper_girl: 'mobs/creeper/monster/monster_creeper_girl',
  ender_woman: 'mobs/ender/ender_woman',
  humanoid_slime_girl: 'mobs/slime/humanoid/humanoid_slime_girl',
  monster_slime_girl: 'mobs/slime/monster/monster_slime_girl',
};
/** The crowning's pre_animation lines (replaced on every run). */
const CROWNING_LINE = /^(v|variable)\.(crown_scale|strain|crowning|crown_x|crown_t|crown|mp_baby) =/;
/** Entity animate entries the belly controller takes over. */
const BELLY_ANIMATE = /^(belly_low|belly_medium|belly_high|belly_growth|fetal_p\d_i+|belly_hidden|fetal_push|birth_push|navel_prebirth|navel_birth)$/;

const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (/** @type {string} */ file, /** @type {unknown} */ doc) => writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
/** One of our families' per-size models (the mod's own, from npm run import). */
const readModel = (/** @type {string} */ family, /** @type {number} */ p) => read(join(RP, 'models/entity', MOD, `${family}_p${p}.geo.json`))['minecraft:geometry'][0];

/** Fields the game (1.26.30) rejects in a behavior entity: the zombie's alert_same_type, the old leash distances. */
function rejectedFields(/** @type {any} */ entity) {
  for (const c of [entity.components ?? {}, ...Object.values(entity.component_groups ?? {})]) {
    if (c['minecraft:behavior.hurt_by_target']) delete c['minecraft:behavior.hurt_by_target'].alert_same_type;
    if (c['minecraft:leashable']) for (const key of ['soft_distance', 'hard_distance', 'max_distance']) delete c['minecraft:leashable'][key];
  }
}

// ---- the belly animation controller: one state per belly size, like the pain controller --------
write(join(RP, 'animation_controllers/belly.animation_controllers.json'), {
  format_version: '1.10.0',
  animation_controllers: {
    [`controller.animation.${MOD}.belly`]: bellyController(false),
    [`controller.animation.${MOD}.belly_navel`]: bellyController(true),
  },
});

// ---- the kick pulses and the contraction wave every female and the player share ---------------------
{
  const file = join(RP, 'animations/preggo_mob.animation.json');
  const doc = read(file);
  Object.assign(doc.animations, kickPulseAnimations(), contractionWaveAnimation(), NO_POSE, crowningAnimations());
  write(file, doc);
}

// ---- the scene poses in the pain controller: on all fours for the bed, sitting for a belly scene ----
{
  const file = join(RP, 'animation_controllers/preggo_mob.animation_controllers.json');
  const doc = read(file);
  const pain = doc.animation_controllers[`controller.animation.${MOD}.preggo_mob.pain`];
  for (const pose of ['scene', 'scene_sit']) {
    // the pose solved for the model of her belly size (each rests its arms and head a little differently)
    const animations = [{ [`${pose}_pose`]: 'v.bp < 0' }, ...PHASES.map((p) => ({ [`${pose}_pose_p${p}`]: `v.bp == ${p}` }))];
    pain.states[pose] = { animations, transitions: [{ default: `!(v.pose == '${pose}')` }], blend_transition: 0.4 };
    const into = pain.states.default.transitions;
    if (!into.some((/** @type {Record<string, string>} */ t) => pose in t)) into.push({ [pose]: `v.pose == '${pose}'` });
  }
  // her birth pose for her belly size, with the crowning and flair in step (all start with the state)
  mobBirthPainStates(pain);
  write(file, doc);
}
// each family's crowning in step with her own pushes, and her flair (tools/lib/mob-births.mjs)
write(join(RP, 'animations/births.animation.json'), { format_version: '1.8.0', animations: mobBirthAnimations({ models: readModel }) });

// ---- each family ---------------------------------------------------------------------------------
for (const [family, texture] of Object.entries(FAMILIES)) {
  const entityFile = join(RP, 'entity', `${family}.entity.json`);
  const entityDoc = read(entityFile);
  const d = entityDoc['minecraft:client_entity'].description;
  for (const p of PHASES) {
    if (!existsSync(join(RP, 'models/entity', MOD, `${family}_p${p}.geo.json`))) throw new Error(`${family}: no P${p} model (run npm run import)`);
    if (!existsSync(join(RP, 'textures', MOD, `${texture}_p${p}.png`))) throw new Error(`${family}: no P${p} texture`);
  }
  // Geometry and textures: the mod's own, per belly size.
  d.geometry = { default: `geometry.${MOD}.${family}`, ...Object.fromEntries(PHASES.map((p) => [`p${p}`, `geometry.${MOD}.${family}_p${p}`])) };
  const textures = { default: `textures/${MOD}/${texture}`, ...Object.fromEntries(PHASES.map((p) => [`p${p}`, `textures/${MOD}/${texture}_p${p}`])) };
  for (const [key, value] of Object.entries(d.textures)) if (!/^(default|p\d)$/.test(key)) textures[key] = value;
  d.textures = textures;

  // Render controllers: one plain controller per belly size, chosen by the entity's conditions.
  const rcFile = join(RP, 'render_controllers', `${family}.render_controllers.json`);
  const rcDoc = existsSync(rcFile) ? read(rcFile) : { format_version: '1.10.0', render_controllers: {} };
  const main = `controller.render.${MOD}.${family}`;
  const base = rcDoc.render_controllers[main] ?? { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] };
  const charged = rcDoc.render_controllers[`${main}_charged`];
  const eyes = rcDoc.render_controllers[`${main}_eyes`];
  /** @type {Record<string, unknown>} */
  const controllers = {};
  const variant = (/** @type {Record<string, unknown>} */ template, /** @type {string} */ geometry, /** @type {string | undefined} */ textureKey) => {
    const { part_visibility, arrays, ...rest } = template;
    return { ...rest, geometry: `Geometry.${geometry}`, ...(textureKey ? { textures: [`Texture.${textureKey}`] } : {}) };
  };
  controllers[main] = variant(base, 'default', 'default');
  for (const p of PHASES) controllers[`${main}_p${p}`] = variant(base, `p${p}`, `p${p}`);
  if (charged) {
    controllers[`${main}_charged`] = variant(charged, 'default', undefined);
    for (const p of PHASES) controllers[`${main}_charged_p${p}`] = variant(charged, `p${p}`, undefined);
  }
  if (eyes) controllers[`${main}_eyes`] = eyes;
  // The crowning (tools/lib/crowning.mjs): the baby's head at her opening during the birth, its own
  // geometry under a copy of her bones; a navel birth has one per belly size.
  const crown = FAMILY_CROWNING[/** @type {keyof typeof FAMILY_CROWNING} */ (family)];
  const crownNavel = crown.opening === 'navel';
  const crownPhases = crownNavel ? PHASES.filter((p) => p >= 4) : [];
  for (const key of Object.keys(d.geometry)) if (/^crowning/.test(key)) delete d.geometry[key];
  if (crownNavel) for (const p of crownPhases) d.geometry[`crowning_p${p}`] = `geometry.${MOD}.${family}_crowning_p${p}`;
  else d.geometry.crowning = `geometry.${MOD}.${family}_crowning`;
  d.textures.fetus = `textures/${MOD}/entity/fetus/${crown.texture}`;
  d.materials = { ...d.materials, crowning: crown.blend ? 'entity_alphablend' : 'entity_alphatest' };
  const crowning = (/** @type {string} */ geometry) => ({ geometry: `Geometry.${geometry}`, materials: [{ '*': 'Material.crowning' }], textures: ['Texture.fetus'] });
  if (crownNavel) for (const p of crownPhases) controllers[`${main}_crowning_p${p}`] = crowning(`crowning_p${p}`);
  else controllers[`${main}_crowning`] = crowning('crowning');
  write(rcFile, { format_version: '1.10.0', render_controllers: controllers });
  d.render_controllers = [
    { [main]: 'v.bp < 0' },
    ...PHASES.map((p) => ({ [`${main}_p${p}`]: `v.bp == ${p}` })),
    ...(charged ? [{ [`${main}_charged`]: 'q.is_powered && v.bp < 0' }, ...PHASES.map((p) => ({ [`${main}_charged_p${p}`]: `q.is_powered && v.bp == ${p}` }))] : []),
    ...(eyes ? [`${main}_eyes`] : []),
    ...(crownNavel ? crownPhases.map((p) => ({ [`${main}_crowning_p${p}`]: `v.crowning && v.bp == ${p}` })) : [{ [`${main}_crowning`]: 'v.crowning' }]),
  ];

  // pre_animation: the belly size from the enum property, else the phase, the variant, or a pregnancy pose.
  const pre = d.scripts.pre_animation.filter((/** @type {string} */ line) => !line.startsWith('v.bp =') && !line.startsWith('v.phase = v.phase >= 0 ?') && !line.startsWith('v.phase = v.bp') && !line.startsWith('v.kr_f =') && !line.startsWith('v.k_') && !/^v\.(kicking|kick_shown|scene|contracting|kick_w|cw) =/.test(line) && !line.startsWith("v.kick = v.pose == 'incapacitated'") && !line.startsWith("v.kick = (v.pose == 'incapacitated'"));
  // The kick and contraction state with eased weights, right after the kick strength is read.
  const kickAt = pre.findIndex((/** @type {string} */ line) => line.startsWith("v.kick = q.property('minepreggo:kick')"));
  if (kickAt < 0) throw new Error(`${family}: no kick line`);
  pre.splice(kickAt + 1, 0, ...kickStateLines());
  const at = pre.findIndex((/** @type {string} */ line) => line.startsWith('v.pregnant_pose ='));
  if (at < 0) throw new Error(`${family}: no v.pregnant_pose line`);
  for (let i = pre.length - 1; i >= 0; i--) if (CROWNING_LINE.test(pre[i])) pre.splice(i, 1);
  const pushAt = pre.findIndex((/** @type {string} */ line) => line.startsWith('v.push ='));
  if (pushAt < 0) throw new Error(`${family}: no v.push line`);
  pre.splice(pushAt + 1, 0, ...crowningLines({ when: "v.pose == 'birth'" }));
  pre.splice(pre.findIndex((/** @type {string} */ line) => line.startsWith('v.pregnant_pose =')) + 1, 0,
    `v.bp = ${bellyIndex("q.property('minepreggo:belly')")};`,
    'v.bp = v.bp >= 0 ? v.bp : (v.phase >= 0 ? v.phase : (q.variant > 0 ? q.variant - 1 : (v.pregnant_pose ? 5 : -1)));',
    'v.phase = v.bp;',
    ...kickRoomLines('v.bp', (p) => read(join(RP, 'models/entity', MOD, `${family}_p${p}.geo.json`))['minecraft:geometry'][0]));
  d.scripts.pre_animation = pre;
  // her own birth: pose keys, crowning, flair, flash and navel lines, the belly shrinking, her effects
  mobBirthEntity(/** @type {any} */ (family), d, { models: (p) => readModel(family, p) });

  // The belly animations move into the controller.
  const navel = 'navel_birth' in d.animations;
  if (navel) {
    // Where the mod's own birth animation already moves her kick cubes, the crowning only grows in place.
    const birthFile = join(RP, 'animations', MOD, `${family}.animation.json`);
    const birth = existsSync(birthFile) ? read(birthFile).animations?.[d.animations.birth] : undefined;
    d.animations.navel_birth = `animation.${MOD}.navel_birth${birth?.bones?.front_kick ? '_light' : ''}`;
  }
  d.animations.belly_controller = `controller.animation.${MOD}.${navel ? 'belly_navel' : 'belly'}`;
  for (const [name, id] of Object.entries(BELLY_ANIMATIONS)) d.animations[name] ??= id;
  // Her scene poses (tools/gen-scene-poses.mjs solves them onto her rig); a monster body (four
  // legs, a jelly) keeps her own stance in a scene.
  const monster = family.startsWith('monster_');
  for (const pose of ['scene', 'scene_sit']) {
    for (const suffix of ['', ...PHASES.map((p) => `_p${p}`)]) d.animations[`${pose}_pose${suffix}`] = monster ? `animation.${MOD}.no_pose` : `animation.${MOD}.${family}.${pose}${suffix}`;
  }
  const animate = d.scripts.animate.filter((/** @type {string | Record<string, string>} */ a) => !(typeof a === 'object' && BELLY_ANIMATE.test(Object.keys(a)[0])) && a !== 'belly_controller');
  const pain = animate.indexOf('pain_controller');
  animate.splice(pain < 0 ? animate.length : pain + 1, 0, 'belly_controller');
  d.scripts.animate = animate;
  for (const name of ['belly_low', 'belly_medium', 'belly_high', 'belly_growth', 'fetal_push', 'birth_push', 'belly_hidden', 'kick_i', 'kick_ii', 'kick_iii', 'contraction_wave', ...PHASES.filter((p) => p >= 3).flatMap((p) => [`fetal_p${p}_i`, `fetal_p${p}_ii`, `fetal_p${p}_iii`])]) {
    if (!d.animations[name]) throw new Error(`${family}: the belly controller needs animation "${name}"`);
  }
  // Every Molang variable the pre_animation keeps between frames starts at 0, or the game logs
  // "unhandled request for unknown variable" every frame until it is first assigned.
  d.scripts.initialize = initializers(d.scripts.pre_animation, d.scripts.initialize ?? []);
  write(entityFile, entityDoc);

  // Behavior: the belly enum property, set by the same events that set the phase.
  const bpFile = join(BP, 'entities', `${family}.json`);
  const bpDoc = read(bpFile);
  const e = bpDoc['minecraft:entity'];
  rejectedFields(e);
  e.description.properties['minepreggo:belly'] = BELLY_PROPERTY;
  e.description.properties['minepreggo:pose'] = { ...e.description.properties['minepreggo:pose'], values: POSES };
  e.description.properties['minepreggo:scene'] = MINEPREGGO_PROPERTIES['minepreggo:scene'];
  for (const [name, event] of Object.entries(e.events)) {
    // An event is a flat step or a sequence of steps; the properties go on the step that sets the phase (else the first).
    const steps = Array.isArray(event.sequence) ? event.sequence : [event];
    const phase = name.match(/^minepreggo:set_phase_(\d)$/);
    const step = steps.find((s) => s.set_property && 'minepreggo:phase' in s.set_property) ?? (phase || name === 'minepreggo:set_not_pregnant' ? steps[0] : undefined);
    if (!step) continue;
    step.set_property = { ...(step.set_property ?? {}), 'minepreggo:phase': phase ? Number(phase[1]) : (step.set_property?.['minepreggo:phase'] ?? -1) };
    step.set_property['minepreggo:belly'] = step.set_property['minepreggo:phase'] === -1 ? 'none' : `p${step.set_property['minepreggo:phase']}`;
  }
  writeEntityJson(bpFile, bpDoc);
  console.log(`${family}: ${Object.keys(controllers).length} render controllers, belly ${navel ? 'navel ' : ''}controller`);
}

// ---- the player: the same selection on her own per-phase bodies ------------------------------------
{
  const file = join(RP, 'entity/player.entity.json');
  const doc = read(file);
  const d = doc['minecraft:client_entity'].description;
  for (const key of Object.keys(d.geometry)) if (/^minepreggo_(belly_(custom|predefined)|body_(custom|predefined)_p\d)$/.test(key)) delete d.geometry[key];
  for (const p of PHASES) {
    d.geometry[`minepreggo_body_custom_p${p}`] = `geometry.${MOD}.player_body_custom_p${p}`;
    d.geometry[`minepreggo_body_predefined_p${p}`] = `geometry.${MOD}.player_body_predefined_p${p}`;
    if (!existsSync(join(RP, 'models/entity', MOD, `player_body_custom_p${p}.geo.json`))) throw new Error(`player: no custom P${p} body`);
    if (!existsSync(join(RP, 'textures', MOD, `entity/player/predefined/alex/alex_p${p}_extra.png`))) throw new Error(`player: no alex P${p} extra texture`);
    d.textures[`minepreggo_alex_p${p}_extra`] = `textures/${MOD}/entity/player/predefined/alex/alex_p${p}_extra`;
  }
  delete d.textures.minepreggo_alex_extra_all;
  // The port's kicks: the kick cubes pulse to just beyond the skin while she is kicking, by strength,
  // faded in and out by the eased variable.kick_w like the mod's keyframed kicks and the push.
  /** @param {string} name @param {string} weight */
  const setEntry = (name, weight) => {
    const at = d.scripts.animate.findIndex((/** @type {string | Record<string, string>} */ a) => typeof a === 'object' && name in a);
    if (at >= 0) d.scripts.animate[at] = { [name]: weight };
    else d.scripts.animate.push({ [name]: weight });
  };
  for (const p of PHASES.filter((n) => n >= 3)) for (const [n, strength] of [['i', 0], ['ii', 1], ['iii', 2]]) {
    if (d.animations[`minepreggo_fetal_p${p}_${n}`]) setEntry(`minepreggo_fetal_p${p}_${n}`, `variable.kick_w * (variable.mp_phase == ${p} && variable.kick_shown == ${strength})`);
  }
  if (d.animations.minepreggo_fetal_push) setEntry('minepreggo_fetal_push', 'variable.kick_w * variable.mp_pregnant');
  d.animations.minepreggo_contraction_wave = `animation.${MOD}.contraction_wave`;
  setEntry('minepreggo_contraction_wave', 'variable.mp_pregnant');
  for (const [n, strength] of [['i', 0], ['ii', 1], ['iii', 2]]) {
    d.animations[`minepreggo_kick_${n}`] = `animation.${MOD}.kick_${n}`;
    const entry = { [`minepreggo_kick_${n}`]: `variable.kick_w * (variable.mp_pregnant && variable.mp_phase >= 3 && variable.kick_shown == ${strength})` };
    const at = d.scripts.animate.findIndex((/** @type {string | Record<string, string>} */ a) => typeof a === 'object' && `minepreggo_kick_${n}` in a);
    if (at >= 0) d.scripts.animate[at] = entry;
    else d.scripts.animate.push(entry);
  }
  const belly = '((!variable.is_first_person && !variable.map_face_icon && !query.is_spectator) || (variable.is_first_person && !query.is_spectator && variable.player_x_rotation > 15.0)) && variable.mp_pregnant';
  d.render_controllers = d.render_controllers.filter((/** @type {string | Record<string, string>} */ rc) => typeof rc === 'string' || !/player_belly_(custom|predefined)/.test(Object.keys(rc)[0]));
  for (const p of PHASES) {
    d.render_controllers.push({ [`controller.render.${MOD}.player_belly_custom_p${p}`]: `${belly} && !variable.mp_predefined && variable.mp_bp == ${p}` });
    d.render_controllers.push({ [`controller.render.${MOD}.player_belly_predefined_p${p}`]: `${belly} && variable.mp_predefined && variable.mp_bp == ${p}` });
  }
  const pre = d.scripts.pre_animation.filter((/** @type {string} */ line) => !line.startsWith('variable.mp_bp =') && !line.startsWith('variable.mp_phase = variable.mp_phase >= 0 ?') && !line.startsWith('variable.mp_phase = variable.mp_bp') && !line.startsWith('variable.kr_f =') && !line.startsWith('v.k_') && !line.startsWith('v.kr_f') && !/^variable\.(kicking|kick_shown|contracting|kick_w|cw) =/.test(line));
  const kickingAt = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_labor ='));
  if (kickingAt < 0) throw new Error('player: no mp_labor line');
  pre.splice(kickingAt + 1, 0, ...playerKickStateLines());
  const at = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_pose ='));
  if (at < 0) throw new Error('player: no mp_pose line');
  pre.splice(at + 1, 0,
    `variable.mp_bp = ${bellyIndex("query.property('minepreggo:belly')")};`,
    "variable.mp_bp = variable.mp_bp >= 0 ? variable.mp_bp : (variable.mp_phase >= 0 ? variable.mp_phase : ((variable.mp_pose == 'none' || variable.mp_pose == 'postbirth' || variable.mp_pose == 'miscarriage') ? -1 : 5));",
    'variable.mp_phase = variable.mp_bp;');
  // The crowning: her baby's head at the opening during the birth (navel births at the belly of her
  // size), in the model and texture of the baby's species.
  for (let i = pre.length - 1; i >= 0; i--) if (CROWNING_LINE.test(pre[i])) pre.splice(i, 1);
  const laborAt = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_labor ='));
  if (laborAt < 0 || !pre.some((/** @type {string} */ line) => line.startsWith('v.push ='))) throw new Error('player: no mp_labor or v.push line');
  const babyIndex = PLAYER_BABIES.reduceRight((rest, [species], i) => `q.property('${MOD}:baby') == '${species}' ? ${i + 1} : (${rest})`, '0');
  pre.splice(laborAt + 1, 0, `variable.mp_baby = ${babyIndex};`, ...crowningLines({ when: "variable.mp_labor && variable.mp_pose == 'birth' && variable.mp_baby > 0", strain: true }));
  const bodyOf = (/** @type {string} */ kind) => (/** @type {number} */ p) => read(join(RP, 'models/entity', MOD, `player_body_${kind}_p${p}.geo.json`))['minecraft:geometry'][0];
  const predefinedAt = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_predefined ='));
  if (predefinedAt < 0) throw new Error('player: no mp_predefined line');
  pre.splice(predefinedAt + 1, 0, ...kickRoomLines('variable.mp_bp', bodyOf('custom'), bodyOf('predefined'), 'variable.mp_predefined'));
  d.scripts.pre_animation = pre;
  for (const key of Object.keys(d.geometry)) if (/^minepreggo_crowning/.test(key)) delete d.geometry[key];
  for (const key of Object.keys(d.textures)) if (/^minepreggo_fetus_/.test(key)) delete d.textures[key];
  const crownKinds = [...new Set(PLAYER_BABIES.map(([, model]) => model))];
  for (const kind of crownKinds) d.geometry[`minepreggo_crowning_${kind}`] = `geometry.${MOD}.player_crowning_${kind}`;
  for (const p of PHASES.filter((n) => n >= 4)) d.geometry[`minepreggo_crowning_navel_p${p}`] = `geometry.${MOD}.player_crowning_navel_p${p}`;
  for (const [species, , texture] of PLAYER_BABIES) d.textures[`minepreggo_fetus_${species}`] = `textures/${MOD}/entity/fetus/${texture}`;
  d.materials = { ...d.materials, minepreggo_crowning: 'entity_alphatest', minepreggo_crowning_blend: 'entity_alphablend' };
  d.animations.minepreggo_crowning = `animation.${MOD}.crowning`;
  d.animations.minepreggo_crowning_navel = `animation.${MOD}.crowning_free`;
  d.scripts.animate = d.scripts.animate.filter((/** @type {string | Record<string, string>} */ a) => !(typeof a === 'object' && /^minepreggo_crowning/.test(Object.keys(a)[0])));
  // started with her birth pose (the same condition), so the baby draws back in when her legs close
  const birthAt = d.scripts.animate.findIndex((/** @type {string | Record<string, string>} */ a) => typeof a === 'object' && 'minepreggo_labor_birth' in a);
  if (birthAt < 0) throw new Error('player: no minepreggo_labor_birth entry');
  const birthWhen = /** @type {Record<string, string>} */ (d.scripts.animate[birthAt]).minepreggo_labor_birth;
  d.scripts.animate.splice(birthAt + 1, 0, { minepreggo_crowning: `${birthWhen} && !variable.mp_navel` }, { minepreggo_crowning_navel: `${birthWhen} && variable.mp_navel` });
  const seen = '!variable.is_first_person && !variable.map_face_icon && !query.is_spectator && variable.crowning';
  const humanoid = PLAYER_BABIES.map(([, model], i) => (model === 'humanoid' ? i + 1 : 0)).filter(Boolean);
  const isHumanoid = `variable.mp_baby >= ${Math.min(...humanoid)} && variable.mp_baby <= ${Math.max(...humanoid)}`;
  d.render_controllers = d.render_controllers.filter((/** @type {string | Record<string, string>} */ rc) => typeof rc === 'string' || !/player_crowning/.test(Object.keys(rc)[0]));
  for (const kind of crownKinds) {
    const which = kind === 'humanoid' ? isHumanoid : PLAYER_BABIES.map(([, model], i) => (model === kind ? `variable.mp_baby == ${i + 1}` : '')).filter(Boolean).join(' || ');
    d.render_controllers.push({ [`controller.render.${MOD}.player_crowning_${kind}`]: `${seen} && !variable.mp_navel && (${which})` });
  }
  for (const p of PHASES.filter((n) => n >= 4)) d.render_controllers.push({ [`controller.render.${MOD}.player_crowning_navel_p${p}`]: `${seen} && variable.mp_navel && variable.mp_bp == ${p} && ${isHumanoid}` });
  // Attachables can tell this player model from another pack's (Actions & Stuff): the off-hand belly
  // of player/compat.js hides itself where this model draws her belly already.
  // (public variables are declared under scripts; the game refuses a description.variables)
  delete d.variables;
  d.scripts.variables = { ...(d.scripts.variables ?? {}), 'variable.mp_native': 'public' };
  // (each run used to add one more copy of the spear line; one is enough)
  d.scripts.initialize = [...new Set(initializers(pre, [...(d.scripts.initialize ?? []).filter((/** @type {string} */ l) => !l.startsWith('variable.mp_native =')), 'variable.melee_spear_equipped = 0.0;'])), 'variable.mp_native = 1.0;'];
  write(file, doc);

  const rcFile = join(RP, 'render_controllers/player.render_controllers.json');
  const rcDoc = read(rcFile);
  for (const key of Object.keys(rcDoc.render_controllers)) if (/player_belly_(custom|predefined)(_p\d)?$/.test(key)) delete rcDoc.render_controllers[key];
  for (const p of PHASES) {
    rcDoc.render_controllers[`controller.render.${MOD}.player_belly_custom_p${p}`] = { geometry: `Geometry.minepreggo_body_custom_p${p}`, materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] };
    rcDoc.render_controllers[`controller.render.${MOD}.player_belly_predefined_p${p}`] = { geometry: `Geometry.minepreggo_body_predefined_p${p}`, materials: [{ '*': 'Material.default' }], textures: [`Texture.minepreggo_alex_p${p}_extra`] };
  }
  for (const key of Object.keys(rcDoc.render_controllers)) if (/player_crowning/.test(key)) delete rcDoc.render_controllers[key];
  /** The fetus texture of the baby's species (humanoid models: human, zombie, creeper and ender babies). */
  const humanoidTextures = PLAYER_BABIES.filter(([, model]) => model === 'humanoid').map(([species]) => `Texture.minepreggo_fetus_${species}`);
  const firstHumanoid = PLAYER_BABIES.findIndex(([, model]) => model === 'humanoid') + 1;
  for (const kind of [...new Set(PLAYER_BABIES.map(([, model]) => model))]) {
    const own = PLAYER_BABIES.find(([, model]) => model === kind);
    rcDoc.render_controllers[`controller.render.${MOD}.player_crowning_${kind}`] = kind === 'humanoid'
      ? { arrays: { textures: { 'Array.fetus': humanoidTextures } }, geometry: `Geometry.minepreggo_crowning_${kind}`, materials: [{ '*': 'Material.minepreggo_crowning' }], textures: [`Array.fetus[variable.mp_baby - ${firstHumanoid}]`] }
      : { geometry: `Geometry.minepreggo_crowning_${kind}`, materials: [{ '*': kind.includes('slime') ? 'Material.minepreggo_crowning_blend' : 'Material.minepreggo_crowning' }], textures: [`Texture.minepreggo_fetus_${own?.[0]}`] };
  }
  for (const p of PHASES.filter((n) => n >= 4)) {
    rcDoc.render_controllers[`controller.render.${MOD}.player_crowning_navel_p${p}`] = { arrays: { textures: { 'Array.fetus': humanoidTextures } }, geometry: `Geometry.minepreggo_crowning_navel_p${p}`, materials: [{ '*': 'Material.minepreggo_crowning' }], textures: [`Array.fetus[variable.mp_baby - ${firstHumanoid}]`] };
  }
  write(rcFile, rcDoc);

  const bpFile = join(BP, 'entities/player.json');
  const bpDoc = read(bpFile);
  bpDoc['minecraft:entity'].description.properties['minepreggo:belly'] = BELLY_PROPERTY;
  bpDoc['minecraft:entity'].description.properties['minepreggo:baby'] = BABY_PROPERTY;
  writeEntityJson(bpFile, bpDoc);
  console.log('player: 20 belly render controllers');
}
