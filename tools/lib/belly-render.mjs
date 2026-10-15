// The one belly-rendering path proven in game, as data shared by tools/gen-belly-render.mjs (our
// own females and the player) and tools/import-jenny.mjs (the Jenny Mod Java Port's girls): the
// entity properties the scripts write, the enum belly property compared as a string in Molang, the
// pre_animation lines every pregnant body needs, the per-size kick room lines the clamped kick
// animations read, the belly animation controller, and the set_property-only phase events.
import { KICK_BONES, kickRoom } from './kick-clamp.mjs';

export const MOD = 'minepreggo';
export const FAMILY_TAG = 'minepreggo_preggo_mob';
export const PHASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const BELLY_VALUES = ['none', ...PHASES.map((p) => `p${p}`)];
export const POSES = ['none', 'morning_sickness', 'fetal_movement', 'kicking_sit', 'contraction', 'back_pain', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'belly_rubs', 'incapacitated'];

/** The belly size the client renders: written by the scripts next to the phase, like the pose. */
export const BELLY_PROPERTY = { type: 'enum', values: BELLY_VALUES, default: 'none', client_sync: true };
/** Every property of a pregnant female (DESIGN.md); write the file with writeEntityJson so 0.0 stays a float literal. */
export const MINEPREGGO_PROPERTIES = {
  [`${MOD}:phase`]: { type: 'int', range: [-1, 9], default: -1, client_sync: true },
  [`${MOD}:pose`]: { type: 'enum', values: POSES, default: 'none', client_sync: true },
  [`${MOD}:kick`]: { type: 'int', range: [0, 2], default: 0, client_sync: true },
  [`${MOD}:growth`]: { type: 'float', range: [0.0, 1.0], default: 0.0, client_sync: true },
  [`${MOD}:savage`]: { type: 'bool', default: false, client_sync: true },
  [`${MOD}:belly`]: BELLY_PROPERTY,
};

/** The belly animations of the mod (BellyAnimation) plus the port's push layers, by the short names the controller plays. */
export const BELLY_ANIMATIONS = {
  belly_low: `animation.${MOD}.belly.low_belly_inflation`,
  belly_medium: `animation.${MOD}.belly.medium_belly_inflation`,
  belly_high: `animation.${MOD}.belly.high_belly_inflation`,
  belly_growth: `animation.${MOD}.belly_growth`,
  ...Object.fromEntries(PHASES.filter((p) => p >= 3).flatMap((p) => ['i', 'ii', 'iii'].map((s) => [`fetal_p${p}_${s}`, `animation.${MOD}.belly.fetal_movement_p${p}_${s}`]))),
  belly_hidden: `animation.${MOD}.belly_hidden`,
  fetal_push: `animation.${MOD}.fetal_push`,
  birth_push: `animation.${MOD}.birth_push`,
  // The port's own kicks: expression-driven pulses of the kick cubes to just beyond the skin (the
  // mod's keyframed kicks are seconds apart inside long loops whose timing a controller cannot
  // restart, so on their own they are rarely seen).
  kick_i: `animation.${MOD}.kick_i`,
  kick_ii: `animation.${MOD}.kick_ii`,
  kick_iii: `animation.${MOD}.kick_iii`,
};

/** Molang: the belly size as a number from the enum property, -1 when none. */
export function bellyIndex(/** @type {string} */ property) {
  let expr = '-1';
  for (const p of [...PHASES].reverse()) expr = `(${property} == 'p${p}' ? ${p} : ${expr})`;
  return expr;
}

/**
 * The pre_animation lines a pregnant body needs for the belly controller: the phase and pose from
 * the properties, the belly size (from the enum, else the phase), and the kick state.
 * @param {string} [fallback] Molang for the belly size when neither the enum nor the phase is known
 */
export function bellyPreAnimation(fallback = '-1') {
  return [
    `v.phase = q.property('${MOD}:phase');`,
    `v.pose = q.property('${MOD}:pose');`,
    "v.pregnant_pose = !(v.pose == 'none') && !(v.pose == 'postbirth') && !(v.pose == 'miscarriage');",
    `v.bp = ${bellyIndex(`q.property('${MOD}:belly')`)};`,
    `v.bp = v.bp >= 0 ? v.bp : (v.phase >= 0 ? v.phase : ${fallback});`,
    'v.phase = v.bp;',
    `v.push = v.pose == 'birth' ? q.property('${MOD}:growth') : 0.0;`,
    `v.kick = q.property('${MOD}:kick');`,
    "v.kicking = v.pose == 'fetal_movement' || v.pose == 'kicking_sit' || v.pose == 'incapacitated' || v.pose == 'prebirth' || v.pose == 'birth';",
    "v.kick = v.pose == 'incapacitated' ? 1 : v.kick;",
    'v.kl = 1.0 + v.kick;',
    `v.belly_growth = (v.phase <= 2 ? 1.0 : (v.phase <= 4 ? 0.9 : (v.phase == 5 ? 0.8 : (v.phase <= 7 ? 0.7 : 0.6)))) * q.property('${MOD}:growth');`,
  ];
}

