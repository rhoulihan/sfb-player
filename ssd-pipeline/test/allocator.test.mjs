import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShipModel } from '../viewer/ship-model.js';
import { applyVolley } from '../viewer/dac-allocator.js';

const load = (s, n) => JSON.parse(readFileSync(new URL(`../data/${s}/${n}.json`, import.meta.url)));
const seqRoll = arr => { let i = 0; return () => arr[i++]; };            // scripted 2d6 totals

// A synthetic Klingon D7 matching the D4.5 worked example's systems + counts:
//  forward hull = 4 (runs out at hit 8), batteries = 3 (last at hit 22), no cargo, no center warp,
//  phasers bear forward (struck through shield #1), flag hits fall through to security.
function buildD7Model() {
  let idc = 0;
  const pool = n => ({ boxIds: Array.from({ length: n }, () => 'b' + idc++), destroyed: new Set() });
  const groupOf = {};
  const phaser = pool(4);
  const phGroup = { type: 'Phaser-1', arcDef: { arcs: ['FA'], paintAdd: [], paintRemove: [] } };
  phaser.boxIds.forEach(id => (groupOf[id] = phGroup));
  const pools = {
    F_HULL: pool(4), R_HULL: pool(5), L_WARP: pool(3), R_WARP: pool(3), BRIDGE: pool(1),
    PHASER: phaser, BATT: pool(3), IMPULSE: pool(4), DRONE: pool(1), TORP: pool(1),
    TRANS: pool(2), TRAC: pool(1), AUX: pool(1), SEC: pool(2), LAB: pool(2), SHUTTLE: pool(1),
  };
  return { shields: { 1: { boxIds: [], max: 0, down: 0 } }, armor: { boxIds: [], destroyed: new Set() },
           pools, neverTargets: new Set(), groupOf, boxById: {} };
}

const D45_ROLLS = [6, 7, 9, 2, 7, 4, 10, 7, 8, 11, 7, 6, 3, 8, 5, 7, 8, 4, 5, 10, 12, 7, 9, 7, 2];
const D45_EXPECT = ['F_HULL', 'F_HULL', 'L_WARP', 'BRIDGE', 'F_HULL', 'PHASER', 'PHASER', 'F_HULL',
  'R_HULL', 'TORP', 'BATT', 'IMPULSE', 'DRONE', 'R_HULL', 'R_WARP', 'BATT', 'R_HULL', 'TRANS',
  'R_HULL', 'TRAC', 'AUX', 'BATT', 'LAB', 'SHUTTLE', 'FLAG'];

test('D4.5: the 25-hit D7 example reproduces the rulebook results', () => {
  const m = buildD7Model();
  const fx = applyVolley(m, { shield: 1, points: 25 }, seqRoll(D45_ROLLS));
  const got = fx.filter(e => e.type === 'destroy').map(e => e.token);
  assert.deepEqual(got, D45_EXPECT);
});

test('D3.63 leaky: 45 pts on a 30-box shield, rate 4 -> 15 internal points', () => {
  const m = buildShipModel(load('FED-CA', 'verified'), load('FED-CA', 'detection'));
  m.shields[1].max = 30; m.shields[1].down = 0;
  const fx = applyVolley(m, { shield: 1, points: 45, leaky: true, leakRate: 4 }, () => 6);
  const internal = fx.filter(e => e.type === 'destroy' || e.type === 'excess').length;
  assert.equal(internal, 15);
  assert.equal(fx.filter(e => e.type === 'shield').length, 30);          // shield fully depleted
});

test('special-function track keeps its last box (D4.33)', () => {
  const m = buildShipModel(load('FED-CA', 'verified'), load('FED-CA', 'detection'));
  const sensor = m.pools.SENSOR; const n = sensor.boxIds.length;
  assert.ok(n >= 2, 'need a multi-box sensor track');
  // pre-destroy all but the last (bottom) sensor box, then aim a SENSOR hit at it
  for (let i = 0; i < n - 1; i++) sensor.destroyed.add(sensor.boxIds[i]);
  // roll 6 col E is SENSOR; empty the earlier columns (A-D) so the point reaches SENSOR
  for (const k of ['F_HULL', 'IMPULSE', 'LAB', 'L_WARP']) if (m.pools[k]) m.pools[k].destroyed = new Set(m.pools[k].boxIds);
  applyVolley(m, { shield: 1, points: 1 }, () => 6);
  assert.equal(m.pools.SENSOR.destroyed.size, n - 1, 'the last sensor box is never destroyed');
});

test('excess overflow destroys the ship (D4.40)', () => {
  const m = buildD7Model();
  // strip everything except one excess box; then overflow it
  for (const k in m.pools) m.pools[k].destroyed = new Set(m.pools[k].boxIds);
  m.pools.EXCESS = { boxIds: ['e0'], destroyed: new Set() };
  const fx = applyVolley(m, { shield: 1, points: 3 }, () => 6);          // roll 6 finds nothing -> excess
  assert.equal(fx.filter(e => e.token === 'EXCESS').length, 1);          // one excess box absorbed
  assert.ok(fx.some(e => e.type === 'shipDestroyed'));                   // then destruction
});

test('bold result scores only once per volley (D4.31)', () => {
  const m = buildD7Model();
  // two roll-2 results in one volley: BRIDGE(bold) then FLAG(bold)
  const fx = applyVolley(m, { shield: 1, points: 2 }, seqRoll([2, 2]));
  const toks = fx.filter(e => e.type === 'destroy').map(e => e.token);
  assert.deepEqual(toks, ['BRIDGE', 'FLAG']);
});
