// The brain system: attaches an LLM-driven BotBrain to rg:bot entities,
// feeds them observations and chat, runs their actions, persists memory and
// keeps bots ticking when the humans leave.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { ALL_AI_CACHE } from "../greeting.js";
import { recordBotMessage } from "../ai_conversations.js";
import { registerBrain, unregisterBrain, getBrain, allBrains, setBrainEnabled, isBrainEnabled } from "./gate.js";
import { getWorldConfig, callConfigFor, readBotSettings, writeBotSettings, patchBotSettings, MEMORY_KEY, BUDGET_KEY } from "./config.js";
import { loadMemory, saveMemory, addFact, forgetFact, addEpisode, addChat, notePerson, createMemory } from "./memory.js";
import { buildSystemStable, buildTurn, promptHash } from "./prompt.js";
import { createSchedulerState, noteEvent, shouldThink, beginThink, endThink, CADENCE } from "./scheduler.js";
import { observe, dist, fmtPos } from "./perception.js";
import { Actuator, findPlayer, attachSrpState } from "./actuator.js";
import { think as transportThink, bridge, transportInfo } from "./transport.js";
import { hasDirectHttp, EDITION } from "./net_impl.js";
import { BudgetLedger } from "./budget.js";
import { worldContent } from "./world_content.js";
import { clip } from "./json_util.js";
import { cleanChat } from "./action_schema.js";
import { playerAllowed } from "./ui.js";
import * as srpState from "../srp/state.js";
import { cure as srpCure, COTH_TAG } from "../srp/infection.js";

const BOT_TYPE = "rg:bot";
const STEP = 10;                 // ticks between brain steps per bot
const DISCOVER_GAP = 100;
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
    }

    get name() { try { return this.bot.nameTag || "Player"; } catch (e) { return "Player"; } }

    readMemoryRaw() {
        try {
            const own = this.bot.getDynamicProperty(MEMORY_KEY);
            if (own) return own;
            const pid = this.bot.getDynamicProperty(PID_KEY);
            if (pid) { const w = world.getDynamicProperty("aisb:mem:" + pid); if (w) return w; }
        } catch (e) { /* ignore */ }
        return undefined;
    }

    saveMemory() {
        try {
            const s = saveMemory(this.memory);
            this.bot.setDynamicProperty(MEMORY_KEY, s);
            const pid = this.bot.getDynamicProperty(PID_KEY);
            if (pid) world.setDynamicProperty("aisb:mem:" + pid, s);
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
        const extra = [cfg.serverRules, cfg.callByName ? "Only reply in chat when someone says your name or whispers to you; otherwise stay quiet unless something important happens." : null].filter(Boolean).join("\n");
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
            if (system.currentTick - this.lastBotReplyTick < 20 * 60 || Math.random() > 0.3) { addChat(this.memory, from, text, Date.now()); return; }
            this.lastBotReplyTick = system.currentTick;
        }
        addChat(this.memory, from, text, Date.now(), { whisper: !!opts.whisper });
        this.chatBuffer.push({ from, text });
        if (this.chatBuffer.length > 8) this.chatBuffer.shift();
        if (opts.whisper || mentioned) this.noteEvent("chat_mention", `${from}: ${text}`);
        else if (!cfg.callByName) this.noteEvent("chat_nearby", `${from}: ${text}`);
        if (!opts.fromBot && from) notePerson(this.memory, from, {}, Date.now());
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
        if (to) {
            const p = findPlayer(to);
            if (p) { try { p.sendMessage(`§7(${this.name} whispers) §r${line}`); } catch (e) { /* ignore */ } addChat(this.memory, this.name, line, Date.now(), { self: true, whisper: true }); return; }
        }
        try { world.sendMessage(`<${this.name}> ${line}`); } catch (e) { /* ignore */ }
        addChat(this.memory, this.name, line, Date.now(), { self: true });
        try { recordBotMessage(this.name, line, this.bot.location, { id: this.id, mood: this.bot.getDynamicProperty("rg:mood"), dimensionId: this.bot.dimension?.id }); } catch (e) { /* ignore */ }
        manager.onBotSaid(this, line);
    }

    cureSelf() { try { srpCure(this.bot); } catch (e) { /* ignore */ } }

    rememberPortal(fromDim, pos) {
        addFact(this.memory, `portal in ${fromDim.replace("minecraft:", "")} at ${fmtPos(pos)}`, Date.now());
    }

    // ---- loop ----
    tick(now) {
        if (!this.bot.isValid) return;
        try { this.actuator.tick(now); } catch (e) { console.warn(`[AISB] ${this.name} actuator: ${e}`); }
        if (this.paused) return;
        if (!isBrainEnabled()) return;
        if (shouldThink(this.sched, now, budget.level())) this.think(now).catch(e => { console.warn(`[AISB] ${this.name} think crashed: ${e}`); endThink(this.sched, system.currentTick, false, false); });
    }

    async think(now) {
        const cfg = callConfigFor(this);
        const level = budget.level();
        const events = beginThink(this.sched, now, level);
        const lastActions = this.actuator.drainResults();
        const obs = observe(this.bot, this, {
            events: events.filter(e => e.type !== "chat_nearby" && e.type !== "chat_mention").map(e => e.text),
            newChat: this.chatBuffer.splice(0),
            lastActions,
            problems: this.problems.splice(0),
            requests: this.requests.splice(0),
            srpLine: srpLine(),
        });
        const systemStable = this.systemPrompt();
        const turn = buildTurn({ systemStable, memory: this.memory, now: Date.now(), obs, history: this.history });
        turn.sysHash = this.systemCache.hash;
        const started = Date.now();
        const res = await transportThink(this.id, cfg, turn);
        const nowTick = system.currentTick;
        this.lastThinkAt = nowTick;
        if (!this.bot.isValid) return;
        if (res.usage) budget.record(res.provider || cfg.provider, res.model || cfg.model, res.usage, this.name);
        if (!res.ok) {
            this.failures++;
            this.lastError = res.error;
            endThink(this.sched, nowTick, false, false);
            if (res.type === "bad_json") this.problems.push("your reply must be exactly one JSON object with the fields shown in the format");
            if (res.type === "no_transport" || res.type === "config" || /no API key/.test(res.error || "")) manager.reportConfigProblem(res.error);
            else console.warn(`[AISB] ${this.name}: ${res.error}`);
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
        if (manager.debug) console.warn(`[AISB] ${this.name} (${res.provider}/${res.model}, ${Date.now() - started}ms): ${reply.thought} | say=${reply.say} | ${reply.actions.map(a => a.type).join(",")}`);
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
        if (reply.say) {
            const quiet = cfg.chatVolume === 1 && !reply.sayTo && !this.chatBuffer.length && Math.random() < 0.5;
            if (!quiet) this.sayNow(reply.say, reply.sayTo);
        }
        if (reply.actions.length) this.actuator.enqueue(reply.actions);
    }

    status() {
        return { name: this.name, id: this.id, thinks: this.thinks, failures: this.failures, lastError: this.lastError, paused: this.paused, current: this.actuator.describeCurrent(), goal: this.memory.goal, owner: this.settings.owner || null, provider: callConfigFor(this).provider, facts: this.memory.facts.length, nextThinkIn: Math.max(0, Math.round((this.sched.nextThink - system.currentTick) / 20)) };
    }
}

