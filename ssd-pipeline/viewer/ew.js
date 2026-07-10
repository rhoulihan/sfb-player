// Electronic warfare effect on fire (D6.3). Pure functions; the host supplies the net ECM strength.
//
// D6.34: net ECM strength (target ECM + built-in/terrain/cloak, minus the firer's ECCM) converts to a "net ECM
// shift" by taking the square root and dropping fractions. The rulebook's chart (1-3→1, 4-8→2, 9-15→3, …) is
// exactly floor(sqrt): shift n spans strengths n² .. (n+1)²-1. A zero or negative result (ECCM ≥ ECM) → no effect.
export function ewShift(strength) { return strength >= 1 ? Math.floor(Math.sqrt(strength)) : 0; }

// E1.82: a positive net ECM shift is applied to the fire die roll.
//
// E1.821 HIT-OR-MISS weapons (photons, disruptors, seeking-weapon proximity): the shift is simply added to the
// die; if the adjusted roll exceeds the "to hit" number the shot misses. Returns the adjusted die.
export function shiftedDie(die, shift) { return die + Math.max(0, shift | 0); }

// E1.822 RANGE-OF-EFFECT weapons (phasers): the shift raises the die toward the top of the column (usually 6);
// each shift beyond reaching 6 instead moves one range column higher (worse). Returns {die, col} to read from the
// effect grid, where `col` is the starting range-band index. (Rulebook example: 9 ECM = shift 3, PH-1 at Range 3,
// die 4 → raise 4→5→6 (two shifts) then bump to the Range-4 column (third shift) → die 6 / Range 4.)
export function shiftRangeOfEffect(die, col, shift, maxDie = 6) {
  let d = die, c = col;
  for (let k = 0; k < Math.max(0, shift | 0); k++) { if (d < maxDie) d++; else c++; }
  return { die: d, col: c };
}
