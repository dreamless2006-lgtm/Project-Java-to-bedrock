// Crowning: during a birth the baby's head shows at the opening, comes out a little further with
// each push and slips back a little between pushes, then the whole baby slides out just before it is
// born. The Java mod draws its fetus model there (FetusLayer: scaled 0.875, head first, slid out by
// the push); here every mother gets a crowning geometry that copies her bones from the root down to
// the one the opening hangs from (by name, pivot and rest rotation, without cubes), so her own
// animations move it exactly as they move her, and carries the baby under three bones of its own:
//
//   crowning        the mount at the opening, hidden (scale 0) but during the birth
//   crowning_slide  slides the baby out along the mount's -y
//   crowning_baby   the baby, head first: its crown is flush with the opening at depth 0, and the
//                   rest of it lies inside her (along the mount's +y)
//
// The progress is the birth progress the scripts already send (minepreggo:growth during the birth
// pose, read as v.push). Molang turns it into a depth (v.crown), eased so the head moves smoothly
// between the coarse updates; the animation adds the push rhythm on top.

import { MOD } from './belly-render.mjs';

/** The mod's fetus scale (FetusLayer.applyTransformation). */
export const FETUS_SCALE = 0.875;
/** How far the head is out once it has crowned, and how much further the body comes after it (fetus units). */
export const HEAD_DEPTH = 3;
export const BODY_DEPTH = 8;

const round = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;
/** A Molang number literal (always with a decimal point). */
const num = (/** @type {number} */ v) => (Number.isInteger(round(v)) ? `${round(v)}.0` : `${round(v)}`);
const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => round(v + b[k]));

/**
 * The mod's fetus geometry without its umbilical cord (it would poke out first), its bones renamed
 * so her animations (head, body, arms) never reach them.
 * @param {any} geometry a converted fetus geometry (one entry of "minecraft:geometry")
 */
export function fetusBones(geometry) {
  const bones = /** @type {any[]} */ (geometry.bones);
  const dropped = new Set();
  for (const bone of bones) if (/^cord$/i.test(bone.name) || (bone.parent && dropped.has(bone.parent))) dropped.add(bone.name);
  return bones.filter((b) => !dropped.has(b.name)).map((b) => ({ ...b, name: `fetus_${b.name}`, ...(b.parent ? { parent: `fetus_${b.parent}` } : {}) }));
}

/** The top middle of the fetus's head (the crown), from its head bone, else from all of its cubes. */
export function crownOf(/** @type {any[]} */ bones) {
  const head = bones.filter((b) => /(^|_)head$/.test(b.name));
  const pool = (head.length ? head : bones).flatMap((b) => b.cubes ?? []);
  if (!pool.length) return [0, 0, 0];
  const lo = [0, 1, 2].map((k) => Math.min(...pool.map((c) => c.origin[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pool.map((c) => c.origin[k] + c.size[k])));
  return [round((lo[0] + hi[0]) / 2), round(hi[1]), round((lo[2] + hi[2]) / 2)];
}

/**
 * A crowning geometry: her chain of bones (no cubes), the mount at the opening, and the baby.
 * @param {object} options
 * @param {string} options.id the geometry identifier
 * @param {{ name: string, parent?: string, pivot: number[], rotation?: number[] }[]} options.chain her bones from the root down to the one the opening hangs from
 * @param {number[]} options.opening where the baby comes out (model space)
 * @param {number[]} [options.mount] the mount's rest rotation: its -y is the way out (none: her bone's -y)
 * @param {any[]} options.baby the baby's bones (fetusBones), crown up at crownOf(baby)
 * @param {number[]} [options.textureSize] the baby's texture layout
 */
export function crowningGeometry({ id, chain, opening, mount, baby, textureSize = [32, 32] }) {
  const last = chain[chain.length - 1].name;
  const crown = crownOf(baby);
  // the baby turned head first: moved so its crown sits on the opening, then turned 180 degrees about
  // x around the opening, so the crown leads out of her and the rest lies inside her
  const shift = opening.map((v, k) => v - crown[k]);
  const roots = new Set(baby.filter((b) => !b.parent).map((b) => b.name));
  const moved = baby.map((b) => ({
    ...b,
    ...(roots.has(b.name) ? { parent: 'crowning_baby' } : {}),
    pivot: add(b.pivot ?? [0, 0, 0], shift),
    ...(b.cubes ? { cubes: b.cubes.map((/** @type {any} */ c) => ({ ...c, origin: add(c.origin, shift), ...(c.pivot ? { pivot: add(c.pivot, shift) } : {}) })) } : {}),
  }));
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: id, texture_width: textureSize[0], texture_height: textureSize[1], visible_bounds_width: 3, visible_bounds_height: 3.5, visible_bounds_offset: [0, 1.25, 0] },
        bones: [
          ...chain.map((b) => ({ name: b.name, ...(b.parent ? { parent: b.parent } : {}), pivot: b.pivot.map(round), ...(b.rotation ? { rotation: b.rotation } : {}) })),
          { name: 'crowning', parent: last, pivot: opening.map(round), ...(mount ? { rotation: mount } : {}) },
          { name: 'crowning_slide', parent: 'crowning', pivot: opening.map(round) },
          { name: 'crowning_baby', parent: 'crowning_slide', pivot: opening.map(round), rotation: [180, 0, 0] },
          ...moved,
        ],
      },
    ],
  };
}

