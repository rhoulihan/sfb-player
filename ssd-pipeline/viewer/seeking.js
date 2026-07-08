// Seeking weapons (C5) — drones and plasma torpedoes that live on the map and home toward a target,
// moving on the Impulse Chart just like ships. Pure functions over a seeker token; the host owns launch
// gating, per-impulse stepping, and handing an impact to the DAC. Warhead/speed/fade are data on the token,
// so drone types and plasma sizes are just different specs, not different code.
import { hexDistance } from './battle-geom.js';
import { movesOnImpulse, neighbor } from './movement.js';

// the hex facing (0..5) whose neighbor most reduces the distance to the target — free homing (seekers are nimble).
// hexDistance floors at 1 (min weapon range), so treat the target hex itself as distance 0 to home INTO it.
function bearingToward(from, to) {
  let best = from.facing ?? 0, bestD = Infinity;
  for (let f = 0; f < 6; f++) {
    const n = neighbor(from.q, from.r, f);
    const d = (n.q === to.q && n.r === to.r) ? 0 : hexDistance(n, to);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export function launchSeeker({ id, owner, type = 'drone', q, r, facing = 0, targetId, speed, warhead, fade = 0, endurance = 40 }) {
  return { id, owner, type, q, r, facing, targetId, speed, warhead, fade, endurance, travelled: 0 };
}

// advance one impulse: move + home only if this impulse is one the seeker's speed schedules (C3 Impulse Chart)
export function stepSeeker(seeker, target, impulse) {
  if (!movesOnImpulse(seeker.speed, impulse)) return { ...seeker };
  const facing = bearingToward(seeker, target), n = neighbor(seeker.q, seeker.r, facing);
  return { ...seeker, q: n.q, r: n.r, facing, endurance: (seeker.endurance ?? Infinity) - 1, travelled: (seeker.travelled || 0) + 1 };
}

export function seekerImpacts(seeker, target) {
  return seeker.q === target.q && seeker.r === target.r;   // co-located = impact (hexDistance floors at 1, so compare hexes)
}

// impact damage: drones deliver a flat warhead; plasma fades `fade` points per hex travelled (FP1), floored at 0
export function seekerDamage(seeker, hexesTravelled = seeker.travelled || 0) {
  return Math.max(0, (seeker.warhead || 0) - (seeker.fade || 0) * hexesTravelled);
}

export function seekerExpired(seeker) {
  return (seeker.endurance ?? Infinity) <= 0;
}

export const PD_RANGE = 3;   // point-defense only engages seekers this close

// A suicide shuttle (C6/J) — a slow, cheap homing seeker a ship launches at a target.
export const SUICIDE_SHUTTLE = { type: 'shuttle', speed: 8, warhead: 12, fade: 0, endurance: 40 };

// A wild weasel is a decoy token (type 'weasel', owned by the ship it protects). Returns the weasel
// currently protecting shipId, if any — seeking weapons homing on that ship divert to the weasel instead.
export function weaselFor(shipId, seekers) {
  return (seekers || []).find(s => s.type === 'weasel' && s.owner === shipId) || null;
}

// Point-defense / anti-drone: a defender rolls each of its PD systems (phaser-3 / ADD count) at a close-in
// seeker; any 4+ shoots it down. Returns true if the seeker is destroyed. Sandbox values, not rulebook.
export function pointDefense(pdRating, rng, range) {
  if (range > PD_RANGE || pdRating <= 0) return false;
  for (let i = 0; i < pdRating; i++) if (rng.d6() >= 4) return true;
  return false;
}

// Build a plasma-torpedo seeker spec from its mount type name (e.g. "Plasma S (LP)"). Warhead scales by
// size (R > S > G > F) and the torpedo fades as it travels; these are functional sandbox values, not
// rulebook tables. Endurance = warhead / fade, so the torpedo dissipates at its effective range.
export function plasmaSpec(type) {
  const size = (/PLASMA[\s-]*([RSGF])/i.exec(type || '') || [])[1] || 'S';
  const warhead = { R: 40, S: 20, G: 12, F: 5 }[size.toUpperCase()] ?? 20;
  const fade = 1;
  return { type: 'plasma', speed: 32, warhead, fade, endurance: warhead / fade };
}
