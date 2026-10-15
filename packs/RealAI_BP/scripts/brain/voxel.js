// A box of blocks as a message: the format the pack sends the bridge and the page reads (docs/WEBVIEW.md).
// Pure, and free of Buffer/atob/btoa (the game's script runtime has neither), so the pack, Node and the browser
// all run this very file.
//
//   cells    Uint8Array of palette indexes, index (y * D + z) * W + x
//   palette  block ids; index 0 is "" = not loaded; at most 255 entries (index 255 = "minecraft:unknown" when full)
//   z        the cells as (varint(run - 1), index byte) pairs, base64

export const UNKNOWN = "";
export const OTHER = "minecraft:unknown";
export const MAX_PALETTE = 255;
export const MAX_DIM_XZ = 65;            // 2 * 32 + 1
export const MAX_DIM_Y = 64;
export const MAX_CELLS = 300_000;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_REV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();

/** bytes (Uint8Array or array) -> base64 text, padded */
export function toBase64(bytes) {
    let out = "";
    const n = bytes.length;
    for (let i = 0; i < n; i += 3) {
        const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
        out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < n ? B64[c & 63] : "=");
    }
    return out;
}

/** base64 text -> Uint8Array, or null when it is not valid base64 (no whitespace tolerated) */
export function fromBase64(text) {
    if (typeof text !== "string" || text.length % 4 !== 0) return null;
    let pad = 0;
    if (text.endsWith("==")) pad = 2; else if (text.endsWith("=")) pad = 1;
    const out = new Uint8Array((text.length / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < text.length; i += 4) {
        const v = [];
        for (let k = 0; k < 4; k++) {
            const ch = text.charCodeAt(i + k);
            if (ch === 61 /* = */) { if (i + 4 !== text.length || k < 4 - pad) return null; v.push(0); continue; }
            const d = ch < 128 ? B64_REV[ch] : -1;
            if (d < 0) return null;
            v.push(d);
        }
        const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
        if (o < out.length) out[o++] = (n >> 16) & 255;
        if (o < out.length) out[o++] = (n >> 8) & 255;
        if (o < out.length) out[o++] = n & 255;
    }
    return out;
}

/** Run-length encode cells (Uint8Array) -> base64. */
export function encodeCells(cells) {
    const bytes = [];
    let i = 0;
    const n = cells.length;
    while (i < n) {
        const v = cells[i];
        let j = i + 1;
        while (j < n && cells[j] === v) j++;
        let run = j - i - 1;
        while (run >= 128) { bytes.push((run & 127) | 128); run = Math.floor(run / 128); }
        bytes.push(run);
        bytes.push(v);
        i = j;
    }
    return toBase64(bytes);
}

/** base64 -> Uint8Array of exactly `length` cells, or null when the data is malformed, short or long. */
export function decodeCells(text, length) {
    if (!Number.isInteger(length) || length < 0 || length > MAX_CELLS) return null;
    const bytes = fromBase64(text);
    if (!bytes) return null;
    const cells = new Uint8Array(length);
    let at = 0, p = 0;
    while (p < bytes.length) {
        let run = 0, mul = 1, more = true, count = 0;
        while (more) {
            if (p >= bytes.length || ++count > 5) return null;
            const b = bytes[p++];
            run += (b & 127) * mul;
            mul *= 128;
            more = (b & 128) !== 0;
        }
        if (p >= bytes.length) return null;
        const v = bytes[p++];
        const len = run + 1;
        if (at + len > length) return null;
        cells.fill(v, at, at + len);
        at += len;
    }
    return at === length ? cells : null;
}

/** Collects block ids while a box is read: index() hands out palette indexes. */
export class Palette {
    constructor() { this.ids = [UNKNOWN]; this.map = new Map([[UNKNOWN, 0]]); }
    index(id) {
        if (id === null || id === undefined || id === "") return 0;
        let i = this.map.get(id);
        if (i !== undefined) return i;
        if (this.ids.length >= MAX_PALETTE) {
            if (this.ids.length === MAX_PALETTE) { this.ids.push(OTHER); this.map.set(OTHER, MAX_PALETTE); }
            return MAX_PALETTE;
        }
        i = this.ids.length;
        this.ids.push(id);
        this.map.set(id, i);
        return i;
    }
}

/** Build a `vw` message. o = [ox, oy, oz], s = [W, H, D]. */
export function packWorld({ n, d, o, s, palette, cells }) {
    return { t: "vw", n, d, o, s, p: palette.ids ? palette.ids : palette, z: encodeCells(cells) };
}

const isInt = (x) => Number.isInteger(x);

/**
 * Check a `vw` message and open it: -> { n, dim, ox, oy, oz, W, H, D, palette, cells } or null for anything that is not one.
 */
export function unpackWorld(msg) {
    if (!msg || typeof msg !== "object") return null;
    const { o, s, p, z } = msg;
    if (!Array.isArray(o) || o.length !== 3 || !o.every(isInt) || o.some(v => Math.abs(v) > 33_554_432)) return null;
    if (!Array.isArray(s) || s.length !== 3 || !s.every(isInt)) return null;
    const [W, H, D] = s;
    if (W < 1 || D < 1 || H < 1 || W > MAX_DIM_XZ || D > MAX_DIM_XZ || H > MAX_DIM_Y || W * H * D > MAX_CELLS) return null;
    if (!Array.isArray(p) || p.length < 1 || p.length > 256 || p[0] !== UNKNOWN || !p.every(x => typeof x === "string" && x.length <= 80)) return null;
    const cells = decodeCells(z, W * H * D);
    if (!cells) return null;
    for (let i = 0; i < cells.length; i++) if (cells[i] >= p.length) return null;
    return { n: Number(msg.n) || 0, dim: typeof msg.d === "string" ? msg.d : "overworld", ox: o[0], oy: o[1], oz: o[2], W, H, D, palette: p.slice(), cells };
}
