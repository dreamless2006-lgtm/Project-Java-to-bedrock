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
const { renderMemory } = await import("../../packs/RealAI_BP/scripts/brain/memory.js");
const gate = await import("../../packs/RealAI_BP/scripts/brain/gate.js");

// Bridge handshake: the relay account runs /scriptevent realai:in <frames>
function fromBridge(obj) { for (const f of encodeFrames("b" + Math.random().toString(36).slice(2, 6), packMessage(obj), DEFAULT_CHUNK)) system.afterEvents.scriptEventReceive.emit({ id: "realai:in", message: f, sourceType: "Entity", sourceEntity: relay }); }
const { getWorldConfig: gwc, updateWorldConfig: uwc } = await import("../../packs/RealAI_BP/scripts/brain/config.js");
check(gwc().worldPlayers === 0 && gwc().bridgePlays === true, "by default the bridge account's player is the only AI player");
uwc({ worldPlayers: 8, freeBuild: true, independent: false });   // the rest of the run covers residents, companions and creative-style building too
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
const otherMsgs = [];
function pump() {
    for (const m of relay.messages.splice(0)) {
        const got = reasm.push(m); if (!got) continue;
        const msg = unpackMessage(got.text); if (!msg) continue;
        if (msg.t !== "think") { otherMsgs.push(msg); continue; }
        seenThinks.push(msg);
        if (wanted && !captured && wanted(msg)) { captured = msg; continue; }
        fromBridge({ t: "result", turnId: msg.turnId, ok: true, text: IDLE, usage: { input: 500, output: 30 }, model: "mock", provider: "anthropic", attempts: 1 });
    }
}
async function run(ticks, step = 5, until = () => false) { for (let i = 0; i < ticks; i += step) { await advanceTicksAsync(step); pump(); if (until()) return true; } return false; }
async function waitThink(pred, ticks = 400) { wanted = pred; captured = null; await run(ticks, 5, () => !!captured); wanted = null; const got = captured; captured = null; return got; }
const thinkMsg = await waitThink(msg => msg.bot === bot.id && msg.messages?.some(m => String(m.content).includes("build us a house")));
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
// Fifth cycle: the inner life. Feelings reach the model, a reflection turn comes round, and the
// model's "self" and "plans" land in memory and come back in the next prompt.
{
    const { updateWorldConfig: upd } = await import("../../packs/RealAI_BP/scripts/brain/config.js");
    upd({ reflectEvery: 3 });
    const r0 = residents()[0];
    const { addEpisode: ep } = await import("../../packs/RealAI_BP/scripts/brain/memory.js");
    ep(r0.memory, "helped Steve carry logs", Date.now()); ep(r0.memory, "saw a creeper near the river", Date.now()); ep(r0.memory, "started a wall by the oak", Date.now());
    const seenBefore = seenThinks.length;
    captured = null;
    let reflectMsg = null, feelingsMsg = null;
    wanted = msg => { if (msg.bot !== r0.id) return false; const obs = msg.messages[msg.messages.length - 1].content; if (!feelingsMsg && obs.includes("You feel")) feelingsMsg = msg; if (obs.includes("Reflection time")) { reflectMsg = msg; return true; } return false; };
    for (let i = 0; i < 8 && !reflectMsg; i++) { r0.request("tell me what you are up to"); await run(120, 5, () => !!captured); if (captured) { reflectMsg = captured; captured = null; } }
    wanted = null;
    check(!!feelingsMsg, "a resident's observation reports its feelings");
    check(!!reflectMsg, "a reflection turn was asked for after a few thinks: " + (seenThinks.length - seenBefore) + " thinks");
    if (reflectMsg) {
        fromBridge({ t: "result", turnId: reflectMsg.turnId, ok: true, text: JSON.stringify({ thought: "looking back", say: "", say_to: "", mood: "focused", goal: "", actions: [{ type: "wait", seconds: 5 }], remember: ["Steve is the person who runs this place"], forget: [], self: "I am the quiet one who builds things properly and keeps an eye on Steve.", plans: ["finish a proper house", "find iron", "make a farm with the others"] }), usage: { input: 900, output: 120 }, model: "mock", provider: "anthropic", attempts: 1 });
        await run(40);
        check(r0.memory.self.includes("quiet one") && r0.memory.plans.length === 3, "self and plans stored from the reflection: " + r0.memory.self);
        let nextObs = null;
        wanted = msg => msg.bot === r0.id;
        r0.request("say hi"); await run(200, 5, () => !!captured); nextObs = captured; captured = null; wanted = null;
        check(!!nextObs && nextObs.messages[nextObs.messages.length - 1].content.includes("Who I am: I am the quiet one") && nextObs.messages[nextObs.messages.length - 1].content.includes("1. finish a proper house"), "the next prompt carries the self-narrative and the plan");
        if (nextObs) fromBridge({ t: "result", turnId: nextObs.turnId, ok: true, text: IDLE, usage: { input: 1, output: 1 }, model: "mock", provider: "anthropic", attempts: 1 });
    }
    // a stranger breaks a block at a resident's home -> the resident notices
    const r1 = residents()[1];
    r1.memory.home = { x: Math.floor(r1.bot.location.x), y: 64, z: Math.floor(r1.bot.location.z), dim: "minecraft:overworld" };
    const stranger = spawnPlayer("Alex", { x: r1.memory.home.x + 2, y: 64, z: r1.memory.home.z });
    const blk = overworld.getBlock({ x: r1.memory.home.x + 1, y: 64, z: r1.memory.home.z });
    world.afterEvents.playerBreakBlock.emit({ player: stranger, block: blk, brokenBlockPermutation: {}, dimension: overworld });
    check(r1.sched.pending.some(e => e.type === "home_touched" && e.text.includes("Alex broke")), "a resident notices someone breaking a block at its home");
    world.afterEvents.weatherChange.emit({ dimension: "minecraft:overworld", newWeather: "Rain", previousWeather: "Clear" });
    check(r1.sched.pending.some(e => e.type === "weather"), "weather changes are noticed");
    // dawn after a night: everyone gets a moment to plan the day
    world.setTimeOfDay(14000); await run(120); world.setTimeOfDay(500); await run(120);
    check(residents().every(b => b.sched.pending.some(e => e.type === "dawn") || b.sched.inFlight || b.thinks > 0), "dawn prompts a plan for the day");
    upd({ reflectEvery: 20 });
}
// Sixth cycle: the bridge account's own player is a player too. It gets a brain, walks by
// stepping its real body, and its words go out as real chat through the bridge.
{
    await run(200);
    const bb = gate.getBrain(relay.id);
    check(!!bb && bb.settings.mode === "bridge", "the bridge account's player has a brain of its own");
    if (bb) {
        relay.location = { x: 30, y: 64, z: 30 };
        const before = Math.hypot(relay.location.x - steve.location.x, relay.location.z - steve.location.z);
        bb.actuator.enqueue([{ type: "go_to_player", name: "Steve" }]);
        await run(900, 10, () => !bb.actuator.current && !bb.actuator.queue.length);
        const after = Math.hypot(relay.location.x - steve.location.x, relay.location.z - steve.location.z);
        check(after < 4 && before > 20, `the bridge player walked to Steve (${before.toFixed(0)}m -> ${after.toFixed(1)}m)`);
        const chatOutBefore = otherMsgs.filter(m => m.t === "chat_out").length;
        bb.sayNow("hello from the account itself");
        pump();
        check(otherMsgs.filter(m => m.t === "chat_out").length > chatOutBefore && otherMsgs.some(m => m.t === "chat_out" && m.text === "hello from the account itself"), "its chat goes out as real chat through the bridge");
        check(!log.chat.some(l => l.includes("hello from the account itself")), "and not as a fake <name> line");
    }
}
// Seventh cycle: the mission. The bridge player sees its progress, locates a stronghold through
// the bridge, lights the end portal with twelve eyes, and the dragon's death is recognised.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        captured = null; wanted = msg => msg.bot === bb.id;
        bb.request("what next?"); await run(200, 5, () => !!captured);
        const m = captured; captured = null; wanted = null;
        const obsText = m ? m.messages[m.messages.length - 1].content : "";
        check(obsText.includes("Mission: beat the game") && obsText.includes("Usual next step"), "the bridge player's observation carries the mission and the next step");
        const sysText = (m && m.sys) || seenThinks.filter(t => t.bot === bb.id && t.sys).map(t => t.sys).pop() || "";
        check(sysText.includes("BEAT THE GAME"), "its system prompt states the purpose");
        if (m) fromBridge({ t: "result", turnId: m.turnId, ok: true, text: IDLE, usage: { input: 1, output: 1 }, model: "mock", provider: "anthropic", attempts: 1 });
        const locBefore = otherMsgs.filter(x => x.t === "locate").length;
        bb.actuator.enqueue([{ type: "locate", structure: "stronghold" }]);
        await run(60, 5, () => otherMsgs.filter(x => x.t === "locate").length > locBefore);
        const req = otherMsgs.filter(x => x.t === "locate").slice(-1)[0];
        check(!!req && req.structure === "stronghold" && req.bot === bb.id, "the bridge is asked to run /locate stronghold");
        if (req) fromBridge({ t: "locate_result", bot: req.bot, structure: "stronghold", ok: true, x: 1200, y: 30, z: -340 });
        await run(60, 5, () => !bb.actuator.current && !bb.actuator.queue.length);
        check(bb.memory.facts.some(f => /stronghold is near x 1200 z -340/.test(f.text)) && bb.memory.mission.strongholdAt?.x === 1200, "the stronghold's position is remembered: " + bb.actuator.results.join(" | "));
        const cx = Math.floor(relay.location.x) + 3, cz = Math.floor(relay.location.z) + 3, fy = 64;
        const ring = []; for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) { const edge = x === cx - 2 || x === cx + 2 || z === cz - 2 || z === cz + 2; const corner = (x === cx - 2 || x === cx + 2) && (z === cz - 2 || z === cz + 2); if (edge && !corner) ring.push([x, z]); }
        for (const [x, z] of ring) overworld._set(x, fy, z, "minecraft:end_portal_frame");
        relay.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:ender_eye", 12));
        relay.location = { x: cx + 0.5, y: 64, z: cz + 0.5 };
        bb.actuator.enqueue(Array.from({ length: 12 }, () => ({ type: "use_item", item: "ender_eye" })));
        await run(800, 10, () => !bb.actuator.current && !bb.actuator.queue.length);
        check(bb.memory.mission.portalLit === true && overworld.getBlock({ x: cx, y: fy, z: cz }).typeId === "minecraft:end_portal", "twelve eyes light the end portal: " + bb.actuator.results.slice(-1));
        const dragon = overworld.spawnEntity("minecraft:ender_dragon", { x: relay.location.x + 3, y: 70, z: relay.location.z });
        dragon.applyDamage(500, { cause: "entityAttack", damagingEntity: relay });
        await run(20);
        check(bb.memory.mission.dragon === true && (log.chat.some(l => l.includes("beat the game")) || steve.messages.some(l => l.includes("beat the game"))), "killing the dragon counts as beating the game");
    }
}
// Eighth cycle: the body itself works the world. The bridge player chops a tree by hand, digs
// through a hill that blocks its way, mines a staircase with a wooden pickaxe, eats to fill a
// real hunger bar, sleeps in a bed, and a failed decision is said out loud.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        const bx = 200, bz = 200;
        const inv = relay.getComponent("minecraft:inventory").container;
        const count = (id) => { let n = 0; for (let i = 0; i < inv.size; i++) { const st = inv.getItem(i); if (st && st.typeId === id) n += st.amount; } return n; };
        // its own thinks drain the action results into observations; keep a copy so checks can read them
        const bbResults = [];
        const origDrainB = bb.actuator.drainResults.bind(bb.actuator);
        bb.actuator.drainResults = () => { const r = origDrainB(); bbResults.push(...r); return r; };
        const last = () => (bb.actuator.results.length ? bb.actuator.results : bbResults).slice(-1)[0] || "";
        const act = (...a) => { if (bb.actuator.current?.action.type === "wait") bb.actuator.finish("wait cancelled"); bb.actuator.enqueue(a); };
        const idle = () => !bb.actuator.current && !bb.actuator.queue.length;
        relay.teleport({ x: bx + 0.5, y: 64, z: bz + 0.5 });
        // a tree five blocks east: a trunk of five logs under a crown of leaves
        for (let y = 64; y <= 68; y++) overworld._set(bx + 5, y, bz, "minecraft:oak_log");
        for (let y = 67; y <= 69; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) overworld._set(bx + 5 + dx, y, bz + dz, "minecraft:oak_leaves");
        act({ type: "gather", material: "oak_log", amount: 4 });
        await run(1500, 10, idle);
        check(count("minecraft:oak_log") >= 4 && /gathered 4 oak logs/.test(last()), "the bridge player chopped four logs by hand: " + last());
        check(overworld.getBlock({ x: bx + 5, y: 64, z: bz }).isAir, "the trunk's lowest log is gone");
        act({ type: "gather", material: "diamond", amount: 1 });
        await run(400, 10, idle);
        check(/no diamond ore/.test(last()), "asking for what is not there ends with a clear answer: " + last());
        // a hill across the way to a spot twelve blocks west: three high, far too wide to walk around
        for (let dz = -40; dz <= 40; dz++) for (let y = 64; y <= 66; y++) overworld._set(bx - 4, y, bz + dz, "minecraft:dirt");
        act({ type: "move_to", x: bx - 12, y: 64, z: bz });
        await run(1500, 10, idle);
        check(Math.hypot(relay.location.x - (bx - 12 + 0.5), relay.location.z - (bz + 0.5)) < 2.5, "it dug through the hill and arrived: " + last() + " at " + JSON.stringify(relay.location));
        check(count("minecraft:dirt") >= 2, "the dirt it dug is in its inventory: " + count("minecraft:dirt"));
        // the crosshair actions, the way a player works: look, mine, hold, place, use, hit
        {
            const px = bx + 40, pz = bz + 40;
            relay.teleport({ x: px + 0.5, y: 64, z: pz + 0.5 }); relay.setRotation({ x: 0, y: 0 });       // facing south
            bb.actuator.stopAll();
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 8; dz++) for (let y = 64; y <= 67; y++) overworld._set(px + dx, y, pz + dz, "minecraft:air");
            overworld._set(px, 65, pz + 2, "minecraft:oak_log");
            const logsBefore = count("minecraft:oak_log");
            act({ type: "mine" });
            await run(300, 10, idle);
            check(/^mine: mined 1 block \(.*oak log x1/.test(last()) && overworld.getBlock({ x: px, y: 65, z: pz + 2 }).isAir && count("minecraft:oak_log") === logsBefore + 1, "mine breaks the block under the crosshair and the drop is in the bag: " + last());
            act({ type: "look", facing: "up" });
            act({ type: "mine" });
            await run(60, 10, idle);
            check(/nothing in reach/.test(last()), "with nothing under the crosshair it says so: " + last());
            act({ type: "look", pitch: 0, yaw: 0 });
            overworld._set(px, 65, pz + 2, "minecraft:bedrock");
            act({ type: "mine" });
            await run(60, 10, idle);
            check(/cannot mine bedrock/.test(last()), "what cannot be mined is refused with the reason: " + last());
            overworld._set(px, 65, pz + 2, "minecraft:air");
            // hold and place: on the ground ahead
            inv.addItem(new ItemStack("minecraft:cobblestone", 8));
            act({ type: "hold", item: "cobblestone" });
            await run(20, 5, idle);
            check(/^hold: holding cobblestone/.test(last()), "hold puts the item in the hand: " + last());
            const hb = (await import("../../packs/RealAI_BP/scripts/brain/perception.js")).observe(relay, bb, {}).hotbar || "";
            check(/cobblestone x\d+\*/.test(hb), "and the hotbar line shows it in hand: " + hb);
            act({ type: "look", pitch: 45, yaw: 0 });
            await run(10, 5, idle);
            const cobBefore = count("minecraft:cobblestone");
            act({ type: "place" });
            await run(40, 5, idle);
            const placedAt = [1, 2].map(dz => overworld.getBlock({ x: px, y: 64, z: pz + dz }).typeId);
            check(/^place: placed cobblestone/.test(last()) && placedAt.includes("minecraft:cobblestone") && count("minecraft:cobblestone") === cobBefore - 1, "place puts the held block on the face under the crosshair: " + last() + " " + placedAt);
            act({ type: "look", facing: "down" });
            act({ type: "place" });
            await run(20, 5, idle);
            check(/where you stand/.test(last()), "not into its own body: " + last());
            // a door in front is used, a creature in front is hit
            relay.setRotation({ x: 0, y: 0 });
            overworld._set(px, 64, pz + 2, "minecraft:oak_door"); overworld._set(px, 65, pz + 2, "minecraft:oak_door");
            act({ type: "look", pitch: 0, yaw: 0 });
            act({ type: "use" });
            await run(30, 5, idle);
            check(/using the oak door/.test(bb.actuator.results.join(" | ")), "use right-clicks the door in front: " + bb.actuator.results.slice(-3).join(" | "));
            overworld._set(px, 64, pz + 2, "minecraft:air"); overworld._set(px, 65, pz + 2, "minecraft:air");
            const cow = overworld.spawnEntity("minecraft:cow", { x: px + 0.5, y: 64, z: pz + 3.5 });
            bb.actuator.stopAll();
            act({ type: "look_at", x: px + 0.5, y: 64.9, z: pz + 3.5 });
            act({ type: "hit" });
            await run(20, 5, () => bb.actuator.results.some(r => /^hit:/.test(r)));
            check(bb.actuator.results.some(r => /^hit: hit the cow/.test(r)), "hit strikes the creature under the crosshair: " + bb.actuator.results.slice(-3).join(" | "));
            bb.actuator.stopAll();
            try { cow.remove(); } catch (e) { /* ignore */ }
            act({ type: "hold", slot: 1 });
            await run(10, 5, idle);
            check(/^hold: (holding|slot 1 is empty)/.test(last()), "hold by slot: " + last());
            bb.actuator.stopAll();
        }
        // mine down with a wooden pickaxe: a staircase, cobblestone in the bag, six levels lower
        act({ type: "mine_down", depth: 6 });
        await run(100, 10, idle);
        check(/needs a pickaxe/.test(last()), "mining without a pickaxe is refused with the recipe: " + last());
        inv.addItem(new ItemStack("minecraft:wooden_pickaxe", 1));
        const yBefore = relay.location.y;
        act({ type: "mine_down", depth: 6 });
        await run(2500, 10, idle);
        check(relay.location.y <= yBefore - 6 + 0.01 && /reached y/.test(last()), `it dug a staircase down (${yBefore} -> ${relay.location.y}): ` + last());
        check(count("minecraft:cobblestone") >= 3, "the stone it dug became cobblestone in its inventory: " + count("minecraft:cobblestone"));
        // a real hunger bar: eating bread fills it, and the observation shows it
        const hungerComp = relay.getComponent("minecraft:player.hunger"); hungerComp.setCurrentValue(6);
        inv.addItem(new ItemStack("minecraft:bread", 1));
        act({ type: "eat" });      // (the per-tick layer may beat the action to it: either way one bread is eaten)
        await run(40);
        check(hungerComp.currentValue === 11 && count("minecraft:bread") === 0, "eating bread fills the real hunger bar: " + last());
        captured = null; wanted = msg => msg.bot === bb.id; bb.request("how are you?"); await run(200, 5, () => !!captured);
        const obs8 = captured ? captured.messages[captured.messages.length - 1].content : "";
        if (captured) fromBridge({ t: "result", turnId: captured.turnId, ok: true, text: IDLE, usage: { input: 1, output: 1 }, model: "mock", provider: "anthropic", attempts: 1 });
        captured = null; wanted = null;
        check(/hunger 11\/20/.test(obs8), "the observation shows the hunger bar");
        // night: it goes to bed, and once everyone else is in bed too the night passes
        const others = world.getAllPlayers().filter(p => p.id !== relay.id);
        relay.teleport({ x: bx + 0.5, y: 64, z: bz + 20.5 });
        overworld._set(bx + 2, 64, bz + 20, "minecraft:bed");
        world.setTimeOfDay(14000);
        act({ type: "sleep" });
        await run(300, 10, () => relay.hasTag("is_sleeping"));
        check(relay.hasTag("is_sleeping") && log.commands.some(c => /spawnpoint @s 202 64 220/.test(c)), "it lies down in the bed and sets its spawn there: " + last());
        check(world.getTimeOfDay() === 14000, "the night goes on while the others are up");
        for (const p of others) p.isSleeping = true;
        await run(300, 10, () => !bb.actuator.current);
        check(world.getTimeOfDay() === 1000 && /slept through the night/.test(last()), "with everyone in bed the night passes: " + last());
        for (const p of others) p.isSleeping = false;
        // the other way round: the humans go to bed while the AI is up; its account turns in too
        world.setTimeOfDay(15000); for (const p of others) p.isSleeping = true;
        await run(320);
        check(world.getTimeOfDay() === 1000 && log.chat.some(l => /went to bed too/.test(l)), "when the humans sleep, the AI's account sleeps as well so the night can pass");
        for (const p of others) p.isSleeping = false; world.setTimeOfDay(6000);
        // a failed decision is said out loud, with the usual cause
        captured = null; wanted = msg => msg.bot === bb.id; bb.request("anything?"); await run(200, 5, () => !!captured);
        if (captured) fromBridge({ t: "result", turnId: captured.turnId, ok: false, error: "429 RESOURCE_EXHAUSTED: quota exceeded", provider: "gemini" });
        captured = null; wanted = null; await run(20);
        check(log.chat.some(l => /could not decide: 429/.test(l) && /rate limiting/.test(l)), "a provider failure is explained in chat: " + log.chat.slice(-1));
    }
}
// Ninth cycle: a bridge that owns its body. When the bridge's hello says body: 1, the walker stops
// teleporting the player and sends it footing points (walk), a stop when it is done, and look
// requests, because a real client only moves through its own input packets.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        fromBridge({ t: "hello", v: 2, name: "RealAIBridge", version: "0.2.0", body: 1, providers: ["anthropic"] });
        await run(40);
        relay.teleport({ x: 300.5, y: 64, z: 300.5 });
        const before = { ...relay.location };
        const walksBefore = otherMsgs.filter(m => m.t === "walk").length;
        if (bb.actuator.current?.action.type === "wait") bb.actuator.finish("wait cancelled");
        bb.actuator.enqueue([{ type: "move_to", x: 310, y: 64, z: 300 }]);
        await run(60, 5, () => otherMsgs.filter(m => m.t === "walk").length > walksBefore + 2);
        const walks = otherMsgs.filter(m => m.t === "walk").slice(walksBefore);
        check(walks.length >= 3 && walks.every(w => typeof w.x === "number" && typeof w.z === "number" && w.y === 64 && /^(walk|sprint)$/.test(w.mode)), `the walker hands footing points to the bridge: ${JSON.stringify(walks[0])}`);
        check(walks.length && walks[0].x > 300.5 && walks[0].x < 303 && Math.abs(walks[0].z - 300.5) < 0.2, "the first point is a step ahead along the way");
        check(relay.location.x === before.x && relay.location.z === before.z, "and the player is no longer teleported by the script");
        // the server moves the body (as the real client would): the walker keeps sending new points ahead
        relay.teleport({ x: 305.5, y: 64, z: 300.5 });
        await run(20);
        const later = otherMsgs.filter(m => m.t === "walk").slice(-1)[0];
        check(later && later.x > 305.5, "later points start from where the server says the body is: " + JSON.stringify(later));
        bb.actuator.stopAll();
        await run(10);
        check(otherMsgs.some(m => m.t === "stop"), "stopping tells the bridge to stop walking");
        // the frames say how high the body stands (a snow layer is not a whole block) and whether it is on the ground
        overworld._set(310, 64, 330, "minecraft:snow_layer");
        relay.teleport({ x: 310.5, y: 64.125, z: 330.5 });
        const snowFrom = otherMsgs.length;
        bb.actuator.enqueue([{ type: "move_to", x: 318, y: 64, z: 330 }]);
        await run(40);
        const snowFrames = otherMsgs.slice(snowFrom).filter(m => m.t === "walk");
        check(snowFrames.length > 2 && snowFrames.every(m => Math.abs(m.y - 64.125) < 1e-6 && Math.abs(m.fy - 64.125) < 1e-6 && m.fg === 1), "walk frames carry the height the body stands at and that it is on the ground: " + JSON.stringify(snowFrames[0]));
        bb.actuator.stopAll(); await run(5);
        // a reply's actions keep their order: turn north, walk, turn east
        relay.teleport({ x: 330.5, y: 64, z: 330.5 }); relay.setRotation({ x: 0, y: 0 });
        const ordFrom = otherMsgs.length; bb.actuator.results.length = 0;
        bb.actuator.enqueue([{ type: "look", facing: "north" }, { type: "move", direction: "forward", seconds: 0.5 }, { type: "look", facing: "east" }]);
        await run(80, 2, () => bb.actuator.results.length >= 3);
        const ord = otherMsgs.slice(ordFrom).filter(m => m.t === "look" || m.t === "input");
        const iLookN = ord.findIndex(m => m.t === "look" && Math.abs(Math.abs(m.yaw) - 180) < 1), iInput = ord.findIndex(m => m.t === "input"), iLookE = ord.findIndex(m => m.t === "look" && Math.abs(m.yaw + 90) < 1);
        check(iLookN === 0 && iInput > iLookN && iLookE > iInput, "look north, then the keys, then look east: " + ord.map(m => m.t === "look" ? "look " + m.yaw : "input").join(", ").slice(0, 120));
        check(/^look: facing N/.test(bb.actuator.results[0] || "") && /^move:/.test(bb.actuator.results[1] || "") && /^look: facing E/.test(bb.actuator.results[2] || ""), "and the results come back in that order: " + JSON.stringify(bb.actuator.results.map(r => r.slice(0, 20))));
        // key frames name the ledge ahead and where it begins
        relay.teleport({ x: 340.5, y: 64, z: 340.5 }); relay.setRotation({ x: 0, y: 0 });
        for (let dx = -3; dx <= 3; dx++) for (let dz = 2; dz <= 8; dz++) overworld._set(340 + dx, 64, 340 + dz, "minecraft:dirt");
        const keyFrom = otherMsgs.length;
        bb.actuator.enqueue([{ type: "move", direction: "forward", seconds: 0.4 }]);
        await run(14);
        const keyFrames = otherMsgs.slice(keyFrom).filter(m => m.t === "input");
        check(keyFrames.length >= 2 && keyFrames.every(m => m.floor === 65 && m.ed > 0.9 && m.ed < 1.8 && m.f === 1 && m.fg === 1), "key frames carry the level of the ledge ahead and the distance to it: " + JSON.stringify(keyFrames[0]));
        bb.actuator.stopAll(); await run(5);
        for (let dx = -3; dx <= 3; dx++) for (let dz = 2; dz <= 8; dz++) overworld._set(340 + dx, 64, 340 + dz, "minecraft:air");
        // too hungry to sprint: the game would refuse, so the body must not claim it
        const hungerNow = relay.getComponent("minecraft:player.hunger");
        const hungerWas = hungerNow.currentValue; hungerNow.setCurrentValue(5);
        relay.teleport({ x: 350.5, y: 64, z: 350.5 });
        const hungFrom = otherMsgs.length;
        bb.actuator.enqueue([{ type: "move", direction: "forward", seconds: 0.3, sprint: true }]);
        await run(10);
        const hungFrames = otherMsgs.slice(hungFrom).filter(m => m.t === "input");
        check(hungFrames.length >= 1 && hungFrames.every(m => m.sprint === false), "at five hunger points it does not sprint");
        bb.actuator.stopAll(); await run(5);
        hungerNow.setCurrentValue(hungerWas);
        // interrupted half way round, look_around faces the way it faced before
        relay.setRotation({ x: 0, y: 90 });
        bb.actuator.stopAll(); await run(2);
        const roundFrom = otherMsgs.length;
        bb.actuator.enqueue([{ type: "look_around" }]);
        await run(22);                       // started on the next supervision tick, a few compass points in
        bb.actuator.stopAll(); await run(3);
        const roundLooks = otherMsgs.slice(roundFrom).filter(m => m.t === "look");
        check(roundLooks.length >= 2 && Math.abs(roundLooks[roundLooks.length - 1].yaw - 90) < 1, "and when it is interrupted it turns back: " + roundLooks.map(m => m.yaw).join(", "));
        fromBridge({ t: "hello", v: 1, name: "RealAIBridge", version: "0.1.0", providers: ["anthropic", "openai", "xai", "gemini", "ollama", "lmstudio", "player2"] });
        await run(40);
    }
}
// Tenth cycle: reflexes and death. Hit by a zombie, the bridge body fights back within a tick; a
// creeper closing in makes it run; on fire it heads for water; when it dies it keeps its brain,
// remembers where its things fell, and knows where to go once it has respawned.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        const bbResults2 = [];
        const origDrain2 = bb.actuator.drainResults.bind(bb.actuator);
        bb.actuator.drainResults = () => { const r = origDrain2(); bbResults2.push(...r); return r; };
        relay.teleport({ x: 400.5, y: 64, z: 400.5 });
        bb.actuator.stopAll(); await run(30);
        const zombie = overworld.spawnEntity("minecraft:zombie", { x: 402, y: 64, z: 400.5 });
        relay.applyDamage(3, { cause: "entityAttack", damagingEntity: zombie });
        await run(15);
        const cur = bb.actuator.current;
        check(cur && cur.action.type === "attack" && /zombie/.test(cur.action.name), "hit by a zombie, it fights back at once: " + (cur ? cur.action.type + " " + cur.action.name : "nothing"));
        check(bb.sched.pending.some(e => e.type === "hurt" && /fighting back/.test(e.text)), "and the model is told so on its next turn");
        await run(600, 10, () => !zombie.isValid);
        check(!zombie.isValid, "and kills it");
        await run(60, 10, () => !bb.actuator.current);
        const creeper = overworld.spawnEntity("minecraft:creeper", { x: 403, y: 64, z: 400.5 });
        await run(40, 5, () => bb.actuator.current?.action.type === "flee");
        check(bb.actuator.current?.action.type === "flee", "a creeper closing in makes it run: " + (bb.actuator.current ? bb.actuator.current.action.type : "nothing"));
        creeper.remove();
        await run(300, 10, () => !bb.actuator.current);
        // on fire, with a pond ten blocks east: it heads for the water
        relay.teleport({ x: 400.5, y: 64, z: 400.5 }); bb.actuator.stopAll(); await run(30);
        for (let dx = 8; dx <= 10; dx++) for (let dz = -1; dz <= 1; dz++) overworld._set(400 + dx, 63, 400 + dz, "minecraft:water");
        relay.components["minecraft:onfire"] = {};
        await run(40, 5, () => bb.actuator.current?.action.type === "move_to");
        const mv = bb.actuator.current;
        check(mv && mv.action.type === "move_to" && mv.action.x >= 407 && mv.action.x <= 411, "on fire it runs for the water: " + (mv ? JSON.stringify(mv.action) : "nothing"));
        delete relay.components["minecraft:onfire"];
        await run(400, 10, () => !bb.actuator.current);
        // death: the brain stays with the body, the loss is remembered, the respawn is announced to it
        const killer = overworld.spawnEntity("minecraft:skeleton", { x: 404, y: 64, z: 404 });
        const deathLoc = { ...relay.location };
        relay.applyDamage(100, { cause: "entityAttack", damagingEntity: killer });
        await run(10);
        check(gate.getBrain(relay.id) === bb && bb.dead === true, "a dead player body keeps its brain and waits");
        check(bb.memory.facts.some(f => new RegExp(`I died at ${Math.floor(deathLoc.x)} ${Math.floor(deathLoc.y)} ${Math.floor(deathLoc.z)}`).test(f.text)), "and remembers where its things fell: " + bb.memory.facts.slice(-1).map(f => f.text));
        check(!bb.actuator.current && !bb.actuator.queue.length, "nothing runs while dead");
        const seenEvents = [];
        const origNote = bb.noteEvent.bind(bb);
        bb.noteEvent = (type, text) => { seenEvents.push({ type, text }); return origNote(type, text); };
        relay.respawn({ x: 0.5, y: 64, z: 0.5 });
        await run(20);
        bb.noteEvent = origNote;
        check(bb.dead === false && seenEvents.some(e => e.type === "death" && /respawned/.test(e.text) && /items/.test(e.text)), "after respawning it knows where to go for its items: " + seenEvents.filter(e => e.type === "death").map(e => e.text).slice(-1));
        check(gate.allBrains().size === [...gate.allBrains().values()].length && gate.getBrain(relay.id) === bb, "no second brain was made for the body");
        killer.remove();
    }
}
// Eleventh cycle: faster than a decision. The body paths around a built wall instead of digging,
// hits a zombie on every damage-immunity beat, eats by itself when hungry, puts on armour it
// finds, pours water under itself when falling, and asks the model sooner while in danger.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        const bbResults3 = [];
        const origDrain3 = bb.actuator.drainResults.bind(bb.actuator);
        bb.actuator.drainResults = () => { const r = origDrain3(); bbResults3.push(...r); return r; };
        const act = (...a) => { if (bb.actuator.current?.action.type === "wait") bb.actuator.finish("wait cancelled"); bb.actuator.enqueue(a); };
        const idle = () => !bb.actuator.current && !bb.actuator.queue.length;
        const cx = 500, cz = 500;
        relay.teleport({ x: cx + 0.5, y: 64, z: cz + 0.5 }); bb.actuator.stopAll(); await run(20);
        // someone's stone-brick wall, two high and nine long, between the body and a spot ten blocks west
        for (let dz = -4; dz <= 4; dz++) for (let y = 64; y <= 65; y++) overworld._set(cx - 4, y, cz + dz, "minecraft:stone_bricks");
        act({ type: "move_to", x: cx - 10, y: 64, z: cz });
        await run(900, 10, idle);
        check(Math.hypot(relay.location.x - (cx - 10 + 0.5), relay.location.z - (cz + 0.5)) < 2.5, "it walks round a built wall: " + JSON.stringify(relay.location) + " " + bbResults3.slice(-1));
        check([-4, 0, 4].every(dz => overworld.getBlock({ x: cx - 4, y: 64, z: cz + dz }).typeId === "minecraft:stone_bricks"), "and leaves the wall alone");
        // combat on the beat: a zombie (20 hp) hit bare-handed (2) dies in ten hits, one every ten ticks
        const zombie = overworld.spawnEntity("minecraft:zombie", { x: relay.location.x + 2, y: 64, z: relay.location.z });
        const t0 = system.currentTick;
        relay.applyDamage(2, { cause: "entityAttack", damagingEntity: zombie });
        await run(200, 2, () => !zombie.isValid);
        const took = system.currentTick - t0;
        check(!zombie.isValid && took <= 130, `the zombie is dead in ${took} ticks (ten hits on the immunity beat)`);
        check(bb.dangerUntil > t0, "danger is noted so the model is asked sooner");
        await run(40, 10, idle);
        // hungry with bread in the bag and nothing around: eats without being told
        const hungerComp = relay.getComponent("minecraft:player.hunger"); hungerComp.setCurrentValue(10);
        relay.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:bread", 1));
        await run(120, 10, () => hungerComp.currentValue > 10);
        check(hungerComp.currentValue === 15, "it eats by itself when hungry: hunger " + hungerComp.currentValue);
        // iron armour in the bag: worn within two seconds
        relay.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:iron_chestplate", 1));
        await run(60, 10, () => log.commands.some(c => /replaceitem entity @s slot.armor.chest 0 minecraft:iron_chestplate/.test(c)));
        check(log.commands.some(c => /slot.armor.chest 0 minecraft:iron_chestplate/.test(c)), "armour it finds goes on by itself");
        // falling fast with a water bucket: water lands first
        relay.getComponent("minecraft:inventory").container.addItem(new ItemStack("minecraft:water_bucket", 1));
        relay.teleport({ x: cx + 0.5, y: 67, z: cz + 20.5 });
        relay.velocity = { x: 0, y: -0.9, z: 0 };
        await run(5, 1, () => overworld.getBlock({ x: cx, y: 64, z: cz + 20 }).typeId === "minecraft:water");
        check(overworld.getBlock({ x: cx, y: 64, z: cz + 20 }).typeId === "minecraft:water", "a water bucket breaks the fall");
        relay.velocity = { x: 0, y: 0, z: 0 };
    }
}
// Twelfth cycle: its own things. What the body builds and the chests it fills are remembered as
// its own; when a player breaks its wall or opens its chest it is told and may react as it likes;
// a full bag is pointed out; waiting with plans pending is pointed out.
{
    const bb = gate.getBrain(relay.id);
    if (bb) {
        const act = (...a) => { if (bb.actuator.current?.action.type === "wait") bb.actuator.finish("wait cancelled"); bb.actuator.enqueue(a); };
        const idle = () => !bb.actuator.current && !bb.actuator.queue.length;
        const seen = [];
        const origNote = bb.noteEvent.bind(bb);
        bb.noteEvent = (type, text) => { seen.push({ type, text }); return origNote(type, text); };
        const ox = 600, oz = 600;
        relay.teleport({ x: ox + 0.5, y: 64, z: oz + 0.5 }); bb.actuator.stopAll(); await run(20);
        const inv = relay.getComponent("minecraft:inventory").container;
        for (let i = 0; i < 3; i++) inv.addItem(new ItemStack("minecraft:oak_planks", 64));
        act({ type: "build", preset: "wall", material: "oak_planks", width: 5, height: 2 });
        await run(1500, 10, idle);
        check(bb.memory.builds.some(b => /wall/.test(b.name)), "a finished build is one of its things: " + JSON.stringify(bb.memory.builds.slice(-1)));
        const wall = bb.memory.builds[bb.memory.builds.length - 1];
        inv.addItem(new ItemStack("minecraft:chest", 1));
        act({ type: "place_block", block: "chest", x: ox + 2, y: 64, z: oz - 2 });
        await run(300, 10, idle);
        check(overworld.getBlock({ x: ox + 2, y: 64, z: oz - 2 }).typeId === "minecraft:chest" && bb.memory.chests.some(c => c.x === ox + 2 && c.z === oz - 2), "a chest it places is one of its things");
        inv.addItem(new ItemStack("minecraft:coal", 20));
        act({ type: "open_container", x: ox + 2, y: 64, z: oz - 2, mode: "store", items: ["coal"] });
        await run(300, 10, idle);
        const chest = bb.memory.chests.find(c => c.x === ox + 2 && c.z === oz - 2);
        check(chest && chest.items.some(i => /coal x20/.test(i)), "and it knows what it put inside: " + JSON.stringify(chest && chest.items));
        check(/my chest at .* coal x20/.test(renderMemory(bb.memory, Date.now())) && /my wall at/.test(renderMemory(bb.memory, Date.now())), "its things are listed in its memory");
        // Steve breaks a block of the wall and opens the chest
        seen.length = 0;
        const wb = overworld.getBlock({ x: wall.x1, y: wall.y1, z: wall.z1 });
        world.afterEvents.playerBreakBlock.emit({ player: steve, block: wb, brokenBlockPermutation: {}, dimension: overworld });
        world.afterEvents.playerInteractWithBlock.emit({ player: steve, block: overworld.getBlock({ x: ox + 2, y: 64, z: oz - 2 }) });
        await run(5);
        check(seen.some(e => e.type === "home_touched" && /Steve broke .* your wall/.test(e.text) && /yours to deal with/.test(e.text)), "it is told when Steve breaks its wall: " + seen.map(e => e.text).join(" | "));
        check(seen.some(e => e.type === "home_touched" && /Steve opened your chest/.test(e.text) && /coal x20/.test(e.text)), "and when Steve opens its chest");
        check(bb.memory.people.Steve && /opened my chest|broke/.test(bb.memory.people.Steve.note || ""), "and remembers who did it: " + JSON.stringify(bb.memory.people.Steve));
        // a nearly full bag is pointed out once
        seen.length = 0;
        for (let i = 0; i < 36; i++) inv.addItem(new ItemStack("minecraft:cobblestone", 1));
        for (let i = 0; i < inv.size; i++) if (!inv.getItem(i)) inv.setItem(i, new ItemStack("minecraft:dirt", 1));
        await run(120);
        check(seen.filter(e => /inventory is nearly full/.test(e.text)).length === 1, "a full bag is pointed out once: " + seen.filter(e => /full/.test(e.text)).length);
        for (let i = 0; i < inv.size; i++) inv.setItem(i, undefined);
        // waiting with plans pending is pointed out on the next turn
        bb.memory.plans = ["gather 16 oak logs for a bigger house"];
        bb.actuator.stopAll(); await run(5);
        captured = null; wanted = msg => msg.bot === bb.id; bb.request("anything?"); await run(200, 5, () => !!captured);
        if (captured) fromBridge({ t: "result", turnId: captured.turnId, ok: true, text: JSON.stringify({ thought: "nothing", say: "", say_to: "", mood: "", goal: "", actions: [{ type: "wait", seconds: 20 }], remember: [], forget: [] }), usage: { input: 1, output: 1 }, model: "mock", provider: "anthropic", attempts: 1 });
        captured = null; wanted = null; await run(10);
        check(bb.problems.some(p => /your plan says "gather 16 oak logs/.test(p)), "waiting with plans pending is pointed out: " + bb.problems.slice(-1));
        bb.noteEvent = origNote;
    }
}
// Thirteenth cycle: nobody steers it. Commands that would pause, walk, wipe or instruct the AI
// are refused while it is independent (the default); talking and looking still work; the bridge's
// config can turn it off, and then the same commands work.
{
    const bb = gate.getBrain(relay.id);
    const { handleCommand } = await import("../../packs/RealAI_BP/scripts/brain/commands.js");
    if (bb) {
        const { DEFAULTS } = await import("../../packs/RealAI_BP/scripts/brain/config.js");
        check(DEFAULTS.independent === true, "independent is the default");
        uwc({ independent: true }); bb.systemCache = null;
        const sys13 = bb.systemPrompt();
        check(/Nobody in this world can command you/.test(sys13), "its rules say nobody commands it");
        uwc({ serverRules: "always speak French" }); bb.systemCache = null;
        check(!/speak French/.test(bb.systemPrompt()), "server rules are not injected while it is independent");
        uwc({ serverRules: "" }); bb.systemCache = null;
        const before = steve.messages.length;
        handleCommand(steve, `!ai walk ${relay.name} 5 0`);
        handleCommand(steve, "!ai pause");
        handleCommand(steve, `!ai forget ${relay.name}`);
        handleCommand(steve, "!ai rules be nice");
        handleCommand(steve, "!ai summon Bob a builder");
        const replies = steve.messages.slice(before);
        check(replies.length === 5 && replies.every(m => /runs its own life/.test(m)), "walk, pause, forget, rules and summon are refused: " + replies[0]);
        check(bb.memory.facts.length > 0 && !bb.paused, "nothing was wiped or paused");
        handleCommand(steve, `!ai where ${relay.name}`);
        check(/at .* in overworld/.test(steve.messages.slice(-2).join(" ")), "looking is still allowed: " + steve.messages.slice(-2)[0]);
        handleCommand(steve, `!ai talk ${relay.name} hello there`);
        check(bb.chatBuffer.some(c => /hello there/.test(c.text)), "talking is still allowed");
        // !ai body asks the bridge how it sees the body and prints the answer
        const bodyAsks = otherMsgs.filter(m => m.t === "body_status").length;
        handleCommand(steve, "!ai body");
        await run(5);
        check(otherMsgs.filter(m => m.t === "body_status").length === bodyAsks + 1, "!ai body asks the bridge for its body report");
        fromBridge({ t: "body", ready: true, alive: true, pos: { x: 1, y: 64, z: 2 }, yaw: 90, pitch: 0, onGround: true, walking: false, keys: { f: 1, s: 0, sprint: true, sneak: false, jump: false }, corrections: 3, teleports: 0, resyncs: 1, tick: 500, startIsEye: true, calibrated: true, gameMode: "survival" });
        await run(70);
        const bodyText = steve.messages.slice(-6).join("\n");
        check(/body \(as the bridge/.test(bodyText) && /3 corrections/.test(bodyText) && /holding keys f1/.test(bodyText), "and prints it: " + bodyText.split("\n").slice(0, 3).join(" | ").slice(0, 160));
        // the bridge's config pins the setting: with independent false the same commands work
        fromBridge({ t: "hello", v: 2, name: "RealAIBridge", version: "0.2.0", body: 0, independent: false, providers: ["anthropic", "openai", "xai", "gemini", "ollama", "lmstudio", "player2"] });
        await run(40);
        check(gwc().independent === false && brainMod.manager.independentPinned === true, "the bridge's config can switch it off and pins it");
        check(steve.messages.slice(-12).some(m => /older version .* cannot walk its account's body/.test(m)), "a bridge without body control is reported to the operators");
        handleCommand(steve, "!ai independent on");
        check(/pinned by the bridge/.test(steve.messages.slice(-1)[0]) && gwc().independent === false, "in game it cannot be changed while pinned");
        bb.actuator.stopAll();
        handleCommand(steve, `!ai walk ${relay.name} 3 0`);
        await run(10);
        check(bb.actuator.current?.action.type === "move_to" || bb.actuator.queue.some(a => a.type === "move_to"), "with independence off the walk command works");
        bb.actuator.stopAll();
        fromBridge({ t: "hello", v: 2, name: "RealAIBridge", version: "0.2.0", body: 0, independent: true, providers: ["anthropic", "openai", "xai", "gemini", "ollama", "lmstudio", "player2"] });
        await run(40);
        check(gwc().independent === true, "and back on");
    }
}
// Fourteenth cycle: sight. The AI's turn carries a picture of what its eyes show; `!ai see` prints it.
{
    const bb = gate.getBrain(relay.id);
    const { handleCommand } = await import("../../packs/RealAI_BP/scripts/brain/commands.js");
    const { observe } = await import("../../packs/RealAI_BP/scripts/brain/perception.js");
    const { renderObservation } = await import("../../packs/RealAI_BP/scripts/brain/prompt.js");
    if (bb) {
        const sx = 900, sz = 900;
        const overworld14 = world.getDimension("overworld");
        for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 12; dz++) for (let y = 64; y <= 70; y++) overworld14._set(sx + dx, y, sz + dz, "minecraft:air");
        bb.actuator.stopAll();
        relay.teleport({ x: sx + 0.5, y: 64, z: sz + 0.5 }); relay.setRotation({ x: 0, y: 0 });                // facing south
        for (let y = 64; y <= 66; y++) overworld14._set(sx + 3, y, sz + 6, "minecraft:oak_log");                 // a tree ahead, to the left
        const cow = overworld14.spawnEntity("minecraft:cow", { x: sx + 0.5, y: 64, z: sz + 5.5 });
        const obs = observe(relay, bb, {});
        check(typeof obs.sight === "string" && /^Sight: facing S/.test(obs.sight), "an observation carries the AI's sight: " + String(obs.sight).slice(0, 60));
        const pictureRows = obs.sight.split("\n").slice(2).filter(l => !/^(In view|Legend)/.test(l));
        check(pictureRows.length === 13, "thirteen rows of picture: " + pictureRows.length);
        check(pictureRows.some(r => r.includes("T")) && /In view: a (cow|Cow)/.test(obs.sight), "the tree and the cow are in the picture:\n" + obs.sight);
        check(/\nSight: facing S/.test(renderObservation(obs)), "the prompt text includes it");
        // looking away moves the picture; the cow is no longer in it
        relay.setRotation({ x: 0, y: 180 });
        check(!/In view: .*cow/i.test(observe(relay, bb, {}).sight), "turned round, the cow is behind it");
        relay.setRotation({ x: 0, y: 0 });
        // !ai see prints the same picture
        const m0 = steve.messages.length;
        handleCommand(steve, `!ai see ${relay.name}`);
        const seeText = steve.messages.slice(m0).join("\n");
        check(/sees/.test(seeText) && /Sight: facing S/.test(seeText) && /> /.test(seeText), "!ai see prints the picture: " + seeText.slice(0, 120));
        cow.remove();
    }
}
check(log.errors.length === 0, "no engine-level errors after lifecycle: " + log.errors.slice(0, 3).join(" | "));
const lateWarnings = log.warnings.filter(w => /\[RealAI\]/.test(w) && !/started|connected|unavailable|quota exceeded/.test(w));
check(lateWarnings.length === 0, "no late [RealAI] warnings: " + lateWarnings.slice(0, 3).join(" | "));

if (fails.length) { console.log("\nFAILED:\n - " + fails.join("\n - ")); console.log("\nwarnings:\n" + log.warnings.slice(0, 15).join("\n")); process.exit(1); }
console.log(`\nsmoke OK (${seenThinks.length} think requests answered, ${log.commands.length} commands)`);
process.exit(0);
