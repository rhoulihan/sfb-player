import test from 'node:test';
import assert from 'node:assert/strict';
import { CRIT_TABLE, CRIT_INFO, CRIT_THRESHOLD, critForRoll, critRepairs, addCrit, hasCrit, activeCrits } from '../viewer/criticals.js';

test('D8.2 table maps 2d6 totals to the correct system (6–8 = no critical)', () => {
  assert.equal(critForRoll(2), 'fireControl');
  assert.equal(critForRoll(3), 'battery');
  assert.equal(critForRoll(4), 'transporter');
  assert.equal(critForRoll(5), 'labs');
  assert.equal(critForRoll(6), null);
  assert.equal(critForRoll(7), null);
  assert.equal(critForRoll(8), null);
  assert.equal(critForRoll(9), 'tractor');
  assert.equal(critForRoll(10), 'shuttleBay');
  assert.equal(critForRoll(11), 'maneuver');
  assert.equal(critForRoll(12), 'warp');
});

test('trigger threshold is 20 damage to one shield in one impulse (D8.1)', () => {
  assert.equal(CRIT_THRESHOLD, 20);
});

test('every critical type has display metadata', () => {
  for (const type of new Set(Object.values(CRIT_TABLE).filter(Boolean)))
    assert.ok(CRIT_INFO[type]?.label, `${type} has a label`);
});

test('repair roll: 1–4 repairs, later attempts on the same occurrence subtract 1 then 2 (D8.31)', () => {
  assert.equal(critRepairs(4, 0), true, 'first attempt: 4 repairs');
  assert.equal(critRepairs(5, 0), false, 'first attempt: 5 fails');
  assert.equal(critRepairs(5, 1), true, 'second attempt (-1): 5→4 repairs');
  assert.equal(critRepairs(6, 1), false, 'second attempt (-1): 6→5 fails');
  assert.equal(critRepairs(6, 2), true, 'third attempt (-2): 6→4 repairs');
});

test('crit state: add / query occurrences', () => {
  let st = [];
  st = addCrit(st, 'warp');
  st = addCrit(st, 'battery');
  assert.equal(hasCrit(st, 'warp'), true);
  assert.equal(hasCrit(st, 'battery'), true);
  assert.equal(hasCrit(st, 'labs'), false);
  assert.deepEqual(activeCrits(st).sort(), ['battery', 'warp']);
  assert.equal(st.find(c => c.type === 'warp').repairAttempts, 0, 'new occurrence starts at 0 repair attempts');
});
