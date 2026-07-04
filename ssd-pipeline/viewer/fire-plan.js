// Fire-group / attack-plan state for the direct-fire sandbox. A MOUNT belongs to at most one fire
// group; a SHIP may span groups (split-fire). Pure — no DOM.
import { isInArc, exposedShield, hexDistance } from './battle-geom.js';
import { WEAPONS, bandIndex } from './weapon-charts.js';

export const newPlan = () => ({ groups: [], committed: false });
export const newGroup = (id, color) => ({ id, color, targetShipId: null, members: [] });

export function mountEligibility(firer, mount, target) {
  const { inArc, covering } = isInArc(firer, mount, target);
  const trueRange = hexDistance(firer, target);
  const def = WEAPONS[mount.cls];
  const inRange = !!def && trueRange <= def.maxRange && !(def.minRange && trueRange < def.minRange)
                  && bandIndex(def, trueRange) >= 0;
  const available = inArc && inRange;
  return { mountId: mount.id, inArc, coveringArc: covering, trueRange, inRange, available,
           struckShield: available ? exposedShield(firer, target) : undefined };
}

const member = (group, shipId) => group.members.find(m => m.shipId === shipId);

function findMount(plan, mountId) {
  for (const g of plan.groups) for (const m of g.members) {
    const i = m.mountIds.indexOf(mountId);
    if (i >= 0) return { g, m, i };
  }
  return null;
}

export function assignMount(plan, groupId, shipId, mountId, opts = {}) {
  const found = findMount(plan, mountId);
  if (found && found.g.id !== groupId && !opts.force) return { conflict: { fromGroupId: found.g.id } };
  if (found) {                                            // remove from its current group (same-group re-add or forced steal)
    found.m.mountIds.splice(found.i, 1);
    if (!found.m.mountIds.length) found.g.members = found.g.members.filter(x => x !== found.m);
  }
  const g = plan.groups.find(x => x.id === groupId); if (!g) return {};
  const mm = member(g, shipId) || (g.members.push({ shipId, mountIds: [] }), member(g, shipId));
  if (!mm.mountIds.includes(mountId)) mm.mountIds.push(mountId);
  return {};
}

export function unassignMount(plan, groupId, shipId, mountId) {
  const g = plan.groups.find(x => x.id === groupId); const mm = g && member(g, shipId);
  if (mm) {
    mm.mountIds = mm.mountIds.filter(id => id !== mountId);
    if (!mm.mountIds.length) g.members = g.members.filter(x => x !== mm);
  }
}

export function planEligibility(plan) {
  const map = new Map();
  for (const g of plan.groups) for (const m of g.members) for (const id of m.mountIds)
    map.set(id, { assignedGroupId: g.id });
  return map;
}

// expected (pre-roll) damage for the preview: phasers average over the 6 equally-likely die rows;
// hit-or-miss bolts weight the warhead by hit probability (so photons don't count as guaranteed hits)
function nominal(cls, trueRange) {
  const def = WEAPONS[cls]; if (!def) return 0;
  const bi = bandIndex(def, trueRange); if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') {
    const col = def.effectGrid.map(row => row[bi] || 0);
    return col.reduce((a, v) => a + v, 0) / col.length;
  }
  const hb = def.hitBand1d[bi]; if (!hb) return 0;
  return ((hb[1] - hb[0] + 1) / 6) * (def.fixedDamage[bi] || 0);
}

export function combinedPreview(group, ships, shipMounts) {
  const target = ships.find(s => s.id === group.targetShipId); if (!target) return null;
  const perShield = {};
  for (const m of group.members) {
    const firer = ships.find(s => s.id === m.shipId); if (!firer) continue;
    const shield = exposedShield(firer, target); const range = hexDistance(firer, target);
    for (const id of m.mountIds) {
      const mount = (shipMounts[m.shipId] || []).find(x => x.id === id); if (!mount) continue;
      const slot = perShield[shield] || (perShield[shield] = { shield, nominal: 0, firers: new Set() });
      slot.nominal += nominal(mount.cls, range); slot.firers.add(m.shipId);
    }
  }
  const rows = Object.values(perShield).map(s => ({ shield: s.shield, nominal: s.nominal, firers: [...s.firers] }));
  return { targetShipId: group.targetShipId, perShield: rows, totalNominal: rows.reduce((a, r) => a + r.nominal, 0) };
}

export function expandPlanToIntents(plan) {
  const out = [];
  for (const g of plan.groups) for (const m of g.members) for (const id of m.mountIds)
    out.push({ firerShipId: m.shipId, weaponInstanceId: id,
      targetRef: { kind: 'unit', unitId: g.targetShipId }, segment: '6D-direct' });
  return out;
}
