// Reflexes: the body-level reactions a real player has before thinking. Pure decisions; the
// brain turns them into actions and the model hears about them on its next turn (a second
// later) and may override them. Entity bots keep their engine reflexes; these are for a real
// player body, which has none of its own.

export const REFLEX_COOLDOWN = { attack: 20 * 3, flee: 20 * 6, water: 20 * 8, lava: 20 * 2 };

/**
 * Hit by something. ctx:
 *   attacker      short type name ("zombie") or null
 *   isPlayer      the attacker is a player (never auto-attacked: that is the model's call)
 *   isHostile     the attacker is a monster
 *   healthFrac    0..1
 *   damage        damage taken
 * Returns {type: "attack"|"flee", target, why} or null.
 */
export function hurtReflex(ctx) {
    if (!ctx || !ctx.attacker) return null;
    const frac = typeof ctx.healthFrac === "number" ? ctx.healthFrac : 1;
    if (/creeper/.test(ctx.attacker)) return { type: "flee", target: ctx.attacker, why: "a creeper is about to blow" };
    if (frac <= 0.35) return { type: "flee", target: ctx.attacker, why: "low on health" };
    if (ctx.isHostile && !ctx.isPlayer) return { type: "attack", target: ctx.attacker, why: "fighting back" };
    return null;
}

/**
 * Standing in danger. ctx:
 *   inLava, onFire, inWater   booleans
 *   creeperDist               distance to the nearest creeper or null
 *   waterDist                 distance to the nearest water block or null
 *   healthFrac                0..1
 * Returns {type: "lava"|"water"|"flee", why} or null, most urgent first.
 */
export function dangerReflex(ctx) {
    if (!ctx) return null;
    if (ctx.inLava) return { type: "lava", why: "in lava" };
    if (ctx.onFire && !ctx.inWater) {
        if (typeof ctx.waterDist === "number" && ctx.waterDist <= 10) return { type: "water", why: "on fire, water is near" };
    }
    if (typeof ctx.creeperDist === "number" && ctx.creeperDist <= 4) return { type: "flee", target: "creeper", why: "a creeper is closing in" };
    return null;
}

/** Keep a reflex from firing again and again: one per type within its cooldown. */
export function reflexAllowed(state, type, now) {
    const until = state[type] || -Infinity;
    if (now < until) return false;
    state[type] = now + (REFLEX_COOLDOWN[type] || 20 * 3);
    return true;
}
