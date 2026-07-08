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

import { plasmaSpec } from '../viewer/seeking.js';
test('plasmaSpec: bigger plasma carries a bigger warhead, and all plasma fades', () => {
  const R = plasmaSpec('Plasma R (LP)'), S = plasmaSpec('Plasma S (RP)'), G = plasmaSpec('Plasma G');
  assert.ok(R.warhead > S.warhead && S.warhead > G.warhead, 'R > S > G warhead');
  assert.ok(R.fade > 0 && S.fade > 0, 'plasma fades with distance');
  assert.equal(S.type, 'plasma');
  assert.ok(S.speed > 0 && S.endurance > 0);
});
