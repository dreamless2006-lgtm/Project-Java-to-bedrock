// Merges the Jenny add-ons in vendor/jenny/ into the Minepreggo packs, so one behavior pack and one
// resource pack hold everything:
//
//   * the Jenny Mod Java Port (a .mcaddon holding its BP and RP folders): every entity, item, recipe,
//     loot table, spawn rule, script, model, animation, controller, texture, sound, UI file and
//     translation is copied into "jenny_port" sub-folders of our packs (texture, sound and loot paths
//     rewritten to match), its scripts are patched for Script API 2.x, its girls get the Minepreggo
//     pregnancy properties, phase events and mob family, and a belly geometry per body they render
//     (built from the mod's pregnant player bodies, tools/lib/belly-fit.mjs) with render controllers
//     under the same visibility as that body;
//   * the older Jenny .mcpack pair contributes the Jenny Bed (model and texture), the player's
//     animation for the bed scene, the scene sound and the house structure (its entity removed, its
//     bed block and state renamed to ours).
//
// Everything written here is third-party content and git-ignored. Our files that the game reads as
// one per pack (sound_definitions.json, sounds.json, item_texture.json) get "jenny_port" overlays
// that tools/build.mjs merges while packaging. Run after tools/import-jar.mjs (`npm run import`).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { BABY_LOOKS, babyIcon } from './lib/baby-icon.mjs';
import { addNewborn, fitBelly, measureBody, smoothBelly } from './lib/belly-fit.mjs';
import { BELLY_ANIMATIONS, FAMILY_TAG, MINEPREGGO_PROPERTIES, MOD, PHASES, bellyPreAnimation, initializers, kickRoomLines, phaseEvents } from './lib/belly-render.mjs';
import { bellyTexture, hairTone, skinTone } from './lib/belly-skin.mjs';
import { girlPoseAnimations } from './lib/scene-poses.mjs';
import { stringifyEntity } from './lib/entity-json.mjs';
import { dropStructureEntities, parseNbt, renameStrings, writeNbt } from './lib/nbt.mjs';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RP = join(ROOT, 'packs/resource');
const BP = join(ROOT, 'packs/behavior');
const VENDOR = join(ROOT, 'vendor/jenny');
const PORT = 'jenny_port';

/** The port's girls (they join the Minepreggo mob system) and the scene stages that stand in for two of them. */
export const PORT_GIRLS = ['fapcraft:jenny', 'kum:bia', 'kum:slime_girl', 'kum:luna', 'kum:galath', 'jhallie4:allie', 'kum:manglelie', 'jhbee24:bee', 'jhkobold:kobold', 'jhelliedev:ellie'];
export const PORT_STAGES = ['jhjenjava:jenny_stage', 'jhelliedev:ellie_stage'];
/** Which girl a stage stands in for (her skin tone is the stage belly's). */
const STAGE_OF = /** @type {Record<string, string>} */ ({ 'jhjenjava:jenny_stage': 'fapcraft:jenny', 'jhelliedev:ellie_stage': 'jhelliedev:ellie' });
/** When a girl is in her own everyday state (not in one of her scenes): only then do our poses play on her. */
const NORMAL = /** @type {Record<string, string>} */ ({ 'jhelliedev:ellie': "!q.property('jhelliedev:stage_hidden')" });
const normalOf = (/** @type {string} */ id) => NORMAL[id] ?? 'q.skin_id == 0';
/** The newborn: hidden but while she pushes during the birth, then it slides out with each push. */
const NEWBORN = {
  [`animation.${MOD}.jp_newborn`]: {
    loop: true,
    bones: {
      newborn: {
        scale: "v.pose == 'birth' ? math.clamp(v.push * 1.8 - 0.25, 0.0, 1.0) : 0.0",
        position: [0, '-3.4 * math.clamp(v.push, 0.0, 1.0)', '-0.6 * math.clamp(v.push, 0.0, 1.0)'],
        rotation: ["v.pose == 'birth' ? 6.0 * math.sin(q.life_time * 240.0) : 0.0", 0, "v.pose == 'birth' ? 4.0 * math.sin(q.life_time * 170.0) : 0.0"],
      },
    },
  },
};

