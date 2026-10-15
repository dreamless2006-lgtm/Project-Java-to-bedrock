import test from "node:test";
import assert from "node:assert/strict";
import { createMemory, noteChest, forgetChest, noteBuild, findOwned, renderMemory, saveMemory, loadMemory } from "../packs/RealAI_BP/scripts/brain/memory.js";

test("chests and builds are remembered, found by position, rendered and saved", () => {
    const m = createMemory();
    const t = 1_000_000;
    noteChest(m, { x: 10.7, y: 64, z: -2.7, items: ["oak planks x64", "coal x12"] }, t);
    noteChest(m, { x: 10, y: 64, z: -3, items: ["oak planks x32"] }, t + 5000);   // same chest, refreshed
    assert.equal(m.chests.length, 1);
    assert.deepEqual(m.chests[0].items, ["oak planks x32"]);
    noteBuild(m, { name: "house", x1: 20, y1: 64, z1: 20, x2: 15, y2: 67, z2: 24 }, t);
    assert.equal(m.builds[0].x1, 15); assert.equal(m.builds[0].x2, 20);
    assert.equal(findOwned(m, { x: 10.2, y: 64.9, z: -2.5 }).kind, "chest");
    assert.equal(findOwned(m, { x: 16, y: 65, z: 22 }).name, "house");
    assert.equal(findOwned(m, { x: 14, y: 65, z: 22 }).kind, "build", "one block outside the box still counts");
    assert.equal(findOwned(m, { x: 12, y: 65, z: 22 }), null);
    assert.equal(findOwned(m, { x: 16, y: 65, z: 22 }, "minecraft:nether"), null, "another dimension");
    const text = renderMemory(m, t + 60_000);
    assert.match(text, /My things:/);
    assert.match(text, /my chest at 10 64 -3: oak planks x32 \(checked/);
    assert.match(text, /my house at 15 64 20 to 20 67 24/);
    const back = loadMemory(saveMemory(m));
    assert.equal(back.chests.length, 1); assert.equal(back.builds.length, 1);
    assert.equal(forgetChest(m, { x: 10, y: 64, z: -3 }), true);
    assert.equal(m.chests.length, 0);
    assert.equal(forgetChest(m, { x: 10, y: 64, z: -3 }), false);
});

test("the lists stay bounded", () => {
    const m = createMemory();
    for (let i = 0; i < 20; i++) { noteChest(m, { x: i, y: 1, z: 1 }, i); noteBuild(m, { name: "b" + i, x1: i, y1: 0, z1: 0, x2: i, y2: 1, z2: 1 }, i); }
    assert.equal(m.chests.length, 8); assert.equal(m.builds.length, 6);
    assert.equal(m.chests[0].x, 12); assert.equal(m.builds[0].name, "b14");
});
