// Builds the observation a bot "sees" each think. Everything here is a
// cheap read of the live world; the block scan is the only loop of note.
import { world, system, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";
import { nameOf, isModdedId } from "./world_content.js";
import { getFriendTask } from "../ai_task_worker.js";
import { whoOwns } from "../ai_navigation.js";

const SCAN_R = 5;           // horizontal radius of the block scan
const SCAN_DY = 3;          // vertical half-height
const ENTITY_R = 24;
const ITEM_R = 12;

const NOTABLE = /(_ore$|^minecraft:ancient_debris$|^minecraft:(water|flowing_water|lava|flowing_lava|chest|trapped_chest|barrel|bed|crafting_table|furnace|lit_furnace|blast_furnace|smoker|portal|end_portal|end_portal_frame|end_gateway|obsidian|crying_obsidian|ladder|torch|lantern|campfire|bookshelf|enchanting_table|anvil|brewing_stand|mob_spawner|trial_spawner|bell|hay_block|sweet_berry_bush|wheat|carrots|potatoes|beetroot|melon_block|pumpkin|cake|bee_nest|beehive|respawn_anchor|lodestone|spawner)$|_door$|_log$|_stem$|_leaves$|_sapling$|_shulker_box$|^minecraft:(sand|gravel|clay|sugar_cane|bamboo|cactus|mushroom)|_planks$)/;
const PASSTHROUGH = new Set(["minecraft:air", "minecraft:stone", "minecraft:dirt", "minecraft:grass_block", "minecraft:deepslate", "minecraft:cobblestone", "minecraft:netherrack", "minecraft:end_stone", "minecraft:bedrock", "minecraft:tuff", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:short_grass", "minecraft:tallgrass", "minecraft:snow_layer", "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:blackstone", "minecraft:basalt", "minecraft:soul_sand", "minecraft:soul_soil", "minecraft:calcite", "minecraft:moss_block", "minecraft:moss_carpet", "minecraft:fern", "minecraft:large_fern", "minecraft:double_plant"]);

export function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dirName(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    if (Math.abs(dx) < 1.5 && Math.abs(dz) < 1.5) return "here";
    const ang = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;   // 0 = north (-z)
    const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return names[Math.round(ang / 45) % 8];
}

export function fmtPos(p) { return `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`; }

export function timeLabel(t) {
    if (t < 1000) return "dawn";
    if (t < 6000) return "morning";
    if (t < 9000) return "midday";
    if (t < 12000) return "afternoon";
    if (t < 13000) return "dusk";
    if (t < 18000) return "night";
    if (t < 23000) return "deep night";
    return "almost dawn";
}

export function dimensionLabel(id) {
    return String(id || "").replace("minecraft:", "").replace("the_end", "the End").replace("nether", "the Nether");
}

export function healthOf(e) {
    try {
        const h = e.getComponent(EntityComponentTypes.Health);
        return h ? { hp: Math.round(h.currentValue), max: Math.round(h.effectiveMax || h.defaultValue || 20) } : null;
    } catch (e2) { return null; }
}

export function containerOf(e) {
    try { return e.getComponent(EntityComponentTypes.Inventory)?.container || null; } catch (e2) { return null; }
}

/** {id: count} for the bot's real inventory container. */
export function inventoryMap(e) {
    const out = {};
    const c = containerOf(e);
    if (!c) return out;
    for (let i = 0; i < c.size; i++) {
        let s;
        try { s = c.getItem(i); } catch (e2) { continue; }
        if (!s) continue;
        out[s.typeId] = (out[s.typeId] || 0) + s.amount;
    }
    return out;
}

export function virtualFood(e) {
    try {
        const raw = e.getDynamicProperty("rg:food_inventory");
        if (!raw) return {};
        const j = JSON.parse(raw);
        return j && typeof j === "object" ? j : {};
    } catch (e2) { return {}; }
}

export function equipmentOf(e) {
    try {
        const eq = e.getComponent(EntityComponentTypes.Equippable);
        if (!eq) return null;
        const parts = [];
        for (const [slot, label] of [[EquipmentSlot.Head, "head"], [EquipmentSlot.Chest, "chest"], [EquipmentSlot.Legs, "legs"], [EquipmentSlot.Feet, "feet"], [EquipmentSlot.Mainhand, "hand"], [EquipmentSlot.Offhand, "offhand"]]) {
            const s = eq.getEquipment(slot);
            if (s) parts.push(`${label}: ${nameOf(s.typeId)}`);
        }
        return parts.length ? parts.join(", ") : "nothing";
    } catch (e2) { return null; }
}

function familiesOf(e) {
    try { return e.getComponent(EntityComponentTypes.TypeFamily); } catch (e2) { return null; }
}

function isHostile(e) {
    const f = familiesOf(e);
    try { if (f && (f.hasTypeFamily("monster") || f.hasTypeFamily("hostile"))) return true; } catch (e2) { /* ignore */ }
    return false;
}

function isAnimalish(e) {
    const f = familiesOf(e);
    try { return !!f && (f.hasTypeFamily("animal") || f.hasTypeFamily("mob")) && !f.hasTypeFamily("monster"); } catch (e2) { return false; }
}

function entityLine(bot, e, extra = "") {
    const d = dist(bot.location, e.location);
    const h = healthOf(e);
    return `${e.nameTag ? e.nameTag + " the " : ""}${nameOf(e.typeId)} ${Math.round(d)}m ${dirName(bot.location, e.location)}${h ? ` hp${h.hp}` : ""}${extra ? " " + extra : ""}`;
}

/** Scan blocks around the bot and summarise notable/modded ones by type. */
export function scanBlocks(bot, radius = SCAN_R, dy = SCAN_DY) {
    const dim = bot.dimension;
    const cx = Math.floor(bot.location.x), cy = Math.floor(bot.location.y), cz = Math.floor(bot.location.z);
    const found = new Map();   // typeId -> {count, nearest, pos}
    for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
            for (let y = -dy; y <= dy; y++) {
                let b;
                try { b = dim.getBlock({ x: cx + x, y: cy + y, z: cz + z }); } catch (e) { continue; }
                if (!b) continue;
                const id = b.typeId;
                if (PASSTHROUGH.has(id)) continue;
                if (!NOTABLE.test(id) && !isModdedId(id)) continue;
                const d = Math.sqrt(x * x + y * y + z * z);
                const cur = found.get(id);
                if (!cur) found.set(id, { count: 1, nearest: d, pos: { x: cx + x, y: cy + y, z: cz + z } });
                else { cur.count++; if (d < cur.nearest) { cur.nearest = d; cur.pos = { x: cx + x, y: cy + y, z: cz + z }; } }
            }
        }
    }
    const rows = [...found.entries()].sort((a, b) => a[1].nearest - b[1].nearest).slice(0, 18);
    return rows.map(([id, v]) => `${nameOf(id)}${v.count > 1 ? " x" + v.count : ""} at ${fmtPos(v.pos)}`);
}

function jobLine(bot, brain) {
    const parts = [];
    try {
        const t = getFriendTask(bot);
        if (t) parts.push(`${t.kind} job (${t.want || "anything"}): ${t.count}/${t.requested} collected, ${Math.round(t.remainingTicks / 20)}s left`);
    } catch (e) { /* ignore */ }
    if (brain?.actuator) {
        const cur = brain.actuator.describeCurrent();
        if (cur) parts.push(cur);
    }
    try {
        if (bot.hasTag("is_sleeping")) parts.push("sleeping");
        if (bot.hasTag("is_busy_building")) parts.push("building");
        if (bot.hasTag("on_eat") || bot.hasTag("is_eating")) parts.push("eating");
        const owner = whoOwns(bot);
        if (owner && owner.source !== "llm") parts.push(`body reflex: ${owner.source}`);
    } catch (e) { /* ignore */ }
    return parts.join("; ");
}

function playerLine(bot, p) {
    const bits = [];
    const d = dist(bot.location, p.location);
    bits.push(`${p.name} ${Math.round(d)}m ${dirName(bot.location, p.location)}`);
    try {
        const s = bot.getDynamicProperty("sympathy_player_" + p.id);
        if (typeof s === "number") bits.push(`likes me ${Math.round(s)}/100`);
        const f = bot.getDynamicProperty("friend_status_" + p.id);
        if (f === "accepted") bits.push("friend");
        if (bot.getDynamicProperty("rg:ai_owner_id") === p.id || bot.getDynamicProperty("realai:owner") === p.id) bits.push("my owner");
        if (p.hasTag("realai_bridge")) bits.push("(relay account, not a real person)");
    } catch (e) { /* ignore */ }
    return bits.join(", ");
}

/**
 * Build the observation object (see prompt.renderObservation).
 * brain: the BotBrain (for job/action status and drained events).
 */
export function observe(bot, brain, extras = {}) {
    const obs = {};
    const loc = bot.location;
    obs.position = loc;
    obs.dimension = dimensionLabel(bot.dimension.id);
    obs.timeOfDay = timeLabel(world.getTimeOfDay());
    try { const w = bot.dimension.getWeather?.(); if (w && w !== "Clear") obs.weather = String(w).toLowerCase(); } catch (e) { /* beta only */ }
    try { const b = bot.dimension.getBlock(loc)?.getBiome?.(); if (b?.id) obs.biome = nameOf(b.id); } catch (e) { /* optional */ }
    try { const r = bot.getRotation(); obs.facing = dirName({ x: 0, z: 0 }, { x: -Math.sin(r.y * Math.PI / 180) * 10, z: Math.cos(r.y * Math.PI / 180) * 10 }); } catch (e) { /* ignore */ }

    const h = healthOf(bot);
    obs.health = h ? h.hp : "?";
    obs.maxHealth = h ? h.max : 20;
    const food = virtualFood(bot);
    const foodCount = Object.values(food).reduce((a, b) => a + (b || 0), 0);
    obs.hunger = `${foodCount} food items carried`;
    try { obs.onFire = !!bot.getComponent(EntityComponentTypes.OnFire); } catch (e) { /* ignore */ }
    try { obs.inWater = !!bot.isInWater; } catch (e) { /* ignore */ }
    const status = [];
    if (status.length) obs.status = status.join(", ");

    const inv = inventoryMap(bot);
    obs.inventory = Object.entries(inv).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([id, n]) => `${nameOf(id)} x${n}`);
    if (foodCount) obs.inventory.push(...Object.entries(food).filter(([, n]) => n > 0).map(([id, n]) => `${nameOf(id)} x${n} (food)`));
    const eq = equipmentOf(bot);
    if (eq) obs.equipment = eq;

    const home = brain?.memory?.home;
    if (home) obs.home = `${fmtPos(home)}${home.dim ? " in " + dimensionLabel(home.dim) : ""} (${Math.round(dist(loc, home))}m away)`;
    try { obs.goal = bot.getDynamicProperty("rg:current_goal") || brain?.memory?.goal || null; } catch (e) { /* ignore */ }
    if (obs.goal === "idle") obs.goal = null;
    obs.job = jobLine(bot, brain);
    obs.lastActions = extras.lastActions || [];

    // entities
    let ents = [];
    try { ents = bot.dimension.getEntities({ location: loc, maxDistance: ENTITY_R }); } catch (e) { ents = []; }
    const players = [], bots = [], hostiles = [], animals = [], items = [];
    for (const e of ents) {
        if (e.id === bot.id) continue;
        let typeId;
        try { typeId = e.typeId; } catch (e2) { continue; }
        if (typeId === "minecraft:player") players.push(playerLine(bot, e));
        else if (typeId === "rg:bot") {
            let extra = "";
            try { const m = e.getDynamicProperty("rg:mood"); const g = e.getDynamicProperty("rg:current_goal"); extra = [m && m !== "neutral" ? m : "", g && g !== "idle" ? "doing: " + g : ""].filter(Boolean).join(", "); } catch (e2) { /* ignore */ }
            bots.push(`${e.nameTag || "bot"} ${Math.round(dist(loc, e.location))}m ${dirName(loc, e.location)}${extra ? " (" + extra + ")" : ""}`);
        } else if (typeId === "minecraft:item") {
            if (dist(loc, e.location) <= ITEM_R) {
                try { const s = e.getComponent(EntityComponentTypes.Item)?.itemStack; if (s) items.push(`${nameOf(s.typeId)} x${s.amount} ${Math.round(dist(loc, e.location))}m ${dirName(loc, e.location)}`); } catch (e2) { /* ignore */ }
            }
        } else if (typeId === "rg:build_target" || typeId === "rg:melee_attack_throw" || /ball$|arrow$|snowball$|xp_orb$/.test(typeId)) {
            continue;
        } else if (isHostile(e)) {
            hostiles.push(entityLine(bot, e, isModdedId(typeId) ? "(modded)" : ""));
        } else if (isAnimalish(e)) {
            animals.push(entityLine(bot, e));
        }
    }
    obs.players = players.slice(0, 8);
    obs.bots = bots.slice(0, 8);
    obs.hostiles = hostiles.slice(0, 10);
    obs.animals = animals.slice(0, 8);
    obs.items = items.slice(0, 8);

    try { obs.blocks = scanBlocks(bot); } catch (e) { obs.blocks = []; }

    // world line
    const w = [];
    try { w.push(`${world.getAllPlayers().length} players online`); } catch (e) { /* ignore */ }
    obs.world = w.join("; ");

    obs.events = extras.events || [];
    obs.requests = extras.requests || [];
    obs.newChat = extras.newChat || [];
    obs.problems = extras.problems || [];
    return obs;
}
