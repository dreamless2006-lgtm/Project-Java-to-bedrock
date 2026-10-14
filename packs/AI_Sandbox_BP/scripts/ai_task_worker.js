import { world, system, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";
import { jobLengthTicks } from "./ai_settings.js";
import { PLAYER, travelMode, jump } from "./ai_player_physics.js";
import { requestMove, releaseMove, NAV } from "./ai_navigation.js";

const JOB_SOURCE = "task";        // name this system uses with the navigation authority

const CHECK_GAP = 10;         // ticks between work steps
const WORK_REACH = 2.2;       // walk up to a block before hitting it
const VERTICAL_REACH = PLAYER.REACH_BLOCK;   // 5 blocks: Bedrock block reach, used up a trunk
const HANDOVER_RANGE = 2.5;
const DELIVER_TIMEOUT = 20 * 20;   // 20s trying to reach you, then drop it anyway
const TREE_LOOK_RADIUS = 24;  // how far he looks for a tree (detection, not reachability)
const CHOP_STALL_TICKS = 600; // 30s of swinging at a target he cannot actually break
const NAV_TICKS = 1800;       // 90s of pure walking toward a tree is not a failed job
const REPOSITION_TRIES = 5;   // sides of the trunk he works around before trying another tree
const COLLECT_RADIUS = 6;     // drops he can still reach after breaking a block
const ORE_RADIUS = 7;
const ORE_STALL_TICKS = 400;      // 20s on a vein he cannot reach: try another
const TRUNK_LIMIT = 7;        // don't chase a tree into the sky
const MAX_CARRY = 24;         // logs or ore before a bot calls it done
const DELIVERED_TAG = "rg:delivered";   // on item entities handed to a player
const WATER_BLOCKS = ["minecraft:water", "minecraft:flowing_water"];

// Staircase mining
const FIRST_PROSPECT_DEPTH = 8; // dig this far down before looking around for a vein
const DIG_FALLBACK = -56;     // never prospect below this
const DIG_DEEPER = 12;        // extra depth per dry prospect
const STONE_SWINGS = 2;       // faster descent, he is not admiring the cobble
const DIG_RELOCATE_MAX = 5;   // faces to try before admitting there is no shaft here

const TASK_KEY = "rg:friend_task";
const OWNER_KEY = "rg:task_owner";
const UNTIL_KEY = "rg:task_until";
const STASH_KEY = "rg:task_stash";
const WANT_KEY = "rg:task_want";        // material fragment, e.g. "iron" or "dark_oak"
const AMOUNT_KEY = "rg:task_amount";    // how many the player asked for
const SYMPATHY_BASE_KEY = "sympathy_player_";

// Working state lives in memory; only the task declaration is persisted.
const jobs = new Map();
const lastBreakByPlayer = new Map();

const SAY = {
    chopStart: [
        "alright, I'll get those logs for you",
        "one tree coming up",
        "guess I'm chopping today"
    ],
    mineStart: [
        "I'll dig what I can find",
        "let me see if there's more of that vein",
        "okay, my pick's out"
    ],
    noTree: [
        "can't see any trees from here, sorry",
        "no trees nearby, try somewhere with a forest"
    ],
    walkToTrees: [
        "no wood from where I'm standing, coming over to you",
        "can't see a tree, I'll walk your way and look again"
    ],
    switchTree: [
        "can't get at that one, taking this one instead",
        "that trunk's a lost cause, new tree",
        "wrong side of the tree, moving on"
    ],
    noOre: [
        "didn't find any ore around here",
        "nothing valuable near us, sorry"
    ],
    noPlace: [
        "nowhere solid to start a shaft here, moving along",
        "can't get a dig going on this edge, hold on"
    ],
    ownerGone: [
        "you weren't around, left the haul right here",
        "guess you went off - your stuff is on the ground here",
        "did the job anyway, dropping it here for you"
    ],
    handingOver: [
        "here, {n} {i} - all yours",
        "got {n} {i} for you",
        "there's {n} {i}, don't say I never do anything",
        "took a while but here's {n} {i}"
    ],
    tired: [
        "that's enough, my arms are done",
        "I'm stopping there, you're welcome"
    ]
};

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function isLog(id) {
    return !!id && (id.endsWith("_log") || id.endsWith("_stem") || id.endsWith("_wood"));
}

function isOre(id) {
    return !!id && (id.endsWith("_ore") || id === "minecraft:ancient_debris");
}

function digSound(id) {
    return isLog(id) ? "dig.wood" : "dig.stone";
}

function distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

function lookAt(ai, target) {
    try {
        const bx = target.x + 0.5 - ai.location.x;
        const by = target.y + 0.5 - (ai.location.y + 1.62);
        const bz = target.z + 0.5 - ai.location.z;
        const yaw = Math.atan2(-bx, bz) * (180 / Math.PI);
        const hDist = Math.sqrt(bx * bx + bz * bz);
        const pitch = -Math.atan2(by, hDist) * (180 / Math.PI);
        ai.setRotation({ x: pitch, y: yaw });
        return { dx: bx, dz: bz, hDist: hDist };
    } catch (e) {
        return null;
    }
}

const lastHopAt = new Map();
const HOP_COOLDOWN = 30;   // one hop every 1.5s, not a bounce every work step

// Movement is *requested* from the navigation authority, never applied here, so
// a working bot cannot be dragged between the tree and the player by two systems
// in the same tick.
function walkToward(ai, target, working, enterWater) {
    requestMove(ai, target, {
        priority: NAV.TASK,
        source: JOB_SOURCE,
        mode: travelMode(ai, target),
        enterWater: !!enterWater
    });

    // Step over whatever is genuinely in the way, like auto-jump does for a
    // player - but never at the block he is about to break, and never into water
    const aim = lookAt(ai, target);
    if (!aim || aim.hDist < 0.2) return;

    const ax = Math.floor(ai.location.x + (aim.dx / aim.hDist));
    const ay = Math.floor(ai.location.y);
    const az = Math.floor(ai.location.z + (aim.dz / aim.hDist));

    if (working && ax === working.x && ay === working.y && az === working.z) return;

    const ahead = blockAt(ai.dimension, ax, ay, az);
    if (!ahead || ahead.isAir || WATER_BLOCKS.includes(ahead.typeId)) return;

    const last = lastHopAt.get(ai.id) || 0;
    if (system.currentTick - last < HOP_COOLDOWN) return;
    lastHopAt.set(ai.id, system.currentTick);
    jump(ai);
}

// A player stands next to a block to hit it, and only reaches far when the
// block is above them - so a bot should not mine things across the room.
function withinReach(ai, target) {
    const feetY = Math.floor(ai.location.y);
    const d = distance(ai.location, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 });
    if (target.y <= feetY) return d <= WORK_REACH;
    return d <= VERTICAL_REACH;
}

