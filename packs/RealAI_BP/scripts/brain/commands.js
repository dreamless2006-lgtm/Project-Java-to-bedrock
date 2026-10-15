// Chat commands for operators and players: !ai ...
import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server";
import { manager, isOperator, budget } from "./core.js";
import { getBrain, allBrains } from "./gate.js";
import { getWorldConfig, updateWorldConfig, patchBotSettings, configuredProviders, serverConfigSummary } from "./config.js";
import { PROVIDERS, PROVIDER_IDS } from "./providers/index.js";
import { formatUsd } from "./budget.js";
import { findPlayer, findEntityByName, walkerInfo, bridgeWalks } from "./actuator.js";
import { bridge } from "./transport.js";
import { renderMemory } from "./memory.js";
import { worldContent } from "./world_content.js";
import { showHub, playerAllowed } from "./ui.js";
import { sightPicture } from "./perception.js";
import { formatSight } from "./sight.js";

// What counts as steering the AI (refused while it is independent); talking, reading and setup stay.
const STEERING = new Set(["walk", "pause", "resume", "think", "forget", "rules", "mission", "summon", "despawn"]);

const HELP = [
    "§b!ai§r - open the Real AI menu",
    "§b!ai status§r - transport, provider, budget and every thinking bot",
    "§b!ai summon <Name> [description]§r - summon a companion bot bound to you",
    "§b!ai despawn <Name>§r - remove one of your companions",
    "§b!ai talk <Name> <message>§r - whisper to a bot (works without the beta chat API)",
    "§b!ai memory <Name>§r | §b!ai forget <Name>§r - read or wipe a bot's memory",
    "§b!ai pause|resume [Name]§r - pause thinking (all bots or one)",
    "§b!ai where [Name]§r - where the server keeps a bot's body and what its walker is doing",
    "§b!ai body§r - how the bridge's client sees the AI's body (keys held, pull-backs by the server)",
    "§b!ai see [Name]§r - the picture of the world the AI's model is given each turn (letters for materials, digits for distance); §b!ai picture on|off§r turns the picture in the AI's turns on or off",
    "§7Independent (default): nobody can steer the AI in game (no pause, walk, forget, rules, mission, summon); talk is the only way in. §b!ai independent on|off§r (pinned by the bridge's config.json when it sets it).",
    "§b!ai walk <Name> <dx> <dz>§r - make a bot walk that far from where it stands (a movement test)",
    "§7operator: §b!ai provider <id>§r, §b!ai model <name>§r, §b!ai transport auto|direct|bridge§r, §b!ai volume 0-3§r, §b!ai budget soft|hard <tokens>|reset§r, §b!ai rules <text>§r, §b!ai callbyname on|off§r, §b!ai freebuild on|off§r, §b!ai debug on|off§r, §b!ai fakechat on|off§r, §b!ai players 0-16§r, §b!ai thoughts on|off§r, §b!ai mix on|off§r, §b!ai bridgeplays on|off§r, §b!ai mission beat|free§r, §b!ai wildspawns on|off§r, §b!ai companiondeath respawn|permadeath§r, §b!ai jointeleport on|off§r, §b!ai content§r",
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
    if (cfg.independent !== false && STEERING.has(cmd)) return reply(player, `§7The AI runs its own life here: nobody in this world can steer it (no "${cmd}"). Talk to it in chat like anyone else.${op ? (manager.independentPinned ? ' To change that, set "independent": false in the bridge\'s config.json and restart it.' : " To change that: !ai independent off.") : ""}`);
    switch (cmd) {
        case "":
        case "menu":
            system.run(() => showHub(player));
            return;
        case "help":
            return reply(player, HELP);
        case "status": {
            const s = manager.status();
            const lines = [`§b[Real AI]§r edition ${s.edition}, brains ${s.enabled ? "§aON" : "§cOFF"}§r, transport: ${s.transport.direct ? "direct http" : "none"}${s.transport.bridgeConnected ? ` + bridge (${s.transport.bridgePlayer})` : ""}`,
                `provider ${s.provider} / ${s.model}; budget ${s.budget.level}: ${s.budget.windowTokens} tokens, ${formatUsd(s.budget.windowUsd)} this ${s.budget.windowMinutes}min window (lifetime ${formatUsd(s.budget.lifetimeUsd)}); modded content: ${s.worldContent.blocks} blocks, ${s.worldContent.items} items, ${s.worldContent.entities} creatures`];
            lines.push(`§7residents: ${s.residents.online}/${s.residents.total} in the world${s.residents.names.length ? " (" + s.residents.names.join(", ") + ")" : ""}`);
            if (s.configProblem) lines.push(`§c${s.configProblem}`);
            for (const b of s.brains) lines.push(`§7- ${b.name} §8[${b.provider}${b.model !== "(default)" ? "/" + b.model : ""}]§7: ${b.paused ? "paused" : `${b.thinks} decisions${b.latencyMs ? ", ~" + (b.latencyMs / 1000).toFixed(1) + "s each" : ""}, next in ${b.nextThinkIn}s`}${b.mission ? ` §e[${b.mission.finished ? "beat the game!" : "mission " + b.mission.done.length + "/15"}]§7` : ""}${b.goal ? `, goal: ${b.goal}` : ""}${b.current ? `, ${b.current}` : ""}${b.lastError ? ` §c(${b.lastError.slice(0, 60)})` : ""}`);
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
        case "body": {
            // what the bridge's client thinks of this body: the first thing to look at when the AI does not move
            if (!bridge.isConnected()) return reply(player, "§cno bridge is connected");
            bridge.bodyStatus = null;
            bridge.send({ t: "body_status" });
            system.runTimeout(() => {
                const st = bridge.bodyStatus;
                if (!st) return reply(player, ["§cthe bridge did not answer within three seconds. Its build may be too old to report on its body (update it: bash ~/real-ai/bridge/phone.sh), or the connection is slow or dropped; try again."]);
                const f = (n) => (typeof n === "number" ? n.toFixed(1) : "?");
                const lines = [`§b[Real AI] body (as the bridge's client sees it)§r`,
                    `§7at ${st.pos ? `${f(st.pos.x)} ${f(st.pos.y)} ${f(st.pos.z)}` : "?"}, facing yaw ${st.yaw} pitch ${st.pitch}, ${st.alive ? "alive" : "§cDEAD (respawning)§7"}, ${st.onGround ? "on the ground" : "in the air"}, ${st.gameMode ?? "?"}`,
                    `§7now: ${st.keys ? `holding keys f${st.keys.f} s${st.keys.s}${st.keys.sprint ? " sprint" : ""}${st.keys.sneak ? " sneak" : ""}${st.keys.jump ? " jump" : ""}` : st.walking ? `walking to ${f(st.target.x)} ${f(st.target.y)} ${f(st.target.z)}` : "standing"}`,
                    `§7server pulled it back: ${st.corrections} corrections, ${st.teleports} teleports; ${st.resyncs} resyncs; input tick ${st.tick}; height convention ${st.startIsEye ? "eye" : "feet"}${st.calibrated ? " (confirmed)" : ""}`];
                try { const b = [...allBrains().values()].find(x => x.settings.mode === "bridge"); if (b) { const l = b.bot.location; lines.push(`§7the game has it at ${f(l.x)} ${f(l.y)} ${f(l.z)}; the bridge walks it: ${bridgeWalks(b.bot) ? "yes" : "§cno"}`); } } catch (e) { /* ignore */ }
                if (st.corrections + st.teleports > 30) lines.push("§eMany pull-backs: the server may not accept this client's movement. On the phone: bash ~/real-ai/bridge/phone.sh selftest");
                reply(player, lines);
            }, 60);
            return;
        }
        case "picture": updateWorldConfig({ sight: rest[0] !== "off" }); return reply(player, rest[0] !== "off" ? "§aeach turn now carries a picture of what the AI sees" : "§athe AI is no longer given a picture of its view (it still has the Around you report)");
        case "see": {
            const b = rest[0] ? botByName(player, rest[0]) : [...allBrains().values()].find(x => { try { return x.settings.mode === "bridge"; } catch (e) { return false; } }) || [...allBrains().values()][0];
            if (!b) return reply(player, "§cno such bot");
            let pic;
            try { pic = formatSight(sightPicture(b.bot)); } catch (e) { return reply(player, "§cthe picture could not be drawn: " + e); }
            const st = b.lastThought;
            return reply(player, [`§b${b.name}§r sees (the chat font is not fixed-width, so columns drift a little; the model gets them exactly):`, ...pic.split("\n").map(l => "§7" + l), st && st.text ? `§7thinking: ${st.text}` : "§7(no decision yet)"]);
        }
        case "where": {
            const b = rest[0] ? botByName(player, rest[0]) : [...allBrains().values()].find(x => { try { return x.settings.mode === "bridge"; } catch (e) { return false; } }) || [...allBrains().values()][0];
            if (!b) return reply(player, "§cno such bot");
            let line = `§b${b.name}§r`;
            try { const l = b.bot.location; line += ` at ${l.x.toFixed(1)} ${l.y.toFixed(1)} ${l.z.toFixed(1)} in ${b.bot.dimension.id.replace("minecraft:", "")}`; } catch (e) { /* ignore */ }
            try { const v = b.bot.getVelocity(); line += `, moving ${Math.hypot(v.x, v.z).toFixed(2)}/tick`; } catch (e) { /* ignore */ }
            try { line += b.bot.isOnGround ? ", on the ground" : ", in the air"; } catch (e) { /* ignore */ }
            try { if (b.bot.typeId === "minecraft:player") line += `, ${b.bot.getGameMode()}`; } catch (e) { /* ignore */ }
            const w = walkerInfo(b.bot);
            line += bridgeWalks(b.bot) ? " §7(the bridge walks this body)" : (b.bot.typeId === "minecraft:player" ? " §7(walked by teleport: the bridge has no body)" : "");
            line += w ? `; walking ${w.mode} to ${w.target.x} ${w.target.y} ${w.target.z}${w.blocked ? ` (blocked ${w.blocked})` : ""}` : "; not walking";
            const cur = b.actuator.describeCurrent();
            return reply(player, [line, cur ? `§7doing: ${cur}` : "§7idle"]);
        }
        case "walk": {
            if (!isOperator(player)) return reply(player, "§conly operators");
            const b = botByName(player, rest[0]);
            const dx = Number(rest[1]), dz = Number(rest[2]);
            if (!b || !Number.isFinite(dx) || !Number.isFinite(dz)) return reply(player, "§cusage: !ai walk <Name> <dx> <dz>");
            const l = b.bot.location;
            b.actuator.stopAll();
            b.actuator.enqueue([{ type: "move_to", x: Math.floor(l.x + dx), y: Math.floor(l.y), z: Math.floor(l.z + dz) }]);
            return reply(player, `§a${b.name} walks ${dx} ${dz} from ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)}; watch it and use !ai where ${b.name}`);
        }
        case "rules": { const text = rest.join(" "); updateWorldConfig({ serverRules: text }); for (const [, b] of allBrains()) b.systemCache = null; return reply(player, text ? "§aserver rules set" : "§aserver rules cleared"); }
        case "bridgename": updateWorldConfig({ bridgeName: rest[0] || "" }); return reply(player, rest[0] ? `§aonly ${rest[0]} may act as the bridge` : "§aany operator account may act as the bridge");
        case "players": { const n = Number(rest[0]); if (!(n >= 0 && n <= 16)) return reply(player, "§cusage: !ai players 0-16 (named AI players living in this world)"); updateWorldConfig({ worldPlayers: n }); manager.populate("command", player); return reply(player, `§a${n} AI players will live in this world`); }
        case "wildspawns": updateWorldConfig({ wildSpawns: rest[0] === "on" }); return reply(player, `§awild bot spawns ${rest[0] === "on" ? "on" : "off"}`);
        case "mission": { const v = rest[0] === "free" ? "free" : rest[0] === "beat" || rest[0] === "beat_the_game" ? "beat_the_game" : null; if (!v) return reply(player, "§cusage: !ai mission beat|free"); updateWorldConfig({ mission: v }); for (const [, b] of allBrains()) b.systemCache = null; return reply(player, v === "free" ? "§athe AI plays freely with no set purpose" : "§athe AI's purpose is to beat the game"); }
        case "bridgeplays": updateWorldConfig({ bridgePlays: rest[0] === "on" }); manager.discover(); return reply(player, rest[0] === "on" ? "§athe bridge account's player now plays with its own brain" : "§athe bridge account's player is a plain relay again");
        case "thoughts": updateWorldConfig({ showThoughts: rest[0] === "on" }); return reply(player, rest[0] === "on" ? "§aevery bot's reasoning and chosen actions are now shown to nearby players" : "§athoughts hidden");
        case "mix": updateWorldConfig({ mixProviders: rest[0] === "on" }); manager.populate("command", player); return reply(player, rest[0] === "on" ? "§aresidents are spread across every provider with a key" : "§aall residents use the world's default provider");
        case "companiondeath": { const v = rest[0]; if (!["respawn", "permadeath"].includes(v)) return reply(player, "§cusage: !ai companiondeath respawn|permadeath"); updateWorldConfig({ companionDeath: v }); return reply(player, `§acompanions now ${v === "respawn" ? "respawn next to their owner after dying" : "stay dead (permadeath)"}`); }
        case "jointeleport": updateWorldConfig({ companionJoinTeleport: rest[0] === "on" }); return reply(player, `§acompanions ${rest[0] === "on" ? "come to their owner on join" : "stay where they are when their owner joins"}`);
        case "maxbrains": { const n = Number(rest[0]); if (!(n >= 0 && n <= 40)) return reply(player, "§cusage: !ai maxbrains 0-40"); updateWorldConfig({ maxBrains: n }); return reply(player, `§amax brains ${n}`); }
        case "independent": {
            if (!op) return reply(player, "§coperator only");
            if (manager.independentPinned) return reply(player, `§7independence is ${cfg.independent !== false ? "on" : "off"} and pinned by the bridge's config.json ("independent"); change it there and restart the bridge`);
            const v = rest[0] === "off" ? false : rest[0] === "on" ? true : null;
            if (v === null) return reply(player, `§7independent is ${cfg.independent !== false ? "on" : "off"}; usage: !ai independent on|off`);
            updateWorldConfig({ independent: v }); for (const [, b] of allBrains()) b.systemCache = null;
            return reply(player, v ? "§athe AI runs its own life: nobody in this world can steer it" : "§eplayers may now steer the AI (pause, walk, jobs, rules, summons)");
        }
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
            reg.registerCommand({ name: "realai:talk", description: "Whisper to an AI bot: /realai:talk <bot> \"message\"", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "bot", type: CustomCommandParamType.String }, { name: "message", type: CustomCommandParamType.String }] }, (origin, bot, message) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai talk ${bot} ${message}`));
                return ok("");
            });
            reg.registerCommand({ name: "realai:menu", description: "Open the Real AI menu", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false }, (origin) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => showHub(p));
                return ok("");
            });
            reg.registerCommand({ name: "realai:companion", description: "Summon an AI companion bound to you", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }], optionalParameters: [{ name: "description", type: CustomCommandParamType.String }] }, (origin, name, description) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai summon ${name} ${description || ""}`));
                return ok("");
            });
            reg.registerCommand({ name: "realai:ai", description: "Any !ai command: /realai:ai \"status\"", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, mandatoryParameters: [{ name: "args", type: CustomCommandParamType.String }] }, (origin, args) => {
                const p = player(origin); if (!p) return fail("players only");
                system.run(() => handleCommand(p, `!ai ${args}`));
                return ok("");
            });
        });
    } catch (e) { console.warn("[RealAI] custom commands unavailable", e); }
}

