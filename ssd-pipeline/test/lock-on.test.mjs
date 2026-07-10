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

test('D6.112: ECM does not break a lock — only cloak/terrain do (lockDeny is cloak-only)', () => {
  const firers = [{ id: 'F1' }];
  const targets = [{ id: 'E1', cloak: 0 }, { id: 'E2', cloak: 5 }];
  const rng = { d6: () => 6 };                       // worst possible roll
  const lockDeny = (f, t) => t.cloak || 0;           // cloak breaks the lock; ECM must NOT (D6.112)
  const locks = resolveLocks(firers, targets, rng, lockDeny);
  assert.ok(locks.F1.has('E1'), 'heavily-jammed but uncloaked target is still locked (EW only degrades effect)');
  assert.ok(!locks.F1.has('E2'), 'cloaked target denies the lock');
});

test('D6.11: lock roll must be ≤ the sensor rating — intact sensors auto-lock, a damaged track can fail', () => {
  for (let r = 1; r <= 6; r++) assert.equal(attemptLock(r, 0, 6), true, 'sensor rating 6 → any d6 locks (automatic)');
  assert.equal(attemptLock(5, 0, 4), false, 'sensor rating 4 → a roll of 5 fails to lock');
  assert.equal(attemptLock(4, 0, 4), true, 'sensor rating 4 → a roll of 4 locks');
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