function loadStash(ai) {
    const empty = { item: null, items: {}, count: 0, blocks: 0, dug: 0, depth: null, phase: "work", requested: null };
    try {
        const raw = ai.getDynamicProperty(STASH_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw);
        return {
            item: parsed.item || null,
            items: parsed.items || {},
            count: parsed.count || 0,
            blocks: parsed.blocks || 0,
            dug: parsed.dug || 0,
            depth: typeof parsed.depth === "number" ? parsed.depth : null,
            phase: parsed.phase || "work",
            requested: typeof parsed.requested === "number" ? parsed.requested : null
        };
    } catch (e) {
        return empty;
    }
}

function saveStash(ai, stash) {
    try {
        ai.setDynamicProperty(STASH_KEY, JSON.stringify(stash));
    } catch (e) { /* property limits are generous here */ }
}

// Collect the dropped items the bot just made, so nothing is duplicated later.
function collectDrops(ai, state, matches) {
    let dropped = [];
    try {
        dropped = ai.dimension.getEntities({
            location: ai.location,
            maxDistance: COLLECT_RADIUS,
            type: "minecraft:item"
        });
    } catch (e) {
        return;
    }

    state.stash.items = state.stash.items || {};

    for (const item of dropped) {
        try {
            const stack = item.getComponent(EntityComponentTypes.Item)?.itemStack;
            if (!stack || !matches(stack.typeId)) continue;

            // Every species he was told to bring counts. The stash used to lock
            // onto the first item type it saw and leave the rest on the floor,
            // which is exactly "asked for 24 logs, came back with 4".
            state.stash.items[stack.typeId] = (state.stash.items[stack.typeId] || 0) + stack.amount;
            state.stash.count += stack.amount;
            state.stash.item = stack.typeId;
            item.remove();
        } catch (e) { /* item may already be gone */ }
    }
}

// A trunk a bot can actually chop: rooted in natural ground, continuing upward,
// with somewhere dry to stand next to. Without these tests he picked stray logs -
// a branch over his head, a fallen tree in a river, a wall of somebody's build -
// and then stood pushing into it.
const TREE_GROUND = [
    "minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt", "minecraft:podzol",
    "minecraft:mycelium", "minecraft:moss_block", "minecraft:mud", "minecraft:clay",
    "minecraft:sand", "minecraft:red_sand", "minecraft:gravel", "minecraft:snow",
    "minecraft:snow_block", "minecraft:farmland", "minecraft:dirt_with_roots",
    "minecraft:crimson_nylium", "minecraft:warped_nylium", "minecraft:soul_sand",
    "minecraft:soul_soil", "minecraft:moss_carpet"
];
const LAVA_BLOCKS = ["minecraft:lava", "minecraft:flowing_lava"];

function isLeaves(typeId) {
    return !!typeId && typeId.endsWith("_leaves");
}

function columnKey(x, z) {
    return `${x},${z}`;
}

// The lowest log of a rooted trunk in this column, or -1. The scan starts well
// below his feet: standing on a bank above a forest, every tree down there used
// to be invisible and he walked off saying there were no trees.
function lowestTrunkLog(dim, x, feetY, z, wantKey) {
    for (let dy = -6; dy <= 8; dy++) {
        const y = feetY + dy;
        const block = blockAt(dim, x, y, z);
        if (!block || !logMatches(block.typeId, wantKey)) continue;

        // Rooted: natural ground (or water - trees do grow in swamps and ponds)
        // under the first log, so builds and floating branches are not trees.
        const below = blockAt(dim, x, y - 1, z);
        if (!below || (!TREE_GROUND.includes(below.typeId) && !WATER_BLOCKS.includes(below.typeId))) continue;

        // And the trunk goes on up, otherwise it is a stump
        const above = blockAt(dim, x, y + 1, z);
        if (!above || (!isLog(above.typeId) && !isLeaves(above.typeId))) continue;

        return y;
    }
    return -1;
}

// Leaves, plants, saplings and snow layers are not walls: a player chops
// straight through them to reach a trunk, so a square holding only clutter is
// still a way in - it just needs clearing first.
function isClearableClutter(typeId) {
    if (!typeId) return false;
    if (isLeaves(typeId)) return true;
    return /(_sapling|_wart|crimson_roots|warped_roots|hanging_roots|seagrass|kelp_plant|sugar_cane|vine|tall_grass|short_grass|large_fern|fern|dead_bush|snow_layer|dripleaf|short_dry_grass|tall_dry_grass|fire)$/.test(typeId);
}

function dryFloorAt(dim, x, y, z) {
    const floor = blockAt(dim, x, y - 1, z);
    if (!floor || floor.isAir) return false;
    return !WATER_BLOCKS.includes(floor.typeId) && !LAVA_BLOCKS.includes(floor.typeId);
}