export function startCommands() {
    const handler = ev => {
        try {
            if (!ev.message.startsWith("!ai")) return;
            if (ev.cancel !== undefined) ev.cancel = true;
            const p = ev.sender;
            if (!playerAllowed(p.name)) return;
            system.run(() => { try { handleCommand(p, ev.message); } catch (e) { console.warn("[RealAI] command failed", e); try { p.sendMessage("§ccommand failed: " + e); } catch (e2) { /* ignore */ } } });
        } catch (e) { /* ignore */ }
    };
    let subscribed = false;
    try { world.beforeEvents.chatSend.subscribe(handler); subscribed = true; } catch (e) { /* beta only */ }
    if (!subscribed) { try { world.afterEvents.chatSend.subscribe(handler); subscribed = true; } catch (e) { /* ignore */ } }
    if (!subscribed) console.warn("[RealAI] chat commands unavailable without the beta chat API; use the menu item or /scriptevent realai:cmd");
    // Always-available path: /scriptevent realai:cmd <text>  (operators, any API level)
    system.afterEvents.scriptEventReceive.subscribe(ev => {
        const p = ev.sourceEntity;
        if (!p || p.typeId !== "minecraft:player") return;
        if (ev.id === "realai:cmd") {
            try { handleCommand(p, "!ai " + ev.message); } catch (e) { console.warn("[RealAI] scriptevent command failed", e); }
            return;
        }
        if (ev.id === "realai:cmdfor") {
            // The bridge account relays "!ai ..." typed by a player (stable API has no chat events).
            try { if (!p.hasTag("realai_bridge")) return; } catch (e) { return; }
            const bar = ev.message.indexOf("|");
            if (bar < 0) return;
            const sender = findPlayer(ev.message.slice(0, bar).trim());
            if (!sender) return;
            if (!playerAllowed(sender.name)) return;
            try { handleCommand(sender, "!ai " + ev.message.slice(bar + 1).trim()); } catch (e) { console.warn("[RealAI] relayed command failed", e); }
        }
    }, { namespaces: ["realai"] });
}
