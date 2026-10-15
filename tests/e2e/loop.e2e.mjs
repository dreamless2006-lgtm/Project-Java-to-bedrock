// Closed loop: the real addon code (brain, actuator, walker, pathfinder, terrain) running on the mock
// Script API, driving the real bridge, which drives a real Bedrock server (Dragonfly); the server's
// answer (where the body really is) is fed back into the addon every tick, like the game does.
// Run: npm run e2e:loop   (node --import ./tests/harness/register.mjs tests/e2e/loop.e2e.mjs)
import { world, system, spawnPlayer, worldLoad, advanceTicksAsync, ItemStack } from "@minecraft/server";
import { encodeFrames, packMessage, DEFAULT_CHUNK } from "../../packs/RealAI_BP/scripts/brain/frame.js";
import { startWorld, sleep, flat } from "./lib.mjs";

const fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); console.log("FAIL -", msg); } else console.log("ok   -", msg); }

await import("../../packs/RealAI_BP/scripts/main.js");
worldLoad();
const overworld = world.getDimension("minecraft:overworld");
const steve = spawnPlayer("Steve", { x: 500, y: 64, z: 500 });
const NAME = "AIBot";
const body = spawnPlayer(NAME, { x: 0.5, y: 64, z: 0.5 });          // the bridge account's player, as the addon sees it
const gate = await import("../../packs/RealAI_BP/scripts/brain/gate.js");
const { updateWorldConfig } = await import("../../packs/RealAI_BP/scripts/brain/config.js");
updateWorldConfig({ independent: true, worldPlayers: 0, freeBuild: false });
await advanceTicksAsync(400);                                        // the pack's own boot (brain system, bridge subscription) before anyone says hello

const w = await startWorld({ username: NAME });
const { server, bridge } = w;

// ---- the two ends of the channel ----------------------------------------------------
const teleports = [];
body.teleport = (loc) => { teleports.push(loc); };                   // the addon must never move this body itself
let idCounter = 0;
function toAddon(obj) {
    for (const f of encodeFrames("b" + (idCounter++), packMessage(obj), DEFAULT_CHUNK)) system.afterEvents.scriptEventReceive.emit({ id: "realai:in", message: f, sourceType: "Entity", sourceEntity: body });
}
const walkFrames = [];
const realHandle = bridge.handle.bind(bridge);
bridge.handle = async (msg) => {
    if (msg.t === "think") { toAddon({ t: "result", turnId: msg.turnId, ok: true, text: JSON.stringify({ thought: "", say: "", say_to: "", mood: "", goal: "", actions: [], remember: [], forget: [] }), usage: { input: 1, output: 1 }, model: "e2e", provider: "anthropic", attempts: 1 }); return; }
    if (msg.t === "walk") walkFrames.push(msg);
    return realHandle(msg);
};
bridge.sendToAddon = (obj) => { w.toAddon.push(obj); toAddon(obj); };    // bridge -> addon: as script events

function syncFromServer() {
    const p = server.now(NAME);
    if (p) { body.location = { x: p.x, y: p.y, z: p.z }; body.rotation = { x: p.pitch ?? 0, y: p.yaw ?? 0 }; }
}
function pumpToBridge() {
    for (const m of body.messages.splice(0)) bridge.onText({ type: "chat", source_name: NAME, message: m });
}
async function drive(ms, until = () => false) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const a = Date.now();
        syncFromServer();
        await advanceTicksAsync(1);
        pumpToBridge();
        if (until()) return true;
        const spent = Date.now() - a; if (spent < 50) await sleep(50 - spent);
    }
    return false;
}

