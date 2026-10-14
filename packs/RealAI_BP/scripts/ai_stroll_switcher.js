import { world, system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { brainActive } from "./brain/gate.js";
const ai_player_id = "rg:bot";
const EVENT_NAME_TO_TRIGGER = "stroll_switch";

const MIN_GAP_SECONDS = 3;
const MAX_GAP_SECONDS = 9;
const POPULATION_Checkgaptime = 100;


const trackedAis = new Set();


function scheduleNextStrollSwitch(ai) {

    if (!ai.isValid) {
        trackedAis.delete(ai.id);
        return;
    }

    // [Extreme Optimization] Use | 0 instead of Math.floor
    const randomDelayTicks = ((MIN_GAP_SECONDS + Math.random() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS)) * 20) | 0;

    system.runTimeout(() => {

        if (!ai.isValid) {
            trackedAis.delete(ai.id);
            return;
        }

        ai.triggerEvent(EVENT_NAME_TO_TRIGGER);

        scheduleNextStrollSwitch(ai);

    }, randomDelayTicks);
}



export function startStrollSwitcherBehavior() {

    system.runInterval(() => {

        // -----------------------------------------------------------
        // [Core Optimization] Use global cache ALL_AI_CACHE instead of expensive dimension query loop
        // -----------------------------------------------------------
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) {
            return; // Cache is empty, exit early
        }

        for (const ai of everyai) {
            // [Micro-optimization] Ensure AI is valid, avoid Map overflow and unnecessary processing
            if (!ai.isValid) {
                trackedAis.delete(ai.id);
                continue;
            }
            if (brainActive(ai)) {   // no engine strolling for a brain-driven bot
                trackedAis.delete(ai.id);
                continue;
            }

            // Check if AI is already in tracking list, if it's new AI start scheduling
            if (!trackedAis.has(ai.id)) {
                trackedAis.add(ai.id);
                scheduleNextStrollSwitch(ai);
            }
        }

        // [Optimization] Cleanup logic: remove AI that no longer exists in cache
        const currentAiIds = new Set(everyai.map(ai => ai.id));
        for (const storedId of trackedAis.keys()) {
            if (!currentAiIds.has(storedId)) {
                trackedAis.delete(storedId);
            }
        }

    }, POPULATION_Checkgaptime);
}