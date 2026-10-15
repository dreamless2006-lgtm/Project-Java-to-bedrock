// What the AI's eyes show, as a picture. Pure: blocks come in through idAt(x, y, z) (a type id, or null when the
// chunk is not loaded), so this runs in the game and in tests alike.
//
// A first-person view in text: one line of sight per character, cast from the eyes through a flat screen in front
// of them, like a ray tracer with a very small window. Two pictures side by side: WHAT is in each direction (one
// character per kind of material) and HOW FAR (one digit per distance band). People and creatures in view are drawn
// over the world where they stand, if nothing is in the way.
//
// The middle column is straight ahead and the middle row is level with the crosshair.

import { kindOf } from "./terrain.js";
import { castDir, sightClass, compassOf } from "./senses.js";

const RAD = Math.PI / 180;

/** The distance bands: a digit is how many of these the thing is beyond. 9 = past the last band, or open air. */
export const DEPTH_BANDS = [2, 4, 6, 8, 11, 15, 20, 26, 32];

/** The characters the picture is drawn with, for the prompt and for the player reading it. */
export const SIGHT_LEGEND = [
    [".", "open air or sky (nothing within range)"], ["?", "not loaded yet"],
    ["#", "rock (stone, deepslate, netherrack...)"], ["\"", "grass"], ["=", "dirt, mud, farmland, path"], [":", "sand, gravel"], ["^", "snow, ice"],
    ["T", "tree trunk or log"], ["%", "leaves"], ["*", "ore"], ["~", "water"], ["!", "lava"], ["X", "harmful (cactus, fire, magma, cobweb)"],
    ["B", "built: planks, bricks, fences, walls, stairs, slabs"], ["D", "door, trapdoor, gate"], ["G", "glass"], ["C", "chest, furnace, crafting table, bed, workstation"], ["o", "any other solid block"],
    ["@", "a player"], ["H", "a hostile creature"], ["a", "an animal"], ["&", "another bot"], ["$", "a dropped item"],
];

const DEPTH_TEXT = "0 = under 2 m, 1 = 2-4, 2 = 4-6, 3 = 6-8, 4 = 8-11, 5 = 11-15, 6 = 15-20, 7 = 20-26, 8 = 26-32, 9 = farther or open";

/** The line of legend text, shared by the system prompt and `!ai see`. */
export function legendText() {
    return SIGHT_LEGEND.map(([g, t]) => `${g} ${t}`).join("; ") + `. Distance digits: ${DEPTH_TEXT}.`;
}

const RE_CHEST = /chest|barrel|furnace|smoker|crafting_table|_bed$|^minecraft:bed$|anvil|enchanting_table|brewing_stand|loom|grindstone|stonecutter|smithing_table|cartography_table|lectern|bookshelf|shulker_box|composter|cauldron/;
const RE_DOOR = /_door$|_trapdoor$|fence_gate$/;

/** The character for a block of this type: see SIGHT_LEGEND. */
export function glyphOf(id, kind) {
    if (kind === undefined) kind = kindOf(id);
    if (kind === "water") return "~";
    if (kind === "lava") return "!";
    if (kind === "hazard") return "X";
    const cls = sightClass(id, kind);
    if (cls === "tree") return /_leaves$/.test(id) ? "%" : "T";
    if (cls === "ore") return "*";
    if (RE_DOOR.test(id)) return "D";
    if (/glass/.test(id)) return "G";
    if (RE_CHEST.test(id)) return "C";
    if (/grass_block|podzol|mycelium|moss_block/.test(id)) return "\"";
    if (/dirt|farmland|path|mud|clay/.test(id)) return "=";
    if (/sand|gravel/.test(id)) return ":";
    if (cls === "ice") return "^";
    if (cls === "built") return "B";
    if (cls === "rock") return "#";
    if (kind === "tall") return "B";
    return "o";
}

function depthDigit(dist) {
    for (let i = 0; i < DEPTH_BANDS.length; i++) if (dist < DEPTH_BANDS[i]) return String(i);
    return "9";
}

function cachedAt(idAt) {
    const m = new Map();
    return (x, y, z) => { const k = x + "," + y + "," + z; let v = m.get(k); if (v === undefined) { v = idAt(x, y, z); if (v === undefined) v = null; m.set(k, v); } return v; };
}

