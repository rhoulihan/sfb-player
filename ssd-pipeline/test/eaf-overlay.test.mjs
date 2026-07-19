import test from 'node:test';
import assert from 'node:assert/strict';
import { ovDims, shieldOverlaySvg } from '../viewer/eaf-controls.js';

test('ovDims: stored overlay array → shape + dims with per-shape defaults', () => {
  assert.deepEqual(ovDims([10, 20]), { deg: undefined, len: 112, wid: 70, shape: 'hex', taper: 0 }, 'bare [x,y] → default Klingon-style hex, no explicit facing');
  assert.deepEqual(ovDims([10, 20, 60]), { deg: 60, len: 112, wid: 70, shape: 'hex', taper: 0 }, 'third element is the facing');
  assert.deepEqual(ovDims([10, 20, 60, 140, 90, 0]), { deg: 60, len: 140, wid: 90, shape: 'hex', taper: 0 }, 'explicit hex dims');
  assert.deepEqual(ovDims([10, 20, 0, 56, 154, 1]), { deg: 0, len: 56, wid: 154, shape: 'arc', taper: 0 }, 'shape 1 = arc (len = span°, wid = band thickness)');
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

test('an arc honors its EXPLICIT facing: rotating deg swings the band around the marker in place', () => {
  const mk = deg => ({ cx: 1408, cy: 900, deg, len: 56, wid: 154, shape: 'arc', t: 1, reinf: 0 });
  const up = shieldOverlaySvg([mk(0)]), right = shieldOverlaySvg([mk(90)]), down = shieldOverlaySvg([mk(180)]);
  assert.ok(up !== right && right !== down && up !== down, 'each facing renders a different band');
  // deg 0 = band faces up → ring centre sits BELOW the marker → the outer arc reaches above cy=900
  const yNums = svg => [...svg.matchAll(/M(\d+) (\d+)/g)].map(m => +m[2]);
  assert.ok(yNums(up).some(y => y < 900), 'facing up: outer edge above the marker');
  assert.ok(yNums(down).some(y => y > 900), 'facing down: outer edge below the marker');
});

test('interactive mode adds a rotation grip per shape', () => {
  const item = { cx: 500, cy: 400, deg: 0, len: 100, wid: 50, shape: 'hex', t: 1, reinf: 0, n: 4 };
  const svg = shieldOverlaySvg([item], { interactive: true });
  assert.ok(svg.includes('data-ovrot="4"'), 'grip tagged with its shield number');
  const plain = shieldOverlaySvg([item]);
  assert.ok(!plain.includes('data-ovrot'), 'no grips in the battle render');
});

test('hex taper: the facing edge narrows/widens against the inner edge (irregular convex hexagon)', () => {
  const base = { cx: 500, cy: 400, deg: 0, len: 100, wid: 50, shape: 'hex', t: 1, reinf: 0 };
  const flat = shieldOverlaySvg([{ ...base }]);
  const tapered = shieldOverlaySvg([{ ...base, taper: 40 }]);   // +40%: outer (facing) edge narrower, inner wider
  assert.ok(flat !== tapered, 'taper changes the shape');
  // deg 0, facing up: outer edge is −y. taper 40 → outer half-width 50·0.6=30 (y=370), inner 50·1.4=70 (y=470)
  assert.ok(tapered.includes('370') && tapered.includes('470'), 'outer edge at cy−30, inner at cy+70');
  assert.ok(flat.includes('350') && flat.includes('450'), 'untapered edges at ±50');
});

test('ovDims: taper stored as the 7th element, default 0', () => {
  assert.equal(ovDims([10, 20, 0, 112, 70, 0]).taper, 0);
  assert.equal(ovDims([10, 20, 0, 112, 70, 0, 40]).taper, 40);
});

import { ctlParts, applyCtlParts } from '../viewer/eaf-controls.js';

const mockEl = (cls = '', children = []) => ({ classList: { contains: c => cls.split(' ').includes(c) }, children, style: {} });

test('ctlParts flattens a control into its parts in stable DOM order (rows/vsteps descended into)', () => {
  const lab = mockEl('lab'), minus = mockEl('stepbtn'), val = mockEl('val'), plus = mockEl('stepbtn');
  const node = mockEl('ctl', [lab, mockEl('row', [minus, val, plus])]);
  const parts = ctlParts(node);
  assert.equal(parts.length, 4, 'label + the three row children');
  assert.equal(parts[0], lab); assert.equal(parts[1], minus); assert.equal(parts[2], val); assert.equal(parts[3], plus);
});

test('applyCtlParts offsets only the customized parts, in art-% converted to px', () => {
  const lab = mockEl('lab'), btn = mockEl('stepbtn');
  const node = mockEl('ctl', [lab, mockEl('row', [btn])]);
  applyCtlParts(node, { p1: [10, 5] }, 700, 400);   // part index 1 = the button
  assert.equal(btn.style.left, '70px'); assert.equal(btn.style.top, '20px'); assert.equal(btn.style.position, 'relative');
  assert.equal(lab.style.left, undefined, 'uncustomized parts untouched');
  applyCtlParts(node, null, 700, 400);   // no offsets → no-op, no crash
});

import { applyCtlText } from '../viewer/eaf-controls.js';

test('applyCtlText overrides part text by index (custom labels), leaving others untouched', () => {
  const lab = { ...mockEl('lab'), textContent: 'GEN REINF' };
  const val = { ...mockEl('val'), textContent: '0' };
  const node = mockEl('ctl', [lab, mockEl('row', [val])]);
  applyCtlText(node, { p0: 'REINFORCE' });
  assert.equal(lab.textContent, 'REINFORCE');
  assert.equal(val.textContent, '0', 'non-overridden parts keep their text');
  applyCtlText(node, null);   // no overrides → no-op
  assert.equal(lab.textContent, 'REINFORCE');
});

test('shuttleCtl: one control set — inventory header, power summary, WW + SUI counters with arming status', async () => {
  const { shuttleCtl } = await import('../viewer/eaf-controls.js');
  const h = shuttleCtl(40, 90, { inv: 3, bays: 4, pw: 4, ww: 1, wwMax: 1, wwStat: '1/2', sui: 3, suiMax: 3, suiStat: '2/3' });
  assert.match(h, /SHUTTLES 3\/4/, 'inventory summary');
  assert.match(h, /⚡\s*4/, 'power allocation summary');
  assert.match(h, /data-key="wildWeasel"/, 'WW stepper bound to the column');
  assert.match(h, /data-key="suicide"/, 'suicide stepper bound to the column');
  assert.match(h, /1\/2/, 'weasel arming status');
  assert.match(h, /2\/3/, 'suicide arming status');
  // at max, the + buttons disable; at 0, the − buttons disable
  assert.equal((h.match(/data-d="1" disabled|data-d="1"[^>]*disabled/g) || []).length, 2, 'both + disabled at max');
  const h0 = shuttleCtl(40, 90, { inv: 0, bays: 4, pw: 0, ww: 0, wwMax: 0, wwStat: '', sui: 0, suiMax: 0, suiStat: '' });
  assert.match(h0, /SHUTTLES 0\/4/);
  assert.equal((h0.match(/data-d="-1"[^>]*disabled/g) || []).length, 2, 'both − disabled at 0');
  // launch buttons: one per row, disabled until the arming is complete and launch is legal
  assert.equal((h0.match(/data-ea="shlaunch"/g) || []).length, 2, 'a launch button on each row');
  assert.match(h0, /data-kind="ww"/); assert.match(h0, /data-kind="sui"/);
  assert.equal((h0.match(/data-ea="shlaunch"[^>]*disabled/g) || []).length, 2, 'both launches disabled when nothing is armed');
  const hl = shuttleCtl(40, 90, { inv: 2, bays: 4, pw: 0, ww: 0, wwMax: 1, wwStat: '✓', sui: 0, suiMax: 3, suiStat: '✓W18', wwLaunch: true, suiLaunch: true });
  assert.equal((hl.match(/data-ea="shlaunch"[^>]*disabled/g) || []).length, 0, 'armed + legal → both launches enabled');
});
