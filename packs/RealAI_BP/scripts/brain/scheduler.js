// Decides when a bot thinks. Pure. Ticks are 20/s.
//
// A think is expensive (one LLM round trip), so bots think on a cadence that
// slows with the budget level, and immediately for events worth reacting to
// (someone spoke to them, they were hurt, a player came close, a job ended).

export const CADENCE = {
    ok:    { idle: 20 * 45, active: 20 * 12, chat: 20 * 2 },   // ticks between thinks
    soft:  { idle: 20 * 120, active: 20 * 30, chat: 20 * 4 },
    hard:  { idle: Infinity, active: Infinity, chat: Infinity },
};

export const EVENT_PRIORITY = {
    chat_mention: 3,      // addressed by name or whispered
    chat_nearby: 1,       // heard chat
    hurt: 3,
    low_health: 3,
    player_near: 2,
    job_done: 2,
    job_failed: 2,
    action_done: 1,
    night: 1,
    death: 3,
    request: 3,           // UI request (job, follow, trade) from a player
    dawn: 2,              // a new day: plan it
    weather: 1,
    home_touched: 3,      // someone changed blocks at the bot's home
    reflect: 1,
};

export function createSchedulerState() {
    return { nextThink: 0, pending: [], inFlight: false, lastThink: -1, consecutiveFailures: 0, active: false };
}

/** Queue an event; higher priority pulls the next think closer. */
export function noteEvent(state, event, nowTick, level = "ok") {
    const prio = EVENT_PRIORITY[event.type] ?? 1;
    state.pending.push({ ...event, prio, t: nowTick });
    if (state.pending.length > 12) state.pending.splice(0, state.pending.length - 12);
    if (level === "hard") return;
    const chatGap = CADENCE[level].chat;
    if (prio >= 3) state.nextThink = Math.min(state.nextThink, nowTick + chatGap);
    else if (prio === 2) state.nextThink = Math.min(state.nextThink, nowTick + chatGap * 3);
}

/** Should this bot think now? */
export function shouldThink(state, nowTick, level = "ok", opts = {}) {
    if (state.inFlight) return false;
    if (level === "hard") return false;
    if (opts.paused) return false;
    if (nowTick < state.nextThink) return false;
    // Backoff after provider failures: 2^n * 10s, capped at 5 min.
    if (state.consecutiveFailures > 0) {
        const backoff = Math.min(20 * 300, 20 * 10 * Math.pow(2, state.consecutiveFailures - 1));
        if (nowTick - state.lastThink < backoff) return false;
    }
    return true;
}

/** Called when a think starts: drain events, compute the next regular slot. */
export function beginThink(state, nowTick, level = "ok", factor = 1) {
    const events = state.pending.splice(0);
    state.inFlight = true;
    state.lastThink = nowTick;
    const c = CADENCE[level] || CADENCE.ok;
    const gap = state.active ? c.active : c.idle;
    state.nextThink = nowTick + (Number.isFinite(gap) ? Math.round(gap * (factor > 0 ? factor : 1)) : gap);
    return events;
}

export function endThink(state, nowTick, ok, becameActive) {
    state.inFlight = false;
    state.active = !!becameActive;
    if (ok) state.consecutiveFailures = 0;
    else state.consecutiveFailures = Math.min(10, state.consecutiveFailures + 1);
}

/** Spread N bots over the cadence so they do not all call the provider on the same tick. */
export function staggerOffset(index, total, gapTicks) {
    if (total <= 1) return 0;
    return Math.floor((index % total) * (gapTicks / total));
}
