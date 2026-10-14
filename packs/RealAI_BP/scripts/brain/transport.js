// Picks how a think reaches an LLM: directly over HTTP (dedicated server
// edition) or through the external bridge player (any world, Realms included).
import { system } from "@minecraft/server";
import { EDITION, hasDirectHttp, httpSend } from "./net_impl.js";
import { runThink } from "./llm_core.js";
import { BridgeChannel } from "./bridge_channel.js";

export const bridge = new BridgeChannel();

export function transportInfo() {
    return {
        edition: EDITION,
        direct: hasDirectHttp,
        bridgeConnected: bridge.isConnected(),
        bridgePlayer: bridge.playerName(),
    };
}

function tickSleep(ms) {
    return new Promise(resolve => system.runTimeout(resolve, Math.max(1, Math.round(ms / 50))));
}

// BDS enforces max_concurrent_requests (HttpRequestLimitExceededError); keep our own cap below it.
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiters = [];
async function limitedSend(req) {
    if (inFlight >= MAX_IN_FLIGHT) await new Promise(resolve => waiters.push(resolve));
    inFlight++;
    try {
        return await httpSend({ ...req, timeoutSec: req.timeoutSec || 40 });
    } finally {
        inFlight--;
        const next = waiters.shift();
        if (next) next();
    }
}

export function inFlightRequests() { return inFlight; }

/**
 * Run one think for a bot. Prefers the bridge when it is connected and the
 * operator chose it; otherwise direct HTTP; otherwise fails fast.
 * cfg: brain config (provider/model/key/mode); turn: from prompt.buildTurn
 */
export async function think(botId, cfg, turn) {
    const mode = cfg.transport || "auto";
    const useBridge = mode === "bridge" || (mode === "auto" && !hasDirectHttp && bridge.isConnected());
    if (useBridge) {
        if (!bridge.isConnected()) return { ok: false, error: "no bridge connected (start the bridge, or run on a dedicated server)", type: "no_transport" };
        return bridge.think(botId, cfg, turn);
    }
    if (!hasDirectHttp) return { ok: false, error: "no transport: Realm edition without a bridge", type: "no_transport" };
    return runThink(cfg, turn, limitedSend, tickSleep);
}
