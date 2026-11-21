// Reads the mod's jar whatever release it is: the readable releases name their model classes and
// animation fields, the obfuscated ones (1.3.9 on: classes, methods and fields renamed to letters) are
// read through the names they register their model layers under (tools/lib/java-layers.mjs) and the
// animation table of the release below. Used by tools/import-jar.mjs and the tests.
import { registeredLayers } from './java-layers.mjs';

/**
 * An obfuscated release's animation classes and fields, by the readable class and field names of the
 * releases before it (the names the rest of this pipeline uses). Worked out once per release from
 * the jar itself: the class each model animates with, the pregnancy state its code checks right before
 * each animation (the state enums keep their names), the walks it plays with HierarchicalModel.animateWalk,
 * and for the rest their length, looping and bones (11.5 s with the belly: the kicking sit; the body lowered 8: riding; the 4 s idle the zombie's; a still
 * pose of the legs: sitting; the shortest one-off: the attack; each phase's fetal movements come
 * strongest first, the inflations lowest first).
 */
export const OBFUSCATED_ANIMATIONS = {
  '1.3.9': {
    ZombieGirlAnimations: ['ad', { ee: 'IDLE', ef: 'WALK', eg: 'AGGRESSION', eh: 'ATTACK', ei: 'WAIT1', ek: 'RIDING', ej: 'MORNING_SICKNESS', el: 'MISCARRIAGE', eq: 'PREBIRTH', eo: 'BIRTH', ep: 'CONTRACTION', er: 'POSTBIRTH', es: 'KICKING_SIT', et: 'BACK_PAIN', eu: 'WATER_BREAKING', em: 'KICKING1', en: 'KICKING2' }],
    HumanoidCreeperGirlAnimations: ['V', { ci: 'IDLE', cj: 'WALK', ck: 'AGGRESSION', cx: 'ATTACK', cp: 'WAIT1', cw: 'RIDING', cm: 'MORNING_SICKNESS', cn: 'MISCARRIAGE', co: 'BIRTH', cq: 'PREBIRTH', cr: 'POSTBIRTH', cs: 'CONTRACTION', ct: 'KICKING_SIT', cu: 'BACK_PAIN', cv: 'WATER_BREAKING' }],
    MonsterCreeperGirlAnimations: ['Z', { cW: 'IDLE', cX: 'WALK', cZ: 'AGGRESSION', cY: 'ATTACK', dk: 'WAIT', db: 'MORNING_SICKNESS', dc: 'BIRTH', dd: 'CONTRACTION', de: 'PREBIRTH', df: 'MISCARRIAGE', dg: 'POSTBIRTH', dh: 'KICKING_SIT', di: 'BACK_PAIN', dj: 'WATER_BREAKING' }],
    MonsterEnderWomanAnimations: ['aa', { dt: 'IDLE', do: 'WALK1', dp: 'WALK2', ds: 'ATTACK', dr: 'CARRING', dn: 'CREEPY_FACE', dq: 'WAIT', dy: 'MORNING_SICKNESS', du: 'MISCARRIAGE', dx: 'PREBIRTH', dw: 'BIRTH', dv: 'CONTRACTION', dz: 'POSTBIRTH', dA: 'KICKING_SIT', dB: 'BACK_PAIN', dC: 'WATER_BREAKING' }],
    HumanoidSlimeGirlAnimations: ['W', { cy: 'IDLE', cz: 'WALK', cA: 'AGGRESSION', cB: 'ATTACK', cE: 'RIDING', cH: 'WAIT', cO: 'SQUISH', cD: 'MORNING_SICKNESS', cF: 'MISCARRIAGE', cG: 'BIRTH', cI: 'PREBIRTH', cJ: 'POSTBIRTH', cK: 'CONTRACTION', cL: 'KICKING_SIT', cM: 'WATER_BREAKING', cN: 'BACK_PAIN' }],
    MonsterSlimeGirlAnimations: ['ab', { dF: 'IDLE', dV: 'AGGRESSION', dK: 'ATTACK', dG: 'LAUNCH', dH: 'LANDING', dL: 'HOP', dI: 'WAIT', dJ: 'MORNING_SICKNESS', dM: 'KICKING_SIT', dN: 'BACK_PAIN', dO: 'WATER_BREAKING', dP: 'CONTRACTION', dR: 'BIRTH', dS: 'PREBIRTH', dT: 'POSTBIRTH', dU: 'MISCARRIAGE' }],
    BellyAnimation: ['R', { bm: 'LOW_BELLY_INFLATION', bn: 'MEDIUM_BELLY_INFLATION', bo: 'HIGH_BELLY_INFLATION', bp: 'FETAL_MOVEMENT_P3_III', bq: 'FETAL_MOVEMENT_P3_II', br: 'FETAL_MOVEMENT_P3_I', bs: 'FETAL_MOVEMENT_P4_III', bt: 'FETAL_MOVEMENT_P4_II', bu: 'FETAL_MOVEMENT_P4_I', bv: 'FETAL_MOVEMENT_P5_III', bw: 'FETAL_MOVEMENT_P5_II', bx: 'FETAL_MOVEMENT_P5_I', by: 'FETAL_MOVEMENT_P6_III', bz: 'FETAL_MOVEMENT_P6_II', bA: 'FETAL_MOVEMENT_P6_I', bB: 'FETAL_MOVEMENT_P7_III', bC: 'FETAL_MOVEMENT_P7_II', bD: 'FETAL_MOVEMENT_P7_I', bE: 'FETAL_MOVEMENT_P8_III', bF: 'FETAL_MOVEMENT_P8_II', bG: 'FETAL_MOVEMENT_P8_I', bH: 'FETAL_MOVEMENT_P9_III', bI: 'FETAL_MOVEMENT_P9_II', bJ: 'FETAL_MOVEMENT_P9_I', bK: 'FETAL_MOVEMENT_P10_III', bL: 'FETAL_MOVEMENT_P10_II', bM: 'FETAL_MOVEMENT_P10_I', bN: 'RIGHT_HANDED_SLAP', bO: 'LEFT_HANDED_SLAP', bP: 'CENTER_HANDED_SLAP', bQ: 'BIRTH', bR: 'BELLY_RUBS_NEEDS_I', bS: 'BELLY_RUBS_NEEDS_II', bT: 'BELLY_RUBS_NEEDS_III' }],
  },
};
const ANIMATION_PACKAGE = 'dev/dixmk/minepreggo/client/animation/preggo/';

