// Map interaction layer — geometry/hit-testing + course-cursor helpers extracted from battle.html.
// Pure of app globals: the base speed for a plot (the eafDraft "Energy for Movement" contract) is passed
// in by the host, which keeps plotBase/syncMovementEnergy as the single owner of the plot↔energy seam.
import { GEOM, hexCenter, headingDeg, hexDistance } from './battle-geom.js';
import { impulseTimeline, speedAt, legalNextHexes, legalSideslips, tryStep, trySideslip } from './course-plan.js';
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
  // seed the slip counter from the carried-over state: a ship may sideslip on its first move UNLESS its
  // last move of the previous turn was a sideslip (s.slipSince === 0). Fresh ships default to 1 (allowed).
  let pos = { q: c.start.q, r: c.start.r }, facing = c.start.facing, hst = turnMode(sp.base), slip = s.slipSince ?? 1;
  for (const st of c.steps) {
    if (st.slip) { hst = hst + 1; slip = 0; }                                        // sideslip: straight for turn mode (C3.24), resets slip
    else { const turned = st.facing !== facing; hst = turned ? 1 : hst + 1; slip = slip + 1; }
    facing = st.facing; pos = { q: st.q, r: st.r };
  }
  const impulse = tl[c.steps.length]?.impulse ?? null;   // impulse the NEXT hex would be reached on
  return { pos, facing, hst, slip, speed: speedAt(sp, impulse || 32), tl };
}

// Greedily draw a legal course: start from `startSteps`, then step toward targetHex each impulse, always
// taking the legal-turn candidate that most reduces distance, until it can get no closer. Pure — mutates
// only a throwaway clone. Returns the new steps array (for a live preview or to commit).
export function pathFrom(s, base, startSteps, targetHex) {
  const c = courseOf(s);
  const dist = (a, b) => (a.q === b.q && a.r === b.r) ? 0 : hexDistance(a, b);
  const tmp = { ...s, course: { start: c.start, steps: startSteps.slice() } };
  for (let guard = 0; guard < 40; guard++) {
    const cur = plotCursor(tmp, base), d0 = dist(cur.pos, targetHex);
    if (d0 === 0) break;
    let best = null, bd = Infinity;
    for (const x of legalNextHexes(cur.pos, cur.facing, cur.speed, cur.hst)) {
      if (!x.legal) continue; const d = dist(x.hex, targetHex); if (d < bd) { bd = d; best = x; }
    }
    if (!best || bd >= d0) break;   // can't get closer under the turn-mode constraints → stop here
    tmp.course.steps.push({ q: best.hex.q, r: best.hex.r, facing: best.facing });
  }
  return tmp.course.steps;
}

