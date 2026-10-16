// Tests for the off-hand belly's geometry and tone atlases (tools/lib/belly-attachable.mjs). The
// checks of the generated files run only after `node tools/import-jar.mjs` (they are git-ignored).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blank, decodePng } from '../lib/png.mjs';
import { PLAYER_BABIES } from '../lib/crowning.mjs';
import { TONES, atlas, attachableGeometry, bellyFront, descendants, fetusSlot, navelOpening, offsetUv, prefixBones, recolor, skinBase, upscale2 } from '../lib/belly-attachable.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RP = join(ROOT, 'packs/resource');
const SPECIES = PLAYER_BABIES.map(([species]) => species);

/** An image of one row of pixels. */
const strip = (/** @type {number[][]} */ pixels) => {
  const image = blank(pixels.length, 1);
  pixels.forEach((p, i) => image.data.set(p, i * 4));
  return image;
};
const pixel = (/** @type {import('../lib/png.mjs').Image} */ image, /** @type {number} */ x, /** @type {number} */ y = 0) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const luma = (/** @type {number[]} */ c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// The mod's Alex: skin and its shadow, the green shirt, brown trousers, orange hair, a transparent texel.
const SKIN = [242, 221, 194, 255];
const SKIN_SHADOW = [212, 183, 143, 255];
const SHIRT = [140, 190, 138, 255];
const TROUSERS = [100, 65, 44, 255];
const HAIR = [229, 141, 63, 255];
const CLEAR = [0, 0, 0, 0];
const alex = () => strip([SKIN, SKIN, SKIN, SKIN, SKIN, SKIN_SHADOW, SHIRT, SHIRT, TROUSERS, HAIR, CLEAR]);

test('the skin base is the light skin, not the hair or the trousers', () => {
  const base = skinBase(alex());
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(base[k] - SKIN[k]) <= 4, `channel ${k}: ${base[k]}`);
  assert.throws(() => skinBase(strip([SHIRT, TROUSERS])), /no skin/);
});

test('a tone recolours the skin only, keeping its shading', () => {
  const image = alex();
  const base = skinBase(image);
  for (const t of [1, 2, 3, 4, 5]) {
    const tone = /** @type {readonly number[]} */ (TONES[t]);
    const out = recolor(image, tone, base);
    const skin = pixel(out, 0);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(skin[k] - tone[k]) <= 12, `tone ${t} channel ${k}: ${skin[k]} vs ${tone[k]}`);
    // the shadow stays darker than the skin, by about the same share as in the original
    const shadow = pixel(out, 5);
    assert.ok(luma(shadow) < luma(skin), `tone ${t}: the shadow is darker`);
    assert.ok(Math.abs(luma(shadow) / luma(skin) - luma(SKIN_SHADOW) / luma(SKIN)) < 0.05, `tone ${t}: relative shading kept`);
    assert.deepEqual(pixel(out, 6), SHIRT, 'the shirt is untouched');
    assert.deepEqual(pixel(out, 8), TROUSERS, 'the trousers are untouched');
    assert.deepEqual(pixel(out, 9), HAIR, 'the hair is untouched');
    assert.deepEqual(pixel(out, 10), CLEAR);
    assert.equal(skin[3], 255, 'alpha kept');
  }
  // tone 0 is the texture as it is, in a copy
  const same = recolor(image, TONES[0], base);
  assert.deepEqual(same, image);
  assert.notEqual(same.data, image.data);
});

