# Energy Allocation (sandbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the start-of-turn Energy Allocation phase to the direct-fire sandbox — a control panel where each commander budgets every ship's power across the 21-line EAF, locks (sealed, final), and when all fleets lock the columns fold onto the ships and impulse 1 begins.

**Architecture:** A new pure engine module `energy-model.js` (production from SSD boxes, default column, balance validator, fold) unit-tested with `node --test`; a split-screen allocation mode inside `battle.html` (controls left, existing map right); `serve.py` gains a `phase` field, per-ship `eaf`, and `lockEnergy`/`energyResolved` POST kinds reusing the existing fog-of-war + single-resolver + optimistic-lock + polling machinery.

**Tech Stack:** Plain ES modules (no npm deps), `node --test`, Python `http.server` static+API, Playwright for E2E.

## Global Constraints

- Pure dependency-free ES modules; tests are `node --test` `.mjs` files under `ssd-pipeline/test/`. No new runtime deps.
- File-based only (no DB). Reuse the existing shared-state plumbing: commander codes, fog-of-war plan filtering, per-ship optimistic locking + `_BATTLE_LOCK`, single-resolver commit, ~1.5s polling.
- Game-mechanics power data (per-box output, life support, capacitor capacity, move cost, weapon arm/overload costs, overload damage/range) is **functional data transcribed from owned material**, committed as code and **verified by unit tests**; no copyrighted prose/art/images.
- Full 21-line EAF, but a line is shown only for a ship that has the system (derived from `verified.json`).
- Movement energy **sets** speed (`speed = ⌊movement/moveCost⌋`, ≤30) — not a cap; speed is not separately adjustable until variable-speed movement exists.
- Input types: **slider** (variable power), **toggle** (fixed on/off), **two toggles** per heavy weapon (arm/hold + overload — no slider), **segmented** (fire control Off/Low/Full), **read-only** (production 1-4, batteries, life support, totals).
- Under-allocation legal (amber); over-allocation blocks Lock (red). Life support mandatory, non-zeroable.
- Deferred (not built): ECM/ECCM to-hit effects, mid-turn reserve discharge, typed-energy gating, fractional accounting, saved templates, GM overrides.
- Reference spec: `docs/superpowers/specs/2026-07-04-energy-allocation-design.md`.

---

### Task 1: `energy-model.js` — `shipPower()` + power data tables

**Files:**
- Create: `ssd-pipeline/viewer/energy-model.js`
- Test: `ssd-pipeline/test/energy-model.test.mjs`

**Interfaces:**
- Consumes: `shipLoadout(verified, detection)` from `./ship-loadout.js` (returns `{mounts:[{id,cls,arc}], shields:[]}`); DAC families in `verified.groups[].family` with `boxIds[]`.
- Produces:
  - `shipPower(code, verified, detection) -> ShipPower` where
    `ShipPower = { warp, impulse, apr, total, batteries, capacitorCap, sizeClass, moveCost, shields, weapons:[{id,cls,arm,overload}], systems:{shuttles,tractor,transporter,ecm,labs,fireControl,cloak} }`
  - const tables `PER_BOX_OUTPUT`, `SHIP_PROFILES`, `LIFE_SUPPORT`, `WEAPON_ARM` (exported).

**Data (transcribed game-mechanics; calibration-flagged):**
```js
export const PER_BOX_OUTPUT = { 'warp-engine': 1, 'impulse-engine': 1, 'apr': 1 };
export const LIFE_SUPPORT = { 1: 3, 2: 1.5, 3: 1, 4: 0.5, 5: 0 };          // by size class (B3.3)
export const WEAPON_ARM = { PHOTON: { arm: 2, overload: 4 }, DISR: { arm: 1, overload: 2 } }; // per-turn cost
export const CAP_PER_PHASER = { 'PH-1': 1, 'PH-2': 1, 'PH-3': 0.5 };       // capacitor capacity (H6.21)
export const SHIP_PROFILES = {  // sizeClass + moveCost per ship code; default SC3/moveCost 1
  'FED-CA': { sizeClass: 3, moveCost: 1 }, 'FED-CL': { sizeClass: 3, moveCost: 1 },
  'FED-NCL': { sizeClass: 3, moveCost: 1 }, 'KLI-D7': { sizeClass: 3, moveCost: 1 },
  'GOR-CA': { sizeClass: 3, moveCost: 1 },
};
```

