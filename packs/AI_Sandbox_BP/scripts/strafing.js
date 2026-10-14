import { world, system, EntityDamageCause, EntityHealthComponent,  EntityEquippableComponent, EntityComponentTypes, ItemStack, EquipmentSlot, Player, Container, EntityInventoryComponent, EffectType } from "@minecraft/server";

import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { requestMove } from "./ai_navigation.js";

const ai_player_id = "rg:bot"; 
const BUILD_aim_ENTITY_ID = "rg:build_target";

// --- Strafing Logic Configuration ---
const STRAFE_THINK_GAP_SECONDS = 0.1;
const STRAFE_TTL_TICKS = 22;   // one smooth sidestep through the authority
const STRAFE_STEP_LENGTH = 2.5;
const STRAFE_PRIORITY = 52;    // above the plain chase so the dodge wins its moment

// --- Activation and Performance Configuration ---
const PROXIMITY_RADIUS = 32; 
const AI_ACTIVATION_GAP = 30; 

const strafeStates = new Map();

// The old version shoved the bot sideways with raw impulses in 5-9 steps of
// 3 ticks, fighting the chase every cycle - the combat shiver. Now the dodge
// is one movement request, so the authority actuates it like any other move.
function initiateStrafe(ai) {
    if (!strafeStates.has(ai.id)) {
        strafeStates.set(ai.id, { isStrafing: false });
    }
    const state = strafeStates.get(ai.id);

    if (state.isStrafing || !ai.isOnGround || ai.isInWater || ai.isFalling) {
        return;
    }

    const targetId = ai.getDynamicProperty("rg:current_target");
    if (targetId && targetId === BUILD_aim_ENTITY_ID) {
        return;
    }

    state.isStrafing = true;

    system.runTimeout(() => {
        if (
            !ai.isValid ||
            !ai.getDynamicProperty("rg:current_target") ||
            !ai.isOnGround ||
            ai.isInWater ||
            ai.isFalling
        ) {
            state.isStrafing = false;
            return;
        }

        const side = Math.random() < 0.5 ? 1 : -1;
        let view = null;
        try {
            view = ai.getViewDirection();
        } catch (e) { view = null; }
        if (!view) view = { x: 0, z: 1 };

        requestMove(ai, {
            x: ai.location.x - view.z * side * STRAFE_STEP_LENGTH,
            y: ai.location.y,
            z: ai.location.z + view.x * side * STRAFE_STEP_LENGTH
        }, {
            priority: STRAFE_PRIORITY,
            source: "strafe",
            mode: "sprint",
            ttl: STRAFE_TTL_TICKS
        });

        state.isStrafing = false;
    }, (STRAFE_THINK_GAP_SECONDS * 20) | 0);
}

export function startStrafingBehavior() {
    
    system.runInterval(() => {
        
        const activeAIinCombat = new Set();
        
        // 【Core Optimization】Use global cache REAL_PLAYERS_CACHE to replace expensive world.getAllPlayers()
        // Assuming REAL_PLAYERS_CACHE has been obtained from rgstart.js and is available.
        const allPlayers = REAL_PLAYERS_CACHE; 
        
        // If the cache is not startd or there are no players, exit early
        if (!allPlayers || allPlayers.length === 0) {
            return;
        }

        // 1. Iterate through all players, query nearby AI
        for (const player of allPlayers) {
            
            // 【Code Unchanged】Entity query is a necessary API overhead that cannot be optimized
            const nearbyAI = player.dimension.getEntities({
                type: ai_player_id,
                maxDistance: PROXIMITY_RADIUS, 
                location: player.location
            });

            // 2. Add nearby AI with targets to the Set
            for (const ai of nearbyAI) {
                if (ai.isValid && ai.getDynamicProperty("rg:current_target")) { 
                    activeAIinCombat.add(ai);
                }
            }
        }
        
        // 3. Run strafe logic for all activated AI
        for (const ai of activeAIinCombat) {
            initiateStrafe(ai);
        }

        // 4. Cleanup logic
        // Unchanged, this is the idiomatic efficient way of Map cleanup
        const currentAiIds = new Set(Array.from(activeAIinCombat).map(ai => ai.id));
        for (const storedId of strafeStates.keys()) {
            if (!currentAiIds.has(storedId)) {
                strafeStates.delete(storedId);
            }
        }

    }, AI_ACTIVATION_GAP); 
}