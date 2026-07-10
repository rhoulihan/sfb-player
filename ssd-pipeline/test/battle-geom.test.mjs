import test from 'node:test';
import assert from 'node:assert/strict';
import { hexCenter, hexDistance, bearingDeg } from '../viewer/battle-geom.js';

test('hexCenter places odd columns half a row lower (flat-top, odd-q)', () => {
  const a = hexCenter(0, 0), b = hexCenter(2, 0);
  assert.ok(Math.abs(a.y - b.y) < 0.001, 'even columns share a row');
  assert.ok(hexCenter(1, 0).y > a.y, 'odd column is offset downward');
});

test('hexDistance is symmetric and true (same hex = range 0, C1.43)', () => {
  assert.equal(hexDistance({q:0,r:0},{q:0,r:0}), 0, 'co-located units are at true range 0 — the range-0 chart column is reachable');
  assert.equal(hexDistance({q:0,r:0},{q:3,r:0}), hexDistance({q:3,r:0},{q:0,r:0}));
  assert.ok(hexDistance({q:0,r:0},{q:3,r:0}) >= 3);
});

test('bearingDeg: a hex due east is ~0°, due south ~90° (screen y-down)', () => {
  assert.ok(Math.abs(bearingDeg({q:0,r:0},{q:2,r:0})) < 1, 'east ≈ 0°');
  const south = bearingDeg({q:0,r:0},{q:0,r:4});
  assert.ok(Math.abs(south - 90) < 1, 'south ≈ 90°');
});

test('hexDistance is exact hex range, not a Euclidean overestimate', () => {
  assert.equal(hexDistance({q:0,r:0},{q:0,r:4}), 4, 'straight down a column is 4, not 5');
  assert.equal(hexDistance({q:0,r:0},{q:3,r:0}), 3, 'three columns east is 3');
});

test('bearingDeg normalizes into [0,360): due north is ~270°', () => {
  const north = bearingDeg({q:0,r:0},{q:0,r:-4});
  assert.ok(Math.abs(north - 270) < 1, 'north ≈ 270°, not -90');
});

import { isInArc, exposedShield, localBearing } from '../viewer/battle-geom.js';

const ship = (q, r, facing) => ({ q, r, facing });
const mount = (...arcs) => ({ arc: { arcs } });

test('each facing points straight at an adjacent hex (edge/neighbour direction, not a corner)', () => {
  // even-column odd-q neighbour offsets in facing order 0..5 = SE, S, SW, NW, N, NE
  const nb = [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const base = { q: 4, r: 4 };
  for (let f = 0; f < 6; f++) {
    const firer = { ...base, facing: f };
    const tgt = ship(base.q + nb[f][0], base.r + nb[f][1], 0);
    assert.ok(Math.abs(localBearing(firer, tgt)) < 1, `facing ${f} aims dead-ahead at its forward neighbour`);
  }
});

test('a target dead ahead is in a front-hemisphere arc, not a rear arc', () => {
  const firer = ship(2, 5, 4);                  // facing 4 = North (straight up)
  const tgt = ship(2, 2, 4);                     // straight up the column → local bearing ~0°
  assert.ok(Math.abs(localBearing(firer, tgt)) < 1);
  assert.equal(isInArc(firer, mount('FH'), tgt).inArc, true, 'front hemisphere covers dead-ahead');
  assert.equal(isInArc(firer, mount('RA'), tgt).inArc, false, 'rear arc does not');
});

test('exposedShield: firer dead ahead of a target strikes shield #1 (front)', () => {
  const target = ship(2, 5, 4);                 // faces North
  const firer = ship(2, 2, 4);                  // north of target = its front
  assert.equal(exposedShield(firer, target), 1);
});

test('exposedShield: firer behind the target strikes shield #4 (rear)', () => {
  const target = ship(2, 5, 4);                 // faces North
  const firer = ship(2, 8, 4);                  // south of target = its rear
  assert.equal(exposedShield(firer, target), 4);
});
