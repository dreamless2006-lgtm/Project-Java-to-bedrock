// Executes the model's actions on the bot body. One action runs at a time;
// long-running ones are state machines stepped every 10 ticks. Every action
// ends with a one-line result that goes into the next observation.
import { world, system, ItemStack, EntityComponentTypes, EquipmentSlot, EntityDamageCause } from "@minecraft/server";
import { requestMove, releaseMove, NAV } from "../ai_navigation.js";
import { jump, faceBlock } from "../ai_player_physics.js";
import { assignFriendTask, getFriendTask, hasJob } from "../ai_task_worker.js";
import { setAITarget, clearAITarget } from "../ai_combat_tactics.js";
import { challengeToDuel } from "../ai_duels.js";
import { dist, dirName, fmtPos, inventoryMap, containerOf, healthOf, virtualFood } from "./perception.js";
import { nameOf, isModdedId, srpMobInfo } from "./world_content.js";
import { craftPlan, smeltPlan, isLog, isPlanks } from "./crafting.js";
import { getWorldConfig } from "./config.js";

const SOURCE = "llm";
const PRIO = NAV.TASK + 2;          // beats jobs, loses to survival/combat/water reflexes
const STEP = 10;                    // ticks between steps (core calls tick() at this cadence)
const REACH = 4.6;                  // block reach measured from the eyes
const MOVE_TIMEOUT = 20 * 90;
const BUILD_MAX = 400;
const WEAPON_RANK = ["netherite_sword", "diamond_sword", "iron_sword", "netherite_axe", "diamond_axe", "stone_sword", "iron_axe", "golden_sword", "wooden_sword", "stone_axe", "wooden_axe", "srp:sentient_sword", "srp:living_sword", "srp:sentient_axe", "srp:living_axe"];
const TOOL_RANK = { pickaxe: ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "golden_pickaxe", "wooden_pickaxe"], axe: ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "golden_axe", "wooden_axe"], shovel: ["netherite_shovel", "diamond_shovel", "iron_shovel", "stone_shovel", "wooden_shovel"], sword: WEAPON_RANK, bow: ["bow", "crossbow"] };
const ARMOR_RANK = ["netherite", "diamond", "iron", "chainmail", "golden", "leather", "srp:sentient", "srp:living"];
const DIM_IDS = { overworld: "minecraft:overworld", nether: "minecraft:nether", end: "minecraft:the_end" };

// ---------------------------------------------------------------- helpers ---
function eye(bot) { return { x: bot.location.x, y: bot.location.y + 1.62, z: bot.location.z }; }
function center(p) { return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5, z: Math.floor(p.z) + 0.5 }; }
function blockAt(dim, x, y, z) { try { return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); } catch (e) { return undefined; } }
function near(bot, target, r) { return dist(bot.location, target) <= r; }
// Block.isSolid is beta-only; "not air and not liquid" is what we need for footing/placement.
function solid(b) { return !!b && !b.isAir && !b.isLiquid; }
function goTo(bot, target, mode = "sprint", prio = PRIO, enterWater = false) { requestMove(bot, target, { priority: prio, source: SOURCE, mode, ttl: STEP * 3, enterWater }); }
function stopMoving(bot) { releaseMove(bot, SOURCE); }
function lookAt(bot, target) { try { faceBlock(bot, target); } catch (e) { /* ignore */ } }
function say(brain, text) { try { brain.sayNow(text); } catch (e) { /* ignore */ } }
function cfg() { return getWorldConfig(); }

export function findPlayer(name) {
    if (!name) return null;
    const q = String(name).toLowerCase().replace(/^@/, "");
    let players = [];
    try { players = world.getAllPlayers(); } catch (e) { return null; }
    return players.find(p => p.name.toLowerCase() === q) || players.find(p => p.name.toLowerCase().startsWith(q)) || players.find(p => (p.nameTag || "").toLowerCase().includes(q)) || null;
}

export function findEntityByName(bot, name, range = 48) {
    if (!name) return null;
    const q = String(name).toLowerCase().replace(/^@/, "").trim();
    const player = findPlayer(q);
    if (player) return player;
    let ents = [];
    try { ents = bot.dimension.getEntities({ location: bot.location, maxDistance: range }); } catch (e) { return null; }
    let best = null, bestD = Infinity;
    for (const e of ents) {
        if (e.id === bot.id) continue;
        let tag = "", type = "", pretty = "";
        try { tag = (e.nameTag || "").toLowerCase(); type = e.typeId.toLowerCase(); pretty = nameOf(e.typeId).toLowerCase(); } catch (e2) { continue; }
        const hit = tag === q || tag.startsWith(q) || type === q || type.endsWith(":" + q) || type.endsWith(":" + q.replace(/\s+/g, "_")) || pretty === q || (q.length > 3 && (pretty.includes(q) || tag.includes(q)));
        if (!hit) continue;
        const d = dist(bot.location, e.location);
        if (d < bestD) { best = e; bestD = d; }
    }
    return best;
}

function takeItems(container, typeId, amount) {
    let left = amount;
    for (let i = 0; i < container.size && left > 0; i++) {
        let s;
        try { s = container.getItem(i); } catch (e) { continue; }
        if (!s || s.typeId !== typeId) continue;
        if (s.amount <= left) { left -= s.amount; container.setItem(i, undefined); }
        else { s.amount -= left; container.setItem(i, s); left = 0; }
    }
    return amount - left;
}

function giveItems(container, typeId, amount) {
    let left = amount;
    while (left > 0) {
        const n = Math.min(64, left);
        let rest;
        try { rest = container.addItem(new ItemStack(typeId, n)); } catch (e) { return amount - left; }
        left -= n;
        if (rest) { left += rest.amount; break; }
    }
    return amount - Math.max(0, left);
}

function resolveItemId(bot, name) {
    const q = String(name || "").toLowerCase().trim().replace(/\s+/g, "_");
    if (!q) return null;
    const inv = inventoryMap(bot);
    const ids = Object.keys(inv);
    return ids.find(id => id === q || id === "minecraft:" + q) || ids.find(id => id.endsWith(":" + q)) || ids.find(id => nameOf(id).toLowerCase().replace(/\s+/g, "_") === q) || ids.find(id => id.includes(q) || nameOf(id).toLowerCase().includes(q.replace(/_/g, " "))) || null;
}

function materialBlockId(bot, wanted) {
    if (wanted) {
        const q = String(wanted).toLowerCase().replace(/\s+/g, "_");
        const inInv = resolveItemId(bot, q);
        if (inInv) return inInv;
        return q.includes(":") ? q : "minecraft:" + q;
    }
    const inv = inventoryMap(bot);
    const pref = Object.keys(inv).find(id => isPlanks(id)) || Object.keys(inv).find(id => /cobblestone|stone_bricks|bricks|sandstone|deepslate/.test(id)) || Object.keys(inv).find(id => isLog(id));
    return pref || "minecraft:cobblestone";
}

function placeBlock(bot, pos, blockId) {
    const dim = bot.dimension;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    const b = blockAt(dim, x, y, z);
    if (!b) return { ok: false, reason: "chunk not loaded" };
    if (!b.isAir && !b.isLiquid && !/grass$|tallgrass|snow_layer|fern|double_plant|seagrass/.test(b.typeId)) return { ok: false, reason: `${nameOf(b.typeId)} is already there` };
    const c = containerOf(bot);
    const inv = inventoryMap(bot);
    if (!cfg().freeBuild) {
        if (!inv[blockId]) return { ok: false, reason: `no ${nameOf(blockId)} in inventory` };
        takeItems(c, blockId, 1);
    } else if (inv[blockId]) {
        takeItems(c, blockId, 1);
    }
    try {
        lookAt(bot, { x: x + 0.5, y, z: z + 0.5 });
        try { bot.playAnimation("set_block"); } catch (e) { /* ignore */ }
        const r = dim.runCommand(`setblock ${x} ${y} ${z} ${blockId}`);
        if (!r || r.successCount === 0) {
            if (!cfg().freeBuild) giveItems(c, blockId, 1);
            return { ok: false, reason: `cannot place ${nameOf(blockId)} (unknown block?)` };
        }
        try { dim.playSound(/wool|cloth/.test(blockId) ? "dig.cloth" : /planks|log|wood/.test(blockId) ? "dig.wood" : "dig.stone", { x, y, z }); } catch (e) { /* ignore */ }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: String(e?.message || e) };
    }
}

