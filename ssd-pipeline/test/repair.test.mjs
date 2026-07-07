import test from 'node:test';
import assert from 'node:assert/strict';
import { repairBoxes } from '../viewer/repair.js';

test('repairs up to `points` destroyed boxes', () => {
  const r = repairBoxes(['a', 'b', 'c'], 2);
  assert.equal(r.repaired.length, 2);
  assert.equal(r.remaining.length, 1);
});

test('points exceeding damage repairs everything', () => {
  const r = repairBoxes(['a', 'b'], 5);
  assert.deepEqual(r.repaired.sort(), ['a', 'b']);
  assert.deepEqual(r.remaining, []);
});

test('zero points repairs nothing', () => {
  const r = repairBoxes(['a', 'b'], 0);
  assert.deepEqual(r.repaired, []);
  assert.deepEqual(r.remaining.sort(), ['a', 'b']);
});

test('nothing destroyed → nothing to do', () => {
  const r = repairBoxes([], 3);
  assert.deepEqual(r.repaired, []);
  assert.deepEqual(r.remaining, []);
});

test('priority order is repaired first (player/importance ordering, D9.7)', () => {
  const r = repairBoxes(['a', 'b', 'c'], 1, { priority: ['c', 'b'] });
  assert.deepEqual(r.repaired, ['c']);
});

test('non-repairable boxes are never restored (excess / damcon track, D9.76)', () => {
  const r = repairBoxes(['a', 'excess1', 'b'], 5, { repairable: id => !id.startsWith('excess') });
  assert.ok(!r.repaired.includes('excess1'), 'excess box stays destroyed');
  assert.deepEqual(r.repaired.sort(), ['a', 'b']);
  assert.deepEqual(r.remaining, ['excess1']);
});
