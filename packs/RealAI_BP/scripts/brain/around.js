// The "look around" report: how far each way goes on and what can be seen, for the prompt and for the
// look_around action. Reads blocks through the dimension; the logic is in senses.js.
import { survey, sights, landmarks, describeAround, describeAbove, compassOf } from "./senses.js";

export function idAtFor(dim) {
    return (x, y, z) => { try { const b = dim.getBlock({ x, y, z }); return b ? b.typeId : null; } catch (e) { return null; } };
}

export const chunkKey = (dimId, x, z) => `${dimId}:${Math.floor(x / 16)},${Math.floor(z / 16)}`;

/** Remember that this 16x16 column of the world has been walked through (so "unexplored" means something). */
export function markVisited(set, dimId, x, z, cap = 3000) {
    const k = chunkKey(dimId, x, z);
    if (set.has(k)) return;
    set.add(k);
    if (set.size > cap) { for (const old of set) { set.delete(old); if (set.size <= cap * 0.9) break; } }
}

/**
 * -> { text, rows, seen, facing }   full: finer, longer-range look (look_around); otherwise the light one for every observation.
 */
export function aroundReport(bot, { yaw = 0, full = false, visited } = {}) {
    const dim = bot.dimension, idAt = idAtFor(dim), loc = bot.location;
    const eye = { x: loc.x, y: loc.y + 1.62, z: loc.z };
    const rows = survey(idAt, loc, { max: full ? 32 : 24 });
    const rays = sights(idAt, eye, full ? { pitches: [-30, -8, 0], max: 48 } : { pitches: [-20, 0], max: 32 });
    const marks = landmarks(idAt, loc, full ? { radius: 32, stride: 3 } : { radius: 24, stride: 3 });
    // what the rays and the grid found, the nearest of each kind per direction
    const seen = rays.map(r => {
        const m = new Map();
        for (const x of [...r.seen, ...(marks.find(k => k.dir === r.dir)?.seen || [])]) { const cur = m.get(x.cls); if (!cur) m.set(x.cls, { ...x }); else { cur.n = Math.max(cur.n || 1, x.n || 1); if (x.dist < cur.dist) cur.dist = x.dist; } }
        return { dir: r.dir, open: r.open, seen: [...m.values()].filter(x => ["tree", "ore", "water", "lava", "built"].includes(x.cls) || (x.cls === "rock" && x.dist >= 8)).sort((a, b) => a.dist - b.dist) };
    });
    const facing = compassOf(yaw).name;
    const seenBefore = visited ? (end) => visited.has(chunkKey(dim.id, end.x, end.z)) : undefined;
    const under = idAt(Math.floor(loc.x), Math.floor(loc.y + 0.05) - 1, Math.floor(loc.z));
    const text = describeAround(rows, seen, facing, { visited: seenBefore }) + `. Underfoot: ${under ? under.replace(/^minecraft:/, "") : "unknown"}. Overhead: ${describeAbove(idAt, loc)}.`;
    return { text, rows, seen, facing };
}
