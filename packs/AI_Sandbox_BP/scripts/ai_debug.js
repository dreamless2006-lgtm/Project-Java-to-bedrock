import { world, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { getAIGoal } from "./ai_goals.js";
import { getJobDebug } from "./ai_task_worker.js";
import { whoOwns } from "./ai_navigation.js";

const SEARCH_RANGE = 32;

const WATCHED_TAGS = [
    "on_eat", "is_busy_building", "is_busy_cooking", "is_upgrading", "is_sleeping",
    "building_shelter", "has_shelter", "suoding", "is_breaking_block", "is_moving_to_build",
    "is_in_combat", "is_mining", "is_building", "is_exploring", "prohibit_building",
    "is_greeting_sneaking", "is_greeting"
];

function num(v, digits = 2) {
    return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : String(v);
}

function hp(ai) {
    try {
        const health = ai.getComponent(EntityComponentTypes.Health);
        return health ? `${health.currentValue}/${health.effectiveMax}` : "?";
    } catch (e) {
        return "?";
    }
}

function air(ai) {
    try {
        const breathable = ai.getComponent(EntityComponentTypes.Breathable);
        return typeof breathable?.airSupply === "number" ? breathable.airSupply : 300;
    } catch (e) {
        return 300;
    }
}

function speedOf(ai) {
    try {
        const v = ai.getVelocity();
        return Math.sqrt(v.x * v.x + v.z * v.z);
    } catch (e) {
        return 0;
    }
}

function blockAt(dim, x, y, z) {
    try {
        return dim.getBlock({ x: x, y: y, z: z });
    } catch (e) {
        return undefined;
    }
}

// The block he is currently pushing into, at feet and head height
function blockedBy(ai) {
    let view = null;
    try {
        view = ai.getViewDirection();
    } catch (e) {
        return "no view direction";
    }
    if (!view) return "?";

    const flat = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
    const x = Math.floor(ai.location.x + (view.x / flat));
    const z = Math.floor(ai.location.z + (view.z / flat));
    const y = Math.floor(ai.location.y);

    const feet = blockAt(ai.dimension, x, y, z);
    const head = blockAt(ai.dimension, x, y + 1, z);
    const under = blockAt(ai.dimension, x, y - 1, z);

    const bits = [];
    if (feet && !feet.isAir) bits.push(`feet ${feet.typeId.replace("minecraft:", "")}`);
    if (head && !head.isAir) bits.push(`head ${head.typeId.replace("minecraft:", "")}`);
    if (under && under.isAir) bits.push("hole in front");
    return bits.length ? bits.join(", ") : "nothing";
}

function activeTags(ai) {
    return WATCHED_TAGS.filter(tag => {
        try {
            return ai.hasTag(tag);
        } catch (e) {
            return false;
        }
    });
}

function report(ai, sender) {
    const lines = [];
    const dist = Math.sqrt(
        Math.pow(ai.location.x - sender.location.x, 2) +
        Math.pow(ai.location.z - sender.location.z, 2));

    const job = getJobDebug(ai);

    lines.push(`§6§l${ai.nameTag} §7(${dist.toFixed(1)}m away)`);
    lines.push(`§7 goal §f${getAIGoal(ai)} §7| tags §f${activeTags(ai).join(" ") || "none"}`);
    lines.push(`§7 pos §f${num(ai.location.x, 1)} ${num(ai.location.y, 1)} ${num(ai.location.z, 1)}` +
        ` §7| hp §f${hp(ai)} §7| air §f${air(ai)}`);
    lines.push(`§7 ground §f${ai.isOnGround ? "yes" : "NO"} §7| water §f${ai.isInWater ? "yes" : "no"}` +
        ` §7| speed §f${num(speedOf(ai), 3)} b/t §7(sprint is 0.281, walk 0.216)`);
    lines.push(`§7 in front of him: §f${blockedBy(ai)}`);

    const driver = whoOwns(ai);
    lines.push(`§7 movement driven by §f${driver ? `${driver.source} (priority ${driver.priority})` : "nobody - engine pathing"}`);

    const danger = ai.getDynamicProperty("rg:isInDanger");
    const hostiles = ai.getDynamicProperty("rg:brain_hostiles");
    const target = ai.getDynamicProperty("rg:current_target");
    if (danger || target || (hostiles || 0) > 0) {
        lines.push(`§7 danger §f${danger ? "yes" : "no"} §7| hostiles §f${hostiles || 0} §7| fighting §f${target ? "yes" : "no"}`);
    }

    const shore = ai.getDynamicProperty("rg:water_shore");
    if (shore) lines.push(`§7 swimming to §f${String(shore).replace(/"/g, "")}`);

    if (job) {
        lines.push(`§7 job §a${job.kind} ${job.phase}` +
            (job.want ? ` for ${job.want}` : "") +
            ` §7| collected §f${job.count ?? 0}§7/§f${job.requested ?? job.amount ?? "?"}` +
            ` §7| logs broken §f${job.blocks ?? 0} §7| rock dug §f${job.dug ?? 0}`);
        if (job.target) {
            lines.push(`§7 target §f${(job.targetBlock || "?").replace("minecraft:", "")} at ${job.target}` +
                ` §7(${job.targetDist} away) §7| swings §f${job.hits} §7| approach §f${job.approaches}`);
            lines.push(`§7 tree §f${job.tree || "-"} §7| standing at §f${job.stand || "-"}` +
                ` §7| trees taken apart §f${job.treesTried} §7| veins skipped §f${job.oreTried}`);
        } else if (job.kind === "mine") {
            lines.push(`§7 dig floor §f${job.digTarget} §7| relocations §f${job.relocations}`);
        } else {
            lines.push(`§7 no target - searching for the next tree`);
        }
        lines.push(`§7 ${num((job.sinceBreakTicks || 0) / 20, 1)}s since last block broken §7| ${job.secondsLeft}s of the job left`);
    } else {
        lines.push(`§7 no job`);
    }

    return lines;
}

function pickBots(sender, arg) {
    const nearby = (ALL_AI_CACHE || []).filter(ai => {
        try {
            if (!ai.isValid) return false;
            if (ai.dimension !== sender.dimension) return false;
            const d = Math.sqrt(
                Math.pow(ai.location.x - sender.location.x, 2) +
                Math.pow(ai.location.z - sender.location.z, 2));
            return d <= SEARCH_RANGE;
        } catch (e) {
            return false;
        }
    });

    if (!nearby.length) return [];
    if (!arg || arg === "nearest") {
        const flat = p => Math.sqrt(
            Math.pow(p.location.x - sender.location.x, 2) +
            Math.pow(p.location.z - sender.location.z, 2));
        return [nearby.sort((a, b) => flat(a) - flat(b))[0]];
    }
    if (arg === "all") return nearby.slice(0, 5);

    const named = nearby.filter(ai => (ai.nameTag || "").toLowerCase().includes(arg.toLowerCase()));
    return named.slice(0, 5);
}

export function startAiDebug() {
    world.afterEvents.chatSend.subscribe(event => {
        const message = event.message.trim();
        if (!message.toLowerCase().startsWith("!aistatus")) return;

        event.cancel = true;
        const sender = event.sender;

        try {
            const arg = message.split(/\s+/)[1] || "";
            const bots = pickBots(sender, arg);

            if (!bots.length) {
                sender.sendMessage(`§cNo bot within ${SEARCH_RANGE} blocks${arg ? ` matching "${arg}"` : ""}.`);
                return;
            }

            for (const ai of bots) report(ai, sender).forEach(line => sender.sendMessage(line));
        } catch (e) {
            sender.sendMessage(`§cDebug failed: ${e}`);
            console.warn(e, e.stack);
        }
    });

    console.warn("[AI Debug] !aistatus [name|all|nearest] registered");
}
