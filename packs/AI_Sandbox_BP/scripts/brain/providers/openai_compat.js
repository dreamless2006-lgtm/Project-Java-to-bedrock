// OpenAI-compatible chat completions builder. Used for OpenAI, xAI (Grok),
// OpenRouter, Player2, Ollama, LM Studio and any other /v1/chat/completions server.

export const OPENAI_COMPAT_PRESETS = {
    openai:     { baseUrl: "https://api.openai.com/v1",       model: "gpt-5-mini",   jsonMode: "json_schema" },
    xai:        { baseUrl: "https://api.x.ai/v1",             model: "grok-4-fast",  jsonMode: "json_schema" },
    openrouter: { baseUrl: "https://openrouter.ai/api/v1",    model: "openai/gpt-5-mini", jsonMode: "json_object" },
    player2:    { baseUrl: "http://127.0.0.1:4315/v1",        model: "",             jsonMode: "none", authHeader: "player2-game-key" },
    ollama:     { baseUrl: "http://127.0.0.1:11434/v1",       model: "llama3.1",     jsonMode: "json_object" },
    lmstudio:   { baseUrl: "http://127.0.0.1:1234/v1",        model: "",             jsonMode: "json_object" },
    custom:     { baseUrl: "",                                model: "",             jsonMode: "json_object" },
};

export function buildOpenAICompatRequest(cfg, req) {
    const preset = OPENAI_COMPAT_PRESETS[cfg.provider] || OPENAI_COMPAT_PRESETS.custom;
    const baseUrl = (cfg.baseUrl || preset.baseUrl).replace(/\/$/, "");
    const model = cfg.model || preset.model;
    const messages = [
        { role: "system", content: req.systemStable + (req.systemDynamic ? "\n\n" + req.systemDynamic : "") },
        ...req.messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") })),
    ];
    const body = { model, messages, max_tokens: req.maxTokens || cfg.maxTokens || 1024 };
    if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
    const jsonMode = cfg.jsonMode || preset.jsonMode;
    if (req.schema && jsonMode === "json_schema") {
        body.response_format = { type: "json_schema", json_schema: { name: req.schemaName || "brain", schema: req.schema, strict: false } };
    } else if (req.schema && jsonMode === "json_object") {
        body.response_format = { type: "json_object" };
    }
    if (cfg.provider === "openai" && cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
    const headers = [{ key: "Content-Type", value: "application/json" }];
    const authHeader = cfg.authHeader || preset.authHeader;
    if (cfg.apiKey) {
        // On a dedicated server the key is an opaque SecretString that must already hold
        // the full header value ("Bearer sk-..."); a plain string gets the prefix added here.
        const raw = typeof cfg.apiKey !== "string";
        if (authHeader) headers.push({ key: authHeader, value: cfg.apiKey });
        else headers.push({ key: "Authorization", value: raw || /^Bearer /i.test(cfg.apiKey) ? cfg.apiKey : "Bearer " + cfg.apiKey });
    }
    if (cfg.provider === "openrouter") {
        headers.push({ key: "HTTP-Referer", value: "https://github.com/ai-sandbox-bedrock" });
        headers.push({ key: "X-Title", value: "AI Sandbox for Minecraft Bedrock" });
    }
    return { uri: baseUrl + "/chat/completions", method: "Post", headers, body: JSON.stringify(body) };
}

export function parseOpenAICompatResponse(status, bodyText) {
    let json;
    try { json = JSON.parse(bodyText); } catch (e) { return { ok: false, error: `bad json (${status})`, retryable: status >= 500 }; }
    if (status !== 200 || json.error) {
        const msg = json?.error?.message || (typeof json?.error === "string" ? json.error : `http ${status}`);
        return { ok: false, error: msg, type: json?.error?.type || json?.error?.code, retryable: status === 429 || status >= 500 };
    }
    const choice = (json.choices || [])[0];
    const msg = choice?.message;
    let text = "";
    if (typeof msg?.content === "string") text = msg.content;
    else if (Array.isArray(msg?.content)) text = msg.content.map(p => p.text || "").join("");
    if (msg?.refusal) return { ok: false, error: "refusal", type: "refusal", retryable: false };
    const u = json.usage || {};
    return {
        ok: true,
        text,
        usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, cacheRead: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 },
        model: json.model,
        stopReason: choice?.finish_reason,
    };
}
