// The Minepreggo guide book: an item that opens a chapter menu (a Bedrock addition; the mod
// documents itself through its wiki and GUIs). New players get one on their first join.

import { ItemStack, Player, system, world } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { setSettings, settingsOf } from '../player/compat.js';
import { startBellyRub } from '../pregnancy/index.js';
import { runMobCommand } from '../mobs/commands.js';
import { runPregnancyCommand } from '../pregnancy/commands.js';
import { getRecord } from '../pregnancy/system.js';
import { forceBelly, forcePose, report, stopForcing } from './debug.js';

const GUIDE = 'minepreggo:guide_book';
/** A forced state started from the book lasts long enough to close the book and look (30 s). */
const BOOK_TICKS = 600;

/** @type {{ title: string, body: string, debug?: boolean, settings?: boolean, rub?: boolean }[]} */
export const CHAPTERS = [
  {
    title: 'Getting started',
    body:
      'Minepreggo adds pregnancy for your character and for four kinds of female mobs.\n\n' +
      '1. When you first join, choose a gender. Only a female character can become pregnant. You can keep your own skin or use the Minepreggo Alex skin (/scriptevent minepreggo:gender female, /scriptevent minepreggo:skin alex).\n' +
      '2. Drink a Potion of Impregnation (creative inventory, Items tab). 15 seconds later the pregnancy starts. Potion II to VI mean more babies (2-3, 4-5, 6-7, 8-9, 10).\n' +
      '3. Crouch to see your status on the action bar: phase, day, pregnancy health and what you feel.\n\n' +
      'The chest and belly show on your body in third person, and in first person when you look down.',
  },
  {
    title: 'Phases P0-P9',
    body:
      'A pregnancy lasts 50 Minecraft days in up to ten phases. One baby is born in P4; more babies mean a later birth (P5 to P9) and a bigger belly.\n\n' +
      'P0 and P1: the belly is flat, as in the mod (nothing to see yet). P2: a small bump (none yet on the monster creeper girl). P3: the belly shows and the baby starts to move. P4+: back pain after long walks, heavy walking. P7+: a big belly and hard kicks.\n\n' +
      'Sleeping through the night moves the pregnancy forward. A Potion of Pregnancy Acceleration skips 4 to 17 days at once; the Gradual one makes time run 120-600x faster for 3 minutes.',
  },
  {
    title: 'Symptoms and pains',
    body:
      'Cravings: eat the craved kind of food (sweet, salty, sour or spicy). Other food feeds you less until you do.\n' +
      'Lactation: use a glass bottle to fill it with breast milk, which cures effects.\n' +
      'Belly rubs (P3+): crouch and look down (or use \'Rub my belly\' in this book) to rub your belly, or let another player crouch and interact with an empty hand.\n\n' +
      'Morning sickness, fetal movements (P3+), contractions (last phase) and back pain come on their own. Spicy food is risky from P4. Getting hurt while weak harms the pregnancy; at 0 % it ends in a miscarriage.',
  },
  {
    title: 'Fetal movements',
    body:
      'From P3 the baby kicks now and then: you hear it, the action bar says so and the belly animates with the kick strength (I, II or III). Late in the pregnancy the kicks bulge out of the belly.\n\n' +
      'A Potion of Fetal Movement Inducement (I-III) brings a kick on at that strength, for you or for a pregnant mob you use it on.',
  },
  {
    title: 'Labor and birth',
    body:
      'When the last phase is complete your water breaks, then come pre-birth and birth. You cannot use items during labor.\n\n' +
      'During birth, tap sneak quickly to push. Each baby needs four bursts of quick taps; the action bar shows the progress. Every baby is born as an item in front of you. After the post-birth rest you recover for a while and lactate.',
  },
  {
    title: 'Other species',
    body:
      'Potions of Zombie, Creeper, Ender, Slime and Villager Impregnation give a litter of that species. The monsters themselves can do it too: zombies (8 hits), creepers (2), endermen (10) and slimes (6) that hit a female character get her pregnant with their species, and a zombie, creeper, enderman or slime that stands next to a free female mob of its kind for a few seconds gets her pregnant.\n\n' +
      'Zombie: you burn in daylight without a helmet. Creeper: dying from P3 on explodes. Ender: now and then the babies teleport you. Slime: the babies cushion your falls. Villager: nothing special.\n\n' +
      'Any pregnancy makes falls hurt more from P3, and dying from P3 on leaves a dead fetus per baby.\n\n' +
      'The babies also decide the diet: zombie babies crave brains (villager, illager and witch brains, and brain with chocolate, salt, hot sauce or sour brain), creeper babies activated gunpowder, ender babies ender slime jelly and chorus fruit, slime babies rotten flesh and spider eyes, each in the sweet, salty, sour and spicy variants. Those foods only agree with a mother carrying that species. Her milk is that species\' milk too.',
  },
  {
    title: 'Potions',
    body:
      'All potions are in the creative inventory (Items tab) and in Debug tools > Give items. Drink one, or use it on a female mob (her owner if she is tamed; anyone on a wild pregnant one).\n\n' +
      'Impregnation I-VI: pregnant 15 seconds later (the action bar counts down); more babies per level. Zombie, Creeper, Ender, Slime and Villager Impregnation: a litter of that species; on a mob only her own species works, another species\' potion hurts her.\n' +
      'Pregnancy Acceleration I-V: skips 7 % of the pregnancy per level at once. Gradual Pregnancy Acceleration I-V: the pregnancy runs 120-600x faster for 3 minutes.\n' +
      'Pregnancy Delay I-V: 7 % per level longer. Baby Duplication I-V: one more baby per level (10 at most), a later birth and a jump forward.\n' +
      'Pregnancy Healing: pregnancy health back to 100. Pregnancy Harming: -30 pregnancy health and a heart; at 0 the pregnancy ends in a miscarriage.\n' +
      'Pregnancy Resistance (8 or 16 min): hits no longer harm the pregnancy. Zero Gravity Belly (8 or 16 min): no slowdown and no extra fall damage. Metabolism Control (5 or 10 min, Strong = II): your saturation keeps refilling. Eternal Pregnancy: birth never comes until you drink milk.\n' +
      'Fetal Movement Inducement I-III: a kick of that strength (from P3).\n\n' +
      'A potion that cannot act says why instead of being wasted.',
  },
  {
    title: 'Preggo mobs',
    body:
      'Zombie girls, creeper girls, slime girls and ender women spawn like their vanilla cousins; some are already pregnant and cannot be tamed.\n\n' +
      'Tame one with her food: villager brain (dropped by villagers, illagers and witches you kill), activated gunpowder (redstone + gunpowder), refined chorus shards / ender slime jelly, or a stuffed mushroom.\n\n' +
      'Use a Potion of Impregnation on a tamed mob. Feed her when hungry or she turns savage. As her owner: feed the craved food, milk her with a glass bottle (P2+), crouch and interact with an empty hand when she is pregnant for her pregnancy menu (rub her belly, feel the baby, help her give birth). Acceleration and inducement potions work on her too. Birth happens on its own.',
  },
  {
    title: 'Jenny mod',
    body:
      'The Jenny Mod Java Port girls (Jenny, Bia, Slime, Luna, Galath, Allie, Manglelie, Bee, Kobold and Ellie) are part of this add-on and of its mob system. The scenes that can get them pregnant do: Doggy for Jenny and Slime, Prone Doggy for Bia, Sitting for Luna, Cowgirl and Threesome for Galath (Manglelie too), Reverse Cowgirl for Allie, the Bee scene, Mating for Kobold, Cowgirl and Missionary for Ellie. Oral and anal scenes do not.\n\n' +
      'The pregnancy is then the Minepreggo one: the belly grows with the phases on her dressed, undressed and scene bodies, the babies kick, and she gives birth. Every potion works on her too, and Debug tools > Nearest mob jumps her ahead.\n\n' +
      'The Jenny Bed (creative inventory, or Give items here) is for the Minepreggo females: place it, stand one of your tamed females within 5 blocks, use the bed and choose her. A 50 second scene follows and she comes out pregnant. A small house with a bed spawns now and then in forests and plains.\n\n' +
      'When she is already pregnant, her babies kick in bursts during a scene and, from P6, her belly tightens in contractions now and then: in the Jenny Bed scene and in the Jenny girls\' own scenes alike.\n\n' +
      'Crouch and use an empty hand on a pregnant female (your own tamed one, or any Jenny girl) for her pregnancy menu: Rub her belly (eases her need for belly rubs, the babies kick back), Feel the baby (they kick into your hands, and you count their heartbeats), and in labor Help her give birth: tap sneak to push with her, every baby is born into your arms, jump to stop.\n\n' +
      'Each Jenny girl has her own labor and birth: she bends over her belly in a contraction, crouches before the birth, lies back with her knees up to give birth, and her baby is hers (Jenny\'s Baby, Luna\'s Baby, ...); its head crowns between her legs with each push. Use a baby to cuddle it.\n\n' +
      'The Kobold lays eggs. Late in her pregnancy her Mating scene becomes an egg-laying scene: her belly hardens, and once her partner pulls back an egg slides out between her legs and she hands it to you; a second one follows, and any left come as you help her push. Place Kobold Eggs as a clutch (up to four, use an egg on it to add one): they crack over the next minutes, faster with a kobold nearby, and hatch into her baby.',
  },
  {
    title: 'Commands',
    body:
      'Operators can test everything with /scriptevent:\n' +
      'minepreggo:pregnancy start|potion|phase <n>|days <n>|labor|miscarry|accelerate <0-4>|induce <0-4>|pain <name>|symptom <name>|status|end\n' +
      'minepreggo:mob (nearest mob) status|start|potion|phase|labor|induce|feed|starve|...\n' +
      'minepreggo:gender female|male, minepreggo:skin custom|alex|steve\n' +
      'minepreggo:debug belly <0-9> shows that belly size on you and the nearest mob for 10 s; minepreggo:debug kick|birth forces the kicks or a birth.\n' +
      'minepreggo:guide gives this book again.\n\n' +
      'The Debug tools chapter of this book runs all of this with buttons.',
  },
  {
    title: 'Debug tools',
    body:
      'Buttons that give every potion and run the test commands on you and on the nearest female mob (within 16 blocks): show any belly size, force the kicks or a birth, start a pregnancy, jump to a phase, use any potion effect, start labor, see what the game renders from.',
    debug: true,
  },
  {
    title: 'Rub my belly',
    body: 'Rubs your belly for a while (from P3), like crouching and looking down at it.',
    rub: true,
  },
  {
    title: 'Settings',
    body: 'Actions & Stuff: your belly, its skin tone, and the belly-rub gesture.',
    settings: true,
  },
];

