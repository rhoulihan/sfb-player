import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const POST = b => fetch(`${BASE}/api/battle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
const GET = (q = '') => fetch(`${BASE}/api/battle${q}`).then(r => r.json());

test('energy phase: sealed lockEnergy → resolve → impulse, with eaf fog of war', async (t) => {
  const child = spawn('python3', ['ssd-pipeline/serve.py'], { env: { ...process.env, SFB_PORT: String(PORT) }, stdio: 'ignore' });
  t.after(() => { child.kill(); try { fs.rmSync('ssd-pipeline/data/_battle.json'); } catch {} });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/ships`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

  await POST({ kind: 'new', turn: 1, impulse: 0,
    fleets: { friendly: { name: 'Fed', code: 'FFFF' }, enemy: { name: 'Kli', code: 'KKKK' } },
    plans: { friendly: { groups: [] }, enemy: { groups: [] } }, eaf: {},
    ships: [{ id: 'F1', side: 'friendly', map: { q: 1, r: 1 } }, { id: 'E1', side: 'enemy', map: { q: 2, r: 1 } }] });

  assert.equal((await GET('?code=FFFF')).phase, 'energy', 'new battle opens in energy phase');

  const a = await POST({ code: 'FFFF', kind: 'lockEnergy', eaf: { F1: { lifeSupport: 1, movement: 8 } } });
  assert.ok(!a.body.resolve, 'first fleet lock does not complete the set');

  const b = await POST({ code: 'KKKK', kind: 'lockEnergy', eaf: { E1: { lifeSupport: 1, movement: 4 } } });
  assert.equal(b.body.resolve, true, 'second fleet lock completes the set → resolver');
  assert.ok(b.body.eaf.F1 && b.body.eaf.E1, 'resolver is handed both fleets’ eaf');

  const fed = await GET('?code=FFFF');   // fog of war: fed sees its own eaf, not the enemy's
  assert.ok(fed.eaf.F1, 'fed sees its own eaf');
  assert.ok(!fed.eaf.E1, 'fed does NOT see the enemy eaf');

  await POST({ code: 'KKKK', kind: 'energyResolved', phase: 'impulse',
    ships: [{ id: 'F1', side: 'friendly', map: { q: 1, r: 1, speed: 8 } }, { id: 'E1', side: 'enemy', map: { q: 2, r: 1, speed: 4 } }] });
  assert.equal((await GET('?code=FFFF')).phase, 'impulse', 'phase flips to impulse once resolved');
});

