// What a pregnant player looks like on a game whose player model is not ours (Actions & Stuff, or
// any other pack that replaces the minecraft:player client entity). Two pieces live here, both pure:
//
// * The compat copies of our pose animations that packs/behavior/scripts/player/compat.js plays on
//   every player near her (animation.minepreggo.as.<name>). Our poses are additive, so on our own
//   model a second copy would double every rotation, and the labor poses use catmull-rom keyframes,
//   which the game refuses to mix with Molang, so a keyframe-level gate is impossible. The gate is
//   therefore the whole animation's blend_weight: 0 wherever our model draws her (variable.mp_native
//   is 1 from its first frame and undefined, so 0, on every other model) and in first person (the
//   engine sets variable.is_first_person on every player model, so her own arms never swing across
//   her screen). Only the vanilla humanoid bones are kept: the belly, kick and chest bones belong to
//   the off-hand belly's attachable now, and a channel on a bone another model lacks is dead weight.
//   Keyframes are copied verbatim, so the copy moves exactly as the original wherever it plays.
//
// * The stand-in player entity for testing without Actions & Stuff (a paid, encrypted Marketplace
//   pack): our own player client entity with everything of Minepreggo taken out, which is what a
//   game with another player model above ours draws (tools/gen/standin-pack.mjs packs it).

export const VANILLA_BONES = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

/** The id prefix of our player poses, and of their compat copies. */
export const SOURCE_PREFIX = 'animation.minepreggo.player.';
export const COMPAT_PREFIX = 'animation.minepreggo.as.';

/** The generated labor poses (tools/import-jar.mjs, git-ignored) and the tracked player poses. */
export const LABOR_FILE = 'animations/minepreggo/player_labor.animation.json';
export const PLAYER_FILE = 'animations/player.animation.json';
/** Where tools/gen/compat-poses.mjs writes the copies (git-ignored like the poses they come from). */
export const COMPAT_FILE = 'animations/minepreggo/player_compat.animation.json';

/**
 * Every pose player/compat.js can play, by its name without SOURCE_PREFIX, with the resource pack
 * file it comes from. The heavy walk only shows while she walks, so it gets a movement gate too.
 * @type {{ name: string, file: string, walk: boolean }[]}
 */
export const COMPAT_SOURCES = [
  ...['labor_water_breaking', 'labor_prebirth', 'labor_birth', 'labor_postbirth', 'labor_miscarriage'].map((name) => ({ name, file: LABOR_FILE, walk: false })),
  { name: 'back_pain', file: PLAYER_FILE, walk: false },
  ...Array.from({ length: 10 }, (_, p) => ({ name: `belly_rubbing_p${p}`, file: PLAYER_FILE, walk: false })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `walking_heavy_p${i + 4}`, file: PLAYER_FILE, walk: true })),
];

/** Zero on our own model and in first person, one on any other model seen from outside. */
export const BLEND_WEIGHT = '(1.0 - v.mp_native) * (1.0 - v.is_first_person)';
/** The same condition our own model plays the heavy walk under (player.entity.json's animate list). */
export const WALK_GATE = ' * ((q.modified_move_speed > 0.05 && q.is_on_ground) ? 1.0 : 0.0)';

/** @param {string} name a pose name from COMPAT_SOURCES */
export const sourceId = (name) => SOURCE_PREFIX + name;
/** @param {string} name a pose name from COMPAT_SOURCES */
export const compatId = (name) => COMPAT_PREFIX + name;

/**
 * The compat copy of one pose: every field but its bones and override_previous_animation (the copy
 * adds on top of whatever the other model is doing, as the pose does on ours), the vanilla bones'
 * channels verbatim, and the blend_weight gate. Null when no vanilla bone is left: an empty bones
 * object would make the game refuse the whole file.
 * @param {Record<string, any>} source the pose's animation definition
 * @param {{ walk?: boolean }} [options] walk: also gate on her walking
 * @returns {Record<string, any> | null}
 */
export function compatAnimation(source, { walk = false } = {}) {
  const { bones = {}, override_previous_animation: _override, ...rest } = source;
  /** @type {Record<string, unknown>} */
  const kept = {};
  for (const bone of VANILLA_BONES) if (bones[bone]) kept[bone] = structuredClone(bones[bone]);
  if (!Object.keys(kept).length) return null;
  return { ...structuredClone(rest), bones: kept, blend_weight: BLEND_WEIGHT + (walk ? WALK_GATE : '') };
}

/**
 * Every compat copy, from the animation files they come from (keyed like COMPAT_SOURCES' file).
 * Throws when a pose is missing, since player/compat.js would then play an animation that does not
 * exist; a copy left without bones is skipped and reported in `skipped`.
 * @param {Record<string, { animations?: Record<string, any> } | undefined>} files
 * @returns {{ animations: Record<string, Record<string, any>>, skipped: string[] }}
 */
export function compatAnimations(files) {
  /** @type {Record<string, Record<string, any>>} */
  const animations = {};
  const skipped = [];
  for (const { name, file, walk } of COMPAT_SOURCES) {
    const source = files[file]?.animations?.[sourceId(name)];
    if (!source) throw new Error(`${sourceId(name)} is missing from ${file}`);
    const copy = compatAnimation(source, { walk });
    if (copy) animations[compatId(name)] = copy;
    else skipped.push(name);
  }
  return { animations, skipped };
}

