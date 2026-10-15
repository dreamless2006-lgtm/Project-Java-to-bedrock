// Per-bot memory: long-term facts, recent episodes, people notes and the
// chat transcript. Pure; serialised to one JSON string kept under a byte cap
// so it fits a dynamic property.

export const MEMORY_LIMITS = {
    maxBytes: 28_000,      // dynamic property strings are capped at 32 KiB
    maxFacts: 40,
    maxEpisodes: 30,
    maxChat: 24,
    maxPeople: 24,
    factChars: 160,
    episodeChars: 140,
    chatChars: 200,
    selfChars: 400,
    maxPlans: 6,
    planChars: 100,
    maxChests: 8,
    maxBuilds: 6,
};

export function createMemory() {
    return { v: 1, facts: [], episodes: [], chat: [], people: {}, goal: null, home: null, created: 0, self: "", plans: [], drives: null, chests: [], builds: [] };
}

export function loadMemory(raw) {
    if (!raw) return createMemory();
    try {
        const m = JSON.parse(raw);
        if (m && typeof m === "object" && Array.isArray(m.facts)) {
            return { ...createMemory(), ...m };
        }
    } catch (e) { /* corrupt */ }
    return createMemory();
}

export function addFact(mem, text, t) {
    const s = String(text).trim().slice(0, MEMORY_LIMITS.factChars);
    if (!s) return;
    const lower = s.toLowerCase();
    mem.facts = mem.facts.filter(f => f.text.toLowerCase() !== lower);
    mem.facts.push({ t, text: s });
    if (mem.facts.length > MEMORY_LIMITS.maxFacts) mem.facts.splice(0, mem.facts.length - MEMORY_LIMITS.maxFacts);
}

export function forgetFact(mem, substring) {
    const needle = String(substring).trim().toLowerCase();
    if (!needle) return 0;
    const before = mem.facts.length;
    mem.facts = mem.facts.filter(f => !f.text.toLowerCase().includes(needle));
    return before - mem.facts.length;
}

/** The bot's own short account of who it is and what it cares about (rewritten by the model when it reflects). */
export function setSelf(mem, text) {
    const s = String(text || "").trim().slice(0, MEMORY_LIMITS.selfChars);
    if (!s) return false;
    mem.self = s;
    return true;
}

/** Replace the multi-day plan (ordered steps). An empty list clears it. */
export function setPlans(mem, list) {
    if (!Array.isArray(list)) return false;
    mem.plans = list.filter(p => typeof p === "string" && p.trim()).map(p => p.trim().slice(0, MEMORY_LIMITS.planChars)).slice(0, MEMORY_LIMITS.maxPlans);
    return true;
}

// ---- the bot's own things: chests it filled and structures it built ----
const sameSpot = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z && (a.dim || "minecraft:overworld") === (b.dim || "minecraft:overworld");

/** Remember (or refresh) a chest the bot placed or used. items: short strings like "oak planks x64". */
export function noteChest(mem, chest, t) {
    if (!chest || typeof chest.x !== "number") return;
    mem.chests = Array.isArray(mem.chests) ? mem.chests : [];
    const c = { x: Math.floor(chest.x), y: Math.floor(chest.y), z: Math.floor(chest.z), dim: chest.dim || "minecraft:overworld", items: (chest.items || []).slice(0, 8).map(s => String(s).slice(0, 40)), t };
    mem.chests = mem.chests.filter(o => !sameSpot(o, c));
    mem.chests.push(c);
    if (mem.chests.length > MEMORY_LIMITS.maxChests) mem.chests.splice(0, mem.chests.length - MEMORY_LIMITS.maxChests);
}

export function forgetChest(mem, pos) {
    if (!Array.isArray(mem.chests)) return false;
    const before = mem.chests.length;
    mem.chests = mem.chests.filter(o => !sameSpot(o, { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dim: pos.dim || "minecraft:overworld" }));
    return mem.chests.length < before;
}

/** Remember a structure the bot built: a name and the box of blocks it covers. */
export function noteBuild(mem, build, t) {
    if (!build || typeof build.x1 !== "number") return;
    mem.builds = Array.isArray(mem.builds) ? mem.builds : [];
    const b = { name: String(build.name || "build").slice(0, 32), dim: build.dim || "minecraft:overworld", x1: Math.min(build.x1, build.x2), y1: Math.min(build.y1, build.y2), z1: Math.min(build.z1, build.z2), x2: Math.max(build.x1, build.x2), y2: Math.max(build.y1, build.y2), z2: Math.max(build.z1, build.z2), t };
    mem.builds.push(b);
    if (mem.builds.length > MEMORY_LIMITS.maxBuilds) mem.builds.splice(0, mem.builds.length - MEMORY_LIMITS.maxBuilds);
}

/** Is this block one of the bot's things? Returns {kind: "chest"|"build", name, ref} or null. */
export function findOwned(mem, pos, dimId = "minecraft:overworld") {
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    for (const c of mem.chests || []) if (c.x === x && c.y === y && c.z === z && (c.dim || "minecraft:overworld") === dimId) return { kind: "chest", name: "chest", ref: c };
    for (const b of (mem.builds || []).slice().reverse()) {
        if ((b.dim || "minecraft:overworld") !== dimId) continue;
        if (x >= b.x1 - 1 && x <= b.x2 + 1 && y >= b.y1 - 1 && y <= b.y2 + 1 && z >= b.z1 - 1 && z <= b.z2 + 1) return { kind: "build", name: b.name, ref: b };
    }
    return null;
}

