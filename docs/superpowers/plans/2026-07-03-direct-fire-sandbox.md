# Direct-Fire Combat Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side hex-map sandbox where the player repositions two fleets, forms per-mount fire groups against enemy targets, and resolves direct fire through the existing DAC damage engine.

**Architecture:** Pure ES-module engine (`battle-geom`, `ship-loadout`, `weapon-charts`, `fire-plan`, `direct-fire`) reused by a single static `battle.html` view, in the exact style of the existing `verify.html`/`damage.html`. Geometry + arc tests reuse `arc-geom.js`; damage reuses the D4.5-validated `ship-model.js` + `dac-allocator.js`. No server, no build step, no npm deps.

**Tech Stack:** Vanilla ES modules, `node --test` (no deps), the Python static server (`serve.py`), Playwright for UI verification.

## Global Constraints

- **No copyrighted content in the repo beyond functional game-mechanics data.** Weapon-chart NUMBERS are transcribed by the owner from owned material (the SSDs) or copied from the already-committed `docs/spec/C4-direct-fire-combat.md`, exactly as `dac.js` was. Never invent chart values; source them. `.gitignore` excludes only images + rules text.
- **Pure engine modules have no DOM and inject all randomness** via a dice function (reuse `dac-allocator.js`'s `makeDice(rand)`), so tests are deterministic.
- **Reuse, don't reinvent:** arcs → `arc-geom.js` (`arcCoversBearing`); damage → `ship-model.js` (`buildShipModel`) + `dac-allocator.js` (`applyVolley`). No bespoke damage math.
- **Weapon set (v0):** `PH-1`, `PH-2`, `PH-3`, `DISR`, `PHOTON` only; standard loads only (no overload/proximity/EW).
- **Coordinate convention:** ship facing `f∈0..5` → heading `f*60°`; `bearingDeg(a,b)=normalize(atan2(b.y-a.y, b.x-a.x)·180/π)`; local bearing (arc-geom frame, 0°=forward) `= normalize(bearingDeg(firer,target) − f*60)`. The SAME `f*60` mapping drives both rendering and geometry.
- **Run all tests:** `node --test ssd-pipeline/test/*.test.mjs`.
- Work on a branch, not `main`. Do not push unless asked.

## File Structure

| File | Responsibility |
|------|----------------|
| `ssd-pipeline/viewer/battle-geom.js` | Hex geometry (`hexCenter`,`hexDistance`,`bearingDeg`) + `isInArc` + `exposedShield` |
| `ssd-pipeline/viewer/ship-loadout.js` | `weaponClassOf(group)` + `shipLoadout(verified,detection)` → `{mounts, shields}` |
| `ssd-pipeline/viewer/weapon-charts.js` | `WEAPONS` catalog + `damageFor(def,trueRange,die)` (owner-sourced numbers) |
| `ssd-pipeline/viewer/fire-plan.js` | Fire-group/attack-plan state, eligibility, `assignMount`, `combinedPreview`, `expandPlanToIntents` |
| `ssd-pipeline/viewer/direct-fire.js` | `resolveMount`, `resolveAttackPlan` (stack by shield → `applyVolley`) |
| `ssd-pipeline/viewer/scenario.js` | The fixed 2-v-2 starting scenario literal |
| `ssd-pipeline/viewer/battle.html` | The sandbox UI (map, drag/rotate, fire groups, mount panel, resolve, damage view) |
| `ssd-pipeline/test/{battle-geom,ship-loadout,weapon-charts,fire-plan,direct-fire}.test.mjs` | Unit tests |

---

### Task 1: Hex geometry (battle-geom.js)

**Files:**
- Create: `ssd-pipeline/viewer/battle-geom.js`
- Test: `ssd-pipeline/test/battle-geom.test.mjs`

**Interfaces:**
- Produces: `hexCenter(q,r) → {x,y}`; `hexDistance(a,b) → number` (a,b are `{q,r}`, true range in hexes, min 1); `bearingDeg(a,b) → number` (0..360, `a`/`b` are `{q,r}`).

- [ ] **Step 1: Write the failing test**

```js
// ssd-pipeline/test/battle-geom.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hexCenter, hexDistance, bearingDeg } from '../viewer/battle-geom.js';

test('hexCenter places odd columns half a row lower (flat-top, odd-q)', () => {
  const a = hexCenter(0, 0), b = hexCenter(2, 0);
  assert.ok(Math.abs(a.y - b.y) < 0.001, 'even columns share a row');
  assert.ok(hexCenter(1, 0).y > a.y, 'odd column is offset downward');
});

test('hexDistance is symmetric and at least 1', () => {
  assert.equal(hexDistance({q:0,r:0},{q:0,r:0}), 1, 'same hex clamps to 1');
  assert.equal(hexDistance({q:0,r:0},{q:3,r:0}), hexDistance({q:3,r:0},{q:0,r:0}));
  assert.ok(hexDistance({q:0,r:0},{q:3,r:0}) >= 3);
});

test('bearingDeg: a hex due east is ~0°, due south ~90° (screen y-down)', () => {
  assert.ok(Math.abs(bearingDeg({q:0,r:0},{q:2,r:0})) < 1, 'east ≈ 0°');
  const south = bearingDeg({q:0,r:0},{q:0,r:4});
  assert.ok(Math.abs(south - 90) < 1, 'south ≈ 90°');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/battle-geom.test.mjs`
Expected: FAIL — cannot find module `battle-geom.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// ssd-pipeline/viewer/battle-geom.js
// Hex geometry for the battle map — flat-top hexes, odd-q offset (matches the battle-screen mockup).
const SIZE = 34, HW = SIZE * 1.5, HH = SIZE * Math.sqrt(3), OX = 60, OY = 60;

export function hexCenter(q, r) {
  return { x: OX + HW * q, y: OY + HH * r + (q % 2 ? HH / 2 : 0) };
}

export function hexDistance(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  return Math.max(1, Math.round(Math.hypot(c2.x - c1.x, c2.y - c1.y) / HW));
}

export function bearingDeg(a, b) {
  const c1 = hexCenter(a.q, a.r), c2 = hexCenter(b.q, b.r);
  const d = Math.atan2(c2.y - c1.y, c2.x - c1.x) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
}

export const GEOM = { SIZE, HW, HH, OX, OY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/battle-geom.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ssd-pipeline/viewer/battle-geom.js ssd-pipeline/test/battle-geom.test.mjs
git commit -m "feat(battle): hex geometry (center/distance/bearing)"
```

---

### Task 2: Arc membership + exposed shield (battle-geom.js)

**Files:**
- Modify: `ssd-pipeline/viewer/battle-geom.js`
- Test: `ssd-pipeline/test/battle-geom.test.mjs`

**Interfaces:**
- Consumes: `arcCoversBearing(name, bearing)` from `../viewer/arc-geom.js`; `bearingDeg` (Task 1).
- Produces: `headingDeg(f) → number` (`f*60`); `localBearing(firer, target) → number` (firer/target are `{q,r,facing}`); `isInArc(firer, mount, target) → {inArc, covering?}` (mount is `{arc:{arcs:[...]}}`); `exposedShield(firer, target) → 1..6`.

- [ ] **Step 1: Write the failing test**

```js
// append to ssd-pipeline/test/battle-geom.test.mjs
import { isInArc, exposedShield, localBearing } from '../viewer/battle-geom.js';

const ship = (q, r, facing) => ({ q, r, facing });
const mount = (...arcs) => ({ arc: { arcs } });

test('a target dead ahead is in a front-hemisphere arc, not a rear arc', () => {
  const firer = ship(0, 0, 0);                 // facing 0 = heading 0° = east
  const tgt = ship(3, 0, 0);                    // due east → local bearing ~0°
  assert.ok(Math.abs(localBearing(firer, tgt)) < 1);
  assert.equal(isInArc(firer, mount('FH'), tgt).inArc, true, 'front hemisphere covers dead-ahead');
  assert.equal(isInArc(firer, mount('RA'), tgt).inArc, false, 'rear arc does not');
});

test('exposedShield: firer dead ahead of a target strikes shield #1 (front)', () => {
  const target = ship(0, 0, 0);                 // target faces east
  const firer = ship(3, 0, 0);                  // firer is to the target's east = its front
  assert.equal(exposedShield(firer, target), 1);
});

test('exposedShield: firer behind the target strikes shield #4 (rear)', () => {
  const target = ship(3, 0, 0);                 // faces east
  const firer = ship(0, 0, 0);                  // firer is to the west = target rear
  assert.equal(exposedShield(firer, target), 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/battle-geom.test.mjs`
Expected: FAIL — `isInArc` is not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// append to ssd-pipeline/viewer/battle-geom.js
import { arcCoversBearing } from './arc-geom.js';

export const headingDeg = f => (((f % 6) * 60) % 360 + 360) % 360;

export function localBearing(firer, target) {
  return (((bearingDeg(firer, target) - headingDeg(firer.facing)) % 360) + 360) % 360;
}

export function isInArc(firer, mount, target) {
  const lb = localBearing(firer, target);
  const arcs = (mount.arc && mount.arc.arcs) || [];
  for (const a of arcs) if (arcCoversBearing(a, lb)) return { inArc: true, covering: a };
  return { inArc: false };
}

// which of the target's six facings faces the firer (D3.402 approximation by 60° sector)
export function exposedShield(firer, target) {
  const lb = (((bearingDeg(target, firer) - headingDeg(target.facing)) % 360) + 360) % 360;
  return ((Math.round(lb / 60) % 6) + 6) % 6 + 1;     // #1 = front (0°), clockwise
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/battle-geom.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ssd-pipeline/viewer/battle-geom.js ssd-pipeline/test/battle-geom.test.mjs
git commit -m "feat(battle): arc membership + exposed-shield geometry (reuses arc-geom)"
```

---

### Task 3: Ship loadout adapter (ship-loadout.js)

**Files:**
- Create: `ssd-pipeline/viewer/ship-loadout.js`
- Test: `ssd-pipeline/test/ship-loadout.test.mjs`

**Interfaces:**
- Produces: `weaponClassOf(group) → 'PH-1'|'PH-2'|'PH-3'|'DISR'|'PHOTON'|null` (reads `group.family` + `group.type`); `shipLoadout(verified, detection) → { mounts: [{id, cls, arc}], shields: number[] }`. `mounts` has one entry per box in each direct-fire weapon group; `id` = `${group.id}.${i}`; `shields[n-1]` = box count of the shield group whose facing is `#n` (default 0).

- [ ] **Step 1: Write the failing test**

```js
// ssd-pipeline/test/ship-loadout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponClassOf, shipLoadout } from '../viewer/ship-loadout.js';

test('weaponClassOf maps family/type to a direct-fire class or null', () => {
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser-1' }), 'PH-1');
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser 2K (FX)' }), 'PH-2');
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser-3' }), 'PH-3');
  assert.equal(weaponClassOf({ family: 'heavy-weapon', type: 'Disruptor' }), 'DISR');
  assert.equal(weaponClassOf({ family: 'heavy-weapon', type: 'Photon Torpedo' }), 'PHOTON');
  assert.equal(weaponClassOf({ family: 'drone-rack', type: 'Drone Rack' }), null, 'seeking weapons excluded');
  assert.equal(weaponClassOf({ family: 'shield', type: '' }), null);
});

test('shipLoadout expands weapon groups to one mount per box and reads shields', () => {
  const verified = { groups: [
    { id: 'g1', family: 'phaser', type: 'Phaser-1', arc: 'FH', arcDef: { arcs: ['FH'] }, boxIds: ['b1','b2'] },
    { id: 'g2', family: 'heavy-weapon', type: 'Photon Torpedo', arc: 'FH', arcDef: { arcs: ['FH'] }, boxIds: ['b3'] },
    { id: 's1', family: 'shield', type: 'Shield 1', arcDef: { arcs: [] }, boxIds: new Array(30).fill('x') },
    { id: 'c1', family: 'crew', type: 'Crew', arcDef: { arcs: [] }, boxIds: ['c'] },
  ]};
  const { mounts, shields } = shipLoadout(verified, { boxes: [] });
  assert.equal(mounts.length, 3, '2 phaser mounts + 1 photon mount');
  assert.deepEqual(mounts.map(m => m.cls), ['PH-1','PH-1','PHOTON']);
  assert.equal(mounts[0].id, 'g1.0');
  assert.equal(shields[0], 30, 'shield #1 has 30 boxes');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/ship-loadout.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// ssd-pipeline/viewer/ship-loadout.js
// Turn a ship's verified SSD data into a firing loadout: individual weapon mounts + shield strengths.
export function weaponClassOf(group) {
  const t = (group.type || '').toLowerCase(), fam = group.family || '';
  if (fam === 'phaser') {
    if (/\b3\b|phaser-3|ph-3/.test(t)) return 'PH-3';
    if (/\b2/.test(t) || /2k/.test(t)) return 'PH-2';
    return 'PH-1';
  }
  if (fam === 'heavy-weapon') {
    if (t.includes('disr')) return 'DISR';
    if (t.includes('photon')) return 'PHOTON';
  }
  return null;    // seeking weapons (drone/plasma), non-weapons → excluded from direct fire
}

// shield-group facing: read a trailing digit in the type, e.g. "Shield 1" → 1 (fallback: sequential)
function shieldFacing(group, seq) {
  const m = (group.type || '').match(/([1-6])\b/);
  return m ? Number(m[1]) : seq;
}

export function shipLoadout(verified, detection) {
  const mounts = [], shields = [0, 0, 0, 0, 0, 0];
  let shieldSeq = 0;
  for (const g of verified.groups || []) {
    if (g.family === 'shield') {
      const n = shieldFacing(g, ++shieldSeq);
      if (n >= 1 && n <= 6) shields[n - 1] = (g.boxIds || []).length;
      continue;
    }
    const cls = weaponClassOf(g);
    if (!cls) continue;
    (g.boxIds || []).forEach((_, i) => mounts.push({ id: `${g.id}.${i}`, cls, arc: g.arcDef || { arcs: [g.arc] } }));
  }
  return { mounts, shields };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/ship-loadout.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ssd-pipeline/viewer/ship-loadout.js ssd-pipeline/test/ship-loadout.test.mjs
git commit -m "feat(battle): ship-loadout adapter (verified groups -> mounts + shields)"
```

---

### Task 4: Weapon catalog + charts (weapon-charts.js)

> **IP:** Do NOT type chart numbers from memory. Copy the `disruptor.std` and `photon.std` chart rows **verbatim from the already-committed `docs/spec/C4-direct-fire-combat.md`** (Domain Model → "Sample catalog rows"). Transcribe the `PH-1`/`PH-2`/`PH-3` die-vs-range grids from your SSD pages (the "TYPE I/II/III PHASER TABLE" printed on each SSD), exactly as `ssd-pipeline/viewer/dac.js` transcribes the DAC from the SSD book. The structure and lookup below are yours to write now; the numbers are filled from those owner sources.

**Files:**
- Create: `ssd-pipeline/viewer/weapon-charts.js`
- Test: `ssd-pipeline/test/weapon-charts.test.mjs`

**Interfaces:**
- Produces: `WEAPONS` — `Record<cls, WeaponDef>` where `WeaponDef = { cls, resolution:'range-of-effect'|'hit-or-miss', maxRange, minRange?, bands:[{minTrue,maxTrue}], effectGrid?:number[][], hitBand1d?:([lo,hi]|null)[], fixedDamage?:number[] }`; `bandIndex(def, trueRange) → number|-1`; `damageFor(def, trueRange, die) → number` (0 if out of range, a miss, or below minRange).

- [ ] **Step 1: Write the failing test**

```js
// ssd-pipeline/test/weapon-charts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, bandIndex, damageFor } from '../viewer/weapon-charts.js';

test('all five direct-fire weapons are defined with a resolution model', () => {
  for (const cls of ['PH-1','PH-2','PH-3','DISR','PHOTON']) {
    assert.ok(WEAPONS[cls], `${cls} defined`);
    assert.ok(['range-of-effect','hit-or-miss'].includes(WEAPONS[cls].resolution));
  }
});

test('damageFor returns 0 beyond max range and (for photon) below min range', () => {
  const photon = WEAPONS.PHOTON;
  assert.equal(damageFor(photon, photon.maxRange + 1, 1), 0, 'out of range');
  assert.equal(damageFor(photon, 1, 1), 0, 'inside photon min range is 0');
});

test('hit-or-miss: a hitting die yields the band warhead; a missing die yields 0', () => {
  const disr = WEAPONS.DISR;                     // resolution: hit-or-miss
  const bi = disr.bands.findIndex(b => b.minTrue <= 4 && 4 <= b.maxTrue);
  const [lo, hi] = disr.hitBand1d[bi];           // hit band for range 4 (from C4 spec)
  assert.equal(damageFor(disr, 4, lo), disr.fixedDamage[bi], 'die in band ⇒ warhead');
  if (hi < 6) assert.equal(damageFor(disr, 4, hi + 1), 0, 'die above band ⇒ miss');
});

test('range-of-effect: phaser reads its die×range cell', () => {
  const ph1 = WEAPONS['PH-1'];                   // resolution: range-of-effect
  const bi = bandIndex(ph1, 1);
  assert.equal(damageFor(ph1, 1, 1), ph1.effectGrid[0][bi], 'die 1 at range 1 reads the grid');
  assert.ok(damageFor(ph1, 1, 1) > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/weapon-charts.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation** (structure now; fill numbers from the owner sources named above)

```js
// ssd-pipeline/viewer/weapon-charts.js
// Direct-fire weapon catalog for the four standard races (v0, standard loads).
// NUMBERS: disruptor/photon copied from docs/spec/C4-direct-fire-combat.md; phaser grids
// transcribed from the SSDs (like dac.js). Structure mirrors C4's WeaponChart.
export const WEAPONS = {
  'PH-1': { cls:'PH-1', resolution:'range-of-effect', maxRange: /*from SSD*/ 25,
            bands: [/* {minTrue,maxTrue} per phaser table column, from the SSD */],
            effectGrid: [/* effectGrid[die-1][bandIdx] = points, from the SSD */] },
  'PH-2': { cls:'PH-2', resolution:'range-of-effect', maxRange: /*SSD*/ 15, bands: [], effectGrid: [] },
  'PH-3': { cls:'PH-3', resolution:'range-of-effect', maxRange: /*SSD*/ 8,  bands: [], effectGrid: [] },
  'DISR': { cls:'DISR', resolution:'hit-or-miss', maxRange: /*C4*/ 30,
            bands: [/* from C4 disruptor.std */], hitBand1d: [/* C4 */], fixedDamage: [/* C4 */] },
  'PHOTON': { cls:'PHOTON', resolution:'hit-or-miss', maxRange: /*C4*/ 30, minRange: 2,
            bands: [/* from C4 photon.std */], hitBand1d: [/* C4 */], fixedDamage: [/* C4 */] },
};

export function bandIndex(def, trueRange) {
  return def.bands.findIndex(b => trueRange >= b.minTrue && trueRange <= b.maxTrue);
}

export function damageFor(def, trueRange, die) {
  if (def.minRange && trueRange < def.minRange) return 0;
  if (trueRange > def.maxRange) return 0;
  const bi = bandIndex(def, trueRange);
  if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') return def.effectGrid[die - 1]?.[bi] ?? 0;
  const band = def.hitBand1d[bi];                 // hit-or-miss
  if (!band) return 0;
  const [lo, hi] = band;
  return (die >= lo && die <= hi) ? def.fixedDamage[bi] : 0;
}
```

> After filling the numbers from the owner sources, ensure `bands`/`effectGrid`/`hitBand1d`/`fixedDamage` array lengths line up per weapon (one entry per band; `effectGrid` has 6 rows for die 1..6).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/weapon-charts.test.mjs`
Expected: PASS (4 tests). If a test fails because a band/warhead is empty, the numbers were not sourced correctly — re-copy from C4 / the SSD.

- [ ] **Step 5: Commit**

```bash
git add ssd-pipeline/viewer/weapon-charts.js ssd-pipeline/test/weapon-charts.test.mjs
git commit -m "feat(battle): direct-fire weapon catalog + chart lookup (4 races, standard loads)"
```

---

### Task 5: Fire-group / attack-plan state (fire-plan.js)

**Files:**
- Create: `ssd-pipeline/viewer/fire-plan.js`
- Test: `ssd-pipeline/test/fire-plan.test.mjs`

**Interfaces:**
- Consumes: `isInArc`,`exposedShield`,`hexDistance` (battle-geom); `WEAPONS`,`bandIndex` (weapon-charts).
- Produces:
  - `newPlan() → { groups: [], committed:false }`
  - `newGroup(id, color) → { id, color, targetShipId:null, members:[] }`
  - `mountEligibility(firer, mount, target) → { mountId, inArc, coveringArc?, trueRange, inRange, available, struckShield? }`
  - `planEligibility(plan, ships) → Map<mountId, {assignedGroupId}>` (which group each mount is in)
  - `assignMount(plan, groupId, shipId, mountId) → { conflict?: {fromGroupId} }` (mutates plan; if the mount is in another group, returns conflict and does NOT move until `force`)
  - `assignMount(plan, groupId, shipId, mountId, {force:true})` — steals it (removes from the other group first)
  - `unassignMount(plan, groupId, shipId, mountId)`
  - `combinedPreview(group, ships, shipMounts) → { targetShipId, perShield:[{shield, nominal, firers:[shipId]}], totalNominal }`
  - `expandPlanToIntents(plan) → [{firerShipId, weaponInstanceId, targetRef:{kind:'unit',unitId}, segment:'6D-direct'}]`

- [ ] **Step 1: Write the failing test**

```js
// ssd-pipeline/test/fire-plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { newPlan, newGroup, assignMount, expandPlanToIntents, mountEligibility } from '../viewer/fire-plan.js';

const ship = (id, q, r, facing) => ({ id, q, r, facing });
const mount = (id, ...arcs) => ({ id, cls:'PH-1', arc:{ arcs } });

test('mountEligibility flags in-arc + in-range with a struck shield', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 3, 0, 0);
  const e = mountEligibility(firer, mount('F1.PH-1.0','FH'), target);
  assert.equal(e.inArc, true);
  assert.equal(e.inRange, true);
  assert.equal(e.available, true);
  assert.equal(e.struckShield, 1);
});

test('a mount belongs to one group; a ship can span groups; steal needs force', () => {
  const plan = newPlan();
  const A = newGroup('A','#2563eb'); A.targetShipId = 'E1'; plan.groups.push(A);
  const B = newGroup('B','#16a34a'); B.targetShipId = 'E2'; plan.groups.push(B);
  assert.deepEqual(assignMount(plan, 'A', 'F1', 'F1.PH-1.0'), {}, 'assign to A');
  assert.deepEqual(assignMount(plan, 'B', 'F1', 'F1.PH-1.1'), {}, 'same ship, other mount, group B (split-fire)');
  const c = assignMount(plan, 'B', 'F1', 'F1.PH-1.0');           // already in A
  assert.deepEqual(c, { conflict: { fromGroupId: 'A' } }, 'steal blocked without force');
  assignMount(plan, 'B', 'F1', 'F1.PH-1.0', { force: true });    // steal
  const inA = A.members.find(m => m.shipId==='F1')?.mountIds || [];
  assert.ok(!inA.includes('F1.PH-1.0'), 'removed from A after forced steal');
});

test('expandPlanToIntents emits one C4 intent per committed mount', () => {
  const plan = newPlan();
  const A = newGroup('A','#2563eb'); A.targetShipId='E1'; plan.groups.push(A);
  assignMount(plan, 'A', 'F1', 'F1.PH-1.0');
  const intents = expandPlanToIntents(plan);
  assert.deepEqual(intents, [{ firerShipId:'F1', weaponInstanceId:'F1.PH-1.0',
    targetRef:{ kind:'unit', unitId:'E1' }, segment:'6D-direct' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/fire-plan.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// ssd-pipeline/viewer/fire-plan.js
import { isInArc, exposedShield, hexDistance } from './battle-geom.js';
import { WEAPONS, bandIndex } from './weapon-charts.js';

export const newPlan = () => ({ groups: [], committed: false });
export const newGroup = (id, color) => ({ id, color, targetShipId: null, members: [] });

export function mountEligibility(firer, mount, target) {
  const { inArc, covering } = isInArc(firer, mount, target);
  const trueRange = hexDistance(firer, target);
  const def = WEAPONS[mount.cls];
  const inRange = !!def && trueRange <= def.maxRange && !(def.minRange && trueRange < def.minRange)
                  && bandIndex(def, trueRange) >= 0;
  const available = inArc && inRange;
  return { mountId: mount.id, inArc, coveringArc: covering, trueRange, inRange, available,
           struckShield: available ? exposedShield(firer, target) : undefined };
}

const member = (group, shipId) => group.members.find(m => m.shipId === shipId);
function removeMount(plan, mountId) {
  for (const g of plan.groups) for (const m of g.members) {
    const i = m.mountIds.indexOf(mountId); if (i >= 0) return { g, m, i };
  }
  return null;
}

export function assignMount(plan, groupId, shipId, mountId, opts = {}) {
  const found = removeMount(plan, mountId);
  if (found && found.g.id !== groupId && !opts.force) return { conflict: { fromGroupId: found.g.id } };
  if (found) { found.m.mountIds.splice(found.i, 1); if (!found.m.mountIds.length)
    found.g.members = found.g.members.filter(x => x !== found.m); }
  const g = plan.groups.find(x => x.id === groupId); if (!g) return {};
  const mm = member(g, shipId) || (g.members.push({ shipId, mountIds: [] }), member(g, shipId));
  if (!mm.mountIds.includes(mountId)) mm.mountIds.push(mountId);
  return {};
}

export function unassignMount(plan, groupId, shipId, mountId) {
  const g = plan.groups.find(x => x.id === groupId); const mm = g && member(g, shipId);
  if (mm) { mm.mountIds = mm.mountIds.filter(id => id !== mountId);
    if (!mm.mountIds.length) g.members = g.members.filter(x => x !== mm); }
}

export function planEligibility(plan) {
  const map = new Map();
  for (const g of plan.groups) for (const m of g.members) for (const id of m.mountIds)
    map.set(id, { assignedGroupId: g.id });
  return map;
}

// nominal (pre-roll) damage = the max grid/warhead value for the band, for the preview only
function nominal(cls, trueRange) {
  const def = WEAPONS[cls]; if (!def) return 0; const bi = bandIndex(def, trueRange); if (bi < 0) return 0;
  if (def.resolution === 'range-of-effect') return Math.max(...def.effectGrid.map(row => row[bi] || 0));
  return def.fixedDamage[bi] || 0;
}

export function combinedPreview(group, ships, shipMounts) {
  const target = ships.find(s => s.id === group.targetShipId); if (!target) return null;
  const perShield = {};
  for (const m of group.members) {
    const firer = ships.find(s => s.id === m.shipId); if (!firer) continue;
    const shield = exposedShield(firer, target); const range = hexDistance(firer, target);
    for (const id of m.mountIds) {
      const mount = (shipMounts[m.shipId] || []).find(x => x.id === id); if (!mount) continue;
      const slot = perShield[shield] || (perShield[shield] = { shield, nominal: 0, firers: new Set() });
      slot.nominal += nominal(mount.cls, range); slot.firers.add(m.shipId);
    }
  }
  const rows = Object.values(perShield).map(s => ({ shield: s.shield, nominal: s.nominal, firers: [...s.firers] }));
  return { targetShipId: group.targetShipId, perShield: rows, totalNominal: rows.reduce((a, r) => a + r.nominal, 0) };
}

export function expandPlanToIntents(plan) {
  const out = [];
  for (const g of plan.groups) for (const m of g.members) for (const id of m.mountIds)
    out.push({ firerShipId: m.shipId, weaponInstanceId: id,
      targetRef: { kind: 'unit', unitId: g.targetShipId }, segment: '6D-direct' });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/fire-plan.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ssd-pipeline/viewer/fire-plan.js ssd-pipeline/test/fire-plan.test.mjs
git commit -m "feat(battle): fire-group/attack-plan state, per-mount eligibility, steal, preview, C4 mapping"
```

---

### Task 6: Resolution + DAC hand-off (direct-fire.js)

**Files:**
- Create: `ssd-pipeline/viewer/direct-fire.js`
- Test: `ssd-pipeline/test/direct-fire.test.mjs`

**Interfaces:**
- Consumes: `exposedShield`,`hexDistance` (battle-geom); `WEAPONS`,`damageFor` (weapon-charts); `applyVolley`,`makeDice` (dac-allocator).
- Produces:
  - `resolveMount(firer, mount, target, dieFn) → { hit, points, struckShield }` (`dieFn()` returns 1..6)
  - `resolveAttackPlan(plan, ships, shipMounts, models, rand=Math.random) → { volleys:[{targetShipId, shield, points, firers, effects}], log:[...] }` where `models[shipId]` is the ship's `buildShipModel` result; each volley calls `applyVolley(models[target], {shield, points}, dice2d6)` and captures its effects.

- [ ] **Step 1: Write the failing test**

```js
// ssd-pipeline/test/direct-fire.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMount, resolveAttackPlan } from '../viewer/direct-fire.js';

const ship = (id, q, r, facing) => ({ id, q, r, facing });

test('resolveMount reports the struck shield and non-negative points', () => {
  const firer = ship('F1', 0, 0, 0), target = ship('E1', 2, 0, 0);
  const mount = { id:'F1.PH-1.0', cls:'PH-1', arc:{ arcs:['FH'] } };
  const r = resolveMount(firer, mount, target, () => 1);      // fixed die = 1
  assert.equal(r.struckShield, 1);
  assert.ok(r.points >= 0);
});

test('resolveAttackPlan stacks two firers on one shield into a single volley', () => {
  // Two friendly ships east of the target both strike shield #1; damage combines (D4.34).
  const ships = [ ship('F1', 0, 0, 0), ship('F2', 0, 2, 0), ship('E1', 4, 1, 3) ];
  const shipMounts = {
    F1: [{ id:'F1.DISR.0', cls:'DISR', arc:{ arcs:['FH'] } }],
    F2: [{ id:'F2.DISR.0', cls:'DISR', arc:{ arcs:['FH'] } }],
  };
  const plan = { groups: [{ id:'A', color:'#2563eb', targetShipId:'E1',
    members: [ { shipId:'F1', mountIds:['F1.DISR.0'] }, { shipId:'F2', mountIds:['F2.DISR.0'] } ] }] };
  // minimal fake model with a big shield #? and pools so applyVolley runs without throwing
  const mkModel = () => ({ shields: { 1:{boxIds:new Array(30).fill('s'),down:0,max:30},
    2:{boxIds:[],down:0,max:0},3:{boxIds:[],down:0,max:0},4:{boxIds:[],down:0,max:0},
    5:{boxIds:[],down:0,max:0},6:{boxIds:[],down:0,max:0} },
    armor:{boxIds:[],destroyed:new Set()}, pools:{}, neverTargets:new Set(), groupOf:{}, boxById:{} });
  const models = { E1: mkModel() };
  const res = resolveAttackPlan(plan, ships, shipMounts, models, () => 0.0);  // seeded rand
  const v1 = res.volleys.filter(v => v.targetShipId==='E1' && v.shield === (res.volleys[0].shield));
  assert.equal(res.volleys.length, 1, 'both firers strike one shield ⇒ one combined volley');
  assert.deepEqual(res.volleys[0].firers.sort(), ['F1','F2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ssd-pipeline/test/direct-fire.test.mjs`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// ssd-pipeline/viewer/direct-fire.js
import { exposedShield, hexDistance } from './battle-geom.js';
import { WEAPONS, damageFor } from './weapon-charts.js';
import { applyVolley, makeDice } from './dac-allocator.js';

export function resolveMount(firer, mount, target, dieFn) {
  const def = WEAPONS[mount.cls];
  const trueRange = hexDistance(firer, target);
  const struckShield = exposedShield(firer, target);
  const die = dieFn();
  const points = def ? damageFor(def, trueRange, die) : 0;
  return { hit: points > 0, points, struckShield, die };
}

export function resolveAttackPlan(plan, ships, shipMounts, models, rand = Math.random) {
  const byId = Object.fromEntries(ships.map(s => [s.id, s]));
  const d6 = () => 1 + Math.floor(rand() * 6);
  const dice2d6 = makeDice(rand);
  const buckets = new Map();      // key `${target}|${shield}` → { targetShipId, shield, points, firers:Set }
  const log = [];

  for (const g of plan.groups) {
    const target = byId[g.targetShipId]; if (!target) continue;
    for (const m of g.members) {
      const firer = byId[m.shipId]; if (!firer) continue;
      for (const id of m.mountIds) {
        const mount = (shipMounts[m.shipId] || []).find(x => x.id === id); if (!mount) continue;
        const r = resolveMount(firer, mount, target, d6);
        log.push({ kind:'shot', firer: m.shipId, mount: id, cls: mount.cls, ...r, target: g.targetShipId });
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
    const effects = model ? applyVolley(model, { shield: b.shield, points: b.points }, dice2d6) : [];
    volleys.push({ targetShipId: b.targetShipId, shield: b.shield, points: b.points, firers: [...b.firers], effects });
    log.push({ kind:'volley', target: b.targetShipId, shield: b.shield, points: b.points, effects });
  }
  return { volleys, log };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ssd-pipeline/test/direct-fire.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite + commit**

```bash
node --test ssd-pipeline/test/*.test.mjs   # all prior + new tests green
git add ssd-pipeline/viewer/direct-fire.js ssd-pipeline/test/direct-fire.test.mjs
git commit -m "feat(battle): direct-fire resolution -> combined volleys -> DAC damage"
```

---

### Task 7: Scenario + battle.html map with drag/rotate

**Files:**
- Create: `ssd-pipeline/viewer/scenario.js`
- Create: `ssd-pipeline/viewer/battle.html`
- Verify: Playwright (no unit test — DOM)

**Interfaces:**
- Consumes: everything above; `buildShipModel` (`ship-model.js`); the loadout API; `GEOM`,`hexCenter`,`headingDeg` (battle-geom).
- Produces: a working map where both fleets render and any ship can be dragged to a new hex and rotated.

- [ ] **Step 1: Create the scenario**

```js
// ssd-pipeline/viewer/scenario.js — fixed 2-v-2 starting positions (drag/rotate editable at runtime)
export const SCENARIO = [
  { id:'F1', code:'FED-CA', name:'Federation CA', side:'friendly', q:2, r:6, facing:0 },
  { id:'F2', code:'GOR-DD', name:'Gorn DD',       side:'friendly', q:2, r:9, facing:0 },
  { id:'E1', code:'KLI-D7', name:'Klingon D7',    side:'enemy',    q:12, r:6, facing:3 },
  { id:'E2', code:'KZI-FF', name:'Kzinti FF',     side:'enemy',    q:12, r:9, facing:3 },
];
```

- [ ] **Step 2: Create battle.html** — start from `docs/spec/wireframes/battle-screen.html` as the scaffold (copy its `<style>` + hex-map SVG shell), then replace its hardcoded `ships` array with data loaded from the scenario + verified SSD files. Load each ship:

```js
// in battle.html <script type="module">
import { GEOM, hexCenter, headingDeg, hexDistance } from './battle-geom.js';
import { shipLoadout } from './ship-loadout.js';
import { buildShipModel } from './ship-model.js';
import { SCENARIO } from './scenario.js';

const ships = [];
async function loadFleet() {
  for (const s of SCENARIO) {
    const det = await (await fetch(`../data/${s.code}/detection.json`)).json();
    const ver = await (await fetch(`../data/${s.code}/verified.json`)).json();
    const { mounts, shields } = shipLoadout(ver, det);
    ships.push({ ...s, mounts, shields, _ver: ver, _det: det, status: {} });
  }
  render();
}
```

- [ ] **Step 3: Render ships + facing pip.** Draw each ship as a token at `hexCenter(q,r)` with a nose pip at angle `headingDeg(facing)`; friendly vs enemy colored. Add the existing hex grid from the mockup.

- [ ] **Step 4: Drag to move.** On ship `mousedown` → `dragging = ship`; on map `mousemove` translate the token; on `mouseup` snap to the nearest hex (`nearestHex(px,py)` inverts `hexCenter`) and set `ship.q/ship.r`, then `render()` and recompute any live eligibility.

```js
function nearestHex(px, py) {
  let best = null, bd = Infinity;
  for (let q = 0; q < COLS; q++) for (let r = 0; r < ROWS; r++) {
    const c = hexCenter(q, r), d = Math.hypot(c.x - px, c.y - py);
    if (d < bd) { bd = d; best = { q, r }; }
  }
  return best;
}
```

- [ ] **Step 5: Rotate facing.** Add a rotate affordance: clicking a small ⟳ handle on the selected ship (or pressing `[` / `]`) does `ship.facing = (ship.facing + 5) % 6` / `(ship.facing + 1) % 6`, then `render()`. Label the current facing on the token.

- [ ] **Step 6: Verify with Playwright**

Run the server if not running: `python3 ssd-pipeline/serve.py &`
Then:
```
Navigate to http://127.0.0.1:8741/viewer/battle.html
- assert 4 ship tokens render (2 friendly, 2 enemy)
- drag F1 to a new hex; assert its q/r changed and it re-rendered at the new center
- rotate E1 with the handle/key; assert its facing pip angle changed
- screenshot for a visual check (no overlaps, tokens on hex centers)
```

- [ ] **Step 7: Commit**

```bash
git add ssd-pipeline/viewer/scenario.js ssd-pipeline/viewer/battle.html
git commit -m "feat(battle): battle.html map + fleets loaded from verified data + drag/rotate"
```

---

### Task 8: Fire groups + per-mount weapon panel

**Files:**
- Modify: `ssd-pipeline/viewer/battle.html`
- Verify: Playwright

**Interfaces:**
- Consumes: `newPlan`,`newGroup`,`assignMount`,`unassignMount`,`planEligibility`,`mountEligibility`,`combinedPreview` (fire-plan); `isInArc`,`exposedShield` (battle-geom).

- [ ] **Step 1: Group + target selection.** Hold a `plan = newPlan()` and a `working` group. Clicking a friendly ship adds/removes it from `working` (create the group on first pick with a rotating color). Clicking an enemy sets `working.targetShipId`. On target set, for every member ship compute `mountEligibility` per mount and **auto-assign** (via `assignMount`) the `available` mounts that are not already in `planEligibility(plan)`.

- [ ] **Step 2: Map overlays for the active ship.** For the working group's active ship, shade each selected mount's arc wedge (reuse the mockup's wedge drawing, keyed to `headingDeg(facing)` + the arc), draw a line of fire to the target, and highlight the target's `exposedShield` facing with its strength. Color each committed fire group distinctly.

- [ ] **Step 3: Per-mount panel with ◀/▶ paging.** Right panel shows the active ship of the working group. Render one row per mount: `cls` · arc · `trueRange` · an eligibility pill (`in-arc`/`out-of-arc`/`out-of-range` from `mountEligibility`) · a `→ Group X` tag if `planEligibility` shows it assigned elsewhere · a checkbox. `◀/▶` page `activeShipIndex` across the group's members. Toggling:

```js
function toggleMount(shipId, mountId) {
  const res = assignMount(plan, working.id, shipId, mountId);
  if (res.conflict) {
    if (confirm(`That mount is committed to group ${res.conflict.fromGroupId}. Move it here?`))
      assignMount(plan, working.id, shipId, mountId, { force: true });
    else return;
  }
  render();
}
```
Unchecking a mount already in `working` calls `unassignMount`. Disable rows whose `mountEligibility.available` is false (never selectable).

- [ ] **Step 4: Attack-plan tray.** Bottom tray lists each fire group with its target and, from `combinedPreview(group, ships, shipMountsMap)`, a per-struck-shield row: `nominal` total, contributing ships, vs the facing strength — labelled **"nominal (pre-roll)"**. A **＋ New fire group** button starts a fresh working group. A **Commit attack plan** button sets `plan.committed = true` and freezes the tray (guarded: ≥1 group with a target and ≥1 mount).

- [ ] **Step 5: Verify with Playwright**

```
Navigate to battle.html
- click F1 then E1: assert F1's in-arc weapons auto-check and the target's exposed shield highlights
- page ◀/▶ if the group has >1 ship; assert the panel swaps ships
- create a 2nd group F1→E2 reusing an already-committed F1 mount: assert the confirm dialog appears
  (accept) and the mount moves group (its `→ Group` tag updates)
- assert the tray shows a per-shield nominal preview and Commit enables only with a mount selected
- screenshot
```

- [ ] **Step 6: Commit**

```bash
git add ssd-pipeline/viewer/battle.html
git commit -m "feat(battle): per-mount fire groups, target-driven auto-select, cross-group steal, preview"
```

---

### Task 9: Resolve + damage view + combat log

**Files:**
- Modify: `ssd-pipeline/viewer/battle.html`
- Verify: Playwright

**Interfaces:**
- Consumes: `resolveAttackPlan` (direct-fire); `buildShipModel` (already loaded per ship at Task 7).

- [ ] **Step 1: Build models + resolve.** On **Resolve** (enabled after Commit): build `models = { [shipId]: buildShipModel(ship._ver, ship._det) }` for every enemy target, call `resolveAttackPlan(plan, ships, shipMountsMap, models)`, and fold each target model's destroyed boxes/shield-down into `ship.status` (map every `effect.boxId` → `'destroyed'`, and record shield-down counts).

- [ ] **Step 2: Combat log.** Render `res.log` chronologically: each `shot` line (`F1 PH-1 → E1: die d, N pts, shield #s` or "miss"), each `volley` line (`E1 shield #s: P pts → destroyed: <systems>`), reusing the family labels from `dac-allocator` effects. Put it in the bottom feed panel from the mockup.

- [ ] **Step 3: Damage readback on the map + SSD.** After resolve, mark damaged enemies on the map (e.g., a red ring + "shields #s down"). Clicking a damaged enemy opens its SSD with damage applied — reuse the existing damage render: instantiate the same overlay `damage.html` uses (import the shared render path or open `damage.html?ship=<code>` in a side frame) so destroyed boxes show greyed with the red ✕. Simplest: a "view SSD" link per target that opens `damage.html?ship=<code>` in a new tab; note in the log that live per-target damage state is in-memory only (not persisted).

- [ ] **Step 4: Reset.** A **Reset battle** button restores original shields/status (re-run `loadFleet` or restore snapshots) and clears the plan, so different angles can be re-tested.

- [ ] **Step 5: Verify with Playwright**

```
Navigate to battle.html
- build a plan F1→E1 with in-arc weapons, Commit, Resolve
- assert the combat log lists per-mount shots and at least one volley line
- assert E1 shows damage (shield-down marker); if any internal destroyed, a system name appears in the log
- Reset: assert shields/status return to full and the plan clears
- screenshot the resolved state
```

- [ ] **Step 6: Run full suite + commit**

```bash
node --test ssd-pipeline/test/*.test.mjs      # all engine tests green
git add ssd-pipeline/viewer/battle.html
git commit -m "feat(battle): resolve fire through the DAC engine + combat log + damage readback"
```

---

### Task 10: Link the sandbox into the app + README

**Files:**
- Modify: `ssd-pipeline/viewer/index.html` (add a Battle card + nav)
- Modify: `ssd-pipeline/viewer/verify.html`, `ssd-pipeline/viewer/damage.html` (nav dropdown → add "⚔ Battle sandbox")
- Modify: `README.md` (status + layout row)

- [ ] **Step 1** Add a third card to `index.html` linking to `battle.html`, and add a "⚔️ Battle sandbox" entry to the `#navMenu` dropdown in `verify.html` and `damage.html` (href `battle.html`).
- [ ] **Step 2** Add a `README.md` status bullet ("Direct-fire combat sandbox — reposition fleets, form per-mount fire groups, resolve through the DAC engine") and a repository-layout row for `battle.html` + the new engine modules.
- [ ] **Step 3: Verify** Playwright: from `index.html`, the Battle card opens `battle.html`; the nav dropdown on `damage.html` links to it.
- [ ] **Step 4: Commit**

```bash
git add ssd-pipeline/viewer/index.html ssd-pipeline/viewer/verify.html ssd-pipeline/viewer/damage.html README.md
git commit -m "feat(battle): link the direct-fire sandbox into the home page + nav + README"
```

---

## Self-Review

**Spec coverage:** reposition (T7) · four races' direct-fire weapons + charts (T4) · damage via existing DAC (T6/T9) · per-mount selection (T3/T8) · split-fire + cross-group marking + confirm-steal (T5/T8) · combined-damage preview D4.34 (T5/T8) · resolution (T6/T9) · C4 mapping `expandPlanToIntents` (T5) · exposed shield / arcs reuse arc-geom (T2) · nominal-vs-rolled labelling (T8) · out-of-scope items untouched (no server/movement/energy). Covered.

**Placeholder scan:** the only intentional blanks are the weapon-chart NUMBERS in `weapon-charts.js` (Task 4), which are deliberately owner-sourced (IP) with exact provenance named — not a code placeholder. All other steps carry runnable code.

**Type consistency:** `mount = {id, cls, arc:{arcs:[]}}`, `ship = {id, q, r, facing, mounts, shields, status}`, `plan = {groups:[{id,color,targetShipId,members:[{shipId,mountIds}]}], committed}`, `WEAPONS[cls] = {resolution, maxRange, minRange?, bands, effectGrid?|hitBand1d?+fixedDamage?}` are used identically across Tasks 3–9. `applyVolley(model,{shield,points},rollFn)` and `makeDice(rand)` match the existing `dac-allocator.js`. `buildShipModel(verified, detection)` matches `ship-model.js`.
