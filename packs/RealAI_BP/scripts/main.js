// Real AI entry point: the AI Multiplayer bot bodies + the LLM brain that drives them.
import "./rgstart.js";
import { system } from "@minecraft/server";
import { startBrainSystem } from "./brain/core.js";
import { startCommands, registerSlashCommands } from "./brain/commands.js";
import { startHubUI } from "./brain/ui.js";

registerSlashCommands();   // must subscribe to system.beforeEvents.startup during module load

// The legacy modules boot 100 ticks after load; the brain attaches to their caches a little later.
system.runTimeout(() => {
    try { startCommands(); } catch (e) { console.warn("[RealAI] commands failed to start", e); }
    try { startHubUI(); } catch (e) { console.warn("[RealAI] hub UI failed to start", e); }
    try { startBrainSystem(); } catch (e) { console.warn("[RealAI] brain failed to start", e); }
}, 140);
