import { test } from "node:test";
import assert from "node:assert/strict";
import { callProvider } from "../bridge/index.mjs";

const baseCfg = { _path: "test", defaults: { provider: "openai" }, providers: { openai: { apiKey: "sk-test", model: "gpt-test" }, anthropic: {} } };
const turn = { systemStable: "S", systemDynamic: null, messages: [{ role: "user", content: "hi" }] };

test("callProvider builds a request, calls fetch and parses the reply", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 }, model: "gpt-test" }) };
    };
    try {
        const res = await callProvider(baseCfg, { provider: "openai" }, turn, 5);
        assert.equal(res.ok, true);
        assert.equal(res.text, '{"actions":[]}');
        assert.equal(res.usage.input, 5);
        assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
        assert.equal(calls[0].init.method, "POST");
        assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.model, "gpt-test");
        assert.equal(body.messages[0].role, "system");
    } finally { globalThis.fetch = realFetch; }
});

test("callProvider reports a missing key and retries on 429", async () => {
    const r1 = await callProvider(baseCfg, { provider: "anthropic" }, turn, 5);
    assert.equal(r1.ok, false); assert.ok(/no API key/.test(r1.error));
    const realFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async () => { n++; return n < 2 ? { status: 429, headers: { get: () => "0" }, text: async () => "{}" } : { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }) }; };
    try {
        const r2 = await callProvider(baseCfg, { provider: "openai" }, turn, 5);
        assert.equal(r2.ok, true); assert.equal(r2.attempts, 2);
    } finally { globalThis.fetch = realFetch; }
});
