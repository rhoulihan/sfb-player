// One impulse round of the B2.2 Impulse Procedure as a pure state machine over shared facts.
// Both clients (and solo, locally) derive the SAME round position from the same stored facts, the
// way the energy-lock and fire-commit protocols already work — the server stays a dumb fact store.
//
// Round shape per (turn, impulse):
//   facts = { intents:   { fleet: intent },          // B2.4 secret-simultaneous declarations
//             moveDone:  { fleet: { order } },       // own-fleet movement executed + posted (plot fog:
//                                                    //   only the owner can move its ships)
//             seekersDone: bool,                     // the designated finisher ran seeker moves + 6A4 impacts
//             segDone:   { '6B': { fleet: true } },  // declared-activity fleets finished acting
//             fireCommitted: { fleet: true } }       // the existing 6D commit protocol
//   intent = { fire, activity: {drones, plasma, shuttles, transporters, mines, tractors, boarding},
//              het, decel, idleImpulses: 0 | N | 'turn' }
//
// Progression: intent → 6A (all fleets move) → 6A4 (last mover resolves seekers) → 6B (only if some
// fleet declared activity; only declaring fleets must mark Done) → 6D (only if some fleet declared
// fire; only declared firers must commit — the rest auto-commit empty) → done. 6C dogfights are not
// implemented and always skip (the cursor already limits them to every 8th impulse).

export const ACTIVITY_KEYS = ['drones', 'plasma', 'shuttles', 'transporters', 'mines', 'tractors', 'boarding'];

export function emptyIntent() {
  return { fire: false, activity: Object.fromEntries(ACTIVITY_KEYS.map(k => [k, false])),
    het: false, decel: false, idleImpulses: 0 };
}

const hasActivity = it => !!it && Object.values(it.activity || {}).some(Boolean);

// which impulses an idle declaration auto-covers: the NEXT N after the submitting impulse
// (the submission itself IS that impulse's empty intent), or the rest of the turn (through 32)
export function idleCovers(intent, submittedAtImpulse, impulse) {
  const w = intent && intent.idleImpulses;
  if (!w) return false;
  if (w === 'turn') return impulse > submittedAtImpulse && impulse <= 32;
  return impulse > submittedAtImpulse && impulse <= submittedAtImpulse + w;
}

export function roundPhase(facts, fleets) {
  const intents = facts.intents || {}, moveDone = facts.moveDone || {};
  const segDone = facts.segDone || {}, fireCommitted = facts.fireCommitted || {};
  const missing = fleets.filter(f => !intents[f]);
  const activityFleets = fleets.filter(f => hasActivity(intents[f]));
  const fireFleets = fleets.filter(f => intents[f] && intents[f].fire);
  const skips = [];
  if (missing.length === 0) {   // the skip set is knowable once every declaration is in (B2.4)
    if (!activityFleets.length) skips.push('6B');
    if (!fireFleets.length) skips.push('6D');
  }
  if (missing.length) return { seg: 'intent', waitingOn: missing, skips };
  const unmoved = fleets.filter(f => !moveDone[f]);
  if (unmoved.length) return { seg: '6A', waitingOn: unmoved, skips };
  if (!facts.seekersDone) return { seg: '6A4', waitingOn: [finisherOf(facts, fleets)], skips };
  const acting = activityFleets.filter(f => !(segDone['6B'] || {})[f]);
  if (acting.length) return { seg: '6B', waitingOn: acting, skips };
  if (fireFleets.length && !facts.fireResolved) {
    const firing = fireFleets.filter(f => !fireCommitted[f]);
    return { seg: '6D', waitingOn: firing, skips };   // all declarers committed → waitingOn [] while the resolver runs
  }
  return { seg: 'done', waitingOn: [], skips };
}

// the LAST fleet to post movement resolves seeker movement + 6A4 impacts (it holds the freshest
// merged positions; the result is deterministic from the shared seed + rngCursor + public state)
export function finisherOf(facts, fleets) {
  const moveDone = facts.moveDone || {};
  return fleets.reduce((best, f) =>
    (moveDone[f] && (!best || moveDone[f].order > moveDone[best].order)) ? f : best, null);
}
