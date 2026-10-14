// Call of the Hive (COTH) infection, assimilation, adaptation and death reactions.
// Everything here is event driven; the only loop walks the (small) set of infected entities.
import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { MOB_INFO, ASSIMILATE, FERAL } from "./data.js";
import { state, currentPhase, addPoints, isParasite, canSpawnMore, safeSpawn, weightedPick, randInt, rand } from "./state.js";

export const COTH_TAG = "srp_coth";
const KILLS_KEY = "srp:kills";
const ADAPT_KILLS = 3;           // kills a primitive needs to become adapted
const FERAL_KILLS = 4;           // kills an assimilated mob needs to turn feral (phase 5+)
const COTH_DURATION = 60 * 20;   // ticks an infection lasts without new hits
const MAX_TRACKED = 64;          // hard cap on tracked infections

/** id -> { entity, expires, since, player } */
const infected = new Map();
let guard = false;               // prevents recursion from our own applyDamage calls

const VIRAL_SKIN = 5, BLEED_SKIN = 6;

function wearsHiveArmor(entity) {
    try {
        const eq = entity.getComponent("minecraft:equippable");
        if (!eq) return 0;
        let n = 0;
        for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
            const it = eq.getEquipment(slot);
            if (it && (it.typeId.startsWith("srp:living_") || it.typeId.startsWith("srp:sentient_"))) n++;
        }
        return n;
    } catch { return 0; }
}

function infect(victim, attacker) {
    if (!state.settings.coth) return;
    if (infected.size >= MAX_TRACKED && !infected.has(victim.id)) return;
    const isPlayer = victim.typeId === "minecraft:player";
    if (isPlayer && wearsHiveArmor(victim) >= 2) return; // living/sentient armor resists COTH
    const now = system.currentTick;
    const rec = infected.get(victim.id);
    if (rec) { rec.expires = now + COTH_DURATION; return; }
    if (!isPlayer && !ASSIMILATE[victim.typeId]) return;   // only track mobs that can be assimilated
    try { victim.addTag(COTH_TAG); } catch { }
    infected.set(victim.id, { entity: victim, expires: now + COTH_DURATION, since: now, player: isPlayer });
    addPoints(1);
    if (isPlayer) {
        try { victim.onScreenDisplay.setActionBar("§4You hear the Call of the Hive..."); } catch { }
    }
}

export function cure(entity) {
    infected.delete(entity.id);
    try { entity.removeTag(COTH_TAG); } catch { }
}

function variantEffects(attacker, victim) {
    const info = MOB_INFO[attacker.typeId];
    if (!info || !info.skins) return;
    let v = 0;
    try { v = attacker.getComponent("minecraft:variant")?.value ?? 0; } catch { }
    const skin = info.skins[v];
    try {
        if (skin === VIRAL_SKIN) victim.addEffect("poison", 60, { amplifier: 0 });
        else if (skin === BLEED_SKIN) victim.addEffect("wither", 50, { amplifier: 0 });
    } catch { }
}

function convert(entity, intoId) {
    if (!canSpawnMore(1)) return undefined;
    let loc, dim;
    try { loc = entity.location; dim = entity.dimension; } catch { return undefined; }
    const spawned = safeSpawn(dim, intoId, loc);
    return spawned;
}

function incrementKills(killer) {
    let k = 0;
    try { k = (killer.getDynamicProperty(KILLS_KEY) ?? 0) + 1; killer.setDynamicProperty(KILLS_KEY, k); } catch { }
    return k;
}

function evolveKiller(killer, kills) {
    const info = MOB_INFO[killer.typeId];
    if (!info) return;
    let into;
    if (info.adapt && kills >= ADAPT_KILLS && currentPhase() >= 2) into = info.adapt;
    else if (FERAL[killer.typeId] && kills >= FERAL_KILLS && currentPhase() >= 5) into = FERAL[killer.typeId];
    if (!into) return;
    system.run(() => {
        try {
            if (!killer.isValid) return;
            const dim = killer.dimension, loc = killer.location;
            const e = dim.spawnEntity(into, loc);
            try { dim.playSound("srp.adaptation.full", loc, { volume: 1.0 }); } catch { }
            if (e) killer.remove();
        } catch { }
    });
}

function onParasiteDeath(dead, info, killer) {
    let dim, loc;
    try { dim = dead.dimension; loc = dead.location; } catch { return; }
    // walking heads detach from assimilated bodies
    if (info.head && Math.random() < 0.35 && canSpawnMore(1)) {
        system.run(() => safeSpawn(dim, info.head, { x: loc.x, y: loc.y + 0.5, z: loc.z }));
    }
    // carriers / colony carriers release their passengers
    if (info.releases) releaseMobs(dim, loc, info.releases);
    // nodes: the hive loses ground
    if (info.node) addPoints(-25 * info.node);
    // late-phase colonies leave moving flesh behind
    if (!info.node && !info.flesh && currentPhase() >= 5 && Math.random() < 0.12 && canSpawnMore(1)) {
        system.run(() => safeSpawn(dim, "srp:movingflesh", loc));
    }
}

export function releaseMobs(dim, loc, releases) {
    const n = randInt(2, 4);
    system.run(() => {
        for (let i = 0; i < n; i++) {
            if (!canSpawnMore(1)) break;
            const e = weightedPick(releases, 1);
            safeSpawn(dim, e[0], { x: loc.x + rand(-1.2, 1.2), y: loc.y + 0.3, z: loc.z + rand(-1.2, 1.2) });
        }
    });
}

