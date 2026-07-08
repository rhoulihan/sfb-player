import test from 'node:test';
import assert from 'node:assert/strict';
import { hexLine, asteroidAt, blocksLoS, inBarrier, makeScenario } from '../viewer/terrain.js';

test('hexLine includes both endpoints and the hexes between', () => {
  const line = hexLine({ q: 0, r: 0 }, { q: 3, r: 0 });
  assert.deepEqual(line[0], { q: 0, r: 0 });
  assert.deepEqual(line[line.length - 1], { q: 3, r: 0 });
  assert.ok(line.length >= 4);
});

test('asteroidAt finds an asteroid hex', () => {
  const t = { asteroids: [{ q: 5, r: 5 }] };
  assert.equal(asteroidAt({ q: 5, r: 5 }, t), true);
  assert.equal(asteroidAt({ q: 5, r: 6 }, t), false);
});

test('an asteroid between two ships blocks LoS; a clear lane does not', () => {
  assert.equal(blocksLoS({ q: 0, r: 0 }, { q: 4, r: 0 }, { asteroids: [{ q: 2, r: 0 }] }), true, 'on the line → blocked');
  assert.equal(blocksLoS({ q: 0, r: 0 }, { q: 4, r: 0 }, { asteroids: [{ q: 2, r: 3 }] }), false, 'off the line → clear');
});

test('an asteroid AT an endpoint does not block (you can still fire from/at it)', () => {
  assert.equal(blocksLoS({ q: 0, r: 0 }, { q: 4, r: 0 }, { asteroids: [{ q: 0, r: 0 }] }), false);
  assert.equal(blocksLoS({ q: 0, r: 0 }, { q: 4, r: 0 }, { asteroids: [{ q: 4, r: 0 }] }), false);
});

test('inBarrier flags hexes outside the tournament playable area', () => {
  const t = { barrier: { minQ: 2, maxQ: 10, minR: 2, maxR: 10 } };
  assert.equal(inBarrier({ q: 5, r: 5 }, t), false);
  assert.equal(inBarrier({ q: 1, r: 5 }, t), true);
  assert.equal(inBarrier({ q: 5, r: 11 }, t), true);
});

test('makeScenario: open has no terrain; tournament insets a barrier + scatters asteroids', () => {
  const open = makeScenario('open', 42, 30);
  assert.equal(open.barrier, null);
  assert.deepEqual(open.asteroids, []);
  const tour = makeScenario('tournament', 42, 30);
  assert.ok(tour.barrier && tour.asteroids.length > 0);
  assert.ok(tour.barrier.minQ > 0 && tour.barrier.maxQ < 42, 'barrier is inset from the map edge');
});

import { applyLoSGate } from '../viewer/terrain.js';
test('applyLoSGate drops fire whose line of sight is blocked by an asteroid', () => {
  const byId = id => ({ F1: { q: 0, r: 0 }, E1: { q: 4, r: 0 } }[id]);
  const plan = { groups: [{ id: 'A', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['m'] }] }] };
  assert.equal(applyLoSGate(plan, byId, { asteroids: [{ q: 2, r: 0 }] }).groups.length, 0, 'blocked → no fire');
  assert.equal(applyLoSGate(plan, byId, { asteroids: [{ q: 2, r: 5 }] }).groups.length, 1, 'clear → fires');
});
