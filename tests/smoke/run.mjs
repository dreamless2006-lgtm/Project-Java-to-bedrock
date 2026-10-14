// Headless smoke run: load the whole pack under the mock engine, bring a bot to life,
// push chat through the bridge channel, answer its think with a scripted reply, and
// make sure actions execute without errors.  Run: npm run smoke
import { world, system, log, advanceTicksAsync, spawnPlayer, worldLoad, ItemStack } from "@minecraft/server";
import { Reassembler, encodeFrames, packMessage, unpackMessage, DEFAULT_CHUNK } from "../../packs/RealAI_BP/scripts/brain/frame.js";

const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); else console.log("ok -", msg); }

await import("../../packs/RealAI_BP/scripts/main.js");
worldLoad();
const overworld = world.getDimension("minecraft:overworld");
const steve = spawnPlayer("Steve", { x: 0, y: 64, z: 0 });
const relay = spawnPlayer("RealAIBridge", { x: 3, y: 64, z: 3 });
const bot = overworld.spawnEntity("rg:bot", { x: 4, y: 64, z: 0 });
bot.addTag("good");
await advanceTicksAsync(400);     // legacy boot (100) + brain start (140) + first discover/caches
check(log.errors.length === 0, "no errors during boot: " + log.errors.slice(0, 3).join(" | "));
const brainMod = await import("../../packs/RealAI_BP/scripts/brain/core.js");
const gate = await import("../../packs/RealAI_BP/scripts/brain/gate.js");

// Bridge handshake: the relay account runs /scriptevent realai:in <frames>
function fromBridge(obj) { for (const f of encodeFrames("b" + Math.random().toString(36).slice(2, 6), packMessage(obj), DEFAULT_CHUNK)) system.afterEvents.scriptEventReceive.emit({ id: "realai:in", message: f, sourceType: "Entity", sourceEntity: relay }); }
fromBridge({ t: "hello", v: 1, name: "RealAIBridge", version: "0.1.0", providers: ["anthropic", "openai", "xai", "gemini", "ollama", "lmstudio", "player2"] });
await advanceTicksAsync(250);
check(gate.isBrainEnabled(), "brains enabled after bridge hello");
check(bot.nameTag && bot.nameTag.length > 0, "bot got a name: " + bot.nameTag);
check(gate.allBrains().size >= 1, "a brain attached to the bot");
const brain = gate.getBrain(bot.id);
check(!!brain, "brain object for bot");
// keep a copy of every action result, the think cycle drains them into the next observation
const allResults = [];
const origDrain = brain.actuator.drainResults.bind(brain.actuator);
brain.actuator.drainResults = () => { const r = origDrain(); allResults.push(...r); return r; };

