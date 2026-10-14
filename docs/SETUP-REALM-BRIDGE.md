# Setup: Realms, LAN worlds and friend worlds (bridge edition)

Scripts on Realms and ordinary worlds cannot make HTTP calls, so the model
runs behind a small Node program, the **bridge**, that joins the world as a
player and relays thinking. It also keeps the Realm loaded while you are
away and lets bots hear chat on the stable API.

## 1. Build and install the packs

```bash
python3 tools/build_mcaddon.py            # realm edition (stable API, no experiments)
```

Install `dist/ai-sandbox-<version>-realm.mcaddon` on the world, then upload
or "Replace World" on your Realm. No experiments are required for this
edition. (`--edition realm-beta` adds direct chat events but needs the Beta
APIs experiment, which Realms may not accept.)

## 2. Prepare a second Microsoft account for the bridge

The bridge logs in with its own Xbox account (it takes one player slot).
Invite that account to the Realm and make it an **operator** (Realm settings
> Members, or `/op <gamertag>` in game). The bridge needs operator rights to
run `/scriptevent`, which is how it answers the addon. Cheats must be
allowed on the Realm.

## 3. Configure and run the bridge

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

## 4. In game

Join and type `!ai status`. You should see `bridge (<gamertag>)` as the
transport. If `!ai` lines are not picked up (stable API without the relay),
use the slash commands instead:

```
/aisb:menu                       open the AI Sandbox menu
/aisb:talk Ellie "come help me"  whisper to a bot
/aisb:summon Ellie "a brave builder"
/aisb:ai "status"
```

The Friend List item (sneak + use) also opens the menu, and sneaking while
interacting with a bot opens its card.

## Keeping bots active when you leave

A Realm keeps ticking while any player is connected, and the bridge is a
player. Chunks only simulate near players, so turn on `anchor` and the bridge
parks itself near the bots' base; the addon also keeps script ticking areas
around bot clusters. Bots then keep building, mining and fighting the
parasites while you are away, within your token budget.
