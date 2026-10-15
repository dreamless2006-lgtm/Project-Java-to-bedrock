import test from "node:test";
import assert from "node:assert/strict";
import { Body, EYE_HEIGHT, SPEED, PHYS, GROUND_DELTA_Y, INPUT_ORDINAL } from "../bridge/body.mjs";

const start = (b, pos = { x: 10, y: 64, z: 10 }) => { b.startConvention = "feet"; b.startIsEye = false; b.calibrated = true; return b.onStartGame({ runtime_entity_id: 7n, player_position: pos, rotation: { x: 0, z: 90 }, current_tick: 1000n, rewind_history_size: 40, player_gamemode: "survival" }); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sorted = (flags) => flags.every((f, i) => i === 0 || INPUT_ORDINAL[flags[i - 1]] < INPUT_ORDINAL[f]);

test("start_game seeds feet from player_position, tick from zero, and idle packets look like a standing client", () => {
    const b = new Body();
    assert.equal(b.step(), null);
    start(b);
    assert.deepEqual(b.pos, { x: 10, y: 64, z: 10 });
    assert.equal(b.yaw, 90);
    const p = b.step();
    assert.equal(p.tick, 1n);
    assert.deepEqual(p.position, { x: 10, y: 64 + EYE_HEIGHT, z: 10 });
    assert.deepEqual(p.input_data, ["block_breaking_delay_enabled", "vertical_collision"]);
    assert.deepEqual(p.move_vector, { x: 0, z: 0 });
    assert.deepEqual(p.analogue_move_vector, { x: 0, z: 0 });
    assert.ok(near(p.delta.y, GROUND_DELTA_Y) && p.delta.x === 0 && p.delta.z === 0);
    assert.equal(p.input_mode, "mouse"); assert.equal(p.play_mode, "screen"); assert.equal(p.interaction_model, "touch");
    for (const k of ["pitch", "yaw", "head_yaw", "interact_rotation", "camera_orientation", "raw_move_vector"]) assert.ok(k in p, k);
    assert.equal(b.step().tick, 2n);
    const eye = new Body({ startGameEyeLevel: true }); eye.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64 + EYE_HEIGHT, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 1n, rewind_history_size: 0 });
    assert.ok(near(eye.pos.y, 64));
    // a Realm (BDS, rewind history 40) sent start_game y 70.62 for feet at 69.00: with nothing configured the height is read as eye level
    const realm = new Body(); realm.onStartGame({ runtime_entity_id: 7n, player_position: { x: -347.17, y: 70.62, z: -1001.13 }, rotation: { x: 0, z: 0 }, current_tick: 5000n, rewind_history_size: 40 });
    assert.ok(near(realm.pos.y, 69.0, 1e-9), "feet at " + realm.pos.y);
    // and a server that did mean feet is noticed from its first position report
    const feetServer = new Body(); feetServer.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 1n, rewind_history_size: 40 });
    assert.ok(near(feetServer.pos.y, 64 - EYE_HEIGHT, 1e-9));
    feetServer.anchorFrom({ x: 0, y: 64, z: 0 }, true);
    assert.equal(feetServer.startIsEye, false, "flipped to feet");
    const configured = new Body({ startConvention: "feet" }); configured.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 1n, rewind_history_size: 40 });
    assert.equal(configured.pos.y, 64);
});

test("walking accelerates like the server simulates, converges to vanilla speed and stops near the target", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 10, y: 64, z: 20 });
    const steps = [];
    let prev = b.pos.z, last = null;
    for (let i = 0; i < 80 && (b.target || Math.abs(b.vel.z) > 1e-4); i++) { last = b.step(); steps.push(b.pos.z - prev); prev = b.pos.z; }
    assert.ok(near(steps[0], 0.098, 1e-4) && near(steps[1], 0.1515, 1e-4) && near(steps[2], 0.1807, 1e-4), "vanilla ramp: " + steps.slice(0, 3));
    assert.ok(near(steps[20], SPEED.walk, 1e-3), "steady walk " + steps[20]);
    assert.ok(Math.abs(b.pos.z - 20) < 0.5 && b.pos.x === 10, "stopped near the target: " + b.pos.z);
    assert.ok(!b.target && b.vel.z < 1e-3, "friction stopped the body after the key was released");
    const walking = new Body(); start(walking); walking.walkTo({ x: 10, y: 64, z: 20 });
    const p1 = walking.step();
    assert.ok(p1.input_data.includes("up") && sorted(p1.input_data), "forward key, flags in ordinal order");
    assert.deepEqual(p1.move_vector, { x: 0, z: 1 }); assert.deepEqual(p1.raw_move_vector, { x: 0, z: 1 }); assert.deepEqual(p1.analogue_move_vector, { x: 0, z: 0 });
    assert.ok(near(p1.yaw, 0), "faces +z");
    assert.ok(near(p1.delta.z, 0.098 * PHYS.airFriction * PHYS.blockFriction, 1e-6), "delta is the post-friction velocity");
    for (let i = 0; i < 30; i++) last = walking.step();
    assert.ok(near(last.delta.z, 0.1178, 1e-3), "steady reported velocity " + last.delta.z);
});

