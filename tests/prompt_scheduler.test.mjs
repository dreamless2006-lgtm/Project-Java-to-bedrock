import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemStable, renderObservation, buildTurn, renderWorldContent, promptHash } from "../packs/AI_Sandbox_BP/scripts/brain/prompt.js";
import { createSchedulerState, noteEvent, shouldThink, beginThink, endThink, CADENCE } from "../packs/AI_Sandbox_BP/scripts/brain/scheduler.js";
import { createMemory, addFact } from "../packs/AI_Sandbox_BP/scripts/brain/memory.js";

test("system prompt is deterministic and includes persona, actions, world content", () => {
    const a = buildSystemStable({ persona: { name: "Zed", faction: "good" }, worldContent: renderWorldContent({ blocks: ["srp:infested_stone"], entities: ["srp:grunt", "srp:crux"], descriptions: { "srp:grunt": "small parasite" } }) });
    const b = buildSystemStable({ persona: { name: "Zed", faction: "good" }, worldContent: renderWorldContent({ blocks: ["srp:infested_stone"], entities: ["srp:crux", "srp:grunt"], descriptions: { "srp:grunt": "small parasite" } }) });
    assert.equal(a, b);
    assert.ok(a.includes("Name: Zed"));
    assert.ok(a.includes("- gather("));
    assert.ok(a.includes("srp:grunt (small parasite)"));
    assert.equal(promptHash(a), promptHash(b));
});

test("observation renders the important lines and the turn ends with the user message", () => {
    const obs = { position: { x: 1.4, y: 64.9, z: -3 }, timeOfDay: "night", dimension: "overworld", health: 7, hunger: 3, inventory: ["oak_log x12"], hostiles: ["zombie 6m west"], newChat: [{ from: "Alex", text: "hey Zed come here" }], problems: ["unknown action 'fly'"] };
    const text = renderObservation(obs);
    assert.ok(text.includes("Position: 1 65 -3"));
    assert.ok(text.includes("Threats: zombie 6m west"));
    assert.ok(text.includes("<Alex> hey Zed come here"));
    assert.ok(text.includes("unknown action 'fly'"));
    const mem = createMemory(); addFact(mem, "base at 0 64 0", 0);
    const turn = buildTurn({ systemStable: "S", memory: mem, now: 1000, obs, history: [{ role: "user", content: "a" }, { role: "assistant", content: "{}" }] });
    assert.equal(turn.messages.length, 3);
    assert.ok(turn.messages[2].content.includes("# Memory"));
    assert.ok(turn.messages[2].content.endsWith("Reply with the JSON object now."));
});

test("scheduler: events pull the think forward, budget hard pauses, failures back off", () => {
    const s = createSchedulerState();
    s.nextThink = 10_000;
    assert.equal(shouldThink(s, 500), false);
    noteEvent(s, { type: "chat_mention", text: "hi" }, 500);
    assert.equal(s.nextThink, 500 + CADENCE.ok.chat);
    assert.equal(shouldThink(s, 500 + CADENCE.ok.chat), true);
    assert.equal(shouldThink(s, 500 + CADENCE.ok.chat, "hard"), false);
    const ev = beginThink(s, 600);
    assert.equal(ev.length, 1);
    assert.equal(shouldThink(s, 700), false);
    endThink(s, 700, false, false);
    assert.equal(s.consecutiveFailures, 1);
    s.consecutiveFailures = 3;          // backoff = 10s * 2^2 = 800 ticks after lastThink (600)
    s.nextThink = 0;
    assert.equal(shouldThink(s, 1300), false);
    assert.equal(shouldThink(s, 1400), true);
    endThink(s, 1400, true, true);
    assert.equal(s.consecutiveFailures, 0);
    assert.equal(s.active, true);
});
