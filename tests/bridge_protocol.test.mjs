import { test } from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../bridge/index.mjs";
import { Reassembler, encodeFrames, packMessage, unpackMessage } from "../packs/RealAI_BP/scripts/brain/frame.js";

function makeBridge() {
    const cfg = { _path: "t", defaults: { provider: "openai" }, providers: { openai: { apiKey: "k", model: "m" } }, chatRelay: true, maxConcurrentThinks: 2, requestTimeoutSeconds: 5, anchor: { enabled: false } };
    const b = new Bridge(cfg);
    b.client = { username: "RealAIBridge", queue: () => {} };
    return b;
}

// Drain the bridge's command queue and reassemble the addon-side messages it would receive.
function drain(b) {
    const r = new Reassembler(() => 0);
    const out = [];
    while (b.outQueue.length) {
        const cmd = b.outQueue.shift();
        if (cmd.startsWith("/scriptevent realai:cmdfor ")) continue;
        assert.ok(cmd.startsWith("/scriptevent realai:in "), cmd);
        assert.ok(cmd.length <= 512, "command too long: " + cmd.length);
        const got = r.push(cmd);
        if (got) out.push(unpackMessage(got.text));
    }
    return out;
}

test("think without a cached system prompt asks for it, then answers with a result", async () => {
    const b = makeBridge();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"say":"hello","actions":[]}' } }], usage: { prompt_tokens: 50, completion_tokens: 8 }, model: "m" }) });
    try {
        // addon -> bridge frames arrive as 'text' packets
        const think = { t: "think", turnId: "t1", bot: "Zed", cfg: { provider: "openai" }, sysHash: "abc", messages: [{ role: "user", content: "obs" }] };
        for (const f of encodeFrames("o1", packMessage(think), 900)) b.onText({ type: "raw", message: f });
        await new Promise(r => setTimeout(r, 20));
        let msgs = drain(b);
        assert.deepEqual(msgs, [{ t: "need_sys", turnId: "t1" }]);
        // resend with the system prompt (long, so it spans several frames)
        const withSys = { ...think, sys: "SYSTEM ".repeat(400) };
        for (const f of encodeFrames("o2", packMessage(withSys), 900)) b.onText({ type: "raw", message: f });
        await new Promise(r => setTimeout(r, 50));
        msgs = drain(b);
        assert.equal(msgs.length, 1);
        assert.equal(msgs[0].t, "result"); assert.equal(msgs[0].turnId, "t1"); assert.equal(msgs[0].ok, true);
        assert.equal(msgs[0].text, '{"say":"hello","actions":[]}');
        assert.equal(msgs[0].usage.input, 50);
    } finally { globalThis.fetch = realFetch; }
});

test("public chat is relayed, !ai lines become relayed commands, own lines are ignored", () => {
    const b = makeBridge();
    b.onText({ type: "chat", source_name: "Steve", message: "hi Zed" });
    b.onText({ type: "chat", source_name: "Steve", message: "!ai status" });
    b.onText({ type: "chat", source_name: "RealAIBridge", message: "ignored" });
    const cmds = b.outQueue.slice();
    assert.ok(cmds.some(c => c.includes("realai:cmdfor Steve|status")));
    const msgs = drain(b);
    assert.deepEqual(msgs.filter(m => m && m.t === "chat_in"), [{ t: "chat_in", from: "Steve", text: "hi Zed" }]);
});
