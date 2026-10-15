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

## Inner life

`drives.js` (pure) keeps six 0..100 drives per bot inside its memory
(`memory.drives`): social, rest, curiosity, safety, boredom, purpose. Each
think updates them from what happened (talked, slept, night, threats,
health, a new place, an idle turn, finished work) and renders them as one
"You feel ..." line in the observation; a pressing drive shortens the next
think (`cadenceFactor` → `beginThink` factor). The reply contract gained
`self` (one or two sentences the bot keeps about itself, `memory.self`) and
`plans` (an ordered list, `memory.plans`), both rendered at the top of the
memory block. Every `reflectEvery` thinks (20) the turn carries a reflection
nudge asking the model to consolidate facts, rewrite self and update plans.
The manager fires `dawn` events when night turns to day, `weather` events
from `weatherChange`, and `home_touched` events when a non-owner breaks or
places blocks within 12 blocks of a bot's home (`playerBreakBlock` /
`playerPlaceBlock`). Bot-to-bot chatter wakes a listener half the time.

## Mission: beat the game

`progress.js` (pure) lists fifteen milestones with inventory/flag tests and
a "usual next step" each; `renderMission` becomes the `obs.progress` line
and the system prompt carries the purpose when `mission` is
`beat_the_game`. Flags live in `memory.mission`: `nether`/`end` (set when
the bot is observed in that dimension), `strongholdAt` (from `locate`),
`portalLit` (from placing the twelfth eye), `dragon` (from `entityDie` of
`minecraft:ender_dragon`, credited to the killer's brain or to every brain
in the End). The `locate` action sends `{t: "locate"}` to the bridge, which
runs `/locate structure <name>` as the account and parses the command
output into `{t: "locate_result"}`; the brain's `takeLocateResult` hands it
to the action. `use_item ender_eye` near `end_portal_frame` blocks fills one
frame per use (tracked per brain, or from the block state when readable)
and fills the 3x3 interior with `end_portal` when twelve are set.
`freeBuild` is off by default so building draws on the inventory.

## The bridge account plays

Bedrock movement is server-authoritative: a player only moves when its own
client sends `player_auth_input` every tick with the inputs it holds and the
position it predicts; the server simulates the same inputs and corrects the
client when they diverge. A client that never sends input is never
simulated, and a client that never closes its initial loading screen is not
treated as a spawned player (unhittable, frozen). So `bridge/body.mjs` is
the bridge account's body: at join it runs the vanilla handshake
(`request_chunk_radius` + loading screen start after `start_game`; `interact`
+ loading screen end + `set_local_player_as_initialized` on the first
`play_status player_spawn`), then sends one `player_auth_input` every 50 ms.
It keeps the feet position from the server's packets (`start_game`,
`move_player`, `correct_player_move_prediction`, `respawn`,
`change_dimension`), walks towards the footing points the addon sends with
the vanilla model (impulse 0.98 x speed, friction 0.91 x 0.6 on the ground,
gravity 0.08 x 0.98, jump 0.42 with a 10-tick cooldown, step height
0.5625), acknowledges teleports with `handled_teleport`, answers the
respawn and dimension-change handshakes, and resyncs when the addon reports
the server keeps the body elsewhere. Messages: `walk{x,y,z,mode,jump,fx,fy,fz}`
(walk to a footing point, the head turns to face it), `input{f,s,sprint,sneak,jump,ms,floor,fx,fy,fz}`
(raw keys: f +1 forward / -1 back, s +1 left / -1 right, held for a lease of `ms`
and released by themselves when the addon goes quiet; `floor` is the ground a
step ahead, which is how a body without eyes hops a ledge or drops down one),
`jump`, `stop`, `look{x,y,z}` or `look{yaw,pitch}`, `swing`, `body_status`, and
`probe`/`probe_hurt` while `!ai debug` is on. Yaw 0 faces south (+z), 90 west,
180 north, -90 east; pitch is negative looking up; strafe left is +x when facing
south. `Body.press`/`release`/`setLook` are the key and head API.

