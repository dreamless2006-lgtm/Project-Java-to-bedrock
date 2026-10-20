// The off-hand belly (tools/gen/belly-items.mjs): one item and attachable per belly size and skin
// tone, each drawing the predefined body of its size and moving it from the player's properties read
// through c.owning_entity->. The geometry and atlases come from tools/import-jar.mjs (git-ignored),
// so their checks run only once those files exist in their current form (the crowning mounts in the
// geometry, the atlas folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KICK_BONES, kickRoom } from '../lib/kick-clamp.mjs';
import { PLAYER_BABIES, crowningAnimations } from '../lib/crowning.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const BP = join(ROOT, 'packs/behavior');
const json = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
const PROPERTIES = ['pose', 'kick', 'growth', 'navel', 'baby'];
const HIDDEN = 'v.hidden = c.is_first_person || c.owning_entity->v.mp_native || c.owning_entity->q.is_invisible || c.owning_entity->q.is_sleeping;';

/** The ids of §2: P0 and P1 with tone 0 only, P2..9 with tones 0..5 (tone 0 without a suffix). */
const EXPECTED = Array.from({ length: 10 }, (_, p) => p).flatMap((p) => (p < 2 ? [0] : [0, 1, 2, 3, 4, 5]).map((t) => ({ p, t, id: t > 0 ? `minepreggo:belly_p${p}_t${t}` : `minepreggo:belly_p${p}` })));

const itemFiles = readdirSync(join(BP, 'items/belly')).filter((f) => f.endsWith('.json'));
const attachableFiles = readdirSync(join(RP, 'attachables')).filter((f) => /^belly_.*\.json$/.test(f));
/** @type {Map<string, any>} id -> attachable description */
const attachables = new Map(attachableFiles.map((f) => {
  const description = json(join(RP, 'attachables', f))['minecraft:attachable'].description;
  return [description.identifier, description];
}));
const own = json(join(RP, 'animations/belly_attachable.animation.json')).animations;

/** Every animation id in the resource pack, with its definition. */
function animationIndex() {
  /** @type {Map<string, any>} */
  const index = new Map();
  const walk = (/** @type {string} */ dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) for (const [id, def] of Object.entries(json(path).animations ?? {})) index.set(id, def);
    }
  };
  walk(join(RP, 'animations'));
  return index;
}
const ANIMATIONS = animationIndex();
// the mod's belly animations live in animations/minepreggo/ (from the jar, git-ignored)
const IMPORTED = existsSync(join(RP, 'animations/minepreggo'));
const fromJar = (/** @type {string} */ id) => /^animation\.minepreggo\.belly\./.test(id);

/** The variables a pre_animation assigns. */
const assigned = (/** @type {string[]} */ lines) => new Set(lines.flatMap((line) => [...line.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)\s*=(?!=)/g)].map((m) => m[1])));

test('50 belly items and 50 attachables, with matching ids and the off-hand item components', () => {
  assert.equal(EXPECTED.length, 50);
  assert.equal(itemFiles.length, 50, 'no stale or missing item file');
  assert.equal(attachableFiles.length, 50, 'no stale or missing attachable file');
  const itemIds = new Set();
  for (const file of itemFiles) {
    const item = json(join(BP, 'items/belly', file))['minecraft:item'];
    const id = item.description.identifier;
    assert.equal(`minepreggo:${file.replace(/\.json$/, '')}`, id, `${file} holds its own id`);
    assert.deepEqual(item.description.menu_category, { category: 'none' });
    assert.deepEqual(item.components, {
      'minecraft:icon': 'minepreggo_belly',
      'minecraft:display_name': { value: 'item.minepreggo.belly' },
      'minecraft:max_stack_size': 1,
      'minecraft:allow_off_hand': { value: true },
    }, id);
    itemIds.add(id);
  }
  for (const file of attachableFiles) assert.ok(attachables.has(`minepreggo:${file.replace(/\.json$/, '')}`), `${file} holds its own id`);
  const ids = EXPECTED.map((e) => e.id).sort();
  assert.deepEqual([...itemIds].sort(), ids);
  assert.deepEqual([...attachables.keys()].sort(), ids);
  // the script's pattern (player/compat.js) matches every one of them
  for (const id of ids) assert.match(id, /^minepreggo:belly_p\d(_t[1-5])?$/);
  const icon = json(join(RP, 'textures/item_texture.json')).texture_data.minepreggo_belly;
  assert.deepEqual(icon, { textures: 'textures/port/belly' });
});

