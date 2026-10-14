import { world, system, EntityComponentTypes } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { PLAYER, clampLaunch } from "./ai_player_physics.js";

const ai_player_id = "rg:bot";
const ENDER_PEARL_COOLDOWN = 40; // 2 seconds
const WATER_LADDER_COOLDOWN = 20;
const BRIDGE_COOLDOWN = 15;
const WIND_BURST_COOLDOWN = 60;

// Ender Pearl teleportation - escape or chase
export function useEnderPearl(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_ender_pearl") || 0;
        if (system.currentTick - lastUse < ENDER_PEARL_COOLDOWN) return false;
        
        const targetId = ai.getDynamicProperty("rg:current_target");
        let target = null;
        if (targetId) {
            try {
                const found = world.getEntity(targetId);
                if (found && found.isValid) target = found;
            } catch (e) { target = null; }
        }
        const inventory = ai.getComponent(EntityComponentTypes.Inventory)?.container;
        
        if (!inventory) return false;
        
        // Find ender pearl in inventory
        let pearlSlot = -1;
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item && item.typeId === "minecraft:ender_pearl") {
                pearlSlot = i;
                break;
            }
        }
        
        if (pearlSlot === -1) return false;
        
        // Determine teleport location
        let teleportPos = null;
        
        if (target) {
            // If fleeing (low health), teleport away
            const health = ai.getComponent(EntityComponentTypes.Health);
            const healthPercent = health ? health.currentValue / (health.effectiveMax || 20) : 1;
            
            if (healthPercent < 0.4) {
                // Teleport away from target
                const dx = ai.location.x - target.location.x;
                const dz = ai.location.z - target.location.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                if (distance === 0) return false;
                const normalizedDx = (dx / distance) * 15;
                const normalizedDz = (dz / distance) * 15;
                
                teleportPos = {
                    x: ai.location.x + normalizedDx,
                    y: ai.location.y + 5,
                    z: ai.location.z + normalizedDz
                };
            } else {
                // Teleport towards target for attack
                const dx = target.location.x - ai.location.x;
                const dz = target.location.z - ai.location.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance > 0) {
                    const normalizedDx = (dx / distance) * 12;
                    const normalizedDz = (dz / distance) * 12;
                    
                    teleportPos = {
                        x: ai.location.x + normalizedDx,
                        y: target.location.y,
                        z: ai.location.z + normalizedDz
                    };
                }
            }
        } else {
            // No target, random teleport
            const angle = Math.random() * Math.PI * 2;
            const distance = 12;
            teleportPos = {
                x: ai.location.x + Math.cos(angle) * distance,
                y: ai.location.y,
                z: ai.location.z + Math.sin(angle) * distance
            };
        }
        
        if (teleportPos) {
            // Use ender pearl
            const item = inventory.getItem(pearlSlot);
            item.amount -= 1;
            if (item.amount > 0) {
                inventory.setItem(pearlSlot, item);
            } else {
                inventory.setItem(pearlSlot, undefined);
            }
            
            // Teleport
            ai.teleport(teleportPos);
            ai.setDynamicProperty("rg:last_ender_pearl", system.currentTick);
            
            // Play effect
            try {
                ai.runCommand("playsound entity.endermen.teleport @a[r=24]");
            } catch (e) { console.warn(e, e.stack); }
            
            return true;
        }
        
        return false;
    } catch (e) {
        return false;
    }
}

// Water ladder climbing - place water and ladder for vertical movement
export function useWaterLadder(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_water_ladder") || 0;
        if (system.currentTick - lastUse < WATER_LADDER_COOLDOWN) return false;
        
        const inventory = ai.getComponent(EntityComponentTypes.Inventory)?.container;
        if (!inventory) return false;
        
        // Find water bucket and ladder
        let waterSlot = -1;
        let ladderSlot = -1;
        
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (!item) continue;
            
            if (item.typeId === "minecraft:water_bucket" && waterSlot === -1) {
                waterSlot = i;
            }
            if (item.typeId === "minecraft:ladder" && ladderSlot === -1) {
                ladderSlot = i;
            }
        }
        
        if (waterSlot === -1 || ladderSlot === -1) return false;
        
        // Check if there's a wall or cliff to climb
        const location = ai.location;
        const upPos = {
            x: Math.floor(location.x),
            y: Math.floor(location.y) + 1,
            z: Math.floor(location.z)
        };
        
        const upBlock = ai.dimension.getBlock(upPos);
        if (!upBlock || (upBlock.typeId !== "minecraft:air" && upBlock.typeId !== "minecraft:cave_air")) {
            return false;
        }
        
        // Place ladder
        try {
            ai.dimension.setBlockType(upPos, "minecraft:ladder");
            ai.setDynamicProperty("rg:last_water_ladder", system.currentTick);
            
            // Consume ladder
            const ladderItem = inventory.getItem(ladderSlot);
            ladderItem.amount -= 1;
            if (ladderItem.amount > 0) {
                inventory.setItem(ladderSlot, ladderItem);
            } else {
                inventory.setItem(ladderSlot, undefined);
            }
            
            return true;
        } catch (e) {
            return false;
        }
    } catch (e) {
        return false;
    }
}

