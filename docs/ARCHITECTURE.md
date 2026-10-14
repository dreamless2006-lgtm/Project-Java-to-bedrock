# AI Sandbox architecture

AI Sandbox turns the bots of the *AI Multiplayer* addon (entity `rg:bot`, a
humanoid "player" body) into real AI players driven by a large language model
(LLM). It merges three things:

1. **AI Multiplayer x Scape and Run: Parasites** (the Bedrock addon this repo
   started from): the bot body, its reflexes (water escape, fleeing, jobs,
   gear tiers), the friend/trade/duel UI and the parasite apocalypse.
2. **Player2NPC** (the NeoForge mod): the *product surface* of LLM companions:
   summon/despawn/whistle, companion memory, call-by-name chat, token budget,
   access lists, mod intelligence, provider profiles. Ported as server-ui
   forms and `!ai` commands.
3. **The brain** (`packs/AI_Sandbox_BP/scripts/brain/`): the agent loop that
   makes every bot observe, think with an LLM and act with its body.

## The loop

```
every ~10 ticks per bot (staggered)
  actuator.tick()            continue the running action (walk, build, mine...)
  if scheduler says "think":
    obs   = perception.observe(bot)                 world snapshot (text)
    turn  = prompt.buildTurn(system, memory, obs)   stable system prompt + memory + observation
    reply = transport.think(cfg, turn)              HTTP (dedicated server) or bridge (Realm)
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

## Modules (`scripts/brain/`)

| File | Role | Node-testable |
|---|---|---|
| `action_schema.js` | the reply contract, action docs for the prompt, validator | yes |
| `prompt.js` | rules, persona, world-content and observation rendering; stable prefix for provider caching | yes |
| `memory.js` | per-bot facts / episodes / people / chat, byte-capped for a dynamic property | yes |
| `budget.js` | token + cost ledger with soft/hard windows (the "Joules" port) | yes |
| `scheduler.js` | when a bot thinks (cadence, events, backoff) | yes |
| `providers/*` | request builders + response parsers: Anthropic, OpenAI-compatible (OpenAI, xAI Grok, OpenRouter, Player2, Ollama, LM Studio, custom), Gemini | yes |
| `llm_core.js` | provider-agnostic think pipeline with retries | yes |
| `frame.js` | chunked framing shared with the bridge | yes |
| `crafting.js` + `generated/` | scripted crafting/smelting incl. every recipe in the pack | yes |
| `json_util.js` | tolerant JSON extraction, stable stringify | yes |
| `perception.js` | observation from the live world | in-game |
| `actuator.js` | every action on the real body | in-game |
| `core.js` | BotBrain, manager, events, chat intake, keep-alive, companions | in-game |
| `transport.js`, `net_impl.*.js`, `bridge_channel.js` | how a think reaches a model | in-game |
| `config.js`, `commands.js`, `ui.js`, `gate.js`, `world_content.js` | settings, `!ai` commands, hub menu, legacy gating, modded-content discovery | in-game |

Pure modules have no `@minecraft/*` imports and are covered by `npm test`.

## Two ways to reach a model

Bedrock scripts can only make HTTP calls on a **Bedrock Dedicated Server**
(`@minecraft/server-net`, with keys in `secrets.json` via
`@minecraft/server-admin`). Realms and ordinary worlds cannot. So there are
two transports behind one interface:

* **Direct** (`bds` edition): `net_impl.bds.js` wraps `http.request`. Keys are
  opaque `SecretString`s that are only ever placed in HTTP headers.
* **Bridge** (`realm` editions): a Node process (`bridge/index.mjs`) joins the
  world as a player through `bedrock-protocol`. The addon sends each turn to
  that player with `Player.sendMessage` frames (`AIB1|id|i/n|payload`); the
  bridge calls the provider and answers with `/scriptevent aisb:in` frames.
  The bridge also relays public chat into the addon (so bots hear players on
  the stable API, which has no chat events), relays `!ai` commands, keeps the
  Realm loaded while humans are offline, and can teleport itself near the
  bots so their chunks keep ticking.

`transport.js` picks the bridge when one is connected (or forced), otherwise
direct HTTP, otherwise reports "no transport" and bots fall back to their
scripted reflexes.

## Editions (`tools/build_mcaddon.py`)

| Edition | `@minecraft/server` | Where it loads | Chat input |
|---|---|---|---|
| `realm` (default) | `2.10.0` stable, no experiments | Realms, any world, BDS | bridge relay, `!ai talk`, hub "Talk", sneak+interact |
| `realm-beta` | `2.11.0-beta` | worlds with the Beta APIs experiment | direct chat events |
| `bds` | `2.11.0-beta` + server-net/server-admin | Bedrock Dedicated Server only | direct chat events |

The checked-in manifest is the stable one; the builder rewrites the
dependency versions and swaps `net_impl.js` per edition. Beta module versions
do not auto-upgrade across game releases, so `BETA_SERVER_VERSION` in the
builder must be bumped when a new major Bedrock release ships.

## How legacy behaviour and the brain coexist

`gate.js` tracks which bots have a brain. When a bot is brain-driven:

* every canned chat line that used to go through `botSay()` becomes an
  *impulse* the model may voice ("you feel like saying: ...") instead of a
  broadcast;
* the random talkers, mood evaluator, goal assigner, idle builder, night
  camp, mischief, quests and friendship proposals skip that bot;
* reflexes stay on: water escape, fleeing fire/creepers, hole escape,
  obstacle breaking, engine combat (fake-melee projectiles, bows, shields),
  hunger/eating, gear tiers, friend UI, trades, duels, parasites;
* the fake "other players" chat simulator and faction recruit broadcasts are
  off unless re-enabled in Behavior.

Bots without a brain (beyond `maxBrains`, or when no transport exists) keep
behaving exactly like the original addon.

## Persistence

* World: `aisb:cfg` (settings JSON), `aisb:budget` (ledger), `aisb:access`
  (access lists), `aisb:mem:<persistent id>` (memory copies that survive death
  and revival).
* Bot entity: `aisb:bot` (persona, owner, mode), `aisb:mem` (memory), plus the
  legacy `rg:*` keys (sympathy, friends, jobs, mood, goal) that the brain
  reads and writes so the existing UI stays truthful.
* Player: `aisb:companions` (summoned companions) and the legacy friend list.

## Staying active when the human leaves

Entities only tick in loaded chunks. On a dedicated server the brain keeps up
to four ticking areas around bot clusters (`keepAlive`), so companions keep
building and the parasites keep evolving while nobody is online. On a Realm
the bridge player keeps the Realm running and, with `anchor` enabled,
teleports itself near the busiest bot cluster every couple of minutes.

## Modded content

`world_content.js` asks the game for every registered block, item and entity
id and keeps the ones outside the `minecraft:` namespace, with human names
from the resource pack's language file and parasite stats from the SRP data.
The list is part of the stable system prompt, so a bot can say "there is a
Primitive Longarms behind you" or use `use_item` with `srp:quench`, and any
other addon's content is picked up the same way.
