# Minepreggo for Bedrock

A work-in-progress port of the **Minepreggo** Forge mod (1.3.2, Minecraft Java 1.20.1) to a
Minecraft **Bedrock** add-on (`.mcaddon`). The port is being rebuilt feature by feature; see
[docs/PORTING_PLAN.md](docs/PORTING_PLAN.md) for what is done, what is next, and where Bedrock
behaves differently.

**Current status — phase 2:** player pregnancy (phases P0–P9, cravings, lactation, belly rubs,
pains, miscarriage, labor and birth) on top of phase 1's farming and food (chili peppers,
cucumbers, lemons, salt and the foods made from them).

Requires Bedrock **1.26.30** or newer. No experimental toggles are needed.

## Playing

- New players choose a gender; only female characters can become pregnant.
- A Potion of Impregnation (creative inventory, *Items* tab) starts a pregnancy 15 seconds after
  drinking it. Stronger potions (II–VI) mean more babies and a later birth.
- **Crouch** to see the pregnancy status on the action bar.
- **Crouch and look down** to rub your belly when the belly-rub need shows up (from P3).
- **Use a glass bottle** while lactating to fill it.
- Eat the food you crave; spicy food is risky late in the pregnancy.
- During birth, **tap sneak quickly** to push. Each baby needs four bursts of quick taps.

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
```

## About the original assets

Minepreggo is *All Rights Reserved* by DixMK, with models and textures by the artists credited in
the mod. This repository therefore contains only the Bedrock code; textures, sounds, translations
and the pack icon are extracted from your own copy of the mod jar at build time and are never
committed.
Don't publish a built `.mcaddon` without the original author's permission.

## Building

Requires Node.js 20+.

```sh
npm install
cp /path/to/minepreggo-official-1.3.2-mc1.20.1.jar vendor/   # or pass the path to `npm run import`
npm run import   # extracts textures, sounds, translations and icon into packs/
npm run check    # type-checks scripts, validates JSON against Mojang's schemas and cross-references
npm test         # unit tests and tick-by-tick pregnancy simulations against a mocked game API
npm run build    # writes dist/minepreggo-<version>.mcaddon
```

Open the `.mcaddon` on a device with Minecraft installed (double-click on Windows, "open with
Minecraft" on mobile), then activate both packs on a world.

## Layout

```
packs/behavior/   behavior pack: items, blocks, recipes, loot tables, trades, scripts
packs/resource/   resource pack: texture atlases, block geometry, sound definitions, language list
tools/            import-jar.mjs, validate.mjs, build.mjs, bedrock-schemas/ (Mojang's JSON schemas),
                  lang/ (strings the port adds), tests/
docs/             porting plan and known differences
vendor/           your local copy of the mod jar (git-ignored)
```