/** The belly's skin tones, in the order of player/compat.js (0 is the Alex belly of 0.6.0). */
const TONE_NAMES = ['Alex (default)', 'Light', 'Medium', 'Tan', 'Brown', 'Dark'];

/** The Settings page: what players with another player model (Actions & Stuff) see of her (player/compat.js). */
export function openSettings(/** @type {Player} */ player, /** @type {() => void} */ back) {
  const now = settingsOf(player);
  new ModalFormData()
    .title('Minepreggo settings')
    .label('Players whose game runs Actions & Stuff (or another pack with its own player model) cannot see this pack\'s pregnant body. They get the poses automatically; the belly needs your off-hand.')
    .toggle('Show my belly to them (held in my off-hand from P2; invisible to everyone else and to me in first person)', { defaultValue: now.belly === true })
    .dropdown('Skin tone of that belly', TONE_NAMES, { defaultValueIndex: now.tone })
    .toggle('Crouch and look down to rub my belly (turn off if Actions & Stuff sits you down instead; \'Rub my belly\' in this book always works)', { defaultValue: now.rubGesture })
    .label('Check: with Actions & Stuff on and pregnant, press F5 - you should see your belly.')
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues || !player.isValid) return;
      // labels may or may not take a slot in formValues (undefined); the three answers are what is left
      const [belly, tone, rub] = response.formValues.filter((v) => v !== undefined);
      setSettings(player, { belly: !!belly, tone: Number(tone) || 0, rubGesture: !!rub });
      player.sendMessage({ translate: 'minepreggo.compat.saved' });
      back();
    });
}

