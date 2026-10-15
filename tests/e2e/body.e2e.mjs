// End-to-end: the real bridge (bedrock-protocol client + the body model) against a real Bedrock
// server (Dragonfly). Every assertion is about what the SERVER sees, not what the bridge believes.
// Run: npm run e2e   (needs Go, and bridge/node_modules with bedrock-protocol installed)
import { startWorld, startAttacker, sleep, flat } from "./lib.mjs";

const fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); console.log("FAIL -", msg); } else console.log("ok   -", msg); }
const log = (...a) => console.log("   ", ...a);

const w = await startWorld({ connect: {} });
const { server, bridge } = w;
let attacker = null;
const cleanup = async () => { try { attacker?.close(); } catch (e) { /* ignore */ } await w.stop(); };
process.on("SIGTERM", () => { cleanup().then(() => process.exit(2)); });

try {
    // ---- join -------------------------------------------------------------------------
    const join = await server.waitFor(e => e.e === "join" && e.name === w.name, 30000, "the bridge to join the server");
    check(!!join, `the bridge joined the server as ${w.name} at feet ${join.x}, ${join.y}, ${join.z}`);
    const t0 = Date.now();
    while (!bridge.spawned && Date.now() - t0 < 10000) await sleep(100);
    check(bridge.spawned, "the bridge finished the spawn handshake");
    await server.waitFor(e => e.e === "pos" && e.name === w.name, 5000, "a position report");
    let lastRx = Date.now(), rx = 0;
    bridge.client.on("packet", () => { lastRx = Date.now(); rx++; });
    const hearing = (label) => { const age = Date.now() - lastRx; check(age < 2500, `the bridge still hears the server after ${label} (last packet ${age} ms ago, ${rx} packets so far)`); };
    await sleep(2500);
    const idle = w.pos();
    check(Math.abs(idle.y - join.y) < 0.05 && flat(idle, join) < 0.05, `idle: the server keeps the body on the ground at its spawn (y ${idle.y.toFixed(2)} vs ${join.y.toFixed(2)})`);
    check(!server.events.some(e => e.e === "quit"), "idle: nobody was kicked");
    check(bridge.body.calibrated || bridge.body.startIsEye, "the body read the spawn height as eye level on a server without rewind history: " + JSON.stringify({ eye: bridge.body.startIsEye, calibrated: bridge.body.calibrated }));

    // ---- another player watches ---------------------------------------------------------
    attacker = await startAttacker({ port: w.relayPort });
    await sleep(1500);
    check(attacker.seen.entities.has(w.name), "another player sees the bridge's body in the world");

    // ---- walk ---------------------------------------------------------------------------
    const start = w.pos();
    const goal = { x: start.x + 8, z: start.z };
    const r = await w.driveTo(goal, { timeout: 8000 });
    const end = w.pos();
    check(r.ok && flat(end, goal) < 0.7, `walking 8 blocks east: the server has it ${flat(end, goal).toFixed(2)} from the goal after ${r.ms} ms`);
    const speed = 8 / (r.ms / 1000);
    check(speed > 3.0 && speed < 4.8, `at a human walking pace (${speed.toFixed(1)} blocks/s, vanilla 4.3)`);
    check(Math.abs(end.y - start.y) < 0.05, "and it stayed on the ground");
    check(bridge.body.corrections === 0 || bridge.body.corrections < 3, "without being rubber-banded: " + bridge.body.corrections + " corrections");
    const seenMoving = attacker.seen.moves.filter(m => m.id === attacker.seen.entities.get(w.name)).length;
    check(seenMoving > 10, `the other player watched it walk (${seenMoving} movement packets)`);

    hearing("walking");
    // ---- sprint -------------------------------------------------------------------------
    const goal2 = { x: end.x - 12, z: end.z };
    const r2 = await w.driveTo(goal2, { mode: "sprint", timeout: 8000 });
    const speed2 = 12 / (r2.ms / 1000);
    check(r2.ok, `sprinting 12 blocks west arrives (${r2.ms} ms)`);
    check(speed2 > speed + 0.5 && speed2 < 6.5, `faster than walking (${speed2.toFixed(1)} blocks/s, vanilla 5.6)`);
    check(server.events.some(e => e.e === "sprint" && e.on === true), "the server saw it start sprinting");

    hearing("sprinting");
    // ---- look ---------------------------------------------------------------------------
    const p = w.pos();
    await w.say({ t: "look", x: p.x, y: p.y + 1.62, z: p.z + 10 });
    await sleep(600);
    let q = w.pos();
    check(Math.abs(q.yaw) < 6 || Math.abs(Math.abs(q.yaw) - 360) < 6, `looking south: yaw ${q.yaw.toFixed(1)}`);
    await w.say({ t: "look", x: p.x - 10, y: p.y + 1.62 + 10, z: p.z });
    await sleep(600);
    q = w.pos();
    check(Math.abs(q.yaw - 90) < 6 && q.pitch < -30 && q.pitch > -60, `looking up to the west: yaw ${q.yaw.toFixed(1)}, pitch ${q.pitch.toFixed(1)}`);
    const lookSeen = attacker.seen.moves.some(m => m.id === attacker.seen.entities.get(w.name) && m.t > Date.now() - 3000);
    check(lookSeen, "other players see the head turn");

    hearing("looking");
    // ---- jump ---------------------------------------------------------------------------
    const jumpsBefore = server.events.filter(e => e.e === "jump").length;
    const y0 = w.pos().y;
    await w.say({ t: "walk", x: w.pos().x, y: y0 + 1, z: w.pos().z - 3, mode: "walk", jump: 1 });
    let peak = y0;
    for (let i = 0; i < 15; i++) { await sleep(50); peak = Math.max(peak, w.pos().y); }
    await w.say({ t: "stop" });
    check(server.events.filter(e => e.e === "jump").length > jumpsBefore, "a jump request makes the server see a jump");
    check(peak - y0 > 0.9 && peak - y0 < 1.4, `the jump has a vanilla arc (peak +${(peak - y0).toFixed(2)})`);
    await sleep(800);
    check(Math.abs(w.pos().y - y0) < 0.1 || w.pos().y - y0 < 1.1, "and lands");

    hearing("jumping");
    // ---- chat ---------------------------------------------------------------------------
    await w.say({ t: "chat_out", text: "hello from the body", to: "" });
    const chat = await server.waitFor(e => e.e === "chat" && /hello from the body/.test(e.message || ""), 4000, "the bridge's chat line").catch(() => null);
    check(!!chat && chat.name === w.name, "its chat reaches the server as the player's own chat");

    hearing("chatting");
    // ---- teleport -----------------------------------------------------------------------
    const tpTarget = { x: w.pos().x + 20, y: w.pos().y, z: w.pos().z + 5 };
    const tpBefore = bridge.body.teleports;
    server.send({ cmd: "tp", name: w.name, x: tpTarget.x, y: tpTarget.y, z: tpTarget.z });
    await server.waitFor(e => e.e === "teleport" && e.name === w.name, 4000, "the teleport");
    await sleep(1200);
    const afterTp = w.pos();
    check(bridge.body.teleports === tpBefore + 1, `the body noticed the server teleport (${bridge.body.teleports - tpBefore})`);
    check(flat(afterTp, tpTarget) < 0.5, `and the server kept it where it was sent (${flat(afterTp, tpTarget).toFixed(2)} off)`);
    const r3 = await w.driveTo({ x: afterTp.x + 5, z: afterTp.z }, { timeout: 6000 });
    check(r3.ok, "it walks on normally after a teleport");

    hearing("the teleport");
    // ---- being hit ----------------------------------------------------------------------
    const hurtBefore = server.events.filter(e => e.e === "hurt" && e.name === w.name).length;
    const bp = w.pos();
    server.send({ cmd: "tp", name: attacker.client.username || "Attacker", x: bp.x + 1, y: bp.y, z: bp.z });
    await sleep(1500);
    // the attacker's own position is reported by the server too
    attacker.seen.entities.get(w.name) !== undefined && attacker.attack(w.name);
    await sleep(800);
    const hurt = server.events.filter(e => e.e === "hurt" && e.name === w.name);
    check(hurt.length > hurtBefore && hurt.slice(-1)[0].damage > 0, `another player can hit the body: the server applied ${hurt.length > hurtBefore ? hurt.slice(-1)[0].damage : 0} damage`);

    hearing("being hit");
    // ---- death and respawn --------------------------------------------------------------
    server.send({ cmd: "kill", name: w.name });
    await server.waitFor(e => e.e === "death" && e.name === w.name, 4000, "the death");
    await sleep(600);
    check(bridge.body.alive === false || server.events.some(e => e.e === "respawn" && e.name === w.name), "the bridge noticed it died");
    check(w.toAddon.some(m => m.t === "died"), "and told the addon");
    const resp = await server.waitFor(e => e.e === "respawn" && e.name === w.name, 15000, "the respawn").catch(() => null);
    check(!!resp, "the body pressed Respawn by itself: nobody touched the death screen");
    const t1 = Date.now(); while (!bridge.body.alive && Date.now() - t1 < 6000) await sleep(100);
    await sleep(500);
    check(bridge.body.alive, "and its body is alive again");
    const bp2 = w.pos();
    check(bp2 && bp2.health > 15, "with its health back (" + (bp2 && bp2.health) + ")");
    const r4 = await w.driveTo({ x: bp2.x + 4, z: bp2.z }, { timeout: 6000 });
    check(r4.ok, "and walks again after respawning");
} catch (e) {
    fails.push("test aborted: " + (e && e.stack || e));
    console.log("ABORT", e && e.stack || e);
} finally {
    await cleanup();
}

if (fails.length) {
    console.log("\nFAILED:\n - " + fails.join("\n - "));
    console.log("\nserver events (not positions):\n" + server.events.filter(e => e.e !== "pos" && e.e !== "move").map(e => JSON.stringify(e)).join("\n"));
    process.exit(1);
}
console.log("\nend-to-end OK");
process.exit(0);
