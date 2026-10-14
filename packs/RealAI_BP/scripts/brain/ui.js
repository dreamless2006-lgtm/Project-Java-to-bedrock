// The Real AI hub: a Bedrock port of the Player2NPC hub screen as
// server-ui forms. Tabs: Getting Started, Companions, Behavior, Budget,
// Access Lists, Mod Intelligence, AI & Memory, Profiles & Models.
import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { manager, isOperator, budget } from "./core.js";
import { allBrains } from "./gate.js";
import { getWorldConfig, updateWorldConfig, patchBotSettings, configuredProviders } from "./config.js";
import { PROVIDERS, PROVIDER_IDS } from "./providers/index.js";
import { formatUsd } from "./budget.js";
import { renderMemory } from "./memory.js";
import { worldContent, nameOf } from "./world_content.js";
import { transportInfo } from "./transport.js";
import { EDITION } from "./net_impl.js";

export const HUB_ITEM = "rg:friend_list_opener";   // the existing "Friend List" item also opens the hub (sneak + use)
const ACCESS_KEY = "realai:access";

function later(fn) { system.run(() => { try { fn(); } catch (e) { console.warn("[RealAI] ui", e); } }); }

export function showHub(player) {
    const s = manager.status();
    const f = new ActionFormData().title("§l§bReal AI");
    f.body(`Brains: ${s.enabled ? "§aon" : "§coff"}§r | ${s.transport.direct ? "direct http" : s.transport.bridgeConnected ? "bridge: " + s.transport.bridgePlayer : "§cno transport"}§r | ${s.provider}${s.model !== "(default)" ? "/" + s.model : ""}\nBudget ${s.budget.level}: ${formatUsd(s.budget.windowUsd)} this window\n${s.configProblem ? "§c" + s.configProblem : ""}`);
    f.button("Getting Started", "textures/items/book_writable");
    f.button("Companions", "textures/items/friends");
    f.button("Behavior", "textures/ui/icon_setting");
    f.button("Budget & Tokens", "textures/items/emerald");
    f.button("Access Lists", "textures/items/online");
    f.button("Mod Intelligence", "textures/items/coords");
    f.button("AI & Memory", "textures/items/paper");
    f.button("Profiles & Models", "textures/items/clock_item");
    f.button("Bots near me", "textures/items/assist");
    f.show(player).then(r => {
        if (r.canceled) return;
        const go = [showGettingStarted, showCompanions, showBehavior, showBudget, showAccessLists, showModIntelligence, showMemoryTab, showProfiles, showNearby][r.selection];
        later(() => go(player));
    }).catch(e => console.warn("[RealAI] hub", e));
}

function showGettingStarted(player) {
    const t = transportInfo();
    const cfg = getWorldConfig();
    const lines = [
        "§lWhat this is§r\nEvery bot in this world can be a real AI player: it sees, talks, builds, mines, crafts, fights and travels between dimensions. The brain runs on a language model (Claude, ChatGPT, Grok, Gemini, Player2 or a local model).",
        cfg.worldPlayers > 0
            ? `§lWho lives here§r\nThe bridge account's player is an AI player in person, plus ${cfg.worldPlayers} named residents (Behavior tab to change). Residents join a few seconds after you do, remember you between sessions and respawn like players. §b!ai status§r lists everyone.`
            : "§lWho lives here§r\nThe AI plays through the bridge account's own player: when the bridge connects, that player comes alive and lives here in person. Want more AI players? Set residents in the Behavior tab or §b!ai players 4§r; each extra resident costs model calls.",
        "§lHow to talk to bots§r\nJust chat. Bots within earshot hear you and answer by name. Use §b!ai talk <Name> <message>§r to whisper. Turn on call-by-name in Behavior to make bots answer only when named.",
        `§lHow the brain connects§r\nBuild: ${EDITION}. ${t.direct ? "This server calls the model directly (dedicated server, server-net)." : "This world cannot make HTTP calls itself, so run the Real AI bridge (bridge/ folder, node index.mjs) with your API key; it joins as a player and relays thinking."} ${t.bridgeConnected ? `Bridge connected as ${t.bridgePlayer}.` : "No bridge connected right now."}`,
        "§lCompanions§r\nSummon a bot bound to you with §b!ai summon <Name> [description]§r or from the Companions tab. Companions remember you, follow reasonable requests and keep their memory across deaths.",
        "§lOut of budget?§r\nThe Budget tab shows token spend per window; soft limit slows thinking, hard limit pauses it. Cheaper models (Haiku, GPT mini, Flash, Grok fast) make bots far cheaper.",
    ];
    new MessageFormData().title("Getting Started").body(lines.join("\n\n")).button1("Back").button2("Close").show(player).then(r => { if (!r.canceled && r.selection === 0) later(() => showHub(player)); });
}

