// Discovers every non-vanilla block, item and creature registered in this
// world (whatever other addons the player installed next to Real AI) so the
// model can name, use and fight modded content. Rendered once per session
// into the stable system prompt.
import { BlockTypes, ItemTypes, EntityTypes } from "@minecraft/server";
import { CONTENT_NAMES } from "./generated/content_names.js";
import { renderWorldContent } from "./prompt.js";

let cache = null;

// Our own helper entities and items: not "content" the model should talk about.
const HIDDEN = new Set(["rg:bot", "rg:build_target", "rg:melee_attack_throw", "rg:friend_request", "rg:friend_list_opener"]);
// Projectiles and other helper entities other addons register.
const HELPER_ENTITY = /(_ball|ball|_missile|missile|_projectile|projectile|_bullet|_bomb|_arrow|_beam|_marker|_effect|_fx)$/;

function allIds(getAll) {
    try {
        return getAll().map(t => t.id).filter(id => typeof id === "string");
    } catch (e) {
        return [];
    }
}

export function isModdedId(id) {
    return typeof id === "string" && id.includes(":") && !id.startsWith("minecraft:");
}

/** Short human name for any id (vanilla ids are de-namespaced). */
export function nameOf(id) {
    if (!id) return "?";
    if (CONTENT_NAMES[id]) return CONTENT_NAMES[id];
    return String(id).replace(/^minecraft:/, "").replace(/^[a-z0-9_]+:/, "").replace(/_/g, " ");
}

function describe(id) {
    return CONTENT_NAMES[id] || "";
}

export function worldContent() {
    if (cache) return cache;
    const blocks = allIds(() => BlockTypes.getAll()).filter(isModdedId);
    const items = allIds(() => ItemTypes.getAll()).filter(isModdedId).filter(id => !HIDDEN.has(id) && !blocks.includes(id));
    const entities = allIds(() => EntityTypes.getAll()).filter(isModdedId).filter(id => !HIDDEN.has(id) && !HELPER_ENTITY.test(id));
    const descriptions = {};
    for (const id of [...blocks, ...items, ...entities]) {
        const d = describe(id);
        if (d) descriptions[id] = d;
    }
    const text = renderWorldContent({ blocks, items, entities, descriptions });
    cache = { blocks, items, entities, descriptions, text, counts: { blocks: blocks.length, items: items.length, entities: entities.length } };
    return cache;
}

export function resetWorldContent() { cache = null; }
