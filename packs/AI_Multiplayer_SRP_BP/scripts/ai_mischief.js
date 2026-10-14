import { world, system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";
import { getSettings } from "./ai_settings.js";

const SCAN_GAP = 200;
const NEXT_KEY = "rg:mischief_next";
const VICTIM_RANGE = 10;
const CHEST_RANGE = 6;

const PET_NAMES = ["Biscuit", "Noodle", "Meatball", "Chairman", "Doggo", "Kevin", "Waffles", "Ferdinand", "Tragic"];
const FLOWERS = ["minecraft:poppy", "minecraft:dandelion", "minecraft:torch"];

const SAY = {
    rename: "I renamed your dog {n}. You're welcome.",
    flower: "decorated around here, you were missing it",
    block: "oops, did I put that there",
    chest: "borrowed one of those, you won't miss it"
};

function distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

function pickVictim(ai) {
    let best = null;
    let bestSympathy = 0;

    for (const player of ai.dimension.getPlayers({ location: ai.location, maxDistance: VICTIM_RANGE })) {
        if (!player.isValid) continue;
        const sympathy = ai.getDynamicProperty("sympathy_player_" + player.id) || 0;
        if (sympathy <= bestSympathy) continue;   // only prank people who like him
        best = player;
        bestSympathy = sympathy;
    }
    return best;
}

function renameSomeonesDog(ai, player) {
    const dogs = ai.dimension.getEntities({
        type: "minecraft:wolf",
        location: player.location,
        maxDistance: 8
    });
    if (!dogs || dogs.length === 0) return false;

    const dog = dogs.find(d => d.isValid && !PET_NAMES.includes(d.nameTag));
    if (!dog) return false;

    const name = PET_NAMES[Math.floor(Math.random() * PET_NAMES.length)];
    try {
        dog.nameTag = name;
    } catch (e) { return false; }

    botSay(ai, SAY.rename.replace("{n}", name));
    return true;
}

function decorateNear(ai, player) {
    const spot = { x: Math.floor(player.location.x) + (Math.random() < 0.5 ? 1 : -1), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
    const block = ai.dimension.getBlock(spot);
    const ground = ai.dimension.getBlock({ x: spot.x, y: spot.y - 1, z: spot.z });
    if (!block || !ground || !block.isAir || ground.isAir) return false;

    try {
        block.setType(FLOWERS[Math.floor(Math.random() * FLOWERS.length)]);
    } catch (e) { return false; }

    botSay(ai, SAY.flower);
    return true;
}

function putABlockInFront(ai, player) {
    let yaw = 0;
    try { yaw = player.getRotation().y * Math.PI / 180; } catch (e) { return false; }

    const spot = {
        // Bedrock forward is (-sin yaw, cos yaw): with +sin the dirt landed on
        // the mirrored side of wherever the player was facing
        x: Math.floor(player.location.x - Math.sin(yaw)),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z + Math.cos(yaw))
    };
    const block = ai.dimension.getBlock(spot);
    const ground = ai.dimension.getBlock({ x: spot.x, y: spot.y - 1, z: spot.z });
    if (!block || !ground || !block.isAir || ground.isAir) return false;

    try {
        block.setType("minecraft:dirt");
    } catch (e) { return false; }

    botSay(ai, SAY.block);
    return true;
}

// One item, from one chest, and he owns up to it straight away
function liftOneItem(ai, player) {
    const feet = Math.floor(player.location.y);

    for (let dx = -CHEST_RANGE; dx <= CHEST_RANGE; dx++) {
        for (let dz = -CHEST_RANGE; dz <= CHEST_RANGE; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                let block;
                try {
                    block = ai.dimension.getBlock({ x: Math.floor(player.location.x) + dx, y: feet + dy, z: Math.floor(player.location.z) + dz });
                } catch (e) { continue; }

                if (!block || !block.typeId.endsWith("chest")) continue;

                const container = block.getComponent("minecraft:inventory")?.container;
                if (!container) continue;

                for (let i = 0; i < container.size; i++) {
                    const stack = container.getItem(i);
                    if (!stack || stack.amount < 2) continue;   // always leave one behind

                    const taken = stack.typeId;
                    const reduced = stack.clone();
                    reduced.amount = stack.amount - 1;
                    container.setItem(i, reduced);

                    botSay(ai, `${SAY.chest} (${taken.replace("minecraft:", "")})`);
                    return true;
                }
            }
        }
    }
    return false;
}

export function startMischief() {
    system.runInterval(() => {
        const level = getSettings().mischief;
        if (!level) return;

        for (const ai of ALL_AI_CACHE || []) {
            if (!ai.isValid) continue;
            if (ai.hasTag("is_sleeping") || ai.getDynamicProperty("rg:current_target")) continue;
            if ((ai.getDynamicProperty(NEXT_KEY) || 0) > system.currentTick) continue;

            ai.setDynamicProperty(NEXT_KEY, system.currentTick + 2400 + Math.floor(Math.random() * 3600));

            const player = pickVictim(ai);
            if (!player) continue;

            const acts = level > 1
                ? [renameSomeonesDog, putABlockInFront, liftOneItem, decorateNear]
                : [renameSomeonesDog, decorateNear];

            const act = acts[Math.floor(Math.random() * acts.length)];
            try {
                act(ai, player);
            } catch (e) { console.warn(e, e.stack); }
        }
    }, SCAN_GAP);
}