function showCompanions(player) {
    const mine = manager.companionsOf(player);
    const f = new ActionFormData().title("My Squad").body(`Stored: ${(() => { try { return JSON.parse(player.getDynamicProperty("realai:companions") || "[]").length; } catch (e) { return 0; } })()}  Live: ${mine.length}`);
    f.button("§aSummon a new companion", "textures/items/friend_request");
    for (const b of mine) f.button(`${b.name}\n§7${b.status().current || b.memory.goal || "idle"}`, "textures/items/friends");
    f.button("§cBack");
    f.show(player).then(r => {
        if (r.canceled) return;
        if (r.selection === 0) return later(() => summonForm(player));
        if (r.selection === mine.length + 1) return later(() => showHub(player));
        later(() => companionDetail(player, mine[r.selection - 1]));
    });
}

function summonForm(player) {
    const f = new ModalFormData().title("Summon companion");
    f.textField("Name", "e.g. Ellie");
    f.textField("Who they are (optional)", "a cheerful builder who loves redstone");
    f.textField("Personality (optional)", "brave, sarcastic, loyal");
    f.textField("Extra instructions (optional)", "always keep torches on you");
    f.show(player).then(r => {
        if (r.canceled) return;
        const [name, description, personality, additionalPrompt] = r.formValues;
        if (!name) return player.sendMessage("§cgive your companion a name");
        if (manager.companionsOf(player).length >= 4 && !isOperator(player)) return player.sendMessage("§cyou already have 4 companions");
        const res = manager.summon(player, { name, description, personality, additionalPrompt });
        player.sendMessage(res.ok ? `§asummoned ${res.name}` : `§c${res.error}`);
    });
}

function companionDetail(player, b) {
    const st = b.status();
    const f = new ActionFormData().title(b.name).body(`Status: ${st.paused ? "paused" : "thinking"} (${st.thinks} turns)\nGoal: ${st.goal || "none"}\nDoing: ${st.current || "idle"}\nProvider: ${st.provider}\n${st.lastError ? "§cLast error: " + st.lastError : ""}`);
    f.button("Whistle (come here)", "textures/items/coords");
    f.button("Talk", "textures/ui/icon_chat");
    f.button("Memory", "textures/items/paper");
    f.button("Additional prompt", "textures/items/book_writable");
    f.button(b.paused ? "Resume" : "Pause", "textures/ui/icon_setting");
    f.button("§cDespawn", "textures/ui/icon_trash");
    f.button("Back");
    f.show(player).then(r => {
        if (r.canceled) return;
        switch (r.selection) {
            case 0: b.actuator.enqueueFront({ type: "go_to_player", name: player.name }); b.request(`${player.name} whistled for you`); player.sendMessage(`§7${b.name} is coming.`); break;
            case 1: later(() => talkForm(player, b)); break;
            case 2: later(() => memoryView(player, b)); break;
            case 3: later(() => promptForm(player, b)); break;
            case 4: b.paused = !b.paused; patchBotSettings(b.bot, { mode: b.paused ? "paused" : "companion" }); if (b.paused) b.actuator.stopAll(); player.sendMessage(`§7${b.name} ${b.paused ? "paused" : "resumed"}`); break;
            case 5: manager.despawn(b.bot); player.sendMessage(`§7${b.name} left.`); break;
            default: later(() => showCompanions(player));
        }
    });
}

function talkForm(player, b) {
    const f = new ModalFormData().title(`Talk to ${b.name}`);
    f.textField("Message", "say something");
    f.show(player).then(r => {
        if (r.canceled || !r.formValues[0]) return;
        b.hearChat(player.name, String(r.formValues[0]), { whisper: true });
        player.sendMessage(`§7(you whisper to ${b.name}) ${r.formValues[0]}`);
    });
}

