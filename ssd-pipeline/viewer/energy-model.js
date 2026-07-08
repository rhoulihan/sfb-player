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
  const labels = verified.labels || {}, wSeq = {};   // box labels the user set at SSD verification (A, B, C, …)
  const weapons = mounts.filter(m => WEAPON_ARM[m.cls]).map(m => {
    const grp = m.id.split('.')[0], seq = (wSeq[grp] = (wSeq[grp] || 0) + 1) - 1;
    const label = (labels[m.boxId] || '').trim() || String.fromCharCode(65 + seq);   // saved label, else A/B/C… by position
    return { id: m.id, cls: m.cls, arc: (m.arc && m.arc.arcs && m.arc.arcs[0]) || '', label, arm: WEAPON_ARM[m.cls].arm, overload: WEAPON_ARM[m.cls].overload };
  });
  const prof = SHIP_PROFILES[code] || DEFAULT_PROFILE;
  return {
    warp, impulse, apr, total: warp + impulse + apr,
    batteries: n('battery'),
    capacitorCap,
    sizeClass: prof.sizeClass, moveCost: prof.moveCost,
    shields: (shields || []).slice(),
    weapons,
    systems: {
      shuttles: n('shuttle-bay'), tractor: n('tractor'), transporter: n('transporter'),
      damageControl: n('damage-control'), ecm: true, labs: n('lab'), fireControl: true, cloak: n('cloaking-device') > 0,
    },
  };
}

// rule-based ceiling on the power a slider may allocate to each system (calibration-flagged).
export function sinkMax(p, key) {
  switch (key) {
    case 'movement': return (30 + (p.impulse > 0 ? 1 : 0)) * p.moveCost;   // 30-hex cap; +1 (31st) if impulse engines (C2.112)
    case 'phaserCap': return p.capacitorCap;                  // capacitor room (H6.21)
    case 'ecm': case 'eccm': return 6;                        // ECM/ECCM shift cap (D6.3)
    case 'recharge': return p.batteries;                      // recharge no more than battery capacity (H5)
    case 'reserveWarp': return p.warp;                        // reserve warp power (H7)
    case 'tractor': return p.systems.tractor || 0;            // one point per tractor emitter (G7)
    case 'transporter': return p.systems.transporter || 0;    // per transporter (G8)
    case 'labs': return p.systems.labs || 0;                  // per lab
    case 'damageControl': return p.systems.damageControl || 0;// damage-control rating (D9)
    case 'genReinf': return p.total + p.batteries;            // limited only by available power (D3.341)
    default: return p.total + p.batteries;
  }
}
export const specReinfMax = (p, shieldN) => p.shields[shieldN - 1] || 0;   // reinforce a shield up to its box value (D3.342)

export function lifeSupportCost(power) { return LIFE_SUPPORT[power.sizeClass] ?? 0; }

// the default "charge / hold / power all" column each turn opens with (spec §1.3).
// carried = phaser-capacitor charge left from last turn (H6 carry-over); the capacitor only needs
// topping up to full, so default fill = capacitorCap - carried.
export function newEafColumn(power, prevSpeed = 0, carried = 0) {
  const weapons = {};
  for (const w of power.weapons) weapons[w.id] = { armed: true, overload: false, prox: false };
  return {
    lifeSupport: lifeSupportCost(power),
    fireControl: power.systems.fireControl ? 1 : 0,
    phaserCap: Math.max(0, power.capacitorCap - carried),
    weapons,
    shieldsActive: true,
    genReinf: 0,
    specReinf: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    movement: prevSpeed * power.moveCost, impulseMove: 0, het: false,
    damageControl: 0, recharge: 0, reserveWarp: 0, tractor: 0, transporter: 0,
    ecm: 0, eccm: 0, labs: 0,
    wildWeasel: false, suicide: false, cloak: false,
  };
}

// fixed line costs (calibration-flagged). Shields are up for free in v1 — the paid shield allocation
// is reinforcement (genReinf/specReinf, variable). Fire control cost is the value itself (0/0.5/1).
export const SHIELD_COST = 0, HET_COST = 2, WW_COST = 1, SUICIDE_COST = 1, CLOAK_COST = 0;

// the balance referee. carried = phaser-capacitor charge left from last turn (H6 carry-over).
export function validateEaf(power, column, carried = 0, batteryCharge = power.batteries) {
  let weaponCost = 0;                                     // JOIN column state onto power.weapons (which carries cls + costs)
  for (const w of power.weapons) {
    const st = column.weapons[w.id];
    if (st && st.armed) weaponCost += st.overload ? w.overload : w.arm;
  }
  const spec = Object.values(column.specReinf || {}).reduce((a, v) => a + (v || 0), 0);
  const used = column.lifeSupport + column.fireControl + column.phaserCap + weaponCost
    + (column.shieldsActive ? SHIELD_COST : 0) + column.genReinf + spec
    + column.movement + column.impulseMove + (column.het ? HET_COST : 0)
    + column.damageControl + column.recharge + (column.reserveWarp || 0) + column.tractor + column.transporter
    + column.ecm + column.eccm + column.labs
    + (column.wildWeasel ? WW_COST : 0) + (column.suicide ? SUICIDE_COST : 0) + (column.cloak ? CLOAK_COST : 0);
  const produced = power.total + batteryCharge;            // only the current battery charge is available
  const free = produced - used;
  const batteryUsed = Math.max(0, used - power.total);
  const errors = [];
  if (used > produced) errors.push('over-allocated: uses more than produced power + batteries');
  if (column.lifeSupport !== lifeSupportCost(power)) errors.push('life support must equal the mandatory cost');
  if (column.phaserCap + carried > power.capacitorCap) errors.push('phaser capacitor over capacity');
  if (column.impulseMove > 1) errors.push('at most 1 impulse point may go to movement');
  if (batteryUsed > batteryCharge) errors.push('battery draw exceeds available battery power');
  if ((column.recharge || 0) > power.batteries - batteryCharge) errors.push('recharge exceeds empty batteries');
  const status = used > produced ? 'over' : free > 0 ? 'under' : 'balanced';
  return { produced, used, batteryUsed, free, status, errors };
}

// apply a locked column to the ship's turn state (consumed by the impulse phase). carried carries
// residual phaser-capacitor charge in from last turn.
export function foldEaf(power, column, carried = 0) {
  const armed = {};
  for (const w of power.weapons) {
    const st = column.weapons[w.id];
    if (st && st.armed) armed[w.id] = { overload: !!st.overload, prox: !!st.prox };
  }
  return {
    speed: Math.min(30, Math.floor(column.movement / power.moveCost)),
    armed,
    capacitor: carried + column.phaserCap,
    reinforce: { gen: column.genReinf, spec: { ...column.specReinf } },
    ecmLevel: column.ecm, eccmLevel: column.eccm,
    wildWeasel: column.wildWeasel, suicide: column.suicide,
  };
}
