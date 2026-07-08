import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMount } from '../viewer/direct-fire.js';
import { combinedPreview } from '../viewer/fire-plan.js';

const ship = (id, q, r, f) => ({ id, q, r, facing: f });
const PH1 = { id: 'F1.PH-1.0', cls: 'PH-1', arc: { arcs: ['FH'] } };

test('combinedPreview reflects net ECM via effective range (lower expected damage)', () => {
  const ships = [ship('F1', 0, 0, 0), ship('E1', 3, 0, 0)];
  const mounts = { F1: [PH1] };
  const group = { id: 'A', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['F1.PH-1.0'] }] };
  const clean = combinedPreview(group, ships, mounts).totalNominal;
  const jammed = combinedPreview(group, ships, mounts, () => 6).totalNominal;
  assert.ok(jammed < clean, `ECM should lower expected damage (${jammed} vs ${clean})`);
});

test('effective range = true range + net ECM (floored at 0)', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 5, 0, 0);   // true range 5
  assert.equal(resolveMount(firer, PH1, target, () => 1, false, 3).effRange, 8, 'ECM 3 → eff 8');
  assert.equal(resolveMount(firer, PH1, target, () => 1, false, 0).effRange, 5, 'no ECM → eff = true');
  assert.equal(resolveMount(firer, PH1, target, () => 1, false, -2).effRange, 5, 'negative ECM floored');
});

test('net ECM never increases damage (monotonic in range)', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);
  const clean = resolveMount(firer, PH1, target, () => 1, false, 0).points;
  for (let n = 1; n <= 8; n++) {
    const jammed = resolveMount(firer, PH1, target, () => 1, false, n).points;
    assert.ok(jammed <= clean, `ECM ${n} raised damage (${jammed} > ${clean})`);
  }
});

test('net ECM beyond a weapon range pushes the shot out → miss', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);   // PH-1 maxRange is 75
  const jammed = resolveMount(firer, PH1, target, () => 1, false, 80);   // eff range 82, past the table
  assert.equal(jammed.points, 0);
  assert.equal(jammed.hit, false);
});
