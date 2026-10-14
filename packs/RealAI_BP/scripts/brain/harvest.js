// What breaking a block yields, which tool it needs and how long it takes. Pure.
// The body code (actuator.js) removes the block and hands the drops over, so a real
// player body (the bridge account) can mine and chop like an entity bot does, with
// survival rules kept: no pickaxe, no cobblestone; wrong tier, no diamonds.
import { isLog } from "./crafting.js";

const M = "minecraft:";
const strip = (id) => String(id || "").replace(/^minecraft:/, "");

export const TIER = { hand: 0, wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
const SPEED = { hand: 1, wooden: 2, golden: 12, stone: 4, iron: 6, diamond: 8, netherite: 9 };

const PICKAXE_BLOCK = /(stone$|^cobblestone|deepslate|_ore$|andesite|diorite|granite|tuff|calcite|netherrack|end_stone|blackstone|basalt|bricks|obsidian|ancient_debris|sandstone|terracotta|concrete$|quartz|^ice$|packed_ice|blue_ice|magma|furnace|smoker|dripstone|_block$|anvil|iron_bars|chain$|rail|glowstone|prismarine|purpur|slab$|stairs$|wall$)/;
const HAND_OK_BLOCK = /(_block$)/;   // ore/metal blocks still need a pickaxe; this only exempts soft "_block" ids below
const SOFT = /(hay_block|melon_block|honey_block|slime_block|mushroom_block|nether_wart_block|warped_wart_block|moss_block|sponge|bone_block|dried_kelp_block|target|note_block|snow_block|clay|mud)/;
const SHOVEL_BLOCK = /^(dirt|grass_block|coarse_dirt|podzol|mycelium|sand|red_sand|gravel|clay|snow|snow_layer|soul_sand|soul_soil|mud|rooted_dirt|farmland|grass_path|dirt_with_roots|concrete_powder.*)$/;
const AXE_BLOCK = /(_log$|_stem$|_wood$|_planks$|_leaves$|hyphae|crafting_table|chest$|barrel|bookshelf|ladder|fence|_door$|trapdoor|sign|bamboo|pumpkin|melon_block|jukebox|loom|composter|lectern|cartography|fletching|smithing_table|beehive|bee_nest|mushroom_block|campfire)/;
const UNBREAKABLE = /(bedrock|barrier|end_portal_frame|end_portal$|^portal$|end_gateway|command_block|structure_block|jigsaw|reinforced_deepslate|light_block|moving_block|invisible_bedrock|allow$|deny$|border_block)/;
const NO_DROP = /(_leaves$|^glass$|_glass$|glass_pane|^ice$|mob_spawner|trial_spawner|tallgrass|short_grass|^fern$|large_fern|double_plant|seagrass|kelp$|vine$|snow_layer|budding_amethyst|^fire$|soul_fire|frosted_ice|infested|monster_egg|sculk)/;

const HARDNESS = { stone: 1.5, cobblestone: 2, deepslate: 3, cobbled_deepslate: 3.5, dirt: 0.5, grass_block: 0.6, coarse_dirt: 0.5, podzol: 0.5, sand: 0.5, red_sand: 0.5, gravel: 0.6, clay: 0.6, snow: 0.2, snow_layer: 0.1, netherrack: 0.4, end_stone: 3, obsidian: 50, crying_obsidian: 50, ancient_debris: 30, glowstone: 0.3, sandstone: 0.8, red_sandstone: 0.8, andesite: 1.5, diorite: 1.5, granite: 1.5, tuff: 1.5, calcite: 0.75, basalt: 1.25, blackstone: 1.5, soul_sand: 0.5, soul_soil: 0.5, magma: 0.5, ice: 0.5, packed_ice: 0.5, quartz_ore: 3, nether_gold_ore: 3, bookshelf: 1.5, crafting_table: 2.5, chest: 2.5, furnace: 3.5, melon_block: 1, pumpkin: 1, hay_block: 0.5, moss_block: 0.1, mud: 0.5, mycelium: 0.6, dripstone_block: 1.5, pointed_dripstone: 1.5, amethyst_block: 1.5 };

/** Ore ids share drops whether they sit in stone or deepslate. */
function oreBase(id) { return strip(id).replace(/^deepslate_/, ""); }

export function isOreId(id) { return /_ore$/.test(String(id)) || /ancient_debris$/.test(String(id)); }

/** What the block hands over when broken without silk touch, as [{id, n}]. rand: 0..1 for the rare extras. */
export function dropsOf(blockId, rand = Math.random()) {
    const s = strip(blockId);
    if (UNBREAKABLE.test(s) || NO_DROP.test(s)) return s === "oak_leaves" && rand < 0.005 ? [{ id: M + "apple", n: 1 }] : [];
    const base = oreBase(s);
    switch (base) {
        case "stone": return [{ id: M + "cobblestone", n: 1 }];
        case "deepslate": return [{ id: M + "cobbled_deepslate", n: 1 }];
        case "grass_block": case "podzol": case "mycelium": case "dirt_with_roots": case "grass_path": case "farmland": return [{ id: M + "dirt", n: 1 }];
        case "coal_ore": return [{ id: M + "coal", n: 1 }];
        case "iron_ore": return [{ id: M + "raw_iron", n: 1 }];
        case "copper_ore": return [{ id: M + "raw_copper", n: 2 + Math.floor(rand * 4) }];
        case "gold_ore": return [{ id: M + "raw_gold", n: 1 }];
        case "nether_gold_ore": return [{ id: M + "gold_nugget", n: 2 + Math.floor(rand * 5) }];
        case "redstone_ore": case "lit_redstone_ore": return [{ id: M + "redstone", n: 4 + Math.floor(rand * 2) }];
        case "lapis_ore": return [{ id: M + "lapis_lazuli", n: 4 + Math.floor(rand * 6) }];
        case "diamond_ore": return [{ id: M + "diamond", n: 1 }];
        case "emerald_ore": return [{ id: M + "emerald", n: 1 }];
        case "quartz_ore": return [{ id: M + "quartz", n: 1 }];
        case "gravel": return [{ id: rand < 0.1 ? M + "flint" : M + "gravel", n: 1 }];
        case "clay": return [{ id: M + "clay_ball", n: 4 }];
        case "snow": return [{ id: M + "snowball", n: 4 }];
        case "glowstone": return [{ id: M + "glowstone_dust", n: 2 + Math.floor(rand * 3) }];
        case "melon_block": return [{ id: M + "melon_slice", n: 3 + Math.floor(rand * 5) }];
        case "bookshelf": return [{ id: M + "book", n: 3 }];
        case "lit_furnace": return [{ id: M + "furnace", n: 1 }];
        case "web": return [{ id: M + "string", n: 1 }];
        case "sea_lantern": return [{ id: M + "prismarine_crystals", n: 2 + Math.floor(rand * 2) }];
        case "campfire": return [{ id: M + "charcoal", n: 2 }];
        default: return [{ id: M + s, n: 1 }];
    }
}

/** Which tool class digs this block fastest (and, for pickaxe/shears blocks, is required). */
export function toolFor(blockId) {
    const s = strip(blockId);
    if (/_wool$|cobweb|^web$/.test(s)) return "shears";
    if (SOFT.test(s) && !/dried_kelp_block/.test(s)) return s === "clay" || s === "mud" || s === "snow_block" ? "shovel" : "hand";
    if (SHOVEL_BLOCK.test(s)) return "shovel";
    if (AXE_BLOCK.test(s)) return "axe";
    if (PICKAXE_BLOCK.test(s) && !HAND_OK_BLOCK.test(s)) return "pickaxe";
    if (/_block$/.test(s) && /(iron|gold|diamond|emerald|lapis|redstone|coal|copper|netherite|raw_|quartz|amethyst|dripstone|purpur|prismarine)/.test(s)) return "pickaxe";
    if (PICKAXE_BLOCK.test(s)) return "pickaxe";
    return "hand";
}

/** Minimum pickaxe tier that yields drops. 0 = none needed. */
export function requiredTier(blockId) {
    const s = oreBase(strip(blockId));
    if (toolFor(s) !== "pickaxe") return 0;
    if (/obsidian|ancient_debris|netherite_block|respawn_anchor/.test(s)) return TIER.diamond;
    if (/^(gold_ore|redstone_ore|lit_redstone_ore|diamond_ore|emerald_ore|gold_block|diamond_block|emerald_block|redstone_block|raw_gold_block)$/.test(s)) return TIER.iron;
    if (/^(iron_ore|lapis_ore|copper_ore|iron_block|lapis_block|copper_block|raw_iron_block|raw_copper_block)$/.test(s)) return TIER.stone;
    return TIER.wooden;
}

/** Best tool of a class in the inventory: {id, tier, speed} or null. inv is {id: count}. */
export function bestTool(inv, tool) {
    let best = null;
    for (const id of Object.keys(inv || {})) {
        const m = strip(id).match(/^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|sword|hoe)$/);
        if (!m || m[2] !== tool) { if (tool === "shears" && strip(id) === "shears") return { id, tier: 1, speed: 15 }; continue; }
        const tier = TIER[m[1]], speed = SPEED[m[1]];
        if (!best || speed > best.speed) best = { id, tier, speed };
    }
    return best;
}