Seeing and moving, in the addon: `terrain.js` (pure) classifies blocks once for
everyone (air, passable: snow layers, grass, carpets, signs, flowers; water;
lava; hazard; solid; tall: fences and walls), so the walker's footing check and
`path.js` never disagree about what is a wall. `path.js` heads for the closest
reachable point when there is no way all the way, flags climbs as jumps, needs
head room at the departure level for a step down, and keeps 0.35 blocks off
corners when it smooths a route; the walker (`stepPlayerBody`) plans far goals
in 24-block segments, plans again whenever it is more than a block from its goal
(at most every ten ticks, and after a failed plan not for two seconds), probes
0.3 blocks beyond its next step because the body is 0.6 wide, and sends the
height it really stands at, not the block index, so a snow layer or a path block
is not a step.
`senses.js` (pure) is the eyes: `survey` (how far the ground goes on in each of
eight directions and why it ends), `castRay`/`sights` (what a line of sight hits:
trees, ore, water, lava, built things, far rock; the floor is not a sight),
`landmarks` (a coarse grid over 24 to 32 blocks that finds a tree three blocks off
every line of sight), `lookingAt`, `probeAhead` (the first change of level, or the
first wall, drop, water or lava, along the way a held key is carrying the body; it
looks 1.7 blocks ahead walking, 2.3 sprinting and 2.2 further when hopping,
because a key released now still carries the body on). `around.js` turns those into the "Around you"
line of every observation and the `look_around` report, and remembers which 16x16
columns have been walked (`unexplored`). The actions `look`, `look_around`, `move`
and `jump` are in `actuator.js`; `move` and `look_around` are `fast` handlers,
stepped every tick by `Actuator.pulse` from the per-tick layer (the rest of the
actuator is supervised every ten ticks), so a key is never released late.

The body also takes what the server says seriously: after a
`correct_player_move_prediction` it adopts the server's state for that tick and
replays the inputs it has sent since (`advance`/`hist`), as a vanilla client does,
so a link with latency settles after one correction; the addon's position reports
are judged against the body's last few ticks, not its present position; the ground
height comes from the server's own reports (`fg`, on ground) so slabs, snow layers
and path blocks need no table; a step down counts only once the body is past its
edge, a ledge once it is reached, and the hop to a ledge keeps that ledge as the
ground until the body has landed; a walk target lapses after two seconds without a
fresh frame. Input ticks are numbered from zero by default; `connect.tickBase:
"server"` continues from start_game's tick, and the bridge flips the numbering
itself once (and says so) when keys are held for twenty seconds, nothing moves
and nothing objects. Frames from the addon are accepted only from raw/json text,
never from a player's chat, whisper or announcement.

