import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMount, resolveAttackPlan } from '../viewer/direct-fire.js';

const ship = (id, q, r, facing) => ({ id, q, r, facing });

test('resolveMount reports the struck shield and non-negative points', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);
  const mount = { id: 'F1.PH-1.0', cls: 'PH-1', arc: { arcs: ['FH'] } };
  const r = resolveMount(firer, mount, target, () => 1);      // fixed die = 1
  assert.ok(r.struckShield >= 1 && r.struckShield <= 6);
  assert.ok(r.points >= 0);
  assert.equal(r.hit, r.points > 0);
});

test('resolveMount at long range beyond a phaser table returns 0 points', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 30, 0, 0);   // ~30 hexes, past PH-3 max (15)
  const mount = { id: 'F1.PH-3.0', cls: 'PH-3', arc: { arcs: ['FH'] } };
  const r = resolveMount(firer, mount, target, () => 1);
  assert.equal(r.points, 0);
  assert.equal(r.hit, false);
});

test('resolveAttackPlan stacks two firers on one shield into a single volley (D4.34)', () => {
  // two friendly ships north of a north-facing target both strike its front shield #1
  const ships = [ ship('F1', 6, 4, 1), ship('F2', 5, 4, 1), ship('E1', 6, 8, 4) ];
  const shipMounts = {
    F1: [{ id: 'F1.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }],
    F2: [{ id: 'F2.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }],
  };
  const plan = { groups: [{ id: 'A', color: '#2563eb', targetShipId: 'E1',
    members: [ { shipId: 'F1', mountIds: ['F1.DISR.0'] }, { shipId: 'F2', mountIds: ['F2.DISR.0'] } ] }] };
  const mkModel = () => ({
    shields: { 1: { boxIds: new Array(30).fill('s'), down: 0, max: 30 },
      2: { boxIds: [], down: 0, max: 0 }, 3: { boxIds: [], down: 0, max: 0 }, 4: { boxIds: [], down: 0, max: 0 },
      5: { boxIds: [], down: 0, max: 0 }, 6: { boxIds: [], down: 0, max: 0 } },
    armor: { boxIds: [], destroyed: new Set() }, pools: {}, neverTargets: new Set(), groupOf: {}, boxById: {} });
  const models = { E1: mkModel() };
  // seeded rand that always yields a low die (guarantees disruptor hits in-band)
  const res = resolveAttackPlan(plan, ships, shipMounts, models, () => 0.0);
  assert.equal(res.volleys.length, 1, 'both firers strike one shield ⇒ one combined volley');
  assert.deepEqual(res.volleys[0].firers.sort(), ['F1', 'F2']);
  assert.ok(res.log.some(l => l.kind === 'shot'), 'log has per-mount shots');
  assert.ok(res.log.some(l => l.kind === 'volley'), 'log has a volley line');
});
