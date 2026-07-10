// Seeking weapons (C5) — drones and plasma torpedoes that live on the map and home toward a target,
// moving on the Impulse Chart just like ships. Pure functions over a seeker token; the host owns launch
// gating, per-impulse stepping, and handing an impact to the DAC. Warhead/speed/fade are data on the token,
// so drone types and plasma sizes are just different specs, not different code.
import { hexDistance } from './battle-geom.js';
import { movesOnImpulse, neighbor } from './movement.js';

// the hex facing (0..5) whose neighbor most reduces the distance to the target — free homing (seekers are nimble).
// hexDistance floors at 1 (min weapon range), so treat the target hex itself as distance 0 to home INTO it.
export function bearingToward(from, to) {
  const cur = from.facing ?? 0;
  let best = cur, bestD = Infinity;
  for (const df of [0, 1, 5]) {   // F2.121: a seeker has Turn Mode 1 — at most ONE hexside of turn per hex moved; F2.14: no reverse (df never 3)
    const f = (cur + df) % 6;
    const n = neighbor(from.q, from.r, f);
    const d = (n.q === to.q && n.r === to.r) ? 0 : hexDistance(n, to);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

// FP1.53 PLASMA TORPEDO TABLE — warhead strength by hexes travelled (it ages as it flies), per type.
const PLASMA_BANDS = [5, 10, 12, 14, 15, 18, 19, 20, 23, 24, 25, 28, 29, 30];   // upper hex bound of each column
export const PLASMA_WARHEAD = {
  'PLASMA-R': [50, 50, 35, 35, 25, 25, 25, 20, 20, 20, 10, 5, 1, 0],
  'PLASMA-S': [30, 30, 22, 22, 22, 15, 15, 15, 10, 5, 1, 0, 0, 0],
  'PLASMA-G': [20, 20, 15, 15, 15, 10, 5, 1, 0, 0, 0, 0, 0, 0],
  'PLASMA-F': [20, 15, 10, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
export function plasmaWarheadAt(cls, hexes) {
  const row = PLASMA_WARHEAD[cls]; if (!row) return 0;
  for (let i = 0; i < PLASMA_BANDS.length; i++) if (hexes <= PLASMA_BANDS[i]) return row[i];
  return 0;   // past 30 hexes the warhead has aged to nothing (FP1.51)
}

export function launchSeeker({ id, owner, type = 'drone', q, r, facing = 0, targetId, speed, warhead, fade = 0, endurance = 40, cls = null }) {
  return { id, owner, type, q, r, facing, targetId, speed, warhead, fade, endurance, cls, phaserHits: 0, travelled: 0 };
}

// advance one impulse: every impulse counts toward endurance (drones live a fixed number of turns, FD1.4;
// plasma a fixed number of impulses, FP1.42); the seeker only MOVES + homes on the impulses its speed schedules.
export function stepSeeker(seeker, target, impulse) {
  const endurance = (seeker.endurance ?? Infinity) - 1;
  if (!movesOnImpulse(seeker.speed, impulse)) return { ...seeker, endurance };
  const facing = bearingToward(seeker, target), n = neighbor(seeker.q, seeker.r, facing);
  return { ...seeker, q: n.q, r: n.r, facing, endurance, travelled: (seeker.travelled || 0) + 1 };
}

// F3.31/F3.4: a seeking weapon whose controller no longer meets the control conditions goes uncontrolled — it
// continues straight on its last bearing (no re-homing) until it expires. Same movement cadence as a homing seeker.
export function stepSeekerBallistic(seeker, impulse) {
  const endurance = (seeker.endurance ?? Infinity) - 1;
  if (!movesOnImpulse(seeker.speed, impulse)) return { ...seeker, endurance };
  const n = neighbor(seeker.q, seeker.r, seeker.facing);
  return { ...seeker, q: n.q, r: n.r, endurance, travelled: (seeker.travelled || 0) + 1 };
}

export function seekerImpacts(seeker, target) {
  return seeker.q === target.q && seeker.r === target.r;   // co-located = impact (hexDistance floors at 1, so compare hexes)
}

// impact damage: a plasma torpedo delivers its aged warhead from the FP1.53 table, reduced 1 per 2 points of
// phaser damage taken in flight (FP1.611); drones and shuttles deliver a flat warhead.
export function seekerDamage(seeker, hexesTravelled = seeker.travelled || 0) {
  if (seeker.cls && PLASMA_WARHEAD[seeker.cls])
    return Math.max(0, plasmaWarheadAt(seeker.cls, hexesTravelled) - Math.floor((seeker.phaserHits || 0) / 2));
  return Math.max(0, (seeker.warhead || 0) - (seeker.fade || 0) * hexesTravelled);
}

export function seekerExpired(seeker) {
  if (seeker.cls && PLASMA_WARHEAD[seeker.cls] && plasmaWarheadAt(seeker.cls, seeker.travelled || 0) <= 0) return true;   // plasma aged to zero (FP1.51)
  return (seeker.endurance ?? Infinity) <= 0;
}

export const PD_RANGE = 3;   // point-defense only engages seekers this close

// F3.21 control channels: a ship guides seeking weapons up to its sensor rating; one NOT armed with drones or
// plasma controls only half (rounded up, F3.211). Drones, plasma, pseudo-plasma, scatter-packs (released as drones),
// and suicide shuttles all count against the limit. CONTROLLED_TYPES lists the seeker types that ride a control
// channel (used for the ballistic-when-uncontrolled check); the finer count is isControlledSeeker below.
export const CONTROLLED_TYPES = new Set(['drone', 'plasma', 'shuttle']);
export function controlLimit(sensorRating, seekingArmed) {
  return seekingArmed ? sensorRating : Math.ceil(sensorRating / 2);
}
// F3.224: administrative, minesweeping, and other non-combat shuttles do NOT count against the control limit — only
// combat (suicide) shuttles do. A shuttle seeker is a suicide shuttle when it carries sub:'suicide' (or a warhead).
export function isControlledSeeker(sk) {
  if (!sk) return false;
  if (sk.type === 'drone' || sk.type === 'plasma') return true;
  if (sk.type === 'shuttle') return sk.sub === 'suicide' || (sk.warhead || 0) > 0;
  return false;
}
export function controlledCount(seekers, ownerId) {
  return (seekers || []).filter(sk => sk.owner === ownerId && isControlledSeeker(sk)).length;
}

// A suicide shuttle (C6/J) — a slow, cheap homing seeker a ship launches at a target.
export const SUICIDE_SHUTTLE = { type: 'shuttle', sub: 'suicide', speed: 8, warhead: 12, fade: 0, endurance: 40 };   // sub:'suicide' marks it a controlled combat seeker (F3.21), distinct from an admin shuttle (F3.224)
// An admin shuttle (C6) — a non-combat shuttle: it moves like a shuttle but carries no warhead.
export const ADMIN_SHUTTLE = { type: 'shuttle', speed: 8, warhead: 0, fade: 0, endurance: 40 };
// A scatter-pack (C6) is a shuttle that releases a burst of drones.
export const SCATTER_PACK = 6;   // FD7: a scatter-pack releases six drones

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

// A plasma torpedo is not shot down — phasers only WEAKEN it (FP1.611; ADDs cannot touch it, E5.32). Count
// the phaser shots that connect; the host applies PD_PLASMA_DMG each toward the plasma's phaserHits total.
export const PD_PLASMA_DMG = 3;   // phaser damage per connecting point-defense shot (a close phaser-3)
export function pointDefenseHits(pdRating, rng, range) {
  if (range > PD_RANGE || pdRating <= 0) return 0;
  let hits = 0; for (let i = 0; i < pdRating; i++) if (rng.d6() >= 4) hits++;
  return hits;
}

// Build a plasma-torpedo seeker spec from its mount type name (e.g. "Plasma S (LP)"). The warhead ages per the
// FP1.53 table (plasmaWarheadAt); all plasma move at speed 32 with a 32-impulse endurance (FP1.42/FP1.43).
export function plasmaSpec(type) {
  const size = (/PLASMA[\s-]*([RSGF])/i.exec(type || '') || [])[1] || 'S';
  const cls = 'PLASMA-' + size.toUpperCase();
  return { type: 'plasma', cls, speed: 32, warhead: (PLASMA_WARHEAD[cls] || PLASMA_WARHEAD['PLASMA-S'])[0], endurance: 32 };
}
