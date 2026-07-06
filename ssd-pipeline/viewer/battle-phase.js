// SFB Sequence of Play (B2.2) turn engine — a segment cursor over the real phase/impulse order.
// Pure cursor mechanics: nextCursor advances one segment; advance() auto-chains through automatic
// segments and rests at the three player-input gates (energy lock, 6A2 free-movement, 6D1 fire commit).
// The host computes the three gate booleans from real game state before each advance and performs the
// heavy side-effects (resolveEnergy, resolveFire) for the segments advance() reports as "ran".

const PRE = ['energy', 'speed', 'self-destruct', 'lockon', 'initial'];   // once, before impulse 1
const IMP = ['6A1', '6A2', '6A3', '6A4', '6B1', '6B2', '6B3', '6B4', '6B5', '6B6', '6B7', '6B8', '6C',
             '6D1', '6D2', '6D3', '6D4', '6D5', '6E'];                   // repeated for impulses 1..32
const POST = ['final', 'record'];                                       // once, after impulse 32

export const SEGMENTS = [...PRE, ...IMP, ...POST].map(id => ({ id }));

// which segments block on player input, and the gate boolean the host must set true to proceed
const BLOCK = { energy: 'energyResolved', '6A2': 'moveSatisfied', '6D1': 'fireResolved' };
const ENERGY_FAMILY = new Set(PRE);

// coarse fork for the existing energy/impulse UI branches
export function family(phase) { return ENERGY_FAMILY.has(phase) ? 'energy' : 'impulse'; }

// one segment forward, honoring the pre → 32×impulse-loop → post → next-turn structure
export function nextCursor(clock) {
  const { turn, impulse, phase } = clock;
  const pi = PRE.indexOf(phase);
  if (pi >= 0) return pi < PRE.length - 1 ? { turn, impulse, phase: PRE[pi + 1] } : { turn, impulse: 1, phase: IMP[0] };
  const ii = IMP.indexOf(phase);
  if (ii >= 0) {
    if (ii < IMP.length - 1) return { turn, impulse, phase: IMP[ii + 1] };
    return impulse < 32 ? { turn, impulse: impulse + 1, phase: IMP[0] } : { turn, impulse, phase: POST[0] };
  }
  const oi = POST.indexOf(phase);
  if (oi >= 0) return oi < POST.length - 1 ? { turn, impulse, phase: POST[oi + 1] } : { turn: turn + 1, impulse: 0, phase: 'energy' };
  return clock;
}

// --- pure gate predicates the host composes into the three advance() gate booleans ---

// secret-simultaneous gate: every fleet has committed (energy lock in phase 1, fire in 6D1)
export function allCommitted(committed, fleets) {
  return fleets.length > 0 && fleets.every(f => !!committed[f]);
}
// 6A2 free-movement gate: every ship that moves this impulse and isn't on autopilot has placed its hex
export function moveSatisfied(ships, impulse, { moves, isAutopilot, placed }) {
  return ships.every(s => !moves(s, impulse) || isAutopilot(s) || placed(s));
}
// fire eligibility: a lock-on entry is either `true` (locked on to all) or a Set of target ids (D6.1)
export function hasLockOn(lockOn, shipId, targetId) {
  const l = lockOn[shipId];
  return l === true || (l instanceof Set && l.has(targetId));
}

// advance the cursor as far as it can: auto-run segments (recording them in `ran`) until one blocks on a
// player-input gate. Skips 6C except on impulses that are multiples of 8. Mutates state.clock.
export function advance(state) {
  const ran = [];
  for (let guard = 0; guard < 500; guard++) {
    const id = state.clock.phase;
    if (id === '6C' && state.clock.impulse % 8 !== 0) { state.clock = nextCursor(state.clock); continue; }
    const blk = BLOCK[id];
    if (blk && !state.gates[blk]) return { ran, blockedOn: id };   // rest at the input gate
    ran.push(id);
    state.clock = nextCursor(state.clock);
  }
  return { ran, blockedOn: null };
}