test("sprinting: edge flags once, key flags every tick, converges to sprint speed", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: -30, y: 64, z: 10 }, "sprint");
    const p1 = b.step();
    assert.ok(p1.input_data.includes("start_sprinting") && p1.input_data.includes("sprint_down") && p1.input_data.includes("sprinting") && p1.input_data.includes("up"));
    assert.ok(near(p1.yaw, 90), "west is yaw 90");
    const p2 = b.step();
    assert.ok(!p2.input_data.includes("start_sprinting") && p2.input_data.includes("sprinting") && p2.input_data.includes("sprint_down"));
    let prev = b.pos.x, step = 0;
    for (let i = 0; i < 30; i++) { b.step(); step = prev - b.pos.x; prev = b.pos.x; }
    assert.ok(near(step, SPEED.sprint, 1e-3), "steady sprint " + step);
    b.stop();
    const p3 = b.step();
    assert.ok(p3.input_data.includes("stop_sprinting") && !p3.input_data.includes("up"));
    assert.ok(!b.step().input_data.includes("stop_sprinting"));
});

test("a jump follows the vanilla arc, lands on a block one up and reports the key release", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 10, y: 65, z: 12 });
    b.jump();
    const p1 = b.step();
    for (const f of ["start_jumping", "jump_pressed_raw", "jump_down", "jumping", "want_up", "jump_current_raw", "up"]) assert.ok(p1.input_data.includes(f), f);
    assert.ok(!p1.input_data.includes("vertical_collision"), "airborne");
    assert.ok(sorted(p1.input_data));
    const ys = [b.pos.y - 64];
    let landed = null;
    for (let i = 0; i < 20; i++) { const p = b.step(); ys.push(+(b.pos.y - 64).toFixed(4)); if (p.input_data.includes("jump_released_raw")) { landed = i + 2; break; } }
    assert.ok(near(ys[0], 0.42) && near(ys[1], 0.7532, 1e-3) && near(ys[2], 1.0013, 1e-3), "arc " + ys.slice(0, 3));
    assert.ok(Math.max(...ys) < 1.26 && Math.max(...ys) > 1.25, "peak " + Math.max(...ys));
    assert.ok(landed && b.onGround && b.pos.y === 65 && b.floor === 65, `landed on the step at tick ${landed}`);
    assert.ok(!b.jumping);
    b.jump(); const again = b.step();
    assert.ok(!again.input_data.includes("start_jumping") || b.jumpDelay === PHYS.jumpDelay - 1, "no second jump inside the cooldown");
});

test("a full block up without a jump hint makes the body jump by itself; a step down falls under gravity", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 10, y: 65, z: 11.5 });
    let jumped = false;
    for (let i = 0; i < 40; i++) { const p = b.step(); if (p.input_data.includes("start_jumping")) jumped = true; if (!b.target && b.onGround) break; }
    assert.ok(jumped && b.pos.y === 65 && b.floor === 65, "jumped onto the block: y " + b.pos.y);
    b.walkTo({ x: 10, y: 63, z: 14 });
    let airborne = false;
    for (let i = 0; i < 60; i++) { const p = b.step(); if (!p.input_data.includes("vertical_collision")) airborne = true; if (!b.target && b.onGround) break; }
    assert.ok(airborne && b.pos.y === 63 && b.floor === 63, "fell down to the lower ground: y " + b.pos.y);
});

