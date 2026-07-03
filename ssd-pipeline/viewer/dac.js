// (D4.21) DAMAGE ALLOCATION CHART — Star Fleet Battles, Basic Set.
// Transcribed cell-by-cell from the chart on the second-to-last page of the Basic Set SSD
// Book (columns A..M for each 2d6 die roll) and verified against the rulebook's D4.5 worked
// example. A `*` suffix marks a BOLD result (D4.31): a bold result may be scored only once
// per volley at that chart position. Tokens are normalized (see TOKEN_FAMILY).
const ROWS = {
  2:  'BRIDGE* FLAG* SENSOR* DAMCON* R_HULL* L_WARP TRANS TRAC SHUTTLE LAB F_HULL R_WARP EXCESS',
  3:  'DRONE* PHASER* IMPULSE L_WARP R_WARP R_HULL SHUTTLE DAMCON* C_WARP LAB BATT PHASER EXCESS',
  4:  'PHASER* TRANS* R_WARP IMPULSE F_HULL R_HULL L_WARP APR LAB TRANS PROBE C_WARP EXCESS',
  5:  'R_WARP* R_HULL CARGO BATT SHUTTLE TORP* L_WARP IMPULSE R_WARP TRAC PROBE ANY_WEAPON EXCESS',
  6:  'F_HULL IMPULSE LAB L_WARP SENSOR* TRAC SHUTTLE R_WARP PHASER TRANS BATT ANY_WEAPON EXCESS',
  7:  'CARGO F_HULL BATT C_WARP SHUTTLE APR LAB PHASER ANY_WARP PROBE R_HULL ANY_WEAPON EXCESS',
  8:  'R_HULL APR SHUTTLE R_WARP SCANNER* TRAC LAB L_WARP PHASER TRANS BATT ANY_WEAPON EXCESS',
  9:  'L_WARP* F_HULL CARGO BATT LAB DRONE* R_WARP IMPULSE L_WARP TRAC PROBE ANY_WEAPON EXCESS',
  10: 'PHASER* TRAC* L_WARP IMPULSE R_HULL F_HULL R_WARP APR LAB TRANS PROBE C_WARP EXCESS',
  11: 'TORP* PHASER* IMPULSE R_WARP L_WARP F_HULL TRAC DAMCON* C_WARP LAB BATT PHASER EXCESS',
  12: 'AUX* EMER* SCANNER* PROBE* F_HULL* R_WARP TRANS SHUTTLE TRAC LAB R_HULL L_WARP EXCESS',
};

/** DAC[roll] = ordered column list [{sys, bold?}, ...] (column A..M). */
export const DAC = Object.fromEntries(Object.entries(ROWS).map(([r, s]) => [r,
  s.split(' ').map(t => (t.endsWith('*') ? { sys: t.slice(0, -1), bold: true } : { sys: t }))]));

/** DAC token -> ship-model pool key / system family. ANY_WEAPON has no single family. */
export const TOKEN_FAMILY = {
  IMPULSE: 'impulse-engine',
  L_WARP: 'warp-engine', R_WARP: 'warp-engine', C_WARP: 'warp-engine', ANY_WARP: 'warp-engine',
  APR: 'apr', BATT: 'battery',
  PHASER: 'phaser', TORP: 'heavy-weapon', DRONE: 'drone-rack',
  BRIDGE: 'bridge', FLAG: 'flag-bridge', EMER: 'emergency-bridge', AUX: 'auxiliary-control',
  SENSOR: 'sensor', SCANNER: 'scanner', DAMCON: 'damage-control',
  F_HULL: 'hull', R_HULL: 'hull',
  LAB: 'lab', TRANS: 'transporter', TRAC: 'tractor', PROBE: 'probe-launcher', SHUTTLE: 'shuttle-bay',
  CARGO: 'cargo', EXCESS: 'excess-damage',
};

export const SYS = new Set([...Object.keys(TOKEN_FAMILY), 'ANY_WEAPON']);
