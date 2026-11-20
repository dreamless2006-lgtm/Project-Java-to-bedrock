// Previews of the sixteen births (the births spec, section 8.1): every pregnant mob in her own birth,
// composed from the generated files the way the client composes her, drawn with
// tools/lib/geo-render.mjs and measured, so a posture, a rhythm or a way out can be judged before
// it reaches a device.
//
// What is composed for one moment of her birth:
//   * our six (tools/lib/mob-births.mjs): her idle (the loop controller), the pain controller's
//     state (the birth pose for her belly size, her crowning, her flair; override_previous_animation
//     honoured bone by bone) and the belly controller's state;
//   * the ten Jenny girls (tools/lib/girl-births.mjs): her own idle, her pose controller's state
//     (pose, flair, crowning), the shared newborn slide when its condition holds, and the belly
//     controller's state.
// Molang is evaluated with tools/lib/molang-lite.mjs after her pre_animation has run for a few
// seconds of frames (the crowning depth eases in), so v.push, v.crown, v.crowning, v.ninset, v.bp
// and q.anim_time are what the game would read. The birth timer of the creepers' flash follows the
// time of the state.
//
// Usage: node tools/render-births.mjs [all|minepreggo|jenny|<id>...] [--phase 4|7] [--push 0.3|0.85|0.97]
//          [--out <dir>] [--sheets all16,mothers,strips,crowning,navel,postbirth,metrics]
// <id> is a family (zombie_girl), a girl's short name (bee) or her entity id (jhbee24:bee). The
// pictures go to --out (default dist/preview/births, git-ignored: they show the mod's and the Jenny
// packs' textures). The metrics sheet prints the floor, exit and baby checks of section 8.1 and
// writes them to births_metrics.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { midPush } from './lib/birth-rhythm.mjs';
import { babyScale, measureBody } from './lib/belly-fit.mjs';
import { FETUS_SCALE, FAMILY_CROWNING } from './lib/crowning.mjs';
import { contactSheet, poseBones, renderParts, rotateBedrock } from './lib/geo-render.mjs';
import { GIRL_BIRTHS, girlBirthExit, restTime } from './lib/girl-births.mjs';
import { MOB_BIRTHS, MOB_FAMILIES } from './lib/mob-births.mjs';
import { evalMolang, runMolang } from './lib/molang-lite.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

/** @typedef {import('./lib/png.mjs').Image} Image */
/** @typedef {import('./lib/geo-render.mjs').Camera} Camera */
/** @typedef {import('./lib/birth-rhythm.mjs').Rhythm} Rhythm */
/** @typedef {{ rotation?: number[], position?: number[], scale?: number[] }} BonePose a bone's evaluated pose */
/** @typedef {Record<string, BonePose>} Pose */
/** @typedef {{ geometry: { description: any, bones: any[] }, texture: Image }} Part */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RP = join(ROOT, 'packs/resource');
const PORT = join(RP, 'animations/jenny_port');
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
/** The port's files carry // comments now and then. */
const readLoose = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const png = (/** @type {string} */ path) => decodePng(new Uint8Array(readFileSync(join(RP, `${path}.png`))));
const round = (/** @type {number} */ v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const norm = (/** @type {number[]} */ v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
/** The angle between two directions, in degrees. */
export const angle = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
  const u = norm(a), w = norm(b);
  return (Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1] + u[2] * w[2]))) * 180) / Math.PI;
};

/** The ten Jenny girls: entity id -> the file name of her client entity (entity/jenny_port/<file>.json). */
export const GIRL_FILES = /** @type {Record<string, string>} */ ({
  'fapcraft:jenny': 'jenny', 'kum:bia': 'bia', 'kum:slime_girl': 'slime', 'kum:luna': 'luna', 'kum:galath': 'galath',
  'jhallie4:allie': 'allie', 'kum:manglelie': 'manglelie', 'jhbee24:bee': 'bee', 'jhkobold:kobold': 'kobold', 'jhelliedev:ellie': 'ellie',
});
/** All sixteen, in sheet order: our six, then the ten girls by entity id. */
export const MOTHERS = /** @type {string[]} */ ([...MOB_FAMILIES, ...Object.keys(GIRL_FILES)]);
const slugOf = (/** @type {string} */ id) => id.split(':')[1].replace(/\W/g, '_');
/** A short name for labels and file names: the girl's own (bee), our families shortened (h_slime). */
export const shortName = (/** @type {string} */ id) =>
  GIRL_BIRTHS[id]?.name ?? id.replace('humanoid_', 'h_').replace('monster_', 'm_').replace('_girl', '').replace('_woman', '');
/** Turns a command-line name (family, short name or entity id) into ids. */
export function idsOf(/** @type {string[]} */ names) {
  if (!names.length || names.includes('all')) return MOTHERS;
  return [...new Set(names.flatMap((name) => {
    if (name === 'minepreggo') return [...MOB_FAMILIES];
    if (name === 'jenny' && !names.includes('all')) return Object.keys(GIRL_FILES);
    const id = MOTHERS.find((m) => m === name || shortName(m) === name || GIRL_FILES[m] === name);
    if (!id) throw new Error(`no mother called ${name} (one of: all, minepreggo, jenny, ${MOTHERS.map(shortName).join(', ')})`);
    return [id];
  }))];
}

