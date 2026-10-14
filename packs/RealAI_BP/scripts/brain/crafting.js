// Scripted crafting and smelting: inventory arithmetic against a recipe table.
// Pure (operates on a plain {id: count} map); the actuator moves items in and
// out of the real container.
import { PACK_RECIPES } from "./generated/pack_recipes.js";

const M = "minecraft:";

// Vanilla basics a survival player crafts constantly. needs = {item: count}; count = output.
const VANILLA = [
    ...["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"].map(w => ({ id: `${w}_planks`, result: M + `${w}_planks`, count: 4, needs: { [M + `${w}_log`]: 1 }, station: "hand" })),
    { id: "planks_from_any_log", result: M + "oak_planks", count: 4, needs: { "#log": 1 }, station: "hand" },
    { id: "stick", result: M + "stick", count: 4, needs: { "#planks": 2 }, station: "hand" },
    { id: "crafting_table", result: M + "crafting_table", count: 1, needs: { "#planks": 4 }, station: "hand" },
    { id: "torch", result: M + "torch", count: 4, needs: { [M + "coal"]: 1, [M + "stick"]: 1 }, station: "hand" },
    { id: "torch_charcoal", result: M + "torch", count: 4, needs: { [M + "charcoal"]: 1, [M + "stick"]: 1 }, station: "hand" },
    { id: "chest", result: M + "chest", count: 1, needs: { "#planks": 8 } },
    { id: "furnace", result: M + "furnace", count: 1, needs: { [M + "cobblestone"]: 8 } },
    { id: "ladder", result: M + "ladder", count: 3, needs: { [M + "stick"]: 7 } },
    { id: "bed", result: M + "bed", count: 1, needs: { "#wool": 3, "#planks": 3 } },
    { id: "oak_door", result: M + "wooden_door", count: 3, needs: { "#planks": 6 } },
    { id: "oak_fence", result: M + "oak_fence", count: 3, needs: { "#planks": 4, [M + "stick"]: 2 } },
    { id: "bread", result: M + "bread", count: 1, needs: { [M + "wheat"]: 3 } },
    { id: "bowl", result: M + "bowl", count: 4, needs: { "#planks": 3 } },
    { id: "bucket", result: M + "bucket", count: 1, needs: { [M + "iron_ingot"]: 3 } },
    { id: "shield", result: M + "shield", count: 1, needs: { "#planks": 6, [M + "iron_ingot"]: 1 } },
    { id: "bow", result: M + "bow", count: 1, needs: { [M + "stick"]: 3, [M + "string"]: 3 } },
    { id: "arrow", result: M + "arrow", count: 4, needs: { [M + "flint"]: 1, [M + "stick"]: 1, [M + "feather"]: 1 } },
    { id: "flint_and_steel", result: M + "flint_and_steel", count: 1, needs: { [M + "iron_ingot"]: 1, [M + "flint"]: 1 } },
    { id: "glass_pane", result: M + "glass_pane", count: 16, needs: { [M + "glass"]: 6 } },
    { id: "stone_bricks", result: M + "stone_bricks", count: 4, needs: { [M + "stone"]: 4 } },
    { id: "iron_block", result: M + "iron_block", count: 1, needs: { [M + "iron_ingot"]: 9 } },
    { id: "golden_apple", result: M + "golden_apple", count: 1, needs: { [M + "gold_ingot"]: 8, [M + "apple"]: 1 } },
    { id: "boat", result: M + "oak_boat", count: 1, needs: { "#planks": 5 } },
    { id: "sign", result: M + "oak_sign", count: 3, needs: { "#planks": 6, [M + "stick"]: 1 } },
    { id: "blaze_powder", result: M + "blaze_powder", count: 2, needs: { [M + "blaze_rod"]: 1 }, station: "hand" },
    { id: "ender_eye", result: M + "ender_eye", count: 1, needs: { [M + "ender_pearl"]: 1, [M + "blaze_powder"]: 1 }, station: "hand" },
    { id: "shears", result: M + "shears", count: 1, needs: { [M + "iron_ingot"]: 2 } },
    { id: "enchanting_table", result: M + "enchanting_table", count: 1, needs: { [M + "book"]: 1, [M + "diamond"]: 2, [M + "obsidian"]: 4 } },
    { id: "ender_chest", result: M + "ender_chest", count: 1, needs: { [M + "obsidian"]: 8, [M + "ender_eye"]: 1 } },
];
for (const [tier, mat, n] of [["wooden", "#planks", 1], ["stone", M + "cobblestone", 1], ["iron", M + "iron_ingot", 1], ["golden", M + "gold_ingot", 1], ["diamond", M + "diamond", 1]]) {
    VANILLA.push({ id: `${tier}_sword`, result: M + `${tier}_sword`, count: 1, needs: { [mat]: 2, [M + "stick"]: 1 } });
    VANILLA.push({ id: `${tier}_pickaxe`, result: M + `${tier}_pickaxe`, count: 1, needs: { [mat]: 3, [M + "stick"]: 2 } });
    VANILLA.push({ id: `${tier}_axe`, result: M + `${tier}_axe`, count: 1, needs: { [mat]: 3, [M + "stick"]: 2 } });
    VANILLA.push({ id: `${tier}_shovel`, result: M + `${tier}_shovel`, count: 1, needs: { [mat]: 1, [M + "stick"]: 2 } });
    VANILLA.push({ id: `${tier}_hoe`, result: M + `${tier}_hoe`, count: 1, needs: { [mat]: 2, [M + "stick"]: 2 } });
}
for (const [tier, mat] of [["leather", M + "leather"], ["iron", M + "iron_ingot"], ["golden", M + "gold_ingot"], ["diamond", M + "diamond"]]) {
    VANILLA.push({ id: `${tier}_helmet`, result: M + `${tier}_helmet`, count: 1, needs: { [mat]: 5 } });
    VANILLA.push({ id: `${tier}_chestplate`, result: M + `${tier}_chestplate`, count: 1, needs: { [mat]: 8 } });
    VANILLA.push({ id: `${tier}_leggings`, result: M + `${tier}_leggings`, count: 1, needs: { [mat]: 7 } });
    VANILLA.push({ id: `${tier}_boots`, result: M + `${tier}_boots`, count: 1, needs: { [mat]: 4 } });
}
VANILLA.push({ id: "netherite_sword", result: M + "netherite_sword", count: 1, needs: { [M + "diamond_sword"]: 1, [M + "netherite_ingot"]: 1 }, station: "smithing_table" });

