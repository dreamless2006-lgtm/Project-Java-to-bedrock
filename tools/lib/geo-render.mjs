// A small software renderer for Bedrock entity geometry, so bellies, poses and animations can be
// looked at as pictures before they reach a device. Bones are posed the way the game poses them:
// a bone's rest rotation plus its animation rotation (angles summed per axis) about its pivot, the
// three axis rotations applied X first, then Y, then Z about the pivot's fixed axes, with the
// game's sign convention (a positive X rotation tilts the top of a bone forward, toward -z; a
// positive Y rotation turns the front of a bone toward -x, her own right; a positive Z rotation tilts the top of a
// bone toward +x, so a right arm hanging at -x swings outward), checked against the vanilla
// sneaking, riding and bob animations, the mod's own converted labor animations (lying on her back,
// sitting with her legs forward) and the Jenny-port rigs' rest poses (arms hang away from the body). Cubes may
// carry their own pivot and rotation (format 1.12.0+); per-face UVs and box UVs are sampled from
// the textures with nearest-neighbour lookup, lit by one directional light plus ambient.
import { rotateBedrock } from './bedrock-math.mjs';
import { blank } from './png.mjs';

/** @typedef {import('./png.mjs').Image} Image */
/** @typedef {{ rotation?: (number | string)[], position?: (number | string)[], scale?: (number | string)[] | number | string }} BonePose */


export { rotateBedrock };

const DEG = Math.PI / 180;

const num = (/** @type {unknown} */ v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vec3 = (/** @type {unknown} */ v, fallback = 0) => (Array.isArray(v) ? [num(v[0], fallback), num(v[1], fallback), num(v[2], fallback)] : [fallback, fallback, fallback]);

/**
 * The world-space placement of every bone of a geometry under a pose: a function mapping a point
 * in the bone's rest frame to the posed model space (parents applied), and the posed pivot.
 * Molang strings in a pose count as 0 (rotation/position) or 1 (scale).
 * @param {{ bones: any[] }} geometry
 * @param {Record<string, BonePose>} pose by bone name
 */
export function poseBones(geometry, pose = {}) {
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  /** @type {Map<string, (p: number[]) => number[]>} */
  const transforms = new Map();
  const transformOf = (/** @type {string} */ name) => {
    const cached = transforms.get(name);
    if (cached) return cached;
    const bone = byName.get(name);
    if (!bone) return (/** @type {number[]} */ p) => p;
    const parent = bone.parent && byName.has(bone.parent) ? transformOf(bone.parent) : (/** @type {number[]} */ p) => p;
    const anim = pose[name] ?? {};
    const pivot = vec3(bone.pivot);
    const rotation = vec3(bone.rotation).map((r, k) => r + vec3(anim.rotation)[k]);
    const position = vec3(anim.position);
    const scale = Array.isArray(anim.scale) ? vec3(anim.scale, 1) : typeof anim.scale === 'number' ? [anim.scale, anim.scale, anim.scale] : [1, 1, 1];
    const local = (/** @type {number[]} */ p) => {
      const rel = p.map((v, k) => (v - pivot[k]) * scale[k]);
      const r = rotateBedrock(rel, rotation);
      // an animation position moves the bone in its parent's frame; x follows the file's axis
      return r.map((v, k) => v + pivot[k] + position[k]);
    };
    const fn = (/** @type {number[]} */ p) => parent(local(p));
    transforms.set(name, fn);
    return fn;
  };
  for (const bone of geometry.bones) transformOf(bone.name);
  return transforms;
}

/** Box UV as per-face UVs (Blockbench's layout). */
function boxFaces(/** @type {number[]} */ uv, /** @type {number[]} */ size) {
  const [u, v] = uv;
  const [w, h, d] = size.map((n) => Math.max(1, Math.ceil(n - 1e-6)));
  return {
    east: { uv: [u, v + d], uv_size: [d, h] },
    north: { uv: [u + d, v + d], uv_size: [w, h] },
    west: { uv: [u + d + w, v + d], uv_size: [d, h] },
    south: { uv: [u + 2 * d + w, v + d], uv_size: [w, h] },
    up: { uv: [u + d, v], uv_size: [w, d] },
    down: { uv: [u + d + w, v + d], uv_size: [w, -d] },
  };
}

/**
 * The faces of every cube of a geometry under a pose, in model space: 4 corners each (counter-
 * clockwise seen from outside), the face's UV rectangle and the texture key of the geometry.
 * @param {{ bones: any[] }} geometry
 * @param {Record<string, BonePose>} pose
 * @param {{ hidden?: Set<string>, texture?: string }} [options] bones not drawn (with their children), texture name
 */
export function cubeFaces(geometry, pose = {}, { hidden = new Set(), texture = 'default' } = {}) {
  const transforms = poseBones(geometry, pose);
  const byName = new Map(geometry.bones.map((b) => [b.name, b]));
  const isHidden = (/** @type {string} */ name) => {
    for (let bone = byName.get(name); bone; bone = bone.parent ? byName.get(bone.parent) : undefined) if (hidden.has(bone.name)) return true;
    return false;
  };
  /** @type {{ corners: number[][], uv: { uv: number[], uv_size: number[] } | undefined, texture: string, mirror: boolean }[]} */
  const faces = [];
  for (const bone of geometry.bones) {
    if (isHidden(bone.name)) continue;
    const toWorld = transforms.get(bone.name) ?? ((/** @type {number[]} */ p) => p);
    for (const cube of bone.cubes ?? []) {
      const inflate = num(cube.inflate);
      const lo = vec3(cube.origin).map((o) => o - inflate);
      const hi = vec3(cube.origin).map((o, k) => o + num(cube.size[k]) + inflate);
      const cubePivot = cube.pivot ? vec3(cube.pivot) : undefined;
      const cubeRotation = cube.rotation ? vec3(cube.rotation) : undefined;
      const place = (/** @type {number[]} */ p) => {
        let q = p;
        if (cubePivot && cubeRotation) q = rotateBedrock(p.map((v, k) => v - cubePivot[k]), cubeRotation).map((v, k) => v + cubePivot[k]);
        return toWorld(q);
      };
      const c = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => place([x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]]);
      const uvs = Array.isArray(cube.uv) ? boxFaces(cube.uv, vec3(cube.size)) : cube.uv ?? {};
      const mirror = !!cube.mirror;
      // corners listed so that (b - a) x (c - a) points outward in the file's (left-handed) frame
      faces.push(
        { corners: [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], uv: uvs.north, texture, mirror },
        { corners: [c(1, 0, 1), c(0, 0, 1), c(0, 1, 1), c(1, 1, 1)], uv: uvs.south, texture, mirror },
        { corners: [c(1, 0, 0), c(1, 0, 1), c(1, 1, 1), c(1, 1, 0)], uv: uvs.west, texture, mirror },
        { corners: [c(0, 0, 1), c(0, 0, 0), c(0, 1, 0), c(0, 1, 1)], uv: uvs.east, texture, mirror },
        { corners: [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)], uv: uvs.up, texture, mirror },
        { corners: [c(0, 0, 1), c(1, 0, 1), c(1, 0, 0), c(0, 0, 0)], uv: uvs.down, texture, mirror }
      );
    }
  }
  return faces;
}

