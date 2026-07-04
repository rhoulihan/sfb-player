import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, bandIndex, damageFor } from '../viewer/weapon-charts.js';

test('all five direct-fire weapons are defined with a resolution model', () => {
  for (const cls of ['PH-1','PH-2','PH-3','DISR','PHOTON']) {
    assert.ok(WEAPONS[cls], `${cls} defined`);
    assert.ok(['range-of-effect','hit-or-miss'].includes(WEAPONS[cls].resolution));
  }
});

test('chart arrays are well-formed (grid = 6 die rows × bands; hit/damage = bands)', () => {
  for (const def of Object.values(WEAPONS)) {
    if (def.resolution === 'range-of-effect') {
      assert.equal(def.effectGrid.length, 6, def.cls + ' has 6 die rows');
      for (const row of def.effectGrid) assert.equal(row.length, def.bands.length, def.cls + ' row width = #bands');
    } else {
      assert.equal(def.hitBand1d.length, def.bands.length, def.cls + ' hitBand1d = #bands');
      assert.equal(def.fixedDamage.length, def.bands.length, def.cls + ' fixedDamage = #bands');
    }
  }
});

test('damageFor returns 0 beyond max range and (for photon) below min range', () => {
  const photon = WEAPONS.PHOTON;
  assert.equal(damageFor(photon, photon.maxRange + 1, 1), 0, 'out of range');
  assert.equal(damageFor(photon, 1, 1), 0, 'inside photon min range is 0');
});

test('hit-or-miss: a hitting die yields the band warhead; a missing die yields 0', () => {
  const disr = WEAPONS.DISR;
  const bi = disr.bands.findIndex(b => b.minTrue <= 4 && 4 <= b.maxTrue);
  const [lo, hi] = disr.hitBand1d[bi];
  assert.equal(damageFor(disr, 4, lo), disr.fixedDamage[bi], 'die in band ⇒ warhead');
  if (hi < 6) assert.equal(damageFor(disr, 4, hi + 1), 0, 'die above band ⇒ miss');
});

test('range-of-effect: phaser reads its die×range cell and degrades with range', () => {
  const ph1 = WEAPONS['PH-1'];
  const bi = bandIndex(ph1, 1);
  assert.equal(damageFor(ph1, 1, 1), ph1.effectGrid[0][bi], 'die 1 at range 1 reads the grid');
  assert.ok(damageFor(ph1, 1, 1) > 0);
  // a phaser does no less at longer range for the same die (monotonic non-increasing across bands)
  assert.ok(damageFor(ph1, 1, 3) >= damageFor(ph1, 20, 3), 'longer range never does more for the same die');
});

test('photon does a fixed warhead on any hitting range band', () => {
  const photon = WEAPONS.PHOTON;
  const bi = bandIndex(photon, 5);            // a mid band
  const [lo] = photon.hitBand1d[bi];
  assert.equal(damageFor(photon, 5, lo), photon.fixedDamage[bi]);
  assert.ok(damageFor(photon, 5, lo) > 0);
});