function breakBlock(bot, pos) {
    const dim = bot.dimension;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    const b = blockAt(dim, x, y, z);
    if (!b) return { ok: false, reason: "chunk not loaded" };
    if (b.isAir) return { ok: false, reason: "nothing there" };
    if (/bedrock|barrier|end_portal_frame|command_block/.test(b.typeId)) return { ok: false, reason: `${nameOf(b.typeId)} cannot be broken` };
    const id = b.typeId;
    try {
        lookAt(bot, { x: x + 0.5, y, z: z + 0.5 });
        try { bot.playAnimation("mine"); } catch (e) { /* ignore */ }
        dim.runCommand(`setblock ${x} ${y} ${z} minecraft:air destroy`);
        try { dim.playSound(/log|wood|planks|leaves/.test(id) ? "dig.wood" : "dig.stone", { x, y, z }); } catch (e) { /* ignore */ }
        return { ok: true, id };
    } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

function collectNearbyItems(bot, radius = 4) {
    const c = containerOf(bot);
    if (!c) return 0;
    let got = 0;
    let items = [];
    try { items = bot.dimension.getEntities({ location: bot.location, maxDistance: radius, type: "minecraft:item" }); } catch (e) { return 0; }
    for (const it of items) {
        try {
            if (it.hasTag("rg:delivered")) continue;
            const s = it.getComponent(EntityComponentTypes.Item)?.itemStack;
            if (!s) continue;
            const rest = c.addItem(s);
            if (!rest) { it.remove(); got += s.amount; }
            else if (rest.amount < s.amount) { it.getComponent(EntityComponentTypes.Item); got += s.amount - rest.amount; it.remove(); bot.dimension.spawnItem(rest, it.location); }
        } catch (e) { /* ignore */ }
    }
    return got;
}

function findBlocks(bot, pred, radius = 12, dy = 4, limit = 1) {
    const dim = bot.dimension;
    const cx = Math.floor(bot.location.x), cy = Math.floor(bot.location.y), cz = Math.floor(bot.location.z);
    const out = [];
    for (let r = 0; r <= radius; r++) {
        for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
            for (let y = -dy; y <= dy; y++) {
                const b = blockAt(dim, cx + x, cy + y, cz + z);
                if (b && pred(b)) { out.push(b); if (out.length >= limit) return out; }
            }
        }
    }
    return out;
}

function findSafeSpot(dim, x, z, yHint) {
    const top = dim.id === "minecraft:nether" ? 120 : (dim.id === "minecraft:the_end" ? 120 : 250);
    try {
        if (dim.id !== "minecraft:nether") {
            const t = dim.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
            if (t && !t.isLiquid) return { x: Math.floor(x) + 0.5, y: t.y + 1, z: Math.floor(z) + 0.5 };
        }
    } catch (e) { /* unloaded */ }
    const start = Math.min(top, Math.max(10, Math.floor(yHint || 64) + 24));
    for (let y = start; y >= 2; y--) {
        const b = blockAt(dim, x, y, z), a1 = blockAt(dim, x, y + 1, z), a2 = blockAt(dim, x, y + 2, z);
        if (!b || !a1 || !a2) continue;
        if (solid(b) && a1.isAir && a2.isAir && !/lava/.test(b.typeId)) return { x: Math.floor(x) + 0.5, y: y + 1, z: Math.floor(z) + 0.5 };
    }
    return null;
}

// --------------------------------------------------------- blueprints ---
export function presetBlueprint(preset, material, size = {}) {
    const w = Math.max(3, Math.min(16, size.width || 5)), d = Math.max(3, Math.min(16, size.depth || 5)), h = Math.max(2, Math.min(12, size.height || 3));
    const bp = [];
    const put = (dx, dy, dz, block = material) => bp.push({ dx, dy, dz, block });
    const hx = Math.floor(w / 2), hz = Math.floor(d / 2);
    switch (preset) {
        case "house": {
            for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
                const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
                for (let y = 0; y < h; y++) {
                    const isDoor = z === 0 && x === hx && y < 2;
                    if (edge && !isDoor) {
                        const window = y === 1 && !isDoor && ((x === 0 || x === w - 1) ? (z % 2 === 1 && z !== 0 && z !== d - 1) : (x % 2 === 1 && x !== 0 && x !== w - 1 && z === d - 1));
                        put(x - hx, y, z, window ? "minecraft:glass" : material);
                    }
                }
                put(x - hx, h, z, material);                       // flat roof
                if (!edge) put(x - hx, -1, z, material);           // floor
            }
            put(1 - hx, 1, 1, "minecraft:torch"); put(w - 2 - hx, 1, d - 2, "minecraft:torch");
            put(w - 2 - hx, 0, d - 2, "minecraft:crafting_table"); put(1 - hx, 0, d - 2, "minecraft:chest");
            break;
        }
        case "shelter": {
            for (let x = -1; x <= 1; x++) for (let z = 0; z <= 2; z++) for (let y = 0; y <= 2; y++) {
                const edge = x === -1 || x === 1 || z === 0 || z === 2 || y === 2;
                const door = z === 0 && x === 0 && y < 2;
                if (edge && !door) put(x, y, z, material);
            }
            put(0, 1, 1, "minecraft:torch");
            break;
        }
        case "wall": for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) put(x - hx, y, 1); break;
        case "tower": {
            for (let y = 0; y < h; y++) for (let x = -1; x <= 1; x++) for (let z = 0; z <= 2; z++) {
                const edge = x === -1 || x === 1 || z === 0 || z === 2;
                if (edge && !(y < 2 && z === 0 && x === 0)) put(x, y, z);
                if (!edge && y === h - 1) put(x, y, z);
            }
            for (let y = 0; y < h - 1; y++) put(0, y, 2, "minecraft:ladder");
            break;
        }
        case "bridge": for (let z = 1; z <= Math.max(4, w); z++) for (let x = -1; x <= 1; x++) put(x, -1, z); break;
        case "pillar": for (let y = 0; y < h; y++) put(1, y, 1); break;
        case "farm": {
            for (let x = -2; x <= 2; x++) for (let z = 0; z <= 4; z++) {
                if (x === 0 && z === 2) { put(x, -1, z, "minecraft:water"); continue; }
                put(x, -1, z, "minecraft:farmland"); put(x, 0, z, "minecraft:wheat");
            }
            break;
        }
        default: return null;
    }
    return bp;
}

// ------------------------------------------------------------ handlers ---
// Each handler: start(a, ctx) -> {done, result} | state ; step(state, ctx) -> {done, result} | undefined
const H = {};

H.wait = {
    start: (a, ctx) => ({ until: ctx.now + 20 * (a.seconds || 10) }),
    step: (s, ctx) => (ctx.now >= s.until ? { done: true, result: "waited" } : undefined),
};

H.stop = {
    start: (a, ctx) => { ctx.actuator.cancelFollow(); stopMoving(ctx.bot); try { clearAITarget(ctx.bot); } catch (e) { /* ignore */ } ctx.actuator.queue.length = 0; return { done: true, result: "stopped" }; },
};

H.look_at = {
    start: (a, ctx) => {
        const t = a.name ? findEntityByName(ctx.bot, a.name, 64) : null;
        const target = t ? t.location : (a.x !== undefined ? { x: a.x, y: a.y ?? ctx.bot.location.y, z: a.z } : null);
        if (!target) return { done: true, result: `look_at: could not find ${a.name || "target"}` };
        lookAt(ctx.bot, target);
        return { done: true, result: `looking at ${a.name || fmtPos(target)}` };
    },
};

H.move_to = {
    start: (a, ctx) => ({ target: { x: a.x + 0.5, y: a.y, z: a.z + 0.5 }, mode: a.sprint === false ? "walk" : "sprint", started: ctx.now, lastPos: { ...ctx.bot.location }, stuck: 0 }),
    step: (s, ctx) => {
        const bot = ctx.bot;
        if (near(bot, s.target, 1.6) || (Math.abs(bot.location.x - s.target.x) < 1.2 && Math.abs(bot.location.z - s.target.z) < 1.2 && Math.abs(bot.location.y - s.target.y) < 3)) { stopMoving(bot); return { done: true, result: `arrived at ${fmtPos(s.target)}` }; }
        if (ctx.now - s.started > MOVE_TIMEOUT) { stopMoving(bot); return { done: true, result: `gave up walking to ${fmtPos(s.target)} (${Math.round(dist(bot.location, s.target))}m left, blocked?)` }; }
        goTo(bot, s.target, s.mode, PRIO, true);
        const moved = dist(bot.location, s.lastPos);
        s.stuck = moved < 0.15 ? s.stuck + 1 : 0;
        s.lastPos = { ...bot.location };
        if (s.stuck === 6) { try { jump(bot); } catch (e) { /* ignore */ } }
        if (s.stuck > 24) { stopMoving(bot); return { done: true, result: `stuck on the way to ${fmtPos(s.target)} (${Math.round(dist(bot.location, s.target))}m left); try break_block or another route` }; }
        return undefined;
    },
};