**Implementation:** count undestroyed boxes per family (`Σ boxIds.length` over groups of that family), multiply by `PER_BOX_OUTPUT`; `capacitorCap = Math.round(Σ CAP_PER_PHASER[cls])` over loadout phaser mounts; `weapons` = loadout mounts whose cls is in `WEAPON_ARM`, each `{id, cls, arm, overload}`; `systems` presence from family counts (`shuttle-bay`,`tractor`,`transporter`,`fire-control` etc.); `shields` = loadout shields; profile merged from `SHIP_PROFILES[code] || {sizeClass:3,moveCost:1}`. Accept an optional `destroyed:Set` param later; for now compute from full `verified` (undamaged).

- [ ] **Step 1: failing tests** in `energy-model.test.mjs`:
```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { shipPower } from '../viewer/energy-model.js';
import fs from 'node:fs';
const load = c => shipPower(c, JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/verified.json`)), JSON.parse(fs.readFileSync(`ssd-pipeline/data/${c}/detection.json`)));
test('shipPower derives production, capacitor, weapons from the SSD', () => {
  const fed = load('FED-CA');
  assert.equal(fed.warp, 30); assert.equal(fed.total, fed.warp + fed.impulse + fed.apr);
  assert.equal(fed.capacitorCap, 9);           // 8×PH-1 + 2×PH-3(0.5) = 9
  assert.equal(fed.weapons.filter(w => w.cls === 'PHOTON').length, 4);
  assert.equal(fed.sizeClass, 3);
  const kli = load('KLI-D7');
  assert.equal(kli.capacitorCap, 9);           // 9×PH-2
  assert.equal(kli.weapons.filter(w => w.cls === 'DISR').length, 4);
});
```
- [ ] **Step 2:** run `node --test ssd-pipeline/test/energy-model.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** implement `energy-model.js` with the data tables + `shipPower` per the notes above. Paths in the test are repo-relative — run tests from repo root.
- [ ] **Step 4:** run the test → PASS. Also run full suite `node --test ssd-pipeline/test/*.test.mjs` (expect 67 + new).
- [ ] **Step 5:** `git add ssd-pipeline/viewer/energy-model.js ssd-pipeline/test/energy-model.test.mjs && git commit -m "feat(energy): shipPower — derive power profile from SSD boxes"`

---

### Task 2: `lifeSupportCost` + `newEafColumn` — the default column

**Files:** Modify `ssd-pipeline/viewer/energy-model.js`, `ssd-pipeline/test/energy-model.test.mjs`

**Interfaces:**
- Produces: `lifeSupportCost(power) -> number` (= `LIFE_SUPPORT[power.sizeClass]`); `newEafColumn(power, prevSpeed=0) -> EafColumn` per spec §1.2/§1.3.
- `EafColumn` fields (all present): `{ lifeSupport, fireControl:0|0.5|1, phaserCap, weapons:{[id]:{armed,overload}}, shieldsActive, genReinf, specReinf:{1..6:0}, movement, impulseMove:0|1, het, damageControl, recharge, tractor, transporter, ecm, eccm, labs, wildWeasel, suicide, cloak }`

**Default rules:** `lifeSupport = lifeSupportCost(power)`; `phaserCap = power.capacitorCap`; every weapon `{armed:true, overload:false}`; `shieldsActive:true`; `movement = prevSpeed * power.moveCost`; `fireControl:1` if `systems.fireControl` else 0; everything else 0/false.

