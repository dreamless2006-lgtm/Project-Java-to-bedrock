// Pathfinding for a player-sized body over block cells. Pure: it reads blocks through a
// function so it runs in the game and in tests alike. A* with an eight-way grid, one-block
// steps up (a jump), drops of up to three blocks, no lava, water only when allowed.
//
// findPath(blockAt, start, goal, opts) -> { ok, path: [{x, y, z}], nodes, reason }
//   blockAt(x, y, z) returns the block's typeId, or null when the chunk is not loaded.
//   start/goal are feet positions; the path is a list of feet positions at cell centres.

const AIRLIKE = /^minecraft:(air|cave_air|void_air|tallgrass|short_grass|fern|large_fern|double_plant|snow_layer|torch|.*_torch|redstone_torch|vine|.*_vines|.*_sapling|.*_flower|dandelion|poppy|wither_rose|seagrass|kelp|lily_pad|sweet_berry_bush|.*_carpet|carpet|rail|.*_rail|lever|.*_button|.*_pressure_plate|tripwire|string|web|cobweb|.*_sign|.*_banner|ladder|scaffolding|light_block|structure_void|dead_bush|.*_mushroom|bamboo_sapling|moss_carpet|pink_petals|hanging_roots|glow_lichen|sculk_vein|nether_sprouts|.*_roots|cave_vines.*|spore_blossom|small_dripleaf|big_dripleaf|azalea|flowering_azalea|.*_coral_fan|.*_coral|sea_pickle|frogspawn|.*_candle)$/;
const WATER = /^minecraft:(water|flowing_water)$/;
const LAVA = /^minecraft:(lava|flowing_lava)$/;
const HARMFUL = /^minecraft:(cactus|magma|sweet_berry_bush|wither_rose|fire|soul_fire|campfire|soul_campfire|powder_snow|pointed_dripstone)$/;

export const PATH_DEFAULTS = { maxNodes: 1200, maxDrop: 3, allowWater: true, goalRadius: 1.0, maxDetour: 2.5, detourSlack: 6 };

export function isPassable(id, allowWater) { return !!id && (AIRLIKE.test(id) || (allowWater && WATER.test(id))); }
export function isSolidId(id) { return !!id && !AIRLIKE.test(id) && !WATER.test(id) && !LAVA.test(id); }

