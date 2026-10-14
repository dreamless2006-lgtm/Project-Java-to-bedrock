# Minepreggo → Bedrock porting plan

Source: **Minepreggo 1.3.2** for Forge 1.20.1 (`modId` `minepreggo`, by DixMK, *All Rights Reserved*).
Target: **Minecraft Bedrock 1.26.30+**, behavior pack + resource pack shipped together as a `.mcaddon`,
logic written against the stable Script API `@minecraft/server` 2.8.0 (no experimental toggles).

The port is done in phases. Every phase must leave the add-on loadable with no content-log errors,
and each phase only ships the textures it actually uses (see `tools/build.mjs`).

## Ground rules

- **Assets stay out of git.** Textures, translations and the pack icon come from the original jar
  through `npm run import`; the jar is never committed. Publishing a built `.mcaddon` redistributes
  DixMK's and the credited artists' work, so that needs the author's permission.
- **Keep Java ids and lang keys.** Items/blocks/entities keep their Java identifiers (`minepreggo:<id>`),
  and `minecraft:display_name` points at the Java lang key so all four translations work unchanged.
- **Babies are never eligible** for taming, pregnancy, or any interaction/"request" system. Java
  enforces this (`PreggoMob.java` refuses to tame `isBaby()` mobs; villager interactions require
  `Villager.canBreed()`, i.e. an adult); every Bedrock port of those systems must check it too.
- **Validate before shipping:** `npm run check` (TypeScript over the scripts + schema/reference checks).

## How Java concepts map to Bedrock

| Java (Forge) | Bedrock | Notes |
|---|---|---|
| Item registry + item classes | `BP/items/*.json` + item custom components | Food effects: `minepreggo:food_effects` |
| Blocks (`CropBlock`, block entities) | `BP/blocks/*.json` + block custom components | Crops: `minepreggo:crop` |
| Recipes (`data/minepreggo/recipes`) | `BP/recipes` | Remainders (buckets/bottles) become extra results |
| Loot tables / global loot modifiers | `BP/loot_tables`; modifiers on vanilla blocks need scripts | Leaves → lemons is a script |
| Villager trades (`VillagerTradesEvent`) | Override `trading/economy_trades/*.json` | Conflicts with other packs that override the same files |
| Capabilities (player/villager data) | Dynamic properties (`entity.setDynamicProperty`) | |
| Custom `MobEffect`s (61) | Not supported | Emulate with dynamic properties + vanilla effects + HUD text |
| Custom potions + brewing recipes (70) | No custom potion types | Custom drinkable items; brewing via crafting or a custom block |
| Entity types per pregnancy phase (`*_p0`…`*_p9`) | **One entity per species** with `minecraft:entity_properties` (state, phase) | Render controllers pick geometry/texture per property |
| Java `ModelPart` models + keyframe animations | `.geo.json` + animation/animation-controller JSON | Converted from the jar's bytecode by `tools/lib` at import |
| Menus/screens (148 menu types) | `@minecraft/server-ui` forms | Inventory-style screens become forms or entity inventories |
| Network packets | Not needed | Scripts run on the server; client visuals via entity properties/Molang |
| Mixins | Script events where they exist | Some behaviour has no hook (e.g. furnace remainders) |
| Server config (`minepreggo-server.toml`) | Manifest v3 pack `settings` or a config form | |
| Advancements (45) / criteria triggers | No custom advancements | Optional: chat/title toasts |
| Custom enchantments (3), banner patterns (2), post shaders | Not supported | Need design alternatives |
| Villager profession "doctor" | No custom professions | Custom NPC entity |
| Structure `scientific_illager_hideout` (NBT + jigsaw) | `.mcstructure` + data-driven jigsaw | NBT needs converting |
| Key mappings | No custom keys | Item use, sneak-interact, `playerButtonInput` |
| JEI / Waystones compat | n/a | Dropped |

## Inventory and status

Legend: ✅ ported · 🟡 partial · ⬜ not started · ⛔ no Bedrock equivalent (needs a design decision)

### Phase 1 – foundation, farming and food ✅
- ✅ Tooling: importer, schema validator, `.mcaddon` packager
- ✅ Foods: lemon, chili pepper, cucumber, lemon ice cream, chocolate bar, lemon popsicle, hot chicken,
  pickle, salty water bottle, lemon drop, chili poppers, french fries, candy apple, stuffed mushroom
