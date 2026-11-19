// Other add-ons' women (tools/compat-addons.mjs, packs/behavior/scripts/mobs/compat_women.js): a woman
// is marked by her minepreggo:female property, whatever her mob type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mob, emit, world } from './mock-server.mjs';
import '../../packs/behavior/scripts/main.js';
import { COMPAT_WOMAN } from '../../packs/behavior/scripts/mobs/families.js';
import { familyOf } from '../../packs/behavior/scripts/mobs/system.js';

const unit = (/** @type {number} */ female) => {
  const mob = new Mob('worldbox:berserker', { families: ['mob', 'worldbox_unit', 'minepreggo_preggo_mob'] });
  mob.properties.set('minepreggo:female', female);
  return mob;
};

test('a World Alliance unit is rolled a woman or a man once, when it first appears, and only a grown woman is one of ours', () => {
  const sexes = new Set();
  for (let i = 0; i < 60; i++) {
    const mob = unit(0);
    emit(world.afterEvents.entitySpawn, { entity: mob });
    const sex = mob.getProperty('minepreggo:female');
    assert.ok(sex === 1 || sex === 2, 'rolled');
    sexes.add(sex);
    // rolled once: a later load keeps it
    emit(world.afterEvents.entityLoad, { entity: mob });
    assert.equal(mob.getProperty('minepreggo:female'), sex);
  }
  assert.deepEqual([...sexes].sort(), [1, 2], 'both women and men');

  assert.equal(familyOf(unit(2)), COMPAT_WOMAN);
  assert.equal(familyOf(unit(1)), undefined);
  assert.equal(familyOf(unit(0)), undefined);
  const grown = unit(2);
  grown.components['minecraft:is_baby'] = {};
  assert.equal(familyOf(grown), undefined, 'never a child');

  // a baby unit is never rolled a woman; its animals and vehicles (no property) are left alone
  const baby = unit(0);
  baby.components['minecraft:is_baby'] = {};
  emit(world.afterEvents.entitySpawn, { entity: baby });
  assert.equal(baby.getProperty('minepreggo:female'), 1);
  const cart = new Mob('worldbox:dwarf_coach', { families: ['mob'] });
  emit(world.afterEvents.entitySpawn, { entity: cart });
  assert.equal(cart.getProperty('minepreggo:female'), undefined);
});

test("Girl Mob's girls are women from the start (vanilla mob types), but never a baby, and a mob without the property is no one's", () => {
  const girl = new Mob('minecraft:zombie', { families: ['mob', 'zombie', 'minepreggo_preggo_mob'] });
  girl.properties.set('minepreggo:female', 2);
  assert.equal(familyOf(girl), COMPAT_WOMAN);
  emit(world.afterEvents.entitySpawn, { entity: girl });
  assert.equal(girl.getProperty('minepreggo:female'), 2, 'not rolled again');
  const baby = new Mob('minecraft:zombie', { families: ['mob', 'zombie'] });
  baby.properties.set('minepreggo:female', 2);
  baby.components['minecraft:is_baby'] = {};
  assert.equal(familyOf(baby), undefined);
  assert.equal(familyOf(new Mob('minecraft:skeleton', { families: ['mob'] })), undefined);
});
