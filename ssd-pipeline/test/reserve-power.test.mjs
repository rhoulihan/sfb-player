import test from 'node:test';
import assert from 'node:assert/strict';
import { RESERVE_SYSTEMS, reservePool, spendReserve, reserveCost, canAfford } from '../viewer/reserve-power.js';

test('reservePool sums held reserve warp + battery charge (H7.4 + H5)', () => {
  assert.equal(reservePool(3, 4), 7);
  assert.equal(reservePool(0, 0), 0);
  assert.equal(reservePool(undefined, 2), 2);
});

test('reserveCost: specific reinforcement 1/pt, general 2/pt, ECCM 1/pt (D3.341/342, D6.312)', () => {
  assert.equal(reserveCost('specReinf', 3), 3);
  assert.equal(reserveCost('genReinf', 3), 6);   // general reinforcement costs two energy per point
  assert.equal(reserveCost('eccm', 2), 2);
  assert.equal(RESERVE_SYSTEMS.genReinf.cost, 2);
});

test('spendReserve draws from the chosen source first, spilling to the other', () => {
  // source=warp: take from reserve warp, then battery
  assert.deepEqual(spendReserve(3, 4, 2, 'warp'), { reserveWarp: 1, battery: 4 });
  assert.deepEqual(spendReserve(3, 4, 5, 'warp'), { reserveWarp: 0, battery: 2 });   // 3 warp + 2 battery
  // source=battery: take from battery first, then warp
  assert.deepEqual(spendReserve(3, 4, 2, 'battery'), { reserveWarp: 3, battery: 2 });
  assert.deepEqual(spendReserve(3, 4, 6, 'battery'), { reserveWarp: 1, battery: 0 });   // 4 battery + 2 warp
});

test('canAfford checks total pool against the costed request', () => {
  assert.equal(canAfford(2, 2, 'specReinf', 4), true);    // 4 pts × 1 = 4 ≤ 4
  assert.equal(canAfford(2, 2, 'specReinf', 5), false);   // 5 > 4
  assert.equal(canAfford(2, 2, 'genReinf', 2), true);     // 2 pts × 2 = 4 ≤ 4
  assert.equal(canAfford(2, 2, 'genReinf', 3), false);    // 3 × 2 = 6 > 4
});
