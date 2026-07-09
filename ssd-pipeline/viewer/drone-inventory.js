// Drone inventory (FD2 / FD3). A drone rack holds a capacity measured in SPACES; drones cost spaces by type
// (standard 1, heavy "two-space" 2, anti-drone ½); racks reload full sets from cargo. Pure helpers over rack
// / loadout data; the host owns per-ship rack state, launching, and reload timing.
export const RACK_CAPACITY = { A: 4, B: 6, C: 4, E: 8, F: 4, G: 2 };   // spaces by rack type (rulebook)
export const DRONE_SPEEDS = [8, 12, 20, 32];                          // drone speed classes by era/refit (FD); the ship's speed applies to all its drones
export const DRONE_CATALOG = {                                        // type matrix: warhead + space cost (functional values)
  'Type-VI': { spaces: 0.5, warhead: 6 },                            // light drone
  'Type-I': { spaces: 1, warhead: 12 },                              // standard drone
  'Type-IV': { spaces: 2, warhead: 24 },                             // heavy "two-space" drone
  'ADD': { spaces: 0.5, warhead: 0, antiDrone: true },               // anti-drone (½ space)
  'heavy': { spaces: 2, warhead: 24 },                               // alias for Type-IV (back-compat)
};
const EPS = 1e-9;

export function rackCapacity(type) { return RACK_CAPACITY[type] ?? RACK_CAPACITY.A; }
export function droneSpaces(droneType) { return DRONE_CATALOG[droneType]?.spaces ?? 1; }
export function droneWarhead(droneType) { return DRONE_CATALOG[droneType]?.warhead ?? 12; }   // FD2.1: the launched drone delivers its loaded type's warhead
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
