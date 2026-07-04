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
