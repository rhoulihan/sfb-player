// SFB D8.0 Critical Hits (optional). If 20+ damage points strike a single shield during one impulse (D8.1),
// the ship rolls 2d6 once per turn; the total maps to a system that is DISABLED (never destroyed, D8.21) until
// repaired. This module is the pure rules core: the 2d6 table, the trigger threshold, the repair roll (D8.31),
// and a small per-ship occurrence-state model. Effects and the trigger accumulator live in the game (battle.html).

// D8.1: 20 or more damage points to a given shield in a single impulse forces the roll.
export const CRIT_THRESHOLD = 20;

// D8.2: the 2d6 result → the system that suffers the critical (6–8 = no critical hit).
export const CRIT_TABLE = {
  2: 'fireControl',   // active fire control fails; ship switches to passive fire control (D19)
  3: 'battery',       // all batteries lose power and cannot hold power until repaired
  4: 'transporter',   // transporters cannot be used until repaired
  5: 'labs',          // labs unusable; emergency damage repair (D14) impossible, in-progress lost
  6: null, 7: null, 8: null,   // no critical hit
  9: 'tractor',       // tractors unusable; all existing tractor links are released
  10: 'shuttleBay',   // one shuttle bay's launch controls jam (D8.24) — no launch/recovery until repaired
  11: 'maneuver',     // speed ≤ 8, no HET, no EM, turn mode +1 at all speeds
  12: 'warp',         // warp control damaged: ship stops, no warp for movement, half output lost (D8.23)
};

// Display metadata for the crit badges / roll modal.
export const CRIT_INFO = {
  fireControl: { label: 'Fire Control', rule: 'D8.2 / D19', desc: 'Active fire control fails → passive fire control.' },
  battery:     { label: 'Batteries',    rule: 'D8.2',       desc: 'All batteries lose power and cannot hold power.' },
  transporter: { label: 'Transporters', rule: 'D8.2',       desc: 'Transporters cannot be used until repaired.' },
  labs:        { label: 'Labs',         rule: 'D8.2 / D14', desc: 'Labs unusable; emergency damage repair impossible.' },
  tractor:     { label: 'Tractor',      rule: 'D8.2 / G7',  desc: 'Tractors unusable; all existing links released.' },
  shuttleBay:  { label: 'Shuttle Bay',  rule: 'D8.2 / D8.24', desc: 'One bay jammed: no launch or recovery.' },
  maneuver:    { label: 'Maneuver',     rule: 'D8.2',       desc: 'Speed ≤ 8, no HET, no EM, turn mode +1.' },
  warp:        { label: 'Warp Engines', rule: 'D8.2 / D8.23', desc: 'Ship stops; no warp for movement; half output lost.' },
};

// The 2d6 total → crit type (null for 6–8, "no critical hit").
export function critForRoll(total) { return CRIT_TABLE[total] ?? null; }

// D8.31: roll one die at the end of the turn; 1–4 repairs. Subtract one from the roll for the second attempt
// on the same occurrence and two for the third and subsequent. `priorAttempts` = failed attempts so far.
export function critRepairs(d6, priorAttempts = 0) {
  const penalty = priorAttempts <= 0 ? 0 : priorAttempts === 1 ? 1 : 2;
  return (d6 - penalty) <= 4;
}

// Per-ship crit state is a list of active occurrences: { type, repairAttempts }. Distinct occurrences of the
// same type are separate entries (D8.31 repairs "the same occurrence"); most callers only need hasCrit/activeCrits.
export function addCrit(state, type, extra = {}) { return [...(state || []), { type, repairAttempts: 0, ...extra }]; }
export function hasCrit(state, type) { return (state || []).some(c => c.type === type); }
export function activeCrits(state) { return (state || []).map(c => c.type); }
