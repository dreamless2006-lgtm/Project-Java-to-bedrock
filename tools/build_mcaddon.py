#!/usr/bin/env python3
"""Package packs/RealAI_BP + packs/RealAI_RP into one dist/Real-AI-<version>.mcaddon.

The addon uses the stable @minecraft/server API (no experiments), so the same
file works on Realms, friend worlds, LAN and dedicated servers. Models are
reached through the Real AI bridge (bridge/), which joins the world as a player.

Optional variant for Bedrock Dedicated Server admins who prefer the server to
call the model providers itself (no bridge account needed):

    python3 tools/build_mcaddon.py --variant server

It adds the @minecraft/server-net and @minecraft/server-admin dependencies
(beta modules that only a dedicated server can load) and swaps
scripts/brain/net_impl.js for the direct HTTP implementation.

Usage: python3 tools/build_mcaddon.py [--variant standard|server|all] [--name Real-AI]
"""
import argparse, json, os, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
DIST = os.path.join(ROOT, "dist")

SKIP = {".DS_Store", "Thumbs.db"}

NET_DEPS = [
    {"module_name": "@minecraft/server-net", "version": "1.0.0-beta"},
    {"module_name": "@minecraft/server-admin", "version": "1.0.0-beta"},
]
BETA_SERVER_VERSION = "2.11.0-beta"   # the -beta module that ships with 1.26.50


def strip_comments(text):
    out, i, in_str = [], 0, False
    while i < len(text):
        c = text[i]; n = text[i + 1] if i + 1 < len(text) else ""
        if in_str:
            out.append(c)
            if c == "\\":
                out.append(n); i += 2; continue
            if c == '"':
                in_str = False
            i += 1; continue
        if c == '"':
            in_str = True; out.append(c); i += 1; continue
        if c == "/" and n == "/":
            while i < len(text) and text[i] != "\n": i += 1
            continue
        if c == "/" and n == "*":
            i += 2
            while i < len(text) and not (text[i] == "*" and text[i + 1:i + 2] == "/"): i += 1
            i += 2; continue
        out.append(c); i += 1
    return "".join(out)


def pack_version(pack_dir):
    with open(os.path.join(pack_dir, "manifest.json"), encoding="utf-8-sig") as f:
        m = json.loads(strip_comments(f.read()))
    return ".".join(str(x) for x in m["header"]["version"]), m["header"]["name"]


def transform(pack_dir, rel, data, variant):
    """Return the bytes to store for a file, applying variant-specific swaps."""
    if variant == "standard":
        return data
    rel = rel.replace(os.sep, "/")
    if rel == "manifest.json":
        m = json.loads(strip_comments(data.decode("utf-8-sig")))
        if any(mod.get("type") == "script" for mod in m.get("modules", [])):
            deps = m.setdefault("dependencies", [])
            for d in deps:
                if d.get("module_name") == "@minecraft/server":
                    d["version"] = BETA_SERVER_VERSION
            names = {d.get("module_name") for d in deps}
            for d in NET_DEPS:
                if d["module_name"] not in names:
                    deps.append(d)
            m["header"]["name"] = m["header"]["name"] + " (Dedicated Server)"
            m["header"]["description"] = "Dedicated Server variant: the server calls the model providers itself through @minecraft/server-net (keys in secrets.json). " + m["header"]["description"]
            return json.dumps(m, indent=2).encode("utf-8")
    if rel == "scripts/brain/net_impl.js":
        with open(os.path.join(pack_dir, "scripts", "brain", "net_impl.bds.js"), "rb") as f:
            return f.read()
    return data


def add_tree(zf, pack_dir, prefix, variant):
    for root, dirs, files in os.walk(pack_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fn in sorted(files):
            if fn in SKIP or fn.startswith("."):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, pack_dir)
            with open(full, "rb") as f:
                data = f.read()
            zf.writestr(os.path.join(prefix, rel), transform(pack_dir, rel, data, variant))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Real-AI")
    ap.add_argument("--variant", default="standard", choices=["standard", "server", "all"])
    ap.add_argument("--mcpacks", action="store_true", help="also write one .mcpack per pack")
    args = ap.parse_args()
    variants = ["standard", "server"] if args.variant == "all" else [args.variant]
    packs = sorted(d for d in os.listdir(PACKS) if os.path.isdir(os.path.join(PACKS, d)) and os.path.exists(os.path.join(PACKS, d, "manifest.json")))
    if not packs:
        print("no packs found", file=sys.stderr); sys.exit(1)
    os.makedirs(DIST, exist_ok=True)
    for variant in variants:
        ver = pack_version(os.path.join(PACKS, packs[0]))[0]
        suffix = "" if variant == "standard" else "-server"
        if args.mcpacks:
            for p in packs:
                out = os.path.join(DIST, f"{p}-{ver}{suffix}.mcpack")
                with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
                    add_tree(zf, os.path.join(PACKS, p), p, variant)
                print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")
        out = os.path.join(DIST, f"{args.name}-{ver}{suffix}.mcaddon")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in packs:
                add_tree(zf, os.path.join(PACKS, p), p, variant)
        print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")


if __name__ == "__main__":
    main()
