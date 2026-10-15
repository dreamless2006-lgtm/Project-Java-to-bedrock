import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFrames, decodeFrame, Reassembler, packMessage, unpackMessage } from "../packs/RealAI_BP/scripts/brain/frame.js";
import { runThink } from "../packs/RealAI_BP/scripts/brain/llm_core.js";

test("frames round-trip and reassemble out of order", () => {
    const text = packMessage({ t: "think", bot: "Zed", n: "x".repeat(1000), q: "a|b/c" });
    const frames = encodeFrames("id1", text, 300);
    assert.equal(frames.length, Math.ceil(text.length / 300));
    assert.ok(frames.every(f => f.length <= 300 + 30));
    const r = new Reassembler(() => 0);
    const shuffled = [frames[2], frames[0], frames[3], frames[1], ...frames.slice(4)];
    let out = null;
    for (const f of shuffled) { const got = r.push("/scriptevent realai:in " + f); if (got) out = got; }
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

// ---- the frame reader is fed by anyone who can put a line in a chat: its limits are enforced here, not left to a catch-all ---------
import { decodeFrame as decodeFrameCap, Reassembler as ReassemblerCap, MAX_FRAMES, MAX_PARTIAL } from "../packs/RealAI_BP/scripts/brain/frame.js";

test("frames with absurd counts, indexes or ids are not frames", () => {
    assert.equal(decodeFrameCap("AIB1|x|1/99999999999|a"), null);
    assert.equal(decodeFrameCap(`AIB1|x|1/${MAX_FRAMES + 1}|a`), null);
    assert.ok(decodeFrameCap(`AIB1|x|1/${MAX_FRAMES}|a`));
    assert.equal(decodeFrameCap("AIB1|x|3/2|a"), null);
    assert.equal(decodeFrameCap("AIB1|x|0/2|a"), null);
    assert.equal(decodeFrameCap("AIB1|x|1/0|a"), null);
    assert.equal(decodeFrameCap("AIB1|" + "i".repeat(41) + "|1/1|a"), null);
    assert.ok(decodeFrameCap("AIB1|" + "i".repeat(40) + "|1/1|a"));
    assert.equal(decodeFrameCap("AIB1|x|1/-2|a"), null);
    assert.equal(decodeFrameCap("AIB1|x|1/1e3|a"), null);
});

test("the reassembler keeps a bounded number of half-finished messages and refuses a frame that disagrees about the count", () => {
    const r = new ReassemblerCap(() => 1000);
    for (let i = 0; i < MAX_PARTIAL + 30; i++) r.push(`AIB1|junk${i}|1/2|x`);
    assert.ok(r.partial.size <= MAX_PARTIAL, "bounded: " + r.partial.size);
    // a legitimate message still completes after a flood of junk
    assert.equal(r.push("AIB1|real|1/2|ab"), null);
    assert.deepEqual(r.push("AIB1|real|2/2|cd"), { id: "real", text: "abcd" });
    const q = new ReassemblerCap(() => 1000);
    q.push("AIB1|m|1/2|a");
    assert.equal(q.push("AIB1|m|2/3|b"), null, "a second frame with another count is dropped");
    assert.deepEqual(q.push("AIB1|m|2/2|b"), { id: "m", text: "ab" });
});

test("a message of tens of kilobytes still fits in the frame limits (the longest system prompt, in the addon's own chunks)", () => {
    const text = "x".repeat(120_000);
    const frames = encodeFrames("big", text, 900);
    assert.ok(frames.length <= MAX_FRAMES, frames.length + " frames");
    const r = new ReassemblerCap();
    let out = null; for (const f of frames) out = r.push(f) || out;
    assert.equal(out.text.length, 120_000);
});
