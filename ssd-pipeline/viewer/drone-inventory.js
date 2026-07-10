// Drone inventory (FD2 / FD3). A drone rack holds a capacity measured in SPACES; drones cost spaces by type
// (standard 1, heavy "two-space" 2, anti-drone ½); racks reload full sets from cargo. Pure helpers over rack
// / loadout data; the host owns per-ship rack state, launching, and reload timing.
export const RACK_CAPACITY = { A: 4, B: 6, C: 4, E: 8, F: 4, G: 2 };   // spaces by rack type (rulebook)
export const DRONE_SPEEDS = [8, 12, 20, 32];                          // drone speed classes by era/refit (FD); the ship's speed applies to all its drones
export const DRONE_CATALOG = {                                        // type matrix: warhead + space cost (Drone Type Chart FD2.1)
  'Type-VI': { spaces: 0.5, warhead: 8, dogfight: true },            // dogfight drone: chart warhead 8, but FD2.54 caps actual damage by target size class
  'Type-I': { spaces: 1, warhead: 12 },                              // standard drone
  'Type-IV': { spaces: 2, warhead: 24 },                             // heavy "two-space" drone
  'ADD': { spaces: 0.5, warhead: 0, antiDrone: true },               // anti-drone (½ space)
  'heavy': { spaces: 2, warhead: 24 },                               // alias for Type-IV (back-compat)
};
const EPS = 1e-9;

export function rackCapacity(type) { return RACK_CAPACITY[type] ?? RACK_CAPACITY.A; }
export function droneSpaces(droneType) { return DRONE_CATALOG[droneType]?.spaces ?? 1; }
export function droneWarhead(droneType) { return DRONE_CATALOG[droneType]?.warhead ?? 12; }   // FD2.1: the launched drone delivers its loaded type's chart warhead
// FD2.54: a dogfight (type-VI) drone scores LIMITED damage that depends on the target's size class — 2 vs ships and
// bases (size class 4 and larger), 4 vs SC5 (PFs), 8 vs SC6+ (shuttles, mines). Normal drones ignore target size.
export function droneWarheadVs(droneType, targetSizeClass = 3) {
  const d = DRONE_CATALOG[droneType];
  if (!d?.dogfight) return droneWarhead(droneType);
  if (targetSizeClass >= 6) return 8;
  if (targetSizeClass === 5) return 4;
  return 2;   // size class 4 and larger targets (the smaller the class number, the bigger the unit)
}

// FD3.1–FD3.7 rack rate of fire: most racks launch one drone per turn, but the "rapid-fire" type-C (two/turn) and
// type-E (four dogfight drones/turn) can launch several — subject to a minimum impulse gap that SPANS the turn boundary.
export const RACK_RATE = { A: 1, B: 1, C: 2, D: 1, E: 4, F: 1, G: 1 };      // drones launchable per turn (FD3.3 C=2, FD3.5 E=4)
export const RACK_MIN_GAP = { A: 8, B: 8, C: 12, D: 8, E: 8, F: 8, G: 8 };  // impulses required between two launches from the same rack (FD3.1 8, FD3.3 12)
export function rackRate(type) { return RACK_RATE[type] ?? 1; }
export function rackMinGap(type) { return RACK_MIN_GAP[type] ?? 8; }
export function rackShotsThisTurn(rack, turn) { return rack?.firedTurn === turn ? (rack.firedCountTurn || 0) : 0; }
// a rack may launch if it has a loaded drone, has not reached its per-turn rate, and enough impulses have passed since
// its last launch (the gap counts across the turn boundary: 32 impulses per turn). impulse is 1..32.
export function rackReadyToFire(rack, turn, impulse) {
  if (!rack || !(rack.loaded && rack.loaded.length)) return false;
  if (rackShotsThisTurn(rack, turn) >= rackRate(rack.type)) return false;
  const last = rack.lastFire;
  const since = last ? (turn - last.turn) * 32 + (impulse - last.impulse) : Infinity;
  return since >= rackMinGap(rack.type);
}
// record a launch on the rack (mutates it): advance the per-turn count and stamp the last-fire impulse.
export function noteRackFire(rack, turn, impulse) {
  rack.firedCountTurn = rackShotsThisTurn(rack, turn) + 1;
  rack.firedTurn = turn;
  rack.lastFire = { turn, impulse };
  return rack;
}
export function loadoutSpaces(loaded) { return (loaded || []).reduce((s, d) => s + droneSpaces(d), 0); }
export function spaceLeft(type, loaded) { return rackCapacity(type) - loadoutSpaces(loaded); }
export function canFit(type, loaded, droneType) { return droneSpaces(droneType) <= spaceLeft(type, loaded) + EPS; }

// fill a rack to capacity with one drone type (default loadout)
export function fillRack(type, droneType) {
  const out = [];
  while (canFit(type, out, droneType)) out.push(droneType);
  return out;
}

// reloadSets = full-rack magazines carried; reloadsLeft is the magazine measured in SPACES (FD2.421 reloads by space).
export function makeRack(type, droneType = 'Type-I', reloadSets = 0) {
  return { type, capacity: rackCapacity(type), loaded: fillRack(type, droneType), reloadsLeft: reloadSets * rackCapacity(type) };
}

// FD2.421: a rack reloads at most `maxSpaces` (two) spaces of drones per turn from its finite magazine — the
// rate cannot be increased. No-op when the rack is full or the magazine is dry.
export function reloadStep(rack, droneType = 'Type-I', maxSpaces = 2) {
  if (!rack || rack.reloadsLeft <= 0) return rack;
  const per = droneSpaces(droneType), room = rackCapacity(rack.type) - loadoutSpaces(rack.loaded);
  const budget = Math.min(maxSpaces, rack.reloadsLeft, room);
  const loaded = [...rack.loaded]; let used = 0;
  while (budget - used >= per - 1e-9) { loaded.push(droneType); used += per; }
  return { ...rack, loaded, reloadsLeft: rack.reloadsLeft - used };
}
