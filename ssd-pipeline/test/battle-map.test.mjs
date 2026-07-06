import test from 'node:test';
import assert from 'node:assert/strict';
import { hexCenter } from '../viewer/battle-geom.js';
import { pixelToHex, plotCursor, courseOf, speedPlotOf, ensureSpeedPlot } from '../viewer/battle-map.js';

test('pixelToHex is the inverse of hexCenter (nearest-hex round-trip, tolerant of jitter)', () => {
  for (const [q, r] of [[4, 4], [7, 3], [10, 12], [0, 0], [5, 9]]) {
    const c = hexCenter(q, r);
    assert.deepEqual(pixelToHex(c.x, c.y), { q, r });
    assert.deepEqual(pixelToHex(c.x + 4, c.y - 4), { q, r }, 'small jitter still snaps to the same hex');
  }
});

test('courseOf lazily anchors a course at the ship position (idempotent)', () => {
  const s = { q: 5, r: 6, facing: 2 };
  const c = courseOf(s);
  assert.deepEqual(c.start, { q: 5, r: 6, facing: 2 });
  assert.equal(c.steps.length, 0);
  assert.equal(courseOf(s), c, 'same object on re-call');
});

test('speedPlotOf/ensureSpeedPlot take the base speed injected (no eafDraft coupling)', () => {
  assert.deepEqual(speedPlotOf({}, 8), { base: 8, changes: [] });
  const s = {};
  ensureSpeedPlot(s, 12);
  assert.deepEqual(s.speedPlot, { base: 12, changes: [] });
  // an existing plot wins over the injected base
  assert.deepEqual(speedPlotOf({ speedPlot: { base: 3, changes: [{ announceImpulse: 8, speed: 6 }] } }, 8).base, 3);
});

test('plotCursor tracks facing, hexes-since-turn, and slip along the course (base injected)', () => {
  const s = { q: 4, r: 4, facing: 0, course: { start: { q: 4, r: 4, facing: 0 }, steps: [
    { q: 5, r: 4, facing: 0 },              // straight
    { q: 6, r: 4, facing: 1 },              // turn
    { q: 6, r: 5, facing: 1, slip: true },  // sideslip (facing unchanged)
  ] } };
  const cur = plotCursor(s, 8);             // base speed 8 injected; turnMode(8)=2 seeds hst
  assert.deepEqual(cur.pos, { q: 6, r: 5 });
  assert.equal(cur.facing, 1);
  assert.equal(cur.hst, 2, 'hst: start 2 (TM8) → straight 3 → turn 1 → sideslip 2');
  assert.equal(cur.slip, 0, 'slip resets after a sideslip (C4.1)');
  assert.equal(cur.speed, 8);
});
