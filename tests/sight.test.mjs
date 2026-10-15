import test from "node:test";
import assert from "node:assert/strict";
import { renderSight, formatSight, glyphOf, cameraBasis, legendText, SIGHT_LEGEND, DEPTH_BANDS } from "../packs/RealAI_BP/scripts/brain/sight.js";
import { castDir, castRay } from "../packs/RealAI_BP/scripts/brain/senses.js";

// ground at y <= 63 (grass), air above; cells override
const world = (cells = {}) => {
    const m = new Map(Object.entries(cells));
    return (x, y, z) => { const v = m.get(`${x},${y},${z}`); if (v !== undefined) return v; return y <= 63 ? "minecraft:grass_block" : "minecraft:air"; };
};
const eye = { x: 0.5, y: 64.62, z: 0.5 };
const col = (s, row) => s.rows[row];
const halves = (s) => [s.rows.map(r => r.slice(0, 16)).join(""), s.rows.map(r => r.slice(17)).join("")];      // left of the middle column, right of it
const unit = (v) => [v.x, v.y, v.z].map(n => Math.round(n) + 0);

test("the camera: forward, right and up are unit vectors that agree with Bedrock's yaw and pitch", () => {
    const south = cameraBasis(0, 0);
    assert.deepEqual(unit(south.f), [0, 0, 1]);
    assert.deepEqual(unit(south.r), [-1, 0, 0]);       // facing south, your right hand is west
    assert.deepEqual(unit(south.u), [0, 1, 0]);
    const west = cameraBasis(90, 0);
    assert.deepEqual(unit(west.f), [-1, 0, 0]);
    assert.deepEqual(unit(west.r), [0, 0, -1]);                        // facing west, right is north
    for (const [y, p] of [[0, 0], [37, -20], [-120, 55], [200, -85]]) {
        const { f, r, u } = cameraBasis(y, p);
        const d = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        assert.ok(Math.abs(d(f, r)) < 1e-9 && Math.abs(d(f, u)) < 1e-9 && Math.abs(d(r, u)) < 1e-9, `orthogonal at ${y},${p}`);
        assert.ok(Math.abs(d(f, f) - 1) < 1e-9 && Math.abs(d(u, u) - 1) < 1e-9);
    }
    const up = cameraBasis(0, -90);
    assert.ok(up.f.y > 0.99, "pitch -90 looks straight up");
});

test("castDir: the same walk as castRay, along any vector", () => {
    const w = world({ "0,64,5": "minecraft:stone" });
    const a = castRay(w, eye, 0, 0, 20), b = castDir(w, eye, { x: 0, y: 0, z: 7 }, 20);
    assert.equal(a.hit.z, 5); assert.equal(b.hit.z, 5);
    assert.ok(Math.abs(a.hit.dist - b.hit.dist) < 1e-9);
    assert.equal(castDir(w, eye, { x: 0, y: 0, z: 0 }, 5).hit, null, "a zero vector sees nothing and does not hang");
});

