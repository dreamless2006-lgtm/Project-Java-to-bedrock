// Scape and Run: Parasites - Bedrock port entry point.
// Started from the merged pack's scripts/main.js alongside AI Multiplayer.
import { world, system } from "@minecraft/server";
import { loadState, startStateLoops, state } from "./state.js";
import { startSpawner } from "./spawner.js";
import { startInfection } from "./infection.js";
import { startNodes } from "./nodes.js";
import { startItems } from "./items.js";

let started = false;

function init() {
    if (started) return;
    started = true;
    try {
        loadState();
        startStateLoops();
        startSpawner();
        startNodes();
        console.log(`[SRP] Scape and Run: Parasites loaded (phase ${state.phase}, ${Math.floor(state.points)} points).`);
    } catch (e) {
        console.warn("[SRP] init failed: " + e);
    }
}

// Event subscriptions are allowed during early execution; world access is not.
try { startInfection(); } catch (e) { console.warn("[SRP] infection hooks failed: " + e); }
try { startItems(); } catch (e) { console.warn("[SRP] item hooks failed: " + e); }

try {
    world.afterEvents.worldLoad.subscribe(() => init());
} catch { }
// Fallback in case the load event already fired (e.g. /reload).
system.runTimeout(() => init(), 60);