test('the atlas doubles the belly into the left half and puts each fetus in its slot', () => {
  const belly = blank(64, 128);
  belly.data.set([10, 20, 30, 255], (5 * 64 + 3) * 4);
  belly.data.set([1, 2, 3, 255], (127 * 64 + 63) * 4);
  const fetuses = SPECIES.map((_, i) => {
    const f = blank(64, 64);
    f.data.set([100 + i, 7, 9, 255], 0);
    f.data.set([200 + i, 8, 9, 255], (63 * 64 + 63) * 4);
    return f;
  });
  const out = atlas(belly, fetuses);
  assert.equal(out.width, 256);
  assert.equal(out.height, 256);
  for (const [x, y] of [[6, 10], [7, 10], [6, 11], [7, 11]]) assert.deepEqual(pixel(out, x, y), [10, 20, 30, 255]);
  assert.deepEqual(pixel(out, 127, 255), [1, 2, 3, 255]);
  SPECIES.forEach((_, i) => {
    const [x, y] = fetusSlot(i).px;
    assert.deepEqual([x, y], [128 + 64 * (i % 2), 64 * Math.floor(i / 2)]);
    assert.deepEqual(fetusSlot(i).uv, [64 + 32 * (i % 2), 32 * Math.floor(i / 2)]);
    assert.deepEqual(pixel(out, x, y), [100 + i, 7, 9, 255]);
    assert.deepEqual(pixel(out, x + 63, y + 63), [200 + i, 8, 9, 255]);
  });
  // the slot below the six stays empty, and a missing fetus leaves its slot empty
  assert.equal(pixel(out, 200, 220)[3], 0);
  assert.equal(pixel(atlas(belly, [null, fetuses[1]]), 128, 0)[3], 0);
  assert.equal(upscale2(belly).width, 128);
});

test('offsetUv moves box and per-face UVs without touching the input', () => {
  const bones = [
    { name: 'a', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [2, 3] }] },
    { name: 'b', parent: 'a', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: { north: { uv: [1, 1], uv_size: [2, 2] }, up: { uv: [4, 5], uv_size: [-2, 2] } } }] },
    { name: 'c', pivot: [0, 0, 0] },
  ];
  const before = JSON.stringify(bones);
  const out = offsetUv(bones, [64, 32]);
  assert.deepEqual(out[0].cubes?.[0].uv, [66, 35]);
  assert.deepEqual(out[1].cubes?.[0].uv, { north: { uv: [65, 33], uv_size: [2, 2] }, up: { uv: [68, 37], uv_size: [-2, 2] } });
  assert.deepEqual(out[2], { name: 'c', pivot: [0, 0, 0] });
  assert.equal(JSON.stringify(bones), before);
});

test('prefixBones renames bones and parents and hangs the roots from the new parent', () => {
  const bones = [{ name: 'fetus_body', parent: 'crowning_baby' }, { name: 'fetus_head', parent: 'fetus_body' }];
  assert.deepEqual(prefixBones(bones, 'c_human_', 'c_human'), [
    { name: 'c_human_fetus_body', parent: 'c_human' },
    { name: 'c_human_fetus_head', parent: 'c_human_fetus_body' },
  ]);
  assert.deepEqual(prefixBones([{ name: 'x', parent: 'gone' }], 'p_'), [{ name: 'p_x' }]);
  assert.deepEqual(descendants([{ name: 'r' }, { name: 'a', parent: 'r' }, { name: 'b', parent: 'a' }, { name: 'c' }], 'r').map((b) => b.name), ['a', 'b']);
});

/** A tiny predefined body: torso pivot, a belly with a front kick resting inside it, legs. */
const tinyBody = () => ({
  description: { identifier: 'geometry.test.body', texture_width: 64, texture_height: 128 },
  bones: [
    { name: 'body', pivot: [0, 24, 0] },
    { name: 'belly', parent: 'body', pivot: [0, 19, -1], rotation: [2.5, 0, 0], cubes: [{ origin: [-4, 12, -9], size: [8, 7, 8], uv: [0, 7], inflate: 0.5 }] },
    { name: 'front_kick', parent: 'belly', pivot: [2.5, 15, -4.5], cubes: [{ origin: [1, 13.5, -6], size: [3, 3, 3], uv: [7, 16] }] },
    { name: 'rightLeg', pivot: [-1.9, 12, 0] },
    { name: 'right_butt', parent: 'rightLeg', pivot: [-2, 12, 1.4], cubes: [{ origin: [-4, 9, 1], size: [4, 3, 2], uv: [32, 1] }] },
    { name: 'leftLeg', pivot: [1.9, 12, 0] },
  ],
});
const oneCubeBaby = (/** @type {number} */ i) => ({ species: SPECIES[i], i, bones: offsetUv([{ name: 'fetus_head', parent: 'crowning_baby', pivot: [0, 9, -0.5], cubes: [{ origin: [-1.5, 9, -2], size: [3, 3, 3], uv: [0, 0] }] }], fetusSlot(i).uv) });

