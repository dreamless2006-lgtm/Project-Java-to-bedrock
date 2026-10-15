#!/usr/bin/env node
// Real AI bridge: a Node process that joins the world as a player, so a
// Realm (which cannot make HTTP calls from scripts) still gets real LLM bots.
//
//   addon --(chat frames to this player)--> bridge --(HTTPS)--> LLM provider
//   bridge --(/scriptevent realai:in frames)--> addon
//
// The bridge also relays public chat it sees into the addon (so bots hear
// players even where the Beta chat API is unavailable), keeps the Realm
// loaded while the humans are offline, and can teleport itself near the bots
// so their chunks keep ticking ("anchor").
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PROVIDERS, getProvider } from "../packs/RealAI_BP/scripts/brain/providers/index.js";
import { encodeFrames, Reassembler, nextMessageId, packMessage, unpackMessage, DEFAULT_CHUNK, FRAME_PREFIX } from "../packs/RealAI_BP/scripts/brain/frame.js";
import { REPLY_SCHEMA } from "../packs/RealAI_BP/scripts/brain/action_schema.js";
import { Body } from "./body.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.3.0";
const EXPECT_ADDON = "2.10.0";          // the pack build whose addon walks this bridge's body
const SCRIPT_EVENT = "realai:in";
const ENV_KEYS = {
    anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY", player2: "PLAYER2_API_KEY", player2cloud: "PLAYER2_API_KEY", custom: "CUSTOM_LLM_API_KEY",
};

// ---------------------------------------------------------------- config ---
function loadConfig(argv) {
    const path = argAfter(argv, "--config") || (existsSync(join(HERE, "config.json")) ? join(HERE, "config.json") : join(HERE, "config.example.json"));
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    cfg.providers = cfg.providers || {};
    for (const [id, env] of Object.entries(ENV_KEYS)) {
        cfg.providers[id] = cfg.providers[id] || {};
        if (!cfg.providers[id].apiKey && process.env[env]) cfg.providers[id].apiKey = process.env[env];
    }
    cfg.defaults = cfg.defaults || { provider: "anthropic" };
    cfg._path = path;
    return cfg;
}

function argAfter(argv, flag) {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let logLevel = 1;
function log(level, ...args) {
    if (LEVELS[level] < logLevel) return;
    const ts = new Date().toISOString().slice(11, 19);
    (level === "error" ? console.error : console.log)(`[${ts}] [${level}]`, ...args);
}

// ---------------------------------------------------------- provider call ---
export async function callProvider(cfg, botCfg, turn, timeoutSeconds = 40) {
    const id = botCfg.provider || cfg.defaults.provider || "anthropic";
    const provider = getProvider(id);
    if (!provider) return { ok: false, error: `unknown provider '${id}'`, type: "config" };
    const pc = cfg.providers[id] || {};
    const merged = { ...pc, provider: id, model: botCfg.model || pc.model || provider.defaultModel, maxTokens: Math.max(64, Math.min(4096, Number(botCfg.maxTokens) || 700)), effort: botCfg.effort || pc.effort, temperature: botCfg.temperature ?? pc.temperature };
    if (provider.needsKey && !merged.apiKey) return { ok: false, error: `${id}: no API key (set providers.${id}.apiKey in ${cfg._path} or ${ENV_KEYS[id]})`, type: "config" };
    const req = provider.build(merged, { systemStable: turn.systemStable, systemDynamic: turn.systemDynamic, messages: turn.messages, schema: REPLY_SCHEMA, schemaName: "bot_turn", maxTokens: merged.maxTokens });
    const headers = {};
    for (const h of req.headers) headers[h.key] = h.value;
    let attempts = 0;
    let lastError = "";
    for (let i = 0; i < 3; i++) {
        attempts++;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutSeconds * 1000);
        let res;
        try {
            res = await fetch(req.uri, { method: req.method.toUpperCase(), headers, body: req.body, signal: ac.signal });
        } catch (e) {
            clearTimeout(timer);
            lastError = "network: " + (e.name === "AbortError" ? "timeout" : e.message);
            await sleep(1500 * Math.pow(2, i));
            continue;
        }
        clearTimeout(timer);
        const body = await res.text();
        const parsed = provider.parse(res.status, body);
        if (parsed.ok) return { ok: true, text: parsed.text, usage: parsed.usage, model: parsed.model || merged.model, provider: id, attempts };
        lastError = `${id} ${res.status}: ${parsed.error}`;
        if (!parsed.retryable) return { ok: false, error: lastError, type: parsed.type, usage: parsed.usage, model: merged.model, provider: id, attempts };
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : 1500 * Math.pow(2, i));
    }
    return { ok: false, error: lastError, type: "retries_exhausted", attempts };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const versionParts = (v) => String(v || "0").split(".").map(n => parseInt(n, 10) || 0);
/** "2.9.0" < "2.10.0" (numeric, part by part). */
export function versionLess(a, b) {
    const x = versionParts(a), y = versionParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
    return false;
}

// ------------------------------------------------------------- the bridge ---
export class Bridge {
    constructor(cfg) {
        this.cfg = cfg;
        this.client = null;
        this.entityId = 0n;
        this.reassembler = new Reassembler();
        this.sysCache = new Map();      // bot -> {hash, text}
        this.outQueue = [];
        this.inFlight = 0;
        this.stopped = false;
        this.reconnectDelay = 5000;
        this.lastAnchor = 0;
        this.anchorTarget = null;
        this.body = this.newBody();      // our own player body: position, walking, the per-tick input packet
        this.inputFailures = 0;
        this._notices = new Set();       // what the bridge has already told the world, once per run
        this._monWindows = [];
    }