H.go_to_player = {
    start: (a, ctx) => {
        const t = findEntityByName(ctx.bot, a.name, 160);
        if (!t) return { done: true, result: `go_to_player: nobody called ${a.name} is nearby` };
        if (t.dimension?.id !== ctx.bot.dimension.id) return { done: true, result: `${a.name} is in another dimension` };
        return { targetId: t.id, name: a.name, started: ctx.now };
    },
    step: (s, ctx) => {
        let t; try { t = world.getEntity(s.targetId); } catch (e) { t = null; }
        if (!t || !t.isValid) { stopMoving(ctx.bot); return { done: true, result: `${s.name} is gone` }; }
        if (near(ctx.bot, t.location, 2.5)) { stopMoving(ctx.bot); lookAt(ctx.bot, t.location); return { done: true, result: `reached ${s.name}` }; }
        if (ctx.now - s.started > MOVE_TIMEOUT) { stopMoving(ctx.bot); return { done: true, result: `could not reach ${s.name}` }; }
        goTo(ctx.bot, t.location, "sprint", PRIO, true);
        return undefined;
    },
};

H.follow = {
    start: (a, ctx) => {
        const t = findEntityByName(ctx.bot, a.name, 160);
        if (!t) return { done: true, result: `follow: nobody called ${a.name} is nearby` };
        ctx.actuator.follow = { targetId: t.id, name: a.name };
        return { done: true, result: `following ${a.name} (use stop to end)` };
    },
};

H.flee = {
    start: (a, ctx) => {
        let from = null;
        if (a.from) { const t = findEntityByName(ctx.bot, a.from, 48); if (t) from = t.location; }
        if (!from) {
            let hostiles = [];
            try { hostiles = ctx.bot.dimension.getEntities({ location: ctx.bot.location, maxDistance: 16, families: ["monster"] }); } catch (e) { /* ignore */ }
            if (hostiles.length) from = hostiles[0].location;
        }
        if (!from) return { done: true, result: "nothing to flee from" };
        const b = ctx.bot.location;
        const dx = b.x - from.x, dz = b.z - from.z, len = Math.hypot(dx, dz) || 1;
        return { target: { x: b.x + dx / len * 24, y: b.y, z: b.z + dz / len * 24 }, until: ctx.now + 20 * 8 };
    },
    step: (s, ctx) => { if (ctx.now >= s.until) { stopMoving(ctx.bot); return { done: true, result: "ran away" }; } goTo(ctx.bot, s.target, "panic", NAV.SURVIVAL - 1, true); return undefined; },
};

H.attack = {
    start: (a, ctx) => {
        const t = findEntityByName(ctx.bot, a.name, 48);
        if (!t) return { done: true, result: `attack: no ${a.name} nearby` };
        if (t.typeId === "minecraft:player" && t.hasTag("aisb_bridge")) return { done: true, result: "that is the relay account, leave it alone" };
        try { setAITarget(ctx.bot, t); ctx.bot.addTag("allow_attack"); ctx.bot.applyDamage(0, { cause: EntityDamageCause.entityAttack, damagingEntity: t }); } catch (e) { /* ignore */ }
        equipBest(ctx.bot, "sword");
        return { targetId: t.id, name: a.name, started: ctx.now, startHp: healthOf(t)?.hp };
    },
    step: (s, ctx) => {
        let t; try { t = world.getEntity(s.targetId); } catch (e) { t = null; }
        const bot = ctx.bot;
        if (!t || !t.isValid) { clearAITarget(bot); stopMoving(bot); try { bot.removeTag("allow_attack"); } catch (e) { /* ignore */ } return { done: true, result: `${s.name} is dead or gone` }; }
        if (ctx.now - s.started > 20 * 60) { clearAITarget(bot); stopMoving(bot); return { done: true, result: `stopped chasing ${s.name} after a minute (hp now ${healthOf(t)?.hp ?? "?"})` }; }
        try { bot.addTag("allow_attack"); } catch (e) { /* ignore */ }
        const d = dist(bot.location, t.location);
        if (d > 2.4) goTo(bot, t.location, "sprint", NAV.COMBAT + 1, true);
        else { stopMoving(bot); lookAt(bot, t.location); if (ctx.now - (s.lastHit || 0) >= 20) { s.lastHit = ctx.now; try { t.applyDamage(meleeDamage(bot), { cause: EntityDamageCause.entityAttack, damagingEntity: bot }); bot.playAnimation("animation.humanoid.attack.rotations"); } catch (e) { /* ignore */ } } }
        return undefined;
    },
};

function meleeDamage(bot) {
    const inv = inventoryMap(bot);
    const held = WEAPON_RANK.find(w => inv["minecraft:" + w] || inv[w]);
    if (!held) return 2;
    if (/netherite/.test(held)) return 8; if (/diamond/.test(held)) return 7; if (/iron|sentient/.test(held)) return 6; if (/stone|living/.test(held)) return 5; return 4;
}

H.defend = {
    start: (a, ctx) => {
        try { ctx.bot.addTag("allow_attack"); } catch (e) { /* ignore */ }
        const protect = a.protect ? findEntityByName(ctx.bot, a.protect, 64) : null;
        if (protect) ctx.actuator.follow = { targetId: protect.id, name: a.protect, guard: true };
        return { until: ctx.now + 20 * 30, protect: a.protect };
    },
    step: (s, ctx) => {
        if (ctx.now >= s.until) return { done: true, result: `stood guard${s.protect ? " near " + s.protect : ""}` };
        try { ctx.bot.addTag("allow_attack"); } catch (e) { /* ignore */ }
        let hostiles = [];
        try { hostiles = ctx.bot.dimension.getEntities({ location: ctx.bot.location, maxDistance: 12, families: ["monster"] }); } catch (e) { /* ignore */ }
        const t = hostiles[0];
        if (t) { try { setAITarget(ctx.bot, t); } catch (e) { /* ignore */ } if (dist(ctx.bot.location, t.location) > 2.4) goTo(ctx.bot, t.location, "sprint", NAV.COMBAT + 1); else if (ctx.now - (s.lastHit || 0) >= 20) { s.lastHit = ctx.now; try { t.applyDamage(meleeDamage(ctx.bot), { cause: EntityDamageCause.entityAttack, damagingEntity: ctx.bot }); } catch (e) { /* ignore */ } } }
        return undefined;
    },
};

H.gather = {
    start: (a, ctx) => {
        if (hasJob(ctx.bot)) return { done: true, result: "already on a gathering job (use stop first)" };
        const m = String(a.material).toLowerCase().replace(/\s+/g, "_").replace(/^minecraft:/, "");
        const kind = /log|wood|tree|oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry/.test(m) ? "chop" : "mine";
        let want = m === "wood" || m === "logs" || m === "log" ? null : m.replace(/_log$/, "");
        if (kind === "mine" && /^(stone|cobblestone|dirt|sand|gravel|anything|ore|ores)$/.test(m)) want = null;
        const owner = ctx.brain.ownerPlayer();
        const ok = assignFriendTask(ctx.bot, owner || null, kind, { want, amount: a.amount || 16, durationTicks: 20 * 60 * 6 });
        if (!ok) return { done: true, result: "could not start the job" };
        return { kind, want: want || "anything", started: ctx.now };
    },
    step: (s, ctx) => {
        const t = getFriendTask(ctx.bot);
        if (!t) { collectNearbyItems(ctx.bot, 6); const inv = inventoryMap(ctx.bot); return { done: true, result: `${s.kind} job finished (${s.want}); inventory now has ${Object.entries(inv).slice(0, 6).map(([id, n]) => nameOf(id) + " x" + n).join(", ") || "nothing new"}` }; }
        if (ctx.now - s.started > 20 * 60 * 6) return { done: true, result: `${s.kind} job still running in the background` };
        return undefined;
    },
};

H.mine_down = {
    start: (a, ctx) => {
        if (hasJob(ctx.bot)) return { done: true, result: "already on a job" };
        const ok = assignFriendTask(ctx.bot, ctx.brain.ownerPlayer() || null, "mine", { want: null, amount: 24, durationTicks: 20 * 60 * 5 });
        return ok ? { started: ctx.now } : { done: true, result: "could not start mining" };
    },
    step: H.gather.step,
};