test("a flat field: grass below, open sky above, a horizon line between", () => {
    const s = renderSight(world(), eye, 0, 0);
    assert.equal(s.rows.length, 13); assert.equal(s.depth.length, 13);
    assert.ok(s.rows.every(r => r.length === 33) && s.depth.every(r => r.length === 33));
    assert.match(s.rows[0], /^\.+$/, "the top row is sky");
    assert.match(s.rows[12], /^"+$/, "the bottom row is grass");
    assert.match(s.depth[0], /^9+$/, "open air is the farthest digit");
    // grass nearest the feet is nearer than grass at the horizon
    assert.ok(Number(s.depth[12][16]) < Number(s.depth[7][16]), s.depth.join("\n"));
    assert.equal(s.hfov, 90); assert.ok(s.vfov > 60 && s.vfov < 90, "vfov " + s.vfov);
});

test("a wall straight ahead fills the middle of the view and says how far it is", () => {
    const cells = {};
    for (let x = -6; x <= 6; x++) for (let y = 64; y <= 67; y++) cells[`${x},${y},5`] = "minecraft:stone";
    const s = renderSight(world(cells), eye, 0, 0);
    assert.equal(s.rows[6][16], "#");
    assert.equal(s.depth[6][16], "2", "4.5 blocks is in the 4-6 band");
    assert.equal(s.rows[6][0], "#", "the wall is wide enough to fill the whole width of the picture at this range");
});

test("left is left: a tree on the +x side shows on the left of the view when facing south, on the right when facing north", () => {
    const cells = {};
    for (let y = 64; y <= 67; y++) cells[`4,${y},4`] = "minecraft:oak_log";
    const south = renderSight(world(cells), eye, 0, 0);
    const [sl, sr] = halves(south);
    assert.ok(sl.includes("T") && !sr.includes("T"), "facing south the trunk (east of centre... +x) is on the left\n" + south.rows.join("\n"));
    // from the other side of it, looking north at a trunk that is now at -z... mirror: stand at z=9, look north: the trunk at x=4 is on the right
    const northEye = { x: 0.5, y: 64.62, z: 8.5 };
    const north = renderSight(world(cells), northEye, 180, 0);
    const [nl, nr] = halves(north);
    assert.ok(nr.includes("T") && !nl.includes("T"), "facing north the same trunk is on the right\n" + north.rows.join("\n"));
});

test("looking up and down moves the horizon; straight up is all sky and straight down all ground", () => {
    const up = renderSight(world(), eye, 0, -80);
    assert.ok(up.rows.every(r => !r.includes("\"")), "nothing but sky overhead\n" + up.rows.join("\n"));
    const down = renderSight(world(), eye, 0, 80);
    assert.ok(down.rows.every(r => !r.includes(".")), "nothing but ground below\n" + down.rows.join("\n"));
    const level = renderSight(world(), eye, 0, 0), tilted = renderSight(world(), eye, 0, 30);
    const horizon = (s) => s.rows.findIndex(r => r.includes("\""));
    assert.ok(horizon(tilted) < horizon(level), "tilting the head down raises the ground in the picture");
});

test("materials: each kind of block gets its own character", () => {
    const g = (id) => glyphOf(id);
    assert.equal(g("minecraft:stone"), "#"); assert.equal(g("minecraft:deepslate"), "#");
    assert.equal(g("minecraft:grass_block"), "\""); assert.equal(g("minecraft:dirt"), "="); assert.equal(g("minecraft:sand"), ":"); assert.equal(g("minecraft:gravel"), ":");
    assert.equal(g("minecraft:oak_log"), "T"); assert.equal(g("minecraft:birch_leaves"), "%");
    assert.equal(g("minecraft:iron_ore"), "*"); assert.equal(g("minecraft:deepslate_diamond_ore"), "*");
    assert.equal(g("minecraft:water"), "~"); assert.equal(g("minecraft:lava"), "!");
    assert.equal(g("minecraft:cactus"), "X"); assert.equal(g("minecraft:magma"), "X");
    assert.equal(g("minecraft:oak_planks"), "B"); assert.equal(g("minecraft:stone_bricks"), "B"); assert.equal(g("minecraft:oak_fence"), "B");
    assert.equal(g("minecraft:oak_door"), "D"); assert.equal(g("minecraft:spruce_fence_gate"), "D");
    assert.equal(g("minecraft:glass"), "G");
    assert.equal(g("minecraft:chest"), "C"); assert.equal(g("minecraft:crafting_table"), "C"); assert.equal(g("minecraft:red_bed"), "C");
    assert.equal(g("minecraft:snow"), "^"); assert.equal(g("minecraft:packed_ice"), "^");
    assert.equal(g("minecraft:some_modded_block"), "o");
    // every character the picture can draw is in the legend
    const known = new Set(SIGHT_LEGEND.map(l => l[0]));
    for (const id of ["stone", "grass_block", "dirt", "sand", "oak_log", "oak_leaves", "iron_ore", "water", "lava", "cactus", "oak_planks", "oak_door", "glass", "chest", "snow", "modded"]) assert.ok(known.has(glyphOf("minecraft:" + id)), id);
});

test("a lake is water, a cliff edge is a drop, unloaded ground is a question mark", () => {
    const cells = {};
    for (let x = -3; x <= 3; x++) for (let z = 3; z <= 9; z++) cells[`${x},63,${z}`] = "minecraft:water";
    const s = renderSight(world(cells), eye, 0, 0);
    assert.ok(s.rows.some(r => r.includes("~")), "water shows\n" + s.rows.join("\n"));
    const partial = renderSight((x, y, z) => (z > 6 ? null : world()(x, y, z)), eye, 0, 0);
    assert.ok(partial.rows.some(r => r.includes("?")), "ground past the loaded chunks is unknown\n" + partial.rows.join("\n"));
});

test("creatures in view are drawn where they stand, nearest on top, and hidden behind walls", () => {
    const cells = {};
    const things = [{ glyph: "H", name: "zombie", x: 0.5, y: 64.9, z: 8.5 }, { glyph: "@", name: "Steve", x: 4.5, y: 64.9, z: 6.5 }, { glyph: "a", name: "cow", x: -0.5, y: 64.9, z: -5 }];
    let s = renderSight(world(cells), eye, 0, 0, { things });
    assert.equal(s.rows[6][16], "H", "the zombie dead ahead\n" + s.rows.join("\n"));
    assert.ok(s.rows.some(r => r.includes("@")), "the player to the left\n" + s.rows.join("\n"));
    assert.ok(!s.rows.some(r => r.includes("a")), "the cow is behind you");
    assert.deepEqual(s.seen.map(x => x.name), ["Steve", "zombie"], "in view, nearest first");
    assert.equal(s.seen[0].name, "Steve"); assert.ok(s.seen[0].bearing < -10, "Steve is on the left, so a negative bearing: " + s.seen[0].bearing);
    // a wall between us hides the zombie
    for (let x = -3; x <= 3; x++) for (let y = 64; y <= 66; y++) cells[`${x},${y},5`] = "minecraft:stone";
    s = renderSight(world(cells), eye, 0, 0, { things: [things[0]] });
    assert.ok(!s.rows.some(r => r.includes("H")) && s.seen.length === 0, "a zombie behind a wall is not seen\n" + s.rows.join("\n"));
});

test("formatSight: header, ruler, rows with the crosshair row marked, who is in view, and the legend on request", () => {
    const things = [{ glyph: "@", name: "Alex", x: 2.5, y: 64.9, z: 6.5 }];
    const s = renderSight(world(), eye, 90, -10, { things });
    const text = formatSight(s);
    const lines = text.split("\n");
    assert.match(lines[0], /^Sight: facing W \(yaw 90, pitch -10\), 90° wide, \d+° high, as far as 32 blocks/);
    assert.ok(lines[1].includes("v"));
    assert.equal(lines.filter(l => l.startsWith("> ")).length, 1, "one crosshair row");
    assert.equal(lines.length, 2 + 13 + (s.seen.length ? 1 : 0));
    assert.ok(!text.includes("Legend:"));
    assert.match(formatSight(s, { legend: true }), /Legend: \. open air/);
    assert.ok(legendText().includes("Distance digits"));
    for (const l of lines.slice(2, 15)) assert.ok(l.length <= 2 + 33 + 3 + 33, "no line is wider than the pictures");
});

test("rendering is cheap enough to do on every turn", () => {
    const cells = {};
    for (let x = -12; x <= 12; x++) for (let z = 0; z <= 14; z++) for (let y = 64; y <= 70; y++) if ((x * 7 + z * 3 + y) % 11 === 0) cells[`${x},${y},${z}`] = "minecraft:oak_leaves";
    let calls = 0; const w = world(cells); const counted = (x, y, z) => { calls++; return w(x, y, z); };
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) renderSight(counted, eye, i * 70, -5);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
    assert.ok(ms < 120, `one picture took ${ms.toFixed(1)} ms`);
    assert.ok(calls / 5 < 30000, `${calls / 5} block reads per picture`);
});

