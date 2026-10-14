import { world, system, EntityComponentTypes } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { botSay } from "./ai_conversations.js";

// ============================================================================
// MOOD STATES
// ============================================================================
export const MOODS = {
    HAPPY: "happy",
    NEUTRAL: "neutral",
    ANGRY: "angry",
    SCARED: "scared",
    WOUNDED: "wounded"
};

const MOOD_PROPERTY = "rg:mood";
const MOOD_UPDATE_GAP = 100; // Every 5s
const TIME_SYNC_GAP = 200; // Every 10s

// Shared time-of-day cache
let _cachedTimeOfDay = 6000;

export function getCachedTimeOfDay() { return _cachedTimeOfDay; }

export function isNightTime() {
    return _cachedTimeOfDay >= 12000 && _cachedTimeOfDay < 24000;
}

export function getMood(ai) {
    if (!ai?.isValid) return MOODS.NEUTRAL;
    return ai.getDynamicProperty(MOOD_PROPERTY) || MOODS.NEUTRAL;
}

export function setMood(ai, mood) {
    if (!ai?.isValid) return;
    try { ai.setDynamicProperty(MOOD_PROPERTY, mood); } catch (e) { console.warn(e, e.stack); }
}

// ============================================================================
// CHAT LINES PER MOOD CHANGE
// ============================================================================
const WOUNDED_CHAT = [
    "Ow.. I'm hurt!", "Someone help me!", "I need to heal..",
    "This is bad..", "Need a potion!", "Getting low here!", "Yikes.."
];
const HAPPY_CHAT = [
    "What a great day!", "Feeling good!", "Life is great!",
    "Love this server :D", "Best day ever!", "So peaceful out here~"
];
const SCARED_CHAT = [
    "It's dark...", "I'm scared!", "Is someone there?",
    "Don't hurt me!", "I should hide..", "What was that noise?"
];
const ANGRY_CHAT = [
    "You'll pay for that!", "Get away!", "I'm furious!",
    "How dare you!", "That's it!", "You asked for this!"
];

// ============================================================================
// MOOD BEHAVIOR MODIFIERS
// ============================================================================
export function getMoodBonus(mood) {
    switch (mood) {
        case MOODS.ANGRY:   return { damage: 1.3, speed: 1.1, defense: 0.9 };  // More damage, less defense
        case MOODS.SCARED:  return { damage: 0.7, speed: 1.2, defense: 1.1 };  // Runs faster, weak attack
        case MOODS.WOUNDED: return { damage: 0.5, speed: 0.8, defense: 0.7 };  // Weakened
        case MOODS.HAPPY:   return { damage: 1.0, speed: 1.0, defense: 1.0, bonusHealing: true };  // May heal
        default:            return { damage: 1.0, speed: 1.0, defense: 1.0 };
    }
}

// ============================================================================
// MAIN LOOP
// ============================================================================
export function startMoodSystem() {

    // Sync in-game time of day every 10 seconds
    system.runInterval(() => {
        try {
            _cachedTimeOfDay = world.getTimeOfDay();
        } catch (e) {
            _cachedTimeOfDay = 14000;
        }
    }, TIME_SYNC_GAP);

    // Evaluate each bot's mood
    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;

        for (const ai of everyai) {
            if (!ai.isValid) continue;
            try {
                const healthComp = ai.getComponent(EntityComponentTypes.Health);
                if (!healthComp) continue;

                const hp = healthComp.currentValue;
                const maxHp = healthComp.effectiveMax || 20;
                const pct = hp / maxHp;

                const inCombat = !!ai.getDynamicProperty("rg:current_target");
                const sleeping = ai.hasTag("is_sleeping");
                const night = _cachedTimeOfDay >= 12000;

                const prev = getMood(ai);
                let next;

                if (pct <= 0.25) next = MOODS.WOUNDED;
                else if (inCombat) next = MOODS.ANGRY;
                else if (pct < 0.5) next = MOODS.SCARED;
                else if (night && !sleeping) next = MOODS.SCARED;
                else if (pct > 0.85 && !night) next = MOODS.HAPPY;
                else next = MOODS.NEUTRAL;

                if (next === prev) continue;
                setMood(ai, next);

                // Send chat message based on new mood
                let chatPool = null;
                if (next === MOODS.WOUNDED && Math.random() < 0.45) chatPool = WOUNDED_CHAT;
                else if (next === MOODS.HAPPY && Math.random() < 0.15) chatPool = HAPPY_CHAT;
                else if (next === MOODS.SCARED && Math.random() < 0.25) chatPool = SCARED_CHAT;
                else if (next === MOODS.ANGRY && Math.random() < 0.35) chatPool = ANGRY_CHAT;

                if (chatPool) {
                    const msg = chatPool[Math.floor(Math.random() * chatPool.length)];
                    const delay = 20 + Math.floor(Math.random() * 60);
                    system.runTimeout(() => {
                        if (ai.isValid && ai.nameTag) {
                            botSay(ai, msg, "§7");
                        }
                    }, delay);
                }

            } catch (e) {
                console.warn(`[Mood] Error for ${ai.id}: ${e}`);
            }
        }
    }, MOOD_UPDATE_GAP);
}