/**
 * @typedef {object} Camera
 * @property {number} yaw degrees around +y: 0 looks at the model's front (from -z), 90 from the model's left (+x), -90 from its right
 * @property {number} pitch degrees: positive looks down on the model
 * @property {number} scale pixels per model unit
 * @property {number[]} [center] model point drawn at the image centre (default the middle of the model)
 */

/**
 * Draws faces (from cubeFaces) into an RGBA image with an orthographic camera, z-buffered, lit by a
 * key light from the camera's upper left and ambient light; faces whose texture texel is
 * transparent are skipped; untextured faces are mid grey.
 * @param {ReturnType<typeof cubeFaces>} faces
 * @param {Record<string, { image: Image, width: number, height: number }>} textures by texture key: the image and the geometry's texture_width/height
 * @param {Camera} camera
 * @param {{ width?: number, height?: number, background?: number[] }} [options]
 */
export function rasterize(faces, textures, camera, { width = 256, height = 320, background = [34, 36, 40, 255] } = {}) {
  const image = blank(width, height);
  for (let i = 0; i < width * height; i++) image.data.set(background, i * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  // Camera basis: the viewer stands at yaw/pitch in front of the model; a left-handed file frame
  // is drawn as seen by someone looking at the model's front, so +x of the file is on the viewer's right.
  const yaw = camera.yaw * DEG, pitch = camera.pitch * DEG;
  const view = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]; // from the model toward the viewer
  const right = [Math.cos(yaw), 0, Math.sin(yaw)];
  const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
  const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let center = camera.center;
  if (!center) {
    // the middle of the bulk of the model (5th to 95th percentile), so a stray prop far away does not push it off the picture
    const coords = [0, 1, 2].map((k) => faces.flatMap((f) => f.corners.map((c) => c[k])).sort((a, b) => a - b));
    const at = (/** @type {number[]} */ list, /** @type {number} */ q) => list[Math.min(list.length - 1, Math.max(0, Math.floor(q * (list.length - 1))))] ?? 0;
    center = coords.map((list) => (at(list, 0.05) + at(list, 0.95)) / 2);
  }
  const project = (/** @type {number[]} */ p) => {
    const rel = p.map((v, k) => v - /** @type {number[]} */ (center)[k]);
    return { x: width / 2 + dot(rel, right) * camera.scale, y: height / 2 - dot(rel, up) * camera.scale, z: -dot(rel, view) };
  };
  const light = [0.4, 0.75, 0.55];
  const lightLen = Math.hypot(...light);
  const lightDir = light.map((v) => v / lightLen);
  const key = [lightDir[0] * right[0] + lightDir[1] * up[0] + lightDir[2] * view[0], lightDir[0] * right[1] + lightDir[1] * up[1] + lightDir[2] * view[1], lightDir[0] * right[2] + lightDir[1] * up[2] + lightDir[2] * view[2]];
  for (const face of faces) {
    const [a, b, c, d] = face.corners;
    const e1 = b.map((v, k) => v - a[k]), e2 = d.map((v, k) => v - a[k]);
    let normal = cross(e1, e2);
    const len = Math.hypot(...normal);
    if (len < 1e-9) continue;
    normal = normal.map((v) => v / len);
    // the file frame is left-handed: outward normals come out flipped by the right-hand cross product
    normal = normal.map((v) => -v);
    const facing = dot(normal, view);
    if (facing <= 0) continue; // back face
    const shade = 0.55 + 0.45 * Math.max(0, dot(normal, key));
    const tex = textures[face.texture];
    const uv = face.uv;
    const p = [project(a), project(b), project(c), project(d)];
    // two triangles with linear interpolation of depth and face-local (s, t) coordinates
    const tri = (/** @type {number[][]} */ idx) => {
      const [i0, i1, i2] = idx;
      const [p0, p1, p2] = [p[i0], p[i1], p[i2]];
      const st = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x))), maxX = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
      const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y))), maxY = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
      const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
      if (Math.abs(area) < 1e-9) return;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          let w0 = ((p1.x - px) * (p2.y - py) - (p2.x - px) * (p1.y - py)) / area;
          let w1 = ((p2.x - px) * (p0.y - py) - (p0.x - px) * (p2.y - py)) / area;
          let w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const at = y * width + x;
          if (z >= depth[at]) continue;
          let color = [150, 150, 150, 255];
          if (tex && uv) {
            const s = w0 * st[i0][0] + w1 * st[i1][0] + w2 * st[i2][0];
            const t = w0 * st[i0][1] + w1 * st[i1][1] + w2 * st[i2][1];
            // s runs along the face's first edge (a -> b), t along a -> d; the texture's u grows with s, v grows downward with 1 - t
            const su = face.mirror ? 1 - s : s;
            const u = uv.uv[0] + su * uv.uv_size[0];
            const v = uv.uv[1] + (1 - t) * uv.uv_size[1];
            const tx = Math.floor((u / tex.width) * tex.image.width), ty = Math.floor((v / tex.height) * tex.image.height);
            if (tx < 0 || ty < 0 || tx >= tex.image.width || ty >= tex.image.height) continue;
            const i = (ty * tex.image.width + tx) * 4;
            if (tex.image.data[i + 3] < 128) continue;
            color = [tex.image.data[i], tex.image.data[i + 1], tex.image.data[i + 2], 255];
          }
          depth[at] = z;
          image.data[at * 4] = Math.min(255, Math.round(color[0] * shade));
          image.data[at * 4 + 1] = Math.min(255, Math.round(color[1] * shade));
          image.data[at * 4 + 2] = Math.min(255, Math.round(color[2] * shade));
          image.data[at * 4 + 3] = 255;
        }
      }
    };
    tri([0, 1, 2]);
    tri([0, 2, 3]);
  }
  return image;
}