function onVictimDeath(dead, killer) {
    const into = ASSIMILATE[dead.typeId];
    if (!into || !state.settings.assimilation) return;
    const byParasite = killer && isParasite(killer);
    let hadCoth = false;
    try { hadCoth = dead.hasTag(COTH_TAG); } catch { }
    infected.delete(dead.id);
    if (!byParasite && !hadCoth) return;
    let dim, loc;
    try { dim = dead.dimension; loc = dead.location; } catch { return; }
    const isPlayer = dead.typeId === "minecraft:player";
    addPoints(isPlayer ? 10 : 4);
    // keep the world from filling up with corpses-turned-parasites
    if (!canSpawnMore(1)) return;
    system.runTimeout(() => {
        const e = safeSpawn(dim, into, loc);
        if (e) { try { dim.playSound("srp.infected.melt", loc, { volume: 0.8 }); } catch { } }
    }, isPlayer ? 40 : 10);
}

function tickInfections() {
    if (!infected.size) return;
    const now = system.currentTick;
    const phase = currentPhase();
    for (const [id, rec] of infected) {
        const e = rec.entity;
        if (!e || !e.isValid) { infected.delete(id); continue; }
        if (now > rec.expires) { cure(e); continue; }
        try {
            if (rec.player) {
                // Call of the Hive on players: hunger and the occasional nausea spell
                e.addEffect("hunger", 100, { amplifier: Math.min(2, Math.floor(phase / 4)), showParticles: false });
                if (phase >= 4 && Math.random() < 0.15) e.addEffect("nausea", 120, { amplifier: 0, showParticles: false });
                continue;
            }
            // infected mobs mutate after a while (from phase 2), or when badly hurt
            const hp = e.getComponent("minecraft:health");
            const low = hp && hp.currentValue < hp.effectiveMax * 0.3;
            const age = now - rec.since;
            if ((phase >= 2 && age > 400 + (id.length % 7) * 60) || (low && age > 60)) {
                const into = ASSIMILATE[e.typeId];
                if (into && state.settings.assimilation && canSpawnMore(1)) {
                    const spawned = convert(e, into);
                    if (spawned) { infected.delete(id); e.remove(); addPoints(3); }
                }
            } else {
                e.addEffect("weakness", 100, { amplifier: 0, showParticles: false });
            }
        } catch { infected.delete(id); }
    }
}

export function startInfection() {
    world.afterEvents.entityHurt.subscribe((ev) => {
        if (guard || !state.ready) return;
        try {
            const attacker = ev.damageSource?.damagingEntity;
            const victim = ev.hurtEntity;
            if (!attacker || !victim) return;
            const attackerIsParasite = isParasite(attacker);
            const victimIsParasite = isParasite(victim);
            if (attackerIsParasite && !victimIsParasite) {
                if (!victim.isValid) return;
                infect(victim, attacker);
                variantEffects(attacker, victim);
            }
        } catch { }
    });

    world.afterEvents.entityDie.subscribe((ev) => {
        if (!state.ready) return;
        try {
            const dead = ev.deadEntity;
            const killer = ev.damageSource?.damagingEntity;
            const info = MOB_INFO[dead.typeId];
            if (info) {
                onParasiteDeath(dead, info, killer);
                return;
            }
            onVictimDeath(dead, killer);
            if (killer && isParasite(killer) && killer.isValid) {
                addPoints(1);
                const k = incrementKills(killer);
                evolveKiller(killer, k);
            }
        } catch { }
    });

    // carriers explode instead of dying normally: release their passengers
    world.beforeEvents.explosion.subscribe((ev) => {
        try {
            const src = ev.source;
            if (!src) return;
            const info = MOB_INFO[src.typeId];
            if (!info || !info.releases) return;
            const dim = ev.dimension, loc = src.location;
            releaseMobs(dim, { x: loc.x, y: loc.y, z: loc.z }, info.releases);
            try { system.run(() => dim.playSound("srp.rathol.boom", loc, { volume: 1.0 })); } catch { }
        } catch { }
    });

    // milk and golden apples cure the Call of the Hive
    world.afterEvents.itemCompleteUse.subscribe((ev) => {
        try {
            const id = ev.itemStack?.typeId;
            if (id === "minecraft:milk_bucket" || id === "minecraft:golden_apple" || id === "minecraft:enchanted_golden_apple") {
                if (ev.source.hasTag(COTH_TAG)) {
                    cure(ev.source);
                    ev.source.onScreenDisplay.setActionBar("§aThe Call of the Hive fades...");
                }
            }
        } catch { }
    });

    // players who rejoin still carrying the tag get tracked again
    world.afterEvents.playerSpawn.subscribe((ev) => {
        try {
            const p = ev.player;
            if (p.hasTag(COTH_TAG) && !infected.has(p.id)) {
                if (!ev.initialSpawn) { cure(p); return; } // respawned after death: clean slate
                infected.set(p.id, { entity: p, expires: system.currentTick + COTH_DURATION, since: system.currentTick, player: true });
            }
        } catch { }
    });

    system.runInterval(() => { try { tickInfections(); } catch { } }, 80);
}

export function infectedCount() { return infected.size; }
export function withGuard(fn) { guard = true; try { fn(); } finally { guard = false; } }
export { EntityDamageCause };
