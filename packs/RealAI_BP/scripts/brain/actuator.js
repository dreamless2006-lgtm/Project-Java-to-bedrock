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
import { nameOf, isModdedId } from "./world_content.js";
import { addFact, noteChest, noteBuild } from "./memory.js";
import { craftPlan, smeltPlan, isLog, isPlanks } from "./crafting.js";
import { getWorldConfig } from "./config.js";
import { presetBlueprint } from "./blueprints.js";
import { dropsOf, harvestCheck, breakTicks, materialMatcher, isOreId, bestTool } from "./harvest.js";
import { bridge } from "./transport.js";
import { findPath } from "./path.js";
export { presetBlueprint };

const SOURCE = "llm";
const PRIO = NAV.TASK + 2;          // beats jobs, loses to survival/combat/water reflexes
const STEP = 10;                    // ticks between steps (core calls tick() at this cadence)
const REACH = 4.6;                  // block reach measured from the eyes
const MOVE_TIMEOUT = 20 * 90;
const BUILD_MAX = 400;
const WEAPON_RANK = ["netherite_sword", "diamond_sword", "iron_sword", "netherite_axe", "diamond_axe", "stone_sword", "iron_axe", "golden_sword", "wooden_sword", "stone_axe", "wooden_axe"];
const TOOL_RANK = { pickaxe: ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "golden_pickaxe", "wooden_pickaxe"], axe: ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "golden_axe", "wooden_axe"], shovel: ["netherite_shovel", "diamond_shovel", "iron_shovel", "stone_shovel", "wooden_shovel"], sword: WEAPON_RANK, bow: ["bow", "crossbow"] };
const ARMOR_RANK = ["netherite", "diamond", "iron", "chainmail", "golden", "leather"];
const DIM_IDS = { overworld: "minecraft:overworld", nether: "minecraft:nether", end: "minecraft:the_end" };

// ---------------------------------------------------------------- helpers ---
function eye(bot) { return { x: bot.location.x, y: bot.location.y + 1.62, z: bot.location.z }; }
function center(p) { return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5, z: Math.floor(p.z) + 0.5 }; }
function blockAt(dim, x, y, z) { try { return dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); } catch (e) { return undefined; } }
function near(bot, target, r) { return dist(bot.location, target) <= r; }
// Block.isSolid is beta-only; "not air and not liquid" is what we need for footing/placement.
function solid(b) { return !!b && !b.isAir && !b.isLiquid; }
// A real player (the bridge account) has no scripted physics: the script cannot push it, so it
// walks by stepping its position a little every tick along the ground.
const walkers = new Map();   // player id -> { bot, target, mode, enterWater, until }
let walkerTimer = null;
export function isPlayerBody(bot) { try { return bot.typeId === "minecraft:player"; } catch (e) { return false; } }
// The bridge account's body moves only through its own client's input packets (Bedrock movement is
// server-authoritative), so when the bridge says it has a body, the walker sends it footing points
// instead of teleporting. Other player bodies (tests, older bridges) are still stepped by teleport.
export function bridgeWalks(bot) { try { return !!(bridge.info && bridge.info.body) && bridge.player && bridge.player.id === bot.id; } catch (e) { return false; } }
function bridgeSend(obj) { try { return bridge.send(obj); } catch (e) { return false; } }
function goTo(bot, target, mode = "sprint", prio = PRIO, enterWater = false) {
    if (isPlayerBody(bot)) {
        const w = walkers.get(bot.id);
        if (w) {
            if (Math.hypot(target.x - w.goal.x, target.z - w.goal.z) > 1.5 || Math.abs(target.y - w.goal.y) > 1.5) { w.path = null; w.planAt = -1000; w.replans = 0; }
            w.goal = { x: target.x, y: target.y, z: target.z }; w.mode = mode; w.enterWater = enterWater; w.until = system.currentTick + STEP * 3;
        } else walkers.set(bot.id, { bot, goal: { x: target.x, y: target.y, z: target.z }, mode, enterWater, until: system.currentTick + STEP * 3, blocked: 0, slide: 0, path: null, planAt: -1000, replans: 0 });
        if (walkerTimer === null) walkerTimer = system.runInterval(() => { const now = system.currentTick; for (const w of [...walkers.values()]) { try { if (!w.bot.isValid) walkers.delete(w.bot.id); else stepPlayerBody(w.bot, now); } catch (e) { /* ignore */ } } }, 1);
        return;
    }
    requestMove(bot, target, { priority: prio, source: SOURCE, mode, ttl: STEP * 3, enterWater });
}
function stopMoving(bot) { if (isPlayerBody(bot)) { const w = walkers.get(bot.id); walkers.delete(bot.id); if (w && w.sent) bridgeSend({ t: "stop" }); return; } releaseMove(bot, SOURCE); }
export function stepPlayerBody(bot, now) {
    const w = walkers.get(bot.id);
    if (!w) return;
    if (now > w.until) { walkers.delete(bot.id); if (w.sent) bridgeSend({ t: "stop" }); return; }
    const loc = bot.location;
    const toGoal = Math.hypot(w.goal.x - loc.x, w.goal.z - loc.z);
    if (toGoal < 0.3) { walkers.delete(bot.id); if (w.sent) bridgeSend({ t: "stop" }); return; }
    // a path through the blocks around (replanned every few seconds, or when the way is blocked)
    if (toGoal > 2.5 && (w.path === null && now - w.planAt > 60 || now - w.planAt > 100) && w.replans < 4) {
        w.planAt = now; w.replans++;
        const dim = bot.dimension;
        const r = findPath((x, y, z) => { const b = blockAt(dim, x, y, z); return b ? b.typeId : null; }, loc, w.goal, { allowWater: w.enterWater, maxNodes: 900 });
        if (r.ok && r.path.length) { w.path = r.path; w.pathIdx = 0; w.blocked = 0; w.slide = 0; }
        else w.path = null;
    }
    let target = w.goal;
    if (w.path) {
        while (w.pathIdx < w.path.length && Math.hypot(w.path[w.pathIdx].x - loc.x, w.path[w.pathIdx].z - loc.z) < 0.45 && Math.abs(w.path[w.pathIdx].y - loc.y) < 1.1) w.pathIdx++;
        if (w.pathIdx >= w.path.length) w.path = null; else target = w.path[w.pathIdx];
    }
    w.target = target;
    const dx = target.x - loc.x, dz = target.z - loc.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 0.3) { if (!w.path) { walkers.delete(bot.id); if (w.sent) bridgeSend({ t: "stop" }); } return; }
    const step = Math.min(w.mode === "walk" ? 0.2 : 0.28, flat);
    const ux = dx / flat, uz = dz / flat;
    let move = null, slid = false;
    // straight on first, then slip sideways around whatever is in the way (a trunk, a corner, a
    // post); a slide that goes on for more than a few blocks is a wall, and the body stops so
    // whoever is walking it can dig through instead.
    for (const a of [0, 0.8, -0.8, 1.5, -1.5]) {
        if (a !== 0 && (w.slide || 0) >= 30) break;
        const cs = Math.cos(a), sn = Math.sin(a);
        const vx = ux * cs - uz * sn, vz = ux * sn + uz * cs;
        const nx = loc.x + vx * step, nz = loc.z + vz * step;
        const ny = footing(bot.dimension, nx, loc.y, nz, w.enterWater);
        if (ny !== null) { move = { x: nx, y: ny, z: nz }; slid = a !== 0; break; }
    }
    if (!move) { w.blocked = (w.blocked || 0) + 1; if (w.path && w.blocked >= 3) { w.path = null; w.planAt = -1000; } if (w.blocked === 1 && w.sent) { bridgeSend({ t: "stop" }); w.sent = false; } return; }
    w.blocked = 0;
    w.slide = slid ? (w.slide || 0) + 1 : 0;
    const yaw = Math.atan2(-dx, dz) * 180 / Math.PI;
    if (bridgeWalks(bot)) {
        // hand the next footing point to the bridge every few ticks; its client walks there itself
        if (now - (w.sentAt || -100) >= 2 || Math.abs(move.y - (w.sentY ?? move.y)) > 0.01) {
            const ahead = Math.min(1.5, flat);
            const px = loc.x + (move.x - loc.x) / step * ahead, pz = loc.z + (move.z - loc.z) / step * ahead;
            bridgeSend({ t: "walk", x: +px.toFixed(2), y: +move.y.toFixed(2), z: +pz.toFixed(2), mode: w.mode === "walk" ? "walk" : "sprint", jump: move.y > loc.y + 0.5 ? 1 : 0, fx: +loc.x.toFixed(2), fy: +loc.y.toFixed(2), fz: +loc.z.toFixed(2) });
            w.sentAt = now; w.sentY = move.y; w.sent = true;
        }
        return;
    }
    try { bot.teleport(move, { rotation: { x: 0, y: yaw } }); }
    catch (e) { try { bot.teleport(move); } catch (e2) { /* ignore */ } }
}
// The height the feet can stand at in column (x, z) within a step of the current height; null when the way is blocked.
function footing(dim, x, y, z, enterWater) {
    try {
        const fx = Math.floor(x), fz = Math.floor(z), feet = Math.floor(y);
        for (const fy of [feet, feet + 1, feet - 1, feet - 2, feet - 3]) {
            const below = dim.getBlock({ x: fx, y: fy - 1, z: fz }), at = dim.getBlock({ x: fx, y: fy, z: fz }), head = dim.getBlock({ x: fx, y: fy + 1, z: fz });
            if (!below || !at || !head) continue;
            if (/lava/.test(below.typeId) || /lava/.test(at.typeId)) return null;
            const ground = solid(below) || (enterWater && /water/.test(below.typeId));
            if (ground && !solid(at) && !solid(head)) return fy;
        }
    } catch (e) { return y; }   // unloaded chunk: keep the height
    return null;
}
export function walkerBlocked(bot) { const w = walkers.get(bot.id); return w ? (w.blocked || 0) : 0; }
/** For !ai where: what the walker is doing with this body. */
export function walkerInfo(bot) { const w = walkers.get(bot.id); return w ? { target: { x: +w.goal.x.toFixed(1), y: +w.goal.y.toFixed(1), z: +w.goal.z.toFixed(1) }, mode: w.mode, blocked: w.blocked || 0, viaBridge: !!w.sent, path: w.path ? `${w.pathIdx}/${w.path.length}` : "straight" } : null; }
function lookAt(bot, target) {
    if (bridgeWalks(bot)) { bridgeSend({ t: "look", x: target.x + 0.5, y: (typeof target.y === "number" ? target.y : bot.location.y) + 0.5, z: target.z + 0.5 }); return; }
    try { faceBlock(bot, target); } catch (e) { /* ignore */ }
}
function cfg() { return getWorldConfig(); }

