import test from 'node:test';
import assert from 'node:assert/strict';
import { repairBoxes, repairCostFor, repairSystemStep, canRepairFamily } from '../viewer/repair.js';

test('D9.7 Cost of Repair (Annex #9): per-system costs, damage-control/excess not repairable (D9.76)', () => {
  assert.equal(repairCostFor('hull'), 1);
  assert.equal(repairCostFor('heavy-weapon'), 8, 'photon/disruptor');
  assert.equal(repairCostFor('warp-engine'), 10);
  assert.equal(repairCostFor('impulse-engine'), 5);
  assert.equal(repairCostFor('battery'), 2);
  assert.equal(canRepairFamily('damage-control'), false, 'D9.76: cannot repair the DC track');
  assert.equal(canRepairFamily('excess-damage'), false, 'D9.76: cannot repair excess damage');
  assert.equal(canRepairFamily('warp-engine'), true);
});

test('D9.7 repair: free points accumulate toward ONE box at a time with carryover (D9.74), scenario cap = DC rating (D9.76)', () => {
  const famOf = () => 'warp-engine';   // cost 10 each
  // turn 1: 4 free points → not enough for a 10-cost box; carries over
  let st = repairSystemStep(['w1', 'w2'], famOf, 4, {}, 4);
  assert.deepEqual(st.repaired, [], 'no box repaired yet (4 < 10)');
  assert.equal(st.progress, 4); assert.equal(st.target, 'w1');
  // turn 2: +4 → 8, still short
  st = repairSystemStep(['w1', 'w2'], famOf, 4, st, 4);
  assert.deepEqual(st.repaired, []); assert.equal(st.progress, 8);
  // turn 3: +4 → 12 ≥ 10 → w1 repaired, 2 carry over toward w2
  st = repairSystemStep(['w1', 'w2'], famOf, 4, st, 4);
  assert.deepEqual(st.repaired, ['w1']); assert.equal(st.target, 'w2'); assert.equal(st.progress, 2);
  assert.equal(st.repairedTotal, 1);
});

test('D9.7 scenario cap: a ship never repairs more boxes than its DC rating (D9.76)', () => {
  const famOf = () => 'hull';   // cost 1 each → cheap
  const st = repairSystemStep(['h1', 'h2', 'h3'], famOf, 10, { repairedTotal: 0 }, 2);   // 10 points but cap 2
  assert.equal(st.repaired.length, 2, 'stops at the DC-rating cap of 2 boxes for the scenario');
  assert.equal(st.repairedTotal, 2);
});

test('repairs up to `points` destroyed boxes', () => {
  const r = repairBoxes(['a', 'b', 'c'], 2);
  assert.equal(r.repaired.length, 2);
  assert.equal(r.remaining.length, 1);
});

test('points exceeding damage repairs everything', () => {
  const r = repairBoxes(['a', 'b'], 5);
  assert.deepEqual(r.repaired.sort(), ['a', 'b']);
  assert.deepEqual(r.remaining, []);
});

test('zero points repairs nothing', () => {
  const r = repairBoxes(['a', 'b'], 0);
  assert.deepEqual(r.repaired, []);
  assert.deepEqual(r.remaining.sort(), ['a', 'b']);
});

test('nothing destroyed → nothing to do', () => {
  const r = repairBoxes([], 3);
  assert.deepEqual(r.repaired, []);
  assert.deepEqual(r.remaining, []);
});

test('priority order is repaired first (player/importance ordering, D9.7)', () => {
  const r = repairBoxes(['a', 'b', 'c'], 1, { priority: ['c', 'b'] });
  assert.deepEqual(r.repaired, ['c']);
});

test('non-repairable boxes are never restored (excess / damcon track, D9.76)', () => {
  const r = repairBoxes(['a', 'excess1', 'b'], 5, { repairable: id => !id.startsWith('excess') });
  assert.ok(!r.repaired.includes('excess1'), 'excess box stays destroyed');
  assert.deepEqual(r.repaired.sort(), ['a', 'b']);
  assert.deepEqual(r.remaining, ['excess1']);
});
