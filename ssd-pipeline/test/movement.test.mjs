import test from 'node:test';
import assert from 'node:assert/strict';
import { movesOnImpulse, neighbor, turnMode, turnModeFor, movesInTurn } from '../viewer/movement.js';

test('turnModeFor is category-aware: a category-D cruiser turns less often than category B (C3.31/C3.23)', () => {
  // Category D (Federation CA, Gorn CA): TM 3 at speed 9, TM 4 at speed 13 (the C3.23 worked example)
  assert.equal(turnModeFor('D', 1), 0);
  assert.equal(turnModeFor('D', 5), 2);
  assert.equal(turnModeFor('D', 9), 3);
  assert.equal(turnModeFor('D', 13), 4);
  assert.equal(turnModeFor('D', 25), 6);
  // Category B (Klingon D7) matches the legacy single curve
  assert.equal(turnModeFor('B', 9), 2);
  assert.equal(turnModeFor('B', 15), 3);
  assert.equal(turnMode(9), turnModeFor('B', 9), 'turnMode() defaults to category B');
  // the audit finding: at speed 9 a category-D ship must go straighter (TM 3) than category B (TM 2)
  assert.ok(turnModeFor('D', 9) > turnModeFor('B', 9));
});
import { localBearing } from '../viewer/battle-geom.js';

test('movesInTurn equals speed (even distribution over 32 impulses)', () => {
  for (const s of [1, 4, 7, 8, 15, 16, 24, 31, 32]) assert.equal(movesInTurn(s), s, `speed ${s}`);
});

test('movesOnImpulse: speed 32 moves every impulse; speed 0 never moves', () => {
  for (let i = 1; i <= 32; i++) assert.equal(movesOnImpulse(32, i), true);
  for (let i = 1; i <= 32; i++) assert.equal(movesOnImpulse(0, i), false);
});

test('neighbor steps exactly one hex in the facing direction (odd-q)', () => {
  assert.deepEqual(neighbor(4, 4, 4), { q: 4, r: 3 }, 'N from even column');
  assert.deepEqual(neighbor(4, 4, 1), { q: 4, r: 5 }, 'S');
  assert.deepEqual(neighbor(4, 4, 0), { q: 5, r: 4 }, 'SE from even column');
  assert.deepEqual(neighbor(5, 4, 0), { q: 6, r: 5 }, 'SE from odd column');
});

test('neighbor is dead-ahead per battle-geom (localBearing ≈ 0 for every facing)', () => {
  for (const q of [4, 5]) for (let f = 0; f < 6; f++) {
    const n = neighbor(q, 6, f);
    assert.ok(Math.abs(localBearing({ q, r: 6, facing: f }, { q: n.q, r: n.r })) < 1, `col ${q} facing ${f}`);
  }
});

test('turnMode rises with speed (0 at crawl, 6 at flank)', () => {
  assert.equal(turnMode(1), 0); assert.equal(turnMode(4), 1); assert.equal(turnMode(8), 2);
  assert.equal(turnMode(16), 4); assert.equal(turnMode(24), 5); assert.equal(turnMode(31), 6);
});
