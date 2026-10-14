// Phase-based parasite spawner (replaces Java's custom evolution spawner).
// Work per cycle is bounded: one filtered entity query + at most a few block lookups per player.
import { world, system } from "@minecraft/server";
import { PHASE_SPAWNS, MOB_INFO } from "./data.js";
import { state, currentPhase, canSpawnMore, weightedPick, randInt, rand, safeSpawn } from "./state.js";

const SOLID_BAD = new Set(["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava",
    "minecraft:bedrock", "minecraft:barrier", "minecraft:magma", "minecraft:fire", "minecraft:cactus", "minecraft:powder_snow"]);

function isDay() {
    const t = world.getTimeOfDay();
    return t < 12800 || t > 23200;
}

/** Find a standable spot near (x, z) around refY. Returns {x,y,z, skyExposed} or undefined. */
function findSpot(dimension, x, z, refY, isOverworld) {
    let top;
    if (isOverworld) {
        try { top = dimension.getTopmostBlock({ x, z }); } catch { top = undefined; }
        if (top && Math.abs(top.y - refY) <= 24) {
            const id = top.typeId;
            if (SOLID_BAD.has(id) || top.isLiquid || id.includes("leaves")) return undefined;
            const above = top.above();
            if (!above || !above.isAir) return undefined;
            return { x: x + 0.5, y: top.y + 1, z: z + 0.5, skyExposed: true };
        }
    }
    // caves / nether / end: scan a short vertical window around the player height
    const start = Math.floor(refY) + 6;
    for (let y = start; y > start - 18; y--) {
        let b;
        try { b = dimension.getBlock({ x, y, z }); } catch { return undefined; }
        if (!b) return undefined;
        if (b.isAir) continue;
        if (b.isLiquid || SOLID_BAD.has(b.typeId)) return undefined;
        const a1 = b.above(), a2 = a1?.above();
        if (a1?.isAir && a2?.isAir) {
            let exposed = false;
            if (isOverworld) {
                try { const t = dimension.getTopmostBlock({ x, z }); exposed = t ? t.y <= y : false; } catch { }
            }
            return { x: x + 0.5, y: y + 1, z: z + 0.5, skyExposed: exposed };
        }
    }
    return undefined;
}

function farFromPlayers(players, loc, minDist) {
    for (const p of players) {
        const d = p.location;
        const dx = d.x - loc.x, dz = d.z - loc.z;
        if (dx * dx + dz * dz < minDist * minDist) return false;
    }
    return true;
}

function trySpawnFor(player, players) {
    const s = state.settings;
    let dim;
    try { dim = player.dimension; } catch { return; }
    try { if (String(player.getGameMode()).toLowerCase() === "spectator") return; } catch { }
    const phase = currentPhase();
    const list = PHASE_SPAWNS[String(phase)] || PHASE_SPAWNS["0"];
    if (!list || !list.length) return;
    // local cap
    const near = dim.getEntities({ location: player.location, maxDistance: 64, families: ["parasite"] });
    const localCap = Math.min(s.localCap + Math.floor(phase / 3), 30);
    if (near.length >= localCap) return;
    if (!canSpawnMore(1)) return;
    const isOverworld = dim.id === "minecraft:overworld";
    // chance per cycle: grows with phase, much lower in daylight before phase 7
    let chance = 0.35 + phase * 0.05;
    const day = isOverworld && isDay();
    for (let attempt = 0; attempt < 3; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = rand(24, 44);
        const x = Math.floor(player.location.x + Math.cos(ang) * dist);
        const z = Math.floor(player.location.z + Math.sin(ang) * dist);
        const spot = findSpot(dim, x, z, player.location.y, isOverworld);
        if (!spot) continue;
        if (!farFromPlayers(players, spot, 20)) continue;
        if (day && spot.skyExposed && phase < 7 && Math.random() > 0.25) return;
        if (Math.random() > chance) return;
        const entry = weightedPick(list, 3);
        const [typeId, min, max] = entry;
        const info = MOB_INFO[typeId] || {};
        let count = Math.min(randInt(min, max), 3, localCap - near.length);
        if (info.boss) count = 1;
        for (let i = 0; i < count; i++) {
            if (!canSpawnMore(1)) break;
            const loc = { x: spot.x + rand(-1.5, 1.5), y: spot.y + (info.fly ? 3 : 0), z: spot.z + rand(-1.5, 1.5) };
            safeSpawn(dim, typeId, loc);
        }
        return;
    }
}

function trySpawnNode(player, players) {
    const s = state.settings;
    const phase = currentPhase();
    if (!s.nodes || phase < 3) return;
    if (state.nodeCount >= s.maxNodes) return;
    if (Math.random() > 0.04 + phase * 0.006) return;
    let dim;
    try { dim = player.dimension; } catch { return; }
    if (dim.getEntities({ location: player.location, maxDistance: 96, families: ["srp_node"] }).length > 0) return;
    const ang = Math.random() * Math.PI * 2, dist = rand(36, 56);
    const x = Math.floor(player.location.x + Math.cos(ang) * dist), z = Math.floor(player.location.z + Math.sin(ang) * dist);
    const spot = findSpot(dim, x, z, player.location.y, dim.id === "minecraft:overworld");
    if (!spot || !farFromPlayers(players, spot, 30)) return;
    const typeId = phase >= 7 && Math.random() < 0.35 ? "srp:dispatcher_si" : "srp:beckon_si";
    if (safeSpawn(dim, typeId, spot)) state.nodeCount++;
}

export function startSpawner() {
    // One player is processed per slice so the cost is spread across ticks.
    let queue = [];
    let lastRound = 0;
    system.runInterval(() => {
        try {
            const s = state.settings;
            if (!state.ready || !s.enabled) return;
            const now = system.currentTick;
            if (queue.length === 0) {
                if (now - lastRound < Math.max(5, s.interval) * 20) return;
                lastRound = now;
                queue = world.getAllPlayers();
                if (!queue.length) return;
            }
            const players = world.getAllPlayers();
            const p = queue.pop();
            if (!p || !p.isValid) return;
            trySpawnFor(p, players);
            trySpawnNode(p, players);
        } catch (e) { /* never let the spawner break the script runtime */ }
    }, 10);
}