test('the attachable geometry binds her bones and mounts every species at the crotch', () => {
  const doc = attachableGeometry({ id: 'geometry.test.attachable', body: tinyBody(), crotch: { opening: [0, 12, -0.5], babies: SPECIES.map((_, i) => oneCubeBaby(i)) } });
  assert.equal(doc.format_version, '1.12.0');
  const g = doc['minecraft:geometry'][0];
  assert.deepEqual(g.description, { identifier: 'geometry.test.attachable', texture_width: 128, texture_height: 128, visible_bounds_width: 3, visible_bounds_height: 3.5, visible_bounds_offset: [0, 1.25, 0] });
  const names = g.bones.map((b) => b.name);
  assert.equal(new Set(names).size, names.length, 'unique bone names');
  const bone = (/** @type {string} */ name) => g.bones.find((b) => b.name === name);
  assert.equal(bone('mp_body')?.binding, "'body'");
  assert.equal(bone('mp_right_leg')?.binding, "'rightLeg'");
  assert.equal(bone('mp_left_leg')?.binding, "'leftLeg'");
  assert.equal(bone('belly')?.parent, 'mp_body');
  assert.equal(bone('right_butt')?.parent, 'mp_right_leg');
  assert.equal(bone('body'), undefined);
  assert.equal(bone('crowning')?.parent, 'mp_body');
  assert.deepEqual(bone('crowning')?.pivot, [0, 12, -0.5]);
  assert.equal(bone('crowning_slide')?.parent, 'crowning');
  assert.deepEqual(bone('crowning_baby'), { name: 'crowning_baby', parent: 'crowning_slide', pivot: [0, 12, -0.5], rotation: [180, 0, 0] });
  SPECIES.forEach((species, i) => {
    assert.deepEqual(bone(`c_${species}`), { name: `c_${species}`, parent: 'crowning_baby', pivot: [0, 12, -0.5] });
    assert.equal(bone(`c_${species}_fetus_head`)?.parent, `c_${species}`);
    assert.deepEqual(bone(`c_${species}_fetus_head`)?.cubes?.[0].uv, fetusSlot(i).uv);
  });
  assert.ok(!names.some((n) => /^(n_|crowning_navel)/.test(n)), 'no navel mount without a navel');
  assert.throws(() => attachableGeometry({ id: 'x', body: tinyBody(), crotch: { opening: [0, 12, -0.5], babies: [oneCubeBaby(0), oneCubeBaby(0)] } }), /two bones named c_human/);
});

test('the navel mount sits on the front of the belly and holds the humanoid species', () => {
  const body = tinyBody();
  const at = navelOpening(body);
  // the front kick's height, on the belly's front face (z -9 less the inflate), not on the kick cube inside it
  assert.deepEqual(at, { opening: [0, 15, -9.5], mount: [-90, 0, 0] });
  assert.equal(bellyFront(body, 0, 15), -9.5);
  assert.equal(bellyFront(body, 0, 30), undefined);
  const doc = attachableGeometry({ id: 'geometry.test.attachable', body, crotch: { opening: [0, 12, -0.5], babies: [oneCubeBaby(0)] }, navel: { ...at, babies: [0, 1, 2, 3].map(oneCubeBaby) } });
  const bones = doc['minecraft:geometry'][0].bones;
  const bone = (/** @type {string} */ name) => bones.find((b) => b.name === name);
  assert.deepEqual(bone('crowning_navel'), { name: 'crowning_navel', parent: 'belly', pivot: [0, 15, -9.5], rotation: [-90, 0, 0] });
  assert.equal(bone('crowning_navel_slide')?.parent, 'crowning_navel');
  assert.deepEqual(bone('crowning_navel_baby')?.rotation, [180, 0, 0]);
  for (const species of ['human', 'zombie', 'creeper', 'ender']) {
    assert.equal(bone(`n_${species}`)?.parent, 'crowning_navel_baby');
    assert.equal(bone(`n_${species}_fetus_head`)?.parent, `n_${species}`);
  }
  assert.equal(bone('n_slime'), undefined);
  assert.throws(() => attachableGeometry({ id: 'x', body: { bones: body.bones.filter((b) => b.name === 'body') }, crotch: { opening: [0, 12, -0.5], babies: [] }, navel: { ...at, babies: [] } }), /belly/);
});

