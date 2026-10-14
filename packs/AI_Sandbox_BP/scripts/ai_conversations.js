import { world, system, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { isSameFaction, isHostileFaction } from "./ai_faction_system.js";
import { TOPIC_NOUNS, REPLIES, MOOD_FLAVOUR, OPENERS, SELF_TALK } from "./database/bot_banter.js";
import { chatAllows } from "./ai_settings.js";
import { brainActive, impulse } from "./brain/gate.js";

const ai_player_id = "rg:bot";
const BOT_CHAT_COOLDOWN_KEY = "rg:chat_cooldown";
const BOT_SPEAKING_TAG = "is_speaking";
const CONVERSATION_TTL = 300; // 15 seconds - how long a message stays worth answering
const BOT_CHAT_RADIUS = 48;   // How far bots can "hear"
const REPLY_CHANCE = 0.55;
const OPENER_CHANCE = 0.12;
const MOOD_FLAVOUR_CHANCE = 0.3;

const MOOD_PROPERTY = "rg:mood";
const GOAL_PROPERTY = "rg:current_goal";
const AFFINITY_PREFIX = "rg:affinity_";
const NEUTRAL_MOODS = ["neutral", undefined, null];

// Recent bot messages storage
const recentBotMessages = [];
const lastLineByBot = new Map();

// Topics that are interesting and generate more responses
const INTERESTING_TOPICS = {
    trouble: ["water", "drown", "swim", "stuck", "sink", "hole", "fell", "fall", "lava", "can't get", "cant get"],
    combat: ["kill", "fight", "attack", "damage", "hurt", "mob", "monster", "zombie", "creeper", "spider", "skeleton"],
    gathering: ["found", "mining", "dig", "resource", "diamond", "gold", "iron", "copper", "block", "collect", "torch"],
    building: ["build", "construct", "structure", "place", "create", "roof", "base", "wall"],
    exploration: ["explore", "discover", "cave", "dungeon", "ravine", "village", "walking", "lost"],
    social: ["hey", "bro", "dude", "mate", "friend", "thanks", "help", "awesome", "nice", "hi"],
    playful: ["lol", "haha", "funny", "joke", "cool", "epic", "no cap", "legit", "lmao", "gg"]
};

function detectTopic(message) {
    const lower = String(message || "").toLowerCase();
    for (const [topic, keywords] of Object.entries(INTERESTING_TOPICS)) {
        if (keywords.some(keyword => lower.includes(keyword))) return topic;
    }
    return null;
}

function pick(list, botId) {
    if (!list || list.length === 0) return null;
    let text = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && text === lastLineByBot.get(botId)) {
        text = list[Math.floor(Math.random() * list.length)];
    }
    lastLineByBot.set(botId, text);
    return text;
}

function fill(template, toName, noun) {
    return String(template)
        .replace(/\{to\}/g, toName || "you")
        .replace(/\{noun\}/g, noun || "that")
        .replace(/\s+/g, " ")
        .trim();
}

function getDistance(loc1, loc2) {
    return Math.sqrt(
        Math.pow(loc1.x - loc2.x, 2) +
        Math.pow(loc1.y - loc2.y, 2) +
        Math.pow(loc1.z - loc2.z, 2)
    );
}

function withSpeakingLock(ai, send, cooldownSeconds) {
    ai.addTag(BOT_SPEAKING_TAG);
    try {
        send();
    } finally {
        system.runTimeout(() => {
            if (ai.isValid) ai.removeTag(BOT_SPEAKING_TAG);
        }, 5);
    }
    ai.setDynamicProperty(BOT_CHAT_COOLDOWN_KEY, Date.now() + cooldownSeconds * 1000);
}

/**
 * Say something as this bot and file it into the conversation pool so other
 * bots can answer it. Every bot-facing chat line should go through here.
 */
export function botSay(ai, message, style = "", opts = {}) {
    if (!ai?.isValid || !message) return;
    // A brain-driven bot does not blurt canned lines: the line becomes an
    // impulse the model may voice in its own words.
    if (!opts.brain && brainActive(ai)) { impulse(ai, message); return; }
    if (!opts.brain && !chatAllows()) return;

    const name = ai.nameTag || "A player";
    try {
        world.sendMessage(`${style}<${name}> ${message}`);
    } catch (e) { console.warn(e, e.stack); }

    recordBotMessage(name, message, ai.location, {
        id: ai.id,
        mood: ai.getDynamicProperty(MOOD_PROPERTY),
        dimensionId: ai.dimension?.id
    });
}

// Store a bot message for other bots to respond to
export function recordBotMessage(aiName, message, location, extra = {}) {
    recentBotMessages.push({
        sender: aiName,
        senderId: extra.id || aiName,
        message: message,
        location: location,
        mood: extra.mood,
        dimensionId: extra.dimensionId || "overworld",
        timestamp: Date.now(),
        topic: detectTopic(message)
    });

    if (recentBotMessages.length > 20) recentBotMessages.shift();
}

