import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shipPower, lifeSupportCost, newEafColumn, validateEaf, foldEaf, sinkMax, specReinfMax, plasmaClsOf, HET_COST, ewFieldMax } from '../viewer/energy-model.js';

test('D6.310: ECM + ECCM combined cannot exceed the sensor rating (ewFieldMax = rating − other, capped per-field)', () => {
  assert.equal(ewFieldMax(6, 0), 6, 'nothing in the other field → full 6');
  assert.equal(ewFieldMax(6, 4), 2, 'other field holds 4 → only 2 room left (combined ≤ 6)');
  assert.equal(ewFieldMax(6, 6), 0, 'other field already at 6 → no room');
  assert.equal(ewFieldMax(4, 3), 1, 'damaged sensor track (rating 4) → tighter combined cap');
  assert.equal(ewFieldMax(6, 0, 6), 6, 'per-field cap still applies');
});
import { armStepCost, armTurns } from '../viewer/weapon-arming.js';

const load = c => shipPower(
  c,
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/verified.json`)),
  JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/detection.json`)),
);

test('EM costs six hexes of movement energy; EDR costs 3 per powered lab (C10.11 / D14.12)', () => {
  const p = load('FED-CA');   // moveCost 1
  const base = newEafColumn(p, 0);
  const used0 = validateEaf(p, base, 0, 0).used;
  assert.equal(validateEaf(p, { ...base, em: true }, 0, 0).used, used0 + 6 * p.moveCost, 'EM adds six hexes of movement energy');
  assert.equal(validateEaf(p, { ...base, edr: 2 }, 0, 0).used, used0 + 6, 'EDR adds 3 per lab (2 labs → 6)');
});

test('shipPower derives production, capacitor, and weapons from the SSD', () => {
  // Golden vectors from OUR verified SSD data (flat 1-power/box model; calibrated in the plan's
  // final task). Fed CA: 30 warp + 4 impulse + 2 apr = 36; 4 batteries.
  const fed = load('FED-CA');
  assert.equal(fed.warp, 30, 'Fed CA warp boxes');
  assert.equal(fed.impulse, 4); assert.equal(fed.apr, 2);
  assert.equal(fed.total, 36, 'Fed CA total power (calibration anchor)');
  assert.equal(fed.batteries, 4, 'Fed CA battery cells');
  assert.equal(fed.capacitorCap, 9, 'Fed CA capacitor: 8×PH-1 + 2×PH-3(0.5) = 9 (our SSD fit)');
  assert.equal(fed.weapons.filter(w => w.cls === 'PHOTON').length, 4, 'Fed CA photons');
  assert.equal(fed.sizeClass, 3);
  assert.ok(fed.systems.shuttles > 0 && fed.systems.tractor && fed.systems.transporter);

  // Klingon D7: 30 warp + 5 impulse + 4 apr = 39; 3 batteries; 9× PH-2 capacitor.
  const kli = load('KLI-D7');
  assert.equal(kli.total, 39, 'Klingon D7 total power (calibration anchor)');
  assert.equal(kli.batteries, 3);
  assert.equal(kli.capacitorCap, 9, 'Klingon D7 capacitor: 9×PH-2 = 9');
  assert.equal(kli.weapons.filter(w => w.cls === 'DISR').length, 4, 'Klingon D7 disruptors');
});

