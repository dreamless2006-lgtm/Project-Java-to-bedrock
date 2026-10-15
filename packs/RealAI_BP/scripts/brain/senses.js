// What a body can tell about its surroundings by looking. Pure: blocks come in through idAt(x, y, z)
// (a type id, or null when the chunk is not loaded), so this runs in the game and in tests alike.
//
//   survey()    which way can I walk: for each of the eight compass directions how far the ground goes on,
//               and why it ends (a wall, a drop, water, lava, the edge of the loaded world)
//   castRay()   one line of sight from the eyes: the first block in the way
//   sights()    what the eyes see in each direction: trees, ore, water, lava, built things, far rock
//   lookingAt() the block under the crosshair
//
// Directions are Bedrock's: yaw 0 faces south (+z), 90 west (-x), 180 north (-z), -90 east (+x);
// pitch is negative looking up.

import { kindOf, canStand } from "./terrain.js";

// Feet sit on top of the ground, a little above it: 63.9375 on a path block or farmland, 63.875 on soul sand, 64.0 plus a hair
// when standing on something. This much is added before taking the cell the feet are in.
const FEET_EPS = 0.15;

export const COMPASS = [
    { name: "N", dx: 0, dz: -1 }, { name: "NE", dx: 1, dz: -1 }, { name: "E", dx: 1, dz: 0 }, { name: "SE", dx: 1, dz: 1 },
    { name: "S", dx: 0, dz: 1 }, { name: "SW", dx: -1, dz: 1 }, { name: "W", dx: -1, dz: 0 }, { name: "NW", dx: -1, dz: -1 },
];
const RAD = Math.PI / 180;

/** The yaw that faces a compass entry. */
export function yawOf(c) { const y = Math.atan2(-c.dx, c.dz) / RAD; return Math.round(y * 10) / 10 + 0; }
/** The compass entry a yaw faces (nearest of eight). */
export function compassOf(yaw) {
    const fx = -Math.sin(yaw * RAD), fz = Math.cos(yaw * RAD);
    let best = COMPASS[0], bestDot = -2;
    for (const c of COMPASS) { const d = (fx * c.dx + fz * c.dz) / Math.hypot(c.dx, c.dz); if (d > bestDot) { bestDot = d; best = c; } }
    return best;
}
/** A compass name or word ("north-east", "ne", "south", "up") to a yaw; null when it is not one. */
export function yawFromWord(word) {
    const w = String(word || "").toLowerCase().replace(/[\s_-]+/g, "");
    const names = { north: "N", northeast: "NE", east: "E", southeast: "SE", south: "S", southwest: "SW", west: "W", northwest: "NW", n: "N", ne: "NE", e: "E", se: "SE", s: "S", sw: "SW", w: "W", nw: "NW" };
    const c = COMPASS.find(c => c.name === names[w]);
    return c ? yawOf(c) : null;
}
export function wrapYaw(y) { y = ((y + 180) % 360 + 360) % 360 - 180; return y === -180 ? 180 : y; }

function short(id) { return id ? String(id).replace(/^minecraft:/, "") : ""; }

function cached(idAt) {
    const m = new Map();
    return (x, y, z) => { const k = x + "," + y + "," + z; let v = m.get(k); if (v === undefined) { v = idAt(x, y, z); if (v === undefined) v = null; m.set(k, v); } return v; };
}

// ---- walking: how far the ground goes on ------------------------------------------------------

/**
 * Step one column on from a cell: the new feet height (a one-block climb or a short drop included),
 * or the reason there is no way.
 */
