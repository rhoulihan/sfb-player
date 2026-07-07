import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSealedFire } from '../viewer/sealed-fire.js';

const ship = (id, q, r, facing) => ({ id, q, r, facing });
const SHIPS = [ship('F1', 6, 4, 1), ship('F2', 5, 4, 1), ship('E1', 6, 8, 4)];
const MOUNTS = {
  F1: [{ id: 'F1.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }],
  F2: [{ id: 'F2.DISR.0', cls: 'DISR', arc: { arcs: ['FH'] } }],
};
const PLAN = { groups: [{ id: 'A', color: '#2563eb', targetShipId: 'E1',
  members: [{ shipId: 'F1', mountIds: ['F1.DISR.0'] }, { shipId: 'F2', mountIds: ['F2.DISR.0'] }] }] };
const mkModels = () => ({ E1: {
  shields: { 1: { boxIds: new Array(30).fill('s'), down: 0, max: 30 },
    2: { boxIds: [], down: 0, max: 0 }, 3: { boxIds: [], down: 0, max: 0 }, 4: { boxIds: [], down: 0, max: 0 },
    5: { boxIds: [], down: 0, max: 0 }, 6: { boxIds: [], down: 0, max: 0 } },
  armor: { boxIds: [], destroyed: new Set() }, pools: {}, neverTargets: new Set(), groupOf: {}, boxById: {} } });

const run = (seed, cursor = 0) => resolveSealedFire({ plan: PLAN, ships: SHIPS, mountsMap: MOUNTS, models: mkModels(), seed, cursor });

test('same seed + cursor resolves identically (both clients agree)', () => {
  const a = run(777), b = run(777);
  assert.deepEqual(a.volleys, b.volleys);
  assert.equal(a.cursor, b.cursor);
});

test('resolution advances the shared cursor (dice were drawn)', () => {
  const a = resolveSealedFire({ plan: PLAN, ships: SHIPS, mountsMap: MOUNTS, models: mkModels(), seed: 5, cursor: 10 });
  assert.ok(a.cursor > 10, `cursor advanced past 10, got ${a.cursor}`);
});

test('resuming from the returned cursor continues the same stream deterministically', () => {
  const first = run(9);
  const second = run(9, first.cursor);
  const secondAgain = run(9, first.cursor);
  assert.ok(second.cursor > first.cursor, 'continuation advances further');
  assert.deepEqual(second.volleys, secondAgain.volleys, 'the continuation is deterministic');
});
