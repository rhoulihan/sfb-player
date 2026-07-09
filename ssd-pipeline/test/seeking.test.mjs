import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSeeker, stepSeeker, seekerImpacts, seekerDamage, seekerExpired } from '../viewer/seeking.js';
import { hexDistance } from '../viewer/battle-geom.js';
import { movesOnImpulse } from '../viewer/movement.js';

const at = (q, r, extra = {}) => ({ id: 'd1', owner: 'F1', type: 'drone', q, r, facing: 0, speed: 8, endurance: 40, warhead: 12, fade: 0, targetId: 'E1', ...extra });

test('launchSeeker builds a token from a spec', () => {
  const s = launchSeeker({ id: 'd1', owner: 'F1', q: 3, r: 4, targetId: 'E1', speed: 8, warhead: 12 });
  assert.equal(s.q, 3); assert.equal(s.owner, 'F1'); assert.equal(s.targetId, 'E1'); assert.equal(s.type, 'drone');
});

test('a seeker only moves on the impulses its speed schedules, and homes toward the target', () => {
  const target = { q: 20, r: 5 };
  const s = at(5, 5, { speed: 8 });
  let moveImp = null, holdImp = null;
  for (let i = 1; i <= 32; i++) { if (movesOnImpulse(8, i)) moveImp ??= i; else holdImp ??= i; }
  const held = stepSeeker(s, target, holdImp);
  assert.deepEqual([held.q, held.r], [s.q, s.r], 'no move on a non-scheduled impulse');
  const moved = stepSeeker(s, target, moveImp);
  assert.ok(hexDistance(moved, target) < hexDistance(s, target), 'moves + homes on a scheduled impulse');
});

test('endurance counts every impulse, not only moving ones (FD1.4: endurance in turns)', () => {
  const target = { q: 20, r: 5 }, s = at(5, 5, { speed: 8, endurance: 10 });
  let held = 1; while (movesOnImpulse(8, held)) held++;   // first non-moving impulse for speed 8
  assert.equal(stepSeeker(s, target, held).endurance, 9, 'a held drone still burns an impulse of endurance');
});

test('a seeker impacts when co-located with the target', () => {
  assert.equal(seekerImpacts({ q: 7, r: 3 }, { q: 7, r: 3 }), true);
  assert.equal(seekerImpacts({ q: 7, r: 3 }, { q: 8, r: 3 }), false);
});

test('drone warhead is flat; plasma fades with distance travelled (floored at 0)', () => {
  assert.equal(seekerDamage({ warhead: 12, fade: 0 }, 10), 12);
  assert.equal(seekerDamage({ warhead: 40, fade: 2 }, 5), 30);
  assert.equal(seekerDamage({ warhead: 40, fade: 2 }, 30), 0);
});

test('a seeker expires when endurance runs out', () => {
  assert.equal(seekerExpired({ endurance: 0 }), true);
  assert.equal(seekerExpired({ endurance: 3 }), false);
});

test('a fast drone reaches a stationary target and impacts within the closing distance', () => {
  const target = { q: 15, r: 5 };
  let s = at(5, 5, { speed: 32 });   // speed 32 → moves every impulse; 10 hexes to close
  let impactImp = null;
  for (let i = 1; i <= 32 && impactImp === null; i++) { s = stepSeeker(s, target, i); if (seekerImpacts(s, target)) impactImp = i; }
  assert.ok(impactImp !== null && impactImp <= 12, `drone should reach the target within ~10 impulses, got ${impactImp}`);
});

import { plasmaSpec, plasmaWarheadAt } from '../viewer/seeking.js';
test('plasmaSpec: table-driven warhead by type, speed 32, 32-impulse endurance (FP1.42/FP1.53)', () => {
  const R = plasmaSpec('Plasma R (LP)'), S = plasmaSpec('Plasma S (RP)'), F = plasmaSpec('Plasma F');
  assert.equal(R.cls, 'PLASMA-R'); assert.equal(S.cls, 'PLASMA-S');
  assert.equal(R.warhead, 50, 'R peak warhead 50'); assert.equal(S.warhead, 30); assert.equal(F.warhead, 20);
  assert.equal(S.type, 'plasma'); assert.equal(S.speed, 32); assert.equal(S.endurance, 32);
});

