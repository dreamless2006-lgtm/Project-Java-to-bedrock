// Spectator mode: watch the game through the AI's eyes.
//
// A viewer who asks (!ai sight, the Real AI menu, /realai:ai "sight") becomes an invisible spectator whose screen is
// the AI's own view: a free camera put at the AI's eyes and turned the way the AI's head is turned, every tick. The
// viewer's own body follows the AI around (the game only loads the world near a player's body, and the camera sits
// where the AI is), their controls are locked while they watch, and they get a line on the action bar with what the
// AI is doing and thinking. Leaving gives back their game mode, controls and view.
//
//   eyes     the camera is in the AI's head: exactly what it sees
//   behind   over the AI's shoulder: the AI in the picture, as in third person
//   body     no camera: the viewer's own spectator body is put at the AI's eyes and turned the way it faces
//
// If the camera API is not there (an older game) "body" is used on its own: the same picture without the smooth camera.
//
// Everything that could leave a player stuck (locked controls, spectator mode, a camera that never ends) is
// written to the player first and undone when they leave, when the AI goes away, and when the world loads again.

import { world, system, GameMode, InputPermissionCategory } from "@minecraft/server";
import { allBrains } from "./gate.js";
import { idAtFor } from "./around.js";
import { castDir } from "./senses.js";

const KEY = "realai:watching";          // on the viewer: { gm, home } while the view is on, so a restart can undo it
const MODES = ["eyes", "behind", "body"];
const BEHIND = 3.4;                     // blocks back from the head in "behind"
export const MODE_TEXT = { eyes: "its eyes", behind: "over its shoulder", body: "from its eyes, no camera" };
const GONE_TICKS = 100;                 // the AI is out of the world this long: the view ends

const watching = new Map();             // viewer id -> { viewer, target, mode, prev, since, fallback, missing, camOk }
let timer = null;

function lower(x) { return String(x ?? "").toLowerCase(); }
function brains() { try { return [...allBrains().values()]; } catch (e) { return []; } }
function valid(e) { try { return !!e && e.isValid !== false && !!e.location; } catch (e2) { return false; } }

/** The AI to watch: by name (a prefix is enough), else the bridge account's player, else the first one alive. */
export function findTarget(query) {
    const all = brains().filter(b => valid(b.bot));
    if (query) { const q = lower(query); return all.find(b => lower(b.name) === q) || all.find(b => lower(b.name).startsWith(q)) || null; }
    return all.find(b => { try { return b.settings?.mode === "bridge"; } catch (e) { return false; } }) || all.find(b => { try { return b.bot.typeId === "minecraft:player"; } catch (e) { return false; } }) || all[0] || null;
}

export function watchState(viewer) {
    const w = watching.get(viewer?.id);
    return w ? { target: w.target, mode: w.mode, fallback: w.fallback } : null;
}
export function isWatching(viewer) { return watching.has(viewer?.id); }

function say(viewer, text) { try { viewer.sendMessage(text); } catch (e) { /* ignore */ } }

function setLocked(viewer, locked) {
    for (const c of [InputPermissionCategory.Camera, InputPermissionCategory.Movement]) {
        try { viewer.inputPermissions.setPermissionCategory(c, !locked); } catch (e) { /* older game: the controls stay */ }
    }
}

/** Put a viewer's game mode, controls, camera and place back the way they were (stay: where the AI is). */
function restore(viewer, gm, home, stay) {
    try { viewer.camera.clear(); } catch (e) { /* no camera, or none set */ }
    setLocked(viewer, false);
    try { if (home && !stay) viewer.teleport({ x: home.x, y: home.y, z: home.z }, { dimension: world.getDimension(home.dim), keepVelocity: false }); } catch (e) { /* ignore */ }
    try { if (gm && lower(gm) !== "spectator") viewer.setGameMode(gm); } catch (e) { /* ignore */ }
    try { viewer.onScreenDisplay.setActionBar(""); } catch (e) { /* ignore */ }
    try { viewer.setDynamicProperty(KEY, undefined); } catch (e) { /* ignore */ }
}

