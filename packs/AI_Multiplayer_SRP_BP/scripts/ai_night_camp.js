import { system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";
import { getCachedTimeOfDay } from "./ai_mood.js";
import { travelMode } from "./ai_player_physics.js";
import { requestMove, NAV } from "./ai_navigation.js";
import { hasJob } from "./ai_task_worker.js";

const CAMP_SOURCE = "camp";

const SCAN_GAP = 60;
const SLEEP_FROM = 18000;   // start winding down
const SLEEP_UNTIL = 23000;  // still in bed until here
const CAMP_KEY = "rg:camp";
const CAMP_RANGE = 24;      // bots would rather camp together than alone

const BEDTIME_LINES = [
    "I'm calling it a day, night all",
    "getting some sleep, yell if you need me",
    "too dark to do anything, I'm out",
    "someone keep watch, I'm lying down"
];

const WAKE_LINES = [
    "morning",
    "sun's up, back to it",
    "finally, that was a long night"
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function distance(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2));
}

// Dynamic properties only hold primitives, so a camp has to be stored as text.
// Reading the raw object back used to throw inside the interval, which stopped
// every bot's bedtime for the rest of the session.
function readCamp(ai) {
    try {
        const raw = ai.getDynamicProperty(CAMP_KEY);
        if (!raw) return null;
        return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
        return null;
    }
}

// Bots camp near each other, the way a group of players piles into one base
function campSpotFor(ai) {
    let closest = null;
    let closestDist = CAMP_RANGE;

    for (const other of ALL_AI_CACHE || []) {
        if (!other.isValid || other.id === ai.id) continue;
        if (other.dimension !== ai.dimension) continue;

        const d = distance(ai.location, other.location);
        const target = readCamp(other) || other.location;
        if (d < closestDist) {
            closestDist = d;
            closest = target;
        }
    }

    const spot = closest || ai.location;
    return {
        x: Math.floor(spot.x) + (Math.random() < 0.5 ? 0 : 1),
        y: Math.floor(spot.y),
        z: Math.floor(spot.z) + (Math.random() < 0.5 ? 0 : 1)
    };
}

function walkHome(ai, camp) {
    // Below a player-assigned job on purpose: bedtime never yanks a bot off a
    // tree he was asked to fell
    requestMove(ai, camp, { priority: NAV.FOLLOW, source: CAMP_SOURCE, mode: travelMode(ai, camp) });
}

export function startNightCamp() {
    system.runInterval(() => {
        const time = getCachedTimeOfDay();
        const night = time >= SLEEP_FROM && time < SLEEP_UNTIL;

        for (const ai of ALL_AI_CACHE || []) {
            if (!ai.isValid) continue;
            const sleeping = ai.hasTag("is_sleeping");

            if (!night) {
                // A bot left crouching from a crashed interval would stay frozen
                // in sneak speed forever
                if (!sleeping) {
                    try {
                        if (ai.isSneaking) ai.isSneaking = false;
                    } catch (e) { /* ignore */ }
                    continue;
                }
                try {
                    ai.removeTag("is_sleeping");
                    ai.setDynamicProperty(CAMP_KEY, null);
                    ai.isSneaking = false;
                } catch (e) { console.warn(e, e.stack); }
                if (Math.random() < 0.35) botSay(ai, pick(WAKE_LINES));
                continue;
            }

            if (ai.getDynamicProperty("rg:current_target") || ai.isInWater) continue;

            // A hired bot finishes the player's job before he goes to bed,
            // otherwise camp and work fight over him all night
            if (hasJob(ai)) continue;

            try {
                if (sleeping) {
                    ai.isSneaking = true;
                    continue;
                }

                let camp = readCamp(ai);
                if (!camp) {
                    camp = campSpotFor(ai);
                    ai.setDynamicProperty(CAMP_KEY, JSON.stringify(camp));
                    if (Math.random() < 0.45) botSay(ai, pick(BEDTIME_LINES));
                }

                if (distance(ai.location, camp) <= 1.6) {
                    ai.addTag("is_sleeping");
                    ai.isSneaking = true;
                } else {
                    walkHome(ai, camp);
                }
            } catch (e) {
                console.warn(`[NightCamp] ${ai.nameTag}: ${e}`);
            }
        }
    }, SCAN_GAP);
}
