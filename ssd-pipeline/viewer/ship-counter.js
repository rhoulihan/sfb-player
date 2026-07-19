// Ship map counters — pure logic. A ship renders on the battle map as a square game counter bearing a clean
// top-down line drawing of its hull class; the whole counter rotates to follow the ship's heading (like turning
// a physical cardboard counter). The drawings (ship-counter-art.js) are original art, drawn forward = up, one
// per hull class. A ship with no known class falls back to a vector outline derived from its verified SSD
// box cluster (counterOutlineFromBoxes), stored in verified.json and editable there.

// ship code → hull class. Three Fed cruisers share one drawing; the Romulan KR flies a D7-family hull.
export const COUNTER_CLASS = {
  'FED-CA': 'fed-cruiser', 'FED-CL': 'fed-cruiser', 'FED-NCL': 'fed-cruiser',
  'KLI-D7': 'klingon-d7', 'ROM-KR': 'klingon-d7',
  'GOR-CA': 'gorn-ca',
  'KZIN-CS': 'kzinti-cs',
};
export function counterClassFor(code) { return COUNTER_CLASS[code] || null; }

// Rotation (degrees, SVG rotate() = clockwise in screen coords) that points forward=up art along the map
// heading. The map's heading frame is headingDeg(f) = f*60+30 measured from +X clockwise (battle-geom); art
// forward (up, −Y) sits at 270° in that frame, so rotating by headingDeg+90 lands it on the heading.
export function counterAngle(facing) { return ((((facing % 6) + 6) % 6) * 60 + 120) % 360; }

// Families that are never part of the drawn ship body on an SSD: the shield rows ring the drawing, and the
// crew/ammo tables and sensor/scanner/DC/excess track columns live elsewhere on the page. Everything else
// (hull, engines, weapons, bridge …) forms the ship shape; any remaining detached table is dropped by the
// largest-connected-component pass in counterOutlineFromBoxes.
export const NON_BODY_FAMILIES = new Set(['shield', 'crew', 'ammo-track', 'markers', 'excess-damage', 'sensor', 'scanner', 'damage-control', 'rating-track']);

// Collect the ship-body boxes ({x,y,w,h}) from a verified.json + a boxId→box index (detection boxes + extras).
export function shipBodyBoxes(verified, boxIndex) {
  const out = [];
  for (const g of (verified.groups || [])) {
    if (NON_BODY_FAMILIES.has(g.family)) continue;
    for (const id of (g.boxIds || [])) { const b = boxIndex[id]; if (b) out.push({ x: b.x, y: b.y, w: b.w, h: b.h }); }
  }
  return out;
}

// Ray-cast point-in-polygon (even-odd). `pts` is a ring of [x,y] (first point not repeated).
export function pointInPolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Scale + center a point ring into a size×size square with `pad` on every side, preserving aspect ratio.
export function fitPointsToBox(points, size, pad = 0) {
  if (!points || !points.length) return [];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = (x1 - x0) || 1e-9, h = (y1 - y0) || 1e-9;
  const s = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return points.map(([x, y]) => [(x - cx) * s + size / 2, (y - cy) * s + size / 2]);
}