- [ ] **Step 1: failing test:**
```js
import { newEafColumn, lifeSupportCost } from '../viewer/energy-model.js';
test('newEafColumn defaults to charge/hold/power all', () => {
  const fed = load('FED-CA'); const col = newEafColumn(fed, 8);
  assert.equal(col.lifeSupport, lifeSupportCost(fed));  // SC3 → 1
  assert.equal(col.phaserCap, fed.capacitorCap);        // full
  assert.ok(Object.values(col.weapons).every(w => w.armed && !w.overload));
  assert.equal(col.shieldsActive, true);
  assert.equal(col.movement, 8 * fed.moveCost);
});
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS + full suite.
- [ ] **Step 5:** commit `feat(energy): default charge/hold/power-all EAF column`.

---

### Task 3: `validateEaf` — the balance referee

**Files:** Modify `energy-model.js`, `energy-model.test.mjs`

**Interfaces:**
- Produces: `validateEaf(power, column, carried = 0) -> { produced, used, batteryUsed, free, status:'balanced'|'under'|'over', errors:string[] }` (`carried` = phaser-capacitor charge left from last turn).

**Cost model — the weapon term JOINS `power.weapons` (which carries `cls`, `arm`, `overload` costs) with `column.weapons[id]` (armed/overload STATE); the column's weapons map has no `cls`:**
`weaponCost = Σ over power.weapons w of (column.weapons[w.id]?.armed ? (column.weapons[w.id].overload ? w.overload : w.arm) : 0)`.
`used = lifeSupport + fireControl + phaserCap + weaponCost + (shieldsActive?SHIELD_COST:0) + genReinf + Σ specReinf + movement + impulseMove + (het?HET_COST:0) + damageControl + recharge + tractor + transporter + ecm + eccm + labs + (wildWeasel?WW_COST:0) + (suicide?SUICIDE_COST:0) + (cloak?CLOAK_COST:0)`.
Constants (exported, calibration-flagged): `SHIELD_COST=0` (shields are up for free in v1; the paid shield allocation is reinforcement), `HET_COST=2`, `WW_COST=1`, `SUICIDE_COST=1`, `CLOAK_COST=0`. `produced = power.total + power.batteries`; `free = produced - used`; `batteryUsed = max(0, used - power.total)`; status: `over` if `used > produced`, `under` if `free > 0`, else `balanced`. Errors: over-allocation; `lifeSupport !== lifeSupportCost(power)`; **`phaserCap + carried > capacitorCap`** (carried-room); `impulseMove > 1`; `batteryUsed > power.batteries`.

- [ ] **Step 1: failing tests:** (a) `newEafColumn` default for FED-CA validated → assert a GOLDEN `used` computed by hand from the exact default (LS 1 + fireControl 1 + phaserCap 9 + 4 photons×2 arm + movement + …) so a wrong constant is caught; over-allocate movement beyond produced → `status:'over'` + error; zero life support → error; `phaserCap = cap - carried + 1` → carried-room error; `impulseMove:2` → error; overloading a weapon raises `used` by `overload−arm`.
- [ ] **Step 2-4:** red → implement → green + full suite.
- [ ] **Step 5:** commit `feat(energy): validateEaf balance referee`.

---

### Task 4: `foldEaf` — apply a locked column to a ship

**Files:** Modify `energy-model.js`, `energy-model.test.mjs`

**Interfaces:**
- Produces: `foldEaf(power, column, carried = 0) -> TurnState` where `TurnState = { speed, armed:{[mountId]:{overload:boolean}}, capacitor, reinforce:{gen,spec:{1..6}}, ecmLevel, eccmLevel, wildWeasel, suicide }`.

**Rules:** `speed = Math.min(30, Math.floor(column.movement / power.moveCost))`; `armed` = entries for weapons with `armed:true`, value `{overload}`; `capacitor = carried + column.phaserCap` (carry-over folded in); `reinforce = {gen: column.genReinf, spec: column.specReinf}`; `ecmLevel/eccmLevel/wildWeasel/suicide` copied.

- [ ] **Step 1: failing test:** `foldEaf(fed, {...movement: 8, weapons:{[id]:{armed:true,overload:true}}, phaserCap:9,...})` → `speed===8`, `armed[id].overload===true`, `capacitor===9`.
- [ ] **Step 2-4:** red → implement → green + full suite.
- [ ] **Step 5:** commit `feat(energy): foldEaf applies a locked column to turn state`.

---

### Task 5: heavy-weapon overload in `weapon-charts.js`

**Files:** Modify `ssd-pipeline/viewer/weapon-charts.js`, add `ssd-pipeline/test/overload.test.mjs` (or extend an existing weapon test if present).

**Interfaces:**
- Produces: `damageFor(def, trueRange, die, overload=false)` honoring an `overloadDamage`/`overloadMaxRange` on hit-or-miss weapons. PHOTON overload: `fixedDamage 16`, `maxRange 8`; DISR overload: higher damage band, shorter range (calibration-flagged values).

**Implementation:** add `overload: { maxRange, fixedDamage: [...] }` (and hit bands) to PHOTON/DISR in `WEAPONS`; extend `damageFor` to use the overload table + range when `overload` is true (out-of-overload-range → 0). Keep the non-overload path byte-identical (default param).

**CRITICAL (review finding):** `serve.py` rewrites `viewer/weapon-charts.js` on every `POST /api/weapon-charts` (weapons.html save) using the hard-coded `WEAPON_CHARTS_FUNCS` string literal at `serve.py:212-228`, which embeds the OLD 3-arg `damageFor` with no overload branch. **This task MUST also update `WEAPON_CHARTS_FUNCS` in serve.py** to the identical overload-aware `damageFor`, or the first weapon-table edit silently reverts overload. Confirm weapons.html round-trips the nested `overload` object in its POST payload.

- [ ] **Step 1: failing test:** `damageFor(WEAPONS.PHOTON, 5, hit, true) === 16`; `damageFor(WEAPONS.PHOTON, 10, hit, true) === 0` (beyond overload range). Also assert `serve.py`'s `WEAPON_CHARTS_FUNCS` contains a 4-arg `damageFor` (grep test or string check).
- [ ] **Step 2-4:** red → implement → green + full suite.
- [ ] **Step 5:** commit `feat(weapons): heavy-weapon overload damage/range`.

---

### Task 6: `serve.py` — `phase`, per-ship `eaf`, lock/resolve kinds, fog filter

**Files:** Modify `ssd-pipeline/serve.py`

**Interfaces:**
- `apply_battle_post` gains kinds:
  - `kind='lockEnergy'` `{code, eaf:{[shipId]:column}}` → store each ship's `eaf`, set `committed[fleet]`; if this completes the set, return `resolve:true` + all ships' `eaf` (reveal for folding).
  - `kind='energyResolved'` `{ships:[folded ship states], phase:'impulse'}` → authoritative write (single resolver): overwrite ships, bump revs, set `phase='impulse'`, clear `committed`.
- `battle_view` returns `phase` (default `'energy'` for a fresh battle) and each ship's `eaf` **filtered to the requesting fleet** (fog of war — opponent `eaf` omitted).
- `kind='new'` seeds `phase:'energy'`; `kind='step'` sets `phase:'energy'` when it wraps to a new turn (impulse→1), else leaves phase.

**Implementation:** mirror the existing `commit`/`fireResult` branches; `eaf` lives top-level `data['eaf'] = {shipId: column}`; filter in `battle_view` by `ship.side == my_fleet`.

- [ ] **Step 1: failing test** `ssd-pipeline/test/energy_server.test.mjs` (node fetch against a spawned server, or a Python check) OR a bash API script: seed battle → GET has `phase:'energy'` → fleet A `lockEnergy` → `resolve:false` → fleet B `lockEnergy` → `resolve:true` + both eaf → `energyResolved` → GET `phase:'impulse'`; opponent GET omits my `eaf`.
- [ ] **Step 2-4:** red → implement in `serve.py` → green (restart server between runs).
- [ ] **Step 5:** commit `feat(server): energy phase + sealed lockEnergy/energyResolved + eaf fog of war`.

---

### Task 7: `battle.html` — allocation mode scaffold (phase, split-screen, source pool + meter)

**Files:** Modify `ssd-pipeline/viewer/battle.html`

**Interfaces:**
- Consumes: `shipPower`, `newEafColumn`, `validateEaf` from `./energy-model.js`; shared-state `phase`, per-ship `eaf`.
- Produces: an `#energyPanel` (left) shown when `phase==='energy'`, hiding the fleets/fire rails; the map stays right (read-only). Client state: `eafDraft:{[shipId]:column}`, `eaSelected` (ship tab). `renderEnergy()` builds the source pool + a live balance meter from `validateEaf`.

