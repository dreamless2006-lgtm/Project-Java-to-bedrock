import { world, system } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { getCurrentTarget } from "./ai_combat_tactics.js";
import { jump } from "./ai_player_physics.js";
import { hasJob } from "./ai_task_worker.js";
import { brainActive } from "./brain/gate.js";

const PROXIMITY_RADIUS_FOR_IDLE_CHECK = 72; // 72 blocks around player
const NEARBY_BUILDERS_CHECK_DISTANCE = 16; // Distance to check for nearby builders

const BUILD_BLOCK_TYPES = [
    { typeId: "minecraft:cobblestone", weight: 25, itemEquipId: "minecraft:cobblestone" },
    { typeId: "minecraft:white_wool", weight: 2, itemEquipId: "minecraft:white_wool" },
    { typeId: "minecraft:light_gray_wool", weight: 2, itemEquipId: "minecraft:light_gray_wool" },
    { typeId: "minecraft:gray_wool", weight: 2, itemEquipId: "minecraft:gray_wool" },
    { typeId: "minecraft:black_wool", weight: 2, itemEquipId: "minecraft:black_wool" },
    { typeId: "minecraft:brown_wool", weight: 2, itemEquipId: "minecraft:brown_wool" },
    { typeId: "minecraft:red_wool", weight: 2, itemEquipId: "minecraft:red_wool" },
    { typeId: "minecraft:orange_wool", weight: 2, itemEquipId: "minecraft:orange_wool" },
    { typeId: "minecraft:yellow_wool", weight: 2, itemEquipId: "minecraft:yellow_wool" },
    { typeId: "minecraft:lime_wool", weight: 2, itemEquipId: "minecraft:lime_wool" },
    { typeId: "minecraft:green_wool", weight: 2, itemEquipId: "minecraft:green_wool" },
    { typeId: "minecraft:cyan_wool", weight: 2, itemEquipId: "minecraft:cyan_wool" },
    { typeId: "minecraft:light_blue_wool", weight: 2, itemEquipId: "minecraft:light_blue_wool" },
    { typeId: "minecraft:blue_wool", weight: 2, itemEquipId: "minecraft:blue_wool" },
    { typeId: "minecraft:purple_wool", weight: 2, itemEquipId: "minecraft:purple_wool" },
    { typeId: "minecraft:magenta_wool", weight: 2, itemEquipId: "minecraft:magenta_wool" },
    { typeId: "minecraft:pink_wool", weight: 2, itemEquipId: "minecraft:pink_wool" },
    { typeId: "minecraft:glass", weight: 10, itemEquipId: "minecraft:glass" }
];

const STRUCTURE_BLUEPRINTS = [
    { id: "hollow_rectangle", weight: 65, generator: generateHollowRectangleOffsets },
    { id: "random_cluster", weight: 22, generator: generateRandomClusterOffsets },
    { id: "flag", weight: 13, generator: generateFlagOffsets }
];
const MIN_RANDOM_BLOCKS = 8;
const MAX_RANDOM_BLOCKS = 30;
const MAX_VERTICAL_STACK = 2;
const ai_player_id = "rg:bot";
const BUILDER_TAG = "builder";
const ABORT_DISTANCE_SQUARED = 225;
const AI_MOVEMENT_TAG = "is_moving_to_build";
const BUILD_aim_ENTITY_ID = "rg:build_target";
const IS_BUILDING_TAG = "is_busy_building";
const MOVEMENT_CHECK_DISTANCE = 5;
const MOVEMENT_WAIT_TICKS = 20;

const MOVEMENT_TIMEOUT_TICKS = 200;
const aiStartTimeTracker = new Map();
const activeBuilds = new Map();     // bot id -> last tick of its build chain

const BUILD_aim_TIMEOUT_TICKS = 200;
const buildTargetTracker = new Map();

const START_DISTANCE = 4;
const ANIMATION_COMMAND = "playanimation @s set_block";
const STOP_WALKING_EVENT = "cancel_stroll";
const DESPAWN_EVENT = "despawn";
const BLOCK_SOUND_MAP = {
    "minecraft:cobblestone": "dig.stone", "minecraft:white_wool": "dig.cloth", "minecraft:light_gray_wool": "dig.cloth", "minecraft:gray_wool": "dig.cloth", "minecraft:black_wool": "dig.cloth", "minecraft:brown_wool": "dig.cloth", "minecraft:red_wool": "dig.cloth", "minecraft:orange_wool": "dig.cloth", "minecraft:yellow_wool": "dig.cloth", "minecraft:lime_wool": "dig.cloth", "minecraft:green_wool": "dig.cloth", "minecraft:cyan_wool": "dig.cloth", "minecraft:light_blue_wool": "dig.cloth", "minecraft:blue_wool": "dig.cloth", "minecraft:purple_wool": "dig.cloth", "minecraft:magenta_wool": "dig.cloth", "minecraft:pink_wool": "dig.cloth", "minecraft:glass": "dig.stone"
};
const BLOCK_PLACEMENT_BLACKLIST = ["minecraft:water", "minecraft:lava", "minecraft:bedrock"];

