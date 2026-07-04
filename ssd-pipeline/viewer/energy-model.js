// Energy allocation — power model. Derives a ship's per-turn power profile from its SSD box counts
// plus a small per-ship profile table. Functional game-mechanics data transcribed from owned material
// (SFB B3 / H sections); the per-box output, life-support, capacitor, and weapon-arm values are
// verified by unit tests and calibrated against known ship totals.
import { shipLoadout } from './ship-loadout.js';

export const PER_BOX_OUTPUT = { 'warp-engine': 1, 'impulse-engine': 1, 'apr': 1 };   // power per undestroyed box
export const LIFE_SUPPORT = { 1: 3, 2: 1.5, 3: 1, 4: 0.5, 5: 0 };                    // by size class (B3.3)
export const WEAPON_ARM = { PHOTON: { arm: 2, overload: 4 }, DISR: { arm: 1, overload: 2 } }; // per-turn cost
export const CAP_PER_PHASER = { 'PH-1': 1, 'PH-2': 1, 'PH-3': 0.5 };                 // capacitor capacity (H6.21)
export const SHIP_PROFILES = {   // size class + movement cost per ship code (default SC3 / cost 1)
  'FED-CA': { sizeClass: 3, moveCost: 1 }, 'FED-CL': { sizeClass: 3, moveCost: 1 },
  'FED-NCL': { sizeClass: 3, moveCost: 1 }, 'KLI-D7': { sizeClass: 3, moveCost: 1 },
  'GOR-CA': { sizeClass: 3, moveCost: 1 },
};
const DEFAULT_PROFILE = { sizeClass: 3, moveCost: 1 };

// ShipPower = { warp, impulse, apr, total, batteries, capacitorCap, sizeClass, moveCost,
//               shields:[], weapons:[{id,cls,arm,overload}], systems:{...presence...} }
export function shipPower(code, verified, detection) {
  const boxes = {};
  for (const g of (verified.groups || [])) boxes[g.family] = (boxes[g.family] || 0) + (g.boxIds || []).length;
  const n = f => boxes[f] || 0;
  const warp = n('warp-engine') * PER_BOX_OUTPUT['warp-engine'];
  const impulse = n('impulse-engine') * PER_BOX_OUTPUT['impulse-engine'];
  const apr = n('apr') * PER_BOX_OUTPUT['apr'];
  const { mounts, shields } = shipLoadout(verified, detection);
  const capacitorCap = Math.round(mounts.reduce((a, m) => a + (CAP_PER_PHASER[m.cls] || 0), 0));
  const weapons = mounts.filter(m => WEAPON_ARM[m.cls])
    .map(m => ({ id: m.id, cls: m.cls, arm: WEAPON_ARM[m.cls].arm, overload: WEAPON_ARM[m.cls].overload }));
  const prof = SHIP_PROFILES[code] || DEFAULT_PROFILE;
  return {
    warp, impulse, apr, total: warp + impulse + apr,
    batteries: n('battery'),
    capacitorCap,
    sizeClass: prof.sizeClass, moveCost: prof.moveCost,
    shields: (shields || []).slice(),
    weapons,
    systems: {
      shuttles: n('shuttle-bay'), tractor: n('tractor') > 0, transporter: n('transporter') > 0,
      ecm: true, labs: n('lab'), fireControl: true, cloak: false,
    },
  };
}
