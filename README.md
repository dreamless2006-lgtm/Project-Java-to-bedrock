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
  shows the pregnancy: the belly grows through the phases, swells as she breathes, and the babies
  kick when she feels them. Chest, belly and hips have the mod's jiggle physics (they bounce with
  steps, jumps and landings), and in first person the chest and belly come into view when you
  look down.
- A Potion of Impregnation (creative inventory, *Items* tab) starts a pregnancy 15 seconds after
  drinking it; the action bar counts the seconds down. Stronger potions (II–VI) mean more babies
  and a later birth. All the mod's other potions are ported too (see **Potions** below).
- **Crouch** to see the pregnancy status on the action bar.
- **Crouch and look down** to rub your belly when the belly-rub need shows up (from P3).
- **Use a glass bottle** while lactating to fill it.
- Eat the food you crave; spicy food is risky late in the pregnancy.
- During birth, **tap sneak quickly** to push. Each baby needs four bursts of quick taps.
- A **Potion of Pregnancy Acceleration** (I–V) skips 7 % of the pregnancy per level at once and
  starts labor when the birth phase is complete; a **Potion of Gradual Pregnancy Acceleration**
  makes the pregnancy run 120–600 times faster for three minutes. Both also work on a pregnant
  mob when used on her.
- During water breaking, pre-birth, birth, post-birth and a miscarriage your body takes the mod's
  labor poses (the same Blockbench animations the humanoid mobs use: doubled over, then lying on
  your back with the babies kicking hard); back pain, belly rubbing and heavy walking from P4 use
  the mod's player animations.
- Fetal movements start on their own from P3 (the mod's per-phase chances: on average one every
  minute or two in P3-P4, more often later). The action bar says "You feel the baby move". While one lasts, the
  belly plays the mod's kick animation for the phase and intensity (I, II or III) and every kick
  bulges visibly out of the belly. A **Potion of Fetal Movement Inducement** (I–III, a
  Bedrock addition) brings one on at that intensity, for you or, used on her, for a pregnant mob:
  a tamed one from P3 (her owner only), a wild pregnant one at any time (she doubles over with the
  kick for her pain cooldown). From P5 a strong kick can make a tamed mob sit down for a moment, as
  in the mod. A potion used on a mob is never drunk by the same tap.

### Updating the add-on in an existing world

A world keeps the pack versions it was created with, and Bedrock keeps older imports next to the
new one. After importing a newer `.mcaddon`, open the world's settings and, under **Behavior
Packs** *and* **Resource Packs**, remove Minepreggo from the active packs and add it again. The
join message shows both versions (`[Minepreggo 0.7.0, resources 0.7.0]`); while the resources
version lags behind, the models, bellies and animations are the old ones, whatever the scripts do.
Old versions can be deleted in Settings → Storage.

### Potions

Every potion of the mod that does not belong to its sexual systems is in the creative *Items* tab
and in the guide book's **Debug tools → Give items**. Each one reports what it did, or why it could
not act, so a potion never fails silently. Drink them, or use them on a female mob (her owner if she
is tamed, anyone on a wild pregnant one).

| Potion | Effect (as in the mod) |
| --- | --- |
| Impregnation I–VI, Zombie/Creeper/Ender/Slime/Villager Impregnation | pregnant 15 s later (the action bar counts down); more babies per level; a litter of that species |
| Pregnancy Acceleration I–V | skips 7 % of the pregnancy per level at once |
| Gradual Pregnancy Acceleration I–V | the timer runs 120–600x faster for 3 minutes |
| Pregnancy Delay I–V | 7 % per level longer, spread over the phases to come |
| Baby Duplication I–V | one more baby per level (10 at most), a later birth and a jump forward |
| Pregnancy Healing / Harming | pregnancy health to 100 / −30 and a heart (a miscarriage at 0) |
| Pregnancy Resistance (8 min, Long 16 min) | hits do no pregnancy damage |
| Zero Gravity Belly (8 min, Long 16 min) | no phase slowdown, no extra fall damage |
| Metabolism Control (5 min, Long 10 min, Strong II) | saturation refills by 0.25 × level every 10 ticks |
| Eternal Pregnancy | birth never comes; milk ends it (like every Minepreggo effect) |
| Fetal Movement Inducement I–III (Bedrock addition) | a kick of that strength from P3 |

The mod's brewing recipes use ingredients of its fertility systems, which are not ported, so the
potions are creative-only (Bedrock cannot add brewing recipes either).

### Reading the content log

Settings → Creator → turn on "Enable Content Log File" and "Enable Content Log GUI", rejoin the
world, and the GUI lists every file the game refused and why. That log is the only ground truth
for a pack: the validators here are run against Mojang's published schemas, and the game's own
parser is stricter in places (float literals, custom component parameter depth, fields that exist
in the schema but not in the game). Each rule the log revealed is now enforced by `npm run check`.

### The self-check line

Two seconds after joining, the add-on prints which of its definitions the game registered, for
example `self-check: entities 6/6 ✔ items 139/139 ✔ blocks 2/2 ✔ player visuals ✔`. A red entry
names the files the game rejected on your device; the reason is in Settings → Creator → Content Log
GUI (turn on "Enable Content Log File" and "Enable Content Log GUI"), and that reason is what to
report.