// FALLBACK COUNTER OUTLINE: trace a clean concave vector outline around a ship's SSD box cluster. The caller
// passes the ship-body boxes ({x,y,w,h}, shield rows already filtered out); detached clusters (off-ship tables)
// are dropped by keeping only the largest connected blob. Boxes are padded and rasterized onto a coarse grid
// (which also bridges the small gutters between box groups), the largest 4-connected component's boundary is
// chained into loops, and the outer loop is returned as a ring of [x,y] points with collinear runs merged.
export function counterOutlineFromBoxes(boxes, opts = {}) {
  if (!boxes || !boxes.length) return [];
  const sizes = boxes.map(b => Math.min(b.w, b.h)).sort((a, b) => a - b);
  const cell = opts.cell || Math.max(4, Math.round((sizes[Math.floor(sizes.length / 2)] || 10) / 2));
  const pad = opts.pad ?? cell;
  const close = opts.close ?? 2;                                              // morphological-closing radius, in cells — 2 bridges real SSD inter-group gutters (~50px at the default cell) without reaching the off-body track columns (~200px away)
  const bx0 = Math.min(...boxes.map(b => b.x)) - pad, by0 = Math.min(...boxes.map(b => b.y)) - pad;
  const bx1 = Math.max(...boxes.map(b => b.x + b.w)) + pad, by1 = Math.max(...boxes.map(b => b.y + b.h)) + pad;
  const ox = bx0 - cell * (close + 1), oy = by0 - cell * (close + 1);         // guaranteed-empty margin (room for the dilate pass)
  const nx = Math.ceil((bx1 - ox) / cell) + close + 1, ny = Math.ceil((by1 - oy) / cell) + close + 1;
  let occ = new Uint8Array(nx * ny);
  for (const b of boxes) {                                                    // mark every cell the padded box touches
    const i0 = Math.max(0, Math.floor((b.x - pad - ox) / cell)), i1 = Math.min(nx - 1, Math.floor((b.x + b.w + pad - ox - 1e-9) / cell));
    const j0 = Math.max(0, Math.floor((b.y - pad - oy) / cell)), j1 = Math.min(ny - 1, Math.floor((b.y + b.h + pad - oy - 1e-9) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * nx + i] = 1;
  }
  // Morphological CLOSING (dilate then erode by `close` cells, Chebyshev window): bridges the gutters between
  // box groups — which can land on a fully-empty grid row and split the ship into pieces — without inflating
  // the outer boundary (closing a solid shape returns it unchanged).
  if (close > 0) {
    const win = (src, want) => {                                              // want=1: dilate (any set) · want=0: erode (all set)
      const dst = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let hit = want === 1 ? 0 : 1;
        for (let dj = -close; dj <= close && (want === 1 ? !hit : hit); dj++) for (let di = -close; di <= close; di++) {
          const i2 = i + di, j2 = j + dj;
          const v = (i2 >= 0 && j2 >= 0 && i2 < nx && j2 < ny) ? src[j2 * nx + i2] : 0;
          if (want === 1) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
        }
        dst[j * nx + i] = hit;
      }
      return dst;
    };
    occ = win(win(occ, 1), 0);
  }
  // largest 4-connected component (drops detached table clusters)
  const comp = new Int32Array(nx * ny).fill(-1);
  let best = -1, bestCount = 0, nc = 0;
  for (let s = 0; s < occ.length; s++) {
    if (!occ[s] || comp[s] >= 0) continue;
    const stack = [s]; comp[s] = nc; let count = 0;
    while (stack.length) {
      const k = stack.pop(); count++;
      const i = k % nx, j = (k - i) / nx;
      if (i + 1 < nx && occ[k + 1] && comp[k + 1] < 0) { comp[k + 1] = nc; stack.push(k + 1); }
      if (i - 1 >= 0 && occ[k - 1] && comp[k - 1] < 0) { comp[k - 1] = nc; stack.push(k - 1); }
      if (j + 1 < ny && occ[k + nx] && comp[k + nx] < 0) { comp[k + nx] = nc; stack.push(k + nx); }
      if (j - 1 >= 0 && occ[k - nx] && comp[k - nx] < 0) { comp[k - nx] = nc; stack.push(k - nx); }
    }
    if (count > bestCount) { bestCount = count; best = nc; }
    nc++;
  }
  const filled = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && comp[j * nx + i] === best;
  // directed boundary edges (clockwise around the filled region in y-down screen coords), keyed by from-vertex
  const vkey = (i, j) => j * (nx + 1) + i;
  const out = new Map();                                                      // fromVertex → [{ti,tj,dx,dy}]
  const addE = (fi, fj, ti, tj) => { const k = vkey(fi, fj); if (!out.has(k)) out.set(k, []); out.get(k).push({ ti, tj, dx: Math.sign(ti - fi), dy: Math.sign(tj - fj) }); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!filled(i, j)) continue;
    if (!filled(i, j - 1)) addE(i, j, i + 1, j);                              // empty above → run right along the top
    if (!filled(i + 1, j)) addE(i + 1, j, i + 1, j + 1);                      // empty right → run down the right side
    if (!filled(i, j + 1)) addE(i + 1, j + 1, i, j + 1);                      // empty below → run left along the bottom
    if (!filled(i - 1, j)) addE(i, j + 1, i, j);                              // empty left → run up the left side
  }
  // chain edges into closed loops; at an ambiguous (diagonal-touch) vertex prefer the sharpest right turn
  const loops = [];
  for (const [startK, list] of out) {
    while (list.length) {
      const first = list.pop();
      let ci = startK % (nx + 1), cj = (startK - ci) / (nx + 1);
      const loop = [[ci, cj]];
      let e = first;
      for (let guard = 0; guard < nx * ny * 8; guard++) {
        ci = e.ti; cj = e.tj;
        if (vkey(ci, cj) === startK) break;                                   // closed
        loop.push([ci, cj]);
        const cands = out.get(vkey(ci, cj)) || [];
        if (!cands.length) break;                                             // shouldn't happen — every vertex has equal in/out degree
        const pri = c => (c.dx === -e.dy && c.dy === e.dx) ? 0 : (c.dx === e.dx && c.dy === e.dy) ? 1 : (c.dx === e.dy && c.dy === -e.dx) ? 2 : 3;
        cands.sort((a, b) => pri(a) - pri(b));
        e = cands.shift();
      }
      loops.push(loop);
    }
  }
  if (!loops.length) return [];
  const area = L => Math.abs(L.reduce((a, [x, y], i) => { const [x2, y2] = L[(i + 1) % L.length]; return a + x * y2 - x2 * y; }, 0)) / 2;
  const outer = loops.reduce((a, b) => (area(b) > area(a) ? b : a));
  // grid vertices → pixel coords, then merge collinear runs (circularly)
  let pts = outer.map(([i, j]) => [ox + i * cell, oy + j * cell]);
  pts = pts.filter(([x, y], i) => { const [px, py] = pts[(i + pts.length - 1) % pts.length]; return x !== px || y !== py; });
  const dir = (a, b) => `${Math.sign(b[0] - a[0])},${Math.sign(b[1] - a[1])}`;
  return pts.filter((p, i) => dir(pts[(i + pts.length - 1) % pts.length], p) !== dir(p, pts[(i + 1) % pts.length]));
}

