// Course planning — SFB mid-turn speed changes (C12.0) and turn-mode-legal path plotting (C3.44).
// Pure functions; the movement rules live here. Reuses the 32-impulse move chart + hex stepping from
// movement.js. A SpeedPlot is { base, changes:[{ announceImpulse, speed }] } — a change announced on
// impulse K takes effect on impulse K+1 (the 1-impulse announce delay, C12.36).
import { movesOnImpulse, neighbor, turnMode, turnModeFor } from './movement.js';

export function speedAt(plot, impulse) {
  let s = plot.base;
  for (const c of plot.changes || []) if (c.announceImpulse < impulse) s = c.speed;   // effective = announce+1
  return s;
}
export function speedSchedule(plot) {
  const a = [];
  for (let i = 1; i <= 32; i++) a.push(speedAt(plot, i));
  return a;
}
export function movesOnImpulseAt(plot, impulse) { return movesOnImpulse(speedAt(plot, impulse), impulse); }

// total hexes moved across all segments = movement energy / moveCost (C12.21)
export function hexesInPlot(plot) {
  let n = 0;
  for (let i = 1; i <= 32; i++) if (movesOnImpulseAt(plot, i)) n++;
  return n;
}
// for each move-impulse, the running hex index the ship has reached
export function impulseTimeline(plot) {
  const tl = []; let h = 0;
  for (let i = 1; i <= 32; i++) if (movesOnImpulseAt(plot, i)) tl.push({ impulse: i, hexIndex: ++h });
  return tl;
}

// the three candidate next hexes: straight ahead (always legal) + the two ±1 turns (legal only once the
// ship has moved turnMode(speed) straight hexes). legal=true → green, legal=false → red.
export function legalNextHexes(pos, facing, speed, hexesSinceTurn, category = 'B') {
  const canTurn = hexesSinceTurn >= turnModeFor(category, speed);
  const at = f => ({ facing: f, hex: neighbor(pos.q, pos.r, f) });
  return [
    { ...at(facing), legal: true },
    { ...at((facing + 5) % 6), legal: canTurn },
    { ...at((facing + 1) % 6), legal: canTurn },
  ];
}
// snap: return the new cursor state if `hex` is a legal next hex, else null. A forward/turn move also
// advances the slip counter (a straight-line hex toward the sideslip requirement, C4.1).
export function tryStep(pos, facing, speed, hexesSinceTurn, slipSince, hex, category = 'B') {   // C3.3: turn-mode legality is category-dependent — the caller MUST pass the ship's category
  const c = legalNextHexes(pos, facing, speed, hexesSinceTurn, category).find(x => x.legal && x.hex.q === hex.q && x.hex.r === hex.r);
  if (!c) return null;
  const turned = c.facing !== facing;
  return { pos: c.hex, facing: c.facing, hexesSinceTurn: turned ? 1 : hexesSinceTurn + 1, slipSince: slipSince + 1 };
}

// the two forward-oblique sideslip hexes (facing±1 direction, facing UNCHANGED). Legal only after the
// slip mode of "1" is satisfied — at least one straight-line move since the last sideslip (C4.1).
export function legalSideslips(pos, facing, slipSince) {
  const canSlip = slipSince >= 1;
  const at = f => ({ facing, hex: neighbor(pos.q, pos.r, f) });
  return [{ ...at((facing + 5) % 6), legal: canSlip }, { ...at((facing + 1) % 6), legal: canSlip }];
}
// snap a sideslip: enter an oblique hex keeping facing; counts as straight for turn mode (C3.24) and
// resets the slip counter. Returns the new cursor state, or null if not a legal sideslip.
export function trySideslip(pos, facing, hexesSinceTurn, slipSince, hex) {
  const c = legalSideslips(pos, facing, slipSince).find(x => x.legal && x.hex.q === hex.q && x.hex.r === hex.r);
  if (!c) return null;
  return { pos: c.hex, facing, hexesSinceTurn: hexesSinceTurn + 1, slipSince: 0 };
}

// place a mid-turn speed change at the impulse the ship reaches hex `atHexIndex` (announce impulse)
// C12.3 mid-turn speed-change limits. `announceImpulse` = when the change is announced, `newSpeed` = the plotted
// speed, `currentSpeed` = the ship's speed when it announces. Returns { ok, reason }. A change replacing the one
// already at this impulse is not counted as an extra.
export function speedChangeLegal(plot, announceImpulse, newSpeed, currentSpeed) {
  if (announceImpulse < 4 || announceImpulse > 28) return { ok: false, reason: 'C12.313: no mid-turn speed change before impulse 4 or after impulse 28' };
  const others = (plot.changes || []).filter(c => c.announceImpulse !== announceImpulse);
  if (others.length >= 4) return { ok: false, reason: 'C12.311: at most four speed changes per turn' };
  if (others.some(c => Math.abs(c.announceImpulse - announceImpulse) < 8)) return { ok: false, reason: 'C12.312: speed changes must be at least eight impulses apart' };
  if (newSpeed < Math.floor(currentSpeed / 2)) return { ok: false, reason: 'C12.32: a ship may decelerate by at most half its current speed in one change' };
  return { ok: true };
}

export function setSpeedChange(plot, timeline, atHexIndex, newSpeed) {
  const entry = timeline.find(t => t.hexIndex === atHexIndex);
  if (!entry) return plot;
  const announceImpulse = entry.impulse;
  const changes = (plot.changes || []).filter(c => c.announceImpulse !== announceImpulse)
    .concat([{ announceImpulse, speed: newSpeed }]).sort((a, b) => a.announceImpulse - b.announceImpulse);
  return { ...plot, changes };
}