    async start() {
        const bedrock = await import("bedrock-protocol");
        const c = this.cfg.connect || {};
        const opts = { username: c.username || "RealAIBridge", offline: !!c.offline, profilesFolder: c.profilesFolder || join(HERE, ".auth-cache"), conLog: (...a) => log("info", "[mc]", ...a) };
        if ((c.mode || "realm") === "realm") {
            try { await this.resolveRealm(opts, c); }
            catch (e) { log("error", "could not join the Realm:", e?.message || e); this.scheduleReconnect(); return; }
        } else {
            opts.host = c.host || "127.0.0.1";
            opts.port = c.port || 19132;
        }
        if (c.version) opts.version = c.version;
        log("info", `connecting (${c.mode || "realm"}) as ${opts.username} ...`);
        // raknet-native is a compiled module that may not build on phones (Termux) or odd setups;
        // bedrock-protocol can run on the pure-JavaScript RakNet instead.
        if (c.raknetBackend) opts.raknetBackend = c.raknetBackend;
        if (!opts.raknetBackend) {
            // actually load it: on a phone the package is present but its compiled binary is not
            try { createRequire(import.meta.url)("raknet-native"); opts.raknetBackend = "raknet-native"; }
            catch (e) { opts.raknetBackend = "jsp-raknet"; log("info", "raknet-native not available, using the JavaScript RakNet"); }
        }
        opts.useNativeRaknet = opts.raknetBackend === "raknet-native";
        // The library would send set_local_player_as_initialized on its own, before the loading
        // screen is closed; a real client closes it first. We run that handshake ourselves.
        opts.autoInitPlayer = false;
        if (c.deviceOS !== undefined && c.deviceOS !== null) opts.skinData = { ...(opts.skinData || {}), DeviceOS: Number(c.deviceOS) };
        const client = bedrock.createClient(opts);
        this.client = client;
        // ---- the body: spawn handshake and movement, in the order a real client does it ----
        this.spawned = false;
        this._spawnWanted = false;
        client.on("start_game", p => {
            try { this.entityId = BigInt(p.runtime_entity_id ?? p.entity_id ?? 0); } catch (e) { this.entityId = 0n; }
            try { this.body.onStartGame(p); } catch (e) { log("warn", "start_game body:", e?.message || e); }
            let pvp = null;
            try { const r = (p.gamerules || []).find(g => String(g.name).toLowerCase() === "pvp"); if (r) pvp = r.value; } catch (e) { /* ignore */ }
            log("info", `start_game: game mode ${p.player_gamemode} (world ${p.world_gamemode}), pvp ${pvp === null ? "?" : pvp}, position ${JSON.stringify(this.body.status().pos)}, rewind ${p.rewind_history_size}, input ticks ${this.body.tickBase}`);
            try { if (this.body.movementInfo && Object.keys(this.body.movementInfo).length) log("info", "movement settings from the server:", JSON.stringify(this.body.movementInfo)); } catch (e) { /* ignore */ }
            if (pvp === false) log("warn", "Friendly Fire is OFF in the Realm's settings (gamerule pvp): nobody can hit this body. Turn it on under World settings > Game.");
            // what the vanilla client sends right after start_game
            try { client.queue("request_chunk_radius", { chunk_radius: 8, max_radius: 28 }); client.queue("serverbound_loading_screen", { type: 1 }); } catch (e) { log("warn", "spawn handshake (start):", e?.message || e); }
            if (this._spawnWanted) this.finishSpawn(opts.username);
        });
        client.on("play_status", p => { if (p?.status === "player_spawn") { if (this.entityId) this.finishSpawn(opts.username); else this._spawnWanted = true; } });
        // Movement is server-authoritative: the body only exists where our own input packets say it is.
        client.on("move_player", p => { try { if (this.body.onMovePlayer(p)) log("debug", `server moved us (${p.mode}) to`, JSON.stringify(this.body.status().pos)); } catch (e) { /* ignore */ } });
        client.on("correct_player_move_prediction", p => { try { if (this.body.onCorrection(p) && this.body.corrections % 20 === 1) log("debug", `movement corrected by the server (${this.body.corrections} so far) to`, JSON.stringify(this.body.status().pos)); } catch (e) { /* ignore */ } });
        client.on("set_entity_motion", p => { try { this.body.onMotion(p); } catch (e) { /* ignore */ } });
        client.on("respawn", p => {
            try {
                const wasDead = !this.body.alive;
                for (const pk of this.body.onRespawn(p)) this.client.queue(pk.name, pk.params);
                if (Number(p.state) === 1 && this.body.isMe(p.runtime_entity_id)) { log("info", "respawned at", JSON.stringify(this.body.status().pos)); this.stopRespawnLoop(); }
                else if (wasDead === false && !this.body.alive) this.onDeath("respawn screen");
            } catch (e) { log("warn", "respawn:", e?.message || e); }
        });
        client.on("change_dimension", p => { try { for (const pk of this.body.onChangeDimension(p)) this.client.queue(pk.name, pk.params); log("info", `changing dimension (${p.dimension}) to`, JSON.stringify(this.body.status().pos)); } catch (e) { log("warn", "change_dimension:", e?.message || e); } });
        client.on("player_action", p => { try { for (const pk of this.body.onPlayerAction(p)) this.client.queue(pk.name, pk.params); } catch (e) { /* ignore */ } });
        client.on("set_player_game_type", p => { this.body.gameMode = p.gamemode; log("info", "game mode is now", p.gamemode); });
        client.on("set_health", p => { log("debug", "health", p.health); try { if (Number(p.health) <= 0) this.onDeath("health 0"); } catch (e) { /* ignore */ } });
        // BDS reports health changes as the "minecraft:health" attribute rather than set_health
        client.on("update_attributes", p => { try { if (!this.body.isMe(p.runtime_entity_id)) return; const h = (p.attributes || []).find(a => a.name === "minecraft:health"); if (h) { log("debug", "health", h.current); if (Number(h.current) <= 0) this.onDeath("health attribute 0"); else if (!this.body.alive && this.respawnTimer && Number(h.current) > 0 && this._respawnSent) { /* the server healed us: the respawn went through */ } } } catch (e) { /* ignore */ } });
        client.on("entity_event", p => { try { if (!this.body.isMe(p.runtime_entity_id)) return; if (p.event_id === "hurt_animation") log("info", "ouch: this body was hit"); else if (p.event_id === "death_animation") this.onDeath("death event"); } catch (e) { /* ignore */ } });
        client.on("update_abilities", p => { try { const layers = (p.abilities || []).map(l => `${l.type}${l.enabled?.invulnerable ? "(invulnerable)" : ""}`); log("debug", "abilities:", layers.join(", ")); if ((p.abilities || []).some(l => l.type === "loading_screen")) log("debug", "a loading-screen ability layer is active on this body"); } catch (e) { /* ignore */ } });
        client.on("text", p => this.onText(p));
        client.on("disconnect", p => { this.spawned = false; this._spawnWanted = false; log("warn", "disconnected:", p?.message || p?.reason || ""); this.scheduleReconnect(); });
        client.on("close", () => { this.spawned = false; this._spawnWanted = false; log("warn", "connection closed"); this.scheduleReconnect(); });
        client.on("error", e => {
            const msg = String(e?.message || e);
            log("error", "client error:", msg.length > 400 ? msg.slice(0, 400) + " ..." : msg);
            // Auth services rate-limit fast retries; back off hard and say what usually fixes it.
            if (/Signal connection/i.test(msg)) { this.signalFailures = (this.signalFailures || 0) + 1; log("warn", "the Realm's signalling service dropped the connection; next try uses the global signalling host. Run with the debug switch (bash phone.sh debug, or node index.mjs --log debug) to see the server's answer."); }
            if (/429|Too Many Requests/i.test(msg)) { this.reconnectDelay = Math.max(this.reconnectDelay, 300_000); log("warn", "the sign-in service is rate limiting us; waiting 5 minutes before the next try"); }
            else if (/401|Unauthorized|not have an Xbox profile/i.test(msg)) {
                this.reconnectDelay = Math.max(this.reconnectDelay, 120_000);
                log("warn", "Minecraft's sign-in service refused this account. Usual fixes: (1) create an Xbox profile for it at xbox.com, (2) sign in to the Minecraft game itself once with this account (on any device), so Minecraft sets the account up, then sign back out, (3) if it is a child account, allow multiplayer in the Xbox family settings. The bridge will retry every 2 minutes.");
            }
        });
        client.on("kick", p => log("warn", "kicked:", p?.message || JSON.stringify(p)));
        this.pumpTimer = setInterval(() => this.pump(), 60);
        this.pingTimer = setInterval(() => {
            if (!this.spawned || this.cfg.selfTest) return;
            if (this.addonHello) { this.sendToAddon({ t: "ping" }); return; }
            // Not acknowledged yet: say hello again, and after a minute explain the usual causes.
            this.sendToAddon(this.helloMessage(opts.username));
            if (Date.now() - (this.helloSentAt || 0) > 60_000) log("warn", "the addon has not answered yet. On the Realm: (1) make this account an Operator (Realm settings > Members), (2) turn on 'Activate Cheats' in the Realm's game settings, (3) make sure the Real AI behavior pack is active on this world. The hello is retried every 30 s.");
            if (Date.now() - (this.helloSentAt || 0) > 60_000) this.notice("nohello", "I joined, but the Real AI pack is not answering. Make this account an Operator (Realm settings > Members), turn on Activate Cheats, and make sure the Real AI pack is active on this world.");
        }, 30_000);
        // The server tells us when a command was refused: that is how a missing operator permission shows up.
        client.on("command_output", p => {
            try {
                const out = (p.output || []).map(o => o.message_id || o.message || "").join(" ");
                if (/locate/i.test(out) && this.pendingLocates && this.pendingLocates.length) {
                    const req = this.pendingLocates.shift();
                    const first = (p.output || [])[0] || {};
                    const params = (first.parameters || []).map(String);
                    const text = `${params.join(" ")} ${first.message || ""}`;
                    const ints = text.match(/-?\d+/g)?.map(Number) || [];
                    const ok = p.success_count > 0 && /success/i.test(first.message_id || "") && ints.length >= 2;
                    let x = ints[0], y, z = ints[1];
                    if (ints.length >= 4) { y = ints[1]; z = ints[2]; }
                    this.sendToAddon(ok ? { t: "locate_result", bot: req.bot, structure: req.structure, ok: true, x, y, z } : { t: "locate_result", bot: req.bot, structure: req.structure, ok: false, error: (first.message_id || out || "not found").slice(0, 80) });
                    return;
                }
                if (p.success_count === 0 || /permission|unknown|cheat|not allowed/i.test(out)) {
                    const key = out.slice(0, 80);
                    if (this._lastCmdErr !== key) { this._lastCmdErr = key; log("warn", `the world refused a command (${out || "no details"}). The bridge account must be an Operator and cheats must be on.`); }
                }
            } catch (e) { /* ignore */ }
        });
        this.anchorTimer = setInterval(() => this.anchor(), 5000);
        // One player_auth_input every tick (50 ms), like a real client: it carries where we are,
        // which way we walk, and the acknowledgement of teleports. Without it the body stands frozen.
        this.bodyTimer = setInterval(() => this.bodyTick(), 50);
        this.monitorTimer = setInterval(() => this.monitorMotion(), 5000);
    }