/**
 * @typedef {object} DebugItem
 * @property {string} label
 * @property {(player: Player) => string} [run] what the button does; the result is shown
 * @property {DebugItem[]} [menu] a sub-menu instead
 */

const PHASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** @param {(player: Player, phase: number) => string} action */
const phaseMenu = (action) => PHASES.map((n) => ({ label: `P${n}${n <= 1 ? ' (flat)' : n >= 7 ? ' (big)' : ''}`, run: (/** @type {Player} */ player) => action(player, n) }));

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const SPECIES = [['zombie', 'Zombie'], ['creeper', 'Creeper'], ['ender', 'Ender'], ['slime', 'Slime'], ['villager', 'Villager']];

/** Puts one `item` in the player's inventory (or drops it at her feet when it is full). */
export function giveItem(/** @type {Player} */ player, /** @type {string} */ item) {
  const leftover = player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(item, 1));
  if (leftover) player.dimension.spawnItem(leftover, player.location);
}

/** A button that gives one item. */
const giver = (/** @type {string} */ label, /** @type {string} */ item) => ({ label, run: (/** @type {Player} */ player) => (giveItem(player, item), `Given: ${label}.`) });
/** Buttons for a potion in strengths I..count. */
const strengths = (/** @type {string} */ label, /** @type {string} */ base, /** @type {number} */ count) =>
  Array.from({ length: count }, (_, n) => giver(`${label} ${ROMAN[n]}`, `minepreggo:${base}_${n}`));