// A square beside a block he can stand and swing from. Returns null only when
// every side is genuinely unusable. Reach covers a step up or down, so a ledge
// counts - without that, trees on slightly different ground looked like nothing.
// allowWading is for the tree standing in a pond: a player stands in the
// shallows to reach it, so a water floor becomes acceptable (never lava).
function approachFor(dim, x, y, z, allowWading) {
    const dirs = [
        { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
        { dx: 1, dz: 1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 1 }, { dx: -1, dz: -1 }
    ];
    const levels = [0, 1, -1];

    for (const dy of levels) {
        for (const d of dirs) {
            const sx = x + d.dx;
            const sy = y + dy;
            const sz = z + d.dz;
            const floor = blockAt(dim, sx, sy - 1, sz);
            if (!floor || floor.isAir) continue;
            if (LAVA_BLOCKS.includes(floor.typeId)) continue;
            const wetFloor = WATER_BLOCKS.includes(floor.typeId);
            if (wetFloor && !allowWading) continue;

            const body = blockAt(dim, sx, sy, sz);
            const head = blockAt(dim, sx, sy + 1, sz);
            if (!body || !head) continue;

            const flags = { x: sx, y: sy, z: sz, wading: wetFloor };

            if (body.isAir && head.isAir) return { ...flags, needsClear: false };
            if (body.isAir && isClearableClutter(head.typeId)) return { ...flags, needsClear: true };
            if (isClearableClutter(body.typeId) && head.isAir) return { ...flags, needsClear: true };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Tree search. DETECTION is deliberately separate from ACCESSIBILITY: a tree is
// a tree whether or not he can stand next to it right now, so an awkward trunk
// comes back as "tree, unreachable from here" instead of "no trees".
// ---------------------------------------------------------------------------
function treeCandidates(ai, wantKey, tried) {
    const dim = ai.dimension;
    const origin = ai.location;
    const cx = Math.floor(origin.x);
    const cz = Math.floor(origin.z);
    const feetY = Math.floor(origin.y);
    const found = [];
    const CAP = 12;

    // radius 0 is his own column: a bot standing under a canopy must still see
    // the trunk he is leaning against
    outer:
    for (let radius = 0; radius <= TREE_LOOK_RADIUS; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;

                const x = cx + dx;
                const z = cz + dz;
                if (tried && tried[columnKey(x, z)]) continue;

                const y = lowestTrunkLog(dim, x, feetY, z, wantKey);
                if (y < 0) continue;

                found.push({
                    x: x, y: y, z: z, baseY: y,
                    flat: Math.sqrt(Math.pow(x + 0.5 - origin.x, 2) + Math.pow(z + 0.5 - origin.z, 2))
                });
                if (found.length >= CAP) break outer;
            }
        }
    }

    found.sort((a, b) =>
        (a.flat + Math.abs(a.y - feetY) * 0.5) - (b.flat + Math.abs(b.y - feetY) * 0.5));
    return found;
}

function findTreeBase(ai, wantKey, tried) {
    const candidates = treeCandidates(ai, wantKey, tried);
    if (candidates.length === 0) return null;

    for (const c of candidates) {
        const spot = approachFor(ai.dimension, c.x, c.y, c.z, false);
        if (spot) {
            return { x: c.x, y: c.y, z: c.z, baseY: c.baseY, stand: spot, reachable: true, wading: false };
        }
    }

    // No dry way in. The trunk in the middle of a pond is still a tree: a player
    // stands in the shallows for it, so try that before calling it unreachable.
    for (const c of candidates) {
        const spot = approachFor(ai.dimension, c.x, c.y, c.z, true);
        if (spot) {
            return { x: c.x, y: c.y, z: c.z, baseY: c.baseY, stand: spot, reachable: true, wading: true };
        }
    }

    // Trees exist and none of them can be stood beside from here: hand back the
    // nearest so the bot walks up to it and looks again, rather than quitting.
    const first = candidates[0];
    return { x: first.x, y: first.y, z: first.z, baseY: first.baseY, stand: null, reachable: false, wading: false };
}

// Is that square still empty to stand in
function standCellFree(dim, s) {
    const air = blockAt(dim, s.x, s.y, s.z);
    const head = blockAt(dim, s.x, s.y + 1, s.z);
    return !!air && air.isAir && !!head && head.isAir;
}

// The next log still standing on the trunk he committed to
function trunkTargetAt(dim, tree, wantKey) {
    for (let dy = 0; dy <= TRUNK_LIMIT; dy++) {
        const y = tree.y + dy;
        const block = blockAt(dim, tree.x, y, tree.z);
        if (!block) return null;
        if (logMatches(block.typeId, wantKey)) {
            return { x: tree.x, y: y, z: tree.z, baseY: tree.y };
        }
    }
    return null;
}

// A face he could actually swing at. Ore completely buried in stone is not a
// target: he would stand next to it hitting nothing until the job ran out.
function exposed(dim, x, y, z) {
    const neighbours = [
        [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y + 1, z], [x, y - 1, z]
    ];
    return neighbours.some(n => {
        const b = blockAt(dim, n[0], n[1], n[2]);
        return !!b && b.isAir;
    });
}

function oreAt(dim, x, y, z) {
    const block = blockAt(dim, x, y, z);
    if (block && isOre(block.typeId) && exposed(dim, x, y, z)) {
        return { x: x, y: y, z: z, typeId: block.typeId };
    }
    return null;
}

function findOre(ai, wantKey, tried) {
    const dim = ai.dimension;
    let fallback = null;

    // Exact match wins; any other ore is only kept as a second choice
    const consider = (spot) => {
        if (!spot) return null;
        if (tried && tried[`${spot.x},${spot.y},${spot.z}`]) return null;
        if (wantKey && spot.typeId.includes(wantKey)) return spot;
        if (!wantKey) return spot;
        if (!fallback) fallback = spot;
        return null;
    };

    // Follow the vein the player was last mining, if it is still fresh
    const owner = ai.getDynamicProperty(OWNER_KEY);
    const hint = owner ? lastBreakByPlayer.get(owner) : null;
    if (hint && hint.dim === dim.id && system.currentTick - hint.tick < 1200) {
        const around = [
            oreAt(dim, hint.x, hint.y, hint.z),
            oreAt(dim, hint.x + 1, hint.y, hint.z), oreAt(dim, hint.x - 1, hint.y, hint.z),
            oreAt(dim, hint.x, hint.y, hint.z + 1), oreAt(dim, hint.x, hint.y, hint.z - 1),
            oreAt(dim, hint.x, hint.y - 1, hint.z), oreAt(dim, hint.x, hint.y + 1, hint.z)
        ].filter(Boolean);

        for (const spot of around) {
            const match = consider(spot);
            if (match) return match;
        }
    }

    const cx = Math.floor(ai.location.x);
    const cz = Math.floor(ai.location.z);
    const feetY = Math.floor(ai.location.y);

    for (let radius = 1; radius <= ORE_RADIUS; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
                // Only blocks a standing bot can actually reach and hit
                for (let dy = -1; dy <= 2; dy++) {
                    const match = consider(oreAt(dim, cx + dx, feetY + dy, cz + dz));
                    if (match) return match;
                }
            }
        }
    }
    return fallback;
}

// The command form supports resync, so each swing visibly restarts. The script
// form has no resync option, which is why repeated calls looked like nothing.
function playMineAnimation(ai) {
    try {
        ai.runCommand("playanimation @s mine 0 1");
        return;
    } catch (e) { /* fall through to the script form */ }

    try {
        ai.playAnimation("mine");
    } catch (e) { /* animation still missing */ }
}

