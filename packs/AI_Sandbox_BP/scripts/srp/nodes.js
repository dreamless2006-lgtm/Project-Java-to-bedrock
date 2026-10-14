// Beckon / dispatcher growth, block infestation and moving-flesh merging.
// Runs every 20 s over the handful of node / worker / flesh entities only.
import { world, system } from "@minecraft/server";
import { NODE_GROWTH, PRIMITIVES, MOB_INFO } from "./data.js";
import { state, currentPhase, addPoints, DIMENSIONS, canSpawnMore, safeSpawn, randInt } from "./state.js";

const BORN_KEY = "srp:born";
// minutes a node must live before growing, per current stage (1..3)
const GROW_MINUTES = { 1: 6, 2: 10, 3: 15 };
// minimum phase for a node to grow out of a stage
const GROW_PHASE = { 1: 3, 2: 4, 3: 5 };

/** @type {{ re: RegExp, into: string }[]} */
const INFEST = [
    { re: /^minecraft:(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|mud|dirt_with_roots|moss_block)$/, into: "srp:infested_stain" },
    { re: /^minecraft:(stone|cobblestone|andesite|diorite|granite|deepslate|cobbled_deepslate|tuff|sandstone|gravel|sand)$/, into: "srp:infested_rubble" },
    { re: /^minecraft:(\w+_log|\w+_wood|\w+_stem)$/, into: "srp:infested_trunk" },
    { re: /^srp:infested_stain$/, into: "srp:parasite_biomass" },
];

function infestTarget(typeId) {
    for (const rule of INFEST) if (rule.re.test(typeId)) return rule.into;
    return undefined;
}

function griefingAllowed() {
    try { return world.gameRules.mobGriefing !== false; } catch { return true; }
}

function infestAround(entity, radius, tries) {
    let dim, base;
    try { dim = entity.dimension; base = entity.location; } catch { return 0; }
    let converted = 0;
    for (let t = 0; t < tries; t++) {
        const x = Math.floor(base.x + randInt(-radius, radius));
        const z = Math.floor(base.z + randInt(-radius, radius));
        for (let dy = 2; dy >= -3; dy--) {
            let b;
            try { b = dim.getBlock({ x, y: Math.floor(base.y) + dy, z }); } catch { b = undefined; }
            if (!b || b.isAir || b.isLiquid) continue;
            const above = b.above();
            if (!above || !(above.isAir || above.typeId.includes("grass") || above.typeId.includes("snow"))) break;
            const into = infestTarget(b.typeId);
            if (into) {
                try { b.setType(into); converted++; } catch { }
            }
            break;
        }
    }
    return converted;
}

function nodeStage(typeId) {
    const info = MOB_INFO[typeId];
    return info ? (info.node || 0) : 0;
}

function processNodes(dim) {
    const s = state.settings;
    const nodes = dim.getEntities({ families: ["srp_node"] });
    const now = Date.now();
    const phase = currentPhase();
    const canInfest = s.infestation && griefingAllowed();
    let handled = 0;
    for (const n of nodes) {
        if (handled++ >= 12) break;
        try {
            let born = n.getDynamicProperty(BORN_KEY);
            if (typeof born !== "number") { born = now; n.setDynamicProperty(BORN_KEY, born); }
            const stage = nodeStage(n.typeId);
            if (canInfest) {
                const c = infestAround(n, 3 + stage * 2, stage);
                if (c) addPoints(0.5 * c);
            }
            const next = NODE_GROWTH[n.typeId];
            if (!s.nodes || !next) continue;
            const ageMin = (now - born) / 60000;
            if (ageMin >= (GROW_MINUTES[stage] ?? 99) && phase >= (GROW_PHASE[stage] ?? 99)) {
                const loc = n.location;
                const grown = dim.spawnEntity(next, loc);
                if (grown) {
                    grown.setDynamicProperty(BORN_KEY, now);
                    n.remove();
                    addPoints(20 * stage);
                    try { dim.playSound("srp.node.one", loc, { volume: 2.0 }); } catch { }
                }
            }
        } catch { }
    }
}

function processWorkers(dim) {
    if (!state.settings.infestation || !griefingAllowed()) return;
    const workers = dim.getEntities({ type: "srp:worker" });
    let i = 0;
    for (const w of workers) {
        if (i++ >= 8) break;
        const c = infestAround(w, 2, 1);
        if (c) addPoints(0.5 * c);
    }
}

function processFlesh(dim) {
    const flesh = dim.getEntities({ type: "srp:movingflesh" });
    if (flesh.length < 2) return;
    const used = new Set();
    for (let i = 0; i < flesh.length && i < 16; i++) {
        const a = flesh[i];
        if (used.has(a.id) || !a.isValid) continue;
        for (let j = i + 1; j < flesh.length && j < 16; j++) {
            const b = flesh[j];
            if (used.has(b.id) || !b.isValid) continue;
            const pa = a.location, pb = b.location;
            const d2 = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2;
            if (d2 > 9) continue;
            used.add(a.id); used.add(b.id);
            const into = PRIMITIVES[Math.floor(Math.random() * PRIMITIVES.length)];
            try {
                const e = dim.spawnEntity(into, pa);
                if (e) { a.remove(); b.remove(); addPoints(10); try { dim.playSound("srp.flesh.primitive", pa); } catch { } }
            } catch { }
            break;
        }
    }
}

export function startNodes() {
    let turn = 0;
    // stagger dimensions: one dimension every ~7 s => each dimension every ~20 s
    system.runInterval(() => {
        if (!state.ready) return;
        const id = DIMENSIONS[turn++ % DIMENSIONS.length];
        try {
            const dim = world.getDimension(id);
            processNodes(dim);
            processWorkers(dim);
            processFlesh(dim);
        } catch { }
    }, 140);
}
