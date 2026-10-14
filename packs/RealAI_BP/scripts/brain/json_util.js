// Pure helpers for turning LLM text into the JSON the brain expects.
// No @minecraft imports: these run in Node unit tests too.

/**
 * Find the first balanced JSON object or array in free text. Handles code
 * fences, leading chatter and trailing commentary. Returns the substring or null.
 */
export function extractJsonText(text) {
    if (typeof text !== "string") return null;
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = findStart(s);
    if (start < 0) return null;
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inString) {
            if (c === "\\") { i++; continue; }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") {
            depth--;
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    // Unbalanced: return the tail so repair can try closing it.
    return s.slice(start);
}

function findStart(s) {
    const a = s.indexOf("{");
    const b = s.indexOf("[");
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
}

/** Try JSON.parse, then a few cheap repairs (trailing commas, missing closers). */
export function parseJsonLoose(text) {
    const candidate = extractJsonText(text);
    if (!candidate) return null;
    const attempts = [
        candidate,
        candidate.replace(/,\s*([}\]])/g, "$1"),
        closeOpen(candidate.replace(/,\s*([}\]])/g, "$1")),
    ];
    for (const a of attempts) {
        try { return JSON.parse(a); } catch (e) { /* next */ }
    }
    return null;
}

function closeOpen(s) {
    const stack = [];
    let inString = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inString) {
            if (c === "\\") { i++; continue; }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') inString = true;
        else if (c === "{") stack.push("}");
        else if (c === "[") stack.push("]");
        else if (c === "}" || c === "]") stack.pop();
    }
    let out = s;
    if (inString) out += '"';
    out = out.replace(/,\s*$/, "");
    while (stack.length) out += stack.pop();
    return out;
}

/** Deterministic stringify (sorted keys) so prompt prefixes stay byte-stable for caching. */
export function stableStringify(value) {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
        return out;
    }
    return v;
}

/** Rough token estimate (chars/4) used only for budgeting, never for truncation decisions that matter. */
export function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
}

/** Clamp a string to n characters, cutting at a word boundary and adding an ellipsis. */
export function clip(text, n) {
    const s = String(text ?? "");
    if (s.length <= n) return s;
    const cut = s.lastIndexOf(" ", n - 1);
    return s.slice(0, cut > n * 0.6 ? cut : n - 1) + "…";
}
