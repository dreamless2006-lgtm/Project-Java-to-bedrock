// The belly a pregnant player can hold in her off-hand so that players whose game runs Actions &
// Stuff (or any other pack with its own player model) see it (player/compat.js). Each item has an
// attachable that draws the mod's predefined body of one belly size (geometry and atlas written by
// tools/import-jar.mjs) on bones bound to her own body and legs, so whatever animates her moves it
// too, and that body moves on its own: inflation, growth, kicks, contractions, the need-rub belly,
// the pushes, the baby crowning between her legs or out of her navel, and the hidden belly after
// the birth, all read from her entity properties through c.owning_entity->.
//
// Items: one per belly size AND skin tone. An attachable cannot use the player's skin, so there are
// six tones (0 Alex, 1..5 Light, Medium, Tan, Brown, Dark), each with its own atlas. Size and tone
// sit in the item id, the one client-visible channel already proven in game, so the belly always
// shows at the right size and colour even if the arrow read of her properties fails:
//   minepreggo:belly_p0, minepreggo:belly_p1   tone 0 only (legacy ids, kept so old worlds load)
//   minepreggo:belly_p<P>                      P 2..9, tone 0 (Alex)
//   minepreggo:belly_p<P>_t<T>                 P 2..9, T 1..5
// 50 items, 50 attachables. Textures: textures/minepreggo/attachable/belly_p<P>_t<T> (T 0 included).
//
// Nobody has confirmed that an attachable's variables keep their values from one frame to the next,
// so every eased value is written to look right either way:
// - kicks and contractions fade in and out, but while active their weight is never below 0.5
//   (math.max(0.5, ...)), so without persistence they still show, at half strength or more;
// - growth eases toward its target, but snaps to it on any jump larger than 0.2 (a new item or a
//   first frame), so without persistence it is simply always on target;
// - the crowning depth is not eased at all (v.crown = v.crown_t), so the baby is never stuck inside.
//
// It hides itself in first person, wherever this pack's own player model draws her belly already
// (variable.mp_native, public in packs/resource/entity/player.entity.json), and while she is
// invisible or asleep.
// Run (after npm run import, which writes the predefined bodies the kick room is measured on):
//   node tools/gen/belly-items.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { blank, encodePng } from '../lib/png.mjs';
import { KICK_BONES, kickRoom } from '../lib/kick-clamp.mjs';
import { MOD, PHASES, initializers, kickShareLines } from '../lib/belly-render.mjs';
import { PLAYER_BABIES, crowningAnimations, crowningLines } from '../lib/crowning.mjs';
import { MINEPREGGO_JIGGLE_BONES, OWNER_WALK_LINES, walkJiggleAnimation } from '../lib/walk-jiggle.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const RP = `${ROOT}packs/resource/`;
const BP = `${ROOT}packs/behavior/`;
const TONES = [0, 1, 2, 3, 4, 5];
const write = (/** @type {string} */ file, /** @type {unknown} */ doc) => {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
};
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));

/** The item name for a belly size and tone (tone 0 keeps the 0.6.0 id). */
const itemName = (/** @type {number} */ p, /** @type {number} */ t) => (t > 0 ? `belly_p${p}_t${t}` : `belly_p${p}`);
// P0 and P1 are never handed out (the belly shows from P2), so they keep their one legacy item.
const ITEMS = PHASES.flatMap((p) => (p < 2 ? [0] : TONES).map((t) => ({ p, t, name: itemName(p, t) })));

// A small round belly for the icon (it never shows in an inventory but the game needs one).
const icon = blank(16, 16);
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const dx = (x - 7.5) / 6.5, dy = (y - 8.5) / 6;
    if (dx * dx + dy * dy > 1) continue;
    const shade = 1.08 - 0.3 * ((dx + 0.4) ** 2 + (dy + 0.4) ** 2) / 2;
    icon.data.set([...[232, 190, 160].map((v) => Math.min(255, Math.round(v * shade))), 255], (y * 16 + x) * 4);
  }
}
writeFileSync(`${RP}textures/port/belly.png`, encodePng(icon));
const items = read(`${RP}textures/item_texture.json`);
items.texture_data.minepreggo_belly = { textures: 'textures/port/belly' };
write(`${RP}textures/item_texture.json`, items);

