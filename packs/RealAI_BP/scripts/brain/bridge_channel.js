// In-game side of the bridge protocol.
//
// Outbound (addon -> bridge player): Player.sendMessage frames; only the bridge
// account receives them. Inbound (bridge -> addon): `/scriptevent realai:in <frame>`
// run by the bridge account (needs operator), received through
// system.afterEvents.scriptEventReceive. Both directions use frame.js.
//
// Message types
//   addon->bridge: hello, think{bot, turnId, cfg, sys?, sysHash, messages}, chat_out{...}, anchor{x,y,z,dim}
//   bridge->addon: hello{name, version, providers}, result{turnId, ok, text|error, usage}, need_sys{turnId}, chat_in{from, text}, ping
import { world, system } from "@minecraft/server";
import { encodeFrames, Reassembler, nextMessageId, packMessage, unpackMessage, DEFAULT_CHUNK } from "./frame.js";
import { getProvider } from "./providers/index.js";
import { parseJsonLoose } from "./json_util.js";
import { normalizeReply } from "./action_schema.js";
import { getWorldConfig } from "./config.js";

export const SCRIPT_EVENT_ID = "realai:in";
export const ADDON_BUILD = "2.6.0";     // keep in step with packs/RealAI_BP/manifest.json
export const BRIDGE_TAG = "realai_bridge";
const OUT_CHUNK = 900;              // server->client chat lines can be longer than 512
const HELLO_TIMEOUT_TICKS = 20 * 90;
const THINK_TIMEOUT_TICKS = 20 * 60;

export class BridgeChannel {
    constructor() {
        this.player = null;            // Player entity of the bridge account
        this.lastSeen = -1;
        this.pending = new Map();      // turnId -> {resolve, cfg, turn, bot, sentSys, t}
        this.sysSent = new Map();      // bot -> sysHash the bridge has
        this.reassembler = new Reassembler(() => Date.now());
        this.listeners = { chat: [], hello: [], locate: [] };
        this.info = null;
        this._subscribed = false;
    }

    subscribe() {
        if (this._subscribed) return;
        this._subscribed = true;
        system.afterEvents.scriptEventReceive.subscribe(ev => {
            if (ev.id !== SCRIPT_EVENT_ID) return;
            const sender = ev.sourceEntity;
            if (!sender || sender.typeId !== "minecraft:player") return;
            this._touch(sender);
            if (!this.player || this.player.id !== sender.id) return;      // not the accepted bridge account
            const got = this.reassembler.push(ev.message);
            if (!got) return;
            const msg = unpackMessage(got.text);
            if (msg) this._handle(msg, sender);
        }, { namespaces: ["realai"] });
        system.runInterval(() => this._sweep(), 40);
    }

    onChat(fn) { this.listeners.chat.push(fn); }
    onHello(fn) { this.listeners.hello.push(fn); }
    onLocate(fn) { this.listeners.locate.push(fn); }

    _touch(player) {
        // Only operators can run /scriptevent, and optionally only the configured bridge account.
        try {
            const wanted = getWorldConfig().bridgeName;
            if (wanted && player.name.toLowerCase() !== String(wanted).toLowerCase()) return;
            if (this.player && this.player.isValid && this.player.id !== player.id && system.currentTick - this.lastSeen < HELLO_TIMEOUT_TICKS) return;   // one bridge at a time
        } catch (e) { /* ignore */ }
        this.player = player;
        this.lastSeen = system.currentTick;
        try { if (!player.hasTag(BRIDGE_TAG)) player.addTag(BRIDGE_TAG); } catch (e) { /* ignore */ }
    }

    isConnected() {
        if (!this.player) return false;
        try { if (!this.player.isValid) return false; } catch (e) { return false; }
        return system.currentTick - this.lastSeen < HELLO_TIMEOUT_TICKS;
    }

    feetOf(player) { try { const l = player.location; return { x: +l.x.toFixed(2), y: +l.y.toFixed(2), z: +l.z.toFixed(2) }; } catch (e) { return null; } }
    gameModeOf(player) { try { return String(player.getGameMode()); } catch (e) { return null; } }

