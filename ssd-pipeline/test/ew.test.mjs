import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMount } from '../viewer/direct-fire.js';
import { combinedPreview } from '../viewer/fire-plan.js';
import { ewShift } from '../viewer/ew.js';

test('D6.34: net ECM strength converts to a die-roll shift = floor(sqrt) — 1-3→1, 4-8→2, 9-15→3, 16-24→4', () => {
  assert.equal(ewShift(0), 0, 'no net ECM → no shift');
  assert.equal(ewShift(-3), 0, 'ECCM stronger (negative) → no shift (D6.34 step 4)');
  assert.equal(ewShift(1), 1); assert.equal(ewShift(3), 1);
  assert.equal(ewShift(4), 2); assert.equal(ewShift(8), 2);
  assert.equal(ewShift(9), 3); assert.equal(ewShift(15), 3);
  assert.equal(ewShift(16), 4); assert.equal(ewShift(24), 4);
  assert.equal(ewShift(25), 5); assert.equal(ewShift(35), 5);
});

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

test('D6.34/D6.35: net ECM produces a die-roll shift, NOT a range add (effRange stays physical)', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 5, 0, 0);   // true range 5
  const r3 = resolveMount(firer, PH1, target, () => 1, false, 3);
  assert.equal(r3.effRange, 5, 'ECM does not extend the effective range — it stays the true range');
  assert.equal(r3.ewShift, 1, 'ECM 3 → die shift 1 (floor sqrt 3)');
  assert.equal(resolveMount(firer, PH1, target, () => 1, false, 8).ewShift, 2, 'ECM 8 → die shift 2');
  assert.equal(resolveMount(firer, PH1, target, () => 1, false, -2).ewShift, 0, 'negative net ECM → no shift');
});

test('passive fire control doubles the chart range and caps direct fire at 5 hexes (D19.11/D19.23)', () => {
  const firer = ship('F1', 0, 0, 0), at = d => ship('E1', d, 0, 0);   // true range d along the row
  assert.equal(resolveMount(firer, PH1, at(3), () => 1, false, 0, true).effRange, 6, 'passive: chart range = 2× true range (D19.11)');
  const p = resolveMount(firer, PH1, at(2), () => 1, false, 4, true);
  assert.equal(p.effRange, 4, 'passive still 2× true; ECM is a separate die shift, not added to range');
  assert.equal(p.ewShift, 2, 'ECM 4 → die shift 2');
  const far = resolveMount(firer, PH1, at(6), () => 1, false, 0, true);   // D19.23: no direct fire beyond 5 hexes
  assert.equal(far.hit, false, 'passive: beyond 5 hexes → miss');
  assert.equal(far.points, 0, 'passive: beyond 5 hexes → 0 points');
  assert.equal(resolveMount(firer, PH1, at(3), () => 1, false, 0, false).effRange, 3, 'active FC: chart range = true range');
});

const DISR = { id: 'F1.DISR.0', cls: 'DISR', arc: { arcs: ['FA'] } };
test('E1.821: a net-ECM die shift can push a hit-or-miss weapon over its to-hit number → miss', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);   // DISR at range 2, to-hit 1-5
  assert.ok(resolveMount(firer, DISR, target, () => 3, false, 0).hit, 'die 3 with no ECM → hit');
  const jammed = resolveMount(firer, DISR, target, () => 3, false, 9);   // ECM 9 → shift 3 → die 3+3=6 > 5 → miss
  assert.equal(jammed.ewShift, 3);
  assert.equal(jammed.hit, false, 'die 3 + shift 3 = 6 exceeds the to-hit 5 → miss');
  assert.equal(jammed.points, 0);
});

test('net ECM never increases damage (monotonic in range)', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);
  const clean = resolveMount(firer, PH1, target, () => 1, false, 0).points;
  for (let n = 1; n <= 8; n++) {
    const jammed = resolveMount(firer, PH1, target, () => 1, false, n).points;
    assert.ok(jammed <= clean, `ECM ${n} raised damage (${jammed} > ${clean})`);
  }
});

test('E1.822: overwhelming net ECM shifts a phaser off the effect grid → 0 damage', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);
  assert.ok(resolveMount(firer, PH1, target, () => 1, false, 0).points > 0, 'no ECM → damage');
  const jammed = resolveMount(firer, PH1, target, () => 1, false, 169);   // shift 13: raise die to 6 then bump columns past the grid
  assert.equal(jammed.ewShift, 13);
  assert.equal(jammed.points, 0, 'the shift walks the read off the end of the grid → no damage');
  assert.equal(jammed.hit, false);
});
