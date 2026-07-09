import test from 'node:test';
import assert from 'node:assert/strict';
import { RACK_CAPACITY, DRONE_CATALOG, rackCapacity, droneSpaces, loadoutSpaces, spaceLeft, canFit, fillRack, makeRack, reloadRack } from '../viewer/drone-inventory.js';

test('rackCapacity: spaces by rack type (Type-A 4, E 8, G 2, B 6)', () => {
  assert.equal(rackCapacity('A'), 4);
  assert.equal(rackCapacity('E'), 8);
  assert.equal(rackCapacity('G'), 2);
  assert.equal(rackCapacity('B'), 6);
  assert.equal(rackCapacity('???'), RACK_CAPACITY.A, 'unknown → Type-A default');
});

test('droneSpaces: standard 1, heavy (two-space) 2, ADD half', () => {
  assert.equal(droneSpaces('Type-I'), 1);
  assert.equal(droneSpaces('heavy'), 2);
  assert.equal(droneSpaces('ADD'), 0.5);
  assert.equal(droneSpaces('unknown'), 1, 'default 1 space');
  assert.ok(DRONE_CATALOG['Type-I'].warhead > 0);
});

test('loadoutSpaces + spaceLeft: space costs sum against capacity', () => {
  assert.equal(loadoutSpaces(['Type-I', 'Type-I', 'heavy']), 4);      // 1+1+2
  assert.equal(spaceLeft('A', ['Type-I', 'heavy']), 1);               // 4 - 3
  assert.equal(loadoutSpaces(['ADD', 'ADD', 'ADD', 'ADD']), 2);       // 4×0.5
});

test('canFit: a drone fits only within the remaining capacity', () => {
  assert.equal(canFit('A', ['Type-I', 'Type-I', 'Type-I'], 'Type-I'), true);   // 3 used +1 = 4 ok
  assert.equal(canFit('A', ['Type-I', 'Type-I', 'Type-I'], 'heavy'), false);   // 3 used +2 > 4
  assert.equal(canFit('G', [], 'heavy'), true);                                // type-G cap 2, +2 ok
  assert.equal(canFit('G', ['heavy'], 'Type-I'), false);                       // full
});

test('fillRack: fills a rack to capacity with one drone type', () => {
  assert.deepEqual(fillRack('A', 'Type-I'), ['Type-I', 'Type-I', 'Type-I', 'Type-I']);
  assert.equal(fillRack('A', 'ADD').length, 8, '4 spaces / 0.5 = 8 ADDs');
  assert.equal(fillRack('E', 'Type-I').length, 8);
  assert.equal(fillRack('A', 'heavy').length, 2, '4 spaces / 2 = 2 heavy drones');
});

test('makeRack + reloadRack: a rack carries reloads; reloading refills to capacity, one set at a time', () => {
  const r = makeRack('A', 'Type-I', 2);
  assert.equal(r.capacity, 4);
  assert.equal(r.loaded.length, 4);
  assert.equal(r.reloadsLeft, 2);
  const spent = { ...r, loaded: ['Type-I'] };      // fired 3
  const re = reloadRack(spent, 'Type-I');
  assert.equal(re.loaded.length, 4, 'refilled to capacity');
  assert.equal(re.reloadsLeft, 1, 'one reload consumed');
  const dry = reloadRack({ ...re, reloadsLeft: 0 }, 'Type-I');
  assert.equal(dry.loaded.length, 4, 'no reloads left → unchanged');
  assert.equal(dry.reloadsLeft, 0);
});