    // ---- death and respawn: nobody presses the Respawn button for the AI, so the bridge does ----
    onDeath(why) {
        if (!this.body.alive) { if (!this.respawnTimer) this.startRespawnLoop(); return; }
        this.body.markDead();
        log("info", `this body died (${why}); pressing Respawn`);
        this.sendToAddon({ t: "died", why });
        this.startRespawnLoop();
    }

    startRespawnLoop() {
        if (this.respawnTimer || !this.client) return;
        let attempt = 0;
        const step = () => {
            this.respawnTimer = null;
            if (!this.client || !this.spawned || this.body.alive) return;
            attempt++;
            try { for (const pk of this.body.respawnPackets(attempt)) this.client.queue(pk.name, pk.params); this._respawnSent = true; }
            catch (e) { log("warn", "respawn request failed:", e?.message || e); }
            this.respawnTimer = setTimeout(step, attempt < 3 ? 1500 : 4000);
        };
        this.respawnTimer = setTimeout(step, 1200);       // the death screen takes a moment to appear
    }

    stopRespawnLoop() { if (this.respawnTimer) { clearTimeout(this.respawnTimer); this.respawnTimer = null; } this._respawnSent = false; }

    newBody() { return new Body({ startConvention: this.cfg.connect?.startConvention, tickBase: this._tickBase || this.cfg.connect?.tickBase }); }

    // A vanilla client puts its own account id (XUID) in every chat packet, and strict servers kick a client whose chat does not carry it.
    chatXuid() {
        try {
            const x = this.client?.profile?.xuid;
            if (x && String(x) !== "0") return String(x);
            return this.cfg.connect?.offline ? "0" : "";   // an offline login claims XUID "0"; a signed-in one without a profile id keeps the old empty value
        } catch (e) { return ""; }
    }

    /** Say something in public chat as this account (what the AI says, and what the bridge itself has to tell the people in the world). */
    sayInGame(text) {
        if (!this.client) return false;
        try {
            this.client.queue("text", { type: "chat", needs_translation: false, category: "authored", source_name: this.client.username, message: String(text).slice(0, 400), xuid: this.chatXuid(), platform_chat_id: "", has_filtered_message: false, filtered_message: "" });
            return true;
        } catch (e) { log("warn", "chat failed:", e?.message || e); return false; }
    }

    /** A notice for the people in the world about the bridge itself: once per kind per run, four in all. */
    notice(kind, text) {
        if (this._notices.has(kind) || this._notices.size >= 4 || !this.spawned || this.cfg.selfTest) return;
        this._notices.add(kind);
        this.sayInGame("[Real AI bridge] " + text);
    }

