# Real AI for Minecraft Bedrock

One addon. A world full of real AI players. Every bot is a player-shaped body
with a language model for a brain: Claude, ChatGPT, Grok, Gemini, Player2 or
a local model. They join the game when you do, talk to you and to each other,
build their own houses, mine, craft, fight, trade, go to the Nether and the
End, remember who you are between sessions, respawn like players, and keep
going after you log off if the world stays loaded.

This repo combines two projects and adds the brain:

* **AI Multiplayer** (Bedrock addon): the bot body (`rg:bot`), its reflexes
  and the friend/trade/duel menus.
* **Player2NPC** (NeoForge mod): the companion experience (summon, memory,
  call-by-name chat, budget, access lists, mod intelligence, model profiles),
  ported to Bedrock menus and commands.
* **The brain** (`packs/RealAI_BP/scripts/brain/`): observe, think, act.

## Who is really playing

Every resident and companion is driven, turn by turn, by the model you
configured. There is no scripted personality underneath: each turn the bot
receives what it sees, hears and remembers, and the model answers with what
to say, how it feels, what its goal is and which actions to take. The body
only executes those actions and keeps a few split-second reflexes a human
player's hands would have (not drowning, stepping back from lava, running
from a creeper that is about to blow, fighting back for the instant after
being hit). Everything else that the original addon used to decide by script
(picking fights, wandering, hunting, eating, building shelters, placing
torches, riding, greeting, duelling, giving gifts, going home at night) is
switched off for brain-driven bots and left to the model.

With more than one key configured, the residents are spread across the
providers: in a world with Claude, ChatGPT, Grok and Gemini keys, two
residents think with each. `!ai status` shows who runs on what, and
`!ai thoughts on` prints every bot's reasoning and chosen actions to nearby
players so you can watch the decisions being made.

## Who lives in your world

Eight named AI players live in the world by default (`Behavior` tab or
`!ai players <n>`, up to 16). A few seconds after you join, each one that is
not already loaded spawns a few blocks from you, announced in chat like a
real player joining. They keep the same names, personalities and memories
across sessions and world reloads, respawn when they die, and get a brain
before any other bot. `!ai summon Ellie a cheerful builder` adds a companion
bound to you on top of that; companions respawn next to you (or permadeath,
your choice) and come to you when you join.

The original addon's random spawner (nameless bots far away from players)
is off by default; turn on "Extra wild bots" in Behavior if you want more
bodies than the roster.

## What a bot can do

Talk in chat (public or whispered), remember facts and people, set goals,
walk anywhere, follow you, fight players and mobs, run gathering jobs (logs,
ores, stone), dig for ore, explore, build from presets (house, shelter, wall,
tower, bridge, farm, pillar) or from its own block-by-block blueprint, place
and break single blocks, place torches, eat, equip the best gear, use items
including modded ones, craft and smelt, handle chests, open
doors/levers/buttons, harvest crops, sleep, set a home and return to it,
travel between dimensions (uses a known portal or builds a Nether portal),
trade, duel, send friend requests, emote, and wait. It also knows every
modded block, item and creature from any other addon in the world.

## Quick start

```bash
npm install            # nothing to install for the packs; this is for the test runner
npm run check          # syntax + JSON + manifest checks
npm test               # unit tests for the pure brain modules
npm run smoke          # boots the whole pack under a mock Script API engine and drives the bots
python3 tools/build_mcaddon.py
```

That writes `dist/Real-AI-<version>.mcaddon`. Import it on any world, Realm
or server, turn on the **Beta APIs** experiment for that world (the same
requirement the original AI Multiplayer addon had; it is what lets bots hear
chat directly), then run the bridge with your API key:

```bash
cd bridge && npm install && cp config.example.json config.json
# put your key in config.json (or export ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY)
node index.mjs
```

The bridge is a small Node program that joins the world as a player and
carries the bots' thinking to the model, because Bedrock scripts cannot make
HTTP calls on Realms or client worlds. Full steps:
[docs/SETUP-REALM-BRIDGE.md](docs/SETUP-REALM-BRIDGE.md). Two optional
builds exist: `--variant stable` needs no experiments but only loads on game
1.26.50 or newer, and `--variant server` lets a Bedrock Dedicated Server
call the model itself without a bridge account:
[docs/SETUP-DEDICATED-SERVER.md](docs/SETUP-DEDICATED-SERVER.md). Design:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Providers and model ids:
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## In game

* `!ai` or `/realai:menu` opens the hub (Getting Started, Companions, Behavior,
  Budget, Access Lists, Mod Intelligence, AI & Memory, Profiles & Models).
* Just chat; bots within earshot answer by name. `!ai talk Ellie hi` or
  `/realai:talk Ellie "hi"` whispers.
* `!ai status` lists the residents and every thinking bot; `!ai memory Ellie`,
  `!ai pause`, `!ai budget`.
* Operators: `!ai players 8`, `!ai thoughts on`, `!ai mix on`,
  `!ai provider anthropic`, `!ai model claude-haiku-5-5`, `!ai volume 2`,
  `!ai rules Speak Spanish`, `!ai callbyname on`,
  `!ai companiondeath permadeath`.

Sneak + use the Friend List item also opens the hub; sneak + interact with a
bot opens its card.

## Cost

Each think is one model call with a cached system prompt (~3k tokens) plus a
short observation (~400 tokens) and a ~150-token reply. A bot thinks every
~12 s while busy, every ~45 s when idle, immediately when spoken to. The
Budget tab shows spend per window; a soft limit slows thinking, a hard limit
pauses it. Eight residents on a small model cost a few cents per hour.

## Repository layout

```
packs/RealAI_BP          behaviour pack (scripts/brain = the LLM brain, everything else = AI Multiplayer + patches)
packs/RealAI_RP          resource pack (bot model, skins, menu icons)
bridge/                  Node relay that joins the world as a player
tools/                   checker, content generator, mcaddon builder
tests/                   node --test suites, the mock engine (harness/) and the smoke run
docs/                    architecture and setup guides
reference/player2npc     language file and class signatures of the Java mod, for the port
```

## Credits

AI Multiplayer authors for the bot bodies; the Player2NPC authors for the
companion design this port follows.
