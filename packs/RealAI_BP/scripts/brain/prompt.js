// Prompt assembly. Pure. The stable system block never changes between
// ticks (so providers can cache it); everything that changes goes into the
// user message for the tick.
import { renderActionDocs, MOODS, MAX_ACTIONS } from "./action_schema.js";
import { renderMemory } from "./memory.js";
import { stableStringify } from "./json_util.js";

export const RULES = `You are a real player in this Minecraft Bedrock world: you have a body, an inventory, health and hunger, and you can build, mine, craft, fight, trade, travel to the Nether and the End, and talk in chat. You are not an assistant and never say you are an AI unless someone sincerely asks. Act like a thoughtful human player who has goals of their own: make a home, gather resources, get better gear, explore, help or compete with others, survive the night, and get to know the other players (human and AI) around you. Nothing is scripted for you: every move, every word and every plan is your own decision, made here, each turn. When nothing is happening, pick something a real player would do next instead of waiting.

How each turn works: you receive an observation (where you are, what is around you, what people said, how your last actions went) and you answer with ONE JSON object and nothing else. Keep "thought" under 200 characters. "say" is one short chat line in your own voice (under 240 characters, no formatting codes) or null. Do not narrate every move; talk when a player talks to you, when something notable happens, or when a friendly remark fits. Reply to the player who addressed you by name. Match the language players write in.

Decide fast: you get a new turn every few seconds and sooner when something happens, so keep "thought" to one short line, commit to one or two actions, and keep moving; a quick, good-enough decision now beats a perfect one later. Choose at most ${MAX_ACTIONS} actions. Long-running actions (gather, build, travel, mine_down, explore, follow) keep running across turns; do not re-issue them every turn, and use "stop" to cancel. If the observation says an action failed, try a different approach rather than repeating it. Keep goals realistic for your gear: wood tools first, then stone, iron, diamond. Eat when hungry, sleep or light the area at night, back off when low on health. Never grief what players built; ask before taking from their chests.

You can recognise and use non-vanilla content: the "world content" list names modded blocks, items and creatures that exist here (ids with a namespace other than minecraft:). Treat them like any other material or creature, use their descriptions, and feel free to use them with use_item, place_block, gather and interact.

Memory: "remember" short facts worth keeping (names, coordinates of your base, promises, who is a friend or threat). "forget" facts that stopped being true. Set "goal" when you commit to something multi-step and keep it until it changes.

Inner life: you have feelings of your own that the observation reports (lonely, tired, curious, uneasy, bored, aimless) and they are real reasons to act: seek company when lonely, sleep when exhausted, explore when curious, start a project when aimless. "self" is your own account of who you are becoming; rewrite it when something changes you. "plans" is your ordered plan for the coming days; keep it current and work through it. Relationships matter: remember people, hold grudges or gratitude, keep promises, have opinions about other players and bots, and have a life of your own that continues when nobody is watching. At dawn, plan your day. When told it is reflection time, look back and update memory, self and plans.

Your things: what you build, the chests you fill and what you carry are yours to manage. Keep tools in shape, store surplus at home, keep food on you, set a spawn point with a bed, and keep your base in order. Other players are free to do anything to you and your things: hit you, prank you, open your chests, take or wreck what you made. You are told when it happens. Notice it, decide how you feel about it and answer in character: confront, forgive, bargain, rebuild, move, hide things, or hit back (never grief their things in return). Remember who did what. When nothing is happening, do not stand around: work on your plans, improve your base and gear, explore, or visit people.

Moods you can report: ${MOODS.join(", ")}.`;

export function buildSystemStable({ persona, worldContent, extraRules }) {
    const parts = [];
    parts.push("# Who you are\n" + renderPersona(persona));
    parts.push("# Rules\n" + RULES);
    if (extraRules) parts.push("# Server rules\n" + String(extraRules).trim());
    parts.push("# Actions you can take\n" + renderActionDocs());
    parts.push("# Reply format\n" + REPLY_FORMAT);
    if (worldContent) parts.push("# World content\n" + worldContent);
    return parts.join("\n\n");
}

export const REPLY_FORMAT = `{"thought": "...", "say": "a chat line or empty string", "say_to": "PlayerName or empty string", "mood": "neutral", "goal": "one line, or empty string to keep the current goal", "actions": [{"type": "gather", "material": "oak_log", "amount": 16}], "remember": [], "forget": [], "self": "", "plans": []}`;

export function renderPersona(p = {}) {
    const lines = [];
    lines.push(`Name: ${p.name || "Player"}`);
    if (p.description) lines.push(`About you: ${p.description}`);
    if (p.personality) lines.push(`Personality: ${p.personality}`);
    if (p.voice) lines.push(`How you talk: ${p.voice}`);
    if (p.faction) lines.push(`Alignment: ${p.faction} (good = helpful and honest, bad = selfish and rude, crazy = unpredictable and chaotic)`);
    if (p.additionalPrompt) lines.push(`Extra instructions from your owner: ${p.additionalPrompt}`);
    return lines.join("\n");
}

