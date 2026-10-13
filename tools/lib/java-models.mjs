// Converts the mod's Java entity models (LayerDefinition factories) and keyframe animations
// (AnimationDefinition constants), run from the jar's bytecode by java-class.mjs, into Bedrock
// geometry and animation files.
//
// Java model space has y pointing down with the entity's feet at y = 24; Bedrock's has y up with
// the feet at 0. Part poses are offsets relative to the parent part and rotations are radians;
// Bedrock bones carry absolute pivots and degrees. Rotations keep their sign: Bedrock mirrors x
// as well as y compared to Java, which cancels out for rotations (compare vanilla's Java
// CowModel body, offsetAndRotation(0, 5, 2, PI/2, 0, 0), with Bedrock's geometry.cow body,
// pivot [0, 19, 2] and rotation [90, 0, 0]).

import { createInterpreter, parseClass } from './java-class.mjs';

/**
 * @typedef {{ x: number, y: number, z: number, xRot: number, yRot: number, zRot: number }} Pose
 * @typedef {{ u: number, v: number, x: number, y: number, z: number, w: number, h: number, d: number, grow: number, mirror: boolean }} Cube
 * @typedef {{ cubes: Cube[], pose: Pose, children: Map<string, Part> }} Part
 * @typedef {{ root: Part, textureWidth: number, textureHeight: number }} Layer
 */

const pose = (x = 0, y = 0, z = 0, xRot = 0, yRot = 0, zRot = 0) => ({ x, y, z, xRot, yRot, zRot });

// The vanilla 1.20.1 builder methods the mod's models call, by their SRG names.
const NATIVES = {
  'MeshDefinition.<init>': (_, self) => { self.root = { cubes: [], pose: pose(), children: new Map() }; },
  'MeshDefinition.m_171576_': (_, self) => self.root, // getRoot
  'PartDefinition.m_171599_': ([name, builder, partPose], self) => { // addOrReplaceChild
    const part = { cubes: [...builder.cubes], pose: partPose, children: new Map() };
    const previous = self.children.get(name);
    if (previous) for (const [childName, child] of previous.children) part.children.set(childName, child);
    self.children.set(name, part);
    return part;
  },
  'PartDefinition.m_171597_': ([name], self) => { // getChild
    const child = self.children.get(name);
    if (!child) throw new Error(`no child part named ${name}`);
    return child;
  },
  'CubeListBuilder.m_171558_': () => ({ cubes: [], u: 0, v: 0, mirror: false }), // create
  'CubeListBuilder.m_171514_': ([u, v], self) => Object.assign(self, { u, v }), // texOffs
  'CubeListBuilder.m_171480_': (_, self) => Object.assign(self, { mirror: true }), // mirror()
  'CubeListBuilder.m_171555_': ([mirror], self) => Object.assign(self, { mirror: mirror !== 0 }), // mirror(boolean)
  'CubeListBuilder.m_171488_': ([x, y, z, w, h, d, deformation], self) => { // addBox(..., CubeDeformation)
    if (deformation.x !== deformation.y || deformation.x !== deformation.z) throw new Error('non-uniform CubeDeformation');
    self.cubes.push({ u: self.u, v: self.v, x, y, z, w, h, d, grow: deformation.x, mirror: self.mirror });
    return self;
  },
  'CubeListBuilder.m_171481_': ([x, y, z, w, h, d], self) => { // addBox(x, y, z, w, h, d)
    self.cubes.push({ u: self.u, v: self.v, x, y, z, w, h, d, grow: 0, mirror: self.mirror });
    return self;
  },
  'CubeDeformation.<init>': (args, self) => {
    const [x, y = x, z = x] = args;
    Object.assign(self, { x, y, z });
  },
  'CubeDeformation.m_171469_': ([g], self) => ({ x: Math.fround(self.x + g), y: Math.fround(self.y + g), z: Math.fround(self.z + g) }), // extend
  'PartPose.m_171419_': ([x, y, z]) => pose(x, y, z), // offset
  'PartPose.m_171423_': ([x, y, z, xRot, yRot, zRot]) => pose(x, y, z, xRot, yRot, zRot), // offsetAndRotation
  'PartPose.m_171430_': ([xRot, yRot, zRot]) => pose(0, 0, 0, xRot, yRot, zRot), // rotation
  'LayerDefinition.m_171565_': ([mesh, textureWidth, textureHeight]) => ({ root: mesh.root, textureWidth, textureHeight }), // create
};