// A tiny binary heap keyed on f.
class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function findPath(blockAt, start, goal, opts = {}) {
    const o = { ...PATH_DEFAULTS, ...opts };
    const cache = new Map();
    const at = (x, y, z) => { const k = x + "," + y + "," + z; let v = cache.get(k); if (v === undefined) { v = blockAt(x, y, z); if (v === undefined) v = null; cache.set(k, v); } return v; };
    const passable = (x, y, z) => { const id = at(x, y, z); return id !== null && isPassable(id, o.allowWater); };
    const ground = (x, y, z) => { const id = at(x, y, z); return id !== null && (isSolidId(id) || (o.allowWater && WATER.test(id))); };
    const dangerous = (x, y, z) => { const id = at(x, y, z); return !!id && (LAVA.test(id) || HARMFUL.test(id)); };
    // can a body stand with its feet in (x, y, z)?
    const standable = (x, y, z) => {
        if (!passable(x, y, z) || !passable(x, y + 1, z)) return false;
        if (!ground(x, y - 1, z)) return false;
        if (dangerous(x, y - 1, z) || dangerous(x, y, z) || dangerous(x, y + 1, z)) return false;
        for (const [dx, dz] of DIRS.slice(0, 4)) { if (dangerous(x + dx, y, z + dz) || dangerous(x + dx, y - 1, z + dz)) return false; }
        return true;
    };
    const sx = Math.floor(start.x), sy = Math.floor(start.y), sz = Math.floor(start.z);
    const gx = Math.floor(goal.x), gy = Math.floor(goal.y), gz = Math.floor(goal.z);
    const straight = Math.hypot(gx - sx, gz - sz);
    const h = (x, y, z) => Math.hypot(gx - x, gz - z) + Math.abs(gy - y) * 0.5;
    const key = (x, y, z) => x + "," + y + "," + z;
    const open = new Heap();
    const best = new Map();       // key -> g
    const parent = new Map();     // key -> node
    const startNode = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), k: key(sx, sy, sz) };
    open.push(startNode); best.set(startNode.k, 0);
    let nodes = 0, found = null, closest = startNode, closestH = startNode.f;
    while (open.size) {
        const n = open.pop();
        if (n.g > (best.get(n.k) ?? Infinity)) continue;
        nodes++;
        const hn = h(n.x, n.y, n.z);
        if (hn < closestH) { closest = n; closestH = hn; }
        if (Math.hypot(gx - n.x, gz - n.z) <= o.goalRadius && Math.abs(gy - n.y) <= 2) { found = n; break; }
        if (nodes >= o.maxNodes) break;
        for (const [dx, dz] of DIRS) {
            const nx = n.x + dx, nz = n.z + dz;
            const diag = dx !== 0 && dz !== 0;
            if (diag && !(passable(n.x + dx, n.y, n.z) && passable(n.x + dx, n.y + 1, n.z) && passable(n.x, n.y, n.z + dz) && passable(n.x, n.y + 1, n.z + dz))) continue;   // no corner cutting
            // same level, one up (a jump: needs room over the head), then drops
            let ny = null, extra = 0;
            if (standable(nx, n.y, nz)) { ny = n.y; }
            else if (standable(nx, n.y + 1, nz) && passable(n.x, n.y + 2, n.z)) { ny = n.y + 1; extra = 0.8; }
            else { for (let d = 1; d <= o.maxDrop; d++) { if (!passable(nx, n.y - d + 1, nz)) break; if (standable(nx, n.y - d, nz)) { ny = n.y - d; extra = 0.2 * d; break; } } }
            if (ny === null) continue;
            const stepCost = (diag ? 1.4142 : 1) + extra + (WATER.test(at(nx, ny, nz) || "") ? 1 : 0);
            const g = n.g + stepCost;
            const k = key(nx, ny, nz);
            if (g >= (best.get(k) ?? Infinity)) continue;
            best.set(k, g);
            const m = { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), k };
            parent.set(k, n);
            open.push(m);
        }
    }
    if (!found) return { ok: false, reason: nodes >= o.maxNodes ? "search budget spent" : "no way through", nodes, closest: { x: closest.x + 0.5, y: closest.y, z: closest.z + 0.5 } };
    const cells = [];
    for (let n = found; n; n = parent.get(n.k)) cells.push(n);
    cells.reverse();
    if (found.g > o.maxDetour * straight + o.detourSlack) return { ok: false, reason: "too far around", nodes, length: found.g };
    const path = smooth(cells, standable).map(c => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }));
    return { ok: true, path, nodes, length: found.g };
}

// Drop waypoints that a straight walk at the same height would pass through anyway.
function smooth(cells, standable) {
    if (cells.length <= 2) return cells.slice(1);
    const out = [];
    let i = 0;
    while (i < cells.length - 1) {
        let j = Math.min(cells.length - 1, i + 8);
        for (; j > i + 1; j--) {
            if (cells[j].y !== cells[i].y) continue;
            if (clearLine(cells[i], cells[j], standable)) break;
        }
        out.push(cells[j]);
        i = j;
    }
    return out;
}

function clearLine(a, b, standable) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const n = Math.max(Math.abs(dx), Math.abs(dz)) * 2;
    for (let s = 1; s < n; s++) {
        const x = Math.floor(a.x + 0.5 + dx * s / n), z = Math.floor(a.z + 0.5 + dz * s / n);
        if (!standable(x, a.y, z)) return false;
    }
    return true;
}