function probeColumn(at, px, py, pz, cx, cz, maxDrop) {
    const stand = canStand(at, cx, py, cz);
    if (stand === true) return { y: py };
    if (stand === null && kindOf(at(cx, py, cz)) === null) return { stop: "unloaded" };
    // one block up: a jump, which needs room over the head where we stand
    const room = kindOf(at(px, py + 2, pz));
    if (canStand(at, cx, py + 1, cz) === true && (room === "air" || room === "passable")) return { y: py + 1, climb: true };
    // a step off an edge is taken at head height: the cell over the departure level must be open too
    const over = kindOf(at(cx, py + 1, cz));
    for (let d = 1; d <= maxDrop && (over === "air" || over === "passable"); d++) {
        const k = kindOf(at(cx, py - d + 1, cz));
        if (k !== "air" && k !== "passable") break;
        if (canStand(at, cx, py - d, cz) === true) return { y: py - d };
    }
    // no way on: say why
    const feet = kindOf(at(cx, py, cz)), head = kindOf(at(cx, py + 1, cz)), below = kindOf(at(cx, py - 1, cz));
    if (feet === null || head === null || below === null) return { stop: "unloaded" };
    if (feet === "lava" || below === "lava") return { stop: "lava" };
    if (feet === "hazard" || head === "hazard" || below === "hazard") return { stop: "hazard", block: short(feet === "hazard" ? at(cx, py, cz) : below === "hazard" ? at(cx, py - 1, cz) : at(cx, py + 1, cz)) };
    if (feet === "water" || head === "water") return { stop: "water" };
    if (feet === "tall") return { stop: "wall", block: short(at(cx, py, cz)) };
    if (feet === "solid") return { stop: "wall", block: short(at(cx, py, cz)), high: kindOf(at(cx, py + 1, cz)) === "solid" || kindOf(at(cx, py + 1, cz)) === "tall" };
    if (head === "solid" || head === "tall") return { stop: "wall", block: short(at(cx, py + 1, cz)), low: true };
    // open air in front of us and nothing to stand on within a step: look down for what is there
    for (let g = 1; g <= 40; g++) {
        const k = kindOf(at(cx, py - g, cz));
        if (k === null) return { stop: "unloaded" };
        if (k === "water") return { stop: "water", fall: g - 1 };
        if (k === "lava") return { stop: "lava", fall: g - 1 };
        if (k === "solid" || k === "tall" || k === "hazard") return { stop: "drop", fall: g - 1 };
    }
    return { stop: "drop", fall: 40 };
}

/**
 * The walkable run in each of the eight directions from a feet position.
 * -> [{ dir, steps, metres, stop, block?, fall?, climbs, dy, ground, end:{x, z} }]
 *    stop: "clear" (a full max steps) | "wall" | "drop" | "water" | "lava" | "hazard" | "unloaded"
 */
export function survey(idAt, feet, { max = 24, maxDrop = 3 } = {}) {
    const at = cached(idAt);
    const x0 = Math.floor(feet.x), z0 = Math.floor(feet.z), y0 = Math.floor(feet.y + FEET_EPS);
    const rows = [];
    for (const c of COMPASS) {
        const diag = c.dx !== 0 && c.dz !== 0;
        let px = x0, pz = z0, y = y0, steps = 0, stop = "clear", block, fall, climbs = 0;
        for (let n = 1; n <= max; n++) {
            const cx = x0 + c.dx * n, cz = z0 + c.dz * n;
            if (diag) {
                // no cutting corners: both sides of the diagonal step must be open at body height
                const side = [[px + c.dx, pz], [px, pz + c.dz]];
                let cut = null;
                for (const [sx, sz] of side) for (const dy of [0, 1]) { const k = kindOf(at(sx, y + dy, sz)); if (k !== "air" && k !== "passable" && k !== null) cut = at(sx, y + dy, sz); }
                if (cut) { stop = "wall"; block = short(cut); break; }
            }
            const r = probeColumn(at, px, y, pz, cx, cz, maxDrop);
            if (r.stop) { stop = r.stop; block = r.block; fall = r.fall; break; }
            y = r.y; px = cx; pz = cz; steps = n;
            if (r.climb) climbs++;
        }
        const ground = short(at(px, y - 1, pz));
        rows.push({ dir: c.name, steps, metres: Math.round(steps * (diag ? Math.SQRT2 : 1)), stop, block, fall, climbs, dy: y - y0, ground, end: { x: px, z: pz } });
    }
    return rows;
}

export function describeRow(r) {
    const m = r.metres;
    const climb = r.climbs ? `, ${r.climbs} step${r.climbs > 1 ? "s" : ""} up` : "";
    switch (r.stop) {
        case "clear": return `${m} clear${climb}`;
        case "wall": return m ? `${m} then a wall${r.block ? " of " + r.block : ""}${climb}` : `wall${r.block ? " of " + r.block : ""} right there`;
        case "drop": return `${m} then a drop of ${r.fall >= 40 ? "40+" : r.fall}`;
        case "water": return m ? `${m} then water${r.fall ? " (" + r.fall + " down)" : ""}` : "water right there";
        case "lava": return m ? `${m} then LAVA` : "LAVA right there";
        case "hazard": return `${m} then ${r.block || "a hazard"}`;
        case "unloaded": return `${m} then the edge of what is loaded`;
        default: return `${m} ${r.stop}`;
    }
}

