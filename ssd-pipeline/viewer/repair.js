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