function memoryView(player, b) {
    new MessageFormData().title(`${b.name}'s memory`).body(renderMemory(b.memory, Date.now(), { facts: 16, episodes: 8, chat: 6 }) || "(nothing yet)").button1("Forget everything").button2("Back").show(player).then(r => {
        if (r.canceled) return;
        if (r.selection === 0) { b.memory.facts = []; b.memory.episodes = []; b.memory.chat = []; b.memory.people = {}; b.history = []; b.saveMemory(); player.sendMessage(`§7${b.name} forgot everything.`); }
        else later(() => companionDetail(player, b));
    });
}

function promptForm(player, b) {
    const f = new ModalFormData().title(`${b.name}: additional prompt`);
    f.textField("Extra instructions for this bot (max 500 chars)", "e.g. never go to the Nether", { defaultValue: b.settings.persona?.additionalPrompt || "" });
    f.show(player).then(r => {
        if (r.canceled) return;
        const persona = { ...(b.settings.persona || {}), additionalPrompt: String(r.formValues[0] || "").slice(0, 500) };
        b.settings = patchBotSettings(b.bot, { persona });
        b.systemCache = null;
        player.sendMessage("§asaved");
    });
}

function showBehavior(player) {
    const cfg = getWorldConfig();
    const op = isOperator(player);
    const f = new ModalFormData().title("Behavior");
    f.dropdown("Chat volume", ["Silent", "Quiet", "Normal", "Chatty"], { defaultValueIndex: cfg.chatVolume });
    f.toggle("Call-by-name chat (bots only answer when named)", { defaultValue: !!cfg.callByName });
    f.dropdown("Autonomy", ["Full (every bot thinks)", "Companions only", "Off"], { defaultValueIndex: ["full", "companions_only", "off"].indexOf(cfg.autonomy) });
    f.slider("AI players living in this world (they join when you do)", 0, 16, { valueStep: 1, defaultValue: cfg.worldPlayers });
    f.toggle("Extra wild bots far from players (original spawner)", { defaultValue: !!cfg.wildSpawns });
    f.toggle("Spread residents across every provider with a key", { defaultValue: !!cfg.mixProviders });
    f.toggle("Show bots' thoughts and chosen actions in chat", { defaultValue: !!cfg.showThoughts });
    f.slider("Max thinking bots", 0, 30, { valueStep: 1, defaultValue: cfg.maxBrains });
    f.slider("Idle think interval (s)", 10, 180, { valueStep: 5, defaultValue: cfg.thinkIdleSec });
    f.toggle("Free building (blocks without inventory)", { defaultValue: !!cfg.freeBuild });
    f.toggle("Keep bots ticking when nobody is online (dedicated server)", { defaultValue: !!cfg.keepAlive });
    f.toggle("Legacy fake-player chat simulator", { defaultValue: !!cfg.legacyFakeChat });
    f.dropdown("When a companion dies", ["Respawn next to its owner", "Permadeath"], { defaultValueIndex: cfg.companionDeath === "permadeath" ? 1 : 0 });
    f.toggle("Companions come to their owner on join", { defaultValue: !!cfg.companionJoinTeleport });
    f.textField("Server rules for every bot", "e.g. no PvP, speak Spanish", { defaultValue: cfg.serverRules || "" });
    f.show(player).then(r => {
        if (r.canceled) return;
        if (!op) return player.sendMessage("§coperator permission required");
        const [vol, cbn, auto, worldPlayers, wild, mix, thoughts, maxBrains, idle, freeBuild, keepAlive, fake, death, joinTp, rules] = r.formValues;
        updateWorldConfig({ chatVolume: Number(vol), callByName: !!cbn, autonomy: ["full", "companions_only", "off"][Number(auto)], worldPlayers: Number(worldPlayers), wildSpawns: !!wild, mixProviders: !!mix, showThoughts: !!thoughts, maxBrains: Number(maxBrains), thinkIdleSec: Number(idle), freeBuild: !!freeBuild, keepAlive: !!keepAlive, legacyFakeChat: !!fake, companionDeath: Number(death) === 1 ? "permadeath" : "respawn", companionJoinTeleport: !!joinTp, serverRules: String(rules || "").slice(0, 600) });
        for (const [, b] of allBrains()) b.systemCache = null;
        manager.refreshEnabled();
        manager.populate("menu", player);
        player.sendMessage("§abehaviour saved");
    });
}