/** Whether the generated files these previews read exist (`npm run import` and import-jenny have run). */
export function generated() {
  return existsSync(join(RP, 'animations/minepreggo/birth_poses.animation.json')) && existsSync(join(RP, 'models/entity/minepreggo/crowning'));
}
/** Whether the Jenny girls are imported (tools/import-jenny.mjs). */
export function girlsImported() {
  return existsSync(join(PORT, 'minepreggo')) && existsSync(join(RP, 'entity/jenny_port/bee.json'));
}

// ---- the definitions, read once ---------------------------------------------------------------------
/** @type {Record<string, any> | undefined} */
let animationIndex;
/** Every animation of the pack by id (the port's own files only when the girls are imported). */
function animations() {
  if (animationIndex) return animationIndex;
  /** @type {Record<string, any>} */
  const all = {};
  const take = (/** @type {string} */ dir, /** @type {boolean} */ deep) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (deep) take(path, deep);
      } else if (entry.name.endsWith('.json')) {
        try {
          Object.assign(all, readLoose(path).animations ?? {});
        } catch {
          // not an animation file this preview can read: validate.mjs reports ours
        }
      }
    }
  };
  take(join(RP, 'animations'), false);
  take(join(RP, 'animations/minepreggo'), false);
  take(PORT, true);
  animationIndex = all;
  return all;
}
/** @type {Record<string, any> | undefined} */
let controllerIndex;
/** Every animation controller by id. */
function controllers() {
  if (controllerIndex) return controllerIndex;
  /** @type {Record<string, any>} */
  const all = {};
  for (const file of ['animation_controllers/preggo_mob.animation_controllers.json', 'animation_controllers/belly.animation_controllers.json', 'animation_controllers/jenny_port/minepreggo_poses.animation_controllers.json']) {
    if (existsSync(join(RP, file))) Object.assign(all, read(join(RP, file)).animation_controllers);
  }
  controllerIndex = all;
  return all;
}
/** @type {Map<string, any> | undefined} */
let portGeometries;
/** The port's own geometries by id (not its stages, not our bellies: they are read per size). */
function portGeometry(/** @type {string} */ id) {
  if (!portGeometries) {
    portGeometries = new Map();
    const walk = (/** @type {string} */ dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'minepreggo') walk(path);
        } else if (entry.name.endsWith('.json') && !/stage/.test(entry.name)) {
          try {
            for (const g of readLoose(path)['minecraft:geometry'] ?? []) portGeometries?.set(g.description.identifier, g);
          } catch {
            // not a geometry file
          }
        }
      }
    };
    walk(join(RP, 'models/entity/jenny_port'));
  }
  return portGeometries.get(id);
}

// ---- a mother -----------------------------------------------------------------------------------------
/**
 * @typedef {object} Mother
 * @property {string} id her family or entity id
 * @property {string} name her short name
 * @property {'mob' | 'girl'} kind
 * @property {number} phase her belly size (P4..P9; the previews' bodies)
 * @property {any} d her client entity's description
 * @property {Rhythm} rhythm
 * @property {number[] | undefined} want the way out of the spec's table (world; her front is -z), if it names one
 * @property {number} exitAt the loop time the way out is aimed at (the middle of her first push)
 * @property {Part} body her body (the mob's model of this size, the girl's main geometry)
 * @property {Part} crown the geometry that carries the crowning bones (the mob's crowning geometry, the girl's belly of this size)
 * @property {Part[]} extra more parts drawn with her (the girl's belly is her crown part)
 * @property {string[]} pre her pre_animation, the birth timer driven by the state's time
 * @property {Map<string, Record<string, any>>} settled her variables after a few seconds of each state, by state and push
 */

/** Cache of mothers by id and size. */
const motherCache = new Map();

/**
 * One mother at one belly size, read from the generated files.
 * @param {string} id @param {number} phase
 * @returns {Mother}
 */
export function loadMother(id, phase) {
  const key = `${id}@${phase}`;
  const cached = motherCache.get(key);
  if (cached) return cached;
  const mother = MOB_BIRTHS[/** @type {keyof typeof MOB_BIRTHS} */ (id)] ? loadMob(id, phase) : loadGirl(id, phase);
  motherCache.set(key, mother);
  return mother;
}

/** One of our six. */
function loadMob(/** @type {string} */ family, /** @type {number} */ phase) {
  const spec = MOB_BIRTHS[/** @type {keyof typeof MOB_BIRTHS} */ (family)];
  const d = read(join(RP, 'entity', `${family}.entity.json`))['minecraft:client_entity'].description;
  const models = join(RP, 'models/entity/minepreggo');
  const crowning = FAMILY_CROWNING[/** @type {keyof typeof FAMILY_CROWNING} */ (family)];
  const texture = png(`${d.textures.default}_p${phase}`);
  // the ender woman is nearly black: lifted so her pose reads in the previews
  if (family === 'ender_woman') for (let i = 0; i < texture.data.length; i += 4) for (let k = 0; k < 3; k++) texture.data[i + k] = Math.min(255, 70 + texture.data[i + k] * 2.2);
  const crownFile = crowning.opening === 'navel' ? `${family}_crowning_p${Math.max(4, phase)}.geo.json` : `${family}_crowning.geo.json`;
  return /** @type {Mother} */ ({
    id: family,
    name: shortName(family),
    kind: 'mob',
    phase,
    d,
    rhythm: spec.rhythm,
    want: spec.exitWant,
    exitAt: spec.exitAt ?? midPush(spec.rhythm, 0),
    body: { geometry: read(join(models, `${family}_p${phase}.geo.json`))['minecraft:geometry'][0], texture },
    crown: { geometry: read(join(models, 'crowning', crownFile))['minecraft:geometry'][0], texture: png(`textures/minepreggo/entity/fetus/${crowning.texture}`) },
    extra: [],
    // the birth timer is the time of the state (the game counts it frame by frame from the state's start)
    pre: d.scripts.pre_animation,
    settled: new Map(),
  });
}