test('texture, geometry, material and render controller follow the size and tone', () => {
  for (const { p, t, id } of EXPECTED) {
    const d = attachables.get(id);
    assert.equal(d.textures.default, `textures/minepreggo/attachable/belly_p${p}_t${t}`, id);
    assert.equal(d.geometry.default, `geometry.minepreggo.belly_attachable_p${p}`, id);
    assert.equal(d.materials.default, 'entity_alphatest', id);
    assert.deepEqual(d.render_controllers, ['controller.render.item_default'], id);
  }
});

test('every animate entry is defined, and every animation it plays exists', () => {
  for (const [id, d] of attachables) {
    const names = d.scripts.animate.map((/** @type {string | Record<string, string>} */ a) => (typeof a === 'string' ? a : Object.keys(a)[0]));
    assert.equal(new Set(names).size, names.length, `${id}: no animate name twice`);
    for (const name of names) assert.ok(d.animations[name], `${id}: animate ${name} is defined`);
    for (const [name, anim] of Object.entries(d.animations)) {
      assert.ok(names.includes(name), `${id}: ${name} is played`);
      if (!IMPORTED && fromJar(/** @type {string} */ (anim))) continue;
      assert.ok(ANIMATIONS.has(/** @type {string} */ (anim)), `${id}: ${anim} exists`);
    }
  }
});

test('kicks from P3, the navel birth from P4, as on our own player model', () => {
  for (const { p, id } of EXPECTED) {
    const d = attachables.get(id);
    const names = Object.keys(d.animations);
    const kicks = names.filter((n) => /^(fetal|kick)_i+$/.test(n));
    const navel = names.filter((n) => /navel/.test(n));
    if (p < 3) assert.deepEqual(kicks, [], `${id}: no kick entries`);
    else {
      assert.deepEqual(kicks.sort(), ['fetal_i', 'fetal_ii', 'fetal_iii', 'kick_i', 'kick_ii', 'kick_iii'], id);
      for (const s of ['i', 'ii', 'iii']) {
        assert.equal(d.animations[`fetal_${s}`], `animation.minepreggo.belly.fetal_movement_p${p}_${s}`);
        assert.equal(d.animations[`kick_${s}`], `animation.minepreggo.kick_${s}`);
      }
      const weight = (/** @type {string} */ name) => d.scripts.animate.find((/** @type {any} */ a) => typeof a === 'object' && name in a)?.[name];
      assert.equal(weight('fetal_ii'), 'v.kick_w * (v.kick_shown == 1)');
      assert.equal(weight('kick_iii'), 'v.kick_w * (v.kick_shown == 2)');
    }
    if (p < 4) assert.deepEqual(navel, [], `${id}: no navel birth below P4`);
    else {
      assert.deepEqual(navel.sort(), ['crowning_navel', 'navel_birth', 'navel_prebirth'], id);
      assert.equal(d.animations.crowning_navel, 'animation.minepreggo.belly_attachable.crowning_navel');
    }
    const band = p <= 2 ? ['low', 'i'] : p <= 6 ? ['medium', 'ii'] : ['high', 'iii'];
    assert.equal(d.animations.inflation, `animation.minepreggo.belly.${band[0]}_belly_inflation`, id);
    assert.equal(d.animations.rubs_need, `animation.minepreggo.belly.belly_rubs_needs_${band[1]}`, id);
    assert.equal(d.animations.postbirth, 'animation.minepreggo.player.belly_hidden', id);
    assert.equal(d.animations.crowning, 'animation.minepreggo.crowning_free', id);
  }
});