/** @type {DebugItem[]} Every item of the add-on worth testing with. */
export const GIVE_MENU = [
  { label: 'Potion of Impregnation I-VI', menu: strengths('Potion of Impregnation', 'impregnation_potion', 6) },
  { label: 'Species impregnation potions I-VI', menu: SPECIES.map(([id, name]) => ({ label: `${name} Impregnation I-VI`, menu: strengths(`Potion of ${name} Impregnation`, `${id}_impregnation_potion`, 6) })) },
  { label: 'Pregnancy Acceleration I-V', menu: strengths('Pregnancy Acceleration', 'pregnancy_acceleration_potion', 5) },
  { label: 'Gradual Pregnancy Acceleration I-V', menu: strengths('Gradual Pregnancy Acceleration', 'gradual_pregnancy_acceleration_potion', 5) },
  { label: 'Fetal Movement Inducement I-III', menu: strengths('Fetal Movement Inducement', 'fetal_movement_inducer_potion', 3) },
  { label: 'Pregnancy Delay I-V', menu: strengths('Pregnancy Delay', 'pregnancy_delay_potion', 5) },
  { label: 'Baby Duplication I-V', menu: strengths('Baby Duplication', 'baby_duplication_potion', 5) },
  {
    label: 'Healing, Harming, Resistance, Zero Gravity, Metabolism, Eternal',
    menu: [
      giver('Pregnancy Healing', 'minepreggo:pregnancy_healing_potion'),
      giver('Pregnancy Harming', 'minepreggo:pregnancy_harming_potion'),
      giver('Pregnancy Resistance (8 min)', 'minepreggo:pregnancy_resistance_potion'),
      giver('Long Pregnancy Resistance (16 min)', 'minepreggo:long_pregnancy_resistance_potion'),
      giver('Zero Gravity Belly (8 min)', 'minepreggo:zero_gravity_belly_potion'),
      giver('Long Zero Gravity Belly (16 min)', 'minepreggo:long_zero_gravity_belly_potion'),
      giver('Metabolism Control (5 min)', 'minepreggo:metabolism_control_potion'),
      giver('Long Metabolism Control (10 min)', 'minepreggo:long_metabolism_control_potion'),
      giver('Strong Metabolism Control II', 'minepreggo:strong_metabolism_control_potion'),
      giver('Eternal Pregnancy', 'minepreggo:eternal_pregnancy_potion'),
    ],
  },
  giver('Jenny Bed', 'minepreggo:jenny_bed'),
  giver('Guide book', GUIDE),
];

