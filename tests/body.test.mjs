import test from "node:test";
import assert from "node:assert/strict";
import { Body, EYE_HEIGHT, SPEED, PHYS, GROUND_DELTA_Y, INPUT_ORDINAL } from "../bridge/body.mjs";

const start = (b, pos = { x: 10, y: 64, z: 10 }) => b.onStartGame({ runtime_entity_id: 7n, player_position: pos, rotation: { x: 0, z: 90 }, current_tick: 1000n, rewind_history_size: 40, player_gamemode: "survival" });
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
    const eye = new Body({ startGameEyeLevel: true }); start(eye, { x: 0, y: 64 + EYE_HEIGHT, z: 0 });
    assert.ok(near(eye.pos.y, 64));
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
