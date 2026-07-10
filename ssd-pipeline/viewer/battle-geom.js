// Hex geometry for the battle map — flat-top hexes, odd-q offset (matches the battle-screen mockup).
const SIZE = 34, HW = SIZE * 1.5, HH = SIZE * Math.sqrt(3), OX = 60, OY = 60;

export function hexCenter(q, r) {
  return { x: OX + HW * q, y: OY + HH * r + (q % 2 ? HH / 2 : 0) };
}

// odd-q offset (flat-top, odd columns shoved down) → cube coords, then cube distance = true hex range
function offsetToCube(q, r) {
  const x = q;
  const z = r - (q - (q & 1)) / 2;
  return { x, y: -x - z, z };
}

export function hexDistance(a, b) {
  const A = offsetToCube(a.q, a.r), B = offsetToCube(b.q, b.r);
  return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z));   // C1.43: true hex range — co-located units are at range 0 (the range-0 weapon-chart column)
}

export function bearingDeg(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  const d = Math.atan2(c2.y - c1.y, c2.x - c1.x) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
}

export const GEOM = { SIZE, HW, HH, OX, OY };

import { arcCoversBearing } from './arc-geom.js';

// Flat-top odd-q hexes: the 6 neighbours lie at 30/90/150/210/270/330° (edge/spine directions),
// NOT at the 0/60/… corners. So a ship's facing points at an adjacent hex, not a vertex.
// f: 0=SE 1=S 2=SW 3=NW 4=N 5=NE
export const headingDeg = f => (((f % 6) * 60 + 30) % 360 + 360) % 360;

export function localBearing(firer, target) {
  return (((bearingDeg(firer, target) - headingDeg(firer.facing)) % 360) + 360) % 360;
}

export function isInArc(firer, mount, target) {
  const lb = localBearing(firer, target);
  const arcs = (mount.arc && mount.arc.arcs) || [];
  for (const a of arcs) if (arcCoversBearing(a, lb)) return { inArc: true, covering: a };
  return { inArc: false };
}

// which of the target's six facings faces the firer (D3.402 approximation by 60° sector)
export function exposedShield(firer, target) {
  const lb = (((bearingDeg(target, firer) - headingDeg(target.facing)) % 360) + 360) % 360;
  return ((Math.round(lb / 60) % 6) + 6) % 6 + 1;     // #1 = front (0°), clockwise
}
