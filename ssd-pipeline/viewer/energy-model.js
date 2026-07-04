// Energy allocation — power model. Derives a ship's per-turn power profile from its SSD box counts
// plus a small per-ship profile table. Functional game-mechanics data transcribed from owned material
// (SFB B3 / H sections); the per-box output, life-support, capacitor, and weapon-arm values are
// verified by unit tests and calibrated against known ship totals.
import { shipLoadout } from './ship-loadout.js';

export const PER_BOX_OUTPUT = { 'warp-engine': 1, 'impulse-engine': 1, 'apr': 1 };   // power per undestroyed box
export const LIFE_SUPPORT = { 1: 3, 2: 1.5, 3: 1, 4: 0.5, 5: 0 };                    // by size class (B3.3)
export const WEAPON_ARM = { PHOTON: { arm: 2, overload: 4 }, DISR: { arm: 2, overload: 4 } }; // per-turn arming cost (disruptor at photon parity, E3.5 — calibration-flagged)
export const CAP_PER_PHASER = { 'PH-1': 1, 'PH-2': 1, 'PH-3': 0.5 };                 // capacitor capacity (H6.21)
export const SHIP_PROFILES = {   // size class + movement cost per ship code (default SC3 / cost 1)
  'FED-CA': { sizeClass: 3, moveCost: 1 }, 'FED-CL': { sizeClass: 3, moveCost: 1 },
  'FED-NCL': { sizeClass: 3, moveCost: 1 }, 'KLI-D7': { sizeClass: 3, moveCost: 1 },
  'GOR-CA': { sizeClass: 3, moveCost: 1 },
};
const DEFAULT_PROFILE = { sizeClass: 3, moveCost: 1 };

// ShipPower = { warp, impulse, apr, total, batteries, capacitorCap, sizeClass, moveCost,
//               shields:[], weapons:[{id,cls,arm,overload}], systems:{...presence...} }
export function shipPower(code, verified, detection) {
  const boxes = {};
  for (const g of (verified.groups || [])) boxes[g.family] = (boxes[g.family] || 0) + (g.boxIds || []).length;
  const n = f => boxes[f] || 0;
  const warp = n('warp-engine') * PER_BOX_OUTPUT['warp-engine'];
  const impulse = n('impulse-engine') * PER_BOX_OUTPUT['impulse-engine'];
  const apr = n('apr') * PER_BOX_OUTPUT['apr'];
  const { mounts, shields } = shipLoadout(verified, detection);
  const capacitorCap = Math.round(mounts.reduce((a, m) => a + (CAP_PER_PHASER[m.cls] || 0), 0));
  const weapons = mounts.filter(m => WEAPON_ARM[m.cls])
    .map(m => ({ id: m.id, cls: m.cls, arm: WEAPON_ARM[m.cls].arm, overload: WEAPON_ARM[m.cls].overload }));
  const prof = SHIP_PROFILES[code] || DEFAULT_PROFILE;
  return {
    warp, impulse, apr, total: warp + impulse + apr,
    batteries: n('battery'),
    capacitorCap,
    sizeClass: prof.sizeClass, moveCost: prof.moveCost,
    shields: (shields || []).slice(),
    weapons,
    systems: {
      shuttles: n('shuttle-bay'), tractor: n('tractor') > 0, transporter: n('transporter') > 0,
      ecm: true, labs: n('lab'), fireControl: true, cloak: false,
    },
  };
}

export function lifeSupportCost(power) { return LIFE_SUPPORT[power.sizeClass] ?? 0; }

// the default "charge / hold / power all" column each turn opens with (spec §1.3).
// carried = phaser-capacitor charge left from last turn (H6 carry-over); the capacitor only needs
// topping up to full, so default fill = capacitorCap - carried.
export function newEafColumn(power, prevSpeed = 0, carried = 0) {
  const weapons = {};
  for (const w of power.weapons) weapons[w.id] = { armed: true, overload: false };
  return {
    lifeSupport: lifeSupportCost(power),
    fireControl: power.systems.fireControl ? 1 : 0,
    phaserCap: Math.max(0, power.capacitorCap - carried),
    weapons,
    shieldsActive: true,
    genReinf: 0,
    specReinf: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    movement: prevSpeed * power.moveCost, impulseMove: 0, het: false,
    damageControl: 0, recharge: 0, tractor: 0, transporter: 0,
    ecm: 0, eccm: 0, labs: 0,
    wildWeasel: false, suicide: false, cloak: false,
  };
}

// fixed line costs (calibration-flagged). Shields are up for free in v1 — the paid shield allocation
// is reinforcement (genReinf/specReinf, variable). Fire control cost is the value itself (0/0.5/1).
export const SHIELD_COST = 0, HET_COST = 2, WW_COST = 1, SUICIDE_COST = 1, CLOAK_COST = 0;

// the balance referee. carried = phaser-capacitor charge left from last turn (H6 carry-over).
export function validateEaf(power, column, carried = 0) {
  let weaponCost = 0;                                     // JOIN column state onto power.weapons (which carries cls + costs)
  for (const w of power.weapons) {
    const st = column.weapons[w.id];
    if (st && st.armed) weaponCost += st.overload ? w.overload : w.arm;
  }
  const spec = Object.values(column.specReinf || {}).reduce((a, v) => a + (v || 0), 0);
  const used = column.lifeSupport + column.fireControl + column.phaserCap + weaponCost
    + (column.shieldsActive ? SHIELD_COST : 0) + column.genReinf + spec
    + column.movement + column.impulseMove + (column.het ? HET_COST : 0)
    + column.damageControl + column.recharge + column.tractor + column.transporter
    + column.ecm + column.eccm + column.labs
    + (column.wildWeasel ? WW_COST : 0) + (column.suicide ? SUICIDE_COST : 0) + (column.cloak ? CLOAK_COST : 0);
  const produced = power.total + power.batteries;
  const free = produced - used;
  const batteryUsed = Math.max(0, used - power.total);
  const errors = [];
  if (used > produced) errors.push('over-allocated: uses more than produced power + batteries');
  if (column.lifeSupport !== lifeSupportCost(power)) errors.push('life support must equal the mandatory cost');
  if (column.phaserCap + carried > power.capacitorCap) errors.push('phaser capacitor over capacity');
  if (column.impulseMove > 1) errors.push('at most 1 impulse point may go to movement');
  if (batteryUsed > power.batteries) errors.push('battery draw exceeds available battery power');
  const status = used > produced ? 'over' : free > 0 ? 'under' : 'balanced';
  return { produced, used, batteryUsed, free, status, errors };
}
