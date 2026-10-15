// What a pregnant female's belly does during a scene: the babies kick in bursts and, late in the
// pregnancy, her belly tightens in a contraction now and then, more often the more intense the
// scene is at the moment. Shared by the Jenny Bed scene (scenes.js), the belly scenes
// (belly_scenes.js) and the Jenny port girls' own scenes (port.js). The client eases every change
// in and out (minepreggo:scene, the belly controller's v.kick_w and v.cw).

/** @typedef {'calm' | 'kicking' | 'contraction'} BeatState */
/** @typedef {{ state: BeatState, until: number, kick: number }} Beat */

/** Kicks are felt from P3 on; contractions come from P6 on. */
export const KICKS_FROM = 3;
export const CONTRACTIONS_FROM = 6;

/** The usual kick strength of a phase: I early, II in the middle, III at the end. */
export const kickOf = (/** @type {number} */ phase) => (phase <= 4 ? 0 : phase <= 7 ? 1 : 2);

/**
 * What comes next for a female at `phase`, `heat` 0..1 being how intense the scene is right now:
 * a burst of kicks (3-5.5 s), a contraction (6-8 s), or a calm spell (2.5-6 s).
 * @param {number} phase @param {number} heat @param {number} now @param {() => number} [random]
 * @returns {Beat}
 */
export function nextBeat(phase, heat, now, random = Math.random) {
  if (phase < KICKS_FROM) return { state: 'calm', until: now + 100, kick: 0 };
  const contraction = phase >= CONTRACTIONS_FROM ? Math.min(0.35, 0.12 + 0.05 * (phase - CONTRACTIONS_FROM) + 0.12 * heat) : 0;
  const kicking = Math.min(0.75, 0.3 + 0.04 * phase + 0.2 * heat);
  const r = random();
  if (r < contraction) return { state: 'contraction', until: now + 120 + Math.floor(random() * 40), kick: 1 };
  if (r < contraction + kicking) {
    const stronger = heat > 0.6 && random() < 0.5 ? 1 : 0;
    return { state: 'kicking', until: now + 60 + Math.floor(random() * 50), kick: Math.min(2, kickOf(phase) + stronger) };
  }
  return { state: 'calm', until: now + 50 + Math.floor(random() * 70), kick: 0 };
}

/**
 * A scene's rhythm: call `step` regularly; it returns the beat when a new one starts.
 */
export class Rhythm {
  constructor() {
    /** @type {Beat | undefined} */
    this.beat = undefined;
  }

  /**
   * @param {number} phase @param {number} heat @param {number} now @param {() => number} [random]
   * @returns {Beat | undefined} the new beat, or undefined while the current one lasts
   */
  step(phase, heat, now, random = Math.random) {
    if (this.beat && now < this.beat.until) return undefined;
    this.beat = nextBeat(phase, heat, now, random);
    return this.beat;
  }
}

/** The message and sound that come with a new beat (a translation key with her name as %s, and a sound id), if any. */
export function announce(/** @type {Beat} */ beat) {
  if (beat.state === 'kicking') return { key: beat.kick >= 2 ? 'minepreggo.scene.kick_hard' : 'minepreggo.scene.kick', sound: 'minepreggo.belly_touch', volume: 0.5 };
  if (beat.state === 'contraction') return { key: 'minepreggo.scene.contraction', sound: 'minepreggo.pregnancy_pain', volume: 0.45 };
  return undefined;
}
