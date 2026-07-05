// Course planning — SFB mid-turn speed changes (C12.0) and turn-mode-legal path plotting (C3.44).
// Pure functions; the movement rules live here. Reuses the 32-impulse move chart + hex stepping from
// movement.js. A SpeedPlot is { base, changes:[{ announceImpulse, speed }] } — a change announced on
// impulse K takes effect on impulse K+1 (the 1-impulse announce delay, C12.36).
import { movesOnImpulse, neighbor, turnMode } from './movement.js';

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
export function legalNextHexes(pos, facing, speed, hexesSinceTurn) {
  const canTurn = hexesSinceTurn >= turnMode(speed);
  const at = f => ({ facing: f, hex: neighbor(pos.q, pos.r, f) });
  return [
    { ...at(facing), legal: true },
    { ...at((facing + 5) % 6), legal: canTurn },
    { ...at((facing + 1) % 6), legal: canTurn },
  ];
}
// snap: return the new cursor state if `hex` is a legal next hex, else null
export function tryStep(pos, facing, speed, hexesSinceTurn, hex) {
  const c = legalNextHexes(pos, facing, speed, hexesSinceTurn).find(x => x.legal && x.hex.q === hex.q && x.hex.r === hex.r);
  if (!c) return null;
  const turned = c.facing !== facing;
  return { pos: c.hex, facing: c.facing, hexesSinceTurn: turned ? 1 : hexesSinceTurn + 1 };
}

// place a mid-turn speed change at the impulse the ship reaches hex `atHexIndex` (announce impulse)
export function setSpeedChange(plot, timeline, atHexIndex, newSpeed) {
  const entry = timeline.find(t => t.hexIndex === atHexIndex);
  if (!entry) return plot;
  const announceImpulse = entry.impulse;
  const changes = (plot.changes || []).filter(c => c.announceImpulse !== announceImpulse)
    .concat([{ announceImpulse, speed: newSpeed }]).sort((a, b) => a.announceImpulse - b.announceImpulse);
  return { ...plot, changes };
}
