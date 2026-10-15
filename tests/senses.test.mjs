import test from "node:test";
import assert from "node:assert/strict";
import { survey, castRay, sights, landmarks, probeAhead, lookingAt, describeRow, describeAround, COMPASS, compassOf, yawOf, yawFromWord, wrapYaw } from "../packs/RealAI_BP/scripts/brain/senses.js";

// ground at y = 63 (solid), air above; rows override single cells
const world = (rows = {}, fill) => {
    const m = new Map(Object.entries(rows));
    return (x, y, z) => { const v = m.get(`${x},${y},${z}`); if (v !== undefined) return v; if (fill) { const f = fill(x, y, z); if (f !== undefined) return f; } return y <= 63 ? "minecraft:stone" : "minecraft:air"; };
};
const row = (rows, dir) => rows.find(r => r.dir === dir);
const feet = { x: 0.5, y: 64, z: 0.5 };

test("compass and yaw agree with Bedrock's convention", () => {
    assert.equal(yawOf(COMPASS.find(c => c.name === "S")), 0);
    assert.equal(yawOf(COMPASS.find(c => c.name === "W")), 90);
    assert.equal(Math.abs(yawOf(COMPASS.find(c => c.name === "N"))), 180);
    assert.equal(yawOf(COMPASS.find(c => c.name === "E")), -90);
    for (const c of COMPASS) assert.equal(compassOf(yawOf(c)).name, c.name);
    assert.equal(compassOf(100).name, "W");
    assert.equal(yawFromWord("north-east"), yawOf(COMPASS.find(c => c.name === "NE")));
    assert.equal(yawFromWord("up"), null);
    assert.equal(wrapYaw(270), -90);
    assert.equal(wrapYaw(-190), 170);
});

test("survey: open ground is clear all the way in every direction", () => {
    const rows = survey(world(), feet);
    assert.equal(rows.length, 8);
    for (const r of rows) { assert.equal(r.stop, "clear", r.dir); assert.equal(r.steps, 24); }
    assert.equal(row(rows, "NE").metres, Math.round(24 * Math.SQRT2));
});

test("survey: a wall ends the run and names the block; a one-block step is climbed", () => {
    const rows = {};
    for (let z = -6; z <= 6; z++) for (let y = 64; y <= 66; y++) rows[`5,${y},${z}`] = "minecraft:stone_bricks";
    for (let x = -40; x <= -3; x++) for (let z = -2; z <= 2; z++) rows[`${x},64,${z}`] = "minecraft:dirt";   // a one-block rise to the west
    const r = survey(world(rows), feet);
    assert.equal(row(r, "E").stop, "wall");
    assert.equal(row(r, "E").steps, 4);
    assert.equal(row(r, "E").block, "stone_bricks");
    assert.match(describeRow(row(r, "E")), /4 then a wall of stone_bricks/);
    assert.equal(row(r, "W").climbs, 1);
    assert.equal(row(r, "W").dy, 1);
});

test("survey: snow layers are no obstacle, a fence is", () => {
    const rows = {};
    for (let x = 0; x <= 10; x++) for (let z = -2; z <= 2; z++) rows[`${x},64,${z}`] = "minecraft:snow_layer";
    rows["6,64,0"] = "minecraft:oak_fence"; rows["6,65,0"] = "minecraft:oak_fence";
    const r = survey(world(rows), feet);
    assert.equal(row(r, "E").stop, "wall");
    assert.equal(row(r, "E").steps, 5);
    assert.equal(row(r, "SE").stop, "clear");
});

