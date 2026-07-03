import test from 'node:test';
import assert from 'node:assert/strict';
import { DAC, SYS, TOKEN_FAMILY } from '../viewer/dac.js';

// Column A for each 2d6 result is pinned by the rulebook's D4.5 worked example (p60).
const COL_A = { 2: 'BRIDGE', 3: 'DRONE', 4: 'PHASER', 5: 'R_WARP', 6: 'F_HULL',
                7: 'CARGO', 8: 'R_HULL', 9: 'L_WARP', 10: 'PHASER', 11: 'TORP', 12: 'AUX' };

test('every roll 2-12 has a non-empty column list', () => {
  for (let r = 2; r <= 12; r++) assert.ok(DAC[r] && DAC[r].length, `roll ${r}`);
});

test('column A matches the D4.5 example reveals', () => {
  for (const [r, sys] of Object.entries(COL_A)) assert.equal(DAC[r][0].sys, sys, `roll ${r} col A`);
});

test('control results 2 and 12 are bold (once-per-volley, D4.31)', () => {
  assert.ok(DAC[2][0].bold);
  assert.ok(DAC[12][0].bold);
});

test('every roll terminates in EXCESS (the column walk always resolves)', () => {
  for (let r = 2; r <= 12; r++) assert.equal(DAC[r][DAC[r].length - 1].sys, 'EXCESS', `roll ${r}`);
});

test('all tokens are valid and mapped to a family', () => {
  for (const r of Object.values(DAC)) for (const c of r) {
    assert.ok(SYS.has(c.sys), `unknown token ${c.sys}`);
    assert.ok(c.sys === 'ANY_WEAPON' || TOKEN_FAMILY[c.sys], `unmapped ${c.sys}`);
  }
});
