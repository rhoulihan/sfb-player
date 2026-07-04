// Direct-fire resolution: roll each committed mount against its weapon chart, stack hits by struck
// shield into combined volleys (D4.34), and apply each volley through the existing DAC damage engine.
import { exposedShield, hexDistance } from './battle-geom.js';
import { WEAPONS, damageFor } from './weapon-charts.js';
import { applyVolley, makeDice } from './dac-allocator.js';

// dieFn() returns a d6 (1..6). Returns { hit, points, struckShield, die }.
export function resolveMount(firer, mount, target, dieFn, overload = false) {
  const def = WEAPONS[mount.cls];
  const trueRange = hexDistance(firer, target);
  const struckShield = exposedShield(firer, target);
  const die = dieFn();
  const points = def ? damageFor(def, trueRange, die, overload) : 0;
  return { hit: points > 0, points, struckShield, die };
}

// models[shipId] is that ship's buildShipModel() result. Rolls every committed mount, buckets hits by
// (target, struck shield), and calls applyVolley once per bucket. Returns { volleys, log }.
export function resolveAttackPlan(plan, ships, shipMounts, models, rand = Math.random, overloadFn = null, reinforceOf = null) {
  const byId = Object.fromEntries(ships.map(s => [s.id, s]));
  const d6 = () => 1 + Math.floor(rand() * 6);
  const dice2d6 = makeDice(rand);
  const buckets = new Map();      // `${target}|${shield}` → { targetShipId, shield, points, firers:Set }
  const log = [];

  for (const g of plan.groups) {
    const target = byId[g.targetShipId]; if (!target) continue;
    for (const m of g.members) {
      const firer = byId[m.shipId]; if (!firer) continue;
      for (const id of m.mountIds) {
        const mount = (shipMounts[m.shipId] || []).find(x => x.id === id); if (!mount) continue;
        const r = resolveMount(firer, mount, target, d6, overloadFn ? overloadFn(m.shipId, id) : false);
        log.push({ kind: 'shot', firer: m.shipId, mount: id, cls: mount.cls, target: g.targetShipId, ...r });
        if (r.points <= 0) continue;
        const key = `${g.targetShipId}|${r.struckShield}`;
        const b = buckets.get(key) || { targetShipId: g.targetShipId, shield: r.struckShield, points: 0, firers: new Set() };
        b.points += r.points; b.firers.add(m.shipId); buckets.set(key, b);
      }
    }
  }

  const volleys = [];
  for (const b of buckets.values()) {
    const model = models[b.targetShipId];
    const absorbed = reinforceOf ? (reinforceOf(b.targetShipId, b.shield, b.points) || 0) : 0;   // reinforcement soaks first
    const pts = b.points - absorbed;
    const effects = model ? applyVolley(model, { shield: b.shield, points: pts }, dice2d6) : [];
    volleys.push({ targetShipId: b.targetShipId, shield: b.shield, points: b.points, absorbed, firers: [...b.firers], effects });
    log.push({ kind: 'volley', target: b.targetShipId, shield: b.shield, points: b.points, absorbed, effects });
  }
  return { volleys, log };
}
