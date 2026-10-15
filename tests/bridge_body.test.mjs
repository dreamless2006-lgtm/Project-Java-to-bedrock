// The bridge's body wiring, with a fake Minecraft client: the spawn handshake happens in the
// vanilla order, what the addon sends becomes player_auth_input packets, teleports are
// acknowledged, respawns and dimension changes answered.
import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../bridge/index.mjs";
import { EYE_HEIGHT } from "../bridge/body.mjs";

function fakeBridge(connect = {}) {
    const b = new Bridge({ _path: "test", defaults: { provider: "openai" }, providers: { openai: { apiKey: "k" } }, connect: { username: "Bot", ...connect } });
    const queued = [];
    b.client = { username: "Bot", status: 3, queue: (name, params) => queued.push({ name, params }), on() {} };
    return { b, queued };
}
const START = { runtime_entity_id: 5n, player_position: { x: 0, y: 64, z: 0 }, rotation: { x: 0, z: 0 }, current_tick: 10n, rewind_history_size: 40, player_gamemode: "creative", world_gamemode: "survival", gamerules: [{ name: "pvp", value: true }] };

function spawn(b, queued) {
    // what start() wires up, replayed by hand: start_game, then the first play_status player_spawn
    b.entityId = START.runtime_entity_id; b.body.onStartGame(START);
    queued.push({ name: "request_chunk_radius", params: { chunk_radius: 8, max_radius: 28 } }, { name: "serverbound_loading_screen", params: { type: 1 } });
    b.finishSpawn("Bot");
}

test("the spawn handshake closes the loading screen before the player is marked initialised", () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued);
    assert.deepEqual(queued.map(q => q.name), ["request_chunk_radius", "serverbound_loading_screen", "interact", "serverbound_loading_screen", "set_local_player_as_initialized"]);
    assert.deepEqual(queued[2].params, { action_id: "mouse_over_entity", target_entity_id: 0n, has_position: false });
    assert.deepEqual(queued[3].params, { type: 2 });
    assert.deepEqual(queued[4].params, { runtime_entity_id: 5n });
    assert.equal(b.client.status, 4);
    assert.equal(b.spawned, true);
    assert.ok(b.outQueue.includes("/gamerule sendcommandfeedback false"));
    assert.ok(b.outQueue.includes("/gamemode survival @s"), "a creative account is put into survival by default");
    assert.ok(b.outQueue.some(c => /scriptevent realai:in/.test(c)), "the hello goes out");
    const n = queued.length;
    b.finishSpawn("Bot");
    assert.equal(queued.length, n, "a second player_spawn does not repeat the handshake");
    const other = fakeBridge({ gamemode: null });
    spawn(other.b, other.queued);
    assert.ok(!other.b.outQueue.some(c => /gamemode/.test(c)), "connect.gamemode null leaves the game mode alone");
});

test("hello carries the body and the expected pack build; nothing is sent before spawn", () => {
    const { b, queued } = fakeBridge();
    const hello = b.helloMessage("Bot");
    assert.equal(hello.body, 1); assert.equal(hello.v, 2); assert.equal(hello.expectAddon, "2.9.0"); assert.ok(hello.providers.includes("openai"));
    b.bodyTick();
    assert.equal(queued.length, 0);
});

test("every tick sends one player_auth_input, idle or walking, and a walk frame anchors the body", async () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued); queued.length = 0;
    b.bodyTick();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].name, "player_auth_input");
    assert.deepEqual(queued[0].params.input_data, ["block_breaking_delay_enabled", "vertical_collision"]);
    assert.equal(queued[0].params.position.y, 64 + EYE_HEIGHT);
    await b.handle({ t: "walk", x: 5, y: 64, z: 0, mode: "sprint", jump: 0, fx: 0, fy: 64, fz: 0 });
    b.bodyTick();
    const p = queued[1].params;
    assert.ok(p.input_data.includes("up") && p.input_data.includes("sprinting") && p.input_data.includes("start_sprinting"));
    assert.ok(p.position.x > 0 && p.position.y === 64 + EYE_HEIGHT);
    assert.equal(p.tick, 2n);
    await b.handle({ t: "stop" });
    b.bodyTick();
    assert.ok(queued[2].params.input_data.includes("stop_sprinting"));
    assert.deepEqual(queued[2].params.move_vector, { x: 0, z: 0 });
    // the addon says the server keeps the body elsewhere, twice: the body resyncs
    await b.handle({ t: "walk", x: 40, y: 64, z: 40, mode: "walk", jump: 0, fx: 30, fy: 64, fz: 30 });
    await b.handle({ t: "walk", x: 40, y: 64, z: 40, mode: "walk", jump: 0, fx: 30, fy: 64, fz: 30 });
    assert.deepEqual(b.body.status().pos, { x: 30, y: 64, z: 30 });
    assert.equal(b.body.resyncs, 1);
});

