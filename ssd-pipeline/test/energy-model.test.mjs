import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shipPower } from '../viewer/energy-model.js';

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
