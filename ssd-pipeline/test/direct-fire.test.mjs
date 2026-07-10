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

test('overloaded photon at range 1 that hits feeds 2 points back to the firer (E4.431)', async () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 1, 0, 0);   // adjacent → true range 1
  const ships = [firer, target];
  const mounts = { F1: [{ id: 'F1.PHOTON.0', cls: 'PHOTON', arc: { arcs: ['FH'] } }] };
  const plan = { groups: [{ id: 'A', color: '#000', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['F1.PHOTON.0'] }] }] };
  const mk = () => ({ shields: { 1: { boxIds: new Array(20).fill('s'), down: 0, max: 20 }, 2: { boxIds: new Array(20).fill('s'), down: 0, max: 20 },
    3: { boxIds: [], down: 0, max: 0 }, 4: { boxIds: [], down: 0, max: 0 }, 5: { boxIds: [], down: 0, max: 0 }, 6: { boxIds: [], down: 0, max: 0 } },
    armor: { boxIds: [], destroyed: new Set() }, pools: {}, neverTargets: new Set(), groupOf: {}, boxById: {} });
  const models = { F1: mk(), E1: mk() };
  const res = await resolveAttackPlan(plan, ships, mounts, models, () => 0.5, () => 'overload');   // die 4 → R1 overload hits (1-6)
  const fb = res.volleys.find(v => v.feedback);
  assert.ok(fb, 'a feedback volley is produced');
  assert.equal(fb.targetShipId, 'F1', 'feedback strikes the firer, not the target');
  assert.equal(fb.points, 4, 'feedback is the warhead-16 photon feedback value (E4.413/E4.431)');
});

test('D6.123: a no-lock shot reads the hit chart at DOUBLE true range, without the passive 5-hex cap', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 8, 0, 0);   // true range 8 (beyond the passive 5-hex limit)
  const mount = { id: 'F1.PH-1.0', cls: 'PH-1', arc: { arcs: ['FH'] } };
  const locked = resolveMount(firer, mount, target, () => 1, false, 0, false, false);
  const noLock = resolveMount(firer, mount, target, () => 1, false, 0, false, true);
  const passive = resolveMount(firer, mount, target, () => 1, false, 0, true, false);
  assert.equal(locked.effRange, 8, 'a locked shot uses true range');
  assert.equal(noLock.effRange, 16, 'D6.123: no lock-on reads the chart at double true range');
  assert.equal(passive.hit, false, 'D19.23: passive FC cannot fire beyond 5 hexes true range');
  assert.ok(noLock.effRange > passive.effRange, 'no-lock is not subject to the passive 5-hex cap — it can still fire (up to the weapon max)');
});

test('resolveMount at long range beyond a phaser table returns 0 points', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 30, 0, 0);   // ~30 hexes, past PH-3 max (15)
  const mount = { id: 'F1.PH-3.0', cls: 'PH-3', arc: { arcs: ['FH'] } };
  const r = resolveMount(firer, mount, target, () => 1);
  assert.equal(r.points, 0);
  assert.equal(r.hit, false);
});

test('resolveAttackPlan stacks two firers on one shield into a single volley (D4.34)', async () => {
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
  const res = await resolveAttackPlan(plan, ships, shipMounts, models, () => 0.0);
  assert.equal(res.volleys.length, 1, 'both firers strike one shield ⇒ one combined volley');
  assert.deepEqual(res.volleys[0].firers.sort(), ['F1', 'F2']);
  assert.ok(res.log.some(l => l.kind === 'shot'), 'log has per-mount shots');
  assert.ok(res.log.some(l => l.kind === 'volley'), 'log has a volley line');
});

test('shield reinforcement absorbs points before the shield goes down (per-turn)', async () => {
  const ships = [ship('F1', 6, 4, 1), ship('F2', 5, 4, 1), ship('E1', 6, 8, 4)];
  const mounts = { F1: [{ id: 'F1.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }], F2: [{ id: 'F2.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }] };
  const plan = { groups: [{ id: 'A', color: '#2563eb', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['F1.DISR.0'] }, { shipId: 'F2', mountIds: ['F2.DISR.0'] }] }] };
  const mk = () => ({ shields: { 1: { boxIds: new Array(30).fill('s'), down: 0, max: 30 }, 2: { boxIds: [], down: 0, max: 0 }, 3: { boxIds: [], down: 0, max: 0 }, 4: { boxIds: [], down: 0, max: 0 }, 5: { boxIds: [], down: 0, max: 0 }, 6: { boxIds: [], down: 0, max: 0 } }, armor: { boxIds: [], destroyed: new Set() }, pools: {}, neverTargets: new Set(), groupOf: {}, boxById: {} });
  const m0 = mk(); const base = await resolveAttackPlan(plan, ships, mounts, { E1: m0 }, () => 0.0);
  const pts = base.volleys[0].points, baseDown = m0.shields[1].down;
  const m1 = mk(); const withR = await resolveAttackPlan(plan, ships, mounts, { E1: m1 }, () => 0.0, null, (t, sh, p) => (sh === 1 ? Math.min(p, 3) : 0));
  assert.equal(withR.volleys[0].absorbed, Math.min(pts, 3), 'reinforcement absorbs up to 3 points');
  assert.equal(m1.shields[1].down, baseDown - withR.volleys[0].absorbed, 'shield takes fewer boxes down by the absorbed amount');
});
