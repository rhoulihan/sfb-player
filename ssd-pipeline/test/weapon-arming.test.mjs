import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_SCHEDULE, armSchedule, armTurns, isArmed, armStepCost, armLabel, canHold, rollCost, canRoll, reserveCompletionCost, firedThisTurn, impulsesSince, refireReady } from '../viewer/weapon-arming.js';

test('E1.5/E1.52 refire cadence: 8 impulses between shots, spanning the turn boundary', () => {
  assert.equal(impulsesSince(null, 1, 1), Infinity, 'never fired → infinitely long ago');
  assert.equal(impulsesSince({ turn: 1, impulse: 25 }, 2, 1), 8, 'imp 25 turn 1 → imp 1 turn 2 is 8 impulses (E1.52 example)');
  assert.equal(refireReady(null, 5, 3), true, 'never fired → ready');
  assert.equal(refireReady({ turn: 1, impulse: 25 }, 2, 1), true, 'fired imp 25 → may fire imp 1 of next turn (8 later)');
  assert.equal(refireReady({ turn: 1, impulse: 28 }, 2, 1), false, 'fired imp 28 → NOT ready imp 1 next turn (only 5 later)');
  assert.equal(refireReady({ turn: 1, impulse: 28 }, 2, 4), true, 'fired imp 28 → ready imp 4 next turn (8 later)');
  assert.equal(refireReady({ turn: 3, impulse: 10 }, 3, 17), false, 'within a turn: 7 impulses is not yet 8');
  assert.equal(refireReady({ turn: 3, impulse: 10 }, 3, 18), true, 'within a turn: 8 impulses later is ready');
});

test('E2.23 frequency: a weapon that fired this turn is not ready again until a later turn', () => {
  assert.equal(firedThisTurn(null, 3), false, 'never fired → not fired this turn');
  assert.equal(firedThisTurn({ turn: 3, impulse: 8 }, 3), true, 'fired on turn 3 → counts as fired this turn');
  assert.equal(firedThisTurn({ turn: 2, impulse: 30 }, 3), false, 'fired last turn → available again this turn');
});

test('arming schedules match the rulebook (E4.21 photon 2+2, FP2.51 plasma 3-turn)', () => {
  assert.deepEqual(ARM_SCHEDULE.PHOTON.turns, [2, 2]);
  assert.equal(ARM_SCHEDULE.PHOTON.hold, 1);
  assert.deepEqual(ARM_SCHEDULE['PLASMA-R'].turns, [2, 2, 5]);
  assert.deepEqual(ARM_SCHEDULE['PLASMA-S'].turns, [2, 2, 4]);
  assert.equal(ARM_SCHEDULE['PLASMA-S'].hold, 2);
  assert.deepEqual(ARM_SCHEDULE['PLASMA-F'].turns, [1, 1, 3]);   // FP2.51: F turn-3 is 3, not 1
  assert.equal(armTurns('PHOTON'), 2);
  assert.equal(armTurns('PLASMA-G'), 3);
});

test('holdability: disruptors and plasma-R cannot be held (E3.24, FP1.311)', () => {
  assert.equal(canHold('PHOTON'), true);
  assert.equal(canHold('PLASMA-S'), true);
  assert.equal(canHold('PLASMA-G'), true);
  assert.equal(canHold('PLASMA-F'), true);    // holds for free
  assert.equal(canHold('PLASMA-R'), false);   // FP1.311: type-R armed by a ship cannot be held
  assert.equal(canHold('DISR'), false);       // E3.24: armed disruptors cannot be held
});

test('rolling delay costs 2 (1 for plasma-F); reserve completion pays the difference (FP1.221/222)', () => {
  assert.equal(rollCost('PLASMA-R'), 2);
  assert.equal(rollCost('PLASMA-S'), 2);
  assert.equal(rollCost('PLASMA-G'), 2);
  assert.equal(rollCost('PLASMA-F'), 1);      // one point for a plasma-F
  assert.equal(canRoll('PLASMA-R'), true);
  assert.equal(canRoll('PHOTON'), false);     // photons do not roll-delay
  assert.equal(canRoll('DISR'), false);
  assert.equal(reserveCompletionCost('PLASMA-R'), 3);   // full 3rd-turn 5 − roll 2
  assert.equal(reserveCompletionCost('PLASMA-S'), 2);   // 4 − 2
  assert.equal(reserveCompletionCost('PLASMA-G'), 1);   // 3 − 2
  assert.equal(reserveCompletionCost('PLASMA-F'), 2);   // 3 − 1
});

test('armStepCost: pay the schedule while arming, the hold price once armed', () => {
  assert.equal(armStepCost('PHOTON', 0), 2);    // arming turn 1
  assert.equal(armStepCost('PHOTON', 1), 2);    // arming turn 2
  assert.equal(armStepCost('PHOTON', 2), 1);    // armed → hold 1
  assert.equal(armStepCost('PLASMA-R', 2), 5);  // 3rd arming turn
  assert.equal(armStepCost('PLASMA-F', 2), 3);  // FP2.51: F 3rd arming turn = 3
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
