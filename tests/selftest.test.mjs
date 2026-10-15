// The bridge's self-test against small in-process servers: one that accepts movement, one that clamps the body at walls without
// saying so, one that pulls it back, one that ignores it, and one that drops inputs numbered the wrong way. The verdicts come from
// what the server model says the body's position is (the same /tp @s ~ ~ ~ the real self-test asks).
import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../bridge/index.mjs";
import { EYE_HEIGHT } from "../bridge/body.mjs";

const SCALE = 10;           // ten times faster than real time

function simulate({ walls = [], freeze = false, rubber = false, dropSmallTicks = false, deadPackets = 0, stepRing = null } = {}) {
    const b = new Bridge({ _path: "test", defaults: { provider: "openai" }, providers: { openai: { apiKey: "k" } }, connect: { username: "Bot" }, selfTest: true });
    const truth = { x: 100.5, y: 64, z: 100.5, yaw: 0, pitch: 0 };
    let packets = 0;
    const inWall = (x, z) => walls.some(w => x > w.x1 && x < w.x2 && z > w.z1 && z < w.z2);
    const sent = [];
    b.client = {
        username: "Bot", status: 4, on() {},
        queue(name, params) {
            sent.push(name);
            if (name === "player_auth_input") {
                if (freeze) { if (rubber) b.body.onMovePlayer({ runtime_id: b.body.runtimeId, mode: "teleport", position: { x: truth.x, y: truth.y + EYE_HEIGHT, z: truth.z }, yaw: truth.yaw, pitch: truth.pitch, on_ground: true }); return; }
                if (++packets <= deadPackets) return;                                 // the server is not simulating us yet
                if (dropSmallTicks && params.tick < 1000n) return;
                const x = params.position.x, z = params.position.z;
                const level = (a, c) => Math.floor(Math.hypot(a - 100.5, c - 100.5) / stepRing);               // terrain that steps down, a block every stepRing blocks, away from the spawn
                const blockedStep = stepRing !== null && level(x, z) < level(truth.x, truth.z);                  // down is free, back up needs a jump
                if (!inWall(x, z) && !blockedStep && Math.hypot(x - truth.x, z - truth.z) < 0.8) { truth.x = x; truth.z = z; if (stepRing !== null) truth.y = 64 - level(x, z); }     // a wall clamps the body without a word, and a claim that jumps is not believed
                truth.yaw = params.yaw; truth.pitch = params.pitch;
            } else if (name === "command_request" && /^\/tp @s ~ ~ ~/.test(params.command)) {
                b.body.onMovePlayer({ runtime_id: b.body.runtimeId, mode: "teleport", position: { x: truth.x, y: truth.y + EYE_HEIGHT, z: truth.z }, yaw: truth.yaw, pitch: truth.pitch, on_ground: true });
            }
        },
    };
    b.entityId = 7n;
    b.body.onStartGame({ runtime_entity_id: 7n, player_position: { x: truth.x, y: truth.y, z: truth.z }, rotation: { x: 0, z: 0 }, current_tick: 5000n, rewind_history_size: 0, player_gamemode: "survival" });
    b.spawned = true;
    b.sendToAddon = () => { throw new Error("the self-test must not talk to the addon"); };
    b.sendToAddon = Bridge.prototype.sendToAddon.bind(b);
    const timer = setInterval(() => b.bodyTick(), 50 / SCALE);
    const run = async () => {
        const lines = [];
        try { const res = await b.selfTest(l => lines.push(l), { timeScale: SCALE }); return { ...res, lines, truth, b }; }
        finally { clearInterval(timer); }
    };
    return { run, b, truth, sent };
}
const wall = (x1, z1, x2, z2) => ({ x1, z1, x2, z2 });

test("a server that accepts movement: every leg is judged and passes", { timeout: 60000 }, async () => {
    const r = await simulate().run();
    assert.ok(r.ok, r.lines.join("\n"));
    assert.equal(r.checks.filter(c => !c.skipped).length >= 8, true, r.lines.join("\n"));
    assert.ok(!r.checks.some(c => c.skipped), "nothing skipped on open ground:\n" + r.lines.join("\n"));
    assert.ok(r.lines.every(l => !/^FAIL/.test(l)));
});

test("a wall 7 blocks south does not fail a healthy server: another heading is used and the legs fit the ground crossed", { timeout: 60000 }, async () => {
    const r = await simulate({ walls: [wall(90, 106, 112, 108)] }).run();
    assert.ok(r.ok, r.lines.join("\n"));
    assert.ok(r.lines.some(l => /walking forward.*(west|north|east)/.test(l)), "it walked another way:\n" + r.lines.join("\n"));
});

