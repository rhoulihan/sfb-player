// Shared SSD rendering engine: the system-family taxonomy + pure cell-layout geometry used by
// BOTH the verify editor (verify.html) and the damage view (damage.html). DOM-free.

export const CATS = ['Defensive', 'Power', 'Weapons', 'Control', 'Sensors/EW', 'Hull', 'Aux Systems', 'Consumables', 'Special', 'Markers'];

export const TAX = [
  { k: 'shield', n: 'Shield', c: 'Defensive', col: '#7c3aed', d: true },
  { k: 'warp-engine', n: 'Warp Engine', c: 'Power', col: '#2563eb', d: true },
  { k: 'warp-reactor', n: 'Warp Reactor', c: 'Power', col: '#1e3a8a', d: true },
  { k: 'impulse-engine', n: 'Impulse Engine', c: 'Power', col: '#3b82f6', d: true },
  { k: 'apr', n: 'APR (Aux Power)', c: 'Power', col: '#60a5fa', d: true },
  { k: 'battery', n: 'Battery / Reserve', c: 'Power', col: '#93c5fd', d: true },
  { k: 'phaser', n: 'Phaser', c: 'Weapons', col: '#dc2626', d: true },
  { k: 'heavy-weapon', n: 'Heavy Weapon', c: 'Weapons', col: '#991b1b', d: true },
  { k: 'drone-rack', n: 'Drone Rack', c: 'Weapons', col: '#ef4444', d: true },
  { k: 'anti-drone', n: 'Anti-drone (ADD)', c: 'Weapons', col: '#f87171', d: true },
  { k: 'esg', n: 'ESG', c: 'Weapons', col: '#7f1d1d', d: true },
  { k: 'sfg', n: 'Stasis Field Gen', c: 'Weapons', col: '#e11d48', d: true },
  { k: 'mine-rack', n: 'Mine Rack', c: 'Weapons', col: '#f97316', d: true },
  { k: 'bridge', n: 'Bridge', c: 'Control', col: '#d97706', d: true },
  { k: 'flag-bridge', n: 'Flag Bridge', c: 'Control', col: '#92400e', d: true },
  { k: 'emergency-bridge', n: 'Emergency Bridge', c: 'Control', col: '#f59e0b', d: true },
  { k: 'auxiliary-control', n: 'Auxiliary Control', c: 'Control', col: '#fbbf24', d: true },
  { k: 'security-station', n: 'Security Station', c: 'Control', col: '#b45309', d: true },
  { k: 'sensor', n: 'Sensor', c: 'Sensors/EW', col: '#0d9488', d: true },
  { k: 'scanner', n: 'Scanner', c: 'Sensors/EW', col: '#14b8a6', d: true },
  { k: 'damage-control', n: 'Damage Control', c: 'Sensors/EW', col: '#0f766e', d: true },
  { k: 'fire-control', n: 'Fire Control', c: 'Sensors/EW', col: '#2dd4bf', d: true },
  { k: 'hull', n: 'Hull', c: 'Hull', col: '#475569', d: true },
  { k: 'cargo', n: 'Cargo', c: 'Hull', col: '#64748b', d: true },
  { k: 'armor', n: 'Armor', c: 'Hull', col: '#334155', d: true },
  { k: 'excess-damage', n: 'Excess Damage', c: 'Hull', col: '#94a3b8', d: true },
  { k: 'lab', n: 'Lab', c: 'Aux Systems', col: '#4d7c0f', d: true },
  { k: 'transporter', n: 'Transporter', c: 'Aux Systems', col: '#84cc16', d: true },
  { k: 'tractor', n: 'Tractor', c: 'Aux Systems', col: '#65a30d', d: true },
  { k: 'probe-launcher', n: 'Probe Launcher', c: 'Aux Systems', col: '#a3e635', d: true },
  { k: 'shuttle-bay', n: 'Shuttle Bay / Fighters', c: 'Aux Systems', col: '#16a34a', d: true },
  { k: 'repair', n: 'Repair', c: 'Aux Systems', col: '#15803d', d: true },
  { k: 'barracks', n: 'Barracks', c: 'Aux Systems', col: '#22c55e', d: true },
  { k: 'crew', n: 'Crew Units', c: 'Consumables', col: '#ec4899', d: false },
  { k: 'boarding-party', n: 'Boarding Parties', c: 'Consumables', col: '#f472b6', d: false },
  { k: 'ammo-track', n: 'Ammo / Reload Track', c: 'Consumables', col: '#db2777', d: false },
  { k: 'cloaking-device', n: 'Cloaking Device', c: 'Special', col: '#c026d3', d: true },
  { k: 'markers', n: 'Markers / Non-system', c: 'Markers', col: '#737373', d: false },
];

