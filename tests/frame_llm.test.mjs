import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFrames, decodeFrame, Reassembler, packMessage, unpackMessage } from "../packs/AI_Sandbox_BP/scripts/brain/frame.js";
import { runThink } from "../packs/AI_Sandbox_BP/scripts/brain/llm_core.js";

test("frames round-trip and reassemble out of order", () => {
    const text = packMessage({ t: "think", bot: "Zed", n: "x".repeat(1000), q: "a|b/c" });
    const frames = encodeFrames("id1", text, 300);
    assert.equal(frames.length, Math.ceil(text.length / 300));
    assert.ok(frames.every(f => f.length <= 300 + 30));
    const r = new Reassembler(() => 0);
    const shuffled = [frames[2], frames[0], frames[3], frames[1], ...frames.slice(4)];
    let out = null;
    for (const f of shuffled) { const got = r.push("/scriptevent aisb:in " + f); if (got) out = got; }
    assert.ok(out);
    assert.equal(out.text, text);
    assert.deepEqual(unpackMessage(out.text).q, "a|b/c");
    assert.equal(decodeFrame("garbage"), null);
    assert.equal(r.push("AIB1|z|2/2|tail"), null);
});

test("reassembler drops stale partials", () => {
    let t = 0;
    const r = new Reassembler(() => t, 1000);
    assert.equal(r.push("AIB1|q|1/2|a"), null);
    t = 5000;
    assert.equal(r.push("AIB1|q|2/2|b"), null); // old part swept, new partial started
    assert.equal(r.push("AIB1|q|1/2|a").text, "ab");
});

test("runThink: success, non-retryable error, retry then success, bad json", async () => {
    const turn = { systemStable: "S", systemDynamic: null, messages: [{ role: "user", content: "go" }] };
    const sleep = async () => {};
    const okBody = JSON.stringify({ choices: [{ message: { content: 'Here: {"say":"hi","actions":[{"type":"wait","seconds":3}]}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    let calls = 0;
    const r1 = await runThink({ provider: "openai", apiKey: "k" }, turn, async () => { calls++; return { status: 200, body: okBody }; }, sleep);
    assert.equal(r1.ok, true); assert.equal(r1.reply.say, "hi"); assert.equal(r1.reply.actions[0].type, "wait"); assert.equal(r1.usage.input, 10);
    const r2 = await runThink({ provider: "openai", apiKey: "k" }, turn, async () => ({ status: 401, body: JSON.stringify({ error: { message: "bad key" } }) }), sleep);
    assert.equal(r2.ok, false); assert.equal(r2.attempts, 1);
    let n = 0;
    const r3 = await runThink({ provider: "openai", apiKey: "k" }, turn, async () => (++n < 3 ? { status: 429, body: "{}" } : { status: 200, body: okBody }), sleep);
    assert.equal(r3.ok, true); assert.equal(r3.attempts, 3);
    const r4 = await runThink({ provider: "openai", apiKey: "k" }, turn, async () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: "no json here" } }] }) }), sleep);
    assert.equal(r4.ok, false); assert.equal(r4.type, "bad_json");
    const r5 = await runThink({ provider: "anthropic" }, turn, async () => ({ status: 200, body: "{}" }), sleep);
    assert.ok(r5.error.includes("no API key"));
    const r6 = await runThink({ provider: "openai", apiKey: "k" }, turn, async () => { throw new Error("boom"); }, sleep, { attempts: 2, baseDelayMs: 0, maxDelayMs: 0, timeoutSec: 1 });
    assert.equal(r6.type, "retries_exhausted"); assert.equal(r6.attempts, 2);
});