// Relayed chat from Steve
fromBridge({ t: "chat_in", from: "Steve", text: `hey ${bot.nameTag} come here and build us a house` });
// Collect frames the addon sends to the relay player and reassemble the think requests.
// Every think that nobody is waiting for gets a quiet default answer, like a real model would.
const reasm = new Reassembler(() => 0);
const IDLE = JSON.stringify({ thought: "nothing to do", say: "", say_to: "", mood: "", goal: "", actions: [{ type: "wait", seconds: 20 }], remember: [], forget: [] });
let wanted = null;   // (msg) => boolean ; the think we are waiting for
let captured = null;
const seenThinks = [];
function pump() {
    for (const m of relay.messages.splice(0)) {
        const got = reasm.push(m); if (!got) continue;
        const msg = unpackMessage(got.text); if (!msg || msg.t !== "think") continue;
        seenThinks.push(msg);
        if (wanted && !captured && wanted(msg)) { captured = msg; continue; }
        fromBridge({ t: "result", turnId: msg.turnId, ok: true, text: IDLE, usage: { input: 500, output: 30 }, model: "mock", provider: "anthropic", attempts: 1 });
    }
}
async function run(ticks, step = 5, until = () => false) { for (let i = 0; i < ticks; i += step) { await advanceTicksAsync(step); pump(); if (until()) return true; } return false; }
async function waitThink(pred, ticks = 400) { wanted = pred; captured = null; await run(ticks, 5, () => !!captured); wanted = null; return captured; }
const thinkMsg = await waitThink(msg => msg.messages?.some(m => String(m.content).includes("build us a house")));
check(!!thinkMsg, "addon sent a think request to the bridge");
if (thinkMsg) {
    check(typeof thinkMsg.sys === "string" && thinkMsg.sys.includes("# Actions you can take"), "think carried the system prompt");
    check(thinkMsg.sys.includes("other:magic_block") && thinkMsg.sys.includes("mymod:goblin"), "system prompt lists modded content");
    const obs = thinkMsg.messages[thinkMsg.messages.length - 1].content;
    check(obs.includes("<Steve>") && obs.includes("build us a house"), "observation contains the chat line");
    check(obs.includes("Players nearby") && obs.includes("Steve"), "observation lists Steve nearby");
    // give the bot planks so the craft at the end of the plan can succeed
    bot.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:oak_planks", 64)); bot.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:oak_planks", 64)); bot.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:oak_planks", 64));
    // Scripted model reply: talk, set goal, walk to Steve, build a house, craft, eat
    const reply = { thought: "Steve asked for a house", say: "on my way Steve, house coming up", say_to: "", mood: "happy", goal: "build Steve a house", actions: [{ type: "go_to_player", name: "Steve" }, { type: "build", preset: "house", material: "oak_planks", width: 5, depth: 5, height: 3 }, { type: "craft", item: "crafting_table" }], remember: ["Steve wants a house near spawn"], forget: [] };
    fromBridge({ t: "result", turnId: thinkMsg.turnId, ok: true, text: JSON.stringify(reply), usage: { input: 1200, output: 90 }, model: "mock", provider: "anthropic", attempts: 1 });
    await run(40);
    check(log.chat.some(l => l.includes("on my way Steve")), "bot spoke in chat: " + log.chat.slice(-1));
    check(brain.memory.facts.some(f => f.text.includes("Steve wants a house")), "fact remembered");
    check(brain.memory.goal === "build Steve a house", "goal stored");
    check(bot.getDynamicProperty("rg:mood") === "happy", "mood written to the legacy property");
    // let the actions run: go_to_player (bot walks via impulses in the mock), then build
    await run(4000, 10, () => brain.actuator.current?.action.type === "build" && brain.actuator.current.state.placed > 10);
    const placed = log.commands.filter(c => /^setblock .* minecraft:(oak_planks|glass|torch|crafting_table|chest)/.test(c)).length;
    check(placed > 10, "house blocks were placed via setblock: " + placed);
    await run(6000, 10, () => !brain.actuator.current && !brain.actuator.queue.length);
    const results = [...allResults, ...brain.actuator.results];
    check(results.some(r => /^build: finished building house/.test(r)), "build finished: " + results.join(" | "));
    check(results.some(r => /^craft: crafted/.test(r)), "craft succeeded: " + results.join(" | "));
}
check(brain && brain.failures === 0, "no think failures");
check(log.errors.length === 0, "no engine-level errors: " + log.errors.slice(0, 3).join(" | "));
const realaiWarnings = log.warnings.filter(w => /\[RealAI\]/.test(w) && !/started|connected|unavailable/.test(w));
check(realaiWarnings.length === 0, "no [RealAI] warnings: " + realaiWarnings.slice(0, 3).join(" | "));

// Second cycle: status command and a travel action with a built portal
const cmds = await import("../../packs/RealAI_BP/scripts/brain/commands.js");
cmds.handleCommand(steve, "!ai status");
check(steve.messages.some(m => m.includes("[Real AI]")), "!ai status answered");
cmds.handleCommand(steve, "!ai summon Ellie a cheerful builder");
console.log("summon reply:", steve.messages.slice(-1)[0]);
await run(200);
const ellie = [...gate.allBrains().values()].find(b => b.name === "Ellie");
check(!!ellie, "companion Ellie summoned with a brain");
if (ellie) {
    const ellieResults = [];
    const d0 = ellie.actuator.drainResults.bind(ellie.actuator);
    ellie.actuator.drainResults = () => { const r = d0(); ellieResults.push(...r); return r; };
    ellie.actuator.enqueue([{ type: "travel", dimension: "nether" }]);
    await run(2000, 10, () => !ellie.actuator.current && !ellie.actuator.queue.length);
    check(ellie.bot.dimension.id === "minecraft:nether", "Ellie travelled to the nether: " + [...ellieResults, ...ellie.actuator.results].join(" | "));
}
check(log.errors.length === 0, "still no engine-level errors: " + log.errors.slice(0, 3).join(" | "));