/**
 * A simple baby for bodies without a fetus model of the mod (the Jenny girls): head, body, arms and
 * legs in fetus units, crown up at y 9.4, drawn with one patch of the texture (her skin tone).
 * @param {{ uv: number[], uv_size: number[] }} patch
 */
export function simpleBaby(patch) {
  const uv = { north: patch, south: patch, east: patch, west: patch, up: patch, down: patch };
  const box = (/** @type {number[]} */ origin, /** @type {number[]} */ size) => ({ origin, size, uv });
  return [
    { name: 'fetus_body', pivot: [0, 4, 0], cubes: [box([-1.2, 3.4, -1], [2.4, 3, 2])] },
    { name: 'fetus_head', parent: 'fetus_body', pivot: [0, 6.4, 0], cubes: [box([-1.5, 6.4, -1.5], [3, 3, 3])] },
    { name: 'fetus_arms', parent: 'fetus_body', pivot: [0, 6, 0], cubes: [box([-2, 3.8, -0.5], [0.8, 2.4, 0.8]), box([1.2, 3.8, -0.5], [0.8, 2.4, 0.8])] },
    { name: 'fetus_legs', parent: 'fetus_body', pivot: [0, 3.4, 0], cubes: [box([-1.1, 1, -0.5], [1, 2.4, 1]), box([0.1, 1, -0.5], [1, 2.4, 1])] },
  ];
}

/**
 * An egg for the egg-laying mothers (the kobold): an oval of three stacked boxes, its narrow end
 * first, drawn with one patch of the texture (the egg's shell).
 * @param {{ uv: number[], uv_size: number[] }} patch
 */
export function simpleEgg(patch) {
  const uv = { north: patch, south: patch, east: patch, west: patch, up: patch, down: patch };
  const box = (/** @type {number} */ w, /** @type {number} */ h) => ({ origin: [-w / 2, 2.15 - h / 2, -w / 2], size: [w, h, w], uv });
  return [{ name: 'fetus_egg', pivot: [0, 2.15, 0], cubes: [box(2.4, 3.0), box(1.9, 3.8), box(1.1, 4.3)] }];
}
/** How far an egg comes out before its widest part has passed, and how much further until it is out. */
export const EGG_DEPTH = { head: 2.2, rest: 3.2 };

