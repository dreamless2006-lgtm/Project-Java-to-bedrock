// Tests for the Java model converter. The geometry checks need the mod jar (vendor/*.jar or
// $MINEPREGGO_JAR) and are skipped without it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { parameterTypes } from '../lib/java-class.mjs';
import { createModelRunner, toBedrockAnimation, toBedrockGeometry } from '../lib/java-models.mjs';
import { modJar } from '../lib/mod-jar.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const jar = process.env.MINEPREGGO_JAR ??
  (existsSync(join(ROOT, 'vendor')) ? readdirSync(join(ROOT, 'vendor')).filter((f) => f.endsWith('.jar')).map((f) => join(ROOT, 'vendor', f))[0] : undefined);
const files = jar ? unzipSync(new Uint8Array(readFileSync(jar))) : null;
const needsJar = { skip: files ? false : 'mod jar not found (vendor/*.jar or $MINEPREGGO_JAR)' };
const PKG = 'dev/dixmk/minepreggo/client/model/entity/preggo/';
const version = files ? (strFromU8(files['META-INF/mods.toml'] ?? new Uint8Array()).match(/^version="([^"]+)"/m)?.[1] ?? '') : '';
/** The jar read by readable names, whether or not it is obfuscated (tools/lib/mod-jar.mjs). */
const jarOf = () => {
  const runner = createModelRunner(/** @type {any} */ (files), 'dev/dixmk/minepreggo/');
  return { runner, jar: modJar(/** @type {any} */ (files), runner, version) };
};

test('method descriptors split into parameter types', () => {
  assert.deepEqual(parameterTypes('()V'), []);
  assert.deepEqual(parameterTypes('(FFFFFFLnet/minecraft/client/model/geom/builders/CubeDeformation;)Lx;'), [
    'F', 'F', 'F', 'F', 'F', 'F', 'Lnet/minecraft/client/model/geom/builders/CubeDeformation;',
  ]);
  assert.deepEqual(parameterTypes('(J[I[[Ljava/lang/String;D)V'), ['J', '[I', '[[Ljava/lang/String;', 'D']);
});

test('the zombie girl model converts to Bedrock coordinates', needsJar, () => {
  const { jar } = jarOf();
  const layer = jar.layer(`${PKG}zombie/AbstractZombieGirlModel`, 'createP0BodyLayer', 'pregnant_zombie_girl_p0');
  assert.equal(layer.textureWidth, 128);
  const bones = toBedrockGeometry(layer, 'geometry.test', { reparent: { hat: 'head' } })['minecraft:geometry'][0].bones;
  const bone = (/** @type {string} */ name) => bones.find((b) => b.name === name);

  // head: addBox(-4, -8, -4, 8, 8, 8) at offset (0, 0, 0)
  assert.deepEqual(bone('head').cubes[0], { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] });
  assert.equal(bone('hat').parent, 'head');
  assert.equal(bone('hat').cubes[0].inflate, 0.25);
  // right_arm: addBox(-2, -2, -2, 3, 12, 4) at offsetAndRotation(-5, 2, 0, -1.5708, 0, 0)
  assert.deepEqual(bone('right_arm').pivot, [-5, 22, 0]);
  assert.deepEqual(bone('right_arm').rotation, [-90.0002, 0, 0]);
  assert.deepEqual(bone('right_arm').cubes[0].origin, [-7, 12, -2]);
  // belly (child of body): addBox(-3, -0.25, -0.85, 6, 5, 1) at offset (0, 6.75, -1.5)
  assert.equal(bone('belly').parent, 'body');
  assert.deepEqual(bone('belly').pivot, [0, 17.25, -1.5]);
  assert.deepEqual(bone('belly').cubes[0].origin, [-3, 12.5, -2.35]);
  // left boob cube: mirrored, inside two nested parents
  assert.equal(bone('letfBoobCube_r1').cubes[0].mirror, true);
  assert.deepEqual(bone('letfBoobCube_r1').pivot, [1, 22.3, -1.9]);
});

