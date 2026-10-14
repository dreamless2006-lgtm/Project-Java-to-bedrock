import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemory, loadMemory, addFact, forgetFact, addEpisode, addChat, notePerson, saveMemory, renderMemory, byteLength, MEMORY_LIMITS } from "../packs/AI_Sandbox_BP/scripts/brain/memory.js";

test("facts dedupe and forget", () => {
    const m = createMemory();
    addFact(m, "Steve lives north", 1);
    addFact(m, "steve LIVES north", 2);
    assert.equal(m.facts.length, 1);
    assert.equal(forgetFact(m, "lives"), 1);
});

test("episodes collapse repeats, chat is capped", () => {
    const m = createMemory();
    addEpisode(m, "hit by zombie", 1); addEpisode(m, "hit by zombie", 2);
    assert.equal(m.episodes.length, 1); assert.equal(m.episodes[0].n, 2);
    for (let i = 0; i < 40; i++) addChat(m, "A", "line " + i, i);
    assert.equal(m.chat.length, MEMORY_LIMITS.maxChat);
});

test("save shrinks to fit and round-trips", () => {
    const m = createMemory();
    for (let i = 0; i < 40; i++) addFact(m, "fact " + i + " " + "x".repeat(100), i);
    for (let i = 0; i < 30; i++) addEpisode(m, "ep " + i + " " + "y".repeat(100), i);
    for (let i = 0; i < 24; i++) addChat(m, "P" + i, "z".repeat(190), i);
    const s = saveMemory(m, 4000);
    assert.ok(byteLength(s) <= 4000);
    const back = loadMemory(s);
    assert.ok(back.facts.length >= 8);
    assert.deepEqual(loadMemory("garbage").facts, []);
});

test("render is compact and relative", () => {
    const m = createMemory();
    addFact(m, "home is at 10 64 10", 0);
    notePerson(m, "Alex", { relation: "friend", sympathy: 70 }, 1000);
    addEpisode(m, "built a hut", 5000);
    addChat(m, "Alex", "hey", 6000); addChat(m, "me", "yo", 7000, { self: true });
    const out = renderMemory(m, 67_000);
    assert.ok(out.includes("- home is at 10 64 10"));
    assert.ok(out.includes("- Alex: friend, likes me 70/100 (last seen 1m ago)"));
    assert.ok(out.includes("<me> yo"));
});