// SVG overlay for the energy-phase planning map: plotted courses + impulse labels + speed-change markers
// + heading arrows, the selected ship's green/red next-hex candidates and purple sideslip targets, and the
// range ruler. Host injects live state (ships/isMine/byId/ui) and the base-speed accessor (plotBase).
export function plotOverlaySvg({ ships, isMine, byId, plotBase, ui }) {
  let s = '';
  for (const sh of ships.filter(isMine)) {   // plotted courses + impulse labels + speed-change markers
    if (ui.navPreview && sh.id === ui.navPreview.shipId) continue;   // being re-drawn — show the preview instead
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
  if (ui.navPreview && byId(ui.navPreview.shipId)) {   // live path being dragged (dashed amber)
    const sh = byId(ui.navPreview.shipId), c = sh.course || { start: { q: sh.q, r: sh.r, facing: sh.facing } };
    let prev = hexCenter(c.start.q, c.start.r);
    for (const st of ui.navPreview.steps) { const cc = hexCenter(st.q, st.r);
      s += `<line x1="${prev.x}" y1="${prev.y}" x2="${cc.x}" y2="${cc.y}" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6 4" opacity="0.9" style="pointer-events:none"/>`;
      prev = cc;
    }
  }
  if (ui.plotShipId && byId(ui.plotShipId)) {   // green/red next-hex candidates + purple sideslips at the (previewed) course end
    const sh = byId(ui.plotShipId);
    const previewing = ui.navPreview && ui.navPreview.shipId === sh.id;
    const start = sh.course ? sh.course.start : { q: sh.q, r: sh.r, facing: sh.facing };
    const steps = previewing ? ui.navPreview.steps : (sh.course ? sh.course.steps : []);
    const cur = plotCursor({ ...sh, course: { start, steps } }, plotBase(sh));
    for (const cand of legalNextHexes(cur.pos, cur.facing, cur.speed, cur.hst)) {
      const cc = hexCenter(cand.hex.q, cand.hex.r);
      s += `<path d="${hexPath(cc.x, cc.y)}" fill="${cand.legal ? '#16a34a' : '#C74634'}" opacity="0.5" style="pointer-events:none"/>`;
    }
    for (const ss of (cur.speed > 0 ? legalSideslips(cur.pos, cur.facing, cur.slip) : [])) {   // sideslip target (purple dashed) — a stationary ship can't sideslip
      if (!ss.legal) continue; const cc = hexCenter(ss.hex.q, ss.hex.r);
      s += `<path d="${hexPath(cc.x, cc.y)}" fill="none" stroke="#a855f7" stroke-width="3" stroke-dasharray="5 3" opacity="0.95" style="pointer-events:none"/>`;
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
  const { map, ui, getPhase, getShips, byId, isMine, COLS, ROWS, hasGhosts, groupOfShip,
          plotBase, saveSoon, render, syncMovementEnergy, onShipClick, renderFleet, pruneUnavailable, openCtxMenu, openSpeedMenu } = ctx;
  // a dragged ship joins the virtual fire group: friendly → add as a firer (once), enemy → set as target
  const joinFireGroup = s => { if (isMine(s)) { if (!groupOfShip(s.id)) onShipClick(s); } else onShipClick(s); };
  const svgPoint = e => { const pt = map.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(map.getScreenCTM().inverse()); };
  const clickToHex = e => { const p = svgPoint(e); return pixelToHex(p.x, p.y); };
  const nearestHex = (px, py) => { let b = { q: 0, r: 0 }, bd = Infinity; for (let q = 0; q < COLS; q++) for (let r = 0; r < ROWS; r++) { const c = hexCenter(q, r), d = Math.hypot(c.x - px, c.y - py); if (d < bd) { bd = d; b = { q, r }; } } return b; };

  // alt-drag any ship → an ephemeral "ghost" what-if position (both phases); rotate it by clicking it.
  // The real ship never moves — ghosts feed the fire preview only and must be cleared to continue.
  map.addEventListener('click', e => {   // capture: select a ghost (arrow keys then rotate it), preempting the plotting/fire click handlers
    const gh = e.target.closest('.ghost'); if (!gh) return;
    ui.selectedGhost = gh.dataset.ghost; render();
    e.stopPropagation(); e.preventDefault();
  }, true);
  window.addEventListener('keydown', e => {   // ← / → rotate the selected ghost
    const g = ui.selectedGhost && ui.ghosts[ui.selectedGhost]; if (!g) return;
    if (e.key === 'ArrowLeft') g.facing = (g.facing + 5) % 6;
    else if (e.key === 'ArrowRight') g.facing = (g.facing + 1) % 6;
    else return;
    e.preventDefault(); render();
  });
  map.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const gh = e.target.closest('.ghost');
    if (gh && !e.altKey) {   // plain-drag an EXISTING ghost → select it + reposition it (no alt, no re-join)
      const id = gh.dataset.ghost; if (!ui.ghosts[id]) return;
      ui.ghostDrag = id; ui.selectedGhost = id;
      e.preventDefault(); e.stopPropagation(); render(); return;
    }
    if (!e.altKey) return; const gg = e.target.closest('.ship, .ghost'); if (!gg) return;   // alt-drag any ship/ghost → create/move a ghost
    const id = gg.dataset.id || gg.dataset.ghost, s = byId(id); if (!s) return;
    ui.ghostDrag = id; ui.ghosts[id] = ui.ghosts[id] || { q: s.q, r: s.r, facing: s.facing }; ui.selectedGhost = id;
    joinFireGroup(s);   // alt-drag also builds the virtual fire group (friendly → firer, enemy → target)
    e.preventDefault(); e.stopPropagation(); render();
  });
  window.addEventListener('mousemove', e => {
    if (!ui.ghostDrag) return; const p = svgPoint(e), h = nearestHex(p.x, p.y);
    const g = ui.ghosts[ui.ghostDrag]; if (h.q !== g.q || h.r !== g.r) { g.q = h.q; g.r = h.r; render(); }
  });
  window.addEventListener('mouseup', () => { if (ui.ghostDrag) ui.ghostDrag = null; });

  // energy-phase drags. Grab: a plotted nav hex (truncate + re-route from there), a green next-hex or purple
  // sideslip candidate (extend from there), or the ship glyph. Plain red / empty hexes aren't draggable.
  // Plain-drag re-routes/extends the path (live preview); shift-drag sideslips; the ship glyph extends one
  // step onto a green hex, else drops a ghost.
  let plotDrag = null, suppressClick = false;
  const navIdxAt = (sh, hex) => (sh && sh.course && hex) ? sh.course.steps.findIndex(st => st.q === hex.q && st.r === hex.r) : -1;
  const startStepsFor = (ps, hex) => {   // classify the grabbed hex → the course prefix to path-find from, or null
    const steps = ps.course ? ps.course.steps : [];
    const navIdx = navIdxAt(ps, hex);
    if (navIdx >= 0) return steps.slice(0, navIdx);                                     // existing nav hex → truncate here
    const cur = plotCursor(ps, plotBase(ps));
    const g = legalNextHexes(cur.pos, cur.facing, cur.speed, cur.hst).find(x => x.legal && x.hex.q === hex.q && x.hex.r === hex.r);
    if (g) return [...steps, { q: g.hex.q, r: g.hex.r, facing: g.facing }];             // green next-hex → extend
    const p = cur.speed > 0 ? legalSideslips(cur.pos, cur.facing, cur.slip).find(x => x.legal && x.hex.q === hex.q && x.hex.r === hex.r) : null;
    if (p) return [...steps, { q: p.hex.q, r: p.hex.r, facing: p.facing, slip: true }]; // purple sideslip hex → extend
    return null;                                                                        // red / empty → not a path drag
  };
  map.addEventListener('mousedown', e => {
    if (e.altKey || e.button !== 0 || getPhase() !== 'energy') return;   // left button only
    const gg = e.target.closest('.ship'), shipHere = gg && byId(gg.dataset.id);   // a ship glyph → sideslip / ghost (allowed even with ghosts open; priority over an underlying nav hex)
    if (shipHere) { plotDrag = { id: shipHere.id, ship: true, shift: e.shiftKey, x: e.clientX, y: e.clientY, moved: false }; return; }
    if (hasGhosts()) return;   // nav-path drags are blocked while a ghost what-if is open
    const ps = ui.plotShipId && byId(ui.plotShipId), hex = clickToHex(e);   // else classify the grabbed hex for the plot ship
    if (ps && isMine(ps) && hex) { const start = startStepsFor(ps, hex); if (start) plotDrag = { id: ps.id, start, shift: e.shiftKey, x: e.clientX, y: e.clientY, moved: false }; }
  });
  window.addEventListener('mousemove', e => {   // on window so a drag that strays off the SVG still tracks/finalizes
    if (!plotDrag) return;
    if (Math.abs(e.clientX - plotDrag.x) > 6 || Math.abs(e.clientY - plotDrag.y) > 6) plotDrag.moved = true;
    if (!plotDrag.moved || plotDrag.shift || !plotDrag.start) return;   // only a path drag previews
    const s = byId(plotDrag.id), hex = clickToHex(e); if (!s || !hex) return;
    if (plotDrag.lastHex && plotDrag.lastHex.q === hex.q && plotDrag.lastHex.r === hex.r) return;   // same snapped hex → skip the pathFrom + re-render
    plotDrag.lastHex = hex;
    ui.navPreview = { shipId: s.id, steps: pathFrom(s, plotBase(s), plotDrag.start, hex) };   // live path preview
    render();
  });
  window.addEventListener('mouseup', e => {
    const d = plotDrag; plotDrag = null; const had = !!ui.navPreview; ui.navPreview = null;
    if (!d || !d.moved || getPhase() !== 'energy') { if (had) render(); return; }
    const s = byId(d.id), hex = clickToHex(e); if (!s || !hex) { render(); return; }
    if (d.shift && isMine(s) && !hasGhosts()) {   // shift-drag → sideslip from the course end (nav — blocked while a ghost is open)
      const cur = plotCursor(s, plotBase(s)), slip = cur.speed > 0 ? trySideslip(cur.pos, cur.facing, cur.hst, cur.slip, hex) : null;
      if (slip) { courseOf(s).steps.push({ q: slip.pos.q, r: slip.pos.r, facing: slip.facing, slip: true }); saveSoon(s.id); }
      suppressClick = true; render(); return;
    }
    if (d.start) { courseOf(s).steps = pathFrom(s, plotBase(s), d.start, hex); saveSoon(s.id); suppressClick = true; render(); return; }   // nav / candidate drag → path
    if (isMine(s) && !hasGhosts()) {   // friendly ship glyph onto a green (legal-next) or purple (sideslip) hex → extend one step (nav is blocked while a ghost is open)
      const cur = plotCursor(s, plotBase(s));
      const step = tryStep(cur.pos, cur.facing, cur.speed, cur.hst, cur.slip, hex);
      if (step) { courseOf(s).steps.push({ q: step.pos.q, r: step.pos.r, facing: step.facing }); saveSoon(s.id); suppressClick = true; render(); return; }
      const slip = cur.speed > 0 ? trySideslip(cur.pos, cur.facing, cur.hst, cur.slip, hex) : null;
      if (slip) { courseOf(s).steps.push({ q: slip.pos.q, r: slip.pos.r, facing: slip.facing, slip: true }); saveSoon(s.id); suppressClick = true; render(); return; }
    }
    if (!(hex.q === s.q && hex.r === s.r)) { ui.ghosts[s.id] = { q: hex.q, r: hex.r, facing: s.facing }; ui.selectedGhost = s.id; joinFireGroup(s); }   // dropped elsewhere → ghost (a same-hex near-click release is a no-op)
    suppressClick = true; render();
  });
  // energy phase clicks: plot courses (snap) / speed-change on a path hex / shift-click to measure range
  map.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }   // a drag-sideslip just happened; don't also turn
    if (getPhase() !== 'energy') return;
    const hex = clickToHex(e); if (!hex) return;
    const shipHere = getShips().find(s => s.q === hex.q && s.r === hex.r);
    if (shipHere && isMine(shipHere)) { ui.plotShipId = shipHere.id; ui.eaSelected = shipHere.id; onShipClick(shipHere); return; }   // friendly → route subject + join the virtual fire group
    if (shipHere && !isMine(shipHere)) { onShipClick(shipHere); return; }   // enemy → fire-group target: draws the target line + opens the weapons panel
    if (hasGhosts()) return;   // nav plotting is blocked while a ghost what-if is open (fire-group + ghosting are not)
    if (ui.plotShipId && byId(ui.plotShipId)) {   // click a legal candidate hex → extend the course one step (drag re-routes; right-click a nav hex = speed change)
      const s = byId(ui.plotShipId), c = courseOf(s), cur = plotCursor(s, plotBase(s));
      const step = tryStep(cur.pos, cur.facing, cur.speed, cur.hst, cur.slip, hex);
      if (step) { c.steps.push({ q: step.pos.q, r: step.pos.r, facing: step.facing }); saveSoon(ui.plotShipId); render(); }
    }
  });
  // impulse phase: drag a ship to move it (snaps to nearest hex); a plain click selects it
  map.addEventListener('mousedown', e => { if (e.altKey || hasGhosts() || getPhase() !== 'impulse') return; const gg = e.target.closest('.ship'); if (!gg) return; ui.dragging = { s: byId(gg.dataset.id), moved: false }; ui.selectedId = ui.dragging.s.id; renderFleet(); e.preventDefault(); });
  window.addEventListener('mousemove', e => {
    if (!ui.dragging) return; const p = svgPoint(e), h = nearestHex(p.x, p.y);
    if (h.q !== ui.dragging.s.q || h.r !== ui.dragging.s.r) { ui.dragging.s.q = h.q; ui.dragging.s.r = h.r; ui.dragging.moved = true; pruneUnavailable(); render(); }
  });
  window.addEventListener('mouseup', () => { if (ui.dragging) { const s = ui.dragging.s, moved = ui.dragging.moved; ui.dragging = null; if (!moved) onShipClick(s); else saveSoon(s.id); } });
  // right-click: clear the plot (energy) or open the ship context menu
  map.addEventListener('contextmenu', e => {
    const g = e.target.closest('.ship');
    if (g) { e.preventDefault(); openCtxMenu(g.dataset.id, e); return; }   // right-click a ship → View EA / View SSD (both phases, any side)
    const ps = getPhase() === 'energy' && ui.plotShipId && byId(ui.plotShipId);
    if (ps && isMine(ps)) {
      const idx = navIdxAt(ps, clickToHex(e));
      if (idx >= 0) { e.preventDefault(); openSpeedMenu(ps.id, idx, e); return; }   // right-click a nav hex → speed-change menu
      if (ps.course) { e.preventDefault(); ps.course = null; ps.speedPlot = null; ps.autopilot = false; saveSoon(ps.id); render(); }   // right-click empty map → clear the plot
    }
  });

  return { clickToHex };
}
