// Multi-turn arming (E4.21/E4.22 photons, FP1.21/FP2.51 plasma). A heavy weapon arms over a fixed schedule of
// per-turn energy costs and can fire ONLY when fully armed (its last schedule turn) or while held; once armed,
// if not fired it costs the hold price each turn to keep it in the tube. Pure functions over a (cls, progress)
// pair where progress = arming turns already completed; the host tracks per-weapon progress on the ship.
// hold === null means the weapon CANNOT be held once armed — it must fire the turn arming completes or the
// energy is lost (E3.24 disruptor; FP1.311 type-R plasma armed by a ship). See canHold().
export const ARM_SCHEDULE = {
  PHOTON: { turns: [2, 2], hold: 1 },         // E4.21: two points on each of two turns; E4.22: hold 1
  'PLASMA-R': { turns: [2, 2, 5], hold: null }, // FP2.51 arming; FP1.311: R armed by a ship cannot be held
  'PLASMA-S': { turns: [2, 2, 4], hold: 2 },
  'PLASMA-G': { turns: [2, 2, 3], hold: 1 },
  'PLASMA-F': { turns: [1, 1, 3], hold: 0 },  // FP2.51: 1/1/3; a type-F in a type-F launcher holds for free
  DISR: { turns: [2], hold: null },           // E3.24: armed disruptors cannot be held
};
const DEFAULT = { turns: [2], hold: null };

// E2.23 FREQUENCY: each phaser (and each heavy weapon) may fire at most once per turn — gatlings (E2.151) excepted,
// but there are none in the cruiser roster. `firedAt` is the {turn} of the last shot (or null); true = already fired
// this turn, so the mount is not eligible again until a later turn.
export function firedThisTurn(firedAt, turn) { return !!firedAt && firedAt.turn >= turn; }

// E1.5/E1.52 REFIRE CADENCE: most weapons need 8 impulses between shots, and that gap SPANS the turn boundary —
// a weapon fired on impulse 25 can next fire on impulse 1 of the following turn (8 impulses later), one fired on
// impulse 28 not until impulse 4. 32 impulses per turn. `firedAt` = {turn, impulse} of the last shot, or null.
export function impulsesSince(firedAt, turn, impulse) { return firedAt ? (turn - firedAt.turn) * 32 + (impulse - firedAt.impulse) : Infinity; }
export function refireReady(firedAt, turn, impulse, minGap = 8) { return impulsesSince(firedAt, turn, impulse) >= minGap; }

export function armSchedule(cls) { return ARM_SCHEDULE[cls] || DEFAULT; }
export function armTurns(cls) { return armSchedule(cls).turns.length; }
export function isArmed(cls, progress) { return progress >= armTurns(cls); }   // full schedule done → may fire
export function canHold(cls) { return armSchedule(cls).hold != null; }         // false → fire-or-lose the turn it arms

// Rolling delay (FP1.221): a plasma may stall on its final arming turn by paying only 2 (1 for a plasma-F)
// instead of the full final step, sitting one turn short of completion. Reserve warp can then complete it
// mid-turn (FP1.222) by paying the difference; the torpedo must be fired that turn.
export function canRoll(cls) { return /^PLASMA-/.test(cls) && armSchedule(cls).turns.length >= 3; }
export function rollCost(cls) { return cls === 'PLASMA-F' ? 1 : 2; }
export function reserveCompletionCost(cls) {
  const sch = armSchedule(cls);
  return sch.turns[sch.turns.length - 1] - rollCost(cls);
}

// energy to spend this turn: still arming → this turn's schedule cost; fully armed & holdable → the hold price.
// A non-holdable weapon should never sit fully armed across turns (it discharges); fall back to its final arm step.
export function armStepCost(cls, progress) {
  const sch = armSchedule(cls);
  if (progress < sch.turns.length) return sch.turns[progress];
  return sch.hold ?? sch.turns[sch.turns.length - 1];
}

// EA-panel label: 'ARM n/N' while arming; 'HOLD' once fully armed (only for holdable weapons)
export function armLabel(cls, progress) {
  const n = armTurns(cls);
  if (progress >= n) return canHold(cls) ? 'HOLD' : 'ARM';
  return `ARM ${progress + 1}/${n}`;
}
