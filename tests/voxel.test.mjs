import test from "node:test";
import assert from "node:assert/strict";
import { toBase64, fromBase64, encodeCells, decodeCells, Palette, packWorld, unpackWorld, MAX_PALETTE, OTHER, MAX_CELLS } from "../packs/RealAI_BP/scripts/brain/voxel.js";

test("base64 agrees with Node's for every length and byte value", () => {
    for (let len = 0; len < 40; len++) {
        const b = new Uint8Array(len).map((_, i) => (i * 37 + len * 11) & 255);
        assert.equal(toBase64(b), Buffer.from(b).toString("base64"), "len " + len);
        assert.deepEqual([...fromBase64(toBase64(b))], [...b]);
    }
    const all = new Uint8Array(256).map((_, i) => i);
    assert.deepEqual([...fromBase64(toBase64(all))], [...all]);
});

test("base64 refuses what is not base64", () => {
    assert.equal(fromBase64("abc"), null);             // not a multiple of 4
    assert.equal(fromBase64("ab!d"), null);
    assert.equal(fromBase64("a=bc"), null);            // padding in the middle
    assert.deepEqual([...fromBase64("YQ==")], [97]);   // valid
    assert.equal(fromBase64("====") , null);
    assert.equal(fromBase64(5), null);
    assert.equal(fromBase64("é234"), null);
});

test("cells round-trip through the run-length coding, including long runs", () => {
    const cells = new Uint8Array(10_000);
    cells.fill(2, 0, 9000); cells.fill(1, 9000, 9500); cells[9500] = 3; cells[9501] = 3; cells.fill(255, 9990);
    const txt = encodeCells(cells);
    assert.ok(txt.length < 100, "compresses: " + txt.length);
    assert.deepEqual([...decodeCells(txt, cells.length)], [...cells]);
    // a run longer than 127 and longer than 16383 (three varint bytes)
    const big = new Uint8Array(40_000).fill(7);
    assert.deepEqual([...decodeCells(encodeCells(big), big.length)], [...big]);
    // alternating values: worst case, still exact
    const alt = new Uint8Array(1000).map((_, i) => i & 1);
    assert.deepEqual([...decodeCells(encodeCells(alt), alt.length)], [...alt]);
    assert.deepEqual([...decodeCells(encodeCells(new Uint8Array(0)), 0)], []);
});

test("the coding matches a hand-made vector", () => {
    // 3 x index 1, then 130 x index 2: (varint 2, 1) (varint 129 = 0x81 0x01, 2)
    assert.equal(toBase64([2, 1, 0x81, 0x01, 2]), "AgGBAQI=");
    const cells = decodeCells("AgGBAQI=", 133);
    assert.deepEqual([...cells.slice(0, 4)], [1, 1, 1, 2]);
    assert.equal(cells[132], 2);
    assert.equal(encodeCells(cells), "AgGBAQI=");
});

test("decoding refuses data of the wrong size or shape", () => {
    const txt = encodeCells(new Uint8Array(100).fill(1));
    assert.equal(decodeCells(txt, 99), null, "too long for the box");
    assert.equal(decodeCells(txt, 101), null, "too short for the box");
    assert.equal(decodeCells(toBase64([5]), 6), null, "a run with no index byte");
    assert.equal(decodeCells(toBase64([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 1]), 10), null, "a varint that never ends");
    assert.equal(decodeCells(txt, -1), null);
    assert.equal(decodeCells(txt, MAX_CELLS + 1), null);
    assert.equal(decodeCells("not base64!", 4), null);
    // a run that claims to be enormous must not allocate or loop
    assert.equal(decodeCells(toBase64([0xff, 0xff, 0xff, 0x7f, 1]), 100), null);
});