// Ground a miner is allowed to take apart. An allow list, so a bot with a
// digging job never starts dismantling somebody's build to get to iron.
const DIGGABLE_GROUND = [
    "minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt", "minecraft:podzol",
    "minecraft:mycelium", "minecraft:moss_block", "minecraft:root_dirt", "minecraft:mud",
    "minecraft:muddy_mangrove_roots", "minecraft:clay", "minecraft:sand", "minecraft:red_sand",
    "minecraft:sandstone", "minecraft:red_sandstone", "minecraft:gravel",
    "minecraft:stone", "minecraft:cobblestone", "minecraft:andesite", "minecraft:diorite",
    "minecraft:granite", "minecraft:dripstone_block", "minecraft:tuff",
    "minecraft:deepslate", "minecraft:cobbled_deepslate", "minecraft:polished_deepslate",
    "minecraft:calcite", "minecraft:basalt", "minecraft:blackstone", "minecraft:gilded_blackstone",
    "minecraft:end_stone", "minecraft:glowstone", "minecraft:netherrack", "minecraft:soul_sand",
    "minecraft:soul_soil", "minecraft:ash", "minecraft:snow_block", "minecraft:ice",
    "minecraft:packed_ice", "minecraft:farmland"
];

// Anything solid that is worth digging through
function isDiggingTarget(typeId) {
    if (!typeId) return false;
    if (isOre(typeId)) return true;               // the whole point of digging
    return DIGGABLE_GROUND.includes(typeId);
}

function isValuable(typeId) {
    return isOre(typeId) || isLog(typeId);
}

// The player can name a specific material; "Any" leaves wantKey null.
function matchesWant(typeId, wantKey) {
    if (!typeId) return false;
    if (!isValuable(typeId)) return false;
    if (!wantKey) return true;
    return typeId.includes(wantKey);
}

// Ore blocks rarely drop themselves: iron, copper and gold drop raw metal, so
// banking has to match the item, not the block.
const ORE_ITEMS = {
    coal: ["minecraft:coal"],
    copper: ["minecraft:raw_copper", "minecraft:copper_ingot"],
    iron: ["minecraft:raw_iron", "minecraft:iron_ingot"],
    gold: ["minecraft:raw_gold", "minecraft:gold_ingot"],
    redstone: ["minecraft:redstone"],
    lapis: ["minecraft:lapis_lazuli"],
    diamond: ["minecraft:diamond"],
    emerald: ["minecraft:emerald"],
    quartz: ["minecraft:quartz"],
    ancient_debris: ["minecraft:ancient_debris"]
};

const ANY_ORE_ITEMS = Object.keys(ORE_ITEMS).reduce((all, key) => all.concat(ORE_ITEMS[key]), []);

// Matcher for picking drops up: accepts the ore item the request implies, the
// block form, and any log.
function bankable(typeId, wantKey) {
    if (!typeId) return false;

    if (isLog(typeId)) return !wantKey || typeId.includes(wantKey);

    const items = ORE_ITEMS[wantKey];
    if (items) {
        if (items.includes(typeId)) return true;
        return isOre(typeId) && typeId.includes(wantKey);
    }

    if (!wantKey) return isOre(typeId) || ANY_ORE_ITEMS.includes(typeId);

    return isValuable(typeId) && typeId.includes(wantKey);
}

function logMatches(typeId, wantKey) {
    if (!isLog(typeId)) return false;
    return !wantKey || wantKey === "log" || typeId.includes(wantKey);
}

function prettyName(typeId) {
    const base = String(typeId || "").replace("minecraft:", "").replace(/_ore$/, "").replace(/_/g, " ");
    return base;
}

function pickDigDirection(ai) {
    let yaw = 0;
    try {
        yaw = ai.getRotation().y;
    } catch (e) { yaw = 0; }

    const radians = yaw * Math.PI / 180;
    const x = -Math.sin(radians);
    const z = Math.cos(radians);

    // Snap to an axis so the staircase stays straight instead of wandering
    return Math.abs(x) >= Math.abs(z)
        ? { x: x >= 0 ? 1 : -1, z: 0 }
        : { x: 0, z: z >= 0 ? 1 : -1 };
}

// A 45 degree staircase: alternate one block forward with one block down,
// otherwise it just tunnels at a single level.
function nextDigTarget(ai, state) {
    const dim = ai.dimension;
    const fx = Math.floor(ai.location.x);
    const fy = Math.floor(ai.location.y);
    const fz = Math.floor(ai.location.z);

    if (!state.dir) state.dir = pickDigDirection(ai);
    const aheadX = fx + state.dir.x;
    const aheadZ = fz + state.dir.z;

    const forward = { x: aheadX, y: fy, z: aheadZ };
    const downward = { x: aheadX, y: fy - 1, z: aheadZ };
    // The block over his head as he steps in. A player clears it as he digs;
    // skipping it leaves a one-man-high tunnel he cannot walk into, which is
    // the "stuck in his own staircase" bug.
    const headroom = { x: aheadX, y: fy + 1, z: aheadZ };

    const floorBlock = blockAt(dim, forward.x, forward.y, forward.z);
    const wayIsOpen = !floorBlock || floorBlock.isAir;

    let order;
    if (wayIsOpen) {
        order = [headroom, downward];
    } else if (state.digToggle) {
        order = [downward, forward, headroom];
    } else {
        order = [forward, downward, headroom];
    }

    for (const spot of order) {
        const block = blockAt(dim, spot.x, spot.y, spot.z);
        if (block && isDiggingTarget(block.typeId)) return spot;
    }
    return null;
}

// Open gap ahead - step into it and drop, so the staircase keeps going. Only
// when it is the shaft's own one block drop: a bot does not throw himself off a
// cliff edge looking for iron.
function advanceStaircase(ai, state) {
    const dim = ai.dimension;
    const fx = Math.floor(ai.location.x);
    const fy = Math.floor(ai.location.y);
    const fz = Math.floor(ai.location.z);
    if (!state.dir) state.dir = pickDigDirection(ai);

    const aheadX = fx + state.dir.x;
    const aheadZ = fz + state.dir.z;

    const landing = blockAt(dim, aheadX, fy - 1, aheadZ);
    const floor = blockAt(dim, aheadX, fy - 2, aheadZ);
    const oneStepDown = (!landing || landing.isAir) && floor && !floor.isAir;
    if (!oneStepDown) return false;

    walkToward(ai, { x: aheadX, y: fy - 1, z: aheadZ });
    return true;
}

// A different cardinal face to try when the ground here gives nowhere to start
function randomDigDirection() {
    const dirs = [ { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 } ];
    return dirs[Math.floor(Math.random() * dirs.length)];
}

function publishProgress(ai, state) {
    saveStash(ai, {
        item: state.stash.item,
        items: state.stash.items || {},
        count: state.stash.count,
        requested: state.requested || state.amount || MAX_CARRY,
        blocks: state.blocksDone || 0,
        dug: state.dugRock || 0,
        depth: Math.floor(ai.location.y),
        phase: state.phase
    });
}