// ...and the ones its keyframe animations (AnimationDefinition) are built with. Vectors are kept the
// way Java stores them: rotations in radians, positions with y negated, scales minus one.
const ANIMATION_NATIVES = {
  'AnimationDefinition$Builder.m_232275_': ([length]) => ({ length, looping: false, bones: new Map() }), // withLength
  'AnimationDefinition$Builder.m_232274_': (_, self) => Object.assign(self, { looping: true }), // looping
  'AnimationDefinition$Builder.m_232279_': ([bone, channel], self) => { // addAnimation
    self.bones.set(bone, [...(self.bones.get(bone) ?? []), channel]);
    return self;
  },
  'AnimationDefinition$Builder.m_232282_': (_, self) => ({ length: self.length, looping: self.looping, bones: self.bones }), // build
  'AnimationChannel.<init>': ([target, keyframes], self) => { Object.assign(self, { target, keyframes }); },
  'Keyframe.<init>': ([time, vector, interpolation], self) => { Object.assign(self, { time, vector, interpolation }); },
  'KeyframeAnimations.m_253186_': ([x, y, z]) => { // degreeVec
    const r = Math.fround(Math.PI / 180);
    return [Math.fround(x * r), Math.fround(y * r), Math.fround(z * r)];
  },
  'KeyframeAnimations.m_253126_': ([x, y, z]) => [x, Math.fround(-y), z], // posVec
  'KeyframeAnimations.m_253004_': ([x, y, z]) => [Math.fround(x - 1), Math.fround(y - 1), Math.fround(z - 1)], // scaleVec(double...)
  // BellyAnimation keeps its slap animations in a fastutil map; only the definitions matter here.
  'Byte.valueOf': ([b]) => b,
  'ImmutableMap.of': (args) => args,
  'Byte2ObjectOpenHashMap.<init>': () => {},
  'Byte2ObjectMaps.unmodifiable': ([map]) => map,
  'Object.<init>': () => {},
  'Enum.<init>': () => {},
};

const STATIC_FIELDS = {
  'CubeDeformation.f_171458_': { x: 0, y: 0, z: 0 }, // NONE
  'PartPose.f_171404_': pose(), // ZERO
  'AnimationChannel$Targets.f_232250_': 'position',
  'AnimationChannel$Targets.f_232251_': 'rotation',
  'AnimationChannel$Targets.f_232252_': 'scale',
  'AnimationChannel$Interpolations.f_232229_': 'linear',
  'AnimationChannel$Interpolations.f_232230_': 'catmullrom',
};

/**
 * Loads classes of one Java package tree from an unzipped jar.
 * @param {Record<string, Uint8Array>} files unzipped jar entries
 * @param {string} packagePrefix e.g. "dev/dixmk/minepreggo/"
 */
export function createModelRunner(files, packagePrefix) {
  /** @type {Map<string, import('./java-class.mjs').ClassFile | null>} */
  const cache = new Map();
  const loadClass = (/** @type {string} */ name) => {
    if (!name.startsWith(packagePrefix)) return null;
    if (!cache.has(name)) {
      const bytes = files[`${name}.class`];
      cache.set(name, bytes ? parseClass(bytes) : null);
    }
    return /** @type {any} */ (cache.get(name));
  };
  const interpreter = createInterpreter({
    loadClass,
    natives: { ...NATIVES, ...ANIMATION_NATIVES },
    staticFields: STATIC_FIELDS,
    newObject: (owner) => ({ class: owner }),
  });
  return {
    /** Runs `ClassName.method()` (a static LayerDefinition factory) and returns the part tree. */
    layer(/** @type {string} */ className, /** @type {string} */ method) {
      return /** @type {Layer} */ (interpreter.runStatic(className, method, '()Lnet/minecraft/client/model/geom/builders/LayerDefinition;'));
    },
    /** The AnimationDefinition constants of a class, by field name. */
    animations(/** @type {string} */ className) {
      const statics = interpreter.staticFields(className);
      return /** @type {Record<string, JavaAnimation>} */ (
        Object.fromEntries(Object.entries(statics).filter(([, v]) => v && typeof v.length === 'number' && v.bones instanceof Map))
      );
    },
  };
}

/**
 * @typedef {{ target: 'position' | 'rotation' | 'scale', keyframes: { time: number, vector: number[], interpolation: string }[] }} JavaChannel
 * @typedef {{ length: number, looping: boolean, bones: Map<string, JavaChannel[]> }} JavaAnimation
 */

const timecode = (/** @type {number} */ seconds) => {
  const t = round(seconds);
  return Number.isInteger(t) ? t.toFixed(1) : String(t);
};

const BEDROCK_VALUE = {
  rotation: (/** @type {number[]} */ v) => v.map(degrees),
  position: (/** @type {number[]} */ v) => [round(v[0]), round(-v[1]), round(v[2])],
  scale: (/** @type {number[]} */ v) => v.map((n) => round(n + 1)),
};

/**
 * Turns a Java keyframe animation into a Bedrock animation. Values come out as the arguments the
 * Java source passed to degreeVec/posVec/scaleVec, which is also what Bedrock expects: Bedrock's
 * position and rotation axes relate to Java's the same way as the geometry (see the top of this
 * file). Java holds the last frame of a finished non-looping animation while it is active, which
 * is Bedrock's "hold_on_last_frame".
 * @param {JavaAnimation} animation
 * @param {Record<string, string>} [boneNames] Java part name -> Bedrock bone name
 */
