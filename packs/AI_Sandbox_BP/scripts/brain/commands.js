// Chat commands for operators and players: !ai ...
import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server";
import { manager, isOperator, budget } from "./core.js";
import { getBrain, allBrains } from "./gate.js";
import { getWorldConfig, updateWorldConfig, patchBotSettings, configuredProviders, serverConfigSummary } from "./config.js";
import { PROVIDERS, PROVIDER_IDS } from "./providers/index.js";
import { formatUsd } from "./budget.js";
import { findPlayer, findEntityByName } from "./actuator.js";
import { renderMemory } from "./memory.js";
import { worldContent } from "./world_content.js";
import { showHub, playerAllowed } from "./ui.js";

const HELP = [
    "§b!ai§r - open the AI Sandbox menu",
    "§b!ai status§r - transport, provider, budget and every thinking bot",
    "§b!ai summon <Name> [description]§r - summon a companion bot bound to you",
    "§b!ai despawn <Name>§r - remove one of your companions",
    "§b!ai talk <Name> <message>§r - whisper to a bot (works without the beta chat API)",
    "§b!ai memory <Name>§r | §b!ai forget <Name>§r - read or wipe a bot's memory",
    "§b!ai pause|resume [Name]§r - pause thinking (all bots or one)",
    "§7operator: §b!ai provider <id>§r, §b!ai model <name>§r, §b!ai transport auto|direct|bridge§r, §b!ai volume 0-3§r, §b!ai budget soft|hard <tokens>|reset§r, §b!ai rules <text>§r, §b!ai callbyname on|off§r, §b!ai freebuild on|off§r, §b!ai debug on|off§r, §b!ai fakechat on|off§r, §b!ai companiondeath respawn|permadeath§r, §b!ai jointeleport on|off§r, §b!ai content§r",
];

function reply(player, lines) { for (const l of [].concat(lines)) { try { player.sendMessage(l); } catch (e) { /* ignore */ } } }

function botByName(player, name) {
    if (!name) return null;
    let best = null, bestD = Infinity;
    for (const [, b] of allBrains()) {
        try {
            if (!b.bot.isValid) continue;
            if (b.name.toLowerCase() === name.toLowerCase() || b.name.toLowerCase().startsWith(name.toLowerCase())) {
                const d = b.bot.dimension.id === player.dimension.id ? Math.hypot(b.bot.location.x - player.location.x, b.bot.location.z - player.location.z) : 1e9;
                if (d < bestD) { best = b; bestD = d; }
            }
        } catch (e) { /* ignore */ }
    }
    return best;
}

