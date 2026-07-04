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
  return Math.max(1, Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z)));
}

export function bearingDeg(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  const d = Math.atan2(c2.y - c1.y, c2.x - c1.x) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
}

export const GEOM = { SIZE, HW, HH, OX, OY };
