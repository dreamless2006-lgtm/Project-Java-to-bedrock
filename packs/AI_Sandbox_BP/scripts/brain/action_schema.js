// The contract between the LLM and the bot body. Pure: no @minecraft imports.
//
// Every "think" returns one JSON object: a short thought, optional chat line,
// a mood, up to MAX_ACTIONS body actions, and memory edits. The body executes
// actions in order; long-running ones (gather, build, travel) report progress
// back in the next observation.

export const MAX_ACTIONS = 4;
export const MAX_SAY = 240;          // chat line cap (Bedrock chat shows ~512 chars; keep bots terse)
export const MAX_THOUGHT = 200;

export const MOODS = ["neutral", "happy", "excited", "curious", "focused", "tired", "scared", "angry", "sad", "playful"];

// name -> { params: { key: {type, required?, min?, max?, enum?} }, doc }
export const ACTIONS = {
    move_to:      { doc: "Walk/sprint to a block position (pathing is automatic).", params: { x: { type: "number", required: true }, y: { type: "number", required: true }, z: { type: "number", required: true }, sprint: { type: "boolean" } } },
    go_to_player: { doc: "Walk to a player or bot by name and stop near them.", params: { name: { type: "string", required: true } } },
    follow:       { doc: "Keep following a player/bot by name until 'stop'.", params: { name: { type: "string", required: true } } },
    stop:         { doc: "Cancel movement, jobs and follow.", params: {} },
    look_at:      { doc: "Face a player/entity by name or a position.", params: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
    attack:       { doc: "Fight a named entity/player (uses best weapon, strafes, blocks).", params: { name: { type: "string", required: true } } },
    defend:       { doc: "Fight back against anything hostile nearby, protect named player if given.", params: { protect: { type: "string" } } },
    flee:         { doc: "Run away from danger (optionally from a named entity).", params: { from: { type: "string" } } },
    gather:       { doc: "Collect a material: logs (oak_log, spruce_log...), ores (iron, coal, diamond, copper, gold, redstone, lapis, emerald), stone, dirt, sand, gravel, wool, food. Long-running job.", params: { material: { type: "string", required: true }, amount: { type: "number", min: 1, max: 64 } } },
    mine_down:    { doc: "Dig a staircase down and prospect for ores (long-running).", params: { depth: { type: "number", min: 4, max: 60 } } },
    explore:      { doc: "Wander in a direction looking for something (village, cave, biome, structure, player).", params: { direction: { type: "string", enum: ["north", "south", "east", "west", "any"] }, looking_for: { type: "string" } } },
    build:        { doc: "Build a structure here or at x,y,z. preset: house | shelter | wall | tower | bridge | farm | pillar | custom. For custom give blueprint: [{dx,dy,dz,block}] with dx/dz in -12..12, dy in 0..12 relative to the origin. material is the main block id (e.g. minecraft:oak_planks). Long-running.", params: { preset: { type: "string", required: true }, material: { type: "string" }, x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, width: { type: "number", min: 3, max: 16 }, height: { type: "number", min: 2, max: 12 }, depth: { type: "number", min: 3, max: 16 }, blueprint: { type: "array", maxItems: 400 }, name: { type: "string" } } },
    place_block:  { doc: "Place one block of a type you carry at x,y,z (within 5 blocks).", params: { block: { type: "string", required: true }, x: { type: "number", required: true }, y: { type: "number", required: true }, z: { type: "number", required: true } } },
    break_block:  { doc: "Break the block at x,y,z (within 5 blocks).", params: { x: { type: "number", required: true }, y: { type: "number", required: true }, z: { type: "number", required: true } } },
    place_torch:  { doc: "Light up the area with torches you carry.", params: {} },
    eat:          { doc: "Eat the best food in inventory.", params: {} },
    equip_best:   { doc: "Put on the best armour and hold the best weapon/tool for the job (sword|pickaxe|axe|shovel|bow).", params: { tool: { type: "string" } } },
    use_item:     { doc: "Use/consume a named item you carry (potion, bucket, boat, ender pearl, spawn egg, a modded item...).", params: { item: { type: "string", required: true } } },
    craft:        { doc: "Craft an item from your inventory (planks, sticks, crafting_table, tools, armour, torches, bed, chest, furnace, bread...).", params: { item: { type: "string", required: true }, amount: { type: "number", min: 1, max: 64 } } },
    smelt:        { doc: "Smelt raw ore/food in a nearby furnace (or craft one).", params: { item: { type: "string", required: true } } },
    drop_item:    { doc: "Drop an item from inventory.", params: { item: { type: "string", required: true }, amount: { type: "number", min: 1, max: 64 } } },
    give_item:    { doc: "Hand an item to a nearby player (walks to them first).", params: { player: { type: "string", required: true }, item: { type: "string", required: true }, amount: { type: "number", min: 1, max: 64 } } },
    pick_up:      { doc: "Collect dropped items nearby.", params: {} },
    open_container: { doc: "Take or store items in a chest/barrel at x,y,z. mode: take | store. items: list of item ids.", params: { x: { type: "number", required: true }, y: { type: "number", required: true }, z: { type: "number", required: true }, mode: { type: "string", enum: ["take", "store"] }, items: { type: "array", maxItems: 16 } } },
    interact:     { doc: "Use a block (door, button, lever, bed, portal, crafting table, modded block) at x,y,z or an entity by name (ride a horse/boat, tame a wolf).", params: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, name: { type: "string" } } },
    sleep:        { doc: "Sleep in the nearest bed (or place one) at night.", params: {} },
    set_home:     { doc: "Remember this (or x,y,z) as home.", params: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
    go_home:      { doc: "Walk back home.", params: {} },
    travel:       { doc: "Go to another dimension: nether | end | overworld. Uses a known portal, or builds a nether portal (needs 10 obsidian + flint_and_steel) or finds a stronghold end portal. Long-running.", params: { dimension: { type: "string", required: true, enum: ["nether", "end", "overworld"] } } },
    trade:        { doc: "Offer a trade to a player: give 'offer' for 'want'.", params: { player: { type: "string", required: true }, offer: { type: "string", required: true }, want: { type: "string", required: true } } },
    duel:         { doc: "Challenge a bot/player to a friendly duel.", params: { name: { type: "string", required: true } } },
    befriend:     { doc: "Send a friend request to a player.", params: { player: { type: "string", required: true } } },
    emote:        { doc: "Play an emote: wave | clap | dance | sit | sneak | jump | swing.", params: { name: { type: "string", required: true } } },
    wait:         { doc: "Stand still for a while (idle, think, watch).", params: { seconds: { type: "number", min: 1, max: 120 } } },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

export const REPLY_SCHEMA = {
    type: "object",
    properties: {
        thought: { type: "string", description: "Private reasoning, max 200 chars." },
        say: { type: ["string", "null"], description: "A chat line in your own voice, or null to stay quiet." },
        say_to: { type: ["string", "null"], description: "Player name to whisper to, or null for public chat." },
        mood: { type: "string", enum: MOODS },
        goal: { type: ["string", "null"], description: "Your current multi-step goal in one line (kept until changed)." },
        actions: {
            type: "array",
            maxItems: MAX_ACTIONS,
            items: {
                type: "object",
                properties: { type: { type: "string", enum: ACTION_NAMES } },
                required: ["type"],
                additionalProperties: true,
            },
        },
        remember: { type: "array", items: { type: "string" }, maxItems: 4, description: "New long-term facts worth keeping." },
        forget: { type: "array", items: { type: "string" }, maxItems: 4, description: "Facts (substring) that are no longer true." },
    },
    required: ["actions"],
    additionalProperties: false,
};

/** Render the action vocabulary for the system prompt (stable text). */
export function renderActionDocs() {
    const lines = [];
    for (const [name, def] of Object.entries(ACTIONS)) {
        const params = Object.entries(def.params).map(([k, p]) => {
            let s = k + (p.required ? "" : "?");
            if (p.enum) s += ":" + p.enum.join("|");
            else if (p.type !== "string") s += ":" + p.type;
            return s;
        }).join(", ");
        lines.push(`- ${name}(${params}): ${def.doc}`);
    }
    return lines.join("\n");
}

/**
 * Validate and normalise a raw reply object. Never throws. Returns
 * {thought, say, sayTo, mood, goal, actions:[{type,...}], remember:[], forget:[], problems:[]}
 */
export function normalizeReply(raw) {
    const problems = [];
    const out = { thought: "", say: null, sayTo: null, mood: null, goal: null, actions: [], remember: [], forget: [], problems };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        problems.push("reply was not a JSON object");
        return out;
    }
    if (typeof raw.thought === "string") out.thought = raw.thought.slice(0, MAX_THOUGHT);
    if (typeof raw.say === "string" && raw.say.trim()) out.say = cleanChat(raw.say).slice(0, MAX_SAY);
    if (typeof raw.say_to === "string" && raw.say_to.trim()) out.sayTo = raw.say_to.trim().slice(0, 32);
    if (typeof raw.mood === "string" && MOODS.includes(raw.mood)) out.mood = raw.mood;
    else if (raw.mood != null) problems.push(`unknown mood '${String(raw.mood).slice(0, 20)}'`);
    if (typeof raw.goal === "string") out.goal = raw.goal.slice(0, 160);
    for (const key of ["remember", "forget"]) {
        if (Array.isArray(raw[key])) {
            out[key] = raw[key].filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, 160)).slice(0, 4);
        }
    }
    const acts = Array.isArray(raw.actions) ? raw.actions : (raw.action ? [raw.action] : []);
    for (const a of acts) {
        if (out.actions.length >= MAX_ACTIONS) { problems.push(`more than ${MAX_ACTIONS} actions; extras dropped`); break; }
        const v = validateAction(a);
        if (v.ok) out.actions.push(v.action);
        else problems.push(v.error);
    }
    return out;
}