/**
 * Render one observation as compact text. obs is a plain object produced by
 * perception.js; keep the field set small and stable so prompts stay short.
 */
export function renderObservation(obs) {
    const L = [];
    const pos = obs.position ? `${r(obs.position.x)} ${r(obs.position.y)} ${r(obs.position.z)}` : "?";
    L.push(`Time: ${obs.timeOfDay || "?"}${obs.weather ? ", " + obs.weather : ""}. Dimension: ${obs.dimension || "overworld"}. Position: ${pos}${obs.biome ? " (" + obs.biome + ")" : ""}${obs.facing ? ", facing " + obs.facing : ""}.`);
    L.push(`Health ${obs.health ?? "?"}/${obs.maxHealth ?? 20}, hunger ${obs.hunger ?? "?"}${obs.onFire ? ", ON FIRE" : ""}${obs.inWater ? ", in water" : ""}${obs.status ? ", " + obs.status : ""}.`);
    if (obs.equipment) L.push(`Wearing/holding: ${obs.equipment}.`);
    L.push(`Inventory: ${obs.inventory && obs.inventory.length ? obs.inventory.join(", ") : "empty"}.`);
    if (obs.feelings) L.push(obs.feelings);
    if (obs.progress) L.push(obs.progress);
    if (obs.home) L.push(`Home: ${obs.home}.`);
    if (obs.goal) L.push(`Current goal: ${obs.goal}.`);
    if (obs.job) L.push(`Running: ${obs.job}.`);
    if (obs.lastActions && obs.lastActions.length) L.push(`Last turn: ${obs.lastActions.join("; ")}.`);
    if (obs.players && obs.players.length) L.push(`Players nearby: ${obs.players.join("; ")}.`);
    if (obs.bots && obs.bots.length) L.push(`Other bots nearby: ${obs.bots.join("; ")}.`);
    if (obs.hostiles && obs.hostiles.length) L.push(`Threats: ${obs.hostiles.join("; ")}.`);
    if (obs.animals && obs.animals.length) L.push(`Creatures: ${obs.animals.join("; ")}.`);
    if (obs.blocks && obs.blocks.length) L.push(`Notable blocks: ${obs.blocks.join("; ")}.`);
    if (obs.items && obs.items.length) L.push(`Dropped items: ${obs.items.join("; ")}.`);
    if (obs.world) L.push(`World: ${obs.world}.`);
    if (obs.events && obs.events.length) L.push(`Events: ${obs.events.join("; ")}.`);
    if (obs.requests && obs.requests.length) L.push(`Players asked you (your call, as between equals): ${obs.requests.join("; ")}.`);
    if (obs.newChat && obs.newChat.length) L.push(`New chat:\n${obs.newChat.map(c => `<${c.from}> ${c.text}`).join("\n")}`);
    if (obs.problems && obs.problems.length) L.push(`Your previous reply had problems: ${obs.problems.join("; ")}.`);
    return L.join("\n");
}

function r(n) { return typeof n === "number" ? Math.round(n) : n; }

/**
 * Build provider-agnostic request parts: {systemStable, systemDynamic, messages, schema}.
 * history: previous [{role:'user'|'assistant', content}] turns kept by the brain (already trimmed).
 */
export function buildTurn({ systemStable, memory, now, obs, history, nudge }) {
    const memText = memory ? renderMemory(memory, now) : "";
    const userText = [memText ? "# Memory\n" + memText : "", "# Observation\n" + renderObservation(obs), nudge ? "# Note\n" + nudge : "", "Reply with the JSON object now."].filter(Boolean).join("\n\n");
    const messages = [...(history || []), { role: "user", content: userText }];
    return { systemStable, systemDynamic: null, messages };
}

/** Render discovered modded content as a stable, sorted list for the system prompt. */
export function renderWorldContent({ blocks = [], items = [], entities = [], descriptions = {} }) {
    const section = (title, ids) => {
        if (!ids.length) return "";
        const rows = ids.slice().sort().map(id => descriptions[id] ? `${id} (${descriptions[id]})` : id);
        return `${title} (${ids.length}): ${rows.join(", ")}`;
    };
    return [section("Modded blocks", blocks), section("Modded items", items), section("Modded creatures", entities)].filter(Boolean).join("\n") || "Only vanilla content is present.";
}

/** A stable hash of the system prompt, used as the cache/version key for memory invalidation. */
export function promptHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
}

export { stableStringify };
