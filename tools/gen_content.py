#!/usr/bin/env python3
"""Generate brain/generated/*.js from pack data so the LLM vocabulary and the
scripted crafting table stay in sync with the pack:
  - pack_recipes.js : every recipe under packs/RealAI_BP/recipes (shaped + shapeless)
  - content_names.js : human names for custom entities/items/blocks (lang + display_name)
Run: python3 tools/gen_content.py
"""
import json, os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "packs", "RealAI_BP")
RP = os.path.join(ROOT, "packs", "RealAI_RP")
OUT = os.path.join(BP, "scripts", "brain", "generated")


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


def load(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.loads(strip_comments(f.read()))


def ingredient_id(v):
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("item")
    return None


def ingredient_count(v):
    if isinstance(v, dict):
        return int(v.get("count", 1) or 1)
    return 1


def recipes():
    out = []
    for path in sorted(glob.glob(os.path.join(BP, "recipes", "**", "*.json"), recursive=True)):
        try:
            j = load(path)
        except Exception as e:
            print("skip", path, e); continue
        for kind in ("minecraft:recipe_shaped", "minecraft:recipe_shapeless"):
            r = j.get(kind)
            if not r:
                continue
            tags = r.get("tags", [])
            res = r.get("result")
            if isinstance(res, list):
                res = res[0]
            if not res:
                continue
            needs = {}
            if kind == "minecraft:recipe_shaped":
                keys = r.get("key", {})
                for row in r.get("pattern", []):
                    for ch in row:
                        if ch == " " or ch not in keys:
                            continue
                        iid = ingredient_id(keys[ch])
                        if iid:
                            needs[iid] = needs.get(iid, 0) + 1
            else:
                for ing in r.get("ingredients", []):
                    iid = ingredient_id(ing)
                    if iid:
                        needs[iid] = needs.get(iid, 0) + ingredient_count(ing)
            out.append({
                "id": r.get("description", {}).get("identifier", os.path.basename(path)),
                "result": res.get("item"),
                "count": int(res.get("count", 1) or 1),
                "needs": needs,
                "station": "crafting_table" if "crafting_table" in tags or not tags else tags[0],
            })
    return out


def strip_codes(s):
    return re.sub(r"§.", "", s or "").strip()


def names():
    out = {}
    lang = os.path.join(RP, "texts", "en_US.lang")
    if os.path.exists(lang):
        for line in open(lang, encoding="utf-8-sig"):
            line = line.strip()
            if "=" not in line or line.startswith("#"):
                continue
            k, v = line.split("=", 1)
            v = v.split("\t#")[0].strip()
            m = re.match(r"^(entity|tile|item)\.([a-z0-9_]+:[a-z0-9_./]+)\.name$", k)
            if m and not m.group(2).startswith("minecraft:"):
                out[m.group(2)] = strip_codes(v)
    for path in glob.glob(os.path.join(BP, "items", "**", "*.json"), recursive=True):
        try:
            j = load(path)
        except Exception:
            continue
        it = j.get("minecraft:item", {})
        iid = it.get("description", {}).get("identifier")
        dn = it.get("components", {}).get("minecraft:display_name", {})
        if iid and isinstance(dn, dict) and dn.get("value") and not str(dn["value"]).startswith("item."):
            out[iid] = strip_codes(dn["value"])
    for path in glob.glob(os.path.join(BP, "blocks", "**", "*.json"), recursive=True):
        try:
            j = load(path)
        except Exception:
            continue
        b = j.get("minecraft:block", {})
        bid = b.get("description", {}).get("identifier")
        if bid and bid not in out:
            out[bid] = bid.split(":")[-1].replace("_", " ")
    return dict(sorted(out.items()))


def main():
    os.makedirs(OUT, exist_ok=True)
    rs = recipes()
    with open(os.path.join(OUT, "pack_recipes.js"), "w") as f:
        f.write("// GENERATED by tools/gen_content.py from packs/RealAI_BP/recipes - do not edit.\n")
        f.write("export const PACK_RECIPES = " + json.dumps(rs, indent=1) + ";\n")
    ns = names()
    with open(os.path.join(OUT, "content_names.js"), "w") as f:
        f.write("// GENERATED by tools/gen_content.py from the RP lang file and item/block JSON - do not edit.\n")
        f.write("export const CONTENT_NAMES = " + json.dumps(ns, indent=1) + ";\n")
    print(f"recipes: {len(rs)}, names: {len(ns)} -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
