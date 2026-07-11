import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBearsToShield, shieldBearing } from '../viewer/arc-geom.js';

const A = arcs => ({ arcs, paintAdd: [], paintRemove: [] });

test('shield bearings: #1 front, #4 rear', () => {
  assert.equal(shieldBearing(1), 0);
  assert.equal(shieldBearing(4), 180);
});

test('FA (front) bears to shield 1, not shield 4', () => {
  assert.equal(arcBearsToShield(A(['FA']), 1), true);
  assert.equal(arcBearsToShield(A(['FA']), 4), false);
});

test('RH (rear hemisphere) bears to shield 4, not shield 1', () => {
  assert.equal(arcBearsToShield(A(['RH']), 4), true);
  assert.equal(arcBearsToShield(A(['RH']), 1), false);
});

test('360 (all six base arcs) bears to every shield', () => {
  const all = A(['RF', 'R', 'RR', 'LR', 'L', 'LF']);
  for (let s = 1; s <= 6; s++) assert.equal(arcBearsToShield(all, s), true);
});

test('a right-side arc (RS) bears to shield 2/3, not 5/6', () => {
  assert.equal(arcBearsToShield(A(['RS']), 2), true);
  assert.equal(arcBearsToShield(A(['RS']), 3), true);
  assert.equal(arcBearsToShield(A(['RS']), 5), false);
  assert.equal(arcBearsToShield(A(['RS']), 6), false);
});

test('D4.321: arcBearsToShield honors paintAdd hex exceptions — a rear hex painted into a forward arc bears to the rear shield', () => {
  const forwardOnly = { arcs: ['FA'], paintAdd: [], paintRemove: [] };
  assert.equal(arcBearsToShield(forwardOnly, 4), false, 'a forward arc does not bear to the rear shield');
  const extended = { arcs: ['FA'], paintAdd: [[0, 2]], paintRemove: [] };   // hex offset (0,2) bears due-rear (180°)
  assert.equal(arcBearsToShield(extended, 4), true, 'D4.321: the paintAdd exception extends the arc onto the rear shield');
  assert.equal(arcBearsToShield(extended, 1), true, 'still bears to the front shield via the named arc');
});
