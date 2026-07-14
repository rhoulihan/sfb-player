import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBearsToShield, shieldBearing, arcCoversBearing } from '../viewer/arc-geom.js';

const A = arcs => ({ arcs, paintAdd: [], paintRemove: [] });

test('D2.34: LP/FP/RP plasma swivel arcs are the front hemisphere rotated ±60° (not the side hemispheres)', () => {
  // bearings: 0 = forward, 90 = right/starboard, 180 = aft, 270 = left/port (clockwise).
  // FP/FH: front 180° centered on 0°.  RP: rotated 60° right → centered 60°, covers [330°..150°].
  // LP: rotated 60° left → centered 300°, covers [210°..30°].
  assert.ok(arcCoversBearing('FH', 0) && arcCoversBearing('RP', 0) && arcCoversBearing('LP', 0), 'dead ahead is inside all three front plasma arcs');
  // a target directly to starboard (90°): the RIGHT plasma bears, the LEFT does not
  assert.equal(arcCoversBearing('RP', 90), true,  'right plasma covers a starboard target');
  assert.equal(arcCoversBearing('LP', 90), false, 'left plasma does not reach far starboard');
  // a target directly to port (270°): the LEFT plasma bears, the RIGHT does not
  assert.equal(arcCoversBearing('LP', 270), true,  'left plasma covers a port target');
  assert.equal(arcCoversBearing('RP', 270), false, 'right plasma does not reach far port');
  // RP edges = [330, 150]
  assert.equal(arcCoversBearing('RP', 150), true);  assert.equal(arcCoversBearing('RP', 160), false);
  assert.equal(arcCoversBearing('RP', 330), true);  assert.equal(arcCoversBearing('RP', 320), false);
  // LP edges = [210, 30]
  assert.equal(arcCoversBearing('LP', 210), true);  assert.equal(arcCoversBearing('LP', 200), false);
  assert.equal(arcCoversBearing('LP', 30),  true);  assert.equal(arcCoversBearing('LP', 40),  false);
  // directly aft (180°) is outside every front-oriented plasma arc
  assert.ok(!arcCoversBearing('FH', 180) && !arcCoversBearing('LP', 180) && !arcCoversBearing('RP', 180), 'aft is outside the front plasma arcs');
});

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