function showBudget(player) {
    const s = budget.status();
    const cfg = getWorldConfig();
    const f = new ModalFormData().title("Budget & Tokens");
    f.label(`Level: ${s.level}\nThis window (${s.windowMinutes} min): ${s.windowTokens} tokens, ${s.windowCalls} calls, ${formatUsd(s.windowUsd)}\nLifetime: ${s.lifetimeTokens} tokens, ${formatUsd(s.lifetimeUsd)}`);
    f.slider("Soft limit (thousand tokens per window)", 0, 5000, { valueStep: 50, defaultValue: Math.round(cfg.budget.softTokens / 1000) });
    f.slider("Hard limit (thousand tokens per window)", 0, 10000, { valueStep: 100, defaultValue: Math.round(cfg.budget.hardTokens / 1000) });
    f.slider("Window (minutes)", 5, 1440, { valueStep: 5, defaultValue: cfg.budget.windowMinutes });
    f.toggle("Reset the current window now", { defaultValue: false });
    f.show(player).then(r => {
        if (r.canceled) return;
        if (!isOperator(player)) return player.sendMessage("§coperator permission required");
        const [, soft, hard, win, reset] = r.formValues;
        updateWorldConfig({ budget: { softTokens: Number(soft) * 1000, hardTokens: Number(hard) * 1000, windowMinutes: Number(win) } });
        budget.setLimits(getWorldConfig().budget);
        if (reset) budget.reset();
        player.sendMessage("§abudget saved");
    });
}

export function getAccessLists() {
    try { const raw = world.getDynamicProperty(ACCESS_KEY); if (raw) return { mode: "blacklist", users: [], bots: [], ...JSON.parse(raw) }; } catch (e) { /* ignore */ }
    return { mode: "blacklist", users: [], bots: [] };
}

export function playerAllowed(name) {
    const a = getAccessLists();
    const n = String(name).toLowerCase();
    const listed = a.users.some(u => u.toLowerCase() === n);
    return a.mode === "whitelist" ? listed : !listed;
}

function showAccessLists(player) {
    const a = getAccessLists();
    const f = new ModalFormData().title("Access Lists");
    f.label("Who may talk to and command bots. Blacklist blocks the names listed; whitelist allows only them.");
    f.dropdown("Mode", ["Blacklist", "Whitelist"], { defaultValueIndex: a.mode === "whitelist" ? 1 : 0 });
    f.textField("Player names (comma separated)", "Steve, Alex", { defaultValue: a.users.join(", ") });
    f.textField("Bot names that are muted (comma separated)", "", { defaultValue: a.bots.join(", ") });
    f.show(player).then(r => {
        if (r.canceled) return;
        if (!isOperator(player)) return player.sendMessage("§coperator permission required");
        const [, mode, users, bots] = r.formValues;
        const split = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 64);
        try { world.setDynamicProperty(ACCESS_KEY, JSON.stringify({ mode: Number(mode) === 1 ? "whitelist" : "blacklist", users: split(users), bots: split(bots) })); } catch (e) { /* ignore */ }
        player.sendMessage("§aaccess lists saved");
    });
}

function showModIntelligence(player) {
    const wc = worldContent();
    const body = [`The bots know about every non-vanilla block, item and creature registered in this world and can name, use and fight them.`, `Blocks: ${wc.counts.blocks}  Items: ${wc.counts.items}  Creatures: ${wc.counts.entities}`, "", wc.text.slice(0, 1800)].join("\n");
    new MessageFormData().title("Mod Intelligence").body(body).button1("Back").button2("Close").show(player).then(r => { if (!r.canceled && r.selection === 0) later(() => showHub(player)); });
}

