// Map interaction layer — geometry/hit-testing + course-cursor helpers extracted from battle.html.
// Pure of app globals: the base speed for a plot (the eafDraft "Energy for Movement" contract) is passed
// in by the host, which keeps plotBase/syncMovementEnergy as the single owner of the plot↔energy seam.
import { GEOM, hexCenter, headingDeg, hexDistance } from './battle-geom.js';
import { impulseTimeline, speedAt, legalNextHexes, legalSideslips } from './course-plan.js';
import { turnMode, neighbor } from './movement.js';

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

// SVG overlay for the energy-phase planning map: plotted courses + impulse labels + speed-change markers
// + heading arrows, the selected ship's green/red next-hex candidates and purple sideslip targets, and the
// range ruler. Host injects live state (ships/isMine/byId/ui) and the base-speed accessor (plotBase).
export function plotOverlaySvg({ ships, isMine, byId, plotBase, ui }) {
  let s = '';
  for (const sh of ships.filter(isMine)) {   // plotted courses + impulse labels + speed-change markers
    const c = sh.course; if (!c || !c.steps.length) continue;
    const sp = speedPlotOf(sh, plotBase(sh)), tl = impulseTimeline(sp); let prev = hexCenter(c.start.q, c.start.r);
    c.steps.forEach((st, i) => {
      const cur = hexCenter(st.q, st.r), imp = tl[i]?.impulse;
      s += `<line x1="${prev.x}" y1="${prev.y}" x2="${cur.x}" y2="${cur.y}" stroke="#2563eb" stroke-width="2" opacity="0.85"/>`;
      if (imp) s += `<text x="${cur.x}" y="${cur.y - 7}" text-anchor="middle" font-size="9" fill="#1d4ed8" font-weight="700" style="pointer-events:none">${imp}</text>`;
      const chg = (sp.changes || []).find(ch => ch.announceImpulse === imp);
      if (chg) s += `<text x="${cur.x}" y="${cur.y + 15}" text-anchor="middle" font-size="10" fill="#b45309" font-weight="800" style="pointer-events:none">▸${chg.speed}</text>`;
      const nb = neighbor(st.q, st.r, st.facing), nc = hexCenter(nb.q, nb.r);   // heading arrow: small triangle pointing in the ship's facing
      const dx = nc.x - cur.x, dy = nc.y - cur.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
      s += `<polygon points="${(cur.x + ux * 11).toFixed(1)},${(cur.y + uy * 11).toFixed(1)} ${(cur.x - ux * 3 + px * 5).toFixed(1)},${(cur.y - uy * 3 + py * 5).toFixed(1)} ${(cur.x - ux * 3 - px * 5).toFixed(1)},${(cur.y - uy * 3 - py * 5).toFixed(1)}" fill="#fbbf24" stroke="#78350f" stroke-width="0.6" opacity="0.95" style="pointer-events:none"/>`;
      prev = cur;
    });
  }
  if (ui.plotShipId && byId(ui.plotShipId)) {   // green/red next-hex candidates for the selected ship
    const sh = byId(ui.plotShipId), cur = plotCursor(sh, plotBase(sh));
    for (const cand of legalNextHexes(cur.pos, cur.facing, cur.speed, cur.hst)) {
      const cc = hexCenter(cand.hex.q, cand.hex.r);
      s += `<path d="${hexPath(cc.x, cc.y)}" fill="${cand.legal ? '#16a34a' : '#C74634'}" opacity="0.5" style="pointer-events:none"/>`;
    }
    for (const ss of legalSideslips(cur.pos, cur.facing, cur.slip)) {   // drag-to-sideslip target (purple dashed)
      if (!ss.legal) continue; const cc = hexCenter(ss.hex.q, ss.hex.r);
      s += `<path d="${hexPath(cc.x, cc.y)}" fill="none" stroke="#a855f7" stroke-width="3" stroke-dasharray="5 3" opacity="0.95" style="pointer-events:none"/>`;
    }
  }
  if (ui.rangeAnchor) {   // range measurement
    const a = hexCenter(ui.rangeAnchor.start.q, ui.rangeAnchor.start.r);
    s += `<circle cx="${a.x}" cy="${a.y}" r="9" fill="none" stroke="#7c3aed" stroke-width="2.5"/>`;
    if (ui.rangeAnchor.end) {
      const b = hexCenter(ui.rangeAnchor.end.q, ui.rangeAnchor.end.r), d = hexDistance(ui.rangeAnchor.start, ui.rangeAnchor.end);
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="6 4"/>` +
        `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}" text-anchor="middle" font-size="13" fill="#6d28d9" font-weight="800" style="pointer-events:none">R${d}</text>`;
    }
  }
  return s;
}