function getRandomBuildDelay() { return Math.floor(Math.random() * (20 - 8 + 1)) + 8; }

function getWeightedRandom(choices) {
    const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let randomValue = Math.random() * totalWeight;
    for (const choice of choices) {
        if (randomValue < choice.weight) return choice;
        randomValue -= choice.weight;
    }
    return choices[choices.length - 1];
}

function snapRotationToCardinal(yaw) {
    const normalizedYaw = (yaw % 360 + 360) % 360;
    return Math.round(normalizedYaw / 90) * 90 % 360;
}

function cleanUpBuilderState(ai) {
    try {
        aiStartTimeTracker.delete(ai.id);
        activeBuilds.delete(ai.id);
        if (!ai.isValid) return;
        ai.removeTag(AI_MOVEMENT_TAG);
        ai.removeTag(IS_BUILDING_TAG);
        // cancel_stroll takes both wander groups away so he can place blocks in
        // peace; without this the bot never gets a move goal back and stands in
        // the same spot for the rest of the session
        try { ai.triggerEvent("stroll_switch"); } catch (e) { /* ignore */ }
        for (const target of ai.dimension.getEntities({ type: BUILD_aim_ENTITY_ID, maxDistance: 50, location: ai.location })) {
            buildTargetTracker.delete(target.id);
            target.triggerEvent(DESPAWN_EVENT);
        }
    } catch (e) { console.warn(e, e.stack); }
}

function isAirBlock(dimension, loc) {
    try {
        const block = dimension.getBlock(loc);
        if (!block) return true;
        const typeId = block.typeId;
        return typeId === "minecraft:air" || typeId === "minecraft:cave_air" || typeId === "minecraft:void_air";
    } catch (e) {
        return false;
    }
}

function isFluidBlock(dimension, loc) {
    try {
        const block = dimension.getBlock(loc);
        if (!block) return false;
        const typeId = block.typeId;
        return typeId === "minecraft:water" || typeId === "minecraft:lava" ||
            typeId === "minecraft:flowing_water" || typeId === "minecraft:flowing_lava";
    } catch (e) {
        return false;
    }
}

function placeClimbHelperBlock(ai, targetLoc, currentBlock) {
    if (!ai.isValid || !targetLoc || !currentBlock) return false;
    const currentY = Math.floor(ai.location.y);
    const targetY = Math.floor(targetLoc.y);
    const heightDiff = targetY - currentY;
    if (heightDiff <= 0 || heightDiff > 2) return false;

    const helperLoc = { x: Math.floor(targetLoc.x), y: targetY - 1, z: Math.floor(targetLoc.z) };
    const botFeet = { x: Math.floor(ai.location.x), y: Math.floor(ai.location.y), z: Math.floor(ai.location.z) };
    if (helperLoc.x === botFeet.x && helperLoc.z === botFeet.z && (helperLoc.y === botFeet.y || helperLoc.y === botFeet.y + 1)) {
        return false;
    }
    if (!isAirBlock(ai.dimension, helperLoc)) return false;

    try {
        try { ai.dimension.runCommand(`fill ${helperLoc.x} ${helperLoc.y} ${helperLoc.z} ${helperLoc.x} ${helperLoc.y} ${helperLoc.z} ${currentBlock.typeId} replace`); } catch (e) { console.warn(e, e.stack); }
        return true;
    } catch (e) {
        return false;
    }
}

function isSolidBlock(dimension, loc) {
    try {
        const block = dimension.getBlock(loc);
        if (!block) return false;
        const typeId = block.typeId;
        return typeId !== "minecraft:air" && typeId !== "minecraft:cave_air" && typeId !== "minecraft:void_air" && typeId !== "minecraft:water" && typeId !== "minecraft:lava";
    } catch (e) {
        return false;
    }
}

function isBotInHole(ai) {
    if (!ai?.isValid || !ai.isOnGround || ai.isInWater) return false;
    const loc = ai.location;
    const x = Math.floor(loc.x);
    const y = Math.floor(loc.y);
    const z = Math.floor(loc.z);

    const sideDirs = [
        { dx: 1, dz: 0 },
        { dx: -1, dz: 0 },
        { dx: 0, dz: 1 },
        { dx: 0, dz: -1 }
    ];

    let wallCount = 0;
    for (const dir of sideDirs) {
        if (isSolidBlock(ai.dimension, { x: x + dir.dx, y, z: z + dir.dz }) &&
            isSolidBlock(ai.dimension, { x: x + dir.dx, y: y + 1, z: z + dir.dz })) {
            wallCount++;
        }
    }

    const belowLoc = { x, y: y - 1, z };
    const hasBlockBelow = isSolidBlock(ai.dimension, belowLoc);

    return wallCount >= 3 || (wallCount >= 2 && !hasBlockBelow);
}

