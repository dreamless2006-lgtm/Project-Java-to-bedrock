import { world, system, ItemStack } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { PLAYER, clampLaunch } from "./ai_player_physics.js";
import { requestMove, NAV } from "./ai_navigation.js";
import { getCurrentTarget } from "./ai_combat_tactics.js";

const COMBAT_SOURCE = "combat";

const ai_player_id = "rg:bot";
const RANGED_CHECK_GAP = 10;

// Weapon categories
const MELEE_WEAPONS = [
    "minecraft:netherite_sword",
    "minecraft:diamond_sword",
    "minecraft:netherite_axe",
    "minecraft:diamond_axe"
];

const RANGED_WEAPONS = [
    "minecraft:bow",
    "minecraft:crossbow",
    "minecraft:trident"
];

const COMBO_WEAPON_PAIRS = [
    ["minecraft:netherite_sword", "minecraft:bow"],
    ["minecraft:diamond_axe", "minecraft:crossbow"],
    ["minecraft:diamond_sword", "minecraft:trident"]
];

// Combat combination types
const COMBAT_COMBOS = {
    "charge_attack": {
        name: "Charge Attack",
        cooldown: 40,
        description: "Sprint forward with sword slam"
    },
    "vault_attack": {
        name: "Vault Attack",
        cooldown: 60,
        description: "Jump and slam from above"
    },
    "spin_attack": {
        name: "Spin Attack",
        cooldown: 30,
        description: "Rapid spin with axe"
    },
    "trident_throw": {
        name: "Trident Throw",
        cooldown: 50,
        description: "Throw trident with riptide"
    },
    "bow_burst": {
        name: "Bow Burst",
        cooldown: 35,
        description: "Rapid bow shots"
    },
    "crossbow_volley": {
        name: "Crossbow Volley",
        cooldown: 45,
        description: "Multishot crossbow burst"
    },
    "mace_ground_slam": {
        name: "Mace Ground Slam",
        cooldown: 50,
        description: "Jump and slam ground with mace"
    }
};

// Execute melee charge attack
export function performChargeAttack(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_charge_attack") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.charge_attack.cooldown) {
            return false;
        }
        
        // Sprint towards target
        ai.addTag("sprinting");
        
        const dx = target.location.x - ai.location.x;
        const dz = target.location.z - ai.location.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > 0) {
            requestMove(ai, target.location, { priority: NAV.COMBAT, source: COMBAT_SOURCE, mode: "sprint" });
        }
        
        ai.setDynamicProperty("rg:last_charge_attack", system.currentTick);
        
        system.runTimeout(() => {
            if (ai?.isValid) ai.removeTag("sprinting");
        }, 20);
        
        return true;
    } catch (e) {
        return false;
    }
}

