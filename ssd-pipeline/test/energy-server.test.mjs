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
