// Chunked message framing shared by the in-game bridge channel and the Node
// bridge. Pure. Bedrock caps a client-sent command at 512 characters and we
// keep server-sent chat lines modest too, so every message is split into
// numbered frames:  AIB1|<id>|<index>/<count>|<payload>
// The payload is JSON with no newlines. Frames are reassembled by id.

export const FRAME_PREFIX = "AIB1|";
export const DEFAULT_CHUNK = 380;   // fits "/scriptevent realai:in " + frame under 512
export const REASSEMBLY_TTL_MS = 30_000;
export const MAX_FRAMES = 512;          // a message of more frames than this is not ours (and must not size an array)
export const MAX_PARTIAL = 64;           // messages being reassembled at once

export function encodeFrames(id, text, chunk = DEFAULT_CHUNK) {
    const s = String(text);
    const frames = [];
    const count = Math.max(1, Math.ceil(s.length / chunk));
    for (let i = 0; i < count; i++) {
        frames.push(`${FRAME_PREFIX}${id}|${i + 1}/${count}|${s.slice(i * chunk, (i + 1) * chunk)}`);
    }
    return frames;
}

export function decodeFrame(line) {
    if (typeof line !== "string") return null;
    const at = line.indexOf(FRAME_PREFIX);
    if (at < 0) return null;
    const rest = line.slice(at + FRAME_PREFIX.length);
    const p1 = rest.indexOf("|");
    if (p1 < 0) return null;
    const p2 = rest.indexOf("|", p1 + 1);
    if (p2 < 0) return null;
    const id = rest.slice(0, p1);
    const idx = rest.slice(p1 + 1, p2);
    const m = /^(\d{1,5})\/(\d{1,5})$/.exec(idx);
    if (!m) return null;
    const index = Number(m[1]), count = Number(m[2]);
    if (count < 1 || count > MAX_FRAMES || index < 1 || index > count || id.length > 40) return null;
    return { id, index, count, payload: rest.slice(p2 + 1) };
}

/** Collects frames; returns the full text when a message completes. */
export class Reassembler {
    constructor(now = () => Date.now(), ttl = REASSEMBLY_TTL_MS) {
        this.now = now;
        this.ttl = ttl;
        this.partial = new Map();
    }

    push(line) {
        const f = decodeFrame(line);
        if (!f) return null;
        this.sweep();
        if (f.count === 1) return { id: f.id, text: f.payload };
        let e = this.partial.get(f.id);
        if (!e && this.partial.size >= MAX_PARTIAL) {   // drop the oldest rather than grow without bound
            const oldest = this.partial.keys().next().value;
            this.partial.delete(oldest);
        }
        if (e && e.count !== f.count) return null;
        if (!e) {
            e = { count: f.count, parts: new Array(f.count), got: 0, t: this.now() };
            this.partial.set(f.id, e);
        }
        if (f.index < 1 || f.index > e.count) return null;
        if (e.parts[f.index - 1] === undefined) e.got++;
        e.parts[f.index - 1] = f.payload;
        e.t = this.now();
        if (e.got === e.count) {
            this.partial.delete(f.id);
            return { id: f.id, text: e.parts.join("") };
        }
        return null;
    }

    sweep() {
        const cutoff = this.now() - this.ttl;
        for (const [id, e] of this.partial) if (e.t < cutoff) this.partial.delete(id);
    }
}

let seq = 0;
export function nextMessageId(prefix = "m") {
    seq = (seq + 1) % 1_000_000;
    return prefix + seq.toString(36) + ((Math.random() * 1296) | 0).toString(36);
}

/** JSON on one line; newlines inside strings are already escaped by JSON.stringify. */
export function packMessage(obj) {
    return JSON.stringify(obj);
}

export function unpackMessage(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
}
