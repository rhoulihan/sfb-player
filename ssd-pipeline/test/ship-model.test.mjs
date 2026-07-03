import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShipModel } from '../viewer/ship-model.js';

const load = n => JSON.parse(readFileSync(new URL(`../data/FED-CA/${n}.json`, import.meta.url)));
const m = buildShipModel(load('verified'), load('detection'));

test('six shields with positive strength', () => {
  for (let s = 1; s <= 6; s++) assert.ok(m.shields[s] && m.shields[s].max > 0, `shield ${s}`);
});

test('warp split into left and right pools', () => {
  assert.ok(m.pools.L_WARP.boxIds.length > 0);
  assert.ok(m.pools.R_WARP.boxIds.length > 0);
});

test('hull pools exist (F and R)', () => {
  assert.ok(m.pools.F_HULL.boxIds.length > 0);
  assert.ok(m.pools.R_HULL.boxIds.length > 0);
});

test('phaser and torp (photon) pools exist', () => {
  assert.ok(m.pools.PHASER.boxIds.length > 0);
  assert.ok(m.pools.TORP.boxIds.length > 0);
});

test('crew and boarding are never-targets, not pools', () => {
  assert.ok(m.neverTargets.has('crew'));
  assert.ok(m.neverTargets.has('boarding-party'));
  assert.ok(!m.pools.CREW);
});

test('pool boxIds are ordered top-to-bottom, left-to-right (D4.33 track order)', () => {
  const s = m.pools.SENSOR;
  if (s && s.boxIds.length > 1) {
    const p = id => { const b = m.boxById[id]; return [b.y, b.x]; };
    for (let i = 1; i < s.boxIds.length; i++) {
      const [ay, ax] = p(s.boxIds[i - 1]), [by, bx] = p(s.boxIds[i]);
      assert.ok(ay < by || (ay === by && ax <= bx), 'ordered');
    }
  }
});