test('movement-plot fog of war: plots are hidden from the other commander and survive their wholesale writes', async (t) => {
  const child = spawn('python3', ['ssd-pipeline/serve.py'], { env: { ...process.env, SFB_PORT: String(PORT) }, stdio: 'ignore' });
  t.after(() => { child.kill(); try { fs.rmSync('ssd-pipeline/data/_battle.json'); } catch {} });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/ships`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

  await POST({ kind: 'new', turn: 1, impulse: 0,
    fleets: { friendly: { name: 'Fed', code: 'FFFF' }, enemy: { name: 'Kli', code: 'KKKK' } },
    plans: { friendly: { groups: [] }, enemy: { groups: [] } }, eaf: {},
    ships: [{ id: 'F1', side: 'friendly', map: { q: 1, r: 1 } }, { id: 'E1', side: 'enemy', map: { q: 2, r: 1 } }] });

  // the Fed commander plots a course for F1
  const course = { start: { q: 1, r: 1, facing: 0 }, steps: [{ q: 1, r: 2, facing: 0 }] };
  await POST({ code: 'FFFF', kind: 'edit', ships: [{ id: 'F1', side: 'friendly', rev: 0, map: { q: 1, r: 1 }, course, speedPlot: { base: 8, changes: [] }, autopilot: true }] });

  // fog: the Klingon commander's view must NOT contain F1's plot; the Fed commander's must
  const kli = await GET('?code=KKKK');
  const kliF1 = kli.ships.find(s => s.id === 'F1');
  assert.ok(!('course' in kliF1) && !('speedPlot' in kliF1) && !('autopilot' in kliF1), 'enemy plots are stripped from the view');
  const fed = await GET('?code=FFFF');
  assert.deepEqual(fed.ships.find(s => s.id === 'F1').course, course, 'own plots are visible');

  // the Klingon commander resolves energy and posts ALL ships — with no knowledge of F1's plot (course null).
  // The server must preserve the Fed fleet's plot fields rather than let them be wiped.
  await POST({ code: 'KKKK', kind: 'energyResolved', phase: 'impulse', ships: [
    { id: 'F1', side: 'friendly', map: { q: 1, r: 1, speed: 8 }, course: null, speedPlot: null, autopilot: false },
    { id: 'E1', side: 'enemy', map: { q: 2, r: 1, speed: 4 }, course: { start: { q: 2, r: 1, facing: 3 }, steps: [{ q: 2, r: 2, facing: 3 }] } },
  ] });
  const fed2 = await GET('?code=FFFF');
  const f1 = fed2.ships.find(s => s.id === 'F1');
  assert.deepEqual(f1.course, course, 'first locker keeps their programmed path after the resolver folds');
  assert.equal(f1.autopilot, true, 'autopilot intent preserved too');
  assert.ok(!('course' in fed2.ships.find(s => s.id === 'E1')), 'the enemy course stays fogged from the Fed view');

  // a mid-impulse step from the Fed commander (who cannot see E1's plot) must not wipe E1's course either
  await POST({ code: 'FFFF', kind: 'step', turn: 1, impulse: 2, ships: [
    { id: 'F1', side: 'friendly', map: { q: 1, r: 2, speed: 8 }, course },
    { id: 'E1', side: 'enemy', map: { q: 2, r: 2, speed: 4 }, course: null },
  ] });
  const kli2 = await GET('?code=KKKK');
  assert.ok(kli2.ships.find(s => s.id === 'E1').course, "the other side's step does not wipe my plot");
});

test('impulse round protocol: fogged intents, owner moves, finisher seekers, idempotent advance', async (t) => {
  const child = spawn('python3', ['ssd-pipeline/serve.py'], { env: { ...process.env, SFB_PORT: String(PORT) }, stdio: 'ignore' });
  t.after(() => { child.kill(); try { fs.rmSync('ssd-pipeline/data/_battle.json'); } catch {} });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/ships`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

  await POST({ kind: 'new', turn: 1, impulse: 1, phase: 'impulse',
    fleets: { friendly: { name: 'Fed', code: 'FFFF' }, enemy: { name: 'Kli', code: 'KKKK' } },
    plans: { friendly: { groups: [] }, enemy: { groups: [] } }, eaf: {},
    ships: [{ id: 'F1', side: 'friendly', map: { q: 1, r: 1 } }, { id: 'E1', side: 'enemy', map: { q: 2, r: 1 } }] });

  // Fed declares first: fire=true. Before the Klingon declares, the Klingon view shows only a submitted flag.
  const fedIntent = { fire: true, activity: {}, het: false, decel: false, idleImpulses: 0 };
  await POST({ code: 'FFFF', kind: 'intent', turn: 1, impulse: 1, intent: fedIntent });
  let kli = await GET('?code=KKKK');
  assert.equal(kli.round.submitted.friendly, true, 'the Klingon sees THAT the Fed declared');
  assert.ok(!kli.round.myIntent, 'the Klingon has not declared');
  assert.ok(!kli.round.announced, 'no announcements until every fleet has declared (B2.4)');
  assert.ok(!JSON.stringify(kli.round).includes('"fire":true'), 'the CONTENT of the Fed intent is fogged');

  // Klingon declares nothing → announcements appear for both
  await POST({ code: 'KKKK', kind: 'intent', turn: 1, impulse: 1, intent: { fire: false, activity: {}, idleImpulses: 0 } });
  kli = await GET('?code=KKKK');
  assert.deepEqual(kli.round.announced.fire, ['friendly'], 'fire declaration announced once all intents are in');
  assert.deepEqual(kli.round.announced.activity, [], 'no activity declared by anyone');

  // each fleet posts its OWN movement; the order is recorded so the last mover resolves seekers
  await POST({ code: 'KKKK', kind: 'moveDone', turn: 1, impulse: 1, ships: [{ id: 'E1', side: 'enemy', map: { q: 2, r: 2 } }] });
  await POST({ code: 'FFFF', kind: 'moveDone', turn: 1, impulse: 1, ships: [{ id: 'F1', side: 'friendly', map: { q: 1, r: 2 } }] });
  const fed = await GET('?code=FFFF');
  assert.equal(fed.round.moveDone.enemy.order, 1); assert.equal(fed.round.moveDone.friendly.order, 2);
  assert.equal(fed.ships.find(s => s.id === 'E1').map.q, 2, 'enemy move merged');
  assert.equal(fed.ships.find(s => s.id === 'E1').map.r, 2);

  // the finisher (Fed, order 2) resolves seekers — may carry enemy STATUS damage from impacts
  await POST({ code: 'FFFF', kind: 'seekerResult', turn: 1, impulse: 1, seekers: [],
    ships: [{ id: 'E1', side: 'enemy', map: { q: 2, r: 2 }, status: { destroyed: ['box1'], shields: [1, 2, 3, 4, 5, 6] } }] });
  const kli2 = await GET('?code=KKKK');
  assert.equal(kli2.round.seekersDone, true);
  assert.deepEqual(kli2.ships.find(s => s.id === 'E1').status.destroyed, ['box1'], 'impact damage applied to the enemy ship');

  // round advance is idempotent: both clients may post it; only the first mutates
  const a1 = await POST({ code: 'FFFF', kind: 'roundAdvance', turn: 1, impulse: 2, phase: 'impulse' });
  const a2 = await POST({ code: 'KKKK', kind: 'roundAdvance', turn: 1, impulse: 2, phase: 'impulse' });
  assert.equal(a1.body.ok, true); assert.equal(a2.body.ok, true);
  const after = await GET('?code=FFFF');
  assert.equal(after.impulse, 2, 'clock advanced once');
  assert.ok(!after.round, 'stale round cleared for the fresh impulse');
});
