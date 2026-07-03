# Damage Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player-facing SSD damage view that applies a struck-shield volley through the full Star Fleet Battles Damage Allocation process (shields + leaky → armor → internal DAC) and shows the resulting box states.

**Architecture:** Pure, node-testable JavaScript logic modules (DAC table, ship model, allocator, arc geometry) with no DOM dependency, plus a shared render engine factored out of `verify.html`, composed by a new `damage.html`. Logic is validated by unit tests anchored on the rulebook's own D4.5 worked example.

**Tech Stack:** Plain ES modules (UMD-style: work in both `node` and `<script>`), node's built-in `node:test` + `node:assert` (no npm deps), existing Python static server, Playwright for browser E2E.

## Global Constraints

- **No new runtime dependencies.** Logic modules use only language built-ins; tests use `node:test`/`node:assert` only. The server stays the existing `ssd-pipeline/serve.py`.
- **UMD pattern** for every logic module: end with `if (typeof module !== 'undefined') module.exports = {...}; if (typeof window !== 'undefined') window.SFB = Object.assign(window.SFB||{}, {...});` so the same file loads under node (tests) and the browser (`damage.html`).
- **Allocator is pure:** `applyVolley(...)` takes an injectable RNG and returns a list of effects; it never touches the DOM, never mutates its inputs in place beyond the model it's given, and is fully deterministic given a seeded RNG.
- **Rules fidelity target:** full DAC per `docs/superpowers/specs/2026-07-03-damage-processor-design.md` (§7). That spec is the source of truth; cite its rule numbers, do not re-derive.
- **Never-targets (D4.324):** crew, boarding-party, ammo-track, cloaking-device, markers are never destroyed by the allocator.
- **verify.html must stay byte-for-byte behaviorally unchanged** after the engine extraction (Task 6) — proven by Playwright before Task 7 builds on it.
- **Commit after every task** with a `feat:`/`test:`/`refactor:` message.

## File Structure

| File | Responsibility |
|------|----------------|
| `ssd-pipeline/viewer/dac.js` (new) | The DAC lookup table (die roll 2–12 → ordered columns, bold flags) + system-token constants + token→family map. Data only. |
| `ssd-pipeline/viewer/arc-geom.js` (new) | `shieldBearing(n)` and `arcBearsToShield(arcDef, shieldNum)` — named-arc → does it bear toward a shield (for D4.321). Ported from verify.html `hexInNamed`. |
| `ssd-pipeline/viewer/ship-model.js` (new) | `buildShipModel(verified, detection)` → `{shields[1..6], armor, pools{token→boxIds}, tracks, neverTargets}`. Pure. |
| `ssd-pipeline/viewer/dac-allocator.js` (new) | `applyVolley(model, params, rng)` → `effect[]`. The core algorithm (§7). Pure. |
| `ssd-pipeline/viewer/ssd-engine.js` (new) | Shared render: `TAX/FAMCOL/FAMNAME/CATS` + layout (`med,globalCell,layoutGroup,isWide,boxRect,inkFor`) + `renderSSD(svg, opts)`. Extracted from verify.html. |
| `ssd-pipeline/viewer/verify.html` (modify) | Import `ssd-engine.js` for base draw; keep editor-only overlays/handlers. |
| `ssd-pipeline/viewer/damage.html` (new) | Player view: engine draw + status map + Apply-damage panel + speed-paced effect playback. |
| `ssd-pipeline/test/dac.test.mjs` (new) | DAC-table structural tests (column-A reveals from D4.5). |
| `ssd-pipeline/test/ship-model.test.mjs` (new) | Ship-model tests against the FED-CA fixture. |
| `ssd-pipeline/test/arc-geom.test.mjs` (new) | Arc-bearing tests. |
| `ssd-pipeline/test/allocator.test.mjs` (new) | The D4.5 replay + leaky + tracks + excess + directional tests. |

Run all tests: `node --test ssd-pipeline/test/`.

---

### Task 1: DAC table + tokens (`dac.js`)

**Files:**
- Create: `ssd-pipeline/viewer/dac.js`
- Test: `ssd-pipeline/test/dac.test.mjs`