test("server teleports, corrections and motion are adopted; a teleport is acknowledged once at its exact position", () => {
    const b = new Body(); start(b);
    assert.equal(b.onMovePlayer({ runtime_id: 99n, position: { x: 0, y: 0, z: 0 }, mode: "teleport" }), false);
    b.walkTo({ x: 20, y: 64, z: 10 }); b.step();
    assert.equal(b.onMovePlayer({ runtime_id: 7n, position: { x: 100, y: 70 + EYE_HEIGHT, z: -5 }, yaw: 180, pitch: 10, mode: "teleport", on_ground: true }), true);
    assert.deepEqual(b.pos, { x: 100, y: 70, z: -5 });
    assert.equal(b.target, null, "a stale target is dropped by a long teleport");
    const p1 = b.step();
    assert.deepEqual(p1.input_data, ["handled_teleport", "block_breaking_delay_enabled", "vertical_collision"]);
    assert.deepEqual(p1.position, { x: 100, y: 70 + EYE_HEIGHT, z: -5 });
    assert.deepEqual(p1.move_vector, { x: 0, z: 0 });
    assert.ok(!b.step().input_data.includes("handled_teleport"));
    b.onMovePlayer({ runtime_id: 7n, position: { x: 100.5, y: 70 + EYE_HEIGHT, z: -5 }, mode: "reset", on_ground: true });
    assert.ok(!b.step().input_data.includes("handled_teleport"), "reset adopts without the flag");
    b.onMovePlayer({ runtime_id: 7n, position: { x: 0, y: 0, z: 0 }, pitch: 33, mode: "rotation" });
    assert.ok(b.pos.x === 100.5 && b.pitch === 33, "rotation mode changes the pitch only");
    b.walkTo({ x: 110, y: 70, z: -5 }); b.step(); b.step();
    const ours = b.tick;
    assert.equal(b.onCorrection({ prediction_type: "player", position: { x: 100, y: 70 + EYE_HEIGHT, z: -5 }, delta: { x: 0.1, y: -0.0784, z: 0 }, on_ground: true, tick: ours }), true);
    assert.deepEqual(b.pos, { x: 100, y: 70, z: -5 });
    assert.ok(near(b.vel.x, 0.1) && b.corrections === 1 && b.target, "snapped, velocity adopted, still walking");
    assert.equal(b.onCorrection({ prediction_type: "player", position: { x: 0, y: 0, z: 0 }, delta: { x: 0, y: 0, z: 0 }, on_ground: true, tick: ours + 5n }), false, "a tick from the future is ignored");
    assert.equal(b.onCorrection({ prediction_type: "player", position: { x: 0, y: 0, z: 0 }, delta: { x: 0, y: 0, z: 0 }, on_ground: true, tick: ours - 100n }), false, "an ancient tick is ignored");
    assert.equal(b.onCorrection({ prediction_type: "vehicle", position: { x: 0, y: 0, z: 0 }, tick: ours }), false);
    assert.equal(b.onMotion({ runtime_entity_id: 7n, velocity: { x: 0.3, y: 0.4, z: 0 } }), true);
    assert.ok(b.vel.y === 0.4 && !b.onGround, "knockback sets the velocity");
});

test("respawn: the body presses the button, closes the exchange when the server is ready, and sends nothing while dead", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 0, y: 64, z: 0 });
    assert.deepEqual(b.onRespawn({ runtime_entity_id: 7n, position: { x: 0, y: 0, z: 0 }, state: 0 }), []);
    assert.equal(b.alive, false); assert.equal(b.target, null);
    const t = b.tick;
    assert.equal(b.step(), null);
    assert.equal(b.tick, t + 1n, "the tick keeps counting while dead");
    const click = b.respawnPackets(1);
    assert.equal(click.length, 1);
    assert.equal(click[0].name, "player_action"); assert.equal(click[0].params.action, "respawn"); assert.equal(click[0].params.runtime_entity_id, 7n);
    const retry = b.respawnPackets(2);
    assert.deepEqual(retry.map(p => p.name), ["player_action", "respawn"]);
    assert.equal(retry[1].params.state, 2);
    const out = b.onRespawn({ runtime_entity_id: 7n, position: { x: 3, y: 65 + EYE_HEIGHT, z: 4 }, state: 1 });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "respawn"); assert.equal(out[0].params.state, 2); assert.equal(out[0].params.runtime_entity_id, 7n);
    assert.equal(b.alive, true);
    assert.deepEqual(b.pos, { x: 3, y: 65, z: 4 });
    assert.ok(b.step().input_data.includes("handled_teleport"), "the spawn teleport is acknowledged");
    assert.deepEqual(b.step().input_data, ["block_breaking_delay_enabled", "vertical_collision"]);
    assert.deepEqual(b.onRespawn({ runtime_entity_id: 7n, position: { x: 0, y: 0, z: 0 }, state: 2 }), []);
    b.markDead();
    assert.equal(b.alive, false); assert.equal(b.deaths, 2, "once for the server's state 0, once now");
});