function getRecentMessages() {
    const now = Date.now();
    return recentBotMessages.filter(msg =>
        now - msg.timestamp < CONVERSATION_TTL * 1000 &&
        msg.topic !== null
    );
}

function relationTo(ai, message) {
    if (!message) return "neutral";
    const affinity = ai.getDynamicProperty(AFFINITY_PREFIX + message.sender);
    const holdsGrudge = typeof affinity === "number" && affinity <= -3;

    // Look the speaker up by entity id, since bot names can repeat
    const speaker = ALL_AI_CACHE?.find(other => other.isValid && other.id === message.senderId);
    if (speaker) {
        if (isHostileFaction(ai, speaker)) return "rival";
        if (isSameFaction(ai, speaker) && !holdsGrudge) return "ally";
    }
    return holdsGrudge ? "rival" : "neutral";
}

function moodFlavour(ai) {
    const mood = ai.getDynamicProperty(MOOD_PROPERTY);
    const pool = MOOD_FLAVOUR[mood] ?? MOOD_FLAVOUR.neutral;
    if (NEUTRAL_MOODS.includes(mood)) return "";
    return pool[Math.floor(Math.random() * pool.length)] || "";
}

// Pick a topic a bot can talk about from what is actually happening to it
function openerFor(ai) {
    const mood = ai.getDynamicProperty(MOOD_PROPERTY);
    if (mood === "wounded") return OPENERS.wounded;
    if (mood === "scared") return OPENERS.scared;

    let isNight = false;
    try {
        const time = world.getTimeOfDay();
        isNight = time >= 13000 && time < 23000;
    } catch (e) { isNight = false; }
    if (isNight && Math.random() < 0.35) return OPENERS.night;

    const goal = ai.getDynamicProperty(GOAL_PROPERTY) || "idle";
    return OPENERS[goal] || OPENERS.idle;
}

function nearestCompanion(ai) {
    const nearby = (ALL_AI_CACHE || [])
        .filter(other => other.isValid && other.id !== ai.id && other.dimension === ai.dimension)
        .sort((a, b) => getDistance(ai.location, a.location) - getDistance(ai.location, b.location));
    return nearby[0] || null;
}

const THOUGHT_CD_KEY = "rg:thought_cd";
const THOUGHT_GAP_MS = 50 * 1000;
const FOOD_KEY = "rg:food_inventory";
const JOB_STASH_KEY = "rg:task_stash";

function isDarkOutside() {
    try {
        const time = world.getTimeOfDay();
        return time >= 13000 && time < 23000;
    } catch (e) {
        return false;
    }
}

function foodCount(ai) {
    try {
        const inv = JSON.parse(ai.getDynamicProperty(FOOD_KEY) || "{}");
        return Object.keys(inv).reduce((total, key) => total + (inv[key] || 0), 0);
    } catch (e) {
        return 0;
    }
}

function jobStash(ai) {
    try {
        const stash = JSON.parse(ai.getDynamicProperty(JOB_STASH_KEY) || "null");
        return stash && stash.count > 0 ? stash : null;
    } catch (e) {
        return null;
    }
}

// What a bot says when nobody is talking to him
function pickThought(ai) {
    try {
        const hostiles = ai.getDynamicProperty("rg:brain_hostiles") || 0;
        const inDanger = !!ai.getDynamicProperty("rg:isInDanger");
        const fighting = !!ai.getDynamicProperty("rg:current_target");
        const onJob = !!ai.getDynamicProperty("rg:friend_task");
        const stash = jobStash(ai);
        const food = foodCount(ai);

        let hpRatio = 1;
        try {
            const hp = ai.getComponent(EntityComponentTypes.Health);
            if (hp) hpRatio = hp.currentValue / (hp.effectiveMax || 20);
        } catch (e) { /* keep going */ }

        const weighted = [];
        if (inDanger || hostiles > 0) weighted.push("danger", "danger");
        if (fighting) weighted.push("hunting", "hunting");
        if (hpRatio < 0.4) weighted.push("hurt", "hurt");
        if (food === 0) weighted.push("hungry");
        if (isDarkOutside()) weighted.push("night");
        if (stash) weighted.push("found", "found");
        if (onJob) weighted.push("working");
        if (!fighting && hostiles === 0) weighted.push("bored", "mutter");
        if (weighted.length === 0) weighted.push("mutter");

        const key = weighted[Math.floor(Math.random() * weighted.length)];
        const pool = SELF_TALK[key] || SELF_TALK.mutter;
        let line = pool[Math.floor(Math.random() * pool.length)];

        if (stash) {
            const itemName = String(stash.item || "").replace("minecraft:", "").replace(/_/g, " ");
            line = line.replace(/\{n\}/g, stash.count).replace(/\{i\}/g, itemName);
        } else {
            line = line.replace(/\{n\}/g, "some").replace(/\{i\}/g, "loot");
        }
        return line;
    } catch (e) {
        return null;
    }
}

