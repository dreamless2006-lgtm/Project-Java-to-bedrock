import { test } from "node:test";
import assert from "node:assert/strict";
import { stripJsonComments } from "../tools/check.mjs";

test("stripJsonComments removes line and block comments but keeps strings", () => {
    const src = '{ "a": "http://x//y", /* c */ "b": 1 // tail\n }';
    assert.deepEqual(JSON.parse(stripJsonComments(src)), { a: "http://x//y", b: 1 });
});

test("stripJsonComments keeps escaped quotes inside strings", () => {
    const src = '{ "a": "say \\"hi\\" // not a comment" }';
    assert.deepEqual(JSON.parse(stripJsonComments(src)), { a: 'say "hi" // not a comment' });
});
