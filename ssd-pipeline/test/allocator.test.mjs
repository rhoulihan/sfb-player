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

test('non-leaky: the struck shield depletes, the remainder goes internal', () => {
  const m = buildD7Model();
  m.shields[1] = { boxIds: ['s0', 's1', 's2', 's3', 's4'], max: 5, down: 0 };
  const fx = applyVolley(m, { shield: 1, points: 8 }, seqRoll([6, 6, 6]));  // 5 shield + 3 internal
  assert.equal(fx.filter(e => e.type === 'shield').length, 5);
  assert.equal(m.shields[1].down, 5);
  assert.equal(fx.filter(e => e.type === 'destroy').length, 3);            // 3 F_HULL (roll 6)
});

test('leaky: damage leaks even when the shield survives (D3.61)', () => {
  const m = buildD7Model();
  m.shields[1] = { boxIds: Array.from({ length: 30 }, (_, i) => 's' + i), max: 30, down: 0 };
  const fx = applyVolley(m, { shield: 1, points: 12, leaky: true, leakRate: 4 }, () => 6);
  assert.equal(fx.filter(e => e.type === 'shield').length, 9);            // 9 to the shield
  assert.equal(m.shields[1].max - m.shields[1].down, 21);                // shield survives
  assert.equal(fx.filter(e => e.type === 'destroy').length, 3);          // points 4,8,12 leaked
});

test('armor absorbs penetrating damage before internals (D4.12)', () => {
  const m = buildD7Model();
  m.armor = { boxIds: ['a0', 'a1'], destroyed: new Set() };
  const fx = applyVolley(m, { shield: 1, points: 3 }, seqRoll([6, 6, 6]));
  assert.equal(fx.filter(e => e.type === 'armor').length, 2);
  assert.equal(fx.filter(e => e.type === 'destroy').length, 1);          // 1 F_HULL after armor
});

test('phaser column is skipped when no phaser bears the struck shield (D4.321)', () => {
  const m = buildD7Model();                                              // phasers bear FA (front / shield 1)
  const fx = applyVolley(m, { shield: 4, points: 1 }, seqRoll([4]));     // rear shield; roll 4 A=PHASER, B=TRANS
  assert.equal(fx.find(e => e.type === 'destroy').token, 'TRANS');
  assert.equal(m.pools.PHASER.destroyed.size, 0);                        // no phaser destroyed
});

test('F-hull hit falls to center hull when forward hull is gone (D4.351)', () => {
  const m = buildD7Model();
  m.pools.F_HULL.destroyed = new Set(m.pools.F_HULL.boxIds);
  m.pools.C_HULL = { boxIds: ['c0', 'c1'], destroyed: new Set() };
  const fx = applyVolley(m, { shield: 1, points: 1 }, seqRoll([6]));     // roll 6 A=F_HULL -> C_HULL
  assert.equal(fx.find(e => e.type === 'destroy').token, 'F_HULL');
  assert.equal(m.pools.C_HULL.destroyed.size, 1);
});

test('excess is absorbed by cargo before the ship is destroyed (D4.40)', () => {
  const m = buildD7Model();
  for (const k in m.pools) m.pools[k].destroyed = new Set(m.pools[k].boxIds);   // everything gone
  m.pools.EXCESS = { boxIds: [], destroyed: new Set() };
  m.pools.CARGO = { boxIds: ['g0'], destroyed: new Set() };
  const fx = applyVolley(m, { shield: 1, points: 2 }, seqRoll([6, 6]));
  assert.equal(fx.filter(e => e.token === 'CARGO').length, 1);
  assert.ok(fx.some(e => e.type === 'shipDestroyed'));
});

test('flag-bridge hits fall to security when there is no flag bridge (D4.31)', () => {
  const m = buildD7Model();                                              // has SEC, no FLAG pool
  const fx = applyVolley(m, { shield: 1, points: 2 }, seqRoll([2, 2]));  // BRIDGE(bold) then FLAG->security
  assert.equal(fx.filter(e => e.token === 'FLAG').length, 1);
  assert.equal(m.pools.SEC.destroyed.size, 1);
});

test('every 3rd phaser hit takes the best type (D4.3221)', () => {
  const m = buildD7Model();
  const ph3 = { type: 'Phaser-3', arcDef: { arcs: ['FA'] } };
  const ph1 = { type: 'Phaser-1', arcDef: { arcs: ['FA'] } };
  m.pools.PHASER = { boxIds: ['p3a', 'p3b', 'p1a', 'p1b'], destroyed: new Set() };
  m.groupOf = { p3a: ph3, p3b: ph3, p1a: ph1, p1b: ph1 };
  for (const k of ['F_HULL', 'IMPULSE', 'LAB', 'L_WARP', 'SENSOR', 'TRAC', 'SHUTTLE', 'R_WARP'])
    m.pools[k] = { boxIds: [], destroyed: new Set() };                   // clear roll-6 cols A-H -> reach col I PHASER
  const fx = applyVolley(m, { shield: 1, points: 3 }, seqRoll([6, 6, 6]));
  const hit = fx.filter(e => e.token === 'PHASER').map(e => e.boxId);
  assert.equal(hit.length, 3);
  assert.ok(['p3a', 'p3b'].includes(hit[0]) && ['p3a', 'p3b'].includes(hit[1]), 'first two are worst type');
  assert.ok(['p1a', 'p1b'].includes(hit[2]), '3rd is best type');
});

test('ANY_WEAPON lands on a live weapon box (D4.324)', () => {
  const m = buildD7Model();
  for (const k in m.pools) if (k !== 'DRONE') m.pools[k].destroyed = new Set(m.pools[k].boxIds);
  const fx = applyVolley(m, { shield: 1, points: 1 }, seqRoll([5]));     // roll 5 col L = ANY_WEAPON -> drone
  assert.equal(fx.find(e => e.type === 'destroy').token, 'ANY_WEAPON');
  assert.equal(m.pools.DRONE.destroyed.size, 1);
});