/** One of the Jenny girls. */
function loadGirl(/** @type {string} */ id, /** @type {number} */ phase) {
  const file = GIRL_FILES[id];
  const spec = GIRL_BIRTHS[id];
  if (!file || !spec) throw new Error(`no mother ${id}`);
  const d = read(join(RP, 'entity/jenny_port', `${file}.json`))['minecraft:client_entity'].description;
  const key = ['default', 'normal', 'dressed'].find((k) => d.geometry?.[k]);
  const tkey = ['default', 'normal', 'dressed'].find((k) => d.textures?.[k]);
  if (!key || !tkey) throw new Error(`${id}: no main geometry or texture`);
  const geometry = portGeometry(d.geometry[key]);
  if (!geometry) throw new Error(`${id}: geometry ${d.geometry[key]} not found`);
  const belly = read(join(RP, 'models/entity/jenny_port/minepreggo', `${slugOf(id)}_0_belly_p${phase}.geo.json`))['minecraft:geometry'][0];
  const body = measureBody(geometry);
  const egg = id === 'jhkobold:kobold';
  const scale = FETUS_SCALE * babyScale(/** @type {any} */ (body));
  const birth = animations()[d.animations.mp_pose_birth];
  const exit = girlBirthExit({ spec, geometry, animation: birth, body: /** @type {any} */ (body), scale, egg });
  return /** @type {Mother} */ ({
    id,
    name: spec.name,
    kind: 'girl',
    phase,
    d,
    rhythm: spec.rhythm,
    want: exit.want,
    exitAt: exit.at,
    body: { geometry, texture: png(d.textures[tkey]) },
    crown: { geometry: belly, texture: png(d.textures.minepreggo_belly) },
    extra: [],
    pre: d.scripts.pre_animation,
    settled: new Map(),
  });
}

// ---- composing a moment ---------------------------------------------------------------------------------
/** Her queries for a moment of `state`, `push` into the baby being born. */
function queries(/** @type {Mother} */ m, /** @type {string} */ state, /** @type {number} */ push) {
  const props = /** @type {Record<string, any>} */ ({
    'minepreggo:phase': m.phase,
    'minepreggo:pose': state,
    'minepreggo:kick': state === 'birth' || state === 'prebirth' ? 2 : 0,
    'minepreggo:growth': state === 'birth' ? push : 1,
    'minepreggo:savage': 0,
    'minepreggo:belly': `p${m.phase}`,
    'minepreggo:scene': 'none',
  });
  return {
    property: (/** @type {string} */ name) => props[name],
    is_tamed: 1, delta_time: 0.05, life_time: 100, variant: m.phase + 1, has_target: 0, is_on_ground: 1, fuse_time: -1,
    position_delta: () => 0, modified_move_speed: 0, is_sitting: 0, is_riding: 0, skin_id: 0,
  };
}

/** Her variables at time t of a state: settled once per state and push, then one frame at t. */
function variables(/** @type {Mother} */ m, /** @type {string} */ state, /** @type {number} */ t, /** @type {number} */ push) {
  const q = queries(m, state, push);
  const key = `${state}|${push}`;
  let base = m.settled.get(key);
  if (!base) {
    base = {};
    for (const line of m.d.scripts.initialize ?? []) runMolang([line], { v: base, q });
    runMolang(m.pre, { v: base, q }, { frames: 80 });
    m.settled.set(key, base);
  }
  const v = { ...base };
  // the birth timer (the creepers' flash) is the time of the state
  const lines = m.pre.map((line) => (line.startsWith('v.bt =') ? `v.bt = ${state === 'birth' ? t : 0};` : line));
  runMolang(lines, { v, q: { ...q, life_time: 100 + t } });
  return { v, q };
}

/** One channel at time t: keyframes interpolated, Molang evaluated, a single value for all three axes. */
function channelAt(/** @type {any} */ channel, /** @type {number} */ t, /** @type {(x: unknown) => number} */ value) {
  if (channel === undefined) return undefined;
  const triple = (/** @type {any} */ v) => (Array.isArray(v) ? [value(v[0]), value(v[1]), value(v[2])] : [value(v), value(v), value(v)]);
  if (Array.isArray(channel) || typeof channel !== 'object') return triple(channel);
  const frames = Object.entries(channel).map(([k, v]) => ({ t: Number(k), v })).sort((a, b) => a.t - b.t);
  const side = (/** @type {any} */ v, /** @type {'pre' | 'post'} */ which) => triple(Array.isArray(v) || typeof v !== 'object' ? v : v[which] ?? v.post ?? v.pre);
  if (t <= frames[0].t) return side(frames[0].v, 'pre');
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      const va = side(a.v, 'post'), vb = side(b.v, 'pre');
      return va.map((x, k) => x + (vb[k] - x) * f);
    }
  }
  return side(frames[frames.length - 1].v, 'post');
}

/**
 * An animation's pose at `time` seconds of playing (a loop with a length starts over), weighted.
 * @param {any} animation @param {number} time @param {{ v: Record<string, any>, q: Record<string, any> }} env @param {number} [weight]
 */