test('plasmaWarheadAt ages the warhead by hexes travelled per the FP1.53 table', () => {
  assert.equal(plasmaWarheadAt('PLASMA-R', 0), 50);
  assert.equal(plasmaWarheadAt('PLASMA-R', 10), 50);
  assert.equal(plasmaWarheadAt('PLASMA-R', 13), 35, 'R at 13 hexes = 35 (FP2.52)');
  assert.equal(plasmaWarheadAt('PLASMA-R', 20), 20);
  assert.equal(plasmaWarheadAt('PLASMA-R', 29), 1);
  assert.equal(plasmaWarheadAt('PLASMA-R', 31), 0, 'past 30 hexes = 0');
  assert.equal(plasmaWarheadAt('PLASMA-S', 24), 5);
  assert.equal(plasmaWarheadAt('PLASMA-F', 0), 20);
  assert.equal(plasmaWarheadAt('PLASMA-F', 6), 15);
  assert.equal(plasmaWarheadAt('PLASMA-F', 15), 1);
});

test('seekerDamage: a plasma torpedo delivers its aged warhead (FP1.53)', () => {
  const sk = launchSeeker({ id: 'p', owner: 'F1', targetId: 'E1', q: 0, r: 0, ...plasmaSpec('Plasma R') });
  assert.equal(seekerDamage({ ...sk, travelled: 0 }), 50);
  assert.equal(seekerDamage({ ...sk, travelled: 13 }), 35);
  assert.equal(seekerExpired({ ...sk, travelled: 31 }), true, 'plasma removed once the warhead ages to 0 (FP1.51)');
  // FP1.611: every 2 points of phaser damage reduce the warhead by 1
  assert.equal(seekerDamage({ ...sk, travelled: 0, phaserHits: 10 }), 45, '10 phaser points → −5 warhead');
});

import { pointDefenseHits, PD_PLASMA_DMG } from '../viewer/seeking.js';
test('pointDefenseHits counts the phaser shots that connect (for plasma weakening, FP1.611)', () => {
  assert.equal(pointDefenseHits(3, { d6: () => 6 }, 2), 3, 'all three phasers hit at close range');
  assert.equal(pointDefenseHits(3, { d6: () => 6 }, 5), 0, 'out of point-defense range');
  assert.equal(pointDefenseHits(3, { d6: () => 1 }, 2), 0, 'low rolls all miss');
  assert.ok(PD_PLASMA_DMG > 0, 'each phaser hit deals some damage to the plasma');
});

import { pointDefense, PD_RANGE } from '../viewer/seeking.js';
test('point-defense: a close seeker is shot down on a good roll, spared on a bad one, safe out of range', () => {
  assert.ok(PD_RANGE >= 1);
  assert.equal(pointDefense(2, { d6: () => 6 }, 1), true, 'high roll in range → killed');
  assert.equal(pointDefense(2, { d6: () => 1 }, 1), false, 'low roll → survives');
  assert.equal(pointDefense(3, { d6: () => 6 }, PD_RANGE + 1), false, 'beyond PD range → safe');
  assert.equal(pointDefense(0, { d6: () => 6 }, 1), false, 'no PD systems → no defense');
});

import { SUICIDE_SHUTTLE, weaselFor } from '../viewer/seeking.js';
test('SUICIDE_SHUTTLE is a slow homing shuttle carrying a warhead', () => {
  assert.equal(SUICIDE_SHUTTLE.type, 'shuttle');
  assert.ok(SUICIDE_SHUTTLE.speed > 0 && SUICIDE_SHUTTLE.warhead > 0 && SUICIDE_SHUTTLE.endurance > 0);
});
test('weaselFor finds a wild-weasel decoy protecting a ship, and only that ship', () => {
  const seekers = [{ id: 'w1', type: 'weasel', owner: 'F1' }, { id: 'd1', type: 'drone', owner: 'E1' }];
  assert.equal(weaselFor('F1', seekers).id, 'w1');
  assert.equal(weaselFor('E1', seekers), null);
  assert.equal(weaselFor('F1', []), null);
});

import { ADMIN_SHUTTLE, SCATTER_PACK } from '../viewer/seeking.js';
test('ADMIN_SHUTTLE is a non-combat shuttle; SCATTER_PACK releases several drones', () => {
  assert.equal(ADMIN_SHUTTLE.type, 'shuttle');
  assert.equal(ADMIN_SHUTTLE.warhead, 0, 'admin shuttle carries no warhead');
  assert.ok(ADMIN_SHUTTLE.speed > 0);
  assert.equal(SCATTER_PACK, 6, 'a scatter-pack releases six drones (FD7)');
});
