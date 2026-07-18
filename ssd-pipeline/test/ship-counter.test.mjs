import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTER_CLASS, counterClassFor, counterAngle } from '../viewer/ship-counter.js';

test('COUNTER_CLASS maps every roster ship to one of the four hull classes', () => {
  // three Fed cruisers share one drawing; the Romulan KR flies a D7-family hull
  assert.equal(counterClassFor('FED-CA'), 'fed-cruiser');
  assert.equal(counterClassFor('FED-CL'), 'fed-cruiser');
  assert.equal(counterClassFor('FED-NCL'), 'fed-cruiser');
  assert.equal(counterClassFor('KLI-D7'), 'klingon-d7');
  assert.equal(counterClassFor('ROM-KR'), 'klingon-d7');
  assert.equal(counterClassFor('GOR-CA'), 'gorn-ca');
  assert.equal(counterClassFor('KZIN-CS'), 'kzinti-cs');
  assert.equal(new Set(Object.values(COUNTER_CLASS)).size, 4, 'exactly four hull classes');
});

test('counterClassFor returns null for an unknown ship (triggers the outline fallback)', () => {
  assert.equal(counterClassFor('THO-PC'), null);
  assert.equal(counterClassFor(''), null);
  assert.equal(counterClassFor(undefined), null);
});

test('counterAngle: art drawn forward=up rotates onto the map heading (facing 0=SE..5=NE, headingDeg=f*60+30)', () => {
  // SVG rotate() is clockwise in screen coords; up (270° in the atan2 frame) + angle must equal headingDeg
  assert.equal(counterAngle(4), 0, 'facing 4 = north → art points up unrotated');
  assert.equal(counterAngle(1), 180, 'facing 1 = south → art points down');
  assert.equal(counterAngle(0), 120, 'facing 0 (SE, heading 30°): 270+120 ≡ 30 (mod 360)');
  assert.equal(counterAngle(2), 240);
  assert.equal(counterAngle(3), 300, 'facing 3 (NW)');
  assert.equal(counterAngle(5), 60, 'facing 5 (NE)');
  assert.equal(counterAngle(7), counterAngle(1), 'facing wraps mod 6');
  for (let f = 0; f < 6; f++)
    assert.equal((270 + counterAngle(f)) % 360, (f * 60 + 30) % 360, `facing ${f}: rotated art forward lands on headingDeg`);
});

import { counterOutlineFromBoxes, fitPointsToBox, pointInPolygon } from '../viewer/ship-counter.js';

const rect = (x, y, w, h) => ({ x, y, w, h });
const bboxOf = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

test('pointInPolygon: inside/outside a square ring', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], sq), true);
  assert.equal(pointInPolygon([15, 5], sq), false);
  assert.equal(pointInPolygon([-1, -1], sq), false);
});

test('counterOutlineFromBoxes: a single box traces to its (padded) rectangle', () => {
  const pts = counterOutlineFromBoxes([rect(100, 100, 40, 40)], { cell: 5, pad: 5 });
  assert.ok(pts.length >= 4, 'a closed ring');
  assert.equal(pts.length, 4, 'an axis-aligned rectangle simplifies to its 4 corners');
  const b = bboxOf(pts);
  // padded by `pad` on every side, quantized to the cell grid
  assert.ok(Math.abs(b.x0 - 95) <= 5 && Math.abs(b.y0 - 95) <= 5, 'outline starts one pad before the box');
  assert.ok(Math.abs(b.x1 - 145) <= 5 && Math.abs(b.y1 - 145) <= 5, 'outline ends one pad after the box');
});

test('counterOutlineFromBoxes: a plus-shape stays CONCAVE — arm centers inside, bbox corners outside', () => {
  // five 20×20 boxes in a plus centered at (100,100)
  const boxes = [rect(90, 90, 20, 20), rect(90, 60, 20, 20), rect(90, 120, 20, 20), rect(60, 90, 20, 20), rect(120, 90, 20, 20)];
  const pts = counterOutlineFromBoxes(boxes, { cell: 5, pad: 2 });
  for (const b of boxes) assert.ok(pointInPolygon([b.x + b.w / 2, b.y + b.h / 2], pts), 'every box center is inside the outline');
  assert.equal(pointInPolygon([70, 70], pts), false, 'the notch corner is OUTSIDE — the outline is concave, not a hull');
  assert.equal(pointInPolygon([130, 130], pts), false, 'all four notches excluded');
});

test('counterOutlineFromBoxes: keeps only the largest cluster (drops detached off-ship tables)', () => {
  const ship = [rect(100, 100, 30, 30), rect(132, 100, 30, 30), rect(100, 132, 30, 30)];   // 3-box ship body
  const table = [rect(400, 400, 20, 20)];                                                  // far-away table
  const pts = counterOutlineFromBoxes([...ship, ...table], { cell: 5, pad: 3 });
  for (const b of ship) assert.ok(pointInPolygon([b.x + b.w / 2, b.y + b.h / 2], pts), 'ship boxes enclosed');
  assert.equal(pointInPolygon([410, 410], pts), false, 'the detached table is not part of the counter outline');
});

