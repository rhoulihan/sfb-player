// Hex geometry for the battle map — flat-top hexes, odd-q offset (matches the battle-screen mockup).
const SIZE = 34, HW = SIZE * 1.5, HH = SIZE * Math.sqrt(3), OX = 60, OY = 60;

export function hexCenter(q, r) {
  return { x: OX + HW * q, y: OY + HH * r + (q % 2 ? HH / 2 : 0) };
}

export function hexDistance(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  return Math.max(1, Math.round(Math.hypot(c2.x - c1.x, c2.y - c1.y) / HW));
}

export function bearingDeg(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  const d = Math.atan2(c2.y - c1.y, c2.x - c1.x) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
}

export const GEOM = { SIZE, HW, HH, OX, OY };
