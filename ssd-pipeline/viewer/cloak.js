// Cloaking device (C8 / G13). While cloaked a ship cannot be locked on (G13.301) and cannot fire, launch, tractor,
// or transport (G13.51/G13.133). Fire AT a cloaked ship uses the cloak shift alone — ECM/ECCM are ignored (G13.303).
// The host reads CLOAK_ECM as the cloak's fire-penalty strength (netEcmOf), and denies the lock outright when
// cloaked. That trade (untargetable vs. can't shoot) is the tactical point of the cloak and makes the Romulan playable.
export const CLOAK_ECM = 5;   // cloak fire-penalty strength → die shift ewShift(5)=2 (G13.37 approximation); ECCM cannot erode it

export function cloakEcm(ship) {
  return ship && ship.cloaked ? CLOAK_ECM : 0;
}

export function cloakBlocksFire(ship) {
  return !!(ship && ship.cloaked);
}

// drop fire from cloaked firers (a cloaked ship holds its fire), then any group left empty
export function applyCloakFireGate(plan, byId) {
  return {
    groups: (plan.groups || [])
      .map(g => ({ ...g, members: (g.members || []).filter(m => !cloakBlocksFire(byId(m.shipId))) }))
      .filter(g => g.members.length),
  };
}