test("a body boxed in by walls: the server did move it, so that is reported as accepted, with the rest skipped", { timeout: 60000 }, async () => {
    const r = await simulate({ walls: [wall(97, 97, 104, 99), wall(97, 102, 104, 104), wall(97, 97, 99, 104), wall(102, 97, 104, 104)] }).run();       // a pen three blocks wide
    assert.ok(r.ok, r.lines.join("\n"));
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.ok(walk && walk.ok && /something stopped it in every direction/.test(walk.detail), walk && walk.detail);
    assert.ok(r.checks.some(c => c.skipped && /rest of the legs/.test(c.name)));
});

test("walls so close that the body cannot move at all: the verdict is 'no room', not a blamed server", { timeout: 60000 }, async () => {
    const r = await simulate({ walls: [wall(98.5, 98.5, 102.5, 100), wall(98.5, 101, 102.5, 102.5), wall(98.5, 98.5, 100, 102.5), wall(101, 98.5, 102.5, 102.5)] }).run();
    assert.equal(r.ok, false);
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.ok(walk && !walk.ok && /something blocks all four directions/.test(walk.detail), walk && walk.detail);
});

test("a server that silently ignores movement fails, and says so", { timeout: 60000 }, async () => {
    const r = await simulate({ freeze: true }).run();
    assert.equal(r.ok, false);
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.ok(walk && !walk.ok && /ignores this client's movement/.test(walk.detail), walk && walk.detail);
});

test("a server that pulls the body back every time fails as rubber-banding", { timeout: 60000 }, async () => {
    const r = await simulate({ freeze: true, rubber: true }).run();
    assert.equal(r.ok, false);
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.ok(walk && !walk.ok && /rubber-banding/.test(walk.detail), walk && walk.detail);
    assert.ok(r.checks.some(c => /pulling the body back/.test(c.name) && !c.ok));
});

test("a server that drops inputs numbered from zero: the other numbering is tried, proved by a control run, and recommended", { timeout: 60000 }, async () => {
    const sim = simulate({ dropSmallTicks: true });
    const r = await sim.run();
    assert.ok(r.ok, r.lines.join("\n"));
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.match(walk.detail, /only with input ticks counted the "server" way/);
    assert.equal(sim.b.body.tickBase, "server");
});

test("a server that merely started late is not blamed on the tick numbering", { timeout: 60000 }, async () => {
    const r = await simulate({ deadPackets: 400 }).run();      // 20 s of ticks: the first round of headings finds nothing, the second works
    assert.ok(r.ok, r.lines.join("\n"));
    const walk = r.checks.find(c => /walking forward/.test(c.name));
    assert.doesNotMatch(walk.detail, /set "tickBase"/, walk.detail);
    assert.match(walk.detail, /not the reason|just needed time/, walk.detail);
});

test("the self-test never talks to the addon", { timeout: 60000 }, async () => {
    const sim = simulate();
    const sentToAddon = [];
    sim.b.outQueue.length = 0;
    const r = await sim.run();
    sentToAddon.push(...sim.b.outQueue.filter(c => /realai:in/.test(c)));
    assert.ok(r.ok);
    assert.equal(sentToAddon.length, 0, "nothing queued for the addon: " + sentToAddon.slice(0, 2));
    sim.b.onDeath("health 0");
    assert.equal(sim.b.outQueue.filter(c => /realai:in/.test(c)).length, 0, "not even a death notice");
    sim.b.stopRespawnLoop();
});

test("the way back over a step down is uphill: the real Realm's terrain must not fail a healthy server, the legs are skipped and the heights are reported", { timeout: 60000 }, async () => {
    const r = await simulate({ stepRing: 3.5 }).run();
    assert.ok(r.ok, r.lines.join("\n"));
    assert.ok(r.lines.some(l => /^SKIP\s+stepping back/.test(l)), "stepping back is skipped, not failed:\n" + r.lines.join("\n"));
    assert.ok(r.lines.some(l => /^SKIP\s+sprinting/.test(l)));
    assert.ok(r.lines.some(l => /^PASS\s+walking forward.*not flat/.test(l)), "the walk says the ground was not flat:\n" + r.lines.join("\n"));
    assert.ok(r.lines.some(l => /^PASS\s+strafing/.test(l)) && r.lines.some(l => /^PASS\s+sneaking/.test(l)), "the legs that can be judged still are");
});
