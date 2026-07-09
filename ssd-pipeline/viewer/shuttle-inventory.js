// Shuttle inventory & damage (C6 / J1 / J17). A shuttle is a small unit with hit points that vary by kind;
// advanced shuttles (post-Y179, J17) add 2 HP (the "A" boxes on the SSD). Pure helpers over a shuttle
// token; the host owns launching, wiring point-defense/fire into damage, and syncing the inventory.
export const SHUTTLE_HP = { admin: 6, heavy: 8 };   // base hit points per shuttle kind (rulebook)
export const ADVANCED_BONUS = 2;                    // advanced shuttles add the 2 "A" boxes (J17)

export function shuttleMaxHp(kind = 'admin', advanced = false) {
  return (SHUTTLE_HP[kind] ?? SHUTTLE_HP.admin) + (advanced ? ADVANCED_BONUS : 0);
}

export function makeShuttle(id, kind = 'admin', advanced = false) {
  const maxHp = shuttleMaxHp(kind, advanced);
  return { id, kind, advanced: !!advanced, maxHp, hp: maxHp };
}

export function damageShuttle(shuttle, points) {
  return { ...shuttle, hp: Math.max(0, shuttle.hp - Math.max(0, points | 0)) };
}

export function shuttleDestroyed(shuttle) {
  return !shuttle || shuttle.hp <= 0;
}
