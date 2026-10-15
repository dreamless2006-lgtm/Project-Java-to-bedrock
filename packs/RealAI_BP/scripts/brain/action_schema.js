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
    look:         { doc: "Turn your head. facing: a compass word (north, south-east...), up, down or level; or yaw/pitch in degrees (yaw 0 = south, 90 = west, 180 = north, -90 = east; pitch -90 = straight up, 0 = level, 90 = straight down); or turn/tilt by that many degrees from where you face now. Instant; says what you are looking at.", params: { facing: { type: "string" }, yaw: { type: "number" }, pitch: { type: "number", min: -90, max: 90 }, turn: { type: "number", min: -360, max: 360 }, tilt: { type: "number", min: -180, max: 180 } } },
    look_around:  { doc: "Turn all the way round (about a second) and report, in every direction, how far you can walk, what stops you, and what you can see far off: trees, ore, water, lava, buildings.", params: {} },
    move:         { doc: "Hold the movement keys for a few seconds, relative to where you face: direction forward | back | left | right, seconds 0.2-15, optionally sprint, sneak or jump. You stop by yourself before a wall, a deep drop, lava or water, step up one-block ledges, and are told how far you got and what stopped you.", params: { direction: { type: "string", enum: ["forward", "back", "backward", "left", "right"] }, seconds: { type: "number", min: 0.2, max: 15 }, sprint: { type: "boolean" }, sneak: { type: "boolean" }, jump: { type: "boolean" } } },
    jump:         { doc: "Jump once (to hop up a block, over a gap, or just because).", params: {} },
    mine:         { doc: "Hold the attack button on the block under your crosshair until it breaks (right tool in hand, real break time, drops picked up), then the next block the crosshair is on, count times. Look at the block first (look, look_at). Says what is in reach and what you got.", params: { count: { type: "number", min: 1, max: 32 } } },
    place:        { doc: "Right-click with a block: put it on the face of the block under your crosshair (look at the ground or a wall first). Uses the block in your hand, or the one named in block.", params: { block: { type: "string" } } },
    use:          { doc: "Right-click what is in front of you: talk to or ride a creature, open a door/chest/crafting table, press a button, eat the food in your hand, place the block in your hand, or use the item in your hand.", params: {} },
    hit:          { doc: "Left-click once: swing your arm, and if a creature or player is under your crosshair, fight it.", params: {} },
    hold:         { doc: "Choose what is in your hand: hotbar slot 1-9 (see Hotbar in the observation) or an item by name.", params: { slot: { type: "number", min: 1, max: 9 }, item: { type: "string" } } },
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
    use_item:     { doc: "Use/consume a named item you carry (potion, bucket, boat, ender pearl, spawn egg, a modded item...). ender_eye next to end portal frames fills a frame; twelve filled frames light the end portal.", params: { item: { type: "string", required: true } } },
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
    locate:       { doc: "Find the nearest structure and remember where it is: stronghold | fortress | bastion_remnant | village | mineshaft | monument | mansion | temple | ruined_portal | ancient_city | trail_ruins. Gives x,z (the stronghold's portal room is deep underground at those coordinates).", params: { structure: { type: "string", required: true } } },
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
        say: { type: "string", description: "A chat line in your own voice, or an empty string to stay quiet." },
        say_to: { type: "string", description: "Player name to whisper to, or an empty string for public chat." },
        mood: { type: "string", enum: MOODS },
        goal: { type: "string", description: "Your current multi-step goal in one line (kept until changed); empty string = no change." },
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
        self: { type: "string", description: "One or two sentences about who you are becoming and what you care about; empty string = unchanged." },
        plans: { type: "array", items: { type: "string" }, maxItems: 6, description: "Your ordered plan for the coming days; replaces the old list; empty array = unchanged." },
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
    const out = { thought: "", say: null, sayTo: null, mood: null, goal: null, actions: [], remember: [], forget: [], self: null, plans: null, problems };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        problems.push("reply was not a JSON object");
        return out;
    }
    if (typeof raw.thought === "string") out.thought = raw.thought.slice(0, MAX_THOUGHT);
    if (typeof raw.say === "string" && raw.say.trim()) out.say = cleanChat(raw.say).slice(0, MAX_SAY);
    if (typeof raw.say_to === "string" && raw.say_to.trim()) out.sayTo = raw.say_to.trim().slice(0, 32);
    if (typeof raw.mood === "string" && MOODS.includes(raw.mood)) out.mood = raw.mood;
    else if (raw.mood != null) problems.push(`unknown mood '${String(raw.mood).slice(0, 20)}'`);
    if (typeof raw.goal === "string" && raw.goal.trim()) out.goal = raw.goal.trim().slice(0, 160);
    else if (raw.goal === null || raw.goal === "none") out.goal = "";
    for (const key of ["remember", "forget"]) {
        if (Array.isArray(raw[key])) {
            out[key] = raw[key].filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, 160)).slice(0, 4);
        }
    }
    if (typeof raw.self === "string" && raw.self.trim()) out.self = raw.self.trim().slice(0, 400);
    if (Array.isArray(raw.plans) && raw.plans.length) out.plans = raw.plans.filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, 100)).slice(0, 6);
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
    if (type === "hold" && action.slot === undefined && !action.item) return { ok: false, error: "hold needs a slot (1-9) or an item" };
    if (type === "look_at" && !action.name && action.x === undefined) return { ok: false, error: "look_at needs a name or x,y,z" };
    if (type === "look" && ["facing", "yaw", "pitch", "turn", "tilt"].every(k => action[k] === undefined)) return { ok: false, error: "look needs facing, yaw/pitch or turn/tilt" };
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