test("dimension change: loading screen start with the id, ack and end when the server acknowledges", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 0, y: 64, z: 0 });
    const out = b.onChangeDimension({ dimension: 1, position: { x: 5, y: 70, z: 6 }, respawn: false, loading_screen_id: 9 });
    assert.deepEqual(out, [{ name: "serverbound_loading_screen", params: { type: 1, loading_screen_id: 9 } }]);
    assert.deepEqual(b.pos, { x: 5, y: 70, z: 6 }); assert.equal(b.target, null);
    assert.deepEqual(b.onPlayerAction({ action: "jump" }), []);
    const ack = b.onPlayerAction({ action: "dimension_change_ack" });
    assert.equal(ack[0].name, "player_action"); assert.equal(ack[0].params.action, "dimension_change_ack");
    assert.deepEqual(ack[1], { name: "serverbound_loading_screen", params: { type: 2, loading_screen_id: 9 } });
    assert.deepEqual(b.onPlayerAction({ action: "dimension_change_ack" }), [], "only once");
    const noId = b.onChangeDimension({ dimension: 0, position: { x: 1, y: 2, z: 3 }, respawn: true });
    assert.deepEqual(noId[0].params, { type: 1 });
});

test("the addon's view of the body resyncs a drifted body, but not a single outlier or a pending teleport", () => {
    const b = new Body(); start(b);
    assert.equal(b.anchorFrom({ x: 10.4, y: 64, z: 10 }), false);
    assert.equal(b.anchorFrom({ x: 20, y: 64, z: 10 }), false, "first gap is noted only");
    assert.equal(b.anchorFrom({ x: 10.2, y: 64, z: 10 }), false, "a single outlier resets the count");
    assert.equal(b.anchorFrom({ x: 20, y: 64, z: 10 }), false);
    assert.equal(b.anchorFrom({ x: 20, y: 64, z: 10 }), true, "two gaps in a row resync");
    assert.deepEqual(b.pos, { x: 20, y: 64, z: 10 }); assert.equal(b.resyncs, 1);
    b.onMovePlayer({ runtime_id: 7n, position: { x: 50, y: 64 + EYE_HEIGHT, z: 50 }, mode: "teleport", on_ground: true });
    assert.equal(b.anchorFrom({ x: 20, y: 64, z: 10 }), false);
    assert.equal(b.anchorFrom({ x: 20, y: 64, z: 10 }), false, "never while a teleport is pending");
});

test("lookAt turns the head without moving", () => {
    const b = new Body(); start(b);
    b.lookAt({ x: 10, y: 64 + EYE_HEIGHT + 5, z: 20 });
    assert.ok(near(b.yaw, 0) && b.pitch < -20 && b.pitch > -30);
    const p = b.step();
    assert.deepEqual(p.position, { x: 10, y: 64 + EYE_HEIGHT, z: 10 });
    assert.deepEqual(b.status().pos, { x: 10, y: 64, z: 10 });
    assert.equal(b.status().gameMode, "survival");
});

test("raw keys: forward goes the way the head faces, back goes the other way, strafe left is the body's left", () => {
    const run = (keys, yaw = 0, ticks = 30) => {
        const b = new Body(); start(b); b.setLook(yaw, 0);
        b.press({ ms: 5000, ...keys });
        let p; for (let i = 0; i < ticks; i++) p = b.step();
        return { b, p, dx: b.pos.x - 10, dz: b.pos.z - 10 };
    };
    let r = run({ f: 1 });                       // facing south (+z)
    assert.ok(r.dz > 3 && Math.abs(r.dx) < 1e-9, "forward is +z at yaw 0: " + r.dz);
    assert.ok(r.p.input_data.includes("up") && !r.p.input_data.includes("down") && sorted(r.p.input_data));
    assert.equal(r.b.yaw, 0, "holding a key does not turn the head");
    r = run({ f: -1 });
    assert.ok(r.dz < -3 && Math.abs(r.dx) < 1e-9, "back is -z: " + r.dz);
    assert.ok(r.p.input_data.includes("down"));
    assert.deepEqual(r.p.move_vector, { x: 0, z: -1 });
    r = run({ s: 1 });                           // facing south, the left hand is east (+x)
    assert.ok(r.dx > 3 && Math.abs(r.dz) < 1e-9, "left of a south-facing body is +x: " + r.dx);
    assert.ok(r.p.input_data.includes("left"));
    r = run({ s: -1 });
    assert.ok(r.dx < -3, "right is -x");
    r = run({ f: 1 }, 90);                       // facing west (-x)
    assert.ok(r.dx < -3 && Math.abs(r.dz) < 1e-6, "forward at yaw 90 is -x: " + r.dx);
    r = run({ f: 1 }, -90);
    assert.ok(r.dx > 3, "forward at yaw -90 is +x");
});