- ✅ Ingredients: salt, hot sauce
- ✅ Crops `chili_peppers` and `cucumbers` (age 0–7, Java growth formula, bone meal, mature drops)
- ✅ Lemons from oak/dark-oak leaves (1.75 %, fortune bonus, not with shears/silk touch)
- ✅ Recipes for all of the above; composting for lemon/chili/cucumber
- 🟡 Farmer and butcher trades (one Minepreggo trade per level instead of being mixed into the pool;
  the farmer's `Items.f_42533_` trades are missing until that obfuscated field is identified)

### Phase 2 – player pregnancy ✅
Port of `world/entity/player` (P0–P9 systems, FemalePlayerSystem), `world/pregnancy` and the player
side of `world/effect`, in `packs/behavior/scripts/pregnancy/`.
- ✅ Gender choice when a player first joins (only female players can become pregnant)
- ✅ Potion of Impregnation I–VI: 15 s after drinking, a pregnancy with 1, 2–3, 4–5, 6–7, 8–9 or 10
  babies starts; more babies means birth in a later phase (P4–P9)
- ✅ Phases P0–P9 over 50 in-game days (24 000 ticks each, Java defaults) split per `PregnancyPhaseMap`;
  sleeping through the night moves the pregnancy forward like in Java
- ✅ Symptoms: cravings (satisfied by the phase 1 foods, other food feeds less), lactation (use a glass
  bottle to get a Human Breast Milk Bottle), belly rubs (crouch and look down, or another player
  crouch-interacts with an empty hand)
- ✅ Pains: morning sickness, fetal movement, contractions, back pain after long walks, with Java's
  severity/duration formulas; spicy food can trigger pains from P4
- ✅ Pregnancy health: hits while below 60 % health (or explosions) harm the pregnancy; at 0 a
  miscarriage starts. It slowly heals over time.
- ✅ Labor: water breaking → pre-birth → birth (tap sneak quickly to push each baby out) →
  post-birth → recovery period and post-partum lactation
- ✅ Extra hunger, random weakness, nausea after long sprinting/sneaking, stomach growls, sounds
- ✅ Items: Potion of Impregnation I–VI, Baby Human, Dead Human Fetus, Human Breast Milk Bottle,
  dead fetus → rotten flesh recipe
- ✅ Operator test commands (`/scriptevent minepreggo:pregnancy …`, see README)
- ⬜ Fertility and menstrual cycle (only matters for the interaction systems of phase 7)
- ⬜ Interspecies pregnancies of players (zombie, creeper, ender, slime, villager potions) — phase 4

### Phase 3 – preggo mobs ✅ (this release)
- ✅ Zombie girl, humanoid and monster creeper girl, humanoid and monster slime girl, monster ender
  woman: one Bedrock entity per family; Java's hostile / hostile pregnant P3·P5·P7 / tamable /
  tamable P0–P9 entity types are component groups plus the entity properties `minepreggo:phase`
  (-1–9), `pose`, `kick`, `growth` and `savage`.
- ✅ Models and keyframe animations converted from the jar's bytecode at import time (66 model
  layers, 126 animations); the render controller picks the phase model and texture; shared
  animation controllers play idle/walk/attack/wait/riding, pains and belly animations.