    playerName() {
        try { return this.player && this.player.isValid ? this.player.name : null; } catch (e) { return null; }
    }

    send(obj) {
        if (!this.player) return false;
        const text = packMessage(obj);
        const frames = encodeFrames(nextMessageId("o"), text, OUT_CHUNK);
        try {
            for (const f of frames) this.player.sendMessage(f);
            return true;
        } catch (e) {
            return false;
        }
    }

    _handle(msg, sender) {
        switch (msg.t) {
            case "hello":
                this.info = msg;
                this.sysSent.clear();
                for (const fn of this.listeners.hello) { try { fn(msg); } catch (e) { console.warn(e, e.stack); } }
                this.send({ t: "hello", v: 2, edition: "addon", version: ADDON_BUILD, walks: true, body: !!msg.body, tick: system.currentTick, pos: this.feetOf(sender), gamemode: this.gameModeOf(sender) });
                break;
            case "ping":
                this.send({ t: "pong", tick: system.currentTick });
                break;
            case "body":
                this.bodyStatus = msg;
                break;
            case "locate_result":
                for (const fn of this.listeners.locate) { try { fn(msg); } catch (e) { console.warn(e, e.stack); } }
                break;
            case "chat_in":
                for (const fn of this.listeners.chat) { try { fn(msg.from, msg.text, msg.whisper); } catch (e) { console.warn(e, e.stack); } }
                break;
            case "need_sys": {
                const p = this.pending.get(msg.turnId);
                if (p) { this.sysSent.delete(p.bot); this._sendThink(p, msg.turnId, true); }
                break;
            }
            case "result": {
                const p = this.pending.get(msg.turnId);
                if (!p) return;
                this.pending.delete(msg.turnId);
                p.resolve(this._finish(p, msg));
                break;
            }
            default:
                break;
        }
    }

    _finish(p, msg) {
        if (!msg.ok) return { ok: false, error: msg.error || "bridge error", type: msg.type || "bridge", usage: msg.usage, provider: p.cfg.provider, model: msg.model };
        const json = parseJsonLoose(msg.text);
        if (!json) return { ok: false, error: "model did not return JSON", type: "bad_json", usage: msg.usage, rawText: msg.text, provider: p.cfg.provider, model: msg.model };
        return { ok: true, reply: normalizeReply(json), raw: json, usage: msg.usage, attempts: msg.attempts || 1, provider: msg.provider || p.cfg.provider, model: msg.model };
    }

    _sendThink(p, turnId, withSys) {
        const have = this.sysSent.get(p.bot);
        const includeSys = withSys || have !== p.turn.sysHash;
        const body = {
            t: "think",
            turnId,
            bot: p.bot,
            cfg: { provider: p.cfg.provider, model: p.cfg.model, maxTokens: p.cfg.maxTokens, effort: p.cfg.effort, temperature: p.cfg.temperature },
            sysHash: p.turn.sysHash,
            messages: p.turn.messages,
        };
        if (includeSys) { body.sys = p.turn.systemStable; this.sysSent.set(p.bot, p.turn.sysHash); }
        this.send(body);
    }

    /** Resolve with the same shape as llm_core.runThink. */
    think(botId, cfg, turn) {
        const provider = getProvider(cfg.provider);
        if (!provider) return Promise.resolve({ ok: false, error: `unknown provider '${cfg.provider}'` });
        const turnId = nextMessageId("t");
        return new Promise(resolve => {
            const p = { resolve, cfg, turn, bot: botId, t: system.currentTick };
            this.pending.set(turnId, p);
            this._sendThink(p, turnId, false);
        });
    }

    _sweep() {
        const now = system.currentTick;
        for (const [id, p] of this.pending) {
            if (now - p.t > THINK_TIMEOUT_TICKS) {
                this.pending.delete(id);
                p.resolve({ ok: false, error: "bridge did not answer in time", type: "timeout", provider: p.cfg.provider });
            }
        }
    }
}