export const RECIPES = [...VANILLA, ...PACK_RECIPES].map(r => ({ ...r, station: r.station || "crafting_table" }));

export const SMELT = {
    [M + "raw_iron"]: M + "iron_ingot", [M + "raw_gold"]: M + "gold_ingot", [M + "raw_copper"]: M + "copper_ingot",
    [M + "iron_ore"]: M + "iron_ingot", [M + "gold_ore"]: M + "gold_ingot", [M + "copper_ore"]: M + "copper_ingot",
    [M + "sand"]: M + "glass", [M + "cobblestone"]: M + "stone", [M + "clay_ball"]: M + "brick",
    [M + "beef"]: M + "cooked_beef", [M + "porkchop"]: M + "cooked_porkchop", [M + "chicken"]: M + "cooked_chicken",
    [M + "mutton"]: M + "cooked_mutton", [M + "cod"]: M + "cooked_cod", [M + "salmon"]: M + "cooked_salmon",
    [M + "potato"]: M + "baked_potato", [M + "rabbit"]: M + "cooked_rabbit", [M + "kelp"]: M + "dried_kelp",
    "#log": M + "charcoal",
};
export const FUELS = { [M + "coal"]: 8, [M + "charcoal"]: 8, [M + "coal_block"]: 80, [M + "blaze_rod"]: 12, [M + "lava_bucket"]: 100, "#planks": 1.5, "#log": 1.5, [M + "stick"]: 0.5 };

export function isLog(id) { return /(_log|_stem|_wood)$/.test(id) && !/stripped/.test(id) || /^minecraft:(log|log2)$/.test(id); }
export function isPlanks(id) { return /_planks$/.test(id) || id === M + "planks"; }
export function isWool(id) { return /_wool$/.test(id) || id === M + "wool"; }

function matchesTag(tag, id) {
    if (tag === "#log") return isLog(id);
    if (tag === "#planks") return isPlanks(id);
    if (tag === "#wool") return isWool(id);
    return false;
}

