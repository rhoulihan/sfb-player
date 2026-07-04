// Turn a ship's verified SSD data into a firing loadout: individual weapon mounts + shield strengths.
export function weaponClassOf(group) {
  const t = (group.type || '').toLowerCase(), fam = group.family || '';
  if (fam === 'phaser') {
    if (/\b3\b|phaser-3|ph-3/.test(t)) return 'PH-3';
    if (/\b2/.test(t) || /2k/.test(t)) return 'PH-2';
    return 'PH-1';
  }
  if (fam === 'heavy-weapon') {
    if (t.includes('disr')) return 'DISR';
    if (t.includes('photon')) return 'PHOTON';
  }
  return null;    // seeking weapons (drone/plasma), non-weapons → excluded from direct fire
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
