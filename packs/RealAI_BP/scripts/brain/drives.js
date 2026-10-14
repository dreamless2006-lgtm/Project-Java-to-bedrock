// A bot's inner life: slow-moving drives that give it reasons of its own to act
// between events. Pure; the state lives inside the bot's memory so it survives
// reloads. Values are 0..100. The model sees them rendered as feelings and
// decides what to do about them; nothing here acts on its own.

export const DRIVE_NAMES = ["social", "rest", "curiosity", "safety", "boredom", "purpose"];

export function createDrives(now = 0) {
    return { social: 25, rest: 10, curiosity: 35, safety: 0, boredom: 0, purpose: 30, lastTalk: now, lastNew: now, lastSleep: now, updated: now, idleTurns: 0 };
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Advance the drives. ctx:
 *   talked      spoke with or was spoken to by someone since the last update
 *   night       it is night
 *   slept       the bot slept since the last update
 *   threats     number of hostile creatures nearby
 *   health      0..1
 *   hasGoal     a goal is set
 *   newPlace    saw a new biome / dimension since the last update
 *   idle        the last reply had no real action (nothing, or just wait) and no chat line
 *   progressed  an action finished since the last update
 */
export function updateDrives(d, ctx, now) {
    const since = typeof d.updated === "number" ? d.updated : now;
    const minutes = Math.max(0, Math.min(30, (now - since) / 60000));
    if (ctx.talked) { d.social = clamp(d.social - 45); d.lastTalk = now; } else d.social = clamp(d.social + 6 * minutes);
    if (ctx.slept) { d.rest = 0; d.lastSleep = now; } else d.rest = clamp(d.rest + (ctx.night ? 10 : 1.5) * minutes);
    if (ctx.newPlace || ctx.progressed) { d.curiosity = clamp(d.curiosity - (ctx.newPlace ? 40 : 10)); if (ctx.newPlace) d.lastNew = now; } else d.curiosity = clamp(d.curiosity + 4 * minutes);
    d.safety = clamp((ctx.threats || 0) * 25 + (1 - (typeof ctx.health === "number" ? ctx.health : 1)) * 60);
    if (ctx.idle) { d.idleTurns = (d.idleTurns || 0) + 1; d.boredom = clamp(d.boredom + 18); } else { d.idleTurns = 0; d.boredom = clamp(d.boredom - 30); }
    d.purpose = ctx.hasGoal ? clamp(d.purpose - 8 * minutes - (ctx.progressed ? 10 : 0)) : clamp(d.purpose + 7 * minutes + 5);
    d.updated = now;
    return d;
}

const WORDS = {
    social: ["lonely, you want company or a chat", "a bit lonely"],
    rest: ["exhausted, you need to sleep", "tired"],
    curiosity: ["itching to explore somewhere new", "curious"],
    safety: ["in danger, your heart is racing", "uneasy"],
    boredom: ["restless and bored of standing around", "a little bored"],
    purpose: ["aimless, you want a project of your own", "wanting something to work towards"],
};

/** One line the model reads as its own feelings. Only notable drives are named. */
export function renderDrives(d) {
    if (!d) return "";
    const strong = [], mild = [];
    for (const k of DRIVE_NAMES) {
        const v = d[k] || 0;
        if (v >= 70) strong.push(WORDS[k][0]);
        else if (v >= 45) mild.push(WORDS[k][1]);
    }
    if (!strong.length && !mild.length) return "You feel settled and at ease.";
    const bits = [...strong, ...mild.slice(0, 2)];
    return `You feel ${bits.join("; ")}.`;
}

/** Think sooner when something inside is pressing (restless, lonely, scared). */
export function cadenceFactor(d) {
    if (!d) return 1;
    const top = Math.max(d.social || 0, d.boredom || 0, d.safety || 0, d.purpose || 0);
    if (top >= 85) return 0.5;
    if (top >= 65) return 0.75;
    return 1;
}
