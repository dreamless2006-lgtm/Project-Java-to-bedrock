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
export const POSES = ['none', 'morning_sickness', 'fetal_movement', 'kicking_sit', 'contraction', 'back_pain', 'water_breaking', 'prebirth', 'birth', 'postbirth', 'miscarriage', 'belly_rubs', 'incapacitated', 'scene', 'scene_sit'];
/**
 * What her belly does during a scene (the Jenny Bed's, a belly scene, or one of the Jenny port
 * girls' own): nothing special, calm, a burst of kicks, or a contraction tightening it. The scripts
 * drive it in bursts; the client eases each in and out.
 */
export const SCENE_STATES = ['none', 'calm', 'kicking', 'contraction'];
export const SCENE_PROPERTY = { type: 'enum', values: SCENE_STATES, default: 'none', client_sync: true };

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
  [`${MOD}:scene`]: SCENE_PROPERTY,
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
  // The belly tightening in waves while she has a contraction (or one comes during a scene).
  contraction_wave: `animation.${MOD}.contraction_wave`,
};

/** Molang: the belly size as a number from the enum property, -1 when none. */
export function bellyIndex(/** @type {string} */ property) {
  let expr = '-1';
  for (const p of [...PHASES].reverse()) expr = `(${property} == 'p${p}' ? ${p} : ${expr})`;
  return expr;
}

/** Seconds a frame may count for when easing (a hitch or a long pause must not jump a whole fade). */
const DT = 'math.clamp(q.delta_time, 0.0, 0.1)';

/**
 * The kick and contraction state of a female for the belly controller, with eased weights so a
 * burst of kicks or a contraction fades in and out instead of snapping: v.kicking and v.kick (the
 * strength), v.contracting, and v.kick_w / v.cw going 0..1 over about a second / two seconds.
 * In a scene (v.scene, minepreggo:scene) the scripts choose the bursts; the sitting pose of a
 * hostile incapacitation still kicks on its own.
 */
export function kickStateLines() {
  return [
    `v.scene = q.property('${MOD}:scene');`,
    "v.kicking = v.pose == 'fetal_movement' || v.pose == 'kicking_sit' || (v.pose == 'incapacitated' && v.scene == 'none') || v.pose == 'prebirth' || v.pose == 'birth' || v.scene == 'kicking';",
    "v.kick = (v.pose == 'incapacitated' && v.scene == 'none') ? 1 : v.kick;",
    "v.contracting = v.pose == 'contraction' || v.pose == 'prebirth' || (v.pose == 'incapacitated' && v.scene == 'none') || v.scene == 'contraction';",
    `v.kick_w = math.clamp(v.kick_w + (v.kicking ? 1.6 : -1.1) * ${DT}, 0.0, 1.0);`,
    `v.cw = math.clamp(v.cw + (v.contracting ? 0.6 : -0.45) * ${DT}, 0.0, 1.0);`,
  ];
}

/** The player's version (her variables are named variable.mp_*; she has no scenes of her own). */
export function playerKickStateLines() {
  return [
    "variable.kicking = variable.mp_pose == 'fetal_movement' || variable.mp_pose == 'kicking_sit' || variable.mp_pose == 'prebirth' || variable.mp_pose == 'birth';",
    "variable.contracting = variable.mp_pose == 'contraction' || variable.mp_pose == 'prebirth';",
    `variable.kick_w = math.clamp(variable.kick_w + (variable.kicking ? 1.6 : -1.1) * ${DT}, 0.0, 1.0);`,
    `variable.cw = math.clamp(variable.cw + (variable.contracting ? 0.6 : -0.45) * ${DT}, 0.0, 1.0);`,
  ];
}

/**
 * The kick pulses: each kick cube of the strength rolls out of the belly and back on a broad,
 * smooth bump of the entity's own clock (a sine cubed, so it rises and settles gently and rests
 * between kicks), out by its measured room plus a bulge so it always shows, drifting a little
 * along the skin as it goes, and swelling as it pushes. Expression-only: nothing to restart.
 */
