// Google Gemini generateContent builder.

export const GEMINI_MODELS = { best: "gemini-2.5-pro", fast: "gemini-2.5-flash" };

export function buildGeminiRequest(cfg, req) {
    const model = cfg.model || GEMINI_MODELS.fast;
    const base = (cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const contents = [];
    for (const m of req.messages) {
        const role = m.role === "assistant" ? "model" : "user";
        const text = String(m.content ?? "");
        if (contents.length && contents[contents.length - 1].role === role) {
            contents[contents.length - 1].parts[0].text += "\n" + text;
        } else {
            contents.push({ role, parts: [{ text }] });
        }
    }
    if (!contents.length) contents.push({ role: "user", parts: [{ text: "(begin)" }] });
    const body = {
        system_instruction: { parts: [{ text: req.systemStable + (req.systemDynamic ? "\n\n" + req.systemDynamic : "") }] },
        contents,
        generationConfig: { maxOutputTokens: req.maxTokens || cfg.maxTokens || 1024 },
    };
    if (cfg.temperature !== undefined) body.generationConfig.temperature = cfg.temperature;
    if (req.schema) {
        body.generationConfig.responseMimeType = "application/json";
        body.generationConfig.responseSchema = stripForGemini(req.schema);
    }
    return {
        uri: `${base}/models/${model}:generateContent`,
        method: "Post",
        headers: [
            { key: "Content-Type", value: "application/json" },
            { key: "x-goog-api-key", value: cfg.apiKey },
        ],
        body: JSON.stringify(body),
    };
}

// Gemini's responseSchema is an OpenAPI subset: no $schema, additionalProperties, etc.
function stripForGemini(schema) {
    if (Array.isArray(schema)) return schema.map(stripForGemini);
    if (!schema || typeof schema !== "object") return schema;
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
        if (k === "$schema" || k === "additionalProperties" || k === "const" || k === "default" || k === "examples") continue;
        out[k] = stripForGemini(v);
    }
    return out;
}

export function parseGeminiResponse(status, bodyText) {
    let json;
    try { json = JSON.parse(bodyText); } catch (e) { return { ok: false, error: `bad json (${status})`, retryable: status >= 500 }; }
    if (status !== 200 || json.error) {
        const msg = json?.error?.message || `http ${status}`;
        return { ok: false, error: msg, type: json?.error?.status, retryable: status === 429 || status >= 500 };
    }
    const cand = (json.candidates || [])[0];
    if (!cand) return { ok: false, error: json.promptFeedback?.blockReason || "no candidates", type: "blocked", retryable: false };
    if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") return { ok: false, error: "refusal", type: "refusal", retryable: false };
    const text = (cand.content?.parts || []).map(p => p.text || "").join("");
    const u = json.usageMetadata || {};
    return {
        ok: true,
        text,
        usage: { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, cacheRead: u.cachedContentTokenCount || 0, cacheWrite: 0 },
        model: json.modelVersion,
        stopReason: cand.finishReason,
    };
}