export function addEpisode(mem, text, t) {
    const s = String(text).trim().slice(0, MEMORY_LIMITS.episodeChars);
    if (!s) return;
    const last = mem.episodes[mem.episodes.length - 1];
    if (last && last.text === s) { last.n = (last.n || 1) + 1; last.t = t; return; }
    mem.episodes.push({ t, text: s });
    if (mem.episodes.length > MEMORY_LIMITS.maxEpisodes) mem.episodes.splice(0, mem.episodes.length - MEMORY_LIMITS.maxEpisodes);
}

export function addChat(mem, from, text, t, opts = {}) {
    const s = String(text).trim().slice(0, MEMORY_LIMITS.chatChars);
    if (!s) return;
    mem.chat.push({ t, from: String(from).slice(0, 32), text: s, ...(opts.whisper ? { w: 1 } : {}), ...(opts.self ? { me: 1 } : {}) });
    if (mem.chat.length > MEMORY_LIMITS.maxChat) mem.chat.splice(0, mem.chat.length - MEMORY_LIMITS.maxChat);
}

export function notePerson(mem, name, patch, t) {
    const key = String(name).slice(0, 32);
    const p = mem.people[key] || { first: t };
    mem.people[key] = { ...p, ...patch, last: t };
    const names = Object.keys(mem.people);
    if (names.length > MEMORY_LIMITS.maxPeople) {
        names.sort((a, b) => (mem.people[a].last || 0) - (mem.people[b].last || 0));
        for (const n of names.slice(0, names.length - MEMORY_LIMITS.maxPeople)) delete mem.people[n];
    }
}

/** Serialise, shrinking oldest data until it fits maxBytes. */
export function saveMemory(mem, maxBytes = MEMORY_LIMITS.maxBytes) {
    let s = JSON.stringify(mem);
    let guard = 0;
    while (byteLength(s) > maxBytes && guard++ < 200) {
        if (mem.chat.length > 4) mem.chat.shift();
        else if (mem.self && mem.self.length > 200) mem.self = mem.self.slice(0, 200);
        else if (mem.episodes.length > 4) mem.episodes.shift();
        else if (mem.chests && mem.chests.length > 2) mem.chests.shift();
        else if (mem.builds && mem.builds.length > 2) mem.builds.shift();
        else if (mem.facts.length > 8) mem.facts.shift();
        else {
            const names = Object.keys(mem.people);
            if (names.length > 2) delete mem.people[names[0]];
            else break;
        }
        s = JSON.stringify(mem);
    }
    return s;
}

export function byteLength(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3;
    }
    return n;
}

/** Compact text for the prompt. now/t are ms; ages are rendered relative. */
export function renderMemory(mem, now, limits = {}) {
    const L = { facts: 20, episodes: 10, chat: 12, people: 8, ...limits };
    const lines = [];
    if (mem.self) lines.push("Who I am: " + mem.self);
    if (mem.plans && mem.plans.length) {
        lines.push("My plans:");
        mem.plans.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    }
    if ((mem.chests && mem.chests.length) || (mem.builds && mem.builds.length)) {
        lines.push("My things:");
        for (const c of (mem.chests || []).slice(-6)) lines.push(`- my chest at ${c.x} ${c.y} ${c.z}${c.dim && c.dim !== "minecraft:overworld" ? " in " + String(c.dim).replace("minecraft:", "") : ""}: ${c.items && c.items.length ? c.items.join(", ") : "empty"} (checked ${ago(now - (c.t || now))})`);
        for (const b of (mem.builds || []).slice(-4)) lines.push(`- my ${b.name} at ${b.x1} ${b.y1} ${b.z1} to ${b.x2} ${b.y2} ${b.z2}`);
    }
    if (mem.facts.length) {
        lines.push("Things I know:");
        for (const f of mem.facts.slice(-L.facts)) lines.push("- " + f.text);
    }
    const people = Object.entries(mem.people).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, L.people);
    if (people.length) {
        lines.push("People:");
        for (const [name, p] of people) {
            const bits = [];
            if (p.relation) bits.push(p.relation);
            if (typeof p.sympathy === "number") bits.push(`likes me ${p.sympathy}/100`);
            if (p.note) bits.push(p.note);
            lines.push(`- ${name}: ${bits.join(", ") || "met"} (last seen ${ago(now - (p.last || now))})`);
        }
    }
    if (mem.episodes.length) {
        lines.push("Recently:");
        for (const e of mem.episodes.slice(-L.episodes)) lines.push(`- ${ago(now - e.t)}: ${e.text}${e.n > 1 ? ` (x${e.n})` : ""}`);
    }
    if (mem.chat.length) {
        lines.push("Chat:");
        for (const c of mem.chat.slice(-L.chat)) lines.push(`${c.w ? "(whisper) " : ""}<${c.me ? "me" : c.from}> ${c.text}`);
    }
    return lines.join("\n");
}

export function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
}