/**
 * Molang lines giving each kick cube's room inside the belly for the current size (v.k_<bone>_x/_y/_z),
 * which the clamped kick animations read; v.kr_f (the navel crowning's reach) is the front kick's z room.
 * @param {string} sizeVariable
 * @param {(phase: number) => any} geometryOf
 * @param {(phase: number) => any} [altGeometryOf] a second body chosen by `altCondition`
 * @param {string} [altCondition]
 */
export function kickRoomLines(sizeVariable, geometryOf, altGeometryOf, altCondition) {
  const rooms = (/** @type {(phase: number) => any} */ of) => Array.from({ length: 10 }, (_, p) => kickRoom(of(p)));
  const main = rooms(geometryOf);
  const alt = altGeometryOf ? rooms(altGeometryOf) : undefined;
  const pick = (/** @type {Record<string, any>[]} */ set, /** @type {string} */ bone, /** @type {'x'|'y'|'z'} */ axis) => {
    let expr = '0.0';
    for (let p = 9; p >= 3; p--) expr = `(${sizeVariable} == ${p} ? ${(set[p][bone]?.[axis] ?? 0).toFixed(2)} : ${expr})`;
    return expr;
  };
  const lines = [];
  for (const bone of KICK_BONES) for (const axis of /** @type {const} */ (['x', 'y', 'z'])) {
    const value = alt && altCondition ? `${altCondition} ? ${pick(alt, bone, axis)} : ${pick(main, bone, axis)}` : pick(main, bone, axis);
    lines.push(`v.k_${bone}_${axis} = ${value};`);
  }
  lines.push('v.kr_f = v.k_front_kick_z;');
  return lines;
}

/**
 * Initialize lines for every variable the pre_animation assigns (they keep state between frames,
 * so the first frame reads them before any assignment), merged with the existing ones.
 * @param {string[]} preAnimation
 * @param {string[]} existing
 */
export function initializers(preAnimation, existing) {
  const assigned = new Set();
  for (const line of preAnimation) for (const m of line.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/g)) assigned.add(m[1]);
  const lines = existing.filter((line) => !/^variable\.[a-z_0-9]+ = 0\.0;$/.test(line) || !assigned.has(line.slice(9, line.indexOf(' '))));
  const have = new Set(lines.map((line) => line.match(/^(?:v|variable)\.([a-z_0-9]+)/)?.[1]));
  for (const name of [...assigned].sort()) if (!have.has(name)) lines.push(`variable.${name} = 0.0;`);
  return lines;
}

/** The belly animation controller: one state per belly size, like the pain controller. */
export function bellyController(/** @type {boolean} */ navel) {
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
      ...(p >= 3 ? [{ kick_i: 'v.kicking && v.kick == 0' }, { kick_ii: 'v.kicking && v.kick == 1' }, { kick_iii: 'v.kicking && v.kick == 2' }] : []),
      { fetal_push: 'v.kicking' },
      { birth_push: "v.pose == 'birth'" },
      ...(navel ? [{ navel_prebirth: "v.pose == 'prebirth'" }, { navel_birth: "v.pose == 'birth'" }] : []),
      { belly_hidden: "v.pose == 'postbirth'" },
    ];
    states[`p${p}`] = { animations, transitions: transitions(p), blend_transition: 0.2 };
  }
  return { initial_state: 'none', states };
}

/**
 * The phase events the scripts fire on a female whose entity file is not ours (the Jenny port's
 * girls): they only set the properties, her own component groups are left alone.
 */
export function phaseEvents() {
  /** @type {Record<string, unknown>} */
  const events = {
    [`${MOD}:set_not_pregnant`]: { set_property: { [`${MOD}:phase`]: -1, [`${MOD}:pose`]: 'none', [`${MOD}:growth`]: 0.0, [`${MOD}:belly`]: 'none' } },
    [`${MOD}:become_savage`]: { set_property: { [`${MOD}:savage`]: true } },
    [`${MOD}:calm_down`]: { set_property: { [`${MOD}:savage`]: false } },
    [`${MOD}:hostile_pregnant_init`]: { set_property: { [`${MOD}:savage`]: false } },
  };
  for (const p of PHASES) events[`${MOD}:set_phase_${p}`] = { set_property: { [`${MOD}:phase`]: p, [`${MOD}:belly`]: `p${p}` } };
  return events;
}
