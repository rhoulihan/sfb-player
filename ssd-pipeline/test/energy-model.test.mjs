import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shipPower, lifeSupportCost, newEafColumn, validateEaf, foldEaf, sinkMax, specReinfMax } from '../viewer/energy-model.js';

const load = c => shipPower(
  c,
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/verified.json`)),
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/detection.json`)),
);

test('shipPower derives production, capacitor, and weapons from the SSD', () => {
  // Golden vectors from OUR verified SSD data (flat 1-power/box model; calibrated in the plan's
  // final task). Fed CA: 30 warp + 4 impulse + 2 apr = 36; 4 batteries.
  const fed = load('FED-CA');
  assert.equal(fed.warp, 30, 'Fed CA warp boxes');
  assert.equal(fed.impulse, 4); assert.equal(fed.apr, 2);
  assert.equal(fed.total, 36, 'Fed CA total power (calibration anchor)');
  assert.equal(fed.batteries, 4, 'Fed CA battery cells');
  assert.equal(fed.capacitorCap, 9, 'Fed CA capacitor: 8×PH-1 + 2×PH-3(0.5) = 9 (our SSD fit)');
  assert.equal(fed.weapons.filter(w => w.cls === 'PHOTON').length, 4, 'Fed CA photons');
  assert.equal(fed.sizeClass, 3);
  assert.ok(fed.systems.shuttles > 0 && fed.systems.tractor && fed.systems.transporter);

  // Klingon D7: 30 warp + 5 impulse + 4 apr = 39; 3 batteries; 9× PH-2 capacitor.
  const kli = load('KLI-D7');
  assert.equal(kli.total, 39, 'Klingon D7 total power (calibration anchor)');
  assert.equal(kli.batteries, 3);
  assert.equal(kli.capacitorCap, 9, 'Klingon D7 capacitor: 9×PH-2 = 9');
  assert.equal(kli.weapons.filter(w => w.cls === 'DISR').length, 4, 'Klingon D7 disruptors');
});

test('lifeSupportCost is by size class; newEafColumn defaults to charge/hold/power all', () => {
  const fed = load('FED-CA');
  assert.equal(lifeSupportCost(fed), 1, 'SC3 life support = 1');
  const col = newEafColumn(fed, 8);
  assert.equal(col.lifeSupport, 1, 'mandatory life support pre-filled');
  assert.equal(col.phaserCap, fed.capacitorCap, 'capacitor charged to full');
  assert.ok(Object.values(col.weapons).every(w => w.armed && !w.overload), 'all heavy weapons armed, none overloaded');
  assert.equal(col.shieldsActive, true, 'shields activated');
  assert.equal(col.movement, 8 * fed.moveCost, 'movement funds prev speed');
  assert.equal(col.fireControl, 1, 'fire control full when the ship has it');
  assert.deepEqual(col.specReinf, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  // carried capacitor charge from last turn: the default only tops up the remaining room (H6 carry-over)
  assert.equal(newEafColumn(fed, 8, 4).phaserCap, fed.capacitorCap - 4, 'phaserCap fills only the empty room');
});

test('validateEaf: golden used, balance status, and hard errors', () => {
  const fed = load('FED-CA');
  // Default FED-CA column at speed 0: LS 1 + fireControl 1 + phaserCap 9 + 4 photons×2 arm = 19.
  const col = newEafColumn(fed, 0);
  const v = validateEaf(fed, col);
  assert.equal(v.used, 19, 'hand-computed default budget');
  assert.equal(v.produced, 40, 'total 36 + 4 batteries');
  assert.equal(v.status, 'under', 'default leaves surplus');

  // overloading one photon adds overload(4) − arm(2) = 2
  const wId = fed.weapons[0].id;
  const over = { ...col, weapons: { ...col.weapons, [wId]: { armed: true, overload: true } } };
  assert.equal(validateEaf(fed, over).used, 21);

  // balanced when movement soaks the surplus exactly
  assert.equal(validateEaf(fed, { ...col, movement: 21 }).status, 'balanced');
  // over-allocation
  const big = validateEaf(fed, { ...col, movement: 40 });
  assert.equal(big.status, 'over');
  assert.ok(big.errors.some(e => /over/i.test(e)));
  // mandatory life support
  assert.ok(validateEaf(fed, { ...col, lifeSupport: 0 }).errors.some(e => /life support/i.test(e)));
  // capacitor carried-room: 6 requested + 4 carried > cap 9
  assert.ok(validateEaf(fed, { ...col, phaserCap: 6 }, 4).errors.some(e => /capacitor/i.test(e)));
  // impulse-to-move <= 1
  assert.ok(validateEaf(fed, { ...col, impulseMove: 2 }).errors.some(e => /impulse/i.test(e)));
});

test('validateEaf accounts for current battery charge and caps recharge to empty batteries', () => {
  const fed = load('FED-CA');   // 4 batteries
  const col = newEafColumn(fed, 0);
  assert.equal(validateEaf(fed, col, 0, 4).produced, fed.total + 4, 'full batteries add their full charge');
  assert.ok(validateEaf(fed, { ...col, recharge: 1 }, 0, 4).errors.some(e => /recharge|empt/i.test(e)), 'cannot charge full batteries');
  assert.equal(validateEaf(fed, col, 0, 1).produced, fed.total + 1, 'only current battery charge is available');
  assert.equal(validateEaf(fed, { ...col, recharge: 3 }, 0, 1).errors.some(e => /recharge|empt/i.test(e)), false, 'may charge the 3 empty batteries');
  assert.ok(validateEaf(fed, { ...col, recharge: 4 }, 0, 1).errors.some(e => /recharge|empt/i.test(e)), 'cannot charge beyond the empty batteries');
});

test('foldEaf applies a locked column to turn state', () => {
  const fed = load('FED-CA'); const wId = fed.weapons[0].id;
  const base = newEafColumn(fed, 0);
  const col = { ...base, movement: 8, phaserCap: 5, genReinf: 3, ecm: 2,
    weapons: { ...base.weapons, [wId]: { armed: true, overload: true } } };
  const ts = foldEaf(fed, col, 4);
  assert.equal(ts.speed, 8, 'movement 8 / moveCost 1 = speed 8');
  assert.equal(ts.armed[wId].overload, true, 'overloaded weapon folded');
  assert.equal(ts.capacitor, 9, 'carried 4 + charged 5');
  assert.equal(ts.reinforce.gen, 3);
  assert.equal(ts.ecmLevel, 2);
  // an un-armed weapon is absent from armed{}
  const noFire = foldEaf(fed, { ...base, weapons: Object.fromEntries(fed.weapons.map(w => [w.id, { armed: false, overload: false }])) }, 0);
  assert.equal(Object.keys(noFire.armed).length, 0);
});

test('sinkMax enforces rule-based slider ceilings', () => {
  const fed = load('FED-CA');   // moveCost 1, capacitor 9, 4 batteries
  assert.equal(sinkMax(fed, 'movement'), 31, '30-hex cap + 1 impulse point (Fed CA has impulse engines)');
  assert.equal(sinkMax(fed, 'ecm'), 6); assert.equal(sinkMax(fed, 'eccm'), 6);
  assert.equal(sinkMax(fed, 'phaserCap'), 9, 'capacitor room');
  assert.equal(sinkMax(fed, 'recharge'), 4, 'no more than battery capacity');
  assert.equal(sinkMax(fed, 'tractor'), fed.systems.tractor);
  assert.equal(sinkMax(fed, 'transporter'), fed.systems.transporter);
  assert.equal(specReinfMax(fed, 1), fed.shields[0], 'reinforce a shield up to its box value');
});
