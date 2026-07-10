// Energy allocation — power model. Derives a ship's per-turn power profile from its SSD box counts
// plus a small per-ship profile table. Functional game-mechanics data transcribed from owned material
// (SFB B3 / H sections); the per-box output, life-support, capacitor, and weapon-arm values are
// verified by unit tests and calibrated against known ship totals.
import { shipLoadout } from './ship-loadout.js';
import { armStepCost, armTurns, canRoll, rollCost } from './weapon-arming.js';   // multi-turn arming (E4.21/E4.22, FP1.21/FP2.51/FP1.221)

export const PER_BOX_OUTPUT = { 'warp-engine': 1, 'impulse-engine': 1, 'apr': 1 };   // power per undestroyed box
export const LIFE_SUPPORT = { 1: 3, 2: 1.5, 3: 1, 4: 0.5, 5: 0 };                    // by size class (B3.3)
// per-turn arming cost + hold cost (E4.44): a photon armed last turn but not fired can be HELD in the tube
// for the hold price instead of re-armed. Disruptors have no hold (re-armed each turn) → hold defaults to arm.
export const WEAPON_ARM = { PHOTON: { arm: 2, overload: 4, hold: 1, holdOverload: 2 }, DISR: { arm: 2, overload: 4 } };
// map a plasma launcher's SSD type string ("Plasma S", "Plasma S (LP)", "Plasma-R") to its arming class (FP2.51)
export function plasmaClsOf(type) {
  const m = /plasma\s*-?\s*([RSGF])/i.exec(type || '');
  return m ? `PLASMA-${m[1].toUpperCase()}` : 'PLASMA-S';
}
export const CAP_PER_PHASER = { 'PH-1': 1, 'PH-2': 1, 'PH-3': 0.5 };                 // capacitor capacity (H6.21)
export const SHIP_PROFILES = {   // size class + movement cost per ship code (default SC3 / cost 1)
  'FED-CA': { sizeClass: 3, moveCost: 1 }, 'FED-CL': { sizeClass: 3, moveCost: 1 },
  'FED-NCL': { sizeClass: 3, moveCost: 1 }, 'KLI-D7': { sizeClass: 3, moveCost: 1 },
  'GOR-CA': { sizeClass: 3, moveCost: 1 }, 'KZIN-CS': { sizeClass: 3, moveCost: 1 },
  'ROM-KR': { sizeClass: 3, moveCost: 1 },
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
    const wa = WEAPON_ARM[m.cls];
    return { id: m.id, cls: m.cls, arc: (m.arc && m.arc.arcs && m.arc.arcs[0]) || '', label, arm: wa.arm, overload: wa.overload, hold: wa.hold ?? wa.arm, holdOverload: wa.holdOverload ?? wa.overload };
  });
  // Phase B: plasma launchers (heavy-weapon groups) arm through the EAF just like photons (FP1.21, 3-turn cycle).
  // Pseudo-plasma markers are not launchers. The group id is the arming key; the arc doubles as the box label.
  for (const g of (verified.groups || []))
    if (g.family === 'heavy-weapon' && /plasma/i.test(g.type || '') && !/pseudo/i.test(g.type || ''))
      weapons.push({ id: g.id, cls: plasmaClsOf(g.type), arc: g.arc || '', label: g.arc || '', plasma: true, gtype: g.type });
  const prof = { ...(SHIP_PROFILES[code] || DEFAULT_PROFILE), ...(verified.stats || {}) };   // verified.json stats (sizeClass/moveCost) drive it; SHIP_PROFILES is only a fallback
  return {
    warp, impulse, apr, total: warp + impulse + apr,
    batteries: n('battery'),
    capacitorCap,
    sizeClass: prof.sizeClass, moveCost: prof.moveCost,
    cloakCost: prof.cloakCost || 0,   // G13.21: per-ship cloak energy cost from the SSD (verified stats)
    dcRating: prof.dcRating || 0,     // D14/D9.21: damage-control track rating (highest number on the DC track), from verified stats
    bes: prof.bes || 0,               // D5.2: Basic Explosion Strength (self-destruction / excess-damage blast), from the ship chart via verified stats
    shields: (shields || []).slice(),
    weapons,
    systems: {
      shuttles: n('shuttle-bay'), tractor: n('tractor'), transporter: n('transporter'),
      damageControl: n('damage-control'), ecm: true, labs: n('lab'), fireControl: true, cloak: n('cloaking-device') > 0,
    },
  };
}

