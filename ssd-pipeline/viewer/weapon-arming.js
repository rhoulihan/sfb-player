// Multi-turn arming (E4.21/E4.22 photons, FP1.21/FP2.51 plasma). A heavy weapon arms over a fixed schedule of
// per-turn energy costs and can fire ONLY when fully armed (its last schedule turn) or while held; once armed,
// if not fired it costs the hold price each turn to keep it in the tube. Pure functions over a (cls, progress)
// pair where progress = arming turns already completed; the host tracks per-weapon progress on the ship.
export const ARM_SCHEDULE = {
  PHOTON: { turns: [2, 2], hold: 1 },        // E4.21: two points on each of two turns; E4.22: hold 1
  'PLASMA-R': { turns: [2, 2, 5], hold: 4 }, // FP2.51 per-type 3-turn increments + hold cost
  'PLASMA-S': { turns: [2, 2, 4], hold: 2 },
  'PLASMA-G': { turns: [2, 2, 3], hold: 1 },
  'PLASMA-F': { turns: [1, 1, 1], hold: 0 },
  DISR: { turns: [2], hold: 2 },             // disruptor arms in one turn, no cheaper hold (re-armed each turn)
};
const DEFAULT = { turns: [2], hold: 2 };

export function armSchedule(cls) { return ARM_SCHEDULE[cls] || DEFAULT; }
export function armTurns(cls) { return armSchedule(cls).turns.length; }
export function isArmed(cls, progress) { return progress >= armTurns(cls); }   // full schedule done → may fire

// energy to spend this turn: still arming → this turn's schedule cost; fully armed → the hold price
export function armStepCost(cls, progress) {
  const sch = armSchedule(cls);
  return progress < sch.turns.length ? sch.turns[progress] : sch.hold;
}

// EA-panel label: 'ARM n/N' while arming, 'HOLD' once fully armed
export function armLabel(cls, progress) {
  const n = armTurns(cls);
  return progress >= n ? 'HOLD' : `ARM ${progress + 1}/${n}`;
}