/**
 * The pre_animation lines of the crowning, after v.push and v.pose are read.
 * @param {object} options
 * @param {string} options.when the Molang condition of a birth with a baby to show (besides v.push > 0)
 * @param {number} [options.scale] the mount's scale while shown (the baby's size)
 * @param {boolean} [options.strain] the player: her own pushes (sneak) drive the rhythm
 * @param {number} [options.head] how far out the head is once crowned (fetus units)
 * @param {number} [options.rest] how much further the rest of the baby comes
 */
export function crowningLines({ when, scale = FETUS_SCALE, strain = false, head = HEAD_DEPTH, rest = BODY_DEPTH }) {
  return [
    `v.crown_scale = ${num(scale)};`,
    strain ? 'v.strain = math.clamp(v.strain + (q.is_sneaking ? 6.0 : -1.5) * q.delta_time, 0.0, 1.0);' : 'v.strain = -1.0;',
    `v.crowning = (${when}) && v.push > 0.0;`,
    'v.crown_x = math.clamp((v.push - 0.15) / 0.65, 0.0, 1.0);',
    `v.crown_t = v.push < 0.8 ? ${num(head)} * v.crown_x * v.crown_x * (3.0 - 2.0 * v.crown_x) : ${num(head)} + ${num(rest)} * math.pow((v.push - 0.8) / 0.2, 2.0);`,
    // eased toward the target (the progress comes in steps), but at once when the next baby starts
    'v.crown = (!v.crowning || v.crown_t < v.crown - 2.5) ? v.crown_t : v.crown + (v.crown_t - v.crown) * math.min(1.0, 6.0 * q.delta_time);',
  ];
}

/**
 * How far out the baby is now: its depth, less a little between pushes (the player's own pushes, or
 * a push every three seconds for a mob).
 */
const DEPTH = '(v.crown - math.min(1.2, 0.45 * v.crown) * (1.0 - (v.strain >= 0.0 ? v.strain : math.pow(math.max(0.0, math.sin(q.anim_time * 120.0)), 2.0))))';

/**
 * The crowning animations: `crowning` for the mod's birth on her back, whose legs close for a moment
 * early in its 9-second loop (the baby draws back in then, unless it is nearly out), and
 * `crowning_free` for the rest (navel births, the Jenny girls, the slime's jelly).
 */
export function crowningAnimations() {
  const show = { scale: 'v.crowning ? v.crown_scale : 0.0' };
  const out = (/** @type {number} */ k) => [0, k === 1 ? `-${DEPTH}` : `-${DEPTH} * (v.push >= 0.8 ? 1.0 : ${k})`, 0];
  return {
    [`animation.${MOD}.crowning`]: {
      loop: true,
      animation_length: 9,
      bones: {
        crowning: show,
        crowning_slide: { position: { '0.0': out(1), '1.5': out(1), '1.65': out(0.15), '3.15': out(0.15), '3.3': out(1), '9.0': out(1) } },
      },
    },
    [`animation.${MOD}.crowning_free`]: {
      loop: true,
      bones: { crowning: show, crowning_slide: { position: [0, `-${DEPTH}`, 0] } },
    },
  };
}

/** The mod's fetus for a mother of each kind (FetusLayer: the baby's species and her creature type). */
export const FETUS_MODELS = {
  humanoid: ['HumanoidFetusModel', 'createDefaultLayer'],
  villager: ['HumanoidFetusModel', 'createVillagerLayer'],
  ender: ['HumanoidFetusModel', 'createEnderLayer'],
  humanoid_slime: ['HumanoidFetusModel', 'createSlimeLayer'],
  creeper: ['CreeperFetusModel', 'createBodyLayer'],
  slime: ['SlimeFetusModel', 'createBodyLayer'],
};

/**
 * How each of our females gives birth: the bones the opening hangs from, the opening, and the
 * mod's fetus model and texture for her babies. Navel births (the ender woman, the monster creeper
 * girl) come out of the front of her belly, so they are per belly size.
 */
