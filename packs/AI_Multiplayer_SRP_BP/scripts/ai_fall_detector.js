import { world, system } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";


const ai_player_id = "rg:bot";
const FALLING_TAG = "falling";
const Checkgaptime = 5;


export function detectfallingai() {
    system.runInterval(() => {
        const everyai = ALL_AI_CACHE;
        if (!everyai || everyai.length === 0) return;
        for (const ai of everyai) {
            if (!ai.isValid) continue;
            const IsFallingNow = ai.isFalling;
            const hasTheTag = ai.hasTag(FALLING_TAG);
            if (IsFallingNow && !hasTheTag) {
                ai.addTag(FALLING_TAG);
            } else if (!IsFallingNow && hasTheTag) {
                ai.removeTag(FALLING_TAG);
            }
        }
    }, Checkgaptime);
}