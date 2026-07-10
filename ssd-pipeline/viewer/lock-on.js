import { hasLockOn } from './battle-phase.js';

// Sensor lock-on (D6). A firer rolls 1d6 to acquire each target; the `lockDeny` modifier raises the bar.
// D6.112: ELECTRONIC WARFARE ONLY DEGRADES WEAPON EFFECT — IT CANNOT BREAK A LOCK. So ECM/ECCM must NOT feed
// this roll (that effect is a fire-time die shift, ew.js/D6.35). Only cloak (G13.301) and terrain break a lock;
// the host passes a cloak/terrain-only penalty. At penalty 0 the lock is automatic (tournament fire control).
// D6.11: lock is achieved if the die is ≤ the firer's sensor rating (the highest unchecked box on the sensor
// track, usually 6). With intact sensors (rating 6) any d6 clears → automatic lock; a damaged sensor track can fail.
export function attemptLock(roll, lockDeny = 0, sensorRating = 6) {
  return roll + Math.max(0, lockDeny) <= sensorRating;
}

// Roll locks for every firer against every enemy target (never itself). lockDeny(firer, target) supplies the
// lock-BREAKING modifier — cloak/terrain only (NOT ECM, per D6.112). sensorRating(firer) is the firer's sensor
// track rating (D6.11). Returns { firerId: Set<targetId> }.
export function resolveLocks(firers, targets, rng, lockDeny = () => 0, sensorRating = () => 6) {
  const locks = {};
  for (const f of firers) {
    const set = new Set();
    for (const t of targets) if (t.id !== f.id && attemptLock(rng.d6(), lockDeny(f, t), sensorRating(f))) set.add(t.id);
    locks[f.id] = set;
  }
  return locks;
}

// Gate a fire plan against lock-on (D6.1). A firer that HAS a lock fires normally. A firer that FAILED lock-on to the
// target does NOT lose the shot — per D6.123 it fires at DOUBLE true range (tagged noLock, resolved by direct-fire),
// and only misses if that doubled range exceeds the weapon's max. The exception is a hard-denied target (cloak/terrain
// that cannot be locked at all): cloakedFn(targetShipId) reports those, and their unlocked members are dropped.
export function applyLockGate(plan, lockOn, cloakedFn = null) {
  return {
    groups: (plan.groups || [])
      .map(g => {
        const hardDenied = cloakedFn ? !!cloakedFn(g.targetShipId) : false;
        const members = (g.members || []).map(m =>
          hasLockOn(lockOn, m.shipId, g.targetShipId) ? m
            : hardDenied ? null                       // cloaked/terrain-obscured → cannot be forced (drop)
            : { ...m, noLock: true }                  // D6.123: no lock-on → fire at double range
        ).filter(Boolean);
        return { ...g, members };
      })
      .filter(g => g.members.length),
  };
}
