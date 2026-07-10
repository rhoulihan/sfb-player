import { hasLockOn } from './battle-phase.js';

// Sensor lock-on (D6). A firer rolls 1d6 to acquire each target; the `lockDeny` modifier raises the bar.
// D6.112: ELECTRONIC WARFARE ONLY DEGRADES WEAPON EFFECT — IT CANNOT BREAK A LOCK. So ECM/ECCM must NOT feed
// this roll (that effect is a fire-time die shift, ew.js/D6.35). Only cloak (G13.301) and terrain break a lock;
// the host passes a cloak/terrain-only penalty. At penalty 0 the lock is automatic (tournament fire control).
export function attemptLock(roll, lockDeny = 0) {
  return roll + Math.max(0, lockDeny) <= 6;
}

// Roll locks for every firer against every enemy target (never itself). lockDeny(firer, target) supplies the
// lock-BREAKING modifier — cloak/terrain only (NOT ECM, per D6.112). Returns { firerId: Set<targetId> }.
export function resolveLocks(firers, targets, rng, lockDeny = () => 0) {
  const locks = {};
  for (const f of firers) {
    const set = new Set();
    for (const t of targets) if (t.id !== f.id && attemptLock(rng.d6(), lockDeny(f, t))) set.add(t.id);
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