// ---- seeing: lines of sight ----------------------------------------------------------------------

/**
 * One line of sight (a voxel walk). origin = the eyes. -> { hit: {id, kind, x, y, z, dist} | null, unloaded, range }
 * Air and soft blocks (grass, snow layers, flowers) do not stop it; water, lava, fences and full blocks do.
 */
export function castRay(idAt, origin, yaw, pitch, maxDist = 40) {
    const yr = yaw * RAD, pr = pitch * RAD;
    const dx = -Math.sin(yr) * Math.cos(pr), dy = -Math.sin(pr), dz = Math.cos(yr) * Math.cos(pr);
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tD = (d) => (Math.abs(d) < 1e-9 ? Infinity : 1 / Math.abs(d));
    const tdx = tD(dx), tdy = tD(dy), tdz = tD(dz);
    let tx = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? x + 1 - origin.x : origin.x - x) * tdx);
    let ty = Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? y + 1 - origin.y : origin.y - y) * tdy);
    let tz = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? z + 1 - origin.z : origin.z - z) * tdz);
    for (let guard = 0; guard < 400; guard++) {
        let t, face;
        if (tx <= ty && tx <= tz) { t = tx; x += sx; tx += tdx; face = { x: -sx, y: 0, z: 0 }; }
        else if (ty <= tz) { t = ty; y += sy; ty += tdy; face = { x: 0, y: -sy, z: 0 }; }
        else { t = tz; z += sz; tz += tdz; face = { x: 0, y: 0, z: -sz }; }
        if (t > maxDist) break;
        const id = idAt(x, y, z);
        if (id === null || id === undefined) return { hit: null, unloaded: true, range: t };
        const kind = kindOf(id);
        if (kind === "air" || kind === "passable") continue;
        return { hit: { id, kind, x, y, z, dist: t, face }, unloaded: false, range: t };      // face: the side of the block the ray came in through (a unit vector pointing out of it)
    }
    return { hit: null, unloaded: false, range: maxDist };
}

const CLASSES = [
    ["tree", /_log$|_wood$|_leaves$|_hyphae$|_stem$|mangrove_roots|^minecraft:bamboo$/],
    ["ore", /_ore$|ancient_debris/],
    ["built", /_planks$|_door$|_trapdoor$|_stairs$|_slab$|_fence|_gate$|glass|bookshelf|_bed$|^minecraft:bed$|crafting_table|furnace|smoker|chest|barrel|brick|(^|[:_])torch$|lantern|_sign$|ladder|_wool$|_carpet$|concrete|hay_block|cobblestone|_wall$|iron_bars|campfire|anvil|lectern|cauldron|bell|farmland|smooth_(stone|sandstone|quartz|red_sandstone)|polished_|cut_|chiseled_/],
    ["rock", /^minecraft:(stone|deepslate|cobbled_deepslate|granite|diorite|andesite|tuff|calcite|netherrack|basalt|smooth_basalt|blackstone|end_stone|obsidian|crying_obsidian|bedrock|dripstone_block|prismarine|sandstone|red_sandstone)$/],
    ["ice", /ice$|snow/],
    ["sand", /sand|gravel|clay|mud|dirt|grass_block|podzol|mycelium|moss|path/],
];
/** What a seen block is, for a report: tree | ore | water | lava | built | rock | ice | sand | other. */
export function sightClass(id, kind) {
    if (kind === "water") return "water";
    if (kind === "lava") return "lava";
    for (const [name, re] of CLASSES) if (re.test(id)) return name;
    return "other";
}
const REPORT = new Set(["tree", "ore", "water", "lava", "built"]);

/**
 * What the eyes see in each of the eight directions: rays at a few pitches, the nearest of each kind of
 * thing. -> [{ dir, seen: [{cls, dist, id, x, y, z}], open }]  (open: the level ray travelled max with nothing in the way)
 */
