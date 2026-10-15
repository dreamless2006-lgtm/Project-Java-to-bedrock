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
import { encodeFrames, Reassembler, nextMessageId, packMessage, unpackMessage, DEFAULT_CHUNK } from "../packs/RealAI_BP/scripts/brain/frame.js";
import { REPLY_SCHEMA } from "../packs/RealAI_BP/scripts/brain/action_schema.js";
import { Body } from "./body.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.2.0";
const EXPECT_ADDON = "2.9.0";          // the pack build whose addon walks this bridge's body
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
    const merged = { ...pc, provider: id, model: botCfg.model || pc.model || provider.defaultModel, maxTokens: botCfg.maxTokens || 700, effort: botCfg.effort || pc.effort, temperature: botCfg.temperature ?? pc.temperature };
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
        this.body = new Body();          // our own player body: position, walking, the per-tick input packet
        this.inputFailures = 0;
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
            log("info", `start_game: game mode ${p.player_gamemode} (world ${p.world_gamemode}), pvp ${pvp === null ? "?" : pvp}, position ${JSON.stringify(this.body.status().pos)}, rewind ${p.rewind_history_size}`);
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
        client.on("respawn", p => { try { for (const pk of this.body.onRespawn(p)) this.client.queue(pk.name, pk.params); if (Number(p.state) === 1 && this.body.isMe(p.runtime_entity_id)) log("info", "respawning at", JSON.stringify(this.body.status().pos)); } catch (e) { log("warn", "respawn:", e?.message || e); } });
        client.on("change_dimension", p => { try { for (const pk of this.body.onChangeDimension(p)) this.client.queue(pk.name, pk.params); log("info", `changing dimension (${p.dimension}) to`, JSON.stringify(this.body.status().pos)); } catch (e) { log("warn", "change_dimension:", e?.message || e); } });
        client.on("player_action", p => { try { for (const pk of this.body.onPlayerAction(p)) this.client.queue(pk.name, pk.params); } catch (e) { /* ignore */ } });
        client.on("set_player_game_type", p => { this.body.gameMode = p.gamemode; log("info", "game mode is now", p.gamemode); });
        client.on("set_health", p => { log("debug", "health", p.health); try { if (Number(p.health) <= 0 && this.body.alive) { this.body.alive = false; this.body.target = null; log("info", "this body died; waiting for the respawn handshake"); } } catch (e) { /* ignore */ } });
        client.on("entity_event", p => { try { if (p.event_id === "hurt_animation" && this.body.isMe(p.runtime_entity_id)) log("info", "ouch: this body was hit"); } catch (e) { /* ignore */ } });
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
            if (!this.spawned) return;
            if (this.addonHello) { this.sendToAddon({ t: "ping" }); return; }
            // Not acknowledged yet: say hello again, and after a minute explain the usual causes.
            this.sendToAddon(this.helloMessage(opts.username));
            if (Date.now() - (this.helloSentAt || 0) > 60_000) log("warn", "the addon has not answered yet. On the Realm: (1) make this account an Operator (Realm settings > Members), (2) turn on 'Activate Cheats' in the Realm's game settings, (3) make sure the Real AI behavior pack is active on this world. The hello is retried every 30 s.");
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
        this.spawned = true;
        this.addonHello = false;
        this.helloSentAt = Date.now();
        this.outQueue.length = 0;
        this.reconnectDelay = 5000;
        // every frame is a /scriptevent command; without this the server tells every operator about each one
        this.outQueue.push("/gamerule sendcommandfeedback false");
        const wantMode = this.cfg.connect?.gamemode === undefined ? "survival" : this.cfg.connect.gamemode;
        if (wantMode && String(this.body.gameMode) !== String(wantMode)) { log("info", `switching this account to ${wantMode} (set connect.gamemode to null in config.json to leave it alone)`); this.outQueue.push(`/gamemode ${wantMode} @s`); }
        this.sendToAddon(this.helloMessage(username));
    }

    bodyTick() {
        if (!this.client || !this.spawned) return;
        let params;
        try { params = this.body.step(); } catch (e) { return; }
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
        clearInterval(this.pumpTimer); clearInterval(this.pingTimer); clearInterval(this.anchorTimer); clearInterval(this.bodyTimer);
        this.body = new Body();
        const d = this.reconnectDelay;
        this.reconnectDelay = Math.min(120_000, d * 2);
        log("info", `reconnecting in ${Math.round(d / 1000)}s`);
        setTimeout(() => { this._reconnecting = false; this.start().catch(e => { log("error", e); this.scheduleReconnect(); }); }, d);
    }

    // Text packets: chat from players (relay) or frames from the addon (handle).
    onText(p) {
        let message = p.message ?? "";
        if (p.type === "json" || p.type === "object") {
            try {
                const j = JSON.parse(message);
                if (j && Array.isArray(j.rawtext)) message = j.rawtext.map(x => x.text || "").join("");
            } catch (e) { /* keep raw */ }
        }
        if (typeof message !== "string") return;
        if (message.includes("AIB1|")) {
            const got = this.reassembler.push(message);
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
        switch (msg.t) {
            case "hello":
                if (!this.addonHello) { this.addonHello = true; log("info", "the addon answered; residents will join the players now"); }
                log("info", `addon says hello (build ${msg.version || "older than 2.5.0"}, walks ${msg.walks ? "yes" : "no"}, tick ${msg.tick})`);
                if (!msg.walks) log("warn", `the Real AI pack on this world is older than ${EXPECT_ADDON}: it tries to teleport this body itself, which a Realm ignores. Import dist/Real-AI-${EXPECT_ADDON}.mcaddon, activate it on the world, and rejoin.`);
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
                this.body.anchorFrom({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) });
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
                try {
                    this.client.queue("text", { type: "chat", needs_translation: false, category: "authored", source_name: this.client.username, message: text, xuid: "", platform_chat_id: "", has_filtered_message: false, filtered_message: "" });
                } catch (e) { log("warn", "chat failed:", e?.message || e); }
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
                this.anchorTarget = msg;
                break;
            // The addon walks our body: it knows the terrain and sends the next footing point.
            case "walk":
                if (typeof msg.fx === "number") this.body.anchorFrom({ x: msg.fx, y: msg.fy, z: msg.fz });
                if (this.body.walkTo({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) }, msg.mode)) { if (msg.jump) this.body.jump(); }
                break;
            case "stop":
                this.body.stop();
                break;
            case "look":
                this.body.lookAt({ x: Number(msg.x), y: Number(msg.y), z: Number(msg.z) });
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
        console.log(`Real AI bridge ${VERSION}\n  node index.mjs [--setup] [--config path] [--log debug|info|warn] [--test-provider <id>]\nProviders: ${Object.keys(PROVIDERS).join(", ")}`);
        process.exit(0);
    }
    const bridge = new Bridge(cfg);
    process.on("SIGINT", () => { bridge.stopped = true; try { bridge.client?.close(); } catch (e) { /* ignore */ } process.exit(0); });
    await bridge.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch(e => { console.error(e); process.exit(1); });
}