// One work step: walk in, swing, and break the block once it has taken enough hits.
function workBlock(ai, state, matches, swingsNeeded) {
    const target = state.target;
    const block = blockAt(ai.dimension, target.x, target.y, target.z);
    if (!block || !matches(block.typeId)) {
        state.target = null;
        return false;
    }

    if (!withinReach(ai, target)) {
        // Walk to a square beside the block, never into it
        const beside = approachFor(ai.dimension, target.x, target.y, target.z, state.wade) ||
            state.stand || target;
        walkToward(ai, { x: beside.x, y: Math.floor(ai.location.y), z: beside.z }, target, state.wade);
        return false;
    }

    // Standing where he needs to be: hold position and keep facing the block.
    // The hold stops the authority pushing him into what he is swinging at and
    // stops the engine turning his body away from it between swings.
    requestMove(ai, target, { priority: NAV.TASK, source: JOB_SOURCE, hold: true, ttl: 8 });

    lookAt(ai, target);
    state.hits = (state.hits || 0) + 1;

    playMineAnimation(ai);
    try {
        ai.runCommand(`playsound ${digSound(block.typeId)} @a ${target.x} ${target.y} ${target.z}`);
    } catch (e) { console.warn(e, e.stack); }

    if (state.hits < swingsNeeded) return false;

    state.hits = 0;
    state.lastBroken = block.typeId;
    try {
        ai.dimension.runCommand(`setblock ${target.x} ${target.y} ${target.z} minecraft:air destroy`);
    } catch (e) { console.warn(e, e.stack); }

    return true;
}

function advanceTarget(ai, state, kind) {
    const dim = ai.dimension;
    const t = state.target;
    state.target = null;

    if (kind === "chop" && t) {
        // Keep taking the trunk apart, bottom to top
        const above = blockAt(dim, t.x, t.y + 1, t.z);
        if (above && logMatches(above.typeId, state.want) && t.y + 1 - t.baseY < TRUNK_LIMIT) {
            state.target = { x: t.x, y: t.y + 1, z: t.z, baseY: t.baseY };
        }
    } else if (kind === "mine" && t) {
        // Dig along the same vein
        const vein = [
            oreAt(dim, t.x + 1, t.y, t.z), oreAt(dim, t.x - 1, t.y, t.z),
            oreAt(dim, t.x, t.y, t.z + 1), oreAt(dim, t.x, t.y, t.z - 1),
            oreAt(dim, t.x, t.y - 1, t.z), oreAt(dim, t.x, t.y + 1, t.z)
        ].filter(Boolean).find(n => matchesWant(n.typeId, state.want));
        if (vein) state.target = vein;
    }
}

function findPlayer(playerId) {
    try {
        // world.getEntity is not reliable for player ids
        const found = world.getAllPlayers().find(p => p.id === playerId);
        if (found) return found;
        return world.getEntity(playerId) || null;
    } catch (e) {
        return null;
    }
}

// Everything he banked, by item type: a mixed forest gives oak and birch and
// both belong to the player who asked for logs.
function pilesOf(stash) {
    const piles = [];
    if (stash.items) {
        for (const typeId of Object.keys(stash.items)) {
            if (stash.items[typeId] > 0) piles.push([typeId, stash.items[typeId]]);
        }
    }
    if (piles.length === 0 && stash.item && stash.count > 0) piles.push([stash.item, stash.count]);
    return piles;
}

function dropItems(ai, at, stash) {
    let dropped = 0;

    for (const pile of pilesOf(stash)) {
        let left = pile[1];
        while (left > 0) {
            const batch = Math.min(64, left);
            left -= batch;
            try {
                const item = ai.dimension.spawnItem(new ItemStack(pile[0], batch), { x: at.x, y: at.y + 0.6, z: at.z });
                // Marked so no bot - including the one who just carried it, whose job
                // ends the same tick - picks the player's haul back up again
                try { item.addTag(DELIVERED_TAG); } catch (e) { /* item entities may refuse tags */ }
                dropped += batch;
            } catch (e) { break; }
        }
    }
    return dropped;
}

function emptyStash(stash) {
    stash.count = 0;
    stash.items = {};
}

function announceHaul(ai, stash, closing) {
    const itemName = prettyName(stash.item);
    botSay(ai, closing.replace(/\{n\}/g, stash.count)
        .replace(/\{i\}/g, itemName + (stash.count > 1 && !itemName.endsWith("s") ? "s" : "")));
}

function handOver(ai, state) {
    const owner = state.ownerId ? findPlayer(state.ownerId) : null;

    // A job the bot gave itself (LLM brain): keep the haul in its own bag.
    if (!state.ownerId) {
        if (state.stash.count > 0) {
            let container = null;
            try { container = ai.getComponent("minecraft:inventory")?.container || null; } catch (e) { container = null; }
            for (const pile of pilesOf(state.stash)) {
                let left = pile[1];
                while (left > 0) {
                    const batch = Math.min(64, left);
                    left -= batch;
                    let rest;
                    try { rest = container ? container.addItem(new ItemStack(pile[0], batch)) : new ItemStack(pile[0], batch); } catch (e) { rest = null; }
                    if (rest) { try { ai.dimension.spawnItem(rest, ai.location); } catch (e) { /* ignore */ } }
                }
            }
            botSay(ai, `got ${state.stash.count} ${prettyName(state.stash.item)}`);
            emptyStash(state.stash);
        }
        return true;
    }

    if (!owner || !owner.isValid || owner.dimension !== ai.dimension) {
        // He logged off or is unloaded. The haul only exists as a count, so
        // putting it on the ground is the difference between a delivery and
        // twelve oak logs vanishing into nowhere.
        if (state.stash.count > 0) {
            const dropped = dropItems(ai, ai.location, state.stash);
            if (dropped > 0) {
                botSay(ai, pick(SAY.ownerGone));
                emptyStash(state.stash);
            }
        }
        return true;
    }

    if (distance(ai.location, owner.location) > HANDOVER_RANGE) {
        if (!state.deliverSince) state.deliverSince = system.currentTick;

        // Cannot reach you: drop it where he stands instead of holding it forever
        if (system.currentTick - state.deliverSince > DELIVER_TIMEOUT) {
            const dropped = dropItems(ai, ai.location, state.stash);
            if (dropped > 0) {
                botSay(ai, `left your ${prettyName(state.stash.item)} here, ${owner.nameTag} - come and get them`);
                emptyStash(state.stash);
            }
            return true;
        }

        walkToward(ai, owner.location);
        return false;
    }

    const stash = state.stash;
    if (stash.count > 0) {
        dropItems(ai, owner.location, stash);
        announceHaul(ai, stash, pick(SAY.handingOver));

        const sympathyKey = SYMPATHY_BASE_KEY + owner.id;
        const sympathy = ai.getDynamicProperty(sympathyKey) || 0;
        try { ai.setDynamicProperty(sympathyKey, Math.min(100, sympathy + 4)); } catch (e) { console.warn(e, e.stack); }

        emptyStash(stash);   // never pay out twice
    }
    return true;
}