H.explore = {
    start: (a, ctx) => {
        const dirs = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
        let [dx, dz] = dirs[a.direction] || [0, 0];
        if (!dx && !dz) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); }
        const b = ctx.bot.location;
        const range = 60 + Math.random() * 60;
        return { target: { x: b.x + dx * range, y: b.y, z: b.z + dz * range }, started: ctx.now, lookingFor: a.looking_for, lastPos: { ...b }, stuck: 0 };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        if (s.lookingFor) {
            const q = String(s.lookingFor).toLowerCase();
            if (/player|someone|people/.test(q)) { const p = world.getAllPlayers().find(p => dist(p.location, bot.location) < 24 && p.dimension.id === bot.dimension.id); if (p) { stopMoving(bot); return { done: true, result: `found ${p.name}` }; } }
            else { const found = findBlocks(bot, b => b.typeId.includes(q.replace(/\s+/g, "_")), 10, 4, 1)[0]; if (found) { stopMoving(bot); return { done: true, result: `found ${nameOf(found.typeId)} at ${fmtPos(found)}` }; } }
        }
        if (Math.abs(bot.location.x - s.target.x) < 3 && Math.abs(bot.location.z - s.target.z) < 3) { stopMoving(bot); return { done: true, result: "explored to " + fmtPos(bot.location) }; }
        if (ctx.now - s.started > MOVE_TIMEOUT) { stopMoving(bot); return { done: true, result: `explored for a while, now at ${fmtPos(bot.location)}` }; }
        const top = findSafeSpot(bot.dimension, s.target.x, s.target.z, bot.location.y);
        goTo(bot, top || s.target, "sprint", PRIO, true);
        const moved = dist(bot.location, s.lastPos); s.stuck = moved < 0.15 ? s.stuck + 1 : 0; s.lastPos = { ...bot.location };
        if (s.stuck === 6) { try { jump(bot); } catch (e) { /* ignore */ } }
        if (s.stuck > 30) { stopMoving(bot); return { done: true, result: `blocked while exploring at ${fmtPos(bot.location)}` }; }
        return undefined;
    },
};

H.build = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const material = materialBlockId(bot, a.material);
        let bp = a.preset === "custom" ? a.blueprint : presetBlueprint(a.preset, material, { width: a.width, height: a.height, depth: a.depth });
        if (!bp || !bp.length) return { done: true, result: `unknown build preset '${a.preset}'` };
        if (bp.length > BUILD_MAX) bp = bp.slice(0, BUILD_MAX);
        const yaw = (() => { try { return bot.getRotation().y; } catch (e) { return 0; } })();
        const snapped = Math.round(((yaw % 360) + 360) % 360 / 90) % 4;    // 0:+z(south) 1:-x(west) 2:-z(north) 3:+x(east)
        const rot = ([dx, dz]) => snapped === 0 ? [dx, dz] : snapped === 1 ? [-dz, dx] : snapped === 2 ? [-dx, -dz] : [dz, -dx];
        const ox = a.x !== undefined ? Math.floor(a.x) : Math.floor(bot.location.x) + rot([0, 3])[0];
        const oz = a.z !== undefined ? Math.floor(a.z) : Math.floor(bot.location.z) + rot([0, 3])[1];
        const oy = a.y !== undefined ? Math.floor(a.y) : Math.floor(bot.location.y);
        const steps = bp.map(b => { const [rx, rz] = rot([b.dx, b.dz]); return { x: ox + rx, y: oy + b.dy, z: oz + rz, block: b.block || material }; });
        steps.sort((p, q) => p.y - q.y || dist(bot.location, p) - dist(bot.location, q));
        try { bot.addTag("is_busy_building"); bot.triggerEvent("cancel_stroll"); } catch (e) { /* ignore */ }
        say(ctx.brain, null);
        return { steps, i: 0, placed: 0, skipped: 0, name: a.name || a.preset, waiting: 0, origin: { x: ox, y: oy, z: oz } };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        const finish = (msg) => { stopMoving(bot); try { bot.removeTag("is_busy_building"); bot.triggerEvent("stroll_switch"); } catch (e) { /* ignore */ } return { done: true, result: msg }; };
        for (let n = 0; n < 2; n++) {
            if (s.i >= s.steps.length) return finish(`finished building ${s.name} at ${fmtPos(s.origin)}: ${s.placed} blocks placed${s.skipped ? `, ${s.skipped} skipped` : ""}`);
            const st = s.steps[s.i];
            const b = blockAt(bot.dimension, st.x, st.y, st.z);
            if (!b) { s.i++; s.skipped++; continue; }
            if (!b.isAir && !b.isLiquid && !/grass$|tallgrass|snow_layer|fern|double_plant/.test(b.typeId)) { s.i++; continue; }
            if (Math.floor(bot.location.x) === st.x && Math.floor(bot.location.z) === st.z && st.y >= Math.floor(bot.location.y) && st.y <= Math.floor(bot.location.y) + 1) {
                // standing in the cell: step aside (skip the block if that keeps failing)
                s.inCell = (s.inCell || 0) + 1;
                if (s.inCell > 12) { s.inCell = 0; s.i++; s.skipped++; continue; }
                goTo(bot, { x: st.x + 1.5, y: st.y, z: st.z + 1.5 }, "walk"); return undefined;
            }
            s.inCell = 0;
            const d = dist(eye(bot), center(st));
            if (d > REACH) {
                goTo(bot, { x: st.x + 0.5, y: st.y, z: st.z + 0.5 }, "walk", PRIO, true);
                s.waiting++;
                if (s.waiting > 40) { s.i++; s.skipped++; s.waiting = 0; }
                return undefined;
            }
            s.waiting = 0;
            stopMoving(bot);
            const r = placeBlock(bot, st, st.block);
            if (r.ok) s.placed++; else { s.skipped++; if (/no .* in inventory/.test(r.reason)) return finish(`stopped building ${s.name}: ${r.reason} (${s.placed} placed)`); }
            s.i++;
            return undefined;
        }
        return undefined;
    },
};

H.place_block = {
    start: (a, ctx) => {
        const id = materialBlockId(ctx.bot, a.block);
        const pos = { x: a.x, y: a.y, z: a.z };
        if (dist(eye(ctx.bot), center(pos)) > REACH + 2) return { pos, id, started: ctx.now };
        const r = placeBlock(ctx.bot, pos, id);
        return { done: true, result: r.ok ? `placed ${nameOf(id)} at ${fmtPos(pos)}` : `could not place ${nameOf(id)}: ${r.reason}` };
    },
    step: (s, ctx) => {
        if (dist(eye(ctx.bot), center(s.pos)) <= REACH) { stopMoving(ctx.bot); const r = placeBlock(ctx.bot, s.pos, s.id); return { done: true, result: r.ok ? `placed ${nameOf(s.id)} at ${fmtPos(s.pos)}` : `could not place ${nameOf(s.id)}: ${r.reason}` }; }
        if (ctx.now - s.started > 20 * 30) { stopMoving(ctx.bot); return { done: true, result: `could not get close enough to ${fmtPos(s.pos)}` }; }
        goTo(ctx.bot, { x: s.pos.x + 0.5, y: s.pos.y, z: s.pos.z + 0.5 }, "walk", PRIO, true);
        return undefined;
    },
};

H.break_block = {
    start: (a, ctx) => ({ pos: { x: a.x, y: a.y, z: a.z }, started: ctx.now }),
    step: (s, ctx) => {
        if (dist(eye(ctx.bot), center(s.pos)) <= REACH) {
            stopMoving(ctx.bot);
            const r = breakBlock(ctx.bot, s.pos);
            if (r.ok) { system.runTimeout(() => { try { collectNearbyItems(ctx.bot, 6); } catch (e) { /* ignore */ } }, 12); }
            return { done: true, result: r.ok ? `broke ${nameOf(r.id)} at ${fmtPos(s.pos)}` : `could not break block: ${r.reason}` };
        }
        if (ctx.now - s.started > 20 * 30) { stopMoving(ctx.bot); return { done: true, result: `could not reach ${fmtPos(s.pos)}` }; }
        goTo(ctx.bot, { x: s.pos.x + 0.5, y: s.pos.y, z: s.pos.z + 0.5 }, "walk", PRIO, true);
        return undefined;
    },
};

H.place_torch = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const inv = inventoryMap(bot);
        if (!cfg().freeBuild && !inv["minecraft:torch"]) return { done: true, result: "no torches in inventory (craft some: coal + stick)" };
        const bx = Math.floor(bot.location.x), by = Math.floor(bot.location.y), bz = Math.floor(bot.location.z);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
            const spot = blockAt(bot.dimension, bx + dx, by, bz + dz), below = blockAt(bot.dimension, bx + dx, by - 1, bz + dz);
            if (spot && below && spot.isAir && solid(below)) { const r = placeBlock(bot, { x: bx + dx, y: by, z: bz + dz }, "minecraft:torch"); return { done: true, result: r.ok ? "placed a torch" : "could not place a torch: " + r.reason }; }
        }
        return { done: true, result: "no good spot for a torch here" };
    },
};

H.eat = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const food = virtualFood(bot);
        if (Object.values(food).some(n => n > 0)) { try { bot.addTag("on_eat"); } catch (e) { /* ignore */ } return { until: ctx.now + 20 * 4, virtual: true }; }
        const c = containerOf(bot);
        const inv = inventoryMap(bot);
        for (const id of Object.keys(inv)) {
            let nutrition = 0;
            try { const f = new ItemStack(id, 1).getComponent("minecraft:food"); if (f) nutrition = f.nutrition || 4; } catch (e) { /* ignore */ }
            if (!nutrition && !/cooked_|bread|apple|carrot|potato|melon|berries|cookie|pie|stew|porkchop|beef|chicken|mutton|cod|salmon|rabbit/.test(id)) continue;
            takeItems(c, id, 1);
            try { bot.addEffect("instant_health", 1, { amplifier: Math.max(0, Math.round((nutrition || 4) / 4) - 1), showParticles: false }); bot.addEffect("regeneration", 20 * 5, { amplifier: 0, showParticles: false }); bot.playAnimation("eat_item_custom"); bot.dimension.playSound("random.eat", bot.location); } catch (e) { /* ignore */ }
            return { done: true, result: `ate ${nameOf(id)}` };
        }
        return { done: true, result: "nothing to eat (hunt animals, pick berries or craft bread)" };
    },
    step: (s, ctx) => (ctx.now >= s.until ? { done: true, result: "ate something" } : undefined),
};

