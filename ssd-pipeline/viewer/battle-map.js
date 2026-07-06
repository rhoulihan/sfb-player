// Map interaction layer — geometry/hit-testing + course-cursor helpers extracted from battle.html.
// Pure of app globals: the base speed for a plot (the eafDraft "Energy for Movement" contract) is passed
// in by the host, which keeps plotBase/syncMovementEnergy as the single owner of the plot↔energy seam.
import { GEOM, hexCenter, headingDeg, hexDistance } from './battle-geom.js';
import { impulseTimeline, speedAt, legalNextHexes, legalSideslips, tryStep, trySideslip, setSpeedChange } from './course-plan.js';
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
  if (ui.selectedPathHex) {   // re-anchor point on a plotted path (amber dashed ring)
    const sh = byId(ui.selectedPathHex.shipId), st = sh && sh.course && sh.course.steps[ui.selectedPathHex.idx];
    if (st) { const cc = hexCenter(st.q, st.r); s += `<circle cx="${cc.x}" cy="${cc.y}" r="13" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="4 2" style="pointer-events:none"/>`; }
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

// Attach all map gesture handlers. Owns its own hit-testing (svgPoint/clickToHex/nearestHex) + the
// energy-phase plot/sideslip/range/speed-change, the impulse-phase ship-drag, and the map contextmenu.
// The host injects live state accessors + intent callbacks (never reaches app globals); it must call this
// once after those are defined. Preserves the suppressClick↔plotDrag ordering and both phase-gated
// mousedown listeners exactly.
export function createBattleMap(ctx) {
  const { map, ui, getPhase, getShips, byId, isMine, COLS, ROWS,
          plotBase, saveSoon, render, syncMovementEnergy, onShipClick, renderFleet, pruneUnavailable, openCtxMenu } = ctx;
  const svgPoint = e => { const pt = map.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(map.getScreenCTM().inverse()); };
  const clickToHex = e => { const p = svgPoint(e); return pixelToHex(p.x, p.y); };
  const nearestHex = (px, py) => { let b = { q: 0, r: 0 }, bd = Infinity; for (let q = 0; q < COLS; q++) for (let r = 0; r < ROWS; r++) { const c = hexCenter(q, r), d = Math.hypot(c.x - px, c.y - py); if (d < bd) { bd = d; b = { q, r }; } } return b; };

  // energy phase: drag = sideslip (move oblique keeping facing, C4.0); a plain click turns
  let plotDrag = null, suppressClick = false;
  map.addEventListener('mousedown', e => { if (getPhase() === 'energy' && ui.plotShipId && byId(ui.plotShipId)) plotDrag = { x: e.clientX, y: e.clientY, moved: false }; });
  map.addEventListener('mousemove', e => { if (plotDrag && (Math.abs(e.clientX - plotDrag.x) > 6 || Math.abs(e.clientY - plotDrag.y) > 6)) plotDrag.moved = true; });
  map.addEventListener('mouseup', e => {
    const dragged = plotDrag && plotDrag.moved; plotDrag = null;
    if (!dragged || getPhase() !== 'energy' || !ui.plotShipId || !byId(ui.plotShipId)) return;
    const hex = clickToHex(e); if (!hex) return;
    const s = byId(ui.plotShipId), cur = plotCursor(s, plotBase(s)), slip = trySideslip(cur.pos, cur.facing, cur.hst, cur.slip, hex);
    if (slip) { courseOf(s).steps.push({ q: slip.pos.q, r: slip.pos.r, facing: slip.facing, slip: true }); saveSoon(ui.plotShipId); suppressClick = true; render(); }
  });
  // energy phase clicks: plot courses (snap) / speed-change on a path hex / shift-click to measure range
  map.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }   // a drag-sideslip just happened; don't also turn
    if (getPhase() !== 'energy') return;
    const hex = clickToHex(e); if (!hex) return;
    if (e.shiftKey) {   // shift-click an enemy → set the fire-group target; shift-click empty → measure range
      const enemyHere = getShips().find(s => s.q === hex.q && s.r === hex.r && !isMine(s));
      if (enemyHere) { onShipClick(enemyHere); return; }
      ui.rangeAnchor = (!ui.rangeAnchor || ui.rangeAnchor.end) ? { start: hex, end: null } : { ...ui.rangeAnchor, end: hex }; render(); return;
    }
    const shipHere = getShips().find(s => s.q === hex.q && s.r === hex.r);
    if (shipHere && isMine(shipHere)) { ui.plotShipId = shipHere.id; ui.eaSelected = shipHere.id; ui.selectedPathHex = null; onShipClick(shipHere); return; }   // route subject + toggle into the fire group
    if (ui.plotShipId && byId(ui.plotShipId)) {
      const s = byId(ui.plotShipId), c = courseOf(s);
      const idx = c.steps.findIndex(st => st.q === hex.q && st.r === hex.r);
      if (idx >= 0) {   // clicked a hex already on the course
        const sel = ui.selectedPathHex;
        if (getPhase() === 'energy' && sel && sel.shipId === s.id && sel.idx === idx) {   // re-click the anchored hex → speed-change modal (allocation only)
          const sp = ensureSpeedPlot(s, plotBase(s)), tl = impulseTimeline(sp), imp = tl[idx]?.impulse, cur = speedAt(sp, imp || 1);
          const v = prompt(`New speed effective after impulse ${imp} (hex ${idx + 1})? Currently ${cur}.`, cur);
          if (v != null && v !== '') { s.speedPlot = setSpeedChange(sp, tl, idx + 1, Math.max(0, Math.min(31, Math.round(+v) || 0))); syncMovementEnergy(s); saveSoon(ui.plotShipId); render(); }
          return;
        }
        c.steps = c.steps.slice(0, idx + 1);   // re-anchor: truncate the course here and re-plot forward from this point
        ui.selectedPathHex = { shipId: s.id, idx };
        saveSoon(ui.plotShipId); render(); return;
      }
      const cur = plotCursor(s, plotBase(s));
      const step = tryStep(cur.pos, cur.facing, cur.speed, cur.hst, cur.slip, hex);
      if (step) { c.steps.push({ q: step.pos.q, r: step.pos.r, facing: step.facing }); ui.selectedPathHex = null; saveSoon(ui.plotShipId); render(); }
    }
  });
  // impulse phase: drag a ship to move it (snaps to nearest hex); a plain click selects it
  map.addEventListener('mousedown', e => { if (getPhase() !== 'impulse') return; const gg = e.target.closest('.ship'); if (!gg) return; ui.dragging = { s: byId(gg.dataset.id), moved: false }; ui.selectedId = ui.dragging.s.id; renderFleet(); e.preventDefault(); });
  window.addEventListener('mousemove', e => {
    if (!ui.dragging) return; const p = svgPoint(e), h = nearestHex(p.x, p.y);
    if (h.q !== ui.dragging.s.q || h.r !== ui.dragging.s.r) { ui.dragging.s.q = h.q; ui.dragging.s.r = h.r; ui.dragging.moved = true; pruneUnavailable(); render(); }
  });
  window.addEventListener('mouseup', () => { if (ui.dragging) { const s = ui.dragging.s, moved = ui.dragging.moved; ui.dragging = null; if (!moved) onShipClick(s); else saveSoon(s.id); } });
  // right-click: clear the plot (energy) or open the ship context menu
  map.addEventListener('contextmenu', e => {
    if (getPhase() === 'energy' && ui.plotShipId && byId(ui.plotShipId)) { e.preventDefault(); const s = byId(ui.plotShipId); s.course = null; s.speedPlot = null; s.autopilot = false; saveSoon(ui.plotShipId); render(); return; }
    const g = e.target.closest('.ship'); if (!g) return; e.preventDefault(); openCtxMenu(g.dataset.id, e);
  });

  return { clickToHex };
}
