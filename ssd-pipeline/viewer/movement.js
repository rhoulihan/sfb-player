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

// Turn mode: the number of hexes a ship must move straight before it may turn one hexside,
// derived from speed (standard SFB breakpoints). Higher speed ⇒ turns less often.
export function turnMode(speed) {
  if (speed <= 1) return 0;
  if (speed <= 5) return 1;
  if (speed <= 10) return 2;
  if (speed <= 15) return 3;
  if (speed <= 21) return 4;
  if (speed <= 28) return 5;
  return 6;
}

// sanity helper: total hexes moved across a full 32-impulse turn (equals speed)
export function movesInTurn(speed) { let n = 0; for (let i = 1; i <= 32; i++) if (movesOnImpulse(speed, i)) n++; return n; }
