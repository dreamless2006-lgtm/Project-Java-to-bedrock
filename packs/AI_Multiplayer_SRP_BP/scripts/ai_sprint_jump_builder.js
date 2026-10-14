import { world, system, EntityComponentTypes, BlockPermutation } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { PLAYER } from "./ai_player_physics.js";

const ai_player_id = "rg:bot";
const SPRINT_JUMP_CHECK_GAP = 5; // Check every 0.25 seconds
const SPRINT_PROXIMITY_RADIUS = 32;
const JUMP_COOLDOWN_TICKS = 60; // Cooldown between jumps
const BLOCKS_FOR_JUMP = ["minecraft:oak_planks", "minecraft:birch_planks", "minecraft:spruce_planks", "minecraft:dark_oak_planks", "minecraft:acacia_planks", "minecraft:jungle_planks", "minecraft:stone", "minecraft:cobblestone", "minecraft:dirt"];

// Tag for sprint jumping enabled
const SPRINT_JUMP_TAG = "can_sprint_jump";
const LAST_JUMP_PROPERTY = "rg:last_jump_time";
const HAS_BLOCKS_PROPERTY = "rg:has_blocks_for_jump";

// Check if AI has buildable blocks
function hasBlocksInInventory(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const container = ai.getComponent(EntityComponentTypes.Inventory);
        if (!container || !container.container) return false;
        
        for (let i = 0; i < container.container.size; i++) {
            const item = container.container.getItem(i);
            if (item && BLOCKS_FOR_JUMP.includes(item.typeId)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Place block below AI for landing
function placeBlockBelow(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const container = ai.getComponent(EntityComponentTypes.Inventory);
        if (!container || !container.container) return false;
        
        // Find a buildable block in inventory
        let blockSlot = -1;
        let blockType = null;
        
        for (let i = 0; i < container.container.size; i++) {
            const item = container.container.getItem(i);
            if (item && BLOCKS_FOR_JUMP.includes(item.typeId)) {
                blockSlot = i;
                blockType = item.typeId;
                break;
            }
        }
        
        if (blockSlot === -1) return false;
        
        // Calculate position below AI
        const belowPos = {
            x: Math.floor(ai.location.x),
            y: Math.floor(ai.location.y) - 1,
            z: Math.floor(ai.location.z)
        };
        
        const targetBlock = ai.dimension.getBlock(belowPos);
        if (!targetBlock || targetBlock.typeId === "minecraft:air" || targetBlock.typeId === "minecraft:cave_air") {
            try {
                ai.dimension.setBlockType(belowPos, blockType);
                
                // Remove block from inventory
                const item = container.container.getItem(blockSlot);
                if (item) {
                    item.amount -= 1;
                    if (item.amount > 0) {
                        container.container.setItem(blockSlot, item);
                    } else {
                        container.container.setItem(blockSlot, undefined);
                    }
                }
                
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Apply sprint and jump impulse
function performSprintJump(ai) {
    if (!ai || !ai.isValid) return false;
    
    try {
        const lastJump = ai.getDynamicProperty(LAST_JUMP_PROPERTY) || 0;
        const currentTick = system.currentTick;
        
        // Check cooldown
        if (currentTick - lastJump < JUMP_COOLDOWN_TICKS) {
            return false;
        }
        
        // Add sprinting effect and jump
        ai.addTag("sprinting");
        
        // Apply upward velocity for jump
        const jumpImpulse = PLAYER.JUMP;
        
        // Apply forward momentum (sprint direction)
        const rotation = ai.getRotation();
        const yaw = (rotation.y * Math.PI) / 180;
        // forward on Bedrock is (-sin yaw, cos yaw); with +sin he leapt sideways
        // away from where he was looking
        const dirX = -Math.sin(yaw) * PLAYER.SPRINT;
        const dirZ = Math.cos(yaw) * PLAYER.SPRINT;
        
        ai.applyImpulse({ x: dirX, y: jumpImpulse, z: dirZ });
        
        ai.setDynamicProperty(LAST_JUMP_PROPERTY, currentTick);
        
        // Remove sprinting tag after 1 second
        system.runTimeout(() => {
            if (ai && ai.isValid) {
                ai.removeTag("sprinting");
            }
        }, 20);
        
        return true;
    } catch (e) {
        return false;
    }
}

// Main sprint jump logic
function updateSprintJumpAI(ai) {
    if (!ai || !ai.isValid) return;
    
    // Check if AI has sprint jump enabled
    if (!ai.hasTag(SPRINT_JUMP_TAG)) return;
    
    try {
        // Check if AI has blocks in inventory
        const hasBlocks = hasBlocksInInventory(ai);
        ai.setDynamicProperty(HAS_BLOCKS_PROPERTY, hasBlocks);
        
        // 60% chance per tick to attempt sprint jump if has blocks and in combat
        if (hasBlocks && Math.random() < 0.15) {
            const target = ai.getDynamicProperty("rg:current_target");
            if (target) {
                // Place block below before jumping
                placeBlockBelow(ai);
                
                // Perform sprint jump
                performSprintJump(ai);
            }
        }
    } catch (e) {
        // Silent fail
    }
}

// Start the sprint jump system
export function startSprintJumpSystem() {
    system.runInterval(() => {
        const allPlayers = REAL_PLAYERS_CACHE;
        if (!allPlayers || allPlayers.length === 0) return;
        
        // Find all AI with sprint jump capability
        for (const player of allPlayers) {
            if (!player.isValid) continue;
            
            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: SPRINT_PROXIMITY_RADIUS,
                location: player.location
            });
            
            for (const ai of nearbyAI) {
                if (ai.isValid) {
                    updateSprintJumpAI(ai);
                }
            }
        }
    }, SPRINT_JUMP_CHECK_GAP);
}
