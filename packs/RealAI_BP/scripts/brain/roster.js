// The server's regulars: a persistent list of named AI players that live in
// this world. Pure helpers (no @minecraft imports) so they can be unit-tested;
// core.js owns the bodies, this file owns the list.
export const ROSTER_KEY = "realai:roster";
export const MAX_RESIDENTS = 16;

export function parseRoster(raw) {
    try {
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) return [];
        return list.filter(r => r && typeof r.pid === "string" && typeof r.name === "string").map(r => ({
            pid: r.pid, name: r.name, created: Number(r.created) || 0,
            persona: { personality: String(r.persona?.personality || ""), voice: String(r.persona?.voice || ""), description: String(r.persona?.description || "") },
        }));
    } catch (e) { return []; }
}

export function serializeRoster(list) { return JSON.stringify(list); }

// Names of real public figures that slipped into the original addon's preset list.
const NOT_THESE = new Set(["taylor swift", "morgan freeman", "jordan peterson"]);

/** A fresh gamertag-looking name (FirstLast42 or "First Last") that is not already on the roster. */
export function pickName(names, taken, rng = Math.random) {
    const pick = (arr) => arr && arr.length ? arr[Math.floor(rng() * arr.length)] : "";
    const used = new Set((taken || []).map(n => String(n).toLowerCase()));
    for (let i = 0; i < 60; i++) {
        let name;
        if (rng() < 0.5) {
            const a = pick(names.prefix), c = pick(names.suffix);
            name = a && c ? `${a}${c}` : "";
            if (name && name.length <= 14) name += String(Math.floor(rng() * 90) + 10);
        } else {
            name = pick(names.preset);
        }
        name = String(name || "").replace(/[^A-Za-z0-9_ ]/g, "").trim();
        if (!name || name.length > 16) continue;
        if (used.has(name.toLowerCase()) || NOT_THESE.has(name.toLowerCase())) continue;
        return name;
    }
    return `Player${Math.floor(rng() * 9000) + 1000}`;
}

/**
 * Grow or shrink the roster to `n` entries. New entries get a persistent id,
 * a name and a persona; removed entries are taken from the end.
 */
export function ensureRoster(list, n, { names, personalities, voices, now, rng = Math.random } = {}) {
    const out = (list || []).slice(0, Math.max(0, Math.min(MAX_RESIDENTS, n)));
    let changed = out.length !== (list || []).length;
    while (out.length < Math.min(MAX_RESIDENTS, n)) {
        const name = pickName(names || {}, out.map(r => r.name), rng);
        out.push({
            pid: `${now || 0}-${Math.floor(rng() * 1e9)}-r${out.length}`,
            name,
            created: now || 0,
            persona: {
                personality: personalities && personalities.length ? personalities[Math.floor(rng() * personalities.length)] : "",
                voice: voices && voices.length ? voices[Math.floor(rng() * voices.length)] : "",
                description: "",
            },
        });
        changed = true;
    }
    return { roster: out, changed };
}

/** A spot on a ring around a player (dx/dz only; the caller finds the ground). */
export function ringOffset(index, count, min = 6, max = 14, rng = Math.random) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + rng() * 0.6;
    const r = min + rng() * (max - min);
    return { dx: Math.cos(angle) * r, dz: Math.sin(angle) * r };
}
