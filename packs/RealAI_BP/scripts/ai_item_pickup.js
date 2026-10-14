import { world, system } from "@minecraft/server";
import { botSay } from "./ai_conversations.js";
import { onItemReceived } from "./ai_bot_quests.js";

import { brainActive } from "./brain/gate.js";
// ============================================================================
// CONFIG
// ============================================================================
const ai_player_id = "rg:bot";
const PICKUP_RADIUS     = 5;   // Blocks around item to search for a bot
const WORKER_KEEP_RADIUS = 4;  // matches the radius a hired bot banks drops in
const PICKUP_DELAY      = 10;  // Ticks after spawn before attempting pickup

// Items bots won't bother picking up
const SKIP_ITEMS = new Set([
    "minecraft:rotten_flesh",
    "minecraft:poisonous_potato",
    "minecraft:spider_eye",
    "minecraft:bone_meal",
    "minecraft:bone",
    "minecraft:string",
    "minecraft:gunpowder"
]);

// Occasional pickup announcement messages
const PICKUP_MSGS = [
    "Found some loot!",
    "ooh, free stuff",
    "I'll take that",
    "nice",
    "score!"
];

// Gifts a bot is grateful for, best tier first. {i} = item name, {p} = giver
const GIFT_TIERS = [
    {
        sympathy: 12,
        thanks: [
            "whoa, {i}? for me? thanks {p}!",
            "you're actually giving me this {i}? alright, thanks {p}"
        ],
        items: [
            "minecraft:diamond", "minecraft:emerald", "minecraft:netherite_ingot",
            "minecraft:ancient_debris", "minecraft:diamond_block", "minecraft:emerald_block",
            "minecraft:diamond_pickaxe", "minecraft:diamond_sword", "minecraft:diamond_axe"
        ]
    },
    {
        sympathy: 7,
        thanks: [
            "nice, an {i}. thanks {p}",
            "I'll take that, thanks {p}!"
        ],
        items: [
            "minecraft:iron_ingot", "minecraft:gold_ingot", "minecraft:iron_sword",
            "minecraft:iron_pickaxe", "minecraft:iron_axe", "minecraft:golden_apple",
            "minecraft:enchanted_golden_apple", "minecraft:bow", "minecraft:shield", "minecraft:saddle"
        ]
    },
    {
        sympathy: 4,
        thanks: [
            "thanks for the food, {p}!",
            "oh nice, I was hungry. thanks {p}"
        ],
        items: [
            "minecraft:cooked_beef", "minecraft:cooked_chicken", "minecraft:cooked_porkchop",
            "minecraft:cooked_mutton", "minecraft:cooked_rabbit", "minecraft:cooked_salmon",
            "minecraft:cooked_cod", "minecraft:bread", "minecraft:baked_potato",
            "minecraft:pumpkin_pie", "minecraft:golden_carrot", "minecraft:cake"
        ]
    },
    {
        sympathy: 2,
        thanks: ["cheers {p}", "thanks {p}, I can use that"],
        items: [
            "minecraft:apple", "minecraft:wheat", "minecraft:carrot", "minecraft:potato",
            "minecraft:copper_ingot", "minecraft:coal", "minecraft:torch", "minecraft:oak_log"
        ]
    }
];

function giftTier(typeId) {
    return GIFT_TIERS.find(tier => tier.items.includes(typeId)) || null;
}

// The closest player gets credit for the drop - the best guess we have
function nearestPlayerTo(dimension, location, range) {
    try {
        const players = dimension.getPlayers({ location: location, maxDistance: range });
        if (!players || players.length === 0) return null;

        let closest = null;
        let closestDist = Infinity;
        for (const player of players) {
            if (!player.isValid) continue;
            const dx = player.location.x - location.x;
            const dy = player.location.y - location.y;
            const dz = player.location.z - location.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < closestDist) {
                closestDist = dist;
                closest = player;
            }
        }
        return closest;
    } catch (e) {
        return null;
    }
}

