// Scape and Run: Parasites (Bedrock port) - shared state: settings, evolution phase, entity caps.
import { world, system } from "@minecraft/server";
import { MOB_INFO } from "./data.js";

export const NS = "srp:";
const SETTINGS_KEY = "srp:settings";
const POINTS_KEY = "srp:points";

// Points needed to reach each phase (index = phase). Scaled down from the Java defaults so a
// Bedrock world progresses in a sensible amount of play time.
export const PHASE_POINTS = [0, 150, 400, 900, 2000, 4500, 9000, 16000, 28000, 45000, 70000];

export const DEFAULT_SETTINGS = {
    enabled: true,        // master switch for natural parasite spawning
    evolution: true,      // evolution phases gain points
    assimilation: true,   // mobs killed by parasites turn into assimilated parasites
    coth: true,           // Call of the Hive infection
    infestation: true,    // nodes/workers convert nearby blocks (needs mobGriefing)
    nodes: true,          // beckons / dispatchers can appear and grow
    globalCap: 45,        // max parasites loaded in the world (spawner + conversions)
    localCap: 10,         // max parasites near one player before the spawner stops there
    interval: 15,         // seconds between spawn attempts per player
    maxNodes: 4,          // max beckons/dispatchers loaded at once
    lockedPhase: -1       // -1 = automatic, otherwise force this phase
};

export const state = {
    ready: false,
    settings: { ...DEFAULT_SETTINGS },
    points: 0,
    phase: 0,
    dirty: false,
    parasiteCount: 0,     // refreshed periodically (cheap global count)
    nodeCount: 0
};

export function isParasiteId(typeId) {
    return typeof typeId === "string" && typeId.startsWith(NS);
}

export function isParasite(entity) {
    try { return MOB_INFO[entity.typeId] !== undefined; } catch { return false; }
}

export function phaseFromPoints(points) {
    let p = 0;
    for (let i = 0; i < PHASE_POINTS.length; i++) if (points >= PHASE_POINTS[i]) p = i;
    return p;
}

export function currentPhase() {
    const lock = state.settings.lockedPhase;
    return lock >= 0 ? Math.min(10, lock) : state.phase;
}

export function loadState() {
    try {
        const raw = world.getDynamicProperty(SETTINGS_KEY);
        if (typeof raw === "string") {
            const parsed = JSON.parse(raw);
            state.settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) { console.warn("[SRP] settings load failed: " + e); }
    try {
        const p = world.getDynamicProperty(POINTS_KEY);
        state.points = typeof p === "number" && isFinite(p) ? Math.max(0, p) : 0;
    } catch { state.points = 0; }
    state.phase = phaseFromPoints(state.points);
    state.ready = true;
}

export function saveSettings() {
    try { world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { console.warn("[SRP] settings save failed: " + e); }
}

function flushPoints() {
    if (!state.dirty) return;
    state.dirty = false;
    try { world.setDynamicProperty(POINTS_KEY, state.points); } catch { }
}

const PHASE_SOUNDS = ["", "srp.evolution.phaseone", "srp.evolution.phasetwo", "srp.evolution.phasethree", "srp.evolution.phasefour",
    "srp.evolution.phasefive", "srp.evolution.phasesix", "srp.evolution.phaseseven", "srp.evolution.phaseeight",
    "srp.evolution.phasenine", "srp.evolution.phaseten"];

function announcePhase(newPhase, oldPhase) {
    const up = newPhase > oldPhase;
    const msg = up
        ? `§4[Parasites] §cThe hive has evolved to §4Phase ${newPhase}§c...`
        : `§2[Parasites] §aThe hive has been pushed back to Phase ${newPhase}.`;
    try { world.sendMessage(msg); } catch { }
    for (const p of world.getAllPlayers()) {
        try {
            p.onScreenDisplay.setTitle(up ? `§4Phase ${newPhase}` : `§2Phase ${newPhase}`, {
                subtitle: up ? "§cThe parasites grow stronger" : "§aThe parasites weaken",
                fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20
            });
            if (up && PHASE_SOUNDS[newPhase]) p.playSound(PHASE_SOUNDS[newPhase], { volume: 0.8 });
        } catch { }
    }
}

export function addPoints(amount) {
    if (!state.ready || !state.settings.evolution || !amount) return;
    const before = state.phase;
    state.points = Math.max(0, Math.min(PHASE_POINTS[10] * 2, state.points + amount));
    state.phase = phaseFromPoints(state.points);
    state.dirty = true;
    if (state.phase !== before && state.settings.lockedPhase < 0) announcePhase(state.phase, before);
}

export function setPoints(value) {
    const before = state.phase;
    state.points = Math.max(0, value);
    state.phase = phaseFromPoints(state.points);
    state.dirty = true;
    if (state.phase !== before) announcePhase(state.phase, before);
}

export const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

export function countFamily(family) {
    let n = 0;
    for (const id of DIMENSIONS) {
        try { n += world.getDimension(id).getEntities({ families: [family] }).length; } catch { }
    }
    return n;
}

export function startStateLoops() {
    // persist points at most every 10 s instead of on every kill
    system.runInterval(() => { try { flushPoints(); } catch { } }, 200);
    // global parasite / node counts every 10 s (single filtered query per dimension)
    system.runInterval(() => {
        try {
            state.parasiteCount = countFamily("parasite");
            state.nodeCount = countFamily("srp_node");
        } catch { }
    }, 200);
}

export function canSpawnMore(extra = 1) {
    return state.parasiteCount + extra <= state.settings.globalCap;
}

export function noteSpawned(n = 1) {
    state.parasiteCount += n;
}

export function rand(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

export function weightedPick(entries, weightIndex) {
    let total = 0;
    for (const e of entries) total += e[weightIndex];
    let r = Math.random() * total;
    for (const e of entries) { r -= e[weightIndex]; if (r <= 0) return e; }
    return entries[entries.length - 1];
}

export function safeSpawn(dimension, typeId, location) {
    try {
        const e = dimension.spawnEntity(typeId, location);
        noteSpawned(1);
        return e;
    } catch (e) {
        return undefined;
    }
}