export function findPlayer(name) {
    if (!name) return null;
    const q = String(name).toLowerCase().replace(/^@/, "");
    let players = [];
    try { players = world.getAllPlayers(); } catch (e) { return null; }
    const exact = players.find(p => p.name.toLowerCase() === q);
    if (exact) return exact;
    const prefix = players.filter(p => p.name.toLowerCase().startsWith(q));
    if (prefix.length === 1) return prefix[0];
    return null;
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

function swing(bot) {
    if (bridgeWalks(bot)) bridgeSend({ t: "swing" });
    try { bot.playAnimation(isPlayerBody(bot) ? "animation.player.attack.rotations" : "animation.humanoid.attack.rotations"); } catch (e) { /* ignore */ }
}

function heldId(bot) { try { return bot.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand)?.typeId || null; } catch (e) { return null; } }
// {id: count} of the inventory plus whatever is in the hand (an entity bot's hand is outside its container).
function invWithHand(bot) { const inv = inventoryMap(bot); const h = heldId(bot); if (h && !inv[h]) inv[h] = 1; return inv; }

// Put an item in the hand. A real player's hand is a hotbar slot, so the item is moved there;
// an entity bot gets it through replaceitem (its hand is not part of its container).
function holdItem(bot, typeId) {
    const c = containerOf(bot);
    if (!c) return false;
    if (isPlayerBody(bot)) {
        if (heldId(bot) === typeId) return true;
        let idx = -1;
        for (let i = 0; i < c.size; i++) { let st; try { st = c.getItem(i); } catch (e) { continue; } if (st && st.typeId === typeId) { idx = i; break; } }
        if (idx < 0) return false;
        const sel = typeof bot.selectedSlotIndex === "number" ? bot.selectedSlotIndex : 0;
        if (idx !== sel) {
            try { c.swapItems(idx, sel, c); }
            catch (e) { try { const a = c.getItem(idx), b = c.getItem(sel); c.setItem(sel, a); c.setItem(idx, b); } catch (e2) { return false; } }
        }
        return true;
    }
    if (takeItems(c, typeId, 1) < 1) return false;
    try { bot.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${typeId}`); } catch (e) { giveItems(c, typeId, 1); return false; }
    return true;
}

// One use of wear on the tool in the inventory; a worn-out tool breaks, like in survival.
function wearTool(bot, typeId) {
    try {
        const c = containerOf(bot);
        if (!c) return;
        for (let i = 0; i < c.size; i++) {
            const st = c.getItem(i);
            if (!st || st.typeId !== typeId) continue;
            const d = st.getComponent("minecraft:durability");
            if (!d) return;
            if (d.damage + 1 >= d.maxDurability) { c.setItem(i, undefined); try { bot.dimension.playSound("random.break", bot.location); } catch (e) { /* ignore */ } }
            else { d.damage += 1; c.setItem(i, st); }
            return;
        }
    } catch (e) { /* ignore */ }
}

// Break a block the survival way: the right tool, its drops into the inventory, wear on the tool.
function harvestBlock(bot, pos) {
    const dim = bot.dimension;
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    const b = blockAt(dim, x, y, z);
    if (!b) return { ok: false, reason: "chunk not loaded" };
    if (b.isAir) return { ok: false, reason: "nothing there" };
    const id = b.typeId;
    const chk = harvestCheck(id, invWithHand(bot));
    if (!chk.ok) return { ok: false, reason: chk.reason, id };
    try {
        lookAt(bot, { x, y, z });
        if (chk.tool) holdItem(bot, chk.tool);
        swing(bot);
        try { b.setType("minecraft:air"); } catch (e) { dim.runCommand(`setblock ${x} ${y} ${z} minecraft:air`); }
        try { dim.playSound(/log|wood|planks|leaves/.test(id) ? "dig.wood" : /dirt|grass|sand|gravel|clay|snow/.test(id) ? "dig.gravel" : "dig.stone", { x, y, z }); } catch (e) { /* ignore */ }
        const c = containerOf(bot);
        let got = 0;
        const drops = dropsOf(id);
        for (const d of drops) {
            const n = c ? giveItems(c, d.id, d.n) : 0;
            got += n;
            if (n < d.n) { try { dim.spawnItem(new ItemStack(d.id, d.n - n), { x: x + 0.5, y: y + 0.5, z: z + 0.5 }); } catch (e) { /* ignore */ } }
        }
        if (chk.tool) wearTool(bot, chk.tool);
        return { ok: true, id, got, drops };
    } catch (e) { return { ok: false, reason: String(e?.message || e), id }; }
}

function breakBlock(bot, pos) { return harvestBlock(bot, pos); }

// Terrain a player digs through without a second thought; anything else may be someone's build.
const NATURAL = /^minecraft:(stone|dirt|grass_block|coarse_dirt|podzol|mycelium|gravel|sand|red_sand|sandstone|red_sandstone|clay|snow|snow_layer|netherrack|soul_sand|soul_soil|basalt|blackstone|end_stone|deepslate|tuff|calcite|andesite|diorite|granite|dripstone_block|pointed_dripstone|moss_block|mud|packed_mud|magma|ice|packed_ice|bamboo|cactus|pumpkin|melon_block|nether_wart_block|warped_wart_block|shroomlight|glowstone|hay_block|sweet_berry_bush|tallgrass|short_grass|fern|large_fern|double_plant|vine|cobweb|web|amethyst_block|budding_amethyst|amethyst_cluster|.*_terracotta|terracotta|.*_leaves|.*_log|.*_stem|.*_wood|.*_hyphae|.*_ore|ancient_debris|.*_mushroom_block|.*_sapling|.*_flower|dandelion|poppy|.*_amethyst_bud)$/;

// Blocked on the way somewhere: dig the two blocks ahead if they are plain terrain.
function clearPath(bot, target) {
    const loc = bot.location;
    const dx = target.x - loc.x, dz = target.z - loc.z, len = Math.hypot(dx, dz) || 1;
    const ax = Math.floor(loc.x) + Math.round(dx / len), az = Math.floor(loc.z) + Math.round(dz / len), fy = Math.floor(loc.y);
    let cleared = 0;
    for (const y of [fy + 1, fy]) {
        const b = blockAt(bot.dimension, ax, y, az);
        if (!b || !solid(b)) continue;
        if (!NATURAL.test(b.typeId)) return { cleared, blockedBy: b.typeId };
        const r = harvestBlock(bot, { x: ax, y, z: az });
        if (r.ok) cleared++; else return { cleared, blockedBy: b.typeId, reason: r.reason };
    }
    return { cleared };
}

// Shared stuck handling for everything that walks: counts steps without progress; a stuck
// entity bot jumps, a stuck player body digs through plain terrain. Returns the stuck count.
function walkProgress(bot, s, target) {
    const moved = s.lastPos ? dist(bot.location, s.lastPos) : 1;
    s.stuck = moved < 0.15 ? (s.stuck || 0) + 1 : 0;
    if (isPlayerBody(bot) && walkerBlocked(bot) >= 8) s.stuck = Math.max(s.stuck, 6);
    s.lastPos = { ...bot.location };
    if (s.stuck >= 6 && s.stuck % 6 === 0) {
        if (isPlayerBody(bot)) {
            // dig only when the ground itself is in the way; a body the bridge walks that simply
            // did not move (network, a slow client) must not leave holes everywhere it stands
            if (!bridgeWalks(bot) || walkerBlocked(bot) >= 8) {
                const r = clearPath(bot, target);
                if (r.blockedBy) s.hardBlock = (s.hardBlock || 0) + 1;
                else if (r.cleared) s.stuck = 0;
            }
        } else { try { jump(bot); } catch (e) { /* ignore */ } }
    }
    return s.stuck;
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

export function findSafeSpot(dim, x, z, yHint) {
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
        let t = a.name ? findEntityByName(ctx.bot, a.name, 64) : null;
        if (t && t.dimension?.id !== ctx.bot.dimension.id) t = null;
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
        const stuck = walkProgress(bot, s, s.target);
        if (stuck > 24 || (s.hardBlock || 0) > 2) { stopMoving(bot); return { done: true, result: `stuck on the way to ${fmtPos(s.target)} (${Math.round(dist(bot.location, s.target))}m left${s.hardBlock ? ", something built is in the way" : ""}); try break_block or another route` }; }
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
        if (t.dimension?.id !== ctx.bot.dimension.id) return { done: true, result: `${a.name} is in another dimension` };
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
        if (t.dimension?.id !== ctx.bot.dimension.id || dist(t.location, ctx.bot.location) > 64) return { done: true, result: `${a.name} is too far away to attack` };
        if (t.typeId === "minecraft:player" && t.hasTag("realai_bridge")) return { done: true, result: "that is the relay account, leave it alone" };
        try { setAITarget(ctx.bot, t); ctx.bot.addTag("allow_attack"); if (!isPlayerBody(ctx.bot)) ctx.bot.applyDamage(0, { cause: EntityDamageCause.entityAttack, damagingEntity: t }); } catch (e) { /* ignore */ }
        equipBest(ctx.bot, "sword");
        return { targetId: t.id, name: a.name, started: ctx.now, startHp: healthOf(t)?.hp };
    },
    step: (s, ctx) => {
        let t; try { t = world.getEntity(s.targetId); } catch (e) { t = null; }
        const bot = ctx.bot;
        if (!t || !t.isValid) { clearAITarget(bot); stopMoving(bot); try { bot.removeTag("allow_attack"); } catch (e) { /* ignore */ } return { done: true, result: `${s.name} is dead or gone` }; }
        if (ctx.now - s.started > 20 * 60) { clearAITarget(bot); stopMoving(bot); return { done: true, result: `stopped chasing ${s.name} after a minute (hp now ${healthOf(t)?.hp ?? "?"})` }; }
        try { bot.addTag("allow_attack"); } catch (e) { /* ignore */ }
        if (isPlayerBody(bot)) return undefined;   // combatTick runs this body every tick
        const d = dist(bot.location, t.location);
        if (d > 2.4) goTo(bot, t.location, "sprint", NAV.COMBAT + 1, true);
        else { stopMoving(bot); lookAt(bot, t.location); if (ctx.now - (s.lastHit || 0) >= 20) { s.lastHit = ctx.now; try { t.applyDamage(meleeDamage(bot), { cause: EntityDamageCause.entityAttack, damagingEntity: bot }); swing(bot); } catch (e) { /* ignore */ } } }
        return undefined;
    },
};

export const HIT_COOLDOWN = 10;     // ticks of damage immunity after a hit: the body swings exactly when it ends
export const REACH_MELEE = 3.0;
/** Every tick while an attack runs on a player body: track the target, keep at reach, hit on the beat. */
export function combatTick(brain, now) {
    const bot = brain.bot;
    const cur = brain.actuator.current;
    if (!cur || cur.action.type !== "attack") return false;
    const s = cur.state;
    let t; try { t = world.getEntity(s.targetId); } catch (e) { t = null; }
    if (!t || !t.isValid) return false;
    const d = dist(bot.location, t.location);
    if (now % 3 === 0) lookAt(bot, { x: t.location.x - 0.5, y: t.location.y + 0.5, z: t.location.z - 0.5 });
    if (d > REACH_MELEE - 0.2) { goTo(bot, t.location, "sprint", NAV.COMBAT + 1, true); return true; }
    stopMoving(bot);
    if (now - (s.lastHit || -100) >= HIT_COOLDOWN) {
        s.lastHit = now; s.hits = (s.hits || 0) + 1;
        try { t.applyDamage(meleeDamage(bot), { cause: EntityDamageCause.entityAttack, damagingEntity: bot }); swing(bot); } catch (e) { /* ignore */ }
    }
    return true;
}

/** Eat without being asked when the hunger bar is low and nothing hostile is close. */
export function autoEat(brain, now) {
    const bot = brain.bot;
    const h = hungerOf(bot);
    if (!h || h.currentValue > 14) return false;
    if (now - (brain.lastAutoEat || -1000) < 100) return false;
    try { if (bot.dimension.getEntities({ location: bot.location, maxDistance: 10, families: ["monster"] }).length) return false; } catch (e) { /* ignore */ }
    brain.lastAutoEat = now;
    const before = brain.actuator.results.length;
    brain.actuator.run({ type: "eat" }, now);
    const r = brain.actuator.results[before];
    return !!r && /ate /.test(r);
}

const ARMOR_SLOTS = [["slot.armor.head", EquipmentSlot.Head, /(helmet|_helm)$/], ["slot.armor.chest", EquipmentSlot.Chest, /chestplate$/], ["slot.armor.legs", EquipmentSlot.Legs, /leggings$/], ["slot.armor.feet", EquipmentSlot.Feet, /boots$/]];
function armorTier(id) { if (!id) return -1; const i = ARMOR_RANK.findIndex(t => id.includes(t)); return i < 0 ? -1 : ARMOR_RANK.length - i; }
function weaponTier(id) { if (!id) return -1; const i = WEAPON_RANK.findIndex(w => id.endsWith(":" + w)); return i < 0 ? -1 : WEAPON_RANK.length - i; }
/** Put on better armour the moment it is in the bag; draw the best weapon when fighting. Returns what changed. */
export function autoEquip(bot, fighting) {
    const out = [];
    const inv = inventoryMap(bot);
    const c = containerOf(bot);
    let eq = null; try { eq = bot.getComponent(EntityComponentTypes.Equippable); } catch (e) { eq = null; }
    if (!c || !eq) return out;
    for (const [cmdSlot, slot, re] of ARMOR_SLOTS) {
        let worn = null; try { worn = eq.getEquipment(slot)?.typeId || null; } catch (e) { worn = null; }
        const best = Object.keys(inv).filter(id => re.test(id) && armorTier(id) > armorTier(worn)).sort((a, b) => armorTier(b) - armorTier(a))[0];
        if (!best) continue;
        try { takeItems(c, best, 1); bot.runCommand(`replaceitem entity @s ${cmdSlot} 0 ${best}`); if (worn) giveItems(c, worn, 1); out.push(nameOf(best)); } catch (e) { /* ignore */ }
    }
    if (fighting) {
        const held = heldId(bot);
        const best = Object.keys(inv).filter(id => weaponTier(id) > weaponTier(held)).sort((a, b) => weaponTier(b) - weaponTier(a))[0];
        if (best && holdItem(bot, best)) out.push(nameOf(best));
    }
    return out;
}

/** Falling with a water bucket: pour it where the body is about to land. */
export function mlgWater(brain, now) {
    const bot = brain.bot;
    let v; try { v = bot.getVelocity(); } catch (e) { return false; }
    if (!v || v.y > -0.5) { brain.mlgArmed = true; return false; }
    if (!brain.mlgArmed) return false;
    const inv = inventoryMap(bot);
    if (!inv["minecraft:water_bucket"]) return false;
    const dim = bot.dimension, fx = Math.floor(bot.location.x), fz = Math.floor(bot.location.z), fy = Math.floor(bot.location.y);
    for (let y = fy - 1; y >= fy - 14; y--) {
        const b = blockAt(dim, fx, y, fz);
        if (!b) return false;
        if (/water/.test(b.typeId)) return false;
        if (!solid(b)) continue;
        const drop = fy - 1 - y;
        if (drop > 4) return false;    // too early: wait until the ground is close
        brain.mlgArmed = false;
        try { dim.runCommand(`setblock ${fx} ${y + 1} ${fz} minecraft:water`); } catch (e) { return false; }
        const c = containerOf(bot);
        takeItems(c, "minecraft:water_bucket", 1); giveItems(c, "minecraft:bucket", 1);
        brain.noteEvent("action_done", "reflex: poured water under me to land safely");
        return true;
    }
    return false;
}

function meleeDamage(bot) {
    const inv = inventoryMap(bot);
    const inHand = heldId(bot);
    const held = WEAPON_RANK.find(w => inv["minecraft:" + w] || inv[w] || inHand === "minecraft:" + w);
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

// Legacy job system (entity bots only): the bot body's own worker chops and mines.
function legacyGatherStart(a, ctx, m) {
    if (hasJob(ctx.bot)) return { done: true, result: "already on a gathering job (use stop first)" };
    const kind = /log|wood|tree|oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry/.test(m) ? "chop" : "mine";
    let want = m === "wood" || m === "logs" || m === "log" ? null : m.replace(/_log$/, "");
    if (kind === "mine" && /^(stone|cobblestone|dirt|sand|gravel|anything|ore|ores)$/.test(m)) want = null;
    const owner = ctx.brain.ownerPlayer();
    const ok = assignFriendTask(ctx.bot, owner || null, kind, { want, amount: a.amount || 16, durationTicks: 20 * 60 * 6 });
    if (!ok) return { done: true, result: "could not start the job" };
    return { kind, want: want || "anything", started: ctx.now };
}
function legacyGatherStep(s, ctx) {
    const t = getFriendTask(ctx.bot);
    if (!t) { collectNearbyItems(ctx.bot, 6); const inv = inventoryMap(ctx.bot); return { done: true, result: `${s.kind} job finished (${s.want}); inventory now has ${Object.entries(inv).slice(0, 6).map(([id, n]) => nameOf(id) + " x" + n).join(", ") || "nothing new"}` }; }
    if (ctx.now - s.started > 20 * 60 * 6) return { done: true, result: `${s.kind} job still running in the background` };
    return undefined;
}

// Script-driven gathering: find the nearest matching block, walk within reach, take the time a
// real player takes to break it, bank the drops, repeat. Works on any body, including the real
// player the bridge account controls.
const blockKey = (b) => `${b.x},${b.y},${b.z}`;
function harvestStep(s, ctx) {
    const bot = ctx.bot;
    const summary = () => `${s.got} ${s.label}`;
    if (s.got >= s.amount) { stopMoving(bot); return { done: true, result: `gathered ${summary()}` }; }
    if (ctx.now - s.started > 20 * 60 * 6) { stopMoving(bot); return { done: true, result: `stopped after six minutes with ${summary()}` }; }
    if (s.target) { const b = blockAt(bot.dimension, s.target.x, s.target.y, s.target.z); if (!b || !s.pred(b.typeId)) { s.target = null; s.breakingSince = 0; } }
    if (!s.target) {
        const feet = Math.floor(bot.location.y);
        const cands = findBlocks(bot, b => s.pred(b.typeId) && !s.skip.has(blockKey(b)) && b.y - feet <= 5 && b.y - feet >= -6, 12, 6, 8);
        cands.sort((p, q) => dist(eye(bot), center(p)) - dist(eye(bot), center(q)));
        let pick = cands[0];
        if (!pick) {
            s.searches++;
            if (s.searches > 1) { stopMoving(bot); return { done: true, result: s.got ? `gathered ${summary()}; no more ${s.label} around here (explore to find more)` : `no ${s.label} in sight here; explore (looking_for: ${s.label}) to find some` }; }
            pick = findBlocks(bot, b => s.pred(b.typeId) && !s.skip.has(blockKey(b)), 28, 8, 1)[0];
            if (!pick) { stopMoving(bot); return { done: true, result: s.got ? `gathered ${summary()}; no more ${s.label} within 28 blocks` : `no ${s.label} within 28 blocks; explore (looking_for: ${s.label}) to find some` }; }
        }
        s.target = { x: pick.x, y: pick.y, z: pick.z }; s.walkSince = ctx.now; s.breakingSince = 0; s.lastPos = { ...bot.location }; s.stuck = 0; s.hardBlock = 0;
        return undefined;
    }
    const t = s.target;
    const d = dist(eye(bot), center(t));
    if (d > REACH) {
        const flat = Math.hypot(bot.location.x - (t.x + 0.5), bot.location.z - (t.z + 0.5));
        if (ctx.now - s.walkSince > 20 * 25 || flat < 1.3 || (s.hardBlock || 0) > 2) { s.skip.add(blockKey(t)); s.target = null; return undefined; }
        goTo(bot, { x: t.x + 0.5, y: t.y, z: t.z + 0.5 }, "walk", PRIO, true);
        walkProgress(bot, s, t);
        return undefined;
    }
    stopMoving(bot);
    if (!s.breakingSince) {
        const b = blockAt(bot.dimension, t.x, t.y, t.z);
        const inv = invWithHand(bot);
        const chk = harvestCheck(b ? b.typeId : "", inv);
        if (!chk.ok) return { done: true, result: `cannot gather ${s.label}: ${chk.reason}${s.got ? ` (${summary()} so far)` : ""}` };
        if (chk.tool) holdItem(bot, chk.tool);
        s.breakingSince = ctx.now; s.needTicks = breakTicks(b.typeId, inv);
        lookAt(bot, t);
    }
    swing(bot);
    if (ctx.now - s.breakingSince < s.needTicks) return undefined;
    const r = harvestBlock(bot, t);
    s.breakingSince = 0; s.target = null;
    if (!r.ok) { s.skip.add(blockKey(t)); return undefined; }
    s.got += r.got;
    collectNearbyItems(bot, 4);
    return undefined;
}

H.gather = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const m = String(a.material || "").toLowerCase().replace(/\s+/g, "_").replace(/^minecraft:/, "");
        const amount = Math.max(1, Math.min(64, Number(a.amount) || 16));
        const mm = materialMatcher(m);
        if (mm.food) {
            let animals = [];
            try { animals = bot.dimension.getEntities({ location: bot.location, maxDistance: 40, families: ["animal"] }).filter(e => !/wolf|cat|horse|donkey|mule|parrot|llama|dolphin|turtle|bee|fox|panda|ocelot|axolotl|frog|allay|camel|sniffer|armadillo|villager/.test(e.typeId)); } catch (e) { /* ignore */ }
            animals.sort((p, q) => dist(bot.location, p.location) - dist(bot.location, q.location));
            if (!animals.length) return { done: true, result: "no animals nearby to hunt; explore for cows, pigs, sheep or chickens, pick sweet berries, or harvest crops" };
            const prey = animals[0];
            ctx.actuator.enqueueFront({ type: "pick_up" });
            ctx.actuator.enqueueFront({ type: "attack", name: prey.typeId.replace(/^.*:/, "") });
            return { done: true, result: `hunting a ${nameOf(prey.typeId)} ${Math.round(dist(bot.location, prey.location))}m away for food` };
        }
        if (mm.crop) {
            const plant = findBlocks(bot, b => b.typeId.includes(mm.crop), 16, 3, 1)[0];
            if (!plant) return { done: true, result: `no ${mm.label} growing nearby` };
            ctx.actuator.enqueueFront({ type: "interact", x: plant.x, y: plant.y, z: plant.z });
            return { done: true, result: `going to pick ${mm.label} at ${fmtPos(plant)}` };
        }
        if (!isPlayerBody(bot)) return legacyGatherStart(a, ctx, m);
        return { pred: mm.pred, label: mm.label, amount, got: 0, started: ctx.now, skip: new Set(), searches: 0, breakingSince: 0, needTicks: 0, walkSince: 0, target: null };
    },
    step: (s, ctx) => (s.pred ? harvestStep(s, ctx) : legacyGatherStep(s, ctx)),
};

// Dig a staircase down, mining every ore that comes within reach, with the usual care: never
// into lava, bridge over caves, a torch every few steps, and a turn every so often so the
// stairs stay close to where they started.
function mineStep(s, ctx) {
    const bot = ctx.bot, dim = bot.dimension;
    const foundText = () => Object.entries(s.found).map(([id, n]) => `${nameOf(id)} x${n}`).join(", ") || "no ore";
    const finish = (why) => { stopMoving(bot); return { done: true, result: `${why}; now at ${fmtPos(bot.location)}, dug ${s.dug} blocks, found ${foundText()}` }; };
    const fx = Math.floor(bot.location.x), fy = Math.floor(bot.location.y), fz = Math.floor(bot.location.z);
    if (fy <= s.targetY) return finish(`reached y ${fy}`);
    if (ctx.now - s.started > 20 * 60 * 6) return finish("stopped after six minutes of digging");
    if (s.breaking) {
        swing(bot);
        if (ctx.now - s.breakingSince < s.needTicks) return undefined;
        const b = s.breaking; s.breaking = null;
        const r = harvestBlock(bot, b);
        if (r.ok) { s.dug++; if (isOreId(r.id)) for (const d of r.drops) s.found[d.id] = (s.found[d.id] || 0) + d.n; }
        else s.skip.add(blockKey(b));
        return undefined;
    }
    const inv = invWithHand(bot);
    const beginBreak = (b) => {
        const chk = harvestCheck(b.typeId, inv);
        if (!chk.ok) { s.skip.add(blockKey(b)); s.lastRefusal = chk.reason; return false; }
        if (chk.tool) holdItem(bot, chk.tool);
        s.breaking = { x: b.x, y: b.y, z: b.z }; s.breakingSince = ctx.now; s.needTicks = breakTicks(b.typeId, inv);
        lookAt(bot, b);
        return true;
    };
    const ore = findBlocks(bot, b => isOreId(b.typeId) && !s.skip.has(blockKey(b)) && dist(eye(bot), center(b)) <= REACH, 3, 2, 1)[0];
    if (ore && beginBreak(ore)) return undefined;
    const [dx, dz] = s.dir;
    const nx = fx + dx, nz = fz + dz, ny = fy - 1;
    const cell = `${nx},${ny},${nz}`;
    const under = blockAt(dim, nx, ny - 1, nz);
    const around = [blockAt(dim, nx, ny, nz), blockAt(dim, nx, ny + 1, nz), under, blockAt(dim, nx + dx, ny, nz + dz), blockAt(dim, nx + dx, ny + 1, nz + dz), blockAt(dim, nx, ny - 2, nz), blockAt(dim, nx + dz, ny, nz + dx), blockAt(dim, nx - dz, ny, nz - dx)];
    if (around.some(b => b && /lava/.test(b.typeId))) return finish("LAVA next to the stairs, stopped digging (pour water on it or dig elsewhere)");
    if (under && (under.isAir || under.isLiquid)) {
        const fill = Object.keys(inv).find(id => /cobblestone|cobbled_deepslate|dirt$|netherrack|:stone$|planks$/.test(id));
        if (!fill) return finish(under.isLiquid ? "water below the next step, stopped" : "a cave opened up below; stopped (carry cobblestone to bridge gaps)");
        const r = placeBlock(bot, { x: nx, y: ny - 1, z: nz }, fill);
        if (!r.ok) return finish("could not secure the next step: " + r.reason);
    }
    for (const y of [ny + 1, ny]) {
        const b = blockAt(dim, nx, y, nz);
        if (!b || !solid(b)) continue;
        if (beginBreak(b)) return undefined;
        return finish(`cannot dig through ${nameOf(b.typeId)}${s.lastRefusal ? " (" + s.lastRefusal + ")" : ""}`);
    }
    // the step is clear: walk down onto it
    if (Math.floor(bot.location.x) === nx && Math.floor(bot.location.z) === nz && Math.floor(bot.location.y) === ny) {
        if (s.lastCell !== cell) {
            s.lastCell = cell; s.stairs++; s.walkTicks = 0;
            if (s.stairs % 6 === 0 && (inv["minecraft:torch"] || 0) > 0) placeBlock(bot, { x: fx, y: fy + 1, z: fz }, "minecraft:torch");
            if (s.stairs % 8 === 0) s.dir = [-s.dir[1], s.dir[0]];
        }
        return undefined;
    }
    goTo(bot, { x: nx + 0.5, y: ny, z: nz + 0.5 }, "walk", PRIO, true);
    s.walkTicks = (s.walkTicks || 0) + STEP;
    if (s.walkTicks > 20 * 8) { s.walkTicks = 0; s.dir = [-s.dir[1], s.dir[0]]; }
    return undefined;
}

H.mine_down = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        if (!isPlayerBody(bot)) {
            if (hasJob(bot)) return { done: true, result: "already on a job" };
            const ok = assignFriendTask(bot, ctx.brain.ownerPlayer() || null, "mine", { want: null, amount: 24, durationTicks: 20 * 60 * 5 });
            return ok ? { kind: "mine", want: "anything", started: ctx.now } : { done: true, result: "could not start mining" };
        }
        if (!bestTool(invWithHand(bot), "pickaxe")) return { done: true, result: "mine_down needs a pickaxe (craft a wooden_pickaxe: 3 planks + 2 sticks)" };
        const depth = Math.max(4, Math.min(60, Number(a.depth) || 16));
        const floor = bot.dimension.id === "minecraft:overworld" ? -59 : 6;
        const yaw = (() => { try { return bot.getRotation().y; } catch (e) { return 0; } })();
        const snapped = Math.round(((yaw % 360) + 360) % 360 / 90) % 4;
        const dirs = [[0, 1], [-1, 0], [0, -1], [1, 0]];
        return { phase: "dig", dir: dirs[snapped], targetY: Math.max(floor, Math.floor(bot.location.y) - depth), started: ctx.now, dug: 0, found: {}, stairs: 0, breaking: null, breakingSince: 0, needTicks: 0, skip: new Set() };
    },
    step: (s, ctx) => (s.phase ? mineStep(s, ctx) : legacyGatherStep(s, ctx)),
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
        if (!s.top || ctx.now - (s.topAt || 0) > 80) { s.top = findSafeSpot(bot.dimension, s.target.x, s.target.z, bot.location.y); s.topAt = ctx.now; }
        goTo(bot, s.top || s.target, "sprint", PRIO, true);
        const stuck = walkProgress(bot, s, s.top || s.target);
        if (stuck > 30 || (s.hardBlock || 0) > 2) { stopMoving(bot); return { done: true, result: `blocked while exploring at ${fmtPos(bot.location)}` }; }
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
        return { steps, i: 0, placed: 0, skipped: 0, name: a.name || a.preset, waiting: 0, origin: { x: ox, y: oy, z: oz } };
    },
    step: (s, ctx) => {
        const bot = ctx.bot;
        const finish = (msg) => { stopMoving(bot); try { bot.removeTag("is_busy_building"); bot.triggerEvent("stroll_switch"); } catch (e) { /* ignore */ } return { done: true, result: msg }; };
        for (let n = 0; n < 2; n++) {
            if (s.i >= s.steps.length) {
                if (s.placed > 0) { try { const xs = s.steps.map(p => p.x), ys = s.steps.map(p => p.y), zs = s.steps.map(p => p.z); noteBuild(ctx.brain.memory, { name: String(s.name || "build"), dim: bot.dimension.id, x1: Math.min(...xs), y1: Math.min(...ys), z1: Math.min(...zs), x2: Math.max(...xs), y2: Math.max(...ys), z2: Math.max(...zs) }, Date.now()); } catch (e) { /* ignore */ } }
                return finish(`finished building ${s.name} at ${fmtPos(s.origin)}: ${s.placed} blocks placed${s.skipped ? `, ${s.skipped} skipped` : ""}`);
            }
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

function rememberContainer(ctx, pos, id) {
    if (!/chest$|barrel$|shulker_box$/.test(String(id))) return;
    try { noteChest(ctx.brain.memory, { x: pos.x, y: pos.y, z: pos.z, dim: ctx.bot.dimension.id, items: [] }, Date.now()); } catch (e) { /* ignore */ }
}
function containerSummary(container) {
    const map = {};
    for (let i = 0; i < container.size; i++) { let st; try { st = container.getItem(i); } catch (e) { continue; } if (st) map[st.typeId] = (map[st.typeId] || 0) + st.amount; }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${nameOf(id)} x${n}`);
}