export function startBotConversations() {
    system.runInterval(() => {
        try {
            const everyai = ALL_AI_CACHE;
            if (!everyai || everyai.length === 0) return;

            const recentMessages = getRecentMessages();

            for (const ai of everyai) {
                if (!ai.isValid || ai.hasTag(BOT_SPEAKING_TAG)) continue;
                if (brainActive(ai)) continue;   // the LLM brain owns this bot

                // Skip if in combat
                if (ai.getDynamicProperty("rg:current_target")) continue;

                // Skip if busy
                if (ai.hasTag('on_eat') ||
                    ai.hasTag('is_busy_building') ||
                    ai.hasTag('is_busy_cooking') ||
                    ai.hasTag('is_upgrading') ||
                    ai.hasTag('is_sleeping')) {
                    continue;
                }

                const cooldownUntil = ai.getDynamicProperty(BOT_CHAT_COOLDOWN_KEY);
                if (cooldownUntil && Date.now() < cooldownUntil) continue;

                const aiLoc = ai.location;
                const nearbyMessages = recentMessages
                    .filter(msg =>
                        msg.senderId !== ai.id &&
                        msg.dimensionId === ai.dimension.id &&
                        getDistance(aiLoc, msg.location) <= BOT_CHAT_RADIUS)
                    .sort((a, b) => b.timestamp - a.timestamp);

                // Answer whoever spoke last
                if (nearbyMessages.length > 0 && Math.random() < REPLY_CHANCE) {
                    const target = nearbyMessages[Math.random() < 0.8 ? 0 : Math.floor(Math.random() * nearbyMessages.length)];
                    const relation = relationTo(ai, target);
                    const pool = REPLIES[target.topic]?.[relation] || REPLIES[target.topic]?.neutral;
                    const template = pick(pool, ai.id);
                    if (!template) continue;

                    const nouns = TOPIC_NOUNS[target.topic];
                    const noun = nouns?.[Math.floor(Math.random() * nouns.length)];
                    const line = fill(template, target.sender, noun) + (Math.random() < MOOD_FLAVOUR_CHANCE ? moodFlavour(ai) : "");

                    withSpeakingLock(ai, () => botSay(ai, line), 30 + Math.random() * 60);
                    continue;
                }

                // Otherwise start something from own situation
                if (Math.random() < OPENER_CHANCE) {
                    const pool = openerFor(ai);
                    const template = pick(pool, ai.id);
                    if (!template) continue;

                    const companion = nearestCompanion(ai);
                    const audienceName = companion?.nameTag || REAL_PLAYERS_CACHE?.find(p => p.isValid && p.dimension === ai.dimension && getDistance(aiLoc, p.location) < 16)?.nameTag;
                    const line = fill(template, audienceName || "anyone");

                    if (audienceName || companion) {
                        withSpeakingLock(ai, () => botSay(ai, line), 45 + Math.random() * 55);
                    }
                    continue;
                }

                // Nothing to say to bots - talk to a nearby player instead
                const players = REAL_PLAYERS_CACHE;
                if (players && players.length > 0 && Math.random() < 0.05) {
                    for (const player of players) {
                        if (!player.isValid || player.dimension !== ai.dimension) continue;
                        if (getDistance(aiLoc, player.location) > 10) continue;

                        const greetings = ["hey there", "whats up bro", "nice day today", "hows it going", "need any help?"];
                        const greeting = pick(greetings, ai.id);
                        withSpeakingLock(ai, () => botSay(ai, `${greeting} ${player.nameTag}`, "§7"), 30 + Math.random() * 60);
                        break;
                    }
                }
            }
        } catch (e) {
            // Silent fail
        }
    }, 20); // Check every second

    // Talking to himself: no audience needed, driven by what is happening to him
    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai) return;

        for (const ai of everyai) {
            if (!ai.isValid) continue;
            if (brainActive(ai)) continue;   // the LLM brain owns this bot
            if (ai.hasTag(BOT_SPEAKING_TAG) || ai.hasTag("is_sleeping") || ai.hasTag("building_shelter")) continue;
            if (ai.hasTag("on_eat") || ai.hasTag("is_busy_cooking") || ai.hasTag("is_upgrading")) continue;

            const now = Date.now();
            if (now - (ai.getDynamicProperty(THOUGHT_CD_KEY) || 0) < THOUGHT_GAP_MS) continue;
            if ((ai.getDynamicProperty(BOT_CHAT_COOLDOWN_KEY) || 0) > now) continue;
            if (Math.random() > 0.35) continue;

            const thought = pickThought(ai);
            if (!thought) continue;

            ai.setDynamicProperty(THOUGHT_CD_KEY, now);
            botSay(ai, thought, "§7");
        }
    }, 40);
}