**Implementation:** on load/resume, if `phase==='energy'` show the panel; build `eafDraft` from `newEafColumn(shipPower(...), ship.speed)` for each of my ships (or from `ship.eaf` if present). Split-screen CSS reuses `.rail`/`.stage`. Map interactions (drag/turn/fire/commit) gated off while `phase==='energy'`.

- [ ] **Steps:** Playwright E2E — new battle opens in energy mode, `#energyPanel` visible, map present + read-only, meter shows produced/used/free for the selected ship. Verify via `browser_evaluate`. Commit `feat(battle): energy allocation mode scaffold + source pool/meter`.

---

### Task 8: `battle.html` — EAF sink rows by input type

**Files:** Modify `ssd-pipeline/viewer/battle.html`

**Interfaces:** Produces `renderEaRows()` rendering each EAF line by input type — read-only (production/batteries/LS/totals), **slider**+stepper (phaserCap, genReinf, specReinf×6, movement w/ "= N hexes", ecm, eccm, recharge, damageControl, tractor, transporter, labs), **toggle** (shieldsActive, het, wildWeasel, suicide, cloak), **two toggles** per heavy weapon (arm/hold + overload), **segmented** (fireControl Off/Low/Full). Rows for absent systems omitted (from `shipPower.systems`). Every gesture updates `eafDraft[ship]` + re-runs `validateEaf` + repaints the meter; each row shows its allocated power units.

