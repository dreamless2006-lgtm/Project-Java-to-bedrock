import test from "node:test";
import assert from "node:assert/strict";
import { dropsOf, toolFor, requiredTier, bestTool, harvestCheck, breakTicks, materialMatcher, isOreId, TIER } from "../packs/RealAI_BP/scripts/brain/harvest.js";

const wooden = { "minecraft:wooden_pickaxe": 1 };
const iron = { "minecraft:iron_pickaxe": 1, "minecraft:stone_axe": 1 };

test("drops follow survival rules", () => {
    assert.deepEqual(dropsOf("minecraft:stone"), [{ id: "minecraft:cobblestone", n: 1 }]);
    assert.deepEqual(dropsOf("minecraft:deepslate_iron_ore"), [{ id: "minecraft:raw_iron", n: 1 }]);
    assert.deepEqual(dropsOf("minecraft:grass_block"), [{ id: "minecraft:dirt", n: 1 }]);
    assert.deepEqual(dropsOf("minecraft:oak_log"), [{ id: "minecraft:oak_log", n: 1 }]);
    assert.deepEqual(dropsOf("minecraft:diamond_ore"), [{ id: "minecraft:diamond", n: 1 }]);
    assert.deepEqual(dropsOf("minecraft:oak_leaves", 0.5), []);
    assert.deepEqual(dropsOf("minecraft:bedrock"), []);
    assert.equal(dropsOf("minecraft:gravel", 0.05)[0].id, "minecraft:flint");
    assert.equal(dropsOf("minecraft:gravel", 0.5)[0].id, "minecraft:gravel");
    assert.ok(dropsOf("minecraft:lapis_ore", 0.9)[0].n >= 4);
});

test("tools and tiers", () => {
    assert.equal(toolFor("minecraft:stone"), "pickaxe");
    assert.equal(toolFor("minecraft:oak_log"), "axe");
    assert.equal(toolFor("minecraft:dirt"), "shovel");
    assert.equal(toolFor("minecraft:hay_block"), "hand");
    assert.equal(toolFor("minecraft:iron_block"), "pickaxe");
    assert.equal(requiredTier("minecraft:diamond_ore"), TIER.iron);
    assert.equal(requiredTier("minecraft:deepslate_iron_ore"), TIER.stone);
    assert.equal(requiredTier("minecraft:obsidian"), TIER.diamond);
    assert.equal(requiredTier("minecraft:coal_ore"), TIER.wooden);
    assert.equal(requiredTier("minecraft:oak_log"), 0);
    assert.equal(bestTool(iron, "pickaxe").id, "minecraft:iron_pickaxe");
    assert.equal(bestTool({ "minecraft:stone_pickaxe": 1, "minecraft:diamond_pickaxe": 1 }, "pickaxe").id, "minecraft:diamond_pickaxe");
    assert.equal(bestTool(wooden, "axe"), null);
});

test("harvestCheck explains what is missing", () => {
    assert.equal(harvestCheck("minecraft:stone", {}).ok, false);
    assert.match(harvestCheck("minecraft:stone", {}).reason, /needs a pickaxe/);
    assert.equal(harvestCheck("minecraft:stone", wooden).ok, true);
    assert.match(harvestCheck("minecraft:diamond_ore", wooden).reason, /iron pickaxe/);
    assert.equal(harvestCheck("minecraft:diamond_ore", iron).ok, true);
    assert.equal(harvestCheck("minecraft:oak_log", {}).ok, true);          // by hand, slowly
    assert.match(harvestCheck("minecraft:bedrock", iron).reason, /cannot be broken/);
    assert.match(harvestCheck("minecraft:water", iron).reason, /bucket/);
});

test("break times scale with the tool", () => {
    assert.ok(breakTicks("minecraft:oak_log", {}) > breakTicks("minecraft:oak_log", iron));
    assert.ok(breakTicks("minecraft:stone", wooden) > breakTicks("minecraft:stone", iron));
    assert.ok(breakTicks("minecraft:stone", {}) > breakTicks("minecraft:stone", wooden));   // no pickaxe: the long way
    assert.ok(breakTicks("minecraft:obsidian", { "minecraft:diamond_pickaxe": 1 }) >= 150);
    assert.equal(breakTicks("minecraft:dirt", {}) % 10, 0);
    assert.ok(breakTicks("minecraft:dirt", {}) <= 20);
});

test("materialMatcher understands what the model asks for", () => {
    const ids = ["minecraft:oak_log", "minecraft:spruce_log", "minecraft:stripped_oak_log", "minecraft:diamond_ore", "minecraft:deepslate_iron_ore", "minecraft:stone", "minecraft:cobblestone", "minecraft:grass_block", "minecraft:sand", "minecraft:ancient_debris", "minecraft:coal_ore", "minecraft:gravel"];
    const hits = (w) => ids.filter(materialMatcher(w).pred);
    assert.deepEqual(hits("oak_log"), ["minecraft:oak_log"]);
    assert.deepEqual(hits("wood"), ["minecraft:oak_log", "minecraft:spruce_log"]);
    assert.deepEqual(hits("logs"), ["minecraft:oak_log", "minecraft:spruce_log"]);
    assert.deepEqual(hits("diamonds"), ["minecraft:diamond_ore"]);
    assert.deepEqual(hits("iron"), ["minecraft:deepslate_iron_ore"]);
    assert.deepEqual(hits("raw_iron"), ["minecraft:deepslate_iron_ore"]);
    assert.deepEqual(hits("stone"), ["minecraft:stone", "minecraft:cobblestone"]);
    assert.deepEqual(hits("cobblestone"), ["minecraft:stone", "minecraft:cobblestone"]);
    assert.deepEqual(hits("dirt"), ["minecraft:grass_block"]);
    assert.deepEqual(hits("ores"), ["minecraft:diamond_ore", "minecraft:deepslate_iron_ore", "minecraft:ancient_debris", "minecraft:coal_ore"]);
    assert.deepEqual(hits("flint"), ["minecraft:gravel"]);
    assert.equal(materialMatcher("food").food, true);
    assert.equal(materialMatcher("cow").food, true);
    assert.equal(materialMatcher("sweet berries").crop, "sweet_berry_bush");
    assert.equal(materialMatcher("Spruce Log").label, "spruce logs");
    assert.ok(isOreId("minecraft:deepslate_gold_ore") && isOreId("minecraft:ancient_debris") && !isOreId("minecraft:stone"));
});
