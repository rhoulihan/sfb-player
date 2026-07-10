import test from 'node:test';
import assert from 'node:assert/strict';
import { MINE, mineTriggeredBy, hitAndRunSucceeds } from '../viewer/mines.js';

test('MINE has a warhead and a trigger radius', () => {
  assert.ok(MINE.warhead > 0 && MINE.radius >= 1);
});

test('a mine triggers on the nearest enemy inside its radius', () => {
  const mine = { q: 5, r: 5, side: 'friendly', radius: 1, warhead: 20 };
  const ships = [{ id: 'E1', side: 'enemy', q: 5, r: 5 }, { id: 'E2', side: 'enemy', q: 15, r: 5 }];
  assert.equal(mineTriggeredBy(mine, ships).id, 'E1');
});

test("a mine ignores its own fleet", () => {
  const mine = { q: 5, r: 5, side: 'friendly', radius: 1 };
  assert.equal(mineTriggeredBy(mine, [{ id: 'F1', side: 'friendly', q: 5, r: 5 }]), null);
});

test('a ship outside the radius does not trigger the mine', () => {
  const mine = { q: 5, r: 5, side: 'friendly', radius: 1 };
  assert.equal(mineTriggeredBy(mine, [{ id: 'E1', side: 'enemy', q: 10, r: 5 }]), null);
});

test('an adjacent enemy (radius 1) triggers the mine', () => {
  const mine = { q: 5, r: 5, side: 'friendly', radius: 1 };
  assert.ok(mineTriggeredBy(mine, [{ id: 'E1', side: 'enemy', q: 6, r: 5 }]));
});

test('hit-and-run raid succeeds on 4+', () => {
  assert.equal(hitAndRunSucceeds(6), true);
  assert.equal(hitAndRunSucceeds(4), true);
  assert.equal(hitAndRunSucceeds(3), false);
});

import { SELF_DESTRUCT, selfDestructHits, selfDestructDamage, selfDestructZone } from '../viewer/mines.js';
test('D5.41: blast zone by BES — radius 1 if BES≥10, same hex only if BES≤9', () => {
  assert.equal(selfDestructZone(30), 1, 'BES 30 → the hex plus the six around it (radius 1)');
  assert.equal(selfDestructZone(10), 1, 'BES 10 → radius 1');
  assert.equal(selfDestructZone(9), 0, 'BES 9 → the exploding hex only');
  const ship = { id: 'F1', q: 5, r: 5 };
  const ships = [ship, { id: 'E1', q: 5, r: 5 }, { id: 'F2', q: 6, r: 5 }, { id: 'E2', q: 7, r: 5 }];
  const r1 = selfDestructHits(ship, ships, selfDestructZone(30)).map(s => s.id);
  assert.ok(r1.includes('E1') && r1.includes('F2'), 'radius 1 catches the hex + adjacent (friend + foe)');
  assert.ok(!r1.includes('F1') && !r1.includes('E2'), 'not itself, not 2 hexes away');
  const r0 = selfDestructHits(ship, ships, selfDestructZone(9)).map(s => s.id);
  assert.deepEqual(r0, ['E1'], 'BES≤9 hits only same-hex units');
});
test('D5.41: every unit in the zone takes the FULL BES on its facing shield (no distance falloff)', () => {
  assert.equal(selfDestructDamage(30), 30, 'full BES at range 0');
  assert.equal(selfDestructDamage(30, 1), 30, 'full BES at range 1 too — no falloff');
  assert.ok(selfDestructDamage(20) === 20 && selfDestructDamage(0) === 0);
});

import { NUCLEAR_MINE, transporterTarget, TRANSPORTER_RANGE, TBOMB_WARHEAD } from '../viewer/mines.js';
test('transporter bomb yields ten damage points (M3.0)', () => { assert.equal(TBOMB_WARHEAD, 10); });
test('NUCLEAR_MINE hits harder and wider than a standard mine', () => {
  assert.ok(NUCLEAR_MINE.warhead > MINE.warhead, 'bigger warhead');
  assert.ok(NUCLEAR_MINE.radius >= MINE.radius, 'at least as wide');
});
test('transporterTarget finds an adjacent enemy (transporter bomb), else null', () => {
  const ship = { q: 5, r: 5, side: 'friendly' };
  assert.equal(transporterTarget(ship, [{ id: 'E1', side: 'enemy', q: 6, r: 5 }]).id, 'E1');
  assert.equal(transporterTarget(ship, [{ id: 'E2', side: 'enemy', q: 12, r: 5 }]), null, 'out of transporter range');
  assert.equal(transporterTarget(ship, [{ id: 'F2', side: 'friendly', q: 6, r: 5 }]), null, 'not an ally');
  assert.ok(TRANSPORTER_RANGE >= 1);
});
