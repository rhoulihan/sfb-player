// Direct-fire weapon catalog for the standard races (v0, standard loads).
// Functional game-mechanics data transcribed from owned material (phaser Type I/II/III
// grids from the SSDs; disruptor E3.4 + photon E4.12 from the rulebook). Editable via
// viewer/weapons.html against the scanned source tables.

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
    "overload": { "maxRange": 8, "fixedDamage": 8 }
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
    "overload": { "maxRange": 8, "fixedDamage": 16 },
    "proximity": { "maxRange": 30, "hitBand": [1, 5], "fixedDamage": 4 }
  }
};

export function bandIndex(def, trueRange) {
  return def.bands.findIndex(b => trueRange >= b.minTrue && trueRange <= b.maxTrue);
}

export function damageFor(def, trueRange, die, mode = false) {   // mode: false | true/'overload' | 'prox'
  const ov = (mode === true || mode === 'overload') && def.overload;   // overload: bigger warhead, shorter range
  const prox = mode === 'prox' && def.proximity;                        // proximity: weaker but reliable, ignores min range
  const maxRange = ov ? def.overload.maxRange : prox ? def.proximity.maxRange : def.maxRange;
  if (!prox && def.minRange && trueRange < def.minRange) return 0;
  if (trueRange > maxRange) return 0;
  const bi = bandIndex(def, trueRange);
  if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') return def.effectGrid[die - 1]?.[bi] ?? 0;  // phasers have no arming mode
  if (prox) { const [lo, hi] = def.proximity.hitBand; return (die >= lo && die <= hi) ? def.proximity.fixedDamage : 0; }
  const hb = def.hitBand1d[bi];
  if (!hb) return 0;
  const [lo, hi] = hb;
  if (die < lo || die > hi) return 0;
  return ov ? def.overload.fixedDamage : def.fixedDamage[bi];
}