export function toBedrockAnimation(animation, boneNames = {}) {
  /** @type {Record<string, any>} */
  const bones = {};
  for (const [javaBone, channels] of animation.bones) {
    const bone = (bones[boneNames[javaBone] ?? javaBone] ??= {});
    for (const channel of channels) {
      if (bone[channel.target]) throw new Error(`two ${channel.target} channels for ${javaBone}`);
      /** @type {Record<string, any>} */
      const frames = {};
      for (const { time, vector, interpolation } of channel.keyframes) {
        const value = BEDROCK_VALUE[channel.target](vector);
        frames[timecode(time)] = interpolation === 'catmullrom' ? { post: value, lerp_mode: 'catmullrom' } : value;
      }
      bone[channel.target] = frames;
    }
  }
  return {
    loop: animation.looping ? true : 'hold_on_last_frame',
    animation_length: round(animation.length),
    bones,
  };
}

const round = (/** @type {number} */ n) => {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};
const degrees = (/** @type {number} */ radians) => round((radians * 180) / Math.PI);

/**
 * @typedef {{
 *   rename?: Record<string, string>,
 *   reparent?: Record<string, string>,
 *   extraBones?: { name: string, parent: string, pivot: number[] }[],
 * }} ConvertOptions
 */

/**
 * Turns a Java part tree into a Bedrock geometry (format 1.12.0).
 * Bone names must be unique in Bedrock, so repeated Java names (common for Blockbench's
 * "cube_r1" helpers) get their parent's name prepended. `rename` maps Java part names to
 * Bedrock bone names, `reparent` moves bones under another bone without changing where they are
 * (Java's HumanoidModel copies the head pose onto the hat every frame; Bedrock parents it).
 * @param {Layer} layer
 * @param {string} identifier e.g. "geometry.minepreggo.zombie_girl"
 * @param {ConvertOptions} [options]
 */
export function toBedrockGeometry(layer, identifier, { rename = {}, reparent = {}, extraBones = [] } = {}) {
  const bones = [];
  const used = new Set();
  let maxRadius = 0;
  let maxY = 0;
  let minY = 0;

  /** @param {Part} part @param {string} javaName @param {string | null} parent @param {number[]} origin parent's absolute Java position */
  const visit = (part, javaName, parent, origin) => {
    let name = rename[javaName] ?? javaName;
    if (used.has(name.toLowerCase())) name = `${parent}_${name}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name}_${n}`;
    used.add(name.toLowerCase());

    const [px, py, pz] = [origin[0] + part.pose.x, origin[1] + part.pose.y, origin[2] + part.pose.z];
    /** @type {Record<string, any>} */
    const bone = { name };
    const parentName = reparent[javaName] ?? parent;
    if (parentName) bone.parent = parentName;
    bone.pivot = [round(px), round(24 - py), round(pz)];
    if (part.pose.xRot || part.pose.yRot || part.pose.zRot) {
      bone.rotation = [degrees(part.pose.xRot), degrees(part.pose.yRot), degrees(part.pose.zRot)];
    }
    if (part.cubes.length) {
      bone.cubes = part.cubes.map((c) => {
        /** @type {Record<string, any>} */
        const cube = {
          origin: [round(px + c.x), round(24 - (py + c.y + c.h)), round(pz + c.z)],
          size: [round(c.w), round(c.h), round(c.d)],
          uv: [c.u, c.v],
        };
        if (c.grow) cube.inflate = round(c.grow);
        if (c.mirror) cube.mirror = true;
        maxRadius = Math.max(maxRadius, Math.abs(px + c.x), Math.abs(px + c.x + c.w), Math.abs(pz + c.z), Math.abs(pz + c.z + c.d));
        maxY = Math.max(maxY, 24 - (py + c.y));
        minY = Math.min(minY, 24 - (py + c.y + c.h));
        return cube;
      });
    }
    bones.push(bone);
    for (const [childName, child] of part.children) visit(child, childName, name, [px, py, pz]);
  };
  for (const [name, part] of layer.root.children) visit(part, name, null, [0, 0, 0]);
  for (const extra of extraBones) bones.push({ name: extra.name, parent: extra.parent, pivot: extra.pivot });

  // Generous bounds: animations swing limbs outside the rest pose.
  const width = Math.ceil(((maxRadius * 2) / 16 + 1) * 2) / 2;
  const height = Math.ceil(((maxY - minY) / 16 + 1) * 2) / 2;
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier,
          texture_width: layer.textureWidth,
          texture_height: layer.textureHeight,
          visible_bounds_width: width,
          visible_bounds_height: height,
          visible_bounds_offset: [0, round(height / 2 - 0.5), 0],
        },
        bones,
      },
    ],
  };
}
