// The "look around" report: how far each way goes on and what can be seen, for the prompt and for the
// look_around action. Reads blocks through the dimension; the logic is in senses.js.
import { survey, sights, describeAround, describeAbove, compassOf } from "./senses.js";

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
    const seen = sights(idAt, eye, full ? { pitches: [-30, -5, 7], max: 48 } : { pitches: [-20, 0], max: 32 });
    const facing = compassOf(yaw).name;
    const seenBefore = visited ? (end) => visited.has(chunkKey(dim.id, end.x, end.z)) : undefined;
    const under = idAt(Math.floor(loc.x), Math.floor(loc.y + 0.05) - 1, Math.floor(loc.z));
    const text = describeAround(rows, seen, facing, { visited: seenBefore }) + `. Underfoot: ${under ? under.replace(/^minecraft:/, "") : "unknown"}. Overhead: ${describeAbove(idAt, loc)}.`;
    return { text, rows, seen, facing };
}
