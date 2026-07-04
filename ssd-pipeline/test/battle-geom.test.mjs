import test from 'node:test';
import assert from 'node:assert/strict';
import { hexCenter, hexDistance, bearingDeg } from '../viewer/battle-geom.js';

test('hexCenter places odd columns half a row lower (flat-top, odd-q)', () => {
  const a = hexCenter(0, 0), b = hexCenter(2, 0);
  assert.ok(Math.abs(a.y - b.y) < 0.001, 'even columns share a row');
  assert.ok(hexCenter(1, 0).y > a.y, 'odd column is offset downward');
});

test('hexDistance is symmetric and at least 1', () => {
  assert.equal(hexDistance({q:0,r:0},{q:0,r:0}), 1, 'same hex clamps to 1');
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

test('a target dead ahead is in a front-hemisphere arc, not a rear arc', () => {
  const firer = ship(0, 0, 0);                 // facing 0 = heading 0° = east
  const tgt = ship(2, 0, 0);                    // due east (even column, no odd-q offset) → local bearing ~0°
  assert.ok(Math.abs(localBearing(firer, tgt)) < 1);
  assert.equal(isInArc(firer, mount('FH'), tgt).inArc, true, 'front hemisphere covers dead-ahead');
  assert.equal(isInArc(firer, mount('RA'), tgt).inArc, false, 'rear arc does not');
});

test('exposedShield: firer dead ahead of a target strikes shield #1 (front)', () => {
  const target = ship(0, 0, 0);                 // target faces east
  const firer = ship(3, 0, 0);                  // firer is to the target's east = its front
  assert.equal(exposedShield(firer, target), 1);
});

test('exposedShield: firer behind the target strikes shield #4 (rear)', () => {
  const target = ship(3, 0, 0);                 // faces east
  const firer = ship(0, 0, 0);                  // firer is to the west = target rear
  assert.equal(exposedShield(firer, target), 4);
});