- ✅ Natural spawning with the Java biome-modifier weights (pregnant variants through the spawn
  rules' spawn event), taming with each family's food (1 in 3), follow/wait, owner defence.
- ✅ Tamed care (`scripts/mobs`): fullness and hunger per phase, healing, savage state, feeding.
- ✅ Mob pregnancies from the Potion of Impregnation: phase timing, cravings with the species'
  craving foods, milking, belly rubs, common pains, pregnancy health and miscarriage, automatic
  labor and birth with baby items, post-partum lactation, hostile pregnant incapacitation and
  death drops.
- ✅ Mob foods and their craving variants (brains, activated gunpowder, ender slime jelly, chorus
  fruit, rotten flesh and spider eye variants) with recipes; brains drop from player-killed
  villagers, illagers and witches; baby, dead-fetus and milk items of every species.
- ✅ Jiggle physics for every female mob and the player (chest, belly from P0, hips from P3).
- ✅ Player visuals: the player entity is overridden with the same properties as the mobs
  (plus gender and skin type); the mod's player body layers (CustomPregnantBodyModel on the
  player's own skin, PredefinedPregnantBodyModel with the Alex textures, and the chest layers)
  are converted like the mob models and rendered by extra render controllers with the mobs'
  belly inflation, growth, fetal-movement and belly-rub animations.
- ✅ Potions of Pregnancy Acceleration I–V and Gradual Pregnancy Acceleration I–V for players
  and mobs (PregnancyPhaseMapHelper.calculateAdvancedPhase ported; Java's float rounding kept:
  level V skips 17 days, not 18).
- ✅ Fetal movements render as in Java: `BellyAnimation.FETAL_MOVEMENT_P3..P9_{I,II,III}` chosen by
  phase and pain severity (0 → I, 1–2 → II, 3+ → III, `FetalMovement.getAnimation`), the sitting
  `KICKING_SIT` body animation when the kick incapacitates a mob (P5+, chance 0.04 × phase), and
  the II animation on incapacitated hostile mobs. A **Potion of Fetal Movement Inducement I–III**
  (Bedrock addition, severity 0/2/4, duration = phase base × (1 + severity × 0.25)) triggers one
  for players and mobs.
- 🟡 Player visuals need the gender form answered; it now returns every 10 s until it is (Java's
  join screen cannot be dismissed either). Manifests are format 2 with array versions, the only
  form the game accepts without "must conform to format version [2]".
- ✅ Player body animations: the mod's procedural `PlayerAnimations` (birth, post-birth,
  miscarriage, water breaking, pre-birth, back pain, belly rubbing P0–P9, heavy walking P4–P9)
  are generated into Molang by `tools/gen/player-animations.py` (absolute transforms via
  `expr - this`, head and arms converted into body-local space, y flipped).
- ✅ Species pregnancies (phase 4 item): Zombie/Creeper/Ender/Slime/Villager Impregnation I–VI,
  species babies and fetuses, and the Full Of Zombies (daylight burn), Creepers (death explosion
  `calculateExplosionLevelByPregnancyPhase`), Enders (random teleport every 2400 ticks),
  Slimes (fall cushioning) effects plus `calculateExtraFallDamageMultiplier`, the species diets
  (`CRAVING_ITEM`: the species' foods are edible only for a mother carrying that species and
  satisfy her cravings) and species milk (`MILK_ITEM`). Baby mobs are still not spawned.
- ✅ **One model per female with every belly size (0.3.0).** The render-time model/texture switch
  never showed in game, so `tools/lib/belly-merge.mjs` now merges the ten phase bellies (with their
  kick bones, suffixed `_pN`) under the `belly` bone of the base model and composites the belly
  pixels of the ten phase textures into one texture per family (and for the predefined player
  layer). `animation.minepreggo.belly_select` scales every belly but the current phase's to zero,
  so the belly depends on nothing but the phase property and an animation, both proven in game.
  Every render controller is a plain geometry + texture reference. Per-phase chest and arm
  variants of the mod's models are not merged (the base model's are shown).
- ✅ **Belly visible under every condition (0.3.1).** The mod's P0/P1 bellies are flat, so a fresh
  pregnancy shows nothing for days; the start messages and the guide now say so, and
  `/scriptevent minepreggo:debug belly <0-9>` forces a size for 10 s (kick/birth force a P7 belly
  when hers is small). The client falls back to `q.variant` and to the pose when the phase
  property is unknown, and the mob system rewrites the phase property every tick (records from
  versions that only set it through entity events, wild mobs that only kept the variant).