test('pre_animation reads her through c.owning_entity-> only, and initialize covers what it sets', () => {
  for (const { p, id } of EXPECTED) {
    const { pre_animation: pre, initialize } = attachables.get(id).scripts;
    const text = pre.join('\n');
    for (const name of PROPERTIES) assert.ok(text.includes(`c.owning_entity->q.property('minepreggo:${name}')`), `${id}: reads ${name} through the arrow`);
    assert.ok(pre.includes(HIDDEN), `${id}: the hide line`);
    // a bare query would read the attachable itself, not her
    assert.doesNotMatch(text, /(?<!->)\b(q|query)\.property\(/, `${id}: no bare q.property(`);
    assert.doesNotMatch(text, /(?<!->)\b(q|query)\.(is_sneaking|is_invisible|is_sleeping)\b/, `${id}: no bare player query`);
    // the persistence-safe forms of the header comment
    assert.ok(pre.includes('v.kick_w = v.kicking ? math.max(0.5, v.kick_w) : v.kick_w;'), id);
    assert.ok(pre.includes('v.cw = v.contracting ? math.max(0.5, v.cw) : v.cw;'), id);
    assert.ok(pre.some((/** @type {string} */ l) => l.startsWith('v.belly_growth = math.abs(v.belly_growth - v.growth_target) > 0.2 ? v.growth_target :')), id);
    assert.ok(pre.includes('v.crown = v.crown_t;'), `${id}: the crown is not eased`);
    assert.ok(text.includes("v.crowning = (v.pose == 'birth' && v.mp_baby > 0) && v.push > 0.0;"), id);
    const factor = p <= 2 ? '1.0' : p <= 4 ? '0.9' : p === 5 ? '0.8' : p <= 7 ? '0.7' : '0.6';
    assert.ok(pre.includes(`v.growth_target = ${factor} * v.growth;`), `${id}: growth factor ${factor}`);
    // the kick room: 15 constants, all zero below P3
    for (const bone of KICK_BONES) for (const axis of ['x', 'y', 'z']) {
      const line = pre.find((/** @type {string} */ l) => l.startsWith(`v.k_${bone}_${axis} = `));
      assert.match(line ?? '', /^v\.k_[a-z_]+ = -?\d+\.\d+;$/, `${id}: v.k_${bone}_${axis} is a constant`);
      if (p < 3) assert.equal(line, `v.k_${bone}_${axis} = 0.0;`, id);
    }
    const initialized = new Set(initialize.map((/** @type {string} */ l) => l.match(/^variable\.([a-z_0-9]+) = /)?.[1]));
    for (const name of assigned(pre)) assert.ok(initialized.has(name), `${id}: initialize sets variable.${name}`);
  }
});

test('the kick room constants are the predefined body of each size', () => {
  for (let p = 3; p <= 9; p++) {
    const file = join(RP, `models/entity/minepreggo/player_body_predefined_p${p}.geo.json`);
    if (!existsSync(file)) continue;
    const room = kickRoom(json(file)['minecraft:geometry'][0]);
    const pre = attachables.get(`minepreggo:belly_p${p}`).scripts.pre_animation;
    for (const bone of KICK_BONES) for (const axis of /** @type {const} */ (['x', 'y', 'z'])) {
      assert.ok(pre.includes(`v.k_${bone}_${axis} = ${(room[bone]?.[axis] ?? 0).toFixed(2)};`), `P${p} v.k_${bone}_${axis}`);
    }
  }
});

test('every variable the played animations read is set by the pre_animation', () => {
  for (const [id, d] of attachables) {
    const set = assigned(d.scripts.pre_animation);
    for (const anim of Object.values(d.animations)) {
      const def = ANIMATIONS.get(/** @type {string} */ (anim));
      if (!def) continue;
      const text = JSON.stringify(def);
      // a read with a ?? fallback (v.kick_grow) is fine unset
      for (const m of text.matchAll(/\b(?:v|variable)\.([a-z_0-9]+)(\s*\?\?)?/g)) if (!m[2]) assert.ok(set.has(m[1]), `${id}: ${anim} reads v.${m[1]}`);
    }
  }
});

test('the attachable animations: hide, one baby per species, the navel crowning and the walk jiggle', () => {
  assert.deepEqual(Object.keys(own).sort(), ['animation.minepreggo.belly_attachable', 'animation.minepreggo.belly_attachable.baby', 'animation.minepreggo.belly_attachable.crowning_navel', 'animation.minepreggo.belly_attachable.walk_jiggle']);
  // her walk, read from her through the arrow in the pre_animation
  const jiggle = JSON.stringify(own['animation.minepreggo.belly_attachable.walk_jiggle']);
  assert.match(jiggle, /v\.owner_distance_moved/);
  assert.doesNotMatch(jiggle, /->/);
  for (const bone of ['mp_body', 'mp_right_leg', 'mp_left_leg']) assert.equal(own['animation.minepreggo.belly_attachable'].bones[bone].scale, 'v.hidden ? 0.0 : 1.0');
  const baby = own['animation.minepreggo.belly_attachable.baby'];
  assert.equal(baby.loop, true);
  assert.equal(Object.keys(baby.bones).length, 10, 'six crotch roots and four navel roots');
  PLAYER_BABIES.forEach(([species], i) => {
    assert.equal(baby.bones[`c_${species}`]?.scale, `(v.crowning && !v.navel && v.mp_baby == ${i + 1}) ? 1.0 : 0.0`, species);
    if (i < 4) assert.equal(baby.bones[`n_${species}`]?.scale, `(v.crowning && v.navel && v.mp_baby == ${i + 1}) ? 1.0 : 0.0`, species);
  });
  const free = crowningAnimations()['animation.minepreggo.crowning_free'];
  assert.deepEqual(own['animation.minepreggo.belly_attachable.crowning_navel'], {
    ...free,
    bones: { crowning_navel: free.bones.crowning, crowning_navel_slide: free.bones.crowning_slide },
  });
});

test('the generated geometry holds every bone the attachable animates (once imported with the crowning mounts)', (t) => {
  let checked = 0;
  for (let p = 0; p <= 9; p++) {
    const file = join(RP, `models/entity/minepreggo/attachable/belly_p${p}.geo.json`);
    if (!existsSync(file)) continue;
    const geometry = json(file)['minecraft:geometry'][0];
    const bones = new Map(geometry.bones.map((/** @type {any} */ b) => [b.name, b]));
    if (!bones.has('c_human')) continue; // the 0.6.0 geometry, before the crowning mounts
    checked++;
    assert.equal(geometry.description.identifier, `geometry.minepreggo.belly_attachable_p${p}`);
    assert.equal(geometry.description.texture_width, 128);
    assert.equal(geometry.description.texture_height, 128);
    assert.equal(bones.get('mp_body')?.binding, "'body'");
    const want = ['crowning', 'crowning_slide', 'crowning_baby', ...PLAYER_BABIES.map(([s]) => `c_${s}`)];
    if (p >= 4) want.push('crowning_navel', 'crowning_navel_slide', 'crowning_navel_baby', ...PLAYER_BABIES.slice(0, 4).map(([s]) => `n_${s}`));
    if (p >= 3) want.push('belly', 'front_kick');
    for (const name of want) assert.ok(bones.has(name), `P${p} has ${name}`);
    // every animation it plays moves at least one of its bones
    const d = attachables.get(`minepreggo:belly_p${p}`);
    for (const anim of Object.values(d.animations)) {
      const def = ANIMATIONS.get(/** @type {string} */ (anim));
      if (def) assert.ok(Object.keys(def.bones ?? {}).some((b) => bones.has(b)), `P${p}: ${anim} moves one of its bones`);
    }
  }
  if (!checked) t.skip('no attachable geometry with the crowning mounts yet (tools/import-jar.mjs)');
});

test('every atlas an attachable names is a 256x256 PNG (once imported)', (t) => {
  const dir = join(RP, 'textures/minepreggo/attachable');
  if (!existsSync(dir)) return t.skip('no attachable atlases yet (tools/import-jar.mjs)');
  for (const [id, d] of attachables) {
    const file = join(RP, `${d.textures.default}.png`);
    assert.ok(existsSync(file), `${id}: ${d.textures.default}.png`);
    const bytes = readFileSync(file);
    assert.equal(bytes.readUInt32BE(16), 256, `${id}: atlas width`);
    assert.equal(bytes.readUInt32BE(20), 256, `${id}: atlas height`);
  }
});
