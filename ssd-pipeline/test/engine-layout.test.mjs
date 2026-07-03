import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGroup } from '../viewer/ssd-engine.js';

const box = (id, x, y) => ({ id, bbox: [x, y, 0.02, 0.02] });
const idx = arr => Object.fromEntries(arr.map(b => [b.id, b]));

test('layoutGroup de-overlaps overlapping/close boxes into distinct, evenly-spaced cells', () => {
  // a & b overlap (nearly same x); c sits a normal cell to the right
  const boxes = [box('a', 0.100, 0.10), box('b', 0.108, 0.10), box('c', 0.140, 0.10)];
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  const cx = id => snap[id].cx;
  assert.ok(cx('a') < cx('b') && cx('b') < cx('c'), 'each box gets a distinct, increasing column');
  assert.ok(Math.abs((cx('b') - cx('a')) - (cx('c') - cx('b'))) < 2, 'evenly spaced (one pitch apart)');
});

test('layoutGroup preserves a real gap (missing cell) in an even row', () => {
  // cells at columns 0,1,2,4,5 — column 3 is missing (pitch 0.03)
  const boxes = [box('a', 0.10, 0.10), box('b', 0.13, 0.10), box('c', 0.16, 0.10), box('d', 0.22, 0.10), box('e', 0.25, 0.10)];
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  const cx = id => snap[id].cx, pitch = cx('b') - cx('a');
  assert.equal(Math.round((cx('d') - cx('c')) / pitch), 2, 'the gap between c and d is preserved (2 pitches)');
});

test('layoutGroup aligns columns across rows (a 2-D grid lines up vertically)', () => {
  const boxes = [box('a', 0.100, 0.10), box('b', 0.130, 0.10), box('c', 0.160, 0.10),   // row 1
                 box('d', 0.102, 0.14), box('e', 0.132, 0.14), box('f', 0.158, 0.14)];   // row 2, slight jitter
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  assert.ok(Math.abs(snap.a.cx - snap.d.cx) < 2, 'column 0 lines up across rows');
  assert.ok(Math.abs(snap.b.cx - snap.e.cx) < 2, 'column 1 lines up across rows');
  assert.ok(Math.abs(snap.c.cx - snap.f.cx) < 2, 'column 2 lines up across rows');
  assert.ok(snap.a.cy < snap.d.cy, 'two distinct rows');
});

test('layoutGroup keeps well-separated clusters at their real positions (e.g. wing weapons)', () => {
  // two pairs far apart, like left/right wing disruptors — each pair tight, a big gap between
  const boxes = [box('l1', 0.10, 0.10), box('l2', 0.128, 0.10), box('r1', 0.60, 0.10), box('r2', 0.628, 0.10)];
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  assert.ok(Math.abs(snap.r1.cx - 610) < 5, 'the right cluster keeps its real position (no drift)');
  assert.ok(Math.abs(snap.r2.cx - 638) < 5, 'right cluster second box keeps its real position');
  assert.ok(snap.l1.cx < snap.l2.cx, 'the left pair is still de-overlapped');
});

test('layoutGroup keeps a lone offset box (own cluster) at its real position', () => {
  // a dense 2x2 grid plus one isolated box far above and horizontally offset (like a boom impulse box)
  const boxes = [box('a', 0.10, 0.20), box('b', 0.14, 0.20), box('c', 0.10, 0.24), box('d', 0.14, 0.24),
                 box('lone', 0.115, 0.05)];
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  const realCx = (0.115 + 0.01) * 1000;
  assert.ok(Math.abs(snap.lone.cx - realCx) < 3, 'the isolated box stays at its real x, not snapped to the grid');
});

test('layoutGroup leaves an already-neat row unchanged', () => {
  const boxes = [box('a', 0.10, 0.10), box('b', 0.13, 0.10), box('c', 0.16, 0.10), box('d', 0.19, 0.10)];
  const snap = layoutGroup(boxes.map(b => b.id), idx(boxes), 1000, 1000);
  const xs = ['a', 'b', 'c', 'd'].map(id => snap[id].cx);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs((xs[i] - xs[i - 1]) - (xs[1] - xs[0])) < 2, 'uniform spacing');
});
