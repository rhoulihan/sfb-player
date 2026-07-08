import test from 'node:test';
import assert from 'node:assert/strict';
import { cloakEcm, cloakBlocksFire, applyCloakFireGate, CLOAK_ECM } from '../viewer/cloak.js';

test('a cloaked ship contributes cloak ECM; an uncloaked one contributes none', () => {
  assert.equal(cloakEcm({ cloaked: true }), CLOAK_ECM);
  assert.equal(cloakEcm({ cloaked: false }), 0);
  assert.equal(cloakEcm({}), 0);
  assert.equal(cloakEcm(null), 0);
});

test('CLOAK_ECM imposes a severe lock penalty (only low rolls can still lock)', () => {
  assert.ok(CLOAK_ECM >= 5, 'cloak should make lock-on succeed only on a low roll (roll + CLOAK_ECM near 6)');
});

test('a cloaked ship cannot fire its direct-fire weapons (G13)', () => {
  assert.equal(cloakBlocksFire({ cloaked: true }), true);
  assert.equal(cloakBlocksFire({ cloaked: false }), false);
  assert.equal(cloakBlocksFire(null), false);
});

test('applyCloakFireGate drops fire from cloaked firers, keeps the rest', () => {
  const state = { F1: { cloaked: true }, F2: { cloaked: false } };
  const byId = id => state[id];
  const plan = { groups: [{ id: 'A', targetShipId: 'E1', members: [{ shipId: 'F1', mountIds: ['m'] }, { shipId: 'F2', mountIds: ['n'] }] }] };
  const gated = applyCloakFireGate(plan, byId);
  assert.equal(gated.groups.length, 1);
  assert.equal(gated.groups[0].members.length, 1, 'only the uncloaked firer remains');
  assert.equal(gated.groups[0].members[0].shipId, 'F2');
});
