import test from 'node:test';
import assert from 'node:assert/strict';
import { SHUTTLE_HP, ADVANCED_BONUS, shuttleMaxHp, makeShuttle, damageShuttle, shuttleDestroyed } from '../viewer/shuttle-inventory.js';

test('shuttleMaxHp: base HP by kind, +2 for advanced shuttles (J17)', () => {
  assert.equal(shuttleMaxHp('admin', false), 6);
  assert.equal(shuttleMaxHp('admin', true), 6 + ADVANCED_BONUS);   // 8
  assert.equal(shuttleMaxHp('heavy', false), 8);
  assert.equal(shuttleMaxHp('heavy', true), 10);
  assert.equal(shuttleMaxHp(), SHUTTLE_HP.admin, 'defaults to a regular admin shuttle');
});

test('makeShuttle starts at full HP for its kind/advanced state', () => {
  const s = makeShuttle('sh1', 'admin', false);
  assert.equal(s.hp, 6);
  assert.equal(s.maxHp, 6);
  assert.equal(s.kind, 'admin');
  assert.equal(makeShuttle('sh2', 'heavy', true).hp, 10);
});

test('damageShuttle reduces HP (floored at 0); shuttleDestroyed at 0', () => {
  let s = makeShuttle('sh1', 'admin', true);   // 8 HP
  s = damageShuttle(s, 3);
  assert.equal(s.hp, 5);
  assert.equal(shuttleDestroyed(s), false);
  s = damageShuttle(s, 99);
  assert.equal(s.hp, 0);
  assert.equal(shuttleDestroyed(s), true);
});

test('damageShuttle ignores non-positive points', () => {
  const s = makeShuttle('sh1', 'admin', false);
  assert.equal(damageShuttle(s, 0).hp, 6);
  assert.equal(damageShuttle(s, -4).hp, 6);
});