test('lifeSupportCost is by size class; newEafColumn defaults to charge/hold/power all', () => {
  const fed = load('FED-CA');
  assert.equal(lifeSupportCost(fed), 1, 'SC3 life support = 1');
  const col = newEafColumn(fed, 8);
  assert.equal(col.lifeSupport, 1, 'mandatory life support pre-filled');
  assert.equal(col.phaserCap, fed.capacitorCap, 'capacitor charged to full');
  assert.ok(Object.values(col.weapons).every(w => w.armed && !w.overload), 'all heavy weapons armed, none overloaded');
  assert.equal(col.shieldsActive, true, 'shields activated');
  assert.equal(col.movement, 8 * fed.moveCost, 'movement funds prev speed');
  assert.equal(col.fireControl, 1, 'fire control full when the ship has it');
  assert.deepEqual(col.specReinf, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  // carried capacitor charge from last turn: the default only tops up the remaining room (H6 carry-over)
  assert.equal(newEafColumn(fed, 8, 4).phaserCap, fed.capacitorCap - 4, 'phaserCap fills only the empty room');
});

test('validateEaf: golden used, balance status, and hard errors', () => {
  const fed = load('FED-CA');
  // Default FED-CA column at speed 0: LS 1 + fireControl 1 + phaserCap 9 + 4 photons×2 arm = 19.
  const col = newEafColumn(fed, 0);
  const v = validateEaf(fed, col);
  assert.equal(v.used, 19, 'hand-computed default budget');
  assert.equal(v.produced, 40, 'total 36 + 4 batteries');
  assert.equal(v.status, 'under', 'default leaves surplus');

  // overloading one photon adds overload(4) − arm(2) = 2
  const wId = fed.weapons[0].id;
  const over = { ...col, weapons: { ...col.weapons, [wId]: { armed: true, overload: true } } };
  assert.equal(validateEaf(fed, over).used, 21);

  // balanced when movement soaks the surplus exactly
  assert.equal(validateEaf(fed, { ...col, movement: 21 }).status, 'balanced');
  // over-allocation
  const big = validateEaf(fed, { ...col, movement: 40 });
  assert.equal(big.status, 'over');
  assert.ok(big.errors.some(e => /over/i.test(e)));
  // mandatory life support
  assert.ok(validateEaf(fed, { ...col, lifeSupport: 0 }).errors.some(e => /life support/i.test(e)));
  // capacitor carried-room: 6 requested + 4 carried > cap 9
  assert.ok(validateEaf(fed, { ...col, phaserCap: 6 }, 4).errors.some(e => /capacitor/i.test(e)));
  // impulse-to-move <= 1
  assert.ok(validateEaf(fed, { ...col, impulseMove: 2 }).errors.some(e => /impulse/i.test(e)));
});

test('validateEaf accounts for current battery charge and caps recharge to empty batteries', () => {
  const fed = load('FED-CA');   // 4 batteries
  const col = newEafColumn(fed, 0);
  assert.equal(validateEaf(fed, col, 0, 4).produced, fed.total + 4, 'full batteries add their full charge');
  assert.ok(validateEaf(fed, { ...col, recharge: 1 }, 0, 4).errors.some(e => /recharge|empt/i.test(e)), 'cannot charge full batteries');
  assert.equal(validateEaf(fed, col, 0, 1).produced, fed.total + 1, 'only current battery charge is available');
  assert.equal(validateEaf(fed, { ...col, recharge: 3 }, 0, 1).errors.some(e => /recharge|empt/i.test(e)), false, 'may charge the 3 empty batteries');
  assert.ok(validateEaf(fed, { ...col, recharge: 4 }, 0, 1).errors.some(e => /recharge|empt/i.test(e)), 'cannot charge beyond the empty batteries');
});

test('foldEaf applies a locked column to turn state', () => {
  const fed = load('FED-CA'); const wId = fed.weapons[0].id;
  const base = newEafColumn(fed, 0);
  const col = { ...base, movement: 8, phaserCap: 5, genReinf: 3, ecm: 2,
    weapons: { ...base.weapons, [wId]: { armed: true, overload: true } } };
  const ts = foldEaf(fed, col, 4);
  assert.equal(ts.speed, 8, 'movement 8 / moveCost 1 = speed 8');
  assert.equal(ts.armed[wId].overload, true, 'overloaded weapon folded');
  assert.equal(ts.capacitor, 9, 'carried 4 + charged 5');
  assert.equal(ts.reinforce.gen, 1, 'general reinforcement 3 energy → 1 point (D3.341, ÷2 round down)');
  assert.equal(ts.ecmLevel, 2);
  // an un-armed weapon is absent from armed{}
  const noFire = foldEaf(fed, { ...base, weapons: Object.fromEntries(fed.weapons.map(w => [w.id, { armed: false, overload: false }])) }, 0);
  assert.equal(Object.keys(noFire.armed).length, 0);
});

test('sinkMax enforces rule-based slider ceilings', () => {
  const fed = load('FED-CA');   // moveCost 1, capacitor 9, 4 batteries
  assert.equal(sinkMax(fed, 'movement'), 31, '30-hex cap + 1 impulse point (Fed CA has impulse engines)');
  assert.equal(sinkMax(fed, 'ecm'), 6); assert.equal(sinkMax(fed, 'eccm'), 6);
  assert.equal(sinkMax(fed, 'phaserCap'), 9, 'capacitor room');
  assert.equal(sinkMax(fed, 'recharge'), 4, 'no more than battery capacity');
  assert.equal(sinkMax(fed, 'tractor'), fed.systems.tractor);
  assert.equal(sinkMax(fed, 'transporter'), fed.systems.transporter);
  assert.equal(specReinfMax(fed, 1), fed.total + fed.batteries, 'D3.342: specific reinforcement is limited only by available power, NOT the printed box value');
  assert.equal(specReinfMax(fed, 1, 5), fed.total + fed.batteries, 'a standing shield reinforces as far as power allows (no printed cap)');
  assert.equal(specReinfMax(fed, 1, 0), 0, 'D3.343: a shield that is down cannot be specific-reinforced');
});

test('D9.21: damage-control energy ceiling is the DC track rating, not the intact-box count', () => {
  const withRating = { dcRating: 4, systems: { damageControl: 6 } };
  assert.equal(sinkMax(withRating, 'damageControl'), 4, 'ceiling = the highest number on the DC track (the rating)');
  const noRating = { dcRating: 0, systems: { damageControl: 5 } };
  assert.equal(sinkMax(noRating, 'damageControl'), 5, 'rating not captured yet → fall back to intact DC box count');
});

// disarm every heavy weapon so a column exercises movement/reserve warp accounting without photon arming (warp) confounding it
const disarmed = c => ({ ...c, weapons: Object.fromEntries(Object.keys(c.weapons).map(id => [id, { armed: false }])) });

test('C2.411/C2.112: practical speed reaches 31 (30 warp + the 1 impulse point), no warp violation', () => {
  const fed = load('FED-CA');   // moveCost 1, warp 30
  const col = { ...disarmed(newEafColumn(fed, 0)), movement: 31 };
  assert.equal(foldEaf(fed, col, 0, {}).speed, 31, 'movement 31 folds to practical speed 31 (C2.411)');
  assert.ok(!validateEaf(fed, col).errors.some(e => /warp allocations exceed/i.test(e)), 'the warp share caps at 30, the 31st is the impulse point → legal');
  assert.ok(validateEaf(fed, { ...col, movement: 32 }).errors.some(e => /31-point/i.test(e)), 'movement 32 exceeds the practical-speed maximum');
});

test('C2.112 / H7.41: warp funds ≤30 movement points and cannot be double-committed to reserve', () => {
  const fed = load('FED-CA');   // warp 30, moveCost 1
  const col = disarmed(newEafColumn(fed, 0));
  assert.ok(!validateEaf(fed, { ...col, movement: 20, reserveWarp: 10 }).errors.some(e => /warp allocations exceed/i.test(e)), '20 warp move + 10 reserve = 30 ≤ warp: legal');
  assert.ok(validateEaf(fed, { ...col, movement: 30, reserveWarp: 1 }).errors.some(e => /warp allocations exceed/i.test(e)), '30 warp move consumes all warp — no output left for 1 reserve');
  assert.ok(validateEaf(fed, { ...col, movement: 25, reserveWarp: 10 }).errors.some(e => /warp allocations exceed/i.test(e)), '25 + 10 = 35 > 30 warp: over-committed');
});

test('E4.44/E4.413: a photon already committed to overload holds at the overload price (2), one over the standard hold (1)', () => {
  const p = load('FED-CA');
  const photon = p.weapons.find(w => w.cls === 'PHOTON');
  const armed = armTurns('PHOTON');
  const heldPlain = validateEaf(p, newEafColumn(p, 0, 0, { [photon.id]: armed })).used;
  const col = newEafColumn(p, 0, 0, { [photon.id]: armed });
  col.weapons[photon.id].overload = true;
  const heldOver = validateEaf(p, col, 0, p.batteries, { [photon.id]: true }).used;   // prevOverload: already committed last turn
  assert.equal(heldOver - heldPlain, 1, 'overloaded hold (2) costs 1 more than the standard hold (1)');
});

test('E4.411/E4.412: overloading a HELD photon this turn pays the full overload energy plus the standard hold', () => {
  const p = load('FED-CA');
  const photon = p.weapons.find(w => w.cls === 'PHOTON');
  const armed = armTurns('PHOTON');
  const heldPlain = validateEaf(p, newEafColumn(p, 0, 0, { [photon.id]: armed })).used;
  const col = newEafColumn(p, 0, 0, { [photon.id]: armed });
  col.weapons[photon.id].overload = true;
  const transition = validateEaf(p, col, 0, p.batteries, {}).used;   // prevOverload empty → transition turn
  assert.equal(transition - heldPlain, 4, 'the transition turn adds the full 4-point overload energy on top of the standard hold (E4.412)');
});

test('E4.23: photon arming + overload energy is warp-sourced and counts against warp output', () => {
  const p = load('FED-CA');   // warp 30, 4 photons arming at 2 = 8 warp
  const col = newEafColumn(p, 0, 0);
  assert.ok(validateEaf(p, { ...col, movement: 24 }).errors.some(e => /warp allocations exceed/i.test(e)), '24 warp move + 8 warp photon-arm = 32 > 30 warp');
  assert.ok(!validateEaf(p, { ...col, movement: 20 }).errors.some(e => /warp allocations exceed/i.test(e)), '20 move + 8 arm = 28 ≤ 30 warp: legal');
});

test('shipPower detects a cloaking device from the SSD (ROSTER-1: Romulan cloaks, Federation does not)', () => {
  assert.equal(load('ROM-KR').systems.cloak, true, 'Romulan King Eagle has a cloaking device');
  assert.equal(load('FED-CA').systems.cloak, false, 'Federation CA has no cloak');
});

test('multi-turn arming: validateEaf charges the schedule by progress; a fully-armed photon holds cheaper (E4.21/E4.22)', () => {
  const p = load('FED-CA');
  const photon = p.weapons.find(w => w.cls === 'PHOTON');
  assert.ok(photon, 'FED-CA has photons');
  // fresh column: every photon at progress 0 (first arming turn). Move ONE to fully-armed → it holds instead.
  const arming = validateEaf(p, newEafColumn(p, 0, 0)).used;
  const heldCol = newEafColumn(p, 0, 0, { [photon.id]: armTurns('PHOTON') });   // progress = 2 → fully armed
  assert.equal(heldCol.weapons[photon.id].progress, armTurns('PHOTON'), 'column carries the arming progress');
  const held = validateEaf(p, heldCol).used;
  assert.equal(arming - held, armStepCost('PHOTON', 0) - armStepCost('PHOTON', armTurns('PHOTON')),
    'holding one photon saves (first arm step − hold)');
  assert.equal(armStepCost('PHOTON', 0) - armStepCost('PHOTON', armTurns('PHOTON')), 1, 'photon: 2 (arming) → 1 (hold)');
});

test('overload doubles the arming energy while arming (E4.411)', () => {
  const p = load('FED-CA');
  const photon = p.weapons.find(w => w.cls === 'PHOTON');
  // while ARMING (progress 0): overload doubles this turn's step (+arm)
  const armPlain = validateEaf(p, newEafColumn(p, 0, 0, { [photon.id]: 0 })).used;
  const armCol = newEafColumn(p, 0, 0, { [photon.id]: 0 });
  armCol.weapons[photon.id].overload = true;
  assert.equal(validateEaf(p, armCol).used - armPlain, armStepCost('PHOTON', 0), 'overload doubles the arming step');
});

test('foldEaf advances arming progress one turn per armed turn, resets when un-armed (E4.21 consecutive turns)', () => {
  const p = load('FED-CA');
  const photon = p.weapons.find(w => w.cls === 'PHOTON');
  const col = newEafColumn(p, 0, 0);                              // all weapons armed
  const t1 = foldEaf(p, col, 0, {});                             // turn 1 → progress 1
  assert.equal(t1.armProgress[photon.id], 1, 'one armed turn → progress 1');
  const t2 = foldEaf(p, col, 0, t1.armProgress);                // turn 2 → progress 2 (fully armed, capped)
  assert.equal(t2.armProgress[photon.id], armTurns('PHOTON'), 'second armed turn → fully armed');
  const t3 = foldEaf(p, col, 0, t2.armProgress);                // held → stays capped at fully armed
  assert.equal(t3.armProgress[photon.id], armTurns('PHOTON'), 'holding does not advance past armed');
  const dropCol = { ...col, weapons: { ...col.weapons, [photon.id]: { ...col.weapons[photon.id], armed: false } } };
  const dropped = foldEaf(p, dropCol, 0, t2.armProgress);       // un-arm → discharged
  assert.equal(dropped.armProgress[photon.id], 0, 'skipping a turn discharges the weapon');
});

test('foldEaf: a rolling plasma holds at the final arming turn instead of completing (FP1.221)', () => {
  const p = load('GOR-CA');
  const plasma = p.weapons.find(w => w.cls === 'PLASMA-S');
  const col = newEafColumn(p, 0, 0);
  let prog = foldEaf(p, col, 0, {}).armProgress;         // turn 1 → 1
  prog = foldEaf(p, col, 0, prog).armProgress;           // turn 2 → 2 (= N-1, ready for the final turn)
  assert.equal(prog[plasma.id], 2);
  const rollCol = { ...col, weapons: { ...col.weapons, [plasma.id]: { ...col.weapons[plasma.id], roll: true } } };
  assert.equal(foldEaf(p, rollCol, 0, prog).armProgress[plasma.id], 2, 'rolling holds at the final arming turn');
  assert.equal(foldEaf(p, col, 0, prog).armProgress[plasma.id], 3, 'completing (no roll) advances to fully armed');
});

test('HET costs 5 hexes of warp energy (C6.21)', () => {
  assert.equal(HET_COST, 5);
});

test('cloak costs the ship\'s per-ship SSD energy (G13.21) — Romulan KR = 20, was free', () => {
  const p = load('ROM-KR');
  assert.equal(p.cloakCost, 20, 'KR cloak cost comes from verified stats');
  const base = validateEaf(p, newEafColumn(p, 0, 0)).used;
  const col = newEafColumn(p, 0, 0); col.cloak = true;
  assert.equal(validateEaf(p, col).used - base, 20, 'activating the cloak adds 20 energy');
});

test('general-reinforcement energy halves to points at 2 energy = 1 point (D3.341)', () => {
  const p = load('FED-CA');
  const col = newEafColumn(p, 0, 0); col.genReinf = 10;
  assert.equal(foldEaf(p, col, 0, {}).reinforce.gen, 5, '10 energy of general reinforcement → 5 points');
  col.genReinf = 7;
  assert.equal(foldEaf(p, col, 0, {}).reinforce.gen, 3, 'odd energy rounds down (7 → 3)');
});

test('foldEaf holds allocated reserve warp for reactive use (H7.4/H7.36)', () => {
  const p = load('FED-CA');
  const col = newEafColumn(p, 0, 0);
  col.reserveWarp = 3;
  const ts = foldEaf(p, col, 0, {});
  assert.equal(ts.reserveWarp, 3, 'reserve warp is held for the turn, not merely paid for');
});

test('plasmaClsOf maps launcher type strings to arming classes (FP2.51)', () => {
  assert.equal(plasmaClsOf('Plasma F'), 'PLASMA-F');
  assert.equal(plasmaClsOf('Plasma S'), 'PLASMA-S');
  assert.equal(plasmaClsOf('Plasma S (LP)'), 'PLASMA-S');   // arc suffix ignored
  assert.equal(plasmaClsOf('Plasma-R'), 'PLASMA-R');
  assert.equal(plasmaClsOf('Plasma G'), 'PLASMA-G');
});

test('Phase B: shipPower brings plasma launchers into the EA weapon list (GOR-CA 2×S + 2×F)', () => {
  const p = load('GOR-CA');
  const plasma = p.weapons.filter(w => w.plasma);
  assert.equal(plasma.length, 4, 'four real plasma launchers');
  assert.ok(plasma.every(w => w.cls.startsWith('PLASMA-')), 'each carries a PLASMA-x arming class');
  assert.equal(plasma.filter(w => w.cls === 'PLASMA-S').length, 2);
  assert.equal(plasma.filter(w => w.cls === 'PLASMA-F').length, 2);
  assert.ok(!plasma.some(w => /pseudo/i.test(w.gtype || '')), 'pseudo-plasma marker is not a launcher');
  // each launcher arms over three turns per its type schedule
  const s = plasma.find(w => w.cls === 'PLASMA-S');
  assert.equal(armTurns(s.cls), 3);
});

test('J2.2211: suicide-shuttle arming is a 0-3 energy ALLOCATION charged at its value (not a flat flag)', () => {
  const p = load('FED-CA');
  const base = disarmed(newEafColumn(p, 0));
  const used0 = validateEaf(p, base, 0, 0).used;
  assert.equal(validateEaf(p, { ...base, suicide: 3 }, 0, 0).used, used0 + 3, '3 points of arming energy charge 3');
  assert.equal(validateEaf(p, { ...base, suicide: 1 }, 0, 0).used, used0 + 1, '1 point charges 1');
  assert.equal(sinkMax(p, 'suicide'), 3, 'J2.2211: no more than 3 points per turn (FED-CA has shuttles)');
  assert.equal(sinkMax({ ...p, systems: { ...p.systems, shuttles: 0 } }, 'suicide'), 0, 'no shuttles in inventory → nothing to arm');
  assert.equal(foldEaf(p, { ...base, suicide: 2 }, 0, {}).suicide, 2, 'the fold carries the allocated arming energy');
  // J1.868: shuttle-arming energy (SS or WW) cannot be allocated without a shuttle in the bay
  const bare = { ...p, systems: { ...p.systems, shuttles: 0 } };
  assert.ok(validateEaf(bare, { ...base, suicide: 1 }, 0, 0).errors.some(e => /J1\.868/.test(e)), 'suicide arming without a shuttle is an error');
  assert.ok(validateEaf(bare, { ...base, wildWeasel: true }, 0, 0).errors.some(e => /J1\.868/.test(e)), 'weasel charging without a shuttle is an error');
  assert.ok(validateEaf(p, { ...base, suicide: 4 }, 0, 0).errors.some(e => /J2\.2211/.test(e)), 'more than 3 points in one turn is an error');
});