export function sights(idAt, eye, { pitches = [-25, 0, 8], max = 40 } = {}) {
    const at = cached(idAt);
    const minY = Math.floor(eye.y - 1.62 + FEET_EPS);     // what lies below the feet is the ground, not a sight
    const out = [];
    for (const c of COMPASS) {
        const yaw = yawOf(c);
        const best = new Map();
        let open = false;
        for (const p of pitches) {
            const r = castRay(at, eye, yaw, p, max);
            if (p === 0 && !r.hit && !r.unloaded) open = true;
            if (!r.hit || r.hit.y < minY) continue;
            const cls = sightClass(r.hit.id, r.hit.kind);
            const cur = best.get(cls);
            if (!cur || r.hit.dist < cur.dist) best.set(cls, { cls, dist: Math.round(r.hit.dist), id: short(r.hit.id), x: r.hit.x, y: r.hit.y, z: r.hit.z });
        }
        const seen = [...best.values()].filter(s => REPORT.has(s.cls) || (s.cls === "rock" && s.dist >= 8)).sort((a, b) => a.dist - b.dist);
        out.push({ dir: c.name, seen, open });
    }
    return out;
}

/**
 * What stands out within `radius` blocks, in any direction, found on a coarse grid (one column in `stride`): the canopy and
 * trunks of trees at head and crown height, walls of buildings, water and lava at the surface. A line of sight is a thin thing and misses
 * a tree three blocks off its axis; a tree's crown is five blocks wide, so a grid with a stride of three cannot miss one.
 * -> [{ dir, seen: [{cls, dist, n}] }] per compass sector, nearest first.
 */
export function landmarks(idAt, feet, { radius = 24, stride = 3 } = {}) {
    const at = cached(idAt);
    const fx = Math.floor(feet.x), fz = Math.floor(feet.z), fy = Math.floor(feet.y + FEET_EPS);
    const sectors = new Map(COMPASS.map(c => [c.name, new Map()]));
    const note = (dir, cls, d) => {
        const m = sectors.get(dir); const cur = m.get(cls);
        if (!cur) m.set(cls, { cls, dist: d, n: 1 }); else { cur.n++; if (d < cur.dist) cur.dist = d; }
    };
    for (let dx = -radius; dx <= radius; dx += stride) {
        for (let dz = -radius; dz <= radius; dz += stride) {
            const d = Math.hypot(dx, dz);
            if (d < 3 || d > radius) continue;
            const dir = compassOf(Math.atan2(-dx, dz) / RAD).name;
            const x = fx + dx, z = fz + dz;
            let id = at(x, fy + 4, z);
            if (id && /_leaves$|_log$|_wood$|_hyphae$/.test(id)) { note(dir, "tree", d); continue; }
            id = at(x, fy + 2, z);
            if (id && /_log$|_wood$|_hyphae$/.test(id)) { note(dir, "tree", d); continue; }
            // a wall of a building has collision: carpets of moss, torchflowers and the like are ground cover, not masonry
            if (id && kindOf(id) !== "passable" && sightClass(id, kindOf(id)) === "built") { note(dir, "built", d); continue; }
            id = at(x, fy, z);
            if (id && kindOf(id) !== "passable" && sightClass(id, kindOf(id)) === "built") { note(dir, "built", d); continue; }
            const k = kindOf(at(x, fy - 1, z));
            if (k === "water") note(dir, "water", d);
            else if (k === "lava") note(dir, "lava", d);
        }
    }
    return COMPASS.map(c => ({ dir: c.name, seen: [...sectors.get(c.name).values()].map(e => ({ ...e, dist: Math.round(e.dist) })).sort((a, b) => a.dist - b.dist) }));
}

/** The block under the crosshair, or what is (not) there. */
export function lookingAt(idAt, eye, yaw, pitch, max = 24) {
    const r = castRay(idAt, eye, yaw, pitch, max);
    if (r.hit) return { id: short(r.hit.id), x: r.hit.x, y: r.hit.y, z: r.hit.z, dist: Math.round(r.hit.dist * 10) / 10, cls: sightClass(r.hit.id, r.hit.kind), face: r.hit.face };
    return { id: null, dist: null, open: !r.unloaded, unloaded: r.unloaded };
}

