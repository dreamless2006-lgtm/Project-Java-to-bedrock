// Parasite gear: Bloody Clock (phase info + settings), Evolution Lure, Quench and living weapons.
import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { MOB_INFO } from "./data.js";
import { state, currentPhase, addPoints, PHASE_POINTS, saveSettings, setPoints, DEFAULT_SETTINGS } from "./state.js";
import { infectedCount, cure, COTH_TAG } from "./infection.js";

let guard = false;

function isOperator(player) {
    try {
        const lvl = player.playerPermissionLevel;
        if (lvl === undefined) return true;
        return lvl >= 2 || String(lvl).toLowerCase().includes("operator");
    } catch { return true; }
}

export function phaseReport() {
    const phase = currentPhase();
    const next = phase < 10 ? PHASE_POINTS[phase + 1] : undefined;
    const pts = Math.floor(state.points);
    const lock = state.settings.lockedPhase >= 0 ? " §7(locked)" : "";
    return `§4Hive Phase §c${phase}${lock}§7 | points §f${pts}${next !== undefined ? "§7/§f" + next : ""}` +
        `§7 | parasites §f${state.parasiteCount}§7/§f${state.settings.globalCap}§7 | nodes §f${state.nodeCount}§7 | infected §f${infectedCount()}`;
}

export function openSettings(player) {
    const s = state.settings;
    const form = new ModalFormData()
        .title("Scape and Run: Parasites")
        .toggle("Natural parasite spawning", { defaultValue: s.enabled })
        .toggle("Evolution phases gain points", { defaultValue: s.evolution })
        .toggle("Assimilation (kills create parasites)", { defaultValue: s.assimilation })
        .toggle("Call of the Hive infection", { defaultValue: s.coth })
        .toggle("Block infestation (needs mobGriefing)", { defaultValue: s.infestation })
        .toggle("Beckons / dispatchers (nodes)", { defaultValue: s.nodes })
        .slider("Max parasites in world (lag control)", 10, 120, { valueStep: 5, defaultValue: s.globalCap })
        .slider("Max parasites near each player", 2, 30, { valueStep: 1, defaultValue: s.localCap })
        .slider("Seconds between spawn attempts", 5, 60, { valueStep: 5, defaultValue: s.interval })
        .slider("Max nodes in world", 0, 12, { valueStep: 1, defaultValue: s.maxNodes })
        .slider("Force phase (-1 = automatic)", -1, 10, { valueStep: 1, defaultValue: s.lockedPhase });
    form.show(player).then((res) => {
        if (res.canceled || !res.formValues) return;
        const v = res.formValues;
        Object.assign(state.settings, {
            enabled: !!v[0], evolution: !!v[1], assimilation: !!v[2], coth: !!v[3], infestation: !!v[4], nodes: !!v[5],
            globalCap: Number(v[6]), localCap: Number(v[7]), interval: Number(v[8]), maxNodes: Number(v[9]), lockedPhase: Number(v[10])
        });
        saveSettings();
        player.sendMessage("§a[Parasites] Settings saved. " + phaseReport());
    }).catch(() => { });
}

function consumeOne(player) {
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        const slot = player.selectedSlotIndex;
        const item = inv?.getItem(slot);
        if (!item) return;
        if (item.amount > 1) { item.amount -= 1; inv.setItem(slot, item); }
        else inv.setItem(slot, undefined);
    } catch { }
}

function sweep(attacker, victim, amount) {
    try {
        const near = attacker.dimension.getEntities({ location: victim.location, maxDistance: 3, families: ["parasite"] });
        let n = 0;
        for (const e of near) {
            if (e.id === victim.id || n >= 4) continue;
            e.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: attacker });
            n++;
        }
    } catch { }
}

