import { system, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";
import { requestMove, releaseMove, NAV } from "./ai_navigation.js";
import { jump } from "./ai_player_physics.js";
import { WATER_COMPLAINTS, WATER_RELIEF, DROWNING_ALERTS } from "./database/bot_banter.js";

const WATER_SOURCE = "water";

const CHECK_GAP = 10;
const SEARCH_RADIUS = 6;
const NO_SHORE_BACKOFF = 40;   // ticks to wait before re-scanning an enclosed pool
const SHORE_KEEP = 100;        // commit to one bank for 5 seconds instead of re-picking
const HOP_GAP = 30;            // ticks between attempts to climb onto the bank
const CLIMB_RANGE = 1.4;       // how close before hopping makes any sense

const IN_WATER_SINCE = "rg:water_since";
const LAST_COMPLAINT = "rg:water_complaint_tick";
const NEXT_SCAN = "rg:water_next_scan";
const SHORE_LATCH = "rg:water_shore";
const LAST_HOP = "rg:water_last_hop";

const LIQUIDS = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava"];
const BUSY_TAGS = ["building_shelter", "is_busy_building", "is_sleeping", "suoding"];

function safeGetBlock(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

// Dry ground you can stand on: empty at this height, solid and not liquid below.
function isStandable(block, ground) {
    if (!block || !ground) return false;
    if (!block.isAir) return false;
    if (ground.isAir) return false;
    return !LIQUIDS.includes(ground.typeId);
}

function flatDistance(ai, x, z) {
    const dx = x + 0.5 - ai.location.x;
    const dz = z + 0.5 - ai.location.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function airLeft(ai) {
    try {
        const breathable = ai.getComponent(EntityComponentTypes.Breathable);
        return typeof breathable?.airSupply === "number" ? breathable.airSupply : 300;
    } catch (e) {
        return 300;
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

function sayOncePerEpisode(ai, pool, chance) {
    if (Math.random() > chance) return;
    const last = ai.getDynamicProperty(LAST_COMPLAINT) || 0;
    if (system.currentTick - last < 1200) return; // once per minute
    ai.setDynamicProperty(LAST_COMPLAINT, system.currentTick);
    botSay(ai, pool[Math.floor(Math.random() * pool.length)], "§b");
}

// Nearest bank he can actually get out onto: level with him, or one hop up.
// Rings go outwards, and a walk-out always beats a climb-out in the same cell.
function findShore(ai) {
    const dim = ai.dimension;
    const loc = ai.location;
    const cx = Math.floor(loc.x);
    const feetY = Math.floor(loc.y);
    const cz = Math.floor(loc.z);

    for (let radius = 1; radius <= SEARCH_RADIUS; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                // Only look at this ring, skipping interior cells already tested
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;

                const x = cx + dx;
                const z = cz + dz;

                for (let rise = 0; rise <= 1; rise++) {
                    const y = feetY + rise;
                    if (!isStandable(safeGetBlock(dim, x, y, z), safeGetBlock(dim, x, y - 1, z))) continue;
                    if (!safeGetBlock(dim, x, y + 1, z)?.isAir) continue; // no room for his head
                    return { x: x, y: y, z: z, rise: rise };
                }
            }
        }
    }
    return null;
}

// Keep steering at one bank. Re-picking every scan made him drift side to side
// against the wall instead of climbing it.
function shoreTo(ai) {
    let latched = null;
    try {
        const raw = ai.getDynamicProperty(SHORE_LATCH);
        latched = raw ? JSON.parse(raw) : null;
    } catch (e) {
        latched = null;
    }

    if (latched && latched.dim === ai.dimension.id &&
        system.currentTick - (latched.tick || 0) < SHORE_KEEP &&
        isStandable(safeGetBlock(ai.dimension, latched.x, latched.y, latched.z),
            safeGetBlock(ai.dimension, latched.x, latched.y - 1, latched.z))) {
        return latched;
    }

    const found = findShore(ai);
    if (!found) {
        ai.setDynamicProperty(SHORE_LATCH, null);
        return null;
    }

    found.dim = ai.dimension.id;
    found.tick = system.currentTick;
    ai.setDynamicProperty(SHORE_LATCH, JSON.stringify(found));
    return found;
}

function clearEpisode(ai) {
    // Dry again: hand the bot back to whoever was waiting behind this request
    releaseMove(ai, WATER_SOURCE);
    ai.setDynamicProperty(SHORE_LATCH, null);
    ai.setDynamicProperty(NEXT_SCAN, null);
    const since = ai.getDynamicProperty(IN_WATER_SINCE);
    if (since && system.currentTick - since > 40) {
        ai.setDynamicProperty(IN_WATER_SINCE, null);
        if (Math.random() < 0.3) {
            botSay(ai, WATER_RELIEF[Math.floor(Math.random() * WATER_RELIEF.length)]);
        }
    } else if (since) {
        ai.setDynamicProperty(IN_WATER_SINCE, null);
    }
}

export function startWaterEscape() {
    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;

        for (const ai of everyai) {
            if (!ai.isValid) continue;
            if (BUSY_TAGS.some(tag => ai.hasTag(tag))) continue;

            const dim = ai.dimension;
            const loc = ai.location;
            const below = safeGetBlock(dim, Math.floor(loc.x), Math.floor(loc.y) - 1, Math.floor(loc.z));
            const standingInLiquid = !!below && LIQUIDS.includes(below.typeId);

            if (!ai.isInWater && !standingInLiquid) {
                clearEpisode(ai);
                continue;
            }

            const since = ai.getDynamicProperty(IN_WATER_SINCE);
            if (!since) ai.setDynamicProperty(IN_WATER_SINCE, system.currentTick);
            const submergedFor = since ? system.currentTick - since : 0;

            const supply = airLeft(ai);
            const inLava = below?.typeId === "minecraft:lava";
            const aboutToDrown = supply < 60;

            if (!inLava && aboutToDrown) {
                sayOncePerEpisode(ai, DROWNING_ALERTS, 0.5);
            } else if (!inLava && submergedFor > 30) {
                sayOncePerEpisode(ai, WATER_COMPLAINTS, 0.35);
            }

            // A burning bot came here on purpose. Leave him alone until he needs
            // air, otherwise this module fights the survival brain at the waterline.
            if (burning(ai) && !inLava && !aboutToDrown) continue;

            const nextScan = ai.getDynamicProperty(NEXT_SCAN) || 0;
            if (system.currentTick < nextScan) continue;

            const shore = shoreTo(ai);
            if (!shore) {
                // Enclosed pool - back off rather than re-scan every tick
                ai.setDynamicProperty(NEXT_SCAN, system.currentTick + NO_SHORE_BACKOFF);
                continue;
            }

            // Wading is not an emergency. A bot standing in shallow water on the
            // way to a trunk must be allowed to keep going, so plain "get out"
            // now only outranks wandering. Real danger - lava, no air, deep water
            // where he cannot touch the floor - still takes the bot over.
            const deep = ai.isInWater && !ai.isOnGround;
            const urgent = inLava || aboutToDrown || deep;

            requestMove(ai, { x: shore.x, y: shore.y, z: shore.z }, {
                priority: urgent ? NAV.SURVIVAL : NAV.WATER_SHALLOW,
                source: WATER_SOURCE,
                mode: "sprint",
                enterWater: true,
                ttl: 30
            });

            // Only climb when he is actually at the wall. Bobbing up and down in
            // open water was what made him look broken at the shoreline.
            if (shore.rise > 0 && flatDistance(ai, shore.x, shore.z) <= CLIMB_RANGE) {
                const lastHop = ai.getDynamicProperty(LAST_HOP) || -HOP_GAP;
                if (system.currentTick - lastHop >= HOP_GAP) {
                    ai.setDynamicProperty(LAST_HOP, system.currentTick);
                    if (!jump(ai)) {
                        // Floating against the bank: one surge, the way a player
                        // jumps at a wall until he catches the top step
                        try { ai.applyImpulse({ x: 0, y: 0.3, z: 0 }); } catch (e) { /* ignore */ }
                    }
                }
            }
        }
    }, CHECK_GAP);
}