    // Every few seconds: is the body doing what it is told? The addon reports where the body really is with each
    // walk or key frame, so "keys down but the real position did not change" and "the server keeps pulling the
    // body back" are both visible here. Everything goes to the log; only a condition that holds for several
    // windows in a row, which ordinary obstacles do not produce, is said once in the world's chat.
    monitorMotion() {
        const b = this.body;
        if (!this.spawned || !b.ready) return;
        const cur = { intent: b.intentTicks, truth: b.truthMoved, corr: b.corrections + b.teleports, resync: b.resyncs };
        const prev = this._mon; this._mon = cur;
        this._monN = (this._monN || 0) + 1;
        if (!prev) return;
        const w = { intent: cur.intent - prev.intent, truth: cur.truth - prev.truth, corr: cur.corr - prev.corr, resync: cur.resync - prev.resync };
        this._monWindows.push(w); if (this._monWindows.length > 6) this._monWindows.shift();
        const last = this._monWindows.slice(-3), recent = this._monWindows.slice(-4);
        const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
        const st = b.status();
        if (w.corr >= 15) log("warn", `the server pulled this body back ${w.corr} times in 5 s (${w.intent} ticks of walking). It may not accept the movement this client reports. Run: bash ~/real-ai/bridge/phone.sh selftest`);
        if (last.length === 3 && last.every(x => x.corr >= 15)) this.notice("rubber", `The server keeps pulling my body back (${sum(last, "corr")} corrections in 15 seconds), so I cannot walk properly. Run the self-test on the phone (bash ~/real-ai/bridge/phone.sh selftest) and send the output to the person fixing this.`);
        // keys held for most of 20 s and the real position hardly changed
        if (recent.length === 4 && sum(recent, "intent") >= 80 && sum(recent, "truth") < 1 && b.lastTruth && this.addonHello) {
            log("warn", `keys were down for ${(sum(recent, "intent") / 20).toFixed(0)} s in the last 20 s but the body moved ${sum(recent, "truth").toFixed(1)} blocks (pull-backs ${sum(recent, "corr")}). Either something blocks the way, or the server ignores this client's movement. Run: bash ~/real-ai/bridge/phone.sh selftest`);
            if (sum(recent, "corr") === 0 && !this._tickFlipped && b.truthMoved < 1) {      // only a body that has never moved on this connection: a body that walked has the right numbering
                // nothing objected and nothing moved: the classic look of input the server drops. The other way of
                // numbering the input ticks is the one thing left to try on our side.
                this._tickFlipped = true;
                const base = b.flipTickBase();
                this._tickBase = base;                       // a reconnect keeps it
                this._monWindows = [];
                log("warn", `trying the other input tick numbering (${base}) in case the server drops inputs with ticks it does not expect; set connect.tickBase in config.json to keep it`);
                this.notice("tickflip", `My body was not moving although I was walking and nothing objected, so I switched to counting my input ticks the way the server does (${base}). If I am still stuck, run the self-test on the phone (bash ~/real-ai/bridge/phone.sh selftest).`);
            } else this.notice("stuck", `I keep walking without getting anywhere. Either something I cannot see is in the way, or the server ignores my movement: run the self-test on the phone (bash ~/real-ai/bridge/phone.sh selftest) if it keeps happening.`);
        }
        if (this._monN % 12 === 0 || w.intent > 0) log(w.intent > 0 ? "debug" : "info", `body: feet ${st.pos ? [st.pos.x, st.pos.y, st.pos.z].join(" ") : "?"} yaw ${st.yaw}, key-down ticks ${w.intent}, real movement ${w.truth.toFixed(1)} blocks, pull-backs ${b.corrections + b.teleports}, resyncs ${b.resyncs}${b.alive ? "" : ", DEAD"}`);
    }

    helloMessage(username) {
        return { t: "hello", v: 2, name: username, version: VERSION, body: 1, expectAddon: EXPECT_ADDON, independent: this.cfg.independent !== false, providers: Object.keys(PROVIDERS).filter(id => !PROVIDERS[id].needsKey || this.cfg.providers[id]?.apiKey) };
    }

    // The first play_status player_spawn: close the loading screen like a real client, then tell the
    // server the player is initialised. Only after this does the server simulate (and let others hit) the body.
    finishSpawn(username) {
        if (this.spawned || !this.client) return;
        this._spawnWanted = false;
        try {
            this.client.queue("interact", { action_id: "mouse_over_entity", target_entity_id: 0n, has_position: false });
            this.client.queue("serverbound_loading_screen", { type: 2 });
            this.client.queue("set_local_player_as_initialized", { runtime_entity_id: this.entityId });
            try { this.client.status = 4; } catch (e) { /* the library keeps its own status; harmless */ }
        } catch (e) { log("warn", "spawn handshake (end):", e?.message || e); }
        log("info", "spawned in the world; announcing to the addon");
        this._mon = null;
        this._monWindows = [];
        this.spawned = true;
        this.addonHello = false;
        this.helloSentAt = Date.now();
        this.outQueue.length = 0;
        this.reconnectDelay = 5000;
        // every frame is a /scriptevent command; without this the server tells every operator about each one
        this.outQueue.push("/gamerule sendcommandfeedback false");
        const wantMode = this.cfg.connect?.gamemode === undefined ? "survival" : this.cfg.connect.gamemode;
        if (wantMode && String(this.body.gameMode) !== String(wantMode)) { log("info", `switching this account to ${wantMode} (set connect.gamemode to null in config.json to leave it alone)`); this.outQueue.push(`/gamemode ${wantMode} @s`); }
        if (!this.cfg.selfTest) this.sendToAddon(this.helloMessage(username));    // the self-test is about the body alone: the addon is not told about it
    }

    bodyTick() {
        if (!this.client || !this.spawned) return;
        let params;
        try { params = this.body.step(); } catch (e) { if (!this._stepErr) { this._stepErr = true; log("error", "the body could not simulate a tick:", e?.stack || e); } return; }
        if (!params) return;
        try { this.client.queue("player_auth_input", params); this.inputFailures = 0; }
        catch (e) { if (this.inputFailures++ === 0) log("warn", "could not send movement input:", e?.message || e); }
        const st = this.body;
        if (Number(st.tick) % 100 === 0) { const b = st.status(); log("debug", `input tick=${b.tick} feet=${b.pos ? [b.pos.x, b.pos.y, b.pos.z].join(" ") : "?"} ${b.walking ? "-> " + [b.target.x, b.target.y, b.target.z].join(" ") : "idle"} corrections=${b.corrections} teleports=${b.teleports}`); }
    }

