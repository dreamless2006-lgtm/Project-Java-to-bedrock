// ============================================================================
// Navigation authority
//
// Every AI system that wants a bot to move now *requests* a move instead of
// pushing the entity itself. One interval per bot picks the single winning
// request and applies it, so two systems can no longer drag the same bot in
// opposite directions (chop vs follow, task vs water escape, wander vs job)
// and rotation happens once per tick from one place.
//
//   AI decision -> requestMove(priority) -> authority -> moveToward -> entity
// ============================================================================

import { system } from "@minecraft/server";
import { moveToward, jump, faceBlock } from "./ai_player_physics.js";
import { ALL_AI_CACHE } from "./greeting.js";

const TICK = 1;              // one actuation per tick, exactly how a player is
                             // accelerated: at 2-5 tick gaps friction ate part of
                             // every push and the bots drifted along
const OWN_TTL = 20;          // ticks a request stays alive without a refresh
const DETOUR_AFTER = 25;     // ticks of "I am not getting anywhere" before routing round
const DETOUR_FOR = 60;       // ticks to commit to the waypoint (3s of going around)
const MOVED_ENOUGH = 0.12;   // blocks that count as progress between two actuations
const HOP_COOLDOWN = 6;      // ticks between step-up jumps
const SPRINT_HOP_EVERY = 24; // ticks between hops while sprinting on open ground:
                             // sprint-jumping is how a player really travels
                             // (~7.1 blocks/s), so the hop keeps coming

export const NAV = {
    SURVIVAL: 60,   // burning, drowning, deep water, lava, running for cover
    COMBAT: 50,     // fighting something
    WATER: 45,      // getting out of the water he is standing in
    TASK: 40,       // a job a player assigned
    FOLLOW: 30,     // walking to a player, to camp, home
    WATER_SHALLOW: 22,  // just wading: weaker than a job, so it cannot fight one
    WANDER: 10      // idle strolling and small adjustments
};

// botId -> { source -> intent }
const intents = new Map();

// botId -> progress tracking for the detour helper
const trackers = new Map();

function intentMap(botId) {
    let map = intents.get(botId);
    if (!map) {
        map = new Map();
        intents.set(botId, map);
    }
    return map;
}

/**
 * Ask for the bot to be steered. Only the highest priority fresh request is
 * acted on; a lower one is dropped until the owner stops refreshing it.
 */
export function requestMove(entity, target, opts = {}) {
    if (!entity?.isValid || !target) return false;

    const priority = typeof opts.priority === "number" ? opts.priority : NAV.WANDER;
    const source = opts.source || "unlabelled";
    const now = system.currentTick;

    intentMap(entity.id).set(source, {
        priority: priority,
        target: target,
        mode: opts.mode || "sprint",
        enterWater: !!opts.enterWater,
        hold: !!opts.hold,
        until: now + (opts.ttl || OWN_TTL)
    });
    return true;
}

/**
 * Give up an intent, e.g. the job finished. Passing no source clears them all.
 */
export function releaseMove(entity, source) {
    if (!entity) return;
    const map = intents.get(entity.id);
    if (!map) return;
    if (source) map.delete(source);
    else map.clear();
    if (map.size === 0) intents.delete(entity.id);
}

// What the bot is currently doing and who is driving it (used by !aistatus)
export function whoOwns(entity) {
    if (!entity) return null;
    const map = intents.get(entity.id);
    if (!map) return null;

    const now = system.currentTick;
    let best = null;
    for (const [source, intent] of map) {
        if (intent.until <= now) continue;
        if (!best || intent.priority > best.priority) best = { source, priority: intent.priority };
    }
    return best;
}

function pickIntent(botId) {
    const map = intents.get(botId);
    if (!map) return null;

    const now = system.currentTick;
    for (const [source, intent] of map) {
        if (intent.until <= now) map.delete(source);
    }
    if (map.size === 0) {
        intents.delete(botId);
        return null;
    }

    let best = null;
    let bestSource = null;
    for (const [source, intent] of map) {
        if (!best || intent.priority > best.priority) {
            best = intent;
            bestSource = source;
        }
    }
    return { intent: best, source: bestSource };
}

// A bot does not wade in for no reason, but a pond directly between him and
// where a job needs him is something a player swims across. So when the direct
// line to an important destination stays water-blocked for a while, he is
// allowed through - and the moment he is dry again the rule returns.
const WET_AFTER = 60;    // ticks of sliding along the bank before swimming
const WET_BLOCKED = ["minecraft:water", "minecraft:flowing_water"];