H.place_block = {
    start: (a, ctx) => {
        const id = materialBlockId(ctx.bot, a.block);
        const pos = { x: a.x, y: a.y, z: a.z };
        if (dist(eye(ctx.bot), center(pos)) > REACH + 2) return { pos, id, started: ctx.now };
        const r = placeBlock(ctx.bot, pos, id);
        if (r.ok) rememberContainer(ctx, pos, id);
        return { done: true, result: r.ok ? `placed ${nameOf(id)} at ${fmtPos(pos)}` : `could not place ${nameOf(id)}: ${r.reason}` };
    },
    step: (s, ctx) => {
        if (dist(eye(ctx.bot), center(s.pos)) <= REACH) { stopMoving(ctx.bot); const r = placeBlock(ctx.bot, s.pos, s.id); if (r.ok) rememberContainer(ctx, s.pos, s.id); return { done: true, result: r.ok ? `placed ${nameOf(s.id)} at ${fmtPos(s.pos)}` : `could not place ${nameOf(s.id)}: ${r.reason}` }; }
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

const FOOD_VALUE = { cooked_beef: 8, cooked_porkchop: 8, rabbit_stew: 10, pumpkin_pie: 8, golden_carrot: 6, cooked_mutton: 6, cooked_salmon: 6, cooked_chicken: 6, mushroom_stew: 6, beetroot_soup: 6, suspicious_stew: 6, honey_bottle: 6, bread: 5, baked_potato: 5, cooked_rabbit: 5, cooked_cod: 5, golden_apple: 4, enchanted_golden_apple: 4, apple: 4, rotten_flesh: 4, beef: 3, porkchop: 3, carrot: 3, rabbit: 3, mutton: 2, salmon: 2, chicken: 2, cod: 2, sweet_berries: 2, glow_berries: 2, melon_slice: 2, cookie: 2, tropical_fish: 1, dried_kelp: 1, potato: 1, beetroot: 1 };
function foodValue(id) {
    const key = String(id).replace(/^minecraft:/, "");
    if (FOOD_VALUE[key] !== undefined) return FOOD_VALUE[key];
    try { const f = new ItemStack(id, 1).getComponent("minecraft:food"); if (f) return f.nutrition || 4; } catch (e) { /* not an item */ }
    return 0;
}
// A real player's hunger bar (an attribute on the player entity); null for entity bots.
export function hungerOf(bot) { try { const h = bot.getComponent("minecraft:player.hunger"); if (h && typeof h.currentValue === "number") return h; } catch (e) { /* not a player */ } return null; }

H.eat = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        if (isPlayerBody(bot)) {
            const inv = inventoryMap(bot);
            const h = hungerOf(bot);
            const hunger = h ? Math.round(h.currentValue) : null;
            if (hunger !== null && hunger >= 20) return { done: true, result: "not hungry (hunger 20/20)" };
            const edible = Object.keys(inv).filter(id => foodValue(id) > 0 && !/rotten_flesh|spider_eye|pufferfish|poisonous_potato|:chicken$|raw_/.test(id)).sort((p, q) => foodValue(q) - foodValue(p));
            const pick = edible[0] || Object.keys(inv).find(id => /rotten_flesh|:chicken$/.test(id));
            if (!pick) return { done: true, result: "nothing to eat (hunt animals with gather food, pick sweet berries, harvest crops or craft bread)" };
            const nutrition = foodValue(pick);
            takeItems(containerOf(bot), pick, 1);
            let applied = false;
            try { if (h) { h.setCurrentValue(Math.min(20, h.currentValue + nutrition)); applied = true; } } catch (e) { /* fall back to the effect */ }
            try { const sat = bot.getComponent("minecraft:player.saturation"); if (sat) sat.setCurrentValue(Math.min(20, (sat.currentValue || 0) + nutrition * 1.2)); } catch (e) { /* optional */ }
            if (!applied) { try { bot.runCommand(`effect @s saturation 1 ${Math.max(0, Math.min(5, Math.round(nutrition / 4) - 1))} true`); } catch (e) { /* ignore */ } }
            try { bot.dimension.playSound("random.eat", bot.location); bot.playAnimation("animation.humanoid.consumables"); } catch (e) { /* ignore */ }
            return { done: true, result: `ate ${nameOf(pick)}${hunger !== null ? ` (hunger now ${Math.min(20, hunger + nutrition)}/20)` : ""}` };
        }
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
    if (!holdItem(bot, best)) return null;
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
            if (id === "minecraft:ender_eye") {
                const frames = findBlocks(bot, b => b.typeId === "minecraft:end_portal_frame", 6, 3, 12);
                if (!frames.length) { takeItems(c, id, 1); return { done: true, result: "threw an eye of ender: follow the direction it flew (use locate stronghold to get coordinates)" }; }
                const filled = ctx.brain.filledFrames = ctx.brain.filledFrames || new Set();
                const hasEye = (b) => { try { const v = b.permutation?.getState?.("end_portal_eye_bit"); if (typeof v === "boolean") return v; } catch (e) { /* ignore */ } return filled.has(`${b.x},${b.y},${b.z}`); };
                const empty = frames.find(b => !hasEye(b));
                if (!empty) return { done: true, result: "every frame here already has an eye" };
                takeItems(c, id, 1);
                try { dim.runCommand(`setblock ${empty.x} ${empty.y} ${empty.z} minecraft:end_portal_frame ["end_portal_eye_bit"=true,"minecraft:cardinal_direction"="${(() => { try { return empty.permutation?.getState?.("minecraft:cardinal_direction") || "south"; } catch (e) { return "south"; } })()}"]`); } catch (e) { /* ignore */ }
                filled.add(`${empty.x},${empty.y},${empty.z}`);
                const ring = findBlocks(bot, b => b.typeId === "minecraft:end_portal_frame", 8, 3, 16).filter(b => b.y === empty.y);
                const withEye = ring.filter(hasEye);
                if (ring.length >= 12 && withEye.length >= 12) {
                    const cx = Math.round(ring.reduce((a, b) => a + b.x, 0) / ring.length), cz = Math.round(ring.reduce((a, b) => a + b.z, 0) / ring.length);
                    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) { try { dim.runCommand(`setblock ${x} ${empty.y} ${z} minecraft:end_portal`); } catch (e) { /* ignore */ } }
                    ctx.brain.memory.mission = ctx.brain.memory.mission || {}; ctx.brain.memory.mission.portalLit = true;
                    addFact(ctx.brain.memory, `the end portal is lit at ${cx} ${empty.y} ${cz}`, Date.now());
                    return { done: true, result: `placed the last eye: the END PORTAL IS LIT at ${cx} ${empty.y} ${cz}. Walk into it (travel end) when you are ready` };
                }
                return { done: true, result: `filled a frame (${withEye.length}/${Math.max(12, ring.length)} eyes placed)` };
            }
            if (id === "minecraft:ender_pearl") { takeItems(c, id, 1); const t = { x: bot.location.x + fwd.x * 10, y: bot.location.y + 1, z: bot.location.z + fwd.z * 10 }; const spot = findSafeSpot(dim, t.x, t.z, t.y) || t; bot.teleport(spot); bot.applyDamage(2); return { done: true, result: "threw an ender pearl and teleported" }; }
            if (id === "minecraft:water_bucket" || id === "minecraft:lava_bucket") { const r = placeBlock(bot, ahead, id.replace("_bucket", "")); if (r.ok) { takeItems(c, id, 1); giveItems(c, "minecraft:bucket", 1); } return { done: true, result: r.ok ? `poured ${nameOf(id)} ahead` : r.reason }; }
            if (id === "minecraft:bucket") { const w = findBlocks(bot, b => b.typeId === "minecraft:water", 4, 2, 1)[0]; if (!w) return { done: true, result: "no water nearby to fill the bucket" }; w.setType("minecraft:air"); takeItems(c, id, 1); giveItems(c, "minecraft:water_bucket", 1); return { done: true, result: "filled a water bucket" }; }
            if (/_boat$|^minecraft:boat$/.test(id)) { takeItems(c, id, 1); dim.spawnEntity("minecraft:boat", ahead); return { done: true, result: "placed a boat (interact with it to ride)" }; }
            if (/_spawn_egg$/.test(id)) { takeItems(c, id, 1); const type = id.replace("_spawn_egg", ""); try { dim.spawnEntity(type, ahead); } catch (e) { dim.spawnEntity(type.replace("minecraft:", ""), ahead); } return { done: true, result: `used ${nameOf(id)}` }; }
            if (/milk_bucket/.test(id)) { takeItems(c, id, 1); giveItems(c, "minecraft:bucket", 1); try { for (const ef of bot.getEffects()) bot.removeEffect(ef.typeId); } catch (e) { /* ignore */ } return { done: true, result: "drank milk: effects cleared" }; }
            if (/golden_apple/.test(id)) { takeItems(c, id, 1); try { bot.addEffect("regeneration", 100, { amplifier: 1 }); bot.addEffect("absorption", 20 * 120, { amplifier: 0 }); } catch (e) { /* ignore */ } return { done: true, result: `ate ${nameOf(id)}` }; }
            if (/potion/.test(id)) { takeItems(c, id, 1); bot.addEffect("regeneration", 20 * 15, { amplifier: 0 }); return { done: true, result: `drank ${nameOf(id)}` }; }
            if (/^minecraft:(torch|.*_planks|cobblestone|.*_log|dirt|stone|.*_wool|glass|sand|gravel|.*bricks|obsidian)$/.test(id) || (isModdedId(id) && cfg().freeBuild === false && false)) { const r = placeBlock(bot, ahead, id); return { done: true, result: r.ok ? `placed ${nameOf(id)} ahead` : r.reason }; }
            let nutrition = 0;
            try { const f = new ItemStack(id, 1).getComponent("minecraft:food"); if (f) nutrition = f.nutrition || 4; } catch (e) { /* ignore */ }
            if (nutrition) { takeItems(c, id, 1); bot.addEffect("instant_health", 1, { amplifier: 0, showParticles: false }); bot.playAnimation("eat_item_custom"); return { done: true, result: `ate ${nameOf(id)}` }; }
            // Generic: hold it (modded tools/weapons/gadgets work through the engine when held).
            if (!holdItem(bot, id)) return { done: true, result: `could not take ${nameOf(id)} in hand` };
            return { done: true, result: `now holding ${nameOf(id)}${isModdedId(id) ? " (a modded item; its own effects apply while held or when it hits something)" : ""}` };
        } catch (e) {
            return { done: true, result: `use_item failed: ${e?.message || e}` };
        }
    },
};

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
        if (p.dimension?.id !== ctx.bot.dimension.id || dist(p.location, ctx.bot.location) > 96) return { done: true, result: `${a.player} is too far away` };
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
        try { noteChest(ctx.brain.memory, { x: s.pos.x, y: s.pos.y, z: s.pos.z, dim: bot.dimension.id, items: containerSummary(chest) }, Date.now()); } catch (e) { /* ignore */ }
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