function showMemoryTab(player) {
    const brains = [...allBrains().values()].filter(b => { try { return b.bot.isValid; } catch (e) { return false; } });
    const f = new ActionFormData().title("AI & Memory").body("Pick a bot to read or clear what it remembers.");
    for (const b of brains) f.button(`${b.name}\n§7${b.memory.facts.length} facts, ${Object.keys(b.memory.people).length} people`);
    f.button("§cBack");
    f.show(player).then(r => { if (r.canceled) return; if (r.selection >= brains.length) return later(() => showHub(player)); later(() => memoryView(player, brains[r.selection])); });
}

function showProfiles(player) {
    const cfg = getWorldConfig();
    const t = transportInfo();
    const provs = configuredProviders();
    const f = new ModalFormData().title("Profiles & Models");
    f.label(`Transport: ${t.direct ? "direct (server-net)" : "bridge"}${t.bridgeConnected ? " connected as " + t.bridgePlayer : ""}\nKeys: ${provs.map(p => `${p.id}${p.hasKey === true ? " ok" : p.hasKey === false ? " missing" : ""}`).join(", ")}\nKeys live in the server's secrets.json or the bridge config, never in the world.`);
    f.dropdown("Provider", PROVIDER_IDS.map(id => PROVIDERS[id].label), { defaultValueIndex: Math.max(0, PROVIDER_IDS.indexOf(cfg.provider)) });
    f.textField("Model id (blank = provider default)", PROVIDERS[cfg.provider]?.defaultModel || "", { defaultValue: cfg.model || "" });
    f.dropdown("Transport", ["Auto", "Direct (server-net)", "Bridge"], { defaultValueIndex: ["auto", "direct", "bridge"].indexOf(cfg.transport) });
    f.dropdown("Reasoning effort (Claude/OpenAI)", ["low", "medium", "high"], { defaultValueIndex: Math.max(0, ["low", "medium", "high"].indexOf(cfg.effort)) });
    f.slider("Max reply tokens", 200, 2000, { valueStep: 50, defaultValue: cfg.maxTokens });
    f.show(player).then(r => {
        if (r.canceled) return;
        if (!isOperator(player)) return player.sendMessage("§coperator permission required");
        const [, prov, model, transport, effort, maxTokens] = r.formValues;
        updateWorldConfig({ provider: PROVIDER_IDS[Number(prov)], model: String(model || "").trim(), transport: ["auto", "direct", "bridge"][Number(transport)], effort: ["low", "medium", "high"][Number(effort)], maxTokens: Number(maxTokens) });
        for (const [, b] of allBrains()) b.systemCache = null;
        manager.refreshEnabled();
        player.sendMessage(`§aprovider ${PROVIDER_IDS[Number(prov)]} saved`);
    });
}

function showNearby(player) {
    const brains = [...allBrains().values()].filter(b => { try { return b.bot.isValid && b.bot.dimension.id === player.dimension.id; } catch (e) { return false; } })
        .map(b => ({ b, d: Math.hypot(b.bot.location.x - player.location.x, b.bot.location.z - player.location.z) })).sort((x, y) => x.d - y.d).slice(0, 12);
    const f = new ActionFormData().title("Bots near me").body(brains.length ? "Tap a bot." : "No thinking bots nearby.");
    for (const { b, d } of brains) f.button(`${b.name} (${Math.round(d)}m)\n§7${b.status().current || b.memory.goal || "idle"}`);
    f.button("§cBack");
    f.show(player).then(r => { if (r.canceled) return; if (r.selection >= brains.length) return later(() => showHub(player)); later(() => companionDetail(player, brains[r.selection].b)); });
}

export function startHubUI() {
    // Sneak + use the Friend List item opens the hub; plain use keeps the legacy friend list.
    try {
        world.afterEvents.itemUse.subscribe(ev => {
            try {
                if (ev.itemStack?.typeId !== HUB_ITEM) return;
                if (!ev.source?.isSneaking) return;
                later(() => showHub(ev.source));
            } catch (e) { /* ignore */ }
        });
    } catch (e) { console.warn("[RealAI] itemUse unavailable", e); }
    // Interacting with a thinking bot while sneaking opens its detail card.
    try {
        world.afterEvents.playerInteractWithEntity.subscribe(ev => {
            try {
                if (ev.target?.typeId !== "rg:bot" || !ev.player?.isSneaking) return;
                const b = allBrains().get(ev.target.id);
                if (b) later(() => companionDetail(ev.player, b));
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
}
