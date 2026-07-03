// Build a damage model for one ship from its verified.json (system families/types) + detection.json
// (box positions). Routes every group into shields, armor, a DAC pool, or the never-targets set.
import { TOKEN_FAMILY } from './dac.js';

// Families the DAC can never hit (D4.324) — shown on the SSD but never destroyed by a volley.
const NEVER = ['crew', 'boarding-party', 'ammo-track', 'cloaking-device', 'markers'];

// Family -> DAC pool token. Warp and hull are split by group type instead (see below). DRONE hits
// (D4.323) also destroy anti-drones/ESGs, so those families feed the DRONE pool.
const FAMILY_TOKEN = {
  'impulse-engine': 'IMPULSE', 'apr': 'APR', 'battery': 'BATT',
  'phaser': 'PHASER', 'heavy-weapon': 'TORP',
  'drone-rack': 'DRONE', 'anti-drone': 'DRONE', 'esg': 'DRONE',
  'bridge': 'BRIDGE', 'flag-bridge': 'FLAG', 'emergency-bridge': 'EMER', 'auxiliary-control': 'AUX',
  'security-station': 'SEC', 'sensor': 'SENSOR', 'scanner': 'SCANNER', 'damage-control': 'DAMCON',
  'lab': 'LAB', 'transporter': 'TRANS', 'tractor': 'TRAC', 'probe-launcher': 'PROBE', 'shuttle-bay': 'SHUTTLE',
  'cargo': 'CARGO', 'excess-damage': 'EXCESS', 'repair': 'REPAIR', 'mine-rack': 'MINE',
};

const warpToken = t => { t = (t || '').toLowerCase(); return t.includes('left') ? 'L_WARP' : t.includes('right') ? 'R_WARP' : 'C_WARP'; };
const hullToken = t => { t = (t || '').toLowerCase(); return (t.includes('forward') || /\bfore\b/.test(t)) ? 'F_HULL' : (t.includes('rear') || t.includes('aft')) ? 'R_HULL' : 'C_HULL'; };
const shieldNum = t => { const m = (t || '').match(/(\d)/); return m ? +m[1] : null; };

export function buildShipModel(verified, detection) {
  const boxById = {};
  for (const b of detection.boxes) boxById[b.id] = b;
  const pos = id => { const b = boxById[id]; return b ? [b.y, b.x] : [0, 0]; };

  const shields = {}, armor = { boxIds: [], destroyed: new Set() }, pools = {},
        neverTargets = new Set(), groupOf = {};
  const ensure = tok => (pools[tok] || (pools[tok] = { boxIds: [], destroyed: new Set() }));

  for (const g of verified.groups) {
    for (const id of g.boxIds) groupOf[id] = g;
    const fam = g.family;
    if (fam === 'shield') {
      const n = shieldNum(g.type);
      if (n) (shields[n] || (shields[n] = { boxIds: [], down: 0, max: 0 })).boxIds.push(...g.boxIds);
      continue;
    }
    if (fam === 'armor') { armor.boxIds.push(...g.boxIds); continue; }
    if (NEVER.includes(fam)) { neverTargets.add(fam); continue; }
    const tok = fam === 'warp-engine' ? warpToken(g.type)
              : fam === 'hull' ? hullToken(g.type)
              : FAMILY_TOKEN[fam];
    if (tok) ensure(tok).boxIds.push(...g.boxIds);
  }

  const order = ids => ids.slice().sort((a, b) => {
    const [ay, ax] = pos(a), [by, bx] = pos(b); return ay - by || ax - bx;
  });
  for (const t in pools) pools[t].boxIds = order(pools[t].boxIds);
  for (const n in shields) { shields[n].boxIds = order(shields[n].boxIds); shields[n].max = shields[n].boxIds.length; }
  armor.boxIds = order(armor.boxIds);
  NEVER.forEach(f => neverTargets.add(f));   // complete set for display/exclusion, present or not

  return { shields, armor, pools, neverTargets, groupOf, boxById };
}

// re-exported so consumers (allocator) share one source of truth
export { TOKEN_FAMILY };
