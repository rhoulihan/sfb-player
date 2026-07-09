import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_SCHEDULE, armSchedule, armTurns, isArmed, armStepCost, armLabel } from '../viewer/weapon-arming.js';

test('arming schedules match the rulebook (E4.21 photon 2+2, FP2.51 plasma 3-turn)', () => {
  assert.deepEqual(ARM_SCHEDULE.PHOTON.turns, [2, 2]);
  assert.equal(ARM_SCHEDULE.PHOTON.hold, 1);
  assert.deepEqual(ARM_SCHEDULE['PLASMA-R'].turns, [2, 2, 5]);
  assert.equal(ARM_SCHEDULE['PLASMA-R'].hold, 4);
  assert.deepEqual(ARM_SCHEDULE['PLASMA-S'].turns, [2, 2, 4]);
  assert.equal(ARM_SCHEDULE['PLASMA-S'].hold, 2);
  assert.equal(armTurns('PHOTON'), 2);
  assert.equal(armTurns('PLASMA-G'), 3);
});

test('armStepCost: pay the schedule while arming, the hold price once armed', () => {
  assert.equal(armStepCost('PHOTON', 0), 2);    // arming turn 1
  assert.equal(armStepCost('PHOTON', 1), 2);    // arming turn 2
  assert.equal(armStepCost('PHOTON', 2), 1);    // armed → hold 1
  assert.equal(armStepCost('PLASMA-R', 2), 5);  // 3rd arming turn
  assert.equal(armStepCost('PLASMA-R', 3), 4);  // held → 4
  assert.equal(armStepCost('PLASMA-F', 3), 0);  // F holds free
});

test('isArmed only when the full schedule is complete (fire on last arm turn or while held)', () => {
  assert.equal(isArmed('PHOTON', 0), false);
  assert.equal(isArmed('PHOTON', 1), false);    // still arming after 1 turn
  assert.equal(isArmed('PHOTON', 2), true);     // 2 turns done → armed (may fire)
  assert.equal(isArmed('PLASMA-S', 2), false);
  assert.equal(isArmed('PLASMA-S', 3), true);
});

test('armLabel: ARM n/N while arming, HOLD once armed', () => {
  assert.equal(armLabel('PHOTON', 0), 'ARM 1/2');
  assert.equal(armLabel('PHOTON', 1), 'ARM 2/2');
  assert.equal(armLabel('PHOTON', 2), 'HOLD');
  assert.equal(armLabel('PLASMA-S', 0), 'ARM 1/3');
  assert.equal(armLabel('PLASMA-S', 3), 'HOLD');
});