### Debug tools in the guide book

The guide book (given on the first join, or with `/scriptevent minepreggo:guide`) has a **Debug
tools** chapter for operators: buttons that show any belly size for 30 s on you and the nearest
female mob, force the kicks or a birth push, start a pregnancy, jump to a phase, induce kicks,
accelerate, start labor, feed or end, and print what the game renders from (with the running
version). Everything the `/scriptevent` commands do, usable from a controller.

### If no belly shows

A new pregnancy starts at P0, and the mod's P0 and P1 bellies are flat (a 1-pixel-deep cube flush
with the body). The bump appears at P2 and the belly is unmistakable from P3, which takes a few
Minecraft days (24000 ticks each). To see it right away run `/scriptevent minepreggo:debug belly 7`
(10 seconds, on you and the nearest preggo mob) or jump the pregnancy with
`/scriptevent minepreggo:pregnancy phase 5` / `/scriptevent minepreggo:mob phase 5`. The client
also falls back to the vanilla variant and to the pose when the phase property is not available, and
the behavior pack rewrites the phase property every tick, so mobs impregnated by older versions get
their belly back.

### If nothing shows on your character

1. Answer the gender form. It opens when you join and comes back every 10 seconds until you choose;
   only a female character gets the chest, belly and jiggle physics. You can also run
   `/scriptevent minepreggo:gender female`.
2. Check the self-check line in chat after joining: all four parts must be green. "player visuals ✘"
   means another pack also overrides the player entity.
3. Both packs must be active on the world (the behavior pack pulls the resource pack in). If the
   game says a pack failed to load, your game is older than 1.26.30 or another copy of an older
   Minepreggo version is still installed: remove it in Settings → Storage and import again.
4. Chest and belly show in third person and, in first person, when you look down more than 25°.

### Other species

**Potions of Zombie, Creeper, Ender, Slime and Villager Impregnation** (I–VI) give a litter of
that species: the babies and dead fetuses are that species' items, and the mother carries the mod's
"Full Of ..." condition for the whole pregnancy. Zombie: you burn in daylight without a helmet.
Creeper: dying from P3 on explodes. Ender: now and then the babies teleport you 8–16 blocks.
Slime: the babies cushion your falls. Every pregnancy makes falls hurt more from P3, and dying from
P3 on leaves a dead fetus per baby. Used on a mob, only her own species' potion (or the human one)
works; another species' potion just hurts her, as in the mod.

The babies also decide the mother's diet, as in the mod: zombie babies crave brains (villager,
illager and witch brains plus brain with chocolate, salt, hot sauce and sour brain), creeper
babies activated gunpowder, ender babies ender slime jelly and chorus fruit, slime babies rotten
flesh and spider eyes, each in sweet, salty, sour and spicy variants that satisfy the matching
craving. Those foods only agree with a mother carrying that species; anyone else gets nausea and
no food from them. While pregnant with another species, a glass bottle fills with that species'
breast milk.

### Without potions

As in the mod, the monsters do it themselves: a zombie (8 hits), creeper (2), enderman (10) or
slime (6) that hits a female character gets her pregnant with its species, 15 seconds later. A
zombie, creeper, enderman or slime that stands next to a free female mob of its own kind for
three seconds gets her pregnant too (hearts show while he is there).

### Navel birth (ender babies)

Ender babies come out through the navel: during pre-birth they push the belly button outward
with every kick, and during birth the navel crowns further out with each push until the baby is
born. This plays for the ender woman and for a player carrying ender babies, on top of the normal
labor pose.

### Guide book

Every new player gets the **Minepreggo Guide** (also craftable: book + lemon). Use it to open the
chapters: getting started, phases, symptoms and pains, fetal movements, labor and birth, other
species, preggo mobs, commands.

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
/scriptevent minepreggo:pregnancy induce <0-4>          # fetal movement of that severity (P3+)
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
/scriptevent minepreggo:mob induce <0-4>
/scriptevent minepreggo:guide                           # gives the guide book again; its "Debug tools" chapter runs all of this with buttons
/scriptevent minepreggo:debug belly <0-9>               # shows that belly size for 10 s on you and the nearest mob (P0/P1 are flat by design)
/scriptevent minepreggo:debug [kick|birth|off]          # shows the rendered properties and the version; forces a 10 s kick/birth (on a P7 belly if hers is small)
/scriptevent minepreggo:mob symptom craving|milking|belly_rubs
```

The add-on overrides the player entity (`packs/behavior/entities/player.json`,
`packs/resource/entity/player.entity.json`) to draw the pregnant body; another add-on that also
overrides the player wins or loses depending on pack order, in which case the body visuals are off
but everything else works.

If the game says a pack failed to load, turn on **Settings → Creator → Content Log GUI** and
reload the world: the log names the file and the problem. When the scripts are running, every
player sees "[Minepreggo 0.2.0] Add-on loaded." and the self-check line on joining.

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
mkdir -p vendor/jenny                                         # optional: the Jenny add-ons to merge in
cp "/path/to/Jenny-Mod-Java-Port-v2.7.2.mcaddon" /path/to/jenny*.mcpack vendor/jenny/
mkdir -p vendor/reign                                         # optional: Reign of Nether's source tree
git clone https://github.com/SoLegendary/reignofnether vendor/reign/reignofnether
npm run import   # extracts textures, sounds, translations, models, animations and icon into packs/,
                 # then merges the Jenny add-ons (tools/import-jenny.mjs) when vendor/jenny/ has them
                 # and Reign of Nether (tools/import-reign.mjs) when vendor/reign/ has it
npm run check    # type-checks scripts, validates JSON against Mojang's schemas and cross-references
npm test         # unit tests, model conversion checks, pregnancy simulations (players and mobs) and a
                 # smoke test that loads the whole script entry point against the mocked game API
npm run build    # writes dist/minepreggo-<version>.mcaddon (`npm run build -- --no-reign` leaves
                 # Reign of Nether out)
```

