import test from 'node:test';
import assert from 'node:assert/strict';
import { tractorCost, canTractor, tractorBroken, TRACTOR_MAX_RANGE } from '../viewer/tractor.js';

test('tractor cost is 1 point per beam at base range, ×range when extended (G7.15/G7.6)', () => {
  assert.equal(tractorCost(0), 1, 'same hex → 1');
  assert.equal(tractorCost(1), 1, 'adjacent → 1');
  assert.equal(tractorCost(2), 2, 'range 2 → double (G7.61)');
  assert.equal(tractorCost(3), 3, 'range 3 → triple (G7.62)');
});

test('a tractor reaches an adjacent/same hex, up to 3 hexes extended (G7.31/G7.6)', () => {
  assert.equal(TRACTOR_MAX_RANGE, 3);
  assert.equal(canTractor(0), true);
  assert.equal(canTractor(1), true);
  assert.equal(canTractor(3), true);
  assert.equal(canTractor(4), false, 'beyond 3 hexes → cannot tractor');
});

test('negative tractor breaks the link once it cancels all positive power (G7.352)', () => {
  assert.equal(tractorBroken(1, 1), true, 'equal negative cancels the beam');
  assert.equal(tractorBroken(2, 1), false, '1 negative vs 2 positive → holds');
  assert.equal(tractorBroken(2, 3), true, 'more negative than positive → breaks');
  assert.equal(tractorBroken(1, 0), false, 'no negative tractor → holds');
});
