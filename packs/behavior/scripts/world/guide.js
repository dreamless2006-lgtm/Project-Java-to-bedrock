// The Minepreggo guide book: an item that opens a chapter menu (a Bedrock addition; the mod
// documents itself through its wiki and GUIs). New players get one on their first join.

import { ItemStack, Player, system, world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';

const GUIDE = 'minepreggo:guide_book';

/** @type {{ title: string, body: string }[]} */
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
      'P0-P2: barely visible. P3: the belly shows and the baby starts to move. P4+: back pain after long walks, heavy walking. P7+: a big belly and hard kicks.\n\n' +
      'Sleeping through the night moves the pregnancy forward. A Potion of Pregnancy Acceleration skips 4 to 17 days at once; the Gradual one makes time run 120-600x faster for 3 minutes.',
  },
  {
    title: 'Symptoms and pains',
    body:
      'Cravings: eat the craved kind of food (sweet, salty, sour or spicy). Other food feeds you less until you do.\n' +
      'Lactation: use a glass bottle to fill it with breast milk, which cures effects.\n' +
      'Belly rubs (P3+): crouch and look down to rub your belly, or let another player crouch and interact with an empty hand.\n\n' +
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
      'Potions of Zombie, Creeper, Ender, Slime and Villager Impregnation give a litter of that species.\n\n' +
      'Zombie: you burn in daylight without a helmet. Creeper: dying from P3 on explodes. Ender: now and then the babies teleport you. Slime: the babies cushion your falls. Villager: nothing special.\n\n' +
      'Any pregnancy makes falls hurt more from P3, and dying from P3 on leaves a dead fetus per baby.\n\n' +
      'The babies also decide the diet: zombie babies crave brains (villager, illager and witch brains, and brain with chocolate, salt, hot sauce or sour brain), creeper babies activated gunpowder, ender babies ender slime jelly and chorus fruit, slime babies rotten flesh and spider eyes, each in the sweet, salty, sour and spicy variants. Those foods only agree with a mother carrying that species. Her milk is that species\' milk too.',
  },
  {
    title: 'Preggo mobs',
    body:
      'Zombie girls, creeper girls, slime girls and ender women spawn like their vanilla cousins; some are already pregnant and cannot be tamed.\n\n' +
      'Tame one with her food: villager brain (dropped by villagers, illagers and witches you kill), activated gunpowder (redstone + gunpowder), refined chorus shards / ender slime jelly, or a stuffed mushroom.\n\n' +
      'Use a Potion of Impregnation on a tamed mob. Feed her when hungry or she turns savage. As her owner: feed the craved food, milk her with a glass bottle (P2+), crouch and interact with an empty hand to rub her belly (P3+). Acceleration and inducement potions work on her too. Birth happens on its own.',
  },
  {
    title: 'Commands',
    body:
      'Operators can test everything with /scriptevent:\n' +
      'minepreggo:pregnancy start|potion|phase <n>|days <n>|labor|miscarry|accelerate <0-4>|induce <0-4>|pain <name>|symptom <name>|status|end\n' +
      'minepreggo:mob (nearest mob) status|start|potion|phase|labor|induce|feed|starve|...\n' +
      'minepreggo:gender female|male, minepreggo:skin custom|alex|steve',
  },
];

/** @param {Player} player */
export function openGuide(player) {
  const menu = new ActionFormData().title('Minepreggo guide').body('Choose a chapter.');
  for (const chapter of CHAPTERS) menu.button(chapter.title);
  menu.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    const chapter = CHAPTERS[response.selection];
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
  const leftover = player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(GUIDE, 1));
  if (leftover) player.dimension.spawnItem(leftover, player.location);
});