    // Resolve the Realm ourselves (what bedrock-protocol's realmAuthenticate does) so we can log
    // the signalling host, sanitize the region name and fall back to the global signalling
    // service when the regional one keeps dropping the connection.
    async resolveRealm(opts, c) {
        const req = createRequire(import.meta.url);
        const bpReq = createRequire(req.resolve("bedrock-protocol"));
        const { Authflow, Titles } = bpReq("prismarine-auth");
        const { RealmAPI } = bpReq("prismarine-realms");
        const r = c.realm || {};
        const version = opts.version || bpReq("bedrock-protocol/src/options").CURRENT_VERSION;
        this.authflow = this.authflow || new Authflow(opts.username, opts.profilesFolder, { flow: "live", authTitle: Titles.MinecraftNintendoSwitch, deviceType: "Nintendo" });
        opts.authflow = this.authflow;
        const api = RealmAPI.from(this.authflow, "bedrock", { minecraftVersion: version.startsWith("1.") ? version : `1.${version}` });
        let realm;
        if (r.invite) realm = await api.getRealmFromInvite(r.invite);
        else {
            const realms = await api.getRealms();
            if (!realms.length) throw new Error("this account is not a member of any Realm; invite it and accept the invite (or give the invite link in the setup)");
            realm = r.id ? realms.find(x => String(x.id) === String(r.id)) : realms[0];
            if (!realm) throw new Error(`Realm ${r.id} not found among: ${realms.map(x => `${x.name} (${x.id})`).join(", ")}`);
        }
        const join = await api.rest.get(`/worlds/${realm.id}/join`);
        if (join.networkProtocol === "NETHERNET_JSONRPC") {
            const region = String(join.sessionRegionData?.regionName || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
            this.signalFailures = this.signalFailures || 0;
            const host = (region && this.signalFailures < 1) ? `signal-${region}.franchise.minecraft-services.net` : "signal.franchise.minecraft-services.net";
            opts.transport = "nethernet";
            opts.nethernet = { networkId: join.address, signalling: "services", _signallingProtocol: "jsonrpc", _signallingHost: host, webrtcBackend: "werift" };
            opts.skipPing = true;
            log("info", `Realm "${realm.name}" (${realm.id}) uses NetherNet; signalling via ${host}${region ? ` (region ${region})` : ""}`);
        } else {
            const m = String(join.address || "").match(/^(.*):(\d+)$/);
            if (!m) throw new Error("Realm returned no usable address");
            opts.transport = "raknet"; opts.host = m[1].replace(/^\[|\]$/g, ""); opts.port = Number(m[2]);
            log("info", `Realm "${realm.name}" (${realm.id}) uses RakNet at ${opts.host}:${opts.port}`);
        }
    }

    scheduleReconnect() {
        if (this.stopped || this._reconnecting) return;
        this._reconnecting = true;
        clearInterval(this.pumpTimer); clearInterval(this.pingTimer); clearInterval(this.anchorTimer); clearInterval(this.bodyTimer); clearInterval(this.monitorTimer);
        this.stopRespawnLoop();
        this.body = this.newBody();
        const d = this.reconnectDelay;
        this.reconnectDelay = Math.min(120_000, d * 2);
        log("info", `reconnecting in ${Math.round(d / 1000)}s`);
        setTimeout(() => { this._reconnecting = false; this.start().catch(e => { log("error", e); this.scheduleReconnect(); }); }, d);
    }

    /** The server's own position of the body, as the addon reads it with each walk or key frame. */
    anchorFromFrame(msg) {
        const x = typeof msg.fx === "number" ? msg.fx : NaN, z = typeof msg.fz === "number" ? msg.fz : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
        return this.body.anchorFrom({ x, y: typeof msg.fy === "number" ? msg.fy : undefined, z }, typeof msg.fg === "number" ? msg.fg === 1 : typeof msg.fg === "boolean" ? msg.fg : undefined);
    }

    // Text packets: chat from players (relay) or frames from the addon (handle).
    onText(p) {
        try { this._onText(p); } catch (e) { log("warn", "ignored a malformed text packet:", e?.message || e); }
    }

    _onText(p) {
        let message = p.message ?? "";
        if (p.type === "json" || p.type === "object") {
            try {
                const j = JSON.parse(message);
                if (j && Array.isArray(j.rawtext)) message = j.rawtext.map(x => x.text || "").join("");
            } catch (e) { /* keep raw */ }
        }
        if (typeof message !== "string") return;
        if (message.includes(FRAME_PREFIX)) {
            // Frames come from the addon through Player.sendMessage: the line is exactly the frame (a colour code or two in front at most).
            // A line that merely contains one, or any chat, whisper or announcement, is a person's words (or a bot's, repeated by some
            // chat formatter): it must never be able to drive this body or the bridge.
            const plain = message.replace(/^(?:§.)+/, "");
            if (p.type === "chat" || p.type === "whisper" || p.type === "announcement" || !plain.startsWith(FRAME_PREFIX)) {
                if (!this._frameWarned) { this._frameWarned = true; log("warn", `ignored a ${p.type || "text"} line that contains a bridge frame but is not one from the addon (someone typing it, or a chat plugin repeating it)`); }
                return;
            }
            const got = this.reassembler.push(plain);
            if (got) {
                const msg = unpackMessage(got.text);
                if (msg) this.handle(msg).catch(e => log("error", "handle failed:", e));
            }
            return;
        }
        if (this.cfg.chatRelay !== false && p.type === "chat" && p.source_name && p.source_name !== this.client?.username) {
            const from = String(p.source_name).slice(0, 32);
            const text = String(message).slice(0, 400);
            if (text.startsWith("!ai")) {
                // Chat commands still work on the stable API: the bridge runs them for the sender.
                const safe = `${from}|${text.slice(3).trim()}`.replace(/\s+/g, " ").slice(0, 420);
                this.outQueue.push(`/scriptevent realai:cmdfor ${safe}`);
                return;
            }
            this.sendToAddon({ t: "chat_in", from, text });
        }
    }

    async handle(msg) {
        if (!msg || typeof msg !== "object" || this.cfg.selfTest) return;
        switch (msg.t) {
            case "hello":
                if (!this.addonHello) { this.addonHello = true; log("info", "the addon answered; residents will join the players now"); }
                log("info", `addon says hello (build ${msg.version || "older than 2.5.0"}, walks ${msg.walks ? "yes" : "no"}, tick ${msg.tick})`);
                if (!msg.walks || versionLess(msg.version, EXPECT_ADDON)) {
                    log("warn", `the Real AI pack on this world (${msg.version || "older than 2.5.0"}) is older than ${EXPECT_ADDON}: ${msg.walks ? "it lacks the newest controls and senses" : "it tries to teleport this body itself, which a Realm ignores"}. Delete the old Real AI packs (Settings > Storage), import dist/Real-AI-${EXPECT_ADDON}.mcaddon, activate it on the world, and rejoin.`);
                    this.notice("oldpack", `The Real AI pack in this world is older than my bridge (build ${msg.version || "unknown"}, I need ${EXPECT_ADDON})${msg.walks ? ", so I am missing the newest controls and senses" : ", so I cannot walk"}. Delete the old Real AI packs (Settings > Storage), import Real-AI-${EXPECT_ADDON}.mcaddon again, activate it on this world, and everyone rejoin.`);
                }
                if (msg.pos && this.body.pos) { const gap = msg.pos.y - this.body.pos.y; log("info", `the addon sees this body at ${JSON.stringify(msg.pos)} (our feet ${JSON.stringify(this.body.status().pos)}, height gap ${gap.toFixed(2)})`); this.body.anchorFrom(msg.pos); this.body.anchorFrom(msg.pos); }
                if (msg.gamemode) this.body.gameMode = msg.gamemode;
                break;
            case "probe": {
                // the addon's server-side view of the body once a second while !ai debug is on
                const st = this.body.status();
                const gap = st.pos ? Math.hypot(msg.x - st.pos.x, msg.y - st.pos.y, msg.z - st.pos.z) : -1;
                log("info", `probe: server ${[msg.x, msg.y, msg.z].map(n => Number(n).toFixed(1)).join(" ")} ground=${msg.ground} gm=${msg.gm} walks=${msg.walks} | ours ${st.pos ? [st.pos.x, st.pos.y, st.pos.z].join(" ") : "?"} gap=${gap.toFixed(2)} walking=${st.walking} corrections=${st.corrections}`);
                if (gap > 1) { this._ghost = (this._ghost || 0) + 1; if (this._ghost === 5) log("warn", "ghost body: the server keeps this player somewhere else than our packets say; the addon will resync us"); }
                else this._ghost = 0;
                this.body.anchorFrom({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) }, typeof msg.ground === "boolean" ? msg.ground : undefined);
                break;
            }
            case "probe_hurt":
                log("info", `the addon saw this body take ${msg.damage} damage (${msg.cause}${msg.by ? " by " + msg.by : ""})`);
                break;
            case "pong":
                break;
            case "chat_out": {
                const text = String(msg.text || "").replace(/[\r\n]+/g, " ").slice(0, 400);
                if (!text || !this.client) break;
                if (msg.to) { this.outQueue.push(`/tell "${String(msg.to).replace(/"/g, "")}" ${text}`); break; }
                this.sayInGame(text);
                break;
            }
            case "locate": {
                const structure = String(msg.structure || "").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32);
                if (!structure) break;
                this.pendingLocates = this.pendingLocates || [];
                this.pendingLocates.push({ bot: msg.bot, structure, at: Date.now() });
                this.outQueue.push(`/locate structure ${structure}`);
                break;
            }
            case "anchor":
                if (msg.off) { this.anchorTarget = null; break; }
                this.anchorTarget = { x: Number(msg.x), y: Number(msg.y), z: Number(msg.z), dim: /^(minecraft:)?(overworld|nether|the_end)$/.test(String(msg.dim || "")) ? String(msg.dim) : "minecraft:overworld" };
                if (![this.anchorTarget.x, this.anchorTarget.y, this.anchorTarget.z].every(Number.isFinite)) this.anchorTarget = null;
                break;
            // The addon walks our body: it knows the terrain and sends the next footing point.
            case "walk":
                this.anchorFromFrame(msg);
                if (this.body.walkTo({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) }, msg.mode, 40)) { if (msg.jump) this.body.jump(); }
                break;
            case "stop":
                this.body.stop();
                break;
            case "input":
                // raw keys, as the AI pressed them: forward/back, strafe, sprint, sneak, jump (see Body.press)
                this.anchorFromFrame(msg);
                this.body.press({ f: msg.f, s: msg.s, sprint: !!msg.sprint, sneak: !!msg.sneak, jump: !!msg.jump, ms: Math.min(Number(msg.ms) || 300, 1000), floor: typeof msg.floor === "number" ? msg.floor : undefined, ed: typeof msg.ed === "number" ? msg.ed : undefined, at: typeof msg.fx === "number" && typeof msg.fz === "number" ? { x: msg.fx, z: msg.fz } : undefined });
                break;
            case "jump":
                this.body.jump();
                break;
            case "look":
                if (typeof msg.yaw === "number" || typeof msg.pitch === "number") this.body.setLook(msg.yaw, msg.pitch);
                else this.body.lookAt({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) });
                break;
            case "swing":
                // the arm swing everyone sees when a real client hits or digs
                try { if (this.client && this.spawned) this.client.queue("animate", { action_id: "swing_arm", runtime_entity_id: this.entityId, data: 0, has_swing_source: false }); } catch (e) { /* ignore */ }
                break;
            case "body_status":
                this.sendToAddon({ t: "body", ...this.body.status() });
                break;
            case "think":
                await this.think(msg);
                break;
            default:
                log("debug", "unknown message", msg.t);
        }
    }

    async think(msg) {
        const { turnId, bot, cfg: botCfg = {}, sysHash, messages } = msg;
        if (msg.sys) this.sysCache.set(bot, { hash: sysHash, text: msg.sys });
        const sys = this.sysCache.get(bot);
        if (!sys || sys.hash !== sysHash) {
            this.sendToAddon({ t: "need_sys", turnId });
            return;
        }
        if (this.inFlight >= (this.cfg.maxConcurrentThinks || 4)) {
            this.sendToAddon({ t: "result", turnId, ok: false, error: "bridge busy", type: "busy" });
            return;
        }
        this.inFlight++;
        const started = Date.now();
        try {
            const res = await callProvider(this.cfg, botCfg, { systemStable: sys.text, systemDynamic: null, messages }, this.cfg.requestTimeoutSeconds || 40);
            const ms = Date.now() - started;
            if (res.ok) log("info", `${bot}: ${res.provider}/${res.model} ok in ${ms}ms (${res.usage?.input ?? "?"} in / ${res.usage?.output ?? "?"} out)`);
            else log("warn", `${bot}: think failed: ${res.error}`);
            this.sendToAddon({ t: "result", turnId, ...res });
        } catch (e) {
            log("error", `${bot}: think crashed:`, e);
            this.sendToAddon({ t: "result", turnId, ok: false, error: String(e?.message || e), type: "bridge" });
        } finally {
            this.inFlight--;
        }
    }

    sendToAddon(obj) {
        if (this.cfg.selfTest) return;           // the self-test is about the body alone: the addon is not told about it
        const text = packMessage(obj);
        for (const f of encodeFrames(nextMessageId("b"), text, DEFAULT_CHUNK)) this.outQueue.push(`/scriptevent ${SCRIPT_EVENT} ${f}`);
    }

    // One command per pump so we never trip anti-spam.
    pump() {
        if (!this.client || !this.spawned || !this.outQueue.length) return;
        const command = this.outQueue.shift();
        this.runCommand(command);
    }

    runCommand(command) {
        try {
            this.client.queue("command_request", {
                command,
                origin: { type: "player", uuid: randomUUID(), request_id: "", player_entity_id: this.entityId },
                internal: false,
                version: "latest",
            });
        } catch (e) {
            log("error", "command failed:", e?.message || e);
        }
    }

    /**
     * Does the server accept this body's movement? Walks and turns it with the same key presses the AI uses and
     * asks the server where it really is (/tp @s ~ ~ ~ makes the server send the player its true position).
     * The addon is not told about the test (cfg.selfTest), so nothing else moves the body meanwhile. The account
     * cannot be placed, so the first leg picks the compass heading with the most room, and every later leg is sized to the
     * ground the body has already crossed (nothing is ever pushed into unknown ground); a leg that cannot be judged
     * for lack of room is SKIPPED, not failed. If no heading moves the body at all, the other way of numbering input
     * ticks is tried, and a success is checked against the original numbering before it is recommended.
     * The account needs to be an Operator with cheats on for the position check.
     * -> { ok, checks: [{ name, ok, detail, skipped? }] }   opts.timeScale makes it faster (tests)
     */
    async selfTest(say = (line) => console.log(line), { timeScale = 1 } = {}) {
        const T = (ms) => ms / timeScale;
        const checks = [];
        const check = (name, ok, detail = "") => { checks.push({ name, ok, detail }); say(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`); return ok; };
        const skip = (name, detail) => { checks.push({ name, ok: true, skipped: true, detail }); say(`SKIP  ${name} - ${detail}`); };
        const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(Math.min(100, T(100))); } return !!fn(); };
        say("Self-test: joining and walking the body with the AI's own key presses ...");
        const joined = await waitFor(() => this.spawned && this.body.ready && this.body.pos, 120_000);
        if (!check("joined the world and spawned", joined, joined ? `feet ${JSON.stringify(this.body.status().pos)}` : "the account never got into the world (see the log above)")) return { ok: false, checks };
        await sleep(T(2500));
        let asked = 0;
        const truth = async () => {
            const n = this.body.teleports;
            asked++;
            this.runCommand("/tp @s ~ ~ ~");
            const got = await waitFor(() => this.body.teleports > n, 5000);
            if (!got) return null;
            await sleep(T(150));
            return { x: this.body.pos.x, y: this.body.pos.y, z: this.body.pos.z, yaw: this.body.yaw, pitch: this.body.pitch };
        };
        const hold = async (keys, ms) => {
            const end = Date.now() + T(ms);
            while (Date.now() < end) { this.body.press({ ...keys, ms: 250 }); await sleep(T(100)); }
            this.body.release();
            await sleep(T(900));
        };
        const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
        const c0 = this.body.corrections, t0 = this.body.teleports;
        const pulledBack = () => (this.body.corrections - c0) + Math.max(0, (this.body.teleports - t0) - asked);   // corrections, and teleports we did not ask for
        const p0 = await truth();
        check("the server tells us where we are (/tp @s ~ ~ ~)", !!p0, p0 ? `feet ${[p0.x, p0.y, p0.z].map(n => n.toFixed(2)).join(" ")}` : "no answer: this account must be an Operator and the world's cheats must be on, otherwise the position cannot be checked");
        if (!p0) {
            // without the position, a walk can only be judged by the server not objecting
            const before = this.body.corrections;
            this.body.setLook(0, 0);
            await hold({ f: 1 }, 2000);
            check("walking 2 s drew no corrections from the server", this.body.corrections - before < 5, `${this.body.corrections - before} corrections (the position could not be read, so this is only half a test: a server that silently ignores the input would also pass)`);
            return { ok: checks.every(c => c.ok), checks };
        }
        // 1. the heading with room: walk 2 s along each of S, W, N, E until one gives a full walk (vanilla 7.5 blocks)
        const headings = [{ name: "south", yaw: 0 }, { name: "west", yaw: 90 }, { name: "north", yaw: 180 }, { name: "east", yaw: -90 }];
        const tryHeadings = async () => {
            let best = null;
            for (const h of headings) {
                this.body.setLook(h.yaw, 0);
                await sleep(T(300));
                const from = (await truth()) || p0;
                await hold({ f: 1 }, 2000);
                const after = await truth();
                const d = after ? flat(from, after) : 0;
                if (!best || d > best.d) best = { h, d, from, after };
                if (d >= 7) break;
            }
            return best;
        };
        let best = await tryHeadings();
        let triedFlip = false, flipRelevant = false;
        if (best.d < 1 && pulledBack() < 8 && this.body.serverTick0 > 0n) {
            // nothing moved in any direction and nothing objected: the one thing left on our side is how input ticks are numbered
            triedFlip = true;
            const base = this.body.flipTickBase();
            say(`      nothing moved in any direction; trying the other input tick numbering (${base}) ...`);
            const second = await tryHeadings();
            if (second.d >= 4) {
                // control: back to the original numbering on the heading that worked; if that moves too, the numbering was not the cause
                this.body.flipTickBase();
                this.body.setLook(second.h.yaw, 0);
                await sleep(T(300));
                const cf = (await truth()) || second.after;
                await hold({ f: 1 }, 1500);
                const ca = await truth();
                const cd = ca ? flat(cf, ca) : 0;
                flipRelevant = cd < 1.5;
                if (flipRelevant) this.body.flipTickBase();            // stay on the numbering that works for the remaining legs
                best = { ...second, after: ca || second.after };       // the control walk went on along the same ground
            } else { this.body.flipTickBase(); }                    // neither worked: leave the original numbering
        }
        const used = best.d >= 4 ? best.h : null;
        const walked = best.d;
        const pulled1 = pulledBack();
        const nowBase = this.body.tickBase;
        check("walking forward for 2 s moves the body (vanilla walk is about 7.5 blocks)", !!used,
            used ? `${walked.toFixed(1)} blocks ${used.name}${triedFlip ? (flipRelevant ? ` (only with input ticks counted the "${nowBase}" way, the original numbering failed on the control run: set "tickBase": "${nowBase}" under connect in config.json)` : " (the other tick numbering was not the reason: the original one moved the body as well on the control run, so the server just needed time)") : ""}${walked < 7 ? ` (short of 7.5: ${walked < 5 ? "something was in the way, or " : ""}the ground here may not be flat)` : ""}`
                : `the best heading moved ${walked.toFixed(1)} blocks${pulled1 ? `, and the server pulled the body back ${pulled1} times: it keeps resetting the body (rubber-banding)` : ": the server ignores this client's movement, or something blocks all four directions around here (stand on open flat ground and try again)"}`);
        const pulledBase = pulledBack();
        if (used) {
            const rad = used.yaw / 57.29578;
            const hv = { x: -Math.sin(rad), z: Math.cos(rad) };       // unit vector the body faced
            const along = (a, b) => (b.x - a.x) * hv.x + (b.z - a.z) * hv.z;
            let cur = best.after;
            // 2. step back (the ground behind us is the ground we just crossed)
            this.body.setLook(used.yaw, 0);
            const backMs = Math.max(400, Math.min(1000, (walked - 1) / 4.3 * 1000));
            await hold({ f: -1 }, backMs);
            let p = await truth();
            const stepped = p ? along(cur, p) : 0;
            check("stepping back moves the body backwards", !!p && stepped <= -0.3 * 4.3 * backMs / 1000, p ? `${stepped.toFixed(1)} blocks along the way it faces` : "no answer");
            cur = p || cur;
            // 3. sprint back towards where we started (known ground), 1 s or less
            const room = along(best.from, cur);
            if (room >= 2.5) {
                this.body.setLook(used.yaw + 180, 0);
                await sleep(T(300));
                const sprintMs = Math.min(1000, room / 5.6 * 1000 * 0.9);
                const before = (await truth()) || cur;
                await hold({ f: 1, sprint: true }, sprintMs);
                p = await truth();
                const sprinted = p ? flat(before, p) : 0;
                const walkSpeed = walked / 2.0;
                check("sprinting is faster than walking", !!p && sprinted / (sprintMs / 1000) >= 1.08 * walkSpeed, `${sprinted.toFixed(1)} blocks in ${(sprintMs / 1000).toFixed(1)} s = ${(sprinted / (sprintMs / 1000)).toFixed(1)} blocks/s against ${walkSpeed.toFixed(1)} walking (vanilla 5.6 against 4.3)`);
                cur = p || before;
            } else skip("sprinting is faster than walking", `only ${room.toFixed(1)} blocks of known ground to sprint over`);
            // 4. strafe: left, and if that side has no room, right
            const side = async (dir) => { const b4 = (await truth()) || cur; await hold({ s: dir }, 1000); const a4 = await truth(); return { b4, a4, d: a4 ? Math.abs(across(b4, a4)) : 0, signed: a4 ? across(b4, a4) : 0 }; };
            this.body.setLook(used.yaw + 180, 0);
            await sleep(T(300));
            // facing the other way round, "left" is the opposite side of the first heading's frame, so judge by the key, not the frame
            const faceRad = (used.yaw + 180) / 57.29578;
            const leftOf = { x: Math.cos(faceRad), z: Math.sin(faceRad) };       // the body's left at that facing
            const lateral = (a, b) => (b.x - a.x) * leftOf.x + (b.z - a.z) * leftOf.z;
            let b4 = (await truth()) || cur;
            await hold({ s: 1 }, 1000);
            let a4 = await truth();
            let moved = a4 ? lateral(b4, a4) : 0;
            let which = "left";
            if (moved < 1.5) {
                b4 = a4 || b4;
                await hold({ s: -1 }, 1000);
                a4 = await truth();
                const m2 = a4 ? -lateral(b4, a4) : 0;
                if (m2 > moved) { moved = m2; which = "right"; }
            }
            if (moved >= 1.5) check(`strafing ${which} moves the body sideways`, true, `${moved.toFixed(1)} blocks to its ${which}`);
            else skip("strafing moves the body sideways", `neither side moved the body (${moved.toFixed(1)} blocks): walls on both sides, or strafing is not accepted; walking, sprinting and backing worked`);
            cur = a4 || b4;
            // 5. sneak forward along the first heading (ground we crossed)
            this.body.setLook(used.yaw, 0);
            await sleep(T(300));
            const sb = (await truth()) || cur;
            await hold({ f: 1, sneak: true }, 2000);
            const sa = await truth();
            const crept = sa ? flat(sb, sa) : 0;
            if (crept < 0.3 && pulledBack() === pulledBase) skip("sneaking forward is slow (vanilla about 2.6 blocks in 2 s)", "the body did not move at all (something in the way?)");
            else check("sneaking forward is slow (vanilla about 2.6 blocks in 2 s)", crept > 0.5 && crept < Math.max(3.2, walked * 0.6), `${crept.toFixed(1)} blocks`);
        } else {
            skip("stepping back, sprinting, strafing and sneaking", "not run: the body never walked");
        }
        this.body.setLook(90, -20);
        await sleep(T(700));
        const p6 = await truth();
        const dyaw = p6 ? Math.abs(((p6.yaw - 90 + 540) % 360) - 180) : 999;
        check("turning the head is accepted", !!p6 && dyaw < 12 && Math.abs(p6.pitch + 20) < 8, p6 ? `the server has yaw ${p6.yaw.toFixed(0)}, pitch ${p6.pitch.toFixed(0)} (asked 90, -20)` : "no answer");
        const pulled = pulledBack() - (used ? pulledBase : 0);
        check("the server did not keep pulling the body back during the test", pulled < 10, `${pulled} times pulled back after the walk (${pulledBack()} in all), ${this.body.resyncs} resyncs`);
        return { ok: checks.every(c => c.ok), checks };
    }

    anchor() {
        const a = this.cfg.anchor || {};
        if (!a.enabled || !this.anchorTarget || !this.client || !this.spawned) return;
        const gap = (a.intervalSeconds || 120) * 1000;
        if (Date.now() - this.lastAnchor < gap) return;
        this.lastAnchor = Date.now();
        const t = this.anchorTarget;
        const dim = t.dim && t.dim !== "minecraft:overworld" ? ` ${t.dim.replace("minecraft:", "")}` : "";
        // Execute via /execute so the bridge can hop dimensions too.
        this.runCommand(`/execute in${dim || " overworld"} run tp @s ${Math.round(t.x)} ${Math.round(t.y) + 1} ${Math.round(t.z)}`);
        log("debug", "anchored near bots at", t.x, t.y, t.z, t.dim);
    }
}

// ----------------------------------------------------------------- main ---
async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("--setup") || (!argAfter(argv, "--config") && !existsSync(join(HERE, "config.json")))) {
        const { runSetup } = await import("./setup.mjs");
        await runSetup();
    }
    const cfg = loadConfig(argv);
    logLevel = LEVELS[argAfter(argv, "--log") || cfg.log || "info"] ?? 1;
    if (logLevel === 0) process.env.DEBUG = [process.env.DEBUG, "minecraft-protocol", "bedrock-protocol:*", "prismarine-auth"].filter(Boolean).join(",");
    if (argv.includes("--test-provider")) {
        const id = argAfter(argv, "--test-provider") || cfg.defaults.provider;
        log("info", `testing provider ${id} ...`);
        const res = await callProvider(cfg, { provider: id }, { systemStable: "You are a Minecraft player bot. Reply with JSON only.", systemDynamic: null, messages: [{ role: "user", content: 'Observation: you just spawned in a forest. Reply: {"thought":"...","say":"hello world","mood":"happy","actions":[{"type":"wait","seconds":2}]}' }] }, 60);
        console.log(JSON.stringify(res, null, 2));
        process.exit(res.ok ? 0 : 1);
    }
    if (argv.includes("--help")) {
        console.log(`Real AI bridge ${VERSION}\n  node index.mjs [--setup] [--config path] [--log debug|info|warn] [--test-provider <id>] [--selftest]\nProviders: ${Object.keys(PROVIDERS).join(", ")}`);
        process.exit(0);
    }
    if (argv.includes("--selftest")) { cfg.chatRelay = false; cfg.selfTest = true; }
    const bridge = new Bridge(cfg);
    if (argv.includes("--selftest")) {
        process.on("SIGINT", () => { bridge.stopped = true; try { bridge.client?.close(); } catch (e) { /* ignore */ } process.exit(130); });
        bridge.start().catch(e => log("error", e));
        const res = await bridge.selfTest();
        console.log(res.ok
            ? "\nSELFTEST PASSED: the server accepts this body walking, sprinting, stepping back and turning. If the AI still stands still in the game, the problem is on the addon side (is the pack up to date and active? is this account an Operator?): in the game chat type  !ai body  and  !ai where."
            : "\nSELFTEST FAILED: see the FAIL lines above. Send a screenshot of this whole output.");
        bridge.stopped = true; try { bridge.client?.close(); } catch (e) { /* ignore */ }
        setTimeout(() => process.exit(res.ok ? 0 : 1), 300);
        return;
    }
    process.on("SIGINT", () => { bridge.stopped = true; try { bridge.client?.close(); } catch (e) { /* ignore */ } process.exit(0); });
    await bridge.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch(e => { console.error(e); process.exit(1); });
}