/**
 * The jar's models and animations by their readable names.
 * @param {Record<string, Uint8Array>} files the jar's entries
 * @param {ReturnType<typeof import('./java-models.mjs').createModelRunner>} models
 * @param {string} version the mod's version (mods.toml)
 */
export function modJar(files, models, version) {
  const obfuscated = !files[`${ANIMATION_PACKAGE}BellyAnimation.class`];
  const layers = obfuscated ? registeredLayers(files, 'dev/dixmk/minepreggo/') : new Map();
  return {
    obfuscated,
    /** A model layer: by its class and method in a readable jar, by its registered name in an obfuscated one. */
    layer(/** @type {string} */ javaClass, /** @type {string} */ method, /** @type {string} */ registered) {
      if (!obfuscated) return models.layer(javaClass, method);
      const ref = layers.get(registered);
      if (!ref) throw new Error(`the jar registers no model layer "${registered}"`);
      return models.layer(ref.className, ref.method);
    },
    /** A Java animation class's AnimationDefinition constants by their readable field names. */
    animations(/** @type {string} */ javaClass) {
      if (!obfuscated) return models.animations(ANIMATION_PACKAGE + javaClass);
      const table = OBFUSCATED_ANIMATIONS[/** @type {keyof typeof OBFUSCATED_ANIMATIONS} */ (version)];
      if (!table) throw new Error(`an obfuscated release (${version}) this importer has no animation table for`);
      const [renamed, fields] = table[/** @type {keyof typeof table} */ (javaClass)];
      const found = models.animations(`dev/dixmk/minepreggo/${renamed}`);
      return Object.fromEntries(Object.entries(fields).map(([field, name]) => {
        if (!found[field]) throw new Error(`${javaClass}: no animation ${renamed}.${field} in ${version}`);
        return [name, found[field]];
      }));
    },
  };
}