export const FAMILY_CROWNING = {
  zombie_girl: { fetus: 'humanoid', texture: 'zombie_fetus', chain: ['body'], opening: 'crotch' },
  humanoid_creeper_girl: { fetus: 'humanoid', texture: 'humanoid_creeper_fetus', chain: ['body'], opening: 'crotch' },
  humanoid_slime_girl: { fetus: 'humanoid_slime', texture: 'humanoid_slime_fetus', chain: ['body'], opening: 'crotch', blend: true },
  monster_slime_girl: { fetus: 'slime', texture: 'slime_fetus', chain: ['leg', 'leg_part_1', 'leg_part_2'], opening: 'jelly', blend: true },
  ender_woman: { fetus: 'ender', texture: 'ender_fetus', chain: ['body', 'belly'], opening: 'navel' },
  monster_creeper_girl: { fetus: 'creeper', texture: 'creeper_fetus', chain: ['body', 'belly'], opening: 'navel' },
};

/** The player's babies: the model and texture of each species (the minepreggo:baby property's values after 'none'). */
export const PLAYER_BABIES = /** @type {const} */ ([
  ['human', 'humanoid', 'human_fetus'],
  ['zombie', 'humanoid', 'zombie_fetus'],
  ['creeper', 'humanoid', 'humanoid_creeper_fetus'],
  ['ender', 'humanoid', 'humanoid_ender_fetus'],
  ['slime', 'humanoid_slime', 'humanoid_slime_fetus'],
  ['villager', 'villager', 'villager_fetus'],
]);
export const BABY_PROPERTY = { type: 'enum', values: ['none', ...PLAYER_BABIES.map(([species]) => species)], default: 'none', client_sync: true };

/** Her bones from `names[0]` (a root) down to the last name, as in her geometry. */
export function chainOf(/** @type {any} */ geometry, /** @type {string[]} */ names) {
  return names.map((name) => {
    const bone = geometry.bones.find((/** @type {any} */ b) => b.name === name);
    if (!bone) throw new Error(`${geometry.description.identifier}: no bone ${name}`);
    return { name, ...(bone.parent ? { parent: bone.parent } : {}), pivot: bone.pivot, ...(bone.rotation ? { rotation: bone.rotation } : {}) };
  });
}

/**
 * Where the baby comes out, and which way.
 * - crotch: the bottom of the torso of a flat humanoid (her body bone), between the legs;
 * - jelly: the front of the monster slime girl's jelly;
 * - navel: the front of the belly of this size, where its front kick pushes out.
 * @returns {{ opening: number[], mount?: number[] }}
 */
export function openingOf(/** @type {any} */ geometry, /** @type {'crotch' | 'jelly' | 'navel'} */ kind) {
  const bone = (/** @type {string} */ name) => geometry.bones.find((/** @type {any} */ b) => b.name === name);
  const cubesOf = (/** @type {any} */ b) => (b?.cubes ?? []).filter((/** @type {any} */ c) => Array.isArray(c.size));
  if (kind === 'crotch') {
    const body = bone('body');
    const legs = ['right_leg', 'left_leg', 'rightLeg', 'leftLeg'].map(bone).filter(Boolean);
    const bottom = Math.min(...cubesOf(body).map((/** @type {any} */ c) => c.origin[1]), ...legs.map((/** @type {any} */ l) => l.pivot[1]));
    return { opening: [0, bottom, -0.5] };
  }
  if (kind === 'jelly') {
    const part = cubesOf(bone('leg_part_2'))[0];
    if (!part) throw new Error('the jelly has no leg_part_2 cube');
    return { opening: [0, round(part.origin[1] + part.size[1] * 0.75), part.origin[2]], mount: [-90, 0, 0] };
  }
  const front = cubesOf(bone('front_kick'))[0];
  if (!front) throw new Error(`${geometry.description.identifier}: no front kick`);
  return { opening: [0, round(front.origin[1] + front.size[1] / 2), front.origin[2]], mount: [-90, 0, 0] };
}
