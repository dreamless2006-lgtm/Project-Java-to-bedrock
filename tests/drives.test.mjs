import test from "node:test";
import assert from "node:assert/strict";
import { createDrives, updateDrives, renderDrives, cadenceFactor, DRIVE_NAMES } from "../packs/RealAI_BP/scripts/brain/drives.js";
import { createMemory, setSelf, setPlans, renderMemory, loadMemory, saveMemory } from "../packs/RealAI_BP/scripts/brain/memory.js";
import { normalizeReply } from "../packs/RealAI_BP/scripts/brain/action_schema.js";
import { renderObservation, REPLY_FORMAT, RULES } from "../packs/RealAI_BP/scripts/brain/prompt.js";
import { createSchedulerState, beginThink, CADENCE } from "../packs/RealAI_BP/scripts/brain/scheduler.js";

const MIN = 60_000;

test("drives move with what happens and stay in range", () => {
    const d = createDrives(0);
    updateDrives(d, { talked: false, night: false, idle: true }, 10 * MIN);
    assert.ok(d.social > 25 && d.boredom > 0, "lonelier and bored after ten quiet idle minutes");
    for (const k of DRIVE_NAMES) assert.ok(d[k] >= 0 && d[k] <= 100);
    updateDrives(d, { talked: true, idle: false, progressed: true, hasGoal: true }, 11 * MIN);
    assert.ok(d.social < 50 && d.boredom === 0, "company and action lower the social need and reset boredom");
    updateDrives(d, { night: true, threats: 3, health: 0.2 }, 30 * MIN);
    assert.ok(d.rest > 50 && d.safety >= 90, "night without sleep makes it tired; threats and low health make it unsafe");
    updateDrives(d, { slept: true, newPlace: true }, 31 * MIN);
    assert.equal(d.rest, 0);
});

test("feelings render only what is notable and shorten the cadence", () => {
    const d = createDrives(0);
    assert.equal(renderDrives(d), "You feel settled and at ease.");
    d.social = 80; d.boredom = 50;
    const line = renderDrives(d);
    assert.ok(line.includes("lonely") && line.includes("a little bored"));
    assert.equal(cadenceFactor(d), 0.75);
    d.boredom = 90; assert.equal(cadenceFactor(d), 0.5);
    const s = createSchedulerState();
    beginThink(s, 1000, "ok", 0.5);
    assert.equal(s.nextThink, 1000 + CADENCE.ok.idle / 2);
});

test("self and plans live in memory and survive a save/load", () => {
    const m = createMemory();
    assert.equal(setSelf(m, "  I am a builder who looks after newcomers. "), true);
    assert.equal(setPlans(m, ["finish the tower", "", 42, "find diamonds"]), true);
    assert.deepEqual(m.plans, ["finish the tower", "find diamonds"]);
    const back = loadMemory(saveMemory(m));
    assert.equal(back.self, "I am a builder who looks after newcomers.");
    const text = renderMemory(back, 1000);
    assert.ok(text.startsWith("Who I am: I am a builder") && text.includes("1. finish the tower"));
});

test("reply contract carries self and plans; observation shows feelings", () => {
    const r = normalizeReply({ actions: [], self: " growing fond of Steve ", plans: ["a", "", "b"], remember: [] });
    assert.equal(r.self, "growing fond of Steve");
    assert.deepEqual(r.plans, ["a", "b"]);
    assert.equal(normalizeReply({ actions: [] }).self, null);
    assert.ok(REPLY_FORMAT.includes('"self"') && REPLY_FORMAT.includes('"plans"'));
    assert.ok(RULES.includes("Inner life"));
    const obs = renderObservation({ timeOfDay: "dawn", feelings: "You feel lonely, you want company or a chat.", inventory: [] });
    assert.ok(obs.includes("You feel lonely"));
});