Diagnosis: the bridge counts the ticks a move key was down and the real distance
the addon reports the body moved (`Body.intentTicks`, `truthMoved`); every five
seconds `monitorMotion` warns (log and, once, the world's chat) when keys were
down without real movement, or when the server pulled the body back 15 times
(corrections or teleports). `node index.mjs --selftest` walks the body with the
AI's own presses and reads the true position with `/tp @s ~ ~ ~`. `!ai body`
prints the bridge's `body_status`.

A player body has no engine reflexes, so `reflex.js` (pure) decides the
body-level reactions and `BotBrain.onHurtBy`/`reflexScan` apply them: hit by
a monster it enqueues an attack at the front (or a flee when low on health or
hit by a creeper), once a second it checks for lava, fire (nearest water
within ten blocks) and a creeper within four blocks; each reflex has a
cooldown and is reported to the model as a `hurt` event. Death keeps the
brain on the player body (`brain.dead` until the `playerSpawn` respawn),
records `memory.deathPos`, stops the actuator, and the respawn event tells the
model where its items lie; the bridge presses Respawn itself (player_action
respawn) about 1.2 s after the death, again after 1.5 s and 4 s if the server
has not answered, and sends respawn state 2 when the server says it is ready.

The per-tick layer (`BotBrain.fastTick`, run by the manager every tick for
player bodies) is where the body is better than a human hand: `path.js`
(pure A* over block cells: eight-way, one-block jumps, drops up to three,
no lava, water when allowed, smoothed waypoints, a node budget and a
"too far around" rule that hands long detours back to the tunnelling
walker) plans the walker's route; `combatTick` tracks the target every
tick and hits exactly every ten ticks (the damage-immunity window);
`autoEat`, `autoEquip` and `mlgWater` handle food, gear and falls; the
reflex scan runs every tick. A `dangerUntil` mark (hurt, or a monster
within eight blocks) shortens the think cadence to `thinkCombatSec`.

Ownership lives in memory (`memory.chests`, `memory.builds`, bounded;
`noteChest`/`noteBuild`/`findOwned`/`forgetChest` in `memory.js`): a
finished `build` records its box, a placed chest and every
`open_container` record the chest and a summary of its contents, and
`renderMemory` lists them under "My things". The manager's block events
(`playerBreakBlock`, `playerPlaceBlock`, `playerInteractWithBlock`) check
`findOwned` and raise a `home_touched` event naming the player and the
thing, and note the person. `BotBrain.upkeep` (every five seconds on a
player body) points out a nearly full bag, a tool about to break and no
food; `apply` adds a problem when the model waited with plans pending.

Independence (`independent`, default true; pinned by the bridge's hello
when its config sets it): `commands.js` refuses the steering commands
(STEERING set), the hub shows talk and memory only, server rules are not
injected into the system prompt, the legacy friend-request/job UI is
disabled, and the system prompt tells the AI that nobody can command it
and that players' asks are requests between equals.

With `bridgePlays` (default on) the manager finds the bridge's player
(`transportInfo().bridgePlayer`) and gives it a `BotBrain` with mode
`bridge`. Scripts cannot push a real player. When the bridge has a body (its
hello says `body: 1`), `stepPlayerBody` sends it footing points (`walk` frames
every two ticks, never a teleport) and the bridge's client walks there itself;
only other player bodies (tests, older bridges) are stepped by teleport, 0.2 to
0.28 blocks per tick, snapping to standable blocks, never onto lava, sliding
sideways past a post or a trunk; a slide that lasts more than a few blocks is a
wall and the body stops so the handler can dig through plain terrain with
`clearPath` (soft blocks such as grass and snow layers are never dug). A player body
cannot use the legacy job worker, so `gather` and `mine_down` run as script
state machines on it: `harvest.js` (pure) knows what a block drops, which
tool and tier it needs and how long it takes to break; `harvestBlock`
removes the block, hands the drops to the inventory and wears the tool.
`eat` fills the player's own hunger attribute (`minecraft:player.hunger`),
`sleep` lies on a bed, sets the spawn point and lets the night pass once
every other player is in bed; `bedtimeWatch` in the manager does the same
when the humans go to bed first. Its chat is sent to the bridge as `chat_out`, which the bridge
turns into a real `text` packet from the account (whispers become `/tell`).
While the bridge player has a brain the addon sends `anchor {off: true}`
so the bridge stops teleporting itself around.

## Testing against a real server

`npm run e2e` starts a real Bedrock server (Dragonfly v0.11.5, `tests/e2e/dragonfly`; it needs
Go, which fetches the toolchain the module asks for, and builds it on every run unless `DF_SERVER_BIN`
names a built binary: `go build -o /tmp/df-server .` in that folder; `GO_BIN` names the go
executable; the scripts share UDP ports 19138 and 19139, so run one at a time, and `pkill -x df-server`
clears a server a crashed run left behind) and joins it with the real bridge
(`bridge/node_modules` must hold `bedrock-protocol`). Every assertion is about what the
server sees: the body is on the ground, walks at 4.3 blocks/s and sprints at 5.6, turns its
head, jumps with the vanilla arc, is hit and killed by another player, respawns by itself and
walks again. `npm run e2e:loop` runs the real addon code (brain, actuator, pathfinder, senses)
on the mock Script API against that bridge and server: the AI's `move_to` across open ground, a
built wall, snow layers, a one-block ledge, a 60-block trip, and its own keys (look, move in all
four directions, sprint, sneak, wall and pit stops, ledge hop, jump, look_around), judged by
where the server says the body is. `npm run e2e:selftest` checks the bridge's self-test verdicts
against a server that accepts movement and one that rejects it (`DF_FREEZE=1`). A small UDP relay
(`tests/e2e/lib.mjs`) adapts the RakNet quirks of the library and the server. This cannot prove
what a Realm (Bedrock Dedicated Server with server-authoritative movement) accepts; that is what
`--selftest` and `!ai body` are for on the real thing.

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
| `terrain.js` | what a block means to a walking body (passable, solid, tall, hazard, lava, water) | yes |
| `path.js` | A* over block cells: eight-way, jumps, drops, partial paths, corner clearance | yes |
| `senses.js` | the eyes: walk survey, line-of-sight rays, sights, what is under the crosshair | yes |
| `around.js` | the "Around you" report and the explored-columns memory | in-game (reads the dimension) |
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
| standard (default) | `2.10.0` stable + server-ui `2.2.0`, engine 1.26.50, no experiments | game 1.26.50+: Realms, any world, any server | bridge relay, `!ai talk`, hub "Talk", sneak+interact |
| `--variant beta` | `2.11.0-beta` + server-ui `2.0.0`, engine 1.26.30 (the original addon's module set); Beta APIs experiment on | worlds with the experiment | direct chat events, plus everything above |
| `--variant server` | beta + server-net/server-admin | Bedrock Dedicated Server only | direct chat events |

The checked-in manifest is the standard one; the builder rewrites the
dependency versions for the other two and swaps `net_impl.js` for the
server variant. The `.mcaddon` carries the two packs as nested `.mcpack`
entries, resource pack first, so the game imports them one at a time
(`--layout folders` writes the loose-folder layout instead). The resource pack declares no dependencies (a resource pack
cannot depend on a behavior pack; the behavior pack depends on the resource
pack so it is activated with it). Beta module versions do not auto-upgrade across game
releases, so `BETA_SERVER_VERSION` in the builder must be bumped when a new
major Bedrock release ships.

## Who decides: the model, not the script

`gate.js` tracks which bots have a brain. When a bot is brain-driven, the
model makes every decision and the original addon's scripted decision-making
is switched off for that bot:

* **Engine goals.** `core.js` fires the entity event `realai:brain_on`, which
  removes the `good`/`bad`/`crazy` groups (nearest-attackable-target, avoid
  mob), the follow and stroll groups and the furnace/work trips, and adds
  `realai_brain`, which keeps only `hurt_by_target` (fight back in the
  instant after being hit; the model is told and can `flee` or `stop`). It
  is re-applied every discover cycle and after a job ends, and
  `realai:brain_off` restores the original groups when a brain is removed.
* **Scripted loops gated with `brainActive()`:** target tactics (retreat,
  heal, call for help), food hunting, random eating and flee logic, furnace
  trips, swarm/low-health fleeing and drifting in `ai_survival_brain`,
  item pickup gifting, torch placing, stroll switching, mounting, shelter
  building, rain sheltering, affinity gifts and grudges, feud scanning,
  mediation, greetings, grouping up and going home at night, plus the
  earlier set: random talkers, mood evaluator, goal assigner, idle builder,
  night camp, mischief, quests, friendship proposals, fake chat, faction
  broadcasts.
* **Reflexes that stay on** (a human hand's split-second moves, all
  reported back to the model as impulses or events): water escape, burning
  (find water), a creeper about to explode, lava directly ahead, TNT nearby,
  hole escape, obstacle breaking while walking a path the model asked for,
  shield/weapon handling while executing a model-ordered fight, gear tiers.
* every canned chat line that used to go through `botSay()` becomes an
  *impulse* the model may voice ("you feel like saying: ...") instead of a
  broadcast; the fake "other players" chat simulator and faction recruit
  broadcasts are off unless re-enabled in Behavior.

Residents are spread across every hosted provider that has a key
(`mixProviders`), each think carries that bot's provider to the bridge or
the HTTP layer, the system prompt tells the bot which model it runs on, and
`showThoughts` prints each decision (reasoning plus chosen actions) to
nearby players. If the world's default provider has no key but another
does, the manager adopts the one that works when the bridge connects.

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
