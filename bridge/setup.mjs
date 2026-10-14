// First-run wizard for the Real AI bridge. Asks a few plain questions and writes
// config.json next to this file. Runs automatically from `node index.mjs` (or
// start.bat / start.sh) when there is no config.json yet; `node index.mjs --setup`
// runs it again.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHOICES = [
    { id: "gemini", label: "Gemini (has a free tier: aistudio.google.com > Get API key > Create API key; easiest to start with)", needsKey: true, hint: "AIza..." },
    { id: "anthropic", label: "Claude (API key from console.anthropic.com; paid per use)", needsKey: true, hint: "sk-ant-..." },
    { id: "openai", label: "ChatGPT (API key from platform.openai.com; paid per use)", needsKey: true, hint: "sk-..." },
    { id: "xai", label: "Grok (API key from console.x.ai; paid per use)", needsKey: true, hint: "xai-..." },
    { id: "openrouter", label: "OpenRouter (one key for many models, some free; openrouter.ai)", needsKey: true, hint: "sk-or-..." },
    { id: "player2", label: "Player2 app (free, no key; Windows/Mac only: install from player2.game, log in, leave it running here)", needsKey: false },
    { id: "ollama", label: "Ollama running on this computer (free, local models)", needsKey: false },
];

export async function runSetup({ configPath = join(HERE, "config.json"), examplePath = join(HERE, "config.example.json") } = {}) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ask = async (q, def = "") => { const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim(); return a || def; };
    const cfg = JSON.parse(readFileSync(existsSync(configPath) ? configPath : examplePath, "utf8"));
    cfg.providers = cfg.providers || {};

    console.log("\n=== Real AI bridge setup ===");
    console.log("This program joins your Minecraft world as an extra player and carries the bots' thinking");
    console.log("to an AI. It has to keep running on this computer while you play.\n");

    console.log("1) Which AI should the players think with? You can add more later; with several keys the");
    console.log("   eight residents are spread across them.");
    CHOICES.forEach((c, i) => console.log(`   ${i + 1}. ${c.label}`));
    let picked = [];
    while (!picked.length) {
        const ans = await ask("Type one or more numbers separated by spaces", "1");
        picked = ans.split(/[\s,]+/).map(n => CHOICES[Number(n) - 1]).filter(Boolean);
    }
    for (const c of picked) {
        cfg.providers[c.id] = cfg.providers[c.id] || {};
        if (c.needsKey) {
            let key = "";
            while (!key) key = await ask(`   Paste your ${c.id} API key (${c.hint}); it is only stored in config.json on this computer`);
            cfg.providers[c.id].apiKey = key;
        }
    }
    cfg.defaults = cfg.defaults || {};
    cfg.defaults.provider = picked[0].id;

    console.log("\n2) Which world should it join?");
    console.log("   1. A Realm I am a member of (the bridge account must be invited to it)");
    console.log("   2. A server or LAN world by address");
    const where = await ask("Type 1 or 2", "1");
    cfg.connect = cfg.connect || {};
    if (where === "2") {
        cfg.connect.mode = "server";
        cfg.connect.host = await ask("   Server address (IP or host name)", cfg.connect.host || "127.0.0.1");
        cfg.connect.port = Number(await ask("   Port", String(cfg.connect.port || 19132)));
    } else {
        cfg.connect.mode = "realm";
        cfg.connect.realm = cfg.connect.realm || {};
        const invite = await ask("   Realm invite link or code (leave empty to use the first Realm this account can join)", cfg.connect.realm.invite || "");
        cfg.connect.realm.invite = invite.replace(/^.*realms\.gg\//, "").trim();
        cfg.connect.realm.pickFirst = !cfg.connect.realm.invite;
    }

    console.log("\n3) The bridge signs in with a Microsoft account of its own (it uses a player slot, so do not use");
    console.log("   the account you play with). Make that account an operator on the world. On first start a");
    console.log("   sign-in code is shown; open the link on any device and enter it.");
    cfg.connect.username = await ask("   Gamertag to show for the bridge player", cfg.connect.username || "RealAIBridge");

    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    rl.close();
    console.log(`\nSaved ${configPath}. Starting the bridge...\n`);
    return cfg;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    runSetup().catch(e => { console.error(e); process.exit(1); });
}
