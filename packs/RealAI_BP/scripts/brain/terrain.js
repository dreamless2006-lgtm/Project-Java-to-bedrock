// What a block means to a walking body. Pure: one classifier shared by the walker's footing check
// and the pathfinder, so they never disagree about what is a wall.
//
// Kinds:
//   air       nothing there
//   passable  has a block but no collision worth the name: snow layers, grass, flowers, carpets,
//             torches, rails, signs, vines, ladders, plants. A body walks through and over these.
//   water     swimmable
//   lava      deadly
//   hazard    walkable but harmful or sticky (cactus, magma, fire, berry bushes, cobwebs, powder snow)
//   solid     a full block (or a slab or stair, which the body steps onto without a jump)
//   tall      solid and taller than a block (fences, walls, gates): cannot be stood on or jumped over

const PASSABLE = /^minecraft:(short_grass|tallgrass|fern|large_fern|double_plant|deadbush|dead_bush|snow_layer|torch|soul_torch|redstone_torch|unlit_redstone_torch|copper_torch|lever|.*_button|.*_pressure_plate|.*_sign|.*_wall_sign|.*_hanging_sign|.*_banner|wall_banner|standing_banner|rail|golden_rail|detector_rail|activator_rail|vine|.*_vines|weeping_vines|twisting_vines|cave_vines.*|glow_lichen|sculk_vein|hanging_roots|.*_roots|.*_sapling|.*_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|pitcher_plant|pitcher_crop|.*_mushroom|brown_mushroom|red_mushroom|crimson_fungus|warped_fungus|seagrass|kelp|.*_coral|.*_coral_fan|.*_coral_wall_fan|sea_pickle|.*_carpet|carpet|moss_carpet|pale_moss_carpet|pink_petals|leaf_litter|wildflowers|string|tripwire_hook|tripwire|redstone_wire|repeater|comparator|powered_repeater|unpowered_repeater|powered_comparator|unpowered_comparator|lily_pad|waterlily|wheat|carrots|potatoes|beetroot|beetroots|nether_wart|melon_stem|pumpkin_stem|attached_.*_stem|reeds|sugar_cane|bamboo_sapling|spore_blossom|small_dripleaf_block|frogspawn|turtle_egg|sniffer_egg|candle|.*_candle|light_block.*|structure_void|moving_block|ladder|scaffolding|flowering_azalea|azalea|big_dripleaf|bubble_column|end_rod|lightning_rod|chain|hanging_chain|iron_chain|.*_chain|skull|.*_head|.*_skull|flower_pot|decorated_pot_no|item_frame|glow_frame|bell_no|conduit_no)$/;
const AIR = /^minecraft:(air|cave_air|void_air)$/;
const WATER = /^minecraft:(water|flowing_water)$/;
const LAVA = /^minecraft:(lava|flowing_lava)$/;
const HAZARD = /^minecraft:(cactus|magma|fire|soul_fire|campfire|soul_campfire|sweet_berry_bush|wither_rose|powder_snow|pointed_dripstone|web|cobweb|bubble_column_down)$/;
const TALL = /^minecraft:(.*_fence|fence|.*_fence_gate|.*_wall|cobblestone_wall|.*_wall_block|nether_brick_fence|iron_bars|glass_pane|.*_glass_pane)$/;

/** @returns one of "air" | "passable" | "water" | "lava" | "hazard" | "solid" | "tall" (null for an unloaded block) */
export function kindOf(id) {
    if (!id) return null;
    if (AIR.test(id)) return "air";
    if (WATER.test(id)) return "water";
    if (LAVA.test(id)) return "lava";
    if (HAZARD.test(id)) return "hazard";
    if (PASSABLE.test(id)) return "passable";
    if (TALL.test(id)) return "tall";
    return "solid";
}

/** Can a body occupy this cell (move through it with its feet or head)? */
export function isOpen(kind, allowWater = false) { return kind === "air" || kind === "passable" || (allowWater && kind === "water"); }
/** Can a body stand on top of a block of this kind? */
export function isGround(kind, allowWater = false) { return kind === "solid" || (allowWater && kind === "water"); }

/**
 * Can feet stand in cell (x, y, z)? idAt(x, y, z) gives a block's type id, or null when it is not
 * loaded. Returns true / false, or null when something needed is unloaded.
 */
export function canStand(idAt, x, y, z, allowWater = false) {
    const at = kindOf(idAt(x, y, z)), head = kindOf(idAt(x, y + 1, z)), below = kindOf(idAt(x, y - 1, z));
    if (at === null || head === null || below === null) return null;
    if (!isOpen(at, allowWater) || !isOpen(head, allowWater) || !isGround(below, allowWater)) return false;
    return true;
}

/** Lava or something harmful in the cell or beside it (where a step could brush it). */
export function nearDanger(idAt, x, y, z) {
    for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]) {
        const k = kindOf(idAt(x + dx, y + dy, z + dz));
        if (k === "lava" || k === "hazard") return true;
    }
    return false;
}

/**
 * The feet height a body walking from (x, y, z) towards column (nx, nz) ends up at, within a step up
 * (one block, a jump) or a drop of up to maxDrop; null when there is no footing or the way is blocked.
 * Returns {y, jump} where jump says the climb needs a real jump (a full block, not a slab or carpet).
 */
export function footingAt(idAt, nx, ny, nz, { allowWater = false, maxDrop = 3 } = {}) {
    if (canStand(idAt, nx, ny, nz, allowWater) === true && !nearDanger(idAt, nx, ny, nz)) return { y: ny, jump: false };
    // one block up: needs room above the current cell's head too, which the caller checks
    if (canStand(idAt, nx, ny + 1, nz, allowWater) === true && !nearDanger(idAt, nx, ny + 1, nz)) return { y: ny + 1, jump: true };
    for (let d = 1; d <= maxDrop; d++) {
        if (!isOpen(kindOf(idAt(nx, ny - d + 1, nz)), allowWater)) break;
        if (canStand(idAt, nx, ny - d, nz, allowWater) === true && !nearDanger(idAt, nx, ny - d, nz)) return { y: ny - d, jump: false };
    }
    return null;
}
