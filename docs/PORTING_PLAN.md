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
| Java `ModelPart` models + keyframe animations | `.geo.json` + animation/animation-controller JSON | Needs conversion (Blockbench) |
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

### Phase 1 – foundation, farming and food ✅ (this release)
- ✅ Tooling: importer, schema validator, `.mcaddon` packager
- ✅ Foods: lemon, chili pepper, cucumber, lemon ice cream, chocolate bar, lemon popsicle, hot chicken,
  pickle, salty water bottle, lemon drop, chili poppers, french fries, candy apple, stuffed mushroom
- ✅ Ingredients: salt, hot sauce
- ✅ Crops `chili_peppers` and `cucumbers` (age 0–7, Java growth formula, bone meal, mature drops)
- ✅ Lemons from oak/dark-oak leaves (1.75 %, fortune bonus, not with shears/silk touch)
- ✅ Recipes for all of the above; composting for lemon/chili/cucumber
- 🟡 Farmer and butcher trades (one Minepreggo trade per level instead of being mixed into the pool;
  the farmer's `Items.f_42533_` trades are missing until that obfuscated field is identified)

### Phase 2 – player data and pregnancy core ⬜
Player gender/skin choice, fertility and menstrual cycle, pregnancy phases P0–P9, symptoms
(cravings, morning sickness, back pain, belly pressure, fetal movement…), birth and post-birth,
miscarriage, lactation. Java sources: `world/entity/player`, `world/pregnancy`, `world/fertility`,
`world/effect`, `network/capability`. Needs a HUD (actionbar/title) and test commands
(`/scriptevent minepreggo:…`). Craving data lives in the `ICravingItem` implementations.

### Phase 3 – species-specific items and medicine ⬜
Craving variants (rotten flesh / spider eye / brain / activated gunpowder / ender slime jelly /
chorus fruit with chocolate, salt, hot sauce, and sour versions), brains, breast-milk bottles,
specimen tubes, baby items, dead fetus items, impregnation/pregnancy potions (as custom items),
medical table block and checkup flow.

### Phase 4 – first mob: zombie girl ⬜
Hostile, tamable and pregnant (P0–P9) zombie girl as **one** entity with properties; taming, follow /
wait / wander, inventory, cravings, birth. Model, animations and expression layers converted from
`client/model/entity/preggo/zombie` and `client/animation/preggo`.

### Phase 5 – remaining mobs and world ⬜
Humanoid and monster creeper girls, humanoid and monster slime girls, monster ender woman, "ill"
variants, scientific illager (+ services and trading), reproduction witch, projectiles, natural
spawning (biome modifiers), illager hideout structure, chest loot, brain loot from villagers,
illagers and witches.

### Phase 6 – equipment and player visuals ⬜
Female and maternity chestplates (P1–P4, six materials), belly shields (P5–P9), knee braces,
armor-transfer recipes, pregnant player body (player geometry override / attachables).

### Phase 7 – interaction systems and GUIs ⬜
Main/inventory screens for tamed mobs, requests between players and mobs, medical checkups,
trading services — rebuilt as `@minecraft/server-ui` forms.

### Phase 8 – everything without a direct equivalent ⛔
Custom mob effects (emulated in phase 2), enchantments, banner patterns, advancements, shaders,
jiggle physics, sounds/particles that depend on removed systems.

## Known differences in phase 1

| Java behaviour | Bedrock port | Why |
|---|---|---|
| Smelting a water bucket gives 32 salt and returns the bucket | Crafting a water bucket gives 32 salt + bucket | Furnace recipes can't output stacks or return containers |
| Leaves dropping by decay can give lemons | Only player-broken leaves can | Bedrock leaves have no editable loot table |
| Fortune increases mature crop drops | No fortune bonus on crops | Block loot tables can't read fortune |
| Crop model sits 1 px into the farmland | Crop sits on top of the block space | Block geometry can't go below y = 0 |
| Stuffed mushroom effects skip players with *Full Of Slimes* | Always applied | That effect is ported in phase 2 |
| Salty water bottle returns a glass bottle when crafted into pickles | Same, as an extra recipe result | — |
| Crops can be bone-mealed by dispensers | Only by players | Custom components only see player interaction |

## Open questions

- `Items.f_42533_` (farmer trades at levels 2–4: 10 emeralds → 5, 15 → 10, 17 → 20) is an
  obfuscated SRG field; it needs a 1.20.1 SRG→Mojang mapping lookup before it can be ported.

## In-game checklist for phase 1

1. Add-on loads with no errors in the content log (Settings → Creator → Enable Content Log GUI).
2. Each food can be eaten; popsicle leaves a stick; stuffed mushroom gives Hunger 30 s + Nausea 10 s.
3. Chili pepper/cucumber plant only on farmland, grow over time in light, bone meal advances 2–5
   stages, mature crops drop 2–5 items, immature ones drop 1, crops pop when trampled or flooded.
4. Breaking oak leaves by hand occasionally drops lemons; never with shears or silk touch.
5. New farmers and butchers offer one Minepreggo trade per level.