export function kickPulseAnimations() {
  /** strength -> [bone, degrees per second, phase, bulge, growth, drift] */
  const kicks = {
    kick_i: [['front_kick', 80, 0, 1.5, 0.3, 0.35], ['right_kick', 80, 200, 1.2, 0.22, 0.3]],
    kick_ii: [['front_kick', 100, 0, 1.75, 0.38, 0.4], ['left_kick', 100, 120, 1.6, 0.32, 0.35], ['right_kick', 100, 240, 1.6, 0.32, 0.35]],
    kick_iii: [['front_kick', 125, 0, 2.0, 0.48, 0.45], ['left_kick', 125, 72, 1.9, 0.42, 0.4], ['right_kick', 125, 144, 1.9, 0.42, 0.4], ['top_kick', 125, 216, 1.8, 0.38, 0.35], ['bottom_kick', 125, 288, 1.8, 0.38, 0.35]],
  };
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [name, bones] of Object.entries(kicks)) {
    /** @type {Record<string, unknown>} */
    const channels = {};
    for (const [bone, f, phi, bulge, grow, drift] of bones) {
      const pulse = `math.pow(math.max(0.0, math.sin(q.life_time * ${Number(f).toFixed(1)} + ${Number(phi).toFixed(1)})), 3.0)`;
      channels[bone] = {
        position: [0, `${Number(drift).toFixed(2)} * math.sin(q.life_time * ${(Number(f) * 0.31).toFixed(1)} + ${Number(phi).toFixed(1)}) * ${pulse}`, `-(v.k_${bone}_z + ${Number(bulge).toFixed(2)}) * ${pulse}`],
        scale: [`1.0 + ${Number(grow).toFixed(2)} * ${pulse}`, `1.0 + ${Number(grow).toFixed(2)} * ${pulse}`, '1.0'],
      };
    }
    out[`animation.${MOD}.${name}`] = { loop: true, bones: channels };
  }
  return out;
}

/**
 * The contraction wave: while v.cw rises (a contraction, labor before the birth, or one during a
 * scene) the belly firms up in slow waves of six seconds: it lifts, rounds forward and narrows a
 * little, then eases off. Expression-only; at v.cw = 0 it changes nothing.
 */
export function contractionWaveAnimation() {
  const w = '(v.cw * (0.5 - 0.5 * math.cos(q.life_time * 60.0)))';
  return {
    [`animation.${MOD}.contraction_wave`]: {
      loop: true,
      bones: {
        belly: {
          position: [0, `0.45 * ${w}`, `-0.3 * ${w}`],
          scale: [`1.0 - 0.03 * ${w}`, `1.0 + 0.035 * ${w}`, `1.0 + 0.07 * ${w}`],
        },
      },
    },
  };
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
    ...kickStateLines(),
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
    // Every kick layer is weighted by the eased v.kick_w, so kicks fade in and out.
    const animations = [
      'belly_growth',
      { [p <= 2 ? 'belly_low' : p <= 6 ? 'belly_medium' : 'belly_high']: p <= 2 ? 'true' : 'q.is_tamed ? 1.0 : 1.0 - v.kick_w' },
      ...(p >= 3 ? [{ [`fetal_p${p}_i`]: 'v.kick_w * (v.kick == 0)' }, { [`fetal_p${p}_ii`]: 'v.kick_w * (v.kick == 1)' }, { [`fetal_p${p}_iii`]: 'v.kick_w * (v.kick == 2)' }] : []),
      ...(p >= 3 ? [{ kick_i: 'v.kick_w * (v.kick == 0)' }, { kick_ii: 'v.kick_w * (v.kick == 1)' }, { kick_iii: 'v.kick_w * (v.kick == 2)' }] : []),
      ...(p >= 2 ? ['contraction_wave'] : []),
      { fetal_push: 'v.kick_w' },
      { birth_push: "v.pose == 'birth'" },
      ...(navel ? [{ navel_prebirth: "v.pose == 'prebirth'" }, { navel_birth: "v.pose == 'birth'" }] : []),
      { belly_hidden: "v.pose == 'postbirth'" },
    ];
    states[`p${p}`] = { animations, transitions: transitions(p), blend_transition: 0.35 };
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