function playerSleepStep(s, ctx) {
    const bot = ctx.bot;
    const t = world.getTimeOfDay();
    const wake = () => { try { bot.removeTag("is_sleeping"); } catch (e) { /* ignore */ } ctx.brain.sleptSince = true; };
    if (!s.asleep) {
        if (!near(bot, s.spot, 1.8)) {
            if (ctx.now - s.started > 20 * 30) { stopMoving(bot); return { done: true, result: "could not get to the bed" }; }
            goTo(bot, s.spot, "walk", PRIO, true); walkProgress(bot, s, s.spot);
            return undefined;
        }
        stopMoving(bot);
        try { bot.runCommand(`spawnpoint @s ${s.bedPos.x} ${s.bedPos.y} ${s.bedPos.z}`); } catch (e) { /* ignore */ }
        try { bot.teleport({ x: s.bedPos.x + 0.5, y: s.bedPos.y + 0.56, z: s.bedPos.z + 0.5 }); } catch (e) { /* ignore */ }
        try { bot.addTag("is_sleeping"); } catch (e) { /* ignore */ }
        ctx.brain.memory.home = ctx.brain.memory.home || { ...s.bedPos, dim: bot.dimension.id };
        s.asleep = true; s.sleptAt = ctx.now;
        return undefined;
    }
    // In bed. The night passes once everyone else is in bed too (or nobody else is here).
    let others = []; try { others = world.getAllPlayers().filter(p => p.id !== bot.id); } catch (e) { /* ignore */ }
    const awake = others.filter(p => { try { return !p.isSleeping; } catch (e) { return true; } });
    if (t >= 500 && t < 12000) { wake(); return { done: true, result: "woke up; it is morning" }; }
    if (!awake.length && ctx.now - s.sleptAt >= 100) {
        try { world.setTimeOfDay(1000); } catch (e) { /* ignore */ }
        try { bot.dimension.runCommand("weather clear"); } catch (e) { /* ignore */ }
        wake();
        return { done: true, result: "slept through the night; it is morning (spawn point set at the bed)" };
    }
    if (ctx.now - s.sleptAt > 20 * 60 * 3) { wake(); return { done: true, result: `rested by the bed, but ${awake.map(p => p.name).join(", ")} stayed up so the night went on` }; }
    return undefined;
}

