#!/usr/bin/env python3
"""Package packs/*_BP and packs/*_RP into dist/<name>.mcaddon (and .mcpack per pack).

Usage: python3 tools/build_mcaddon.py [--name ai-sandbox]
"""
import argparse, json, os, re, sys, zipfile

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


def add_tree(zf, pack_dir, prefix):
    for root, dirs, files in os.walk(pack_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fn in sorted(files):
            if fn in SKIP or fn.startswith("."):
                continue
            full = os.path.join(root, fn)
            arc = os.path.join(prefix, os.path.relpath(full, pack_dir))
            zf.write(full, arc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ai-sandbox")
    args = ap.parse_args()
    packs = sorted(d for d in os.listdir(PACKS) if os.path.isdir(os.path.join(PACKS, d)) and os.path.exists(os.path.join(PACKS, d, "manifest.json")))
    if not packs:
        print("no packs found", file=sys.stderr); sys.exit(1)
    os.makedirs(DIST, exist_ok=True)
    ver = None
    for p in packs:
        v, _ = pack_version(os.path.join(PACKS, p))
        ver = ver or v
        out = os.path.join(DIST, f"{p}-{v}.mcpack")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            add_tree(zf, os.path.join(PACKS, p), p)
        print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")
    out = os.path.join(DIST, f"{args.name}-{ver}.mcaddon")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in packs:
            add_tree(zf, os.path.join(PACKS, p), p)
    print("wrote", os.path.relpath(out, ROOT), f"({os.path.getsize(out)//1024} KiB)")


if __name__ == "__main__":
    main()
