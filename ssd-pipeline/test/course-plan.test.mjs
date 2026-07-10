import test from 'node:test';
import assert from 'node:assert/strict';
import { speedAt, speedSchedule, hexesInPlot, impulseTimeline, legalNextHexes, tryStep, setSpeedChange, legalSideslips, trySideslip } from '../viewer/course-plan.js';
import { neighbor } from '../viewer/movement.js';

test('C3.3: tryStep respects ship category — a category-D cruiser cannot turn as early as category B (speed 9, TM 3 vs 2)', () => {
  const pos = { q: 5, r: 5 }, facing = 0, speed = 9, hexesSinceTurn = 2, slipSince = 5;
  const turnHex = neighbor(pos.q, pos.r, 1);   // a +1-facing turn
  assert.ok(tryStep(pos, facing, speed, hexesSinceTurn, slipSince, turnHex, 'B'), 'category B (TM 2) may turn with 2 hexes since turn');
  assert.equal(tryStep(pos, facing, speed, hexesSinceTurn, slipSince, turnHex, 'D'), null, 'category D (TM 3) may NOT turn yet');
});

test('speedAt applies the 1-impulse announce delay (C12.36)', () => {
  const plot = { base: 8, changes: [{ announceImpulse: 9, speed: 18 }] };
  assert.equal(speedAt(plot, 9), 8, 'still base on the announce impulse');
  assert.equal(speedAt(plot, 10), 18, 'new speed the impulse after announcing');
  assert.equal(speedSchedule(plot).length, 32);
  assert.equal(speedSchedule(plot)[0], 8);
  assert.equal(speedSchedule(plot)[31], 18);
});

test('hexesInPlot matches the C12.10 worked example (Sp 8→18 on imp 9 = 15 hexes)', () => {
  const plot = { base: 8, changes: [{ announceImpulse: 9, speed: 18 }] };
  assert.equal(hexesInPlot(plot), 15, '2 hexes at Sp 8 (imp 1-9) + 13 at Sp 18 (imp 10-32)');
  assert.equal(hexesInPlot({ base: 8, changes: [] }), 8, 'constant speed = speed hexes');
});

test('impulseTimeline maps hex indices to the impulses they are reached', () => {
  const plot = { base: 8, changes: [{ announceImpulse: 9, speed: 18 }] };
  const tl = impulseTimeline(plot);
  assert.equal(tl.length, 15, 'one entry per move-impulse');
  assert.deepEqual(tl.find(t => t.hexIndex === 1), { impulse: 4, hexIndex: 1 });
  assert.deepEqual(tl.find(t => t.hexIndex === 2), { impulse: 8, hexIndex: 2 }, 'reached 2 hexes by imp 8 (C12.10)');
});

test('legalNextHexes: straight always legal, turns only at/after turn mode', () => {
  const pos = { q: 4, r: 4 };                 // even column
  const held = legalNextHexes(pos, 0, 8, 0);  // speed 8 turnMode 2, only 0 straight hexes so far
  assert.equal(held.find(c => c.facing === 0).legal, true, 'straight legal');
  assert.equal(held.filter(c => c.facing !== 0).every(c => !c.legal), true, 'turns illegal before turn mode');
  const ready = legalNextHexes(pos, 0, 8, 2);  // moved 2 straight → may turn
  assert.equal(ready.every(c => c.legal), true, 'all three legal once turn mode is met');
});

test('tryStep snaps to legal moves, tracks hexesSinceTurn and slip', () => {
  const straight = tryStep({ q: 4, r: 4 }, 0, 8, 2, 0, { q: 5, r: 4 });   // SE from even col = straight (facing 0)
  assert.ok(straight && straight.facing === 0 && straight.hexesSinceTurn === 3 && straight.slipSince === 1);
  const illegalTurn = tryStep({ q: 4, r: 4 }, 0, 8, 0, 0, { q: 4, r: 3 }); // a turn before turn mode
  assert.equal(illegalTurn, null, 'illegal turn rejected (snap)');
});

test('sideslip: blocked until one straight move, then moves oblique keeping facing (C4.1, C3.24)', () => {
  const pos = { q: 4, r: 4 };
  assert.equal(legalSideslips(pos, 0, 0).every(c => !c.legal), true, 'no sideslip before a straight move');
  assert.equal(legalSideslips(pos, 0, 1).every(c => c.legal), true, 'sideslip allowed after one straight move');
  const target = legalSideslips(pos, 0, 1)[0].hex;
  const slip = trySideslip(pos, 0, 3, 1, target);
  assert.equal(slip.facing, 0, 'facing unchanged on sideslip');
  assert.equal(slip.slipSince, 0, 'slip resets after a sideslip');
  assert.equal(slip.hexesSinceTurn, 4, 'sideslip counts as straight for turn mode (C3.24)');
  assert.equal(trySideslip(pos, 0, 3, 0, target), null, 'cannot sideslip with slip 0');
});

test('setSpeedChange places the announce impulse from the hex it is set at', () => {
  const plot = { base: 8, changes: [] };
  const tl = impulseTimeline(plot);                     // constant Sp 8
  const p2 = setSpeedChange(plot, tl, 2, 18);           // change speed at hex #2 (reached imp 8)
  assert.deepEqual(p2.changes, [{ announceImpulse: 8, speed: 18 }]);
  assert.equal(speedAt(p2, 8), 8); assert.equal(speedAt(p2, 9), 18);
});