function endJob(ai, state) {
    jobs.delete(ai.id);
    releaseMove(ai, JOB_SOURCE);
    ai.setDynamicProperty(TASK_KEY, null);
    ai.setDynamicProperty(OWNER_KEY, null);
    ai.setDynamicProperty(UNTIL_KEY, null);
    ai.setDynamicProperty(STASH_KEY, null);
    ai.setDynamicProperty(WANT_KEY, null);
    ai.setDynamicProperty(AMOUNT_KEY, null);

    // Hand the vanilla follow/wander behaviours back. While he worked they were
    // switched off, otherwise the engine pathed him toward the nearest player at
    // the same time the job pathed him toward the next tree.
    try { ai.triggerEvent("rg:job_off"); } catch (e) { /* entity gone */ }

    if (state.stash.count === 0 && !state.announced) {
        if (state.kind === "mine" && (state.dugRock || 0) > 0) {
            botSay(ai, pick(SAY.noOre));
        } else if ((state.blocksDone || 0) + (state.dugRock || 0) > 0) {
            botSay(ai, pick(SAY.tired));
        }
    }
}

/**
 * Give a bot a job for a player. kind is "chop" (fells trees) or "mine"
 * (staircase down, then prospect for ore at depth).
 */
export function assignFriendTask(ai, player, kind, options = {}) {
    if (!ai?.isValid) return false;
    if (player && !player.isValid) return false;
    if (ai.getDynamicProperty(TASK_KEY)) return false;

    const want = options.want || null;
    const amount = options.amount || MAX_CARRY;
    const until = system.currentTick + (options.durationTicks || jobLengthTicks());

    ai.setDynamicProperty(TASK_KEY, kind);
    ai.setDynamicProperty(OWNER_KEY, player ? player.id : null);
    ai.setDynamicProperty(UNTIL_KEY, until);
    ai.setDynamicProperty(WANT_KEY, want);
    ai.setDynamicProperty(AMOUNT_KEY, amount);
    ai.setDynamicProperty(STASH_KEY, JSON.stringify({ item: null, items: {}, count: 0, requested: amount, blocks: 0, dug: 0, depth: Math.floor(ai.location.y) }));

    // While he works only this system and the emergency ones may steer him:
    // engine follow/wander goals are switched off and restored in endJob
    try { ai.triggerEvent("rg:job_on"); } catch (e) { console.warn(e, e.stack); }

    jobs.set(ai.id, {
        kind: kind,
        ownerId: player ? player.id : null,
        until: until,
        want: want,
        amount: amount,
        requested: amount,          // the authoritative target for this job
        target: null,
        tree: null,                 // the trunk he committed to
        stand: null,                // clear square beside that trunk
        tried: {},                  // tree columns he already took apart
        treesTried: 0,
        triedOre: {},               // veins he could not reach
        approaches: 0,
        atTargetSince: 0,
        treeSince: 0,
        hits: 0,
        blocksDone: 0,
        dugRock: 0,
        dir: kind === "mine" ? pickDigDirection(ai) : null,
        digTarget: Math.floor(ai.location.y) - FIRST_PROSPECT_DEPTH,
        stash: { item: null, items: {}, count: 0 },
        lastBreakTick: system.currentTick,
        phase: "work"
    });

    botSay(ai, pick(kind === "chop" ? SAY.chopStart : SAY.mineStart));
    return true;
}

/**
 * What the friend menu shows: the job, time left, what was asked for, and how
 * much is banked so far.
 */
export function getFriendTask(ai) {
    if (!ai?.isValid) return null;
    const kind = ai.getDynamicProperty(TASK_KEY);
    if (!kind) return null;

    const stash = loadStash(ai);
    return {
        kind: kind,
        remainingTicks: Math.max(0, (ai.getDynamicProperty(UNTIL_KEY) || 0) - system.currentTick),
        want: ai.getDynamicProperty(WANT_KEY) || null,
        amount: ai.getDynamicProperty(AMOUNT_KEY) || MAX_CARRY,
        requested: stash.requested || ai.getDynamicProperty(AMOUNT_KEY) || MAX_CARRY,
        item: stash.item,
        itemName: stash.item ? prettyName(stash.item) : null,
        count: stash.count,
        blocks: stash.blocks,
        dug: stash.dug,
        depth: stash.depth,
        phase: stash.phase
    };
}

function clearTree(state) {
    state.tree = null;
    state.stand = null;
    state.target = null;
    state.approaches = 0;
    state.atTargetSince = 0;
    state.treeSince = 0;
}

// Walk a different side of the trunk each attempt, the way a player circles a
// tree that will not come down from one angle.
function repositionSpot(dim, tree, attempt) {
    const dirs = [
        { dx: 1, dz: 0 }, { dx: 1, dz: 1 }, { dx: 0, dz: 1 }, { dx: -1, dz: 1 },
        { dx: -1, dz: 0 }, { dx: -1, dz: -1 }, { dx: 0, dz: -1 }, { dx: 1, dz: -1 }
    ];
    for (let i = 0; i < dirs.length; i++) {
        const d = dirs[(attempt + i) % dirs.length];
        for (const dy of [0, 1, -1]) {
            const spot = { x: tree.x + d.dx, y: tree.y + dy, z: tree.z + d.dz };
            if (standCellFree(dim, spot) && dryFloorAt(dim, spot.x, spot.y, spot.z)) return spot;
        }
    }
    return approachFor(dim, tree.x, tree.y, tree.z, true);
}

