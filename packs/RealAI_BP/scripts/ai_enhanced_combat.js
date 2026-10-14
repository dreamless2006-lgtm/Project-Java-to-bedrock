import { world, system, EntityComponentTypes, ItemStack, EquipmentSlot } from "@minecraft/server";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { ALL_AI_CACHE } from "./greeting.js";
import { getCurrentTarget, hasValidTarget, clearAITarget } from "./ai_combat_tactics.js";
import { clampLaunch } from "./ai_player_physics.js";

// ====================================================================
// CONSTANTS
// ====================================================================
const ai_player_id = "rg:bot";
const TICK_INTERVAL = 15;
const PROXIMITY_RADIUS = 48;

// Weapon tiers mapped to bot equipment tags
const WEAPON_TIERS = {
    wooden: { sword: "minecraft:wooden_sword", axe: "minecraft:wooden_axe" },
    stone: { sword: "minecraft:stone_sword", axe: "minecraft:stone_axe" },
    copper: { sword: "minecraft:copper_sword", axe: "minecraft:copper_axe" },
    iron: { sword: "minecraft:iron_sword", axe: "minecraft:iron_axe" },
    diamond: { sword: "minecraft:diamond_sword", axe: "minecraft:diamond_axe" },
    diamond_pro: { sword: "minecraft:netherite_sword", axe: "minecraft:netherite_axe" }
};

const TIER_TAGS = ["diamond_pro", "diamond", "iron", "copper", "stone", "wooden"];

// Special weapons pool for high-tier bots
const SPECIAL_WEAPONS = [
    "minecraft:trident",
    "minecraft:crossbow"
];

const RANGED_WEAPONS = ["minecraft:bow", "minecraft:crossbow", "minecraft:trident"];
const FLYING_ENEMIES = ["minecraft:ghast", "minecraft:phantom", "minecraft:blaze", "minecraft:ender_dragon"];

// Cooldown maps
const comboCooldowns = new Map();
const enderPearlCooldowns = new Map();
const windBurstCooldowns = new Map();
const mlgCooldowns = new Map();
const weaponSwitchCooldowns = new Map();

// ====================================================================
// UTILITY
// ====================================================================

