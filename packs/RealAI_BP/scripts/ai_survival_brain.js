import { world, system, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";
import { requestMove, NAV } from "./ai_navigation.js";

import { brainActive } from "./brain/gate.js";
const BRAIN_SOURCE = "brain";

const SCAN_GAP = 10;
const THREAT_RANGE = 12;
const CREEPER_RANGE = 5;
const CREEPER_PANIC_RANGE = 2.5;
const MEMORY_KEEP = 20 * 180;      // 3 minutes of "do not go back there"
const MEMORY_MAX = 6;
const CLIFF_BLOCKS = 4;            // a player does not jump off this on purpose

const DANGER_FLAG = "rg:isInDanger";
const LAST_HOSTILE = "rg:lastHostileTick";
const HOSTILE_COUNT = "rg:brain_hostiles";
const MEMORY_KEY = "rg:danger_spots";
const SHOUT_CD = "rg:brain_shout_tick";
const SHOUT_GAP = 20 * 20;

const SAY = {
    creeper: ["creeper!!", "get away from me", "ah- creeper", "I'm not dying to a creeper again"],
    surrounded: ["there's too many of them, help!", "someone back me up, I'm getting swarmed", "I'm falling back, they're everywhere"],
    lowHp: ["I'm low, I need to eat something", "that's it, I'm healing up", "backing off, I'm nearly dead"],
    burning: ["I'M ON FIRE!!", "fire fire fire, where's water", "okay that's not great, I'm burning"],
    lava: ["lava, not walking into that", "there's lava right there, going around"],
    cliff: ["that's a long way down, I'll walk around", "not jumping off that, thanks"]
};

const LIQUIDS = ["minecraft:water", "minecraft:flowing_water"];
const LAVA = ["minecraft:lava", "minecraft:flowing_lava"];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function dist(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

function hpRatio(ai) {
    try {
        const hp = ai.getComponent(EntityComponentTypes.Health);
        if (!hp) return 1;
        return hp.currentValue / (hp.effectiveMax || 20);
    } catch (e) {
        return 1;
    }
}

function burning(ai) {
    try {
        const fire = ai.getComponent(EntityComponentTypes.OnFire);
        return !!fire && fire.onFireTicksRemaining > 0;
    } catch (e) {
        return false;
    }
}

function shout(ai, lines, style = "") {
    const last = ai.getDynamicProperty(SHOUT_CD) || 0;
    if (system.currentTick - last < SHOUT_GAP) return;
    ai.setDynamicProperty(SHOUT_CD, system.currentTick);
    botSay(ai, pick(lines), style);
}

function hostilesNear(ai, range) {
    try {
        return ai.dimension.getEntities({
            location: ai.location,
            maxDistance: range,
            families: ["monster"]
        });
    } catch (e) {
        return [];
    }
}

function nearestWater(ai, range) {
    const dim = ai.dimension;
    const cx = Math.floor(ai.location.x);
    const cy = Math.floor(ai.location.y);
    const cz = Math.floor(ai.location.z);

    for (let radius = 1; radius <= range; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
                for (let dy = -3; dy <= 2; dy++) {
                    const b = blockAt(dim, cx + dx, cy + dy, cz + dz);
                    if (b && LIQUIDS.includes(b.typeId)) return { x: b.x, y: b.y, z: b.z };
                }
            }
        }
    }
    return null;
}

// --- danger memory -------------------------------------------------------

