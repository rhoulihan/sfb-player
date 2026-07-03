// Damage allocator (SFB rules D3.6–D4.4). Pure: applyVolley mutates the given model (marking
// boxes destroyed, shields down) and returns an ordered list of effects for the UI to play back.
import { DAC, TOKEN_FAMILY } from './dac.js';
import { arcBearsToShield } from './arc-geom.js';

const FAM = { ...TOKEN_FAMILY, SEC: 'security-station', REPAIR: 'repair', MINE: 'mine-rack', C_HULL: 'hull' };

const firstLive = pool => {
  if (!pool) return null;
  for (const id of pool.boxIds) if (!pool.destroyed.has(id)) return id;
  return null;
};
const liveCount = pool => (pool ? pool.boxIds.length - pool.destroyed.size : 0);
const phaserRank = type => { const t = (type || '').toLowerCase(); return t.includes('3') ? 3 : t.includes('2') ? 2 : 1; };

/** roll two dice via an injected source: rollFn() returns a 2d6 total (2–12). */
export function makeDice(rand = Math.random) {
  return () => 1 + Math.floor(rand() * 6) + 1 + Math.floor(rand() * 6);
}

// pick a live target box for a DAC token, honoring directional/track/hull rules.
// returns {boxId, pool, token} or null (no live target -> caller advances a column).
function pickTarget(model, tok, ctx) {
  const P = model.pools;
  const live = key => { const id = firstLive(P[key]); return id ? { boxId: id, pool: P[key], token: tok } : null; };

  if (tok === 'PHASER') return pickPhaser(model, ctx);
  if (tok === 'TORP') return pickWeaponByType(P.TORP, ctx.torpHits, tok, model);
  if (tok === 'FLAG') return live('FLAG') || live('SEC');                 // flag hits score on security if no flag bridge
  if (tok === 'ANY_WARP') return live('L_WARP') || live('R_WARP') || live('C_WARP');
  if (tok === 'ANY_WEAPON') return live('PHASER') || live('TORP') || live('DRONE');
  if (tok === 'F_HULL') return live('F_HULL') || live('C_HULL');          // D4.351: C hull absorbs F/R
  if (tok === 'R_HULL') return live('R_HULL') || live('C_HULL');
  if (tok === 'SENSOR' || tok === 'SCANNER' || tok === 'DAMCON')          // D4.33: last box never destroyed
    return liveCount(P[tok]) > 1 ? live(tok) : null;
  return live(tok);
}

function pickPhaser(model, ctx) {
  const pool = model.pools.PHASER;
  if (!pool) return null;
  const cands = pool.boxIds.filter(id => !pool.destroyed.has(id) &&
    arcBearsToShield((model.groupOf[id] || {}).arcDef, ctx.shield));
  if (!cands.length) return null;
  cands.sort((a, b) => phaserRank((model.groupOf[a] || {}).type) - phaserRank((model.groupOf[b] || {}).type));
  // D4.3221: every 3rd phaser hit must be the best type; otherwise preserve the best (take worst).
  const box = (ctx.phaserHits % 3 === 2) ? cands[0] : cands[cands.length - 1];
  return { boxId: box, pool, token: 'PHASER' };
}

function pickWeaponByType(pool, hitCount, tok, model) {
  if (!pool) return null;
  const cands = pool.boxIds.filter(id => !pool.destroyed.has(id));
  if (!cands.length) return null;
  // D4.3222: every 3rd hit on the best type; otherwise take any (front of pool, already position-ordered).
  return { boxId: cands[0], pool, token: tok };
}

function scoreExcess(model) {                                             // D4.36 / D4.40
  for (const key of ['EXCESS', 'CARGO', 'REPAIR', 'MINE']) {
    const id = firstLive(model.pools[key]);
    if (id) { model.pools[key].destroyed.add(id); return { type: 'destroy', token: key, family: FAM[key], boxId: id }; }
  }
  return null;                                                           // nothing left to absorb -> ship destroyed
}

export function applyVolley(model, params, rollFn) {
  const { shield, points, leaky = false, leakRate = 4 } = params;
  const roll = rollFn || makeDice();
  const effects = [];

  // 1. Shield phase (+ leaky shields, D3.61–63)
  const sh = model.shields[shield] || { boxIds: [], max: 0, down: 0 };
  let internal = 0;
  if (!leaky) {
    const toShield = Math.min(points, sh.max - sh.down);
    for (let i = 0; i < toShield; i++) { sh.down++; effects.push({ type: 'shield', shield, box: sh.boxIds[sh.down - 1] }); }
    internal = points - toShield;
  } else {
    let leaked = 0, excess = 0;
    for (let i = 1; i <= points; i++) {
      if (sh.max - sh.down <= 0) excess++;                               // shield already down
      else if (i % leakRate === 0) leaked++;                            // this point leaks internally
      else { sh.down++; effects.push({ type: 'shield', shield, box: sh.boxIds[sh.down - 1] }); }
    }
    internal = leaked + excess;                                          // combined into one internal volley (D3.62)
  }

  // 2. Armor phase (D4.12)
  const armor = model.armor || { boxIds: [], destroyed: new Set() };
  while (internal > 0 && armor.destroyed.size < armor.boxIds.length) {
    const box = armor.boxIds[armor.destroyed.size]; armor.destroyed.add(box);
    effects.push({ type: 'armor', box }); internal--;
  }

  // 3. Internal DAC phase (D4.22)
  const boldUsed = new Set(); const ctx = { shield, phaserHits: 0, torpHits: 0 };
  for (let p = 0; p < internal; p++) {
    const r = roll();
    const cols = DAC[r] || [];
    let hit = null;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      if (col.sys === 'EXCESS') break;                                   // reached the excess column
      if (col.bold && boldUsed.has(r + ':' + ci)) continue;              // D4.31: bold once per volley
      const t = pickTarget(model, col.sys, ctx);
      if (!t) continue;                                                  // no live target -> next column
      t.pool.destroyed.add(t.boxId);
      if (col.bold) boldUsed.add(r + ':' + ci);
      if (col.sys === 'PHASER') ctx.phaserHits++;
      if (col.sys === 'TORP') ctx.torpHits++;
      effects.push({ type: 'destroy', token: col.sys, family: FAM[col.sys], boxId: t.boxId });
      hit = t; break;
    }
    if (!hit) {
      const ex = scoreExcess(model);
      if (!ex) { effects.push({ type: 'shipDestroyed' }); return effects; }
      effects.push(ex);
    }
  }
  return effects;
}
