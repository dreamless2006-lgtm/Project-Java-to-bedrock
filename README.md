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

## Quick decisions, real models

Every decision is one call to the model you configured (Gemini, Claude,
ChatGPT or Grok). While busy the player decides every 6 seconds, every 20
when idle, and immediately when spoken to, hurt, or when something happens;
a pressing feeling brings the next decision sooner. Defaults favour fast
models (Gemini Flash Lite, Claude Haiku, GPT mini), replies are capped
short, and a slow answer times out after 40 seconds so the body never
freezes. `!ai status` shows each player's model and how long its decisions
take; `!ai thoughts on` shows them as they happen. Tune with
`thinkActiveSec` / `thinkIdleSec` in the Behavior tab.

## The mission: beat the game

The AI player is free to do anything the game allows, and its long-term
purpose is to beat Minecraft: reach the End and kill the Ender Dragon. Every
observation tells it how far it is (wood, stone pickaxe, iron, diamonds,
Nether, blaze rods, ender pearls, twelve eyes, stronghold, lit portal, the
End, dragon) and the usual next step, and it chooses its own route. It plays
honest survival: blocks come from its inventory, recipes need real
ingredients, obsidian needs a diamond pickaxe. Two things only a real
account can do are wired through the bridge: `locate` runs the game's own
`/locate structure` to find strongholds and fortresses, and placing eyes of
ender into the frames lights the End portal. Killing the dragon is
recognised and announced. `!ai mission free` removes the purpose and
`!ai freebuild on` restores creative-style building.

## An inner life, not a script

Each AI player carries slow-moving drives (company, rest, curiosity, safety,
restlessness, purpose) that the game updates from what actually happens and
the model reads as feelings: "You feel lonely" or "restless and bored of
standing around" are real reasons to go find someone, sleep, explore or start
a project. Every so often a bot gets a reflection turn: it looks back over
what happened, turns it into lasting facts, rewrites a short "self" (who it
is becoming, what it cares about) and keeps an ordered plan for the coming
days. At dawn every bot is nudged to plan its day. Bots notice the weather
turning, a stranger breaking blocks at their home, other bots' chat, and a
pressing feeling shortens the time to their next decision. Self, plans,
drives and memory persist across reloads. `!ai memory <Name>` shows a bot's
self and plans; `!ai thoughts on` shows the decisions as they happen.

The bridge account's player is that AI. It stands in the world as a real
player, so it gets a brain of its own: it walks like a real client (the
bridge sends the game's own per-tick movement input, so the Realm moves
it, animates it, and lets others hit it), has reflexes (fights back when
a monster hits it, runs from creepers, heads for water when on fire) and
respawns on its own when it dies, remembering where its things fell, and
below the model runs a per-tick layer that no hand can match: planned paths
round every obstacle, hits on the exact damage beat, food, armour and a
water-bucket landing handled by themselves,
slips around trees and digs through hills that block its way, chops and
mines by the survival rules (the right tool, the real break time, the real
drops, wear on the tool), fills its real hunger bar when it eats, sleeps in
a bed and sets its spawn there, builds and fights through the same actions
as any bot, and its chat goes out as genuine chat from that account. When
you go to bed its account turns in too, so the night can pass. If a
decision fails (a rate limit, a bad key, a timeout) the reason is said in
chat instead of the player silently standing still. `!ai bridgeplays off`
turns it back into a plain relay.

## Its own things, and nobody steers it

What the AI builds, the chests it fills and what it carries are its own: it
remembers them ("My things" in its memory), keeps tools in shape, stores
surplus, keeps food on it, and is nudged when its bag is full, a tool is
about to break or it has waited with plans pending. In the world, nothing
is protected from you: hit it, prank it, open its chests, take or wreck
what it made. It is told who did what, remembers it, and answers in
character (confront, forgive, bargain, rebuild, move, hide its things, hit
back), never by griefing your things in return.

Its functions are another matter: by default the AI is **independent**.
Nobody in the game can pause it, walk it, give it jobs, wipe its memory,
inject rules, change its mission or summon companions for it; the menu
shows talk and memory only, and the steering commands answer "the AI runs
its own life here". Talking to it is the only way in, and what you ask is
a request between equals that it may refuse. The bridge's `config.json`
(`"independent": true`) pins this; set it to `false` there and restart the
bridge to get the controls back (or `!ai independent off` on a world
without a bridge).

## Who lives in your world

By default there is exactly one AI player: the bridge account itself. When
the bridge connects, its player comes alive and plays in person, and when
it disconnects that player leaves like anyone else. Want a second AI
player? Run a second bridge with another account (`node index.mjs --config
other.json`). Want a crowd without more accounts? Residents are named AI
bodies the addon spawns and keeps: `!ai players <n>` (up to 16) or the
Behavior tab. They join a few seconds after you do, keep their names,
personalities and memories across sessions, respawn when they die, and are
announced in chat like real players. `!ai summon Ellie a cheerful builder`
adds a companion bound to you; companions respawn next to you (or
permadeath, your choice) and come to you when you join.

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

