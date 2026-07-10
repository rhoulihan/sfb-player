import test from 'node:test';
import assert from 'node:assert/strict';
import { RACK_CAPACITY, DRONE_CATALOG, rackCapacity, droneSpaces, droneWarhead, droneWarheadVs, loadoutSpaces, spaceLeft, canFit, fillRack, makeRack, reloadStep, rackRate, rackMinGap, rackReadyToFire, noteRackFire } from '../viewer/drone-inventory.js';

test('droneWarhead delivers the loaded type warhead — Type-IV 24, not a fixed 12 (FD2.1)', () => {
  assert.equal(droneWarhead('Type-I'), 12);
  assert.equal(droneWarhead('Type-IV'), 24);
  assert.equal(droneWarhead('Type-VI'), 8, 'FD2.1 Drone Type Chart lists the type-VI warhead as 8 (was miscoded 6)');
  assert.equal(droneWarhead('unknown'), 12);
});

test('FD2.54: a dogfight (type-VI) drone does LIMITED damage by target size class — 2 vs ships, 4 vs SC5, 8 vs SC6', () => {
  assert.equal(droneWarheadVs('Type-VI', 3), 2, 'a cruiser (SC3) takes only 2 from a type-VI');
  assert.equal(droneWarheadVs('Type-VI', 4), 2, 'SC4 still 2');
  assert.equal(droneWarheadVs('Type-VI', 5), 4, 'SC5 (PF) takes 4');
  assert.equal(droneWarheadVs('Type-VI', 6), 8, 'SC6 (shuttle) takes the full 8');
  assert.equal(droneWarheadVs('Type-I', 3), 12, 'a normal drone is unaffected by target size class');
});

test('FD3.3/FD3.5: rack rate of fire — A/B fire 1/turn, C 2/turn (12-impulse gap), E 4/turn (8-impulse gap)', () => {
  assert.equal(rackRate('A'), 1); assert.equal(rackRate('B'), 1);
  assert.equal(rackRate('C'), 2, 'type-C rapid-fire: two drones per turn');
  assert.equal(rackRate('E'), 4, 'type-E: up to four dogfight drones per turn');
  assert.equal(rackMinGap('C'), 12, 'type-C drones cannot launch within 12 impulses of each other');
  assert.equal(rackMinGap('E'), 8, 'type-E: no two within 8 impulses');
  assert.equal(rackMinGap('A'), 8, 'FD3.1: a type-A rack cannot fire within 8 impulses of its previous shot');
});

test('rackReadyToFire enforces per-turn rate and the impulse gap (gap spans the turn boundary)', () => {
  const rackC = { type: 'C', loaded: ['Type-I', 'Type-I'] };
  assert.equal(rackReadyToFire(rackC, 1, 5), true, 'first shot is allowed');
  noteRackFire(rackC, 1, 5);
  assert.equal(rackReadyToFire(rackC, 1, 10), false, 'only 5 impulses later → under the 12-impulse gap');
  assert.equal(rackReadyToFire(rackC, 1, 17), true, '12 impulses later → second shot allowed');
  noteRackFire(rackC, 1, 17);
  assert.equal(rackReadyToFire(rackC, 1, 30), false, 'type-C is capped at 2 launches per turn');
  assert.equal(rackReadyToFire(rackC, 2, 1), true, 'the per-turn count resets next turn and the 12-impulse gap has cleared');
  const rackA = { type: 'A', loaded: ['Type-I'] };
  noteRackFire(rackA, 1, 28);
  assert.equal(rackReadyToFire(rackA, 2, 3), false, 'gap spans the boundary: impulse 28→next-turn 3 is 7 impulses (<8)');
  assert.equal(rackReadyToFire(rackA, 2, 4), true, 'impulse 28→next-turn 4 is 8 impulses (≥8)');
  const empty = { type: 'C', loaded: [] };
  assert.equal(rackReadyToFire(empty, 1, 5), false, 'an empty rack cannot fire');
});

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

test('makeRack magazine is in spaces; reloadStep loads at most 2 spaces per turn (FD2.421)', () => {
  const r = makeRack('A', 'Type-I', 2);
  assert.equal(r.capacity, 4);
  assert.equal(r.loaded.length, 4);
  assert.equal(r.reloadsLeft, 8, 'two reload sets × 4-space A-rack = an 8-space magazine');
  const spent = { ...r, loaded: [] };              // rack fired empty
  const re = reloadStep(spent, 'Type-I');
  assert.equal(loadoutSpaces(re.loaded), 2, 'only 2 spaces reload in a turn (rate cannot be increased)');
  assert.equal(re.reloadsLeft, 6, 'magazine drops by the 2 spaces loaded');
  const dry = reloadStep({ ...re, reloadsLeft: 0 }, 'Type-I');
  assert.equal(loadoutSpaces(dry.loaded), 2, 'no reload when the magazine is dry');
  assert.equal(dry.reloadsLeft, 0);
});

import { DRONE_SPEEDS } from '../viewer/drone-inventory.js';
test('full drone type/speed matrix: types by warhead/space + speed classes', () => {
  // types: light Type-VI (½ space) < Type-I (1) < heavy Type-IV (2 space, "two-space drone")
  assert.equal(droneSpaces('Type-VI'), 0.5);
  assert.equal(droneSpaces('Type-I'), 1);
  assert.equal(droneSpaces('Type-IV'), 2);
  assert.ok(DRONE_CATALOG['Type-IV'].warhead > DRONE_CATALOG['Type-I'].warhead, 'heavy hits harder');
  assert.ok(DRONE_CATALOG['Type-VI'].warhead < DRONE_CATALOG['Type-I'].warhead, 'light hits softer');
  assert.equal(DRONE_CATALOG['ADD'].spaces, 0.5);
  // speed classes by era/refit (FD): 8 / 12 / 20 / 32
  assert.deepEqual(DRONE_SPEEDS, [8, 12, 20, 32]);
});