/** Can this inventory harvest the block (get its drops)? {ok, reason, tool} */
export function harvestCheck(blockId, inv) {
    const s = strip(blockId);
    if (!s || s === "air") return { ok: false, reason: "nothing there" };
    if (UNBREAKABLE.test(s)) return { ok: false, reason: `${s.replace(/_/g, " ")} cannot be broken` };
    if (/^(water|flowing_water|lava|flowing_lava)$/.test(s)) return { ok: false, reason: "that is a liquid (use a bucket)" };
    const tool = toolFor(s);
    const have = bestTool(inv, tool);
    if (tool === "pickaxe") {
        if (!have) return { ok: false, reason: `${s.replace(/_/g, " ")} needs a pickaxe (craft a wooden_pickaxe: 3 planks + 2 sticks)` };
        const need = requiredTier(s);
        if (have.tier < need) {
            const name = Object.keys(TIER).find(k => TIER[k] === need) || "better";
            return { ok: false, reason: `${s.replace(/_/g, " ")} needs ${name === "iron" ? "an" : "a"} ${name} pickaxe or better` };
        }
    }
    return { ok: true, tool: have ? have.id : null };
}

/** Ticks it takes to break the block with what the inventory holds (vanilla formula, rounded up to 10-tick steps). */
export function breakTicks(blockId, inv) {
    const s = strip(blockId);
    const base = oreBase(s);
    let hard = HARDNESS[base] ?? HARDNESS[s];
    if (hard === undefined) hard = isOreId(s) ? 3 : isLog(M + s) ? 2 : /_planks$|_wood$/.test(s) ? 2 : /_wool$/.test(s) ? 0.8 : /_leaves$/.test(s) ? 0.2 : /_ore$/.test(s) ? 3 : 1.5;
    if (/^deepslate_/.test(s)) hard = Math.max(hard, 4.5);
    const tool = toolFor(s);
    const have = tool === "hand" ? null : bestTool(inv, tool);
    const speed = have ? have.speed : 1;
    const seconds = hard * (tool === "pickaxe" && !have ? 5 : 1.5) / speed;
    const ticks = Math.ceil(seconds * 20 / 10) * 10;
    return Math.max(10, Math.min(20 * 20, ticks));
}