export function startItems() {
    world.afterEvents.itemUse.subscribe((ev) => {
        const player = ev.source, item = ev.itemStack;
        if (!item || !player) return;
        try {
            if (item.typeId === "srp:bloody_clock") {
                if (player.isSneaking && isOperator(player)) { system.run(() => openSettings(player)); return; }
                player.sendMessage(phaseReport());
                if (player.hasTag(COTH_TAG)) player.sendMessage("§4You are infected with the Call of the Hive. §7Milk or a golden apple cures it.");
            } else if (item.typeId === "srp:evolution_lure") {
                const before = currentPhase();
                addPoints(-Math.max(60, PHASE_POINTS[Math.max(1, before)] * 0.08));
                consumeOne(player);
                player.playSound("random.orb", { pitch: 0.6 });
                player.sendMessage("§2[Parasites] §aThe lure draws the hive back. " + phaseReport());
            }
        } catch { }
    });

    world.afterEvents.projectileHitEntity.subscribe((ev) => {
        try {
            if (ev.projectile?.typeId !== "srp:quench_ball") return;
            const hit = ev.getEntityHit()?.entity;
            if (!hit || !MOB_INFO[hit.typeId]) return;
            guard = true;
            hit.applyDamage(18, { cause: EntityDamageCause.fire, damagingEntity: ev.source });
            hit.setOnFire(6, true);
            cure(hit);
        } catch { } finally { guard = false; }
    });

    // living / sentient weapons are tuned against parasites
    world.afterEvents.entityHurt.subscribe((ev) => {
        if (guard) return;
        try {
            const attacker = ev.damageSource?.damagingEntity;
            if (!attacker || attacker.typeId !== "minecraft:player") return;
            const victim = ev.hurtEntity;
            if (!MOB_INFO[victim.typeId]) return;
            if (ev.damageSource.cause !== EntityDamageCause.entityAttack) return;
            const held = attacker.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
            const id = held?.typeId;
            if (!id || !(id.startsWith("srp:living_") || id.startsWith("srp:sentient_"))) return;
            const sentient = id.startsWith("srp:sentient_");
            guard = true;
            if (id.endsWith("_scythe") || id.endsWith("_axe")) sweep(attacker, victim, ev.damage * (sentient ? 0.6 : 0.4));
            else if (id.endsWith("_sword") || id.endsWith("_cleaver")) victim.addEffect("wither", sentient ? 80 : 50, { amplifier: 0 });
            else if (id.endsWith("_maul")) victim.addEffect("slowness", 60, { amplifier: sentient ? 2 : 1 });
            else if (id.endsWith("_lance")) victim.addEffect("weakness", 80, { amplifier: sentient ? 1 : 0 });
        } catch { } finally { guard = false; }
    });

    // operator commands: /scriptevent srp:<command> [value]
    system.afterEvents.scriptEventReceive.subscribe((ev) => {
        try {
            if (!ev.id.startsWith("srp:")) return;
            const cmd = ev.id.slice(4);
            const arg = (ev.message || "").trim();
            const src = ev.sourceEntity;
            const reply = (m) => {
                try {
                    const player = src && src.typeId === "minecraft:player" ? /** @type {import("@minecraft/server").Player} */ (src) : undefined;
                    if (player) player.sendMessage(m); else world.sendMessage(m);
                } catch { }
            };
            switch (cmd) {
                case "menu": case "settings":
                    if (src && src.typeId === "minecraft:player") system.run(() => openSettings(src));
                    break;
                case "phase": {
                    const p = Math.max(0, Math.min(10, parseInt(arg)));
                    if (!isNaN(p)) { state.settings.lockedPhase = -1; saveSettings(); setPoints(PHASE_POINTS[p]); }
                    reply(phaseReport());
                    break;
                }
                case "lock": {
                    const p = parseInt(arg);
                    state.settings.lockedPhase = isNaN(p) ? -1 : Math.max(-1, Math.min(10, p));
                    saveSettings(); reply(phaseReport());
                    break;
                }
                case "points": {
                    const v = parseFloat(arg);
                    if (!isNaN(v)) setPoints(v);
                    reply(phaseReport());
                    break;
                }
                case "cap": {
                    const v = parseInt(arg);
                    if (!isNaN(v)) { state.settings.globalCap = Math.max(0, Math.min(200, v)); saveSettings(); }
                    reply(phaseReport());
                    break;
                }
                case "toggle": {
                    if (arg in DEFAULT_SETTINGS && typeof DEFAULT_SETTINGS[arg] === "boolean") {
                        state.settings[arg] = !state.settings[arg]; saveSettings();
                        reply(`§e[Parasites] ${arg} = ${state.settings[arg]}`);
                    } else reply("§cUse one of: " + Object.keys(DEFAULT_SETTINGS).filter(k => typeof DEFAULT_SETTINGS[k] === "boolean").join(", "));
                    break;
                }
                case "clear": {
                    let n = 0;
                    for (const id of ["overworld", "nether", "the_end"]) {
                        for (const e of world.getDimension(id).getEntities({ families: ["parasite"] })) { try { e.remove(); n++; } catch { } }
                    }
                    reply(`§e[Parasites] Removed ${n} parasites.`);
                    break;
                }
                case "status": default:
                    reply(phaseReport());
            }
        } catch (e) { console.warn("[SRP] scriptevent failed: " + e); }
    });
}