function mentionsName(text, name) {
    if (!text || !name) return false;
    const first = String(name).split(/[\s_]+/)[0].toLowerCase();
    const t = String(text).toLowerCase();
    return first.length >= 3 && (t.includes(first) || t.includes(String(name).toLowerCase()));
}

function srpLine() {
    try {
        const phase = srpState.currentPhase();
        return `parasite hive phase ${phase}/10 (${srpState.state.parasiteCount} parasites loaded, ${srpState.state.nodeCount} hive nodes)`;
    } catch (e) { return ""; }
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
        attachSrpState(srpState);
        this.refreshEnabled();
        try { bridge.subscribe(); } catch (e) { console.warn("[AISB] bridge subscribe failed", e); }
        bridge.onChat((from, text, whisper) => this.intakeChat(from, text, { whisper, viaBridge: true }));
        bridge.onHello(info => { console.warn(`[AISB] bridge connected: ${info.name} v${info.version}, providers: ${(info.providers || []).join(", ")}`); this.refreshEnabled(); this.announce(`§a[AI Sandbox] Bridge "${info.name}" connected. Bots are thinking through it.`); });
        this.subscribeEvents();
        system.runInterval(() => this.discover(), DISCOVER_GAP);
        system.runInterval(() => this.step(), 1);
        system.runInterval(() => this.keepAlive(), KEEPALIVE_GAP);
        system.runInterval(() => this.autoCure(), 80);
        system.runInterval(() => this.refreshEnabled(), 200);
        system.runTimeout(() => this.discover(), 40);
        console.warn(`[AISB] brain system started (edition ${EDITION}, direct http: ${hasDirectHttp})`);
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
            try { if (isOperator(p)) p.sendMessage(`§c[AI Sandbox] Bots cannot think: ${err}. Type !ai help`); } catch (e) { /* ignore */ }
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
        const score = (e) => {
            const s = readBotSettings(e);
            if (s.mode === "companion" || s.owner) return -1e9;
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
                try { registerBrain(e.id, new BotBrain(e)); } catch (err) { console.warn(`[AISB] attach failed: ${err}`); }
            }
        }
        for (const [id, b] of [...brains]) {
            if (!keep.has(id)) { try { b.saveMemory(); b.actuator.stopAll(); } catch (e) { /* ignore */ } unregisterBrain(id); }
        }
    }

    step() {
        this.tickCounter++;
        const now = system.currentTick;
        let i = 0;
        for (const [, b] of allBrains()) {
            if ((now + i) % STEP === 0) { try { b.tick(now); } catch (e) { console.warn(`[AISB] tick ${b.name}: ${e}`); } }
            i++;
        }
    }

    subscribeEvents() {
        // Player chat (beta API; fails harmlessly where unavailable, the bridge relays chat there).
        try {
            world.afterEvents.chatSend.subscribe(ev => {
                try {
                    if (ev.message.startsWith("!")) return;
                    if (ev.sender.hasTag("aisb_bridge")) return;
                    this.intakeChat(ev.sender.name, ev.message, { player: ev.sender });
                } catch (e) { /* ignore */ }
            });
        } catch (e) { console.warn("[AISB] chatSend event unavailable (stable API); chat reaches bots through the bridge or the Talk menu"); }
        try {
            world.afterEvents.entityHurt.subscribe(ev => {
                try {
                    const b = getBrain(ev.hurtEntity);
                    if (!b) return;
                    const src = ev.damageSource;
                    let who = src?.cause || "something";
                    try { if (src?.damagingEntity?.isValid) who = src.damagingEntity.nameTag || src.damagingEntity.typeId.replace("minecraft:", ""); } catch (e) { /* ignore */ }
                    if (ev.damage >= 2) b.noteEvent("hurt", `took ${Math.round(ev.damage)} damage from ${who}`);
                    try { if (src?.damagingEntity?.typeId === "minecraft:player") notePerson(b.memory, src.damagingEntity.name, { note: "attacked me" }, Date.now()); } catch (e) { /* ignore */ }
                } catch (e) { /* ignore */ }
            });
            world.afterEvents.entityDie.subscribe(ev => {
                const dead = ev.deadEntity;
                const b = getBrain(dead);
                if (b) {
                    let killerName = "";
                    try {
                        try { const k = ev.damageSource?.damagingEntity; if (k?.isValid) killerName = k.nameTag || k.typeId.replace("minecraft:", ""); } catch (e) { /* ignore */ }
                        addEpisode(b.memory, `I died${killerName ? " to " + killerName : ""} at ${fmtPos(dead.location)}`, Date.now());
                        b.saveMemory();
                    } catch (e) { /* ignore */ }
                    unregisterBrain(dead.id);
                    try { this.onCompanionDeath(b, dead, killerName); } catch (e) { console.warn("[AISB] companion death handling failed", e); }
                    return;
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
                if (!ev.initialSpawn) return;
                for (const [, br] of allBrains()) { try { if (br.settings.owner === ev.player.id) br.noteEvent("player_near", `${ev.player.name} (my owner) joined the game`); } catch (e) { /* ignore */ } }
                // Player2NPC behaviour: companions that wandered off (or are in another dimension) come to their owner
                const player = ev.player;
                system.runTimeout(() => { try { this.gatherCompanions(player); } catch (e) { /* ignore */ } }, 60);
            });
            world.afterEvents.playerLeave.subscribe(ev => {
                for (const [, br] of allBrains()) { try { if (br.settings.owner === ev.playerId) br.noteEvent("action_done", `${ev.playerName} (my owner) left the game; carry on with your own goals`); } catch (e) { /* ignore */ } }
            });
        } catch (e) { console.warn("[AISB] event subscription failed", e); }
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

    autoCure() {
        if (!getWorldConfig().autoCure) return;
        for (const [, b] of allBrains()) {
            try { if (b.bot.hasTag(COTH_TAG)) { srpCure(b.bot); b.noteEvent("hurt", "the hive's call faded (cured)"); } } catch (e) { /* ignore */ }
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
        if (clusters.length) try { bridge.send({ t: "anchor", x: clusters[0].x, y: clusters[0].y, z: clusters[0].z, dim: clusters[0].dim.id }); } catch (e) { /* ignore */ }
        if (!cfg.keepAlive) { this.clearTickingAreas(); return; }
        const players = (() => { try { return world.getAllPlayers().filter(p => !p.hasTag("aisb_bridge")); } catch (e) { return []; } })();
        // Script ticking areas (stable API, no cheats needed): 3x3 chunks around up to four clusters.
        const mgr = world.tickingAreaManager;
        if (!mgr) return;
        const wanted = clusters.filter(c => players.length === 0 || c.owned).slice(0, 4);
        for (let i = 0; i < 4; i++) {
            const name = "aisb_" + i;
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
        for (let i = 0; i < 4; i++) { try { if (mgr.hasTickingArea("aisb_" + i)) mgr.removeTickingArea("aisb_" + i); } catch (e) { /* ignore */ } }
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
                    const comps = JSON.parse(player.getDynamicProperty("aisb:companions") || "[]");
                    comps.push({ pid, name, at: Date.now() });
                    player.setDynamicProperty("aisb:companions", JSON.stringify(comps.slice(-16)));
                } catch (e) { /* ignore */ }
            } catch (e) { console.warn("[AISB] summon setup failed", e); }
        }, 2);
        void cfg;
        return { ok: true, name };
    }

    // A summoned companion that dies comes back (like a player respawning) unless the server
    // chose permadeath. Memory, persona and ownership survive through the persistent pid.
    onCompanionDeath(brain, dead, killerName) {
        const settings = brain.settings || {};
        if (!settings.owner || settings.mode !== "companion") return;
        const cfg = getWorldConfig();
        let pid = null, ownerId = settings.owner, dimId = "minecraft:overworld", loc = { x: 0, y: 70, z: 0 };
        try { pid = dead.getDynamicProperty(PID_KEY) || null; dimId = dead.dimension.id; loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z }; } catch (e) { /* ignore */ }
        const owner = (() => { try { return world.getEntity(ownerId); } catch (e) { return undefined; } })();
        const tell = (msg) => { try { if (owner?.isValid) owner.sendMessage(msg); } catch (e) { /* ignore */ } };
        if (cfg.companionDeath === "permadeath") {
            tell(`§c${brain.name} has died${killerName ? " to " + killerName : ""} and will not return (permadeath is on)`);
            return;
        }
        tell(`§e${brain.name} has died${killerName ? " to " + killerName : ""}; respawning in 10s`);
        const settingsCopy = { ...settings, respawns: (settings.respawns || 0) + 1 };
        const name = brain.name;
        system.runTimeout(() => {
            try {
                const o = (() => { try { return world.getEntity(ownerId); } catch (e) { return undefined; } })();
                const dim = o?.isValid ? o.dimension : world.getDimension(dimId);
                const at = o?.isValid ? { x: o.location.x + 1.5, y: o.location.y, z: o.location.z + 1.5 } : { x: loc.x, y: loc.y + 1, z: loc.z };
                const bot = dim.spawnEntity(BOT_TYPE, at);
                bot.addTag("rg:awakened_ai");
                system.runTimeout(() => {
                    try {
                        if (!bot.isValid) return;
                        bot.nameTag = name;
                        bot.addTag("online");
                        if (pid) bot.setDynamicProperty(PID_KEY, pid);
                        bot.setDynamicProperty("rg:ai_owner_id", ownerId);
                        bot.setDynamicProperty("sympathy_player_" + ownerId, 60);
                        bot.setDynamicProperty("friend_status_" + ownerId, "accepted");
                        try { bot.triggerEvent("minecraft:on_tame"); } catch (e) { /* ignore */ }
                        writeBotSettings(bot, settingsCopy);
                        const nb = new BotBrain(bot);
                        nb.settings = settingsCopy;
                        addEpisode(nb.memory, `I respawned${o?.isValid ? " next to " + o.name : ""} after dying; my inventory was lost`, Date.now());
                        nb.saveMemory();
                        registerBrain(bot.id, nb);
                        nb.request("you just respawned after dying; say something brief about it and carry on");
                        tell(`§a${name} is back`);
                    } catch (e) { console.warn("[AISB] companion respawn setup failed", e); }
                }, 2);
            } catch (e) { console.warn("[AISB] companion respawn failed", e); }
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
        return { enabled: isBrainEnabled(), edition: EDITION, transport: transportInfo(), provider: cfg.provider, model: cfg.model || "(default)", brains: [...allBrains().values()].map(b => b.status()), budget: budget.status(), configProblem: this.configProblem, worldContent: worldContent().counts };
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
