// Mines (M2.0 nuclear space mines / M3.0 transporter bombs) & boarding (D15) — a lightweight slice. A mine is a static
// token (owner, side, hex, warhead, trigger radius) that, once armed, detonates on the nearest unit inside its radius
// regardless of side (M2.23); the host hands the hit to the DAC. Hit-and-run is a transporter raid resolved by a die
// roll (D7.8). Uses true (unfloored) cube distance so the radius is exact. Pure functions; the host owns laying,
// per-impulse checking, and applying damage.
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

export const MINE_DETECTION_RANGE = 2;   // M2.35 (Basic Set): the dropper arms the mine by moving two hexes away — no longer in the mine's hex or an adjacent one

// M2.31: a mine arms automatically the instant the unit that dropped it leaves the mine's Detection Range (two hexes,
// M2.35). Once armed it stays armed even if the dropper returns. The host latches mine.armed once this returns true.
export function mineShouldArm(mine, ships) {
  if (mine.armed) return true;
  const dropper = (ships || []).find(s => s.id === mine.owner);
  return !dropper || dist(dropper, mine) >= MINE_DETECTION_RANGE;   // dropper gone or ≥2 hexes away → arms
}

// M2.23 NEUTRALITY: once armed, a mine is neutral — it triggers against ANY unit within its radius, friend or foe,
// including the unit that dropped it (mines cannot be set to accept only enemy units). M2.31: it is inert until armed.
// Returns the nearest triggering unit, or null.
export function mineTriggeredBy(mine, ships) {
  if (!mine || !mine.armed) return null;   // M2.31: inert until the dropper leaves the detection range
  const r = mine.radius ?? 1;
  const hits = (ships || []).filter(s => dist(mine, s) <= r);   // no side filter — a dropped mine is neutral (M2.23)
  return hits.sort((a, b) => dist(mine, a) - dist(mine, b))[0] || null;
}

// D7.81 hit-and-run raid chart (1d6): 1 = the designated system is destroyed, the boarding party returns; 2 = both
// the system and the party are destroyed; 3-5 = the party is destroyed, the system survives; 6 = the party returns
// with nothing accomplished. The system is knocked out only on 1 or 2.
export function hitAndRunResult(roll) {
  if (roll === 1) return { systemDestroyed: true, partyLost: false };
  if (roll === 2) return { systemDestroyed: true, partyLost: true };
  if (roll >= 3 && roll <= 5) return { systemDestroyed: false, partyLost: true };
  return { systemDestroyed: false, partyLost: false };
}
// Back-compat: "did the raid knock out the target system?" — true only on the 1-2 rolls (D7.81).
export function hitAndRunSucceeds(roll) {
  return hitAndRunResult(roll).systemDestroyed;
}

// Self-destruct (D5) — the ship explodes, hitting every other ship in the blast radius; damage falls off
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