export const FAMCOL = Object.fromEntries(TAX.map(f => [f.k, f.col]));
export const FAMNAME = Object.fromEntries(TAX.map(f => [f.k, f.n]));
export const FAMS = TAX.map(f => f.k);

export const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// One cell size for the WHOLE ship = median box size (robust to the few double-width boxes).
export function globalCell(boxes, IMGW, IMGH) {
  if (!boxes.length) return { w: 24, h: 24 };
  return { w: med(boxes.map(b => b.bbox[2] * IMGW)) || 24, h: med(boxes.map(b => b.bbox[3] * IMGH)) || 24 };
}

// A box is "double" (2 cells wide + divider) when its original width is ~2x the cell (drone-rack reloads).
export const isWide = (box, cellW, IMGW) => (box.bbox[2] * IMGW) > cellW * 1.5;

// Snap a group's boxes to a regular grid: every row shares one Y, columns on a uniform pitch.
export function layoutGroup(boxIds, boxIndex, IMGW, IMGH) {
  const bs = (boxIds || []).map(id => boxIndex[id]).filter(Boolean); if (bs.length < 2) return null;
  const CX = b => (b.bbox[0] + b.bbox[2] / 2) * IMGW, CY = b => (b.bbox[1] + b.bbox[3] / 2) * IMGH;
  const mw = med(bs.map(b => b.bbox[2] * IMGW)), mh = med(bs.map(b => b.bbox[3] * IMGH));
  const os = bs.map(b => ({ b, cx: CX(b), cy: CY(b) })).sort((a, b) => a.cy - b.cy);
  const rows = []; let cur = [];
  os.forEach(o => { if (cur.length && Math.abs(o.cy - cur[cur.length - 1].cy) > mh * 0.6) { rows.push(cur); cur = []; } cur.push(o); });
  if (cur.length) rows.push(cur);
  const pitchOf = arr => { if (arr.length < 2) return 0; const s = arr.slice().sort((a, b) => a - b); const d = []; for (let i = 1; i < s.length; i++) { const gp = s[i] - s[i - 1]; if (gp > mw * 0.4) d.push(gp); } return med(d); };
  const big = rows.reduce((a, b) => b.length > a.length ? b : a, rows[0]);
  const px = pitchOf(big.map(o => o.cx)) || mw * 1.25;
  const ox = Math.min(...os.map(o => o.cx));   // shared column origin so dense rows line up vertically
  const GAP = px * 3;                          // gaps wider than this are separate clusters, kept in place
  const snap = {};
  // Each dense cluster snaps to the shared column grid (ox + col·px); within a cluster columns advance
  // greedily (>= 1 per box) so connected/overlapping/close boxes de-overlap into distinct adjacent cells
  // while genuine single-cell gaps are preserved. A big gap (e.g. left/right wing weapons) starts a new
  // sub-cluster anchored at its REAL position, so separated boxes don't drift onto a distant grid.
  rows.forEach(row => {
    row.sort((a, b) => a.cx - b.cx); const rowY = med(row.map(o => o.cy));
    let base = ox + Math.round((row[0].cx - ox) / px) * px, col = 0;
    snap[row[0].b.id] = { cx: base, cy: rowY };
    for (let i = 1; i < row.length; i++) {
      const delta = row[i].cx - row[i - 1].cx;
      if (delta > GAP) { base = row[i].cx; col = 0; }               // separated sub-cluster: keep real position
      else col += Math.max(1, Math.round(delta / px));             // else advance on the local grid (de-overlap)
      snap[row[i].b.id] = { cx: base + col * px, cy: rowY };
    }
  });
  return snap;
}

// On-screen rect for a box. When `cell` is given (uniform mode) the box is snapped + sized to the cell.
export function boxRect(box, snap, cell, wide, IMGW, IMGH) {
  const [nx, ny, nw, nh] = box.bbox; let cx = (nx + nw / 2) * IMGW, cy = (ny + nh / 2) * IMGH, w = nw * IMGW, h = nh * IMGH;
  if (cell) { if (snap && snap[box.id]) { cx = snap[box.id].cx; cy = snap[box.id].cy; } w = cell.w * (wide ? 2 : 1); h = cell.h; }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// contrasting ink for a fill colour so overlaid labels stay legible
export function inkFor(col) {
  const c = (col || '#888').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), gg = parseInt(c.slice(2, 4), 16), bb = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * gg + 0.114 * bb) > 150 ? '#0f172a' : '#f8fafc';
}