test("survey: drops, water, lava and unloaded ground are told apart", () => {
    const hole = {};
    for (let x = 4; x <= 40; x++) for (let z = -3; z <= 3; z++) for (let y = 40; y <= 63; y++) hole[`${x},${y},${z}`] = "minecraft:air";
    let r = survey(world(hole), feet);
    assert.equal(row(r, "E").stop, "drop");
    assert.ok(row(r, "E").fall >= 20, "the fall is measured: " + row(r, "E").fall);
    assert.match(describeRow(row(r, "E")), /a drop of/);
    const pond = {}; for (let x = 4; x <= 9; x++) for (let z = -3; z <= 3; z++) pond[`${x},63,${z}`] = "minecraft:water";
    r = survey(world(pond), feet);
    assert.equal(row(r, "E").stop, "water"); assert.equal(row(r, "E").steps, 3);
    const lava = {}; for (let x = 4; x <= 9; x++) for (let z = -3; z <= 3; z++) lava[`${x},63,${z}`] = "minecraft:lava";
    r = survey(world(lava), feet);
    assert.equal(row(r, "E").stop, "lava"); assert.match(describeRow(row(r, "E")), /LAVA/);
    r = survey(world({}, (x) => (x > 6 ? null : undefined)), feet);
    assert.equal(row(r, "E").stop, "unloaded");
    assert.match(describeRow(row(r, "E")), /edge of what is loaded/);
});

test("survey: a diagonal does not cut a wall's corner", () => {
    const rows = {};
    for (let y = 64; y <= 65; y++) rows[`1,${y},0`] = "minecraft:stone";    // east of the start; the SE step would squeeze past its corner
    const r = survey(world(rows), feet);
    assert.equal(row(r, "SE").steps, 0);
    assert.equal(row(r, "SE").stop, "wall");
});

test("castRay: stops at full blocks and water, passes grass and snow layers", () => {
    const eye = { x: 0.5, y: 65.62, z: 0.5 };
    const rows = { "10,65,0": "minecraft:stone", "4,65,0": "minecraft:snow_layer", "6,65,0": "minecraft:short_grass" };
    const at = world(rows);
    const east = castRay(at, eye, -90, 0, 40);
    assert.equal(east.hit.id, "minecraft:stone");
    assert.ok(Math.abs(east.hit.dist - 9.5) < 0.2, "distance to the face: " + east.hit.dist);
    const water = castRay(world({ "0,65,5": "minecraft:water" }), eye, 0, 0, 40);
    assert.equal(water.hit.kind, "water");
    const down = castRay(at, eye, 0, 90, 10);
    assert.equal(down.hit.y, 63);
    assert.ok(Math.abs(down.hit.dist - 1.62) < 0.1, "straight down to the ground: " + down.hit.dist);
    const none = castRay(at, eye, 90, -10, 30);
    assert.equal(none.hit, null);
    const gone = castRay(world({}, (x) => (x > 5 ? null : undefined)), eye, -90, 0, 40);
    assert.equal(gone.unloaded, true);
});

test("sights: trees, water, ore and built things are reported with a distance, plain rock near by is not", () => {
    const rows = {};
    for (let y = 64; y <= 69; y++) rows[`0,${y},-14`] = "minecraft:spruce_log";
    for (let x = 12; x <= 14; x++) for (let z = -3; z <= 3; z++) for (let y = 64; y <= 70; y++) rows[`${x},${y},${z}`] = "minecraft:oak_planks";
    for (let y = 64; y <= 68; y++) for (let x = -3; x <= 3; x++) rows[`${x},${y},-3`] = "minecraft:stone";   // rock close by in the north: part of the walk report, not a sight
    const s = sights(world(rows), { x: 0.5, y: 65.62, z: 0.5 });
    const get = (d) => s.find(x => x.dir === d);
    assert.ok(get("E").seen.some(x => x.cls === "built" && x.dist >= 11 && x.dist <= 13), JSON.stringify(get("E")));
    assert.ok(!get("N").seen.some(x => x.cls === "rock"), "near rock is not a sight");
    const far = {}; for (let y = 64; y <= 69; y++) far[`0,${y},-14`] = "minecraft:spruce_log";
    assert.ok(sights(world(far), { x: 0.5, y: 65.62, z: 0.5 }).find(x => x.dir === "N").seen.some(x => x.cls === "tree" && x.dist >= 13 && x.dist <= 15));
    assert.equal(get("S").open, true);
});