// Third cycle: a companion dies and respawns next to its owner, keeping its memory; the owner
// re-joins far away and the companion is brought over.
if (ellie) {
    const pid = ellie.bot.getDynamicProperty("rg:p_id");
    ellie.memory.facts.push({ text: "Steve likes oak houses", at: Date.now(), hits: 1 });
    ellie.saveMemory();
    ellie.bot.applyDamage(100, { cause: "lava" });
    await run(260);
    const ellie2 = [...gate.allBrains().values()].find(b => b.name === "Ellie");
    check(!!ellie2 && ellie2 !== ellie, "Ellie respawned with a new body: " + (ellie2 ? ellie2.bot.id : "none"));
    if (ellie2) {
        check(ellie2.bot.getDynamicProperty("rg:p_id") === pid, "respawned Ellie keeps her pid");
        check(ellie2.memory.facts.some(f => f.text.includes("oak houses")), "respawned Ellie keeps her memory");
        check(ellie2.settings.owner === steve.id && ellie2.settings.mode === "companion", "respawned Ellie is still Steve's companion");
        check(ellie2.bot.dimension.id === "minecraft:overworld" && Math.hypot(ellie2.bot.location.x - steve.location.x, ellie2.bot.location.z - steve.location.z) < 4, "respawned next to Steve");
        check(steve.messages.some(m => m.includes("Ellie is back")), "owner told about the respawn");
        // owner leaves and comes back 300 blocks away: companion is gathered
        ellie2.bot.teleport({ x: 300, y: 64, z: 300 });
        world.afterEvents.playerLeave.emit({ playerId: steve.id, playerName: steve.name });
        world.afterEvents.playerSpawn.emit({ player: steve, initialSpawn: true });
        await run(100);
        check(Math.hypot(ellie2.bot.location.x - steve.location.x, ellie2.bot.location.z - steve.location.z) < 6, "Ellie brought to Steve on join: " + JSON.stringify(ellie2.bot.location));
    }
}
// Fourth cycle: the resident AI players. They joined when the bridge connected, each announced
// like a player; they come back with the same names and memories after the world reloads, and
// they respawn like players when they die.
const mgr = brainMod.manager;
await run(200);
const residents = () => [...gate.allBrains().values()].filter(b => b.settings.mode === "resident" && b.bot.isValid);
const joinMsgs = () => log.chat.filter(l => l.includes("multiplayer.player.joined")).length;
check(residents().length === 8, "8 resident AI players have bodies and brains: " + residents().length);
check(joinMsgs() >= 8, "each resident was announced like a player joining: " + joinMsgs());
check(mgr.residentsStatus().online === 8 && mgr.residentsStatus().total === 8, "residents status 8/8: " + JSON.stringify(mgr.residentsStatus()));
const rosterNames = residents().map(b => b.name).sort();
const rosterPids = residents().map(b => b.bot.getDynamicProperty("rg:p_id")).sort();
check(new Set(rosterNames).size === 8 && rosterNames.every(n => n && n.length > 0), "resident names are unique: " + rosterNames.join(", "));
check(residents().every(b => Math.hypot(b.bot.location.x - steve.location.x, b.bot.location.z - steve.location.z) <= 15), "residents spawned within 15 blocks of Steve");
// every resident is driven by a real model: providers are spread over what the bridge has keys for
const provs = residents().map(b => b.settings.provider);
check(provs.every(p => ["anthropic", "openai", "xai", "gemini"].includes(p)) && new Set(provs).size === 4 && provs.filter(p => p === "anthropic").length === 2, "residents spread across Claude, ChatGPT, Grok and Gemini: " + provs.join(","));
check(residents().every(b => b.systemPrompt().includes("Your mind runs on the")), "each resident's prompt names the model it runs on");
check(residents().every(b => b.bot.events.includes("realai:brain_on")), "engine targeting/wandering goals switched off for every brain-driven bot");
// their thinks go out tagged with their own provider
const residentThinks = seenThinks.filter(t => residents().some(b => b.id === t.bot));
check(new Set(residentThinks.map(t => t.bot)).size === 8, "every resident asked the model for its first decision: " + new Set(residentThinks.map(t => t.bot)).size);
check(residentThinks.every(t => residents().find(b => b.id === t.bot)?.settings.provider === t.cfg?.provider), "each think goes to that resident's own provider");
// thoughts can be shown to nearby players
const { updateWorldConfig } = await import("../../packs/RealAI_BP/scripts/brain/config.js");
updateWorldConfig({ showThoughts: true });
const r0 = residents()[0]; r0.request("say something");
const before = steve.messages.length;
await run(300, 5, () => steve.messages.slice(before).some(m => m.includes("thinks via")));
check(steve.messages.slice(before).some(m => m.includes("thinks via")), "Steve can watch a resident's reasoning: " + (steve.messages.slice(before).find(m => m.includes("thinks via")) || "none"));
updateWorldConfig({ showThoughts: false });
check(world.getDimension("overworld").getEntities({ type: "rg:bot" }).filter(e => !e.getDynamicProperty("rg:p_id")).length <= 1, "no wild bots from the legacy spawner (wildSpawns off)");
// the world unloads (bodies vanish without dying), Steve rejoins: same people come back
const first = residents()[0];
first.memory.facts.push({ text: "Steve built a house by spawn", at: Date.now(), hits: 1 }); first.saveMemory();
const firstName = first.name, firstPid = first.bot.getDynamicProperty("rg:p_id");
for (const b of residents()) b.bot.remove();
const joinsBefore = joinMsgs();
world.afterEvents.playerLeave.emit({ playerId: steve.id, playerName: steve.name });
world.afterEvents.playerSpawn.emit({ player: steve, initialSpawn: true });
await run(500);
check(residents().length === 8, "residents rejoined after a reload: " + residents().length);
check(joinMsgs() - joinsBefore >= 8, "rejoin was announced again: " + (joinMsgs() - joinsBefore));
check(JSON.stringify(residents().map(b => b.name).sort()) === JSON.stringify(rosterNames), "same names after reload");
check(JSON.stringify(residents().map(b => b.bot.getDynamicProperty("rg:p_id")).sort()) === JSON.stringify(rosterPids), "same persistent ids after reload");
const firstAgain = residents().find(b => b.name === firstName);
check(!!firstAgain && firstAgain.bot.getDynamicProperty("rg:p_id") === firstPid && firstAgain.memory.facts.some(f => f.text.includes("built a house")), "resident memory survived the reload");
// a stale body of the same resident loads from a far chunk: it is removed, not duplicated
const stale = overworld.spawnEntity("rg:bot", { x: 500, y: 64, z: 500 }); stale.addTag("rg:awakened_ai"); stale.setDynamicProperty("rg:p_id", firstPid);
world.afterEvents.entityLoad.emit({ entity: stale });
await run(20);
check(!stale.isValid && firstAgain.bot.isValid, "stale duplicate body removed on load");
// a resident dies: it respawns like a player, same identity
firstAgain.bot.applyDamage(100, { cause: "fall" });
await run(260);
const reborn = residents().find(b => b.name === firstName);
check(!!reborn && reborn !== firstAgain && reborn.bot.getDynamicProperty("rg:p_id") === firstPid, "dead resident respawned with the same identity");
check(residents().length === 8, "still 8 residents after the respawn: " + residents().length);
check(log.errors.length === 0, "no engine-level errors after lifecycle: " + log.errors.slice(0, 3).join(" | "));
const lateWarnings = log.warnings.filter(w => /\[RealAI\]/.test(w) && !/started|connected|unavailable/.test(w));
check(lateWarnings.length === 0, "no late [RealAI] warnings: " + lateWarnings.slice(0, 3).join(" | "));

if (fails.length) { console.log("\nFAILED:\n - " + fails.join("\n - ")); console.log("\nwarnings:\n" + log.warnings.slice(0, 15).join("\n")); process.exit(1); }
console.log(`\nsmoke OK (${seenThinks.length} think requests answered, ${log.commands.length} commands)`);
process.exit(0);