/** @type {DebugItem[]} The Debug tools chapter. */
export const DEBUG_MENU = [
  { label: 'Give items (potions, this book)', menu: GIVE_MENU },
  { label: 'Show a belly size for 30 s (me + nearest mob)', menu: phaseMenu((player, n) => forceBelly(player, n, BOOK_TICKS)) },
  { label: 'Force fetal movement for 30 s', run: (player) => forcePose(player, 'kick', BOOK_TICKS) },
  { label: 'Force a birth push for 30 s', run: (player) => forcePose(player, 'birth', BOOK_TICKS) },
  { label: 'Stop forcing, show the real state', run: stopForcing },
  {
    label: 'My pregnancy',
    menu: [
      { label: 'Give me the female body', run: (player) => (getRecord(player).setGender('female'), 'Your character is female now.') },
      { label: 'Start a pregnancy (1 baby)', run: (player) => runPregnancyCommand(player, 'start 1') },
      { label: 'Start a pregnancy (3 babies)', run: (player) => runPregnancyCommand(player, 'start 3') },
      { label: 'Jump to a phase', menu: phaseMenu((player, n) => runPregnancyCommand(player, `phase ${n}`)) },
      { label: 'Induce kicks (III)', run: (player) => runPregnancyCommand(player, 'induce 2') },
      { label: 'Accelerate (potion IV)', run: (player) => runPregnancyCommand(player, 'accelerate 3') },
      { label: 'Delay (potion III)', run: (player) => runPregnancyCommand(player, 'delay 2') },
      { label: 'Duplicate babies (potion I)', run: (player) => runPregnancyCommand(player, 'duplicate 0') },
      { label: 'Heal the pregnancy', run: (player) => runPregnancyCommand(player, 'heal') },
      { label: 'Harm the pregnancy (-30)', run: (player) => runPregnancyCommand(player, 'harm') },
      { label: 'Start labor', run: (player) => runPregnancyCommand(player, 'labor') },
      { label: 'End the pregnancy', run: (player) => runPregnancyCommand(player, 'end') },
      { label: 'Cure potion effects', run: (player) => runPregnancyCommand(player, 'cure') },
      { label: 'Status', run: (player) => runPregnancyCommand(player, 'status') },
    ],
  },
  {
    label: 'Nearest mob',
    menu: [
      { label: 'Start a pregnancy (1 baby)', run: (player) => runMobCommand(player, 'start 1') },
      { label: 'Start a pregnancy (3 babies)', run: (player) => runMobCommand(player, 'start 3') },
      { label: 'Jump to a phase', menu: phaseMenu((player, n) => runMobCommand(player, `phase ${n}`)) },
      { label: 'Induce kicks (III)', run: (player) => runMobCommand(player, 'induce 2') },
      { label: 'Accelerate (potion IV)', run: (player) => runMobCommand(player, 'accelerate 3') },
      { label: 'Delay (potion III)', run: (player) => runMobCommand(player, 'delay 2') },
      { label: 'Duplicate babies (potion I)', run: (player) => runMobCommand(player, 'duplicate 0') },
      { label: 'Heal the pregnancy', run: (player) => runMobCommand(player, 'heal') },
      { label: 'Harm the pregnancy (-30)', run: (player) => runMobCommand(player, 'harm') },
      { label: 'Start labor', run: (player) => runMobCommand(player, 'labor') },
      { label: 'Feed her', run: (player) => runMobCommand(player, 'feed') },
      { label: 'End the pregnancy', run: (player) => runMobCommand(player, 'end') },
      { label: 'Status', run: (player) => runMobCommand(player, 'status') },
    ],
  },
  { label: 'What the game renders from (me + nearest mob)', run: (player) => report(player).join('\n') },
];