export function validateAction(a) {
    if (!a || typeof a !== "object") return { ok: false, error: "action was not an object" };
    const type = typeof a.type === "string" ? a.type.trim().toLowerCase() : (typeof a.action === "string" ? a.action.trim().toLowerCase() : null);
    if (!type) return { ok: false, error: "action without type" };
    const def = ACTIONS[type];
    if (!def) return { ok: false, error: `unknown action '${type.slice(0, 24)}'` };
    const action = { type };
    for (const [k, p] of Object.entries(def.params)) {
        let v = a[k];
        if (v === undefined || v === null || v === "") {
            if (p.required) return { ok: false, error: `${type} needs '${k}'` };
            continue;
        }
        if (p.type === "number") {
            v = typeof v === "number" ? v : Number(v);
            if (!Number.isFinite(v)) return { ok: false, error: `${type}.${k} must be a number` };
            if (p.min !== undefined) v = Math.max(p.min, v);
            if (p.max !== undefined) v = Math.min(p.max, v);
        } else if (p.type === "boolean") {
            v = v === true || v === "true";
        } else if (p.type === "array") {
            if (!Array.isArray(v)) return { ok: false, error: `${type}.${k} must be an array` };
            if (p.maxItems && v.length > p.maxItems) v = v.slice(0, p.maxItems);
        } else {
            v = String(v).trim().slice(0, 96);
            if (p.enum && !p.enum.includes(v.toLowerCase())) return { ok: false, error: `${type}.${k} must be one of ${p.enum.join("|")}` };
            if (p.enum) v = v.toLowerCase();
        }
        action[k] = v;
    }
    if (type === "look_at" && !action.name && action.x === undefined) return { ok: false, error: "look_at needs a name or x,y,z" };
    if (type === "interact" && !action.name && action.x === undefined) return { ok: false, error: "interact needs a name or x,y,z" };
    if (type === "build" && action.preset === "custom" && !action.blueprint) return { ok: false, error: "build custom needs a blueprint" };
    if (type === "build" && action.blueprint) {
        const bp = [];
        for (const b of action.blueprint) {
            if (!b || typeof b !== "object") continue;
            const dx = Number(b.dx), dy = Number(b.dy), dz = Number(b.dz);
            if (![dx, dy, dz].every(Number.isFinite)) continue;
            if (Math.abs(dx) > 12 || Math.abs(dz) > 12 || dy < 0 || dy > 12) continue;
            const block = typeof b.block === "string" ? b.block.trim() : (action.material || "minecraft:cobblestone");
            bp.push({ dx: Math.round(dx), dy: Math.round(dy), dz: Math.round(dz), block });
        }
        if (!bp.length) return { ok: false, error: "build blueprint had no valid entries" };
        action.blueprint = bp;
    }
    return { ok: true, action };
}

// Strip formatting codes and newlines so a bot cannot forge system/chat styling.
export function cleanChat(s) {
    return String(s).replace(/§./g, "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