/** The camera: forward, right and up unit vectors for a yaw and pitch (Bedrock's: yaw 0 faces south, pitch negative looks up). */
export function cameraBasis(yaw, pitch) {
    const sy = Math.sin(yaw * RAD), cy = Math.cos(yaw * RAD), sp = Math.sin(pitch * RAD), cp = Math.cos(pitch * RAD);
    return {
        f: { x: -sy * cp, y: -sp, z: cy * cp },
        r: { x: -cy, y: 0, z: -sy },
        u: { x: -sy * sp, y: cp, z: cy * sp },
    };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Draw the view from `eye` facing (yaw, pitch).
 *   things: [{ glyph: "@", name, x, y, z }]  the middle of each person or creature worth drawing (x, y, z is the body's middle)
 *   -> { rows: [string], depth: [string], seen: [{ glyph, name, dist, bearing, elevation }], cols, nrows, hfov, vfov, yaw, pitch, max }
 */
export function renderSight(idAt, eye, yaw, pitch, { cols = 33, rows = 13, hfov = 90, max = 32, things = [] } = {}) {
    cols = Math.max(5, Math.min(101, cols | 0)); rows = Math.max(3, Math.min(61, rows | 0));
    const at = cachedAt(idAt);
    const { f, r, u } = cameraBasis(yaw, pitch);
    const tanH = Math.tan(Math.min(150, Math.max(20, hfov)) * RAD / 2);
    const tanV = tanH * rows * 2 / cols;                  // a character is about twice as tall as it is wide: square "pixels"
    const g = [], d = [];
    for (let j = 0; j < rows; j++) {
        const ny = 1 - ((j + 0.5) / rows) * 2;
        let gl = "", dl = "";
        for (let i = 0; i < cols; i++) {
            const nx = ((i + 0.5) / cols) * 2 - 1;
            const dir = { x: f.x + nx * tanH * r.x + ny * tanV * u.x, y: f.y + nx * tanH * r.y + ny * tanV * u.y, z: f.z + nx * tanH * r.z + ny * tanV * u.z };
            const hit = castDir(at, eye, dir, max);
            if (hit.hit) { gl += glyphOf(hit.hit.id, hit.hit.kind); dl += depthDigit(hit.hit.dist); }
            else if (hit.unloaded) { gl += "?"; dl += depthDigit(hit.range); }
            else { gl += "."; dl += "9"; }
        }
        g.push(gl); d.push(dl);
    }
    // creatures and people, drawn where they stand if the line to them is clear
    const seen = [];
    const placed = (things || []).map(t => {
        const v = { x: t.x - eye.x, y: t.y - eye.y, z: t.z - eye.z };
        const z = dot(v, f);
        if (z < 0.3) return null;
        const nx = dot(v, r) / z / tanH, ny = dot(v, u) / z / tanV;
        if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
        const dist = Math.hypot(v.x, v.y, v.z);
        if (dist > max) return null;
        return { t, dist, nx, ny, bearing: Math.atan2(dot(v, r), z) / RAD, elevation: Math.atan2(dot(v, u), z) / RAD };
    }).filter(Boolean).sort((a, b) => b.dist - a.dist);       // far ones first, so near ones are drawn over them
    for (const p of placed) {
        const hit = castDir(at, eye, { x: p.t.x - eye.x, y: p.t.y - eye.y, z: p.t.z - eye.z }, p.dist);
        if (hit.hit && hit.hit.dist < p.dist - 0.8) continue;            // behind a wall or a hill
        const i = Math.min(cols - 1, Math.max(0, Math.floor((p.nx + 1) / 2 * cols)));
        const j = Math.min(rows - 1, Math.max(0, Math.floor((1 - p.ny) / 2 * rows)));
        g[j] = g[j].slice(0, i) + (p.t.glyph || "@") + g[j].slice(i + 1);
        d[j] = d[j].slice(0, i) + depthDigit(p.dist) + d[j].slice(i + 1);
        seen.push({ glyph: p.t.glyph || "@", name: p.t.name || "", dist: Math.round(p.dist * 10) / 10, bearing: Math.round(p.bearing), elevation: Math.round(p.elevation) });
    }
    seen.sort((a, b) => a.dist - b.dist);
    return { rows: g, depth: d, seen, cols, nrows: rows, hfov, vfov: Math.round(2 * Math.atan(tanV) / RAD), yaw, pitch, max };
}

function side(deg) { const a = Math.abs(deg); return a < 6 ? "dead ahead" : `${a}° ${deg < 0 ? "left" : "right"}`; }
function height(deg) { const a = Math.abs(deg); return a < 8 ? "" : `, ${a}° ${deg < 0 ? "below" : "above"} your eyes`; }

/**
 * The picture as text, for the prompt and for the player reading it in chat. The middle row has a > in front of it and the middle column a v above it.
 */
export function formatSight(s, { legend = false } = {}) {
    const mid = (s.nrows - 1) / 2, midc = (s.cols - 1) / 2;
    const L = [];
    L.push(`Sight: facing ${compassOf(s.yaw).name} (yaw ${Math.round(s.yaw)}, pitch ${Math.round(s.pitch)}), ${s.hfov}° wide, ${s.vfov}° high, as far as ${s.max} blocks. Left: what is there. Right: how far.`);
    L.push("  " + " ".repeat(Math.floor(midc)) + "v" + " ".repeat(Math.max(0, s.cols - Math.floor(midc) - 1)) + "   " + " ".repeat(Math.floor(midc)) + "v");
    for (let j = 0; j < s.nrows; j++) L.push(`${j === Math.floor(mid) ? "> " : "  "}${s.rows[j]}   ${s.depth[j]}`);
    if (s.seen.length) L.push("In view: " + s.seen.slice(0, 8).map(x => `${x.glyph} ${x.name || "?"} ${x.dist}m ${side(x.bearing)}${height(x.elevation)}`).join("; ") + ".");
    if (legend) L.push("Legend: " + legendText());
    return L.join("\n");
}
