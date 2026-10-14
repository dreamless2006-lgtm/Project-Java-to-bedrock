import { system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { isNightTime } from "./ai_mood.js";
import { hasJob } from "./ai_task_worker.js";

import { brainActive } from "./brain/gate.js";
const SHELTER_CHECK_GAP = 200;  // Every 10s
const SHELTER_TAG = "has_shelter";
const BUILDING_SHELTER_TAG = "building_shelter";
const SHELTER_BOX = "rg:shelter_box";

// A night hut is built, not dug: no crater left behind, no bot buried alive,
// and nothing to escape from at dawn.
const HUT_BLOCK = "minecraft:dirt";
const SIDE_OFFSETS = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
];
const ROOF_OFFSETS = [
    { dx: 0, dz: 0 },
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1},
    { dx: 1, dz: 1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 1 }, { dx: -1, dz: -1 }
];

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

function isAirBlock(block) {
    if (!block) return false;                      // unloaded: leave it alone
    const id = block.typeId;
    return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air";
}

// Check if bot is exposed (no roof within 2 blocks above)
function isExposed(bot) {
    const pos = bot.location;
    const dim = bot.dimension;
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const block = blockAt(dim, cx + dx, cy + 2, cz + dz);
            if (block && !isAirBlock(block)) return false; // Found roof
        }
    }
    return true;
}

// Something already in that cell (a player, a mob, another bot) means no block
function cellBusy(dim, x, y, z, self) {
    try {
        const centre = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
        return dim.getEntities({ location: centre, maxDistance: 1.5 }).some(e => {
            if (e.id === self.id) return false;
            return Math.abs(e.location.x - centre.x) < 0.9 &&
                Math.abs(e.location.z - centre.z) < 0.9 &&
                e.location.y < y + 1 && e.location.y + 1.9 > y;
        });
    } catch (e) {
        return true;
    }
}

function takeDownHut(bot) {
    let hut = null;
    try {
        const raw = bot.getDynamicProperty(SHELTER_BOX);
        hut = raw ? JSON.parse(raw) : null;
    } catch (e) {
        hut = null;
    }

    const dim = bot.dimension;
    for (const cell of (hut && hut.cells) || []) {
        try {
            const block = blockAt(dim, cell.x, cell.y, cell.z);
            // Only remove what the hut itself put there
            if (block && block.typeId === HUT_BLOCK) block.setType("minecraft:air");
        } catch (e) { /* gone or unloaded */ }
    }

    const home = hut && hut.home ? hut.home : null;
    if (home) {
        try { bot.teleport(home, { dimension: dim }); } catch (e) { /* spot taken */ }
    }

    try { bot.setDynamicProperty(SHELTER_BOX, null); } catch (e) { /* ignore */ }
    bot.removeTag(SHELTER_TAG);
}

function buildHut(bot) {
    const pos = bot.location;
    const dim = bot.dimension;
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);

    // Walls at feet and head height, roof one above that, floor left as it is
    const plan = [];
    for (const side of SIDE_OFFSETS) {
        plan.push({ x: cx + side.dx, y: cy, z: cz + side.dz });
        plan.push({ x: cx + side.dx, y: cy + 1, z: cz + side.dz });
    }
    const roofY = cy + 2;
    for (const roof of ROOF_OFFSETS) {
        plan.push({ x: cx + roof.dx, y: roofY, z: cz + roof.dz });
    }

    const placed = [];
    for (const cell of plan) {
        const block = blockAt(dim, cell.x, cell.y, cell.z);
        if (!isAirBlock(block)) continue;
        if (cellBusy(dim, cell.x, cell.y, cell.z, bot)) continue;
        try {
            block.setType(HUT_BLOCK);
            placed.push(cell);
        } catch (e) { console.warn(e, e.stack); }
    }

    // A hut needs a roof over the head he is standing under, or it is pointless
    if (!placed.some(c => c.y === roofY)) {
        for (const cell of placed) {
            try {
                const block = blockAt(dim, cell.x, cell.y, cell.z);
                if (block && block.typeId === HUT_BLOCK) block.setType("minecraft:air");
            } catch (e) { /* ignore */ }
        }
        return false;
    }

    try {
        bot.teleport({ x: cx + 0.5, y: cy, z: cz + 0.5 }, { dimension: dim });
    } catch (e) { /* already there */ }

    const record = { cells: placed, home: { x: cx + 0.5, y: cy, z: cz + 0.5 } };
    try {
        bot.setDynamicProperty(SHELTER_BOX, JSON.stringify(record));
    } catch (e) { /* property size */ }

    bot.addTag(SHELTER_TAG);
    return true;
}

export function startShelterBuilder() {
    system.runInterval(() => {
        if (!isNightTime()) return;

        for (const bot of ALL_AI_CACHE || []) {
            if (!bot.isValid) continue;
            if (brainActive(bot)) continue;   // the model builds its own shelter when it decides to
            if (bot.hasTag(SHELTER_TAG)) continue;
            if (bot.hasTag(BUILDING_SHELTER_TAG)) continue;

            // Skip if in combat, eating, or working a job for a player - the
            // hut build teleports him inside itself, which mid-chop looked like
            // the bot teleporting across the map
            if (bot.getDynamicProperty("rg:current_target")) continue;
            if (bot.hasTag("on_eat")) continue;
            if (hasJob(bot)) continue;

            if (!isExposed(bot)) continue;

            bot.addTag(BUILDING_SHELTER_TAG);
            try {
                buildHut(bot);
            } catch (e) {
                console.warn(e, e.stack);
            }
            bot.removeTag(BUILDING_SHELTER_TAG);
        }
    }, SHELTER_CHECK_GAP);

    // Take the hut down in the morning
    system.runInterval(() => {
        if (isNightTime()) return;

        for (const bot of ALL_AI_CACHE || []) {
            if (!bot.isValid) continue;
            if (bot.hasTag(SHELTER_TAG)) {
                try {
                    takeDownHut(bot);
                } catch (e) { console.warn(e, e.stack); }
            }
        }
    }, 200);

    // Old worlds have bots buried under a slowness 255 effect from the previous
    // dig-a-hole routine. Free anyone whose shelter is gone.
    system.runInterval(() => {
        for (const bot of ALL_AI_CACHE || []) {
            if (!bot.isValid || bot.hasTag(SHELTER_TAG)) continue;
            try {
                const slow = bot.getEffect("slowness");
                if (slow && slow.duration > 1000) bot.removeEffect("slowness");
            } catch (e) { /* no effect component */ }
        }
    }, 600);
}
