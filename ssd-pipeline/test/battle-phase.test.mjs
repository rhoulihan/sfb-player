import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCursor, advance, family, SEGMENTS, allCommitted, moveSatisfied, hasLockOn } from '../viewer/battle-phase.js';

// gates: the three player-input blocks the host computes from real game state before each advance
const mk = (phase, impulse = 0, gates = {}) =>
  ({ clock: { turn: 1, impulse, phase }, gates: { energyResolved: false, moveSatisfied: false, fireResolved: false, ...gates } });

test('SEGMENTS is the full SFB sequence in order (pre → impulse loop → post)', () => {
  const ids = SEGMENTS.map(s => s.id);
  assert.deepEqual(ids.slice(0, 5), ['energy', 'speed', 'self-destruct', 'lockon', 'initial']);
  assert.ok(ids.includes('6A2') && ids.includes('6C') && ids.includes('6D1') && ids.includes('6E'));
  assert.deepEqual(ids.slice(-2), ['final', 'record']);
});

test('nextCursor walks pre-impulse → impulse loop → post → next turn', () => {
  assert.deepEqual(nextCursor({ turn: 1, impulse: 0, phase: 'energy' }), { turn: 1, impulse: 0, phase: 'speed' });
  assert.deepEqual(nextCursor({ turn: 1, impulse: 0, phase: 'initial' }), { turn: 1, impulse: 1, phase: '6A1' });
  assert.deepEqual(nextCursor({ turn: 1, impulse: 1, phase: '6E' }), { turn: 1, impulse: 2, phase: '6A1' });
  assert.deepEqual(nextCursor({ turn: 1, impulse: 32, phase: '6E' }), { turn: 1, impulse: 32, phase: 'final' });
  assert.deepEqual(nextCursor({ turn: 1, impulse: 32, phase: 'record' }), { turn: 2, impulse: 0, phase: 'energy' });
});

test('advance rests at energy while unresolved (allocation), runs nothing', () => {
  const s = mk('energy');
  const r = advance(s);
  assert.equal(s.clock.phase, 'energy');
  assert.equal(r.blockedOn, 'energy');
  assert.deepEqual(r.ran, []);
});

test('advance auto-chains from resolved energy through the auto phases and blocks at free-movement', () => {
  const s = mk('energy', 0, { energyResolved: true });
  const r = advance(s);
  assert.equal(s.clock.phase, '6A2');
  assert.equal(s.clock.impulse, 1);
  assert.equal(r.blockedOn, '6A2');
  assert.ok(r.ran.includes('energy') && r.ran.includes('lockon') && r.ran.includes('6A1'));
});

test('advance from a satisfied 6A2 chains through 6B to the fire gate, skipping 6C off the eights', () => {
  const s = mk('6A2', 1, { moveSatisfied: true });
  const r = advance(s);
  assert.equal(s.clock.phase, '6D1');
  assert.equal(r.blockedOn, '6D1');
  assert.ok(r.ran.includes('6B1') && r.ran.includes('6B8'));
  assert.ok(!r.ran.includes('6C'), 'impulse 1 is not a multiple of 8');
});

test('6C runs only on impulses that are multiples of 8', () => {
  const s = mk('6A2', 8, { moveSatisfied: true });
  const r = advance(s);
  assert.ok(r.ran.includes('6C'), 'impulse 8 runs the dogfight segment');
});

test('advance from a committed 6D1 resolves fire and lands on the next impulse movement gate', () => {
  const s = mk('6D1', 1, { fireResolved: true });
  const r = advance(s);
  assert.equal(s.clock.impulse, 2);
  assert.equal(s.clock.phase, '6A2');
  assert.equal(r.blockedOn, '6A2');
  assert.ok(r.ran.includes('6D2') && r.ran.includes('6E'));
});

test('turn wrap: committing 6D1 on impulse 32 runs final/record and returns to energy', () => {
  const s = mk('6D1', 32, { fireResolved: true });
  const r = advance(s);
  assert.equal(s.clock.turn, 2);
  assert.equal(s.clock.phase, 'energy');
  assert.ok(r.ran.includes('final') && r.ran.includes('record'));
});

test('family() maps the fine segment cursor to the coarse energy/impulse fork', () => {
  assert.equal(family('energy'), 'energy');
  assert.equal(family('lockon'), 'energy');
  assert.equal(family('6A2'), 'impulse');
  assert.equal(family('6D1'), 'impulse');
});

test('allCommitted — the secret-simultaneous gate (energy lock & 6D1 fire)', () => {
  assert.equal(allCommitted({ friendly: true, enemy: true }, ['friendly', 'enemy']), true);
  assert.equal(allCommitted({ friendly: true }, ['friendly', 'enemy']), false);
  assert.equal(allCommitted({}, []), false, 'no fleets is not "all committed"');
});

test('moveSatisfied — every non-autopilot mover must have placed its hex (6A2 gate)', () => {
  const ships = [{ id: 'a', autopilot: false }, { id: 'b', autopilot: true }, { id: 'c', autopilot: false }];
  const moves = () => true;                        // all move this impulse
  const isAutopilot = s => s.autopilot;
  // a not placed → blocked
  assert.equal(moveSatisfied(ships, 4, { moves, isAutopilot, placed: s => s.id === 'c' }), false);
  // a & c placed (b is autopilot → auto-satisfied) → satisfied
  assert.equal(moveSatisfied(ships, 4, { moves, isAutopilot, placed: s => s.id === 'a' || s.id === 'c' }), true);
  // nobody moves this impulse → satisfied regardless of placement
  assert.equal(moveSatisfied(ships, 4, { moves: () => false, isAutopilot, placed: () => false }), true);
});

test('hasLockOn — fire eligibility gate (true = all, or a Set of target ids)', () => {
  assert.equal(hasLockOn({ a: true }, 'a', 'x'), true);
  assert.equal(hasLockOn({ a: new Set(['x']) }, 'a', 'x'), true);
  assert.equal(hasLockOn({ a: new Set(['y']) }, 'a', 'x'), false);
  assert.equal(hasLockOn({}, 'a', 'x'), false);
});

import { segmentName } from '../viewer/battle-phase.js';
test('segmentName gives a readable label for each sequence-of-play segment', () => {
  assert.equal(segmentName('energy'), 'Energy Allocation');
  assert.equal(segmentName('6A2'), 'Movement');
  assert.equal(segmentName('6D1'), 'Direct Fire');
  assert.equal(segmentName('6B3'), 'Seeking Weapons');
  assert.equal(segmentName('self-destruct'), 'Self-Destruct');
  assert.equal(segmentName('6E'), 'Post-Combat');
});