function loadMemory(ai) {
    try {
        const raw = ai.getDynamicProperty(MEMORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function remember(ai, kind) {
    const now = system.currentTick;
    let spots = loadMemory(ai).filter(s => s.until > now);

    const already = spots.find(s => dist(s, ai.location) <= 8);
    if (already) {
        // Refresh a spot he was hurt at again rather than filling the list up
        if (now > already.until - MEMORY_KEEP / 2) return;
        already.until = now + MEMORY_KEEP;
    } else {
        spots.push({
            x: Math.floor(ai.location.x),
            y: Math.floor(ai.location.y),
            z: Math.floor(ai.location.z),
            dim: ai.dimension.id,
            kind: kind,
            until: now + MEMORY_KEEP
        });
    }

    if (spots.length > MEMORY_MAX) spots = spots.slice(-MEMORY_MAX);
    try {
        ai.setDynamicProperty(MEMORY_KEY, JSON.stringify(spots));
    } catch (e) { /* dynamic property limits */ }
}

function rememberedSpot(ai) {
    return loadMemory(ai).find(s =>
        s.dim === ai.dimension.id &&
        s.until > system.currentTick &&
        dist(s, ai.location) <= 6) || null;
}

// --- movement safety -----------------------------------------------------

// Would stepping to this column be lava, or a fall a player would not take?
function stepIsSafe(ai, x, z) {
    const dim = ai.dimension;
    const feet = Math.floor(ai.location.y);

    const atFeet = blockAt(dim, x, feet, z);
    if (atFeet && LAVA.includes(atFeet.typeId)) return false;
    if (atFeet && !atFeet.isAir && atFeet.typeId !== "minecraft:air") return true; // wall, not a fall

    let drop = 0;
    for (let y = feet - 1; y >= feet - (CLIFF_BLOCKS + 2); y--) {
        const b = blockAt(dim, x, y, z);
        if (!b) return true;                                   // unloaded, assume fine
        if (LIQUIDS.includes(b.typeId)) return drop <= 1;       // a puddle is fine, a lake is not
        if (LAVA.includes(b.typeId)) return false;
        if (!b.isAir) break;
        drop++;
    }
    return drop < CLIFF_BLOCKS;
}

function sidestep(ai) {
    let view = null;
    try {
        view = ai.getViewDirection();
    } catch (e) { view = null; }
    if (!view) view = { x: 0, y: 0, z: 1 };

    // A perpendicular to (x, z) is (-z, x). The old trig worked out to straight
    // forward or straight back, so half the time this "sidestep" walked him into
    // the lava he was reacting to.
    const side = Math.random() < 0.5 ? 1 : -1;
    requestMove(ai, {
        x: ai.location.x - view.z * side * 3,
        y: ai.location.y,
        z: ai.location.z + view.x * side * 3
    }, { priority: NAV.SURVIVAL, source: BRAIN_SOURCE, mode: "walk" });
}

function fleeFrom(ai, threatLocation, mode = "sprint") {
    requestMove(ai, {
        x: ai.location.x * 2 - threatLocation.x,
        y: ai.location.y,
        z: ai.location.z * 2 - threatLocation.z
    }, { priority: NAV.SURVIVAL, source: BRAIN_SOURCE, mode: mode });
}

// --- the brain -----------------------------------------------------------

function think(ai) {
    if (ai.hasTag("is_sleeping") || ai.hasTag("building_shelter") || ai.hasTag("suoding")) return;

    const fighting = !!ai.getDynamicProperty("rg:current_target");
    const hp = hpRatio(ai);
    const hostiles = hostilesNear(ai, THREAT_RANGE);
    const creepers = hostiles.filter(m => m.typeId === "minecraft:creeper" && dist(m.location, ai.location) <= CREEPER_RANGE);

    try {
        ai.setDynamicProperty(DANGER_FLAG, hostiles.length > 0);
        ai.setDynamicProperty(HOSTILE_COUNT, hostiles.length);
        if (hostiles.length > 0) ai.setDynamicProperty(LAST_HOSTILE, system.currentTick);
    } catch (e) { console.warn(e, e.stack); }

    // 1. Burning: a player looks for water before anything else. Once he is in
    //    it he stops moving - hopping around underwater is not a player thing.
    if (burning(ai)) {
        if (!ai.isInWater) {
            const water = nearestWater(ai, 8);
            if (water) requestMove(ai, water, { priority: NAV.SURVIVAL, source: BRAIN_SOURCE, mode: "sprint", enterWater: true });
            else sidestep(ai);
        }
        shout(ai, SAY.burning, "§c");
        remember(ai, "fire");
        return;
    }

    // 2. Creeper close: run, and say so, because that is exactly what a
    //    panicking player does
    if (creepers.length > 0) {
        fleeFrom(ai, creepers[0].location, "panic");
        shout(ai, SAY.creeper, "§c");
        if (dist(creepers[0].location, ai.location) <= CREEPER_PANIC_RANGE) remember(ai, "creeper");
        return;
    }

    // Brain-driven bots keep only the split-second physical reflexes above and the lava
    // check below; fleeing, eating and repositioning are decisions the model makes.
    const brained = brainActive(ai);

    // 2b. Swarmed: a player does not stand in the middle of a mob of zombies
    //     and box them, he runs. The panic pace is just above the engine's
    //     chase speed, otherwise the hurt target goal dragged him back in.
    if (!brained && !fighting && hostiles.length >= 3) {
        const nearest = hostiles.slice().sort(
            (a, b) => dist(a.location, ai.location) - dist(b.location, ai.location))[0];
        fleeFrom(ai, nearest.location, "panic");
        shout(ai, SAY.surrounded, "§e");
        remember(ai, "swarm");
        return;
    }

    // 3. Lava or a long drop in front of him while he is walking along. Skipped
    //    for a bot with a job: a bot working a tree on a slope looks at a drop
    //    all day, so only lava counts, otherwise the two systems push him back
    //    and forth next to the trunk.
    const task = ai.getDynamicProperty("rg:friend_task");
    const mining = task === "mine";
    const onJob = !!task;
    if (!fighting && !mining && ai.isOnGround) {
        let view;
        try { view = ai.getViewDirection(); } catch (e) { view = null; }
        if (view) {
            const nextX = Math.floor(ai.location.x + view.x * 1.5);
            const nextZ = Math.floor(ai.location.z + view.z * 1.5);
            if (Number.isFinite(nextX) && Number.isFinite(nextZ) && !stepIsSafe(ai, nextX, nextZ)) {
                const lavaAhead = (() => {
                    const b = blockAt(ai.dimension, nextX, Math.floor(ai.location.y), nextZ);
                    const below = blockAt(ai.dimension, nextX, Math.floor(ai.location.y) - 1, nextZ);
                    return (b && LAVA.includes(b.typeId)) || (below && LAVA.includes(below.typeId));
                })();

                if ((onJob || brained) && !lavaAhead) {
                    // a hill is not a hazard while he is working (or when the model is steering)
                } else {
                    sidestep(ai);
                    if (lavaAhead) {
                        shout(ai, SAY.lava, "§6");
                        remember(ai, "lava");
                    } else {
                        shout(ai, SAY.cliff, "§e");
                    }
                    return;
                }
            }
        }
    }

    if (brained) return;

    // 4. Hurt: eat, and run when it is genuinely bad
    if (hp < 0.5 && hostiles.length > 0 && !ai.hasTag("on_eat") && !ai.hasTag("no_food")) {
        ai.addTag("on_eat");
    }

    if (hp < 0.35 && hostiles.length > 0) {
        fleeFrom(ai, hostiles[0].location);
        shout(ai, hp < 0.2 || hostiles.length >= 3 ? SAY.surrounded : SAY.lowHp, "§c");
        return;
    }

    if (hostiles.length >= 3 && !fighting) {
        fleeFrom(ai, hostiles[0].location);
        shout(ai, SAY.surrounded, "§c");
        return;
    }

    // 5. He was hurt here recently: drift away instead of standing in it
    if (!fighting && rememberedSpot(ai)) sidestep(ai);
}

export function startSurvivalBrain() {
    // A solid hit is what makes a spot worth avoiding
    try {
        world.afterEvents.entityHurt.subscribe(event => {
            const bot = event.hurtEntity;
            if (!bot || bot.typeId !== "rg:bot") return;
            if (event.damage < 4) return;
            remember(bot, "hurt");
        });
    } catch (e) { console.warn(e, e.stack); }

    system.runInterval(() => {
        for (const ai of ALL_AI_CACHE || []) {
            if (!ai.isValid) continue;
            try {
                think(ai);
            } catch (e) { console.warn(e, e.stack); }
        }
    }, SCAN_GAP);
}
