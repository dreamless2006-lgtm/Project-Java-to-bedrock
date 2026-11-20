// The "effects" parameter of `minepreggo:food_effects`, kept pure so the validator can read it too.
// The game limits custom component parameters to flat values (an array of objects fails with
// "Exceeded the object and array depth limit" and the item does not load), so the list is one
// string: "<effect> <ticks> [amplifier]; ...". Durations are in ticks, as in Java's MobEffectInstance.

/** @typedef {{ effect: string, duration: number, amplifier: number }} FoodEffect */

/**
 * @param {unknown} params
 * @returns {FoodEffect[]}
 */
export function readEffects(params) {
  const effects = /** @type {{ effects?: unknown }} */ (params)?.effects;
  if (typeof effects !== 'string') throw new Error('minepreggo:food_effects needs an "effects" string: "<effect> <ticks> [amplifier]; ..."');
  return effects
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [effect, duration, amplifier = '0'] = entry.split(/\s+/);
      if (!effect || !/^\d+$/.test(duration ?? '') || !/^\d+$/.test(amplifier)) throw new Error(`minepreggo:food_effects: bad entry "${entry}"`);
      return { effect, duration: Number(duration), amplifier: Number(amplifier) };
    });
}
