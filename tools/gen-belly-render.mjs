// Rebuilds how the females and the player show their belly, around the one path that is proven in
// game: an enum entity property written by the scripts (like the pose), compared as a string in
// Molang, driving plain render-controller conditions (one controller per belly size, each a plain
// geometry + texture of the mod's own per-phase model) and a state-machine animation controller
// (like the pain controller) for the belly animations. Run: node tools/gen-belly-render.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeEntityJson } from './lib/entity-json.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const BP = join(ROOT, 'packs/behavior');
const MOD = 'minepreggo';
const PHASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const BELLY_VALUES = ['none', ...PHASES.map((p) => `p${p}`)];

/** Family -> base texture (the mod's per-phase textures are <texture>_pN). */
const FAMILIES = {
  zombie_girl: 'mobs/zombie/zombie_girl',
  humanoid_creeper_girl: 'mobs/creeper/humanoid/humanoid_creeper_girl',
  monster_creeper_girl: 'mobs/creeper/monster/monster_creeper_girl',
  ender_woman: 'mobs/ender/ender_woman',
  humanoid_slime_girl: 'mobs/slime/humanoid/humanoid_slime_girl',
  monster_slime_girl: 'mobs/slime/monster/monster_slime_girl',
};
/** Entity animate entries the belly controller takes over. */
const BELLY_ANIMATE = /^(belly_low|belly_medium|belly_high|belly_growth|fetal_p\d_i+|belly_hidden|fetal_push|birth_push|navel_prebirth|navel_birth)$/;

const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (/** @type {string} */ file, /** @type {unknown} */ doc) => writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');

/**
 * Initialize lines for every variable the pre_animation assigns (they keep state between frames,
 * so the first frame reads them before any assignment), merged with the existing ones.
 * @param {string[]} preAnimation
 * @param {string[]} existing
 */
function initializers(preAnimation, existing) {
  const assigned = new Set();
  for (const line of preAnimation) for (const m of line.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/g)) assigned.add(m[1]);
  const lines = existing.filter((line) => !/^variable\.[a-z_0-9]+ = 0\.0;$/.test(line) || !assigned.has(line.slice(9, line.indexOf(' '))));
  const have = new Set(lines.map((line) => line.match(/^(?:v|variable)\.([a-z_0-9]+)/)?.[1]));
  for (const name of [...assigned].sort()) if (!have.has(name)) lines.push(`variable.${name} = 0.0;`);
  return lines;
}

/** Fields the game (1.26.30) rejects in a behavior entity: the zombie's alert_same_type, the old leash distances. */
function rejectedFields(/** @type {any} */ entity) {
  for (const c of [entity.components ?? {}, ...Object.values(entity.component_groups ?? {})]) {
    if (c['minecraft:behavior.hurt_by_target']) delete c['minecraft:behavior.hurt_by_target'].alert_same_type;
    if (c['minecraft:leashable']) for (const key of ['soft_distance', 'hard_distance', 'max_distance']) delete c['minecraft:leashable'][key];
  }
}

/**
 * How far the front kick cube's resting face sits behind the belly skin, per belly size: the navel
 * birth moves it out by exactly that plus the crowning, so the bulge surfaces at the skin instead
 * of floating in front of it (or staying buried) whatever the belly size.
 * @param {(phase: number) => any} geometryOf
 */
function kickReach(geometryOf) {
  /** @type {number[]} */
  const reach = [];
  for (let p = 0; p <= 9; p++) {
    const geometry = geometryOf(p);
    const byName = new Map(geometry.bones.map((/** @type {any} */ b) => [b.name, b]));
    const children = (/** @type {string} */ n) => geometry.bones.filter((/** @type {any} */ b) => b.parent === n).map((/** @type {any} */ b) => b.name);
    const subtree = (/** @type {string} */ n) => [n, ...children(n).flatMap(subtree)];
    const front = (/** @type {any} */ bone) => Math.min(...bone.cubes.map((/** @type {any} */ c) => c.origin[2] - (c.inflate ?? 0)));
    const bellyBones = subtree('belly').filter((n) => !/kick/.test(n)).map((n) => byName.get(n)).filter((b) => b?.cubes?.length);
    const kick = byName.get('front_kick');
    reach.push(kick && bellyBones.length ? Math.max(0, Math.round((front(kick) - Math.min(...bellyBones.map(front))) * 100) / 100) : 0);
  }
  return reach;
}
/** Molang picking the reach of the current belly size. */
const reachExpression = (/** @type {string} */ sizeVariable, /** @type {number[]} */ reach) => {
  let expr = '0.0';
  for (let p = 9; p >= 3; p--) expr = `(${sizeVariable} == ${p} ? ${reach[p].toFixed(2)} : ${expr})`;
  return expr;
};

