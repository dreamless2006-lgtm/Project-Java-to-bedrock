import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { ALL_AI_CACHE } from "./greeting.js";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { botSay } from "./ai_conversations.js";
import { acceptFriendship, refuseFriendship } from "./ai_interaction_ui.js";
import { getSettings } from "./ai_settings.js";

const SYMPATHY_BASE_KEY = "sympathy_player_";
const FRIEND_STATUS_BASE_KEY = "friend_status_";
const BOT_ASKED_KEY = "rg:bot_friend_ask_";

const PROPOSE_SYMPATHY = 45;    // how much a bot has to like you to ask first
const CHECK_GAP = 100;          // ticks between proposal sweeps
const ASK_RANGE = 10;           // blocks
const ANSWER_WINDOW = 60 * 20;  // ticks of chat time before the form reminder
const REASK_COOLDOWN_MS = 10 * 60 * 1000;

const ACCEPT_WORDS = ["yes", "yeah", "yep", "ya", "sure", "ok", "okay", "k", "y", "please", "definitely", "course", "ofc", "always"];
const REFUSE_WORDS = ["no", "nah", "nope", "later", "sorry", "never", "deny", "pass"];

const SAY = {
    ask: [
        "hey {p}, wanna be friends?",
        "{p} we should be friends, yeah?",
        "hey {p}, add me? I think we get along",
        "{p} you're alright, wanna be friends"
    ],
    accepted: [
        "yes! alright {p}",
        "knew you'd say yes {p}",
        "awesome, now I've got a friend on here",
        "finally, I was running out of people to talk to"
    ],
    refused: [
        "ah, alright. no worries {p}",
        "fair enough {p}",
        "ok ok, later then"
    ],
    missed: [
        "guess you didn't see my message {p}"
    ]
};

// botId|playerId -> { botId, playerId, expiresTick, reminded }
const offers = new Map();

function sayFor(list, playerName) {
    return list[Math.floor(Math.random() * list.length)].replace(/\{p\}/g, playerName || "you");
}

function tokens(message) {
    return String(message).toLowerCase().replace(/[^a-z]/g, " ").split(" ").filter(Boolean);
}

// world.getEntity is not reliable for player ids, so prefer the live cache
function findPlayer(playerId) {
    const cached = (REAL_PLAYERS_CACHE || []).find(p => p.isValid && p.id === playerId);
    if (cached) return cached;
    try {
        return world.getEntity(playerId) || null;
    } catch (e) {
        return null;
    }
}

function dropOffer(key, ai, player, silently) {
    offers.delete(key);
    if (!silently && ai?.isValid && player?.isValid) {
        try { ai.setDynamicProperty(FRIEND_STATUS_BASE_KEY + player.id, null); } catch (e) { /* already clear */ }
    }
}

function resolveOffer(key, accepted) {
    const offer = offers.get(key);
    if (!offer) return;

    const ai = world.getEntity(offer.botId);
    const player = findPlayer(offer.playerId);
    offers.delete(key);

    if (!ai?.isValid || !player?.isValid) return;

    const name = player.nameTag || "player";
    if (accepted) {
        acceptFriendship(ai, player);
        botSay(ai, sayFor(SAY.accepted, name));
        player.sendMessage(`§a§l[${ai.nameTag}] is now on your friends list.`);
    } else {
        refuseFriendship(ai, player);
        botSay(ai, sayFor(SAY.refused, name));
    }
}

function remindWithForm(key, offer) {
    const ai = world.getEntity(offer.botId);
    const player = findPlayer(offer.playerId);
    if (!ai?.isValid || !player?.isValid) {
        dropOffer(key, ai, player, true);
        return;
    }

    const form = new ActionFormData();
    form.title(`§a${ai.nameTag} wants to be friends`);
    form.body(`${ai.nameTag} asked you in chat to be friends.\n\nDo you want to add them?`);
    form.button("§aAccept");
    form.button("§cDecline");

    form.show(player).then(response => {
        if (response.canceled) {
            // Closed without choosing - do not nag, but let the bot know
            dropOffer(key, ai, player, false);
            if (ai.isValid && Math.random() < 0.5) botSay(ai, sayFor(SAY.missed, player.nameTag));
            return;
        }
        resolveOffer(key, response.selection === 0);
    }).catch(() => dropOffer(key, ai, player, true));
}

export function startBotFriendships() {
    // Answer in chat: "yes" / "no" to whichever bot asked
    world.afterEvents.chatSend.subscribe(event => {
        const player = event.sender;
        if (!player?.isValid) return;

        const words = tokens(event.message);
        const refuses = words.some(w => REFUSE_WORDS.includes(w));
        const accepts = words.some(w => ACCEPT_WORDS.includes(w));
        if (!refuses && !accepts) return;

        // Answer the most recent offer, leave the others open
        let chosenKey = null;
        let chosen = null;
        for (const [key, offer] of offers) {
            if (offer.playerId !== player.id) continue;
            if (!chosen || offer.expiresTick > chosen.expiresTick) {
                chosen = offer;
                chosenKey = key;
            }
        }
        if (chosenKey) resolveOffer(chosenKey, accepts && !refuses);
    });

    system.runInterval(() => {
        // Expire the chat window into a form reminder
        for (const [key, offer] of offers) {
            if (offer.reminded || system.currentTick < offer.expiresTick) continue;
            offer.reminded = true;
            remindWithForm(key, offer);
        }

        if (!getSettings().proposals) return;

        const players = REAL_PLAYERS_CACHE;
        if (!players || players.length === 0) return;

        for (const ai of ALL_AI_CACHE) {
            if (!ai.isValid) continue;
            if (ai.getDynamicProperty("rg:current_target")) continue;   // busy fighting
            if (ai.hasTag("is_sleeping") || ai.hasTag("building_shelter")) continue;

            for (const player of players) {
                if (!player.isValid || player.dimension !== ai.dimension) continue;

                const dx = player.location.x - ai.location.x;
                const dy = player.location.y - ai.location.y;
                const dz = player.location.z - ai.location.z;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) > ASK_RANGE) continue;

                const status = ai.getDynamicProperty(FRIEND_STATUS_BASE_KEY + player.id);
                if (status === "accepted" || status === "requested" || status === "bot_requested") continue;

                const sympathy = ai.getDynamicProperty(SYMPATHY_BASE_KEY + player.id) || 0;
                if (sympathy < PROPOSE_SYMPATHY) continue;

                const lastAsk = ai.getDynamicProperty(BOT_ASKED_KEY + player.id) || 0;
                if (Date.now() - lastAsk < REASK_COOLDOWN_MS) continue;

                ai.setDynamicProperty(BOT_ASKED_KEY + player.id, Date.now());
                ai.setDynamicProperty(FRIEND_STATUS_BASE_KEY + player.id, "bot_requested");

                const key = `${ai.id}|${player.id}`;
                offers.set(key, {
                    botId: ai.id,
                    playerId: player.id,
                    expiresTick: system.currentTick + ANSWER_WINDOW
                });

                botSay(ai, sayFor(SAY.ask, player.nameTag));
                break; // one offer per bot per sweep
            }
        }
    }, CHECK_GAP);
}