function sample(animation, time, env, weight = 1) {
  const length = Number(animation.animation_length ?? 0);
  const t = animation.loop === true && length > 0 ? time % length : animation.loop === 'hold_on_last_frame' && length > 0 ? Math.min(time, length) : time;
  const q = Object.create(env.q);
  q.anim_time = t;
  const value = (/** @type {unknown} */ x) => (typeof x === 'number' ? x : evalMolang(x, { v: env.v, q }));
  /** @type {Pose} */
  const pose = {};
  for (const [bone, channels] of Object.entries(animation.bones ?? {})) {
    /** @type {BonePose} */
    const p = {};
    const r = channelAt(channels.rotation, t, value), pos = channelAt(channels.position, t, value), s = channelAt(channels.scale, t, value);
    if (r) p.rotation = r.map((x) => x * weight);
    if (pos) p.position = pos.map((x) => x * weight);
    if (s) p.scale = s.map((x) => 1 + (x - 1) * weight);
    pose[bone] = p;
  }
  return { pose, override: !!animation.override_previous_animation };
}

/** Adds an animation's pose to the composed one: summed per axis, or replacing the bones it keys. */
function accumulate(/** @type {Pose} */ out, /** @type {{ pose: Pose, override: boolean }} */ { pose, override }) {
  for (const [bone, p] of Object.entries(pose)) {
    if (override) delete out[bone];
    const o = (out[bone] ??= {});
    if (p.rotation) o.rotation = p.rotation.map((v, k) => v + (o.rotation?.[k] ?? 0));
    if (p.position) o.position = p.position.map((v, k) => v + (o.position?.[k] ?? 0));
    if (p.scale) o.scale = p.scale.map((v, k) => v * (o.scale?.[k] ?? 1));
  }
}

/** A controller state's (or animate list's) entries with their weights, the ones that play. */
function entries(/** @type {any[]} */ list, /** @type {{ v: any, q: any }} */ env) {
  return list
    .flatMap((e) => (typeof e === 'string' ? [[e, 1]] : Object.entries(e).map(([name, c]) => [name, evalMolang(c, env)])))
    .filter(([, w]) => /** @type {number} */ (w) > 0);
}

/**
 * Her composed pose at time t of a labor state ('birth', 'postbirth', 'prebirth', ...), `push`
 * into the baby being born (the minepreggo:growth property during the birth).
 * @param {Mother} m @param {string} state @param {number} t @param {number} [push]
 * @returns {{ pose: Pose, v: Record<string, any> }}
 */
export function compose(m, state, t, push = 0.6) {
  const env = variables(m, state, t, push);
  const A = m.d.animations;
  const all = animations();
  const ctrl = controllers();
  /** @type {Pose} */
  const out = {};
  const play = (/** @type {string} */ name, /** @type {number} */ weight) => {
    const anim = A[name] ? all[A[name]] : undefined;
    if (anim) accumulate(out, sample(anim, t, env, weight));
  };
  if (m.kind === 'mob') {
    // the loop controller's idle (she is not riding or sitting), then her labor state
    play('idle', 1);
    for (const [name, w] of entries(ctrl['controller.animation.minepreggo.preggo_mob.pain'].states[state]?.animations ?? [], env)) play(name, w);
  } else {
    const idle = (m.d.scripts.animate ?? []).find((/** @type {any} */ a) => a && typeof a === 'object' && 'idle' in a);
    if (!idle || evalMolang(idle.idle, env) > 0) play('idle', 1);
    for (const [name, w] of entries(ctrl[A.mp_pose_controller]?.states[state]?.animations ?? [], env)) play(name, w);
    const newborn = (m.d.scripts.animate ?? []).find((/** @type {any} */ a) => a === 'newborn' || (a && typeof a === 'object' && 'newborn' in a));
    if (newborn && (typeof newborn === 'string' || evalMolang(newborn.newborn, env) > 0)) play('newborn', 1);
  }
  for (const [name, w] of entries(ctrl[A.belly_controller]?.states[`p${m.phase}`]?.animations ?? [], env)) play(name, w);
  return { pose: out, v: env.v };
}

// ---- measuring ----------------------------------------------------------------------------------------------
/**
 * Bones whose subtree is not a limb on the floor: the belly (measured on its own), the baby, hair,
 * the Kobold's tongue and Allie's smoke tail (section 8.1 lets it pass through the floor).
 */
function skipped(/** @type {Mother} */ m) {
  const allie = m.id === 'jhallie4:allie';
  return (/** @type {string} */ name) => /^(belly|crowning)$/.test(name) || /hair/i.test(name) || /^toung?e/i.test(name) || (allie && /^tail/.test(name));
}
/** Whether a bone or one of its parents passes a test of its name. */
function under(/** @type {{ bones: any[] }} */ geometry, /** @type {(name: string) => boolean} */ test) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  return (/** @type {any} */ bone) => {
    for (let b = bone; b; b = b.parent ? byName.get(b.parent) : undefined) if (test(b.name)) return true;
    return false;
  };
}
/** The lowest point of every bone with cubes under a pose (cube rotations and inflate included). */
export function boneLows(/** @type {{ bones: any[] }} */ geometry, /** @type {Pose} */ pose, /** @type {(bone: any) => boolean} */ keep = () => true) {
  const transforms = poseBones(geometry, /** @type {any} */ (pose));
  /** @type {[string, number][]} */
  const out = [];
  for (const bone of geometry.bones) {
    if (!bone.cubes?.length || !keep(bone)) continue;
    const toWorld = transforms.get(bone.name);
    if (!toWorld) continue;
    let low = Infinity;
    for (const cube of bone.cubes) {
      if (!Array.isArray(cube.size)) continue;
      const inflate = typeof cube.inflate === 'number' ? cube.inflate : 0;
      const lo = cube.origin.map((/** @type {number} */ o) => o - inflate);
      const hi = cube.origin.map((/** @type {number} */ o, /** @type {number} */ k) => o + cube.size[k] + inflate);
      for (let n = 0; n < 8; n++) {
        let p = [n & 1 ? hi[0] : lo[0], n & 2 ? hi[1] : lo[1], n & 4 ? hi[2] : lo[2]];
        if (Array.isArray(cube.pivot) && Array.isArray(cube.rotation)) p = rotateBedrock(p.map((x, k) => x - cube.pivot[k]), cube.rotation).map((x, k) => x + cube.pivot[k]);
        low = Math.min(low, toWorld(p)[1]);
      }
    }
    out.push([bone.name, low]);
  }
  return out;
}

