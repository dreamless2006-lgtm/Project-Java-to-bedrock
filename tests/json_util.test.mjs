import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonText, parseJsonLoose, stableStringify, clip } from "../packs/AI_Sandbox_BP/scripts/brain/json_util.js";

test("extracts fenced json", () => {
    const t = 'Sure! ```json\n{"say": "hi", "actions": []}\n``` done';
    assert.equal(extractJsonText(t), '{"say": "hi", "actions": []}');
});

test("extracts first balanced object with braces in strings", () => {
    const t = 'x {"a": "b}c", "n": {"d": 1}} trailing {"other": 1}';
    assert.deepEqual(parseJsonLoose(t), { a: "b}c", n: { d: 1 } });
});

test("repairs trailing commas and unclosed objects", () => {
    assert.deepEqual(parseJsonLoose('{"a": [1,2,],}'), { a: [1, 2] });
    assert.deepEqual(parseJsonLoose('{"say": "hello", "actions": [{"type": "move"'), { say: "hello", actions: [{ type: "move" }] });
});

test("returns null for no json", () => {
    assert.equal(parseJsonLoose("just words"), null);
});

test("stableStringify sorts keys recursively", () => {
    assert.equal(stableStringify({ b: 1, a: { d: 1, c: [ { z: 1, y: 2 } ] } }), '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}');
});

test("clip cuts at a word boundary", () => {
    assert.equal(clip("hello brave new world", 12), "hello brave…");
});