test("raw keys: a diagonal is no faster than straight on, sneaking is slow, sprinting is fast, and the lease runs out", () => {
    const speed = (keys, ticks = 40) => { const b = new Body(); start(b); b.setLook(0, 0); b.press({ ms: 5000, ...keys }); const a = { ...b.pos }; for (let i = 0; i < ticks; i++) b.step(); const z = { ...b.pos }; return Math.hypot(z.x - a.x, z.z - a.z) / ticks; };
    const straight = speed({ f: 1 }), diag = speed({ f: 1, s: 1 }), sneak = speed({ f: 1, sneak: true }), sprint = speed({ f: 1, sprint: true });
    assert.ok(Math.abs(diag - straight) / straight < 0.06, `diagonal ${diag.toFixed(3)} vs straight ${straight.toFixed(3)}`);
    assert.ok(sneak < straight * 0.45, `sneaking ${sneak.toFixed(3)} vs ${straight.toFixed(3)}`);
    assert.ok(sprint > straight * 1.2, `sprinting ${sprint.toFixed(3)} vs ${straight.toFixed(3)}`);
    const b = new Body(); start(b); b.setLook(0, 0);
    b.press({ f: 1, ms: 200 });                  // four ticks and the key lets go by itself
    let last; for (let i = 0; i < 4; i++) last = b.step();
    assert.ok(last.input_data.includes("up"));
    for (let i = 0; i < 3; i++) last = b.step();
    assert.ok(!last.input_data.includes("up") && b.keys === null, "released after the lease");
    for (let i = 0; i < 60; i++) b.step();
    assert.ok(Math.hypot(b.vel.x, b.vel.z) < 1e-3, "and friction stops the body");
    assert.ok(b.pos.z - 10 > 0.2 && b.pos.z - 10 < 1.2, "having moved about a block: " + (b.pos.z - 10));
});

test("raw keys: sneak and sprint edges, jump held, the ground a step ahead, stop and press with nothing", () => {
    const b = new Body(); start(b); b.setLook(0, 0);
    b.press({ f: 1, sneak: true, ms: 5000 });
    let p = b.step();
    assert.ok(p.input_data.includes("start_sneaking") && p.input_data.includes("sneaking") && sorted(p.input_data));
    p = b.step();
    assert.ok(!p.input_data.includes("start_sneaking") && p.input_data.includes("sneaking"));
    b.press({ f: 1, sprint: true, ms: 5000 });
    p = b.step();
    assert.ok(p.input_data.includes("stop_sneaking") && p.input_data.includes("start_sprinting"));
    // a ledge one block up: the ground ahead says 65, the body hops by itself
    const c = new Body(); start(c); c.setLook(0, 0);
    let peak = 64; let landed = null;
    for (let i = 0; i < 40; i++) { c.press({ f: 1, ms: 300, floor: 65 }); c.step(); peak = Math.max(peak, c.pos.y); if (c.onGround && c.pos.y >= 64.99) { landed = c.pos.y; break; } }
    assert.ok(peak > 64.9 && landed === 65, `hopped onto the ledge: peak ${peak.toFixed(2)}, landed ${landed}`);
    // held jump hops again and again
    const d = new Body(); start(d);
    let jumps = 0; for (let i = 0; i < 60; i++) { d.press({ jump: true, ms: 300 }); const q = d.step(); if (q.input_data.includes("start_jumping")) jumps++; }
    assert.ok(jumps >= 3, "hops repeatedly: " + jumps);
    // stop() and an empty press let go
    const e = new Body(); start(e); e.press({ f: 1, ms: 5000 }); e.stop(); assert.equal(e.keys, null);
    e.press({ f: 1, ms: 5000 }); e.press({}); assert.equal(e.keys, null);
    // dead bodies press nothing
    const f = new Body(); start(f); f.alive = false; assert.equal(f.press({ f: 1 }), false);
});

test("setLook turns the head to an absolute yaw and pitch, wrapped and clamped", () => {
    const b = new Body(); start(b);
    b.setLook(270, 100); assert.equal(b.yaw, -90); assert.equal(b.pitch, 90);
    b.setLook(-200, -120); assert.ok(near(b.yaw, 160)); assert.equal(b.pitch, -90);
    b.setLook(undefined, 10); assert.ok(near(b.yaw, 160)); assert.equal(b.pitch, 10);
    const p = b.step(); assert.ok(near(p.yaw, 160) && p.pitch === 10 && p.head_yaw === p.yaw);
});

// ---- corrections are replayed, floors come from the server, jumps and walks do not linger --------------------

