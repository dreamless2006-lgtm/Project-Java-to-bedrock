import test from "node:test";
import assert from "node:assert/strict";
import { parseRoster, serializeRoster, ensureRoster, pickName, ringOffset, MAX_RESIDENTS } from "../packs/RealAI_BP/scripts/brain/roster.js";

const names = { prefix: ["Alex", "Sam"], nouns: ["Miner", "Builder"], suffix: ["X", ""], preset: ["Nova", "Ember", "Kai"] };
function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

test("roster round-trips and drops junk", () => {
    const { roster } = ensureRoster([], 3, { names, personalities: ["chatty"], voices: ["dry"], now: 1000, rng: seeded(1) });
    assert.equal(roster.length, 3);
    const back = parseRoster(serializeRoster(roster));
    assert.deepEqual(back.map(r => r.pid), roster.map(r => r.pid));
    assert.deepEqual(parseRoster("not json"), []);
    assert.deepEqual(parseRoster(JSON.stringify([{ pid: 1 }, { name: "x" }, { pid: "a", name: "A" }])).map(r => r.name), ["A"]);
});

test("ensureRoster grows, keeps existing members and shrinks from the end", () => {
    const rng = seeded(7);
    const a = ensureRoster([], 2, { names, now: 1, rng }).roster;
    const b = ensureRoster(a, 4, { names, now: 2, rng });
    assert.equal(b.changed, true);
    assert.deepEqual(b.roster.slice(0, 2), a);
    const c = ensureRoster(b.roster, 4, { names, now: 3, rng });
    assert.equal(c.changed, false);
    const d = ensureRoster(b.roster, 1, { names, now: 4, rng });
    assert.deepEqual(d.roster, [a[0]]);
    assert.equal(ensureRoster([], 99, { names, now: 5, rng }).roster.length, MAX_RESIDENTS);
});

test("names are unique, short and gamertag-safe", () => {
    const rng = seeded(3);
    const taken = [];
    for (let i = 0; i < 12; i++) { const n = pickName(names, taken, rng); assert.ok(!taken.includes(n)); assert.ok(n.length <= 16 && /^[A-Za-z0-9_ ]+$/.test(n)); taken.push(n); }
    assert.ok(/^Player\d{4}$/.test(pickName({}, [], rng)));
});

test("ring offsets stay within the ring", () => {
    for (let i = 0; i < 8; i++) { const { dx, dz } = ringOffset(i, 8, 6, 14, seeded(i)); const r = Math.hypot(dx, dz); assert.ok(r >= 6 && r <= 14.01); }
});
