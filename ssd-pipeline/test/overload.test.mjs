import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WEAPONS, damageFor } from '../viewer/weapon-charts.js';

const HIT = 1; // low die is a hit for the close bands of both bolt weapons

test('heavy-weapon overload: more damage, shorter range', () => {
  // photon: normal 8 on a hit at range 5; overloaded 16 within range 8, 0 beyond
  assert.equal(damageFor(WEAPONS.PHOTON, 5, HIT), 8, 'normal photon');
  assert.equal(damageFor(WEAPONS.PHOTON, 5, HIT, true), 16, 'overloaded photon');
  assert.equal(damageFor(WEAPONS.PHOTON, 10, HIT, true), 0, 'overload beyond range 8 is a whiff');
  // non-overload path unchanged at long range
  assert.equal(damageFor(WEAPONS.PHOTON, 10, HIT), 8, 'normal photon reaches range 10');
  // disruptor overloads too
  assert.ok(damageFor(WEAPONS.DISR, 4, HIT, true) > damageFor(WEAPONS.DISR, 4, HIT), 'disruptor overload hits harder');
});

test('serve.py chart regeneration keeps the overload-aware damageFor (no revert)', () => {
  const src = fs.readFileSync('ssd-pipeline/serve.py', 'utf8');
  const m = src.match(/WEAPON_CHARTS_FUNCS = """([\s\S]*?)"""/);
  assert.ok(m, 'WEAPON_CHARTS_FUNCS present');
  assert.match(m[1], /function damageFor\(def, trueRange, die, overload/, 'server-regenerated damageFor is overload-aware');
});