import { COUNTER_VIEW } from './ship-counter-art.js';

// Render one square game counter as an SVG fragment. The WHOLE counter (frame included) is translated to the
// hex centre and rotated to the ship's heading — like turning a physical cardboard counter on the map. Content
// precedence: custom uploaded art (imageHref) → hull-class line drawing (art, tinted via currentColor) →
// fallback outline polygon (outline, from counterOutlineFromBoxes) → a generic delta. The ship-id label is NOT
// part of this group — callers draw it separately, un-rotated, so it stays screen-upright at every heading.
export function counterSvg({ cx, cy, size = 38, angle = 0, frameFill = '#2563eb', frameStroke = '#173e8f', color = '#fff', art = null, outline = null, imageHref = null }) {
  const h = size / 2, rx = size * 0.14, inner = size * 0.92, k = inner / COUNTER_VIEW;
  const toView = `scale(${k}) translate(${-COUNTER_VIEW / 2},${-COUNTER_VIEW / 2})`;   // COUNTER_VIEW-space content, centred on the origin
  let content;
  if (imageHref) content = `<image x="${-inner / 2}" y="${-inner / 2}" width="${inner}" height="${inner}" href="${imageHref}" preserveAspectRatio="xMidYMid meet"/>`;
  else if (art) content = `<g color="${color}" transform="${toView}">${art}</g>`;
  else if (outline && outline.length >= 3) {
    const pts = fitPointsToBox(outline, COUNTER_VIEW, 6);
    content = `<g transform="${toView}"><path d="M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z" fill="${color}" opacity="0.92"/></g>`;
  } else content = `<g transform="${toView}"><path d="M32,10 L52,52 L32,42 L12,52 Z" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/></g>`;
  return `<g transform="translate(${cx},${cy}) rotate(${angle})">` +
    `<rect x="${-h}" y="${-h}" width="${size}" height="${size}" rx="${rx}" fill="${frameFill}" stroke="${frameStroke}" stroke-width="2"/>` +
    content + `</g>`;
}

// Classic SFB counter colors per race (Rick's palette): bg = counter fill, fg = ship-drawing tint.
// Keyed by the ship-code race prefix (FED-CA → FED); unknown races get a neutral slate counter.
export const RACE_COLORS = {
  FED:  { bg: '#2563eb', fg: '#000000' },   // black ship on blue
  KLI:  { bg: '#000000', fg: '#ffffff' },   // white ship on black
  ROM:  { bg: '#C74634', fg: '#000000' },   // black ship on red
  KZIN: { bg: '#f97316', fg: '#ffffff' },   // white on orange
  GOR:  { bg: '#16a34a', fg: '#ffffff' },   // white on green
  THOL: { bg: '#C74634', fg: '#ffffff' },   // white on red
  LYR:  { bg: '#facc15', fg: '#15803d' },   // green on yellow
  HYD:  { bg: '#16a34a', fg: '#000000' },   // black on green
};
export function counterColors(code) {
  return RACE_COLORS[String(code || '').split('-')[0]] || { bg: '#475569', fg: '#ffffff' };
}
