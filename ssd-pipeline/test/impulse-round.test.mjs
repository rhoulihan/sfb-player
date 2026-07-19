import test from 'node:test';
import assert from 'node:assert/strict';
import { roundPhase, emptyIntent, idleCovers } from '../viewer/impulse-round.js';

// One impulse round (B2.2 procedure 6): both fleets declare intentions (B2.4 secret-simultaneous),
// each executes its OWN movement (plot fog — no client knows the other's course), the last mover
// resolves seekers, then only DECLARED segments pause (6B activity, 6D fire). Everything else skips.
const FLEETS = ['friendly', 'enemy'];
const intent = over => ({ ...emptyIntent(), ...over });

test('intent stage: the round waits for every fleet\'s declaration', () => {
  assert.deepEqual(roundPhase({ intents: {} }, FLEETS), { seg: 'intent', waitingOn: FLEETS, skips: [] });
  const one = roundPhase({ intents: { friendly: intent() } }, FLEETS);
  assert.equal(one.seg, 'intent');
  assert.deepEqual(one.waitingOn, ['enemy'], 'only the missing fleet is waited on');
});

test('6A movement: each fleet must post its own moves; nothing-declared rounds skip 6B and 6D', () => {
  const facts = { intents: { friendly: intent(), enemy: intent() }, moveDone: {} };
  const r = roundPhase(facts, FLEETS);
  assert.equal(r.seg, '6A');
  assert.deepEqual(r.waitingOn, FLEETS);
  assert.deepEqual([...r.skips].sort(), ['6B', '6D'], 'no activity + no fire declared → both interactive segments skip');
  const half = roundPhase({ ...facts, moveDone: { friendly: { order: 1 } } }, FLEETS);
  assert.deepEqual(half.waitingOn, ['enemy']);
});

test('6A4 seekers: the LAST fleet to post movement is the designated finisher', () => {
  const facts = { intents: { friendly: intent(), enemy: intent() },
    moveDone: { friendly: { order: 2 }, enemy: { order: 1 } }, seekersDone: false };
  const r = roundPhase(facts, FLEETS);
  assert.equal(r.seg, '6A4');
  assert.deepEqual(r.waitingOn, ['friendly'], 'friendly posted last (order 2) → it resolves seekers/impacts');
});

test('6B activity: pauses only for fleets that declared activity; others are auto-done', () => {
  const facts = { intents: { friendly: intent({ activity: { shuttles: true } }), enemy: intent() },
    moveDone: { friendly: { order: 1 }, enemy: { order: 2 } }, seekersDone: true, segDone: {} };
  const r = roundPhase(facts, FLEETS);
  assert.equal(r.seg, '6B');
  assert.deepEqual(r.waitingOn, ['friendly'], 'only the declaring fleet must act and mark Done');
  assert.ok(!r.skips.includes('6B') && r.skips.includes('6D'));
  const done = roundPhase({ ...facts, segDone: { '6B': { friendly: true } } }, FLEETS);
  assert.equal(done.seg, 'done', 'activity finished, no fire declared → round complete');
});

test('6D fire: pauses for the declaring fleet\'s commit via the existing protocol', () => {
  const facts = { intents: { friendly: intent(), enemy: intent({ fire: true }) },
    moveDone: { friendly: { order: 1 }, enemy: { order: 2 } }, seekersDone: true, segDone: {}, fireCommitted: {} };
  const r = roundPhase(facts, FLEETS);
  assert.equal(r.seg, '6D');
  assert.deepEqual(r.waitingOn, ['enemy'], 'only the declared firer must commit; the other auto-commits empty');
  assert.ok(r.skips.includes('6B') && !r.skips.includes('6D'));
  const committed = roundPhase({ ...facts, fireCommitted: { enemy: true } }, FLEETS);
  assert.equal(committed.seg, '6D');
  assert.deepEqual(committed.waitingOn, [], 'all declarers committed → resolution in flight, nothing to click');
  const done = roundPhase({ ...facts, fireCommitted: { enemy: true }, fireResolved: true }, FLEETS);
  assert.equal(done.seg, 'done', 'one fire exchange per impulse — done once RESOLVED, not merely committed');
});

test('a fully quiet round runs straight to done once movement and seekers are in', () => {
  const r = roundPhase({ intents: { friendly: intent(), enemy: intent() },
    moveDone: { friendly: { order: 1 }, enemy: { order: 2 } }, seekersDone: true }, FLEETS);
  assert.equal(r.seg, 'done');
});

test('idleCovers: "next N impulses" and "rest of turn" windows', () => {
  const n3 = intent({ idleImpulses: 3 });
  assert.ok(!idleCovers(n3, 5, 5), 'the submitting impulse itself is the declared (empty) intent, not auto-covered');
  assert.ok(idleCovers(n3, 5, 6) && idleCovers(n3, 5, 8), 'covers the NEXT 3 impulses (6, 7, 8)');
  assert.ok(!idleCovers(n3, 5, 9), 'impulse 9 is past the window');
  const turn = intent({ idleImpulses: 'turn' });
  assert.ok(idleCovers(turn, 5, 32) && !idleCovers(turn, 5, 33), 'rest of turn caps at impulse 32');
  assert.ok(!idleCovers(intent(), 5, 6), 'no idle window → nothing auto-covered');
});