// --- the attachable's own animations ---------------------------------------------------------------
const BONES = ['mp_body', 'mp_right_leg', 'mp_left_leg'];
// The baby at each mount: one species root per baby (tools/import-jar.mjs builds them all into the
// geometry, each with its fetus texture in its own slot of the atlas), shown only for hers. The navel
// mount (P4 and up) carries the four humanoid fetuses, the babies a navel birth can bring.
const CROTCH_BABIES = PLAYER_BABIES.map(([species], i) => ({ bone: `c_${species}`, i: i + 1 }));
const NAVEL_BABIES = PLAYER_BABIES.slice(0, 4).map(([species], i) => ({ bone: `n_${species}`, i: i + 1 }));
const crowningFree = crowningAnimations()[`animation.${MOD}.crowning_free`];
const NAVEL_BONE = /** @type {Record<string, string>} */ ({ crowning: 'crowning_navel', crowning_slide: 'crowning_navel_slide' });
write(`${RP}animations/belly_attachable.animation.json`, {
  format_version: '1.8.0',
  animations: {
    [`animation.${MOD}.belly_attachable`]: {
      loop: true,
      bones: Object.fromEntries(BONES.map((bone) => [bone, { scale: 'v.hidden ? 0.0 : 1.0' }])),
    },
    [`animation.${MOD}.belly_attachable.baby`]: {
      loop: true,
      bones: Object.fromEntries([
        ...CROTCH_BABIES.map(({ bone, i }) => [bone, { scale: `(v.crowning && !v.navel && v.mp_baby == ${i}) ? 1.0 : 0.0` }]),
        ...NAVEL_BABIES.map(({ bone, i }) => [bone, { scale: `(v.crowning && v.navel && v.mp_baby == ${i}) ? 1.0 : 0.0` }]),
      ]),
    },
    // her chest, belly and butt bounce as she walks: her walk, read through the arrow
    [`animation.${MOD}.belly_attachable.walk_jiggle`]: walkJiggleAnimation(MINEPREGGO_JIGGLE_BONES, { owner: true }),
    // the crowning of a navel birth: the same free crowning, on the navel mount's own bones
    [`animation.${MOD}.belly_attachable.crowning_navel`]: {
      ...crowningFree,
      bones: Object.fromEntries(Object.entries(crowningFree.bones).map(([bone, channels]) => [NAVEL_BONE[bone] ?? bone, channels])),
    },
  },
});

// --- the scripts of one belly size ------------------------------------------------------------------
/** Seconds a frame may count for when easing (a hitch or a long pause must not jump a whole fade). */
const DT = 'math.clamp(q.delta_time, 0.0, 0.1)';
const OWNER = 'c.owning_entity->';
const property = (/** @type {string} */ name) => `${OWNER}q.property('${MOD}:${name}')`;
/** The share of her growth the belly animation swells by at each size, as on our own player model. */
const growthFactor = (/** @type {number} */ p) => (p <= 2 ? 1.0 : p <= 4 ? 0.9 : p === 5 ? 0.8 : p <= 7 ? 0.7 : 0.6).toFixed(1);
const babyIndex = PLAYER_BABIES.reduceRight((rest, [species], i) => `${property('baby')} == '${species}' ? ${i + 1} : (${rest})`, '0');

/** The predefined body of a size (written by tools/import-jar.mjs); its kick cubes set the kick room. */
function predefinedBody(/** @type {number} */ p) {
  const file = `${RP}models/entity/${MOD}/player_body_predefined_p${p}.geo.json`;
  if (!existsSync(file)) throw new Error(`no ${file.slice(ROOT.length)}: run npm run import first`);
  return read(file)['minecraft:geometry'][0];
}

/**
 * The crowning lines of our own player model, with her sneaking read through the arrow, and the
 * depth set straight to its target (no easing: right even if the variables do not persist).
 */
