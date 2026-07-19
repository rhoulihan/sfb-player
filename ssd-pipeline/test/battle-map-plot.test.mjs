import test from 'node:test';
import assert from 'node:assert/strict';
import { pathFrom } from '../viewer/battle-map.js';

// A minimal plot-ship: FED-CA-ish at (7,12) facing 0 (SE), speed 8, slip allowed (slipSince 1), turn satisfied.
const ship = (over = {}) => ({ q: 7, r: 12, facing: 0, turnCat: 'D', hexesSinceTurn: 2, slipSince: 1,
  course: { start: { q: 7, r: 12, facing: 0 }, steps: [] }, speedPlot: { base: 8, changes: [] }, ...over });
// facing 0 from (7,12): straight ahead = (8,13); the two sideslip hexes = (8,12) and (7,13)

test('DRAG NEVER TURNS: dragging to the oblique (sideslip) hex plots a sideslip, not a turn', () => {
  const steps = pathFrom(ship(), 8, [], { q: 8, r: 12 });
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0], { q: 8, r: 12, facing: 0, slip: true }, 'facing unchanged + slip flag — a sideslip (C4.1)');
});

test('offset drag with sideslip ILLEGAL does NOTHING (no turn fallback)', () => {
  const steps = pathFrom(ship({ slipSince: 0 }), 8, [], { q: 8, r: 12 });   // last move was a slip → cannot slip again yet
  assert.equal(steps.length, 0, 'the drag adds no step — it must not turn into the hex');
});

test('drag straight ahead is fine: a multi-hex straight drag plots straight steps only', () => {
  const steps = pathFrom(ship(), 8, [], { q: 9, r: 13 });   // two hexes dead ahead: (8,13) → (9,13)
  assert.equal(steps.length, 2);
  assert.ok(steps.every(st => st.facing === 0 && !st.slip), 'all straight, no turns, no slips');
  assert.deepEqual(steps.map(st => [st.q, st.r]), [[8, 13], [9, 13]]);
});

test('a target that would REQUIRE a turn is unreachable by drag — the route stops rather than turning', () => {
  const steps = pathFrom(ship(), 8, [], { q: 6, r: 12 });   // behind the ship
  assert.equal(steps.length, 0, 'no progress possible with straights+slips only → nothing plotted');
});

test('a diagonal drag weaves straights and sideslips (slip counter forces alternation), never turning', () => {
  const steps = pathFrom(ship(), 8, [], { q: 10, r: 12 });   // forward-right of the ship
  assert.ok(steps.length >= 2);
  assert.ok(steps.every(st => st.facing === 0), 'facing never changes on a drag');
  assert.ok(steps.some(st => st.slip), 'the offset is covered by sideslips');
  for (let i = 1; i < steps.length; i++) assert.ok(!(steps[i].slip && steps[i - 1].slip), 'C4.1: no two consecutive sideslips');
});
