// Direct-fire weapon catalog for the standard races (v0, standard loads).
// Numeric charts are functional game-mechanics data (same treatment as dac.js), transcribed from the
// owner's material: phaser die-vs-range grids (Type I/II/III) from the SSDs; disruptor (E3.4) and
// photon (E4.12) charts from the rulebook. `bands` are {minTrue,maxTrue} inclusive true-range columns.
//   range-of-effect (phasers): roll 1d6, damage = effectGrid[die-1][bandIdx] (always contributes).
//   hit-or-miss (disruptor/photon): roll 1d6, hit if die within hitBand1d[bandIdx], then fixedDamage.
const band = (minTrue, maxTrue) => ({ minTrue, maxTrue });

export const WEAPONS = {
  'PH-1': {
    cls: 'PH-1', resolution: 'range-of-effect', maxRange: 75,
    bands: [band(0, 0), band(1, 1), band(2, 2), band(3, 3), band(4, 4), band(5, 5), band(6, 8), band(9, 15), band(16, 25), band(26, 50), band(51, 75)],
    effectGrid: [
      [9, 8, 7, 6, 5, 5, 4, 3, 2, 1, 1],
      [8, 7, 6, 5, 5, 4, 3, 2, 1, 1, 0],
      [7, 5, 5, 4, 4, 4, 3, 1, 0, 0, 0],
      [6, 4, 4, 4, 4, 3, 2, 0, 0, 0, 0],
      [5, 4, 4, 4, 3, 3, 1, 0, 0, 0, 0],
      [4, 4, 3, 3, 2, 2, 0, 0, 0, 0, 0],
    ],
  },
  'PH-2': {
    cls: 'PH-2', resolution: 'range-of-effect', maxRange: 50,
    bands: [band(0, 0), band(1, 1), band(2, 2), band(3, 3), band(4, 8), band(9, 15), band(16, 30), band(31, 50)],
    effectGrid: [
      [6, 5, 5, 4, 3, 2, 1, 1],
      [6, 5, 4, 4, 2, 1, 1, 0],
      [6, 4, 4, 4, 1, 1, 0, 0],
      [5, 4, 4, 3, 1, 0, 0, 0],
      [5, 4, 3, 3, 0, 0, 0, 0],
      [5, 3, 3, 3, 0, 0, 0, 0],
    ],
  },
  'PH-3': {
    cls: 'PH-3', resolution: 'range-of-effect', maxRange: 15,
    bands: [band(0, 0), band(1, 1), band(2, 2), band(3, 3), band(4, 8), band(9, 15)],
    effectGrid: [
      [4, 4, 4, 3, 1, 1],
      [4, 4, 4, 2, 1, 0],
      [4, 4, 4, 1, 0, 0],
      [4, 4, 3, 0, 0, 0],
      [4, 3, 2, 0, 0, 0],
      [3, 3, 1, 0, 0, 0],
    ],
  },
  'DISR': {
    cls: 'DISR', resolution: 'hit-or-miss', maxRange: 30,
    bands: [band(0, 0), band(1, 1), band(2, 2), band(3, 4), band(5, 8), band(9, 15), band(16, 22), band(23, 30)],
    hitBand1d: [null, [1, 5], [1, 5], [1, 4], [1, 4], [1, 4], [1, 3], [1, 2]],   // range 0: disruptors can't fire (E3.32)
    fixedDamage: [0, 5, 4, 4, 3, 3, 2, 2],
  },
  'PHOTON': {
    cls: 'PHOTON', resolution: 'hit-or-miss', maxRange: 30, minRange: 2,        // min true range 2 (E4.14)
    bands: [band(0, 1), band(2, 2), band(3, 4), band(5, 8), band(9, 12), band(13, 30)],
    hitBand1d: [null, [1, 5], [1, 4], [1, 3], [1, 2], [1, 1]],
    fixedDamage: [0, 8, 8, 8, 8, 8],                                            // 8 on any hit (E4.13)
  },
};

export function bandIndex(def, trueRange) {
  return def.bands.findIndex(b => trueRange >= b.minTrue && trueRange <= b.maxTrue);
}

export function damageFor(def, trueRange, die) {
  if (def.minRange && trueRange < def.minRange) return 0;
  if (trueRange > def.maxRange) return 0;
  const bi = bandIndex(def, trueRange);
  if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') return def.effectGrid[die - 1]?.[bi] ?? 0;
  const hb = def.hitBand1d[bi];
  if (!hb) return 0;
  const [lo, hi] = hb;
  return (die >= lo && die <= hi) ? def.fixedDamage[bi] : 0;
}
