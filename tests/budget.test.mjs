import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetLedger, estimateCostMillicents, formatUsd } from "../packs/RealAI_BP/scripts/brain/budget.js";

function mem() { let v; return { get: () => v, set: s => { v = s; } }; }

test("cost estimate uses cache read pricing", () => {
    const mc = estimateCostMillicents("anthropic", "claude-haiku-5-5", { input: 1_000_000, output: 0, cacheRead: 1_000_000 });
    assert.equal(mc, Math.round(0.01 * 100 * 1000));
    assert.equal(estimateCostMillicents("ollama", "x", { input: 5000, output: 100 }), 0);
});

test("ledger windows, levels and persistence", () => {
    let t = 1_000_000_000;
    const store = mem();
    const l = new BudgetLedger(store, () => t, { windowMinutes: 10, softTokens: 1000, hardTokens: 2000 });
    l.record("openai", "gpt", { input: 500, output: 100 }, "Bob");
    assert.equal(l.level(), "ok");
    l.record("openai", "gpt", { input: 500, output: 0 }, "Bob");
    assert.equal(l.level(), "soft");
    t += 60_000;
    l.record("openai", "gpt", { input: 1000, output: 0 }, "Bob");
    assert.equal(l.level(), "hard");
    assert.equal(l.window().calls, 3);
    t += 11 * 60_000;
    assert.equal(l.level(), "ok");
    assert.equal(l.status().lifetimeTokens, 2100);
    const l2 = new BudgetLedger(store, () => t, { windowMinutes: 10 });
    assert.equal(l2.status().lifetimeTokens, 2100);
    l2.reset();
    assert.equal(l2.window().tokens, 0);
});

test("formatUsd", () => {
    assert.equal(formatUsd(1.5), "$1.50");
    assert.equal(formatUsd(0.0123), "1.2¢");
});
