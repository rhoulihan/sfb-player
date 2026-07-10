import test from 'node:test';
import assert from 'node:assert/strict';
import { hexLine, asteroidAt, asteroidEcm, inBarrier, makeScenario } from '../viewer/terrain.js';

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

test('P3.33: asteroids do NOT block fire — each asteroid hex on the line (endpoints included) gives the target 1 ECM', () => {
  // a vertical run (same q) so the intermediate line hexes are exactly (0,1),(0,2),(0,3)
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [{ q: 0, r: 2 }] }), 1, 'one asteroid on the line → 1 ECM');
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [{ q: 3, r: 2 }] }), 0, 'off the line → 0 ECM');
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [{ q: 0, r: 1 }, { q: 0, r: 2 }, { q: 0, r: 3 }] }), 3, 'three on the line → 3 ECM');
});

test('P3.33: asteroids at the firing or target hex still count for ECM (including both endpoints)', () => {
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [{ q: 0, r: 0 }] }), 1, 'firing unit hex counts');
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [{ q: 0, r: 4 }] }), 1, 'target hex counts');
  assert.equal(asteroidEcm({ q: 5, r: 5 }, { q: 5, r: 5 }, { asteroids: [{ q: 5, r: 5 }] }), 1, 'same hex → 1');
  assert.equal(asteroidEcm({ q: 0, r: 0 }, { q: 0, r: 4 }, { asteroids: [] }), 0, 'no asteroids → 0');
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