// A toy authoritative server with the same physics and one-way latency `d` ticks each way. It compares each claim with
// its own position at that tick and answers with ITS state at that tick (what a rewind server sends) when more than 0.5 off.
function latencyRun({ d, sprint }) {
    const mk = () => { const b = new Body(); start(b, { x: 0, y: 64, z: 0 }); b.setLook(0, 0); return b; };
    const client = mk(), server = mk();
    const toServer = [], toClient = [];
    let corrections = 0;
    for (let now = 1; now <= 200; now++) {
        if (now === 40) server.pos.z += 1.0;              // a disturbance the client could not know about (a ledge, a lag spike)
        client.press({ f: 1, sprint, ms: 250 });
        const pkt = client.step();
        toServer.push([now + d, pkt]);
        while (toServer.length && toServer[0][0] <= now) {
            const [, p] = toServer.shift();
            server.press({ f: 1, sprint, ms: 250 }); server.step();
            const err = Math.hypot(p.position.x - server.pos.x, p.position.y - (server.pos.y + EYE_HEIGHT), p.position.z - server.pos.z);
            if (err > 0.5) toClient.push([now + d, { tick: p.tick, pos: { ...server.pos }, vel: { ...server.vel } }]);
        }
        while (toClient.length && toClient[0][0] <= now) {
            const [, c] = toClient.shift();
            if (now > 100) corrections++;
            client.onCorrection({ prediction_type: "player", tick: c.tick, position: { x: c.pos.x, y: c.pos.y + EYE_HEIGHT, z: c.pos.z }, delta: c.vel, on_ground: true });
        }
    }
    return corrections;
}

test("a correction is followed by a replay of the inputs sent since, so a link with latency settles after one", () => {
    for (const [d, sprint] of [[2, false], [3, false], [3, true], [4, true]]) {
        const n = latencyRun({ d, sprint });
        assert.ok(n <= 2, `one-way latency ${d * 50} ms, ${sprint ? "sprint" : "walk"}: ${n} corrections in the last 5 s (without the replay every tick draws one)`);
    }
});

test("the ground height is learned from the server: a snow layer, a path block, a slab", () => {
    const b = new Body(); start(b); b.step();
    assert.equal(b.pos.y, 64);
    b.anchorFrom({ x: 10, y: 64.375, z: 10 }, true);       // the server stands us 0.375 higher
    assert.equal(b.floor, 64.375); assert.equal(b.pos.y, 64.375);
    for (let i = 0; i < 5; i++) b.step();
    assert.equal(b.pos.y, 64.375, "and the body stays there");
    const lower = new Body(); start(lower); lower.step();
    lower.anchorFrom({ x: 10, y: 63.9375, z: 10 }, true);  // a path block is 15/16 high
    assert.ok(Math.abs(lower.pos.y - 63.9375) < 1e-9);
    // a report from the air, or a whole block away (a ledge climbed meanwhile), is not taken as the ground
    const air = new Body(); start(air); air.step();
    air.anchorFrom({ x: 10, y: 64.3, z: 10 }, false); assert.equal(air.pos.y, 64);
    air.anchorFrom({ x: 10, y: 63, z: 10 }, true); assert.equal(air.pos.y, 64);
});

test("a late position report does not look like drift: it is judged against where the body was over the last few ticks", () => {
    const b = new Body(); start(b); b.setLook(0, 0);
    const reports = [];
    for (let i = 0; i < 80; i++) {
        b.press({ f: 1, sprint: true, ms: 250 });
        b.step();
        reports.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
        if (reports.length > 7) b.anchorFrom(reports[reports.length - 7], true);     // 350 ms old
    }
    assert.equal(b.resyncs, 0, "no resyncs");
    assert.ok(b.pos.z - 10 > 15, "and it kept running: " + (b.pos.z - 10));
});

