// Every mother's babies are her own, and every baby grows up into a grown child of her line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LINES, lineOf } from '../../packs/behavior/scripts/items/lines.js';
import { FAMILIES, COMPAT_WOMAN, birthItemOf } from '../../packs/behavior/scripts/mobs/families.js';

const item = (/** @type {string} */ id) => new URL(`../../packs/behavior/items/children/${id.replace('minepreggo:', '')}.json`, import.meta.url);

test('no mother outside our own kinds gives a plain human baby; her own baby item is in the pack', () => {
  for (const [id, family] of Object.entries(FAMILIES)) {
    if (!family.external || id.includes(':jenny') && !id.startsWith('minepreggo:') || family.eggItem) continue;
    if (['fapcraft', 'kum', 'jhallie4', 'jhbee24', 'jhkobold', 'jhelliedev'].includes(id.split(':')[0])) continue;
    assert.notEqual(family.babyItem, 'minepreggo:baby_human', id);
    assert.ok(existsSync(item(family.babyItem)), `${id}: ${family.babyItem}`);
  }
  assert.equal(birthItemOf(COMPAT_WOMAN, 'girlmob:zombie'), 'minepreggo:baby_girl_mob');
  assert.equal(birthItemOf(COMPAT_WOMAN, 'worldbox:human'), 'minepreggo:baby_world_alliance');
});

test('a baby grows up into its line: by its item, by its kind, else human; every line has a son and a daughter skin', () => {
  assert.ok(LINES.length <= 32, 'the line property holds 0..31');
  assert.equal(LINES[lineOf('minepreggo:baby_daisy')].item, 'daisy');
  assert.equal(LINES[lineOf('minepreggo:baby_humanoid_creeper')].item, 'creeper');
  assert.equal(LINES[lineOf('minepreggo:baby_humanoid_ender')].item, 'ender');
  assert.equal(lineOf('minepreggo:baby_jenny'), 0);
  const client = JSON.parse(readFileSync(new URL('../../packs/resource/entity/children/grown_child.entity.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(client['minecraft:client_entity'].description.textures).length, LINES.length * 2);
  const server = JSON.parse(readFileSync(new URL('../../packs/behavior/entities/children/grown_child.json', import.meta.url), 'utf8'))['minecraft:entity'];
  const families = server.components['minecraft:type_family'].family;
  assert.ok(!families.includes('minepreggo_preggo_mob') && !Object.keys(server.description.properties).some((p) => /phase|pregnan|growth|pose/.test(p)), 'a grown child is never pregnant');
});
