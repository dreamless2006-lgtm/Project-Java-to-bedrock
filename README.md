# Minepreggo for Bedrock

A work-in-progress port of the **Minepreggo** Forge mod (1.3.2, Minecraft Java 1.20.1) to a
Minecraft **Bedrock** add-on (`.mcaddon`). The port is being rebuilt feature by feature; see
[docs/PORTING_PLAN.md](docs/PORTING_PLAN.md) for what is done, what is next, and where Bedrock
behaves differently.

**Current status — phase 1:** farming and food (chili peppers, cucumbers, lemons, salt and the
foods made from them), with recipes, crop growth, bone meal and villager trades.

Requires Bedrock **1.26.30** or newer. No experimental toggles are needed.

## About the original assets

Minepreggo is *All Rights Reserved* by DixMK, with models and textures by the artists credited in
the mod. This repository therefore contains only the Bedrock code; textures, translations and the
pack icon are extracted from your own copy of the mod jar at build time and are never committed.
Don't publish a built `.mcaddon` without the original author's permission.

## Building

Requires Node.js 20+.

```sh
npm install
cp /path/to/minepreggo-official-1.3.2-mc1.20.1.jar vendor/   # or pass the path to `npm run import`
npm run import   # extracts textures, translations and icon into packs/
npm run check    # type-checks scripts, validates JSON against Mojang's schemas and cross-references
npm run build    # writes dist/minepreggo-<version>.mcaddon
```

Open the `.mcaddon` on a device with Minecraft installed (double-click on Windows, "open with
Minecraft" on mobile), then activate both packs on a world.

## Layout

```
packs/behavior/   behavior pack: items, blocks, recipes, loot tables, trades, scripts
packs/resource/   resource pack: texture atlases, block geometry, language list
tools/            import-jar.mjs, validate.mjs, build.mjs, bedrock-schemas/ (Mojang's JSON schemas)
docs/             porting plan and known differences
vendor/           your local copy of the mod jar (git-ignored)
```
