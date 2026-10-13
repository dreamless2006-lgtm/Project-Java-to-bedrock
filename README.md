# Minepreggo for Bedrock

A work-in-progress port of the **Minepreggo** Forge mod (1.3.2, Minecraft Java 1.20.1) to a
Minecraft **Bedrock** add-on (`.mcaddon`). The port is being rebuilt feature by feature; see
[docs/PORTING_PLAN.md](docs/PORTING_PLAN.md) for what is done, what is next, and where Bedrock
behaves differently.

**Current status — phase 3:** the preggo mobs — zombie girls, humanoid and monster creeper girls,
humanoid and monster slime girls and ender women — with the mod's own models and animations for
every pregnancy phase, taming, care and mob pregnancies; on top of phase 2's player pregnancy
(phases P0–P9, cravings, lactation, belly rubs, pains, miscarriage, labor and birth) and phase 1's
farming and food (chili peppers, cucumbers, lemons, salt and the foods made from them).

Requires Bedrock **1.26.30** or newer. No experimental toggles are needed.

## Playing

- New players choose a gender; only female characters can become pregnant. A female character
  either keeps her own skin (the pregnant belly is drawn with the skin's own colours) or uses the
  mod's Alex skin (`/scriptevent minepreggo:skin custom|alex|steve` changes it later). Her body
  shows the pregnancy in third person: the belly grows through the phases, swells as she breathes,
  and the babies kick when she feels them.
- A Potion of Impregnation (creative inventory, *Items* tab) starts a pregnancy 15 seconds after
  drinking it. Stronger potions (II–VI) mean more babies and a later birth.
- **Crouch** to see the pregnancy status on the action bar.
- **Crouch and look down** to rub your belly when the belly-rub need shows up (from P3).
- **Use a glass bottle** while lactating to fill it.
- Eat the food you crave; spicy food is risky late in the pregnancy.
- During birth, **tap sneak quickly** to push. Each baby needs four bursts of quick taps.
- A **Potion of Pregnancy Acceleration** (I–V) skips 7 % of the pregnancy per level at once and
  starts labor when the birth phase is complete; a **Potion of Gradual Pregnancy Acceleration**
  makes the pregnancy run 120–600 times faster for three minutes. Both also work on a pregnant
  mob when used on her.

### Preggo mobs

- Zombie girls, creeper girls, slime girls and ender women spawn like their vanilla cousins; some
  are already pregnant (P3, P5 or P7). Those can't be tamed, and a hard hit may double them over.
- Tame one with her favourite food (one in three tries): zombie girls take a **villager brain**
  (villagers, illagers and witches drop brains when a player kills them), creeper girls
  **activated gunpowder** (redstone + gunpowder), ender women **refined chorus shards** or
  **ender slime jelly**, slime girls a **stuffed mushroom**.
- A tamed mob follows you; interact with her to make her wait. Feed her her food when she's hungry:
  if she starves she turns savage and attacks until you feed her again.
- Use a **Potion of Impregnation** on her: 15 seconds later she's pregnant. Her belly grows through
  the phases, and as her owner you care for her: feed her the craved variant of her food, milk her
  with a glass bottle (from P2), and **crouch and interact with an empty hand** to rub her belly
  (from P3). Labor and birth happen on their own; the babies drop as items.

### Commands

Operator commands for testing (cheats on), acting on the player who runs them:

```
/scriptevent minepreggo:gender female|male
/scriptevent minepreggo:pregnancy status
/scriptevent minepreggo:pregnancy start [babies 1-10]
/scriptevent minepreggo:pregnancy phase <0-9>
/scriptevent minepreggo:pregnancy days <n>
/scriptevent minepreggo:pregnancy symptom craving|milking|belly_rubs
/scriptevent minepreggo:pregnancy pain morning_sickness|fetal_movement|contraction|back_pain
/scriptevent minepreggo:pregnancy labor | miscarry | end
/scriptevent minepreggo:pregnancy accelerate <0-4> | gradual <0-4>
/scriptevent minepreggo:skin custom|alex|steve
```

The same for the nearest preggo mob within 16 blocks:

```
/scriptevent minepreggo:mob status
/scriptevent minepreggo:mob start [babies 1-10] | potion [level 0-5] | end
/scriptevent minepreggo:mob phase <0-9> | days <n> | labor | miscarry | feed | starve
/scriptevent minepreggo:mob pain morning_sickness|fetal_movement|contraction|back_pain
/scriptevent minepreggo:mob symptom craving|milking|belly_rubs
```

The add-on overrides the player entity (`packs/behavior/entities/player.json`,
`packs/resource/entity/player.entity.json`) to draw the pregnant body; another add-on that also
overrides the player wins or loses depending on pack order, in which case the body visuals are off
but everything else works.

If the game says a pack failed to load, turn on **Settings → Creator → Content Log GUI** and
reload the world: the log names the file and the problem. When the scripts are running, every
player sees "[Minepreggo 0.2.0] Add-on loaded." on joining.

## About the original assets

Minepreggo is *All Rights Reserved* by DixMK, with models and textures by the artists credited in
the mod. This repository therefore contains only the Bedrock code; textures, sounds, translations,
the entity models and animations, and the pack icon are extracted from your own copy of the mod jar
at build time and are never committed. The mod builds its models and animations in Java code, so
`tools/lib/java-class.mjs` runs that code straight from the jar's class files (a small bytecode
interpreter) and `tools/lib/java-models.mjs` turns the result into Bedrock geometry and animations.
Don't publish a built `.mcaddon` without the original author's permission.

## Building

Requires Node.js 20+.

```sh
npm install
cp /path/to/minepreggo-official-1.3.2-mc1.20.1.jar vendor/   # or pass the path to `npm run import`
npm run import   # extracts textures, sounds, translations, models, animations and icon into packs/
npm run check    # type-checks scripts, validates JSON against Mojang's schemas and cross-references
npm test         # unit tests, model conversion checks and pregnancy simulations (players and mobs)
npm run build    # writes dist/minepreggo-<version>.mcaddon
```

Open the `.mcaddon` on a device with Minecraft installed (double-click on Windows, "open with
Minecraft" on mobile), then activate both packs on a world.

## Layout

```
packs/behavior/   behavior pack: items, blocks, entities, spawn rules, recipes, loot tables, trades,
                  scripts (pregnancy/ for players, mobs/ for the preggo mobs)
packs/resource/   resource pack: client entities, render and animation controllers, texture atlases,
                  block geometry, sound definitions, language list
tools/            import-jar.mjs, validate.mjs, build.mjs, lib/ (Java model converter),
                  bedrock-schemas/ (Mojang's JSON schemas), lang/ (strings the port adds), tests/
docs/             porting plan and known differences
vendor/           your local copy of the mod jar (git-ignored)
```
