// Combined entry point: Scape and Run: Parasites + AI Multiplayer + the LLM brain.
// SRP is imported first; it only subscribes to events and defers world access until the world has loaded.
import "./srp/main.js";
import "./rgstart.js";
import { system } from "@minecraft/server";
import { startBrainSystem } from "./brain/core.js";
import { startCommands } from "./brain/commands.js";
import { startHubUI } from "./brain/ui.js";

// The legacy modules boot 100 ticks after load; the brain attaches to their caches a little later.
system.runTimeout(() => {
    try { startCommands(); } catch (e) { console.warn("[AISB] commands failed to start", e); }
    try { startHubUI(); } catch (e) { console.warn("[AISB] hub UI failed to start", e); }
    try { startBrainSystem(); } catch (e) { console.warn("[AISB] brain failed to start", e); }
}, 140);