const LOG_WORDS = /^(wood|woods|log|logs|tree|trees|timber|lumber)$/;
const ORE_WORDS = { coal: /coal_ore$/, iron: /iron_ore$/, copper: /copper_ore$/, gold: /gold_ore$/, diamond: /diamond_ore$/, redstone: /redstone_ore$/, lapis: /lapis_ore$/, emerald: /emerald_ore$/, quartz: /quartz_ore$/, netherite: /ancient_debris$/, ancient_debris: /ancient_debris$/, debris: /ancient_debris$/ };
export const FOOD_WORDS = /^(food|meat|beef|steak|pork|porkchop|chicken|mutton|cow|cows|pig|pigs|sheep|rabbit|animal|animals)$/;

/**
 * Turn the material the model asked for into a block test.
 * Returns {pred(typeId) -> bool, label} or {food: true} or {crop: "..."}.
 */
export function materialMatcher(material) {
    const m = String(material || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/^minecraft:/, "");
    if (!m) return { pred: () => false, label: "nothing" };
    return matchOnce(m) || (m.length > 3 && /s$/.test(m) ? matchOnce(m.replace(/s$/, "")) : null) || { pred: (id) => id === M + m || id.endsWith(":" + m) || (m.length > 3 && id.includes(m)), label: m.replace(/_/g, " ") };
}

