// D9.7 COST OF REPAIR (Annex #9, Module G3): repair points needed to restore one destroyed box, keyed by the
// game's DAC family. Functional game data. Costs vary by weapon type in the chart; the coarse DAC families here
// use a representative value (phaser = a middle of PH-1/2/3, heavy weapon = photon/disruptor-30 = 8).
export const REPAIR_COST = {
  hull: 1, armor: 2, cargo: 1, battery: 2, apr: 4,
  'impulse-engine': 5, 'warp-engine': 10,
  phaser: 4, 'heavy-weapon': 8, 'anti-drone': 3, 'drone-rack': 3, 'probe-launcher': 3,
  sensor: 10, scanner: 10, 'fire-control': 4, lab: 5,
  transporter: 3, tractor: 3, 'shuttle-bay': 2,
  bridge: 6, 'auxiliary-control': 6, 'emergency-bridge': 6, 'security-station': 3,
  'cloaking-device': 15,
};
// D9.76: the damage-control track and excess damage can never be repaired by this procedure; crew/tracks/markers
// are not system boxes.
const NON_REPAIRABLE = new Set(['damage-control', 'excess-damage', 'crew', 'boarding-party', 'markers', 'ammo-track']);
export function canRepairFamily(family) { return !NON_REPAIRABLE.has(family); }
export function repairCostFor(family) { return REPAIR_COST[family] || 4; }   // 4 = reasonable default for an unlisted system

// D9.7 CONTINUOUS DAMAGE REPAIR: a ship gets FREE repair points equal to its DC rating each turn (D9.711). Points
// accumulate toward ONE destroyed box at a time (D9.74 carryover), repairing it when the accumulated total reaches
// its Cost of Repair. A ship can never repair more boxes over a scenario than its original DC rating (D9.76).
// `repairable` is the caller-filtered list of destroyed, prior-turn (D9.73), repairable-family boxes.
// Pure — the host persists { target, progress, repairedTotal } on the ship.
export function repairSystemStep(repairable, familyOf, freePoints, state = {}, dcCap = Infinity) {
  let { target = null, progress = 0, repairedTotal = 0 } = state;
  let pool = repairable.slice(), pts = Math.max(0, freePoints | 0), repaired = [];
  if (target && !pool.includes(target)) { target = null; progress = 0; }   // current target gone → drop it
  while (pts > 0 && repairedTotal < dcCap) {
    if (!target) { target = pool.find(id => !repaired.includes(id)); if (!target) break; progress = 0; }
    const cost = repairCostFor(familyOf(target));
    const add = Math.min(pts, cost - progress);
    progress += add; pts -= add;
    if (progress >= cost) { repaired.push(target); repairedTotal++; target = null; progress = 0; }
    else break;   // ran out of points mid-box → carry the progress into next turn
  }
  return { repaired, target, progress, repairedTotal };
}

// Damage control repair (C7 / D9). Spends `points` of repair to restore destroyed boxes, in an optional
// priority order (the player's / by importance), skipping boxes that can never be repaired (excess-damage
// and the damage-control track itself, D9.76). Pure: returns the repaired ids and what remains destroyed.
export function repairBoxes(destroyed, points, { priority = [], repairable = () => true } = {}) {
  const candidates = destroyed.filter(repairable);
  const inPriority = priority.filter(id => candidates.includes(id));
  const rest = candidates.filter(id => !priority.includes(id));
  const repaired = [...inPriority, ...rest].slice(0, Math.max(0, points | 0));
  const done = new Set(repaired);
  return { repaired, remaining: destroyed.filter(id => !done.has(id)) };
}