function equipBest(bot, tool) {
    const inv = inventoryMap(bot);
    const c = containerOf(bot);
    const rank = TOOL_RANK[tool] || WEAPON_RANK;
    const best = rank.map(r => (r.includes(":") ? r : "minecraft:" + r)).find(id => inv[id]);
    if (!best) return null;
    try { takeItems(c, best, 1); bot.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${best}`); } catch (e) { return null; }
    return best;
}

H.equip_best = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const inv = inventoryMap(bot);
        const c = containerOf(bot);
        const out = [];
        const held = equipBest(bot, a.tool || "sword");
        if (held) out.push("holding " + nameOf(held));
        for (const [slot, part] of [["slot.armor.head", "helmet|helm"], ["slot.armor.chest", "chestplate|chest"], ["slot.armor.legs", "leggings|pants"], ["slot.armor.feet", "boots"]]) {
            const re = new RegExp(`(${part})$`);
            const best = ARMOR_RANK.map(t => Object.keys(inv).find(id => id.startsWith(t.includes(":") ? t : "minecraft:" + t) && re.test(id))).find(Boolean);
            if (best) { try { takeItems(c, best, 1); bot.runCommand(`replaceitem entity @s ${slot} 0 ${best}`); out.push("wearing " + nameOf(best)); } catch (e) { /* ignore */ } }
        }
        if (inv["minecraft:shield"]) { try { takeItems(c, "minecraft:shield", 1); bot.runCommand("replaceitem entity @s slot.weapon.offhand 0 minecraft:shield"); out.push("shield in offhand"); } catch (e) { /* ignore */ } }
        return { done: true, result: out.length ? out.join(", ") : "nothing better to equip in inventory" };
    },
};

H.use_item = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const id = resolveItemId(bot, a.item);
        if (!id) return { done: true, result: `no ${a.item} in inventory` };
        const c = containerOf(bot);
        const dim = bot.dimension;
        const fwd = (() => { try { const v = bot.getViewDirection(); return { x: v.x, y: v.y, z: v.z }; } catch (e) { return { x: 0, y: 0, z: 1 }; } })();
        const ahead = { x: bot.location.x + fwd.x * 2, y: bot.location.y, z: bot.location.z + fwd.z * 2 };
        try {
            if (id === "minecraft:ender_pearl") { takeItems(c, id, 1); const t = { x: bot.location.x + fwd.x * 10, y: bot.location.y + 1, z: bot.location.z + fwd.z * 10 }; const spot = findSafeSpot(dim, t.x, t.z, t.y) || t; bot.teleport(spot); bot.applyDamage(2); return { done: true, result: "threw an ender pearl and teleported" }; }
            if (id === "minecraft:water_bucket" || id === "minecraft:lava_bucket") { const r = placeBlock(bot, ahead, id.replace("_bucket", "")); if (r.ok) { takeItems(c, id, 1); giveItems(c, "minecraft:bucket", 1); } return { done: true, result: r.ok ? `poured ${nameOf(id)} ahead` : r.reason }; }
            if (id === "minecraft:bucket") { const w = findBlocks(bot, b => b.typeId === "minecraft:water", 4, 2, 1)[0]; if (!w) return { done: true, result: "no water nearby to fill the bucket" }; w.setType("minecraft:air"); takeItems(c, id, 1); giveItems(c, "minecraft:water_bucket", 1); return { done: true, result: "filled a water bucket" }; }
            if (/_boat$|^minecraft:boat$/.test(id)) { takeItems(c, id, 1); dim.spawnEntity("minecraft:boat", ahead); return { done: true, result: "placed a boat (interact with it to ride)" }; }
            if (/_spawn_egg$/.test(id)) { takeItems(c, id, 1); const type = id.replace("_spawn_egg", ""); try { dim.spawnEntity(type, ahead); } catch (e) { dim.spawnEntity(type.replace("minecraft:", ""), ahead); } return { done: true, result: `used ${nameOf(id)}` }; }
            if (id === "srp:quench") { takeItems(c, id, 1); const ball = dim.spawnEntity("srp:quench_ball", { x: bot.location.x + fwd.x, y: bot.location.y + 1.5, z: bot.location.z + fwd.z }); try { ball.applyImpulse({ x: fwd.x * 1.5, y: 0.2, z: fwd.z * 1.5 }); } catch (e) { /* ignore */ } return { done: true, result: "threw a quench" }; }
            if (id === "srp:evolution_lure") { takeItems(c, id, 1); try { const st = await_import_state(); st.addPoints(-Math.max(60, (st.PHASE_POINTS[Math.max(1, st.currentPhase())] || 150) * 0.08)); } catch (e) { /* ignore */ } return { done: true, result: "used an evolution lure: the hive loses ground" }; }
            if (/milk_bucket|golden_apple/.test(id)) { takeItems(c, id, 1); try { ctx.brain.cureSelf(); bot.addEffect("regeneration", 100, { amplifier: 1 }); } catch (e) { /* ignore */ } return { done: true, result: `used ${nameOf(id)}: cured` }; }
            if (/potion/.test(id)) { takeItems(c, id, 1); bot.addEffect("regeneration", 20 * 15, { amplifier: 0 }); return { done: true, result: `drank ${nameOf(id)}` }; }
            if (/^minecraft:(torch|.*_planks|cobblestone|.*_log|dirt|stone|.*_wool|glass|sand|gravel|.*bricks|obsidian)$/.test(id) || (isModdedId(id) && cfg().freeBuild === false && false)) { const r = placeBlock(bot, ahead, id); return { done: true, result: r.ok ? `placed ${nameOf(id)} ahead` : r.reason }; }
            let nutrition = 0;
            try { const f = new ItemStack(id, 1).getComponent("minecraft:food"); if (f) nutrition = f.nutrition || 4; } catch (e) { /* ignore */ }
            if (nutrition) { takeItems(c, id, 1); bot.addEffect("instant_health", 1, { amplifier: 0, showParticles: false }); bot.playAnimation("eat_item_custom"); return { done: true, result: `ate ${nameOf(id)}` }; }
            // Generic: hold it (modded tools/weapons/gadgets work through the engine when held).
            takeItems(c, id, 1);
            bot.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${id}`);
            return { done: true, result: `now holding ${nameOf(id)}${isModdedId(id) ? " (a modded item; its own effects apply while held or when it hits something)" : ""}` };
        } catch (e) {
            return { done: true, result: `use_item failed: ${e?.message || e}` };
        }
    },
};

let srpState = null;
function await_import_state() { return srpState; }
export function attachSrpState(mod) { srpState = mod; }

function tableNearby(bot, id, r = 5) { return findBlocks(bot, b => b.typeId === id || (id === "minecraft:furnace" && b.typeId === "minecraft:lit_furnace"), r, 2, 1)[0] || null; }

function ensureStation(bot, id) {
    if (tableNearby(bot, id)) return { ok: true };
    const inv = inventoryMap(bot);
    if (inv[id] || cfg().freeBuild) {
        const bx = Math.floor(bot.location.x), by = Math.floor(bot.location.y), bz = Math.floor(bot.location.z);
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) {
            const r = placeBlock(bot, { x: bx + dx, y: by, z: bz + dz }, id);
            if (r.ok) return { ok: true, placed: true };
        }
    }
    return { ok: false, reason: `no ${nameOf(id)} nearby and none to place` };
}

H.craft = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const inv = inventoryMap(bot);
        let plan = craftPlan(a.item, a.amount || 1, inv, true);
        if (!plan.ok) return { done: true, result: `cannot craft ${a.item}: ${plan.reason}` };
        if (plan.recipe.station === "crafting_table") { const st = ensureStation(bot, "minecraft:crafting_table"); if (!st.ok) { plan = craftPlan(a.item, a.amount || 1, inv, false); if (!plan.ok) return { done: true, result: `cannot craft ${a.item}: ${st.reason}. Craft a crafting_table first (4 planks)` }; } }
        if (plan.recipe.station === "smithing_table" && !tableNearby(bot, "minecraft:smithing_table")) return { done: true, result: "needs a smithing table nearby" };
        const c = containerOf(bot);
        for (const [id, n] of Object.entries(plan.consume)) takeItems(c, id, n);
        const got = giveItems(c, plan.produce.id, plan.produce.count);
        if (got < plan.produce.count) { try { bot.dimension.spawnItem(new ItemStack(plan.produce.id, plan.produce.count - got), bot.location); } catch (e) { /* ignore */ } }
        try { bot.playAnimation("set_block"); bot.dimension.playSound("random.anvil_use", bot.location); } catch (e) { /* ignore */ }
        return { done: true, result: `crafted ${plan.produce.count} ${nameOf(plan.produce.id)}` };
    },
};

