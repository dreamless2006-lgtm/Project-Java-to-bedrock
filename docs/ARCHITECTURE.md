# Real AI architecture

Real AI turns the bots of the *AI Multiplayer* addon (entity `rg:bot`, a
humanoid "player" body) into real AI players driven by a large language model
(LLM). It merges three things:

1. **AI Multiplayer** (the Bedrock addon this repo started from): the bot
   body, its reflexes (water escape, fleeing, jobs, gear tiers) and the
   friend/trade/duel UI.
2. **Player2NPC** (the NeoForge mod): the *product surface* of LLM companions:
   summon/despawn/whistle, companion memory, call-by-name chat, token budget,
   access lists, mod intelligence, provider profiles. Ported as server-ui
   forms and `!ai` commands.
3. **The brain** (`packs/RealAI_BP/scripts/brain/`): the agent loop that
   makes every bot observe, think with an LLM and act with its body, plus the
   resident roster that makes the world feel populated.

## The loop

```
every ~10 ticks per bot (staggered)
  actuator.tick()            continue the running action (walk, build, mine...)
  if scheduler says "think":
    obs   = perception.observe(bot)                 world snapshot (text)
    turn  = prompt.buildTurn(system, memory, obs)   stable system prompt + memory + observation
    reply = transport.think(cfg, turn)              bridge (any world) or HTTP (dedicated server variant)
    reply = action_schema.normalizeReply(json)      validate: say / mood / goal / actions / memory edits
    core.apply(reply)                               chat line, mood, goal, memory, queue actions
```

The LLM is asked for exactly one JSON object per turn (`action_schema.js`
documents the contract and every action). The body executes actions one at a
time; long-running ones (gather, build, travel, explore, follow) keep running
across turns and report progress in the next observation, so the model does
not need to be called every tick. Think cadence: ~12 s while active, ~45 s
idle, immediately when addressed in chat, hurt, or a player comes close;
slower under a soft budget limit, paused under a hard one (`scheduler.js`).

## Residents: the people who live here

`roster.js` + `BrainManager.populate()` keep a persistent list of named AI
players in the world property `realai:roster` (`worldPlayers` of them, 8 by
default, 16 max). Each entry has a persistent id (`rg:p_id` on the body,
`realai:mem:<pid>` for the memory copy), a name from the addon's name lists
and a persona. On brain start, when a player joins, when the bridge
connects, and every 30 s, the manager compares the roster with the loaded
bodies and spawns the missing ones 6 to 14 blocks from a player, two seconds
apart, each announced with the vanilla `multiplayer.player.joined` message.
A body left behind in an unloaded chunk is removed when it loads again and a
newer body with the same id exists (`entityLoad`). Residents and companions
that die respawn after 10 s (companions beside their owner, residents at
their home or near the nearest player) keeping id, memory and persona;
companions can be set to permadeath. Residents get a brain before any other
bot (`discover()` ranks companions, then residents, then the closest wild
bots, up to `maxBrains`). The original random spawner is behind the
`wildSpawns` switch, off by default.

## Modules (`scripts/brain/`)

| File | Role | Node-testable |
|---|---|---|
| `action_schema.js` | the reply contract, action docs for the prompt, validator | yes |
| `prompt.js` | rules, persona, world-content and observation rendering; stable prefix for provider caching | yes |
| `memory.js` | per-bot facts / episodes / people / chat, byte-capped for a dynamic property | yes |
| `budget.js` | token + cost ledger with soft/hard windows (the "Joules" port) | yes |
| `scheduler.js` | when a bot thinks (cadence, events, backoff) | yes |
| `roster.js` | the resident list: names, ids, personas, ring placement | yes |
| `providers/*` | request builders + response parsers: Anthropic, OpenAI-compatible (OpenAI, xAI Grok, OpenRouter, Player2, Ollama, LM Studio, custom), Gemini | yes |
| `llm_core.js` | provider-agnostic think pipeline with retries | yes |
| `frame.js` | chunked framing shared with the bridge | yes |
| `crafting.js` + `generated/` | scripted crafting/smelting (vanilla basics plus any recipes in the pack) | yes |
| `json_util.js` | tolerant JSON extraction, stable stringify | yes |
| `perception.js` | observation from the live world | in-game |
| `actuator.js` | every action on the real body | in-game |
| `core.js` | BotBrain, manager, events, chat intake, keep-alive, residents, companions, respawns | in-game |
| `transport.js`, `net_impl.*.js`, `bridge_channel.js` | how a think reaches a model | in-game |
| `config.js`, `commands.js`, `ui.js`, `gate.js`, `world_content.js` | settings, `!ai` commands, hub menu, legacy gating, modded-content discovery | in-game |