test("a step down holds until the body has passed the edge; a ledge is hopped by itself; keys ending mid-fall do not lift the body", () => {
    // a one-block drop 2.0 blocks ahead (south, +z)
    const b = new Body(); start(b, { x: 0, y: 64, z: 0 }); b.setLook(0, 0);
    let minY = 64, edgeZ = null, tick = 0;
    for (; tick < 60; tick++) {
        b.press({ f: 1, ms: 250, floor: 63, ed: 2.0 - b.pos.z, at: { x: 0, z: b.pos.z } });   // the addon re-measures each time
        b.step();
        if (b.pos.z < 2.25) assert.equal(b.pos.y, 64, `still on the upper ground at z ${b.pos.z.toFixed(2)}`);
        if (b.pos.y < 64 && edgeZ === null) edgeZ = b.pos.z;
        minY = Math.min(minY, b.pos.y);
        if (b.onGround && b.pos.y === 63) break;
    }
    assert.equal(b.pos.y, 63, "and it lands on the lower ground");
    assert.ok(edgeZ >= 2.2, "it began to fall only past the edge: z " + edgeZ);
    // keys ending while falling must not put the body back on the old level
    const c = new Body(); start(c, { x: 0, y: 64, z: 0 }); c.setLook(0, 0);
    let fell = false;
    for (let i = 0; i < 60; i++) {
        if (!fell) c.press({ f: 1, ms: 250, floor: 60, ed: 1.0 - c.pos.z, at: { x: 0, z: c.pos.z } });
        c.step();
        if (c.pos.y < 63) { fell = true; c.release(); }
    }
    assert.equal(fell, true);
    assert.ok(c.pos.y <= 60 + 1e-9, "it keeps falling to the lower ground instead of snapping back up: " + c.pos.y);
    // a ledge one block up, 2.0 ahead
    const d = new Body(); start(d, { x: 0, y: 64, z: 0 }); d.setLook(0, 0);
    let top = 64, jumps = 0;
    for (let i = 0; i < 60; i++) {
        d.press({ f: 1, ms: 250, floor: 65, ed: 2.0 - d.pos.z, at: { x: 0, z: d.pos.z } });
        const p = d.step(); if (p.input_data.includes("start_jumping")) jumps++;
        top = Math.max(top, d.pos.y);
        if (d.onGround && d.pos.y === 65) break;
    }
    assert.equal(d.pos.y, 65); assert.equal(jumps, 1, "one hop"); assert.ok(top > 65.0);
    // once up, the addon sees only level ground ahead (no floor in its frames): the body must not sink back into the ledge
    const e = new Body(); start(e, { x: 0, y: 64, z: 0 }); e.setLook(0, 0);
    let sank = false;
    for (let i = 0; i < 60; i++) {
        if (e.pos.z < 2.6) e.press({ f: 1, ms: 250, floor: 65, ed: 2.0 - e.pos.z, at: { x: 0, z: e.pos.z } });
        else e.press({ f: 1, ms: 250 });                  // past the ledge's edge the frames carry no level change
        e.step();
        if (i > 30 && e.pos.y < 64.99) sank = true;
    }
    assert.equal(sank, false, "stays on top of the ledge: y " + e.pos.y);
});

test("a single jump frame hops once; a jump request that finds no ground lapses; stopping clears it", () => {
    const b = new Body(); start(b); b.setLook(0, 0);
    let jumps = 0;
    b.press({ f: 1, jump: true, ms: 250 });
    for (let i = 0; i < 40; i++) { const p = b.step(); if (p.input_data.includes("start_jumping")) jumps++; }
    assert.equal(jumps, 1, "one lease, one hop");
    const c = new Body(); start(c);
    c.jump(); c.step();                          // jumps now
    c.jump();                                    // pressed in mid-air...
    let again = 0;
    for (let i = 0; i < 40; i++) { const p = c.step(); if (p.input_data.includes("start_jumping")) again++; }
    assert.equal(again, 0, "...it does not fire minutes later on landing");
    const d = new Body(); start(d);
    d.jump(); d.stop();
    assert.equal(d.step().input_data.includes("start_jumping"), false, "stop() cancels a pending hop");
});

test("a walk target lapses when the addon stops refreshing it", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 10, y: 64, z: 50 }, "walk", 10);
    for (let i = 0; i < 9; i++) b.step();
    assert.ok(b.target, "alive while fresh");
    for (let i = 0; i < 4; i++) b.step();
    assert.equal(b.target, null, "gone after the lease");
    const c = new Body(); start(c);
    assert.equal(c.walkTo({ x: NaN, z: 1 }), false); assert.equal(c.walkTo({ x: 1, z: Infinity }), false); assert.equal(c.walkTo({ x: "a", z: "b" }), false);
    assert.equal(c.walkTo({ x: 1e9, z: 1 }), false, "outside the world");
    assert.ok(c.walkTo({ x: 5, z: 5 }), "a plain target without a lease still works for direct callers");
});

test("input ticks can be counted the server's way, and flipped on the fly", () => {
    const zero = new Body(); zero.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 5000n, rewind_history_size: 40 });
    assert.equal(zero.step().tick, 1n);
    zero.flipTickBase();
    assert.equal(zero.tickBase, "server");
    assert.equal(zero.step().tick, 5002n, "continues from the server's tick");
    assert.equal(zero.flipTickBase(), "zero");
    assert.equal(zero.step().tick, 3n, "back to our own count");
    const srv = new Body({ tickBase: "server" }); srv.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 5000n, rewind_history_size: 40 });
    assert.equal(srv.step().tick, 5001n);
    assert.ok(srv.status().tickBase === "server");
});

// ---- the second review round: corrections are neutral when they agree, hop state survives a replay -------------------------