Open the `.mcaddon` on a device with Minecraft installed (double-click on Windows, "open with
Minecraft" on mobile), then activate both packs on a world.

### Consoles

The add-on needs no experimental toggles (stable Script API only), keeps every file path under
the 100-character limit that consoles enforce, and is checked with Microsoft's Creator Tools, so
it runs on Xbox, PlayStation and Switch like any other add-on. Consoles can't open files from a
USB stick, so get it onto one of these ways:

- add it to a world on a PC or phone, then share that world through a **Realm** (every platform),
- on Xbox, download the `.mcaddon` with the console's Edge browser and open it from the downloads,
- or export the world from a PC/phone as a `.mcworld` and import it the same way.

When you join a world with the add-on, chat shows `[Minepreggo 0.2.0] Add-on loaded.` followed by
a self-check line (`mobs ✔ items ✔ crops ✔ player visuals ✔`). A red ✘ names the part that
failed to load; the Content Log GUI (Settings → Creator) has the details on platforms that show it.

## Layout

```
packs/behavior/   behavior pack: items, blocks, entities, spawn rules, recipes, loot tables, trades,
                  scripts (pregnancy/ for players, mobs/ for the preggo mobs)
packs/resource/   resource pack: client entities, render and animation controllers, texture atlases,
                  block geometry, sound definitions, language list
tools/            import-jar.mjs, validate.mjs, build.mjs, lib/ (Java model converter),
                  bedrock-schemas/ (Mojang's JSON schemas), lang/ (strings the port adds), tests/
docs/             porting plan and known differences
vendor/           your local copy of the mod jar, vendor/jenny/ the Jenny add-ons and vendor/reign/
                  Reign of Nether's source (git-ignored)
```

## The Jenny add-ons

With the Jenny Mod Java Port `.mcaddon` and the older Jenny `.mcpack` pair in `vendor/jenny/`,
`npm run import` merges them into the two packs (one behavior pack, one resource pack): the port's
girls keep their own scripts, menus and scenes and join the Minepreggo mob system, so a scene that
can get a girl pregnant does, her belly grows with the phases on every body she renders (dressed,
undressed, scene stage), the babies kick, and she gives birth; every potion works on her too. The
older pack's Jenny Bed lets a tamed Minepreggo female of yours be taken to bed for a 50-second scene
that leaves her pregnant: pick her on the bed and she walks over (or is placed on it after 20 s),
the scene is shown from a camera beside the bed, and with the port installed her sounds play along.
The Jenny girls' bellies are smooth, round shells in each girl's own skin tone, and each girl has
her own labor: she bends over her belly in a contraction, crouches before the birth, lies back with
her knees up to give birth (her baby's head crowns between her legs with each push), and her babies
are her own items. The kobold lays eggs: late in her pregnancy her Mating scene becomes an
egg-laying scene, and her eggs placed as a clutch crack and hatch into her baby.
When she is pregnant, her babies kick and her belly tightens during scenes, hers and the Jenny Bed's.
Crouch and use an empty hand on a pregnant female for her pregnancy menu: rub her belly, feel the
baby, or help her give birth (tap sneak to push, the babies are born into your arms). The guide
book's "Jenny mod" chapter has the details. Like the jar's assets, nothing of theirs is committed; the import folders
are git-ignored.

## Births and Actions & Stuff

In every birth (the player's, the mod's females' and the Jenny girls') the baby's head crowns at
the opening, comes out further with each push and slips back a little between pushes, and the
whole baby slides out just before it is born: the mod's own fetus models for the player and the
mod's females (navel births come out of the belly), a small baby in her skin tone for the Jenny
girls (tools/lib/crowning.mjs; `node tools/render-crowning.mjs` renders every mother).

Actions & Stuff replaces the player model, so on a game running it this pack's player body does
not show (no two resource packs can share the player model). The guide book's Settings page has
two opt-in switches for it: "My game runs Actions & Stuff" plays the pregnant players' poses on
that game through the Script API (and moves the belly rub into the book, since crouching and
looking down is its sit gesture), and "Show my belly to Actions & Stuff players" puts a pregnant
player's belly in her off-hand, drawn on her body by any player model and hidden where this
pack's own player model draws it already.