// ============================================================================
// startR
// ============================================================================
export function startItemPickup() {
    world.afterEvents.entitySpawn.subscribe(event => {
        const entity = event.entity;

        // Only care about dropped item entities
        if (entity.typeId !== "minecraft:item") return;

        // Delay so the item has settled and we're not in the same tick as the
        // spawn (avoids edge-case crashes with unloaded chunks)
        system.runTimeout(() => {
            if (!entity.isValid) return;

            // A bot who just handed a haul to a player drops it at their feet and
            // his job ends the same tick; without this mark the closest bot - often
            // him - would straight away put the player's items back in his own bag
            try {
                if (entity.hasTag("rg:delivered")) return;
            } catch (e) { /* tags on item entities may not be readable */ }

            // Retrieve the item stack from the dropped item entity
            let itemStack;
            try {
                const itemComp = entity.getComponent("minecraft:item");
                if (!itemComp) return;
                itemStack = itemComp.itemStack;
                if (!itemStack) return;
            } catch (e) {
                return;
            }

            // Skip junk items
            if (SKIP_ITEMS.has(itemStack.typeId)) return;

            // Find the nearest bot within pickup radius
            let nearestBot  = null;
            let nearestDist = PICKUP_RADIUS + 1;
            let nearWorker  = null;
            let workerDist  = 99;

            try {
                const candidates = entity.dimension.getEntities({
                    type:        ai_player_id,
                    location:    entity.location,
                    maxDistance: PICKUP_RADIUS
                });

                for (const bot of candidates) {
                    if (!bot.isValid || bot.isInWater) continue;
                    if (brainActive(bot)) continue;   // the model decides what to pick up and who to give it to

                    const dx   = bot.location.x - entity.location.x;
                    const dy   = bot.location.y - entity.location.y;
                    const dz   = bot.location.z - entity.location.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestBot  = bot;
                    }

                    // A hired bot banks what he breaks within 4 blocks for the
                    // player who hired him; an idle bot must not eat that haul
                    if (dist <= WORKER_KEEP_RADIUS &&
                        bot.getDynamicProperty("rg:friend_task") &&
                        dist < workerDist) {
                        workerDist = dist;
                        nearWorker = bot;
                    }
                }
            } catch (e) {
                return;
            }

            if (nearWorker) return;

            if (!nearestBot || !nearestBot.isValid) return;

            // A bot on a job banks his own drops for the player, so leave those alone
            if (nearestBot.getDynamicProperty("rg:friend_task")) return;

            // Add item to bot's inventory
            try {
                const invComp = nearestBot.getComponent("minecraft:inventory");
                if (!invComp || !invComp.container) return;

                const leftover = invComp.container.addItem(itemStack);
                const received = itemStack.amount - (leftover?.amount || 0);
                if (received > 0) onItemReceived(nearestBot, itemStack.typeId, received);

                // Remove the dropped entity so it isn't picked up twice
                try { entity.kill(); } catch (e) { console.warn(e, e.stack); }

                // occasionally say something about the pickup
                if (Math.random() < 0.09) {
                    const itemName = itemStack.typeId
                        .replace("minecraft:", "")
                        .replace(/_/g, " ");
                    const quip = PICKUP_MSGS[Math.floor(Math.random() * PICKUP_MSGS.length)];
                    system.runTimeout(() => {
                        if (nearestBot.isValid) {
                            botSay(nearestBot, `${quip} (${itemName})`);
                        }
                    }, Math.floor(Math.random() * 20) + 5);
                }

                // Gratitude for a gift worth having
                const tier = giftTier(itemStack.typeId);
                if (tier) {
                    const giver = nearestPlayerTo(nearestBot.dimension, nearestBot.location, 8);
                    if (giver) {
                        const sympathyKey = "sympathy_player_" + giver.id;
                        const currentSympathy = nearestBot.getDynamicProperty(sympathyKey) || 0;
                        const affinityKey = "rg:affinity_" + giver.name;
                        const currentAffinity = nearestBot.getDynamicProperty(affinityKey) || 0;

                        try {
                            nearestBot.setDynamicProperty(sympathyKey, Math.min(100, currentSympathy + tier.sympathy));
                            nearestBot.setDynamicProperty(affinityKey, currentAffinity + tier.sympathy);
                        } catch (e) { console.warn(e, e.stack); }

                        const itemName = itemStack.typeId.replace("minecraft:", "").replace(/_/g, " ");
                        const thanks = tier.thanks[Math.floor(Math.random() * tier.thanks.length)]
                            .replace(/\{i\}/g, itemName)
                            .replace(/\{p\}/g, giver.nameTag || "you");
                        botSay(nearestBot, thanks);
                    }
                }

            } catch (e) { console.warn(e, e.stack); }

        }, PICKUP_DELAY);
    });
}
