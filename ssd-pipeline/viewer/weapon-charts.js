// Direct-fire weapon catalog for the standard races (v0, standard loads).
// Functional game-mechanics data transcribed from owned material (phaser Type I/II/III
// grids from the SSDs; disruptor E3.4 + photon E4.12 from the rulebook). Editable via
// viewer/weapons.html against the scanned source tables.
import { shiftedDie, shiftRangeOfEffect } from './ew.js';   // D6.35/E1.82: net ECM applies as a die-roll shift

export const WEAPONS = {
  "PH-1": {
    "cls": "PH-1",
    "resolution": "range-of-effect",
    "maxRange": 75,
    "bands": [
      {"minTrue": 0, "maxTrue": 0},
      {"minTrue": 1, "maxTrue": 1},
      {"minTrue": 2, "maxTrue": 2},
      {"minTrue": 3, "maxTrue": 3},
      {"minTrue": 4, "maxTrue": 4},
      {"minTrue": 5, "maxTrue": 5},
      {"minTrue": 6, "maxTrue": 8},
      {"minTrue": 9, "maxTrue": 15},
      {"minTrue": 16, "maxTrue": 25},
      {"minTrue": 26, "maxTrue": 50},
      {"minTrue": 51, "maxTrue": 75}
    ],
    "effectGrid": [
      [9, 8, 7, 6, 5, 5, 4, 3, 2, 1, 1],
      [8, 7, 6, 5, 5, 4, 3, 2, 1, 1, 0],
      [7, 5, 5, 4, 4, 4, 3, 1, 0, 0, 0],
      [6, 4, 4, 4, 4, 3, 2, 0, 0, 0, 0],
      [5, 4, 4, 4, 3, 3, 1, 0, 0, 0, 0],
      [4, 4, 3, 3, 2, 2, 0, 0, 0, 0, 0]
    ]
  },
  "PH-2": {
    "cls": "PH-2",
    "resolution": "range-of-effect",
    "maxRange": 50,
    "bands": [
      {"minTrue": 0, "maxTrue": 0},
      {"minTrue": 1, "maxTrue": 1},
      {"minTrue": 2, "maxTrue": 2},
      {"minTrue": 3, "maxTrue": 3},
      {"minTrue": 4, "maxTrue": 8},
      {"minTrue": 9, "maxTrue": 15},
      {"minTrue": 16, "maxTrue": 30},
      {"minTrue": 31, "maxTrue": 50}
    ],
    "effectGrid": [
      [6, 5, 5, 4, 3, 2, 1, 1],
      [6, 5, 4, 4, 2, 1, 1, 0],
      [6, 4, 4, 4, 1, 1, 0, 0],
      [5, 4, 4, 3, 1, 0, 0, 0],
      [5, 4, 3, 3, 0, 0, 0, 0],
      [5, 3, 3, 3, 0, 0, 0, 0]
    ]
  },
  "PH-3": {
    "cls": "PH-3",
    "resolution": "range-of-effect",
    "maxRange": 15,
    "bands": [
      {"minTrue": 0, "maxTrue": 0},
      {"minTrue": 1, "maxTrue": 1},
      {"minTrue": 2, "maxTrue": 2},
      {"minTrue": 3, "maxTrue": 3},
      {"minTrue": 4, "maxTrue": 8},
      {"minTrue": 9, "maxTrue": 15}
    ],
    "effectGrid": [
      [4, 4, 4, 3, 1, 1],
      [4, 4, 4, 2, 1, 0],
      [4, 4, 4, 1, 0, 0],
      [4, 4, 3, 0, 0, 0],
      [4, 3, 2, 0, 0, 0],
      [3, 3, 1, 0, 0, 0]
    ]
  },
  "DISR": {
    "cls": "DISR",
    "resolution": "hit-or-miss",
    "maxRange": 30,
    "bands": [
      {"minTrue": 0, "maxTrue": 0},
      {"minTrue": 1, "maxTrue": 1},
      {"minTrue": 2, "maxTrue": 2},
      {"minTrue": 3, "maxTrue": 4},
      {"minTrue": 5, "maxTrue": 8},
      {"minTrue": 9, "maxTrue": 15},
      {"minTrue": 16, "maxTrue": 22},
      {"minTrue": 23, "maxTrue": 30}
    ],
    "hitBand1d": [
      null,
      [1, 5],
      [1, 5],
      [1, 4],
      [1, 4],
      [1, 4],
      [1, 3],
      [1, 2]
    ],
    "fixedDamage": [0, 5, 4, 4, 3, 3, 2, 2],
    "overload": { "maxRange": 8, "feedbackRange": 0, "feedback": 2 }
  },
  "PHOTON": {
    "cls": "PHOTON",
    "resolution": "hit-or-miss",
    "maxRange": 30,
    "minRange": 2,
    "bands": [
      {"minTrue": 0, "maxTrue": 1},
      {"minTrue": 2, "maxTrue": 2},
      {"minTrue": 3, "maxTrue": 4},
      {"minTrue": 5, "maxTrue": 8},
      {"minTrue": 9, "maxTrue": 12},
      {"minTrue": 13, "maxTrue": 30}
    ],
    "hitBand1d": [
      null,
      [1, 5],
      [1, 4],
      [1, 3],
      [1, 2],
      [1, 1]
    ],
    "fixedDamage": [0, 8, 8, 8, 8, 8],
    "overload": { "maxRange": 8, "fixedDamage": 16, "feedbackRange": 1, "feedback": 2 },
    "proximity": { "minRange": 9, "maxRange": 30, "fixedDamage": 4, "dieBonus": 2 }
  }
};

