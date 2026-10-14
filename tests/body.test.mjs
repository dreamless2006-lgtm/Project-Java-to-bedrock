import test from "node:test";
import assert from "node:assert/strict";
import { Body, EYE_HEIGHT, SPEED } from "../bridge/body.mjs";

const start = (b) => b.onStartGame({ runtime_entity_id: 7n, player_position: { x: 10, y: 64 + EYE_HEIGHT, z: 10 }, rotation: { x: 0, z: 90 }, current_tick: 1000n });

test("start_game sets the feet position from the eye position and the server tick", () => {
    const b = new Body();
    assert.equal(b.step(), null);                       // nothing before start_game
    start(b);
    assert.deepEqual(b.pos, { x: 10, y: 64, z: 10 });
    assert.equal(b.yaw, 90);
    const p = b.step();
    assert.equal(p.tick, 1001n);
    assert.deepEqual(p.position, { x: 10, y: 64 + EYE_HEIGHT, z: 10 });
    assert.deepEqual(p.input_data, []);
    assert.deepEqual(p.move_vector, { x: 0, z: 0 });
    assert.equal(p.input_mode, "mouse"); assert.equal(p.play_mode, "normal"); assert.equal(p.interaction_model, "crosshair");
    for (const k of ["pitch", "yaw", "head_yaw", "interact_rotation", "delta", "analogue_move_vector", "camera_orientation", "raw_move_vector"]) assert.ok(k in p, k);
});

test("walking advances the claimed position at vanilla speed, facing the target, and stops on arrival", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 10, y: 64, z: 20 });                   // 10 blocks south (+z)
    const p1 = b.step();
    assert.ok(p1.input_data.includes("up"));
    assert.deepEqual(p1.move_vector, { x: 0, z: 1 });
    assert.ok(Math.abs(p1.yaw) < 1e-9, "faces +z");
    assert.ok(Math.abs(p1.position.z - (10 + SPEED.walk)) < 1e-9);
    let n = 1;
    while (b.target && n < 200) { b.step(); n++; }
    assert.ok(n < 60, `arrived in ${n} ticks`);
    assert.ok(Math.abs(b.pos.z - 20) <= 0.3 && b.pos.x === 10);
    const idle = b.step();
    assert.deepEqual(idle.input_data, []);
});

test("sprinting raises the speed and sends start/stop flags", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 0, y: 64, z: 10 }, "sprint");          // 10 blocks west (-x)
    const p1 = b.step();
    assert.ok(p1.input_data.includes("start_sprinting") && p1.input_data.includes("sprinting"));
    assert.ok(Math.abs(p1.yaw - 90) < 1e-9, "west is yaw 90");
    assert.ok(Math.abs(p1.position.x - (10 - SPEED.sprint)) < 1e-9);
    b.stop();
    const p2 = b.step();
    assert.ok(p2.input_data.includes("stop_sprinting"));
    assert.deepEqual(p2.move_vector, { x: 0, z: 0 });
});

test("server teleports and corrections are adopted and a teleport is acknowledged once", () => {
    const b = new Body(); start(b);
    assert.equal(b.onMovePlayer({ runtime_id: 99n, position: { x: 0, y: 0, z: 0 }, mode: "teleport" }), false);   // someone else
    assert.equal(b.onMovePlayer({ runtime_id: 7n, position: { x: 100, y: 70 + EYE_HEIGHT, z: -5 }, yaw: 180, pitch: 10, mode: "teleport", on_ground: true }), true);
    assert.deepEqual(b.pos, { x: 100, y: 70, z: -5 });
    const p1 = b.step();
    assert.ok(p1.input_data.includes("handled_teleport"));
    assert.ok(!b.step().input_data.includes("handled_teleport"));
    b.walkTo({ x: 110, y: 70, z: -5 });
    b.step();
    b.onCorrection({ prediction_type: "player", position: { x: 100, y: 70 + EYE_HEIGHT, z: -5 }, delta: { x: 0, y: 0, z: 0 }, on_ground: true, tick: 1003n });
    assert.deepEqual(b.pos, { x: 100, y: 70, z: -5 });
    assert.equal(b.corrections, 1);
    assert.ok(b.target, "a correction does not cancel the walk");
});

test("respawn handshake answers the server and resets the body", () => {
    const b = new Body(); start(b);
    b.walkTo({ x: 0, y: 64, z: 0 });
    assert.deepEqual(b.onRespawn({ runtime_entity_id: 7n, position: { x: 0, y: 0, z: 0 }, state: 0 }), []);
    assert.equal(b.alive, false); assert.equal(b.target, null);
    assert.deepEqual(b.step().input_data, []);           // dead bodies do not walk
    const out = b.onRespawn({ runtime_entity_id: 7n, position: { x: 3, y: 65 + EYE_HEIGHT, z: 4 }, state: 1 });
    assert.equal(out.length, 2);
    assert.equal(out[0].name, "respawn"); assert.equal(out[0].params.state, 2); assert.equal(out[0].params.runtime_entity_id, 7n);
    assert.equal(out[1].name, "player_action"); assert.equal(out[1].params.action, "respawn");
    assert.equal(b.alive, true);
    assert.deepEqual(b.pos, { x: 3, y: 65, z: 4 });
    assert.ok(b.step().input_data.includes("handled_teleport"));
});

test("lookAt turns the head without moving", () => {
    const b = new Body(); start(b);
    b.lookAt({ x: 10, y: 64 + EYE_HEIGHT + 5, z: 20 });
    assert.ok(Math.abs(b.yaw) < 1e-9 && b.pitch < -20 && b.pitch > -30);
    const p = b.step();
    assert.deepEqual(p.position, { x: 10, y: 64 + EYE_HEIGHT, z: 10 });
    assert.deepEqual(b.status().pos, { x: 10, y: 64, z: 10 });
});