Pure modules have no `@minecraft/*` imports and are covered by `npm test`.
The in-game modules are exercised by `npm run smoke`: `tests/harness/` is a
small mock of `@minecraft/server` and `@minecraft/server-ui` (ticks, timers,
events fired at end of tick, a flat world, entities with inventories and
simple physics, commands, dynamic properties, ticking areas), and
`tests/smoke/run.mjs` loads `main.js` on top of it, connects a fake bridge
account, relays chat, answers the bots' thinks with scripted model replies
and checks that a bot talks, remembers, walks, builds, crafts, travels to the
Nether, that companions respawn and come to their owner on join, and that
the eight residents join, come back with the same names and memories after a
reload, never duplicate, and respawn when killed, with no engine errors.

## Two ways to reach a model

Bedrock scripts can only make HTTP calls on a **Bedrock Dedicated Server**
(`@minecraft/server-net`, with keys in `secrets.json` via
`@minecraft/server-admin`). Realms and ordinary worlds cannot. So there are
two transports behind one interface:

* **Bridge** (the standard addon): a Node process (`bridge/index.mjs`) joins
  the world as a player through `bedrock-protocol`. The addon sends each turn
  to that player with `Player.sendMessage` frames (`AIB1|id|i/n|payload`);
  the bridge calls the provider and answers with `/scriptevent realai:in`
  frames. The bridge also relays public chat into the addon (so bots hear
  players on the stable API, which has no chat events), relays `!ai`
  commands, keeps a Realm loaded while humans are offline, and can teleport
  itself near the bots so their chunks keep ticking.
* **Direct** (the optional `--variant server` build): `net_impl.bds.js` wraps
  `http.request`. Keys are opaque `SecretString`s that are only ever placed
  in HTTP headers.

`transport.js` picks direct HTTP when the build has it, otherwise the bridge
when one is connected, otherwise reports "no transport": bots then fall back
to their scripted reflexes and no residents are spawned (the joining player
is told what is missing).

## Builds (`tools/build_mcaddon.py`)

| Build | `@minecraft/server` | Where it loads | Chat input |
|---|---|---|---|
| standard (default) | `2.10.0` stable, no experiments | Realms, any world, any server | bridge relay, `!ai talk`, hub "Talk", sneak+interact |
| `--variant server` | `2.11.0-beta` + server-net/server-admin | Bedrock Dedicated Server only | direct chat events |

The checked-in manifest is the stable one; the builder rewrites the
dependency versions and swaps `net_impl.js` for the server variant. Beta
module versions do not auto-upgrade across game releases, so
`BETA_SERVER_VERSION` in the builder must be bumped when a new major Bedrock
release ships.

## How legacy behaviour and the brain coexist

`gate.js` tracks which bots have a brain. When a bot is brain-driven:

* every canned chat line that used to go through `botSay()` becomes an
  *impulse* the model may voice ("you feel like saying: ...") instead of a
  broadcast;
* the random talkers, mood evaluator, goal assigner, idle builder, night
  camp, mischief, quests and friendship proposals skip that bot;
* reflexes stay on: water escape, fleeing fire/creepers, hole escape,
  obstacle breaking, engine combat (fake-melee projectiles, bows, shields),
  hunger/eating, gear tiers, friend UI, trades, duels;
* the fake "other players" chat simulator and faction recruit broadcasts are
  off unless re-enabled in Behavior.

Bots without a brain (beyond `maxBrains`, or when no transport exists) keep
behaving exactly like the original addon.

## Persistence

* World: `realai:cfg` (settings JSON), `realai:budget` (ledger), `realai:access`
  (access lists), `realai:roster` (the residents),
  `realai:mem:<persistent id>` (memory copies that survive death, reloads
  and revival).
* Bot entity: `realai:bot` (persona, owner, mode: `resident`, `companion`,
  `auto` or `paused`), `realai:mem` (memory), plus the legacy `rg:*` keys
  (persistent id, sympathy, friends, jobs, mood, goal) that the brain reads
  and writes so the existing UI stays truthful.
* Player: `realai:companions` (summoned companions) and the legacy friend list.

## Staying active when the human leaves

Entities only tick in loaded chunks. On a dedicated server the brain keeps up
to four ticking areas around bot clusters (`keepAlive`), so residents and
companions keep building and exploring while nobody is online. On a Realm
the bridge player keeps the Realm running and, with `anchor` enabled,
teleports itself near the busiest bot cluster every couple of minutes. When
chunks do unload, the residents simply "log in" again next to you the next
time you join.

## Modded content

`world_content.js` asks the game for every registered block, item and entity
id and keeps the ones outside the `minecraft:` namespace (minus this pack's
own helper entities and obvious projectiles), with human names from the
resource pack's language file when available. The list is part of the
stable system prompt, so a bot can name, pick up, place or fight anything
another addon adds, and `use_item` holds any modded item so its own engine
effects apply.