H.smelt = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const inv = inventoryMap(bot);
        const plan = smeltPlan(a.item, inv);
        if (!plan.ok) return { done: true, result: `cannot smelt ${a.item}: ${plan.reason}` };
        const st = ensureStation(bot, "minecraft:furnace");
        if (!st.ok) return { done: true, result: `cannot smelt: ${st.reason} (craft a furnace from 8 cobblestone)` };
        const c = containerOf(bot);
        takeItems(c, plan.input, plan.count); takeItems(c, plan.fuel, plan.fuelCount);
        const f = tableNearby(bot, "minecraft:furnace"); try { if (f && f.typeId === "minecraft:furnace") f.setType("minecraft:lit_furnace"); } catch (e) { /* ignore */ }
        try { bot.triggerEvent("rg:event_go_cooking"); } catch (e) { /* ignore */ }
        return { until: ctx.now + 20 * 10, plan, furnace: f ? { x: f.x, y: f.y, z: f.z } : null };
    },
    step: (s, ctx) => {
        if (ctx.now < s.until) return undefined;
        const c = containerOf(ctx.bot);
        giveItems(c, s.plan.output, s.plan.count);
        try { ctx.bot.triggerEvent("rg:event_stop_cooking"); if (s.furnace) { const f = blockAt(ctx.bot.dimension, s.furnace.x, s.furnace.y, s.furnace.z); if (f && f.typeId === "minecraft:lit_furnace") f.setType("minecraft:furnace"); } } catch (e) { /* ignore */ }
        return { done: true, result: `smelted ${s.plan.count} ${nameOf(s.plan.output)}` };
    },
};

H.drop_item = {
    start: (a, ctx) => {
        const id = resolveItemId(ctx.bot, a.item);
        if (!id) return { done: true, result: `no ${a.item} to drop` };
        const c = containerOf(ctx.bot);
        const n = takeItems(c, id, a.amount || 1);
        if (!n) return { done: true, result: "could not take it from inventory" };
        try { const it = ctx.bot.dimension.spawnItem(new ItemStack(id, n), { x: ctx.bot.location.x, y: ctx.bot.location.y + 0.8, z: ctx.bot.location.z }); it.addTag("rg:delivered"); } catch (e) { /* ignore */ }
        return { done: true, result: `dropped ${n} ${nameOf(id)}` };
    },
};

H.give_item = {
    start: (a, ctx) => {
        const p = findPlayer(a.player) || findEntityByName(ctx.bot, a.player, 64);
        if (!p) return { done: true, result: `${a.player} is not around` };
        const id = resolveItemId(ctx.bot, a.item);
        if (!id) return { done: true, result: `no ${a.item} in inventory` };
        return { targetId: p.id, id, amount: a.amount || 1, name: a.player, started: ctx.now };
    },
    step: (s, ctx) => {
        let t; try { t = world.getEntity(s.targetId); } catch (e) { t = null; }
        if (!t || !t.isValid) return { done: true, result: `${s.name} left` };
        if (near(ctx.bot, t.location, 2.8)) {
            stopMoving(ctx.bot);
            const n = takeItems(containerOf(ctx.bot), s.id, s.amount);
            try { const it = ctx.bot.dimension.spawnItem(new ItemStack(s.id, n), { x: t.location.x, y: t.location.y + 0.5, z: t.location.z }); it.addTag("rg:delivered"); } catch (e) { /* ignore */ }
            try { const k = "sympathy_player_" + t.id; ctx.bot.setDynamicProperty(k, Math.min(100, (ctx.bot.getDynamicProperty(k) || 0) + 3)); } catch (e) { /* ignore */ }
            return { done: true, result: `gave ${n} ${nameOf(s.id)} to ${s.name}` };
        }
        if (ctx.now - s.started > 20 * 40) { stopMoving(ctx.bot); return { done: true, result: `could not reach ${s.name} to hand over the ${nameOf(s.id)}` }; }
        goTo(ctx.bot, t.location, "sprint", PRIO, true);
        return undefined;
    },
};

H.pick_up = {
    start: (a, ctx) => {
        let items = [];
        try { items = ctx.bot.dimension.getEntities({ location: ctx.bot.location, maxDistance: 12, type: "minecraft:item" }); } catch (e) { /* ignore */ }
        items = items.filter(i => { try { return !i.hasTag("rg:delivered"); } catch (e) { return true; } });
        if (!items.length) return { done: true, result: "no items lying around" };
        return { ids: items.map(i => i.id), got: 0, started: ctx.now };
    },
    step: (s, ctx) => {
        s.got += collectNearbyItems(ctx.bot, 3);
        let next = null;
        for (const id of s.ids) { let e; try { e = world.getEntity(id); } catch (e2) { e = null; } if (e && e.isValid) { next = e; break; } }
        if (!next || ctx.now - s.started > 20 * 40) { stopMoving(ctx.bot); return { done: true, result: `picked up ${s.got} items` }; }
        goTo(ctx.bot, next.location, "walk", PRIO, true);
        return undefined;
    },
};

H.open_container = {
    start: (a, ctx) => ({ pos: { x: a.x, y: a.y, z: a.z }, mode: a.mode || "take", items: a.items || [], started: ctx.now }),
    step: (s, ctx) => {
        const bot = ctx.bot;
        if (dist(eye(bot), center(s.pos)) > REACH) { if (ctx.now - s.started > 20 * 30) { stopMoving(bot); return { done: true, result: "could not reach the container" }; } goTo(bot, { x: s.pos.x + 0.5, y: s.pos.y, z: s.pos.z + 0.5 }, "walk", PRIO, true); return undefined; }
        stopMoving(bot);
        const b = blockAt(bot.dimension, s.pos.x, s.pos.y, s.pos.z);
        let inv; try { inv = b?.getComponent("minecraft:inventory"); } catch (e) { inv = null; }
        if (!inv?.container) return { done: true, result: `no container at ${fmtPos(s.pos)}` };
        const chest = inv.container, mine = containerOf(bot);
        const want = s.items.map(x => String(x).toLowerCase().replace(/\s+/g, "_"));
        const matches = id => !want.length || want.some(w => id === w || id.endsWith(":" + w) || id.includes(w));
        let moved = [];
        if (s.mode === "store") {
            for (let i = 0; i < mine.size; i++) { const st = mine.getItem(i); if (!st || !matches(st.typeId) || (!want.length && /sword|pickaxe|axe|shovel|bow|shield|helmet|chestplate|leggings|boots/.test(st.typeId))) continue; const rest = chest.addItem(st); mine.setItem(i, rest); moved.push(nameOf(st.typeId) + " x" + (st.amount - (rest?.amount || 0))); }
        } else {
            for (let i = 0; i < chest.size; i++) { const st = chest.getItem(i); if (!st || !matches(st.typeId)) continue; const rest = mine.addItem(st); chest.setItem(i, rest); moved.push(nameOf(st.typeId) + " x" + (st.amount - (rest?.amount || 0))); if (rest) break; }
        }
        try { bot.playAnimation("set_block"); } catch (e) { /* ignore */ }
        return { done: true, result: moved.length ? `${s.mode === "store" ? "stored" : "took"} ${moved.slice(0, 8).join(", ")}` : `nothing to ${s.mode}` };
    },
};