test('every mob model layer converts into a valid bone tree', needsJar, () => {
  const { jar } = jarOf();
  const families = [
    ['zombie/AbstractZombieGirlModel', 'createBodyLayer', 'zombie_girl'],
    ['creeper/AbstractHumanoidCreeperGirlModel', 'createBodyLayer', 'humanoid_creeper_girl'],
    ['creeper/AbstractMonsterCreeperGirlModel', 'createBasicBodyLayer', 'monster_creeper_girl'],
    ['ender/AbstractMonsterEnderWomanModel', 'createBodyLayer', 'monster_ender_woman'],
    ['slime/AbstractHumanoidSlimeGirlModel', 'createNonPregBodyLayer', 'humanoid_slime_girl'],
    ['slime/AbstractMonsterSlimeGirlModel', 'createNonPregBodyLayer', 'monster_slime_girl'],
  ];
  for (const [javaClass, base, registered] of families) {
    for (const [method, name] of [[base, registered], ...Array.from({ length: 10 }, (_, p) => [`createP${p}BodyLayer`, `pregnant_${registered}_p${p}`])]) {
      const geometry = toBedrockGeometry(jar.layer(PKG + javaClass, method, name), 'geometry.test');
      const { bones, description } = geometry['minecraft:geometry'][0];
      const names = bones.map((b) => b.name.toLowerCase());
      assert.equal(new Set(names).size, names.length, `${javaClass}.${method}: duplicate bone names`);
      for (const b of bones) if (b.parent) assert.ok(names.includes(b.parent.toLowerCase()), `${javaClass}.${method}: ${b.name} has unknown parent`);
      assert.ok(bones.some((b) => b.name === 'head') && bones.some((b) => b.name === 'body'), `${javaClass}.${method}`);
      for (const b of bones) for (const c of b.cubes ?? []) {
        assert.ok(c.size.every((n) => Number.isInteger(n) && n >= 0), `${javaClass}.${method}: box UV needs whole sizes`);
        // (Some of the mod's own boxes run past the texture edge, so only the UV origin is checked.)
        assert.ok(c.uv[0] < description.texture_width && c.uv[1] < description.texture_height, `${javaClass}.${method}: ${b.name} UV outside texture`);
      }
    }
  }
});

test('keyframe animations convert back to the values in the Java source', needsJar, () => {
  const { jar } = jarOf();
  const zombie = jar.animations('ZombieGirlAnimations');
  // IDLE: 4 s loop, right_arm rotation degreeVec(-2.5, 0, 0) at 1 s, linear.
  const idle = toBedrockAnimation(zombie.IDLE);
  assert.equal(idle.loop, true);
  assert.equal(idle.animation_length, 4);
  assert.deepEqual(idle.bones.right_arm.rotation['1.0'], [-2.5, 0, 0]);
  assert.deepEqual(idle.bones.body.rotation['2.0'], [0, -2.5, 0]);
  // ATTACK is not looping: Java holds the last frame while the animation state runs.
  assert.equal(toBedrockAnimation(zombie.ATTACK).loop, 'hold_on_last_frame');

  // BellyAnimation.LOW_BELLY_INFLATION: scaleVec(1.01, 1.0, 1.065) at 2 s, Catmull-Rom.
  const belly = toBedrockAnimation(jar.animations('BellyAnimation').LOW_BELLY_INFLATION);
  assert.deepEqual(belly.bones.belly.scale['2.0'], { post: [1.01, 1, 1.065], lerp_mode: 'catmullrom' });

  // posVec keeps the source's argument (Java stores y negated; Bedrock's y points up): RIDING
  // lowers the upper body with posVec(0, -8, 0).
  assert.deepEqual(toBedrockAnimation(zombie.RIDING).bones.body.position['0.0'], [0, -8, 0]);
  assert.ok(toBedrockAnimation(zombie.RIDING).bones.right_arm.rotation, 'rotation and position channels of one bone are merged');
  const slime = jar.animations('HumanoidSlimeGirlAnimations');
  for (const animation of Object.values(slime)) toBedrockAnimation(animation);
  const all = ['ZombieGirlAnimations', 'HumanoidCreeperGirlAnimations', 'MonsterCreeperGirlAnimations', 'MonsterEnderWomanAnimations',
    'HumanoidSlimeGirlAnimations', 'MonsterSlimeGirlAnimations', 'BellyAnimation'];
  const count = all.reduce((n, c) => n + Object.keys(jar.animations(c)).length, 0);
  // (1.3.2's classes hold 126; the 1.3.9 table names the 128 the port plays, its new ones left out)
  assert.equal(count, jar.obfuscated ? 128 : 126);
});
