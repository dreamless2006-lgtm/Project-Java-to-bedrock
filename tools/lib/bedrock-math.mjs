// How the game turns a bone or cube: rotation [x, y, z] in degrees about the pivot, applied X
// first, then Y, then Z about the fixed axes, in the file's own coordinates (+y up, -z the model's
// front, a humanoid's right limbs at -x). In right-handed formulas on the file's axes that is
// p' = q + Rz(-z) Ry(+y) Rx(-x) (p - q): a positive X tilts the top of a bone forward (toward -z),
// a positive Y turns its front toward -x (the model's own right), a positive Z tilts its top toward
// +x (so a right limb hanging at -x swings outward). This is Blockbench's mapping (it mirrors x and
// negates rotation x and y on import, then uses Euler order ZYX) and the vanilla animations agree:
// sneaking leans forward with +X, riding.legs splays the right leg out with Y +18, bob swings the
// right arm out with +Z. Animation channels add to the rest angles per axis before this rotation.

const RAD = Math.PI / 180;

/**
 * Rotates `v` (relative to the pivot) by Bedrock angles in degrees.
 * @param {number[]} v @param {number[]} deg
 */
export function rotateBedrock(v, deg) {
  let [x, y, z] = v;
  const ax = -deg[0] * RAD, ay = deg[1] * RAD, az = -deg[2] * RAD;
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}

/** Rotates `point` by Bedrock angles about `pivot`. */
export const rotateAbout = (/** @type {number[]} */ point, /** @type {number[]} */ deg, /** @type {number[]} */ pivot) =>
  rotateBedrock(point.map((v, k) => v - pivot[k]), deg).map((v, k) => v + pivot[k]);

/**
 * Bedrock angles [x, y, 0] that turn a bone's front (-z) onto the unit direction `n`: after X by
 * rx and Y by ry the front points at (-cos rx sin ry, -sin rx, -cos rx cos ry).
 * @param {number[]} n
 */
export function anglesForFront(n) {
  const rx = -Math.asin(Math.max(-1, Math.min(1, n[1]))) / RAD;
  const ry = Math.atan2(-n[0], -n[2]) / RAD;
  return [Math.round(rx * 10000) / 10000, Math.round(ry * 10000) / 10000, 0];
}

/** @typedef {number[][]} Mat3 row-major 3x3 */

/** The rotation matrix of Bedrock angles: M v = rotateBedrock(v, deg). */
export function matFromEuler(/** @type {number[]} */ deg) {
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => rotateBedrock(e, deg));
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => cols[c][r]));
}

/** Bedrock angles of a rotation matrix (one of the equivalent triples). */
export function eulerFromMat(/** @type {Mat3} */ m) {
  // m = Rz(g) Ry(b) Rx(a) in right-handed form, with a = -x, b = +y, g = -z
  const sb = Math.max(-1, Math.min(1, -m[2][0]));
  const b = Math.asin(sb);
  let a, g;
  if (Math.abs(sb) < 0.99999) {
    a = Math.atan2(m[2][1], m[2][2]);
    g = Math.atan2(m[1][0], m[0][0]);
  } else {
    a = Math.atan2(-m[1][2], m[1][1]);
    g = 0;
  }
  return [-a / RAD, b / RAD, -g / RAD];
}
