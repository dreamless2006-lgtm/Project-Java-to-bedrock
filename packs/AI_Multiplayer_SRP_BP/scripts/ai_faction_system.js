import { world, system, EntityComponentTypes } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";

const ai_player_id = "rg:bot";
const FACTION_PROPERTY = "rg:faction";
const FACTION_CHECK_GAP = 100; // Check every 5 seconds

// Define factions with their properties
// Display names stay short - the internal keys below are what get saved to
// worlds and to entity tags, so they must not change.
const FACTIONS = {
    "big_netherite": {
        displayName: "§6Alpha",
        subfactions: [
            "netherite_alpha", "netherite_beta", "netherite_gamma", "netherite_delta",
            "netherite_epsilon", "netherite_zeta", "netherite_eta", "netherite_theta"
        ],
        color: "§6",
        hostile: ["ancient_dragon", "void_faction"]
    },
    "ancient_dragon": {
        displayName: "§5Beta",
        subfactions: [
            "dragon_alpha", "dragon_beta", "dragon_gamma", "dragon_delta"
        ],
        color: "§5",
        hostile: ["big_netherite", "void_faction"]
    },
    "void_faction": {
        displayName: "§0Sigma",
        subfactions: [
            "void_alpha", "void_beta", "void_gamma"
        ],
        color: "§0",
        hostile: ["big_netherite", "ancient_dragon"]
    },
    "shadow_order": {
        displayName: "§8Omega",
        subfactions: [
            "shadow_alpha", "shadow_beta", "shadow_gamma", "shadow_delta"
        ],
        color: "§8",
        hostile: ["big_netherite"]
    }
};

// Assign faction on spawn
export function assignFaction(ai) {
    if (!ai || !ai.isValid) return;
    
    const existingFaction = ai.getDynamicProperty(FACTION_PROPERTY);
    if (existingFaction) return;
    
    // Weight towards Big Netherite faction (60% chance)
    let selectedFaction;
    const random = Math.random();
    
    if (random < 0.60) {
        selectedFaction = "big_netherite";
    } else if (random < 0.80) {
        selectedFaction = "ancient_dragon";
    } else if (random < 0.90) {
        selectedFaction = "void_faction";
    } else {
        selectedFaction = "shadow_order";
    }
    
    const factionConfig = FACTIONS[selectedFaction];
    const subfaction = factionConfig.subfactions[Math.floor(Math.random() * factionConfig.subfactions.length)];
    
    ai.setDynamicProperty(FACTION_PROPERTY, selectedFaction);
    ai.addTag(`faction_${selectedFaction}`);
    ai.addTag(`subfaction_${subfaction}`);
    
    // Display faction join message
    try {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (allPlayers && allPlayers.length > 0) {
            for (const player of allPlayers) {
                player.sendMessage(`${factionConfig.displayName} recruited ${ai.nameTag || "AI"}!`);
            }
        }
    } catch (e) { console.warn(e, e.stack); }
}

// Check faction relationship
export function isSameFaction(ai1, ai2) {
    if (!ai1?.isValid || !ai2?.isValid) return false;
    
    const faction1 = ai1.getDynamicProperty(FACTION_PROPERTY);
    const faction2 = ai2.getDynamicProperty(FACTION_PROPERTY);
    
    return faction1 && faction1 === faction2;
}

// Check if factions are hostile
export function isHostileFaction(ai1, ai2) {
    if (!ai1?.isValid || !ai2?.isValid) return false;
    
    const faction1 = ai1.getDynamicProperty(FACTION_PROPERTY);
    const faction2 = ai2.getDynamicProperty(FACTION_PROPERTY);
    
    if (!faction1 || !faction2 || faction1 === faction2) return false;
    
    const config1 = FACTIONS[faction1];
    if (!config1) return false;
    
    return config1.hostile && config1.hostile.includes(faction2);
}

// Get all AI from same faction
export function getFactionalAllies(ai, maxDistance = 64) {
    if (!ai?.isValid) return [];
    
    const aiFaction = ai.getDynamicProperty(FACTION_PROPERTY);
    if (!aiFaction) return [];
    
    try {
        const nearby = ai.dimension.getEntities({
            type: ai_player_id,
            maxDistance: maxDistance,
            location: ai.location
        });
        
        return nearby.filter(entity => {
            if (!entity.isValid || entity.id === ai.id) return false;
            const entityFaction = entity.getDynamicProperty(FACTION_PROPERTY);
            return entityFaction === aiFaction;
        });
    } catch (e) {
        return [];
    }
}

// Get faction enemies
export function getFactionalEnemies(ai, maxDistance = 64) {
    if (!ai?.isValid) return [];
    
    const aiFaction = ai.getDynamicProperty(FACTION_PROPERTY);
    if (!aiFaction) return [];
    
    try {
        const nearby = ai.dimension.getEntities({
            type: ai_player_id,
            maxDistance: maxDistance,
            location: ai.location
        });
        
        return nearby.filter(entity => {
            if (!entity.isValid || entity.id === ai.id) return false;
            return isHostileFaction(ai, entity);
        });
    } catch (e) {
        return [];
    }
}

// Start faction system
export function startFactionSystem() {
    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;
        
        for (const player of allPlayers) {
            if (!player.isValid) continue;
            
            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: 128,
                location: player.location
            });
            
            for (const ai of nearbyAI) {
                if (ai.isValid) {
                    // Assign faction if needed
                    if (!ai.getDynamicProperty(FACTION_PROPERTY)) {
                        assignFaction(ai);
                    }
                    
                    // Check for faction conflicts
                    const enemies = getFactionalEnemies(ai, 32);
                    if (enemies.length > 0) {
                        // Mark for combat priority
                        ai.setDynamicProperty("rg:faction_enemies_nearby", enemies.length);
                    }
                }
            }
        }
    }, FACTION_CHECK_GAP);
}

// Get faction display info
export function getFactionInfo(ai) {
    if (!ai?.isValid) return null;
    
    const faction = ai.getDynamicProperty(FACTION_PROPERTY);
    if (!faction) return null;
    
    const config = FACTIONS[faction];
    if (!config) return null;
    
    const subfactionTag = ai.getTags().find(tag => tag.startsWith("subfaction_"));
    const rawSub = subfactionTag ? subfactionTag.replace("subfaction_", "") : "unknown";
    // "netherite_epsilon" reads as a debug string in chat; show "Epsilon"
    const suffix = rawSub.slice(rawSub.lastIndexOf("_") + 1);

    return {
        faction: faction,
        displayName: config.displayName,
        subfaction: suffix.charAt(0).toUpperCase() + suffix.slice(1),
        color: config.color
    };
}
