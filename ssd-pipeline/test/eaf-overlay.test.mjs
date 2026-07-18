import test from 'node:test';
import assert from 'node:assert/strict';
import { ovDims, shieldOverlaySvg } from '../viewer/eaf-controls.js';

test('ovDims: stored overlay array → shape + dims with per-shape defaults', () => {
  assert.deepEqual(ovDims([10, 20]), { deg: undefined, len: 112, wid: 70, shape: 'hex' }, 'bare [x,y] → default Klingon-style hex, no explicit facing');
  assert.deepEqual(ovDims([10, 20, 60]), { deg: 60, len: 112, wid: 70, shape: 'hex' }, 'third element is the facing');
  assert.deepEqual(ovDims([10, 20, 60, 140, 90, 0]), { deg: 60, len: 140, wid: 90, shape: 'hex' }, 'explicit hex dims');
  assert.deepEqual(ovDims([10, 20, 0, 56, 154, 1]), { deg: 0, len: 56, wid: 154, shape: 'arc' }, 'shape 1 = arc (len = span°, wid = band thickness)');
  assert.deepEqual(ovDims([10, 20, 0, undefined, undefined, 1]).len, 56, 'arc default span');
});

test('shieldOverlaySvg: a hex item renders the elongated hexagon at its dims and facing', () => {
  const svg = shieldOverlaySvg([{ cx: 500, cy: 400, deg: 0, len: 100, wid: 50, shape: 'hex', t: 1, reinf: 0 }]);
  assert.ok(svg.includes('<svg class="shsvg"'), 'full overlay svg');
  assert.ok(svg.includes('M400 400'), 'deg 0 → long axis horizontal: left tip at cx−len');
  assert.ok(svg.includes('hsl(120'), 'full strength renders green');
  assert.ok(!svg.includes('shGlow") '), 'no glow paths when reinf 0');
});

test('shieldOverlaySvg: an arc item renders an annular sector curved about the ring centre', () => {
  // two markers opposite each other → centroid (1408,720); each at radius 408
  const mk = (cx, cy) => ({ cx, cy, deg: 0, len: 56, wid: 154, shape: 'arc', t: 0.5, reinf: 0 });
  const svg = shieldOverlaySvg([mk(1000, 720), mk(1816, 720)]);
  assert.ok(/A485/.test(svg), 'outer arc radius = 408 + 154/2 = 485');
  assert.ok(/A331/.test(svg), 'inner arc radius = 408 − 154/2 = 331');
  assert.ok(svg.includes('hsl(60'), 'half strength renders yellow-green');
});

test('shieldOverlaySvg: reinforcement adds a glow path scaled by points', () => {
  const svg = shieldOverlaySvg([{ cx: 500, cy: 400, deg: 90, len: 112, wid: 70, shape: 'hex', t: 1, reinf: 2 }]);
  assert.ok(svg.includes('filter="url(#shGlow)"'), 'glow filter applied');
  assert.ok(svg.includes('stroke-width="18"'), 'glow width 8 + 2×5');
});

test('shieldOverlaySvg interactive mode adds outline hit paths for click-resize', () => {
  const item = { cx: 500, cy: 400, deg: 0, len: 100, wid: 50, shape: 'hex', t: 1, reinf: 0, n: 3 };
  const svg = shieldOverlaySvg([item], { interactive: true });
  assert.ok(svg.includes('data-ovn="3"'), 'hit path tagged with its shield number');
  assert.ok(svg.includes('pointer-events="stroke"'), 'only the OUTLINE is grabbable');
  const plain = shieldOverlaySvg([item]);
  assert.ok(!plain.includes('data-ovn'), 'battle (non-interactive) render has no hit paths');
});
