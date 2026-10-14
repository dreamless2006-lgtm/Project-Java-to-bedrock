import { system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { botSay } from "./ai_conversations.js";
import { getSettings } from "./ai_settings.js";

const CHECK_GAP = 100;
const ASK_RANGE = 12;
const MIN_SYMPATHY = 15;
const QUEST_TICKS = 20 * 180;      // 3 minutes to deliver
const REMIND_AFTER = 20 * 90;
const ASK_COOLDOWN_MS = 5 * 60 * 1000;

const QUEST_KEY = "rg:quest_item";
const NEED_KEY = "rg:quest_need";
const HAVE_KEY = "rg:quest_have";
const OWNER_KEY = "rg:quest_owner";
const UNTIL_KEY = "rg:quest_until";
const REMINDER_KEY = "rg:quest_reminded";
const COOLDOWN_KEY = "rg:quest_cd_";

// What bots ask for, and what they hand back when you deliver
const WANTS = [
    { item: "minecraft:cooked_beef", label: "cooked beef", need: 2, reward: "minecraft:coal", rewardLabel: "some coal", rewardCount: 3 },
    { item: "minecraft:bread", label: "bread", need: 2, reward: "minecraft:wheat", rewardLabel: "wheat", rewardCount: 3 },
    { item: "minecraft:iron_ingot", label: "iron", need: 2, reward: "minecraft:cooked_chicken", rewardLabel: "cooked chicken", rewardCount: 2 },
    { item: "minecraft:oak_log", label: "logs", need: 6, reward: "minecraft:coal", rewardLabel: "coal", rewardCount: 2 },
    { item: "minecraft:torch", label: "torches", need: 8, reward: "minecraft:bread", rewardLabel: "bread", rewardCount: 1 },
    { item: "minecraft:coal", label: "coal", need: 4, reward: "minecraft:iron_ingot", rewardLabel: "iron", rewardCount: 1 },
    { item: "minecraft:diamond", label: "a diamond", need: 1, reward: "minecraft:enchanted_golden_apple", rewardLabel: "this", rewardCount: 1 }
];

function clearQuest(ai) {
    ai.setDynamicProperty(QUEST_KEY, null);
    ai.setDynamicProperty(NEED_KEY, null);
    ai.setDynamicProperty(HAVE_KEY, null);
    ai.setDynamicProperty(OWNER_KEY, null);
    ai.setDynamicProperty(UNTIL_KEY, null);
    ai.setDynamicProperty(REMINDER_KEY, null);
}

function distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

function bestCandidate(ai) {
    const players = REAL_PLAYERS_CACHE || [];
    let best = null;
    let bestSympathy = MIN_SYMPATHY;

    for (const player of players) {
        if (!player.isValid || player.dimension !== ai.dimension) continue;
        if (distance(ai.location, player.location) > ASK_RANGE) continue;

        const sympathy = ai.getDynamicProperty("sympathy_player_" + player.id) || 0;
        if (sympathy < bestSympathy) continue;

        const lastAsk = ai.getDynamicProperty(COOLDOWN_KEY + player.id) || 0;
        if (Date.now() - lastAsk < ASK_COOLDOWN_MS) continue;

        best = player;
        bestSympathy = sympathy;
    }
    return best;
}

/**
 * Called by the pickup system whenever a bot takes an item, so delivered quest
 * items are noticed there instead of re-scanning the world here.
 */
export function onItemReceived(ai, typeId, amount) {
    if (!ai?.isValid) return;

    const wanted = ai.getDynamicProperty(QUEST_KEY);
    if (!wanted || wanted !== typeId) return;

    const have = (ai.getDynamicProperty(HAVE_KEY) || 0) + amount;
    const need = ai.getDynamicProperty(NEED_KEY) || 1;
    ai.setDynamicProperty(HAVE_KEY, have);

    if (have < need) {
        botSay(ai, `got ${have} of the ${amount ? typeId.replace("minecraft:", "") : ""} you gave, ${need - have} to go`);
        return;
    }

    const owner = ai.getDynamicProperty(OWNER_KEY);
    const player = owner ? (REAL_PLAYERS_CACHE || []).find(p => p.isValid && p.id === owner) : null;
    const want = WANTS.find(entry => entry.item === wanted);

    if (player && want) {
        try {
            player.runCommand(`give @s ${want.reward} ${want.rewardCount}`);
        } catch (e) { console.warn(e, e.stack); }

        const sympathyKey = "sympathy_player_" + player.id;
        const sympathy = ai.getDynamicProperty(sympathyKey) || 0;
        try { ai.setDynamicProperty(sympathyKey, Math.min(100, sympathy + 6)); } catch (e) { console.warn(e, e.stack); }

        botSay(ai, `thanks for the ${want.label}, here's ${want.rewardLabel} back`);
    }

    clearQuest(ai);
}

export function startBotQuests() {
    system.runInterval(() => {
        if (!getSettings().quests) return;

        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;

        for (const ai of everyai) {
            if (!ai.isValid) continue;
            if (ai.hasTag("is_sleeping") || ai.getDynamicProperty("rg:current_target")) continue;
            if (ai.getDynamicProperty("rg:friend_task")) continue;   // busy working

            const active = ai.getDynamicProperty(QUEST_KEY);

            if (active) {
                const until = ai.getDynamicProperty(UNTIL_KEY) || 0;
                const startedAt = until - QUEST_TICKS;

                if (system.currentTick > until) {
                    clearQuest(ai);
                    continue;
                }

                if (!ai.getDynamicProperty(REMINDER_KEY) && system.currentTick - startedAt > REMIND_AFTER) {
                    ai.setDynamicProperty(REMINDER_KEY, true);
                    const want = WANTS.find(entry => entry.item === active);
                    const ownerName = findOwnerName(ai);
                    if (want && ownerName) botSay(ai, `still no spare ${want.label}, ${ownerName}?`);
                }
                continue;
            }

            const player = bestCandidate(ai);
            if (!player) continue;

            const want = WANTS[Math.floor(Math.random() * WANTS.length)];
            ai.setDynamicProperty(QUEST_KEY, want.item);
            ai.setDynamicProperty(NEED_KEY, want.need);
            ai.setDynamicProperty(HAVE_KEY, 0);
            ai.setDynamicProperty(OWNER_KEY, player.id);
            ai.setDynamicProperty(UNTIL_KEY, system.currentTick + QUEST_TICKS);
            ai.setDynamicProperty(COOLDOWN_KEY + player.id, Date.now());

            botSay(ai, `hey ${player.nameTag}, got ${want.need} ${want.label}? I'll give you ${want.rewardLabel} for it`);
        }
    }, CHECK_GAP);
}

function findOwnerName(ai) {
    const owner = ai.getDynamicProperty(OWNER_KEY);
    if (!owner) return null;
    const player = (REAL_PLAYERS_CACHE || []).find(p => p.isValid && p.id === owner);
    return player ? player.nameTag : null;
}