export function handleCommand(player, message) {
    const parts = message.trim().split(/\s+/);
    const cmd = (parts[1] || "").toLowerCase();
    const rest = parts.slice(2);
    const op = isOperator(player);
    const cfg = getWorldConfig();
    switch (cmd) {
        case "":
        case "menu":
            system.run(() => showHub(player));
            return;
        case "help":
            return reply(player, HELP);
        case "status": {
            const s = manager.status();
            const lines = [`§b[AI Sandbox]§r edition ${s.edition}, brains ${s.enabled ? "§aON" : "§cOFF"}§r, transport: ${s.transport.direct ? "direct http" : "none"}${s.transport.bridgeConnected ? ` + bridge (${s.transport.bridgePlayer})` : ""}`,
                `provider ${s.provider} / ${s.model}; budget ${s.budget.level}: ${s.budget.windowTokens} tokens, ${formatUsd(s.budget.windowUsd)} this ${s.budget.windowMinutes}min window (lifetime ${formatUsd(s.budget.lifetimeUsd)}); modded content: ${s.worldContent.blocks} blocks, ${s.worldContent.items} items, ${s.worldContent.entities} creatures`];
            if (s.configProblem) lines.push(`§c${s.configProblem}`);
            for (const b of s.brains) lines.push(`§7- ${b.name}: ${b.paused ? "paused" : `${b.thinks} thinks, next in ${b.nextThinkIn}s`}${b.goal ? `, goal: ${b.goal}` : ""}${b.current ? `, ${b.current}` : ""}${b.lastError ? ` §c(${b.lastError.slice(0, 60)})` : ""}`);
            if (!s.brains.length) lines.push("§7no bots have a brain attached yet (spawn some, or !ai summon)");
            return reply(player, lines);
        }
        case "summon": {
            const name = rest[0];
            if (!name) return reply(player, "§cusage: !ai summon <Name> [description]");
            if (manager.companionsOf(player).length >= 4 && !op) return reply(player, "§cyou already have 4 companions");
            const r = manager.summon(player, { name, description: rest.slice(1).join(" ") });
            return reply(player, r.ok ? `§asummoned ${r.name}` : `§c${r.error}`);
        }
        case "despawn": {
            const b = botByName(player, rest[0]);
            if (!b) return reply(player, "§cno such bot nearby");
            if (b.settings.owner !== player.id && !op) return reply(player, "§cthat is not your companion");
            manager.despawn(b.bot);
            return reply(player, `§7${b.name} left.`);
        }
        case "talk":
        case "say": {
            const b = botByName(player, rest[0]);
            if (!b) return reply(player, "§cno such bot nearby");
            const text = rest.slice(1).join(" ");
            if (!text) return reply(player, "§cusage: !ai talk <Name> <message>");
            b.hearChat(player.name, text, { whisper: true });
            return reply(player, `§7(you whisper to ${b.name}) ${text}`);
        }
        case "memory": {
            const b = botByName(player, rest[0]);
            if (!b) return reply(player, "§cno such bot nearby");
            return reply(player, [`§b${b.name}'s memory:§r`, renderMemory(b.memory, Date.now(), { facts: 12, episodes: 6, chat: 6 }) || "(empty)"]);
        }
        case "forget": {
            const b = botByName(player, rest[0]);
            if (!b) return reply(player, "§cno such bot nearby");
            if (b.settings.owner !== player.id && !op) return reply(player, "§conly the owner or an operator can do that");
            b.memory.facts = []; b.memory.episodes = []; b.memory.chat = []; b.memory.people = {}; b.history = []; b.saveMemory();
            return reply(player, `§7${b.name} forgot everything.`);
        }
        case "pause":
        case "resume": {
            const on = cmd === "pause";
            if (rest[0]) { const b = botByName(player, rest[0]); if (!b) return reply(player, "§cno such bot"); b.paused = on; patchBotSettings(b.bot, { mode: on ? "paused" : (b.settings.owner ? "companion" : "auto") }); if (on) b.actuator.stopAll(); return reply(player, `§7${b.name} ${on ? "paused" : "resumed"}`); }
            if (!op) return reply(player, "§coperator only");
            updateWorldConfig({ enabled: !on }); manager.refreshEnabled();
            return reply(player, `§7brains ${on ? "paused" : "resumed"} for every bot`);
        }
        case "think": {
            const b = botByName(player, rest[0]);
            if (!b) return reply(player, "§cno such bot");
            b.sched.nextThink = 0; b.sched.consecutiveFailures = 0;
            return reply(player, `§7${b.name} will think now`);
        }
        case "content": {
            const wc = worldContent();
            return reply(player, [`§bmodded content:§r ${wc.counts.blocks} blocks, ${wc.counts.items} items, ${wc.counts.entities} creatures`, wc.text.slice(0, 900)]);
        }
    }
    if (!op) return reply(player, "§coperator only. Try !ai help");
    switch (cmd) {
        case "provider": {
            const id = (rest[0] || "").toLowerCase();
            if (!PROVIDERS[id]) return reply(player, [`§cunknown provider. Options: ${PROVIDER_IDS.join(", ")}`, "§7" + configuredProviders().map(p => `${p.id}${p.hasKey === true ? " (key ok)" : p.hasKey === false ? " (no key)" : ""}`).join(", ")]);
            updateWorldConfig({ provider: id, model: rest[1] || "" });
            for (const [, b] of allBrains()) b.systemCache = null;
            return reply(player, `§aprovider set to ${PROVIDERS[id].label}${rest[1] ? " / " + rest[1] : ""}`);
        }
        case "model": updateWorldConfig({ model: rest[0] || "" }); return reply(player, `§amodel set to ${rest[0] || "(provider default)"}`);
        case "transport": { const t = rest[0]; if (!["auto", "direct", "bridge"].includes(t)) return reply(player, "§cusage: !ai transport auto|direct|bridge"); updateWorldConfig({ transport: t }); manager.refreshEnabled(); return reply(player, `§atransport ${t}`); }
        case "volume": { const v = Number(rest[0]); if (!(v >= 0 && v <= 3)) return reply(player, "§cusage: !ai volume 0-3"); updateWorldConfig({ chatVolume: v }); return reply(player, `§achat volume ${v}`); }
        case "callbyname": updateWorldConfig({ callByName: rest[0] === "on" }); for (const [, b] of allBrains()) b.systemCache = null; return reply(player, `§acall-by-name ${rest[0] === "on" ? "on" : "off"}`);
        case "freebuild": updateWorldConfig({ freeBuild: rest[0] !== "off" }); return reply(player, `§afree building ${rest[0] !== "off" ? "on" : "off"}`);
        case "fakechat": updateWorldConfig({ legacyFakeChat: rest[0] === "on" }); return reply(player, `§afake player chat ${rest[0] === "on" ? "on" : "off"}`);
        case "debug": manager.debug = rest[0] === "on"; return reply(player, `§adebug ${manager.debug ? "on (see server log)" : "off"}`);
        case "rules": { const text = rest.join(" "); updateWorldConfig({ serverRules: text }); for (const [, b] of allBrains()) b.systemCache = null; return reply(player, text ? "§aserver rules set" : "§aserver rules cleared"); }
        case "bridgename": updateWorldConfig({ bridgeName: rest[0] || "" }); return reply(player, rest[0] ? `§aonly ${rest[0]} may act as the bridge` : "§aany operator account may act as the bridge");
        case "companiondeath": { const v = rest[0]; if (!["respawn", "permadeath"].includes(v)) return reply(player, "§cusage: !ai companiondeath respawn|permadeath"); updateWorldConfig({ companionDeath: v }); return reply(player, `§acompanions now ${v === "respawn" ? "respawn next to their owner after dying" : "stay dead (permadeath)"}`); }
        case "jointeleport": updateWorldConfig({ companionJoinTeleport: rest[0] === "on" }); return reply(player, `§acompanions ${rest[0] === "on" ? "come to their owner on join" : "stay where they are when their owner joins"}`);
        case "maxbrains": { const n = Number(rest[0]); if (!(n >= 0 && n <= 40)) return reply(player, "§cusage: !ai maxbrains 0-40"); updateWorldConfig({ maxBrains: n }); return reply(player, `§amax brains ${n}`); }
        case "autonomy": { const v = rest[0]; if (!["full", "companions_only", "off"].includes(v)) return reply(player, "§cusage: !ai autonomy full|companions_only|off"); updateWorldConfig({ autonomy: v }); manager.refreshEnabled(); return reply(player, `§aautonomy ${v}`); }
        case "budget": {
            const sub = rest[0];
            if (sub === "reset") { budget.reset(); return reply(player, "§abudget window reset"); }
            if (sub === "soft" || sub === "hard") { const n = Number(rest[1]); if (!(n >= 0)) return reply(player, "§cusage: !ai budget soft|hard <tokens per window>"); updateWorldConfig({ budget: { [sub + "Tokens"]: n } }); budget.setLimits(getWorldConfig().budget); return reply(player, `§a${sub} limit ${n} tokens`); }
            if (sub === "window") { const n = Number(rest[1]); if (!(n >= 1)) return reply(player, "§cusage: !ai budget window <minutes>"); updateWorldConfig({ budget: { windowMinutes: n } }); budget.setLimits(getWorldConfig().budget); return reply(player, `§abudget window ${n} min`); }
            const s = budget.status();
            return reply(player, `§bbudget:§r ${s.level}; ${s.windowTokens}/${s.softTokens} soft, ${s.hardTokens} hard tokens per ${s.windowMinutes}min; ${s.windowCalls} calls; ${formatUsd(s.windowUsd)} window, ${formatUsd(s.lifetimeUsd)} lifetime`);
        }
        case "server": { const s = serverConfigSummary(); return reply(player, `§7server-admin: ${s.hasServerAdmin}; secrets: ${s.secrets.join(", ") || "none"}; variables: ${s.variables.join(", ") || "none"}`); }
        default:
            return reply(player, HELP);
    }
}

