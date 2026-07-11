// SFB impulse movement (functional game-mechanics): the 32-impulse move chart as an even
// distribution, hex-neighbour stepping on the flat-top odd-q grid, and speed→turn-mode.

// A ship at `speed` moves on exactly `speed` of the 32 impulses, spread as evenly as possible —
// which is what the printed 32-Impulse Movement Chart encodes. `impulse` is 1..32.
export function movesOnImpulse(speed, impulse) {
  if (speed <= 0) return false;
  return Math.floor(impulse * speed / 32) > Math.floor((impulse - 1) * speed / 32);
}

// facing 0=SE 1=S 2=SW 3=NW 4=N 5=NE — odd-q offset neighbour one hex in the facing direction.
const NB = {
  0: [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],   // even column (q & 1 === 0)
  1: [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]],     // odd column (q & 1 === 1)
};
export function neighbor(q, r, facing) { const o = NB[q & 1][facing]; return { q: q + o[0], r: r + o[1] }; }

// C3.31 TURN MODE CHART: hexes a unit must move straight between turns, by turn-mode category AND speed
// (transcribed from the rulebook chart). Each entry is [upper-speed-of-bracket, turnMode]; speed 0-1 = TM 0.
export const TURN_CHART = {
  AA: [[1, 0], [8, 1], [16, 2], [24, 3], [31, 4]],
  A:  [[1, 0], [6, 1], [12, 2], [19, 3], [26, 4], [31, 5]],
  B:  [[1, 0], [5, 1], [10, 2], [15, 3], [21, 4], [28, 5], [31, 6]],
  C:  [[1, 0], [4, 1], [9, 2], [14, 3], [20, 4], [27, 5], [31, 6]],
  D:  [[1, 0], [4, 1], [8, 2], [12, 3], [17, 4], [24, 5], [31, 6]],
  E:  [[1, 0], [3, 1], [6, 2], [10, 3], [14, 4], [20, 5], [29, 6], [31, 7]],
  F:  [[1, 0], [3, 1], [5, 2], [9, 3], [13, 4], [17, 5], [23, 6], [29, 7], [31, 8]],   // tightest curve: 2-3/4-5/6-9/10-13/14-17/18-23/24-29/30+
};

// Turn mode for a unit of a given category at a given speed (C3.32).
export function turnModeFor(category, speed) {
  const chart = TURN_CHART[category] || TURN_CHART.C;
  for (const [maxSp, tm] of chart) if (speed <= maxSp) return tm;
  return chart[chart.length - 1][1];
}

// Legacy speed-only turn mode (defaults to category B — the Klingon D7 curve). Prefer turnModeFor(category, …).
export function turnMode(speed) { return turnModeFor('B', speed); }

// C2.21 MAXIMUM INCREASE: when allocating energy to movement a ship may raise its practical speed by no
// more than the previous turn's speed, or ten, whichever is greater. Returns the highest speed reachable
// next turn from `prevSpeed` (e.g. 3→13, 13→26). Reductions are unlimited (C2.22) so there is no floor.
export function accelCap(prevSpeed) { return prevSpeed + Math.max(prevSpeed, 10); }

// sanity helper: total hexes moved across a full 32-impulse turn (equals speed)
export function movesInTurn(speed) { let n = 0; for (let i = 1; i <= 32; i++) if (movesOnImpulse(speed, i)) n++; return n; }

// G7.36B TOWING PSEUDO-SPEED: a ship linked by tractor to one or more others must move the whole group,
// so its practical (pseudo) speed is its movement energy divided by the COMBINED movement cost of every
// linked ship, dropping fractional points. Both ships' movement power drives the pair (a disabled tow
// contributes 0). Capped because no ship generates more than 30 movement points from warp energy, so two
// cost-one ships peak at 15. `held` is [{energy, cost}] for each towed ship; empty → normal solo speed.
// (Simplification: we pool warp+impulse movement energy rather than model the smaller ship's ignored
//  impulse power separately, which our single per-ship movement-energy figure doesn't distinguish.)
export function pseudoSpeed(towerEnergy, towerCost, held = []) {
  if (!held.length) return Math.floor(towerEnergy / towerCost);
  const combinedCost = held.reduce((c, h) => c + h.cost, towerCost);
  const totalEnergy = held.reduce((e, h) => e + (h.energy || 0), towerEnergy);
  return Math.min(Math.floor(30 / combinedCost), Math.floor(totalEnergy / combinedCost));
}