function wetAhead(entity, target) {
    try {
        let dx = target.x + 0.5 - entity.location.x;
        let dz = target.z + 0.5 - entity.location.z;
        const flat = Math.sqrt(dx * dx + dz * dz) || 1;
        dx /= flat;
        dz /= flat;

        const feet = Math.floor(entity.location.y);
        for (const dist of [1.2, 2.4]) {
            const x = Math.floor(entity.location.x + dx * dist);
            const z = Math.floor(entity.location.z + dz * dist);
            for (const y of [feet, feet - 1]) {
                const block = entity.dimension.getBlock({ x: x, y: y, z: z });
                if (block && WET_BLOCKED.includes(block.typeId)) return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

function trackerFor(entity) {
    let t = trackers.get(entity.id);
    if (!t) {
        t = {
            x: entity.location.x, z: entity.location.z, stuckFor: 0,
            detourFor: 0, side: 1, lastHop: -100,
            lastRhythmHop: system.currentTick,   // no hop the instant he starts running
            wetFor: 0
        };
        trackers.set(entity.id, t);
    }
    return t;
}

// A player does not walk into a one block step, he runs at it and jumps - and
// across open ground a player does not sprint either, he sprint-jumps, which is
// why their travel pace is ~7.1 blocks/s rather than 5.6.
function hopIfNeeded(ai, ux, uz, t, mode) {
    if (!ai.isOnGround || ai.isInWater) return;

    const now = system.currentTick;
    const feet = Math.floor(ai.location.y);
    const x = Math.floor(ai.location.x + ux * 0.9);
    const z = Math.floor(ai.location.z + uz * 0.9);

    const belly = blockAt(ai.dimension, x, feet, z);
    const head = blockAt(ai.dimension, x, feet + 1, z);
    if (!head) return;

    const stepUp = !head.isAir && (!belly || belly.isAir);
    if (stepUp) {
        if (now - t.lastHop < HOP_COOLDOWN) return;
        t.lastHop = now;
        t.lastRhythmHop = now;
        jump(ai);
        return;
    }

    // Rhythm hops only while sprinting, on flat open ground
    if (mode === "sprint" && now - t.lastRhythmHop >= SPRINT_HOP_EVERY) {
        t.lastRhythmHop = now;
        jump(ai);
    }
}

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return null;
    }
}

// A right-angle waypoint past the blocker: the bot walks parallel to the wall,
// not diagonally into it, and only heads back at the destination once the
// detour has run its course (or he is already beside it).
function detourTarget(entity, intent, side) {
    const loc = entity.location;
    let dx = intent.target.x + 0.5 - loc.x;
    let dz = intent.target.z + 0.5 - loc.z;
    const flat = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= flat;
    dz /= flat;

    const rx = -dz * side;
    const rz = dx * side;

    return { x: loc.x + rx * 6, y: loc.y, z: loc.z + rz * 6 };
}

export function startNavigationAuthority() {
    system.runInterval(() => {
        const bots = ALL_AI_CACHE || [];

        for (const ai of bots) {
            try {
                if (!ai.isValid) {
                    intents.delete(ai.id);
                    trackers.delete(ai.id);
                    continue;
                }

                const chosen = pickIntent(ai.id);
                if (!chosen) {
                    trackers.delete(ai.id);
                    continue;
                }
                const intent = chosen.intent;

                // A "hold" request means: do not move me, just keep me facing
                // this. A bot mid-swing uses it, so nothing can rotate his body
                // away from the block he is working between swings.
                if (intent.hold) {
                    faceBlock(ai, intent.target);
                    continue;
                }

                const t = trackerFor(ai);
                const moved = Math.sqrt(
                    Math.pow(ai.location.x - t.x, 2) + Math.pow(ai.location.z - t.z, 2));

                if (moved < MOVED_ENOUGH) t.stuckFor += TICK;
                else t.stuckFor = 0;

                t.x = ai.location.x;
                t.z = ai.location.z;

                // Movement does NOT cancel a detour - sliding along the wall is
                // the whole point, and the old rule ended it after two blocks so
                // the bot re-aimed straight into the wall and ground forever.
                // It ends on the clock, or early once the destination is beside
                // him.
                if (t.detourFor > 0) {
                    const ddx = intent.target.x + 0.5 - ai.location.x;
                    const ddz = intent.target.z + 0.5 - ai.location.z;
                    const beside = Math.sqrt(ddx * ddx + ddz * ddz) < 2.5;

                    t.detourFor -= TICK;
                    if (beside) t.detourFor = 0;          // already round the corner
                    if (t.detourFor <= 0) t.side = -t.side;   // next time try the other way
                } else if (t.stuckFor >= DETOUR_AFTER) {
                    t.detourFor = DETOUR_FOR;
                    t.stuckFor = 0;
                }

                const target = t.detourFor > 0
                    ? detourTarget(ai, intent, t.side)
                    : intent.target;

                // Water in the way: allowed to swim through only when it has
                // genuinely blocked an important route for a while. While he is
                // in the water the counter is left alone, so the permission
                // lasts until he climbs out on the other side.
                if (!intent.enterWater && intent.priority >= NAV.TASK && !ai.isInWater) {
                    if (wetAhead(ai, target)) t.wetFor += TICK;
                    else t.wetFor = 0;
                } else if (!ai.isInWater) {
                    t.wetFor = 0;
                }

                const swimAcross = t.wetFor >= WET_AFTER;
                moveToward(ai, target, intent.mode, {
                    enterWater: intent.enterWater || swimAcross
                });

                const hdx = target.x + 0.5 - ai.location.x;
                const hdz = target.z + 0.5 - ai.location.z;
                const hflat = Math.sqrt(hdx * hdx + hdz * hdz);
                if (hflat > 0.2) {
                    hopIfNeeded(ai, hdx / hflat, hdz / hflat, t, intent.mode);
                }
            } catch (e) { /* one bot must not stop the others */ }
        }
    }, TICK);

    console.warn("[Navigation] movement authority registered");
}
