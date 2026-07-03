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
  if (name === 'LP') return b >= 180;                                  // left plasma 180°
  if (name === 'RP') return b <= 180;                                  // right plasma 180°
  if (name === 'LPR') return b >= 120 && b <= 300;                     // left plasma rear (D2.36)
  if (name === 'RPR') return b >= 60 && b <= 240;                      // right plasma rear (D2.36)
  if (COMBINED[name]) return COMBINED[name].some(s =>
    s === '_FH' ? (b >= 270 || b <= 90) : s === '_RH' ? (b >= 90 && b <= 270) : inSector(s, b));
  return false;
}

/** Direction a shield faces, in degrees (0° = forward). #1 front … #4 rear … #6 left-front. */
export const shieldBearing = n => (((n - 1) * 60) % 360 + 360) % 360;

/** True if a weapon group with this arcDef can fire toward the given shield's facing (D4.321). */
export function arcBearsToShield(arcDef, shieldNum) {
  const b = shieldBearing(shieldNum);
  const arcs = (arcDef && arcDef.arcs) || [];
  return arcs.some(a => arcCoversBearing(a, b));
}
