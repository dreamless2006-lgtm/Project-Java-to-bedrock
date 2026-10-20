// The mod's labor poses lie her on the floor on its flat labor model (models/entity/player_labor),
// whose neck sits at the middle of a body half as deep as her head: the back of her head sinks into
// the floor, further when she throws it back in a push. Used for the player's own labor
// (tools/import-jar.mjs) and the MCA women's (tools/lib/mca-poses.mjs).
import { cubeFaces, poseAt } from './geo-render.mjs';
import { keyTimes } from './pose-solve.mjs';

/**
 * A lying pose of the mod's with her head kept out of the floor. The mod's labor model lies with
 * its neck at the middle of a body half as deep as its head, so the back of her head sinks into the
 * floor, and further when she throws it back in a push. At every moment the head's lowest point
 * (her hat included) is measured, and where it would go below `floor` the head is raised by as
 * much: its position channel on straight-line keyframes (her head is twice as deep as her neck, so
 * it stays on it). Unchanged when the head never goes below.
 * @param {any} animation @param {{ bones: any[] }} flat the player's flat labor model
 * @param {number} [floor] @param {number} [step] seconds between the moments measured
 */
export function headOffFloor(animation, flat, floor = -0.25, step = 1 / 12) {
  const inHead = new Set(['head']);
  for (const b of flat.bones) if (b.parent && inHead.has(b.parent)) inHead.add(b.name);
  const head = { bones: flat.bones.map((b) => (inHead.has(b.name) ? b : { ...b, cubes: [] })) };
  const length = Number(animation.animation_length ?? 0);
  const times = [...new Set([...keyTimes(animation), ...Array.from({ length: Math.floor(length / step) + 1 }, (_, k) => Math.round(k * step * 1000) / 1000)])]
    .filter((t) => t <= length).sort((a, b) => a - b);
  const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  const samples = times.map((t) => {
    const pose = poseAt(animation, t);
    let low = Infinity;
    for (const face of cubeFaces(head, pose)) for (const c of face.corners) low = Math.min(low, c[1]);
    const at = /** @type {number[]} */ (pose.head?.position ?? [0, 0, 0]).map(Number);
    return { t, lift: Math.max(0, floor - low), at };
  });
  if (samples.every((s) => s.lift === 0)) return animation;
  // the moments kept: the fewest whose straight lines pass within 0.05 of every moment measured
  const near = (/** @type {number} */ a, /** @type {number} */ b) => samples.slice(a + 1, b).every((s) => {
    const f = (s.t - samples[a].t) / (samples[b].t - samples[a].t);
    const line = (/** @type {number[]} */ va, /** @type {number[]} */ vb) => va.map((v, i) => v + (vb[i] - v) * f);
    const want = [s.at[0], s.at[1] + s.lift, s.at[2]];
    const got = line([samples[a].at[0], samples[a].at[1] + samples[a].lift, samples[a].at[2]], [samples[b].at[0], samples[b].at[1] + samples[b].lift, samples[b].at[2]]);
    return got.every((v, i) => Math.abs(v - want[i]) < 0.05);
  });
  const kept = [0];
  for (let k = 1; k < samples.length - 1; k++) if (!near(kept[kept.length - 1], k + 1)) kept.push(k);
  if (samples.length > 1) kept.push(samples.length - 1);
  /** @type {Record<string, number[]>} */
  const frames = {};
  for (const k of kept) {
    const { t, lift, at } = samples[k];
    // (a time with a decimal point: whole numbers as keys would be ordered before all the others)
    const key = String(round(t));
    frames[key.includes('.') ? key : `${key}.0`] = [round(at[0]), round(at[1] + lift), round(at[2])];
  }
  return { ...animation, bones: { ...animation.bones, head: { ...animation.bones.head, position: frames } } };
}