test("a correction that agrees with the body changes nothing, even in the middle of a hop", () => {
    for (let hopTick = 8; hopTick <= 16; hopTick++) {
        const b = new Body(); start(b, { x: 0, y: 64, z: 0 }); b.setLook(0, 0);
        const snaps = new Map();
        for (let i = 0; i < 40; i++) {
            b.press({ f: 1, ms: 250, floor: 65, ed: 3.0 - b.pos.z, at: { x: 0, z: b.pos.z } });
            const p = b.step();
            snaps.set(p.tick, { pos: { ...b.pos }, vel: { ...b.vel }, onGround: b.onGround });
            if (i === hopTick + 2) {
                const at = snaps.get(BigInt(hopTick + 1));           // the server agrees with what we said at tick hopTick+1
                const want = { pos: { ...b.pos }, vel: { ...b.vel }, onGround: b.onGround, jumping: b.jumping };
                b.onCorrection({ prediction_type: "player", tick: BigInt(hopTick + 1), position: { x: at.pos.x, y: at.pos.y + EYE_HEIGHT, z: at.pos.z }, delta: at.vel, on_ground: at.onGround });
                assert.ok(Math.abs(b.pos.z - want.pos.z) < 1e-6 && Math.abs(b.pos.y - want.pos.y) < 1e-6, `hop tick ${hopTick}: replay lands where step() was: y ${b.pos.y} vs ${want.pos.y}, z ${b.pos.z} vs ${want.pos.z}`);
                assert.equal(b.onGround, want.onGround, `hop tick ${hopTick}: on ground agrees`);
                assert.equal(b.jumping, want.jumping, `hop tick ${hopTick}: jumping agrees`);
            }
        }
    }
});

test("late reports right after a correction do not make the body resync backwards", () => {
    const b = new Body(); start(b); b.setLook(0, 0);
    const trail = [];
    for (let i = 0; i < 120; i++) {
        b.press({ f: 1, sprint: true, ms: 250 });
        const p = b.step();
        trail.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
        if (i === 50) b.onCorrection({ prediction_type: "player", tick: p.tick - 3n, position: { x: trail[i - 3].x, y: trail[i - 3].y + EYE_HEIGHT, z: trail[i - 3].z }, delta: { ...b.vel }, on_ground: true });
        if (i > 8) b.anchorFrom(trail[i - 7], true);       // reports seven ticks old: 1.9 blocks behind at sprint speed
    }
    assert.equal(b.resyncs, 0, "no resync");
});

test("hop state does not outlive a respawn, a dimension change or a correction that ends the hop", () => {
    const hopping = () => { const b = new Body(); start(b, { x: 0, y: 64, z: 0 }); b.setLook(0, 0); for (let i = 0; i < 40 && !b.hopTo; i++) { b.press({ f: 1, ms: 250, floor: 65, ed: 3.0 - b.pos.z, at: { x: 0, z: b.pos.z } }); b.step(); } return b; };
    let b = hopping(); assert.ok(b.hopTo, "set up: mid-hop");
    b.onChangeDimension({ position: { x: 0, y: 70, z: 0 }, loading_screen_id: 1 });
    assert.equal(b.hopTo, null); assert.equal(b.autoHop, false); assert.equal(b.jumping, false);
    b = hopping();
    b.markDead(); b.onRespawn({ runtime_entity_id: 7n, state: 1, position: { x: 0, y: 70 + EYE_HEIGHT, z: 0 } });
    assert.equal(b.hopTo, null);
    b = hopping();
    b.hist.length = 0;                                       // a correction for a tick we no longer have: nothing to replay, and nothing left of the hop
    b.onCorrection({ prediction_type: "player", tick: b.tick, position: { x: 0, y: 64 + EYE_HEIGHT, z: 2.2 }, delta: { x: 0, y: -0.0784, z: 0 }, on_ground: true });
    assert.equal(b.hopTo, null);
});

test("a sprinting hop is up before the front of the body reaches the ledge face", () => {
    const b = new Body(); start(b, { x: 0, y: 64, z: 0 }); b.setLook(0, 0);
    const edge = 6.0;                                        // the ledge face, 1 block high, south
    let worst = 0;
    for (let i = 0; i < 80; i++) {
        b.press({ f: 1, sprint: true, ms: 250, floor: 65, ed: edge - b.pos.z, at: { x: 0, z: b.pos.z } });
        b.step();
        if (b.pos.y < 64.99) worst = Math.max(worst, b.pos.z + 0.3 - edge);         // how far the front of the body is inside the ledge while below its top
    }
    assert.ok(worst < 0.12, `the front of the body is at most ${worst.toFixed(2)} inside the ledge while below its top`);
});
