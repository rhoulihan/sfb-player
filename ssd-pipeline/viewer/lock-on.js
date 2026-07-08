import { hasLockOn } from './battle-phase.js';

// Sensor lock-on (D6). A firer rolls 1d6 to acquire each target; net ECM (target's ECM beyond the firer's
// ECCM, plus any cloak) raises the bar. At net-ECM 0 the lock is automatic (tournament fire control); EW and
// cloak are what make it fail — which is the whole point of rolling for it rather than fixed auto-lock.
export function attemptLock(roll, netEcm = 0) {
  return roll + Math.max(0, netEcm) <= 6;
}

// Roll locks for every firer against every enemy target (never itself). netEcm(firer, target) supplies the
// EW/cloak modifier (0 until EW-1/CLOAK-1 fill it). Returns { firerId: Set<targetId> }.
export function resolveLocks(firers, targets, rng, netEcm = () => 0) {
  const locks = {};
  for (const f of firers) {
    const set = new Set();
    for (const t of targets) if (t.id !== f.id && attemptLock(rng.d6(), netEcm(f, t))) set.add(t.id);
    locks[f.id] = set;
  }
  return locks;
}

// Gate a fire plan: a mount may only fire at a target its firer has a lock on (D6.1). Drops unlocked
// members, then empty groups.
export function applyLockGate(plan, lockOn) {
  return {
    groups: (plan.groups || [])
      .map(g => ({ ...g, members: (g.members || []).filter(m => hasLockOn(lockOn, m.shipId, g.targetShipId)) }))
      .filter(g => g.members.length),
  };
}