function botJump(ai) {
    if (!ai?.isValid || !ai.isOnGround) return false;
    try {
        jump(ai);
        return true;
    } catch (e) {
        return false;
    }
}

// ============================================================================
// FIXED: jumpAndPillarUp - Now places blocks correctly
// ============================================================================
function jumpAndPillarUp(ai) {
    if (!ai?.isValid || !ai.isOnGround) return false;

    const loc = ai.location;
    const startX = Math.floor(loc.x);
    const startY = Math.floor(loc.y);
    const startZ = Math.floor(loc.z);

    // Position to place block (at feet level, which will be empty after jump)
    const blockPlacePos = { x: startX, y: startY, z: startZ };

    // Check head space for jumping
    const headPos = { x: startX, y: startY + 2, z: startZ };
    const aboveHeadPos = { x: startX, y: startY + 3, z: startZ };

    if (!isAirBlock(ai.dimension, headPos) || !isAirBlock(ai.dimension, aboveHeadPos)) {
        return false;
    }

    // Check if we can actually place the block
    const targetBlock = ai.dimension.getBlock(blockPlacePos);
    if (targetBlock && targetBlock.isSolid) {
        return false;
    }

    try {
        const blockToPlace = "minecraft:cobblestone";

        // Equip the block
        try { ai.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${blockToPlace}`); } catch (e) { console.warn(e, e.stack); }

        // Look down to face where block will be placed
        ai.setRotation({ x: 90, y: ai.getRotation().y });

        // Jump first
        jump(ai);

        // Schedule block placement 3 ticks after jump (when bot is high enough)
        system.runTimeout(() => {
            if (!ai.isValid) return;

            // Verify position is still valid (air)
            const currentBlock = ai.dimension.getBlock(blockPlacePos);
            if (currentBlock && (currentBlock.isAir || !currentBlock.isSolid)) {
                // Play animation and sound
                try { ai.runCommand('playanimation @s set_block'); } catch (e) { console.warn(e, e.stack); }
                try { ai.runCommand(`playsound dig.stone @a ${blockPlacePos.x} ${blockPlacePos.y} ${blockPlacePos.z}`); } catch (e) { console.warn(e, e.stack); }

                // Place the block
                try { ai.dimension.runCommand(`setblock ${blockPlacePos.x} ${blockPlacePos.y} ${blockPlacePos.z} ${blockToPlace}`); } catch (e) { console.warn(e, e.stack); }

                // Schedule a second block above for extra height
                system.runTimeout(() => {
                    if (ai.isValid) {
                        const secondBlockPos = { x: startX, y: startY + 1, z: startZ };
                        const secondBlock = ai.dimension.getBlock(secondBlockPos);
                        if (secondBlock && (secondBlock.isAir || !secondBlock.isSolid)) {
                            try { ai.dimension.runCommand(`setblock ${secondBlockPos.x} ${secondBlockPos.y} ${secondBlockPos.z} ${blockToPlace}`); } catch (e) { console.warn(e, e.stack); }
                        }
                    }
                }, 2);

                return true;
            }
            return false;
        }, 3);

        return true;
    } catch (e) {
        return false;
    }
}

// ============================================================================
// FIXED: placeHoleEscapeStep - Now places blocks correctly
// ============================================================================
function placeHoleEscapeStep(ai) {
    if (!ai?.isValid) return false;
    const loc = ai.location;
    const x = Math.floor(loc.x);
    const y = Math.floor(loc.y);
    const z = Math.floor(loc.z);
    const stepBlock = "minecraft:cobblestone";

    const sideDirs = [
        { dx: 1, dz: 0 },
        { dx: -1, dz: 0 },
        { dx: 0, dz: 1 },
        { dx: 0, dz: -1 }
    ];

    for (const dir of sideDirs) {
        const wallLoc = { x: x + dir.dx, y: y, z: z + dir.dz };
        const stepLoc = { x: x + dir.dx, y: y + 1, z: z + dir.dz };

        if (isSolidBlock(ai.dimension, wallLoc) &&
            isAirBlock(ai.dimension, stepLoc) &&
            isAirBlock(ai.dimension, { x: stepLoc.x, y: stepLoc.y + 1, z: stepLoc.z })) {

            try {
                // Look at the step position
                const lookDx = (stepLoc.x + 0.5) - ai.location.x;
                const lookDz = (stepLoc.z + 0.5) - ai.location.z;
                const yaw = Math.atan2(-lookDx, lookDz) * (180 / Math.PI);
                ai.setRotation({ x: 30, y: yaw });

                // Place the step block
                try { ai.dimension.runCommand(`setblock ${stepLoc.x} ${stepLoc.y} ${stepLoc.z} ${stepBlock}`); } catch (e) { console.warn(e, e.stack); }
                try { ai.runCommand('playanimation @s set_block'); } catch (e) { console.warn(e, e.stack); }
                try { ai.runCommand(`playsound dig.stone @a ${stepLoc.x} ${stepLoc.y} ${stepLoc.z}`); } catch (e) { console.warn(e, e.stack); }

                // Jump onto the step
                system.runTimeout(() => {
                    if (ai.isValid && ai.isOnGround) {
                        botJump(ai);
                    }
                }, 1);

                return true;
            } catch (e) {
                return false;
            }
        }
    }
    return false;
}

function enhancedHoleEscape(ai) {
    if (!ai?.isValid) return false;

    // A hole is only a trap when he did not mean to be in it. A miner works in
    // a shaft, a night shelter is a box of blocks, and a builder stands inside
    // his own walls - rescuing those bots just fills the place with cobblestone.
    if (hasJob(ai)) return false;
    if (ai.hasTag(IS_BUILDING_TAG)) return false;
    if (ai.hasTag("has_shelter") || ai.hasTag("building_shelter")) return false;
    if (ai.hasTag("is_sleeping") || ai.hasTag("is_mining")) return false;
    if (ai.isInWater) return false;

    if (!isBotInHole(ai)) return false;

    const currentTick = system.currentTick;
    const lastAttempt = ai.getDynamicProperty("rg:hole_rescue_last_tick") || 0;

    if (currentTick < lastAttempt + 15) return false;

    ai.setDynamicProperty("rg:hole_rescue_last_tick", currentTick);

    if (jumpAndPillarUp(ai)) {
        return true;
    }

    if (placeHoleEscapeStep(ai)) {
        return true;
    }

    botJump(ai);
    return true;
}

function tryHoleEscape(ai) {
    return enhancedHoleEscape(ai);
}

function rotateCoordinates(dx, dz, yaw) {
    const angleRad = (yaw + 90) * (Math.PI / 180);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    return { dx: Math.round(dx * cosA - dz * sinA), dz: Math.round(dx * sinA + dz * cosA) };
}

function generateHollowRectangleOffsets() {
    const offsets = [];
    const MIN_SIDE_LENGTH = 5, MAX_SIDE_LENGTH = 10, MIN_HEIGHT = 3, MAX_HEIGHT = 4;
    const lengthX = Math.floor(Math.random() * (MAX_SIDE_LENGTH - MIN_SIDE_LENGTH + 1)) + MIN_SIDE_LENGTH;
    const lengthZ = Math.floor(Math.random() * (MAX_SIDE_LENGTH - MIN_SIDE_LENGTH + 1)) + MIN_SIDE_LENGTH;
    const heightY = Math.floor(Math.random() * (MAX_HEIGHT - MIN_HEIGHT + 1)) + MIN_HEIGHT;
    const doorWall = Math.floor(Math.random() * 4);
    const doorPosition = Math.floor(Math.random() * ((doorWall < 2 ? lengthX : lengthZ) - 2)) + 1;
    for (let y = 0; y <= heightY; y++) {
        for (let x = 0; x <= lengthX; x++) {
            for (let z = 0; z <= lengthZ; z++) {
                const isSideWall = (x === 0 || x === lengthX || z === 0 || z === lengthZ);
                // The ground he is standing on is already a floor, so only the
                // roof gets a full layer
                const isRoof = (y === heightY);
                if (isRoof || isSideWall) {
                    if (y > 0 && y < heightY && x > 0 && x < lengthX && z > 0 && z < lengthZ) continue;
                    let isDoorBlock = false;
                    if (y === 1 || y === 2) {
                        switch (doorWall) {
                            case 0: if (z === lengthZ && x === doorPosition) isDoorBlock = true; break;
                            case 1: if (z === 0 && x === doorPosition) isDoorBlock = true; break;
                            case 2: if (x === lengthX && z === doorPosition) isDoorBlock = true; break;
                            case 3: if (x === 0 && z === doorPosition) isDoorBlock = true; break;
                        }
                    }
                    if (!isDoorBlock) offsets.push({ dx: x, dy: y, dz: z });
                }
            }
        }
    }
    offsets.sort((a, b) => { if (a.dy !== b.dy) return a.dy - b.dy; if (a.dx !== b.dx) return a.dx - b.dx; return a.dz - b.dz; });
    return offsets;
}

function generateRandomClusterOffsets() {
    const offsets = [{ dx: 0, dy: 0, dz: 0 }];
    const blockCount = Math.floor(Math.random() * (MAX_RANDOM_BLOCKS - MIN_RANDOM_BLOCKS + 1)) + MIN_RANDOM_BLOCKS;
    let lastOffset = { dx: 0, dy: 0, dz: 0 }, currentVerticalStack = 0;
    const WEIGHTED_DIRECTIONS = [
        { dir: { dx: 1, dy: 0, dz: 0 }, weight: 20 },
        { dir: { dx: -1, dy: 0, dz: 0 }, weight: 20 },
        { dir: { dx: 0, dy: 0, dz: 1 }, weight: 20 },
        { dir: { dx: 0, dy: 0, dz: -1 }, weight: 20 },
        { dir: { dx: 1, dy: 1, dz: 0 }, weight: 5 },
        { dir: { dx: -1, dy: 1, dz: 0 }, weight: 5 },
        { dir: { dx: 0, dy: 1, dz: 1 }, weight: 5 },
        { dir: { dx: 0, dy: 1, dz: -1 }, weight: 5 },
        { dir: { dx: 0, dy: 1, dz: 0 }, weight: 0 },
        { dir: { dx: 0, dy: -1, dz: 0 }, weight: 0 }
    ];
    for (let i = 1; i < blockCount; i++) {
        let foundNewPosition = false, safetyCounter = 0;
        while (!foundNewPosition && safetyCounter < 100) {
            safetyCounter++;
            let currentDirections = WEIGHTED_DIRECTIONS.filter(d => !(currentVerticalStack >= MAX_VERTICAL_STACK && d.dir.dy === 1 && d.dir.dx === 0 && d.dir.dz === 0));
            const totalWeight = currentDirections.reduce((sum, item) => sum + item.weight, 0);
            let randomValue = Math.random() * totalWeight, randomDirection = null;
            for (const item of currentDirections) {
                if (randomValue < item.weight) { randomDirection = item.dir; break; }
                randomValue -= item.weight;
            }
            if (!randomDirection) continue;
            const nextOffset = { dx: lastOffset.dx + randomDirection.dx, dy: lastOffset.dy + randomDirection.dy, dz: lastOffset.dz + randomDirection.dz };
            if (!offsets.some(o => o.dx === nextOffset.dx && o.dy === nextOffset.dy && o.dz === nextOffset.dz)) {
                offsets.push(nextOffset);
                lastOffset = nextOffset;
                foundNewPosition = true;
                currentVerticalStack = (randomDirection.dy === 1 && randomDirection.dx === 0 && randomDirection.dz === 0) ? currentVerticalStack + 1 : 0;
            }
        }
    }
    return offsets;
}

function generateFlagOffsets() {
    const offsets = [];
    const MIN_FLAG_WIDTH = 2, MAX_FLAG_WIDTH = 10;
    const MIN_FLAG_HEIGHT = 1, MAX_FLAG_HEIGHT = 5;
    const width = Math.floor(Math.random() * (MAX_FLAG_WIDTH - MIN_FLAG_WIDTH + 1)) + MIN_FLAG_WIDTH;
    const height = Math.floor(Math.random() * (MAX_FLAG_HEIGHT - MIN_FLAG_HEIGHT + 1)) + MIN_FLAG_HEIGHT;
    for (let y = 0; y < height; y++) {
        for (let z = 0; z < width; z++) {
            offsets.push({ dx: 0, dy: y, dz: z });
        }
    }
    return offsets;
}

function stopWalkingToTarget(ai, radius) {
    ai.removeTag(AI_MOVEMENT_TAG);
    try { ai.triggerEvent(STOP_WALKING_EVENT); } catch (e) { /* ignore */ }
    try {
        for (const target of ai.dimension.getEntities({ type: BUILD_aim_ENTITY_ID, maxDistance: radius, location: ai.location })) {
            buildTargetTracker.delete(target.id);
            target.triggerEvent(DESPAWN_EVENT);
        }
    } catch (e) { console.warn(e, e.stack); }
}

// Walk to a step that is out of reach
function startWalkingToTarget(ai, targetLoc) {
    if (ai.hasTag(AI_MOVEMENT_TAG)) return;
    if (!ai.hasTag(IS_BUILDING_TAG)) return;

    let existing = [];
    try {
        existing = ai.dimension.getEntities({ type: BUILD_aim_ENTITY_ID, maxDistance: 100, location: ai.location });
    } catch (e) { console.warn(e, e.stack); }

    if (existing.length === 0) {
        let loaded = false;
        try { loaded = ai.dimension.isChunkLoaded(targetLoc); } catch (e) { loaded = false; }
        if (!loaded) {
            ai.removeTag(BUILDER_TAG);
            cleanUpBuilderState(ai);
            return;
        }
        try {
            const targetEntity = ai.dimension.spawnEntity(BUILD_aim_ENTITY_ID, targetLoc);
            buildTargetTracker.set(targetEntity.id, { spawnTick: system.currentTick, dimension: ai.dimension });
        } catch (e) { console.warn(e, e.stack); }
    }
    ai.addTag(AI_MOVEMENT_TAG);
}

function scheduleStep(ai, state) {
    system.runTimeout(() => {
        try {
            buildStep(ai, state);
        } catch (e) {
            console.warn(e, e.stack);
            activeBuilds.delete(ai.id);
            cleanUpBuilderState(ai);
        }
    }, state.pass > 1 ? 6 : getRandomBuildDelay());
}

// A step he cannot place right now goes on the list for the second pass, so the
// build ends up finished instead of full of holes.
function deferStep(state, offset) {
    if (state.pass === 1) state.pending.push(offset);
}

function buildStep(ai, state) {
    if (!ai.isValid) {
        activeBuilds.delete(ai.id);
        return;
    }
    activeBuilds.set(ai.id, system.currentTick);

    if (state.stepIndex >= state.offsets.length) {
        if (state.pass === 1 && state.pending.length > 0) {
            state.offsets = state.pending;
            state.pending = [];
            state.stepIndex = 0;
            state.pass = 2;
            scheduleStep(ai, state);
            return;
        }
        activeBuilds.delete(ai.id);
        cleanUpBuilderState(ai);
        return;
    }

    if (ai.isInWater) {
        activeBuilds.delete(ai.id);
        cleanUpBuilderState(ai);
        return;
    }

    // Do not build through a fight
    try {
        const currentTargetId = ai.getDynamicProperty("rg:current_target");
        if (currentTargetId && currentTargetId !== BUILD_aim_ENTITY_ID) {
            activeBuilds.delete(ai.id);
            cleanUpBuilderState(ai);
            return;
        }
    } catch (e) {
        activeBuilds.delete(ai.id);
        cleanUpBuilderState(ai);
        return;
    }

    const offset = state.offsets[state.stepIndex];
    const targetLoc = { x: state.base.x + offset.dx, y: state.base.y + offset.dy, z: state.base.z + offset.dz };

    if (ai.isFalling || !ai.isOnGround) {
        system.runTimeout(() => {
            try {
                buildStep(ai, state);
            } catch (e) {
                console.warn(e, e.stack);
                activeBuilds.delete(ai.id);
                cleanUpBuilderState(ai);
            }
        }, MOVEMENT_WAIT_TICKS);
        return;
    }
    const targetBlock = ai.dimension.getBlock(targetLoc);
    const targetTypeId = targetBlock ? targetBlock.typeId : "minecraft:air";

    // Something is already there (terrain, or his own block): that part of the
    // build is done rather than missing
    if (!isAirBlock(ai.dimension, targetLoc) || BLOCK_PLACEMENT_BLACKLIST.includes(targetTypeId)) {
        state.stepIndex++;
        scheduleStep(ai, state);
        return;
    }

    const dx = ai.location.x - (targetLoc.x + 0.5);
    const dz = ai.location.z - (targetLoc.z + 0.5);
    // A player measures reach from their eyes, not their feet: feet-based
    // distance made roof blocks unreachable and houses lost their tops
    const dy = (ai.location.y + 1.62) - (targetLoc.y + 0.5);
    const distanceSquared = dx * dx + dy * dy + dz * dz;

    // Knocked right away from the site: give up on the whole build
    if (distanceSquared > ABORT_DISTANCE_SQUARED) {
        activeBuilds.delete(ai.id);
        cleanUpBuilderState(ai);
        return;
    }

    const distance = Math.sqrt(distanceSquared);
    const currentTick = system.currentTick;

    if (distance > MOVEMENT_CHECK_DISTANCE) {
        if (!aiStartTimeTracker.has(ai.id)) aiStartTimeTracker.set(ai.id, currentTick);
        const elapsedTicks = currentTick - aiStartTimeTracker.get(ai.id);

        if (elapsedTicks >= MOVEMENT_TIMEOUT_TICKS) {
            // First try a step up towards it, then keep the shape and come back
            // later. The old code squashed every higher block down to his own
            // level, which is why the walls and roofs went missing.
            //
            // A helper step is placed with a command, which is asynchronous, so
            // it can report success and still place nothing. Without a cap the
            // bot retried the same step forever, kept refreshing activeBuilds,
            // and never let go of is_busy_building.
            state.helperTries = (state.helperTries || 0) + 1;
            if (state.helperTries <= 2 && placeClimbHelperBlock(ai, targetLoc, state.block)) {
                aiStartTimeTracker.set(ai.id, currentTick);
                scheduleStep(ai, state);
                return;
            }
            state.helperTries = 0;
            aiStartTimeTracker.delete(ai.id);
            stopWalkingToTarget(ai, 10);
            deferStep(state, offset);
            state.stepIndex++;
            scheduleStep(ai, state);
            return;
        }

        startWalkingToTarget(ai, targetLoc);
        scheduleStep(ai, state);
        return;
    }

    aiStartTimeTracker.delete(ai.id);
    if (ai.hasTag(AI_MOVEMENT_TAG)) stopWalkingToTarget(ai, 5);

    const flooredTargetLoc = { x: Math.floor(targetLoc.x), y: Math.floor(targetLoc.y), z: Math.floor(targetLoc.z) };
    const aiFeetLoc = { x: Math.floor(ai.location.x), y: Math.floor(ai.location.y), z: Math.floor(ai.location.z) };
    const inHisOwnWay = flooredTargetLoc.x === aiFeetLoc.x && flooredTargetLoc.z === aiFeetLoc.z &&
        (flooredTargetLoc.y === aiFeetLoc.y || flooredTargetLoc.y === aiFeetLoc.y + 1);

    if (inHisOwnWay) {
        // Stand somewhere else for this one on the second pass
        deferStep(state, offset);
        state.stepIndex++;
        scheduleStep(ai, state);
        return;
    }

    if (targetTypeId === state.block.typeId || !isAirBlock(ai.dimension, flooredTargetLoc)) {
        state.stepIndex++;
        scheduleStep(ai, state);
        return;
    }

    try {
        const lookDx = (targetLoc.x + 0.5) - ai.location.x;
        const lookDz = (targetLoc.z + 0.5) - ai.location.z;
        const yaw = Math.atan2(-lookDx, lookDz) * (180 / Math.PI);
        ai.setRotation({ x: 0, y: yaw });

        const soundId = BLOCK_SOUND_MAP[state.block.typeId];
        if (soundId) { try { ai.runCommand(`playsound ${soundId} @a ${Math.floor(targetLoc.x)} ${Math.floor(targetLoc.y)} ${Math.floor(targetLoc.z)}`); } catch (e) { console.warn(e, e.stack); } }
        try { ai.runCommand(ANIMATION_COMMAND); } catch (e) { console.warn(e, e.stack); }

        try {
            ai.dimension.runCommand(`setblock ${flooredTargetLoc.x} ${flooredTargetLoc.y} ${flooredTargetLoc.z} ${state.block.typeId}`);
        } catch (e) { console.warn(e, e.stack); }
    } catch (e) { console.warn(e, e.stack); }

    state.stepIndex++;
    scheduleStep(ai, state);
}

function startOneBuild(ai) {
    ai.removeTag(BUILDER_TAG);
    if (!ai.isValid) return;
    if (ai.hasTag(IS_BUILDING_TAG)) return;

    // Never break ground for a house mid-fight, mid-meal or mid-sleep
    if (ai.getDynamicProperty("rg:current_target")) return;
    if (ai.hasTag("on_eat") || ai.hasTag("is_sleeping") || ai.hasTag("is_busy_cooking")) return;
    if (ai.hasTag("has_shelter") || ai.hasTag("building_shelter")) return;

    // A bot someone hired to chop or mine does not go build a house instead
    if (hasJob(ai)) return;

    ai.addTag(IS_BUILDING_TAG);
    const chosenBlueprint = getWeightedRandom(STRUCTURE_BLUEPRINTS);
    const chosenBlock = getWeightedRandom(BUILD_BLOCK_TYPES);
    const itemToEquip = chosenBlock.itemEquipId || chosenBlock.typeId;
    try { ai.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${itemToEquip}`); } catch (e) { console.warn(e, e.stack); }
    const aiLoc = ai.location, aiRot = ai.getRotation();
    const snappedYaw = snapRotationToCardinal(aiRot.y);
    const relativeOffsets = chosenBlueprint.generator();
    if (!relativeOffsets || relativeOffsets.length === 0) { cleanUpBuilderState(ai); return; }
    const initialOffset = rotateCoordinates(0, START_DISTANCE, snappedYaw);
    const baseLoc = { x: Math.floor(aiLoc.x + initialOffset.dx), y: Math.floor(aiLoc.y), z: Math.floor(aiLoc.z + initialOffset.dz) };

    if (isFluidBlock(ai.dimension, baseLoc) || isFluidBlock(ai.dimension, { x: baseLoc.x, y: baseLoc.y - 1, z: baseLoc.z })) {
        cleanUpBuilderState(ai);
        return;
    }

    const rotatedOffsets = relativeOffsets.map(offset => { const rotated = rotateCoordinates(offset.dx, offset.dz, snappedYaw); return { dx: rotated.dx, dy: offset.dy, dz: rotated.dz }; });
    const state = {
        base: baseLoc,
        offsets: rotatedOffsets,
        pending: [],
        stepIndex: 0,
        pass: 1,
        block: chosenBlock
    };
    activeBuilds.set(ai.id, system.currentTick);
    ai.triggerEvent(STOP_WALKING_EVENT);
    const lookDx = (baseLoc.x + 0.5) - ai.location.x;
    const lookDz = (baseLoc.z + 0.5) - ai.location.z;
    const yaw = Math.atan2(-lookDx, lookDz) * (180 / Math.PI);
    ai.setRotation({ x: 0, y: yaw });
    system.runTimeout(() => {
        try {
            buildStep(ai, state);
        } catch (e) {
            console.warn(e, e.stack);
            activeBuilds.delete(ai.id);
            cleanUpBuilderState(ai);
        }
    }, 10);
}