// Build bridges - place blocks below for traversal
export function buildBridge(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_bridge_build") || 0;
        if (system.currentTick - lastUse < BRIDGE_COOLDOWN) return false;
        
        const inventory = ai.getComponent(EntityComponentTypes.Inventory)?.container;
        if (!inventory) return false;
        
        // Find building blocks
        const buildBlocks = ["minecraft:oak_planks", "minecraft:cobblestone", "minecraft:stone", "minecraft:dark_oak_planks"];
        let blockSlot = -1;
        
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item && buildBlocks.includes(item.typeId)) {
                blockSlot = i;
                break;
            }
        }
        
        if (blockSlot === -1) return false;
        
        // Place block in front at same level
        const rotation = ai.getRotation();
        const yaw = (rotation.y * Math.PI) / 180;
        // forward on Bedrock is (-sin yaw, cos yaw); +sin mirrored the spot
        const dirX = -Math.sin(yaw);
        const dirZ = Math.cos(yaw);
        
        const placePos = {
            x: Math.floor(ai.location.x + dirX * 1.5),
            y: Math.floor(ai.location.y - 1),
            z: Math.floor(ai.location.z + dirZ * 1.5)
        };
        
        const targetBlock = ai.dimension.getBlock(placePos);
        if (targetBlock && (targetBlock.typeId === "minecraft:air" || targetBlock.typeId === "minecraft:cave_air")) {
            const item = inventory.getItem(blockSlot);
            ai.dimension.setBlockType(placePos, item.typeId);
            
            item.amount -= 1;
            if (item.amount > 0) {
                inventory.setItem(blockSlot, item);
            } else {
                inventory.setItem(blockSlot, undefined);
            }
            
            ai.setDynamicProperty("rg:last_bridge_build", system.currentTick);
            return true;
        }
        
        return false;
    } catch (e) {
        return false;
    }
}

// Wind burst - knockback effect (simulated)
export function useWindBurst(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_wind_burst") || 0;
        if (system.currentTick - lastUse < WIND_BURST_COOLDOWN) return false;
        
        // Calculate direction away from AI
        const dx = target.location.x - ai.location.x;
        const dz = target.location.z - ai.location.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance === 0) return false;
        
        // Apply knockback velocity
        const knockbackStrength = 2.5;
        target.applyImpulse(clampLaunch({
            x: (dx / distance) * knockbackStrength,
            y: PLAYER.JUMP,
            z: (dz / distance) * knockbackStrength
        }));
        
        // Apply slowness to target as balance
        try {
            target.runCommand("effect @s slowness 2 1 true");
        } catch (e) { console.warn(e, e.stack); }
        
        ai.setDynamicProperty("rg:last_wind_burst", system.currentTick);
        
        try {
            ai.runCommand("playsound item.trident.riptide.1 @a[r=16]");
        } catch (e) { console.warn(e, e.stack); }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Start advanced combat utilities
export function startAdvancedCombatUtilities() {
    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;
        
        for (const player of allPlayers) {
            if (!player.isValid) continue;
            
            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: 64,
                location: player.location
            });
            
            for (const ai of nearbyAI) {
                if (!ai.isValid) continue;
                
                const target = ai.getDynamicProperty("rg:current_target");
                if (!target) continue;
                
                try {
                    const targetEntity = world.getEntity(target);
                    if (!targetEntity || !targetEntity.isValid) continue;
                    
                    const distance = Math.hypot(
                        ai.location.x - targetEntity.location.x,
                        ai.location.z - targetEntity.location.z
                    );
                    
                    // 20% chance to use wind burst
                    if (distance < 8 && Math.random() < 0.20) {
                        useWindBurst(ai, targetEntity);
                    }
                    
                    // 15% chance to use ender pearl when fleeing
                    if (distance < 12 && Math.random() < 0.15) {
                        useEnderPearl(ai);
                    }
                    
                    // 10% chance to build bridge
                    if (Math.random() < 0.10) {
                        buildBridge(ai);
                    }
                    
                    // 8% chance to use water ladder
                    if (Math.random() < 0.08) {
                        useWaterLadder(ai);
                    }
                } catch (e) { console.warn(e, e.stack); }
            }
        }
    }, 10);
}


