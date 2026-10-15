import test from "node:test";
import assert from "node:assert/strict";
import { findPath } from "../packs/RealAI_BP/scripts/brain/path.js";

// A flat world: ground at y = 63, air above; extra blocks via set().
function makeWorld() {
    const blocks = new Map();
    const set = (x, y, z, id) => blocks.set(`${x},${y},${z}`, id);
    const at = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y <= 63 ? "minecraft:stone" : "minecraft:air");
    return { set, at };
}
const last = (p) => p.path[p.path.length - 1];

test("open ground: a straight path with few waypoints", () => {
    const w = makeWorld();
    const r = findPath(w.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 });
    assert.ok(r.ok, r.reason);
    assert.ok(r.path.length <= 3, "smoothed: " + r.path.length);
    assert.ok(Math.abs(last(r).x - 10.5) <= 1 && last(r).y === 64);
});

test("walks around a wall instead of through it", () => {
    const w = makeWorld();
    for (let z = -4; z <= 4; z++) for (let y = 64; y <= 66; y++) w.set(5, y, z, "minecraft:stone_bricks");
    const r = findPath(w.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 });
    assert.ok(r.ok, r.reason);
    assert.ok(r.path.some(p => Math.abs(p.z) >= 4.5), "goes round the end of the wall");
    assert.ok(r.path.every(p => !(Math.floor(p.x) === 5 && Math.abs(p.z) <= 4.5)), "never inside the wall");
});

test("steps up one block (a jump) and down a drop, but not off a cliff", () => {
    const w = makeWorld();
    for (let x = 3; x <= 6; x++) for (let z = -3; z <= 3; z++) w.set(x, 64, z, "minecraft:dirt");   // a one-block-high plateau
    let r = findPath(w.at, { x: 0.5, y: 64, z: 0.5 }, { x: 4.5, y: 65, z: 0.5 });
    assert.ok(r.ok && last(r).y === 65, "climbs the plateau: " + JSON.stringify(r));
    r = findPath(w.at, { x: 4.5, y: 65, z: 0.5 }, { x: 9.5, y: 64, z: 0.5 });
    assert.ok(r.ok && last(r).y === 64, "drops back down");
    const cliff = makeWorld();
    for (let x = 5; x <= 20; x++) for (let z = -20; z <= 20; z++) for (let y = 58; y <= 63; y++) cliff.set(x, y, z, "minecraft:air");   // a six-block hole beyond x = 5
    r = findPath(cliff.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 58, z: 0.5 }, { maxNodes: 600 });
    assert.ok(!r.ok, "no six-block drop");
});

test("never through lava, over water only when allowed", () => {
    const w = makeWorld();
    for (let z = -6; z <= 6; z++) w.set(5, 63, z, "minecraft:lava");
    for (let z = -6; z <= 6; z++) w.set(5, 64, z, "minecraft:air");
    let r = findPath(w.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 });
    assert.ok(r.ok && r.path.every(p => Math.floor(p.x) !== 5 || Math.abs(p.z) > 6.5), "goes round the lava: " + JSON.stringify(r.path));
    const pond = makeWorld();
    for (let x = 3; x <= 7; x++) for (let z = -8; z <= 8; z++) pond.set(x, 63, z, "minecraft:water");
    const swim = findPath(pond.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 }, { allowWater: true });
    const dry = findPath(pond.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 }, { allowWater: false });
    assert.ok(swim.ok, "can swim across");
    assert.ok(dry.ok && dry.path.some(p => Math.abs(p.z) > 8), "or walk round when water is off limits");
});

test("a huge hill is reported rather than circled, and unloaded chunks stop the search", () => {
    const w = makeWorld();
    for (let z = -40; z <= 40; z++) for (let y = 64; y <= 66; y++) w.set(5, y, z, "minecraft:stone");
    const r = findPath(w.at, { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 }, { maxNodes: 800 });
    assert.ok(!r.ok && /budget|too far|no way/.test(r.reason), r.reason);
    assert.ok(r.nodes <= 800);
    const unloaded = findPath((x, y, z) => (x > 3 ? null : w.at(x, y, z)), { x: 0.5, y: 64, z: 0.5 }, { x: 10.5, y: 64, z: 0.5 }, { maxNodes: 400 });
    assert.ok(!unloaded.ok);
});
