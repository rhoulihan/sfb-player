// Firing-arc geometry for phaser-directional damage (D4.321): does a weapon group's arc bear
// toward the shield the volley struck? Bearings are degrees clockwise from forward (0°); a
// shield #N faces (N-1)·60°. Arc definitions mirror verify.html's hex arc editor.

// base 60° sectors, clockwise from forward
const SECTOR = { RF: [0, 60], R: [60, 120], RR: [120, 180], LR: [180, 240], L: [240, 300], LF: [300, 360] };
// combined arcs (D2.2): union of base sectors; _FH/_RH are the front/rear hemispheres
const COMBINED = {
  FA: ['RF', 'LF'], FX: ['L', 'LF', 'RF', 'R'], RA: ['LR', 'RR'], RX: ['L', 'LR', 'RR', 'R'],
  RS: ['RF', 'R', 'RR'], LS: ['LF', 'L', 'LR'], FH: ['_FH'], RH: ['_RH'],
};

const inSector = (name, b) => {
  const [lo, hi] = SECTOR[name];
  return (b >= lo && b <= hi) || (b + 360 >= lo && b + 360 <= hi) || (b - 360 >= lo && b - 360 <= hi);
};

export function arcCoversBearing(name, bearing) {
  const b = ((bearing % 360) + 360) % 360;
  if (name === '360' || name === 'ALL') return true;
  if (SECTOR[name]) return inSector(name, b);
  if (name === 'FH' || name === 'FP') return b >= 270 || b <= 90;      // front hemisphere / front plasma
  if (name === 'RH' || name === 'AP') return b >= 90 && b <= 270;      // rear hemisphere / aft plasma
  if (name === 'LP') return b >= 210 || b <= 30;                       // D2.34: left plasma — the front hemisphere rotated 60° left (centered on 300°)
  if (name === 'RP') return b >= 330 || b <= 150;                      // D2.34: right plasma — the front hemisphere rotated 60° right (centered on 60°)
  if (name === 'LPR') return b >= 120 && b <= 300;                     // left plasma rear (D2.36)
  if (name === 'RPR') return b >= 60 && b <= 240;                      // right plasma rear (D2.36)
  if (COMBINED[name]) return COMBINED[name].some(s =>
    s === '_FH' ? (b >= 270 || b <= 90) : s === '_RH' ? (b >= 90 && b <= 270) : inSector(s, b));
  return false;
}

/** Direction a shield faces, in degrees (0° = forward). #1 front … #4 rear … #6 left-front. */
export const shieldBearing = n => (((n - 1) * 60) % 360 + 360) % 360;

// Bearing of a painted hex offset, in the same 0°=forward, clockwise frame as shieldBearing. Mirrors verify.html's
// arc editor: flat-top hexPix (x = 1.5q, y = √3·(r + q/2)), bearing = atan2(x, -y). The common scale cancels.
function hexOffsetBearing(q, r) {
  return ((Math.atan2(1.5 * q, -Math.sqrt(3) * (r + q / 2)) * 180 / Math.PI) + 360) % 360;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

/** True if a weapon group with this arcDef can fire toward the given shield's facing (D4.321). */
export function arcBearsToShield(arcDef, shieldNum) {
  const b = shieldBearing(shieldNum);
  const arcs = (arcDef && arcDef.arcs) || [];
  if (arcs.some(a => arcCoversBearing(a, b))) return true;   // a named arc covers this shield's facing
  // D4.321: honor the per-hex arc exceptions captured at verification. A paintAdd hex EXTENDS the firing arc — if one
  // bears within the shield's 60° facing sector (±30°), the phaser can fire toward that shield even without a named arc
  // there. (paintRemove carves individual hexes out of a named sector; a sparse removal cannot clear a full 60° facing,
  // so it does not change this directional test.)
  const add = (arcDef && arcDef.paintAdd) || [];
  return add.some(h => angDiff(hexOffsetBearing(h[0], h[1]), b) <= 30 + 1e-9);
}
