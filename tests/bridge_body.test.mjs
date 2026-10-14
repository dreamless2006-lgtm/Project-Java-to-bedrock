// The bridge's body wiring, with a fake Minecraft client: what the addon sends becomes
// player_auth_input packets, teleports are acknowledged, respawns answered.
import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../bridge/index.mjs";
import { EYE_HEIGHT } from "../bridge/body.mjs";

function fakeBridge() {
    const b = new Bridge({ _path: "test", defaults: { provider: "openai" }, providers: { openai: { apiKey: "k" } }, connect: { username: "Bot" } });
    const queued = [];
    b.client = { username: "Bot", queue: (name, params) => queued.push({ name, params }), on() {} };
    b.spawned = true;
    b.body.onStartGame({ runtime_entity_id: 5n, player_position: { x: 0, y: 64 + EYE_HEIGHT, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 10n });
    return { b, queued };
}

test("every tick sends one player_auth_input, idle or walking", async () => {
    const { b, queued } = fakeBridge();
    b.bodyTick();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].name, "player_auth_input");
    assert.deepEqual(queued[0].params.input_data, []);
    await b.handle({ t: "walk", x: 5, y: 64, z: 0, mode: "sprint", jump: 0 });
    b.bodyTick();
    const p = queued[1].params;
    assert.ok(p.input_data.includes("up") && p.input_data.includes("sprinting"));
    assert.ok(p.position.x > 0 && p.position.y === 64 + EYE_HEIGHT);
    assert.equal(p.tick, 12n);
    await b.handle({ t: "stop" });
    b.bodyTick();
    assert.ok(queued[2].params.input_data.includes("stop_sprinting"));
    assert.deepEqual(queued[2].params.move_vector, { x: 0, z: 0 });
});

test("a jump request adds the jump flags on the next ticks", async () => {
    const { b, queued } = fakeBridge();
    await b.handle({ t: "walk", x: 3, y: 65, z: 0, mode: "walk", jump: 1 });
    b.bodyTick();
    assert.ok(queued[0].params.input_data.includes("start_jumping") && queued[0].params.input_data.includes("jumping"));
    b.bodyTick();
    assert.ok(queued[1].params.input_data.includes("jumping") && !queued[1].params.input_data.includes("start_jumping"));
    assert.ok(queued[1].params.position.y > 64 + EYE_HEIGHT);
});

test("look turns the head and body_status answers the addon", async () => {
    const { b, queued } = fakeBridge();
    await b.handle({ t: "look", x: 0, y: 64 + EYE_HEIGHT, z: -10 });
    b.bodyTick();
    assert.ok(Math.abs(Math.abs(queued[0].params.yaw) - 180) < 1e-6, "north is yaw 180");
    await b.handle({ t: "body_status" });
    assert.ok(b.outQueue.some(c => /scriptevent realai:in/.test(c)), "status goes back over the script event channel");
});

test("hello announces the body and nothing is sent before spawn", () => {
    const { b, queued } = fakeBridge();
    const hello = b.helloMessage("Bot");
    assert.equal(hello.body, 1); assert.equal(hello.v, 2); assert.ok(hello.providers.includes("openai"));
    b.spawned = false;
    b.bodyTick();
    assert.equal(queued.length, 0);
});
