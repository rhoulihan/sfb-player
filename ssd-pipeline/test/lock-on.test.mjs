import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptLock, resolveLocks, applyLockGate } from '../viewer/lock-on.js';

test('lock succeeds at base (no EW): any 1d6 clears', () => {
  for (let r = 1; r <= 6; r++) assert.equal(attemptLock(r, 0), true, `roll ${r} should lock at netEcm 0`);
});

test('net ECM raises the bar; a high roll can miss the lock', () => {
  assert.equal(attemptLock(6, 1), false);   // 6 + 1 > 6
  assert.equal(attemptLock(5, 1), true);
  assert.equal(attemptLock(3, 3), true);     // 3 + 3 = 6
  assert.equal(attemptLock(4, 3), false);    // 4 + 3 > 6
});

test('negative net ECM is treated as zero', () => {
  assert.equal(attemptLock(6, -4), true);
});

test('resolveLocks locks every enemy at base and never itself', () => {
  const rng = { d6: () => 4 };
  const locks = resolveLocks([{ id: 'F1' }], [{ id: 'E1' }, { id: 'E2' }], rng, () => 0);
  assert.deepEqual([...locks.F1].sort(), ['E1', 'E2']);
});

test('heavy net ECM denies the lock', () => {
  const rng = { d6: () => 6 };
  const locks = resolveLocks([{ id: 'F1' }], [{ id: 'E1' }], rng, () => 6);   // 6 + 6 > 6
  assert.equal(locks.F1.size, 0);
});

test('applyLockGate drops fire at unlocked targets, keeps locked ones', () => {
  const plan = { groups: [{ id: 'A', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['m'] }] }] };
  assert.equal(applyLockGate(plan, { F1: new Set(['E1']) }).groups.length, 1, 'locked → fires');
  assert.equal(applyLockGate(plan, { F1: new Set() }).groups.length, 0, 'no lock → no fire');
  assert.equal(applyLockGate(plan, { F1: true }).groups.length, 1, 'true = locked to all');
});
