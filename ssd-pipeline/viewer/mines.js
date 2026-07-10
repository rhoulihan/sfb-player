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
export const NUCLEAR_MINE = { warhead: 40, radius: 2 };   // C10: a heavier nuclear space mine — bigger blast, wider trigger
export const TRANSPORTER_RANGE = 5;   // G8.14: the maximum range of transporters is five hexes
export const TBOMB_WARHEAD = 10;      // M3.0: the transporter bomb has a yield of ten damage points

// the nearest enemy within transporter range — where a transporter bomb is beamed
export function transporterTarget(ship, ships, range = TRANSPORTER_RANGE) {
  const hits = (ships || []).filter(s => s.side !== ship.side && dist(ship, s) <= range);
  return hits.sort((a, b) => dist(ship, a) - dist(ship, b))[0] || null;
}

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
// Self-destruction (D5). A ship's Basic Explosion Strength (BES, D5.2/D5.41) comes from the Master Ship Chart —
// it is a per-ship value captured in verified.json, never a fixed constant. DEFAULT_BES is only a fallback when a
// ship's chart value has not been entered yet.
export const DEFAULT_BES = 30;
export const SELF_DESTRUCT = { warhead: DEFAULT_BES };   // legacy alias for the fallback strength
// D5.41: BES ≥ 10 → the exploding hex plus the six around it (radius 1); BES ≤ 9 → the exploding hex only.
export function selfDestructZone(bes = DEFAULT_BES) { return bes >= 10 ? 1 : 0; }
export function selfDestructHits(ship, ships, radius) {
  const r = radius == null ? selfDestructZone(DEFAULT_BES) : radius;
  return (ships || []).filter(s => s.id !== ship.id && dist(ship, s) <= r);
}
// D5.41: every unit in the blast zone takes the FULL BES on its facing shield — there is no distance falloff.
export function selfDestructDamage(bes = DEFAULT_BES) { return Math.max(0, Math.round(bes)); }
