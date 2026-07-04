// Turn a ship's verified SSD data into a firing loadout: individual weapon mounts + shield strengths.
// Handles both taxonomies seen in verified data: the granular one ('phaser' / 'heavy-weapon' family)
// and the older generic one ('weapon' family with the class named in `type`, e.g. GOR-CA).
const WEAPON_FAMS = new Set(['phaser', 'heavy-weapon', 'weapon']);
export function weaponClassOf(group) {
  const t = (group.type || '').toLowerCase(), fam = group.family || '';
  if (!WEAPON_FAMS.has(fam)) return null;
  if (/plasma|drone/.test(t)) return null;               // seeking weapons → not direct fire
  if (/disr/.test(t)) return 'DISR';
  if (/photon/.test(t)) return 'PHOTON';
  if (fam === 'phaser' || /phaser|ph-?\d/.test(t)) {     // phaser by family or by type name
    if (/\b3\b|phaser-?3|ph-?3/.test(t)) return 'PH-3';
    if (/\b2\b|phaser-?2|ph-?2|2k/.test(t)) return 'PH-2';
    return 'PH-1';
  }
  return null;    // unlabeled / non-direct-fire weapon box → skip
}

// shield-group facing: read a trailing digit in the type, e.g. "Shield 1" → 1 (fallback: sequential)
function shieldFacing(group, seq) {
  const m = (group.type || '').match(/([1-6])\b/);
  return m ? Number(m[1]) : seq;
}

export function shipLoadout(verified, detection) {
  const mounts = [], shields = [0, 0, 0, 0, 0, 0];
  let shieldSeq = 0;
  for (const g of verified.groups || []) {
    if (g.family === 'shield') {
      const n = shieldFacing(g, ++shieldSeq);
      if (n >= 1 && n <= 6) shields[n - 1] = (g.boxIds || []).length;
      continue;
    }
    const cls = weaponClassOf(g);
    if (!cls) continue;
    (g.boxIds || []).forEach((_, i) => mounts.push({ id: `${g.id}.${i}`, cls, arc: g.arcDef || { arcs: [g.arc] } }));
  }
  return { mounts, shields };
}
