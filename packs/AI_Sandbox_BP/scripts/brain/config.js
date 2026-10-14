// Brain configuration: world-level settings in one JSON dynamic property,
// optional overrides from dedicated-server variables/secrets, and per-bot
// settings in a dynamic property on the bot entity.
import { world } from "@minecraft/server";
import { readVariable, readSecret, secretNames, variableNames, hasServerAdmin } from "./net_impl.js";
import { PROVIDER_IDS } from "./providers/index.js";
import { BUDGET_DEFAULTS } from "./budget.js";

export const WORLD_KEY = "aisb:cfg";
export const BOT_KEY = "aisb:bot";
export const MEMORY_KEY = "aisb:mem";
export const BUDGET_KEY = "aisb:budget";

export const DEFAULTS = Object.freeze({
    enabled: true,
    provider: "anthropic",
    model: "",
    transport: "auto",          // auto | direct | bridge
    effort: "low",              // anthropic effort / openai reasoning hint
    maxTokens: 700,
    temperature: null,
    chatVolume: 2,              // 0 silent, 1 quiet, 2 normal, 3 chatty
    callByName: false,          // Player2NPC "call-by-name chat": only answer when addressed
    hearingRange: 48,
    thinkIdleSec: 45,
    thinkActiveSec: 12,
    maxBrains: 10,              // bots with a live brain at once (closest to players first)
    autonomy: "full",           // full | companions_only | off
    freeBuild: true,            // place blocks without inventory (like the original addon)
    keepAlive: true,            // ticking areas around bot homes when nobody is online (BDS)
    autoCure: true,             // cure Call of the Hive on bots so they are not replaced by parasites
    legacyFakeChat: false,      // the original fake-player chat simulator
    serverRules: "",
    budget: { ...BUDGET_DEFAULTS },
});

let worldCache = null;

export function getWorldConfig() {
    if (worldCache) return worldCache;
    let stored = {};
    try {
        const raw = world.getDynamicProperty(WORLD_KEY);
        if (typeof raw === "string" && raw) stored = JSON.parse(raw) || {};
    } catch (e) { stored = {}; }
    const cfg = { ...DEFAULTS, ...stored, budget: { ...DEFAULTS.budget, ...(stored.budget || {}) } };
    applyServerOverrides(cfg);
    worldCache = cfg;
    return cfg;
}

export function updateWorldConfig(patch) {
    const cfg = getWorldConfig();
    const next = { ...cfg, ...patch, budget: { ...cfg.budget, ...(patch.budget || {}) } };
    worldCache = next;
    try { world.setDynamicProperty(WORLD_KEY, JSON.stringify(stripOverrides(next))); } catch (e) { console.warn("[AISB] config save failed", e); }
    return next;
}

function stripOverrides(cfg) {
    const out = { ...cfg };
    delete out._overrides;
    return out;
}

// On a dedicated server, config/<pack>/variables.json and secrets.json win over in-game settings.
function applyServerOverrides(cfg) {
    cfg._overrides = [];
    if (!hasServerAdmin) return;
    const map = {
        "aisb.provider": "provider", "aisb.model": "model", "aisb.transport": "transport", "aisb.effort": "effort",
        "aisb.maxTokens": "maxTokens", "aisb.maxBrains": "maxBrains", "aisb.autonomy": "autonomy", "aisb.chatVolume": "chatVolume",
        "aisb.callByName": "callByName", "aisb.freeBuild": "freeBuild", "aisb.keepAlive": "keepAlive", "aisb.serverRules": "serverRules",
        "aisb.thinkIdleSec": "thinkIdleSec", "aisb.thinkActiveSec": "thinkActiveSec", "aisb.enabled": "enabled",
    };
    for (const [varName, key] of Object.entries(map)) {
        const v = readVariable(varName);
        if (v !== undefined && v !== null && v !== "") { cfg[key] = v; cfg._overrides.push(key); }
    }
    for (const b of ["softTokens", "hardTokens", "windowMinutes", "softMillicents", "hardMillicents"]) {
        const v = readVariable("aisb.budget." + b);
        if (typeof v === "number") { cfg.budget[b] = v; cfg._overrides.push("budget." + b); }
    }
}

/** API key for a provider: a SecretString from secrets.json on BDS, nothing elsewhere (the bridge holds keys). */
export function apiKeyFor(provider) {
    if (!hasServerAdmin) return undefined;
    const candidates = [`aisb.apiKey.${provider}`, `aisb_${provider}_key`, ENV_NAMES[provider]].filter(Boolean);
    for (const name of candidates) {
        const s = readSecret(name);
        if (s) return s;
    }
    return undefined;
}

export const ENV_NAMES = {
    anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY", player2: "PLAYER2_API_KEY", custom: "CUSTOM_LLM_API_KEY",
};

export function configuredProviders() {
    const out = [];
    for (const id of PROVIDER_IDS) {
        if (hasServerAdmin) {
            const hasKey = !!apiKeyFor(id);
            out.push({ id, hasKey });
        } else {
            out.push({ id, hasKey: null });   // unknown here; the bridge reports what it has
        }
    }
    return out;
}

export function serverConfigSummary() {
    return { hasServerAdmin, secrets: secretNames(), variables: variableNames() };
}

/** Effective LLM call config for one bot. */
export function callConfigFor(bot) {
    const w = getWorldConfig();
    const b = bot.settings || {};
    const provider = b.provider || w.provider;
    return {
        provider,
        model: b.model || w.model || "",
        apiKey: apiKeyFor(provider),
        baseUrl: readVariable(`aisb.baseUrl.${provider}`) || undefined,
        maxTokens: w.maxTokens,
        effort: w.effort || undefined,
        temperature: w.temperature ?? undefined,
        transport: w.transport,
    };
}

// ---- per-bot settings ------------------------------------------------------
export function readBotSettings(entity) {
    try {
        const raw = entity.getDynamicProperty(BOT_KEY);
        if (typeof raw === "string" && raw) return JSON.parse(raw) || {};
    } catch (e) { /* fallthrough */ }
    return {};
}

export function writeBotSettings(entity, settings) {
    try { entity.setDynamicProperty(BOT_KEY, JSON.stringify(settings)); } catch (e) { console.warn("[AISB] bot settings save failed", e); }
}

export function patchBotSettings(entity, patch) {
    const next = { ...readBotSettings(entity), ...patch };
    writeBotSettings(entity, next);
    return next;
}