test('fitPointsToBox scales+centers points into a square, preserving aspect', () => {
  const tall = [[0, 0], [10, 0], [10, 40], [0, 40]];   // 10×40 shape
  const out = fitPointsToBox(tall, 64, 4);
  const b = bboxOf(out);
  assert.ok(b.x0 >= 4 - 1e-9 && b.y0 >= 4 - 1e-9 && b.x1 <= 60 + 1e-9 && b.y1 <= 60 + 1e-9, 'fits inside the padded square');
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  assert.ok(Math.abs(h - 56) < 1e-9, 'the long axis fills the padded box');
  assert.ok(Math.abs(w / h - 10 / 40) < 1e-9, 'aspect ratio preserved');
  assert.ok(Math.abs((b.x0 + b.x1) / 2 - 32) < 1e-9 && Math.abs((b.y0 + b.y1) / 2 - 32) < 1e-9, 'centered');
});

import { shipBodyBoxes, NON_BODY_FAMILIES } from '../viewer/ship-counter.js';
import fs from 'node:fs';

test('REAL DATA: the FED-CA fallback outline encloses the drawn ship body and excludes the off-ship tables', () => {
  const v = JSON.parse(fs.readFileSync('ssd-pipeline/data/FED-CA/verified.json'));
  const det = JSON.parse(fs.readFileSync('ssd-pipeline/data/FED-CA/detection.json'));
  const boxIndex = {}; det.boxes.forEach(b => (boxIndex[b.id] = b)); (v.extraBoxes || []).forEach(b => (boxIndex[b.id] = b));
  const boxes = shipBodyBoxes(v, boxIndex);
  assert.ok(boxes.length > 50, 'the Fed CA ship body has many boxes');
  assert.ok(NON_BODY_FAMILIES.has('shield') && NON_BODY_FAMILIES.has('crew'), 'shield rows and crew tables are never part of the body');
  const pts = counterOutlineFromBoxes(boxes);
  assert.ok(pts.length >= 8, 'a real ship outline is a non-trivial polygon');
  const centerOfFam = fam => { const g = v.groups.find(x => x.family === fam); const b = boxIndex[g.boxIds[0]]; return [b.x + b.w / 2, b.y + b.h / 2]; };
  assert.ok(pointInPolygon(centerOfFam('bridge'), pts), 'the bridge is inside the counter outline');
  assert.ok(pointInPolygon(centerOfFam('warp-engine'), pts), 'the warp engines are inside');
  assert.ok(pointInPolygon(centerOfFam('heavy-weapon'), pts), 'the photon tubes are inside');
  assert.equal(pointInPolygon(centerOfFam('crew'), pts), false, 'the crew-units table (far left of the page) is excluded');
  assert.equal(pointInPolygon(centerOfFam('sensor'), pts), false, 'the sensor track column is excluded');
  assert.equal(pointInPolygon(centerOfFam('shield'), pts), false, 'shield rows are excluded');
});

import { COUNTER_ART, COUNTER_VIEW } from '../viewer/ship-counter-art.js';

test('COUNTER_ART: one tintable forward=up drawing per hull class, on the shared square viewBox', () => {
  const classes = new Set(Object.values(COUNTER_CLASS));
  assert.deepEqual(new Set(Object.keys(COUNTER_ART)), classes, 'exactly the four hull classes, no extras');
  assert.equal(typeof COUNTER_VIEW, 'number');
  for (const [cls, art] of Object.entries(COUNTER_ART)) {
    assert.ok(art.length > 100, `${cls}: substantial drawing`);
    assert.ok(/currentColor/.test(art), `${cls}: tintable — strokes/fills use currentColor`);
    assert.ok(!/#[0-9a-fA-F]{3,6}|rgb\(/.test(art), `${cls}: no hard-coded colors (would defeat fleet tinting)`);
    assert.ok(!/<svg|<script|href=/.test(art), `${cls}: inner markup only — no nested <svg>, scripts, or external refs`);
  }
});

import { counterSvg } from '../viewer/ship-counter.js';

test('counterSvg: a rotating framed counter with the right content per source', () => {
  const base = { cx: 100, cy: 200, size: 38, angle: 120, frameFill: '#2563eb', frameStroke: '#173e8f', color: '#fff' };
  const art = counterSvg({ ...base, art: COUNTER_ART['fed-cruiser'] });
  assert.ok(art.includes('translate(100,200) rotate(120)'), 'whole counter (frame included) rotates about the hex center');
  assert.ok(art.includes('rect') && art.includes('#2563eb'), 'fleet-coloured square frame');
  assert.ok(art.includes('currentColor') && art.includes('color="#fff"'), 'hull drawing tinted via currentColor');
  const img = counterSvg({ ...base, imageHref: '../data/X/counter.png', art: COUNTER_ART['fed-cruiser'] });
  assert.ok(img.includes('<image') && img.includes('counter.png'), 'custom art wins over the class drawing');
  assert.ok(!img.includes('currentColor'), 'no drawing under the custom image');
  const poly = counterSvg({ ...base, outline: [[0, 0], [100, 0], [100, 300], [0, 300]] });
  assert.ok(/<path d="M[\d.]/.test(poly), 'fallback outline renders as a filled path');
  const none = counterSvg(base);
  assert.ok(none.includes('<path'), 'no source at all still renders a generic delta');
});
