// Reactive power (H5 batteries + H7 reserve power). A ship holds a reserve pool = held reserve warp + battery
// charge, spent reactively during the turn on eligible systems. Pure helpers; the host owns the pools, the
// queued-allocation state, and the confirm/apply UI.

// reserve-eligible systems and their per-point energy cost (H7.2 list). Cost is energy spent per point of effect.
export const RESERVE_SYSTEMS = {
  specReinf: { label: 'Reinforce shield', cost: 1 },   // D3.342: 1 energy = 1 extra box on a specific shield
  genReinf:  { label: 'General reinforce', cost: 2 },  // D3.341: general reinforcement costs 2 energy per point
  eccm:      { label: 'ECCM', cost: 1 },               // D6.312: 1 energy = 1 ECCM point (Fire Decision Step, H7.33)
  capacitor: { label: 'Phaser capacitor', cost: 1 },   // E2.33: energize the phaser capacitor
};

export function reservePool(reserveWarp, battery) { return (reserveWarp || 0) + (battery || 0); }

// draw n energy from the chosen source first (default reserve warp), spilling the remainder to the other pool
export function spendReserve(reserveWarp, battery, n, source = 'warp') {
  let rw = reserveWarp || 0, b = battery || 0;
  if (source === 'battery') { const t = Math.min(n, b); b -= t; rw -= (n - t); }
  else { const t = Math.min(n, rw); rw -= t; b -= (n - t); }
  return { reserveWarp: Math.max(0, rw), battery: Math.max(0, b) };
}

export function reserveCost(system, points) { return (RESERVE_SYSTEMS[system]?.cost || 1) * points; }
export function canAfford(reserveWarp, battery, system, points) {
  return reserveCost(system, points) <= reservePool(reserveWarp, battery);
}