/** One line per direction for the prompt: how far it goes on, why it stops, and what stands out. */
export function describeAround(rows, seen, facing, { visited } = {}) {
    const bySeen = new Map((seen || []).map(s => [s.dir, s]));
    const parts = [];
    for (const r of rows) {
        let t = `${r.dir}${r.dir === facing ? " (ahead)" : ""}: ${describeRow(r)}`;
        const s = bySeen.get(r.dir);
        const sights = s && s.seen.length ? s.seen.slice(0, 3).map(x => `${x.cls === "tree" && (x.n || 1) > 1 ? "trees" : x.cls} ${x.dist}m${(x.n || 1) > 2 ? " x" + x.n : ""}`).join(", ") : "";
        if (sights) t += ` [${sights}]`;
        else if (s && s.open) t += " [far view open]";
        if (visited && r.steps >= 8 && !visited(r.end)) t += " (unexplored)";
        parts.push(t);
    }
    return parts.join("; ");
}

/**
 * Is the next cell a body walking from `feet` towards `ahead` would enter walkable? Used by raw key
 * presses, which have no path to follow: the answer is the feet height to expect there, or why not.
 * -> { ok: true, y, climb } | { ok: false, stop, block?, fall? }
 */
export function probeStep(idAt, feet, ahead, { maxDrop = 3 } = {}) {
    const at = cached(idAt);
    const px = Math.floor(feet.x), pz = Math.floor(feet.z), y = Math.floor(feet.y + FEET_EPS);
    const cx = Math.floor(ahead.x), cz = Math.floor(ahead.z);
    if (cx === px && cz === pz) return { ok: true, y, climb: false };
    if (cx !== px && cz !== pz) {
        for (const [sx, sz] of [[cx, pz], [px, cz]]) for (const dy of [0, 1]) {
            const k = kindOf(at(sx, y + dy, sz));
            if (k !== "air" && k !== "passable" && k !== null) return { ok: false, stop: "wall", block: short(at(sx, y + dy, sz)) };
        }
    }
    const r = probeColumn(at, px, y, pz, cx, cz, maxDrop);
    if (r.stop) return { ok: false, stop: r.stop, block: r.block, fall: r.fall };
    return { ok: true, y: r.y, climb: !!r.climb };
}

/** What is overhead: "open sky" or "a roof of <block> N blocks up". */
export function describeAbove(idAt, feet, max = 24) {
    const x = Math.floor(feet.x), z = Math.floor(feet.z), y = Math.floor(feet.y + FEET_EPS);
    for (let d = 2; d <= max; d++) {
        const id = idAt(x, y + d, z);
        if (id === null || id === undefined) return "unknown overhead";
        const k = kindOf(id);
        if (k !== "air" && k !== "passable") return `${short(id)} ${d - 1} above your head`;
    }
    return "open sky";
}

/**
 * The way ahead of a body holding a key: walks along (hx, hz) from `feet` for `reach` blocks and reports the first
 * thing that changes. -> { ok: true, floor, climb, edge } where `edge` is the distance at which the ground level changes
 * to `floor` (undefined, with floor the current level, when it does not within reach) | { ok: false, stop, block, fall, at }.
 */
export function probeAhead(idAt, feet, hx, hz, reach = 1.8, { maxDrop = 3 } = {}) {
    const at = cached(idAt);
    let px = Math.floor(feet.x), pz = Math.floor(feet.z);
    const y = Math.floor(feet.y + FEET_EPS);
    for (let d = 0.2; d <= reach + 1e-9; d += 0.2) {
        const cx = Math.floor(feet.x + hx * d), cz = Math.floor(feet.z + hz * d);
        if (cx === px && cz === pz) continue;
        if (cx !== px && cz !== pz) {
            for (const [sx, sz] of [[cx, pz], [px, cz]]) for (const dy of [0, 1]) {
                const k = kindOf(at(sx, y + dy, sz));
                if (k !== "air" && k !== "passable" && k !== null) return { ok: false, stop: "wall", block: short(at(sx, y + dy, sz)), at: d };
            }
        }
        const r = probeColumn(at, px, y, pz, cx, cz, maxDrop);
        if (r.stop) return { ok: false, stop: r.stop, block: r.block, fall: r.fall, at: d };
        if (r.y !== y) return { ok: true, floor: r.y, climb: !!r.climb, edge: Math.max(0, d - 0.1) };
        px = cx; pz = cz;
    }
    return { ok: true, floor: y, climb: false, edge: undefined };
}
