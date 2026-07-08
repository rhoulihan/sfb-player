// Mines & boarding (C10/D15) — a lightweight slice. A mine is a static token (owner side, hex, warhead,
// trigger radius) that detonates on the nearest enemy ship inside its radius; the host hands the hit to the
// DAC. Hit-and-run is a transporter raid resolved by a die roll. Uses true (unfloored) cube distance so the
// radius is exact. Pure functions; the host owns laying, per-impulse checking, and applying damage.
const toCube = (q, r) => { const x = q, z = r - (q - (q & 1)) / 2; return { x, y: -x - z, z }; };
const dist = (a, b) => {
  const A = toCube(a.q, a.r), B = toCube(b.q, b.r);
  return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z));
};

export const MINE = { warhead: 20, radius: 1 };   // functional sandbox values, not rulebook tables

// the nearest enemy ship (side !== mine.side) within the mine's trigger radius, or null
export function mineTriggeredBy(mine, ships) {
  const r = mine.radius ?? 1;
  const hits = (ships || []).filter(s => s.side !== mine.side && dist(mine, s) <= r);
  return hits.sort((a, b) => dist(mine, a) - dist(mine, b))[0] || null;
}

// a hit-and-run / boarding raid succeeds on 4+ (1d6) — the host then knocks out a random enemy system
export function hitAndRunSucceeds(roll) {
  return roll >= 4;
}

// Self-destruct (D19) — the ship explodes, hitting every other ship in the blast radius; damage falls off
// with distance. The host applies the hits through the DAC and removes the exploding ship.
export const SELF_DESTRUCT = { radius: 2, warhead: 30 };
export function selfDestructHits(ship, ships, radius = SELF_DESTRUCT.radius) {
  return (ships || []).filter(s => s.id !== ship.id && dist(ship, s) <= radius);
}
export function selfDestructDamage(distance, warhead = SELF_DESTRUCT.warhead) {
  return Math.max(0, Math.round(warhead / Math.max(1, distance)));
}
