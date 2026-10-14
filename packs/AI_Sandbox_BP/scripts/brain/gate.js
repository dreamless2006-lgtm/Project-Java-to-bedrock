// Registry of bots that have an LLM brain attached, plus the "impulse" sink.
//
// Legacy modules keep their reflexes (water escape, fleeing, jobs) but when a
// bot is brain-driven their canned chat lines are not broadcast; instead the
// line is handed to the brain as an impulse so the model can voice it in the
// bot's own words (or ignore it).
const brains = new Map();           // entity id -> brain object (set by core.js)
let enabled = false;                 // global switch (config.brainEnabled && transport available)

export function setBrainEnabled(v) { enabled = !!v; }
export function isBrainEnabled() { return enabled; }

export function registerBrain(entityId, brain) { brains.set(entityId, brain); }
export function unregisterBrain(entityId) { brains.delete(entityId); }
export function getBrain(entityOrId) {
    const id = typeof entityOrId === "string" ? entityOrId : entityOrId?.id;
    return id ? brains.get(id) : undefined;
}
export function allBrains() { return brains; }

/** True when this bot's behaviour is owned by the LLM (legacy talkers must stay quiet). */
export function brainActive(entityOrId) {
    if (!enabled) return false;
    const b = getBrain(entityOrId);
    return !!b && !b.paused;
}

/** Legacy code wanted the bot to say something: queue it as an impulse for the model. */
export function impulse(entityOrId, text, kind = "impulse") {
    const b = getBrain(entityOrId);
    if (!b) return false;
    try { b.noteImpulse(String(text), kind); } catch (e) { /* ignore */ }
    return true;
}
