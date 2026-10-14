import { system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { getAIGoal, AI_GOALS } from "./ai_goals.js";

const BREAKING_TAG = "is_breaking_block";
const OBSTACLE_CHECK_GAP = 5; // Check every 0.25 seconds
const STUCK_TICKS = 40;       // two full seconds of pushing into something
const BREAK_LIMIT = 3;        // blocks per bot per window, so he cannot chew a hill
const BREAK_WINDOW = 200;

// Only things that genuinely stop a walk and that a player would clear with an
// empty hand. No crops, no flowers, no hay, no build materials - a player does
// not tear through a farm or a wall to get past it.
const BREAKABLE_BLOCKS = [
    "minecraft:oak_leaves", "minecraft:birch_leaves", "minecraft:spruce_leaves", "minecraft:dark_oak_leaves", "minecraft:acacia_leaves", "minecraft:jungle_leaves",
    "minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log", "minecraft:dark_oak_log", "minecraft:acacia_log", "minecraft:jungle_log",
    "minecraft:oak_wood", "minecraft:birch_wood", "minecraft:spruce_wood", "minecraft:dark_oak_wood", "minecraft:acacia_wood", "minecraft:jungle_wood",
    "minecraft:stripped_oak_log", "minecraft:stripped_birch_log", "minecraft:stripped_spruce_log", "minecraft:stripped_dark_oak_log", "minecraft:stripped_acacia_log", "minecraft:stripped_jungle_log",
    "minecraft:dirt", "minecraft:grass_block", "minecraft:gravel", "minecraft:sand", "minecraft:red_sand", "minecraft:clay",
    "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern",
    "minecraft:seagrass", "minecraft:tall_seagrass", "minecraft:kelp_plant", "minecraft:sugar_cane",
    "minecraft:vine", "minecraft:hanging_roots", "minecraft:cobweb",
    "minecraft:snow", "minecraft:snow_layer", "minecraft:dead_bush", "minecraft:tall_dry_grass", "minecraft:short_dry_grass"
];

const NETHER_WEED = [
    "minecraft:crimson_roots", "minecraft:warped_roots", "minecraft:nether_sprouts", "minecraft:twisting_vines", "minecraft:weeping_vines"
];

function isBreakableBlock(blockTypeId) {
    if (!blockTypeId) return false;
    return BREAKABLE_BLOCKS.includes(blockTypeId) || NETHER_WEED.includes(blockTypeId);
}

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

function isEmptyAir(block) {
    if (!block) return false;
    const id = block.typeId;
    return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air";
}

// Is a real player standing close enough to watch him do this?
function playerWatching(ai, range) {
    try {
        return ai.dimension.getEntities({
            location: ai.location,
            maxDistance: range,
            families: ["player"]
        }).some(e => e.typeId === "minecraft:player");
    } catch (e) {
        return false;
    }
}

// A bot that is idle, chatting or sleeping is not stuck - it is standing still
// on purpose. Only clear a block when he is somewhere with somewhere to be.
function hasPlaceToBe(ai) {
    if (ai.hasTag("is_moving_to_build")) return true;
    if (ai.getDynamicProperty("rg:friend_task")) return true;
    const goal = getAIGoal(ai);
    return goal === AI_GOALS.EXPLORING || goal === AI_GOALS.MINING || goal === AI_GOALS.BUILDING;
}

// Get the block that is actually in his way: the one column directly ahead, at
// feet level and then head level.
function blockingBlock(ai) {
    if (!ai?.isValid || !ai.dimension) return null;

    const loc = ai.location;
    const rotation = ai.getRotation();
    const yaw = (rotation.y * Math.PI) / 180;
    // Bedrock yaw 0 faces +Z and 90 faces -X, so forward is (-sin, cos). With
    // +sin he inspected the column mirrored behind his shoulder and broke a
    // block that was never in his way.
    const dirX = -Math.sin(yaw);
    const dirZ = Math.cos(yaw);

    const x = Math.floor(loc.x + dirX);
    const z = Math.floor(loc.z + dirZ);
    const feetY = Math.floor(loc.y);

    // Anything higher than a one-block step is not worth breaking - a player
    // walks around it
    const ahead = blockAt(ai.dimension, x, feetY, z);
    if (ahead && !isEmptyAir(ahead)) return { block: ahead, location: { x: x, y: feetY, z: z } };

    const head = blockAt(ai.dimension, x, feetY + 1, z);
    if (head && !isEmptyAir(head)) return { block: head, location: { x: x, y: feetY + 1, z: z } };

    return null;
}

// Check if bot is stuck (has been trying to move and got nowhere)
function isBotStuck(ai) {
    if (!ai?.isValid) return false;

    const lastPos = ai.getDynamicProperty("rg:last_position");
    const lastCheck = ai.getDynamicProperty("rg:last_stuck_check") || 0;
    const currentTick = system.currentTick;

    if (currentTick < lastCheck + STUCK_TICKS) return false;

    ai.setDynamicProperty("rg:last_stuck_check", currentTick);

    if (!lastPos) {
        ai.setDynamicProperty("rg:last_position", JSON.stringify(ai.location));
        return false;
    }

    try {
        const prev = JSON.parse(lastPos);
        const distance = Math.sqrt(
            Math.pow(ai.location.x - prev.x, 2) +
            Math.pow(ai.location.y - prev.y, 2) +
            Math.pow(ai.location.z - prev.z, 2)
        );

        ai.setDynamicProperty("rg:last_position", JSON.stringify(ai.location));

        // If moved less than 1.0 blocks in two seconds, he is pushing into something
        return distance < 1.0;
    } catch (e) {
        return false;
    }
}

function allowBreak(ai) {
    const start = ai.getDynamicProperty("rg:break_window_start") || 0;
    const now = system.currentTick;
    let count = ai.getDynamicProperty("rg:break_count") || 0;

    if (now - start > BREAK_WINDOW) {
        ai.setDynamicProperty("rg:break_window_start", now);
        count = 0;
    }
    if (count >= BREAK_LIMIT) return false;

    ai.setDynamicProperty("rg:break_count", count + 1);
    return true;
}

// Break block in front of bot
function breakBlockInFront(ai, blockLocation) {
    if (!ai?.isValid) return false;

    // Don't break if already breaking
    if (ai.hasTag(BREAKING_TAG)) return false;

    // Don't break if in combat (need to fight)
    if (ai.getDynamicProperty("rg:current_target")) return false;

    // Don't wreck anything while a player is standing right there watching
    if (playerWatching(ai, 8)) return false;

    const blockTypeId = ai.dimension.getBlock(blockLocation)?.typeId;

    // Only break if it's in the hand-clearing list - and only then spend one of
    // his three breaks, otherwise a stone wall in front uses up the budget and
    // he can never clear the leaves that are actually in his way
    if (!isBreakableBlock(blockTypeId)) return false;

    if (!allowBreak(ai)) return false;

    ai.addTag(BREAKING_TAG);

    // Look at the block
    try {
        const bx = blockLocation.x + 0.5 - ai.location.x;
        const by = blockLocation.y + 0.5 - (ai.location.y + 1.62); // eye height
        const bz = blockLocation.z + 0.5 - ai.location.z;
        const yaw = Math.atan2(-bx, bz) * (180 / Math.PI);
        const hDist = Math.sqrt(bx * bx + bz * bz);
        const pitch = hDist === 0 ? 0 : -Math.atan2(by, hDist) * (180 / Math.PI);
        ai.setRotation({ x: pitch, y: yaw });
    } catch (e) { console.warn(e, e.stack); }

    // Play digging animation
    try {
        try {
            ai.playAnimation('mine');
        } catch (e) {
            try { ai.runCommand('playanimation @s mine 0 1'); } catch (e2) { /* animation not loaded */ }
        }
    } catch (e) { console.warn(e, e.stack); }

    // Break block after delay - a hand break takes a second, not a snap
    const breakTime = 25;
    system.runTimeout(() => {
        try {
            if (ai.isValid) {
                const stillThere = ai.dimension.getBlock(blockLocation)?.typeId;
                // Only finish the job if the block is the same one he started on
                if (stillThere === blockTypeId) {
                    ai.dimension.runCommand(`setblock ${blockLocation.x} ${blockLocation.y} ${blockLocation.z} minecraft:air destroy`);
                    ai.runCommand(`playsound dig.${blockTypeId.split(':')[1] || 'stone'} @a[r=16]`);
                }
            }
        } catch (e) { console.warn(e, e.stack); }

        if (ai.isValid) ai.removeTag(BREAKING_TAG);
    }, breakTime);

    return true;
}

// Main obstacle breaker behavior
export function startObstacleBreaker() {
    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;

        for (const ai of everyai) {
            try {
                if (!ai.isValid || ai.hasTag(BREAKING_TAG)) continue;

                // A hired bot has his own block logic and is already swinging at
                // a specific log; the breaker used to consider him "stuck" while
                // he swung and broke the same log from the other side - the
                // shivering, double-swinging chop.
                if (ai.getDynamicProperty("rg:friend_task")) continue;

                // Don't break blocks while eating, building, cooking, sleeping,
                // or shut up inside his own night shelter (whose walls are dirt,
                // which is on the breakable list - he would chew his hut apart)
                if (ai.hasTag('on_eat') ||
                    ai.hasTag('is_busy_building') ||
                    ai.hasTag('is_busy_cooking') ||
                    ai.hasTag('is_upgrading') ||
                    ai.hasTag('is_sleeping') ||
                    ai.hasTag('has_shelter') ||
                    ai.hasTag('building_shelter')) {
                    continue;
                }

                if (!hasPlaceToBe(ai)) continue;
                if (!isBotStuck(ai)) continue;

                const obstacle = blockingBlock(ai);
                if (!obstacle) continue;

                breakBlockInFront(ai, obstacle.location);
            } catch (e) { /* one bot should not stop the rest */ }
        }
    }, OBSTACLE_CHECK_GAP);
}
