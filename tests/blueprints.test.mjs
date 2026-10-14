import { test } from "node:test";
import assert from "node:assert/strict";
import { presetBlueprint } from "../packs/RealAI_BP/scripts/brain/blueprints.js";

test("house has walls, roof, floor, door gap, windows and furniture", () => {
    const bp = presetBlueprint("house", "minecraft:oak_planks", { width: 5, depth: 5, height: 3 });
    assert.ok(bp.length > 60);
    const at = (dx, dy, dz) => bp.find(b => b.dx === dx && b.dy === dy && b.dz === dz);
    assert.equal(at(0, 0, 0), undefined);           // door gap (front centre, bottom)
    assert.equal(at(0, 1, 0), undefined);           // door gap (front centre, top)
    assert.ok(at(-2, 0, 0));                        // front wall corner
    assert.ok(at(0, 3, 2));                         // roof
    assert.ok(at(0, -1, 2));                        // floor
    assert.ok(bp.some(b => b.block === "minecraft:glass"));
    assert.ok(bp.some(b => b.block === "minecraft:torch"));
    assert.ok(bp.some(b => b.block === "minecraft:crafting_table"));
    assert.ok(bp.every(b => Math.abs(b.dx) <= 12 && Math.abs(b.dz) <= 12 && b.dy >= -1 && b.dy <= 12));
});

test("other presets produce bounded blueprints and unknown returns null", () => {
    for (const p of ["shelter", "wall", "tower", "bridge", "pillar", "farm"]) {
        const bp = presetBlueprint(p, "minecraft:cobblestone", { width: 16, height: 12, depth: 16 });
        assert.ok(Array.isArray(bp) && bp.length > 0, p);
        assert.ok(bp.length <= 400, p + " too big: " + bp.length);
    }
    assert.equal(presetBlueprint("castle", "minecraft:stone"), null);
});