/**
 * What section 8.1 checks at one moment: her lowest limb (and which), her belly's lowest point,
 * where the baby comes out (the posed crowning pivot), the way it comes out (the posed mount's -y)
 * and the lowest point of the baby.
 * @param {Mother} m @param {Pose} pose
 */
export function measure(m, pose) {
  const skip = under(m.body.geometry, skipped(m));
  let limb = Infinity, limbBone = '';
  for (const [name, y] of boneLows(m.body.geometry, pose, (b) => !skip(b))) if (y < limb) [limb, limbBone] = [y, name];
  const bellyGeometry = m.kind === 'mob' ? m.body.geometry : m.crown.geometry;
  const inBelly = under(bellyGeometry, (name) => name === 'belly');
  const baby = under(bellyGeometry, (name) => name === 'crowning' || /^baby\d/.test(name));
  const belly = Math.min(Infinity, ...boneLows(bellyGeometry, pose, (b) => inBelly(b) && !baby(b)).map(([, y]) => y));
  const transforms = poseBones(m.crown.geometry, /** @type {any} */ (pose));
  const mount = m.crown.geometry.bones.find((/** @type {any} */ b) => b.name === 'crowning');
  const toWorld = /** @type {(p: number[]) => number[]} */ (transforms.get('crowning'));
  const opening = toWorld(mount.pivot);
  const exit = norm(toWorld(mount.pivot.map((/** @type {number} */ x, /** @type {number} */ k) => x - (k === 1 ? 1 : 0))).map((x, k) => x - opening[k]));
  const inBaby = under(m.crown.geometry, (name) => name === 'crowning_baby');
  const lows = boneLows(m.crown.geometry, pose, inBaby).map(([, y]) => y);
  return { limb, limbBone, belly, opening, exit, babyLow: lows.length ? Math.min(...lows) : NaN };
}

/** The moments of her loop worth looking at: between pushes, early in a push, its peak, the gate or the second push. */
export function keyTimes(/** @type {Mother} */ m) {
  const { rhythm } = m;
  const [p0, p1] = rhythm.pushes;
  const r = (/** @type {number} */ v) => round(v);
  /** @type {[string, number][]} */
  const times = [['rest', restTime(rhythm)], ['push start', r(p0[0] + 0.3)], ['push peak', midPush(rhythm, 0)]];
  if (rhythm.gates?.length) times.push(['gate', r((rhythm.gates[0][0] + rhythm.gates[0][1]) / 2)]);
  else times.push(p1 ? ['push 2', midPush(rhythm, 1)] : ['late push', r(p0[1] - 0.3)]);
  return times;
}

// ---- drawing ------------------------------------------------------------------------------------------------
/** A tiny 3x5 font for labels. */
const GLYPHS = /** @type {Record<string, string>} */ ({
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', '.': '000000000000010', '=': '000111000111000', '-': '000000111000000', _: '000000000000111', ' ': '000000000000000', '/': '001001010100100', ':': '000010000010000',
});
/** Writes a label into an image. */
function label(/** @type {Image} */ img, /** @type {string} */ text, x0 = 3, y0 = 3, k = 2, color = [255, 230, 120]) {
  let x = x0;
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1') {
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        const px = x + c * k + dx, py = y0 + r * k + dy;
        if (px >= 0 && py >= 0 && px < img.width && py < img.height) img.data.set([...color, 255], (py * img.width + px) * 4);
      }
    }
    x += 4 * k;
  }
  return img;
}
/** The camera's projection of a model point onto the image (as geo-render's rasterizer projects it). */
function projector(/** @type {Camera} */ camera, /** @type {number} */ width, /** @type {number} */ height) {
  const DEG = Math.PI / 180;
  const yaw = camera.yaw * DEG, pitch = camera.pitch * DEG;
  const right = [Math.cos(yaw), 0, Math.sin(yaw)];
  const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
  const center = camera.center ?? [0, 0, 0];
  return (/** @type {number[]} */ p) => {
    const rel = p.map((v, k) => v - center[k]);
    const dot = (/** @type {number[]} */ a) => a[0] * rel[0] + a[1] * rel[1] + a[2] * rel[2];
    return [width / 2 + dot(right) * camera.scale, height / 2 - dot(up) * camera.scale];
  };
}
/** A line drawn over an image (2 px wide). */
function line(/** @type {Image} */ img, /** @type {number[]} */ a, /** @type {number[]} */ b, color = [255, 40, 40]) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) if (x + dx >= 0 && y + dy >= 0 && x + dx < img.width && y + dy < img.height) img.data.set([...color, 255], ((y + dy) * img.width + x + dx) * 4);
  }
}

