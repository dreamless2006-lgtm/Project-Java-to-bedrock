// A belly in her art style (tools/lib/belly-fit.mjs chestStyle): blocky for a girl of boxes, smooth for a rounded one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chestStyle } from '../lib/belly-fit.mjs';

test('her chest tells her art style: big boxes square to her body are cube, turned or small pieces round, none undefined', () => {
  const cube = { bones: [{ name: 'body' }, { name: 'Breasts', parent: 'body', cubes: [{ size: [8, 4, 3] }] }, { name: 'HelmetItemPivot', parent: 'body', cubes: [{ size: [1, 1, 1], rotation: [45, 0, 0] }] }] };
  assert.equal(chestStyle(cube), 'cube');
  // a little turn of the whole bust (Skelly's 15 degrees) is still a box
  assert.equal(chestStyle({ bones: [{ name: 'boobs', rotation: [15, 0, 0], cubes: [{ size: [4, 4, 4] }] }] }), 'cube');
  const round = { bones: [{ name: 'boobs', rotation: [-35, 0, 0], cubes: [{ size: [3, 3, 3] }] }, { name: 'boobL', parent: 'boobs', cubes: [{ size: [1, 3, 2] }] }] };
  assert.equal(chestStyle(round), 'round');
  assert.equal(chestStyle({ bones: [{ name: 'body', cubes: [{ size: [8, 12, 4] }] }] }), undefined);
});