- ✅ **Kicks as bulges (0.3.8).** The kick cubes rest 1 to 10 units inside the belly depending on
  the size, and the mod's own per-phase `fetal_movement_pN` animations move them by exactly the
  right distance; the port's procedural push layers used to add a fixed 2-5 units on top, which
  threw the cubes clear of the skin on small bellies. `fetal_push`, `fetal_push_monster`,
  `birth_push` and `birth_push_monster` now move only the belly bone (a swell and shift from
  inside), the kick cubes belong to the mod's keyframed kicks, and the navel birth's crowning
  travels by the measured reach of the current belly size (`v.kr_f`, written per family and for
  the player's two bodies by the generator), growing at most 1.45x; the monster creeper girl, whose
  own birth animation already moves her kick cubes, gets a crowning that grows in place.
- ✅ **What the game's content log said (0.3.7).** The first content log from a device named the
  real failures: a float property default written as `0` (what JSON.stringify makes of 0.0) makes
  the game drop every property of the entity ("'default' value does not match the specified type
  'float'"), which took phase, pose, kick, growth and belly off the client at once; the zombie
  girl's `alert_same_type` and the old leash distances are rejected by 1.26.30; the guide book
  recipe lacked unlock data; the stuffed mushroom's nested `food_effects` parameters exceed the
  custom component depth limit; and the jiggle variables were read before their first assignment.
  Entity files are now written through `tools/lib/entity-json.mjs` (float literals kept), the
  validator enforces all of these rules (and validates against the 1.26.30 schemas), food effects
  are one flat string, every pre_animation variable is initialized, and the recipe unlocks.
- ✅ **Belly on the proven path (0.3.6).** The one property path that is proven in game is the pose:
  an enum written by the scripts and compared as a string. The belly is now the same kind of value
  (`minepreggo:belly`: `none`, `p0`..`p9`), written next to the phase and kept equal to it every
  tick. Each female renders the mod's own per-phase model and texture through a plain render
  controller per size, chosen by the entity's render-controller conditions (`v.bp == N`), with the
  phase, the variant and a pregnancy pose as fallbacks; the player's per-phase bodies are chosen the
  same way. The belly animations (inflation, the mod's fetal movements, the pushes, the navel
  birth) run from a state controller with one state per size, like the pain controller. The merged
  models and part_visibility are no longer used (`tools/gen-belly-render.mjs` writes it all).
- ✅ **Self-check names rejected definitions (0.3.5).** `tools/gen-ids.mjs` writes every entity,
  item and block identifier of the pack into `scripts/generated/ids.js`; on join the banner
  compares them with the game's registries and lists the ones it rejected, which is the only way
  to see a content error on a phone or console. The zombie girl's sun behaviors now match the
  current vanilla zombie (no flee/restrict sun, vanilla turtle-egg stomping parameters).
- ✅ **Belly shown by the render controller (0.3.4).** The belly group of the phase is selected with
  `part_visibility` (every bone of `belly_pN`, kick bones included, visible only while
  `v.phase == N`), generated per family from the merged model by the importer, which is how the
  game itself shows and hides bones; the scale-to-zero `belly_select` animation is gone. Each
  family has its own render controller file. The join message names the resource pack's version
  next to the scripts', since a world keeps running an older resource pack until it is re-added.
- ✅ **Every non-sexual potion of the mod, with feedback (0.3.3).** `pregnancy/potions.js` ports
  PregnancyDelay (distributeExtraDays), BabyDuplication (duplicateRandomBaby, the new birth phase
  and day map; the sigmoid growth jump is approximated by a third of the phases left),
  PregnancyHealing, PregnancyHarming, PregnancyResistance (PregnancyDamageHelper returns 0),
  ZeroGravityBelly (no phase slowness, no extra fall damage), MetabolismControl (saturation
  refill) and Eternal Pregnancy (canGiveBirth false); the timed ones live in the player record
  and milk clears them. Mobs get the instant ones through interaction and commands. Every potion
  reports its outcome; the Impregnation effect counts game ticks (shown on the action bar) instead
  of the world's absolute time. The guide book's Debug tools give every item and need no operator.
  Icons are the port's own bottle tinted with the mod's effect colours (`tools/gen/potion-icons.mjs`).
- ✅ **Debug tools in the guide book (0.3.2).** The book's last chapter is a button menu for
  operators (`commandPermissionLevel` >= 1) that runs the debug and test commands on the player
  and the nearest mob: belly sizes and forced kicks/birth for 30 s, pregnancy start, phase jumps,
  inducement, acceleration, labor, feeding, ending, status and the render report. The command
  runners of `pregnancy/commands.js` and `mobs/commands.js` are exported for it, and
  `/scriptevent minepreggo:guide` gives the book again.
- ✅ The non-pregnant models have no belly cubes at all, so a pregnant model that is never
  selected shows nothing to animate. The model index is now `max(phase property + 1, variant)`
  computed in pre_animation (the vanilla ghast pattern with a variable); the phase property is
  written by the script before any entity event, and every event call is wrapped so a rejected
  event can no longer stop a pregnancy. Humanoid females share the player's fetal movement and
  birth push; monsters (monster creeper girl, monster slime girl, ender woman) have their own
  rolling belly versions; the monster creeper girl and the ender woman give navel births.
- ✅ Impregnation by vanilla mobs: `PlayerHelper.tryImpregnateByMobAttack` ported (hits counted per
  species, 65 % roll, fertility cycle not ported) and, as a Bedrock addition, a vanilla
  counterpart next to a free female mob for 3 s impregnates her.
- ✅ The phase property of a mob is written with `Entity.setProperty` on every change (the
  client never showed the value the JSON events set, while the pose written by the script did);
  wild pregnant spawns are recognised from the `minecraft:variant` their spawn event's component
  group carries. With the phase visible, the fetal movement animations (by phase and intensity)
  and the belly inflation levels play on every family.
- ✅ Birth progress (push progress for players, the baby's birth timer for mobs) is sent in the
  growth property during birth, so the belly pushes with it.
- ✅ Navel birth for ender babies (Bedrock addition, ender woman and players carrying ender
  babies): Molang animations push the navel (front kick bone) in pre-birth and crown it out with
  the birth progress, on top of the labor pose.
- ✅ Every mob render controller (the creeper girls and the ender woman have their own, which the
  first variant fix missed) selects geometry and texture with `query.variant`; no render controller
  reads a property, compares strings or uses `part_visibility` for the belly any more (the belly is
  hidden after birth by a scale-0 animation). The belly texture pixels exist only in the per-phase
  textures, so geometry and texture must switch together.
- ✅ Player labor poses: the mod's own humanoid creeper girl Blockbench animations (water breaking,
  pre-birth, birth, post-birth, miscarriage) play on a flat-hierarchy player geometry
  (`geometry.minepreggo.player_labor`, vanilla skin layout) while the vanilla geometry is hidden,
  so the pose matches the mobs exactly; the belly and chest layers follow the same bones. The
  procedural Java player animations remain for back pain, belly rubbing and heavy walking.
- ✅ Pre-birth and birth play the strongest fetal movement animation (III) on the belly, for
  players and mobs; first-person chest and belly show from a 15° downward look.
- ✅ Mob belly geometry is selected with `query.variant` (the `minepreggo:phase_N` component
  groups carry `minecraft:variant` N+1), the vanilla mechanism, instead of `query.property`
  inside the render controller; belly visibility comes from a pre_animation variable. The pose
  property still drives the animations (confirmed in game by the water-breaking animation).
- ✅ Fetal Movement Inducement on mobs: tamed from P3 (owner), wild pregnant at any time
  (incapacitated with the potion's kick strength); a potion used on a mob is not also drunk.
- ✅ Guide book item with the add-on's manual (Bedrock addition).
- ⬜ **Zombie girl follow-up (requested):** the Ill Zombie Girl variant (`IllZombieGirl`, P0 model)
  and the zombie girl GUI/inventory are not ported yet; the hostile, tamable and pregnant zombie
  girls are.
- ⬜ Inventory/main menu, combat modes, wander mode, break-blocks and pick-up options (phase 7).
- ⬜ Ill variants, scientific illager, reproduction witch (phase 5).

### Phase 4 – species-specific items and medicine ⬜
Interspecies impregnation potions, pregnancy potions (healing, harming, resistance, acceleration,
delay, baby duplication, metabolism control, zero gravity belly), specimen-free medicine, medical
table block and checkup flow, effects of the species milk bottles, and ways to get potions in
survival (brewing replacement, witch drops, illager trades).

### Phase 5 – remaining mobs and world ⬜
"Ill" variants, scientific illager (+ services and trading), reproduction witch, projectiles,
illager hideout structure, chest loot.

### Phase 6 – equipment and player visuals ⬜
Female and maternity chestplates (P1–P4, six materials), belly shields (P5–P9), knee braces,
armor-transfer recipes and the mobs' armour layers, pregnant player body (player geometry override /
attachables).

### Phase 7 – interaction systems and GUIs ⬜
Main/inventory screens for tamed mobs, requests between players and mobs, medical checkups,
trading services — rebuilt as `@minecraft/server-ui` forms.

### Phase 8 – everything without a direct equivalent ⛔
Enchantments, banner patterns, advancements, shaders, jiggle physics, sounds/particles that depend on
removed systems. (Custom mob effects are emulated since phase 2.)

## Known differences in phase 1

| Java behaviour | Bedrock port | Why |
|---|---|---|
| Smelting a water bucket gives 32 salt and returns the bucket | Crafting a water bucket gives 32 salt + bucket | Furnace recipes can't output stacks or return containers |
| Leaves dropping by decay can give lemons | Only player-broken leaves can | Bedrock leaves have no editable loot table |
| Fortune increases mature crop drops | No fortune bonus on crops | Block loot tables can't read fortune |
| Crop model sits 1 px into the farmland | Crop sits on top of the block space | Block geometry can't go below y = 0 |
| Stuffed mushroom effects skip players with *Full Of Slimes* | Always applied | Slime pregnancies come in phase 3 |
| Salty water bottle returns a glass bottle when crafted into pickles | Same, as an extra recipe result | — |
| Crops can be bone-mealed by dispensers | Only by players | Custom components only see player interaction |

## Known differences in phase 2

| Java behaviour | Bedrock port | Why |
|---|---|---|
| 61 custom mob effects with icons and attribute modifiers | Status on the action bar while crouching; slowness / weakness / nausea for their effect on the player | Add-ons can't register mob effects |
| Phase slowness plus extra -15 % speed modifiers | One slowness level per phase that matches the combined Java speed | No attribute modifier API |
| Attack-speed penalties, gravity and knockback-resistance modifiers per phase | Not applied | No attribute modifier API; Bedrock has no attack cooldown |
| Morning sickness screen overlay | Nausea | No custom screen overlays |
| Keys: R rubs the belly, K pushes during birth, J opens the player menu | Crouch + look down rubs, tapping sneak pushes; gender via form/command | Add-ons can't add key bindings |
| Impregnation potions are brewed and come as splash/lingering potions and arrows | Drinkable items from the creative inventory or commands | Brewing stands only accept vanilla potions; survival sources arrive in phase 3/5 |
| Labor makes the player immobile (-100 % speed) | Slowness VII (speed 0) | No attribute API; also wears off on its own if the add-on is removed |
| Armor and held items are dropped at birth and when a chestplate no longer fits | Nothing is dropped | Maternity armor isn't ported yet (phase 6); avoids losing items |
| Pregnant player body, jiggle physics, body state during birth | Not shown | Player visuals are phase 6 |
| Riding, elytra and jump limits per phase | Not enforced yet | — |
| The P9 effect runs the P8 system (uses P8 timings) | P9 uses its own P9 timings | Java bug |
| A miscarriage in the last phase can be replaced by labor | The miscarriage runs its course | Java bug |
| Father notifications and advancements | None | Potion pregnancies have no father; no custom advancements |
| HORNY symptom | Not ported | Belongs to the interaction systems |
| Medical tables make pushing easier | Not yet | Medical table is phase 3 |
| Pregnancy-pain damage has its own damage type | Magic damage | No custom damage types |
| After birth: Luck (`MobEffects.f_19621_`); after a miscarriage: `MobEffects.f_19590_`, Trauma | Left out | Bedrock has no Luck; the other id is obfuscated; Trauma has no effect of its own |

## Known differences in phase 3

| Java behaviour | Bedrock port | Why |
|---|---|---|
| A separate entity type per state and phase (92 spawn eggs), converted on taming and phase changes | One entity per family; groups and properties change in place, so the mob keeps its UUID | Bedrock entities can't change type; avoids copying data between entities |
| Spawn eggs for every state and phase | One spawn egg per family (a hostile mob); pregnancies via the potion or `/scriptevent minepreggo:mob` | Bedrock spawn eggs can't pick an event |
| Main menu and inventory (wait / follow / wander, pick-up loot, break blocks, combat mode, armour slots) | Interact to sit/stand (vanilla sitting); no menus, wander, inventory or combat-mode choice | GUIs are phase 7 |
| Belly touch needs the player face to face, eyes above her, mob without chestplate | Crouch and interact with an empty hand | Simpler gesture; mobs wear no armour yet |
| Incapacitating pains and labor stop every AI goal | Slowness 255 + weakness 255 while they last | No goal-level control from scripts |
| Hostile mobs spawn with babies as small mobs, and pregnant mobs may give birth to live baby mobs when they die | No baby mobs; dead fetus items drop instead | Baby mobs are not ported |
| Owner anger (a slap at the owner when fullness ≤ 4 or a need is at 20) | Not ported | Needs targeting control from scripts |
| Rehabilitation effect after birth or miscarriage (-10 % speed, -30 % max health…) | Not applied; the recovery period still blocks a new pregnancy | No attribute modifier API |
| Gravity and fall-damage modifiers per phase | Only knockback resistance per phase | No gravity/fall-damage components |
| Species milk bottles have effects on mobs and players | Plain items | Item effects are phase 4 |
| Expression (face) layer, armour layers | Not shown | Phases 6 and 8 |
| Jiggle physics (BoobJigglePhysics, BellyJigglePhysics, ButtJigglePhysics: springs stepped once per client tick) | The same springs, stepped per rendered frame in Molang with the Java constants scaled by frame time | Molang keeps per-entity variables between frames; `query.position_delta` stands in for the Java position deltas |
| Pregnant body and chest only in third person | Also in first person when looking down more than 25° | The Bedrock first-person body follows the camera, so the layers swing into view |
| Hostile humanoid slime girls are not spawned naturally (no biome modifier) | Same | — |
| Steve predefined skin has only a base texture; the loader falls back to Alex for the phases | Same (Steve = Steve base skin + Alex pregnancy art) | — |
| Pregnant body shows in first person too (arms only) | Third person only | First-person view has no body |
| Custom skin type uses the player's own skin pixels for the belly | Same | — |

## Open questions

- `Items.f_42533_` (farmer trades at levels 2–4: 10 emeralds → 5, 15 → 10, 17 → 20) is an
  obfuscated SRG field; it needs a 1.20.1 SRG→Mojang mapping lookup before it can be ported.

## In-game checklist for phase 3

1. `npm run import` then `npm run build`; the content log is clean when a world with the add-on loads.
2. At night every family spawns (zombie and creeper girls in the overworld, monster slime girls in
   swamps, ender women in the overworld, warped forests and the End); some are pregnant (P3/P5/P7)
   with bigger bellies and fetal movement; their models animate (idle, walk, attack, pains).
3. Taming: villager brain / activated gunpowder / refined chorus shards or ender slime jelly /
   stuffed mushroom, one in three tries; tamed mobs follow and defend their owner; interacting
   makes them wait.
4. `/scriptevent minepreggo:mob starve`: she turns savage; feeding her food calms her down.
5. Potion of Impregnation on a tamed mob: 15 s later `minepreggo:mob status` shows P0; `phase 4`
   shows the P4 model; `symptom craving` + the craved food, `symptom milking` + glass bottle,
   `symptom belly_rubs` + crouch-interact all work; `labor` runs water breaking, pre-birth, birth
   (baby items) and post-birth, then she's back to the normal model.
6. `miscarry` (P1+) drops dead fetus items; killing a pregnant mob drops one per baby.

## In-game checklist for phase 2

1. A new player is asked for a gender; `/scriptevent minepreggo:gender female` changes it.
2. Drinking a Potion of Impregnation as a female player starts a pregnancy 15 s later (chat tip),
   crouching shows phase, day, pregnancy health and symptoms on the action bar.
3. `/scriptevent minepreggo:pregnancy phase 3` then `symptom craving`: eating the craved food
   (e.g. chocolate bar for Sweet) ends the craving; other food gives less hunger.
4. `symptom milking` (P2+): using a glass bottle gives a Human Breast Milk Bottle.
5. `labor`: water breaks, then the player can't move, then tapping sneak quickly pushes; each baby
   needs four bursts of 28 taps; Baby Human items drop, then the player recovers.
6. `miscarry` (P1+): Dead Human Fetus items are given and the pregnancy ends.
7. Sounds play (pains, contractions, birth, stomach growls) and the content log stays clean.

## In-game checklist for phase 1

1. Add-on loads with no errors in the content log (Settings → Creator → Enable Content Log GUI).
2. Each food can be eaten; popsicle leaves a stick; stuffed mushroom gives Hunger 30 s + Nausea 10 s.
3. Chili pepper/cucumber plant only on farmland, grow over time in light, bone meal advances 2–5
   stages, mature crops drop 2–5 items, immature ones drop 1, crops pop when trampled or flooded.
4. Breaking oak leaves by hand occasionally drops lemons; never with shears or silk touch.
5. New farmers and butchers offer one Minepreggo trade per level.
