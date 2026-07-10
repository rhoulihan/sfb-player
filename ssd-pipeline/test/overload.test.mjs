import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WEAPONS, damageFor, feedbackFor } from '../viewer/weapon-charts.js';

const HIT = 1; // low die is a hit for the close bands of both bolt weapons

test('heavy-weapon overload: more damage, shorter range', () => {
  // photon: normal 8 on a hit at range 5; overloaded 16 within range 8, 0 beyond
  assert.equal(damageFor(WEAPONS.PHOTON, 5, HIT), 8, 'normal photon');
  assert.equal(damageFor(WEAPONS.PHOTON, 5, HIT, true), 16, 'overloaded photon');
  assert.equal(damageFor(WEAPONS.PHOTON, 10, HIT, true), 0, 'overload beyond range 8 is a whiff');
  assert.equal(damageFor(WEAPONS.PHOTON, 10, HIT), 8, 'normal photon reaches range 10');
});

test('overloaded disruptor damage is doubled by range, not a flat value (E3.52)', () => {
  assert.equal(damageFor(WEAPONS.DISR, 1, HIT, true), 10, 'R1 overload = 2×5');
  assert.equal(damageFor(WEAPONS.DISR, 4, HIT, true), 8, 'R3-4 overload = 2×4');
  assert.equal(damageFor(WEAPONS.DISR, 6, HIT, true), 6, 'R5-8 overload = 2×3');
  assert.equal(damageFor(WEAPONS.DISR, 9, HIT, true), 0, 'overload beyond range 8 is a whiff (E3.53)');
});

test('overloaded photon may fire at range 0-1 on a die of 1-6 (E4.43), with feedback to the firer', () => {
  assert.equal(damageFor(WEAPONS.PHOTON, 1, 1, 'overload'), 16, 'R1 overload hits on 1');
  assert.equal(damageFor(WEAPONS.PHOTON, 1, 6, 'overload'), 16, 'R1 overload hits even on 6 (1-6)');
  assert.equal(damageFor(WEAPONS.PHOTON, 1, HIT), 0, 'a NORMAL photon still cannot fire below min range 2');
  assert.equal(feedbackFor(WEAPONS.PHOTON, 1, 1, 'overload', true), 4, 'a point-blank overload HIT feeds the warhead-16 photon feedback value back to the firer (E4.413/E4.431)');
  assert.equal(feedbackFor(WEAPONS.PHOTON, 1, 1, 'overload', false), 0, 'a miss produces no feedback (D6.1264)');
  assert.equal(feedbackFor(WEAPONS.PHOTON, 3, 1, 'overload', true), 0, 'no feedback beyond range 1');
});

test('photon proximity: auto-misses below 9 hexes, then hits 1-4 / 1-3 with warhead 4 (E4.32/E4.33)', () => {
  assert.equal(damageFor(WEAPONS.PHOTON, 5, HIT, 'prox'), 0, 'proximity auto-misses inside 9 hexes');
  assert.equal(damageFor(WEAPONS.PHOTON, 1, HIT, 'prox'), 0, 'proximity auto-misses at point blank');
  assert.equal(damageFor(WEAPONS.PHOTON, 10, 4, 'prox'), 4, 'R9-12 proximity hits on 1-4 (std 1-2, −2 to die)');
  assert.equal(damageFor(WEAPONS.PHOTON, 10, 5, 'prox'), 0, 'R9-12 proximity misses on 5');
  assert.equal(damageFor(WEAPONS.PHOTON, 20, 3, 'prox'), 4, 'R13-30 proximity hits on 1-3');
  assert.equal(damageFor(WEAPONS.PHOTON, 20, 4, 'prox'), 0, 'R13-30 proximity misses on 4');
});

test('serve.py chart regeneration keeps the overload-aware damageFor (no revert)', () => {
  const src = fs.readFileSync('ssd-pipeline/serve.py', 'utf8');
  const m = src.match(/WEAPON_CHARTS_FUNCS = """([\s\S]*?)"""/);
  assert.ok(m, 'WEAPON_CHARTS_FUNCS present');
  assert.match(m[1], /function damageFor\(def, trueRange, die, mode/, 'server-regenerated damageFor is overload/proximity-aware');
});