/** Her parts for a moment: the body (flashing white with the creepers' flash), the crowning while shown, her belly. */
function partsOf(/** @type {Mother} */ m, /** @type {Record<string, any>} */ v, { hideBelly = false } = {}) {
  let texture = m.body.texture;
  if (v.flash > 0) {
    texture = { ...texture, data: Uint8Array.from(texture.data) };
    for (let i = 0; i < texture.data.length; i += 4) for (let k = 0; k < 3; k++) texture.data[i + k] = Math.round(texture.data[i + k] + (255 - texture.data[i + k]) * v.flash);
  }
  const bellyBones = (/** @type {{ bones: any[] }} */ g) => {
    const inBelly = under(g, (name) => name === 'belly'), baby = under(g, (name) => name === 'crowning');
    return g.bones.filter((b) => inBelly(b) && !baby(b)).map((b) => b.name);
  };
  if (m.kind === 'mob') {
    const parts = [{ geometry: m.body.geometry, texture, hidden: hideBelly ? ['belly'] : [] }];
    if (v.crowning) parts.push({ geometry: m.crown.geometry, texture: m.crown.texture, hidden: [] });
    return parts;
  }
  return [{ geometry: m.body.geometry, texture, hidden: [] }, { geometry: m.crown.geometry, texture: m.crown.texture, hidden: hideBelly ? bellyBones(m.crown.geometry) : [] }];
}

/** The view along each mother's way out (to judge the exit arrow against the table). */
const EXIT_VIEW = /** @type {Record<string, { yaw: number, pitch: number }>} */ ({
  zombie_girl: { yaw: 150, pitch: -5 }, humanoid_creeper_girl: { yaw: 20, pitch: 50 }, humanoid_slime_girl: { yaw: 40, pitch: 8 },
  monster_creeper_girl: { yaw: 0, pitch: 80 }, monster_slime_girl: { yaw: 40, pitch: 10 }, ender_woman: { yaw: 90, pitch: 30 },
  jenny: { yaw: 25, pitch: 20 }, bia: { yaw: 30, pitch: -5 }, slime: { yaw: 40, pitch: 10 }, luna: { yaw: 150, pitch: 10 }, galath: { yaw: 40, pitch: 10 },
  allie: { yaw: 30, pitch: -10 }, manglelie: { yaw: 20, pitch: 25 }, bee: { yaw: 30, pitch: -10 }, kobold: { yaw: 150, pitch: 5 }, ellie: { yaw: 30, pitch: -10 },
});
const SIDE = { yaw: 90, pitch: 6 };
const FRONT_SIDE = { yaw: 35, pitch: 20 };
/** A view by name. */
const viewOf = (/** @type {Mother} */ m, /** @type {string} */ view) => (view === 'side' ? SIDE : view === 'front' ? FRONT_SIDE : EXIT_VIEW[m.name] ?? FRONT_SIDE);

/**
 * One picture of her: the floor's cross (blue), and with `arrow` the way out at full depth (red,
 * from the opening along the posed mount's -y) beside the table's (green).
 * @param {Mother} m @param {Pose} pose @param {Record<string, any>} v @param {Camera} camera @param {{ width: number, height: number }} size
 * @param {{ arrow?: boolean, hideBelly?: boolean, exit?: number[] }} [options] exit: the arrow's direction (default: as posed now)
 */
function render(m, pose, v, camera, size, { arrow = false, hideBelly = false, exit } = {}) {
  const img = renderParts(/** @type {any} */ (partsOf(m, v, { hideBelly })), /** @type {any} */ (pose), camera, size);
  const P = projector(camera, size.width, size.height);
  line(img, P([-16, 0, 0]), P([16, 0, 0]), [80, 200, 255]);
  line(img, P([0, 0, -16]), P([0, 0, 16]), [80, 200, 255]);
  if (arrow) {
    const at = measure(m, pose);
    if (m.want) line(img, P(at.opening), P(at.opening.map((x, k) => x + norm(/** @type {number[]} */ (m.want))[k] * 12)), [60, 255, 60]);
    const dir = exit ?? at.exit;
    line(img, P(at.opening), P(at.opening.map((x, k) => x + dir[k] * 12)));
  }
  return img;
}

/** The way out as posed with the baby all the way out (a turning mount is fully turned then). */
export function exitAtFullDepth(/** @type {Mother} */ m) {
  const { pose } = compose(m, 'birth', m.exitAt, 1.0);
  return measure(m, pose);
}

// ---- the sheets ------------------------------------------------------------------------------------------------
/**
 * @typedef {object} SheetOptions
 * @property {string[]} ids the mothers to draw
 * @property {number} phase
 * @property {number} push the push level of the posture sheets
 * @property {string} out the folder to write to
 */

/** Writes a sheet and says where. */
function write(/** @type {string} */ out, /** @type {string} */ name, /** @type {Image} */ img) {
  mkdirSync(out, { recursive: true });
  const file = join(out, name);
  writeFileSync(file, encodePng(img));
  console.log('wrote', file);
  return file;
}

/** All sixteen at the peak of the first push: side, front-side and the exit view. */
export function sheetAll16(/** @type {SheetOptions} */ { ids, phase, push, out }) {
  const size = { width: 150, height: 150 };
  const images = [];
  for (const view of ['side', 'front', 'exit']) {
    for (const id of ids) {
      const m = loadMother(id, phase);
      const t = midPush(m.rhythm, 0);
      const { pose, v } = compose(m, 'birth', t, push);
      const img = render(m, pose, v, { ...viewOf(m, view), scale: 2.4, center: [0, 11, 0] }, size, { arrow: view === 'exit', exit: view === 'exit' ? exitAtFullDepth(m).exit : undefined });
      label(img, m.name);
      label(img, `${view} ${t}`, 3, size.height - 13, 2, [160, 220, 255]);
      images.push(img);
    }
  }
  return write(out, `births_all16_side_p${phase}.png`, contactSheet(images, ids.length));
}