// Real slash commands work on the stable API without cheats or a bridge.
export function registerSlashCommands() {
    try {
        system.beforeEvents.startup.subscribe(ev => {
            const reg = ev.customCommandRegistry;
            const player = origin => { const e = origin.sourceEntity; return e && e.typeId === "minecraft:player" ? e : null; };
            const ok = (message) => ({ status: CustomCommandStatus.Success, message });
            const fail = (message) => ({ status: CustomCommandStatus.Failure, message });
            reg.registerCommand({ name: "aisb:talk", description: "Whisper to an AI bot: /aisb:talk <bot> \"message\"", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "bot", type: CustomCommandParamType.String }, { name: "message", type: CustomCommandParamType.String }] }, (origin, bot, message) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai talk ${bot} ${message}`));
                return ok("");
            });
            reg.registerCommand({ name: "aisb:menu", description: "Open the AI Sandbox menu", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (origin) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => showHub(p));
                return ok("");
            });
            reg.registerCommand({ name: "aisb:summon", description: "Summon an AI companion bound to you", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }], optionalParameters: [{ name: "description", type: CustomCommandParamType.String }] }, (origin, name, description) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai summon ${name} ${description || ""}`));
                return ok("");
            });
            reg.registerCommand({ name: "aisb:ai", description: "Any !ai command: /aisb:ai \"status\"", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "args", type: CustomCommandParamType.String }] }, (origin, args) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai ${args}`));
                return ok("");
            });
        });
    } catch (e) { console.warn("[AISB] custom commands unavailable", e); }
}

export function startCommands() {
    const handler = ev => {
        try {
            if (!ev.message.startsWith("!ai")) return;
            if (ev.cancel !== undefined) ev.cancel = true;
            const p = ev.sender;
            if (!playerAllowed(p.name)) return;
            system.run(() => { try { handleCommand(p, ev.message); } catch (e) { console.warn("[AISB] command failed", e); try { p.sendMessage("§ccommand failed: " + e); } catch (e2) { /* ignore */ } } });
        } catch (e) { /* ignore */ }
    };
    let subscribed = false;
    try { world.beforeEvents.chatSend.subscribe(handler); subscribed = true; } catch (e) { /* beta only */ }
    if (!subscribed) { try { world.afterEvents.chatSend.subscribe(handler); subscribed = true; } catch (e) { /* ignore */ } }
    if (!subscribed) console.warn("[AISB] chat commands unavailable without the beta chat API; use the menu item or /scriptevent aisb:cmd");
    // Always-available path: /scriptevent aisb:cmd <text>  (operators, any API level)
    system.afterEvents.scriptEventReceive.subscribe(ev => {
        const p = ev.sourceEntity;
        if (!p || p.typeId !== "minecraft:player") return;
        if (ev.id === "aisb:cmd") {
            try { handleCommand(p, "!ai " + ev.message); } catch (e) { console.warn("[AISB] scriptevent command failed", e); }
            return;
        }
        if (ev.id === "aisb:cmdfor") {
            // The bridge account relays "!ai ..." typed by a player (stable API has no chat events).
            try { if (!p.hasTag("aisb_bridge")) return; } catch (e) { return; }
            const bar = ev.message.indexOf("|");
            if (bar < 0) return;
            const sender = findPlayer(ev.message.slice(0, bar).trim());
            if (!sender) return;
            if (!playerAllowed(sender.name)) return;
            try { handleCommand(sender, "!ai " + ev.message.slice(bar + 1).trim()); } catch (e) { console.warn("[AISB] relayed command failed", e); }
        }
    }, { namespaces: ["aisb"] });
}