// rule-based ceiling on the power a slider may allocate to each system (calibration-flagged).
// D6.310: total ECM + ECCM allocated during Energy Allocation cannot exceed the sensor rating (highest unchecked
// sensor-track box, usually 6). Returns the max one EW field may hold given the other field's current allocation.
export function ewFieldMax(rating, otherAlloc, perFieldMax = 6) { return Math.max(0, Math.min(perFieldMax, rating - Math.max(0, otherAlloc | 0))); }

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
    case 'edr': return p.systems.labs || 0;                   // D14: one EDR attempt per powered lab box
    case 'damageControl': return p.dcRating || (p.systems.damageControl || 0);// D9.21: ceiling = highest number on the DC track (the rating); fall back to intact-box count until captured (D14.13)
    case 'genReinf': return p.total + p.batteries;            // limited only by available power (D3.341)
    default: return p.total + p.batteries;
  }
}
// D3.342: specific reinforcement adds "extra" boxes equal to the energy applied — there is NO cap at the shield's
// printed box value; it is limited only by available power. D3.343: a shield that is down (current strength 0) cannot
// be specific-reinforced — only general reinforcement blocks fire from that facing. Pass the current strength to enforce it.
export const specReinfMax = (p, shieldN, currentStrength) => (currentStrength != null && currentStrength <= 0) ? 0 : (p.total + p.batteries);

export function lifeSupportCost(power) { return LIFE_SUPPORT[power.sizeClass] ?? 0; }

// the default "charge / hold / power all" column each turn opens with (spec §1.3).
// carried = phaser-capacitor charge left from last turn (H6 carry-over); the capacitor only needs
// topping up to full, so default fill = capacitorCap - carried.
export function newEafColumn(power, prevSpeed = 0, carried = 0, progress = {}) {
  const weapons = {};                                    // progress[id] = arming turns already completed (drives cost + label)
  for (const w of power.weapons) weapons[w.id] = { armed: true, overload: false, prox: false, progress: progress[w.id] || 0, roll: false };
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
    em: false, fcPassive: false, edr: 0,   // C10 erratic maneuvers, D19 passive fire control, D14 emergency damage repair
    repairShield: 0,   // D9.21: 0 = damage-control repairs systems (D9.7); 1-6 = repair that shield (2 energy/box)
    wildWeasel: false, suicide: false, cloak: false,
  };
}

// fixed line costs (calibration-flagged). Shields are up for free in v1 — the paid shield allocation
// is reinforcement (genReinf/specReinf, variable). Fire control cost is the value itself (0/0.5/1).
export const SHIELD_COST = 0, HET_COST = 5, WW_COST = 1, SUICIDE_COST = 1, CLOAK_COST = 0;   // HET = 5 hexes of warp energy (C6.21)

