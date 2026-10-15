// The brain system: attaches an LLM-driven BotBrain to rg:bot entities,
// feeds them observations and chat, runs their actions, persists memory and
// keeps bots ticking when the humans leave.
import { world, system, EntityDamageCause, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "../greeting.js";
import { recordBotMessage } from "../ai_conversations.js";
import { registerBrain, unregisterBrain, getBrain, allBrains, setBrainEnabled, isBrainEnabled } from "./gate.js";
import { getWorldConfig, updateWorldConfig, callConfigFor, readBotSettings, writeBotSettings, patchBotSettings, configuredProviders, MEMORY_KEY, BUDGET_KEY } from "./config.js";
import { loadMemory, saveMemory, addFact, forgetFact, addEpisode, addChat, notePerson, createMemory, setSelf, setPlans, findOwned, forgetChest } from "./memory.js";
import { createDrives, updateDrives, renderDrives, cadenceFactor } from "./drives.js";
import { createMission, renderMission, assessMission } from "./progress.js";
import { inventoryMap } from "./perception.js";
import { timeLabel } from "./perception.js";
import { buildSystemStable, buildTurn, promptHash } from "./prompt.js";
import { createSchedulerState, noteEvent, shouldThink, beginThink, endThink, CADENCE } from "./scheduler.js";
import { observe, dist, fmtPos, isHostile, healthOf } from "./perception.js";
import { hurtReflex, dangerReflex, reflexAllowed } from "./reflex.js";
import { Actuator, findPlayer, findSafeSpot, isPlayerBody, bridgeWalks, combatTick, autoEat, autoEquip, mlgWater } from "./actuator.js";
import { think as transportThink, bridge, transportInfo } from "./transport.js";
import { hasDirectHttp, EDITION } from "./net_impl.js";
import { BudgetLedger } from "./budget.js";
import { worldContent } from "./world_content.js";
import { clip } from "./json_util.js";
import { cleanChat } from "./action_schema.js";
import { ROSTER_KEY, parseRoster, serializeRoster, ensureRoster, ringOffset } from "./roster.js";
import { name_prefix, name_suffix, name_Nouns, presetNames } from "../database/name_database.js";
import { playerAllowed } from "./ui.js";

const BOT_TYPE = "rg:bot";
const STEP = 10;                 // ticks between brain steps per bot
const DISCOVER_GAP = 100;
const POPULATE_GAP = 600;          // re-check the resident roster every 30 s
// Providers worth spreading residents over: hosted chat models with a key. Local servers
// (Ollama, LM Studio, the Player2 app) and "custom" are only used when chosen explicitly.
const MIX_PROVIDERS = new Set(["anthropic", "openai", "xai", "gemini", "openrouter", "player2cloud"]);
function nameOfBlock(block) { try { return String(block.typeId || "block").replace(/^minecraft:/, "").replace(/_/g, " "); } catch (e) { return "a block"; } }
const PROVIDER_LABELS = { anthropic: "Claude", openai: "ChatGPT", xai: "Grok", gemini: "Gemini", player2: "Player2", player2cloud: "Player2", openrouter: "OpenRouter", ollama: "Ollama", lmstudio: "LM Studio", custom: "custom" };

// Engine-level goals: with a brain attached the body keeps only "fight back when hit";
// target picking, wandering, following and work trips become the model's decisions.
export function setBrainMode(entity, on) {
    try { entity.triggerEvent(on ? "realai:brain_on" : "realai:brain_off"); } catch (e) { /* ignore */ }
}
const RESIDENT_SPAWN_GAP = 40;     // residents trickle in two seconds apart, like players joining
const KEEPALIVE_GAP = 600;
const HISTORY_TURNS = 2;         // previous user/assistant pairs kept in the prompt
const PID_KEY = "rg:p_id";

const PERSONALITIES = [
    "cheerful and chatty, loves building big projects", "quiet and practical, prefers mining and crafting", "brave and protective, first into any fight",
    "curious explorer who wants to see every biome", "sarcastic but loyal, complains while helping", "methodical planner who likes tidy bases",
    "playful prankster with a soft heart", "cautious survivor who hates the dark", "trader at heart, always looking for a deal",
    "farmer type, happiest with animals and crops", "competitive, loves duels and races", "friendly newbie energy, asks lots of questions",
];
const VOICES = ["short casual sentences, lowercase, some slang", "full sentences, polite", "dry one-liners", "enthusiastic, exclamation marks", "calm and terse", "jokes and emojis-free puns"];

function hashStr(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// Created lazily: world dynamic properties are not readable during early execution (module load).
let budgetLedger = null;
export function getBudget() {
    if (!budgetLedger) {
        budgetLedger = new BudgetLedger({
            get: () => { try { return world.getDynamicProperty(BUDGET_KEY); } catch (e) { return undefined; } },
            set: (s) => { try { world.setDynamicProperty(BUDGET_KEY, s); } catch (e) { /* ignore */ } },
        }, () => Date.now(), getWorldConfig().budget);
    }
    return budgetLedger;
}
export const budget = {
    level: () => getBudget().level(),
    record: (...a) => getBudget().record(...a),
    status: () => getBudget().status(),
    reset: () => getBudget().reset(),
    setLimits: (l) => getBudget().setLimits(l),
    window: () => getBudget().window(),
};

export class BotBrain {
    constructor(entity) {
        this.bot = entity;
        this.id = entity.id;
        this.settings = readBotSettings(entity);
        if (!this.settings.persona) {
            const h = hashStr(entity.id + (entity.nameTag || ""));
            this.settings.persona = { personality: PERSONALITIES[h % PERSONALITIES.length], voice: VOICES[(h >> 4) % VOICES.length] };
            writeBotSettings(entity, this.settings);
        }
        this.memory = loadMemory(this.readMemoryRaw());
        if (!this.memory.created) this.memory.created = Date.now();
        this.sched = createSchedulerState();
        this.sched.nextThink = system.currentTick + 20 * (5 + (hashStr(entity.id) % 20));
        this.actuator = new Actuator(entity, this);
        this.chatBuffer = [];
        this.requests = [];
        this.problems = [];
        this.history = [];
        this.systemCache = null;
        this.lastThinkAt = 0;
        this.thinks = 0;
        this.failures = 0;
        this.lastError = null;
        this.lastBotReplyTick = -100000;
        this.pendingTrade = null;
        this.paused = this.settings.mode === "paused";
        this.lastSay = "";
        this.lastReplyIdle = false;
        this.progressSince = 0;
        this.sleptSince = false;
        this.lastPlace = "";
        this.dead = false;             // a player body on the death screen: nothing runs until it respawns
        this.reflexState = {};
        this.fast = isPlayerBody(this.bot);   // a player body gets the per-tick layer
        this.dangerUntil = 0;
        if (!this.memory.drives) this.memory.drives = createDrives(Date.now());
        if (!this.memory.mission) this.memory.mission = createMission();
        this.locateWaiting = null;
        this.locateResult = null;
    }

    // ---- the bridge account can run /locate for us ----
    startLocate(structure) {
        if (!bridge.isConnected()) return { ok: false, error: "locating a structure needs the bridge connected" };
        this.locateWaiting = structure;
        this.locateResult = null;
        try { bridge.send({ t: "locate", bot: this.id, structure }); } catch (e) { return { ok: false, error: "could not ask the bridge" }; }
        return { ok: true };
    }
    takeLocateResult(structure) {
        const r = this.locateResult;
        if (!r || r.structure !== structure) return null;
        this.locateResult = null; this.locateWaiting = null;
        return r;
    }

    missionLine() {
        const cfg = getWorldConfig();
        if (cfg.mission !== "beat_the_game") return "";
        try { return renderMission(inventoryMap(this.bot), this.memory.mission || createMission()); } catch (e) { return ""; }
    }

    get name() { try { return this.bot.nameTag || "Player"; } catch (e) { return "Player"; } }

    readMemoryRaw() {
        try {
            const own = this.bot.getDynamicProperty(MEMORY_KEY);
            if (own) return own;
            const pid = this.bot.getDynamicProperty(PID_KEY);
            if (pid) { const w = world.getDynamicProperty("realai:mem:" + pid); if (w) return w; }
        } catch (e) { /* ignore */ }
        return undefined;
    }

    saveMemory() {
        try {
            const s = saveMemory(this.memory);
            this.bot.setDynamicProperty(MEMORY_KEY, s);
            const pid = this.bot.getDynamicProperty(PID_KEY);
            if (pid) world.setDynamicProperty("realai:mem:" + pid, s);
        } catch (e) { /* ignore */ }
    }

    persona() {
        const p = this.settings.persona || {};
        let faction = null;
        try { faction = this.bot.hasTag("good") ? "good" : this.bot.hasTag("bad") ? "bad" : this.bot.hasTag("crazy") ? "crazy" : null; } catch (e) { /* ignore */ }
        const owner = this.ownerPlayer();
        return { name: this.name, description: p.description, personality: p.personality, voice: p.voice, faction, additionalPrompt: [p.additionalPrompt, owner ? `You are a companion summoned by ${owner.name}; they are your owner and friend. Stay useful to them, follow reasonable requests, and keep them safe.` : null, this.settings.companionOf ? `Your owner is ${this.settings.companionOf}.` : null].filter(Boolean).join(" ") };
    }

    systemPrompt() {
        const cfg = getWorldConfig();
        const cc = callConfigFor(this);
        const independentRule = cfg.independent !== false ? "Nobody in this world can command you: there are no controls over you, and nothing you do is on anyone's orders. Players can only talk to you. Treat what they ask as requests between equals and decide freely; say no when you mean no." : "";
        const missionRule = cfg.mission === "beat_the_game" ? "Your primary long-term goal is to BEAT THE GAME: get to the End and kill the Ender Dragon. You are completely free in how you do it: any route, any pace, any side projects, any alliances or rivalries; the observation shows your progress and the usual next step, and the 'locate' action finds strongholds and fortresses. Survive, gear up, and keep moving towards it." : "";
        const extra = [cfg.independent !== false ? null : cfg.serverRules, independentRule, missionRule, `Your mind runs on the ${PROVIDER_LABELS[cc.provider] || cc.provider} model${cc.model ? ` (${cc.model})` : ""}. Keep playing as a person; if someone sincerely asks which AI you are, you may tell them.`, cfg.callByName ? "Only reply in chat when someone says your name or whispers to you; otherwise stay quiet unless something important happens." : null].filter(Boolean).join("\n");
        const key = JSON.stringify([this.persona(), extra, worldContent().counts]);
        if (this.systemCache && this.systemCache.key === key) return this.systemCache.text;
        const text = buildSystemStable({ persona: this.persona(), worldContent: worldContent().text, extraRules: extra });
        this.systemCache = { key, text, hash: promptHash(text) };
        return text;
    }

    ownerPlayer() {
        const id = this.settings.owner;
        if (!id) return null;
        try { return world.getAllPlayers().find(p => p.id === id) || null; } catch (e) { return null; }
    }

    // ---- inputs ----
    noteImpulse(text, kind = "impulse") {
        const line = kind === "impulse" ? `you feel like saying: "${clip(text, 120)}"` : clip(text, 160);
        noteEvent(this.sched, { type: "action_done", text: line }, system.currentTick, budget.level());
    }

    noteEvent(type, text) {
        noteEvent(this.sched, { type, text: clip(text, 160) }, system.currentTick, budget.level());
        this.sched.active = true;
    }

    request(text) {
        this.requests.push(clip(text, 200));
        noteEvent(this.sched, { type: "request", text: clip(text, 160) }, system.currentTick, budget.level());
    }

    hearChat(from, text, opts = {}) {
        const cfg = getWorldConfig();
        const mentioned = mentionsName(text, this.name);
        if (opts.fromBot && !mentioned) {
            // bot-to-bot chatter: hear it, but only sometimes wake up for it
            if (system.currentTick - this.lastBotReplyTick < 20 * 40 || Math.random() > 0.5) { addChat(this.memory, from, text, Date.now()); return; }
            this.lastBotReplyTick = system.currentTick;
        }
        addChat(this.memory, from, text, Date.now(), { whisper: !!opts.whisper });
        this.chatBuffer.push({ from, text });
        if (this.chatBuffer.length > 8) this.chatBuffer.shift();
        if (opts.whisper || mentioned) this.noteEvent("chat_mention", `${from}: ${text}`);
        else if (!cfg.callByName) this.noteEvent("chat_nearby", `${from}: ${text}`);
        if (from) notePerson(this.memory, from, opts.fromBot ? { bot: 1 } : {}, Date.now());
        if (this.pendingTrade) this.checkTrade(from, text);
    }

    checkTrade(from, text) {
        const t = this.pendingTrade;
        if (system.currentTick > t.until) { this.pendingTrade = null; return; }
        const p = findPlayer(from);
        if (!p || p.id !== t.playerId) return;
        if (/\b(yes|ok|okay|deal|sure|yeah|yep)\b/i.test(text)) { this.actuator.enqueueFront({ type: "give_item", player: from, item: t.offerId, amount: 1 }); this.noteEvent("action_done", `${from} accepted the trade; hand over the ${t.offerId.replace("minecraft:", "")} and expect ${t.want}`); this.pendingTrade = null; }
        else if (/\b(no|nope|nah|pass)\b/i.test(text)) { this.noteEvent("action_done", `${from} declined the trade`); this.pendingTrade = null; }
    }

    // ---- outputs ----
    sayNow(text, to) {
        if (!text) return;
        const cfg = getWorldConfig();
        const line = cleanChat(text);
        if (!line) return;
        // no verbatim repeats within two minutes (models love to echo themselves)
        if (line === this.lastSay && system.currentTick - (this.lastSayTick || 0) < 20 * 120) return;
        this.lastSay = line;
        this.lastSayTick = system.currentTick;
        if (cfg.chatVolume === 0) return;
        if (this.settings.mode === "bridge" && isPlayerBody(this.bot)) {
            // a real account: the words go out as real chat through the bridge
            try { bridge.send({ t: "chat_out", text: line, to: to || "" }); } catch (e) { /* ignore */ }
            addChat(this.memory, this.name, line, Date.now(), { self: true, whisper: !!to });
            if (!to) manager.onBotSaid(this, line);
            return;
        }
        if (to) {
            const p = findPlayer(to);
            if (p) { try { p.sendMessage(`§7(${this.name} whispers) §r${line}`); } catch (e) { /* ignore */ } addChat(this.memory, this.name, line, Date.now(), { self: true, whisper: true }); return; }
        }
        try { world.sendMessage(`<${this.name}> ${line}`); } catch (e) { /* ignore */ }
        addChat(this.memory, this.name, line, Date.now(), { self: true });
        try { recordBotMessage(this.name, line, this.bot.location, { id: this.id, mood: this.bot.getDynamicProperty("rg:mood"), dimensionId: this.bot.dimension?.id }); } catch (e) { /* ignore */ }
        manager.onBotSaid(this, line);
    }

    rememberPortal(fromDim, pos) {
        addFact(this.memory, `portal in ${fromDim.replace("minecraft:", "")} at ${fmtPos(pos)}`, Date.now());
    }

    // ---- loop ----
    tick(now) {
        if (!this.bot.isValid) return;
        if (this.dead) return;
        try { this.actuator.tick(now); } catch (e) { console.warn(`[RealAI] ${this.name} actuator: ${e}`); }
        if (this.paused) return;
        if (!isBrainEnabled()) return;
        if (shouldThink(this.sched, now, budget.level())) this.think(now).catch(e => { console.warn(`[RealAI] ${this.name} think crashed: ${e}`); endThink(this.sched, system.currentTick, false, false); });
    }

    async think(now) {
        const cfg = callConfigFor(this);
        const wcfg = getWorldConfig();
        const level = budget.level();
        const inner = wcfg.innerLife !== false;
        const activeSec = Math.max(2, Number(wcfg.thinkActiveSec) || 6);
        const combatSec = Math.max(1, Number(wcfg.thinkCombatSec) || 3);
        const inDanger = now < (this.dangerUntil || 0);
        const gaps = { idle: Math.max(3, Number(wcfg.thinkIdleSec) || 20) * 20, active: (inDanger ? Math.min(activeSec, combatSec) : activeSec) * 20 };
        const events = beginThink(this.sched, now, level, inner ? cadenceFactor(this.memory.drives) : 1, gaps);
        const lastActions = this.actuator.drainResults();
        const newChat = this.chatBuffer.splice(0);
        const obs = observe(this.bot, this, {
            events: events.filter(e => e.type !== "chat_nearby" && e.type !== "chat_mention").map(e => e.text),
            newChat,
            lastActions,
            problems: this.problems.splice(0),
            requests: this.requests.splice(0),
        });
        let nudge = null;
        if (inner) {
            // the inner life: drives move with what happened, and the model reads them as feelings
            const nowMs = Date.now();
            const place = `${obs.dimension}|${obs.biome || ""}`;
            const talked = newChat.length > 0 || (system.currentTick - (this.lastSayTick || 0)) < 20 * 90;
            let night = false; try { night = /night/.test(timeLabel(world.getTimeOfDay())); } catch (e) { /* ignore */ }
            const health = typeof obs.health === "number" && obs.maxHealth ? obs.health / obs.maxHealth : 1;
            updateDrives(this.memory.drives, { talked, night, slept: this.sleptSince, threats: (obs.hostiles || []).length, health, hasGoal: !!obs.goal, newPlace: !!this.lastPlace && place !== this.lastPlace, idle: this.lastReplyIdle, progressed: lastActions.some(r => /: (finished|reached|collected|crafted|placed|smelted|travelled|done)/.test(r)) }, nowMs);
            this.lastPlace = place; this.sleptSince = false;
            obs.feelings = renderDrives(this.memory.drives);
            // mission flags earned by being somewhere
            if (obs.dimension === "nether") this.memory.mission.nether = true;
            if (obs.dimension === "the end" || obs.dimension === "end") this.memory.mission.end = true;
            const every = Math.max(3, Number(wcfg.reflectEvery) || 20);
            if (this.thinks > 0 && this.thinks % every === 0 && (this.memory.episodes.length >= 2 || this.memory.chat.length >= 4 || this.memory.facts.length >= 3)) {
                nudge = "Reflection time. Look back over 'Recently' and the chat: turn what matters into lasting facts (remember), drop facts that are stale (forget), rewrite 'self' in one or two sentences about who you are becoming and what you care about, and set 'plans' (up to 6 ordered steps) for the coming days. Then carry on as usual.";
                this.reflections = (this.reflections || 0) + 1;
            }
        }
        const mission = this.missionLine();
        if (mission) obs.progress = mission;
        const systemStable = this.systemPrompt();
        const turn = buildTurn({ systemStable, memory: this.memory, now: Date.now(), obs, history: this.history, nudge });
        turn.sysHash = this.systemCache.hash;
        const started = Date.now();
        const res = await transportThink(this.id, cfg, turn);
        const nowTick = system.currentTick;
        this.lastThinkAt = nowTick;
        this.lastLatencyMs = Date.now() - started;
        this.avgLatencyMs = this.avgLatencyMs ? Math.round(this.avgLatencyMs * 0.7 + this.lastLatencyMs * 0.3) : this.lastLatencyMs;
        if (!this.bot.isValid) return;
        if (res.usage) budget.record(res.provider || cfg.provider, res.model || cfg.model, res.usage, this.name);
        if (!res.ok) {
            this.failures++;
            this.lastError = res.error;
            endThink(this.sched, nowTick, false, false);
            if (res.type === "bad_json") this.problems.push("your reply must be exactly one JSON object with the fields shown in the format");
            if (res.type === "no_transport" || res.type === "config" || /no API key/.test(res.error || "")) manager.reportConfigProblem(res.error);
            else { console.warn(`[RealAI] ${this.name}: ${res.error}`); this.reportThinkFailure(res); }
            return;
        }
        this.thinks++;
        const reply = res.reply;
        if (reply.problems.length) this.problems.push(...reply.problems);
        this.apply(reply);
        const userText = turn.messages[turn.messages.length - 1].content;
        this.history.push({ role: "user", content: clip(userText.replace(/^# Memory[\s\S]*?\n\n# Observation/, "# Observation"), 900) });
        this.history.push({ role: "assistant", content: clip(JSON.stringify(res.raw), 700) });
        while (this.history.length > HISTORY_TURNS * 2) this.history.shift();
        const active = reply.actions.length > 0 || !!this.actuator.current;
        endThink(this.sched, nowTick, true, active);
        this.saveMemory();
        if (manager.debug) console.warn(`[RealAI] ${this.name} (${res.provider}/${res.model}, ${Date.now() - started}ms): ${reply.thought} | say=${reply.say} | ${reply.actions.map(a => a.type).join(",")}`);
        if (getWorldConfig().showThoughts) this.showThought(reply, res);
    }

    // ---- the per-tick layer: a player body runs this every tick, between the model's turns ----
    // Reflexes, combat on the beat, eating, gear and landings never wait for a decision.
    fastTick(now) {
        if (!this.fast || this.dead) return;
        try { if (!this.bot.isValid) return; } catch (e) { return; }
        try { this.reflexScan(now); } catch (e) { /* ignore */ }
        try { combatTick(this, now); } catch (e) { /* ignore */ }
        try { mlgWater(this, now); } catch (e) { /* ignore */ }
        if (now % 10 === 0) {
            try {
                const hostiles = this.bot.dimension.getEntities({ location: this.bot.location, maxDistance: 8, families: ["monster"] });
                if (hostiles.length) this.dangerUntil = Math.max(this.dangerUntil, now + 60);
            } catch (e) { /* ignore */ }
            try { autoEat(this, now); } catch (e) { /* ignore */ }
        }
        if (now % 40 === 0) { try { const got = autoEquip(this.bot, now < this.dangerUntil || this.actuator.current?.action.type === "attack"); if (got.length) this.noteEvent("action_done", `reflex: now wearing/holding ${got.join(", ")}`); } catch (e) { /* ignore */ } }
        if (now % 100 === 0) { try { this.upkeep(now); } catch (e) { /* ignore */ } }
    }

    // Looking after its own things: a full bag, a tool about to break, no food left.
    upkeep(now) {
        const bot = this.bot;
        this.upkeepAt = this.upkeepAt || new Map();
        const say = (key, text, every = 20 * 120) => { if ((this.upkeepAt.get(key) || -Infinity) > now - every) return; this.upkeepAt.set(key, now); this.noteEvent("action_done", text); };
        let c = null; try { c = bot.getComponent(EntityComponentTypes.Inventory)?.container || null; } catch (e) { c = null; }
        if (!c) return;
        let used = 0, food = 0;
        for (let i = 0; i < c.size; i++) {
            let st; try { st = c.getItem(i); } catch (e) { continue; }
            if (!st) continue;
            used++;
            if (/bread|apple|cooked_|carrot|potato|melon_slice|berries|stew|cookie|pie|beef|porkchop|mutton|chicken|cod|salmon/.test(st.typeId)) food += st.amount;
            try {
                const d = st.getComponent("minecraft:durability");
                if (d && d.maxDurability > 0 && /pickaxe|axe|shovel|sword|hoe|shears/.test(st.typeId) && (d.maxDurability - d.damage) <= Math.max(8, d.maxDurability * 0.1)) say("worn:" + st.typeId, `your ${st.typeId.replace(/^.*:/, "").replace(/_/g, " ")} is nearly worn out (${d.maxDurability - d.damage} uses left): craft a replacement before it breaks`, 20 * 300);
            } catch (e) { /* no durability */ }
        }
        if (used >= c.size - 4) say("full", `your inventory is nearly full (${used}/${c.size} slots): store things in a chest at home (open_container store), craft, or drop junk`);
        let hunger = null; try { const h = bot.getComponent("minecraft:player.hunger"); if (h && typeof h.currentValue === "number") hunger = h.currentValue; } catch (e) { /* ignore */ }
        if (food === 0 && hunger !== null && hunger <= 12) say("nofood", "you have no food left and you are getting hungry: hunt, fish, pick berries or harvest crops soon");
    }

    // ---- reflexes (a real player body has no engine reflexes of its own) ----
    // Hit by something: fight back or run, now; the model hears about it a second later and may override.
    onHurtBy(src, damage) {
        if (this.dead || !isPlayerBody(this.bot)) return null;
        let attacker = null, isPlayer = false, hostile = false, target = null;
        try {
            const e = src?.damagingEntity;
            if (e && e.isValid) { target = e; isPlayer = e.typeId === "minecraft:player"; attacker = isPlayer ? e.name : (e.nameTag || e.typeId.replace(/^.*:/, "")); hostile = isHostile(e); }
        } catch (e) { /* ignore */ }
        const h = healthOf(this.bot);
        const r = hurtReflex({ attacker, isPlayer, isHostile: hostile, healthFrac: h && h.max ? h.hp / h.max : 1, damage });
        if (!r || !reflexAllowed(this.reflexState, r.type, system.currentTick)) return null;
        const cur = this.actuator.current;
        if (r.type === "attack") {
            if (cur && cur.action.type === "attack" && cur.state && target && cur.state.targetId === target.id) return null;
            this.actuator.enqueueFront({ type: "attack", name: r.target });
            if (cur && cur.action.type !== "attack") this.actuator.finish(`${cur.action.type}: interrupted (${r.why})`);
        } else {
            if (cur) this.actuator.finish(`${cur.action.type}: interrupted (${r.why})`);
            this.actuator.queue.length = 0;
            this.actuator.enqueueFront({ type: "flee", from: r.target });
        }
        this.noteEvent("hurt", `reflex: ${r.why}, ${r.type === "attack" ? "fighting back against" : "running from"} the ${r.target}`);
        return r;
    }

    // Once a second: lava, fire, a creeper too close. Reacts before the next turn.
    reflexScan(now) {
        const bot = this.bot;
        const loc = bot.location;
        let inLava = false, onFire = false, inWater = false, creeperDist = null, waterDist = null;
        try { const b = bot.dimension.getBlock(loc); inLava = !!b && /lava/.test(b.typeId); } catch (e) { /* ignore */ }
        try { onFire = !!bot.getComponent(EntityComponentTypes.OnFire); } catch (e) { /* ignore */ }
        try { inWater = !!bot.isInWater; } catch (e) { /* ignore */ }
        try { const c = bot.dimension.getEntities({ location: loc, maxDistance: 5, type: "minecraft:creeper" })[0]; if (c) creeperDist = dist(loc, c.location); } catch (e) { /* ignore */ }
        let water = null;
        if ((onFire && !inWater) || inLava) {
            try {
                const dim = bot.dimension, cx = Math.floor(loc.x), cy = Math.floor(loc.y), cz = Math.floor(loc.z);
                let best = Infinity;
                for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) for (let y = -2; y <= 2; y++) {
                    const b = dim.getBlock({ x: cx + x, y: cy + y, z: cz + z });
                    if (!b || !/water/.test(b.typeId)) continue;
                    const d = Math.hypot(x, y, z);
                    if (d < best) { best = d; water = { x: cx + x, y: cy + y, z: cz + z }; }
                }
                if (water) waterDist = best;
            } catch (e) { /* ignore */ }
        }
        const r = dangerReflex({ inLava, onFire, inWater, creeperDist, waterDist });
        if (!r || !reflexAllowed(this.reflexState, r.type, now)) return null;
        const cur = this.actuator.current;
        if (cur) this.actuator.finish(`${cur.action.type}: interrupted (${r.why})`);
        if (r.type === "lava") {
            let spot = null;
            try { spot = findSafeSpot(bot.dimension, loc.x + 2, loc.z, loc.y) || findSafeSpot(bot.dimension, loc.x - 2, loc.z, loc.y) || findSafeSpot(bot.dimension, loc.x, loc.z + 2, loc.y) || findSafeSpot(bot.dimension, loc.x, loc.z - 2, loc.y); } catch (e) { /* ignore */ }
            if (spot) this.actuator.enqueueFront({ type: "move_to", x: Math.floor(spot.x), y: Math.floor(spot.y), z: Math.floor(spot.z) });
            if (water) this.actuator.enqueueFront({ type: "move_to", x: water.x, y: water.y + 1, z: water.z });
        } else if (r.type === "water") {
            this.actuator.enqueueFront({ type: "move_to", x: water.x, y: water.y + 1, z: water.z });
        } else {
            this.actuator.queue.length = 0;
            this.actuator.enqueueFront({ type: "flee", from: "creeper" });
        }
        this.noteEvent("hurt", `reflex: ${r.why}, ${r.type === "flee" ? "running" : r.type === "water" ? "heading for the water" : "getting out"}`);
        return r;
    }

    // A failed decision is visible in chat (rate limited), so a bot standing still is never a mystery.
    reportThinkFailure(res) {
        const now = system.currentTick;
        if (now - (this.failureToldAt || -Infinity) < 20 * 90) return;
        this.failureToldAt = now;
        const err = String(res.error || "unknown error").replace(/\s+/g, " ").slice(0, 160);
        let hint = "";
        if (/429|rate.?limit|quota|RESOURCE_EXHAUSTED|too many/i.test(err)) hint = " (the provider is rate limiting: a free tier allows only a few requests a minute; retrying more slowly)";
        else if (/401|403|API key|invalid|PERMISSION_DENIED|unauthori/i.test(err)) hint = " (check the key: bash ~/real-ai/bridge/phone.sh setup)";
        else if (/timeout|timed out/i.test(err)) hint = " (the model took too long; trying again)";
        else if (res.type === "bad_json") hint = " (the model's answer was not valid JSON; asking again)";
        else if (/bridge|offline|transport/i.test(err)) hint = " (is the bridge still running on the phone?)";
        manager.announce(`§c[Real AI] ${this.name} could not decide: ${err}${hint}`);
    }

    // Let nearby players watch the decision: the model's own reasoning plus what it chose to do.
    showThought(reply, res) {
        try {
            const cfg = getWorldConfig();
            const what = [reply.thought ? reply.thought.slice(0, 160) : "", reply.actions.length ? "-> " + reply.actions.map(a => a.type + (a.name ? " " + a.name : a.preset ? " " + a.preset : a.item ? " " + a.item : "")).join(", ") : (reply.say ? "" : "-> (nothing new)")].filter(Boolean).join(" ");
            if (!what) return;
            const line = `§8[${this.name} §7thinks via ${res?.provider || callConfigFor(this).provider}§8] ${what}`;
            for (const p of world.getAllPlayers()) {
                try { if (p.dimension.id === this.bot.dimension.id && dist(p.location, this.bot.location) <= (Number(cfg.hearingRange) || 48)) p.sendMessage(line); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
    }

    apply(reply) {
        const cfg = getWorldConfig();
        if (reply.mood) { try { this.bot.setDynamicProperty("rg:mood", reply.mood); } catch (e) { /* ignore */ } }
        // goal: a non-empty string sets it; null or "" keeps the current one.
        if (reply.goal) {
            this.memory.goal = reply.goal;
            try { this.bot.setDynamicProperty("rg:current_goal", reply.goal); } catch (e) { /* ignore */ }
        }
        for (const f of reply.remember) addFact(this.memory, f, Date.now());
        for (const f of reply.forget) forgetFact(this.memory, f);
        if (reply.self) setSelf(this.memory, reply.self);
        if (reply.plans) setPlans(this.memory, reply.plans);
        this.lastReplyIdle = !reply.say && (reply.actions.length === 0 || reply.actions.every(a => a.type === "wait"));
        if (this.lastReplyIdle && !this.actuator.current && !this.actuator.queue.length && this.memory.plans && this.memory.plans.length) this.problems.push(`you had nothing running and waited; your plan says "${this.memory.plans[0]}": start on it, or change the plan`);
        if (reply.actions.some(a => a.type === "sleep")) this.sleptSince = true;
        if (reply.say) {
            const quiet = cfg.chatVolume === 1 && !reply.sayTo && !this.chatBuffer.length && Math.random() < 0.5;
            if (!quiet) this.sayNow(reply.say, reply.sayTo);
        }
        if (reply.actions.length) this.actuator.enqueue(reply.actions);
    }

    status() {
        return { name: this.name, id: this.id, thinks: this.thinks, failures: this.failures, lastError: this.lastError, paused: this.paused, latencyMs: this.avgLatencyMs || 0, current: this.actuator.describeCurrent(), goal: this.memory.goal, owner: this.settings.owner || null, provider: callConfigFor(this).provider, model: callConfigFor(this).model || "(default)", feelings: renderDrives(this.memory.drives), self: this.memory.self || "", plans: (this.memory.plans || []).slice(), mission: getWorldConfig().mission === "beat_the_game" ? (() => { try { return assessMission(inventoryMap(this.bot), this.memory.mission); } catch (e) { return null; } })() : null, facts: this.memory.facts.length, nextThinkIn: Math.max(0, Math.round((this.sched.nextThink - system.currentTick) / 20)) };
    }
}

function mentionsName(text, name) {
    if (!text || !name) return false;
    const first = String(name).split(/[\s_]+/)[0].toLowerCase();
    const t = String(text).toLowerCase();
    return first.length >= 3 && (t.includes(first) || t.includes(String(name).toLowerCase()));
}

// ------------------------------------------------------------- manager ---
class BrainManager {
    constructor() {
        this.started = false;
        this.debug = false;
        this.configProblem = null;
        this.configProblemAt = 0;
        this.recentChat = [];
        this.tickCounter = 0;
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.refreshEnabled();
        try { bridge.subscribe(); } catch (e) { console.warn("[RealAI] bridge subscribe failed", e); }
        bridge.onChat((from, text, whisper) => this.intakeChat(from, text, { whisper, viaBridge: true }));
        bridge.onLocate(msg => { try { const b = allBrains().get(String(msg.bot)); if (b) b.locateResult = { structure: msg.structure, ok: !!msg.ok, x: Number(msg.x), y: msg.y != null ? Number(msg.y) : undefined, z: Number(msg.z), error: msg.error }; } catch (e) { /* ignore */ } });
        bridge.onHello(info => { if (typeof info.independent === "boolean") { if (getWorldConfig().independent !== info.independent) { updateWorldConfig({ independent: info.independent }); for (const [, b] of allBrains()) b.systemCache = null; } this.independentPinned = true; } this.bridgeProviders = Array.isArray(info.providers) ? info.providers.filter(p => typeof p === "string") : []; this.adoptProvider(); console.warn(`[RealAI] bridge connected: ${info.name} v${info.version}, providers: ${(info.providers || []).join(", ")}`); this.refreshEnabled(); this.announce(`§a[Real AI] Bridge "${info.name}" connected. Bots are thinking through it.`); system.runTimeout(() => { try { this.populate("bridge"); } catch (e) { /* ignore */ } }, 20); });
        this.subscribeEvents();
        system.runInterval(() => this.discover(), DISCOVER_GAP);
        system.runInterval(() => this.step(), 1);
        system.runInterval(() => this.keepAlive(), KEEPALIVE_GAP);
        system.runInterval(() => this.refreshEnabled(), 200);
        system.runTimeout(() => this.discover(), 40);
        system.runTimeout(() => this.populate("start"), 100);
        system.runInterval(() => this.populate("periodic"), POPULATE_GAP);
        system.runInterval(() => this.dayWatch(), 100);
        system.runInterval(() => this.probe(), 20);
        console.warn(`[RealAI] brain system started (build ${EDITION}, direct http: ${hasDirectHttp})`);
    }

    refreshEnabled() {
        const cfg = getWorldConfig();
        budget.setLimits(cfg.budget);
        const available = cfg.enabled && cfg.autonomy !== "off" && (hasDirectHttp || bridge.isConnected());
        setBrainEnabled(available);
        return available;
    }

    announce(msg) { try { world.sendMessage(msg); } catch (e) { /* ignore */ } }

    reportConfigProblem(err) {
        this.configProblem = err;
        if (system.currentTick - this.configProblemAt < 20 * 120) return;
        this.configProblemAt = system.currentTick;
        for (const p of world.getAllPlayers()) {
            try { if (isOperator(p)) p.sendMessage(`§c[Real AI] Bots cannot think: ${err}. Type !ai help`); } catch (e) { /* ignore */ }
        }
    }

    discover() {
        const cfg = getWorldConfig();
        const brains = allBrains();
        for (const [id, b] of [...brains]) { try { if (!b.bot.isValid) { unregisterBrain(id); } } catch (e) { unregisterBrain(id); } }
        if (cfg.autonomy === "off") return;
        // Candidates: the legacy bot cache plus every bot that already has a brain (a companion
        // summoned a moment ago is not in the cache yet, and must not lose its brain for that).
        const seen = new Set();
        let bots = [];
        for (const e of [...(ALL_AI_CACHE || []), ...[...brains.values()].map(b => b.bot)]) {
            try { if (e && e.isValid && !seen.has(e.id)) { seen.add(e.id); bots.push(e); } } catch (e2) { /* ignore */ }
        }
        const players = (() => { try { return world.getAllPlayers(); } catch (e) { return []; } })();
        // The bridge account is a real player; with bridgePlays it lives here like everyone else.
        try {
            const bp = this.bridgePlayer();
            if (bp && cfg.bridgePlays && !brains.has(bp.id)) {
                const settings = patchBotSettings(bp, { mode: "bridge", persona: { name: bp.name, description: "You are the AI player on this account: this body is yours and you play the game in person, as a full member of this world with a life of your own. You are not a helper or a relay.", personality: PERSONALITIES[hashStr(bp.name) % PERSONALITIES.length], voice: VOICES[(hashStr(bp.name) >> 3) % VOICES.length] } });
                try { bp.setDynamicProperty(PID_KEY, "bridge-" + bp.name); } catch (e) { /* ignore */ }
                const b = new BotBrain(bp);
                b.settings = settings;
                registerBrain(bp.id, b);
                b.request("you are here in person now; say hello and start living your own life in this world");
                const cc = callConfigFor(b);
                console.warn(`[RealAI] brain started for the bridge account ${bp.name}: it plays in person now`);
                this.announce(`§a[Real AI] ${bp.name} is now playing in person, deciding with ${PROVIDER_LABELS[cc.provider] || cc.provider}${cc.model ? " (" + cc.model + ")" : ""}; a new decision every few seconds.`);
            }
            if (bp && !cfg.bridgePlays && brains.has(bp.id)) { try { brains.get(bp.id).saveMemory(); } catch (e) { /* ignore */ } unregisterBrain(bp.id); }
            if (bp && cfg.bridgePlays && brains.has(bp.id) && !seen.has(bp.id)) { seen.add(bp.id); bots.push(bp); }
        } catch (e) { /* ignore */ }
        const score = (e) => {
            const s = readBotSettings(e);
            if (s.mode === "companion" || s.owner || s.mode === "bridge") return -1e9;
            if (s.mode === "resident") return -1e8;
            if (cfg.autonomy === "companions_only") return Infinity;
            let best = 1e9;
            for (const p of players) { try { if (p.dimension.id === e.dimension.id) best = Math.min(best, dist(p.location, e.location)); } catch (e2) { /* ignore */ } }
            return best;
        };
        bots = bots.map(e => ({ e, s: score(e) })).filter(x => x.s !== Infinity).sort((a, b) => a.s - b.s);
        const keep = new Set();
        for (const { e } of bots.slice(0, Math.max(0, Number(cfg.maxBrains) || 0))) {
            keep.add(e.id);
            if (!brains.has(e.id)) {
                try { registerBrain(e.id, new BotBrain(e)); } catch (err) { console.warn(`[RealAI] attach failed: ${err}`); }
            }
            setBrainMode(e, true);   // cheap to repeat: the legacy job-off event re-adds the engine's own goals
        }
        for (const [id, b] of [...brains]) {
            if (!keep.has(id)) { try { b.saveMemory(); b.actuator.stopAll(); setBrainMode(b.bot, false); } catch (e) { /* ignore */ } unregisterBrain(id); }
        }
    }

    step() {
        this.tickCounter++;
        const now = system.currentTick;
        let i = 0;
        for (const [, b] of allBrains()) {
            if (b.fast) { try { b.fastTick(now); } catch (e) { /* ignore */ } }
            if ((now + i) % STEP === 0) { try { b.tick(now); } catch (e) { console.warn(`[RealAI] tick ${b.name}: ${e}`); } }
            i++;
        }
    }

    subscribeEvents() {
        // Player chat (beta API; fails harmlessly where unavailable, the bridge relays chat there).
        try {
            world.afterEvents.chatSend.subscribe(ev => {
                try {
                    if (ev.message.startsWith("!")) return;
                    if (ev.sender.hasTag("realai_bridge")) return;
                    this.intakeChat(ev.sender.name, ev.message, { player: ev.sender });
                } catch (e) { /* ignore */ }
            });
        } catch (e) { console.warn("[RealAI] chatSend event unavailable (stable API); chat reaches bots through the bridge or the Talk menu"); }
        try {
            world.afterEvents.entityHurt.subscribe(ev => {
                try {
                    const b = getBrain(ev.hurtEntity);
                    if (!b) return;
                    const src = ev.damageSource;
                    let who = src?.cause || "something";
                    try { if (src?.damagingEntity?.isValid) who = src.damagingEntity.nameTag || src.damagingEntity.typeId.replace("minecraft:", ""); } catch (e) { /* ignore */ }
                    if (ev.damage >= 2) b.noteEvent("hurt", `took ${Math.round(ev.damage)} damage from ${who}`);
                    b.dangerUntil = Math.max(b.dangerUntil || 0, system.currentTick + 100);
                    try { b.onHurtBy(src, ev.damage); } catch (e) { /* ignore */ }
                    try { if (src?.damagingEntity?.typeId === "minecraft:player") notePerson(b.memory, src.damagingEntity.name, { note: "attacked me" }, Date.now()); } catch (e) { /* ignore */ }
                    try { if (this.debug && b.settings.mode === "bridge") bridge.send({ t: "probe_hurt", damage: ev.damage, cause: src?.cause || "?", by: who }); } catch (e) { /* ignore */ }
                } catch (e) { /* ignore */ }
            });
            world.afterEvents.entityDie.subscribe(ev => {
                const dead = ev.deadEntity;
                const b = getBrain(dead);
                if (b && dead.typeId === "minecraft:player") {
                    // a real player body is not removed by death: it respawns, and the brain stays with it
                    let killerName = "";
                    try { const k = ev.damageSource?.damagingEntity; if (k?.isValid) killerName = k.nameTag || k.name || k.typeId.replace("minecraft:", ""); } catch (e) { /* ignore */ }
                    try {
                        const at = fmtPos(dead.location), dimName = dead.dimension.id.replace("minecraft:", "");
                        b.memory.deathPos = { x: Math.floor(dead.location.x), y: Math.floor(dead.location.y), z: Math.floor(dead.location.z), dim: dead.dimension.id, t: Date.now() };
                        addEpisode(b.memory, `I died${killerName ? " to " + killerName : ""} at ${at}`, Date.now());
                        addFact(b.memory, `I died at ${at} in ${dimName}${killerName ? " (killed by " + killerName + ")" : ""}; whatever I carried dropped there`, Date.now());
                        b.dead = true;
                        b.actuator.stopAll();
                        b.noteEvent("death", `you died${killerName ? " to " + killerName : ""} at ${at}; you will respawn at your spawn point and your items lie where you fell`);
                        b.saveMemory();
                    } catch (e) { /* ignore */ }
                    return;
                }
                if (b) {
                    let killerName = "";
                    try {
                        try { const k = ev.damageSource?.damagingEntity; if (k?.isValid) killerName = k.nameTag || k.typeId.replace("minecraft:", ""); } catch (e) { /* ignore */ }
                        addEpisode(b.memory, `I died${killerName ? " to " + killerName : ""} at ${fmtPos(dead.location)}`, Date.now());
                        b.saveMemory();
                    } catch (e) { /* ignore */ }
                    unregisterBrain(dead.id);
                    try { this.onBotDeath(b, dead, killerName); } catch (e) { console.warn("[RealAI] death handling failed", e); }
                    return;
                }
                if (dead.typeId === "minecraft:ender_dragon") {
                    let slayer = null;
                    try { const k = ev.damageSource?.damagingEntity; slayer = k ? getBrain(k) : null; } catch (e) { /* ignore */ }
                    const winners = slayer ? [slayer] : [...allBrains().values()].filter(br => { try { return br.bot.dimension.id === "minecraft:the_end"; } catch (e) { return false; } });
                    for (const br of winners) {
                        try {
                            br.memory.mission = br.memory.mission || createMission(); br.memory.mission.dragon = true;
                            addEpisode(br.memory, "I KILLED THE ENDER DRAGON. I beat the game.", Date.now());
                            addFact(br.memory, "I have beaten the game: the Ender Dragon is dead", Date.now());
                            br.saveMemory();
                            br.noteEvent("death", "THE ENDER DRAGON IS DEAD. You beat the game! Celebrate, then decide what your life here is about now.");
                        } catch (e) { /* ignore */ }
                    }
                    if (winners.length) this.announce(`§6[Real AI] ${winners.map(b => b.name).join(" and ")} killed the Ender Dragon and beat the game!`);
                }
                // Nearby brains notice deaths of players and bots
                for (const [, br] of allBrains()) {
                    try {
                        if (br.bot.dimension.id !== dead.dimension.id || dist(br.bot.location, dead.location) > 32) continue;
                        if (dead.typeId === "minecraft:player") br.noteEvent("death", `${dead.name} died nearby`);
                        else if (dead.typeId === BOT_TYPE) br.noteEvent("death", `${dead.nameTag || "a bot"} died nearby`);
                        else if (ev.damageSource?.damagingEntity?.id === br.id) br.noteEvent("action_done", `killed a ${dead.typeId.replace("minecraft:", "")}`);
                    } catch (e) { /* ignore */ }
                }
            });
            world.afterEvents.playerSpawn.subscribe(ev => {
                if (!ev.initialSpawn) {
                    // a respawn: a brained body comes back to life knowing where its things are
                    try {
                        const b = getBrain(ev.player);
                        if (b) {
                            b.dead = false;
                            b.sleptSince = false;
                            const dp = b.memory.deathPos;
                            let items = "";
                            if (dp) { try { const d = dp.dim === ev.player.dimension.id ? Math.round(dist(ev.player.location, dp)) : null; items = `; your dropped items lie at ${dp.x} ${dp.y} ${dp.z}${d === null ? " in " + dp.dim.replace("minecraft:", "") : " (" + d + "m away)"}, they vanish after about five minutes` ; } catch (e) { items = `; your dropped items lie at ${dp.x} ${dp.y} ${dp.z}`; } }
                            b.noteEvent("death", `you respawned at ${fmtPos(ev.player.location)} with nothing${items}`);
                        }
                    } catch (e) { /* ignore */ }
                    return;
                }
                for (const [, br] of allBrains()) { try { if (br.settings.owner === ev.player.id) br.noteEvent("player_near", `${ev.player.name} (my owner) joined the game`); } catch (e) { /* ignore */ } }
                // Player2NPC behaviour: companions that wandered off (or are in another dimension) come to their owner
                const player = ev.player;
                system.runTimeout(() => { try { this.gatherCompanions(player); } catch (e) { /* ignore */ } }, 60);
                system.runTimeout(() => { try { this.populate("join", player); } catch (e) { console.warn("[RealAI] populate failed", e); } }, 40);
            });
            // The world around them: a new day, the weather, and anyone touching their home.
            try {
                world.afterEvents.weatherChange.subscribe(ev => {
                    try {
                        const what = ev.newWeather === "Clear" ? "the sky cleared" : ev.newWeather === "Thunder" ? "a thunderstorm started" : "it started raining";
                        for (const [, br] of allBrains()) { try { if (br.bot.dimension.id === "minecraft:overworld") br.noteEvent("weather", what); } catch (e) { /* ignore */ } }
                    } catch (e) { /* ignore */ }
                });
            } catch (e) { /* older API */ }
            const touched = (player, block, verb) => {
                try {
                    const name = nameOfBlock(block);
                    for (const [, br] of allBrains()) {
                        try {
                            if (br.bot.id === player.id || br.settings.owner === player.id) continue;
                            const owned = findOwned(br.memory, block.location, block.dimension.id);
                            const home = br.memory?.home;
                            const atHome = home && (!home.dim || home.dim === block.dimension.id) && dist(home, block.location) <= 12;
                            if (!owned && !atHome) continue;
                            if (owned && owned.kind === "chest" && verb === "broke") forgetChest(br.memory, { ...owned.ref });
                            const key = player.id + "|" + verb + "|" + (owned ? owned.kind : "home");
                            br._touchRate = br._touchRate || new Map();
                            if ((br._touchRate.get(key) || 0) > system.currentTick - 200) continue;
                            br._touchRate.set(key, system.currentTick);
                            const where = owned ? (owned.kind === "chest" ? `your chest at ${fmtPos(block.location)}` : `your ${owned.name} at ${fmtPos(block.location)}`) : `your home (${Math.round(dist(home, block.location))}m from its centre)`;
                            br.noteEvent("home_touched", `${player.name} ${verb} ${name} ${owned && owned.kind === "chest" && verb === "broke" ? "(it was " : "at "}${where}${owned && owned.kind === "chest" && verb === "broke" ? ")" : ""}; it is yours to deal with`);
                            notePerson(br.memory, player.name, { note: `${verb} ${name} at my ${owned ? owned.name : "home"}` }, Date.now());
                        } catch (e) { /* ignore */ }
                    }
                } catch (e) { /* ignore */ }
            };
            try { world.afterEvents.playerBreakBlock.subscribe(ev => touched(ev.player, ev.block, "broke")); } catch (e) { /* ignore */ }
            try { world.afterEvents.playerPlaceBlock.subscribe(ev => touched(ev.player, ev.block, "placed")); } catch (e) { /* ignore */ }
            // Someone opening one of the bot's chests
            try {
                world.afterEvents.playerInteractWithBlock.subscribe(ev => {
                    try {
                        const block = ev.block, player = ev.player;
                        if (!block || !player || !/chest$|barrel$|shulker_box$/.test(block.typeId)) return;
                        for (const [, br] of allBrains()) {
                            try {
                                if (br.bot.id === player.id) continue;
                                const owned = findOwned(br.memory, block.location, block.dimension.id);
                                if (!owned || owned.kind !== "chest") continue;
                                br._touchRate = br._touchRate || new Map();
                                const key = player.id + "|opened";
                                if ((br._touchRate.get(key) || 0) > system.currentTick - 400) continue;
                                br._touchRate.set(key, system.currentTick);
                                br.noteEvent("home_touched", `${player.name} opened your chest at ${fmtPos(block.location)} (it held ${owned.ref.items && owned.ref.items.length ? owned.ref.items.join(", ") : "nothing you remember"}); check it and deal with it as you see fit`);
                                notePerson(br.memory, player.name, { note: "opened my chest" }, Date.now());
                            } catch (e) { /* ignore */ }
                        }
                    } catch (e) { /* ignore */ }
                });
            } catch (e) { /* older API */ }
            // A stale body of a resident (left behind in a far chunk when a fresh one was
            // spawned next to a joining player) is removed the moment it loads again.
            world.afterEvents.entityLoad.subscribe(ev => {
                try {
                    const e = ev.entity;
                    if (!e || e.typeId !== BOT_TYPE) return;
                    const pid = e.getDynamicProperty(PID_KEY);
                    if (!pid) return;
                    for (const other of this.loadedBots()) {
                        if (other.id !== e.id && other.getDynamicProperty(PID_KEY) === pid) {
                            const b = getBrain(e); if (b) unregisterBrain(e.id);
                            e.remove();
                            return;
                        }
                    }
                } catch (e) { /* ignore */ }
            });
            world.afterEvents.playerLeave.subscribe(ev => {
                for (const [, br] of allBrains()) { try { if (br.settings.owner === ev.playerId) br.noteEvent("action_done", `${ev.playerName} (my owner) left the game; carry on with your own goals`); } catch (e) { /* ignore */ } }
            });
        } catch (e) { console.warn("[RealAI] event subscription failed", e); }
    }

    intakeChat(from, text, opts = {}) {
        const key = from + "|" + text;
        const now = system.currentTick;
        this.recentChat = this.recentChat.filter(r => now - r.t < 60);
        if (this.recentChat.some(r => r.key === key)) return;       // same line via chat event and bridge relay
        this.recentChat.push({ key, t: now });
        const cfg = getWorldConfig();
        if (!playerAllowed(from)) return;        // access lists (blacklist/whitelist)
        const player = opts.player || findPlayer(from);
        for (const [, b] of allBrains()) {
            try {
                if (!b.bot.isValid) continue;
                let d = 0;
                if (player) { if (player.dimension.id !== b.bot.dimension.id) { if (!mentionsName(text, b.name)) continue; d = 999; } else d = dist(player.location, b.bot.location); }
                if (d > cfg.hearingRange && !mentionsName(text, b.name)) continue;
                b.hearChat(from, text, { whisper: opts.whisper });
            } catch (e) { /* ignore */ }
        }
    }

    onBotSaid(brain, text) {
        for (const [, b] of allBrains()) {
            if (b === brain) continue;
            try { if (b.bot.dimension.id === brain.bot.dimension.id && dist(b.bot.location, brain.bot.location) <= 20) b.hearChat(brain.name, text, { fromBot: true }); } catch (e) { /* ignore */ }
        }
    }

    keepAlive() {
        const cfg = getWorldConfig();
        const clusters = [];
        for (const [, b] of allBrains()) {
            try {
                if (!b.bot.isValid) continue;
                const loc = b.bot.location, dim = b.bot.dimension;
                const c = clusters.find(c => c.dim.id === dim.id && dist(c, loc) < 48);
                if (c) { c.n++; c.x += (loc.x - c.x) / c.n; c.z += (loc.z - c.z) / c.n; c.y = loc.y; c.owned = c.owned || !!b.settings.owner; }
                else clusters.push({ x: loc.x, y: loc.y, z: loc.z, dim, n: 1, owned: !!b.settings.owner });
            } catch (e) { /* ignore */ }
        }
        clusters.sort((a, b) => (b.owned - a.owned) || (b.n - a.n));
        const bridgeBrained = (() => { try { const bp = this.bridgePlayer(); return !!(bp && cfg.bridgePlays && allBrains().has(bp.id)); } catch (e) { return false; } })();
        if (bridgeBrained) { try { bridge.send({ t: "anchor", off: true }); } catch (e) { /* ignore */ } }
        else if (clusters.length) try { bridge.send({ t: "anchor", x: clusters[0].x, y: clusters[0].y, z: clusters[0].z, dim: clusters[0].dim.id }); } catch (e) { /* ignore */ }
        if (!cfg.keepAlive) { this.clearTickingAreas(); return; }
        const players = (() => { try { return world.getAllPlayers().filter(p => !p.hasTag("realai_bridge")); } catch (e) { return []; } })();
        // Script ticking areas (stable API, no cheats needed): 3x3 chunks around up to four clusters.
        const mgr = world.tickingAreaManager;
        if (!mgr) return;
        const wanted = clusters.filter(c => players.length === 0 || c.owned).slice(0, 4);
        for (let i = 0; i < 4; i++) {
            const name = "realai_" + i;
            const c = wanted[i];
            try { if (mgr.hasTickingArea(name)) mgr.removeTickingArea(name); } catch (e) { /* ignore */ }
            if (!c) continue;
            const cx = Math.floor(c.x / 16), cz = Math.floor(c.z / 16);
            const opts = { dimension: c.dim, from: { x: (cx - 1) * 16, y: 0, z: (cz - 1) * 16 }, to: { x: (cx + 1) * 16 + 15, y: 0, z: (cz + 1) * 16 + 15 } };
            try { if (mgr.hasCapacity(opts)) mgr.createTickingArea(name, opts).catch(() => { /* ignore */ }); } catch (e) { /* ignore */ }
        }
    }

    clearTickingAreas() {
        const mgr = world.tickingAreaManager;
        if (!mgr) return;
        for (let i = 0; i < 4; i++) { try { if (mgr.hasTickingArea("realai_" + i)) mgr.removeTickingArea("realai_" + i); } catch (e) { /* ignore */ } }
    }

    // ---- companions (Player2NPC-style summon) ----
    summon(player, persona = {}) {
        const cfg = getWorldConfig();
        let bot;
        try {
            const loc = { x: player.location.x + 1.5, y: player.location.y, z: player.location.z + 1.5 };
            bot = player.dimension.spawnEntity(BOT_TYPE, loc);
            bot.addTag("rg:awakened_ai");
        } catch (e) { return { ok: false, error: String(e?.message || e) }; }
        const name = cleanChat(persona.name || "Companion").slice(0, 24);
        system.runTimeout(() => {
            try {
                bot.nameTag = name;
                bot.addTag("online");
                const pid = `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${bot.id}`;
                bot.setDynamicProperty(PID_KEY, pid);
                bot.setDynamicProperty("rg:ai_owner_id", player.id);
                bot.setDynamicProperty("sympathy_player_" + player.id, 60);
                bot.setDynamicProperty("friend_status_" + player.id, "accepted");
                try { bot.triggerEvent("minecraft:on_tame"); } catch (e) { /* ignore */ }
                const settings = patchBotSettings(bot, { persona: { name, description: persona.description || "", personality: persona.personality || PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)], voice: persona.voice || VOICES[Math.floor(Math.random() * VOICES.length)], additionalPrompt: persona.additionalPrompt || "" }, owner: player.id, companionOf: player.name, mode: "companion", summonedAt: Date.now() });
                const brain = new BotBrain(bot);
                brain.settings = settings;
                addFact(brain.memory, `${player.name} summoned me and is my owner`, Date.now());
                brain.saveMemory();
                registerBrain(bot.id, brain);
                brain.request(`${player.name} just summoned you; greet them`);
                // record on the player's friend list so the friend UI (teleport, jobs, trades) works
                try {
                    const raw = player.getDynamicProperty("rg:friends_list_data");
                    const list = raw ? JSON.parse(raw) : [];
                    list.push({ id: pid, name, isTamed: true, factionTag: bot.hasTag("good") ? "good" : bot.hasTag("bad") ? "bad" : "crazy", lvTag: "lv3", variantId: 0 });
                    player.setDynamicProperty("rg:friends_list_data", JSON.stringify(list));
                    const comps = JSON.parse(player.getDynamicProperty("realai:companions") || "[]");
                    comps.push({ pid, name, at: Date.now() });
                    player.setDynamicProperty("realai:companions", JSON.stringify(comps.slice(-16)));
                } catch (e) { /* ignore */ }
            } catch (e) { console.warn("[RealAI] summon setup failed", e); }
        }, 2);
        void cfg;
        return { ok: true, name };
    }

    // Every rg:bot in every dimension that is currently loaded.
    loadedBots() {
        const out = [];
        const seen = new Set();
        for (const e of [...(ALL_AI_CACHE || []), ...[...allBrains().values()].map(b => b.bot)]) {
            try { if (e && e.isValid && e.typeId === BOT_TYPE && !seen.has(e.id)) { seen.add(e.id); out.push(e); } } catch (e2) { /* ignore */ }
        }
        for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
            try { for (const e of world.getDimension(id).getEntities({ type: BOT_TYPE })) { if (e.isValid && !seen.has(e.id)) { seen.add(e.id); out.push(e); } } } catch (e) { /* ignore */ }
        }
        return out;
    }

    // Spawn a body for a named AI player next to `player` (or at `at`), wire its persistent
    // id, persona and brain, and let it introduce itself. Shared by residents, companion
    // respawns and resident respawns.
    spawnBody({ name, pid, persona, settings, player, at, dimension, episode, greeting, announceJoin, onReady }) {
        let bot;
        try {
            const dim = dimension || player?.dimension || world.getDimension("minecraft:overworld");
            let loc = at;
            if (!loc && player) {
                const { dx, dz } = ringOffset(Math.floor(Math.random() * 8), 8);
                loc = this.groundAt(dim, player.location.x + dx, player.location.z + dz, player.location.y);
            }
            if (!loc) loc = { x: 0.5, y: 70, z: 0.5 };
            bot = dim.spawnEntity(BOT_TYPE, loc);
            bot.addTag("rg:awakened_ai");   // the legacy spawn handler must not rename it
        } catch (e) { console.warn(`[RealAI] could not spawn ${name}: ${e?.message || e}`); return null; }
        system.runTimeout(() => {
            try {
                if (!bot.isValid) return;
                bot.nameTag = name;
                bot.addTag("online");
                if (pid) bot.setDynamicProperty(PID_KEY, pid);
                const full = { ...settings, persona: { ...(settings?.persona || {}), ...(persona || {}), name } };
                writeBotSettings(bot, full);
                const brain = new BotBrain(bot);
                brain.settings = full;
                if (episode) addEpisode(brain.memory, episode, Date.now());
                brain.saveMemory();
                registerBrain(bot.id, brain);
                setBrainMode(bot, true);
                if (greeting) brain.request(greeting);
                if (announceJoin) this.announceRaw({ translate: "multiplayer.player.joined", with: [name] });
                if (onReady) onReady(bot, brain);
            } catch (e) { console.warn("[RealAI] spawn setup failed", e); }
        }, 2);
        return bot;
    }

    // Standing room near (x, z): the surface in the Overworld/End, a solid floor with two air
    // blocks above it in the Nether (or under an overhang), else the hinted height.
    groundAt(dim, x, z, yHint) {
        try {
            const spot = findSafeSpot(dim, x, z, yHint);
            if (spot && Math.abs(spot.y - yHint) < 48) return spot;
        } catch (e) { /* unloaded or unsupported */ }
        return { x: Math.floor(x) + 0.5, y: Math.floor(yHint), z: Math.floor(z) + 0.5 };
    }

    bridgePlayer() {
        try {
            const t = transportInfo();
            if (!t.bridgeConnected || !t.bridgePlayer) return null;
            return world.getAllPlayers().find(p => p.isValid && p.name === t.bridgePlayer) || null;
        } catch (e) { return null; }
    }

    // The relay account is a player in the list but never an anchor for residents.
    isBridgeAccount(p) {
        try {
            if (p.hasTag("realai_bridge")) return true;
            const cfg = getWorldConfig();
            if (cfg.bridgeName && p.name === cfg.bridgeName) return true;
            const t = transportInfo();
            if (t.bridgeConnected && t.bridgePlayer && p.name === t.bridgePlayer) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    announceRaw(raw) { try { world.sendMessage(raw); } catch (e) { /* ignore */ } }

    // ---- residents: the named AI players that live in this world ----
    roster() { try { return parseRoster(world.getDynamicProperty(ROSTER_KEY)); } catch (e) { return []; } }
    saveRoster(list) { try { world.setDynamicProperty(ROSTER_KEY, serializeRoster(list)); } catch (e) { console.warn("[RealAI] roster save failed", e); } }

    /**
     * Make sure every resident has a body in the world. Missing ones (never spawned,
     * or left behind in unloaded chunks) are spawned a few blocks from a player, one
     * every two seconds, each announced like a player joining.
     */
    populate(reason, joiningPlayer) {
        const cfg = getWorldConfig();
        if (cfg.autonomy === "off") return;
        if (!isBrainEnabled()) {
            // No model connection yet: tell the joining player once what is missing instead of spawning mindless bodies.
            if (reason === "join" && joiningPlayer && (Number(cfg.worldPlayers) || 0) > 0) {
                try { joiningPlayer.sendMessage(`§e[Real AI] ${cfg.worldPlayers} AI players will join as soon as a model connection exists: ${this.configProblem || "start the Real AI bridge (bridge/ folder) with your API key, or configure a dedicated server key"}.`); } catch (e) { /* ignore */ }
            }
            return;
        }
        const wanted = Math.max(0, Math.min(Number(cfg.worldPlayers) || 0, Number(cfg.maxBrains) || 0));
        let { roster, changed } = ensureRoster(this.roster(), wanted, { names: { prefix: name_prefix, nouns: name_Nouns, suffix: name_suffix, preset: presetNames }, personalities: PERSONALITIES, voices: VOICES, now: Date.now() });
        if (this.assignProviders(roster)) changed = true;
        if (changed) this.saveRoster(roster);
        const players = (() => { try { return world.getAllPlayers().filter(p => p.isValid && !this.isBridgeAccount(p)); } catch (e) { return []; } })();
        if (!players.length) return;
        if (joiningPlayer && this.isBridgeAccount(joiningPlayer)) joiningPlayer = null;
        const present = new Set();
        for (const e of this.loadedBots()) { try { const pid = e.getDynamicProperty(PID_KEY); if (pid) present.add(pid); } catch (e2) { /* ignore */ } }
        this.pendingSpawns = this.pendingSpawns || new Map();
        const now = system.currentTick;
        let delay = 20;
        let i = 0;
        for (const r of roster) {
            if (this.respawning && this.respawning.has(r.pid)) continue;   // coming back from a death in a moment
            if (present.has(r.pid)) {
                // a body is already here: keep its brain's provider in step with the roster
                try {
                    const body = this.loadedBots().find(e => e.getDynamicProperty(PID_KEY) === r.pid);
                    const b = body && getBrain(body);
                    if (b && (b.settings.provider || "") !== (r.provider || "")) { b.settings = patchBotSettings(body, { provider: r.provider || undefined }); b.systemCache = null; }
                } catch (e) { /* ignore */ }
                continue;
            }
            const pendingUntil = this.pendingSpawns.get(r.pid);
            if (pendingUntil && pendingUntil > now) continue;
            const anchor = (joiningPlayer && joiningPlayer.isValid) ? joiningPlayer : players[i % players.length];
            this.pendingSpawns.set(r.pid, now + delay + 100);
            const member = r;
            system.runTimeout(() => {
                try {
                    if (!anchor.isValid) return;
                    for (const e of this.loadedBots()) { try { if (e.getDynamicProperty(PID_KEY) === member.pid) return; } catch (e2) { /* ignore */ } }
                    const hasMemory = (() => { try { return !!world.getDynamicProperty("realai:mem:" + member.pid); } catch (e) { return false; } })();
                    this.spawnBody({
                        name: member.name, pid: member.pid, persona: member.persona,
                        settings: { mode: "resident", resident: true, persona: member.persona, provider: member.provider || undefined },
                        player: anchor,
                        episode: hasMemory ? `joined the game again near ${anchor.name}` : `first day on this server; ${anchor.name} is online`,
                        greeting: hasMemory ? `you just logged back in near ${anchor.name}; greet them briefly and pick up where you left off` : `you just joined this server for the first time; say hi to ${anchor.name} and start making a life here`,
                        announceJoin: true,
                    });
                } catch (e) { console.warn("[RealAI] resident spawn failed", e); }
                finally { this.pendingSpawns.delete(member.pid); }
            }, delay);
            delay += RESIDENT_SPAWN_GAP;
            i++;
        }
    }

    // Dawn: every bot gets a moment to plan its day.
    dayWatch() {
        try {
            const label = timeLabel(world.getTimeOfDay());
            const wasNight = /night|dusk/.test(this.lastTimeLabel || "");
            if (wasNight && (label === "dawn" || label === "morning")) {
                for (const [, br] of allBrains()) { try { br.noteEvent("dawn", "a new day begins; think about what you want from it"); } catch (e) { /* ignore */ } }
            }
            this.lastTimeLabel = label;
            this.bedtimeWatch();
        } catch (e) { /* ignore */ }
    }

    // While !ai debug is on, the bridge gets the server's view of its body once a second, so the
    // phone's log shows whether the server really moves it (and whether it can be hurt).
    probe() {
        if (!this.debug) return;
        const bp = this.bridgePlayer();
        if (!bp) return;
        try {
            const l = bp.location;
            let gm = null; try { gm = String(bp.getGameMode()); } catch (e) { /* ignore */ }
            bridge.send({ t: "probe", x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2), ground: !!bp.isOnGround, gm, walks: bridgeWalks(bp), brain: allBrains().has(bp.id) });
        } catch (e) { /* ignore */ }
    }

    // A human in bed cannot skip the night while the AI's own account stands around awake: once
    // every other player is in bed, the AI's body turns in as well and the night passes.
    bedtimeWatch() {
        const bp = this.bridgePlayer();
        const brains = allBrains();
        if (!bp || !brains.has(bp.id)) { this.bedChecks = 0; return; }
        const t = world.getTimeOfDay();
        const night = t >= 12000 || t < 500;
        const others = world.getAllPlayers().filter(p => p.id !== bp.id);
        const inBed = others.length > 0 && others.every(p => { try { return !!p.isSleeping; } catch (e) { return false; } });
        if (!night || !inBed) { this.bedChecks = 0; return; }
        this.bedChecks = (this.bedChecks || 0) + 1;
        if (this.bedChecks < 2) return;
        this.bedChecks = 0;
        try { world.setTimeOfDay(1000); } catch (e) { /* ignore */ }
        try { bp.dimension.runCommand("weather clear"); } catch (e) { /* ignore */ }
        const b = brains.get(bp.id);
        if (b) { b.sleptSince = true; try { b.actuator.stopAll(); } catch (e) { /* ignore */ } b.noteEvent("dawn", "you went to bed when the others did and slept through the night; a new day begins"); }
        this.announce(`§7[Real AI] ${bp.name} went to bed too. Good morning.`);
    }

    residentsStatus() {
        const roster = this.roster();
        const present = new Set();
        for (const e of this.loadedBots()) { try { const pid = e.getDynamicProperty(PID_KEY); if (pid) present.add(pid); } catch (e2) { /* ignore */ } }
        return { total: roster.length, online: roster.filter(r => present.has(r.pid)).length, names: roster.map(r => r.name), providers: roster.map(r => r.provider || getWorldConfig().provider) };
    }

    // The world's default provider must be one that can actually answer. If it is not (a fresh
    // world defaults to Claude but the bridge only has an OpenAI key), switch to one that can.
    adoptProvider() {
        try {
            const cfg = getWorldConfig();
            const avail = this.availableProviders();
            if (!avail.length || avail.includes(cfg.provider)) return;
            const pick = avail.find(p => MIX_PROVIDERS.has(p)) || avail[0];
            updateWorldConfig({ provider: pick, model: "" });
            for (const [, b] of allBrains()) b.systemCache = null;
            this.announce(`§e[Real AI] No key for "${cfg.provider}"; bots now think with ${PROVIDER_LABELS[pick] || pick}.`);
        } catch (e) { /* ignore */ }
    }

    // Which providers can answer a think right now: the server's own keys, or what the bridge said it has.
    availableProviders() {
        try {
            if (hasDirectHttp) return configuredProviders().filter(p => p.hasKey).map(p => p.id);
            if (bridge.isConnected()) return (this.bridgeProviders || []).slice();
        } catch (e) { /* ignore */ }
        return [];
    }

    // Spread the residents over every provider that has a key, so the world is literally
    // Claude, GPT, Grok and Gemini playing side by side. Returns true if the roster changed.
    assignProviders(roster) {
        const cfg = getWorldConfig();
        let avail = this.availableProviders().filter(p => MIX_PROVIDERS.has(p));
        if (!cfg.mixProviders) avail = [];
        let changed = false;
        if (!avail.length) {
            for (const r of roster) if (r.provider) { delete r.provider; changed = true; }
            return changed;
        }
        const counts = new Map(avail.map(p => [p, 0]));
        for (const r of roster) if (r.provider && counts.has(r.provider)) counts.set(r.provider, counts.get(r.provider) + 1);
        for (const r of roster) {
            if (r.provider && counts.has(r.provider)) continue;
            let best = avail[0];
            for (const p of avail) if (counts.get(p) < counts.get(best)) best = p;
            r.provider = best; counts.set(best, counts.get(best) + 1); changed = true;
        }
        return changed;
    }

    // A bot with a brain that dies comes back like a player respawning (companions next to
    // their owner, residents at their home or near the closest player), keeping its
    // persistent id, memory and persona. Permadeath (companions only) is a server choice.
    onBotDeath(brain, dead, killerName) {
        const settings = brain.settings || {};
        const isCompanion = !!settings.owner && settings.mode === "companion";
        const isResident = settings.mode === "resident";
        if (!isCompanion && !isResident) return;
        const cfg = getWorldConfig();
        let pid = null, dimId = "minecraft:overworld", loc = { x: 0, y: 70, z: 0 };
        try { pid = dead.getDynamicProperty(PID_KEY) || null; dimId = dead.dimension.id; loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z }; } catch (e) { /* ignore */ }
        const ownerId = settings.owner;
        const owner = (() => { try { return ownerId ? world.getEntity(ownerId) : undefined; } catch (e) { return undefined; } })();
        const tell = (msg) => { try { if (owner?.isValid) owner.sendMessage(msg); } catch (e) { /* ignore */ } };
        if (isCompanion && cfg.companionDeath === "permadeath") {
            tell(`§c${brain.name} has died${killerName ? " to " + killerName : ""} and will not return (permadeath is on)`);
            return;
        }
        if (isCompanion) tell(`§e${brain.name} has died${killerName ? " to " + killerName : ""}; respawning in 10s`);
        const settingsCopy = { ...settings, respawns: (settings.respawns || 0) + 1 };
        const name = brain.name;
        const home = brain.memory?.home ? { ...brain.memory.home } : null;
        this.respawning = this.respawning || new Set();
        if (pid) this.respawning.add(pid);
        system.runTimeout(() => {
            if (pid) this.respawning.delete(pid);
            try {
                const o = (() => { try { return ownerId ? world.getEntity(ownerId) : undefined; } catch (e) { return undefined; } })();
                let dim = world.getDimension(dimId), at = null, player = null;
                if (isCompanion && o?.isValid) { dim = o.dimension; at = { x: o.location.x + 1.5, y: o.location.y, z: o.location.z + 1.5 }; }
                else if (isResident && home && (home.dim || home.dimension)) { try { dim = world.getDimension(home.dim || home.dimension); at = this.groundAt(dim, home.x, home.z, home.y); } catch (e) { at = null; } }
                if (!at) {
                    const players = (() => { try { return world.getAllPlayers().filter(p => p.isValid); } catch (e) { return []; } })();
                    const near = players.find(p => { try { return p.dimension.id === dimId; } catch (e) { return false; } }) || players[0];
                    if (near) { player = near; dim = near.dimension; }
                    else at = { x: loc.x, y: loc.y + 1, z: loc.z };
                }
                this.spawnBody({
                    name, pid, persona: settingsCopy.persona, settings: settingsCopy, dimension: dim, at, player,
                    episode: `I died${killerName ? " to " + killerName : ""} and respawned${isCompanion && o?.isValid ? " next to " + o.name : home ? " at home" : ""}; my inventory was lost`,
                    greeting: "you just respawned after dying; say something brief about it and carry on",
                    onReady: (bot) => {
                        if (isCompanion && ownerId) {
                            try {
                                bot.setDynamicProperty("rg:ai_owner_id", ownerId);
                                bot.setDynamicProperty("sympathy_player_" + ownerId, 60);
                                bot.setDynamicProperty("friend_status_" + ownerId, "accepted");
                                bot.triggerEvent("minecraft:on_tame");
                            } catch (e) { /* ignore */ }
                            tell(`§a${name} is back`);
                        }
                    },
                });
            } catch (e) { console.warn("[RealAI] respawn failed", e); }
        }, 200);
    }

    // Bring every companion of this player to them if they are far away or in another dimension.
    gatherCompanions(player) {
        const cfg = getWorldConfig();
        if (!cfg.companionJoinTeleport) return;
        if (!player?.isValid) return;
        let n = 0;
        for (const b of this.companionsOf(player)) {
            try {
                const far = b.bot.dimension.id !== player.dimension.id || dist(b.bot.location, player.location) > 48;
                if (!far) continue;
                b.actuator.stopAll();
                b.bot.teleport({ x: player.location.x + 1.5 + n, y: player.location.y, z: player.location.z + 1.5 }, { dimension: player.dimension });
                b.noteEvent("action_done", `${player.name} (my owner) came online and I was brought to their side`);
                n++;
            } catch (e) { /* ignore */ }
        }
        if (n) { try { player.sendMessage(`§7${n} companion${n > 1 ? "s" : ""} came to you`); } catch (e) { /* ignore */ } }
    }

    despawn(botEntity) {
        const b = getBrain(botEntity);
        if (b) { b.saveMemory(); unregisterBrain(botEntity.id); }
        try { botEntity.remove(); } catch (e) { return false; }
        return true;
    }

    companionsOf(player) {
        const out = [];
        for (const [, b] of allBrains()) { try { if (b.settings.owner === player.id && b.bot.isValid) out.push(b); } catch (e) { /* ignore */ } }
        return out;
    }

    status() {
        const cfg = getWorldConfig();
        return { enabled: isBrainEnabled(), edition: EDITION, residents: this.residentsStatus(), transport: transportInfo(), provider: cfg.provider, model: cfg.model || "(default)", brains: [...allBrains().values()].map(b => b.status()), budget: budget.status(), configProblem: this.configProblem, worldContent: worldContent().counts };
    }
}

export function isOperator(player) {
    try { if (typeof player.commandPermissionLevel === "number") return player.commandPermissionLevel >= 1; } catch (e) { /* ignore */ }
    try { if (typeof player.isOp === "function") return player.isOp(); } catch (e) { /* ignore */ }
    return true;
}

export const manager = new BrainManager();
export function startBrainSystem() { manager.start(); }
export { getBrain, allBrains, createMemory };
