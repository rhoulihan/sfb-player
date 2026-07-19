// Shared Energy-Allocation control renderers. Both the battle EA panel (battle.html) and the EAF layout editor
// (verify.html) render controls with these, so the editor is pixel-identical to the game. Each returns an
// absolutely-positioned `.ctl` div (styled by eaf-panel.css) with the game's data-ea hooks; the editor just
// makes them draggable and ignores the hooks. `ctl(x,y,inner,extra)` positions by % of the art.
import { armLabel, canRoll, armTurns, rollCost } from './weapon-arming.js';

export const ctl = (x, y, inner, extra = '') => `<div class="ctl ${extra}" style="left:${x}%;top:${y}%">${inner}</div>`;
export const stepPair = (key, val, max) =>   // a −/+ button pair bound to a column key (clamped via sinkMax in the handler)
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button><button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button>`;
export const stackCtl = (x, y, label, key, val, max) =>   // left-stack: label line, then [−] value [+] on the second line
  ctl(x, y, `<div class="lab">${label}</div><div class="row"><button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button><span class="val">${val}</span><button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button></div>`);
export const barCtl = (x, y, lit, total) =>   // non-adjustable status bar (SENSORS), enlarged
  ctl(x, y, `<div class="statbar">${Array.from({ length: total }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</div>`, 'bigbar');
export const sysCtl = (x, y, key, val, max) =>   // bottom-strip: centered counter with the +/- buttons side by side on the right
  `<div class="ctl syscell" style="left:${x}%;top:${y}%"><span class="val">${val}</span><span class="vstep">` +
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button>` +
  `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button></span></div>`;
export const batteryCtl = (x, y, charge, recharge, max) => {   // BATTERIES: current+charging / capacity; +/- allocate recharge, capped to empty batteries
  const total = charge + recharge, room = max - charge;
  return `<div class="ctl syscell" style="left:${x}%;top:${y}%"><span class="val">${total}/${max}</span><span class="vstep">` +
    `<button class="stepbtn" data-ea="step" data-key="recharge" data-d="-1"${recharge <= 0 ? ' disabled' : ''}>−</button>` +
    `<button class="stepbtn" data-ea="step" data-key="recharge" data-d="1"${recharge >= room ? ' disabled' : ''}>+</button></span></div>`;
};
export const ewCtl = (x, y, ecm, eccm, max) =>   // EW box: ECM/ECCM label, value/value counter, a −/+ pair on either side
  ctl(x, y, `<div class="lab">ECM/ECCM</div><div class="row">${stepPair('ecm', ecm, max)}<span class="val">${ecm}/${eccm}</span>${stepPair('eccm', eccm, max)}</div>`);
// Combined shuttle-bay control set: inventory + power summary header, then one counter each for the
// wild-weasel charge (J3.12, 0/1 point) and suicide-shuttle arming (J2.2211, 0-3 points). o = {inv, bays,
// pw, ww, wwMax, wwStat, sui, suiMax, suiStat, wwLaunch, suiLaunch, variant} — the stat strings carry
// cross-turn arming progress ("1/2", "✓", "2/3", "✓W18") and are empty when nothing is banked; the launch
// flags enable each 🚀 (armed + movement phase; the suicide launch takes the drone-targeting target).
// variant picks the shape: 0 = default (header + two counter rows), 1 = wide (one flat row),
// 2 = tall (narrow stack, one line per element). Stored as controls['shuttles'][2] in the EAF layout.
const SHUTTLE_TITLES = {
  ww: 'Launch the charged wild weasel (J3.12) — needs two consecutive turns of charge',
  sui: 'Launch the armed suicide shuttle (J2.2211) at the attack-group target — click an enemy ship to target, as with drones',
};
export const shuttleCtl = (x, y, o) => {
  const steps = (key, val, max) =>
    `<button class="stepbtn" data-ea="step" data-key="${key}" data-d="-1"${val <= 0 ? ' disabled' : ''}>−</button><span class="val">${val}</span><button class="stepbtn" data-ea="step" data-key="${key}" data-d="1"${val >= max ? ' disabled' : ''}>+</button>`;
  const rocket = (kind, launch) => `<button data-ea="shlaunch" data-kind="${kind}"${launch ? '' : ' disabled'} title="${SHUTTLE_TITLES[kind]}">🚀</button>`;
  const hdr = `SHUTTLES ${o.inv}/${o.bays} · ⚡${o.pw}`;
  const v = o.variant | 0;
  // Compact variants share ONE stepper + launch pair between the two shuttle types; the WW/SUI toggle
  // (data-ea="shmode", view state in the host) picks which type the shared controls address.
  const m = o.mode === 'sui' ? 'sui' : 'ww';
  const act = m === 'ww'
    ? { key: 'wildWeasel', kind: 'ww', val: o.ww, max: o.wwMax, stat: o.wwStat, launch: o.wwLaunch }
    : { key: 'suicide', kind: 'sui', val: o.sui, max: o.suiMax, stat: o.suiStat, launch: o.suiLaunch };
  const modeBtns = withVals =>
    `<button data-ea="shmode" data-mode="ww" class="${m === 'ww' ? 'on' : ''}">WW${withVals ? ' ' + o.ww : ''}</button>`
    + `<button data-ea="shmode" data-mode="sui" class="${m === 'sui' ? 'on' : ''}">SUI${withVals ? ' ' + o.sui : ''}</button>`;
  if (v === 1)   // wide: two lines — header, then toggle + the shared stepper/status/launch
    return ctl(x, y, `<div class="lab">${hdr}</div>`
      + `<div class="row">${modeBtns(true)}${steps(act.key, act.val, act.max)}${act.stat ? `<span class="lab">${act.stat}</span>` : ''}${rocket(act.kind, act.launch)}</div>`);
  if (v === 2)   // tall: narrow stack — toggle, stepper, and launch each on their own compact line
    return ctl(x, y, `<div class="lab">SHUTTLES</div><div class="lab">${o.inv}/${o.bays} · ⚡${o.pw}</div>`
      + `<div class="row">${modeBtns(false)}</div>`
      + `<div class="row">${steps(act.key, act.val, act.max)}</div>`
      + `<div class="row">${rocket(act.kind, act.launch)}${act.stat ? `<span class="lab">${act.stat}</span>` : ''}</div>`);
  const row = (tag, key, kind, val, max, stat, launch) =>
    `<div class="row"><span class="lab">${tag}</span>${steps(key, val, max)}${stat ? `<span class="lab">${stat}</span>` : ''}${rocket(kind, launch)}</div>`;
  return ctl(x, y, `<div class="lab">${hdr}</div>`
    + row('WW', 'wildWeasel', 'ww', o.ww, o.wwMax, o.wwStat, o.wwLaunch)
    + row('SUI', 'suicide', 'sui', o.sui, o.suiMax, o.suiStat, o.suiLaunch));
};
export const toggleCtl = (x, y, label, key, on, num) =>
  ctl(x, y, `<div class="lab">${label}</div><button class="${on ? 'on' : ''}" data-ea="toggle" data-key="${key}"${num ? ' data-num="1"' : ''}>${on ? 'ON' : 'OFF'}</button>`);
export function shieldCtl(n, x, y, strength, reinf, max, gen = 0) {
  const hl = reinf > 0 || gen > 0;   // highlight on specific OR general reinforcement (general lights all 6 — Rick)
  return ctl(x, y, `<div class="lab">SHLD ${n}</div><div class="val">${strength}${reinf ? '+' + reinf : ''}${gen ? `<span style="font-size:9px;opacity:.85"> +${gen}g</span>` : ''}</div>
    <div class="row"><button class="stepbtn" data-ea="specstep" data-shield="${n}" data-d="-1">−</button><button class="stepbtn" data-ea="specstep" data-shield="${n}" data-d="1"${reinf >= max ? ' disabled' : ''}>+</button></div>`, hl ? 'reinf' : '');
}
export function weaponCtl(x, y, w, st) {
  const name = w.cls === 'DISR' ? 'DISRUPTOR' : w.cls;   // full weapon name + SSD box label (A–D)
  return ctl(x, y, `<div class="lab">${name} ${w.label || ''}</div><div class="row"><button class="${st.armed ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="armed" title="multi-turn arming (E4.21/FP1.21) — fires only when fully armed or held">${st.roll ? 'ROLL' : armLabel(w.cls, st.progress || 0)}</button>${w.plasma ? '' : `<button class="${st.overload ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="overload">OL</button>`}${w.cls === 'PHOTON' ? `<button class="${st.prox ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="prox">PX</button>` : ''}${canRoll(w.cls) && (st.progress || 0) === armTurns(w.cls) - 1 ? `<button class="${st.roll ? 'on' : ''}" data-ea="weap" data-wid="${w.id}" data-what="roll" title="rolling delay — stall one turn short of completion for ${rollCost(w.cls)} (FP1.221)">ROLL</button>` : ''}</div>`);
}
// phaser capacitor: spell it out, show existing (carried) charge, and never allow overcharging past capacity
export function capCtl(x, y, carried, charging, cap) {
  const total = carried + charging, room = cap - carried;
  return ctl(x, y, `<div class="lab">PHASERS (Held: ${carried})</div><div class="row"><button class="stepbtn" data-ea="step" data-key="phaserCap" data-d="-1"${charging <= 0 ? ' disabled' : ''}>−</button><span class="val">${total}/${cap}</span><button class="stepbtn" data-ea="step" data-key="phaserCap" data-d="1"${charging >= room ? ' disabled' : ''}>+</button></div>`);
}
export const segCtl = (x, y, label, key, val) =>
  ctl(x, y, `<div class="lab">${label}</div><div class="row">${[['OFF', 0], ['LO', 0.5], ['FUL', 1]].map(([t, v]) => `<button class="${val === v ? 'on' : ''}" data-ea="seg" data-key="${key}" data-val="${v}">${t}</button>`).join('')}</div>`);

// ---- shield strength/reinforcement overlay geometry (shared: battle EA panel + EAF editor preview) ----
// A placed overlay marker stores [x%, y%, facingDeg, len, wid, shape] in the layout. Shape 0 = elongated hexagon
// (Klingon-style SSD shield slot; len/wid are half-length/half-width in art px), shape 1 = annular ARC sector
// (Federation-style ring band; len = angular span in degrees, wid = band thickness in art px, curved about the
// ring centre = centroid of the placed markers). Both hosts render through shieldOverlaySvg so the editor
// preview is pixel-identical to the game.
export function ovDims(raw) {
  const shape = raw && raw[5] === 1 ? 'arc' : 'hex';
  return {
    deg: raw ? raw[2] : undefined,
    len: (raw && raw[3] != null) ? raw[3] : (shape === 'arc' ? 56 : 112),
    wid: (raw && raw[4] != null) ? raw[4] : (shape === 'arc' ? 154 : 70),
    shape,
    taper: (raw && raw[6]) || 0,   // hex only: % taper of the facing edge vs the inner edge (±, 0 = symmetric)
  };
}
// Elongated hexagon rotated `deg` about (cx,cy); tips inset by ti. `taper` (±%) makes it an irregular convex
// hexagon: the facing (outer, −v) edge shrinks while the inner (+v) edge grows — taper 40 → outer at 60% width,
// inner at 140% — matching SSD shield slots that narrow toward the shield face.
const hexPath = (cx, cy, hl, hw, ti, deg, taper = 0) => {
  const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const t = Math.max(-0.9, Math.min(0.9, taper / 100)), ho = hw * (1 - t), hi = hw * (1 + t);
  return 'M' + [[-hl, 0], [-hl + ti, -ho], [hl - ti, -ho], [hl, 0], [hl - ti, hi], [-hl + ti, hi]]
    .map(([u, v]) => `${(cx + u * c - v * s).toFixed(0)} ${(cy + u * s + v * c).toFixed(0)}`).join(' L') + ' Z';
};
// annular sector through (cx,cy) FACING deg (the band's outward direction; 0 = up, clockwise — the same facing
// convention as the hex). The ring centre sits opposite the facing at radius rM, so rotating deg swings the band
// around the marker in place.
const arcPath = (cx, cy, deg, rM, spanDeg, wid, grow = 0) => {
  const th = (deg - 90) * Math.PI / 180;                                        // facing 0=up → outward normal at −90° in the atan2 screen frame
  const rcx = cx - rM * Math.cos(th), rcy = cy - rM * Math.sin(th);
  const ri = Math.max(10, rM - wid / 2 - grow), ro = rM + wid / 2 + grow, half = (spanDeg / 2 + grow / 8) * Math.PI / 180;
  const pt = (r, a) => `${(rcx + r * Math.cos(a)).toFixed(0)} ${(rcy + r * Math.sin(a)).toFixed(0)}`;
  return `M${pt(ro, th - half)} A${ro.toFixed(0)} ${ro.toFixed(0)} 0 0 1 ${pt(ro, th + half)} L${pt(ri, th + half)} A${ri.toFixed(0)} ${ri.toFixed(0)} 0 0 0 ${pt(ri, th - half)} Z`;
};
// items: [{ n, cx, cy (art px), deg, len, wid, shape, t (0..1 strength), reinf (points) }]
export function shieldOverlaySvg(items, opts = {}) {
  const arcs = items.filter(i => i.shape === 'arc');
  let rcx = 1408, rcy = 768;   // ring centre for arc sectors: centroid of the placed markers (art-centre fallback until ≥2 are placed)
  if (items.length >= 2) { rcx = items.reduce((a, i) => a + i.cx, 0) / items.length; rcy = items.reduce((a, i) => a + i.cy, 0) / items.length; }
  let fills = '', glows = '', hits = '';
  for (const it of items) {
    const rM = items.length >= 2 ? Math.max(60, Math.hypot(it.cx - rcx, it.cy - rcy)) : 480;   // curvature radius: distance to the marker centroid (fallback until ≥2 placed)
    const shape = it.shape === 'arc'
      ? arcPath(it.cx, it.cy, it.deg || 0, rM, it.len, it.wid)
      : hexPath(it.cx, it.cy, it.len, it.wid, Math.round(it.len * 0.55), it.deg || 0, it.taper || 0);
    fills += `<path d="${shape}" fill="hsl(${Math.round(120 * Math.max(0, Math.min(1, it.t)))},85%,48%)" fill-opacity="0.4"/>`;
    if (it.reinf > 0) {
      const glow = it.shape === 'arc'
        ? arcPath(it.cx, it.cy, it.deg || 0, rM, it.len, it.wid, 14)
        : hexPath(it.cx, it.cy, it.len + 12, it.wid + 12, Math.round(it.len * 0.55) + 6, it.deg || 0, it.taper || 0);
      glows += `<path d="${glow}" fill="none" stroke="#fde047" stroke-linejoin="round" filter="url(#shGlow)" stroke-width="${8 + it.reinf * 5}" stroke-opacity="${Math.min(0.95, 0.3 + it.reinf * 0.22)}"/>`;
    }
    if (opts.interactive) {
      hits += `<path d="${shape}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="22" pointer-events="stroke" data-ovn="${it.n}" style="cursor:nwse-resize"/>`;
      // rotation grip: a dot on a stalk off the shape's facing edge — drag it around the marker centre to rotate
      const th = ((it.deg || 0) - 90) * Math.PI / 180, ext = (it.shape === 'arc' ? it.wid / 2 : it.wid) + 64;
      const gx = it.cx + ext * Math.cos(th), gy = it.cy + ext * Math.sin(th);
      const ex = it.cx + (ext - 36) * Math.cos(th), ey = it.cy + (ext - 36) * Math.sin(th);
      hits += `<line x1="${ex.toFixed(0)}" y1="${ey.toFixed(0)}" x2="${gx.toFixed(0)}" y2="${gy.toFixed(0)}" stroke="#fde047" stroke-width="5" pointer-events="none"/>` +
        `<circle cx="${gx.toFixed(0)}" cy="${gy.toFixed(0)}" r="28" fill="#fde047" fill-opacity="0.9" stroke="#7c5e00" stroke-width="4" pointer-events="all" data-ovrot="${it.n}" style="cursor:grab"/>`;
    }
  }
  return `<svg class="shsvg" viewBox="0 0 2816 1536" preserveAspectRatio="none"><defs><filter id="shGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter></defs>${fills}${glows}${hits}</svg>`;
}

// ---- per-control PART offsets (label / counters / ± buttons repositioned within one control set) ----
// A layout may carry parts: { [controlId]: { pN: [dxPct, dyPct] } } — offsets in % of the ART, keyed by the
// part's index in stable DOM order. Unlocking a control in the EAF editor lets each part be dragged
// independently; locking it again moves the whole set (anchor + saved offsets) as one. Both hosts apply the
// offsets through applyCtlParts so the editor preview stays pixel-identical to the battle EA panel.
export function ctlParts(node) {
  const out = [];
  const walk = el => { for (const ch of el.children) {
    if (ch.classList.contains('row') || ch.classList.contains('vstep')) walk(ch);
    else out.push(ch);
  } };
  walk(node); return out;
}
export function applyCtlParts(node, offs, wrapW, wrapH) {
  if (!offs) return;
  const parts = ctlParts(node);
  parts.forEach((el, i) => { const o = offs['p' + i]; if (!o) return;
    el.style.position = 'relative';                       // shifted visually; its flow slot is preserved so siblings stay put
    el.style.left = (o[0] / 100 * wrapW) + 'px';
    el.style.top = (o[1] / 100 * wrapH) + 'px';
  });
}

// Custom part TEXT (edited labels): layout.partText = { [controlId]: { pN: "text" } }, same stable part
// indexing as applyCtlParts. Both hosts apply it so an edited label reads identically in editor and game.
export function applyCtlText(node, texts) {
  if (!texts) return;
  const parts = ctlParts(node);
  parts.forEach((el, i) => { const t = texts['p' + i]; if (t != null && t !== '') el.textContent = t; });
}