/**
 * Renders a set of geometries (e.g. a girl's body and her belly) under one pose from one camera.
 * @param {{ geometry: { description: any, bones: any[] }, texture?: Image, textureKey?: string, hidden?: string[] }[]} parts
 * @param {Record<string, BonePose>} pose
 * @param {Camera} camera
 * @param {{ width?: number, height?: number, background?: number[] }} [options]
 */
export function renderParts(parts, pose, camera, options = {}) {
  /** @type {ReturnType<typeof cubeFaces>} */
  const faces = [];
  /** @type {Record<string, { image: Image, width: number, height: number }>} */
  const textures = {};
  parts.forEach((part, n) => {
    const key = part.textureKey ?? `part${n}`;
    if (part.texture) textures[key] = { image: part.texture, width: num(part.geometry.description.texture_width, 64), height: num(part.geometry.description.texture_height, 64) };
    faces.push(...cubeFaces(part.geometry, pose, { hidden: new Set(part.hidden ?? []), texture: key }));
  });
  return rasterize(faces, textures, camera, options);
}

/**
 * The pose of a keyframed Bedrock animation at `time` seconds: numeric keyframes interpolated
 * linearly (pre/post frames honoured), Molang strings taken as 0 (or 1 for scale).
 * @param {{ bones?: Record<string, any> }} animation
 * @param {number} time
 * @returns {Record<string, BonePose>}
 */
