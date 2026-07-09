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
};

// Turn mode for a unit of a given category at a given speed (C3.32).
export function turnModeFor(category, speed) {
  const chart = TURN_CHART[category] || TURN_CHART.C;
  for (const [maxSp, tm] of chart) if (speed <= maxSp) return tm;
  return chart[chart.length - 1][1];
}

// Legacy speed-only turn mode (defaults to category B — the Klingon D7 curve). Prefer turnModeFor(category, …).
export function turnMode(speed) { return turnModeFor('B', speed); }

// sanity helper: total hexes moved across a full 32-impulse turn (equals speed)
export function movesInTurn(speed) { let n = 0; for (let i = 1; i <= 32; i++) if (movesOnImpulse(speed, i)) n++; return n; }
