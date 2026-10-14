#!/usr/bin/env node
// AI Sandbox bridge: a Node process that joins the world as a player, so a
// Realm (which cannot make HTTP calls from scripts) still gets real LLM bots.
//
//   addon --(chat frames to this player)--> bridge --(HTTPS)--> LLM provider
//   bridge --(/scriptevent aisb:in frames)--> addon
//
// The bridge also relays public chat it sees into the addon (so bots hear
// players even where the Beta chat API is unavailable), keeps the Realm
// loaded while the humans are offline, and can teleport itself near the bots
// so their chunks keep ticking ("anchor").
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PROVIDERS, getProvider } from "../packs/AI_Sandbox_BP/scripts/brain/providers/index.js";
import { encodeFrames, Reassembler, nextMessageId, packMessage, unpackMessage, DEFAULT_CHUNK } from "../packs/AI_Sandbox_BP/scripts/brain/frame.js";
import { REPLY_SCHEMA } from "../packs/AI_Sandbox_BP/scripts/brain/action_schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.1.0";
const SCRIPT_EVENT = "aisb:in";
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
export async function callProvider(cfg, botCfg, turn, timeoutSeconds = 60) {
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
    }

    async start() {
        const bedrock = await import("bedrock-protocol");
        const c = this.cfg.connect || {};
        const opts = { username: c.username || "AISandboxBridge", offline: !!c.offline, profilesFolder: c.profilesFolder || join(HERE, ".auth-cache"), conLog: (...a) => log("info", "[mc]", ...a) };
        if ((c.mode || "realm") === "realm") {
            const r = c.realm || {};
            if (r.invite) opts.realms = { realmInvite: r.invite };
            else if (r.id) opts.realms = { realmId: String(r.id) };
            else opts.realms = { pickRealm: realms => { log("info", "Realms available:", realms.map(x => `${x.name} (${x.id})`).join(", ")); return realms[0]; } };
        } else {
            opts.host = c.host || "127.0.0.1";
            opts.port = c.port || 19132;
        }
        if (c.version) opts.version = c.version;
        log("info", `connecting (${c.mode || "realm"}) as ${opts.username} ...`);
        const client = bedrock.createClient(opts);
        this.client = client;
        client.on("start_game", p => { try { this.entityId = BigInt(p.runtime_entity_id ?? p.entity_id ?? 0); } catch (e) { this.entityId = 0n; } });
        client.on("spawn", () => {
            log("info", "spawned in the world; announcing to the addon");
            this.reconnectDelay = 5000;
            this.sendToAddon({ t: "hello", v: 1, name: opts.username, version: VERSION, providers: Object.keys(PROVIDERS).filter(id => !PROVIDERS[id].needsKey || this.cfg.providers[id]?.apiKey) });
        });
        client.on("text", p => this.onText(p));
        client.on("disconnect", p => { log("warn", "disconnected:", p?.message || p?.reason || ""); this.scheduleReconnect(); });
        client.on("close", () => { log("warn", "connection closed"); this.scheduleReconnect(); });
        client.on("error", e => log("error", "client error:", e?.message || e));
        client.on("kick", p => log("warn", "kicked:", p?.message || JSON.stringify(p)));
        this.pumpTimer = setInterval(() => this.pump(), 60);
        this.pingTimer = setInterval(() => this.sendToAddon({ t: "ping" }), 30_000);
        this.anchorTimer = setInterval(() => this.anchor(), 5000);
    }

    scheduleReconnect() {
        if (this.stopped || this._reconnecting) return;
        this._reconnecting = true;
        clearInterval(this.pumpTimer); clearInterval(this.pingTimer); clearInterval(this.anchorTimer);
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
                this.outQueue.push(`/scriptevent aisb:cmdfor ${safe}`);
                return;
            }
            this.sendToAddon({ t: "chat_in", from, text });
        }
    }

    async handle(msg) {
        switch (msg.t) {
            case "hello":
                log("info", "addon says hello (tick " + msg.tick + ")");
                break;
            case "pong":
                break;
            case "anchor":
                this.anchorTarget = msg;
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
            const res = await callProvider(this.cfg, botCfg, { systemStable: sys.text, systemDynamic: null, messages }, this.cfg.requestTimeoutSeconds || 60);
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
        if (!this.client || !this.outQueue.length) return;
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
        if (!a.enabled || !this.anchorTarget || !this.client) return;
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
    const cfg = loadConfig(argv);
    logLevel = LEVELS[argAfter(argv, "--log") || cfg.log || "info"] ?? 1;
    if (argv.includes("--test-provider")) {
        const id = argAfter(argv, "--test-provider") || cfg.defaults.provider;
        log("info", `testing provider ${id} ...`);
        const res = await callProvider(cfg, { provider: id }, { systemStable: "You are a Minecraft player bot. Reply with JSON only.", systemDynamic: null, messages: [{ role: "user", content: 'Observation: you just spawned in a forest. Reply: {"thought":"...","say":"hello world","mood":"happy","actions":[{"type":"wait","seconds":2}]}' }] }, 60);
        console.log(JSON.stringify(res, null, 2));
        process.exit(res.ok ? 0 : 1);
    }
    if (argv.includes("--help")) {
        console.log(`AI Sandbox bridge ${VERSION}\n  node index.mjs [--config path] [--log debug|info|warn] [--test-provider <id>]\nProviders: ${Object.keys(PROVIDERS).join(", ")}`);
        process.exit(0);
    }
    const bridge = new Bridge(cfg);
    process.on("SIGINT", () => { bridge.stopped = true; try { bridge.client?.close(); } catch (e) { /* ignore */ } process.exit(0); });
    await bridge.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch(e => { console.error(e); process.exit(1); });
}
