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
