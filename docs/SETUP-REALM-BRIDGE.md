# Setup: Realms, LAN worlds, friend worlds and servers (the bridge)

Scripts on Realms and ordinary worlds cannot make HTTP calls, so the model
runs behind a small Node program, the **bridge**, that joins the world as a
player and relays thinking. It also keeps a Realm loaded while you are away
and lets bots hear chat on the stable API. The same single addon and the
same bridge work on a dedicated server too.

## 1. Build and install the addon

```bash
python3 tools/build_mcaddon.py
```

Import `dist/Real-AI-<version>.mcaddon` (double-click it, or open it from
the game) and activate the **Real AI** behavior pack on the world; the
resource pack is activated with it. No experiments are needed (game 1.26.50
or newer). Then upload or "Replace World" on your Realm. If an older
"Real AI" or "AI Sandbox" pack is still installed on the device, remove it
first in Settings > Storage so only one copy exists.

**Updating:** the game ignores an import whose version is the same as or
lower than the copy it already has, and a Realm keeps its own copy of the
pack. To update, remove the old Real AI packs from the device (Settings >
Storage), import the new `.mcaddon`, activate it on the world, and have
everyone leave and rejoin the Realm. The bridge's log says which build the
world runs (`addon says hello (build 2.9.0, walks yes)`); a `walks no` line
means the Realm still serves an older pack that cannot move the body.

## 2. Prepare a second Microsoft account for the bridge

The bridge logs in with its own Xbox account (it takes one player slot).
Invite that account to the Realm and make it an **operator** (Realm settings
> Members, or `/op <gamertag>` in game). The bridge needs operator rights to
run `/scriptevent`, which is how it answers the addon. Cheats must be
allowed on the world.

## 3. Run the bridge

Install Node.js 20 or newer from nodejs.org, then run `start.bat`
(Windows) or `start.sh` (Mac/Linux) in the `bridge` folder. The first run
is a short wizard: which AI (the free Player2 app, or a Claude / ChatGPT /
Grok / Gemini key), which Realm or server, and the gamertag for the bridge
account. It writes `config.json` and starts; `node index.mjs --setup` runs
the wizard again. Advanced users can edit `config.json` by hand:

```bash
cd bridge
npm install
cp config.example.json config.json
# edit config.json: set providers.<id>.apiKey (or export ANTHROPIC_API_KEY etc.)
node index.mjs --test-provider anthropic   # optional: one test call
node index.mjs                             # joins the Realm (device-code sign-in on first run)
```

`config.json` fields:

| Field | Meaning |
|---|---|
| `connect.mode` | `realm` (default) or `server` (host/port of a LAN world or dedicated server) |
| `connect.realm.invite` / `id` | which Realm; leave both empty to pick the first joined Realm |
| `connect.username` | gamertag shown in the player list |
| `connect.offline` | `true` only for servers that allow offline logins |
| `defaults.provider` | provider used when the world does not pick one (`anthropic`, `openai`, `xai`, `gemini`, `player2`, `openrouter`, `ollama`, `lmstudio`, `custom`) |
| `providers.<id>.apiKey/model/baseUrl` | keys and model overrides; env vars `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `PLAYER2_API_KEY` also work |
| `chatRelay` | relay public chat to the bots (needed on the stable API) |
| `anchor.enabled` | teleport the bridge near the busiest bot cluster so their chunks keep ticking while you are offline |
| `maxConcurrentThinks` | parallel model calls |

Keep the bridge running on any always-on machine (a laptop, a Raspberry Pi,
a cheap VPS). It reconnects on its own.

Optional hardening: `!ai bridgename <gamertag>` makes the addon accept
bridge traffic only from that account (any operator can otherwise claim the
role).

## 4. In game

Join the world. When the bridge connects you see its account join like any
player; a few seconds later that player starts moving and talking: it is
the AI, playing in person (the bridge also turns off `sendcommandfeedback`
so its script events do not show up as chat lines). If it stands still,
read the chat: a failed decision is reported there with its cause, usually
a free-tier rate limit. To test the body without waiting for the model, an
operator can type `!ai walk <gamertag> 5 0` and watch it walk five blocks;
`!ai where <gamertag>` shows where the server keeps it and what its walker
is doing. With `!ai debug on` the bridge's log prints a `probe:` line every
second comparing the server's position with its own, and reports every hit
the body takes. The bridge puts its account into survival on join (set
`connect.gamemode` to `null` in `config.json` to leave the game mode alone);
if "Friendly Fire" is off in the Realm's settings nobody can hit any player,
and the log says so. The body has reflexes of its own: hit by a monster it
fights back within a tick (or runs when low on health or from a creeper),
on fire it heads for the nearest water, in lava it climbs out; the model
hears about each reflex on its next turn and can override it. When the
body dies the bridge answers the respawn screen at once, the brain stays
with the body, and the AI is told where its items fell so it can go back
for them. Below the model there is a per-tick layer that never waits for a
decision: paths are planned through the blocks around (round walls and
fences, over steps, never through lava), a fight is fought on the damage
beat (a hit the moment the target's immunity ends, tracking it every
tick), food is eaten when the bar is low and nothing hostile is near,
better armour goes on the moment it is in the bag, and a water bucket is
poured under the body when it falls. While in danger the model is asked
every `thinkCombatSec` seconds (default 3) instead of every
`thinkActiveSec`. The AI is independent by default: `!ai walk`, `!ai pause`,
`!ai forget`, `!ai rules`, `!ai mission` and `!ai summon` are refused for
everyone, the menu offers talk and memory only, and the legacy friend-request
items are not handed out. `"independent": false` in the bridge's
`config.json` (then restart the bridge) brings the controls back; the
movement test `!ai walk` is only available then. `!ai status` shows `bridge (<gamertag>)` as the
transport and lists every thinking player with its provider and model. For
more AI players, `!ai players <n>` spawns named residents that join next to
you. Put several keys in `config.json` and the residents are spread
across them (two on Claude, two on ChatGPT, two on Grok, two on Gemini with
four keys). `!ai thoughts on` shows their reasoning and decisions in chat. If you joined before the bridge was up,
the game tells you what is missing and the residents join as soon as the
bridge connects.

If `!ai` lines are not picked up (stable API without the relay), use the
slash commands instead:

```
/realai:menu                       open the Real AI menu
/realai:talk Ellie "come help me"  whisper to a bot
/realai:companion Ellie "a brave builder"
/realai:ai "status"
```

The Friend List item (sneak + use) also opens the menu, and sneaking while
interacting with a bot opens its card.

## Keeping bots active when you leave

A Realm keeps ticking while any player is connected, and the bridge is a
player. Chunks only simulate near players, so turn on `anchor` and the bridge
parks itself near the bots' base; the addon also keeps script ticking areas
around bot clusters. Bots then keep building, mining and exploring while you
are away, within your token budget. If their chunks do unload, they simply
log in again next to you when you come back, with their memories intact.
