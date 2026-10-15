// Pathfinding for a player-sized body over block cells. Pure: it reads blocks through a
// function so it runs in the game and in tests alike. A* with an eight-way grid, one-block
// steps up (a jump), drops of up to three blocks, no lava, water only when allowed.
//
// findPath(blockAt, start, goal, opts) -> { ok, path: [{x, y, z}], nodes, reason }
//   blockAt(x, y, z) returns the block's typeId, or null when the chunk is not loaded.
//   start/goal are feet positions; the path is a list of feet positions at cell centres.

import { kindOf, isOpen, isGround, canStand, nearDanger } from "./terrain.js";

export const PATH_DEFAULTS = { maxNodes: 1200, maxDrop: 3, allowWater: true, goalRadius: 1.0, maxDetour: 4, detourSlack: 16, ignoreGoalY: false, allowPartial: true, minProgress: 3 };

export function isPassable(id, allowWater) { return isOpen(kindOf(id), allowWater); }
export function isSolidId(id) { return isGround(kindOf(id), false); }

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
    const passable = (x, y, z) => { const k = kindOf(at(x, y, z)); return k !== null && isOpen(k, o.allowWater); };
    // can a body stand with its feet in (x, y, z)?
    const standable = (x, y, z) => canStand(at, x, y, z, o.allowWater) === true && !nearDanger(at, x, y, z);
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
        if (Math.hypot(gx - n.x, gz - n.z) <= o.goalRadius && (o.ignoreGoalY || Math.abs(gy - n.y) <= 2)) { found = n; break; }
        if (nodes >= o.maxNodes) break;
        for (const [dx, dz] of DIRS) {
            const nx = n.x + dx, nz = n.z + dz;
            const diag = dx !== 0 && dz !== 0;
            if (diag && !(passable(n.x + dx, n.y, n.z) && passable(n.x + dx, n.y + 1, n.z) && passable(n.x, n.y, n.z + dz) && passable(n.x, n.y + 1, n.z + dz))) continue;   // no corner cutting
            // same level, one up (a jump: needs room over the head), then drops
            let ny = null, extra = 0;
            if (standable(nx, n.y, nz)) { ny = n.y; }
            else if (standable(nx, n.y + 1, nz) && passable(n.x, n.y + 2, n.z)) { ny = n.y + 1; extra = 0.8; }
            else if (passable(nx, n.y + 1, nz)) { for (let d = 1; d <= o.maxDrop; d++) { if (!passable(nx, n.y - d + 1, nz)) break; if (standable(nx, n.y - d, nz)) { ny = n.y - d; extra = 0.2 * d; break; } } }   // stepping off an edge happens at head height: the cell above the departure level must be open too
            if (ny === null) continue;
            const stepCost = (diag ? 1.4142 : 1) + extra + (kindOf(at(nx, ny, nz)) === "water" ? 1 : 0);
            const g = n.g + stepCost;
            const k = key(nx, ny, nz);
            if (g >= (best.get(k) ?? Infinity)) continue;
            best.set(k, g);
            const m = { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), k };
            parent.set(k, n);
            open.push(m);
        }
    }
    let partial = false;
    if (!found) {
        // no way all the way: head for the reachable cell that gets closest, if that is real progress
        const gained = Math.hypot(gx - sx, gz - sz) - Math.hypot(gx - closest.x, gz - closest.z);
        if (!o.allowPartial || gained < o.minProgress) return { ok: false, reason: nodes >= o.maxNodes ? "search budget spent" : "no way through", nodes, closest: { x: closest.x + 0.5, y: closest.y, z: closest.z + 0.5 } };
        found = closest; partial = true;
    }
    const cells = [];
    for (let n = found; n; n = parent.get(n.k)) cells.push(n);
    cells.reverse();
    if (!partial && found.g > o.maxDetour * straight + o.detourSlack) return { ok: false, reason: "too far around", nodes, length: found.g };
    const path = smooth(cells, standable, passable).map(c => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }));
    let prevY = sy;
    for (const c of path) { c.jump = c.y > prevY; prevY = c.y; }
    return { ok: true, path, nodes, length: found.g, partial };
}

// Drop waypoints that a straight walk at the same height would pass through anyway.
function smooth(cells, standable, passable) {
    if (cells.length <= 2) return cells.slice(1);
    const out = [];
    let i = 0;
    while (i < cells.length - 1) {
        let j = Math.min(cells.length - 1, i + 8);
        for (; j > i + 1; j--) {
            if (cells[j].y !== cells[i].y) continue;
            if (clearLine(cells[i], cells[j], standable, passable)) break;
        }
        out.push(cells[j]);
        i = j;
    }
    return out;
}

// A body is 0.6 wide: every sample along the line must have room for that, so a shortcut never
// clips the corner of a wall (the server would push the body back).
const HALF_WIDTH = 0.35;
function clearLine(a, b, standable, passable) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const n = Math.max(Math.abs(dx), Math.abs(dz)) * 4;
    for (let s = 1; s < n; s++) {
        const px = a.x + 0.5 + dx * s / n, pz = a.z + 0.5 + dz * s / n;
        if (!standable(Math.floor(px), a.y, Math.floor(pz))) return false;
        for (const [ox, oz] of [[-HALF_WIDTH, -HALF_WIDTH], [HALF_WIDTH, -HALF_WIDTH], [-HALF_WIDTH, HALF_WIDTH], [HALF_WIDTH, HALF_WIDTH]]) {
            const cx = Math.floor(px + ox), cz = Math.floor(pz + oz);
            if (!passable(cx, a.y, cz) || !passable(cx, a.y + 1, cz)) return false;
        }
    }
    return true;
}