test("palette: index 0 is unknown, ids are numbered in order of first use, overflow lands on the last slot", () => {
    const p = new Palette();
    assert.equal(p.index(null), 0); assert.equal(p.index(undefined), 0); assert.equal(p.index(""), 0);
    assert.equal(p.index("minecraft:air"), 1); assert.equal(p.index("minecraft:stone"), 2); assert.equal(p.index("minecraft:air"), 1);
    for (let i = 0; i < 400; i++) p.index("mod:b" + i);
    assert.equal(p.ids.length, 256);
    assert.equal(p.ids[255], OTHER);
    assert.equal(p.index("mod:b399"), 255);
    assert.equal(p.index("minecraft:stone"), 2, "ids already known keep their slot");
    assert.ok(p.ids.slice(0, 255).every(x => typeof x === "string") && p.ids[0] === "");
});

test("a world message round-trips and is checked strictly", () => {
    const W = 5, H = 4, D = 3;
    const pal = new Palette();
    const cells = new Uint8Array(W * H * D);
    for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) cells[(y * D + z) * W + x] = pal.index(y < 2 ? "minecraft:stone" : y === 2 ? (x === 0 ? "minecraft:oak_log" : "minecraft:air") : null);
    const msg = packWorld({ n: 3, d: "overworld", o: [-10, 60, 200], s: [W, H, D], palette: pal, cells });
    assert.equal(msg.t, "vw");
    const wire = JSON.parse(JSON.stringify(msg));
    const w = unpackWorld(wire);
    assert.deepEqual([w.ox, w.oy, w.oz, w.W, w.H, w.D, w.n, w.dim], [-10, 60, 200, 5, 4, 3, 3, "overworld"]);
    assert.deepEqual([...w.cells], [...cells]);
    assert.deepEqual(w.palette, ["", "minecraft:stone", "minecraft:oak_log", "minecraft:air"]);
    // every way to be wrong
    const bad = (patch) => unpackWorld({ ...wire, ...patch });
    assert.equal(bad({ s: [5, 4, 4] }), null, "size does not match the data");
    assert.equal(bad({ s: [0, 4, 3] }), null);
    assert.equal(bad({ s: [100, 4, 3] }), null);
    assert.equal(bad({ s: [65, 64, 65] }), null, "too many cells");
    assert.equal(bad({ s: [5.5, 4, 3] }), null);
    assert.equal(bad({ o: [1, 2] }), null);
    assert.equal(bad({ o: [1, 2, NaN] }), null);
    assert.equal(bad({ o: [1e12, 0, 0] }), null);
    assert.equal(bad({ p: ["minecraft:stone"] }), null, "index 0 must be the unknown block");
    assert.equal(bad({ p: ["", "minecraft:stone"] }), null, "a cell uses an index the palette lacks");
    assert.equal(bad({ p: ["", 5, "x", "y"] }), null);
    assert.equal(bad({ p: ["", "x".repeat(200), "y", "z"] }), null);
    assert.equal(bad({ z: 12 }), null);
    assert.equal(unpackWorld(null), null); assert.equal(unpackWorld("x"), null); assert.equal(unpackWorld({}), null);
    assert.equal(bad({ d: 7 }).dim, "overworld", "a bad dimension name falls back");
});

test("a full-size snapshot is small on the wire", () => {
    const W = 49, H = 32, D = 49;
    const pal = new Palette();
    const cells = new Uint8Array(W * H * D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const surface = 14 + ((x * 7 + z * 3) % 3);
        for (let y = 0; y < H; y++) cells[(y * D + z) * W + x] = pal.index(y < surface - 3 ? "minecraft:stone" : y < surface ? "minecraft:dirt" : y === surface ? "minecraft:grass_block" : "minecraft:air");
    }
    const msg = packWorld({ n: 1, d: "overworld", o: [0, 0, 0], s: [W, H, D], palette: pal, cells });
    const bytes = JSON.stringify(msg).length;
    assert.ok(bytes < 40_000, "a rolling hillside of 76,832 cells is " + bytes + " bytes");
    assert.deepEqual([...unpackWorld(JSON.parse(JSON.stringify(msg))).cells], [...cells]);
});