export function poseAt(animation, time) {
  /** @type {Record<string, BonePose>} */
  const pose = {};
  const sample = (/** @type {unknown} */ channel, /** @type {number} */ fallback) => {
    if (channel === undefined) return undefined;
    if (Array.isArray(channel)) return vec3(channel, fallback);
    if (typeof channel === 'number' || typeof channel === 'string') return [num(channel, fallback), num(channel, fallback), num(channel, fallback)];
    const frames = Object.entries(/** @type {Record<string, any>} */ (channel)).map(([t, v]) => ({ t: Number(t), v })).sort((a, b) => a.t - b.t);
    if (!frames.length) return undefined;
    const value = (/** @type {any} */ v, /** @type {'pre' | 'post'} */ side) => vec3(Array.isArray(v) ? v : v?.[side] ?? v?.post ?? v?.pre, fallback);
    if (time <= frames[0].t) return value(frames[0].v, 'post');
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      if (time >= a.t && time <= b.t) {
        const f = b.t === a.t ? 1 : (time - a.t) / (b.t - a.t);
        const va = value(a.v, 'post'), vb = value(b.v, 'pre');
        return va.map((v, k) => v + (vb[k] - v) * f);
      }
    }
    return value(frames[frames.length - 1].v, 'post');
  };
  for (const [bone, channels] of Object.entries(animation.bones ?? {})) {
    /** @type {BonePose} */
    const p = {};
    const r = sample(channels.rotation, 0), t = sample(channels.position, 0), s = sample(channels.scale, 1);
    if (r) p.rotation = r;
    if (t) p.position = t;
    if (s) p.scale = s;
    pose[bone] = p;
  }
  return pose;
}

/** Several poses summed per axis (what the game does with simultaneous animations). */
export function mergePoses(/** @type {Record<string, BonePose>[]} */ poses) {
  /** @type {Record<string, BonePose>} */
  const out = {};
  for (const pose of poses) {
    for (const [bone, p] of Object.entries(pose)) {
      const o = (out[bone] ??= {});
      if (p.rotation) o.rotation = vec3(p.rotation).map((v, k) => v + vec3(o.rotation)[k]);
      if (p.position) o.position = vec3(p.position).map((v, k) => v + vec3(o.position)[k]);
      if (p.scale) o.scale = vec3(p.scale, 1).map((v, k) => v * (Array.isArray(o.scale) ? vec3(o.scale, 1)[k] : 1));
    }
  }
  return out;
}

/** Lays images out in a grid (same size each), with a gap. */
export function contactSheet(/** @type {Image[]} */ images, columns = 4, gap = 4, background = [20, 20, 22, 255]) {
  if (!images.length) return blank(1, 1);
  const w = images[0].width, h = images[0].height;
  const rows = Math.ceil(images.length / columns);
  const sheet = blank(columns * (w + gap) + gap, rows * (h + gap) + gap);
  for (let i = 0; i < sheet.width * sheet.height; i++) sheet.data.set(background, i * 4);
  images.forEach((img, n) => {
    const x0 = gap + (n % columns) * (w + gap), y0 = gap + Math.floor(n / columns) * (h + gap);
    for (let y = 0; y < img.height; y++) sheet.data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y0 + y) * sheet.width + x0) * 4);
  });
  return sheet;
}
