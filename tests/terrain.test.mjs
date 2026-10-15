import test from "node:test";
import assert from "node:assert/strict";
import { kindOf, canStand, footingAt, nearDanger } from "../packs/RealAI_BP/scripts/brain/terrain.js";
import { findPath } from "../packs/RealAI_BP/scripts/brain/path.js";

const world = (rows = {}) => {
    const m = new Map(Object.entries(rows));
    return (x, y, z) => m.get(`${x},${y},${z}`) ?? (y <= 63 ? "minecraft:stone" : "minecraft:air");
};

test("kinds: what a body walks through, over, and into", () => {
    for (const id of ["minecraft:snow_layer", "minecraft:short_grass", "minecraft:red_carpet", "minecraft:dandelion", "minecraft:torch", "minecraft:oak_sign", "minecraft:rail", "minecraft:tall_grass", "minecraft:sunflower", "minecraft:rose_bush", "minecraft:lilac", "minecraft:short_dry_grass", "minecraft:frog_spawn", "minecraft:trip_wire", "minecraft:oak_sapling", "minecraft:ladder", "minecraft:vine"]) assert.equal(kindOf(id), "passable", id);
    for (const id of ["minecraft:stone", "minecraft:oak_planks", "minecraft:stone_slab", "minecraft:oak_stairs", "minecraft:snow", "minecraft:ice", "minecraft:oak_log", "minecraft:chest", "minecraft:grass_block"]) assert.equal(kindOf(id), "solid", id);
    for (const id of ["minecraft:oak_fence", "minecraft:cobblestone_wall", "minecraft:fence_gate", "minecraft:spruce_fence_gate", "minecraft:iron_bars"]) assert.equal(kindOf(id), "tall", id);
    assert.equal(kindOf("minecraft:air"), "air");
    assert.equal(kindOf("minecraft:water"), "water");
    assert.equal(kindOf("minecraft:flowing_lava"), "lava");
    assert.equal(kindOf("minecraft:cactus"), "hazard");
    assert.equal(kindOf("minecraft:powder_snow"), "hazard");
    assert.equal(kindOf(null), null);
});

test("standing on snow: a snow layer in the feet cell is not a wall", () => {
    const at = world({ "5,64,5": "minecraft:snow_layer", "6,64,5": "minecraft:snow_layer", "6,63,5": "minecraft:snow" });
    assert.equal(canStand(at, 5, 64, 5), true);
    assert.equal(canStand(at, 6, 64, 5), true);
    assert.deepEqual(footingAt(at, 6, 64, 5), { y: 64, jump: false });
    // a fence is a wall; a one-block ledge needs a jump; a two-block wall cannot be climbed
    const fenced = world({ "6,64,5": "minecraft:oak_fence", "6,65,5": "minecraft:oak_fence" });
    assert.equal(canStand(fenced, 6, 64, 5), false);
    const ledge = world({ "6,64,5": "minecraft:dirt" });
    assert.deepEqual(footingAt(ledge, 6, 64, 5), { y: 65, jump: true });
    const wall = world({ "6,64,5": "minecraft:dirt", "6,65,5": "minecraft:dirt" });
    assert.equal(footingAt(wall, 6, 64, 5), null);
    // a fence post cannot be stood on
    const fenceTop = world({ "6,64,5": "minecraft:oak_fence" });
    assert.equal(footingAt(fenceTop, 6, 64, 5), null);
});

test("hazards and unloaded blocks", () => {
    const cactus = world({ "6,64,5": "minecraft:cactus" });
    assert.equal(canStand(cactus, 6, 64, 5), false);
    assert.equal(nearDanger(world({ "7,64,5": "minecraft:lava" }), 6, 64, 5), true);
    assert.equal(canStand((x, y, z) => (x > 5 ? null : "minecraft:stone"), 6, 64, 5), null);
    const lavaFloor = world({ "6,63,5": "minecraft:lava" });
    assert.equal(canStand(lavaFloor, 6, 64, 5), false);
});

test("a snowy slope: the path walks over snow layers instead of finding walls everywhere", () => {
    const rows = {};
    for (let x = 0; x <= 14; x++) for (let z = -3; z <= 3; z++) rows[`${x},64,${z}`] = "minecraft:snow_layer";
    const at = world(rows);
    const r = findPath(at, { x: 0.5, y: 64, z: 0.5 }, { x: 12.5, y: 64, z: 0.5 });
    assert.ok(r.ok, r.reason);
    assert.ok(r.path.length <= 3, "a straight line over the snow: " + r.path.length);
});