// --- the stand-in player entity -----------------------------------------------------------------

/** Fixed, so a newer stand-in replaces the older one on import instead of sitting next to it. */
export const STANDIN_UUIDS = { header: 'b3f0c6de-6a1e-4c55-9d43-7a0e5f1c2a71', module: '5d2e8f41-0c7b-4f3a-a9e6-1b4c7d9e3f20' };

/**
 * The stand-in pack's manifest. Bedrock keeps a pack it has already imported under the same uuid
 * and version, so the stand-in carries the add-on's version and a newer one replaces the old.
 * @param {string} version package.json's version, "x.y.z"
 * @param {number[]} minEngineVersion our resource pack's
 */
export function standinManifest(version, minEngineVersion) {
  const numbers = version.split('.').map(Number);
  return {
    format_version: 2,
    header: {
      name: 'Minepreggo test: other player model',
      description: 'Development aid: a plain player model standing in for Actions & Stuff. Put it above Minepreggo (Resources).',
      uuid: STANDIN_UUIDS.header,
      version: numbers,
      min_engine_version: minEngineVersion,
    },
    modules: [{ type: 'resources', uuid: STANDIN_UUIDS.module, version: numbers }],
  };
}

const OURS = /minepreggo/;
/** Molang names a variable is assigned in (`variable.x = ` or `v.x = `, never `==`). */
const assigned = (/** @type {string} */ line) => [...line.matchAll(/\b(?:variable|v)\.(\w+)\s*=(?!=)/g)].map((m) => m[1]);
const mentions = (/** @type {string} */ line, /** @type {Set<string>} */ names) => [...line.matchAll(/\b(?:variable|v)\.(\w+)/g)].some((m) => names.has(m[1]));
/** What must not survive in the stand-in: any Minepreggo id or path, or one of our mp_ variables. */
export const STANDIN_LEFTOVER = /minepreggo|\bmp_/;

/**
 * Our player client entity as a plain player model, the way a game with another player model above
 * ours draws her: every geometry, texture, material, animation and render controller whose key or
 * id names Minepreggo goes, with the animate entries that played them; pre_animation stops before
 * our first variable.mp_ line (everything after it is ours: belly, kicks, crowning, jiggle), and the
 * initializers of the variables only those lines set go too, as does the public variable.mp_native,
 * so our attachable belly and compat poses treat it exactly as they treat Actions & Stuff. The
 * vanilla third-person controller loses the condition that handed her body to our controllers.
 * Throws if anything of ours is left.
 * @param {any} doc the parsed packs/resource/entity/player.entity.json
 */
export function standinEntity(doc) {
  const out = structuredClone(doc);
  const description = out['minecraft:client_entity'].description;
  const named = (/** @type {[string, unknown]} */ [key, value]) => OURS.test(key) || (typeof value === 'string' && OURS.test(value));
  for (const field of ['materials', 'textures', 'geometry']) {
    if (description[field]) description[field] = Object.fromEntries(Object.entries(description[field]).filter((entry) => !named(entry)));
  }
  const removed = new Set(Object.entries(description.animations ?? {}).filter(named).map(([key]) => key));
  description.animations = Object.fromEntries(Object.entries(description.animations ?? {}).filter(([key]) => !removed.has(key)));
  description.render_controllers = (description.render_controllers ?? [])
    .filter((/** @type {string | Record<string, string>} */ rc) => !OURS.test(typeof rc === 'string' ? rc : Object.keys(rc)[0]))
    .map((/** @type {string | Record<string, string>} */ rc) => {
      if (typeof rc === 'string' || !rc['controller.render.player.third_person']) return rc;
      return { 'controller.render.player.third_person': rc['controller.render.player.third_person'].replace(' && !variable.mp_predefined && !variable.mp_labor', '') };
    });
  const scripts = description.scripts ?? {};
  scripts.animate = (scripts.animate ?? []).filter((/** @type {string | Record<string, string>} */ a) => !removed.has(typeof a === 'string' ? a : Object.keys(a)[0]));
  const pre = scripts.pre_animation ?? [];
  const cut = pre.findIndex((/** @type {string} */ line) => /\bvariable\.mp_/.test(line));
  const kept = cut < 0 ? pre : pre.slice(0, cut);
  // Variables only the dropped lines set: their initializers would be dead, and some are ours (mp_*).
  const keptNames = new Set(kept.flatMap(assigned));
  const gone = new Set([...(cut < 0 ? [] : pre.slice(cut)).flatMap(assigned), 'mp_native'].filter((name) => !keptNames.has(name)));
  scripts.pre_animation = kept;
  scripts.initialize = (scripts.initialize ?? []).filter((/** @type {string} */ line) => !mentions(line, gone));
  if (scripts.variables) {
    delete scripts.variables['variable.mp_native'];
    if (!Object.keys(scripts.variables).length) delete scripts.variables;
  }
  const text = JSON.stringify(out);
  const left = [...new Set(text.match(new RegExp(`.{0,40}(?:${STANDIN_LEFTOVER.source}).{0,40}`, 'g')) ?? [])];
  if (left.length) throw new Error(`the stand-in player entity still holds Minepreggo parts:\n  ${left.slice(0, 5).join('\n  ')}`);
  return out;
}
