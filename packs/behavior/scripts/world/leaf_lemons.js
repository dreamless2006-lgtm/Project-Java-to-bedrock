// Port of loot/OakLeavesLemonsModifier: oak and dark oak leaves sometimes drop 1-3 lemons unless
// broken with shears or Silk Touch. Bedrock leaves have no editable loot table, so this hooks
// player breaking instead; unlike Java, leaves that decay on their own never drop lemons.

import { world, ItemStack, GameMode } from '@minecraft/server';

const LEAVES = new Set(['minecraft:oak_leaves', 'minecraft:dark_oak_leaves']);
const BASE_CHANCE = 0.0175;
const FORTUNE_FACTOR = 1.3;

world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation, itemStackBeforeBreak, player }) => {
  if (!LEAVES.has(brokenBlockPermutation.type.id)) return;
  if (player.getGameMode() === GameMode.Creative) return;
  if (itemStackBeforeBreak?.typeId === 'minecraft:shears') return;

  const enchantable = itemStackBeforeBreak?.getComponent('minecraft:enchantable');
  if (enchantable?.getEnchantment('minecraft:silk_touch')) return;
  const fortune = enchantable?.getEnchantment('minecraft:fortune')?.level ?? 0;
  const chance = fortune > 0 ? BASE_CHANCE * fortune * FORTUNE_FACTOR : BASE_CHANCE;
  if (Math.random() >= chance) return;

  const count = 1 + Math.floor(Math.random() * 3);
  block.dimension.spawnItem(new ItemStack('minepreggo:lemon', count), block.center());
});