function matchOnce(m) {
    const label = m.replace(/_/g, " ");
    if (FOOD_WORDS.test(m)) return { food: true, label };
    if (/berr/.test(m)) return { crop: "sweet_berry_bush", label };
    if (/^(wheat|carrot|carrots|potato|potatoes|beetroot|crops?)$/.test(m)) return { crop: m.replace(/s$/, ""), label };
    if (LOG_WORDS.test(m)) return { pred: (id) => isLog(id), label: "logs" };
    const wood = m.replace(/_logs?$|_wood$|_stem$/, "");
    if (/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|crimson|warped|bamboo)$/.test(wood)) return { pred: (id) => (id.endsWith(`:${wood}_log`) || id.endsWith(`:${wood}_stem`) || id.endsWith(`:${wood}_wood`) || id.endsWith(`:${wood}_hyphae`)) && !/stripped/.test(id), label: wood.replace(/_/g, " ") + " logs" };
    const oreKey = m.replace(/_ores?$/, "").replace(/^raw_/, "");
    if (ORE_WORDS[oreKey]) return { pred: (id) => ORE_WORDS[oreKey].test(id), label: /debris|netherite/.test(oreKey) ? "ancient debris" : oreKey.replace(/_/g, " ") + " ore" };
    if (/^(ore|ores|anything|minerals?|resources?)$/.test(m)) return { pred: (id) => isOreId(id), label: "ore" };
    if (/^(stone|cobblestone|cobble|rock|rocks)$/.test(m)) return { pred: (id) => /:(stone|cobblestone)$/.test(id), label: "stone" };
    if (/^(deepslate|cobbled_deepslate)$/.test(m)) return { pred: (id) => /:(deepslate|cobbled_deepslate)$/.test(id), label: "deepslate" };
    if (/^(dirt|soil|earth)$/.test(m)) return { pred: (id) => /:(dirt|grass_block|coarse_dirt|podzol|rooted_dirt)$/.test(id), label: "dirt" };
    if (m === "sand") return { pred: (id) => /:(sand|red_sand)$/.test(id), label: "sand" };
    if (m === "flint") return { pred: (id) => id.endsWith(":gravel"), label: "gravel (flint drops from it sometimes)" };
    if (m === "wool") return { pred: (id) => /_wool$/.test(id), label: "wool" };
    if (/^(leaf|leaves)$/.test(m)) return { pred: (id) => /_leaves$/.test(id), label: "leaves" };
    if (m === "snow" || m === "snowball") return { pred: (id) => /:(snow|snow_layer)$/.test(id), label: "snow" };
    if (m === "clay") return { pred: (id) => id.endsWith(":clay"), label: "clay" };
    return null;
}
