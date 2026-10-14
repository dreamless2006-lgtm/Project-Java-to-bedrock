# AI Sandbox for Minecraft Bedrock

Real AI players for Bedrock. Every bot is a player-shaped body with a language
model for a brain: Claude, ChatGPT, Grok, Gemini, Player2 or a local model.
They talk to you and to each other, build their own houses, mine, craft,
fight, trade, go to the Nether and the End, remember who you are, and keep
going after you log off. All of it in a Scape and Run: Parasites apocalypse.

This repo merges two projects and adds the brain:

* **AI Multiplayer x Scape and Run: Parasites** (Bedrock addon): the bot
  body, its reflexes, the friend/trade/duel menus and the parasites.
* **Player2NPC** (NeoForge mod): the companion experience (summon, memory,
  call-by-name chat, budget, access lists, mod intelligence, model profiles),
  ported to Bedrock menus and commands.
* **The brain** (`packs/AI_Sandbox_BP/scripts/brain/`): observe, think, act.

## What a bot can do

Talk in chat (public or whispered), remember facts and people, set goals,
walk anywhere, follow you, fight players/mobs/parasites, run gathering jobs
(logs, ores, stone), dig for ore, explore, build from presets (house, shelter,
wall, tower, bridge, farm, pillar) or from its own block-by-block blueprint,
place and break single blocks, place torches, eat, equip the best gear, use
items including modded ones, craft and smelt (vanilla basics plus every
recipe in the pack), handle chests, open doors/levers/buttons, harvest crops,
sleep, set a home and return to it, travel between dimensions (uses a known
portal or builds a Nether portal), trade, duel, send friend requests, emote,
and wait. It also knows every modded block, item and creature in the world.

## Quick start

```bash
npm install            # nothing to install for the packs; this is for the test runner
npm run check          # syntax + JSON + manifest checks
npm test               # unit tests for the pure brain modules
npm run smoke          # boots the whole pack under a mock Script API engine and drives a bot
python3 tools/build_mcaddon.py --edition all
```

`dist/` then holds three `.mcaddon` files:

| Edition | Use it when | Model calls go through |
|---|---|---|
| `realm` | Realms, friend worlds, LAN, or any world without experiments | the bridge (`bridge/`) |
| `realm-beta` | you can enable the Beta APIs experiment and want bots to hear chat directly | the bridge |
| `bds` | you run a Bedrock Dedicated Server | the server itself (`@minecraft/server-net`) |

Setup guides: [docs/SETUP-DEDICATED-SERVER.md](docs/SETUP-DEDICATED-SERVER.md)
and [docs/SETUP-REALM-BRIDGE.md](docs/SETUP-REALM-BRIDGE.md). Design:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## In game

* `!ai` or `/aisb:menu` opens the hub (Getting Started, Companions, Behavior,
  Budget, Access Lists, Mod Intelligence, AI & Memory, Profiles & Models).
* `!ai summon Ellie a cheerful builder` summons a companion bound to you.
  A companion that dies respawns next to you with its memory intact
  (operators can switch to permadeath), and companions far away come to
  you when you join.
* Just chat; bots within earshot answer by name. `!ai talk Ellie hi` or
  `/aisb:talk Ellie "hi"` whispers.
* `!ai status`, `!ai memory Ellie`, `!ai pause`, `!ai budget`.
* Operators: `!ai provider anthropic`, `!ai model claude-haiku-5-5`,
  `!ai volume 2`, `!ai rules Speak Spanish`, `!ai callbyname on`.

Sneak + use the Friend List item also opens the hub; sneak + interact with a
bot opens its card.

## Cost

Each think is one model call with a cached system prompt (~3k tokens) plus a
short observation (~400 tokens) and a ~150-token reply. A bot thinks every
~12 s while busy, every ~45 s when idle, immediately when spoken to. The
Budget tab shows spend per window; a soft limit slows thinking, a hard limit
pauses it. Ten active bots on a small model cost a few cents per hour.

## Repository layout

```
packs/AI_Sandbox_BP      behaviour pack (scripts/brain = the LLM brain, everything else = original addon + patches)
packs/AI_Sandbox_RP      resource pack (unchanged assets)
bridge/                  Node relay for Realms / client worlds
tools/                   checker, content generator, mcaddon builder
tests/                   node --test suites for the pure modules and the bridge
docs/                    architecture and setup guides
reference/player2npc     language file and class signatures of the Java mod, for the port
```

## Credits

AI Multiplayer authors; Dhanantry (Scape and Run: Parasites); the Player2NPC
authors for the companion design this port follows.