**Interfaces:**
- Produces: `DAC` — object keyed `"2".."12"`, each an ordered array of `{sys, bold?}` columns; `SYS` — the set of valid token strings; `TOKEN_FAMILY` — map from DAC token to the ship-model pool key / family. Tokens: `IMPULSE, L_WARP, R_WARP, C_WARP, APR, BATT, PHASER, TORP, DRONE, BRIDGE, FLAG, EMER, AUX, SEC, SENSOR, SCANNER, DAMCON, F_HULL, R_HULL, C_HULL, LAB, TRANS, TRAC, PROBE, SHUTTLE, EXCESS, CARGO, REPAIR, MINE, ANY_WEAPON`.

The DAC is transcribed from the chart graphic. Column A for each roll is **pinned** by the D4.5 example (p60 of the rulebook): `2→BRIDGE(bold)`, `3→DRONE`, `4→PHASER(bold)`, `5→R_WARP`, `6→F_HULL`, `7→CARGO`, `8→R_HULL`, `9→L_WARP(bold)`, `10→PHASER(bold)`, `11→TORP`, `12→AUX(bold)`. Later columns are transcribed from the chart and refined until Task 4's D4.5 replay passes (the example also reveals, e.g., roll-7 order `CARGO→F_HULL→BATT→C_WARP→SHUTTLE`, roll-9 `L_WARP→F_HULL→CARGO→BATT→LAB`, roll-6 `F_HULL→…→IMPULSE`).

- [ ] **Step 1: Write the failing test** (`dac.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAC, SYS, TOKEN_FAMILY } from '../viewer/dac.js';

const COL_A = {2:'BRIDGE',3:'DRONE',4:'PHASER',5:'R_WARP',6:'F_HULL',
               7:'CARGO',8:'R_HULL',9:'L_WARP',10:'PHASER',11:'TORP',12:'AUX'};

test('every roll 2-12 has a non-empty column list', () => {
  for (let r = 2; r <= 12; r++) assert.ok(DAC[r] && DAC[r].length, `roll ${r}`);
});
test('column A matches the D4.5 example reveals', () => {
  for (const [r, sys] of Object.entries(COL_A)) assert.equal(DAC[r][0].sys, sys, `roll ${r} col A`);
});
test('control results 2 and 12 are bold', () => {
  assert.ok(DAC[2][0].bold); assert.ok(DAC[12][0].bold);
});
test('all tokens are valid and mapped to a family', () => {
  for (const r of Object.values(DAC)) for (const c of r) {
    assert.ok(SYS.has(c.sys), `unknown token ${c.sys}`);
    assert.ok(c.sys === 'ANY_WEAPON' || TOKEN_FAMILY[c.sys], `unmapped ${c.sys}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ssd-pipeline/test/dac.test.mjs` → FAIL (cannot find module).
- [ ] **Step 3: Transcribe the chart into `dac.js`.** Render the DAC chart to PNG from the owner's PDF (hunt: rulebook charts section / Basic Set SSD book rules pages — the grid titled "DAMAGE ALLOCATION CHART"), read it visually, and encode `DAC`, `SYS`, `TOKEN_FAMILY` in the UMD pattern. Pin column A to `COL_A`. If the chart image can't be located, encode the standard Captain's-Edition DAC (published game data) and let Task 4's D4.5 replay be the acceptance gate.
- [ ] **Step 4: Run to verify it passes** — `node --test ssd-pipeline/test/dac.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add ssd-pipeline/viewer/dac.js ssd-pipeline/test/dac.test.mjs && git commit -m "feat(dac): transcribe Damage Allocation Chart into dac.js"`

---

### Task 2: Ship model (`ship-model.js`)

**Files:**
- Create: `ssd-pipeline/viewer/ship-model.js`
- Test: `ssd-pipeline/test/ship-model.test.mjs`

**Interfaces:**
- Consumes: a ship's `verified.json` (groups with `family`,`type`,`boxIds`,`arcDef`) + `detection.json` (boxes).
- Produces: `buildShipModel(verified, detection)` → `{ shields: {1..6:{max,down}}, armor:{boxIds,down}, pools: {TOKEN: {boxIds:[...ordered], destroyed:Set}}, neverTargets:Set<family>, groupOf:Map<boxId,group> }`. Warp split into `L_WARP/R_WARP/C_WARP` by group `type` ("Left/Right/Center Warp"); hull into `F_HULL/R_HULL/C_HULL` by type. `pools[TOKEN].boxIds` ordered top-to-bottom/left-to-right by box position (for track order, D4.33).

- [ ] **Step 1: Write the failing test** (`ship-model.test.mjs`) using the checked-in FED-CA fixture:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShipModel } from '../viewer/ship-model.js';

const load = n => JSON.parse(readFileSync(new URL(`../data/FED-CA/${n}.json`, import.meta.url)));
const m = buildShipModel(load('verified'), load('detection'));

test('six shields with positive strength', () => {
  for (let s = 1; s <= 6; s++) assert.ok(m.shields[s].max > 0, `shield ${s}`);
});
test('warp split into left and right pools', () => {
  assert.ok(m.pools.L_WARP.boxIds.length > 0);
  assert.ok(m.pools.R_WARP.boxIds.length > 0);
});
test('hull pools exist (F and R)', () => {
  assert.ok(m.pools.F_HULL.boxIds.length > 0);
  assert.ok(m.pools.R_HULL.boxIds.length > 0);
});
test('phaser and torp (photon) pools exist', () => {
  assert.ok(m.pools.PHASER.boxIds.length > 0);
  assert.ok(m.pools.TORP.boxIds.length > 0);
});
test('crew and boarding are never-targets, not pools', () => {
  assert.ok(m.neverTargets.has('crew'));
  assert.ok(m.neverTargets.has('boarding-party'));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test ssd-pipeline/test/ship-model.test.mjs` → FAIL.
- [ ] **Step 3: Implement `buildShipModel`.** Iterate groups; route each by `family` (and `type` for warp/hull side) into `shields`, `armor`, `pools[TOKEN]`, or `neverTargets` per the spec §5 table. Order each pool's `boxIds` by the box's `(y,x)` from `detection`. UMD export.
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(model): build ship damage model from verified.json`

---

### Task 3: Arc geometry (`arc-geom.js`)

**Files:**
- Create: `ssd-pipeline/viewer/arc-geom.js`
- Test: `ssd-pipeline/test/arc-geom.test.mjs`

**Interfaces:**
- Produces: `shieldBearing(n)` → degrees (1→0/front, 2→60, 3→120, 4→180, 5→240, 6→300); `arcBearsToShield(arcDef, shieldNum)` → bool (does a weapon group with this `arcDef` bear toward the given shield's direction). Ports `hexInNamed` semantics from `verify.html`.

- [ ] **Step 1: Write the failing test** (`arc-geom.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBearsToShield } from '../viewer/arc-geom.js';
const A = arcs => ({ arcs, paintAdd: [], paintRemove: [] });