/**
 * Shows a debug menu; a button runs its action and shows the result, or opens its sub-menu.
 * @param {Player} player
 * @param {string} title
 * @param {DebugItem[]} items
 * @param {() => void} back what the last button does
 */
function openDebugMenu(player, title, items, back) {
  const menu = new ActionFormData().title(title).body('Choose an action.');
  for (const item of items) menu.button(item.label);
  menu.button('Back');
  menu.show(player).then((response) => {
    if (response.canceled || response.selection === undefined || !player.isValid) return;
    const item = items[response.selection];
    if (!item) return back();
    if (item.menu) return openDebugMenu(player, item.label, item.menu, () => openDebugMenu(player, title, items, back));
    let result = 'Done.';
    try {
      result = item.run?.(player) || result;
    } catch (error) {
      result = `Failed: ${error}`;
    }
    new ActionFormData()
      .title(item.label)
      .body(result)
      .button('Back')
      .show(player)
      .then((page) => {
        if (!page.canceled && player.isValid) openDebugMenu(player, title, items, back);
      });
  });
}

/** The Debug tools chapter. */
export function openDebugTools(/** @type {Player} */ player, /** @type {() => void} */ back) {
  openDebugMenu(player, 'Debug tools', DEBUG_MENU, back);
}

/** Puts a guide book in the player's inventory. */
export const giveGuide = (/** @type {Player} */ player) => giveItem(player, GUIDE);

/** @param {Player} player */
export function openGuide(player) {
  const menu = new ActionFormData().title('Minepreggo guide').body('Choose a chapter.');
  for (const chapter of CHAPTERS) menu.button(chapter.title);
  menu.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    const chapter = CHAPTERS[response.selection];
    if (!chapter) return;
    if (chapter.debug) return openDebugTools(player, () => openGuide(player));
    if (chapter.settings) return openSettings(player, () => openGuide(player));
    if (chapter.rub) {
      const started = startBellyRub(getRecord(player));
      player.onScreenDisplay.setActionBar({ translate: started ? 'minepreggo.compat.rubbing' : 'minepreggo.compat.no_rub' });
      return;
    }
    new ActionFormData()
      .title(chapter.title)
      .body(chapter.body)
      .button('Back to chapters')
      .show(player)
      .then((page) => {
        if (!page.canceled && player.isValid) openGuide(player);
      });
  });
}

world.beforeEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId !== GUIDE) return;
  event.cancel = true;
  const { source } = event;
  system.run(() => openGuide(source));
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn || player.getDynamicProperty('minepreggo:guide_given')) return;
  player.setDynamicProperty('minepreggo:guide_given', true);
  giveGuide(player);
});

// /scriptevent minepreggo:guide: the book again (lost, or joined before it existed).
system.afterEvents.scriptEventReceive.subscribe(({ id, sourceEntity }) => {
  if (id !== 'minepreggo:guide' || !(sourceEntity instanceof Player)) return;
  giveGuide(sourceEntity);
  sourceEntity.sendMessage('[Minepreggo] Guide book given. Use it to read the chapters or to open the Debug tools.');
});