/** One family of mothers (our six, or the girls): rest, push start, push peak, gate or second push; three views each. */
export function sheetMothers(/** @type {SheetOptions} */ { ids, phase, push, out }, /** @type {string} */ name) {
  const size = { width: 170, height: 170 };
  const images = [];
  for (let row = 0; row < 4; row++) {
    for (const view of ['side', 'front', 'exit']) {
      for (const id of ids) {
        const m = loadMother(id, phase);
        const [moment, t] = keyTimes(m)[row];
        const { pose, v } = compose(m, 'birth', t, push);
        const img = render(m, pose, v, { ...viewOf(m, view), scale: 2.6, center: [0, 11.5, 0] }, size, { arrow: view === 'exit' });
        label(img, m.name);
        label(img, `${moment} ${t}`, 3, size.height - 13, 2, [160, 220, 255]);
        images.push(img);
      }
    }
  }
  return write(out, `births_${name}_p${phase}.png`, contactSheet(images, ids.length));
}

/** Her loop in 13 frames (t = 0..L in L/12 steps), side and exit view, with the crowning slide. */
export function sheetStrip(/** @type {SheetOptions} */ { phase, push, out }, /** @type {string} */ id) {
  const m = loadMother(id, phase);
  const L = m.rhythm.length;
  const size = { width: 150, height: 150 };
  const images = [];
  for (const view of ['side', 'exit']) {
    for (let i = 0; i <= 12; i++) {
      const t = round((L * i) / 12);
      const { pose, v } = compose(m, 'birth', t, push);
      const img = render(m, pose, v, { ...viewOf(m, view), scale: 2.3, center: [0, 11.5, 0] }, size, { arrow: view === 'exit' });
      label(img, `t=${t}`);
      label(img, `s=${round(pose.crowning_slide?.position?.[1] ?? 0, 1)} p=${push}`, 3, size.height - 13, 2, [160, 220, 255]);
      images.push(img);
    }
  }
  return write(out, `birth_strip_${m.name}.png`, contactSheet(images, 13));
}

/** The crotch births (zombie, humanoid slime, humanoid creeper, the ten girls): the baby at push 0.3 / 0.85 / 0.97 / 1.0, close up along the way out. */
export function sheetCrowning(/** @type {SheetOptions} */ { ids, phase, out }) {
  const size = { width: 180, height: 170 };
  const images = [];
  const crotch = ids.filter((id) => !['monster_creeper_girl', 'monster_slime_girl', 'ender_woman'].includes(id));
  for (const id of crotch) {
    const m = loadMother(id, phase);
    for (const push of [0.3, 0.85, 0.97, 1.0]) {
      const { pose, v } = compose(m, 'birth', m.exitAt, push);
      const at = measure(m, pose);
      const view = m.kind === 'mob' ? EXIT_VIEW[m.name] : EXIT_VIEW[m.name];
      const img = render(m, pose, v, { ...view, scale: 4, center: [at.opening[0], Math.max(5, at.opening[1] - 3), at.opening[2]] }, size, { arrow: true, hideBelly: true });
      label(img, `${m.name} p=${push}`);
      label(img, `low ${round(at.babyLow, 1)} d=${round(v.crown ?? 0, 1)}`, 3, size.height - 13, 2, [160, 220, 255]);
      images.push(img);
    }
  }
  return write(out, 'crowning_crotch.png', contactSheet(images, 4));
}

/** The navel births (ender woman, monster creeper girl) at every size P4..P9: side, top and back views at push 0.3 and 0.85. */
export function sheetNavel(/** @type {SheetOptions} */ { out }) {
  const size = { width: 180, height: 170 };
  const files = [];
  for (const phase of [4, 5, 6, 7, 8, 9]) {
    const images = [];
    for (const id of ['ender_woman', 'monster_creeper_girl']) {
      const m = loadMother(id, phase);
      const t = midPush(m.rhythm, 0);
      for (const view of [{ yaw: 90, pitch: 6 }, { yaw: 0, pitch: 85 }, { yaw: -90, pitch: 6 }]) {
        for (const push of [0.3, 0.85]) {
          const { pose, v } = compose(m, 'birth', t, push);
          const at = measure(m, pose);
          const img = render(m, pose, v, { ...view, scale: 5, center: at.opening }, size);
          label(img, `${m.name} p${phase} push ${push}`);
          label(img, `y${view.yaw} ninset ${round(v.ninset ?? 0, 2)}`, 3, size.height - 13, 2, [160, 220, 255]);
          images.push(img);
        }
      }
    }
    files.push(write(out, `crowning_navel_p${phase}.png`, contactSheet(images, 6)));
  }
  return files;
}