- [ ] **Steps:** Playwright — move the movement slider → "= N hexes" + meter update; toggle a photon overload → used increases by overload−arm delta; over-allocate → meter red + Lock disabled. Commit `feat(battle): EAF sink rows (sliders/toggles/segmented, overload)`.

---

### Task 9: `battle.html` — Lock flow + phase transition

**Files:** Modify `ssd-pipeline/viewer/battle.html`

**Interfaces:** Produces `lockEnergy()` (final-warning confirm → POST `kind='lockEnergy'` with `eafDraft`; on `resolve:true`, fold every ship via `foldEaf` + POST `kind='energyResolved'` with folded state + `phase:'impulse'`). `applyRemote` reads `phase`; when it flips to `'impulse'`, hide `#energyPanel`, re-enable the map, run impulse 1. Test mode locks solo immediately. `stepImpulse` wrap to a new turn sets `phase='energy'` + rebuilds `eafDraft` defaults.

- [ ] **Steps:** Playwright (test mode, solo) — allocate → Lock → confirm → panel closes, phase `impulse`, map interactive, ships' speeds match allocation; step 32 impulses → wraps → energy mode returns. Commit `feat(battle): energy Lock + energy→impulse phase transition`.

---

### Task 10: `battle.html` — combat wiring (movement→speed, armed/overload, capacitor, reinforcement)

**Files:** Modify `ssd-pipeline/viewer/battle.html`

**Interfaces:** Consumes folded `TurnState`. Changes:
- Fleet-panel speed field becomes **read-only** (shows folded `speed`); remove the editable speed input + its `saveSoon`.
- `resolvePlanInto` filters mounts to `ship.armed`; overloaded mounts pass `overload=true` to `damageFor` (via `direct-fire.js` `resolveMount` gaining an `overload` flag from `ship.armed[mountId].overload`).
- Phaser availability within a turn = capacitor has ≥ firing cost; decrement `ship.capacitor` on phaser fire (replaces `isCharged` for phasers during the turn; heavy weapons still gated by `armed`).
- Shield reinforcement: `foldEaf` reinforcement added to effective shield strength when building the damage model / in the DAC allocator for the turn.

- [ ] **Steps:** Playwright — allocate movement 8 → ship speed 8 (read-only); unarm a photon → it can't be committed to fire; overload a photon at range 5 → 16 damage in the log; phasers deplete the capacitor. Commit `feat(battle): wire energy allocation into movement + fire`.

---

### Task 11: calibration + full E2E + docs

**Files:** Modify `energy-model.js` data if calibration needs it; `README.md` (mention the energy phase); run full suites.

- [ ] Verify `PER_BOX_OUTPUT`, `WEAPON_ARM`, overload values against the rulebook/SSDs; adjust constants + tests so Fed CA / Klingon D7 totals are exact (golden-vector tests).
- [ ] Full `node --test ssd-pipeline/test/*.test.mjs` green; Playwright end-to-end: new battle → energy allocate both fleets → lock → impulse play → fire → next turn → energy again.
- [ ] Update README status bullet. Commit `docs: note the energy allocation phase`.

---

## Self-Review notes

- **Spec coverage:** Tasks 1-4 = engine (§1); Task 5 = overload (§4); Task 6 = server phase/lock/fog (§2); Tasks 7-9 = UI + phase flow (§3, §2); Task 10 = combat wiring (§4); Task 11 = calibration (§6 open) + testing (§5).
- **Deferred items** (ECM/ECCM effects, reserve drawer, typed gating) are captured as allocatable config in Tasks 8/9 but intentionally not wired — matches spec §6.
- **Type consistency:** `EafColumn`, `ShipPower`, `TurnState` field names are fixed in Tasks 1-4 and reused verbatim in 6-10.