// No tree anywhere in sight. A player does not quit: he walks to where the
// wood is likely to be and looks again, so this never ends the job.
function relocate(ai, state) {
    const owner = state.ownerId ? findPlayer(state.ownerId) : null;
    const toOwner = owner && owner.isValid && owner.dimension === ai.dimension &&
        distance(ai.location, owner.location) > 4 && distance(ai.location, owner.location) < 48;

    if (toOwner) {
        if (!state.saidSearching || system.currentTick - state.saidSearching > 800) {
            state.saidSearching = system.currentTick;
            botSay(ai, pick(SAY.walkToTrees));
        }
        walkToward(ai, owner.location);
        return;
    }

    if (!state.searchDir) state.searchDir = randomDigDirection();
    if (!state.searchUntil || system.currentTick > state.searchUntil) {
        state.searchDir = randomDigDirection();
        state.searchUntil = system.currentTick + 120;   // a new heading every 6 seconds
    }
    const here = ai.location;
    walkToward(ai, {
        x: Math.floor(here.x) + state.searchDir.x * 8,
        y: Math.floor(here.y),
        z: Math.floor(here.z) + state.searchDir.z * 8
    });
}

function runChop(ai, state) {
    const tried = state.tried || (state.tried = {});
    const requested = state.requested || state.amount || MAX_CARRY;
    const collected = state.stash.count;
    const feetY = Math.floor(ai.location.y);

    // ---------------------------------------------------------------------
    // The only thing that finishes this job is the number of logs actually
    // banked. Running out of a tree, a target going out of reach or a delivery
    // timer must never be mistaken for "done".
    // ---------------------------------------------------------------------
    if (collected >= requested) {
        state.phase = "deliver";
        return;
    }

    if (!state.tree) {
        const found = findTreeBase(ai, state.want, tried);
        if (!found) {
            relocate(ai, state);
            return;
        }
        state.tree = { x: found.x, y: found.baseY, z: found.z };
        state.stand = found.stand;
        state.wade = !!found.wading;       // this trunk is only reachable from the water
        state.target = null;
        state.approaches = 0;
        state.treeSince = system.currentTick;
        state.atTargetSince = 0;

        // A valid tree he cannot stand beside yet: go and lean against it, the
        // next scan looks for the way in from there
        if (!found.reachable) {
            walkToward(ai, { x: found.x, y: feetY, z: found.z }, null, true);
            return;
        }
    }

    // The next log still on the trunk he committed to
    const next = trunkTargetAt(ai.dimension, state.tree, state.want);
    if (!next) {
        // Nothing left of this trunk: finished it, not failed it
        tried[columnKey(state.tree.x, state.tree.z)] = true;
        clearTree(state);
        return;
    }

    if (!withinReach(ai, next)) {
        // The log is too high or he is on the wrong side. Reposition and try
        // again; only after a full circle of the trunk is the tree set aside -
        // and it is not blacklisted, because another approach may work later.
        state.approaches = (state.approaches || 0) + 1;

        if (state.approaches > REPOSITION_TRIES) {
            clearTree(state);
            return;
        }

        if (next.y > feetY + 1 && state.stand) {
            // stand under it and hop for the high logs, once per approach
            walkToward(ai, { x: state.tree.x, y: feetY, z: state.tree.z }, null, state.wade);
            jump(ai);
            return;
        }
        state.stand = repositionSpot(ai.dimension, state.tree, state.approaches) || state.stand;
        walkToward(ai, state.stand || { x: next.x, y: feetY, z: next.z }, null, state.wade);
        return;
    }

    // He is in reach and swinging. This is the only place a chopping stall can
    // start: walking around the tree never counts against him.
    state.target = next;
    if (!state.atTargetSince) state.atTargetSince = system.currentTick;

    const wantedLog = (typeId) => logMatches(typeId, state.want);
    const broke = workBlock(ai, state, wantedLog, 3);
    collectDrops(ai, state, (typeId) => bankable(typeId, state.want));
    publishProgress(ai, state);

    if (broke) {
        state.blocksDone++;
        state.atTargetSince = system.currentTick;   // real progress, clock restarts
        state.approaches = 0;
        advanceTarget(ai, state, "chop");
        return;
    }

    // 30s of swinging at the same trunk with nothing banked: wrong tree for him
    if (system.currentTick - state.atTargetSince > CHOP_STALL_TICKS) {
        tried[columnKey(state.tree.x, state.tree.z)] = true;
        clearTree(state);
        botSay(ai, pick(SAY.switchTree));
        return;
    }

    // 90s spent on this tree without ever banking a log either: move on, keep
    // the tree available for later, and carry on looking
    if (state.treeSince && system.currentTick - state.treeSince > NAV_TICKS) clearTree(state);
}

/**
 * Staircase mining: dig down at 45 degrees, and every time it reaches a level,
 * look around for ore worth bringing back before going deeper.
 */
function runMining(ai, state) {
    const feetY = Math.floor(ai.location.y);
    const triedOre = state.triedOre || (state.triedOre = {});

    if (state.phase === "hunt" || feetY <= state.digTarget) {
        state.phase = "hunt";
        if (!state.target) state.target = findOre(ai, state.want, triedOre);

        if (state.target) {
            // A vein he cannot get at is not worth standing next to forever:
            // cross it off and prospect for another one
            if (system.currentTick - (state.lastBreakTick || 0) > ORE_STALL_TICKS) {
                const t = state.target;
                triedOre[`${t.x},${t.y},${t.z}`] = true;
                state.target = null;
                state.lastBreakTick = system.currentTick;
                botSay(ai, pick(SAY.switchTree));
                return;
            }

            const wantedOre = (typeId) => matchesWant(typeId, state.want);
            const broke = workBlock(ai, state, wantedOre, 4);
            collectDrops(ai, state, (typeId) => bankable(typeId, state.want));
            publishProgress(ai, state);

            if (broke) {
                state.blocksDone++;
                state.lastBreakTick = system.currentTick;
                advanceTarget(ai, state, "mine");
                if (state.stash.count >= (state.amount || MAX_CARRY)) state.phase = "deliver";
            }
            return;
        }

        // Nothing worth digging for here
        if (feetY <= DIG_FALLBACK) {
            botSay(ai, pick(SAY.noOre));
            state.announced = true;
            state.phase = "deliver";
            return;
        }
        state.phase = "work";
        state.digTarget = Math.min(state.digTarget, feetY) - DIG_DEEPER;
        state.target = null;
    }

    // Digging: nothing broken for 45 seconds means stop rather than stand here forever
    if (system.currentTick - (state.lastBreakTick || 0) > 900) {
        state.phase = "deliver";
        return;
    }

    if (!state.target) state.target = nextDigTarget(ai, state);

    if (!state.target) {
        // Follow the shaft if it is open in front of him, otherwise walk along
        // and try a different face - a player looks for a way in
        if (advanceStaircase(ai, state)) return;

        state.relocations = (state.relocations || 0) + 1;
        if (state.relocations > DIG_RELOCATE_MAX) {
            botSay(ai, pick(SAY.noPlace));
            state.phase = "deliver";
            return;
        }

        state.dir = randomDigDirection();
        const here = ai.location;
        walkToward(ai, {
            x: Math.floor(here.x) + state.dir.x * 3,
            y: Math.floor(here.y),
            z: Math.floor(here.z) + state.dir.z * 3
        });
        state.target = null;
        return;
    }

    const broke = workBlock(ai, state, isDiggingTarget, STONE_SWINGS);
    collectDrops(ai, state, (typeId) => bankable(typeId, state.want)); // ore crossed on the way down is kept
    publishProgress(ai, state);

    if (broke) {
        state.lastBreakTick = system.currentTick;
        state.digToggle = !state.digToggle;   // alternate forward / down steps
        state.relocations = 0;
        if (isOre(state.lastBroken)) state.blocksDone++;
        else state.dugRock++;
        state.target = null;
    }
}