test('FA (front) bears to shield 1, not shield 4', () => {
  assert.equal(arcBearsToShield(A(['FA']), 1), true);
  assert.equal(arcBearsToShield(A(['FA']), 4), false);
});
test('RH (rear hemisphere) bears to shield 4, not shield 1', () => {
  assert.equal(arcBearsToShield(A(['RH']), 4), true);
  assert.equal(arcBearsToShield(A(['RH']), 1), false);
});
test('360 (all six base arcs) bears to every shield', () => {
  const all = A(['RF','R','RR','LR','L','LF']);
  for (let s = 1; s <= 6; s++) assert.equal(arcBearsToShield(all, s), true);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.
- [ ] **Step 3: Implement.** Port `hexInNamed(name, bearing)` from verify.html into `arc-geom.js`; `arcBearsToShield` maps shield→bearing via `shieldBearing`, returns true if any named arc in `arcDef.arcs` (or a paintAdd hex in that sector) covers it. UMD export.
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(arc): shield-bearing arc coverage for phaser-directional hits`

---

### Task 4: Allocator (`dac-allocator.js`) — the core

**Files:**
- Create: `ssd-pipeline/viewer/dac-allocator.js`
- Test: `ssd-pipeline/test/allocator.test.mjs`

**Interfaces:**
- Consumes: `DAC/SYS/TOKEN_FAMILY` (Task 1), `buildShipModel` output (Task 2), `arcBearsToShield` (Task 3).
- Produces: `applyVolley(model, {shield, points, leaky, leakRate}, rng)` → ordered `effect[]` where each effect is one of `{type:'shield', shield, box}`, `{type:'armor', box}`, `{type:'destroy', token, family, boxId}`, `{type:'excess'}`, `{type:'shipDestroyed'}`. `rng()` returns a float in [0,1) — a 2d6 helper `roll2d6(rng)` lives here. The function mutates `model` (marking boxes destroyed / shields down) AND returns the effect stream for playback.

**Algorithm (implement per spec §7):** shield phase (+leaky D3.61–63) → armor (D4.12) → per internal point: `roll2d6` → walk `DAC[roll]` columns, first with a live target under the restriction checks (bold once-per-volley `boldUsed` keyed by `roll:colIndex`; phaser-directional via `arcBearsToShield`; every-3rd-best phaser/torp; special tracks keep last box; hull F/R/C and warp L/R/C designation; excess→cargo/repair/mine→shipDestroyed).

- [ ] **Step 1: Write the leaky-shields test** (`allocator.test.mjs`, D3.63)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShipModel } from '../viewer/ship-model.js';
import { applyVolley } from '../viewer/dac-allocator.js';
const load = (s,n) => JSON.parse(readFileSync(new URL(`../data/${s}/${n}.json`, import.meta.url)));
const seq = rolls => { let i = 0; return () => rolls[i++]; };        // deterministic 2d6 via injected rng-of-rolls

test('D3.63 leaky: 45 pts on a 30-box shield, rate 4 -> 15 internal points', () => {
  const m = buildShipModel(load('FED-CA','verified'), load('FED-CA','detection'));
  // force shield #1 to 30 boxes for the canonical example
  m.shields[1].max = 30; m.shields[1].down = 0;
  const fx = applyVolley(m, {shield:1, points:45, leaky:true, leakRate:4}, Math.random);
  const internal = fx.filter(e => e.type === 'destroy' || e.type === 'excess').length;
  assert.equal(internal, 15);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.
- [ ] **Step 3: Implement shield+leaky+armor+DAC-walk** in `dac-allocator.js` (spec §7.1–7.8). Support an injected 2d6 source for tests (accept `rng` that may be a roll-sequence for determinism).
- [ ] **Step 4: Run leaky test** — PASS.
- [ ] **Step 5: Write the D4.5 replay test** (the headline correctness gate)

```js
const D45_ROLLS = [6,7,9,2,7,4,10,7,8,11,7,6,3,8,5,7,8,4,5,10,12,7,9,7,2];
// expected system destroyed per hit, from the rulebook D4.5 worked example:
const D45_EXPECT = ['F_HULL','F_HULL','L_WARP','BRIDGE','F_HULL','PHASER','PHASER','F_HULL',
  'R_HULL','TORP','BATT','IMPULSE','DRONE','R_HULL','R_WARP','BATT','R_HULL','TRANS',
  'R_HULL','TRAC','AUX','BATT','LAB','SHUTTLE','FLAG'];

test('D4.5: the 25-hit D7 example reproduces the rulebook results', () => {
  const m = buildD7Model();                     // helper builds a D7 model with the example's systems
  const fx = [];
  let i = 0;
  const rng = seqDice(D45_ROLLS);               // returns the next scripted 2d6 total
  const out = applyVolley(m, {shield:1, points:25, leaky:false, __allInternal:true}, rng);
  const got = out.filter(e => e.type === 'destroy').map(e => e.token);
  assert.deepEqual(got, D45_EXPECT);
});
```

  (`buildD7Model` builds from `data/KLI-D7/verified.json`; `seqDice` yields the scripted totals so `roll2d6` returns them in order; `__allInternal` treats all 25 as internal points, matching the example which is post-shield.)

- [ ] **Step 6: Run D4.5 test; iterate `dac.js` columns + allocator until it PASSES.** This is where the DAC transcription is proven correct.
- [ ] **Step 7: Add remaining tests** — track last-box-never-destroyed (a 6-box sensor track can lose at most 5); excess→destruction (a model with no excess/cargo/repair/mine emits `shipDestroyed` on the overflow point); bold-once (two roll-2 hits in one volley → BRIDGE then FLAG). Implement any gaps; all PASS.
- [ ] **Step 8: Commit** — `feat(dac): full damage allocator (shields/leaky/armor/internal DAC) validated against D4.5`

---

### Task 5: Extract shared render engine (`ssd-engine.js`) + refactor verify.html

**Files:**
- Create: `ssd-pipeline/viewer/ssd-engine.js`
- Modify: `ssd-pipeline/viewer/verify.html`

**Interfaces:**
- Produces: `window.SFB.engine = { TAX, FAMCOL, FAMNAME, CATS, med, globalCell, layoutGroup, isWide, boxRect, inkFor, renderSSD(svg, {boxes, groupOf, gById, labelText, IMGW, IMGH, overlayOpacity, uniformCells, status?}) }`. `renderSSD` draws the base cells (family or `status` color), borders, dividers, and labels — exactly what verify.html's base pass does today; it does NOT draw selection/current-group/damage overlays (callers add those).

- [ ] **Step 1: Baseline snapshot test.** Add `ssd-pipeline/test/verify-snapshot.md` noting current FED-CA facts to preserve: 43 groups, shields uniform purple, 48 labels, 4 double-width drone dividers, arc editor works. (Manual acceptance list — the regression guard.)
- [ ] **Step 2: Create `ssd-engine.js`** by moving the taxonomy + layout helpers + the base render pass out of verify.html verbatim into `renderSSD`, in the UMD/global pattern.
- [ ] **Step 3: Refactor `verify.html`** to `<script src="ssd-engine.js">` and call `SFB.engine.renderSSD(...)` for the base pass, keeping its indicator pass (selection/current-group rings), dblclick, tooltips, and the arc editor untouched.
- [ ] **Step 4: Verify verify.html unchanged** — restart server; Playwright: load `verify.html?ship=FED-CA`, assert group count 43, `#ovl rect[data-id]` count matches pre-refactor, a shield group's boxes share one fill, labels render, and opening the arc editor still works. Compare against Step 1's list.
- [ ] **Step 5: Commit** — `refactor(viewer): extract ssd-engine.js shared render; verify.html unchanged`

---

### Task 6: Player view (`damage.html`)

**Files:**
- Create: `ssd-pipeline/viewer/damage.html`

**Interfaces:**
- Consumes: `ssd-engine.js`, `dac.js`, `arc-geom.js`, `ship-model.js`, `dac-allocator.js` via `<script>`.

- [ ] **Step 1: Scaffold** `damage.html`: load `detection.json`+`verified.json`+`/api/labels`, `buildShipModel`, render via `SFB.engine.renderSSD` with a `status` map (all intact), and a shield readout row.
- [ ] **Step 2: Apply-damage panel** — shield `#1–6` selector, volley size, leaky toggle + rate (4/6/10), speed selector (Slow 400 / Medium 150 / Fast 40 / Instant 0 ms), Apply, Reset.
- [ ] **Step 3: Effect playback** — on Apply, call `applyVolley`, then play the returned effects at the chosen delay: each `destroy` flips a box's `status` to `destroyed` (engine re-render); each `shield` decrements the readout; `shipDestroyed` shows a terminal banner. Status: destroyed = greyed + hatch/✕ (spec §9).
- [ ] **Step 4: Result summary** — after playback, a per-token tally line ("15 internal: 4 F-hull, 2 L-warp, 1 bridge, 1 Ph-3, 3 excess").
- [ ] **Step 5: E2E test** — Playwright: open `damage.html?ship=FED-CA`, set shield 1 + 20 points + instant, Apply; assert some boxes now have destroyed status, the shield readout dropped, and the summary rendered. Reset returns all to intact.
- [ ] **Step 6: Commit** — `feat(damage): player-facing SSD damage view with Apply-damage + speed playback`

---

### Task 7: Polish + roadmap update

**Files:**
- Modify: `tasks/todo.md`, `README.md`

- [ ] **Step 1:** Update `tasks/todo.md` (damage processor built) and the README roadmap (damage view shipped; link `damage.html`).
- [ ] **Step 2:** Full test run `node --test ssd-pipeline/test/` (all green) + a final Playwright pass on `damage.html`.
- [ ] **Step 3: Commit** — `docs: damage processor built; update roadmap`

---

## Self-Review

- **Spec coverage:** §1 arch → Tasks 5/6; §2 model → Task 2; §3 rules → Tasks 1/4; §4 engine → Task 5; §5 model map → Task 2; §6 DAC data → Task 1; §7 algorithm → Task 4; §8 UI → Task 6; §9 visuals → Task 6 Step 3; §10 ephemeral state → Task 6 (status map + Reset); §11 tests → Tasks 1–4 + 6 E2E (D4.5, D3.63, tracks, excess, directional all present); §12 build order → task order; §13 risks (DAC transcription) → Task 1 Step 3 + Task 4 Step 6 gate. No gaps.
- **Placeholders:** test steps carry concrete code + expected results; the DAC transcription (Task 1/4) is inherently a read-the-chart data task pinned by the D4.5 acceptance gate — not a hand-wave.
- **Type consistency:** `applyVolley(model, params, rng)`, effect `{type,...}` shape, pool token names (`L_WARP`,`F_HULL`,`TORP`,`PHASER`,…), and `arcBearsToShield(arcDef, shieldNum)` are used identically across Tasks 1–6.
