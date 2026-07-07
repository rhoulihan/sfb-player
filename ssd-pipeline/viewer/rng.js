// Deterministic seeded RNG (E1). One battle carries a `seed`; every die draw advances a `cursor`.
// Counter-based (splitmix32 finalizer over a Weyl-mixed (seed, cursor) input) so the stream is a pure
// function of (seed, cursor): rebuilding makeRng(seed, cursor) resumes the exact sequence — no replay,
// no shared mutable state — which is what lets both clients agree on the same rolls and a paused game
// continue identically.
export function makeRng(seed, cursor = 0) {
  const s = seed >>> 0;
  let n = cursor >>> 0;
  function next() {                                  // float in [0, 1)
    let z = (s + Math.imul(n, 0x9e3779b9)) >>> 0;    // unique per (seed, cursor)
    n = (n + 1) >>> 0;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);       // splitmix32 finalizer — scrambles all bits
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z ^= z >>> 15;
    return (z >>> 0) / 4294967296;
  }
  return {
    next,
    roll: sides => 1 + Math.floor(next() * sides),   // 1..sides
    d6: () => 1 + Math.floor(next() * 6),            // 1..6
    cursor: () => n,                                 // draws consumed — persist this in _battle.json
  };
}