/**
 * Is this bot working for someone right now? Everything else that could grab
 * his attention - houses, goals, rescues - has to wait until he is done.
 */
export function hasJob(ai) {
    try {
        return !!ai?.isValid && !!ai.getDynamicProperty(TASK_KEY);
    } catch (e) {
        return false;
    }
}

/**
 * What !aistatus prints: the whole internal state of a running job, so a stuck
 * bot can be read instead of guessed at.
 */
export function getJobDebug(ai) {
    if (!hasJob(ai)) return null;

    const state = jobs.get(ai.id);
    if (!state) {
        return { kind: ai.getDynamicProperty(TASK_KEY), phase: "not started yet" };
    }

    const t = state.target;
    return {
        kind: state.kind,
        phase: state.phase,
        want: state.want,
        amount: state.amount,
        requested: state.requested || state.amount,
        approaches: state.approaches || 0,
        onTreeFor: state.treeSince ? system.currentTick - state.treeSince : 0,
        count: state.stash ? state.stash.count : 0,
        blocks: state.blocksDone || 0,
        dug: state.dugRock || 0,
        hits: state.hits || 0,
        target: t ? `${t.x},${t.y},${t.z}` : null,
        targetBlock: t ? (blockAt(ai.dimension, t.x, t.y, t.z) || {}).typeId : null,
        targetDist: t ? distance(ai.location, { x: t.x + 0.5, y: t.y, z: t.z + 0.5 }).toFixed(1) : null,
        tree: state.tree ? `${state.tree.x},${state.tree.y},${state.tree.z}` : null,
        stand: state.stand ? `${state.stand.x},${state.stand.y},${state.stand.z}` : null,
        treesTried: Object.keys(state.tried || {}).length,
        oreTried: Object.keys(state.triedOre || {}).length,
        relocations: state.relocations || 0,
        digTarget: state.digTarget,
        sinceBreakTicks: system.currentTick - (state.lastBreakTick || 0),
        secondsLeft: Math.max(0, (((ai.getDynamicProperty(UNTIL_KEY) || 0) - system.currentTick) / 20)).toFixed(0)
    };
}

export function startFriendTasks() {
    try {
        world.afterEvents.playerBreakBlock.subscribe(event => {
            try {
                const block = event.block;
                lastBreakByPlayer.set(event.player.id, {
                    x: block.x, y: block.y, z: block.z,
                    dim: block.dimension.id,
                    typeId: event.brokenBlockPermutation?.type?.id || null,
                    tick: system.currentTick
                });
            } catch (e) { /* nothing worth logging */ }
        });
    } catch (e) { console.warn(e, e.stack); }

    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;

        for (const ai of everyai) {
            if (!ai.isValid) continue;

            const kind = ai.getDynamicProperty(TASK_KEY);
            if (!kind) {
                if (jobs.has(ai.id)) jobs.delete(ai.id);
                continue;
            }

            // A bot in a fight or asleep finishes later - but his time still runs
            // out. Without this the job never expires while he is interrupted,
            // rg:friend_task stays set, and every new hire attempt is refused.
            const expired = system.currentTick > (ai.getDynamicProperty(UNTIL_KEY) || 0);
            if (!expired && (ai.getDynamicProperty("rg:current_target") || ai.hasTag("is_sleeping"))) {
                const paused = jobs.get(ai.id);
                if (paused) {
                    paused.lastBreakTick = system.currentTick;  // stall clock restarts on resume
                    paused.target = null;
                }
                continue;
            }

            // One bot throwing in here would kill this interval for every bot in
            // the world, so each one is handled on its own
            try {
                let state = jobs.get(ai.id);
                if (!state) {
                    const banked = loadStash(ai);
                    state = {
                        kind: kind,
                        ownerId: ai.getDynamicProperty(OWNER_KEY),
                        until: ai.getDynamicProperty(UNTIL_KEY) || 0,
                        want: ai.getDynamicProperty(WANT_KEY) || null,
                        amount: ai.getDynamicProperty(AMOUNT_KEY) || MAX_CARRY,
                        requested: banked.requested || ai.getDynamicProperty(AMOUNT_KEY) || MAX_CARRY,
                        target: null,
                        tree: null,
                        stand: null,
                        tried: {},
                        treesTried: 0,
                        triedOre: {},
                        approaches: 0,
                        atTargetSince: 0,
                        treeSince: 0,
                        hits: 0,
                        blocksDone: banked.blocks,
                        dugRock: banked.dug,
                        dir: kind === "mine" ? pickDigDirection(ai) : null,
                        digTarget: Math.floor(ai.location.y) - FIRST_PROSPECT_DEPTH,
                        stash: { item: banked.item, items: banked.items, count: banked.count },
                        lastBreakTick: system.currentTick,
                        phase: banked.phase === "deliver" ? "work" : banked.phase
                    };
                    jobs.set(ai.id, state);
                    try { ai.triggerEvent("rg:job_on"); } catch (e) { /* entity gone */ }
                }

                if (expired) state.phase = "deliver";

                if (state.phase === "deliver") {
                    if (handOver(ai, state)) endJob(ai, state);
                    continue;
                }

                if (kind === "chop") runChop(ai, state);
                else runMining(ai, state);
            } catch (e) {
                console.warn(`[FriendTasks] job step failed for ${ai.nameTag}: ${e}`);
                jobs.delete(ai.id);
                try { ai.setDynamicProperty(TASK_KEY, null); } catch (e2) { /* entity gone */ }
            }
        }
    }, CHECK_GAP);
}
