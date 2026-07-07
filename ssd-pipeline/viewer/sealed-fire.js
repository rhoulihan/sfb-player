import { resolveAttackPlan } from './direct-fire.js';
import { makeRng } from './rng.js';

// Resolve committed fire deterministically from the shared (seed, cursor). At 6D1 reveal the designated
// client (battle creator) runs this over the merged fire of all fleets and broadcasts the result; the
// cursor it returns is persisted so the next resolution continues the same die stream. Because the dice
// come only from (seed, cursor), every client that runs this with the same inputs gets the same volleys.
export function resolveSealedFire({ plan, ships, mountsMap, models, seed, cursor = 0, modeFn = null, reinforceOf = null }) {
  const rng = makeRng(seed, cursor);
  const res = resolveAttackPlan(plan, ships, mountsMap, models, rng.next, modeFn, reinforceOf);
  return { ...res, cursor: rng.cursor() };
}
