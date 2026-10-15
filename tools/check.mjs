#!/usr/bin/env node
// Static checks for the behaviour/resource packs: JS syntax, JSON validity
// (Bedrock-style comments tolerated), manifest dependency wiring and a scan
// for obviously-wrong Script API usage. Exit code 1 on any failure.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PACKS = join(ROOT, "packs");

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

// Bedrock's JSON reader tolerates // and /* */ comments. Strip them outside strings.
export function stripJsonComments(text) {
    let out = "";
    let i = 0;
    let inString = false;
    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];
        if (inString) {
            out += c;
            if (c === "\\") { out += n ?? ""; i += 2; continue; }
            if (c === '"') inString = false;
            i++;
            continue;
        }
        if (c === '"') { inString = true; out += c; i++; continue; }
        if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
        if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
        out += c;
        i++;
    }
    return out;
}

function main() {
const failures = [];
const files = walk(PACKS);
let jsCount = 0, jsonCount = 0;

for (const f of files) {
    const ext = extname(f);
    if (ext === ".js" || ext === ".mjs") {
        jsCount++;
        const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
        if (r.status !== 0) failures.push(`JS syntax: ${relative(ROOT, f)}\n${r.stderr.trim()}`);
    } else if (ext === ".json" || ext === ".material") {
        jsonCount++;
        try {
            JSON.parse(stripJsonComments(readFileSync(f, "utf8").replace(/^﻿/, "")));
        } catch (e) {
            failures.push(`JSON: ${relative(ROOT, f)}: ${e.message}`);
        }
    }
}

// Manifest wiring: every pack's uuid must be unique, RP<->BP dependencies must resolve,
// and the script entry file must exist.
const manifests = files.filter(f => f.endsWith("manifest.json"));
const headers = new Map();
for (const m of manifests) {
    const j = JSON.parse(stripJsonComments(readFileSync(m, "utf8")));
    const uuid = j.header?.uuid;
    if (!uuid) failures.push(`manifest without header.uuid: ${relative(ROOT, m)}`);
    if (headers.has(uuid)) failures.push(`duplicate pack uuid ${uuid} in ${relative(ROOT, m)} and ${headers.get(uuid)}`);
    headers.set(uuid, relative(ROOT, m));
    for (const mod of j.modules ?? []) {
        if (mod.type === "script") {
            const entry = join(m, "..", mod.entry);
            try { statSync(entry); } catch { failures.push(`script entry missing: ${relative(ROOT, entry)}`); }
        }
    }
}
for (const m of manifests) {
    const j = JSON.parse(stripJsonComments(readFileSync(m, "utf8")));
    for (const dep of j.dependencies ?? []) {
        if (dep.uuid && !headers.has(dep.uuid)) failures.push(`${relative(ROOT, m)} depends on unknown pack uuid ${dep.uuid}`);
    }
}

// One version everywhere: both packs' headers and modules, the build the addon announces to the bridge, and the build the bridge expects.
{
    const vers = new Map();
    for (const m of manifests) {
        const j = JSON.parse(stripJsonComments(readFileSync(m, "utf8")));
        if (j.header?.version) vers.set(relative(ROOT, m) + " header", j.header.version.join("."));
        for (const mod of j.modules ?? []) if (Array.isArray(mod.version)) vers.set(relative(ROOT, m) + " module " + mod.type, mod.version.join("."));
    }
    const grab = (file, re) => { try { return re.exec(readFileSync(join(ROOT, file), "utf8"))?.[1]; } catch { return undefined; } };
    vers.set("ADDON_BUILD (bridge_channel.js)", grab("packs/RealAI_BP/scripts/brain/bridge_channel.js", /ADDON_BUILD = "([\d.]+)"/));
    vers.set("EXPECT_ADDON (bridge/index.mjs)", grab("bridge/index.mjs", /EXPECT_ADDON = "([\d.]+)"/));
    const distinct = new Set([...vers.values()]);
    if (distinct.size !== 1) failures.push("the pack version is not the same everywhere: " + [...vers].map(([k, v]) => `${k}=${v}`).join(", "));
}

// Import graph: every relative import must resolve to a file inside the pack.
for (const f of files.filter(f => f.endsWith(".js"))) {
    const src = readFileSync(f, "utf8");
    const re = /from\s+["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) {
        const spec = m[1];
        if (spec.startsWith("@minecraft/")) continue;
        if (!spec.startsWith(".")) { failures.push(`${relative(ROOT, f)}: bare import '${spec}' is not resolvable in a pack`); continue; }
        const target = join(f, "..", spec);
        try { statSync(target); } catch { failures.push(`${relative(ROOT, f)}: import '${spec}' does not exist`); }
    }
}

console.log(`checked ${jsCount} scripts, ${jsonCount} json files, ${manifests.length} manifests`);
if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
}
console.log("OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
