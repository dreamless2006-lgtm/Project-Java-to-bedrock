// The mission: beat the game. Pure. Reads the bot's inventory and a few flags
// it earns along the way and tells the model, every turn, how far it is and
// what the next step usually is. The model is free to go its own way.

export function createMission() {
    return { nether: false, end: false, strongholdAt: null, portalLit: false, dragon: false };
}

const has = (inv, id, n = 1) => (inv["minecraft:" + id] || inv[id] || 0) >= n;
const anyOf = (inv, ids, n = 1) => ids.some(id => has(inv, id, n));
const PICK_TIERS = ["stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const pickAtLeast = (inv, tier) => PICK_TIERS.slice(PICK_TIERS.indexOf(tier)).some(id => has(inv, id));

export const MILESTONES = [
    { key: "wood", label: "wood", test: (inv) => Object.keys(inv).some(id => /(_log|_planks|_wood)$/.test(id)), next: "punch some trees: gather oak_log, craft planks, sticks and a crafting_table" },
    { key: "stone_pick", label: "stone pickaxe", test: (inv) => pickAtLeast(inv, "stone_pickaxe"), next: "craft a wooden_pickaxe, gather cobblestone, craft a stone_pickaxe (and a stone_sword, torches, a furnace)" },
    { key: "iron", label: "iron", test: (inv) => anyOf(inv, ["iron_ingot", "iron_pickaxe", "iron_sword", "iron_chestplate", "diamond_pickaxe"]), next: "find iron (caves, mine_down), smelt raw_iron in a furnace, craft an iron_pickaxe, iron armour and a bucket" },
    { key: "iron_pick", label: "iron pickaxe", test: (inv) => pickAtLeast(inv, "iron_pickaxe"), next: "craft an iron_pickaxe (3 iron ingots + 2 sticks)" },
    { key: "diamonds", label: "diamonds", test: (inv) => anyOf(inv, ["diamond", "diamond_pickaxe", "diamond_sword"]), next: "mine_down to y -58 and gather diamond_ore (bring torches and food)" },
    { key: "diamond_pick", label: "diamond pickaxe", test: (inv) => pickAtLeast(inv, "diamond_pickaxe"), next: "craft a diamond_pickaxe (3 diamonds + 2 sticks); diamond armour and sword help too" },
    { key: "obsidian", label: "nether portal", test: (inv, f) => f.nether || has(inv, "obsidian", 10), next: "get 10 obsidian (mine with the diamond pickaxe where lava meets water, or pour water on lava) and craft flint_and_steel (iron_ingot + flint)" },
    { key: "nether", label: "been to the Nether", test: (inv, f) => f.nether || anyOf(inv, ["blaze_rod", "blaze_powder", "ender_eye"]), next: "travel to the nether (the portal is built from your obsidian)" },
    { key: "blaze", label: "blaze rods", test: (inv, f) => anyOf(inv, ["blaze_rod", "blaze_powder"]) || has(inv, "ender_eye") || f.portalLit, next: "in the Nether use locate fortress, go there and attack blazes for blaze_rods (6+); eat and keep armour on" },
    { key: "pearls", label: "ender pearls", test: (inv, f) => has(inv, "ender_pearl") || has(inv, "ender_eye") || f.portalLit, next: "attack endermen at night (or in a warped forest) for ender_pearls (12+)" },
    { key: "eyes", label: "12 eyes of ender", test: (inv, f) => has(inv, "ender_eye", 12) || f.portalLit, next: "craft blaze_powder from blaze_rods, then craft ender_eye (pearl + powder) until you have 12" },
    { key: "stronghold", label: "stronghold found", test: (inv, f) => !!f.strongholdAt || f.portalLit, next: "use locate stronghold, then travel there and dig down to the portal room" },
    { key: "portal", label: "end portal lit", test: (inv, f) => f.portalLit || f.end, next: "stand by the end portal frames and use_item ender_eye twelve times to fill them" },
    { key: "end", label: "the End", test: (inv, f) => f.end || f.dragon, next: "travel to the end: walk into the lit portal with armour, a bow if you have one, food and blocks" },
    { key: "dragon", label: "Ender Dragon slain", test: (inv, f) => !!f.dragon, next: "attack the ender_crystal towers first, then attack ender_dragon whenever it lands; keep eating" },
];

/** Returns { done: [labels], next: text|null, finished: bool } */
export function assessMission(inv = {}, flags = createMission()) {
    const done = [];
    let next = null;
    for (const m of MILESTONES) {
        if (m.test(inv, flags)) done.push(m.label);
        else if (!next) next = m.next;
    }
    return { done, next, finished: !!flags.dragon };
}

export function renderMission(inv, flags) {
    const a = assessMission(inv, flags);
    if (a.finished) return "Mission: you have beaten the game (the Ender Dragon is slain). Live as you please now.";
    const doneText = a.done.length ? a.done.join(", ") : "nothing yet";
    return `Mission: beat the game (reach the End and kill the Ender Dragon). Done: ${doneText}. Usual next step: ${a.next}. You may take any route you like.`;
}
