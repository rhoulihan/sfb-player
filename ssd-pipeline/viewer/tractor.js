// SFB G7 tractor beams — the pure rules core. A tractor beam (one per TRAC box, G7.11) links a ship to a unit
// in an adjacent/same hex (G7.31), or up to three hexes with extra power (G7.6). One point of power operates a
// beam (G7.15); an opposing ship can spend "negative tractor" power to break it, point-for-point (G7.35/G7.352).
// Link state, the map, and the Operate-Tractors step live in the game (battle.html); this module is just math.

export const TRACTOR_MAX_RANGE = 3;   // adjacent/same-hex normally (G7.31), out to 3 hexes at extended range (G7.6)

// Power to operate one beam at a given true range: 1 at range 0-1, doubled at range 2 (G7.61), tripled at 3 (G7.62).
export function tractorCost(range) { return Math.max(1, Math.min(TRACTOR_MAX_RANGE, range | 0)); }

// Whether a beam can reach a unit at `range` hexes (true range, not effective — G7.31).
export function canTractor(range) { return (range | 0) >= 0 && (range | 0) <= TRACTOR_MAX_RANGE; }

// G7.352: each point of negative tractor cancels one point of the positive beam's effective power. The link
// breaks once negative power meets or exceeds the positive power holding it.
export function tractorBroken(positivePower, negativePower) { return (negativePower | 0) >= (positivePower | 0); }
