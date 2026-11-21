// Armour for the girls made for us (the Pokémon and furry girls, tools/import-jenny-preggo.mjs armorLayer):
// use a chestplate on one you tamed and she wears that armour (drawn over her, her belly out in front
// of it), and it guards her: resistance by its material. Her Wahoo menu takes it off again (her
// chestplate back to you). The minepreggo:armor property: 0 none, 1 leather, 2 iron (or chainmail),
// 3 gold, 4 diamond, 5 netherite.
import { ItemStack, system, world } from '@minecraft/server';
import { FAMILY_TAG } from './system.js';

export const ARMOR = 'minepreggo:armor';
/** Each chestplate's armour, and the chestplate each armour gives back. */
export const CHESTPLATES = /** @type {Record<string, number>} */ ({
  'minecraft:leather_chestplate': 1, 'minecraft:chainmail_chestplate': 2, 'minecraft:iron_chestplate': 2,
  'minecraft:golden_chestplate': 3, 'minecraft:diamond_chestplate': 4, 'minecraft:netherite_chestplate': 5,
});
const BACK = ['', 'minecraft:leather_chestplate', 'minecraft:iron_chestplate', 'minecraft:golden_chestplate', 'minecraft:diamond_chestplate', 'minecraft:netherite_chestplate'];
/** Resistance by armour (its amplifier; none for leather). */
const RESISTANCE = [-1, -1, 0, 0, 1, 1];

/** Her armour (0: none, or she cannot wear any). */
export function armorOf(/** @type {import('@minecraft/server').Entity} */ entity) {
  try {
    return /** @type {number} */ (entity.getProperty(ARMOR) ?? 0);
  } catch {
    return 0;
  }
}
/** Whether she can wear armour (her model has a layer for it). */
export function canWearArmor(/** @type {import('@minecraft/server').Entity} */ entity) {
  try {
    return entity.getProperty(ARMOR) !== undefined;
  } catch {
    return false;
  }
}
/** She puts on the armour of a chestplate (her old armour's chestplate dropped at her feet). */
export function wearArmor(/** @type {import('@minecraft/server').Entity} */ entity, /** @type {string} */ chestplate) {
  const armor = CHESTPLATES[chestplate];
  if (!armor) return false;
  takeOffArmor(entity);
  entity.setProperty(ARMOR, armor);
  entity.dimension.playSound(armor === 3 ? 'armor.equip_gold' : armor === 4 ? 'armor.equip_diamond' : armor === 5 ? 'armor.equip_netherite' : armor === 1 ? 'armor.equip_leather' : 'armor.equip_iron', entity.location);
  return true;
}
/** She takes off her armour: its chestplate dropped at her feet. */
export function takeOffArmor(/** @type {import('@minecraft/server').Entity} */ entity) {
  const armor = armorOf(entity);
  if (!armor) return false;
  entity.setProperty(ARMOR, 0);
  entity.dimension.spawnItem(new ItemStack(BACK[armor], 1), entity.location);
  return true;
}

// (every two seconds: her armour's resistance, a little longer than that)
system.runInterval(() => {
  for (const id of ['overworld', 'nether', 'the_end']) {
    for (const entity of world.getDimension(id).getEntities({ tags: [FAMILY_TAG] })) {
      const amplifier = RESISTANCE[armorOf(entity)] ?? -1;
      if (amplifier < 0) continue;
      try {
        entity.addEffect('resistance', 60, { amplifier, showParticles: false });
      } catch {
        // gone
      }
    }
  }
}, 40);
