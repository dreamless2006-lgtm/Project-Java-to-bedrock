// Token/cost ledger: the Bedrock port of Player2NPC's "Joules" budget.
// Pure. Storage is injected (get/set of a JSON string) so it works on
// world dynamic properties in-game and on a plain object in tests.
//
// Units: tokens are counted exactly from provider usage; cost is estimated in
// milli-cents (1/1000 of a US cent) from PRICES. Soft limit -> bots think less
// often; hard limit -> brains pause and the scripted fallback takes over until
// the window rolls or an operator resets.

// USD per 1M tokens: [input, output, cacheRead]. Unknown models fall back to the provider default.
export const PRICES = {
    anthropic: {
        "claude-opus-5-5":   [4.00, 20.00, 0.20],
        "claude-sonnet-5-5": [2.00, 10.00, 0.20],
        "claude-haiku-5-5":  [0.10, 0.50, 0.01],
        "claude-fable-5-1":  [10.00, 50.00, 0.25],
        default:             [4.00, 20.00, 0.20],
    },
    // Non-Anthropic prices are approximate list prices seen in 2026; adjust in PRICES if your invoice differs.
    openai:     { "gpt-5.4-mini": [0.75, 4.50, 0.075], "gpt-5.4-nano": [0.20, 1.20, 0.02], "gpt-5.5": [5.00, 30.00, 0.50], "gpt-5-mini": [0.25, 2.00, 0.025], default: [0.75, 4.50, 0.075] },
    xai:        { "grok-4.3": [1.25, 2.50, 0.20], "grok-4.5": [2.00, 6.00, 0.20], "grok-4.6": [2.00, 6.00, 0.20], default: [1.25, 2.50, 0.20] },
    gemini:     { "gemini-2.5-pro": [1.25, 10.00, 0.31], "gemini-2.5-flash": [0.30, 2.50, 0.075], "gemini-3.6-flash": [0.75, 3.75, 0.19], "gemini-flash-lite-latest": [0.30, 1.50, 0.05], default: [0.75, 3.75, 0.19] },
    openrouter: { default: [0.50, 2.00, 0.5] },
    player2:    { default: [0, 0, 0] },
    ollama:     { default: [0, 0, 0] },
    lmstudio:   { default: [0, 0, 0] },
    custom:     { default: [0, 0, 0] },
};

export function estimateCostMillicents(provider, model, usage) {
    const table = PRICES[provider] || PRICES.custom;
    const p = table[model] || table.default;
    const nonCached = Math.max(0, (usage.input || 0) - (usage.cacheRead || 0));
    const usd = (nonCached * p[0] + (usage.cacheRead || 0) * p[2] + (usage.output || 0) * p[1]) / 1_000_000;
    return Math.round(usd * 100 * 1000);
}

export const BUDGET_DEFAULTS = {
    windowMinutes: 60,
    softTokens: 400_000,     // per window, all bots together
    hardTokens: 1_000_000,
    softMillicents: 0,       // 0 = unlimited
    hardMillicents: 0,
};

export class BudgetLedger {
    /** storage: { get(): string|undefined, set(s: string): void }, now: () => ms */
    constructor(storage, now = () => Date.now(), limits = {}) {
        this.storage = storage;
        this.now = now;
        this.limits = { ...BUDGET_DEFAULTS, ...limits };
        this.state = this._load();
    }

    _load() {
        try {
            const raw = this.storage.get();
            if (raw) {
                const s = JSON.parse(raw);
                if (s && Array.isArray(s.buckets)) return s;
            }
        } catch (e) { /* fresh */ }
        return { buckets: [], lifetimeTokens: 0, lifetimeMillicents: 0, calls: 0 };
    }

    _save() {
        try { this.storage.set(JSON.stringify(this.state)); } catch (e) { /* ignore */ }
    }

    setLimits(limits) {
        this.limits = { ...this.limits, ...limits };
    }

    _prune() {
        const cutoff = this.now() - this.limits.windowMinutes * 60_000;
        // buckets are 1-minute aggregates: {t, tokens, mc}
        this.state.buckets = this.state.buckets.filter(b => b.t >= cutoff);
    }

    record(provider, model, usage, botName) {
        const tokens = (usage.input || 0) + (usage.output || 0);
        const mc = estimateCostMillicents(provider, model, usage);
        const minute = Math.floor(this.now() / 60_000) * 60_000;
        let b = this.state.buckets[this.state.buckets.length - 1];
        if (!b || b.t !== minute) {
            b = { t: minute, tokens: 0, mc: 0, calls: 0 };
            this.state.buckets.push(b);
        }
        b.tokens += tokens;
        b.mc += mc;
        b.calls += 1;
        this.state.lifetimeTokens += tokens;
        this.state.lifetimeMillicents += mc;
        this.state.calls += 1;
        this.state.lastBot = botName;
        this._prune();
        this._save();
        return { tokens, mc };
    }

    /** Usage within the current window. */
    window() {
        this._prune();
        let tokens = 0, mc = 0, calls = 0;
        for (const b of this.state.buckets) { tokens += b.tokens; mc += b.mc; calls += b.calls; }
        return { tokens, mc, calls };
    }

    /** "ok" | "soft" | "hard" */
    level() {
        const w = this.window();
        const L = this.limits;
        if ((L.hardTokens && w.tokens >= L.hardTokens) || (L.hardMillicents && w.mc >= L.hardMillicents)) return "hard";
        if ((L.softTokens && w.tokens >= L.softTokens) || (L.softMillicents && w.mc >= L.softMillicents)) return "soft";
        return "ok";
    }

    reset() {
        this.state.buckets = [];
        this._save();
    }

    status() {
        const w = this.window();
        return {
            level: this.level(),
            windowMinutes: this.limits.windowMinutes,
            windowTokens: w.tokens,
            windowCalls: w.calls,
            windowUsd: w.mc / 100_000,
            lifetimeTokens: this.state.lifetimeTokens,
            lifetimeUsd: this.state.lifetimeMillicents / 100_000,
            softTokens: this.limits.softTokens,
            hardTokens: this.limits.hardTokens,
        };
    }
}

export function formatUsd(usd) {
    if (usd >= 1) return "$" + usd.toFixed(2);
    if (usd >= 0.01) return (usd * 100).toFixed(1) + "¢";
    return (usd * 100).toFixed(3) + "¢";
}