test("a far goal gives a partial path towards it instead of nothing; a jump flag marks the climb", () => {
    const rows = {};
    for (let z = -60; z <= 60; z++) for (let y = 64; y <= 70; y++) rows[`8,${y},${z}`] = "minecraft:stone";   // a cliff wall, taller than a jump and far too wide to circle
    const at = world(rows);
    const r = findPath(at, { x: 0.5, y: 64, z: 0.5 }, { x: 14.5, y: 64, z: 0.5 }, { maxNodes: 500, allowPartial: true });
    assert.ok(r.ok && r.partial, "partial: " + JSON.stringify(r).slice(0, 120));
    assert.ok(r.path[r.path.length - 1].x > 4, "it got closer to the wall");
    const ledge = {}; for (let x = 3; x <= 9; x++) for (let z = -8; z <= 8; z++) ledge[`${x},64,${z}`] = "minecraft:dirt";
    const up = findPath(world(ledge), { x: 0.5, y: 64, z: 0.5 }, { x: 6.5, y: 65, z: 0.5 });
    assert.ok(up.ok && up.path.some(p => p.jump), "the climb is flagged as a jump");
    const far = findPath(world(), { x: 0.5, y: 64, z: 0.5 }, { x: 24.5, y: 64, z: 0.5 }, { ignoreGoalY: true });
    assert.ok(far.ok && !far.partial);
});

test("plants without collision are not walls; roots that are blocks are", () => {
    for (const id of ["minecraft:tall_grass", "minecraft:large_fern", "minecraft:peony", "minecraft:tall_seagrass", "minecraft:closed_eyeblossom", "minecraft:crimson_roots", "minecraft:hanging_roots", "minecraft:nether_sprouts"]) assert.equal(kindOf(id), "passable", id);
    for (const id of ["minecraft:dirt_with_roots", "minecraft:mangrove_roots", "minecraft:muddy_mangrove_roots", "minecraft:piston_head", "minecraft:piston_arm_collision"]) assert.equal(kindOf(id), "solid", id);
    for (const id of ["minecraft:portal", "minecraft:end_portal"]) assert.equal(kindOf(id), "hazard", id);
    for (const id of ["minecraft:chain", "minecraft:end_rod", "minecraft:fence_gate"]) assert.equal(kindOf(id), "tall", id);
});

test("only things that hurt from next door count as danger beside the path", () => {
    const berries = world({ "7,64,5": "minecraft:sweet_berry_bush" });
    assert.equal(nearDanger(berries, 6, 64, 5), false, "a berry bush beside the path is fine");
    assert.equal(nearDanger(world({ "6,64,5": "minecraft:sweet_berry_bush" }), 6, 64, 5), true, "in the cell it is not");
    assert.equal(nearDanger(world({ "7,64,5": "minecraft:cactus" }), 6, 64, 5), true);
    assert.equal(nearDanger(world({ "7,64,5": "minecraft:web" }), 6, 64, 5), false);
});

test("stepping down needs head room at the departure level", () => {
    // ground top at y=64 for x<=4; a hollow beyond with its floor top at 63 and spruce leaves over it at y=65:
    // a body at feet 64 would walk into the leaves before it could drop
    const rows = {};
    for (let x = 5; x <= 12; x++) for (let z = -3; z <= 3; z++) { rows[`${x},63,${z}`] = "minecraft:air"; rows[`${x},65,${z}`] = "minecraft:spruce_leaves"; }
    const r = findPath(world(rows), { x: 4.5, y: 64, z: 0.5 }, { x: 9.5, y: 63, z: 0.5 }, { allowPartial: false });
    assert.ok(!r.ok, "no way in: " + JSON.stringify(r.path));
    // with the leaves gone the same drop works
    const open = {}; for (let x = 5; x <= 12; x++) for (let z = -3; z <= 3; z++) open[`${x},63,${z}`] = "minecraft:air";
    const r2 = findPath(world(open), { x: 4.5, y: 64, z: 0.5 }, { x: 9.5, y: 63, z: 0.5 }, { allowPartial: false });
    assert.ok(r2.ok && r2.path[r2.path.length - 1].y === 63, "drops into the hollow: " + JSON.stringify(r2).slice(0, 100));
});

test("plants that have collision are not walked through: azalea, big dripleaf, chorus flower", () => {
    for (const id of ["minecraft:azalea", "minecraft:flowering_azalea", "minecraft:big_dripleaf", "minecraft:chorus_flower"]) assert.equal(kindOf(id), "solid", id);
    assert.equal(kindOf("minecraft:dandelion"), "passable"); assert.equal(kindOf("minecraft:cornflower"), "passable"); assert.equal(kindOf("minecraft:wither_rose"), "hazard");
});

test("a body standing on a path block (feet 63.9375) starts from the right cell: a flat strip is flat", () => {
    const rows = {}; for (let x = -2; x <= 30; x++) for (let z = -2; z <= 2; z++) rows[`${x},63,${z}`] = "minecraft:grass_path";
    const r = findPath(world(rows), { x: 0.5, y: 63.9375, z: 0.5 }, { x: 20.5, y: 64, z: 0.5 });
    assert.ok(r.ok, r.reason);
    assert.ok(!r.path.some(p => p.jump), "no hop on flat ground: " + JSON.stringify(r.path));
    assert.ok(r.path.length <= 4, "a straight line, smoothed: " + r.path.length);
});