export function startBuilderSystem() {
    const BUILD_Checkgaptime = 40;
    const dimensionIds = ["overworld", "nether", "the_end"];

    system.runInterval(() => {
        let potentialBuilders = [];
        for (const dimId of dimensionIds) {
            try {
                const dimension = world.getDimension(dimId);
                const entitiesInDimension = dimension.getEntities({ type: ai_player_id, tags: [BUILDER_TAG] });
                potentialBuilders.push(...entitiesInDimension);
            } catch (e) { console.warn(e, e.stack); }
        }
        for (const ai of potentialBuilders) {
            try {
                startOneBuild(ai);
            } catch (e) {
                console.warn(e, e.stack);
                cleanUpBuilderState(ai);
            }
        }
    }, BUILD_Checkgaptime);

    system.runInterval(() => {
        if (buildTargetTracker.size === 0) return;
        for (const [targetId, targetInfo] of buildTargetTracker.entries()) {
            const elapsedTicks = system.currentTick - targetInfo.spawnTick;
            if (elapsedTicks > BUILD_aim_TIMEOUT_TICKS) {
                const dimension = targetInfo.dimension;
                let targetEntity;
                try {
                    targetEntity = dimension.getEntity(targetId);
                } catch (e) {
                    buildTargetTracker.delete(targetId);
                    continue;
                }
                if (targetEntity && targetEntity.isValid) {
                    const nearbyBuilders = targetEntity.dimension.getEntities({ type: ai_player_id, location: targetEntity.location, maxDistance: 20, tags: [IS_BUILDING_TAG] });
                    if (nearbyBuilders.length > 0) {
                        for (const builder of nearbyBuilders) {
                            cleanUpBuilderState(builder);
                        }
                    }
                    targetEntity.triggerEvent(DESPAWN_EVENT);
                }
                buildTargetTracker.delete(targetId);
            }
        }
    }, 40);

    system.runInterval(() => {
        const dimensionIds = ["overworld", "nether", "the_end"];
        for (const dimId of dimensionIds) {
            try {
                const dimension = world.getDimension(dimId);
                const aiEntities = dimension.getEntities({ type: ai_player_id });
                for (const ai of aiEntities) {
                    if (!ai.isValid) continue;
                    tryHoleEscape(ai);
                }
            } catch (e) { console.warn(e, e.stack); }
        }
    }, 20);

    // A build chain that died mid-way (chunk unload, thrown error) must not leave
    // a bot tagged as building for the rest of the session
    system.runInterval(() => {
        for (const dimId of ["overworld", "nether", "the_end"]) {
            try {
                const dimension = world.getDimension(dimId);
                for (const ai of dimension.getEntities({ type: ai_player_id, tags: [IS_BUILDING_TAG] })) {
                    const last = activeBuilds.get(ai.id);
                    if (last === undefined || system.currentTick - last > 400) {
                        cleanUpBuilderState(ai);
                    }
                }
            } catch (e) { /* dimension not loaded */ }
        }
    }, 200);

    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;

        const processedAis = new Set();

        for (const player of allPlayers) {
            if (!player.isValid) continue;

            const nearbyAis = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: PROXIMITY_RADIUS_FOR_IDLE_CHECK,
                location: player.location
            });

            for (const ai of nearbyAis) {
                if (processedAis.has(ai.id) || !ai.isValid) continue;
                if (brainActive(ai)) continue;   // the LLM brain decides when to build

                const hasCombatTarget = getCurrentTarget(ai) !== null;

                let isBusy = hasCombatTarget;

                if (!isBusy) {
                    isBusy = hasJob(ai) ||
                        ai.hasTag(IS_BUILDING_TAG) ||
                        ai.hasTag('on_eat') ||
                        ai.hasTag('prohibit_building') ||
                        ai.hasTag('is_busy_cooking') ||
                        ai.hasTag('is_upgrading');
                }

                if (isBusy) {
                    processedAis.add(ai.id);
                    continue;
                }

                if (Math.random() < 0.70) {
                    ai.addTag(BUILDER_TAG);
                }

                processedAis.add(ai.id);
            }
        }
    }, 1200);
}