H.interact = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        if (a.name) {
            const t = findEntityByName(bot, a.name, 24);
            if (!t) return { done: true, result: `no ${a.name} nearby` };
            if (/horse|donkey|mule|camel|boat|minecart|pig|strider/.test(t.typeId)) { try { bot.runCommand(`ride @s start_riding @e[type=${t.typeId},c=1,r=8]`); bot.addTag("is_mounted"); return { done: true, result: `riding ${nameOf(t.typeId)}` }; } catch (e) { return { done: true, result: "could not mount" }; } }
            if (/wolf|cat|parrot/.test(t.typeId)) { try { const tame = t.getComponent(EntityComponentTypes.Tameable); if (tame && !tame.isTamed) { t.setDynamicProperty("rg:ai_owner_id", bot.id); t.triggerEvent("minecraft:on_tame"); return { done: true, result: `tamed the ${nameOf(t.typeId)}` }; } } catch (e) { /* ignore */ } }
            if (t.typeId === "rg:bot" || t.typeId === "minecraft:player") { lookAt(bot, t.location); return { done: true, result: `waved at ${a.name}` }; }
            return { done: true, result: `poked the ${nameOf(t.typeId)}; nothing special happened` };
        }
        const pos = { x: a.x, y: a.y, z: a.z };
        return { pos, started: ctx.now };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        if (dist(eye(bot), center(s.pos)) > REACH) { if (ctx.now - s.started > 20 * 30) { stopMoving(bot); return { done: true, result: "could not reach it" }; } goTo(bot, { x: s.pos.x + 0.5, y: s.pos.y, z: s.pos.z + 0.5 }, "walk", PRIO, true); return undefined; }
        stopMoving(bot);
        const b = blockAt(bot.dimension, s.pos.x, s.pos.y, s.pos.z);
        if (!b) return { done: true, result: "nothing there" };
        const id = b.typeId;
        try {
            if (/_door$|trapdoor|fence_gate/.test(id)) { const p = b.permutation; const open = p.getState("open_bit"); b.setPermutation(p.withState("open_bit", !open)); return { done: true, result: `${open ? "closed" : "opened"} the ${nameOf(id)}` }; }
            if (/lever/.test(id)) { const p = b.permutation; b.setPermutation(p.withState("open_bit", !p.getState("open_bit"))); return { done: true, result: "flipped the lever" }; }
            if (/button/.test(id)) { const p = b.permutation; b.setPermutation(p.withState("button_pressed_bit", true)); system.runTimeout(() => { try { b.setPermutation(p.withState("button_pressed_bit", false)); } catch (e) { /* ignore */ } }, 20); return { done: true, result: "pressed the button" }; }
            if (/bed/.test(id)) { ctx.actuator.enqueueFront({ type: "sleep" }); return { done: true, result: "going to sleep in that bed" }; }
            if (/portal/.test(id)) { ctx.actuator.enqueueFront({ type: "travel", dimension: id.includes("end") ? "end" : (bot.dimension.id === "minecraft:nether" ? "overworld" : "nether") }); return { done: true, result: "stepping into the portal" }; }
            if (/chest|barrel|shulker/.test(id)) { ctx.actuator.enqueueFront({ type: "open_container", x: s.pos.x, y: s.pos.y, z: s.pos.z, mode: "take" }); return { done: true, result: "opening it" }; }
            if (/crafting_table|furnace|anvil|enchanting/.test(id)) return { done: true, result: `standing at the ${nameOf(id)}; use craft/smelt` };
            if (/sweet_berry_bush/.test(id)) { b.setPermutation(b.permutation.withState("growth", 1)); giveItems(containerOf(bot), "minecraft:sweet_berries", 2); return { done: true, result: "picked sweet berries" }; }
            if (/wheat|carrots|potatoes|beetroot/.test(id)) { const g = b.permutation.getState("growth"); if (g >= 7) { const crop = id.replace("minecraft:", "").replace(/s$/, ""); b.setPermutation(b.permutation.withState("growth", 0)); giveItems(containerOf(bot), "minecraft:" + (crop === "carrot" ? "carrot" : crop === "potatoe" ? "potato" : crop), 2); return { done: true, result: `harvested ${nameOf(id)}` }; } return { done: true, result: `${nameOf(id)} is not ripe yet` }; }
        } catch (e) { return { done: true, result: `could not use ${nameOf(id)}: ${e?.message || e}` }; }
        return { done: true, result: `used ${nameOf(id)}; nothing happened${isModdedId(id) ? " (modded block without a scripted interaction)" : ""}` };
    },
};

H.sleep = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const t = world.getTimeOfDay();
        if (t > 1000 && t < 12000) return { done: true, result: "it is daytime, no need to sleep" };
        const bed = findBlocks(bot, b => b.typeId === "minecraft:bed", 12, 3, 1)[0];
        const spot = bed ? { x: bed.x + 0.5, y: bed.y + 0.6, z: bed.z + 0.5 } : null;
        return { spot, started: ctx.now, asleep: false, bedPos: bed ? { x: bed.x, y: bed.y, z: bed.z } : null };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        const t = world.getTimeOfDay();
        if (s.asleep) {
            if (t < 1000 || ctx.now - s.started > 20 * 60 * 3) { try { bot.removeTag("is_sleeping"); bot.isSneaking = false; } catch (e) { /* ignore */ } return { done: true, result: "woke up" }; }
            try { bot.isSneaking = true; } catch (e) { /* ignore */ }
            return undefined;
        }
        if (s.spot && !near(bot, s.spot, 1.4)) { if (ctx.now - s.started > 20 * 30) s.spot = null; else { goTo(bot, s.spot, "walk"); return undefined; } }
        stopMoving(bot);
        try { if (s.spot) bot.teleport(s.spot); bot.addTag("is_sleeping"); bot.isSneaking = true; bot.setDynamicProperty("rg:camp", JSON.stringify({ x: bot.location.x, y: bot.location.y, z: bot.location.z })); } catch (e) { /* ignore */ }
        s.asleep = true;
        if (s.bedPos) ctx.brain.memory.home = ctx.brain.memory.home || { ...s.bedPos, dim: bot.dimension.id };
        return undefined;
    },
};

H.set_home = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const home = a.x !== undefined ? { x: Math.floor(a.x), y: Math.floor(a.y ?? bot.location.y), z: Math.floor(a.z), dim: bot.dimension.id } : { x: Math.floor(bot.location.x), y: Math.floor(bot.location.y), z: Math.floor(bot.location.z), dim: bot.dimension.id };
        ctx.brain.memory.home = home;
        try { bot.setDynamicProperty("rg:home_loc", JSON.stringify(home)); } catch (e) { /* ignore */ }
        ctx.brain.saveMemory();
        return { done: true, result: `home set to ${fmtPos(home)}` };
    },
};

H.go_home = {
    start: (a, ctx) => {
        const home = ctx.brain.memory.home;
        if (!home) return { done: true, result: "no home yet (set_home first)" };
        if (home.dim && home.dim !== ctx.bot.dimension.id) { ctx.actuator.enqueueFront({ type: "move_to", x: home.x, y: home.y, z: home.z }); return { done: true, result: `home is in ${home.dim.replace("minecraft:", "")}; travel there first` }; }
        return H.move_to.start({ x: home.x, y: home.y, z: home.z }, ctx);
    },
    step: H.move_to.step,
};

H.travel = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const targetId = DIM_IDS[a.dimension];
        if (bot.dimension.id === targetId) return { done: true, result: `already in ${a.dimension}` };
        const wantEnd = a.dimension === "end";
        const portalPred = wantEnd ? (b => b.typeId === "minecraft:end_portal") : (b => b.typeId === "minecraft:portal");
        const portal = findBlocks(bot, portalPred, 20, 6, 1)[0];
        if (portal) return { phase: "walk", portal: { x: portal.x, y: portal.y, z: portal.z }, targetId, started: ctx.now, name: a.dimension };
        if (wantEnd) return { done: true, result: "no end portal nearby: find a stronghold (explore underground) or use an existing end portal" };
        if (bot.dimension.id === "minecraft:the_end") return { done: true, result: "no portal nearby in the End; find the return portal at the centre island (0, 0)" };
        // Build a nether portal here.
        const inv = inventoryMap(bot);
        const haveObsidian = (inv["minecraft:obsidian"] || 0) >= 10 && (inv["minecraft:flint_and_steel"] || 0) >= 1;
        if (!haveObsidian && !cfg().freeBuild) return { done: true, result: "no nether portal nearby and not enough materials (need 10 obsidian + flint_and_steel)" };
        const bx = Math.floor(bot.location.x) + 2, by = Math.floor(bot.location.y), bz = Math.floor(bot.location.z);
        const frame = [];
        for (let x = 0; x < 4; x++) for (let y = 0; y < 5; y++) { const edge = x === 0 || x === 3 || y === 0 || y === 4; const corner = (x === 0 || x === 3) && (y === 0 || y === 4); if (edge && !corner) frame.push({ x: bx + x, y: by + y, z: bz, block: "minecraft:obsidian" }); }
        const c = containerOf(bot);
        if (haveObsidian) takeItems(c, "minecraft:obsidian", 10);
        for (const f of frame) { try { bot.dimension.runCommand(`setblock ${f.x} ${f.y} ${f.z} minecraft:obsidian`); } catch (e) { /* ignore */ } }
        for (let x = 1; x <= 2; x++) for (let y = 1; y <= 3; y++) { try { bot.dimension.runCommand(`setblock ${bx + x} ${by + y} ${bz} minecraft:portal ["portal_axis":"x"]`); } catch (e) { /* ignore */ } }
        try { bot.dimension.playSound("fire.ignite", { x: bx + 1, y: by + 1, z: bz }); } catch (e) { /* ignore */ }
        return { phase: "walk", portal: { x: bx + 1, y: by + 1, z: bz }, targetId, started: ctx.now, name: a.dimension, built: true };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        if (s.phase === "walk") {
            if (near(bot, { x: s.portal.x + 0.5, y: s.portal.y, z: s.portal.z + 0.5 }, 2.2)) { stopMoving(bot); s.phase = "go"; s.at = ctx.now; return undefined; }
            if (ctx.now - s.started > MOVE_TIMEOUT) { stopMoving(bot); return { done: true, result: "could not reach the portal" }; }
            goTo(bot, { x: s.portal.x + 0.5, y: s.portal.y, z: s.portal.z + 0.5 }, "walk", PRIO, true);
            return undefined;
        }
        if (ctx.now - s.at < 40) return undefined;    // a moment in the portal
        const from = bot.dimension.id;
        const to = world.getDimension(s.targetId);
        let x = bot.location.x, z = bot.location.z, y = bot.location.y;
        if (s.targetId === "minecraft:nether" && from === "minecraft:overworld") { x /= 8; z /= 8; }
        else if (s.targetId === "minecraft:overworld" && from === "minecraft:nether") { x *= 8; z *= 8; }
        else if (s.targetId === "minecraft:the_end") { x = 100; z = 0; y = 50; }
        else if (s.targetId === "minecraft:overworld" && from === "minecraft:the_end") { const home = ctx.brain.memory.home; x = home?.x ?? 0; z = home?.z ?? 0; y = home?.y ?? 70; }
        const spot = findSafeSpot(to, x, z, y) || { x: Math.floor(x) + 0.5, y: Math.max(5, Math.min(120, y)), z: Math.floor(z) + 0.5 };
        try {
            stopMoving(bot);
            try { if (hasJob(bot)) ctx.actuator.cancelJob(); } catch (e) { /* ignore */ }
            bot.teleport(spot, { dimension: to });
            const botRef = bot;
            system.runTimeout(() => {
                try {
                    const b = botRef.dimension.getBlock({ x: Math.floor(botRef.location.x), y: Math.floor(botRef.location.y) - 1, z: Math.floor(botRef.location.z) });
                    if (b && (b.isAir || b.isLiquid)) botRef.dimension.runCommand(`fill ${Math.floor(botRef.location.x) - 1} ${Math.floor(botRef.location.y) - 1} ${Math.floor(botRef.location.z) - 1} ${Math.floor(botRef.location.x) + 1} ${Math.floor(botRef.location.y) - 1} ${Math.floor(botRef.location.z) + 1} ${s.targetId === "minecraft:the_end" ? "minecraft:obsidian" : "minecraft:cobblestone"} keep`);
                } catch (e) { /* ignore */ }
            }, 10);
            ctx.brain.rememberPortal(from, s.portal);
            return { done: true, result: `travelled to ${s.name}; now at ${fmtPos(spot)}` };
        } catch (e) {
            return { done: true, result: `could not change dimension: ${e?.message || e}` };
        }
    },
};