test("lookingAt and the prompt line", () => {
    const eye = { x: 0.5, y: 65.62, z: 0.5 };
    const at = world({ "0,65,6": "minecraft:oak_log" });
    const l = lookingAt(at, eye, 0, 0);
    assert.equal(l.id, "oak_log"); assert.equal(l.cls, "tree"); assert.equal(l.z, 6);
    assert.equal(lookingAt(at, eye, 90, -45).id, null);
    const rows = survey(at, feet);
    const text = describeAround(rows, sights(at, eye), "S", { visited: () => false });
    assert.match(text, /S \(ahead\): 5 then a wall of oak_log/);
    assert.match(text, /N: 24 clear/);
    assert.match(text, /unexplored/);
});

test("landmarks: a tree three blocks off any line of sight is still found, with a direction and a distance", () => {
    const rows = {};
    for (let y = 64; y <= 68; y++) rows[`12,${y},3`] = "minecraft:oak_log";
    for (let y = 67; y <= 69; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) rows[`${12 + dx},${y},${3 + dz}`] = "minecraft:oak_leaves";
    const at = world(rows);
    const eye = { x: 0.5, y: 65.62, z: 0.5 };
    assert.ok(!sights(at, eye).find(s => s.dir === "E").seen.some(x => x.cls === "tree"), "the rays alone miss it");
    const lm = landmarks(at, feet);
    const e = lm.find(s => s.dir === "E").seen.find(x => x.cls === "tree");
    assert.ok(e && e.dist >= 10 && e.dist <= 14, "the grid finds it to the east: " + JSON.stringify(lm.find(s => s.dir === "E")));
    // water and lava at the surface, a building wall
    const w = {}; for (let x = 8; x <= 14; x++) for (let z = -8; z <= -2; z++) w[`${x},63,${z}`] = "minecraft:water";
    assert.ok(landmarks(world(w), feet).some(s => s.seen.some(x => x.cls === "water")));
    const b = {}; for (let y = 64; y <= 66; y++) for (let z = -6; z <= 6; z++) b[`15,${y},${z}`] = "minecraft:oak_planks";
    assert.ok(landmarks(world(b), feet).find(s => s.dir === "E").seen.some(x => x.cls === "built"));
    assert.deepEqual(landmarks(world(), feet).flatMap(s => s.seen), [], "nothing on an empty plain");
});

test("probeAhead: the first change of level or the first thing in the way, and where it begins", () => {
    const f = { x: 0.5, y: 64, z: 0.5 };
    let r = probeAhead(world(), f, 0, 1, 2.5);
    assert.deepEqual(r, { ok: true, floor: 64, climb: false, edge: undefined });
    const ledge = {}; for (let z = 2; z <= 10; z++) for (let x = -2; x <= 2; x++) ledge[`${x},64,${z}`] = "minecraft:dirt";
    r = probeAhead(world(ledge), f, 0, 1, 3);
    assert.equal(r.ok, true); assert.equal(r.floor, 65); assert.equal(r.climb, true);
    assert.ok(r.edge > 1.0 && r.edge < 1.7, "the ledge starts about 1.5 ahead: " + r.edge);
    const wall = {}; for (let z = 4; z <= 4; z++) for (let x = -3; x <= 3; x++) for (let y = 64; y <= 66; y++) wall[`${x},${y},${z}`] = "minecraft:stone_bricks";
    r = probeAhead(world(wall), f, 0, 1, 5);
    assert.equal(r.ok, false); assert.equal(r.stop, "wall"); assert.ok(r.at > 3 && r.at < 4.2);
    const pit = {}; for (let z = 3; z <= 8; z++) for (let x = -3; x <= 3; x++) for (let y = 20; y <= 63; y++) pit[`${x},${y},${z}`] = "minecraft:air";
    r = probeAhead(world(pit), f, 0, 1, 5);
    assert.equal(r.ok, false); assert.equal(r.stop, "drop");
    const step = {}; for (let z = 2; z <= 10; z++) for (let x = -2; x <= 2; x++) step[`${x},63,${z}`] = "minecraft:air";
    r = probeAhead(world(step), f, 0, 1, 3);
    assert.equal(r.ok, true); assert.equal(r.floor, 63); assert.equal(r.climb, false);
});

