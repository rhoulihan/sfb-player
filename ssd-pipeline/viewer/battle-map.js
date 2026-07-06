// Map interaction layer — geometry/hit-testing + course-cursor helpers extracted from battle.html.
// Pure of app globals: the base speed for a plot (the eafDraft "Energy for Movement" contract) is passed
// in by the host, which keeps plotBase/syncMovementEnergy as the single owner of the plot↔energy seam.
import { GEOM, hexCenter, headingDeg } from './battle-geom.js';
import { impulseTimeline, speedAt } from './course-plan.js';
import { turnMode } from './movement.js';

// facing → radians (for on-map heading arrows)
export const rad = f => headingDeg(f) * Math.PI / 180;

// a flat-top hexagon path centered at (cx, cy)
export function hexPath(cx, cy) {
  let p = '';
  for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i); p += (i ? 'L' : 'M') + (cx + GEOM.SIZE * Math.cos(a)).toFixed(1) + ' ' + (cy + GEOM.SIZE * Math.sin(a)).toFixed(1) + ' '; }
  return p + 'Z';
}

// pixel → hex: nearest hex center to (x, y) in map user-space (inverse of hexCenter)
export function pixelToHex(x, y) {
  let best = null, bd = Infinity, q0 = Math.round((x - GEOM.OX) / GEOM.HW);
  for (let q = q0 - 1; q <= q0 + 1; q++) for (let r = Math.round((y - GEOM.OY - (q % 2 ? GEOM.HH / 2 : 0)) / GEOM.HH) - 1, e = r + 2; r <= e; r++) {
    const c = hexCenter(q, r), d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = { q, r }; }
  }
  return best;
}

// lazily anchor a ship's drawn course at its current position
export const courseOf = s => s.course || (s.course = { start: { q: s.q, r: s.r, facing: s.facing }, steps: [] });
// a ship's speed plot; base speed injected (host derives it from the EAF movement allocation)
export const speedPlotOf = (s, base) => s.speedPlot || { base, changes: [] };
export const ensureSpeedPlot = (s, base) => s.speedPlot || (s.speedPlot = { base, changes: [] });

// cursor at the end of a ship's plotted course: position, facing, hexes-since-turn, slip counter, and the
// impulse the next hex would be reached on. `base` is the planned base speed (injected).
export function plotCursor(s, base) {
  const c = courseOf(s), sp = speedPlotOf(s, base), tl = impulseTimeline(sp);
  let pos = { q: c.start.q, r: c.start.r }, facing = c.start.facing, hst = turnMode(sp.base), slip = 0;
  for (const st of c.steps) {
    if (st.slip) { hst = hst + 1; slip = 0; }                                        // sideslip: straight for turn mode (C3.24), resets slip
    else { const turned = st.facing !== facing; hst = turned ? 1 : hst + 1; slip = slip + 1; }
    facing = st.facing; pos = { q: st.q, r: st.r };
  }
  const impulse = tl[c.steps.length]?.impulse ?? null;   // impulse the NEXT hex would be reached on
  return { pos, facing, hst, slip, speed: speedAt(sp, impulse || 32), tl };
}