H.trade = {
    start: (a, ctx) => {
        const p = findPlayer(a.player);
        if (!p) return { done: true, result: `${a.player} is not online` };
        const offerId = resolveItemId(ctx.bot, a.offer);
        if (!offerId) return { done: true, result: `I don't have ${a.offer} to offer` };
        ctx.brain.pendingTrade = { playerId: p.id, offerId, want: a.want, until: ctx.now + 20 * 90 };
        return { done: true, result: `offered ${nameOf(offerId)} for ${a.want} to ${p.name}; if they say yes and hand over ${a.want}, the trade completes` };
    },
};

H.duel = {
    start: (a, ctx) => {
        const p = findPlayer(a.name);
        if (!p) return { done: true, result: `${a.name} is not a player here` };
        const ok = challengeToDuel(p, ctx.bot);
        return { done: true, result: ok ? `challenged ${p.name} to a duel` : "could not start a duel (duels off or already duelling)" };
    },
};

H.befriend = {
    start: (a, ctx) => {
        const p = findPlayer(a.player);
        if (!p) return { done: true, result: `${a.player} is not online` };
        try {
            const st = ctx.bot.getDynamicProperty("friend_status_" + p.id);
            if (st === "accepted") return { done: true, result: `${p.name} is already my friend` };
            ctx.bot.setDynamicProperty("friend_status_" + p.id, "bot_requested");
            ctx.bot.setDynamicProperty("rg:bot_friend_ask_" + p.id, Date.now());
        } catch (e) { /* ignore */ }
        return { done: true, result: `asked ${p.name} to be friends (they can answer yes/no in chat)` };
    },
};

H.emote = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const n = String(a.name).toLowerCase();
        try {
            if (n === "jump") jump(bot);
            else if (n === "sneak" || n === "sit") { bot.isSneaking = true; system.runTimeout(() => { try { bot.isSneaking = false; } catch (e) { /* ignore */ } }, 60); }
            else if (n === "swing") bot.playAnimation("set_block");
            else bot.playAnimation("animation.humanoid.celebrating");
        } catch (e) { /* ignore */ }
        return { done: true, result: `did a ${n}` };
    },
};

// ------------------------------------------------------------- the runner ---
export class Actuator {
    constructor(bot, brain) {
        this.bot = bot;
        this.brain = brain;
        this.queue = [];
        this.current = null;      // {action, state, handler, startedTick}
        this.results = [];
        this.follow = null;       // {targetId, name, guard}
    }

    enqueue(actions) {
        for (const a of actions || []) {
            if (a.type === "stop") { this.queue.length = 0; if (this.current) this.finish(`cancelled ${this.current.action.type}`); this.run(a, system.currentTick); continue; }
            if (a.type === "follow" || a.type === "set_home" || a.type === "look_at" || a.type === "emote") { this.run(a, system.currentTick); continue; }   // instant
            this.queue.push(a);
        }
    }

    enqueueFront(action) { this.queue.unshift(action); }

    ctx(now) { return { bot: this.bot, brain: this.brain, now, actuator: this }; }

    run(action, now) {
        const handler = H[action.type];
        if (!handler) { this.results.push(`${action.type}: not implemented`); return; }
        let r;
        try { r = handler.start(action, this.ctx(now)); } catch (e) { this.results.push(`${action.type} failed: ${e?.message || e}`); return; }
        if (r && r.done) { this.results.push(`${action.type}: ${r.result}`); return; }
        this.current = { action, state: r || {}, handler, startedTick: now };
    }

    tick(now) {
        if (!this.bot.isValid) return;
        if (this.follow) this.tickFollow(now);
        if (!this.current && this.queue.length) this.run(this.queue.shift(), now);
        if (!this.current) return;
        const { action, state, handler } = this.current;
        if (!handler.step) { this.finish(`${action.type}: done`); return; }
        let r;
        try { r = handler.step(state, this.ctx(now)); } catch (e) { this.finish(`${action.type} failed: ${e?.message || e}`); return; }
        if (r && r.done) this.finish(`${action.type}: ${r.result}`);
        else if (now - this.current.startedTick > 20 * 60 * 8) this.finish(`${action.type}: timed out`);
    }

    finish(text) {
        this.results.push(text);
        this.current = null;
        stopMoving(this.bot);
    }

    tickFollow(now) {
        let t; try { t = world.getEntity(this.follow.targetId); } catch (e) { t = null; }
        if (!t || !t.isValid || t.dimension.id !== this.bot.dimension.id) { this.results.push(`${this.follow.name} is gone; stopped following`); this.follow = null; return; }
        const d = dist(this.bot.location, t.location);
        const busy = this.current && this.current.action.type !== "wait";
        if (d > 4 && !busy) goTo(this.bot, t.location, d > 10 ? "sprint" : "walk", NAV.FOLLOW + 1, true);
        else if (!busy && d <= 4) { releaseMove(this.bot, SOURCE); if (now % 40 < STEP) lookAt(this.bot, t.location); }
    }

    cancelFollow() { this.follow = null; }

    cancelJob() {
        try { this.bot.setDynamicProperty("rg:friend_task", null); this.bot.setDynamicProperty("rg:task_owner", null); this.bot.setDynamicProperty("rg:task_until", 0); this.bot.triggerEvent("rg:job_off"); } catch (e) { /* ignore */ }
    }

    stopAll() {
        this.queue.length = 0;
        if (this.current) this.finish(`${this.current.action.type}: cancelled`);
        this.follow = null;
        stopMoving(this.bot);
    }

    describeCurrent() {
        const parts = [];
        if (this.current) {
            const a = this.current.action;
            const s = this.current.state;
            let extra = "";
            if (a.type === "build") extra = ` (${s.placed}/${s.steps.length} blocks)`;
            else if (a.type === "move_to" || a.type === "explore") extra = ` (${Math.round(dist(this.bot.location, s.target))}m to go)`;
            parts.push(`${a.type}${extra} for ${Math.round((system.currentTick - this.current.startedTick) / 20)}s`);
        }
        if (this.queue.length) parts.push(`queued: ${this.queue.map(a => a.type).join(", ")}`);
        if (this.follow) parts.push(`following ${this.follow.name}`);
        return parts.join("; ");
    }

    drainResults() { return this.results.splice(0); }
}