function attachableCrowningLines() {
  const lines = crowningLines({ when: "v.pose == 'birth' && v.mp_baby > 0", strain: true }).map((line) => line.replace(/(?<!->)\bq\.is_sneaking\b/g, `${OWNER}q.is_sneaking`));
  const crownAt = lines.findIndex((line) => line.startsWith('v.crown ='));
  if (crownAt < 0 || !lines.some((line) => line.includes(`${OWNER}q.is_sneaking`))) throw new Error('crowningLines changed: no v.crown or q.is_sneaking line');
  lines[crownAt] = 'v.crown = v.crown_t;';
  return lines;
}

/** The pre_animation of the belly of size p. */
function preAnimation(/** @type {number} */ p) {
  // the kick room of this size is a constant here (one attachable per size); none below P3
  const room = p >= 3 ? kickRoom(predefinedBody(p)) : {};
  return [
    `v.pose = ${property('pose')};`,
    `v.kick = ${property('kick')};`,
    `v.growth = ${property('growth')};`,
    `v.navel = ${property('navel')};`,
    `v.mp_baby = ${babyIndex};`,
    `v.hidden = c.is_first_person || ${OWNER}v.mp_native || ${OWNER}q.is_invisible || ${OWNER}q.is_sleeping;`,
    ...OWNER_WALK_LINES,
    "v.push = v.pose == 'birth' ? v.growth : 0.0;",
    "v.kicking = v.pose == 'fetal_movement' || v.pose == 'kicking_sit' || v.pose == 'prebirth' || v.pose == 'birth';",
    // the strength last kicked with stays while the kicks fade out (the property drops at once)
    'v.kick_shown = v.kicking ? v.kick : v.kick_shown;',
    "v.contracting = v.pose == 'contraction' || v.pose == 'prebirth';",
    // eased fades, but never under half while active, so they show even without persistence
    `v.kick_w = math.clamp(v.kick_w + (v.kicking ? 1.6 : -1.1) * ${DT}, 0.0, 1.0);`,
    'v.kick_w = v.kicking ? math.max(0.5, v.kick_w) : v.kick_w;',
    `v.cw = math.clamp(v.cw + (v.contracting ? 0.6 : -0.45) * ${DT}, 0.0, 1.0);`,
    'v.cw = v.contracting ? math.max(0.5, v.cw) : v.cw;',
    'v.kl = 1.0 + v.kick;',
    // how much a kick swells, and the share of the babies' movements the keyframed kicks give way to
    'v.kick_grow = 1.0;',
    ...kickShareLines('v'),
    `v.growth_target = ${growthFactor(p)} * v.growth;`,
    // eased toward the target, but at once on a big jump (a new item, or no persistence at all)
    `v.belly_growth = math.abs(v.belly_growth - v.growth_target) > 0.2 ? v.growth_target : v.belly_growth + (v.growth_target - v.belly_growth) * math.min(1.0, 3.0 * ${DT});`,
    ...KICK_BONES.flatMap((bone) => /** @type {const} */ (['x', 'y', 'z']).map((axis) => `v.k_${bone}_${axis} = ${p >= 3 ? (room[bone]?.[axis] ?? 0).toFixed(2) : '0.0'};`)),
    'v.kr_f = v.k_front_kick_z;',
    ...attachableCrowningLines(),
  ];
}