// ---- the generated files ----

const GEO = (/** @type {number} */ p) => join(RP, `models/entity/minepreggo/attachable/belly_p${p}.geo.json`);
const ATLAS = (/** @type {number} */ p, /** @type {number} */ t) => join(RP, `textures/minepreggo/attachable/belly_p${p}_t${t}.png`);
const generated = existsSync(GEO(0)) && existsSync(ATLAS(0, 0));
const needsImport = { skip: generated ? false : 'attachable geometry not generated (node tools/import-jar.mjs)' };

test('every phase has the crowning mounts and species roots', needsImport, () => {
  for (let p = 0; p <= 9; p++) {
    const doc = JSON.parse(readFileSync(GEO(p), 'utf8'));
    const g = doc['minecraft:geometry'][0];
    assert.equal(g.description.identifier, `geometry.minepreggo.belly_attachable_p${p}`);
    assert.equal(g.description.texture_width, 128);
    assert.equal(g.description.texture_height, 128);
    const names = g.bones.map((/** @type {any} */ b) => b.name);
    assert.equal(new Set(names).size, names.length, `P${p}: unique bone names`);
    const bone = (/** @type {string} */ name) => g.bones.find((/** @type {any} */ b) => b.name === name);
    assert.equal(bone('mp_body')?.binding, "'body'", `P${p}: mp_body bound`);
    assert.ok(bone('belly'), `P${p}: belly`);
    assert.equal(bone('crowning')?.parent, 'mp_body', `P${p}: crowning`);
    assert.equal(bone('crowning_slide')?.parent, 'crowning', `P${p}: crowning_slide`);
    for (const species of SPECIES) assert.equal(bone(`c_${species}`)?.parent, 'crowning_baby', `P${p}: c_${species}`);
    if (p >= 3) assert.ok(bone('front_kick'), `P${p}: front_kick`);
    if (p >= 4) {
      assert.equal(bone('crowning_navel')?.parent, 'belly', `P${p}: crowning_navel`);
      assert.ok(bone('crowning_navel_slide'), `P${p}: crowning_navel_slide`);
      for (const species of SPECIES.slice(0, 4)) assert.equal(bone(`n_${species}`)?.parent, 'crowning_navel_baby', `P${p}: n_${species}`);
      // the navel baby starts on the belly's skin, in front of the resting front kick
      const kick = bone('front_kick').cubes[0];
      assert.ok(bone('crowning_navel').pivot[2] < kick.origin[2] - 1, `P${p}: the navel opening is on the skin, in front of the kick cube`);
    } else assert.ok(!names.some((/** @type {string} */ n) => /^(n_|crowning_navel)/.test(n)), `P${p}: no navel mount`);
    // every species draws from its own slot of the atlas
    SPECIES.forEach((species, i) => {
      const [u0, v0] = fetusSlot(i).uv;
      for (const b of g.bones.filter((/** @type {any} */ b) => b.name.startsWith(`c_${species}_`) || b.name.startsWith(`n_${species}_`))) {
        for (const cube of b.cubes ?? []) {
          const uvs = Array.isArray(cube.uv) ? [cube.uv] : Object.values(cube.uv).map((/** @type {any} */ f) => f.uv);
          for (const [u, v] of uvs) assert.ok(u >= u0 && u < u0 + 32 && v >= v0 && v < v0 + 32, `P${p} ${b.name}: uv ${u},${v} outside slot ${i}`);
        }
      }
    });
  }
});

test('every phase and tone has its 256 x 256 atlas', needsImport, () => {
  for (let p = 0; p <= 9; p++) {
    for (let t = 0; t <= 5; t++) {
      assert.ok(existsSync(ATLAS(p, t)), `belly_p${p}_t${t}.png`);
    }
    const image = decodePng(new Uint8Array(readFileSync(ATLAS(p, 0))));
    assert.equal(image.width, 256);
    assert.equal(image.height, 256);
  }
});