/**
 * Start (or change) a view. -> { ok, name, mode } or { ok: false, error }
 *   opts.mode: "eyes" | "behind"
 */
export function startWatching(viewer, query, opts = {}) {
    if (!valid(viewer)) return { ok: false, error: "no viewer" };
    const t = findTarget(query);
    if (!t) return { ok: false, error: query ? `no AI called ${query} is here` : "no AI is playing yet (is the bridge connected?)" };
    if (t.bot.id === viewer.id) return { ok: false, error: "that is you" };
    const mode = MODES.includes(opts.mode) ? opts.mode : (watching.get(viewer.id)?.mode || "eyes");
    const cur = watching.get(viewer.id);
    if (cur) {
        cur.target = t.name; cur.mode = mode; cur.missing = 0; cur.fallback = mode === "body";
        if (cur.fallback) { try { viewer.camera.clear(); } catch (e) { /* ignore */ } }
        return { ok: true, name: t.name, mode };
    }
    let prev = "Survival";
    try { prev = viewer.getGameMode(); } catch (e) { /* ignore */ }
    let home = null;
    try { const l = viewer.location; home = { x: l.x, y: l.y, z: l.z, dim: viewer.dimension.id }; } catch (e) { /* ignore */ }
    try { viewer.setDynamicProperty(KEY, JSON.stringify({ gm: prev, home })); } catch (e) { /* ignore */ }
    try { if (lower(prev) !== "spectator") viewer.setGameMode(GameMode.Spectator); } catch (e) { /* the view works without it */ }
    setLocked(viewer, true);
    watching.set(viewer.id, { viewer, target: t.name, mode, prev, home, since: system.currentTick, fallback: mode === "body", missing: 0, camOk: false, tp: 0 });
    ensureTimer();
    return { ok: true, name: t.name, mode };
}

export function stopWatching(viewer, why, { stay = false } = {}) {
    const w = watching.get(viewer?.id);
    if (!w) return false;
    watching.delete(viewer.id);
    restore(viewer, w.prev, w.home, stay);
    if (why) say(viewer, why);
    return true;
}

function ensureTimer() {
    if (timer !== null) return;
    timer = system.runInterval(tick, 1);
}

/** Where the AI's eyes are, and which way they face. */
function eyesOf(bot) {
    let head = null;
    try { head = bot.getHeadLocation?.(); } catch (e) { head = null; }
    const l = bot.location;
    if (!head || !Number.isFinite(head.x)) head = { x: l.x, y: l.y + 1.62, z: l.z };
    let yaw = 0, pitch = 0;
    try { const r = bot.getRotation(); yaw = r.y; pitch = r.x; } catch (e) { /* ignore */ }
    return { head, yaw, pitch };
}

/** Over the shoulder: back along where the AI faces, but not through a wall. */
function behindOf(bot, head, yaw, pitch) {
    const yr = yaw * Math.PI / 180, pr = pitch * Math.PI / 180;
    const f = { x: -Math.sin(yr) * Math.cos(pr), y: -Math.sin(pr), z: Math.cos(yr) * Math.cos(pr) };
    const up = { x: head.x, y: head.y + 0.7, z: head.z };
    let back = BEHIND;
    try { const r = castDir(idAtFor(bot.dimension), up, { x: -f.x, y: -f.y, z: -f.z }, BEHIND + 0.4); if (r.hit) back = Math.max(0.4, r.hit.dist - 0.4); } catch (e) { /* ignore */ }
    return { x: up.x - f.x * back, y: up.y - f.y * back, z: up.z - f.z * back };
}

function actionLine(w, b) {
    let doing = "", think = "", hp = "";
    try { doing = b.actuator.describeCurrent() || "idle"; } catch (e) { doing = "?"; }
    try { const t = b.lastThought; if (t && t.text) think = t.text.slice(0, 90); } catch (e) { /* ignore */ }
    try { const h = b.bot.getComponent("minecraft:health"); if (h) hp = `♥ ${Math.round(h.currentValue)}`; } catch (e) { /* ignore */ }
    return `§bWatching ${b.name}§r (${MODE_TEXT[w.mode]})  ${hp}\n§7${doing}${think ? " | " + think : ""}  §8(!ai sight off to leave)`;
}

