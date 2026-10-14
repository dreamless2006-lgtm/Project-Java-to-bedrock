#!/usr/bin/env python3
"""Package packs/*_BP and packs/*_RP into dist/<name>-<edition>.mcaddon (and .mcpack per pack).

Editions:
  realm      (default) stable @minecraft/server API, no experiments needed; the LLM brain talks
                       through the bridge; players chat with bots via the bridge relay or the menu.
  realm-beta           same, but depends on the -beta server module so bots hear chat directly
                       (world needs the Beta APIs experiment; Realms may not allow it).
  bds                  beta module + @minecraft/server-net/@minecraft/server-admin, with
                       scripts/brain/net_impl.js swapped for direct HTTP. Bedrock Dedicated Server only.

Usage: python3 tools/build_mcaddon.py [--name ai-sandbox] [--edition realm|realm-beta|bds|all]
"""
import argparse, io, json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
DIST = os.path.join(ROOT, "dist")

SKIP = {".DS_Store", "Thumbs.db"}


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


NET_DEPS = [
    {"module_name": "@minecraft/server-net", "version": "1.0.0-beta"},
    {"module_name": "@minecraft/server-admin", "version": "1.0.0-beta"},
]


BETA_SERVER_VERSION = "2.11.0-beta"   # ships with 1.26.50; bump when a new major release lands


def transform(pack_dir, rel, data, edition):
    """Return the bytes to store for a file, applying edition-specific swaps."""
    if edition == "realm":
        return data
    if rel == "manifest.json":
        m = json.loads(strip_comments(data.decode("utf-8-sig")))
        if any(mod.get("type") == "script" for mod in m.get("modules", [])):
            deps = m.setdefault("dependencies", [])
            for d in deps:
                if d.get("module_name") == "@minecraft/server":
                    d["version"] = BETA_SERVER_VERSION
            if edition == "bds":
                names = {d.get("module_name") for d in deps}
                for d in NET_DEPS:
                    if d["module_name"] not in names:
                        deps.append(d)
            suffix = " (Dedicated Server)" if edition == "bds" else " (Beta API)"
            m["header"]["name"] = m["header"]["name"] + suffix
            m["header"]["description"] = m["header"]["description"].replace("Stable API edition: works on Realms and worlds with the AI Sandbox bridge; use the Dedicated Server edition for in-server HTTP.", "Beta API edition: enable the Beta APIs experiment." + (" Dedicated Server edition: in-server HTTP via @minecraft/server-net." if edition == "bds" else " Bots hear chat directly."))
            return json.dumps(m, indent=2).encode("utf-8")
    if edition == "bds" and rel.replace(os.sep, "/") == "scripts/brain/net_impl.js":
        with open(os.path.join(pack_dir, "scripts", "brain", "net_impl.bds.js"), "rb") as f:
            return f.read()
    return data


def add_tree(zf, pack_dir, prefix, edition="realm"):
    for root, dirs, files in os.walk(pack_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fn in sorted(files):
            if fn in SKIP or fn.startswith("."):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, pack_dir)
            arc = os.path.join(prefix, rel)
            with open(full, "rb") as f:
                data = f.read()
            zf.writestr(arc, transform(pack_dir, rel, data, edition))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ai-sandbox")
    ap.add_argument("--edition", default="realm", choices=["realm", "realm-beta", "bds", "all", "both"])
    args = ap.parse_args()
    editions = ["realm", "realm-beta", "bds"] if args.edition in ("all", "both") else [args.edition]
    packs = sorted(d for d in os.listdir(PACKS) if os.path.isdir(os.path.join(PACKS, d)) and os.path.exists(os.path.join(PACKS, d, "manifest.json")))
    if not packs:
        print("no packs found", file=sys.stderr); sys.exit(1)
    os.makedirs(DIST, exist_ok=True)
    for edition in editions:
        ver = None
        for p in packs:
            v, _ = pack_version(os.path.join(PACKS, p))
            ver = ver or v
            out = os.path.join(DIST, f"{p}-{v}-{edition}.mcpack")
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
                add_tree(zf, os.path.join(PACKS, p), p, edition)
            print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")
        out = os.path.join(DIST, f"{args.name}-{ver}-{edition}.mcaddon")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in packs:
                add_tree(zf, os.path.join(PACKS, p), p, edition)
        print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")


if __name__ == "__main__":
    main()