/** Resolve a loose name ("pickaxe", "iron pickaxe", "stone_sword", "torch") to recipes, best first. */
export function findRecipes(name) {
    const q = String(name || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/^minecraft:/, "");
    if (!q) return [];
    const exact = RECIPES.filter(r => r.result === M + q || r.result === q || r.result.endsWith(":" + q) || r.id === q);
    if (exact.length) return exact;
    const partial = RECIPES.filter(r => r.result.includes(q) || r.id.includes(q));
    // Prefer the cheapest tier the inventory can make: order wooden > stone > iron > ... when the query is generic
    const tierOrder = ["wooden", "stone", "golden", "iron", "diamond", "netherite", "leather"];
    partial.sort((a, b) => {
        const ta = tierOrder.findIndex(t => a.result.includes(t)), tb = tierOrder.findIndex(t => b.result.includes(t));
        return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
    });
    return partial;
}

/**
 * Can this inventory ({id: count}) cover a recipe `times` times? Returns the
 * concrete consumption plan {id: count} (tags resolved to real items) or null.
 */
export function planCraft(recipe, inv, times = 1) {
    const plan = {};
    const left = { ...inv };
    for (const [need, perCraft] of Object.entries(recipe.needs)) {
        let remaining = perCraft * times;
        if (need.startsWith("#")) {
            for (const id of Object.keys(left)) {
                if (remaining <= 0) break;
                if (!matchesTag(need, id) || left[id] <= 0) continue;
                const take = Math.min(left[id], remaining);
                left[id] -= take; remaining -= take; plan[id] = (plan[id] || 0) + take;
            }
        } else if ((left[need] || 0) >= remaining) {
            left[need] -= remaining; plan[need] = (plan[need] || 0) + remaining; remaining = 0;
        }
        if (remaining > 0) return null;
    }
    return plan;
}

/** Try to craft `amount` of `name` from inventory map. Returns {ok, recipe, times, consume, produce:{id,count}, reason}. */
export function craftPlan(name, amount, inv, hasTable = true) {
    const candidates = findRecipes(name);
    if (!candidates.length) return { ok: false, reason: `no recipe for '${name}'` };
    let bestFail = null;
    for (const recipe of candidates) {
        if (recipe.station !== "hand" && recipe.station !== "crafting_table" && recipe.station !== "smithing_table") continue;
        if (recipe.station === "crafting_table" && !hasTable) { bestFail = bestFail || { ok: false, reason: `need a crafting table nearby (or craft one) for ${short(recipe.result)}` }; continue; }
        const times = Math.max(1, Math.ceil((amount || 1) / recipe.count));
        // find the largest feasible multiple up to `times`
        for (let t = times; t >= 1; t--) {
            const plan = planCraft(recipe, inv, t);
            if (plan) return { ok: true, recipe, times: t, consume: plan, produce: { id: recipe.result, count: recipe.count * t } };
        }
        bestFail = bestFail || { ok: false, reason: `missing ingredients for ${short(recipe.result)}: needs ${Object.entries(recipe.needs).map(([k, v]) => `${v} ${short(k)}`).join(", ")}` };
    }
    return bestFail || { ok: false, reason: `cannot craft '${name}' here` };
}

export function smeltPlan(name, inv) {
    const q = String(name || "").toLowerCase().replace(/\s+/g, "_").replace(/^minecraft:/, "");
    let input = null, output = null;
    for (const [i, o] of Object.entries(SMELT)) {
        if (i.startsWith("#")) {
            const found = Object.keys(inv).find(id => matchesTag(i, id) && inv[id] > 0 && (id.includes(q) || o.includes(q)));
            if (found) { input = found; output = o; break; }
        } else if ((i.endsWith(":" + q) || i.includes(q) || o.endsWith(":" + q) || o.includes(q)) && (inv[i] || 0) > 0) { input = i; output = o; break; }
    }
    if (!input) return { ok: false, reason: `nothing to smelt for '${name}'` };
    let fuel = null;
    for (const f of Object.keys(FUELS)) {
        if (f.startsWith("#")) { fuel = Object.keys(inv).find(id => matchesTag(f, id) && inv[id] > 0) || null; }
        else if ((inv[f] || 0) > 0) fuel = f;
        if (fuel) break;
    }
    if (!fuel) return { ok: false, reason: "no fuel (coal, charcoal, planks or logs)" };
    const count = Math.min(inv[input], 8);
    return { ok: true, input, output, count, fuel, fuelCount: Math.max(1, Math.ceil(count / (FUELS[fuel] || FUELS["#planks"] || 1))) };
}

export function short(id) { return String(id).replace(/^minecraft:/, "").replace(/^#/, "any "); }