function tick() {
    if (watching.size === 0) { try { system.clearRun(timer); } catch (e) { /* ignore */ } timer = null; return; }
    const now = system.currentTick;
    for (const [id, w] of [...watching]) {
        const viewer = w.viewer;
        if (!valid(viewer)) { watching.delete(id); continue; }                // gone: the saved property undoes it on their next join
        const b = findTarget(w.target);
        if (!b) {
            if (++w.missing > GONE_TICKS) stopWatching(viewer, "§e[Real AI] The AI is gone, so the view ended.");
            continue;
        }
        w.missing = 0;
        try {
            const bot = b.bot;
            const { head, yaw, pitch } = eyesOf(bot);
            const dimChanged = viewer.dimension.id !== bot.dimension.id;
            let near = true;
            try { const l = viewer.location; near = Math.hypot(l.x - head.x, l.y - head.y, l.z - head.z) <= 3; } catch (e) { near = false; }
            // the world is loaded around the viewer's body: keep it with the AI
            if (dimChanged || !near || now - w.tp >= 100) {
                try { viewer.teleport({ x: head.x, y: head.y, z: head.z }, { dimension: bot.dimension, keepVelocity: false }); w.tp = now; } catch (e) { /* retry next tick */ }
            }
            if (!w.fallback) {
                const loc = w.mode === "behind" ? behindOf(bot, head, yaw, pitch) : head;
                try {
                    viewer.camera.setCamera("minecraft:free", { location: { x: loc.x, y: loc.y, z: loc.z }, rotation: { x: pitch, y: yaw } });
                    w.camOk = true;
                } catch (e) {
                    if (!w.camOk) {
                        w.fallback = true;
                        say(viewer, "§e[Real AI] This game has no free camera for add-ons, so your spectator body looks through the AI's eyes instead (no smooth view, but the same sight).");
                    }
                }
            }
            if (w.fallback) {
                try { viewer.teleport({ x: head.x, y: head.y, z: head.z }, { dimension: bot.dimension, rotation: { x: pitch, y: yaw }, keepVelocity: false }); w.tp = now; } catch (e) { /* ignore */ }
            }
            if (now % 10 === 0) { try { viewer.onScreenDisplay.setActionBar(actionLine(w, b)); } catch (e) { /* ignore */ } }
        } catch (e) { /* one bad tick does not end the view */ }
    }
}

/** If this player was left in the view by a restart or a crash, give them their game mode, controls and screen back. */
export function undoStale(player) {
    if (watching.has(player?.id)) return false;
    let raw;
    try { raw = player.getDynamicProperty(KEY); } catch (e) { return false; }
    if (typeof raw !== "string" || !raw) return false;
    let gm = null, home = null;
    try { const j = JSON.parse(raw); gm = j.gm; home = j.home; } catch (e) { /* ignore */ }
    restore(player, gm, home, false);
    say(player, "§e[Real AI] Your view of the AI had been left on; it is off now.");
    return true;
}

/** Hook the lifecycle: undo stale views for everyone online after a (re)load and whenever someone joins, and forget leavers. */
export function startSightCam() {
    system.runTimeout(() => { for (const p of world.getAllPlayers()) { try { undoStale(p); } catch (e) { /* ignore */ } } }, 20);
    try { world.afterEvents.playerSpawn.subscribe(ev => { if (ev.initialSpawn) system.runTimeout(() => { try { undoStale(ev.player); } catch (e) { /* ignore */ } }, 20); }); } catch (e) { /* ignore */ }
    try { world.afterEvents.playerLeave.subscribe(ev => { watching.delete(ev.playerId); }); } catch (e) { /* ignore */ }
}

/** For tests and !ai status. */
export function viewerCount() { return watching.size; }
