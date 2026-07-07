import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../viewer/rng.js';

test('same seed produces the same sequence (deterministic)', () => {
  const a = makeRng(12345), b = makeRng(12345);
  const seqA = Array.from({ length: 12 }, () => a.roll(6));
  const seqB = Array.from({ length: 12 }, () => b.roll(6));
  assert.deepEqual(seqA, seqB);
});

test('different seeds produce different sequences', () => {
  const a = makeRng(1), b = makeRng(2);
  const seqA = Array.from({ length: 12 }, () => a.d6());
  const seqB = Array.from({ length: 12 }, () => b.d6());
  assert.notDeepEqual(seqA, seqB);
});

test('d6 stays within 1..6', () => {
  const r = makeRng(7);
  for (let i = 0; i < 2000; i++) { const v = r.d6(); assert.ok(v >= 1 && v <= 6, `d6 out of range: ${v}`); }
});

test('roll(sides) stays within 1..sides', () => {
  const r = makeRng(3);
  for (let i = 0; i < 2000; i++) { const v = r.roll(20); assert.ok(v >= 1 && v <= 20, `roll out of range: ${v}`); }
});

test('cursor advances one per draw', () => {
  const r = makeRng(999);
  assert.equal(r.cursor(), 0);
  r.roll(6); r.roll(6); r.roll(6);
  assert.equal(r.cursor(), 3);
});

test('reconstructs mid-stream from (seed, cursor) — resume is exact', () => {
  const r = makeRng(999);
  const drawn = [r.roll(6), r.roll(6), r.roll(6)];   // consume 3
  const resumed = makeRng(999, r.cursor());          // rebuild at cursor 3
  assert.equal(resumed.roll(6), r.roll(6), 'the 4th draw matches on both');
  // and a fresh generator replayed to the same cursor yields the same first three
  const replay = makeRng(999);
  assert.deepEqual([replay.roll(6), replay.roll(6), replay.roll(6)], drawn);
});

test('2d6 is a fair-ish spread across 2..12 (finalizer mixes, no obvious bias)', () => {
  const r = makeRng(42), counts = {};
  for (let i = 0; i < 6000; i++) { const v = r.d6() + r.d6(); counts[v] = (counts[v] || 0) + 1; }
  for (let v = 2; v <= 12; v++) assert.ok(counts[v] > 0, `2d6 never produced ${v}`);
  assert.ok(counts[7] > counts[2], '7 should occur more than 2 over many rolls');
});