## What you need (plain language)

Minecraft Bedrock on a phone, console or PC cannot talk to the internet from
an addon, so the thinking happens through a small helper program, the
**bridge**, that runs on a Windows, Mac or Linux computer and joins your
world as an extra player. You need:

1. **A computer that stays on while you play.** Install Node.js from
   nodejs.org, download this repository (green "Code" button, "Download
   ZIP"), open the `bridge` folder and run `start.bat` (Windows) or
   `start.sh` (Mac/Linux). The first run asks three questions and sets
   everything up.
2. **An AI for the players to think with.** Either the free **Player2 app**
   from player2.game (install it, log in, leave it open; no key needed), or
   an API key from one of the AI companies: Claude (console.anthropic.com),
   ChatGPT (platform.openai.com), Grok (console.x.ai) or Gemini
   (aistudio.google.com). A key is a long password-like text you paste into
   the setup once; the companies charge a few cents per hour of play. With
   several keys the residents are spread across Claude, ChatGPT, Grok and
   Gemini.
3. **A second Microsoft account for the bridge.** It joins as a player, so it
   cannot be the account you play with. Invite it to your Realm and make it
   an operator. On first start the bridge shows a sign-in code.

Then import `Real-AI-<version>.mcaddon` on your device, activate the Real AI
behavior pack on the world, join, and the eight residents walk in a few
seconds after the bridge connects.

### No Node.js yet?

* **Windows or Mac:** go to https://nodejs.org, click the big "LTS" download,
  run the installer with its defaults (on Windows leave "Add to PATH"
  ticked), then download this repository as a ZIP (green "Code" button on
  GitHub, "Download ZIP"), unzip it, open the `bridge` folder and
  double-click `start.bat` (Windows) or run `start.sh` (Mac, in Terminal).
  The first run installs what it needs and starts the setup questions.
* **Only an Android phone (no computer at all):** install Termux (from
  F-Droid or its GitHub releases, not the old Play Store build), open it,
  paste this one line and press Enter:

  ```
  curl -sL https://raw.githubusercontent.com/dreamless2006-lgtm/Project-Java-to-bedrock/ccr-72baab68-lqswgf/bridge/phone.sh | bash
  ```

  It installs Node.js, downloads the bridge, keeps the phone awake and
  starts the setup questions. Pick Gemini (free tier) or paste another key,
  give the Realm invite link, and sign in with the second Microsoft account
  when the code appears. Keep Termux open while you play (switch apps, do
  not close it; in Android settings exclude Termux from battery
  optimisation). Later, start it again with `bash ~/real-ai/bridge/phone.sh`.
  The bridge uses a pure-JavaScript network layer on phones.
* **No computer that stays on:** rent a Bedrock Dedicated Server from a host
  that lets you edit the server files, and use the `--variant server` build,
  where the server calls the AI itself and nothing else needs to run
  ([docs/SETUP-DEDICATED-SERVER.md](docs/SETUP-DEDICATED-SERVER.md)).

## Quick start

```bash
npm install            # nothing to install for the packs; this is for the test runner
npm run check          # syntax + JSON + manifest checks
npm test               # unit tests for the pure brain modules
npm run smoke          # boots the whole pack under a mock Script API engine and drives the bots
python3 tools/build_mcaddon.py
```

That writes `dist/Real-AI-<version>.mcaddon`. Import it on any world, Realm
or server (game 1.26.50 or newer, no experiments needed), activate the
behavior pack on the world (its resource pack comes with it), then run the
bridge with your API key:

```bash
cd bridge && npm install && cp config.example.json config.json
# put your key in config.json (or export ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY)
node index.mjs
```

The bridge is a small Node program that joins the world as a player and
carries the bots' thinking to the model, because Bedrock scripts cannot make
HTTP calls on Realms or client worlds. Full steps:
[docs/SETUP-REALM-BRIDGE.md](docs/SETUP-REALM-BRIDGE.md). Two optional
builds exist: `--variant beta` uses the beta script modules (Beta APIs
experiment on, bots hear chat without the relay), and `--variant server`
lets a Bedrock Dedicated Server call the model itself without a bridge
account: [docs/SETUP-DEDICATED-SERVER.md](docs/SETUP-DEDICATED-SERVER.md). Design:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Providers and model ids:
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## In game

* `!ai` or `/realai:menu` opens the hub (Getting Started, Companions, Behavior,
  Budget, Access Lists, Mod Intelligence, AI & Memory, Profiles & Models).
* Just chat; bots within earshot answer by name. `!ai talk Ellie hi` or
  `/realai:talk Ellie "hi"` whispers.
* `!ai status` lists the residents and every thinking bot; `!ai memory Ellie`,
  `!ai pause`, `!ai budget`.
* Operators: `!ai players 8`, `!ai thoughts on`, `!ai mix on`, `!ai bridgeplays on`,
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
