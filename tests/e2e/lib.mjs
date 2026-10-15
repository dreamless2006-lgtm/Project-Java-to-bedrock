// Helpers for the end-to-end tests: a real Bedrock server (Dragonfly, Go) on localhost, the real
// bridge connecting to it through bedrock-protocol, and a second client that plays "another player".
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dgram from "node:dgram";

const HERE = dirname(fileURLToPath(import.meta.url));
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Build (once) and start the Dragonfly server; resolves to an object with events, send(), stop(). */
export async function startServer({ port = 19138, env = {} } = {}) {
    let bin = process.env.DF_SERVER_BIN;
    if (!bin || !existsSync(bin)) {
        const go = process.env.GO_BIN || "/usr/local/go/bin/go";
        const dir = mkdtempSync(join(tmpdir(), "realai-df-"));
        bin = join(dir, "df-server");
        const r = spawnSync(go, ["build", "-o", bin, "."], { cwd: join(HERE, "dragonfly"), encoding: "utf8" });
        if (r.status !== 0) throw new Error("could not build the Dragonfly test server: " + (r.stderr || r.stdout));
    }
    const child = spawn(bin, [], { env: { ...process.env, DF_ADDR: `127.0.0.1:${port}`, ...env }, stdio: ["pipe", "pipe", "inherit"] });
    const events = [];
    const waiters = [];
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
        let e; try { e = JSON.parse(line); } catch (err) { return; }
        e.t = Date.now();
        events.push(e);
        for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
    });
    const server = {
        port, events, child,
        send: (obj) => child.stdin.write(JSON.stringify(obj) + "\n"),
        /** Resolve with the first event (past or future) matching pred, or reject on timeout. */
        waitFor: (pred, ms = 10000, what = "event") => new Promise((resolve, reject) => {
            const old = events.find(pred); if (old) return resolve(old);
            const w = { pred, resolve }; waiters.push(w);
            setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error("timed out waiting for " + what)); } }, ms);
        }),
        last: (name) => [...events].reverse().find(e => e.e === "pos" && e.name === name) || null,
        /** Latest server-side position of a player. */
        pos: (name) => { const e = server.last(name); return e ? { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, health: e.health } : null; },
        /** The newest of the per-input "move" events (every 50 ms while walking) or the periodic position report. */
        now: (name) => {
            const m = [...events].reverse().find(e => (e.e === "move" || e.e === "pos" || e.e === "teleport") && e.name === name);
            return m ? { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch } : null;
        },
        stop: () => { try { child.kill("SIGKILL"); } catch (e) { /* ignore */ } },
    };
    await server.waitFor(e => e.e === "ready", 20000, "the Dragonfly server to start");
    return server;
}

export const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Dragonfly only accepts RakNet protocol 11 while the JavaScript RakNet client in bedrock-protocol
 * sends 10 (BDS and Realms accept both, and Realms use another transport anyway). This UDP relay
 * rewrites that byte, and fixes up the three other things Dragonfly's RakNet insists on (the server address
 * and the security cookie in request 2, and a negative client GUID); everything else is forwarded untouched.
 */
export function startRakRelay({ listenPort, targetPort }) {
    const front = dgram.createSocket({ type: "udp4", recvBufferSize: 8 << 20, sendBufferSize: 8 << 20 });
    const upstream = new Map();   // "addr:port" -> socket towards the server
    const cookies = new Map();    // "addr:port" -> the security cookie the server issued
    front.on("message", (buf0, rinfo) => {
        let buf = buf0;
        const key = rinfo.address + ":" + rinfo.port;
        let up = upstream.get(key);
        if (!up) {
            up = dgram.createSocket({ type: "udp4", recvBufferSize: 8 << 20, sendBufferSize: 8 << 20 });
            up.on("message", (back) => {
                if (back[0] === 0x06 && back.length >= 30 && back[25] === 1) cookies.set(key, Buffer.from(back.subarray(26, 30)));   // OpenConnectionReply1 with security: remember the cookie
                counters.toClient++;
                front.send(back, rinfo.port, rinfo.address, (err) => { if (err && process.env.E2E_TRACE) console.log("relay send error", err.message); });
            });
            up.on("error", (e) => { if (process.env.E2E_TRACE) console.log("relay upstream error", e.message); });
            upstream.set(key, up);
        }
        if (buf[0] === 0x05 && buf[17] === 10) buf[17] = 11;      // OpenConnectionRequest1: protocol 10 -> 11
        if (buf[0] === 0x07 && buf[17] === 4) {                       // OpenConnectionRequest2: point the server address at the real one
            buf[18] = ~127 & 0xff; buf[19] = ~0 & 0xff; buf[20] = ~0 & 0xff; buf[21] = ~1 & 0xff;
            buf.writeUInt16BE(targetPort, 22);
            const cookie = cookies.get(key);
            if (cookie) buf = Buffer.concat([buf.subarray(0, 17), cookie, Buffer.from([0]), buf.subarray(17)]);   // security cookie + "no challenge" byte
            buf[buf.length - 8] |= 0x80;                                // vanilla clients always have a negative GUID; Dragonfly insists
        }

        counters.toServer++;
        up.send(buf, targetPort, "127.0.0.1");
    });
    front.on("error", (e) => { if (process.env.E2E_TRACE) console.log("relay front error", e.message); });
    let count = 0; const counters = { toServer: 0, toClient: 0, bytes: 0 };
    if (process.env.E2E_TRACE) setInterval(() => console.log("RELAY", JSON.stringify(counters)), 2000).unref();
    front.bind(listenPort, "127.0.0.1");
    return { stop: () => { try { front.close(); } catch (e) { /* ignore */ } for (const u of upstream.values()) { try { u.close(); } catch (e) { /* ignore */ } } } };
}

