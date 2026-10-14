// Discovers every non-vanilla block, item and creature registered in this
// world (this pack's parasites and any other addon the player installed) so
// the model can name, use and fight modded content. Rendered once per
// session into the stable system prompt.
import { BlockTypes, ItemTypes, EntityTypes } from "@minecraft/server";
import { CONTENT_NAMES } from "./generated/content_names.js";
import { renderWorldContent } from "./prompt.js";
import { MOB_INFO } from "../srp/data.js";

let cache = null;
const srpInfo = MOB_INFO || {};

const HIDDEN = new Set(["rg:bot", "rg:build_target", "rg:melee_attack_throw", "rg:friend_request", "rg:friend_list_opener"]);

export function srpMobInfo(id) { return srpInfo[id]; }

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
    const base = CONTENT_NAMES[id];
    const info = srpInfo && srpInfo[id];
    if (info) {
        const bits = [base || nameOf(id)];
        if (info.cat) bits.push(String(info.cat).replace(/^srp_/, "") + " parasite");
        if (info.hp) bits.push(`${info.hp} hp`);
        if (info.boss) bits.push("boss");
        if (info.fly) bits.push("flies");
        if (info.node) bits.push("hive node, kill it to push the infection back");
        return bits.join(", ");
    }
    return base || "";
}

export function worldContent() {
    if (cache) return cache;
    const blocks = allIds(() => BlockTypes.getAll()).filter(isModdedId);
    const items = allIds(() => ItemTypes.getAll()).filter(isModdedId).filter(id => !HIDDEN.has(id) && !blocks.includes(id));
    const entities = allIds(() => EntityTypes.getAll()).filter(isModdedId).filter(id => !HIDDEN.has(id) && !/ball$|^srp:(missile|homing|bomb_)/.test(id));
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