test("a path block or farmland under the feet (63.9375) is flat ground, not a staircase of walls", () => {
    const rows = {};
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) rows[`${x},63,${z}`] = "minecraft:grass_path";
    const r = survey(world(rows), { x: 0.5, y: 63.9375, z: 0.5 });
    for (const row of r) { assert.equal(row.stop, "clear", row.dir + ": " + describeRow(row)); assert.equal(row.climbs, 0, row.dir); }
    assert.equal(probeAhead(world(rows), { x: 0.5, y: 63.9375, z: 0.5 }, 1, 0, 2).climb, false);
});

test("sight classes: terracotta, cactus, glowstone and geode basalt are not buildings, trees or rock", () => {
    const eye = { x: 0.5, y: 65.62, z: 0.5 };
    const one = (id) => { const rows = { "10,65,0": id }; return sights(world(rows), eye).find(s => s.dir === "E").seen.map(x => x.cls); };
    assert.deepEqual(one("minecraft:orange_terracotta"), [], "badlands are not a village");
    assert.deepEqual(one("minecraft:cactus"), [], "a cactus is not a tree");
    assert.deepEqual(one("minecraft:glowstone"), []);
    assert.ok(!one("minecraft:smooth_basalt").includes("built"), "geode basalt is rock, not masonry");
    assert.deepEqual(one("minecraft:oak_planks"), ["built"]);
    assert.deepEqual(one("minecraft:spruce_log"), ["tree"]);
});

test("the floor is not a sight: standing on planks, rays that land on the floor ahead are ignored", () => {
    const rows = {}; for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) rows[`${x},63,${z}`] = "minecraft:oak_planks";
    const seen = sights(world(rows), { x: 0.5, y: 65.62, z: 0.5 }, { pitches: [-30, -8, 0, 7], max: 48 });
    for (const s of seen) assert.deepEqual(s.seen, [], s.dir);
    assert.ok(seen.every(s => s.open), "and the level view is open");
});

test("landmarks: moss carpet and torchflowers are ground cover, not buildings", () => {
    const rows = {};
    for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) { rows[`${x},64,${z}`] = (x + z) % 2 ? "minecraft:pale_moss_carpet" : "minecraft:torchflower"; }
    const lm = landmarks(world(rows), feet);
    assert.deepEqual(lm.flatMap(s => s.seen.filter(x => x.cls === "built")), [], "nothing built in a garden");
    const b = {}; for (let y = 64; y <= 66; y++) for (let z = -6; z <= 6; z++) b[`15,${y},${z}`] = "minecraft:oak_planks";
    assert.ok(landmarks(world(b), feet).find(s => s.dir === "E").seen.some(x => x.cls === "built"), "a wall still is");
});

test("survey agrees with the pathfinder about a drop under a low ceiling", () => {
    const rows = {};
    for (let x = 1; x <= 30; x++) for (let z = -3; z <= 3; z++) { rows[`${x},63,${z}`] = "minecraft:air"; rows[`${x},65,${z}`] = "minecraft:spruce_leaves"; }
    const r = survey(world(rows), { x: 0.5, y: 64, z: 0.5 });
    const e = row(r, "E");
    assert.equal(e.steps, 0, "cannot step off under the leaves: " + describeRow(e));
    assert.equal(probeAhead(world(rows), { x: 0.5, y: 64, z: 0.5 }, 1, 0, 3).ok, false);
});