/** Molang: the belly size as a number from the enum property, -1 when none. */
function bellyIndex(/** @type {string} */ property) {
  let expr = '-1';
  for (const p of [...PHASES].reverse()) expr = `(${property} == 'p${p}' ? ${p} : ${expr})`;
  return expr;
}

// ---- the belly animation controller: one state per belly size, like the pain controller --------
function bellyController(/** @type {boolean} */ navel) {
  /** @type {Record<string, unknown>} */
  const states = {};
  const transitions = (/** @type {number} */ self) => [
    ...(self >= 0 ? [{ none: 'v.bp < 0' }] : []),
    ...PHASES.filter((p) => p !== self).map((p) => ({ [`p${p}`]: `v.bp == ${p}` })),
  ];
  states.none = { transitions: transitions(-1) };
  for (const p of PHASES) {
    const animations = [
      'belly_growth',
      { [p <= 2 ? 'belly_low' : p <= 6 ? 'belly_medium' : 'belly_high']: p <= 2 ? 'true' : 'q.is_tamed || !v.kicking' },
      ...(p >= 3 ? [{ [`fetal_p${p}_i`]: 'v.kicking && v.kick == 0' }, { [`fetal_p${p}_ii`]: 'v.kicking && v.kick == 1' }, { [`fetal_p${p}_iii`]: 'v.kicking && v.kick == 2' }] : []),
      { fetal_push: 'v.kicking' },
      { birth_push: "v.pose == 'birth'" },
      ...(navel ? [{ navel_prebirth: "v.pose == 'prebirth'" }, { navel_birth: "v.pose == 'birth'" }] : []),
      { belly_hidden: "v.pose == 'postbirth'" },
    ];
    states[`p${p}`] = { animations, transitions: transitions(p), blend_transition: 0.2 };
  }
  return { initial_state: 'none', states };
}
write(join(RP, 'animation_controllers/belly.animation_controllers.json'), {
  format_version: '1.10.0',
  animation_controllers: {
    [`controller.animation.${MOD}.belly`]: bellyController(false),
    [`controller.animation.${MOD}.belly_navel`]: bellyController(true),
  },
});

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
  write(rcFile, { format_version: '1.10.0', render_controllers: controllers });
  d.render_controllers = [
    { [main]: 'v.bp < 0' },
    ...PHASES.map((p) => ({ [`${main}_p${p}`]: `v.bp == ${p}` })),
    ...(charged ? [{ [`${main}_charged`]: 'q.is_powered && v.bp < 0' }, ...PHASES.map((p) => ({ [`${main}_charged_p${p}`]: `q.is_powered && v.bp == ${p}` }))] : []),
    ...(eyes ? [`${main}_eyes`] : []),
  ];

  // pre_animation: the belly size from the enum property, else the phase, the variant, or a pregnancy pose.
  const pre = d.scripts.pre_animation.filter((/** @type {string} */ line) => !line.startsWith('v.bp =') && !line.startsWith('v.phase = v.phase >= 0 ?') && !line.startsWith('v.phase = v.bp') && !line.startsWith('v.kr_f ='));
  const at = pre.findIndex((/** @type {string} */ line) => line.startsWith('v.pregnant_pose ='));
  if (at < 0) throw new Error(`${family}: no v.pregnant_pose line`);
  pre.splice(at + 1, 0,
    `v.bp = ${bellyIndex("q.property('minepreggo:belly')")};`,
    'v.bp = v.bp >= 0 ? v.bp : (v.phase >= 0 ? v.phase : (q.variant > 0 ? q.variant - 1 : (v.pregnant_pose ? 5 : -1)));',
    'v.phase = v.bp;',
    `v.kr_f = ${reachExpression('v.bp', kickReach((p) => read(join(RP, 'models/entity', MOD, `${family}_p${p}.geo.json`))['minecraft:geometry'][0]))};`);
  d.scripts.pre_animation = pre;

  // The belly animations move into the controller.
  const navel = 'navel_birth' in d.animations;
  if (navel) {
    // Where the mod's own birth animation already moves her kick cubes, the crowning only grows in place.
    const birthFile = join(RP, 'animations', MOD, `${family}.animation.json`);
    const birth = existsSync(birthFile) ? read(birthFile).animations?.[d.animations.birth] : undefined;
    d.animations.navel_birth = `animation.${MOD}.navel_birth${birth?.bones?.front_kick ? '_light' : ''}`;
  }
  d.animations.belly_controller = `controller.animation.${MOD}.${navel ? 'belly_navel' : 'belly'}`;
  const animate = d.scripts.animate.filter((/** @type {string | Record<string, string>} */ a) => !(typeof a === 'object' && BELLY_ANIMATE.test(Object.keys(a)[0])) && a !== 'belly_controller');
  const pain = animate.indexOf('pain_controller');
  animate.splice(pain < 0 ? animate.length : pain + 1, 0, 'belly_controller');
  d.scripts.animate = animate;
  for (const name of ['belly_low', 'belly_medium', 'belly_high', 'belly_growth', 'fetal_push', 'birth_push', 'belly_hidden', ...PHASES.filter((p) => p >= 3).flatMap((p) => [`fetal_p${p}_i`, `fetal_p${p}_ii`, `fetal_p${p}_iii`])]) {
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
  e.description.properties['minepreggo:belly'] = { type: 'enum', values: BELLY_VALUES, default: 'none', client_sync: true };
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
  const belly = '((!variable.is_first_person && !variable.map_face_icon && !query.is_spectator) || (variable.is_first_person && !query.is_spectator && variable.player_x_rotation > 15.0)) && variable.mp_pregnant';
  d.render_controllers = d.render_controllers.filter((/** @type {string | Record<string, string>} */ rc) => typeof rc === 'string' || !/player_belly_(custom|predefined)/.test(Object.keys(rc)[0]));
  for (const p of PHASES) {
    d.render_controllers.push({ [`controller.render.${MOD}.player_belly_custom_p${p}`]: `${belly} && !variable.mp_predefined && variable.mp_bp == ${p}` });
    d.render_controllers.push({ [`controller.render.${MOD}.player_belly_predefined_p${p}`]: `${belly} && variable.mp_predefined && variable.mp_bp == ${p}` });
  }
  const pre = d.scripts.pre_animation.filter((/** @type {string} */ line) => !line.startsWith('variable.mp_bp =') && !line.startsWith('variable.mp_phase = variable.mp_phase >= 0 ?') && !line.startsWith('variable.mp_phase = variable.mp_bp') && !line.startsWith('variable.kr_f ='));
  const at = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_pose ='));
  if (at < 0) throw new Error('player: no mp_pose line');
  pre.splice(at + 1, 0,
    `variable.mp_bp = ${bellyIndex("query.property('minepreggo:belly')")};`,
    "variable.mp_bp = variable.mp_bp >= 0 ? variable.mp_bp : (variable.mp_phase >= 0 ? variable.mp_phase : ((variable.mp_pose == 'none' || variable.mp_pose == 'postbirth' || variable.mp_pose == 'miscarriage') ? -1 : 5));",
    'variable.mp_phase = variable.mp_bp;');
  const reachOf = (/** @type {string} */ kind) => reachExpression('variable.mp_bp', kickReach((p) => read(join(RP, 'models/entity', MOD, `player_body_${kind}_p${p}.geo.json`))['minecraft:geometry'][0]));
  const predefinedAt = pre.findIndex((/** @type {string} */ line) => line.startsWith('variable.mp_predefined ='));
  if (predefinedAt < 0) throw new Error('player: no mp_predefined line');
  pre.splice(predefinedAt + 1, 0, `variable.kr_f = variable.mp_predefined ? ${reachOf('predefined')} : ${reachOf('custom')};`);
  d.scripts.pre_animation = pre;
  d.scripts.initialize = initializers(pre, [...(d.scripts.initialize ?? []), 'variable.melee_spear_equipped = 0.0;']);
  write(file, doc);

  const rcFile = join(RP, 'render_controllers/player.render_controllers.json');
  const rcDoc = read(rcFile);
  for (const key of Object.keys(rcDoc.render_controllers)) if (/player_belly_(custom|predefined)(_p\d)?$/.test(key)) delete rcDoc.render_controllers[key];
  for (const p of PHASES) {
    rcDoc.render_controllers[`controller.render.${MOD}.player_belly_custom_p${p}`] = { geometry: `Geometry.minepreggo_body_custom_p${p}`, materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] };
    rcDoc.render_controllers[`controller.render.${MOD}.player_belly_predefined_p${p}`] = { geometry: `Geometry.minepreggo_body_predefined_p${p}`, materials: [{ '*': 'Material.default' }], textures: [`Texture.minepreggo_alex_p${p}_extra`] };
  }
  write(rcFile, rcDoc);

  const bpFile = join(BP, 'entities/player.json');
  const bpDoc = read(bpFile);
  bpDoc['minecraft:entity'].description.properties['minepreggo:belly'] = { type: 'enum', values: BELLY_VALUES, default: 'none', client_sync: true };
  writeEntityJson(bpFile, bpDoc);
  console.log('player: 20 belly render controllers');
}
