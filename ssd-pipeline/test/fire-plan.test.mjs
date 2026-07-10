import test from 'node:test';
import assert from 'node:assert/strict';
import { newPlan, newGroup, assignMount, unassignMount, planEligibility, expandPlanToIntents, mountEligibility } from '../viewer/fire-plan.js';

const ship = (id, q, r, facing) => ({ id, q, r, facing });
const mount = (id, ...arcs) => ({ id, cls: 'PH-1', arc: { arcs } });

test('mountEligibility flags in-arc + in-range with a struck shield', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 3, 0, 0);
  const e = mountEligibility(firer, mount('F1.PH-1.0', 'FH'), target);
  assert.equal(e.inArc, true);
  assert.equal(e.inRange, true);
  assert.equal(e.available, true);
  assert.ok(e.struckShield >= 1 && e.struckShield <= 6);
});

test('E4.43: a photon at true range 1 is ineligible normally, but an OVERLOADED photon may fire point-blank', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 1, 0, 0);   // adjacent → true range 1 (< photon min range 2)
  const photon = { id: 'F1.PHOTON.0', cls: 'PHOTON', arc: { arcs: ['FH'] } };
  const normal = mountEligibility(firer, photon, target);
  assert.equal(normal.inRange, false, 'a normal photon cannot fire at true range 1 (E4.14 minimum range)');
  assert.equal(normal.available, false);
  const overloaded = mountEligibility(firer, photon, target, true);
  assert.equal(overloaded.inRange, true, 'E4.43: an overloaded photon is the exception — it may fire at range 0-1');
  assert.equal(overloaded.available, true);
});

test('out-of-arc mounts are never available', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 3, 0, 0);   // target is forward
  const e = mountEligibility(firer, mount('F1.PH-1.0', 'RA'), target); // rear arc only
  assert.equal(e.inArc, false);
  assert.equal(e.available, false);
});

test('a mount belongs to one group; a ship can span groups; steal needs force', () => {
  const plan = newPlan();
  const A = newGroup('A', '#2563eb'); A.targetShipId = 'E1'; plan.groups.push(A);
  const B = newGroup('B', '#16a34a'); B.targetShipId = 'E2'; plan.groups.push(B);
  assert.deepEqual(assignMount(plan, 'A', 'F1', 'F1.PH-1.0'), {}, 'assign to A');
  assert.deepEqual(assignMount(plan, 'B', 'F1', 'F1.PH-1.1'), {}, 'same ship, other mount, group B (split-fire)');
  const c = assignMount(plan, 'B', 'F1', 'F1.PH-1.0');           // already in A
  assert.deepEqual(c, { conflict: { fromGroupId: 'A' } }, 'steal blocked without force');
  const stillInA = A.members.find(m => m.shipId === 'F1')?.mountIds || [];
  assert.ok(stillInA.includes('F1.PH-1.0'), 'blocked steal did not mutate group A');
  assignMount(plan, 'B', 'F1', 'F1.PH-1.0', { force: true });    // steal
  const inA = A.members.find(m => m.shipId === 'F1')?.mountIds || [];
  assert.ok(!inA.includes('F1.PH-1.0'), 'removed from A after forced steal');
  assert.equal(planEligibility(plan).get('F1.PH-1.0').assignedGroupId, 'B');
});

test('unassignMount removes a mount and prunes the empty member', () => {
  const plan = newPlan();
  const A = newGroup('A', '#2563eb'); A.targetShipId = 'E1'; plan.groups.push(A);
  assignMount(plan, 'A', 'F1', 'F1.PH-1.0');
  unassignMount(plan, 'A', 'F1', 'F1.PH-1.0');
  assert.equal(A.members.find(m => m.shipId === 'F1'), undefined, 'empty member pruned');
});

test('expandPlanToIntents emits one C4 intent per committed mount', () => {
  const plan = newPlan();
  const A = newGroup('A', '#2563eb'); A.targetShipId = 'E1'; plan.groups.push(A);
  assignMount(plan, 'A', 'F1', 'F1.PH-1.0');
  const intents = expandPlanToIntents(plan);
  assert.deepEqual(intents, [{ firerShipId: 'F1', weaponInstanceId: 'F1.PH-1.0',
    targetRef: { kind: 'unit', unitId: 'E1' }, segment: '6D-direct' }]);
});
