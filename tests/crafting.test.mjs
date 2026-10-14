import { test } from "node:test";
import assert from "node:assert/strict";
import { craftPlan, smeltPlan, findRecipes, RECIPES } from "../packs/RealAI_BP/scripts/brain/crafting.js";

test("pack recipes are loaded alongside vanilla", () => {
    assert.ok(RECIPES.every(r => r.station), "every recipe has a station");
    assert.ok(RECIPES.some(r => r.result === "minecraft:oak_planks"));
});

test("craft planks from any log, then sticks, then a wooden pickaxe", () => {
    let inv = { "minecraft:birch_log": 3 };
    let p = craftPlan("planks", 8, inv);
    assert.equal(p.ok, true); assert.equal(p.produce.count, 8); assert.deepEqual(p.consume, { "minecraft:birch_log": 2 });
    inv = { "minecraft:birch_planks": 8 };
    p = craftPlan("stick", 4, inv, false);
    assert.equal(p.ok, true); assert.equal(p.recipe.station, "hand");
    inv = { "minecraft:birch_planks": 6, "minecraft:stick": 4 };
    p = craftPlan("pickaxe", 1, inv, true);
    assert.equal(p.ok, true); assert.equal(p.produce.id, "minecraft:wooden_pickaxe");
    assert.equal(craftPlan("pickaxe", 1, inv, false).ok, false);
    assert.ok(craftPlan("diamond_pickaxe", 1, inv).reason.includes("missing"));
});

test("craftPlan falls back to a smaller multiple when short", () => {
    const p = craftPlan("torch", 16, { "minecraft:coal": 2, "minecraft:stick": 9 });
    assert.equal(p.ok, true); assert.equal(p.times, 2); assert.equal(p.produce.count, 8);
});

test("smelt picks input and fuel", () => {
    const s = smeltPlan("iron", { "minecraft:raw_iron": 5, "minecraft:oak_planks": 4 });
    assert.equal(s.ok, true); assert.equal(s.output, "minecraft:iron_ingot"); assert.equal(s.count, 5); assert.equal(s.fuel, "minecraft:oak_planks");
    assert.equal(smeltPlan("iron", { "minecraft:raw_iron": 5 }).ok, false);
});

test("vanilla recipe resolves by loose name", () => {
    assert.ok(findRecipes("crafting table")[0].result === "minecraft:crafting_table");
});