// ------------------------------------------------------------------ clients ---
import { createRequire } from "node:module";
const requireFromBridge = createRequire(join(HERE, "..", "..", "bridge", "index.mjs"));

/** A plain bedrock-protocol client that plays "another player": it can watch and hit the bridge's body. */
export async function startAttacker({ port, name = "Attacker" }) {
    const bedrock = requireFromBridge("bedrock-protocol");
    const client = bedrock.createClient({ host: "127.0.0.1", port, username: name, offline: true, version: "1.26.51", raknetBackend: "jsp-raknet", useNativeRaknet: false, skipPing: true });
    const seen = { entities: new Map(), moves: [], hurt: 0, spawned: false, runtimeId: null };
    client.on("start_game", p => { seen.runtimeId = p.runtime_entity_id; });
    client.on("spawn", () => { seen.spawned = true; });
    client.on("add_player", p => { seen.entities.set(p.username, p.runtime_id); });
    client.on("move_player", p => seen.moves.push({ id: p.runtime_id, x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch, mode: p.mode, t: Date.now() }));
    client.on("move_entity_delta", p => seen.moves.push({ id: p.runtime_entity_id, flags: p.flags, x: p.x, y: p.y, z: p.z, yaw: p.rot_y, pitch: p.rot_x, headYaw: p.rot_z, t: Date.now(), delta: true }));
    client.on("move_entity", p => seen.moves.push({ id: p.runtime_entity_id, x: p.position?.x, y: p.position?.y, z: p.position?.z, yaw: p.rotation?.y, pitch: p.rotation?.x, headYaw: p.rotation?.z, t: Date.now() }));
    client.on("error", e => { seen.error = String(e && e.message || e); });
    const t0 = Date.now();
    while (!seen.spawned && Date.now() - t0 < 20000) await sleep(100);
    if (!seen.spawned) throw new Error("the attacker never spawned" + (seen.error ? ": " + seen.error : ""));
    return {
        client, seen,
        /** Left-click the named player, as a vanilla client does (needs to be within reach). */
        attack(targetName) {
            const id = seen.entities.get(targetName);
            if (id === undefined) throw new Error(`${targetName} is not visible to the attacker`);
            client.queue("inventory_transaction", { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: "item_use_on_entity", actions: [], transaction_data: { entity_runtime_id: id, action_type: "attack", hotbar_slot: 0, held_item: { network_id: 0 }, player_pos: { x: 0.5, y: 2.12, z: 0.5 }, click_pos: { x: 0, y: 0, z: 0 } } } });
        },
        close() { try { client.close(); } catch (e) { /* ignore */ } },
    };
}

/** Everything a body test needs, wired up: server, relay, the real bridge, and the helpers. */
export async function startWorld({ serverPort = 19138, relayPort = 19139, username = "AIBot", connect = {}, serverEnv = {}, bridgeCfg = {} } = {}) {
    const { Bridge } = await import("../../bridge/index.mjs");
    const server = await startServer({ port: serverPort, env: serverEnv });
    const relay = startRakRelay({ listenPort: relayPort, targetPort: serverPort });
    const bridge = new Bridge({ ...bridgeCfg, _path: "e2e", defaults: { provider: "anthropic" }, providers: {}, connect: { mode: "server", host: "127.0.0.1", port: relayPort, offline: true, username, gamemode: "survival", ...connect } });
    const toAddon = [];
    const realSend = bridge.sendToAddon.bind(bridge);
    bridge.sendToAddon = (obj) => { toAddon.push(obj); realSend(obj); };
    bridge.start().catch(e => { console.error("bridge start failed", e); });
    const world = {
        server, relay, bridge, toAddon, username, relayPort,
        name: username,
        /** The addon's role: report where the server keeps the body (from the server's own record). */
        pos: () => server.pos(username),
        say: (obj) => bridge.handle(obj),
        /** Walk like the addon's walker does: a footing point 1.5 blocks ahead every 100 ms, from the server's own position. */
        async driveTo(goal, { mode = "walk", timeout = 10000, arrive = 0.5, jump = false } = {}) {
            const t0 = Date.now();
            while (Date.now() - t0 < timeout) {
                const p = world.pos();
                if (p) {
                    const d = flat(p, goal);
                    if (d < arrive) { await bridge.handle({ t: "stop" }); return { ok: true, ms: Date.now() - t0 }; }
                    const ahead = Math.min(1.5, d);
                    await bridge.handle({ t: "walk", x: p.x + (goal.x - p.x) / d * ahead, y: p.y, z: p.z + (goal.z - p.z) / d * ahead, mode, jump: jump ? 1 : 0, fx: p.x, fy: p.y, fz: p.z });
                }
                await sleep(100);
            }
            await bridge.handle({ t: "stop" });
            return { ok: false, ms: Date.now() - t0 };
        },
        async stop() {
            bridge.stopped = true;
            try { bridge.client?.close(); } catch (e) { /* ignore */ }
            for (const t of ["pumpTimer", "pingTimer", "anchorTimer", "bodyTimer", "monitorTimer", "respawnTimer"]) clearInterval(bridge[t]);
            relay.stop(); server.stop();
        },
    };
    return world;
}