function dist3D(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2D(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function directionTo(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) return { x: 0, z: 0 };
    return { x: dx / len, z: dz / len };
}

function onCooldown(map, id, cooldownTicks) {
    const last = map.get(id) || 0;
    return system.currentTick - last < cooldownTicks;
}

function setCooldown(map, id) {
    map.set(id, system.currentTick);
}

function getAITier(ai) {
    for (const tag of TIER_TAGS) {
        if (ai.hasTag(tag)) return tag;
    }
    return "wooden";
}

function getHealthPercent(ai) {
    try {
        const hp = ai.getComponent(EntityComponentTypes.Health);
        if (!hp) return 1;
        return hp.currentValue / hp.effectiveMax;
    } catch { return 1; }
}

function isSafeBlockToReplace(block) {
    if (!block) return false;
    const safeBlocks = ["minecraft:air", "minecraft:cave_air", "minecraft:void_air",
        "minecraft:water", "minecraft:flowing_water",
        "minecraft:grass", "minecraft:tallgrass", "minecraft:double_plant",
        "minecraft:red_flower", "minecraft:yellow_flower", "minecraft:snow_layer",
        "minecraft:vine", "minecraft:waterlily", "minecraft:seagrass"];
    return safeBlocks.includes(block.typeId) || block.isAir;
}

function isSolidBlock(block) {
    if (!block) return false;
    const nonSolid = ["minecraft:air", "minecraft:cave_air", "minecraft:void_air",
        "minecraft:water", "minecraft:flowing_water", "minecraft:lava",
        "minecraft:grass", "minecraft:tallgrass", "minecraft:double_plant",
        "minecraft:red_flower", "minecraft:yellow_flower", "minecraft:snow_layer",
        "minecraft:vine", "minecraft:waterlily", "minecraft:seagrass"];
    return !nonSolid.includes(block.typeId);
}

// ====================================================================
// 1. SMART WEAPON SWITCHING (melee vs ranged vs special)
// ====================================================================
function handleWeaponSwitch(ai, target) {
    if (onCooldown(weaponSwitchCooldowns, ai.id, 30)) return;

    const equippable = ai.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;

    const distance = dist3D(ai.location, target.location);
    const heightDiff = target.location.y - ai.location.y;
    const tier = getAITier(ai);
    const weapons = WEAPON_TIERS[tier];
    if (!weapons) return;

    try {
        const currentItem = equippable.getEquipment(EquipmentSlot.Mainhand);
        const currentId = currentItem?.typeId || "";

        // Flying or elevated targets → ranged
        const needsRanged = FLYING_ENEMIES.includes(target.typeId) || heightDiff > 5 || distance > 20;

        // High tier bots sometimes use special weapons
        const isHighTier = tier === "diamond" || tier === "diamond_pro";
        const healthPercent = getHealthPercent(ai);

        if (needsRanged) {
            // Use crossbow for high tier, bow for others
            const rangedWeapon = isHighTier ? "minecraft:crossbow" : "minecraft:bow";
            if (currentId !== rangedWeapon) {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(rangedWeapon, 1));
                setCooldown(weaponSwitchCooldowns, ai.id);
            }
        } else if (distance < 4) {
            // Very close range: prefer axe for more damage
            if (isHighTier && healthPercent < 0.4 && Math.random() < 0.3) {
                // Desperate: try mace or special weapon
                const special = SPECIAL_WEAPONS[(Math.random() * SPECIAL_WEAPONS.length) | 0];
                if (currentId !== special) {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(special, 1));
                    setCooldown(weaponSwitchCooldowns, ai.id);
                }
            } else {
                // Normal close: 60% sword for speed, 40% axe for damage
                const useSword = Math.random() < 0.6;
                const weapon = useSword ? weapons.sword : weapons.axe;
                if (currentId !== weapon) {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(weapon, 1));
                    setCooldown(weaponSwitchCooldowns, ai.id);
                }
            }
        } else if (distance >= 4 && distance <= 12) {
            // Medium range: sword primary
            if (isHighTier && Math.random() < 0.25 && currentId !== "minecraft:trident") {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack("minecraft:trident", 1));
                setCooldown(weaponSwitchCooldowns, ai.id);
            } else if (currentId !== weapons.sword) {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(weapons.sword, 1));
                setCooldown(weaponSwitchCooldowns, ai.id);
            }
        } else if (distance > 12 && distance <= 20) {
            // Far medium: ranged + melee
            if (isHighTier && Math.random() < 0.4) {
                const rangedWeapon = "minecraft:crossbow";
                if (currentId !== rangedWeapon) {
                    equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(rangedWeapon, 1));
                    setCooldown(weaponSwitchCooldowns, ai.id);
                }
            } else if (currentId !== weapons.sword) {
                equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(weapons.sword, 1));
                setCooldown(weaponSwitchCooldowns, ai.id);
            }
        }
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// 2. COMBAT COMBOS (sprint attack, crit jump, leap strike)
// ====================================================================
function handleCombatCombo(ai, target) {
    if (onCooldown(comboCooldowns, ai.id, 40)) return;

    const distance = dist2D(ai.location, target.location);
    if (distance > 8 || distance < 0.5) return;
    if (!ai.isOnGround) return;

    const tier = getAITier(ai);
    const isHighTier = tier === "diamond" || tier === "diamond_pro";
    const comboChance = isHighTier ? 0.5 : 0.25;  // More aggressive

    if (Math.random() > comboChance) return;

    const dir = directionTo(ai.location, target.location);
    const comboRoll = Math.random();
    const healthPercent = getHealthPercent(ai);

    try {
        if (comboRoll < 0.3) {
            // Sprint Attack: aggressive dash forward
            ai.applyImpulse(clampLaunch({ x: dir.x * 0.8, y: 0.15, z: dir.z * 0.8 }));
        } else if (comboRoll < 0.55) {
            // Critical Jump: jump attack for crit damage
            ai.applyImpulse(clampLaunch({ x: dir.x * 0.4, y: 0.55, z: dir.z * 0.4 }));
            ai.addTag("in_combat_jump");
            system.runTimeout(() => {
                if (ai.isValid) ai.removeTag("in_combat_jump");
            }, 12);
        } else if (comboRoll < 0.75) {
            // Leap Strike: powerful forward leap
            ai.applyImpulse(clampLaunch({ x: dir.x * 1.0, y: 0.5, z: dir.z * 1.0 }));
        } else if (comboRoll < 0.9) {
            // Strafe Dodge: circle strafe around target
            const sideX = -dir.z;
            const sideZ = dir.x;
            const side = Math.random() < 0.5 ? 1 : -1;
            ai.applyImpulse(clampLaunch({ x: sideX * side * 0.6, y: 0.1, z: sideZ * side * 0.6 }));
        } else {
            // Backpedal if low health - create distance
            if (healthPercent < 0.3) {
                ai.applyImpulse(clampLaunch({ x: -dir.x * 0.7, y: 0.2, z: -dir.z * 0.7 }));
            }
        }
        setCooldown(comboCooldowns, ai.id);
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// 3. ENDER PEARL USAGE
// ====================================================================
function handleEnderPearl(ai, target) {
    if (onCooldown(enderPearlCooldowns, ai.id, 250)) return;  // Reduced from 400 to 250 ticks

    const tier = getAITier(ai);
    if (tier !== "diamond" && tier !== "diamond_pro" && tier !== "iron") return;

    const distance = dist3D(ai.location, target.location);
    const healthPct = getHealthPercent(ai);

    try {
        const equippable = ai.getComponent(EntityComponentTypes.Equippable);
        if (!equippable) return;

        const offhand = equippable.getEquipment(EquipmentSlot.Offhand);
        const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
        const hasPearl = (offhand?.typeId === "minecraft:ender_pearl") || (mainhand?.typeId === "minecraft:ender_pearl");

        if (!hasPearl) return;

        // Escape pearl: more aggressive threshold
        if (healthPct < 0.35 && distance < 12) {
            const dir = directionTo(target.location, ai.location);
            const throwDirection = { x: dir.x * 1.2, y: 0.3, z: dir.z * 1.2 };

            const pearl = ai.dimension.spawnEntity("minecraft:ender_pearl", { x: ai.location.x, y: ai.location.y + 1.5, z: ai.location.z });
            if (pearl && pearl.isValid) {
                pearl.applyImpulse(throwDirection);
            }
            try { ai.dimension.playSound("mob.endermen.portal", ai.location, { maxDistance: 32 }); } catch (e) { }

            if (offhand?.typeId === "minecraft:ender_pearl") {
                equippable.setEquipment(EquipmentSlot.Offhand, undefined);
            } else if (mainhand?.typeId === "minecraft:ender_pearl") {
                equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
            }

            setCooldown(enderPearlCooldowns, ai.id);
        }
        // Tactical reposition pearl: improved conditions
        else if (distance > 15 && distance < 45 && Math.random() < 0.25) {
            const direction = directionTo(ai.location, target.location);
            const throwDirection = { x: direction.x * 1.3, y: 0.4, z: direction.z * 1.3 };

            const pearl = ai.dimension.spawnEntity("minecraft:ender_pearl", { x: ai.location.x, y: ai.location.y + 1.5, z: ai.location.z });
            if (pearl && pearl.isValid) {
                pearl.applyImpulse(throwDirection);
            }
            try { ai.dimension.playSound("mob.endermen.portal", ai.location, { maxDistance: 32 }); } catch (e) { }

            if (offhand?.typeId === "minecraft:ender_pearl") {
                equippable.setEquipment(EquipmentSlot.Offhand, undefined);
            } else if (mainhand?.typeId === "minecraft:ender_pearl") {
                equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
            }

            setCooldown(enderPearlCooldowns, ai.id);
        }
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// 4. WIND BURST (knockback nearby enemies)
// ====================================================================
function handleWindBurst(ai, target) {
    if (onCooldown(windBurstCooldowns, ai.id, 300)) return;

    const tier = getAITier(ai);
    if (tier !== "diamond_pro") return;
    if (Math.random() > 0.12) return;

    const distance = dist2D(ai.location, target.location);
    if (distance > 4) return;

    try {
        const nearbyEntities = ai.dimension.getEntities({
            location: ai.location,
            maxDistance: 5,
            excludeTypes: [ai_player_id]
        });

        for (const entity of nearbyEntities) {
            if (!entity.isValid) continue;
            if (entity.id === ai.id) continue;

            const dir = directionTo(ai.location, entity.location);
            try {
                entity.applyImpulse({ x: dir.x * 1.5, y: 0.6, z: dir.z * 1.5 });
            } catch (e) { console.warn(e, e.stack); }
        }

        ai.runCommand(`particle minecraft:wind_explosion ${ai.location.x} ${ai.location.y + 0.5} ${ai.location.z}`);
        ai.runCommand("playsound breeze.wind_burst @a[r=32]");
        ai.applyImpulse(clampLaunch({ x: 0, y: 0.4, z: 0 }));
        setCooldown(windBurstCooldowns, ai.id);
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// 5. MLG WATER BUCKET (FIXED - proper ground detection)
// ====================================================================
function handleMLGWater() {
    const allAI = ALL_AI_CACHE;
    if (!allAI || allAI.length === 0) return;

    for (const ai of allAI) {
        if (!ai.isValid) continue;
        if (onCooldown(mlgCooldowns, ai.id, 100)) continue;

        try {
            const vel = ai.getVelocity();
            // Check if falling fast enough
            if (vel.y < -0.6 && !ai.isInWater && !ai.isOnGround) {

                const tier = getAITier(ai);
                const mlgChance = (tier === "diamond_pro") ? 0.9 :
                    (tier === "diamond") ? 0.8 :
                        (tier === "iron") ? 0.6 : 0.4;

                if (Math.random() < mlgChance) {
                    // Find the actual ground block below the AI
                    let groundY = Math.floor(ai.location.y) - 1;
                    let foundGround = false;

                    // Search down up to 10 blocks to find solid ground
                    for (let y = Math.floor(ai.location.y) - 1; y >= Math.floor(ai.location.y) - 10; y--) {
                        const checkBlock = ai.dimension.getBlock({
                            x: Math.floor(ai.location.x),
                            y: y,
                            z: Math.floor(ai.location.z)
                        });

                        if (checkBlock && isSolidBlock(checkBlock)) {
                            // Found solid ground - place water one block above it
                            groundY = y + 1;
                            foundGround = true;
                            break;
                        }
                    }

                    if (!foundGround) {
                        // Default to 2 blocks below AI if no ground found
                        groundY = Math.floor(ai.location.y) - 2;
                    }

                    const waterPos = {
                        x: Math.floor(ai.location.x),
                        y: groundY,
                        z: Math.floor(ai.location.z)
                    };

                    // Make sure water isn't being placed in mid-air
                    const blockBelowWater = ai.dimension.getBlock({
                        x: waterPos.x,
                        y: waterPos.y - 1,
                        z: waterPos.z
                    });

                    const blockAtWater = ai.dimension.getBlock(waterPos);

                    // Only place water if there's solid ground below AND the water block is air
                    if (blockBelowWater &&
                        isSolidBlock(blockBelowWater) &&
                        blockAtWater &&
                        (blockAtWater.typeId === "minecraft:air" || blockAtWater.typeId === "minecraft:cave_air")) {

                        // Place water
                        ai.dimension.runCommand(`setblock ${waterPos.x} ${waterPos.y} ${waterPos.z} water`);
                        ai.runCommand("playsound random.splash @a[r=16]");

                        // Remove water after 1.5 seconds (30 ticks)
                        const dim = ai.dimension;
                        const savedWaterPos = { ...waterPos };
                        system.runTimeout(() => {
                            try {
                                const checkBlock = dim.getBlock(savedWaterPos);
                                if (checkBlock && checkBlock.typeId === "minecraft:water") {
                                    dim.runCommand(`setblock ${savedWaterPos.x} ${savedWaterPos.y} ${savedWaterPos.z} air`);
                                }
                            } catch (e) { console.warn(e, e.stack); }
                        }, 30);

                        setCooldown(mlgCooldowns, ai.id);
                    }
                }
            }
        } catch (e) { console.warn(e, e.stack); }
    }
}

// ====================================================================
// 6. SMART DISTANCE MANAGEMENT (approach & maintain range)
// ====================================================================
function handleDistanceManagement(ai, target) {
    const distance = dist3D(ai.location, target.location);
    const heightDiff = Math.abs(target.location.y - ai.location.y);

    try {
        // If too far away, move closer
        if (distance > 20 && ai.isOnGround && !ai.isInWater) {
            const dir = directionTo(ai.location, target.location);
            // Speed-boost movement
            if (Math.random() < 0.4) {
                ai.applyImpulse(clampLaunch({ x: dir.x * 0.4, y: 0.15, z: dir.z * 0.4 }));
            }
        }
        // If very close, back up slightly to maintain range
        else if (distance < 2 && ai.isOnGround && !ai.isInWater) {
            const dir = directionTo(ai.location, target.location);
            if (Math.random() < 0.3) {
                ai.applyImpulse(clampLaunch({ x: -dir.x * 0.25, y: 0.05, z: -dir.z * 0.25 }));
            }
        }
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// 7. FLANKING & POSITIONING
// ====================================================================
function handlePositioning(ai, target) {
    if (!ai.isOnGround || ai.isInWater) return;

    try {
        const nearbyFriends = ai.dimension.getEntities({
            type: ai_player_id,
            location: ai.location,
            maxDistance: 3
        });

        let tooClose = 0;
        for (const friend of nearbyFriends) {
            if (friend.id !== ai.id && friend.isValid) tooClose++;
        }

        // Spread out if crowded
        if (tooClose >= 2 && Math.random() < 0.35) {
            const dir = directionTo(ai.location, target.location);
            const side = Math.random() < 0.5 ? 1 : -1;
            ai.applyImpulse(clampLaunch({ x: -dir.z * side * 0.4, y: 0.08, z: dir.x * side * 0.4 }));
        }
    } catch (e) { console.warn(e, e.stack); }
}

// ====================================================================
// MAIN LOOP
// ====================================================================
export function startEnhancedCombat() {
    // Main combat enhancement loop
    system.runInterval(() => {
        try {
            const allPlayers = REAL_PLAYERS_CACHE;
            if (!allPlayers || allPlayers.length === 0) return;

            const processedAIs = new Set();

            for (const player of allPlayers) {
                if (!player.isValid) continue;

                let nearbyAI;
                try {
                    nearbyAI = player.dimension.getEntities({
                        type: ai_player_id,
                        maxDistance: PROXIMITY_RADIUS,
                        location: player.location
                    });
                } catch (e) {
                    continue;
                }

                for (const ai of nearbyAI) {
                    if (!ai.isValid || processedAIs.has(ai.id)) continue;
                    processedAIs.add(ai.id);

                    try {
                        if (!hasValidTarget(ai)) continue;
                        const target = getCurrentTarget(ai);
                        if (!target || !target.isValid) continue;

                        // Run all combat subsystems
                        try { handleWeaponSwitch(ai, target); } catch (e) { console.warn(e, e.stack); }
                        try { handleDistanceManagement(ai, target); } catch (e) { console.warn(e, e.stack); }
                        try { handleCombatCombo(ai, target); } catch (e) { console.warn(e, e.stack); }
                        try { handleEnderPearl(ai, target); } catch (e) { console.warn(e, e.stack); }
                        try { handleWindBurst(ai, target); } catch (e) { console.warn(e, e.stack); }
                        try { handlePositioning(ai, target); } catch (e) { console.warn(e, e.stack); }
                    } catch (e) {
                        console.warn(`Error processing AI ${ai.id}: ${e}`);
                    }
                }
            }
        } catch (e) {
            console.error("Combat loop fatal error:", e);
        }
    }, TICK_INTERVAL);

    // MLG water runs every 3 ticks (fast response)
    system.runInterval(() => {
        try {
            handleMLGWater();
        } catch (e) { console.warn(e, e.stack); }
    }, 3);

    // Cleanup cooldown maps periodically
    system.runInterval(() => {
        try {
            const now = system.currentTick;
            for (const map of [comboCooldowns, enderPearlCooldowns, windBurstCooldowns, mlgCooldowns, weaponSwitchCooldowns]) {
                for (const [id, tick] of map.entries()) {
                    if (now - tick > 600) map.delete(id);
                }
            }
        } catch (e) { console.warn(e, e.stack); }
    }, 200);
}

