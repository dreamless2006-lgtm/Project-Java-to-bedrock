import { system, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { botSay } from "./ai_conversations.js";
import { ActionFormData } from "@minecraft/server-ui";

const TRADE_COOLDOWN_MS = 60 * 1000;
const COOLDOWN_KEY = "rg:trade_cd_";

const BOT_GOODS = [
    { item: "minecraft:cobblestone", label: "cobble", count: 16 },
    { item: "minecraft:oak_log", label: "logs", count: 8 },
    { item: "minecraft:coal", label: "coal", count: 6 },
    { item: "minecraft:wheat", label: "wheat", count: 5 },
    { item: "minecraft:torch", label: "torches", count: 12 },
    { item: "minecraft:iron_ingot", label: "iron", count: 2 },
    { item: "minecraft:cooked_beef", label: "cooked beef", count: 3 },
    { item: "minecraft:diamond", label: "a diamond", count: 1 }
];

const BOT_WANTS = [
    { item: "minecraft:dirt", label: "dirt", count: 8 },
    { item: "minecraft:coal", label: "coal", count: 4 },
    { item: "minecraft:iron_ingot", label: "iron", count: 2 },
    { item: "minecraft:bread", label: "bread", count: 2 },
    { item: "minecraft:emerald", label: "emeralds", count: 2 },
    { item: "minecraft:diamond", label: "a diamond", count: 1 }
];

const SAY = {
    generous: "fair trade, {p}. I like you",
    fair: "deal. here you go",
    grumpy: "fine, whatever. here",
    insulted: "you're actually trying to stiff me, {p}?",
    cantPay: "you don't even have that, {p}",
    declined: "alright, keep your stuff",
    rivalDeclined: "your loss, not mine",
    haggleGood: "alright, for you - one more thing in it",
    haggleBad: "that's my final offer, take it or leave it"
};

function countInContainer(container, typeId) {
    let total = 0;
    for (let i = 0; i < container.size; i++) {
        const stack = container.getItem(i);
        if (stack && stack.typeId === typeId) total += stack.amount;
    }
    return total;
}

// Takes items out of a container, or clears the slot. Returns true if it paid in full.
function takeFromContainer(container, typeId, count) {
    let remaining = count;

    for (let i = 0; i < container.size && remaining > 0; i++) {
        const stack = container.getItem(i);
        if (!stack || stack.typeId !== typeId) continue;

        if (stack.amount > remaining) {
            container.setItem(i, new ItemStack(typeId, stack.amount - remaining));
            remaining = 0;
        } else {
            container.setItem(i, undefined);
            remaining -= stack.amount;
        }
    }
    return remaining === 0;
}

function containerOf(entity) {
    try {
        return entity.getComponent(EntityComponentTypes.Inventory)?.container || null;
    } catch (e) {
        return null;
    }
}

// Sympathy decides how generous the bot is: good friends get the good stock and
// a small price, bad ones get junk for a big price.
function buildDeal(sympathy, round) {
    const generosity = Math.max(0, Math.min(BOT_GOODS.length - 1, Math.round(sympathy / 20) + round));
    const greed = Math.max(0, Math.min(BOT_WANTS.length - 1, (BOT_WANTS.length - 1) - generosity));

    const offer = BOT_GOODS[Math.min(BOT_GOODS.length - 1, generosity)];
    const ask = BOT_WANTS[Math.min(BOT_WANTS.length - 1, greed)];
    return { offer, ask };
}

function showTradeForm(player, ai, deal, round) {
    if (!player?.isValid || !ai?.isValid) return;

    const aiName = ai.nameTag || "AI Player";
    const form = new ActionFormData();
    form.title(`§6Trade with ${aiName}`);
    form.body(
        `${aiName} offers:\n§a${deal.offer.count} ${deal.offer.label}\n\n` +
        `In exchange for:\n§e${deal.ask.count} ${deal.ask.label}\n\n` +
        `Your sympathy with them: ${Math.round(getSympathy(ai, player))}`
    );
    form.button("§aAccept");
    form.button("§6Haggle");
    form.button("§cDecline");

    form.show(player).then(response => {
        if (response.canceled) return;

        if (response.selection === 1) {
            // Haggling only helps if they already like you
            const sympathy = getSympathy(ai, player);
            // One concession only, otherwise haggling farms free diamonds
            const nextRound = sympathy > 25 ? Math.min(round + 1, 1) : round;
            if (sympathy > 25) botSay(ai, SAY.haggleGood.replace("{p}", player.nameTag));
            else botSay(ai, SAY.haggleBad.replace("{p}", player.nameTag));

            if (nextRound !== round) {
                ai.setDynamicProperty(COOLDOWN_KEY + player.id, 0);
                system.runTimeout(() => startTrade(player, ai, sympathy, nextRound), 10);
            } else {
                system.runTimeout(() => showTradeForm(player, ai, deal, round), 10);
            }
            return;
        }

        if (response.selection === 2) {
            botSay(ai, sympathyLine(ai, player, SAY.declined, SAY.rivalDeclined));
            setCooldown(ai, player);
            return;
        }

        completeTrade(player, ai, deal, sympathyLine(ai, player, SAY.generous, SAY.grumpy));
    }).catch(e => console.warn(e, e.stack));
}

function sympathyLine(ai, player, friendly, unfriendly) {
    return getSympathy(ai, player) >= 20 ? friendly : unfriendly;
}

function getSympathy(ai, player) {
    return ai.getDynamicProperty("sympathy_player_" + player.id) || 0;
}

function setCooldown(ai, player) {
    ai.setDynamicProperty(COOLDOWN_KEY + player.id, Date.now() + TRADE_COOLDOWN_MS);
}

function completeTrade(player, ai, deal, closingLine) {
    const playerContainer = containerOf(player);
    const botContainer = containerOf(ai);
    if (!playerContainer) return;

    if (countInContainer(playerContainer, deal.ask.item) < deal.ask.count) {
        botSay(ai, SAY.cantPay.replace("{p}", player.nameTag));
        setCooldown(ai, player);
        return;
    }

    takeFromContainer(playerContainer, deal.ask.item, deal.ask.count);

    // Pay out of the bot's own stock where it can, so trades are not free money
    let paid = false;
    if (botContainer && countInContainer(botContainer, deal.offer.item) >= deal.offer.count) {
        paid = takeFromContainer(botContainer, deal.offer.item, deal.offer.count);
    }
    if (!paid) {
        try {
            player.runCommand(`give @s ${deal.offer.item} ${deal.offer.count}`);
        } catch (e) { console.warn(e, e.stack); }
    }

    botSay(ai, closingLine);
    const key = "sympathy_player_" + player.id;
    ai.setDynamicProperty(key, Math.min(100, getSympathy(ai, player) + 2));
    setCooldown(ai, player);
}

export function tradeOnCooldown(ai, player) {
    if (!ai?.isValid || !player?.isValid) return false;
    return (ai.getDynamicProperty(COOLDOWN_KEY + player.id) || 0) > Date.now();
}

/**
 * Open a trade with a bot. Higher sympathy means a better item asked for less.
 */
export function startTrade(player, ai, sympathy = 0, round = 0) {
    if (!player?.isValid || !ai?.isValid) return;

    const deal = buildDeal(sympathy, round);
    showTradeForm(player, ai, deal, round);
}
