import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReply, validateAction, renderActionDocs, ACTION_NAMES, REPLY_SCHEMA, MAX_ACTIONS } from "../packs/AI_Sandbox_BP/scripts/brain/action_schema.js";

test("normalizeReply accepts a good reply and clamps", () => {
    const r = normalizeReply({ thought: "x".repeat(500), say: "§chello\nthere", mood: "happy", goal: "build a house", actions: [{ type: "move_to", x: "1", y: 64, z: 3 }, { type: "gather", material: "oak_log", amount: 999 }], remember: ["Steve lives north"] });
    assert.equal(r.thought.length, 200);
    assert.equal(r.say, "hello there");
    assert.equal(r.mood, "happy");
    assert.deepEqual(r.actions[0], { type: "move_to", x: 1, y: 64, z: 3 });
    assert.equal(r.actions[1].amount, 64);
    assert.deepEqual(r.remember, ["Steve lives north"]);
    assert.deepEqual(r.problems, []);
});

test("normalizeReply reports problems instead of throwing", () => {
    const r = normalizeReply({ mood: "weird", actions: [{ type: "fly" }, { type: "attack" }, "junk", { type: "travel", dimension: "Nether" }] });
    assert.equal(r.mood, null);
    assert.deepEqual(r.actions, [{ type: "travel", dimension: "nether" }]);
    assert.equal(r.problems.length, 4);
    assert.deepEqual(normalizeReply("nope").actions, []);
});

test("too many actions are dropped with a note", () => {
    const acts = Array.from({ length: MAX_ACTIONS + 2 }, () => ({ type: "wait", seconds: 5 }));
    const r = normalizeReply({ actions: acts });
    assert.equal(r.actions.length, MAX_ACTIONS);
    assert.ok(r.problems[0].includes("more than"));
});

test("build blueprint is filtered to the allowed box", () => {
    const v = validateAction({ type: "build", preset: "custom", blueprint: [{ dx: 0, dy: 0, dz: 0, block: "minecraft:stone" }, { dx: 50, dy: 0, dz: 0 }, { dx: 1, dy: -1, dz: 0 }, "x"] });
    assert.equal(v.ok, true);
    assert.deepEqual(v.action.blueprint, [{ dx: 0, dy: 0, dz: 0, block: "minecraft:stone" }]);
    assert.equal(validateAction({ type: "build", preset: "custom" }).ok, false);
});

test("docs and schema cover every action", () => {
    const docs = renderActionDocs();
    for (const n of ACTION_NAMES) assert.ok(docs.includes(`- ${n}(`), n);
    assert.deepEqual(REPLY_SCHEMA.properties.actions.items.properties.type.enum, ACTION_NAMES);
});