try {
    await server.waitFor(e => e.e === "join" && e.name === NAME, 30000, "the bridge to join");
    const t0 = Date.now(); while (!bridge.spawned && Date.now() - t0 < 10000) await sleep(100);
    // the world's ground, for this test, is at feet height 64: move the body there (the server keeps what it is told)
    server.send({ cmd: "tp", name: NAME, x: 0.5, y: 64, z: 0.5 });
    await drive(2500);
    check(server.now(NAME) && Math.abs(server.now(NAME).y - 64) < 0.2, "the body stands at the test world's ground height: " + JSON.stringify(server.now(NAME)));
    // the addon learns about the bridge (the bridge's hello, sent again now that the addon is listening) and gives the body a brain
    bridge.helloSentAt = Date.now();
    bridge.sendToAddon(bridge.helloMessage(NAME));
    await drive(12000, () => !!gate.getBrain(body.id));
    const brain = gate.getBrain(body.id);
    check(!!brain && brain.settings.mode === "bridge", "the addon found the bridge's player and gave it a brain");
    const { bridgeWalks } = await import("../../packs/RealAI_BP/scripts/brain/actuator.js");
    check(bridgeWalks(body), "and knows the bridge walks this body (hello carried body: 1)");
    const act = (...a) => { if (brain.actuator.current?.action.type === "wait") brain.actuator.finish("cancelled"); brain.actuator.stopAll(); brain.actuator.enqueue(a); };
    const idle = () => !brain.actuator.current && !brain.actuator.queue.length;
    const at = () => server.now(NAME);
    const trace = []; const rec = setInterval(() => { const p = at(); if (p) trace.push({ x: p.x, y: p.y, z: p.z, t: Date.now() }); }, 50);

    // ---- 1. open ground -------------------------------------------------------------
    let from = at(); walkFrames.length = 0;
    act({ type: "move_to", x: Math.floor(from.x) + 20, y: 64, z: Math.floor(from.z) });
    let t1 = Date.now();
    await drive(20000, idle);
    let end = at();
    check(idle() && flat(end, { x: from.x + 20.5, z: from.z + 0.5 }) < 2.5, `the AI's move_to 20 blocks east: arrived ${flat(end, { x: from.x + 20.5, z: from.z + 0.5 }).toFixed(2)} off in ${Date.now() - t1} ms (${brain.actuator.results.slice(-1)})`);
    check(walkFrames.length > 20 && teleports.length === 0, `driven by walk frames to the bridge (${walkFrames.length}), never by teleporting the player (${teleports.length})`);
    check(Date.now() - t1 < 11000, "at walking pace plus slack");

    // ---- 2. a built wall ------------------------------------------------------------
    brain.actuator.results.length = 0;
    from = at();
    const wx = Math.floor(from.x) + 5, wz0 = Math.floor(from.z);
    for (let dz = -5; dz <= 5; dz++) for (let y = 64; y <= 65; y++) overworld._set(wx, y, wz0 + dz, "minecraft:stone_bricks");
    trace.length = 0;
    act({ type: "move_to", x: wx + 8, y: 64, z: wz0 });
    t1 = Date.now();
    await drive(25000, idle);
    end = at();
    check(flat(end, { x: wx + 8.5, z: wz0 + 0.5 }) < 2.5, `past a wall nine blocks wide: arrived ${flat(end, { x: wx + 8.5, z: wz0 + 0.5 }).toFixed(2)} off (${brain.actuator.results.slice(-1)})`);
    const inWall = trace.filter(p => Math.floor(p.x) === wx && Math.abs(Math.floor(p.z) - wz0) <= 5 && p.y < 66).length;
    check(inWall === 0, `and never through it (${inWall} positions inside the wall)`);
    check(overworld.getBlock({ x: wx, y: 64, z: wz0 }).typeId === "minecraft:stone_bricks", "nor did it break it");

    // ---- 3. snow ----------------------------------------------------------------------
    from = at();
    const sx = Math.floor(from.x), sz = Math.floor(from.z);
    for (let dx = 0; dx <= 16; dx++) for (let dz = -3; dz <= 3; dz++) overworld._set(sx + dx, 64, sz + dz, "minecraft:snow_layer");
    brain.actuator.results.length = 0;
    t1 = Date.now();
    act({ type: "move_to", x: sx + 15, y: 64, z: sz });
    await drive(20000, idle);
    end = at();
    check(flat(end, { x: sx + 15.5, z: sz + 0.5 }) < 1.5, `across snow layers: arrived ${flat(end, { x: sx + 15.5, z: sz + 0.5 }).toFixed(2)} off in ${Date.now() - t1} ms (${brain.actuator.results.slice(-1)})`);
    check(Date.now() - t1 < 9000, "without stalling on every flake");

    // ---- 4. a ledge ---------------------------------------------------------------------
    from = at();
    const lx = Math.floor(from.x) + 4, lz = Math.floor(from.z);
    for (let dx = 0; dx <= 8; dx++) for (let dz = -6; dz <= 6; dz++) overworld._set(lx + dx, 64, lz + dz, "minecraft:dirt");     // the ground itself rises by one block here
    for (let dx = 0; dx <= 8; dx++) for (let dz = -6; dz <= 6; dz++) overworld._set(lx + dx, 65, lz + dz, "minecraft:air");
    const jumpsBefore = server.events.filter(e => e.e === "jump").length;
    brain.actuator.results.length = 0;
    act({ type: "move_to", x: lx + 6, y: 65, z: lz });
    await drive(15000, idle);
    end = at();
    check(flat(end, { x: lx + 6.5, z: lz + 0.5 }) < 1.5 && end.y > 64.5, `up a one-block ledge: arrived ${flat(end, { x: lx + 6.5, z: lz + 0.5 }).toFixed(2)} off at height ${end.y.toFixed(2)} (${brain.actuator.results.slice(-1)})`);
    check(server.events.filter(e => e.e === "jump").length > jumpsBefore, "by jumping");

    // ---- 5. a long trip -------------------------------------------------------------------
    from = at();
    brain.actuator.results.length = 0;
    t1 = Date.now();
    act({ type: "move_to", x: Math.floor(from.x) - 60, y: 65, z: Math.floor(from.z) + 10 });
    await drive(40000, idle);
    end = at();
    check(flat(end, { x: from.x - 59.5, z: from.z + 10.5 }) < 2.5, `a 60-block trip in segments: arrived ${flat(end, { x: from.x - 59.5, z: from.z + 10.5 }).toFixed(2)} off in ${Date.now() - t1} ms (${brain.actuator.results.slice(-1)})`);

    // ---- 6. the model's own words for looking and exploring ---------------------------------
    from = at();
    act({ type: "look_at", x: Math.floor(from.x) + 10, y: 65, z: Math.floor(from.z) });
    await drive(1500);
    const yaw = at().yaw;
    check(Math.abs(Math.abs(yaw) - 90) < 8, `look_at east turns the body (yaw ${yaw.toFixed(0)})`);
    act({ type: "explore", direction: "north" });
    const e0 = at(); t1 = Date.now();
    await drive(15000, () => flat(at(), e0) > 25);
    check(flat(at(), e0) > 25, `explore north: ${flat(at(), e0).toFixed(0)} blocks from where it began after ${Date.now() - t1} ms`);
    clearInterval(rec);
} catch (e) {
    fails.push("test aborted: " + (e && e.stack || e));
    console.log("ABORT", e && e.stack || e);
} finally {
    await w.stop();
}
const errs = (await import("@minecraft/server")).log.errors;
if (errs.length) { fails.push("engine errors: " + errs.slice(0, 3).join(" | ")); }
if (fails.length) { console.log("\nFAILED:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("\nclosed loop OK");
process.exit(0);