export function bandIndex(def, trueRange) {
  return def.bands.findIndex(b => trueRange >= b.minTrue && trueRange <= b.maxTrue);
}

// overload warhead: photon carries a fixed value; a disruptor doubles the standard band damage (E3.52)
function overloadDmg(def, trueRange) {
  if (def.overload.fixedDamage != null) return def.overload.fixedDamage;
  const bi = bandIndex(def, Math.max(1, trueRange));   // clamp so a point-blank (R0) bolt reads the R1 band
  return 2 * (def.fixedDamage[bi] || 0);
}

// `range` = chart-lookup (effective) range for the hit-band column — passive FC doubles this (D19.11); `trueRange`
// = physical hexes, used for range LIMITS (E3.53/E4.42 overload cap, minimum range, weapon max); `dieShift` = the
// net ECM die-roll shift (D6.35/E1.82), applied to the die, never to a range. Single-range callers get the old
// behavior (trueRange defaults to range, no shift).
export function damageFor(def, range, die, mode = false, trueRange = range, dieShift = 0) {
  const ov = (mode === true || mode === 'overload') && def.overload;   // overload: bigger warhead, shorter range
  const prox = mode === 'prox' && def.proximity;                        // proximity: weaker, auto-misses at close range (E4.32)
  if (prox) {
    const pd = def.proximity;
    if (trueRange < (pd.minRange || 0) || trueRange > pd.maxRange) return 0;   // E4.32: automatic miss inside min range (true range)
    const bi = bandIndex(def, range); if (bi < 0) return 0;
    const hb = def.hitBand1d[bi]; if (!hb) return 0;
    const sd = shiftedDie(die, dieShift);
    return (sd >= hb[0] && sd <= hb[1] + (pd.dieBonus || 0)) ? pd.fixedDamage : 0;   // −2 to the die = +2 to the hit threshold
  }
  if (ov) {
    const od = def.overload;
    if (trueRange > od.maxRange) return 0;   // E3.53/E4.42: overload's 8-hex cap is on TRUE range, not effective range
    if (trueRange <= (od.feedbackRange ?? -1)) return (shiftedDie(die, dieShift) <= 6) ? overloadDmg(def, range) : 0;   // R0-1 overload hits 1-6 (E4.43)
    if (def.minRange && trueRange < def.minRange) return 0;   // otherwise the normal minimum range still applies
    const bi = bandIndex(def, range); if (bi < 0) return 0;
    const hb = def.hitBand1d[bi]; if (!hb) return 0;
    const sd = shiftedDie(die, dieShift);
    return (sd >= hb[0] && sd <= hb[1]) ? overloadDmg(def, range) : 0;
  }
  if (def.minRange && trueRange < def.minRange) return 0;
  if (trueRange > def.maxRange) return 0;
  const bi = bandIndex(def, range); if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') { const r = shiftRangeOfEffect(die, bi, dieShift); return def.effectGrid[r.die - 1]?.[r.col] ?? 0; }   // E1.822 phaser: raise die to 6, then one column higher per remaining shift
  const hb = def.hitBand1d[bi]; if (!hb) return 0;
  const sd = shiftedDie(die, dieShift);
  return (sd >= hb[0] && sd <= hb[1]) ? def.fixedDamage[bi] : 0;
}

// Feedback damage (E4.431 photon, E3.54 disruptor): a point-blank overloaded bolt that HITS scores damage on
// the FIRING ship's facing shield. A miss produces no feedback (D6.1264). `hit` = did the shot connect.
export function feedbackFor(def, trueRange, die, mode, hit) {
  const ov = (mode === true || mode === 'overload') && def.overload;
  if (!ov || !hit) return 0;
  return trueRange <= (def.overload.feedbackRange ?? -1) ? (def.overload.feedback || 0) : 0;
}
