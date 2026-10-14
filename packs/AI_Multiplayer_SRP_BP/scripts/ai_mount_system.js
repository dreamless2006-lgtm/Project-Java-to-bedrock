import { world, system, EntityComponentTypes } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";

const ai_player_id = "rg:bot";
const MOUNT_CHECK_GAP = 40; // Check every 2 seconds
const MOUNT_SEARCH_RADIUS = 32;
const HORSE_BREEDS = ["minecraft:horse", "minecraft:donkey", "minecraft:mule"];
const CAMEL_TYPE = "minecraft:camel";
const GHAST_TYPE = "minecraft:ghast";

// Tags
const MOUNTED_TAG = "is_mounted";
const MOUNTING_TAG = "is_mounting";

// Try to mount nearby horse
export function tryMountHorse(ai) {
    if (!ai || !ai.isValid || ai.hasTag(MOUNTED_TAG)) return false;
    
    try {
        // Search for nearby horses
        const nearby = ai.dimension.getEntities({
            type: HORSE_BREEDS,
            location: ai.location,
            maxDistance: 8
        });
        
        if (nearby.length === 0) return false;
        
        const horse = nearby[0];
        if (!horse.isValid) return false;
        
        // Attempt to ride
        ai.runCommand(`ride @s start_riding @e[type=${horse.typeId},c=1,r=8]`);
        ai.addTag(MOUNTED_TAG);
        
        // Give horse speed boost
        try {
            horse.addEffect('speed', 20, { amplifier: 2, showParticles: false });
        } catch (e) { console.warn(e, e.stack); }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Try to mount nearby camel
export function tryMountCamel(ai) {
    if (!ai || !ai.isValid || ai.hasTag(MOUNTED_TAG)) return false;
    
    try {
        // Search for nearby camels
        const nearby = ai.dimension.getEntities({
            type: CAMEL_TYPE,
            location: ai.location,
            maxDistance: 8
        });
        
        if (nearby.length === 0) return false;
        
        const camel = nearby[0];
        if (!camel.isValid) return false;
        
        // Attempt to ride
        ai.runCommand(`ride @s start_riding @e[type=${CAMEL_TYPE},c=1,r=8]`);
        ai.addTag(MOUNTED_TAG);
        
        // Give camel speed
        try {
            camel.addEffect('speed', 20, { amplifier: 1, showParticles: false });
        } catch (e) { console.warn(e, e.stack); }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Tame/befriend a ghast for riding
export function tryTameGhast(ai) {
    if (!ai || !ai.isValid || ai.hasTag(MOUNTED_TAG)) return false;
    
    try {
        const nearby = ai.dimension.getEntities({
            type: GHAST_TYPE,
            location: ai.location,
            maxDistance: 12
        });
        
        if (nearby.length === 0) return false;
        
        const ghast = nearby[0];
        if (!ghast.isValid) return false;
        
        // Give ghast alliance tag and ride it
        ghast.addTag(`tamed_by_${ai.id}`);
        ai.addTag(MOUNTED_TAG);
        
        // Make ghast friendly to AI's faction
        const faction = ai.getDynamicProperty("rg:faction");
        if (faction) {
            ghast.addTag(`faction_ally_${faction}`);
        }
        
        // Ride the ghast
        ai.runCommand(`ride @s start_riding @e[type=${GHAST_TYPE},c=1,r=12]`);
        
        // Apply effects to make ghast stronger
        try {
            ghast.addEffect('strength', 20, { amplifier: 1, showParticles: false });
            ghast.addEffect('resistance', 20, { amplifier: 1, showParticles: false });
        } catch (e) { console.warn(e, e.stack); }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Dismount from current mount
export function dismount(ai) {
    if (!ai || !ai.isValid || !ai.hasTag(MOUNTED_TAG)) return false;
    
    try {
        ai.runCommand("ride @s stop_riding");
        ai.removeTag(MOUNTED_TAG);
        return true;
    } catch (e) {
        return false;
    }
}

// Check if AI should stay mounted or dismount
export function shouldStayMounted(ai, target) {
    if (!ai?.isValid || !target?.isValid) return true;
    
    const distance = Math.hypot(
        ai.location.x - target.location.x,
        ai.location.z - target.location.z
    );
    
    // Dismount if very close to target (need melee range)
    if (distance < 3) return false;
    
    // Stay mounted for mobility
    return true;
}

// Mount system main loop
export function startMountSystem() {
    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;
        
        for (const player of allPlayers) {
            if (!player.isValid) continue;
            
            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: MOUNT_SEARCH_RADIUS,
                location: player.location
            });
            
            for (const ai of nearbyAI) {
                if (!ai.isValid) continue;
                
                const hasTarget = !!ai.getDynamicProperty("rg:current_target");
                const isMounted = ai.hasTag(MOUNTED_TAG);
                
                // If in combat and not mounted, try to mount for mobility
                if (hasTarget && !isMounted && Math.random() < 0.3) {
                    // 60% horses, 30% camels, 10% ghasts
                    const random = Math.random();
                    if (random < 0.60) {
                        tryMountHorse(ai);
                    } else if (random < 0.90) {
                        tryMountCamel(ai);
                    } else {
                        tryTameGhast(ai);
                    }
                }
                
                // Check if should dismount
                if (isMounted && hasTarget) {
                    try {
                        const targetEntity = world.getEntity(ai.getDynamicProperty("rg:current_target"));
                        if (targetEntity && targetEntity.isValid) {
                            if (!shouldStayMounted(ai, targetEntity)) {
                                dismount(ai);
                            }
                        }
                    } catch (e) { console.warn(e, e.stack); }
                }
                
                // Dismount after 30 seconds on mount
                if (isMounted) {
                    const mountTime = ai.getDynamicProperty("rg:mount_time") || system.currentTick;
                    if (system.currentTick - mountTime > 600) { // 30 seconds
                        dismount(ai);
                        ai.setDynamicProperty("rg:mount_time", null);
                    }
                }
            }
        }
    }, MOUNT_CHECK_GAP);
}

// Track when AI mounts
export function onAIMounted(ai) {
    if (!ai || !ai.isValid) return;
    ai.setDynamicProperty("rg:mount_time", system.currentTick);
}


