import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, PROVIDER_IDS } from "../packs/RealAI_BP/scripts/brain/providers/index.js";

const req = {
    systemStable: "You are a bot.",
    systemDynamic: "Tick 5.",
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "{}" }, { role: "user", content: "go" }],
    schema: { type: "object", properties: { say: { type: "string" } }, required: ["say"], additionalProperties: false },
    maxTokens: 300,
};

test("every provider builds a POST with a JSON body", () => {
    for (const id of PROVIDER_IDS) {
        const p = PROVIDERS[id];
        const r = p.build({ provider: id, apiKey: "k", baseUrl: id === "custom" ? "http://x/v1" : undefined }, req);
        assert.equal(r.method, "Post", id);
        assert.ok(r.uri.startsWith("http"), id + " uri " + r.uri);
        const body = JSON.parse(r.body);
        assert.ok(body, id);
        assert.ok(r.headers.some(h => h.key === "Content-Type"), id);
    }
});

test("anthropic: cache_control on stable system block, json schema output, alternating turns", () => {
    const r = PROVIDERS.anthropic.build({ apiKey: "k" }, { ...req, messages: [{ role: "assistant", content: "first?" }, { role: "user", content: "a" }, { role: "user", content: "b" }] });
    const b = JSON.parse(r.body);
    assert.equal(b.system[0].cache_control.type, "ephemeral");
    assert.equal(b.output_config.format.type, "json_schema");
    assert.equal(b.messages[0].role, "user");
    assert.deepEqual(b.messages.map(m => m.role), ["user", "assistant", "user"]);
    assert.equal(b.messages[2].content, "a\nb");
    assert.ok(r.headers.find(h => h.key === "x-api-key").value === "k");
    assert.ok(r.headers.find(h => h.key === "anthropic-version"));
});

test("anthropic: parses text, usage and refusal", () => {
    const ok = PROVIDERS.anthropic.parse(200, JSON.stringify({ content: [{ type: "text", text: '{"say":"yo"}' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, stop_reason: "end_turn", model: "m" }));
    assert.equal(ok.ok, true); assert.equal(ok.text, '{"say":"yo"}'); assert.equal(ok.usage.input, 110); assert.equal(ok.usage.cacheRead, 100);
    const ref = PROVIDERS.anthropic.parse(200, JSON.stringify({ content: [], stop_reason: "refusal", usage: {} }));
    assert.equal(ref.ok, false); assert.equal(ref.type, "refusal");
    const rl = PROVIDERS.anthropic.parse(429, JSON.stringify({ error: { type: "rate_limit_error", message: "slow down" } }));
    assert.equal(rl.retryable, true);
});

test("openai-compatible presets and parse", () => {
    const r = PROVIDERS.xai.build({ provider: "xai", apiKey: "k" }, req);
    assert.equal(r.uri, "https://api.x.ai/v1/chat/completions");
    const b = JSON.parse(r.body);
    assert.equal(b.response_format.type, "json_schema");
    assert.equal(b.messages[0].role, "system");
    assert.ok(r.headers.find(h => h.key === "Authorization").value.startsWith("Bearer "));
    const p2 = PROVIDERS.player2.build({ provider: "player2", apiKey: "gk" }, req);
    assert.equal(p2.uri, "http://127.0.0.1:4315/v1/chat/completions");
    assert.ok(p2.headers.find(h => h.key === "Authorization").value === "Bearer gk");
    assert.equal(JSON.parse(p2.body).model, undefined);
    const p2c = PROVIDERS.player2cloud.build({ provider: "player2cloud", apiKey: "tok" }, req);
    assert.equal(p2c.uri, "https://api.player2.game/v1/chat/completions");
    const parsed = PROVIDERS.openai.parse(200, JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    assert.equal(parsed.ok, true); assert.equal(parsed.usage.input, 3);
    const err = PROVIDERS.openai.parse(401, JSON.stringify({ error: { message: "bad key", type: "invalid_request_error" } }));
    assert.equal(err.ok, false); assert.equal(err.retryable, false);
});

test("gemini: schema stripped of additionalProperties, roles mapped, parse", () => {
    const r = PROVIDERS.gemini.build({ apiKey: "k" }, req);
    const b = JSON.parse(r.body);
    assert.ok(r.uri.includes(":generateContent"));
    assert.equal(b.generationConfig.responseMimeType, "application/json");
    assert.equal(b.generationConfig.responseSchema.additionalProperties, undefined);
    assert.deepEqual(b.contents.map(c => c.role), ["user", "model", "user"]);
    const parsed = PROVIDERS.gemini.parse(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } }));
    assert.equal(parsed.ok, true); assert.equal(parsed.text, "{}");
});
