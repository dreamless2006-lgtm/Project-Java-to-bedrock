// Provider-agnostic think pipeline. Pure: the HTTP call is injected.
import { getProvider } from "./providers/index.js";
import { parseJsonLoose } from "./json_util.js";
import { normalizeReply, REPLY_SCHEMA } from "./action_schema.js";

export const RETRY = { attempts: 3, baseDelayMs: 1500, maxDelayMs: 12_000, timeoutSec: 90 };

/**
 * cfg: {provider, model, apiKey, baseUrl, maxTokens, effort, temperature}
 * turn: {systemStable, systemDynamic, messages}
 * send: ({uri, method, headers, body, timeoutSec}) => Promise<{status, body}>
 * sleep: (ms) => Promise<void>
 * Returns {ok, reply (normalised), raw, usage, error, attempts, provider, model}
 */
export async function runThink(cfg, turn, send, sleep = defaultSleep, retry = RETRY) {
    const provider = getProvider(cfg.provider);
    if (!provider) return { ok: false, error: `unknown provider '${cfg.provider}'`, attempts: 0 };
    if (provider.needsKey && !cfg.apiKey) return { ok: false, error: `${cfg.provider}: no API key configured`, attempts: 0 };
    const model = cfg.model || provider.defaultModel;
    const req = provider.build({ ...cfg, model }, { ...turn, schema: REPLY_SCHEMA, schemaName: "bot_turn", maxTokens: cfg.maxTokens || 700 });
    let lastError = "no attempts";
    let attempts = 0;
    for (let i = 0; i < retry.attempts; i++) {
        attempts++;
        let res;
        try {
            res = await send({ ...req, timeoutSec: retry.timeoutSec });
        } catch (e) {
            lastError = "transport: " + (e && e.message ? e.message : String(e));
            await sleep(backoff(i, retry));
            continue;
        }
        const parsed = provider.parse(res.status, res.body);
        if (!parsed.ok) {
            lastError = `${cfg.provider} ${res.status}: ${parsed.error}`;
            if (!parsed.retryable) return { ok: false, error: lastError, type: parsed.type, attempts, usage: parsed.usage, provider: cfg.provider, model };
            await sleep(backoff(i, retry));
            continue;
        }
        const json = parseJsonLoose(parsed.text);
        if (!json) {
            lastError = "model did not return JSON";
            // One more try with a nudge is handled by the caller via problems; stop here.
            return { ok: false, error: lastError, type: "bad_json", attempts, usage: parsed.usage, rawText: parsed.text, provider: cfg.provider, model };
        }
        const reply = normalizeReply(json);
        return { ok: true, reply, raw: json, usage: parsed.usage, attempts, provider: cfg.provider, model, stopReason: parsed.stopReason };
    }
    return { ok: false, error: lastError, type: "retries_exhausted", attempts, provider: cfg.provider, model };
}

export function backoff(i, retry = RETRY) {
    const d = retry.baseDelayMs * Math.pow(2, i);
    return Math.min(retry.maxDelayMs, d) + Math.floor(Math.random() * 250);
}

function defaultSleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