/** The relaxed postbirths: the girls, and the humanoid slime girl beside the creeper girl (whose base she shared). */
export function sheetPostbirth(/** @type {SheetOptions} */ { ids, out }) {
  const size = { width: 160, height: 160 };
  const files = [];
  const girls = ids.filter((id) => GIRL_FILES[id]);
  if (girls.length) {
    const images = [];
    for (const phase of [4, 7]) for (const view of [SIDE, FRONT_SIDE]) for (const id of girls) {
      const m = loadMother(id, phase);
      const { pose, v } = compose(m, 'postbirth', 1, 0);
      const img = render(m, pose, v, { ...view, scale: 2.5, center: [0, 11.5, 0] }, size);
      label(img, `${m.name} p${phase}`);
      images.push(img);
    }
    files.push(write(out, 'postbirth_jenny.png', contactSheet(images, girls.length)));
  }
  if (ids.includes('humanoid_slime_girl')) {
    const images = [];
    for (const phase of [4, 7]) for (const id of ['humanoid_slime_girl', 'humanoid_creeper_girl']) for (const t of [0, 2]) for (const view of [SIDE, FRONT_SIDE]) {
      const m = loadMother(id, phase);
      const { pose, v } = compose(m, 'postbirth', t, 0);
      const img = render(m, pose, v, { ...view, scale: 2.8, center: [0, 10, 0] }, size);
      label(img, `${m.name} p${phase} t${t}`);
      images.push(img);
    }
    files.push(write(out, 'postbirth_hslime.png', contactSheet(images, 4)));
  }
  return files;
}

/**
 * The numbers of section 8.1 for one mother at one size: her lowest limb and belly over the loop
 * (between pushes and in them), the way out at full depth against the table, and the baby's lowest
 * point at full depth.
 * @param {string} id @param {number} phase
 */
export function metricsOf(id, phase) {
  const m = loadMother(id, phase);
  const L = m.rhythm.length;
  let limb = { y: Infinity, bone: '', t: 0 }, belly = { y: Infinity, t: 0 };
  for (let t = 0; t <= L + 1e-6; t += 0.1) {
    for (const push of [0.05, 0.6]) {
      const at = measure(m, compose(m, 'birth', round(t), push).pose);
      if (at.limb < limb.y) limb = { y: at.limb, bone: at.limbBone, t: round(t) };
      if (at.belly < belly.y) belly = { y: at.belly, t: round(t) };
    }
  }
  const full = exitAtFullDepth(m);
  return {
    id,
    name: m.name,
    phase,
    limb: { y: round(limb.y), bone: limb.bone, t: limb.t },
    belly: { y: round(belly.y), t: belly.t },
    exit: full.exit.map((x) => round(x, 3)),
    want: m.want ? norm(m.want).map((x) => round(x, 3)) : null,
    exitOff: m.want ? round(angle(full.exit, m.want), 1) : null,
    babyLow: round(full.babyLow),
  };
}

/** Prints and writes the metrics of the chosen mothers at P4, P7 and P9. */
export function sheetMetrics(/** @type {SheetOptions} */ { ids, out }) {
  const rows = [];
  for (const id of ids) {
    for (const phase of [4, 7, 9]) {
      const r = metricsOf(id, phase);
      rows.push(r);
      const exit = r.exitOff === null ? `exit [${r.exit}] (as the mod has it)` : `exit ${r.exitOff} deg off`;
      console.log(`${r.name.padEnd(10)} p${phase}  limbs ${String(r.limb.y).padStart(6)} (${r.limb.bone} t=${r.limb.t})  belly ${String(r.belly.y).padStart(6)} (t=${r.belly.t})  ${exit}  baby low ${r.babyLow}`);
    }
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, 'births_metrics.json');
  writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
  console.log('wrote', file);
  return rows;
}

// ---- the command line ----------------------------------------------------------------------------------------
/** Reads the arguments: mothers by name, --phase, --push, --out, --sheets. */
function parseArgs(/** @type {string[]} */ argv) {
  const names = [];
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      flags[k] = inline ?? argv[++i];
    } else names.push(a);
  }
  return { names, flags };
}

async function main() {
  const { names, flags } = parseArgs(process.argv.slice(2));
  if (!generated()) {
    console.error('The generated births are missing: run `npm run import` (or gen-birth-poses, import-jenny and gen-belly-render) first.');
    process.exit(1);
  }
  let ids = idsOf(names);
  if (!girlsImported()) {
    const skipped = ids.filter((id) => GIRL_FILES[id]);
    if (skipped.length) console.warn(`note: the Jenny girls are not imported (tools/import-jenny.mjs): ${skipped.map(shortName).join(', ')} left out`);
    ids = ids.filter((id) => !GIRL_FILES[id]);
  }
  const phase = Number(flags.phase ?? 7);
  const push = Number(flags.push ?? 0.6);
  const out = flags.out ?? join(ROOT, 'dist/preview/births');
  const sheets = new Set((flags.sheets ?? 'all16,mothers,strips,crowning,navel,postbirth,metrics').split(','));
  const options = { ids, phase, push, out };
  const mobs = ids.filter((id) => !GIRL_FILES[id]);
  const girls = ids.filter((id) => GIRL_FILES[id]);
  if (sheets.has('all16')) sheetAll16(options);
  if (sheets.has('mothers')) {
    if (mobs.length) sheetMothers({ ...options, ids: mobs }, 'minepreggo');
    if (girls.length) sheetMothers({ ...options, ids: girls }, 'jenny');
  }
  if (sheets.has('strips')) for (const id of ids) sheetStrip(options, id);
  if (sheets.has('crowning')) sheetCrowning(options);
  if (sheets.has('navel') && ids.includes('ender_woman') && ids.includes('monster_creeper_girl')) sheetNavel(options);
  if (sheets.has('postbirth')) sheetPostbirth(options);
  if (sheets.has('metrics')) sheetMetrics(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