// the balance referee. carried = phaser-capacitor charge left from last turn (H6 carry-over).
export function validateEaf(power, column, carried = 0, batteryCharge = power.batteries) {
  let weaponCost = 0;                                     // JOIN column state onto power.weapons (which carries cls + costs)
  for (const w of power.weapons) {
    const st = column.weapons[w.id];
    if (st && st.armed) {   // overload doubles the arming energy (E4.411) but NOT the hold (E4.22)
      const prog = st.progress || 0, n = armTurns(w.cls), arming = prog < n;
      const rolling = st.roll && canRoll(w.cls) && prog >= n - 1;   // FP1.221 rolling delay: pay the reduced roll cost, not the full final step
      const step = rolling ? rollCost(w.cls) : armStepCost(w.cls, prog);
      weaponCost += (st.overload && arming && !rolling ? 2 : 1) * step;
    }
  }
  const spec = Object.values(column.specReinf || {}).reduce((a, v) => a + (v || 0), 0);
  const used = column.lifeSupport + column.fireControl + column.phaserCap + weaponCost
    + (column.shieldsActive ? SHIELD_COST : 0) + column.genReinf + spec
    + column.movement + column.impulseMove + (column.het ? HET_COST : 0)
    + column.damageControl + column.recharge + (column.reserveWarp || 0) + column.tractor + column.transporter
    + column.ecm + column.eccm + column.labs
    + (column.em ? 6 * power.moveCost : 0) + (column.edr ? 3 * column.edr : 0)   // C10.11 EM = six hexes of movement; D14.12 EDR = 3 per powered lab
    + (column.wildWeasel ? WW_COST : 0) + (column.suicide ? SUICIDE_COST : 0) + (column.cloak ? (power.cloakCost || CLOAK_COST) : 0);   // G13.21: per-ship cloak cost
  const produced = power.total + batteryCharge;            // only the current battery charge is available
  const free = produced - used;
  const batteryUsed = Math.max(0, used - power.total);
  const errors = [];
  if (used > produced) errors.push('over-allocated: uses more than produced power + batteries');
  if (column.lifeSupport !== lifeSupportCost(power)) errors.push('life support must equal the mandatory cost');
  if (column.phaserCap + carried > power.capacitorCap) errors.push('phaser capacitor over capacity');
  if (column.impulseMove > 1) errors.push('at most 1 impulse point may go to movement');
  // C2.112: at most 30 movement points come from the warp engines; C2.111: the 31st (and only the 31st) may come from
  // the impulse engines. column.movement is the total movement allocation, so the warp share is the first 30 points and
  // any overflow is the single impulse point. C2.11 (movement is warp/impulse only, never APR/battery) then follows from
  // gating that warp share against warp output below.
  const warpMove = Math.min(column.movement || 0, 30 * power.moveCost);
  if ((column.movement || 0) > 31 * power.moveCost) errors.push('movement exceeds the 31-point practical-speed maximum (C2.411)');
  // H7.41/H7.42: warp output cannot be double-committed. Warp-specific allocations (warp movement + reserve warp + HET,
  // all drawn from the warp engines) together may not exceed the warp engine output.
  const warpDemand = warpMove + (column.reserveWarp || 0) + (column.het ? HET_COST : 0);
  if (warpDemand > power.warp) errors.push('warp allocations exceed warp engine output (C2.11/H7.41)');
  if (batteryUsed > batteryCharge) errors.push('battery draw exceeds available battery power');
  if ((column.recharge || 0) > power.batteries - batteryCharge) errors.push('recharge exceeds empty batteries');
  const status = used > produced ? 'over' : free > 0 ? 'under' : 'balanced';
  return { produced, used, batteryUsed, free, status, errors };
}

// apply a locked column to the ship's turn state (consumed by the impulse phase). carried carries
// residual phaser-capacitor charge in from last turn.
export function foldEaf(power, column, carried = 0, progress = {}) {
  const armed = {}, armProgress = {};
  for (const w of power.weapons) {
    const st = column.weapons[w.id];
    if (st && st.armed) {
      armed[w.id] = { overload: !!st.overload, prox: !!st.prox };
      const n = armTurns(w.cls), prev = progress[w.id] || 0;
      if (st.roll && canRoll(w.cls) && prev >= n - 1) armProgress[w.id] = n - 1;    // FP1.221 rolling delay: stall one turn short of completion
      else armProgress[w.id] = Math.min(n, prev + 1);                              // otherwise advance the cycle (caps at fully armed)
    } else armProgress[w.id] = 0;                                                  // skipped a turn → discharged (E4.21 consecutive)
  }
  return {
    speed: Math.min(31, Math.floor(column.movement / power.moveCost)),   // C2.411: practical speed maxes at 31 (30 warp + 1 impulse point)
    armed, armProgress,
    capacitor: carried + column.phaserCap,
    reinforce: { gen: Math.floor((column.genReinf || 0) / 2), spec: { ...column.specReinf } },   // D3.341: general reinforcement energy ÷2 = points (2 energy = 1 point)
    ecmLevel: column.ecm, eccmLevel: column.eccm,
    wildWeasel: column.wildWeasel, suicide: column.suicide,
    reserveWarp: column.reserveWarp || 0,   // held for reactive use during the turn (H7.4); unused → batteries (H7.36)
  };
}
