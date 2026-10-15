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
const inputFrames = [];
const realHandle = bridge.handle.bind(bridge);
bridge.handle = async (msg) => {
    if (msg.t === "think") { toAddon({ t: "result", turnId: msg.turnId, ok: true, text: JSON.stringify({ thought: "", say: "", say_to: "", mood: "", goal: "", actions: [], remember: [], forget: [] }), usage: { input: 1, output: 1 }, model: "e2e", provider: "anthropic", attempts: 1 }); return; }
    if (msg.t === "walk") walkFrames.push(msg);
    if (msg.t === "input") inputFrames.push(msg);
    return realHandle(msg);
};
bridge.sendToAddon = (obj) => { w.toAddon.push(obj); toAddon(obj); };    // bridge -> addon: as script events

function syncFromServer() {
    const p = server.now(NAME);
    if (p) { body.location = { x: p.x, y: p.y, z: p.z }; body.rotation = { x: p.pitch ?? 0, y: p.yaw ?? 0 }; }
}
function pumpToBridge() {
    for (const m of body.messages.splice(0)) bridge.onText({ type: "raw", message: m });         // the addon talks to the bridge in raw text, never in chat
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
    check(flat(end, { x: lx + 6.5, z: lz + 0.5 }) < 2.5 && end.y > 64.5, `up a one-block ledge: arrived ${flat(end, { x: lx + 6.5, z: lz + 0.5 }).toFixed(2)} off at height ${end.y.toFixed(2)} (${brain.actuator.results.slice(-1)})`);
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

    // ---- 7. the AI's own controls: look, move, jump, look_around -----------------------------
    const results = () => brain.actuator.results;
    const lastResult = () => String(results().slice(-1));
    async function lab(x) {                                             // a clean patch of flat ground to experiment on
        brain.actuator.stopAll();
        server.send({ cmd: "tp", name: NAME, x: x + 0.5, y: 64, z: 200.5 });
        await drive(2200);
    }
    const { observe } = await import("../../packs/RealAI_BP/scripts/brain/perception.js");

    await lab(200);
    act({ type: "look", facing: "south" });
    await drive(700);
    check(Math.abs(at().yaw) < 6, `look facing south: the server has yaw ${at().yaw.toFixed(0)}`);
    check(/facing S \(yaw 0/.test(lastResult()), "and it says what it faces and sees: " + lastResult().slice(0, 90));
    act({ type: "look", yaw: -90, pitch: -30 });
    await drive(700);
    check(Math.abs(at().yaw + 90) < 6 && Math.abs(at().pitch + 30) < 4, `look with a yaw and pitch: ${at().yaw.toFixed(0)} / ${at().pitch.toFixed(0)}`);
    act({ type: "look", turn: 90, tilt: 30 });
    await drive(700);
    check(Math.abs(Math.abs(at().yaw) - 0) < 6 && Math.abs(at().pitch) < 4, `look turn and tilt are relative: ${at().yaw.toFixed(0)} / ${at().pitch.toFixed(0)}`);

    // keys: forward, back, left, right, sprint, sneak
    async function press(spec, ms = 4000) {
        const p0 = at(); results().length = 0;
        const tk0 = system.currentTick, ms0 = Date.now(), inputs0 = inputFrames.length;
        act({ type: "move", ...spec });
        await drive(ms, idle);
        const p1 = at();
        if (process.env.E2E_TRACE) console.log("    [press]", JSON.stringify(spec), "mock ticks", system.currentTick - tk0, "real ms", Date.now() - ms0, "input frames", inputFrames.length - inputs0);
        return { dx: p1.x - p0.x, dz: p1.z - p0.z, dy: p1.y - p0.y, text: lastResult(), end: p1, start: p0 };
    }
    let m = await press({ direction: "forward", seconds: 2 });
    check(m.dz > 5 && m.dz < 9.5 && Math.abs(m.dx) < 0.6, `move forward for 2 s walks ${m.dz.toFixed(1)} blocks the way it faces (south): ${m.text}`);
    check(/^move: moved forward/.test(m.text), "and reports how far it got");
    const walked = m.dz;
    m = await press({ direction: "back", seconds: 1 });
    check(m.dz < -2.5 && m.dz > -5 && Math.abs(m.dx) < 0.6 && Math.abs(at().yaw) < 6, `move back for 1 s steps back ${(-m.dz).toFixed(1)} blocks without turning round (yaw ${at().yaw.toFixed(0)})`);
    m = await press({ direction: "left", seconds: 1 });
    check(m.dx > 2.5 && Math.abs(m.dz) < 0.8 && Math.abs(at().yaw) < 6, `strafing left from facing south goes east (+x ${m.dx.toFixed(1)}) with the head still south`);
    m = await press({ direction: "right", seconds: 1 });
    check(m.dx < -2.5, `strafing right goes west (${m.dx.toFixed(1)})`);
    const sprints0 = server.events.filter(e => e.e === "sprint" && e.on === true).length;
    m = await press({ direction: "forward", seconds: 2, sprint: true });
    check(m.dz > walked + 1.2 && server.events.filter(e => e.e === "sprint" && e.on === true).length > sprints0, `sprinting covers more ground in the same time (${m.dz.toFixed(1)} vs ${walked.toFixed(1)}) and the server sees it`);
    m = await press({ direction: "forward", seconds: 2, sneak: true });
    check(m.dz > 0.5 && m.dz < 3.8, `sneaking is slow (${m.dz.toFixed(1)} blocks in 2 s)`);
    // diagonal by turning first, then walking: still one key
    act({ type: "look", facing: "north-east" });
    await drive(600);
    m = await press({ direction: "forward", seconds: 2 });
    check(m.dx > 4 && m.dz < -4, `facing north-east and moving forward goes north-east (${m.dx.toFixed(1)}, ${m.dz.toFixed(1)})`);

    // a wall: the keys stop before it
    await lab(230);
    act({ type: "look", facing: "south" }); await drive(500);
    const wz = Math.floor(at().z) + 7;
    for (let dx = -6; dx <= 6; dx++) for (let y = 64; y <= 66; y++) overworld._set(Math.floor(at().x) + dx, y, wz, "minecraft:stone_bricks");
    m = await press({ direction: "forward", seconds: 6, sprint: true }, 9000);
    check(m.end.z < wz - 0.1 && m.end.z > wz - 2.2, `holding forward into a wall stops in front of it (z ${m.end.z.toFixed(2)}, wall at ${wz}): ${m.text}`);
    check(/a wall of stone_bricks is in the way/.test(m.text), "and says what is in the way");

    // a ledge: a one-block step up is hopped by itself
    await lab(260);
    act({ type: "look", facing: "south" }); await drive(500);
    const ledgeZ = Math.floor(at().z) + 4, lxx = Math.floor(at().x);
    for (let dx = -4; dx <= 4; dx++) for (let dz = 0; dz <= 12; dz++) overworld._set(lxx + dx, 64, ledgeZ + dz, "minecraft:dirt");
    const jumpsBefore2 = server.events.filter(e => e.e === "jump").length;
    m = await press({ direction: "forward", seconds: 3 });
    check(m.end.y > 64.9 && m.dz > 4, `walking into a one-block ledge hops up onto it (y ${m.end.y.toFixed(2)}, ${m.dz.toFixed(1)} blocks): ${m.text}`);
    check(server.events.filter(e => e.e === "jump").length > jumpsBefore2, "the server saw it jump");

    // a drop: the keys stop at the edge
    await lab(290);
    act({ type: "look", facing: "south" }); await drive(500);
    const pz = Math.floor(at().z) + 5, pxx = Math.floor(at().x);
    for (let dx = -5; dx <= 5; dx++) for (let dz = 0; dz <= 8; dz++) for (let y = 30; y <= 63; y++) overworld._set(pxx + dx, y, pz + dz, "minecraft:air");
    m = await press({ direction: "forward", seconds: 6 }, 9000);
    check(m.end.y > 63.9 && m.end.z < pz + 0.2, `walking at a pit stops at its edge instead of falling (z ${m.end.z.toFixed(2)}, edge ${pz}, y ${m.end.y.toFixed(2)}): ${m.text}`);
    check(/a drop of/.test(m.text), "and says it is a drop");

    // jump
    await lab(320);
    const jumps0 = server.events.filter(e => e.e === "jump").length;
    const y00 = at().y; let top = y00;
    act({ type: "jump" });
    for (let i = 0; i < 12; i++) { await drive(50); top = Math.max(top, at().y); }
    check(server.events.filter(e => e.e === "jump").length > jumps0 && top - y00 > 0.9, `jump makes the body jump (+${(top - y00).toFixed(2)})`);

    // look around: turns through the compass, restores the heading, reports every direction
    await lab(350);
    act({ type: "look", facing: "west" }); await drive(500);
    const headingBefore = at().yaw;
    const seenYaws = new Set(); const sampler = setInterval(() => { const p = at(); if (p) seenYaws.add(Math.round(((p.yaw % 360) + 360) % 360 / 45) % 8); }, 40);
    results().length = 0;
    act({ type: "look_around" });
    await drive(5000, idle);
    clearInterval(sampler);
    const report = lastResult();
    check(/looked all the way round/.test(report) && ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].every(d => new RegExp("\\b" + d + "( \\(ahead\\))?: ").test(report)), "look_around reports all eight directions: " + report.slice(0, 160));
    check(/Underfoot: /.test(report) && /Overhead: open sky/.test(report), "and what is under and over it");
    check(seenYaws.size >= 6, `the head really turned through ${seenYaws.size} of the 8 directions`);
    await drive(600);
    check(Math.abs(at().yaw - headingBefore) < 8, `and ends facing the way it began (${at().yaw.toFixed(0)} vs ${headingBefore.toFixed(0)})`);

    // the observation the model reads carries the same senses
    const obs = observe(body, brain, {});
    check(typeof obs.surroundings === "string" && /W \(ahead\): /.test(obs.surroundings) && /unexplored|clear/.test(obs.surroundings), "the model's observation says where it can walk in each direction: " + String(obs.surroundings).slice(0, 100));
    check(/looking at/.test(String(obs.looking)), "and what it is looking at: " + obs.looking);

    // exploring with no direction picks a way by itself
    await lab(380);
    const x0 = at(); t1 = Date.now();
    act({ type: "explore" });
    await drive(14000, () => flat(at(), x0) > 25);
    check(flat(at(), x0) > 25, `explore with no direction chose a way and went ${flat(at(), x0).toFixed(0)} blocks in ${Date.now() - t1} ms`);

    // ---- 8. the order of a reply's actions is kept: turn, walk, turn, walk -------------------------------
    await lab(410);
    results().length = 0;
    const o0 = at();
    brain.actuator.stopAll();
    brain.actuator.enqueue([{ type: "look", facing: "north" }, { type: "move", direction: "forward", seconds: 1.2 }, { type: "look", facing: "east" }, { type: "move", direction: "forward", seconds: 1.2 }]);
    await drive(9000, idle);
    const o1 = at();
    check(o1.z < o0.z - 3 && o1.x > o0.x + 3, `look north, walk, look east, walk goes north and then east, in that order (dz ${(o1.z - o0.z).toFixed(1)}, dx ${(o1.x - o0.x).toFixed(1)}): ${results().join(" | ").slice(0, 150)}`);

    // ---- 9. the user's own scene: a snowy forest. Gathering logs must walk over the snow to the trees and chop them ---------
    await lab(440);
    const gx = Math.floor(at().x), gz = Math.floor(at().z);
    for (let dx = -3; dx <= 24; dx++) for (let dz = -12; dz <= 12; dz++) overworld._set(gx + dx, 64, gz + dz, (dx + dz) % 7 === 0 ? "minecraft:tall_grass" : "minecraft:snow_layer");
    for (const [tx, tz] of [[gx + 12, gz + 3], [gx + 15, gz - 4]]) {
        for (let y = 64; y <= 68; y++) overworld._set(tx, y, tz, "minecraft:oak_log");
        for (let y = 67; y <= 69; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) overworld._set(tx + dx, y, tz + dz, "minecraft:oak_leaves");
    }
    const inv = body.getComponent("minecraft:inventory").container;
    const logs = () => { let n = 0; for (let i = 0; i < inv.size; i++) { const st = inv.getItem(i); if (st && st.typeId === "minecraft:oak_log") n += st.amount; } return n; };
    brain._around = null;                                      // the scene was just built: no cached view of it
    const seenFrom = observe(body, brain, {}).surroundings || "";
    check(/E[^;]*trees \d+m/.test(seenFrom) || /E[^;]*tree/.test(seenFrom), "from the snow it can see trees to the east in 'Around you': " + seenFrom.slice(0, 200));
    const g0 = at(); t1 = Date.now(); results().length = 0;
    act({ type: "gather", material: "oak_log", amount: 4 });
    await drive(60000, idle);
    check(logs() >= 4, `gather oak_log in a snowy forest: ${logs()} logs in the bag after ${Date.now() - t1} ms (${lastResult().slice(0, 100)})`);
    check(flat(at(), g0) > 6 && teleports.length === 0, `it walked there (${flat(at(), g0).toFixed(1)} blocks) on its own legs, never teleported`);

    // ---- 10. a belt of tall grass is not a wall --------------------------------------------------------------------
    await lab(480);
    const tx0 = Math.floor(at().x), tz0 = Math.floor(at().z);
    for (let dx = 3; dx <= 8; dx++) for (let dz = -20; dz <= 20; dz++) { overworld._set(tx0 + dx, 64, tz0 + dz, "minecraft:tall_grass"); overworld._set(tx0 + dx, 65, tz0 + dz, "minecraft:tall_grass"); }
    results().length = 0;
    const tg = at();
    act({ type: "move_to", x: tx0 + 14, y: 64, z: tz0 });
    await drive(20000, idle);
    check(flat(at(), { x: tx0 + 14.5, z: tz0 + 0.5 }) < 2.5 && Math.abs(at().z - tg.z) < 4, `through a belt of tall grass in a straight line: ${lastResult().slice(0, 90)}`);
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