H.sleep = {
    start: (a, ctx) => {
        const bot = ctx.bot;
        const t = world.getTimeOfDay();
        if (t > 1000 && t < 12000) return { done: true, result: "it is daytime, no need to sleep" };
        let bed = findBlocks(bot, b => b.typeId === "minecraft:bed", 12, 3, 1)[0];
        if (!bed) {
            // carrying a bed: put it down next to where we stand
            const inv = inventoryMap(bot);
            const bedItem = Object.keys(inv).find(id => /:bed$|_bed$/.test(id));
            if (bedItem) {
                const bx = Math.floor(bot.location.x), by = Math.floor(bot.location.y), bz = Math.floor(bot.location.z);
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const spot = blockAt(bot.dimension, bx + dx, by, bz + dz), below = blockAt(bot.dimension, bx + dx, by - 1, bz + dz);
                    if (spot && below && spot.isAir && solid(below)) { const r = placeBlock(bot, { x: bx + dx, y: by, z: bz + dz }, bedItem); if (r.ok) { bed = blockAt(bot.dimension, bx + dx, by, bz + dz); break; } }
                }
            }
        }
        if (!bed && isPlayerBody(bot)) return { done: true, result: "no bed nearby: craft one (3 wool + 3 planks) and carry it, or light the area and stay busy until morning" };
        const spot = bed ? { x: bed.x + 0.5, y: bed.y + 0.6, z: bed.z + 0.5 } : null;
        return { spot, started: ctx.now, asleep: false, bedPos: bed ? { x: bed.x, y: bed.y, z: bed.z } : null, player: isPlayerBody(bot) };
    },
    step: (s, ctx) => {
        if (s.player) return playerSleepStep(s, ctx);
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

H.locate = {
    start: (a, ctx) => {
        const structure = String(a.structure || "").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32);
        if (!structure) return { done: true, result: "locate needs a structure name" };
        const r = ctx.brain.startLocate(structure);
        if (!r.ok) return { done: true, result: r.error };
        return { structure, started: ctx.now };
    },
    step: (s, ctx) => {
        const res = ctx.brain.takeLocateResult(s.structure);
        if (res) {
            if (!res.ok) return { done: true, result: `could not find a ${s.structure}${res.error ? " (" + res.error + ")" : ""}` };
            const where = `${Math.round(res.x)}, ${Math.round(res.z)}`;
            addFact(ctx.brain.memory, `${s.structure} is near x ${Math.round(res.x)} z ${Math.round(res.z)}${typeof res.y === "number" ? " y " + Math.round(res.y) : ""}`, Date.now());
            if (s.structure === "stronghold") { ctx.brain.memory.mission = ctx.brain.memory.mission || {}; ctx.brain.memory.mission.strongholdAt = { x: Math.round(res.x), z: Math.round(res.z) }; }
            const d = Math.round(Math.hypot(res.x - ctx.bot.location.x, res.z - ctx.bot.location.z));
            return { done: true, result: `nearest ${s.structure} is around ${where} (${d} blocks away)` };
        }
        if (ctx.now - s.started > 20 * 30) return { done: true, result: `no answer about the ${s.structure} (is the bridge connected and an operator?)` };
        return undefined;
    },
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
        for (let x = 1; x <= 2; x++) for (let y = 1; y <= 3; y++) { try { bot.dimension.runCommand(`setblock ${bx + x} ${by + y} ${bz} minecraft:portal ["portal_axis"="x"]`); } catch (e) { /* ignore */ } }
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
            if (n === "jump") { try { jump(bot); } catch (e) { /* players cannot be pushed */ } }
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
        actions = actions || [];
        // "just wait" while something is already running or queued is a no-op, not a queued pause
        if (actions.length === 1 && actions[0].type === "wait" && (this.current || this.queue.length)) return;
        for (const a of actions) {
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
        try { this.bot.setDynamicProperty("rg:friend_task", null); this.bot.setDynamicProperty("rg:task_owner", null); this.bot.setDynamicProperty("rg:task_until", 0); this.bot.triggerEvent("rg:job_off"); this.bot.triggerEvent("realai:brain_on"); } catch (e) { /* ignore */ }
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
            else if (a.type === "gather" && s.pred) extra = ` (${s.got}/${s.amount} ${s.label})`;
            else if (a.type === "mine_down" && s.phase) extra = ` (at y ${Math.floor(this.bot.location.y)}, going to y ${s.targetY}, ${s.dug} dug)`;
            parts.push(`${a.type}${extra} for ${Math.round((system.currentTick - this.current.startedTick) / 20)}s`);
        }
        if (this.queue.length) parts.push(`queued: ${this.queue.map(a => a.type).join(", ")}`);
        if (this.follow) parts.push(`following ${this.follow.name}`);
        return parts.join("; ");
    }

    drainResults() { return this.results.splice(0); }
}