// Execute vault/jump attack
export function performVaultAttack(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_vault_attack") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.vault_attack.cooldown) {
            return false;
        }
        
        // Jump up and over target
        const dx = target.location.x - ai.location.x;
        const dz = target.location.z - ai.location.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 0) {
            ai.clearVelocity();
            ai.applyImpulse(clampLaunch({ x: (dx / distance) * PLAYER.SPRINT, y: PLAYER.JUMP, z: (dz / distance) * PLAYER.SPRINT }));
        }
        
        // Apply damage after landing
        system.runTimeout(() => {
            if (ai?.isValid && target?.isValid) {
                try {
                    target.applyDamage(8, {
                        cause: "entityAttack",
                        damagingEntity: ai
                    });
                } catch (e) { console.warn(e, e.stack); }
            }
        }, 15);
        
        ai.setDynamicProperty("rg:last_vault_attack", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Execute spin attack (rapid axe swings)
export function performSpinAttack(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_spin_attack") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.spin_attack.cooldown) {
            return false;
        }
        
        // Rapid rotation and damage
        const numHits = 3;
        for (let i = 0; i < numHits; i++) {
            system.runTimeout(() => {
                if (ai?.isValid && target?.isValid) {
                    try {
                        target.applyDamage(4, {
                            cause: "entityAttack",
                            damagingEntity: ai
                        });
                        ai.runCommand("playsound item.axe.scrape @a[r=16]");
                    } catch (e) { console.warn(e, e.stack); }
                }
            }, i * 5);
        }
        
        ai.setDynamicProperty("rg:last_spin_attack", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Throw trident with riptide
export function performTridentThrow(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_trident_throw") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.trident_throw.cooldown) {
            return false;
        }
        
        // Throw trident in target direction
        const dx = target.location.x - ai.location.x;
        const dz = target.location.z - ai.location.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > 0) {
            // Spawn projectile
            try {
                const spawnPos = { x: ai.location.x, y: ai.location.y + 1.5, z: ai.location.z };
                const trident = ai.dimension.spawnEntity("minecraft:thrown_trident", spawnPos);
                if (trident && trident.isValid) {
                    const impulse = {
                        x: (dx / distance) * 2.0,
                        y: ((target.location.y - ai.location.y) / distance) * 2.0 + 0.2,
                        z: (dz / distance) * 2.0
                    };
                    trident.applyImpulse(impulse);
                }
            } catch (e) { console.warn(e, e.stack); }
        }
        
        ai.setDynamicProperty("rg:last_trident_throw", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Rapid bow shots
export function performBowBurst(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_bow_burst") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.bow_burst.cooldown) {
            return false;
        }
        
        // Multiple quick shots
        const numShots = 3;
        for (let i = 0; i < numShots; i++) {
            system.runTimeout(() => {
                if (ai?.isValid && target?.isValid) {
                    try {
                        const spawnPos = { x: ai.location.x, y: ai.location.y + 1.5, z: ai.location.z };
                        const arrow = ai.dimension.spawnEntity("minecraft:arrow", spawnPos);
                        if (arrow && arrow.isValid) {
                            const dx = target.location.x - ai.location.x;
                            const dy = target.location.y - ai.location.y;
                            const dz = target.location.z - ai.location.z;
                            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                            arrow.applyImpulse({
                                x: (dx / dist) * 2.5,
                                y: (dy / dist) * 2.5 + 0.1,
                                z: (dz / dist) * 2.5
                            });
                        }
                    } catch (e) { console.warn(e, e.stack); }
                }
            }, i * 8);
        }
        
        ai.setDynamicProperty("rg:last_bow_burst", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Crossbow multishot
export function performCrossbowVolley(ai, target) {
    if (!ai?.isValid || !target?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_crossbow_volley") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.crossbow_volley.cooldown) {
            return false;
        }
        
        // Multishot pattern
        const numArrows = 4;
        for (let i = 0; i < numArrows; i++) {
            system.runTimeout(() => {
                if (ai?.isValid && target?.isValid) {
                    try {
                        const spawnPos = { x: ai.location.x, y: ai.location.y + 1.5, z: ai.location.z };
                        const arrow = ai.dimension.spawnEntity("minecraft:arrow", spawnPos);
                        if (arrow && arrow.isValid) {
                            const dx = target.location.x - ai.location.x;
                            const dy = target.location.y - ai.location.y;
                            const dz = target.location.z - ai.location.z;
                            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                            const spread = (i - 1.5) * 0.15;
                            arrow.applyImpulse({
                                x: (dx / dist) * 2.8 + spread,
                                y: (dy / dist) * 2.8 + 0.05,
                                z: (dz / dist) * 2.8 + spread
                            });
                        }
                    } catch (e) { console.warn(e, e.stack); }
                }
            }, i * 6);
        }
        
        ai.setDynamicProperty("rg:last_crossbow_volley", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Mace ground slam
export function performMaceGroundSlam(ai) {
    if (!ai?.isValid) return false;
    
    try {
        const lastUse = ai.getDynamicProperty("rg:last_mace_slam") || 0;
        if (system.currentTick - lastUse < COMBAT_COMBOS.mace_ground_slam.cooldown) {
            return false;
        }
        
        // Jump and slam
        const current = ai.getVelocity();
        ai.clearVelocity();
        ai.applyImpulse({ x: current.x, y: PLAYER.JUMP, z: current.z });
        
        // Damage radius on landing
        system.runTimeout(() => {
            if (ai?.isValid) {
                try {
                    const nearby = ai.dimension.getEntities({
                        maxDistance: 6,
                        location: ai.location,
                        excludeTypes: [ai_player_id],
                        excludeFamilies: ["player"]
                    });
                    
                    for (const entity of nearby) {
                        if (entity.isValid) {
                            entity.applyDamage(12, {
                                cause: "entityAttack",
                                damagingEntity: ai
                            });
                        }
                    }
                    
                    ai.runCommand("playsound entity.dragon.hurt @a[r=24]");
                } catch (e) { console.warn(e, e.stack); }
            }
        }, 12);
        
        ai.setDynamicProperty("rg:last_mace_slam", system.currentTick);
        return true;
    } catch (e) {
        return false;
    }
}

// Start advanced combat system
export function startAdvancedCombatSystem() {
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
                    
                    // Choose combat combo based on distance and random chance
                    const random = Math.random();
                    
                    if (distance < 5) {
                        // Melee range
                        if (random < 0.25) performChargeAttack(ai, targetEntity);
                        else if (random < 0.50) performVaultAttack(ai, targetEntity);
                        else if (random < 0.65) performSpinAttack(ai, targetEntity);
                        else if (random < 0.80) performSpinAttack(ai, targetEntity);
                    } else if (distance < 16) {
                        // Ranged distance
                        if (random < 0.30) performBowBurst(ai, targetEntity);
                        else if (random < 0.60) performCrossbowVolley(ai, targetEntity);
                        else if (random < 0.85) performTridentThrow(ai, targetEntity);
                    }
                } catch (e) { console.warn(e, e.stack); }
            }
        }
    }, RANGED_CHECK_GAP);

    // The chase itself. Combos only lunged once per cooldown, which left the
    // authority intent dead between lunges and the engine melee goal carried
    // him at a plod; this re-requests a sprint at the target every few ticks
    // so he genuinely runs after whoever he is fighting.
    system.runInterval(() => {
        for (const player of REAL_PLAYERS_CACHE || []) {
            if (!player.isValid) continue;
            try {
                const nearby = player.dimension.getEntities({
                    type: ai_player_id,
                    maxDistance: 64,
                    location: player.location
                });

                for (const ai of nearby) {
                    if (!ai.isValid || ai.isInWater) continue;
                    const target = getCurrentTarget(ai);
                    if (!target) continue;

                    const dist = Math.hypot(
                        ai.location.x - target.location.x,
                        ai.location.z - target.location.z
                    );
                    if (dist < 2.2) continue;   // the engine's own melee handles the swing

                    requestMove(ai, target.location, {
                        priority: NAV.COMBAT,
                        source: COMBAT_SOURCE,
                        mode: "sprint",
                        ttl: 8
                    });
                }
            } catch (e) { /* one bot must not stop the rest */ }
        }
    }, 5);
}


