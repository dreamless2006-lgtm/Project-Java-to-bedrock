import { world, system, EntityDamageCause, Player, ItemStack } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { botSay } from "./ai_conversations.js";

import { brainActive } from "./brain/gate.js";
const ai_player_id = "rg:bot";
const AFFINITY_PROPERTY_PREFIX = "rg:affinity_";

// Thresholds
const HATE_THRESHOLD = -30;
const LOVE_THRESHOLD = 30;

// botId -> { attackerId, tick } : whoever last hurt a bot, so we notice defence
const recentBotAttackers = new Map();

export function startSocialMemory() {
    
    // 1. Negative Interaction (Attacking the bot)
    world.afterEvents.entityHurt.subscribe(event => {
        const { hurtEntity, damageSource } = event;
        const attacker = damageSource.damagingEntity;

        if (hurtEntity.typeId === ai_player_id && attacker && attacker instanceof Player) {
            
            // It's a player hitting the bot! Decrease affinity rapidly.
            let currentAffinity = hurtEntity.getDynamicProperty(AFFINITY_PROPERTY_PREFIX + attacker.name) || 0;
            currentAffinity -= 15; // Heavy penalty for violence
            
            // Save affinity
            try {
                hurtEntity.setDynamicProperty(AFFINITY_PROPERTY_PREFIX + attacker.name, currentAffinity);
            } catch (e) { console.warn(e, e.stack); }

            // Immediate reaction if they hate the player
            if (currentAffinity <= HATE_THRESHOLD) {
                // Aggro on the player, then let it cool off - this tag used to leak forever
                hurtEntity.addTag("allow_attack");
                system.runTimeout(() => {
                    if (hurtEntity.isValid) hurtEntity.removeTag("allow_attack");
                }, 200);
                try {
                    // Small damage application to trick the AI combat target
                    hurtEntity.applyDamage(0, {
                        cause: EntityDamageCause.entityAttack,
                        damagingEntity: attacker
                    });
                } catch (e) { console.warn(e, e.stack); }
                
                // Have the bot complain in chat
                if (Math.random() < 0.3) {
                    botSay(hurtEntity, `I've had enough of you, ${attacker.name}!`, "§c");
                }
            }
        }
    });

    // 1b. Being defended - a player hits whatever just hurt one of our bots
    world.afterEvents.entityHurt.subscribe(event => {
        const { hurtEntity, damageSource } = event;
        const attacker = damageSource.damagingEntity;
        if (!attacker) return;

        if (hurtEntity.typeId === ai_player_id && !(attacker instanceof Player)) {
            recentBotAttackers.set(hurtEntity.id, { attackerId: attacker.id, tick: system.currentTick });
            return;
        }

        if (!(attacker instanceof Player)) return;

        for (const [botId, record] of recentBotAttackers) {
            if (record.attackerId !== hurtEntity.id) continue;
            recentBotAttackers.delete(botId);

            // Too late to read as defending
            if (system.currentTick - record.tick > 100) continue;

            const bot = world.getEntity(botId);
            if (!bot?.isValid) continue;

            const sympathyKey = "sympathy_player_" + attacker.id;
            const sympathy = (bot.getDynamicProperty(sympathyKey) || 0) + 7;
            try {
                bot.setDynamicProperty(sympathyKey, Math.min(100, sympathy));
            } catch (e) { console.warn(e, e.stack); }

            if (Math.random() < 0.5) {
                botSay(bot, `thanks for having my back, ${attacker.nameTag}!`);
            }
        }

        if (recentBotAttackers.size > 64) {
            for (const [botId, record] of recentBotAttackers) {
                if (system.currentTick - record.tick > 200) recentBotAttackers.delete(botId);
            }
        }
    });

    // 2. Positive Interaction (Player interacting / feeding bot could be detected here, 
    //    but we'll simulate a passive positive bond that builds if you stay near them peacefully, 
    //    and a negative bond recovery over a long time)
    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;

        for (const player of allPlayers) {
            if (!player.isValid) continue;

            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: 8,
                location: player.location
            });

            for (const ai of nearbyAI) {
                if (!ai.isValid) continue;
                if (brainActive(ai)) continue;   // gifts and grudges live in the model's own memory

                let currentAffinity = ai.getDynamicProperty(AFFINITY_PROPERTY_PREFIX + player.name) || 0;

                // Passive relationship building for spending time nearby without attacking
                if (currentAffinity < LOVE_THRESHOLD * 2) { // cap out passive growth
                    currentAffinity += 1; // +1 every 5 seconds they hang around
                    
                    try {
                        ai.setDynamicProperty(AFFINITY_PROPERTY_PREFIX + player.name, currentAffinity);
                    } catch (e) { console.warn(e, e.stack); }
                }

                // Consequences of High/Low Affinity
                if (currentAffinity >= LOVE_THRESHOLD) {
                    // Show some love
                    if (Math.random() < 0.1) { // 10% chance per 5 seconds
                        ai.runCommand("particle minecraft:heart_particle ~ ~2.2 ~");
                        
                        // Toss the player an item as a gift (Apple) rarely
                        if (Math.random() < 0.05) {
                            try {
                                ai.dimension.spawnItem(
                                    new ItemStack("minecraft:apple", 1), 
                                    ai.location
                                );
                                botSay(ai, `Here, I found this for you, ${player.name}.`, "§d");
                                currentAffinity -= 5; // Slight reduction so they don't spam indefinitely
                                ai.setDynamicProperty(AFFINITY_PROPERTY_PREFIX + player.name, currentAffinity);
                            } catch (e) { console.warn(e, e.stack); }
                        }
                    }
                } else if (currentAffinity <= HATE_THRESHOLD) {
                    // Show anger
                    if (Math.random() < 0.2) {
                        ai.runCommand("particle minecraft:villager_angry ~ ~2.2 ~");
                    }
                }
            }
        }
    }, 100); // Check and grow passive affinity every 5 seconds (100 ticks)

}


