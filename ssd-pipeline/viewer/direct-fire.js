// Direct-fire resolution: roll each committed mount against its weapon chart, stack hits by struck
// shield into combined volleys (D4.34), and apply each volley through the existing DAC damage engine.
import { exposedShield, hexDistance } from './battle-geom.js';
import { WEAPONS, damageFor, feedbackFor } from './weapon-charts.js';
import { applyVolley, makeDice } from './dac-allocator.js';
import { ewShift } from './ew.js';   // D6.34/D6.35: net ECM applies as a die-roll shift, not a range add

// dieFn() returns a d6 (1..6). netEcm (target ECM beyond firer ECCM, D6.3) is added to the range the weapon
// chart is read at, so jamming lowers damage or pushes a shot out of range. Returns { hit, points,
// struckShield, die, trueRange, effRange }.
export function resolveMount(firer, mount, target, dieFn, mode = false, netEcm = 0, passive = false) {
  const def = WEAPONS[mount.cls];
  const trueRange = hexDistance(firer, target);
  const struckShield = exposedShield(firer, target);
  const die = dieFn();
  if (passive && trueRange > 5)                                    // D19.23: passive FC can't fire direct-fire weapons beyond 5 hexes true range
    return { hit: false, points: 0, struckShield, die, trueRange, effRange: trueRange, feedback: 0, passive: true };
  const effRange = passive ? 2 * trueRange : trueRange;   // D19.11: passive FC has no lock-on → the hit chart is read at double true range
  const shift = ewShift(Math.max(0, netEcm | 0));         // D6.34/D6.35: net ECM produces a die-roll shift (E1.82), applied to the die — NOT added to the range
  const points = def ? damageFor(def, effRange, die, mode, trueRange, shift) : 0;   // mode: false | 'overload' | 'prox'
  const feedback = def ? feedbackFor(def, trueRange, die, mode, points > 0) : 0;   // point-blank overload feeds back to the firer (E4.431/E3.54)
  return { hit: points > 0, points, struckShield, die, trueRange, effRange, ewShift: shift, feedback };
}

// models[shipId] is that ship's buildShipModel() result. Rolls every committed mount, buckets hits by
// (target, struck shield), and calls applyVolley once per bucket. Returns { volleys, log }.
// reinforceOf may be async — it can pause to let the defender pour reserve/battery power into the struck
// shield before the volley resolves (H7.134). All to-hit rolls are taken before any bucket applies, so the
// pause does not affect determinism.
export async function resolveAttackPlan(plan, ships, shipMounts, models, rand = Math.random, modeFn = null, reinforceOf = null, netEcmFn = null, criticals = false, passiveFcFn = null) {
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
        const r = resolveMount(firer, mount, target, d6, modeFn ? modeFn(m.shipId, id) : false, netEcmFn ? netEcmFn(firer, target) : 0, passiveFcFn ? passiveFcFn(firer) : false);
        log.push({ kind: 'shot', firer: m.shipId, mount: id, cls: mount.cls, target: g.targetShipId, ...r });
        if (r.feedback > 0) {   // E4.431/E3.54: point-blank overload damage to the FIRER's own shield facing the target
          const fbShield = exposedShield(target, firer), key = `fb:${m.shipId}|${fbShield}`;
          const fb = buckets.get(key) || { targetShipId: m.shipId, shield: fbShield, points: 0, firers: new Set(), feedback: true };
          fb.points += r.feedback; fb.firers.add(g.targetShipId); buckets.set(key, fb);
        }
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
    const absorbed = reinforceOf ? (await reinforceOf(b.targetShipId, b.shield, b.points)) || 0 : 0;   // reinforcement soaks first (may pause for reactive reserve, H7.134)
    const pts = b.points - absorbed;
    const effects = model ? applyVolley(model, { shield: b.shield, points: pts, criticals }, dice2d6) : [];
    volleys.push({ targetShipId: b.targetShipId, shield: b.shield, points: b.points, absorbed, firers: [...b.firers], effects, feedback: !!b.feedback });
    log.push({ kind: 'volley', target: b.targetShipId, shield: b.shield, points: b.points, absorbed, effects });
  }
  return { volleys, log };
}