test("a jump request adds the jump flags on the next ticks", async () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued); queued.length = 0;
    await b.handle({ t: "walk", x: 3, y: 65, z: 0, mode: "walk", jump: 1 });
    b.bodyTick();
    assert.ok(queued[0].params.input_data.includes("start_jumping") && queued[0].params.input_data.includes("jumping"));
    b.bodyTick();
    assert.ok(queued[1].params.input_data.includes("jumping") && !queued[1].params.input_data.includes("start_jumping"));
    assert.ok(queued[1].params.position.y > 64 + EYE_HEIGHT);
});

test("look turns the head; body_status and probes are answered", async () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued); queued.length = 0;
    await b.handle({ t: "look", x: 0, y: 64 + EYE_HEIGHT, z: -10 });
    b.bodyTick();
    assert.ok(Math.abs(Math.abs(queued[0].params.yaw) - 180) < 1e-6, "north is yaw 180");
    b.outQueue.length = 0;
    await b.handle({ t: "body_status" });
    assert.ok(b.outQueue.some(c => /scriptevent realai:in/.test(c)), "status goes back over the script event channel");
    await b.handle({ t: "probe", x: 0.2, y: 64, z: 0.1, ground: true, gm: "survival", walks: true });
    await b.handle({ t: "probe_hurt", damage: 2, cause: "entityAttack", by: "Steve" });
    await b.handle({ t: "hello", v: 2, edition: "addon", version: "2.5.0", walks: true, tick: 5, pos: { x: 0, y: 64, z: 0 }, gamemode: "survival" });
    assert.equal(b.body.gameMode, "survival");
});

test("a respawn and a dimension change are answered through the body", async () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued); queued.length = 0;
    b.body.markDead();
    for (const pk of b.body.respawnPackets(1)) b.client.queue(pk.name, pk.params);
    for (const pk of b.body.onRespawn({ runtime_entity_id: 5n, position: { x: 1, y: 65 + EYE_HEIGHT, z: 1 }, state: 1 })) b.client.queue(pk.name, pk.params);
    assert.deepEqual(queued.map(q => q.name), ["player_action", "respawn"]);
    queued.length = 0;
    for (const pk of b.body.onChangeDimension({ dimension: 1, position: { x: 2, y: 70, z: 2 }, respawn: false, loading_screen_id: 4 })) b.client.queue(pk.name, pk.params);
    for (const pk of b.body.onPlayerAction({ action: "dimension_change_ack" })) b.client.queue(pk.name, pk.params);
    assert.deepEqual(queued.map(q => q.name), ["serverbound_loading_screen", "player_action", "serverbound_loading_screen"]);
    assert.deepEqual(queued[2].params, { type: 2, loading_screen_id: 4 });
});

test("death: the bridge presses Respawn by itself, again with 'ready' when the server stays quiet, and stops once it is back", async () => {
    const { b, queued } = fakeBridge();
    spawn(b, queued); queued.length = 0;
    b.onDeath("test");
    assert.equal(b.body.alive, false);
    assert.ok(b.toAddonHasDied === undefined);
    await new Promise(r => setTimeout(r, 1300));
    assert.deepEqual(queued.map(q => q.name), ["player_action"], "the first press");
    assert.equal(queued[0].params.action, "respawn");
    await new Promise(r => setTimeout(r, 1700));
    assert.ok(queued.map(q => q.name).includes("respawn"), "later presses also say ready");
    for (const pk of b.body.onRespawn({ runtime_entity_id: 5n, position: { x: 0, y: 64 + EYE_HEIGHT, z: 0 }, state: 1 })) b.client.queue(pk.name, pk.params);
    b.stopRespawnLoop();
    const n = queued.length;
    await new Promise(r => setTimeout(r, 1700));
    assert.equal(queued.length, n, "no more presses once it is alive");
});