/** The animations (short name to id) and the animate list of the belly of size p. */
function animationsOf(/** @type {number} */ p) {
  const band = p <= 2 ? 0 : p <= 6 ? 1 : 2;
  const strengths = ['i', 'ii', 'iii'];
  /** @type {Record<string, string>} */
  const animations = {
    shown: `animation.${MOD}.belly_attachable`,
    baby: `animation.${MOD}.belly_attachable.baby`,
    inflation: `animation.${MOD}.belly.${['low', 'medium', 'high'][band]}_belly_inflation`,
    growth: `animation.${MOD}.belly_growth`,
    contraction: `animation.${MOD}.contraction_wave`,
    rubs_need: `animation.${MOD}.belly.belly_rubs_needs_${strengths[band]}`,
    postbirth: `animation.${MOD}.player.belly_hidden`,
    fetal_push: `animation.${MOD}.fetal_push`,
    birth_push: `animation.${MOD}.birth_push`,
    crowning: `animation.${MOD}.crowning_free`,
    walk_jiggle: `animation.${MOD}.belly_attachable.walk_jiggle`,
  };
  /** @type {(string | Record<string, string>)[]} */
  const animate = [
    'shown', 'baby', 'inflation', 'growth', 'contraction', 'walk_jiggle',
    { rubs_need: "v.pose == 'belly_rubs'" },
    { postbirth: "v.pose == 'postbirth'" },
    { fetal_push: 'v.kick_w' },
    { birth_push: "v.pose == 'birth'" },
    { crowning: "v.pose == 'birth' && !v.navel" },
  ];
  // the kicks (the mod's keyframed fetal movements and the port's pulses), from the size with kick cubes
  if (p >= 3) {
    strengths.forEach((s, k) => {
      animations[`fetal_${s}`] = `animation.${MOD}.belly.fetal_movement_p${p}_${s}`;
      animate.push({ [`fetal_${s}`]: `v.kick_w * (v.kick_shown == ${k})` });
    });
    strengths.forEach((s, k) => {
      animations[`kick_${s}`] = `animation.${MOD}.kick_${s}`;
      animate.push({ [`kick_${s}`]: `v.kick_w * (v.kick_shown == ${k})` });
    });
  }
  // a navel birth out of the front of the belly, from the size with a navel mount
  if (p >= 4) {
    animations.navel_prebirth = `animation.${MOD}.navel_prebirth`;
    animations.navel_birth = `animation.${MOD}.navel_birth`;
    animations.crowning_navel = `animation.${MOD}.belly_attachable.crowning_navel`;
    animate.push({ navel_prebirth: "v.navel && v.pose == 'prebirth'" }, { navel_birth: "v.navel && v.pose == 'birth'" }, { crowning_navel: "v.pose == 'birth' && v.navel" });
  }
  return { animations, animate };
}

// --- items and attachables --------------------------------------------------------------------------
// (built first: a missing import throws before any committed file is removed)
/** @type {Map<number, { pre_animation: string[], initialize: string[], animations: Record<string, string>, animate: (string | Record<string, string>)[] }>} */
const scripts = new Map();
for (const p of PHASES) {
  const pre = preAnimation(p);
  scripts.set(p, { pre_animation: pre, initialize: initializers(pre, []), ...animationsOf(p) });
}
// A size or tone dropped from the list must not leave its item behind.
mkdirSync(`${BP}items/belly`, { recursive: true });
for (const file of readdirSync(`${BP}items/belly`)) if (file.endsWith('.json')) unlinkSync(`${BP}items/belly/${file}`);
for (const file of readdirSync(`${RP}attachables`)) if (/^belly_.*\.json$/.test(file)) unlinkSync(`${RP}attachables/${file}`);

for (const { p, t, name } of ITEMS) {
  const s = /** @type {NonNullable<ReturnType<typeof scripts.get>>} */ (scripts.get(p));
  write(`${BP}items/belly/${name}.json`, {
    format_version: '1.26.30',
    'minecraft:item': {
      description: { identifier: `${MOD}:${name}`, menu_category: { category: 'none' } },
      components: {
        'minecraft:icon': 'minepreggo_belly',
        'minecraft:display_name': { value: 'item.minepreggo.belly' },
        'minecraft:max_stack_size': 1,
        'minecraft:allow_off_hand': { value: true },
      },
    },
  });
  write(`${RP}attachables/${name}.json`, {
    format_version: '1.10.0',
    'minecraft:attachable': {
      description: {
        identifier: `${MOD}:${name}`,
        // (controller.render.item_default also names the enchanted material and texture)
        materials: { default: 'entity_alphatest', enchanted: 'entity_alphatest_glint' },
        textures: { default: `textures/${MOD}/attachable/belly_p${p}_t${t}`, enchanted: 'textures/misc/enchanted_item_glint' },
        geometry: { default: `geometry.${MOD}.belly_attachable_p${p}` },
        scripts: { initialize: s.initialize, pre_animation: s.pre_animation, animate: s.animate },
        animations: s.animations,
        render_controllers: ['controller.render.item_default'],
      },
    },
  });
}
console.log(`belly items: ${ITEMS.length} items and attachables (${PHASES.length} sizes, ${TONES.length} tones from P2)`);