/** The older pack's ids and ours. */
const OLD = { bed: 'cumin:jenny_bed', bedState: 'bridge:block_rotation', jenny: 'cumin:jenny' };

const slug = (/** @type {string} */ id) => id.split(':')[1].replace(/\W/g, '_');
/** bridge. and others write a "//" comment line before the JSON. */
const parse = (/** @type {Uint8Array | string} */ data) => JSON.parse((typeof data === 'string' ? data : strFromU8(data)).replace(/^\s*\/\/.*$/gm, ''));
function writeFile(/** @type {string} */ path, /** @type {Uint8Array | string} */ data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
const stripRoot = (/** @type {string} */ name) => name.slice(name.indexOf('/') + 1);

if (!existsSync(VENDOR)) {
  console.log('vendor/jenny/ not found: the Jenny add-ons are not imported (copy the Jenny Mod Java Port .mcaddon and the two older .mcpack files there).');
  process.exit(0);
}

// ---- find the inputs ---------------------------------------------------------------------------
/** @type {Record<string, Uint8Array> | undefined} */
let portBP;
/** @type {Record<string, Uint8Array> | undefined} */
let portRP;
/** @type {Record<string, Uint8Array> | undefined} */
let oldRP;
/** @type {Record<string, Uint8Array> | undefined} */
let oldBP;
const moduleTypes = (/** @type {Record<string, Uint8Array>} */ files, /** @type {string} */ manifest) => new Set((parse(files[manifest]).modules ?? []).map((/** @type {any} */ m) => m.type));
for (const name of readdirSync(VENDOR).filter((f) => /\.(mcaddon|mcpack|zip)$/i.test(f)).sort()) {
  const files = unzipSync(new Uint8Array(readFileSync(join(VENDOR, name))));
  const manifests = Object.keys(files).filter((f) => /(^|\/)manifest\.json$/.test(f));
  for (const manifest of manifests) {
    const root = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/') + 1) : '';
    const pack = /** @type {Record<string, Uint8Array>} */ ({});
    for (const [file, data] of Object.entries(files)) if (file.startsWith(root) && file.length > root.length && !file.endsWith('/')) pack[file.slice(root.length)] = data;
    const types = moduleTypes(pack, 'manifest.json');
    // The port names its packs "Jenny Mod Java Port ... BP/RP" and has scripts; the older packs are "JennyModBeh"/"JennyModRes".
    const isPort = /Java Port/i.test(parse(pack['manifest.json']).header?.name ?? '') || !!pack['scripts/main.js'];
    if (types.has('data')) { if (isPort) portBP = pack; else oldBP = pack; }
    else if (types.has('resources')) { if (isPort) portRP = pack; else oldRP = pack; }
  }
}
const need = (/** @type {Record<string, Uint8Array> | undefined} */ pack, /** @type {string} */ file, /** @type {string} */ what) => {
  if (!pack?.[file]) throw new Error(`${what} has no ${file}`);
  return pack[file];
};

// ---- clean the previous import --------------------------------------------------------------------
for (const dir of ['entities', 'items', 'recipes', 'loot_tables', 'spawn_rules', 'scripts', 'structures']) rmSync(join(BP, dir, PORT), { recursive: true, force: true });
rmSync(join(BP, 'structures', MOD), { recursive: true, force: true });
for (const dir of ['entity', 'animations', 'animation_controllers', 'render_controllers', 'attachables', 'models/entity', 'textures', 'sounds']) rmSync(join(RP, dir, PORT), { recursive: true, force: true });
rmSync(join(RP, PORT), { recursive: true, force: true });
rmSync(join(RP, 'ui'), { recursive: true, force: true });
for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
  const path = join(RP, 'texts', file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf('## Jenny Mod Java Port');
  if (at >= 0) writeFileSync(path, text.slice(0, at));
}

/** The mod's pregnant player bodies, the source of every fitted belly. */
const playerBodies = PHASES.map((p) => {
  const file = join(RP, 'models/entity', MOD, `player_body_predefined_p${p}.geo.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run tools/import-jar.mjs first`);
  return parse(readFileSync(file, 'utf8'));
});
/** The mod's labor animations come from the humanoid creeper girl (a plain standing humanoid). */
const creeper = (() => {
  const geometryFile = join(RP, 'models/entity', MOD, 'humanoid_creeper_girl.geo.json');
  const animationFile = join(RP, 'animations', MOD, 'humanoid_creeper_girl.animation.json');
  if (!existsSync(geometryFile) || !existsSync(animationFile)) throw new Error('the humanoid creeper girl is missing: run tools/import-jar.mjs first');
  const prefix = `animation.${MOD}.humanoid_creeper_girl.`;
  const animations = Object.fromEntries(Object.entries(parse(readFileSync(animationFile, 'utf8')).animations).map(([k, v]) => [k.startsWith(prefix) ? k.slice(prefix.length) : k, v]));
  return { geometry: parse(readFileSync(geometryFile, 'utf8'))['minecraft:geometry'][0], animations };
})();

/**
 * A girl's pose controller: one state per pose, entered while the pose property says so and she is
 * in her everyday state, cross-faded in and out.
 * @param {string[]} poses
 */
function poseController(poses) {
  /** @type {Record<string, unknown>} */
  const states = { default: { transitions: poses.map((pose) => ({ [pose]: `v.jp_normal && v.pose == '${pose}'` })) } };
  for (const pose of poses) {
    states[pose] = { animations: [`mp_pose_${pose}`], transitions: [{ default: `!v.jp_normal || !(v.pose == '${pose}')` }], blend_transition: 0.45 };
  }
  return { initial_state: 'default', states };
}

const counts = { files: 0, scripts: 0, girls: 0, bellies: 0, sounds: 0, poses: 0, babies: 0 };

// ---- the Jenny Mod Java Port -----------------------------------------------------------------------
if (portBP && portRP) {
  /** Their asset paths move under jenny_port/, so nothing collides with ours or with another pack's. */
  const rewrite = (/** @type {string} */ text) => text.replace(/"textures\//g, `"textures/${PORT}/`).replace(/"sounds\//g, `"sounds/${PORT}/`).replace(/"loot_tables\//g, `"loot_tables/${PORT}/`);
  /** "sounds/a/b/c.ogg" -> "sounds/jenny_port/a_b_c.ogg" (with or without the extension). */
  const flatSound = (/** @type {string} */ path) => `sounds/${PORT}/${path.replace(/^sounds\//, '').replace(/\//g, '_')}`;
  /** Script API 2.x: getAllPlayers is gone, applyKnockback takes a horizontal force vector. */
  const patchScript = (/** @type {string} */ text) =>
    text
      .replaceAll('world.getAllPlayers()', 'world.getPlayers()')
      .replace(/applyKnockback\(\s*([^,()]+),\s*([^,()]+),\s*([^,()]+),\s*([^,()]+)\)/g, 'applyKnockback({ x: ($1) * ($3), z: ($2) * ($3) }, $4)');

  // Behavior pack.
  /** @type {Map<string, any>} entity id -> their entity document, patched below */
  const entityDocs = new Map();
  for (const [file, data] of Object.entries(portBP)) {
    if (file === 'manifest.json' || file === 'pack_icon.png') continue;
    const [dir] = file.split('/');
    const rest = file.slice(dir.length + 1);
    if (dir === 'scripts') {
      writeFile(join(BP, 'scripts', PORT, rest), patchScript(strFromU8(data)));
      counts.scripts++;
    } else if (dir === 'entities') {
      const doc = parse(rewrite(strFromU8(data)));
      entityDocs.set(doc['minecraft:entity'].description.identifier, { file: join(BP, 'entities', PORT, rest), doc });
    } else if (['items', 'recipes', 'loot_tables', 'spawn_rules'].includes(dir)) {
      writeFile(join(BP, dir, PORT, rest), file.endsWith('.json') ? rewrite(strFromU8(data)) : data);
      counts.files++;
    }
  }
  // Their girls join the Minepreggo mob system: the pregnancy properties the scripts write, the
  // phase events the scripts fire (set_property only, their component groups are theirs), and the
  // family the mob loop looks for. The stages only carry the belly size they are shown with.
  for (const [id, { file, doc }] of entityDocs) {
    const e = doc['minecraft:entity'];
    if (PORT_GIRLS.includes(id)) {
      e.description.properties = { ...(e.description.properties ?? {}), ...MINEPREGGO_PROPERTIES };
      e.events = { ...(e.events ?? {}), ...phaseEvents() };
      // Sneaking with an empty hand opens our pregnancy menu, so their own menu waits for a plain interaction.
      for (const components of [e.components, ...Object.values(e.component_groups ?? {})]) {
        for (const interaction of components?.['minecraft:interact']?.interactions ?? []) {
          const on = interaction.on_interact;
          if (!on || JSON.stringify(on.filters ?? {}).includes('is_sneaking')) continue;
          const notSneaking = { test: 'is_sneaking', subject: 'other', value: false };
          on.filters = on.filters ? { all_of: [...(Array.isArray(on.filters) ? on.filters : [on.filters]), notSneaking] } : notSneaking;
        }
      }
      for (const components of [e.components, ...Object.values(e.component_groups ?? {})]) {
        const family = components?.['minecraft:type_family']?.family;
        if (Array.isArray(family) && !family.includes(FAMILY_TAG)) family.push(FAMILY_TAG);
      }
      counts.girls++;
    } else if (PORT_STAGES.includes(id)) {
      // The stage plays her scene in her place: it shows her belly, her kicks and her contractions (port.js copies them over).
      e.description.properties = { ...(e.description.properties ?? {}), ...MINEPREGGO_PROPERTIES };
    }
    writeFile(file, stringifyEntity(doc));
    counts.files++;
  }

  // Resource pack: everything under jenny_port/ but the UI (the game reads ui/_ui_defs.json at the root).
  /** @type {Map<string, any>} geometry id -> geometry */
  const geometries = new Map();
  /** @type {Record<string, any>} render controller id -> definition */
  const rcDefs = {};
  /** @type {{ file: string, doc: any }[]} */
  const clientDocs = [];
  /** @type {Record<string, any>} their animations by id (her idle is her neutral stance) */
  const portAnimations = {};
  for (const [file, data] of Object.entries(portRP)) {
    if (file === 'manifest.json' || file === 'pack_icon.png' || file === 'texts/languages.json') continue;
    const [dir] = file.split('/');
    const rest = file.slice(dir.length + 1);
    const json = file.endsWith('.json');
    if (dir === 'textures') {
      if (rest === 'item_texture.json') writeFile(join(RP, 'textures', PORT, 'item_texture.json'), rewrite(strFromU8(data)));
      else writeFile(join(RP, 'textures', PORT, rest), json ? rewrite(strFromU8(data)) : data);
    } else if (dir === 'sounds') {
      // Their sound files sit six folders deep; consoles may not read a path of eight segments, so
      // they are flattened into one folder (sound_definitions.json follows).
      if (rest === 'sound_definitions.json') {
        const doc = parse(data);
        for (const def of Object.values(doc.sound_definitions ?? {})) {
          def.sounds = (def.sounds ?? []).map((/** @type {any} */ sound) => (typeof sound === 'string' ? flatSound(sound) : { ...sound, name: flatSound(sound.name) }));
        }
        writeFile(join(RP, 'sounds', PORT, 'sound_definitions.json'), JSON.stringify(doc, null, 2) + '\n');
      } else {
        writeFile(join(RP, flatSound(file)), data);
        counts.sounds++;
      }
    } else if (file === 'sounds.json') {
      writeFile(join(RP, PORT, 'sounds.json'), rewrite(strFromU8(data)));
    } else if (dir === 'texts') {
      const ours = join(RP, 'texts', rest);
      if (existsSync(ours)) writeFileSync(ours, readFileSync(ours, 'utf8').replace(/\n?$/, '\n') + `## Jenny Mod Java Port (vendor/jenny, tools/import-jenny.mjs)\n${strFromU8(data).replace(/^pack\.(name|description)=.*$/gm, '').trim()}\n`);
    } else if (dir === 'ui') {
      writeFile(join(RP, 'ui', rest), rewrite(strFromU8(data)));
    } else if (dir === 'models') {
      const doc = parse(data);
      for (const g of doc['minecraft:geometry'] ?? []) geometries.set(g.description.identifier, g);
      writeFile(join(RP, 'models/entity', PORT, rest.replace(/^entity\//, '')), JSON.stringify(doc) + '\n');
    } else if (dir === 'render_controllers') {
      const doc = parse(data);
      Object.assign(rcDefs, doc.render_controllers ?? {});
      writeFile(join(RP, dir, PORT, rest), rewrite(strFromU8(data)));
    } else if (dir === 'entity') {
      clientDocs.push({ file: join(RP, 'entity', PORT, rest), doc: parse(rewrite(strFromU8(data))) });
    } else if (['animations', 'animation_controllers', 'attachables'].includes(dir)) {
      writeFile(join(RP, dir, PORT, rest), json ? rewrite(strFromU8(data)) : data);
      if (dir === 'animations' && json) Object.assign(portAnimations, parse(rewrite(strFromU8(data))).animations ?? {});
    } else {
      continue;
    }
    counts.files++;
  }

  // Each girl's skin tone, from her own texture, for her belly and her stage's.
  /** @type {Map<string, number[]>} girl id -> [r, g, b] */
  const tones = new Map();
  /** @type {Map<string, number[]>} girl id -> her hair colour */
  const hairs = new Map();
  for (const { doc } of clientDocs) {
    const d = doc['minecraft:client_entity'].description;
    if (!PORT_GIRLS.includes(d.identifier)) continue;
    const textureKey = ['default', 'normal', 'dressed'].find((k) => d.textures?.[k]);
    const geometryKey = ['default', 'normal', 'dressed'].find((k) => d.geometry?.[k]);
    const geometry = geometryKey ? geometries.get(d.geometry[geometryKey]) : undefined;
    const texture = textureKey ? join(RP, `${d.textures[textureKey]}.png`) : undefined;
    if (geometry && texture && existsSync(texture)) {
      const png = decodePng(new Uint8Array(readFileSync(texture)));
      tones.set(d.identifier, skinTone(png, geometry));
      hairs.set(d.identifier, hairTone(png, geometry));
    }
  }
  const toneOf = (/** @type {string} */ id) => tones.get(id) ?? tones.get(STAGE_OF[id] ?? '') ?? [224, 188, 160];

  // Bellies: for every render controller of a girl or stage whose geometry has a hip, a round belly
  // per size fitted to that body in her skin tone, shown under the same visibility as that body.
  /** @type {Record<string, unknown>} */
  const bellyControllers = {};
  /** @type {Record<string, unknown>} */
  const poseControllers = {};
  for (const { file, doc } of clientDocs) {
    const d = doc['minecraft:client_entity'].description;
    const id = d.identifier;
    const girl = PORT_GIRLS.includes(id);
    if (girl || PORT_STAGES.includes(id)) {
      const entries = /** @type {(string | Record<string, string>)[]} */ (d.render_controllers ?? []);
      /** @type {{ signature: string, body: import('./lib/belly-fit.mjs').Body, visibilities: string[] }[]} */
      const sets = [];
      for (const entry of entries) {
        const name = typeof entry === 'string' ? entry : Object.keys(entry)[0];
        const condition = typeof entry === 'string' ? undefined : entry[name];
        const def = rcDefs[name];
        if (!def) continue;
        const expr = String(def.geometry ?? '');
        let key = expr.match(/^(?:Geometry|geometry)\.(\w+)$/)?.[1];
        if (!key) {
          const array = expr.match(/^(Array\.\w+)/i)?.[1];
          const list = array ? def.arrays?.geometries?.[array] ?? def.arrays?.geometries?.[array.toLowerCase()] : undefined;
          key = Array.isArray(list) ? String(list[0]).match(/^(?:Geometry|geometry)\.(\w+)$/)?.[1] : undefined;
        }
        const geometry = key ? geometries.get(d.geometry?.[key]) : undefined;
        const body = geometry ? measureBody(geometry) : undefined;
        if (!body) continue;
        const star = def.part_visibility?.find((/** @type {any} */ p) => '*' in p)?.['*'];
        const parts = [condition, typeof star === 'string' ? star : undefined].filter((c) => c && c !== 'true');
        const signature = JSON.stringify(body);
        let set = sets.find((s) => s.signature === signature);
        if (!set) sets.push((set = { signature, body, visibilities: [] }));
        set.visibilities.push(parts.length ? `(${parts.join(') && (')})` : 'true');
      }
      if (sets.length) {
        d.materials = { ...(d.materials ?? {}), minepreggo_belly: 'entity_alphatest' };
        const skin = `textures/${PORT}/${MOD}/${slug(id)}_belly`;
        writeFile(join(RP, `${skin}.png`), encodePng(bellyTexture(toneOf(id))));
        d.textures.minepreggo_belly = skin;
        /** @type {any[]} the first set's geometries, whose kick room the clamped kicks use */
        const firstSet = [];
        sets.forEach((set, n) => {
          const visibility = set.visibilities.includes('true') ? undefined : set.visibilities.join(' || ');
          for (const p of PHASES) {
            const geometryId = `geometry.${MOD}.jp_${slug(id)}_${n}_belly_p${p}`;
            const belly = addNewborn(smoothBelly(fitBelly(playerBodies[p], geometryId, set.body), set.body), set.body);
            writeFile(join(RP, 'models/entity', PORT, MOD, `${slug(id)}_${n}_belly_p${p}.geo.json`), JSON.stringify(belly, null, 2) + '\n');
            if (n === 0) firstSet.push(belly['minecraft:geometry'][0]);
            d.geometry[`minepreggo_belly_${n}_p${p}`] = geometryId;
            const rc = `controller.render.${MOD}.jp_${slug(id)}_${n}_p${p}`;
            bellyControllers[rc] = { geometry: `Geometry.minepreggo_belly_${n}_p${p}`, materials: [{ '*': 'Material.minepreggo_belly' }], textures: ['Texture.minepreggo_belly'] };
            entries.push({ [rc]: `v.bp == ${p}${visibility ? ` && (${visibility})` : ''}` });
            counts.bellies++;
          }
        });
        d.render_controllers = entries;
        d.scripts ??= {};
        const pre = (d.scripts.pre_animation ?? []).filter((/** @type {string} */ l) => !/^v\.(bp|phase|pose|pregnant_pose|push|kick|kicking|kl|belly_growth|k_[a-z_]+|kr_f)\s*=/.test(l));
        // Girls and the stages that play their scenes: the belly, the kicks, the contractions, the newborn.
        pre.push(...bellyPreAnimation(), ...kickRoomLines('v.bp', (p) => firstSet[p]));
        d.animations = { ...(d.animations ?? {}), ...BELLY_ANIMATIONS, newborn: `animation.${MOD}.jp_newborn`, belly_controller: `controller.animation.${MOD}.belly` };
        const animate = (d.scripts.animate ?? []).filter((/** @type {unknown} */ a) => a !== 'belly_controller' && a !== 'newborn' && a !== 'mp_pose_controller');
        if (girl) {
          // Her pregnancy and scene poses, solved onto her rig from her own idle stance (tools/lib/scene-poses.mjs).
          const geometryKey = ['default', 'normal', 'dressed'].find((k) => d.geometry?.[k]);
          const geometry = geometryKey ? geometries.get(d.geometry[geometryKey]) : undefined;
          const idle = d.animations.idle ? portAnimations[d.animations.idle] : undefined;
          const poses = geometry && girlPoseAnimations({ geometry, idle, sourceGeometry: creeper.geometry, sourceAnimations: creeper.animations, prefix: `animation.${MOD}.jp_${slug(id)}` });
          if (poses) {
            const file = { format_version: '1.8.0', animations: Object.fromEntries(Object.values(poses).map(({ id: animationId, animation }) => [animationId, animation])) };
            writeFile(join(RP, 'animations', PORT, MOD, `${slug(id)}_poses.animation.json`), JSON.stringify(file) + '\n');
            for (const [pose, { id: animationId }] of Object.entries(poses)) d.animations[`mp_pose_${pose}`] = animationId;
            const controllerId = `controller.animation.${MOD}.jp_${slug(id)}.pose`;
            poseControllers[controllerId] = poseController(Object.keys(poses));
            d.animations.mp_pose_controller = controllerId;
            pre.push(`v.jp_normal = ${normalOf(id)};`);
            animate.push('mp_pose_controller');
            counts.poses += Object.keys(poses).length;
          }
        }
        d.scripts.animate = [...animate, 'newborn', 'belly_controller'];
        d.scripts.pre_animation = pre;
        d.scripts.initialize = initializers(pre, d.scripts.initialize ?? []);
      }
    }
    writeFile(file, JSON.stringify(doc, null, 2) + '\n');
  }
  writeFile(join(RP, 'render_controllers', PORT, 'minepreggo_bellies.render_controllers.json'), JSON.stringify({ format_version: '1.10.0', render_controllers: bellyControllers }, null, 2) + '\n');
  writeFile(join(RP, 'animation_controllers', PORT, 'minepreggo_poses.animation_controllers.json'), JSON.stringify({ format_version: '1.10.0', animation_controllers: poseControllers }, null, 2) + '\n');
  writeFile(join(RP, 'animations', PORT, MOD, 'newborn.animation.json'), JSON.stringify({ format_version: '1.8.0', animations: NEWBORN }, null, 2) + '\n');

  // Each girl's baby: an item with an icon in her colours (her skin, her hair, her kind's trait).
  const itemTextures = parse(readFileSync(join(RP, 'textures', PORT, 'item_texture.json'), 'utf8'));
  /** @type {string[]} */
  const babyLang = [];
  for (const girl of PORT_GIRLS) {
    const look = BABY_LOOKS[girl];
    const name = `baby_${slug(girl)}`;
    const icon = `textures/${PORT}/${MOD}/${name}`;
    writeFile(join(RP, `${icon}.png`), encodePng(babyIcon({ skin: toneOf(girl), hair: hairs.get(girl) ?? [110, 80, 60], ...look })));
    itemTextures.texture_data[`${MOD}_${name}`] = { textures: icon };
    const item = {
      format_version: '1.26.30',
      'minecraft:item': {
        description: { identifier: `${MOD}:${name}`, menu_category: { category: 'items' } },
        components: { 'minecraft:icon': `${MOD}_${name}`, 'minecraft:display_name': { value: `item.${MOD}.${name}` }, 'minecraft:max_stack_size': 1 },
      },
    };
    writeFile(join(BP, 'items', PORT, MOD, `${name}.json`), JSON.stringify(item, null, 2) + '\n');
    babyLang.push(`item.${MOD}.${name}=${look.name}'s Baby`);
    counts.babies++;
  }
  writeFile(join(RP, 'textures', PORT, 'item_texture.json'), JSON.stringify(itemTextures, null, 2) + '\n');
  for (const file of readdirSync(join(RP, 'texts')).filter((f) => f.endsWith('.lang'))) {
    const path = join(RP, 'texts', file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n?$/, '\n') + `${babyLang.join('\n')}\n`);
  }
} else {
  console.warn('warning: the Jenny Mod Java Port .mcaddon (BP + RP) is not in vendor/jenny/; its girls are not imported');
}

// ---- the older Jenny packs: the bed, the player's scene animation, the scene sound, the house -----
if (oldRP && oldBP) {
  writeFile(join(RP, 'textures', MOD, 'block/jenny_bed.png'), need(oldRP, 'textures/blocks/jenny_bed.png', 'the older Jenny resource pack'));
  // The bed model, trimmed to the 30 units a block model may span and laid out from the block toward +z (the block's permutations turn it).
  const bed = parse(need(oldRP, 'models/entity/jenny_bed.geo.json', 'the older Jenny resource pack'));
  bed['minecraft:geometry'][0].description.identifier = `geometry.${MOD}.jenny_bed`;
  for (const bone of bed['minecraft:geometry'][0].bones) {
    for (const cube of bone.cubes ?? []) {
      if (cube.size[2] > 30) cube.size[2] = 30;
      cube.origin = [cube.origin[0], cube.origin[1], -8];
    }
  }
  writeFile(join(RP, 'models/entity', MOD, 'jenny_bed.geo.json'), JSON.stringify(bed, null, 2) + '\n');
  // The player's side of the bed scene.
  const scene = parse(need(oldRP, 'animations/humanoid_s3x.json', 'the older Jenny resource pack')).animations['animation.player.s3x'];
  if (!scene) throw new Error('the older Jenny resource pack has no animation.player.s3x');
  writeFile(join(RP, 'animations', MOD, 'jenny_bed.animation.json'), JSON.stringify({ format_version: '1.8.0', animations: { [`animation.${MOD}.jenny_bed.player_scene`]: scene } }, null, 2) + '\n');
  writeFile(join(RP, 'sounds', MOD, 'jenny_bed/scene.ogg'), need(oldRP, 'sounds/jenny/s3x/s3x.ogg', 'the older Jenny resource pack'));
  // The house: its bed block and state become ours; its NPC (a Jenny of the old pack) is taken out.
  const house = parseNbt(need(oldBP, 'structures/jenny_house.mcstructure', 'the older Jenny behavior pack'));
  const renamed = renameStrings(house, { [OLD.bed]: `${MOD}:jenny_bed`, [OLD.bedState]: `${MOD}:facing` });
  const dropped = dropStructureEntities(house);
  writeFile(join(BP, 'structures', MOD, 'jenny_house.mcstructure'), writeNbt(house));
  console.log(`Older Jenny packs: the bed, the player's scene animation, the scene sound, the house (${renamed[OLD.bed]} bed block, ${renamed[OLD.bedState]} bed state renamed, ${dropped} entity removed)`);
} else {
  console.warn('warning: the older Jenny .mcpack pair is not in vendor/jenny/; the Jenny Bed and its scene have no model, animation or sound');
}

if (portBP && portRP) {
  console.log(`Jenny Mod Java Port: ${counts.files} files, ${counts.scripts} scripts, ${counts.sounds} sounds, ${counts.girls} girls in the mob system, ${counts.bellies} belly render controllers, ${counts.poses} pregnancy and scene poses, ${counts.babies} babies`);
}
