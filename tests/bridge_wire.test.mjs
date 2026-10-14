// Wire check: every packet the bridge's body emits round-trips through bedrock-protocol's real
// serializer for the game version the bridge targets. Skipped when bedrock-protocol is not
// installed (the repo keeps no node_modules); point BEDROCK_PROTOCOL_DIR at an install to run it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Body, EYE_HEIGHT, FLAG_ORDER } from "../bridge/body.mjs";

const VERSION = "1.26.51";
let ser = null, des = null, mcdata = null;
for (const base of [process.env.BEDROCK_PROTOCOL_DIR, new URL("../bridge/node_modules/bedrock-protocol", import.meta.url).pathname].filter(Boolean)) {
    try {
        const req = createRequire(base + "/package.json");
        const t = req("bedrock-protocol/src/transforms/serializer");
        ser = t.createSerializer(VERSION); des = t.createDeserializer(VERSION);
        mcdata = req("minecraft-data")("bedrock_" + VERSION);
        break;
    } catch (e) { /* try the next */ }
}
const skip = ser ? false : "bedrock-protocol is not installed (set BEDROCK_PROTOCOL_DIR to a bridge install to run the wire check)";

function roundTrip(name, params) {
    const buf = ser.createPacketBuffer({ name, params });
    const back = des.parsePacketBuffer(buf);
    assert.equal(back.data.name, name);
    return back.data.params;
}

test("player_auth_input packets from the body encode and decode intact", { skip }, () => {
    const b = new Body(); b.onStartGame({ runtime_entity_id: 7n, player_position: { x: 10, y: 64, z: 10 }, rotation: { x: 0, z: 0 }, rewind_history_size: 40 });
    const idle = b.step();
    let back = roundTrip("player_auth_input", idle);
    assert.deepEqual(back.input_data, idle.input_data);
    assert.ok(Math.abs(back.position.y - (64 + EYE_HEIGHT)) < 1e-4);
    assert.equal(back.tick, idle.tick);
    b.walkTo({ x: 10, y: 65, z: 20 }, "sprint"); b.jump();
    const walking = b.step();
    back = roundTrip("player_auth_input", walking);
    assert.deepEqual(back.input_data, walking.input_data, "flags survive: " + walking.input_data);
    assert.ok(Math.abs(back.move_vector.z - 1) < 1e-6 && Math.abs(back.delta.z - walking.delta.z) < 1e-4);
    b.onMovePlayer({ runtime_id: 7n, position: { x: 1, y: 70 + EYE_HEIGHT, z: 1 }, mode: "teleport", on_ground: true });
    const ack = b.step();
    back = roundTrip("player_auth_input", ack);
    assert.ok(back.input_data.includes("handled_teleport"));
});

test("every flag name the body can send exists in the protocol's InputData enum", { skip }, () => {
    const mapping = mcdata.protocol.types.InputData[1].mappings;
    const names = new Set(Object.values(mapping));
    for (const f of FLAG_ORDER) assert.ok(names.has(f), f);
});

test("the handshake, respawn and dimension-change packets encode", { skip }, () => {
    roundTrip("request_chunk_radius", { chunk_radius: 8, max_radius: 28 });
    assert.deepEqual(roundTrip("serverbound_loading_screen", { type: 1 }), { type: 1, loading_screen_id: undefined });
    assert.deepEqual(roundTrip("serverbound_loading_screen", { type: 2, loading_screen_id: 7 }), { type: 2, loading_screen_id: 7 });
    const it = roundTrip("interact", { action_id: "mouse_over_entity", target_entity_id: 0n, has_position: false });
    assert.equal(it.action_id, "mouse_over_entity");
    roundTrip("set_local_player_as_initialized", { runtime_entity_id: 7n });
    const b = new Body(); b.onStartGame({ runtime_entity_id: 7n, player_position: { x: 0, y: 64, z: 0 } });
    for (const pk of b.onRespawn({ runtime_entity_id: 7n, position: { x: 0, y: 65.62, z: 0 }, state: 1 })) roundTrip(pk.name, pk.params);
    for (const pk of b.onChangeDimension({ dimension: 1, position: { x: 0, y: 70, z: 0 }, respawn: false, loading_screen_id: 3 })) roundTrip(pk.name, pk.params);
    for (const pk of b.onPlayerAction({ action: "dimension_change_ack" })) roundTrip(pk.name, pk.params);
});
