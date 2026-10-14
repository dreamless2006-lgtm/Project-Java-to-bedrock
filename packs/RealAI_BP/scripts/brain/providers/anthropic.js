// Anthropic Messages API request builder. Pure: returns {uri, method, headers, body}
// for the transport (server-net HttpRequest on BDS, fetch() in the bridge).
// Facts: https://platform.claude.com/docs - headers x-api-key + anthropic-version,
// system as an array of text blocks so the big stable block can carry
// cache_control, structured output via output_config.format (json_schema).

const DEFAULT_MODEL = "claude-haiku-5-5";     // the fast one: decisions in a second or two
export const ANTHROPIC_MODELS = {
    best: "claude-opus-5-5",
    fast: "claude-haiku-5-5",
    balanced: "claude-sonnet-5-5",
};

export function buildAnthropicRequest(cfg, req) {
    const model = cfg.model || DEFAULT_MODEL;
    const body = {
        model,
        max_tokens: req.maxTokens || cfg.maxTokens || 1024,
        system: [
            // Stable prefix first so prompt caching hits across every tick and bot.
            { type: "text", text: req.systemStable, cache_control: { type: "ephemeral" } },
            ...(req.systemDynamic ? [{ type: "text", text: req.systemDynamic }] : []),
        ],
        messages: toAnthropicMessages(req.messages),
    };
    if (req.schema) {
        body.output_config = { format: { type: "json_schema", schema: req.schema } };
    }
    if (cfg.effort) {
        body.output_config = { ...(body.output_config || {}), effort: cfg.effort };
    }
    return {
        uri: (cfg.baseUrl || "https://api.anthropic.com") + "/v1/messages",
        method: "Post",
        headers: [
            { key: "Content-Type", value: "application/json" },
            { key: "anthropic-version", value: "2023-06-01" },
            { key: "x-api-key", value: cfg.apiKey },
        ],
        body: JSON.stringify(body),
    };
}

function toAnthropicMessages(messages) {
    // Anthropic requires strictly alternating user/assistant turns starting with user.
    const out = [];
    for (const m of messages) {
        const role = m.role === "assistant" ? "assistant" : "user";
        const text = String(m.content ?? "");
        if (out.length && out[out.length - 1].role === role) {
            out[out.length - 1].content += "\n" + text;
        } else {
            out.push({ role, content: text });
        }
    }
    if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(begin)" });
    if (out[out.length - 1].role !== "user") out.push({ role: "user", content: "(continue)" });
    return out;
}

export function parseAnthropicResponse(status, bodyText) {
    let json;
    try { json = JSON.parse(bodyText); } catch (e) { return { ok: false, error: `bad json (${status})`, retryable: status >= 500 }; }
    if (status !== 200) {
        const msg = json?.error?.message || `http ${status}`;
        return { ok: false, error: msg, type: json?.error?.type, retryable: status === 429 || status === 529 || status >= 500 };
    }
    if (json.stop_reason === "refusal") {
        return { ok: false, error: "refusal", type: "refusal", retryable: false, usage: usageOf(json) };
    }
    const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return { ok: true, text, usage: usageOf(json), model: json.model, stopReason: json.stop_reason };
}

function usageOf(json) {
    const u = json.usage || {};
    return {
        input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
    };
}
