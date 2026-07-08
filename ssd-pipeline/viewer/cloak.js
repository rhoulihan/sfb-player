// Cloaking device (C8 / G13). While cloaked, a ship is very hard to lock and to hit — it adds a large
// ECM-equivalent that flows through the shared netEcm hook (so lock-on and effective range both suffer) —
// but it cannot fire its own direct-fire weapons. That trade (near-untargetable vs. can't shoot) is the
// whole tactical point of the cloak, and it's what makes the plasma-armed Romulan playable.
export const CLOAK_ECM = 5;   // added to net ECM against a cloaked ship: lock succeeds only on a low roll (roll + 5 <= 6)

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