test("the depth bands read in order", () => {
    for (let i = 1; i < DEPTH_BANDS.length; i++) assert.ok(DEPTH_BANDS[i] > DEPTH_BANDS[i - 1]);
});

test("stripSight removes the picture from a stored turn and nothing else", async () => {
    const { stripSight } = await import("../packs/RealAI_BP/scripts/brain/sight.js");
    const s = renderSight(world(), eye, 0, 0, { things: [{ glyph: "a", name: "cow", x: 0.5, y: 64.6, z: 5.5 }] });
    const obs = "Time: day.\nAround you: N: 24 clear.\n" + formatSight(s) + "\nHotbar: 1 axe.\nInventory: empty.";
    assert.equal(stripSight(obs), "Time: day.\nAround you: N: 24 clear.\nHotbar: 1 axe.\nInventory: empty.");
    assert.equal(stripSight("no picture here"), "no picture here");
    assert.equal(stripSight(formatSight(s, { legend: true })), "");
});

test("fixes from review: portals, built-from-sand, trapdoors, sky above the world, glass does not hide creatures", () => {
    assert.equal(glyphOf("minecraft:portal"), "P"); assert.equal(glyphOf("minecraft:end_portal"), "P"); assert.equal(glyphOf("minecraft:end_gateway"), "P");
    assert.equal(glyphOf("minecraft:sandstone_stairs"), "B"); assert.equal(glyphOf("minecraft:cut_sandstone"), "B"); assert.equal(glyphOf("minecraft:mud_brick_stairs"), "B"); assert.equal(glyphOf("minecraft:smooth_sandstone_slab"), "B");
    assert.equal(glyphOf("minecraft:sand"), ":"); assert.equal(glyphOf("minecraft:mud"), "="); assert.equal(glyphOf("minecraft:farmland"), "=");
    assert.equal(glyphOf("minecraft:trapdoor"), "D"); assert.equal(glyphOf("minecraft:oak_trapdoor"), "D");
    // at the top of the world the sky is sky, not an unloaded chunk
    const high = renderSight((x, y, z) => (y >= 320 ? null : y <= 63 ? "minecraft:stone" : "minecraft:air"), { x: 0.5, y: 316.62, z: 0.5 }, 0, -40);
    assert.ok(!high.rows.some(r => r.includes("?")), "no unloaded cells in the sky\n" + high.rows.join("\n"));
    // a zombie behind a glass wall is still seen
    const cells = {};
    for (let x = -3; x <= 3; x++) for (let y = 64; y <= 66; y++) cells[`${x},${y},4`] = "minecraft:glass";
    const s = renderSight(world(cells), eye, 0, 0, { things: [{ glyph: "H", name: "zombie", x: 0.5, y: 64.9, z: 8.5 }] });
    assert.equal(s.seen.length, 1, "seen through the glass");
    // but not through stone
    for (let x = -3; x <= 3; x++) for (let y = 64; y <= 66; y++) cells[`${x},${y},4`] = "minecraft:stone";
    assert.equal(renderSight(world(cells), eye, 0, 0, { things: [{ glyph: "H", name: "zombie", x: 0.5, y: 64.9, z: 8.5 }] }).seen.length, 0);
    // bad input does not break the picture
    const odd = renderSight(world(), eye, 0, 0, { hfov: NaN, things: [{ glyph: "H", name: "x", x: NaN, y: 64, z: 5 }, null] });
    assert.equal(odd.hfov, 90); assert.equal(odd.seen.length, 0);
});
