import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shipPower, lifeSupportCost, newEafColumn } from '../viewer/energy-model.js';

const load = c => shipPower(
  c,
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/verified.json`)),
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/detection.json`)),
);

test('shipPower derives production, capacitor, and weapons from the SSD', () => {
  const fed = load('FED-CA');
  assert.equal(fed.warp, 30, 'Fed CA warp boxes');
  assert.equal(fed.total, fed.warp + fed.impulse + fed.apr, 'total = warp+impulse+apr');
  assert.equal(fed.capacitorCap, 9, 'Fed CA capacitor: 8×PH-1 + 2×PH-3(0.5) = 9');
  assert.equal(fed.weapons.filter(w => w.cls === 'PHOTON').length, 4, 'Fed CA photons');
  assert.equal(fed.sizeClass, 3);
  assert.ok(fed.systems.shuttles > 0 && fed.systems.tractor && fed.systems.transporter);

  const kli = load('KLI-D7');
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
});
