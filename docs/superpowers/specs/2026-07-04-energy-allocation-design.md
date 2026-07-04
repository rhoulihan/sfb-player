# Energy Allocation (sandbox) — Design Spec

**Date:** 2026-07-04
**Status:** Draft for review
**Context:** Adds the start-of-turn **Energy Allocation Phase** to the direct-fire sandbox
(`ssd-pipeline/viewer/battle.html`). Adapts the platform specs `docs/spec/C2-energy-allocation-power.md`
(engine) and `docs/spec/D3-energy-allocation-ui.md` (panel) to the sandbox's client-side / file-based
architecture (plain ES modules, Python static server, `_battle.json` shared state, per-ship optimistic
locking, commander codes, ~1.5 s polling).

## Goal

Each turn begins with a control-panel Energy Allocation phase. Every commander budgets each of their
ships' power across the full 21-line Energy Allocation Form (EAF), confirms/locks (secret, final), and
when **all fleets have locked** the battlemap renders and impulse 1 begins. The allocation drives the
turn: movement funds speed, heavy weapons must be armed to fire (with overload), phasers fire from the
charged capacitor, and shield reinforcement adds boxes.

## Scope (from review)

- **Full 21-line EAF** — every line on the form, but a line is only shown for a ship that has the
  system (derived from `verified.json`).
- **Production derived from SSD boxes** — `Σ(undestroyed source boxes × perBoxOutput)`.
- **Combat wiring this pass:** movement→speed cap, armed/overloaded heavy weapons, phasers from the
  capacitor, shield reinforcement. **Deferred to the impulse-procedure work:** ECM/ECCM to-hit
  effects, mid-turn reserve discharge, and inert-but-allocatable tractor/transporter/damage-control.
- **UI:** a turn-start mode inside `battle.html` — controls left, existing scrollable map right.

Non-goals for v1: fractional accounting (B3.2), AWR-vs-APR typing nuance, contingent reserve (H7.6),
Andromedan/Vudar EAFs, GM overrides, saved templates. (Room is left for them; they are not built.)

---

## 1. Power model — `energy-model.js` (new, pure, unit-tested)

A dependency-free ES module mirroring the existing engine modules (`direct-fire.js`, `dac-allocator.js`).
No DOM, no I/O — takes data in, returns data out.

### 1.1 Deriving a ship's power profile from the SSD

```
shipPower(verified, detection) -> ShipPower
```

Counts undestroyed boxes by DAC family from `verified.groups` and multiplies by a per-box output table:

```js
// game-mechanics data (calibrated so each standard ship's total matches its published power)
const PER_BOX_OUTPUT = { 'warp-engine': 1, 'impulse-engine': 1, 'apr': 1 };
```

```ts
interface ShipPower {
  warp: number;        // Σ undestroyed warp-engine boxes × output
  impulse: number;     // Σ undestroyed impulse-engine boxes × output
  apr: number;         // Σ undestroyed apr boxes × output   (line 3 "Reactor")
  total: number;       // warp + impulse + apr               (line 4)
  batteries: number;   // battery box count (1-point cells, H5)
  capacitorCap: number;// phaser-capacitor capacity from phaser fit (H6.21): Σ per-phaser cap
  sizeClass: 1|2|3|4|5;// -> life-support cost + shield-activate cost
  moveCost: number;    // energy per hex of warp movement (0.5 / 1 / 1.5)
  systems: {           // which discretionary lines to show — presence, from box families
    heavyWeapons: { id: string; cls: 'PHOTON'|'DISR'; arm: number; overload: number }[];
    shields: number;   // shield count (usually 6)
    shuttles: number;  // shuttle-bay capacity -> wild-weasel / suicide options
    tractor: boolean; transporter: boolean; ecm: boolean; labs: number;
    fireControl: boolean; cloak: boolean;
  };
}
```

**Calibration note (implementation task):** `PER_BOX_OUTPUT` values are set so `total` matches each
standard ship's published power (Fed CA, Klingon D7, Kzinti, Gorn). If box counts don't land on the
published total with a flat coefficient, a small per-ship `powerOverride` is added to the profile data
(same pattern as the weapon charts — data transcribed from owned material, verified against the SSDs).
`capacitorCap`, `sizeClass`, `moveCost`, and per-weapon `arm`/`overload` costs are likewise
game-mechanics data (H6.21, B3.3, C2.11, E4.21/E3) transcribed and unit-tested against known values
(Fed CA capacitor 9 — our SSD's fit is 8×PH-1 + 2×PH-3; Klingon D7 9×PH-2 = 9; photon arm 2 /
overload 4; disruptor at photon parity 2/4 — all calibration-flagged data tasks).

### 1.2 The EAF column (21 lines)

One column per ship per turn. Read-only lines are computed; discretionary lines are the player's.

```ts
interface EafColumn {
  turn: number;
  // production 1-4 (READ-ONLY, from ShipPower)
  // batteries 5-6 (state)  batteriesAvailable, batteriesDischarged
  lifeSupport: number;              // 7  MANDATORY, forced by sizeClass (B3.3)
  fireControl: 0 | 0.5 | 1;         // 8  segmented (Off/Low/Full) (D6.6)
  phaserCap: number;                // 9  SLIDER 0..(capacitorCap - carriedCharge) (H6.21)
  weapons: Record<string, {         // 10 per heavy weapon: two toggles, no slider
    armed: boolean; overload: boolean }>;
  shieldsActive: boolean;           // 11 TOGGLE, fixed cost by sizeClass (D3.32)
  genReinf: number;                 // 12 SLIDER (D3.341)
  specReinf: Record<1|2|3|4|5|6, number>; // 13 SLIDER per shield (D3.342)
  movement: number;                 // 14 SLIDER warp points; impulsePoint 0|1; het: boolean
  impulseMove: 0 | 1;               //    (H3.4) <= 1
  het: boolean;                     //    TOGGLE (fixed cost)
  damageControl: number;            // 15 SLIDER
  recharge: number;                 // 16 SLIDER (batteries / reserve-warp)
  tractor: number;                  // 17 SLIDER
  transporter: number;              // 18 SLIDER
  ecm: number; eccm: number;        // 19 SLIDERs (levels)
  labs: number;                     //    stepper/toggles
  wildWeasel: boolean; suicide: boolean; cloak: boolean; // TOGGLEs (fixed cost)
  // 20-21 (READ-ONLY): totalUsed, batteryUsed (computed by validateEaf)
}
```

### 1.3 Default column — `newEafColumn(power, prev)`

Every turn starts **set to charge/hold/power everything** (the requested default), then the player
adjusts:

- `lifeSupport` = mandatory cost for `sizeClass` (locked).
- `phaserCap` = fill the capacitor to full (`capacitorCap - carriedCharge`).
- `weapons[*].armed = true`, `overload = false` — arm/hold every heavy weapon.
- `shieldsActive = true`.
- `movement` = fund the ship's current speed (`speed × moveCost`), clamped to available.
- everything else 0 / off.

If the result over-allocates (small ship, everything on), the panel opens **red** and the player trims
— the default never silently drops a mandatory or weapon.

### 1.4 Balance validator — `validateEaf(power, column)`

Pure referee. Returns:

```ts
{ produced: number,   // total + batteriesAvailable
  used: number,       // Σ all discretionary line costs + lifeSupport
  batteryUsed: number,// used - total (drawn from batteries), >= 0
  free: number,       // produced - used
  status: 'balanced' | 'under' | 'over',
  errors: string[] }  // blocks Lock
```

Hard errors (block Lock): over-allocation (`used > produced`); life support ≠ mandatory; `phaserCap`
past capacitor room; `impulseMove > 1`; battery draw > available. Under-allocation is legal (amber
warning; surplus is **not** reserve, B3.4). No typed-energy gating in v1 beyond `impulseMove ≤ 1`
(warp-vs-impulse-vs-APR sourcing is auto-filled cheapest-legal; full typing is deferred).

### 1.5 Folding a locked column onto the ship — `foldEaf(ship, column, power)`

Applies the confirmed allocation to the ship's turn state, consumed by the impulse phase:

- `ship.speed = min(30, floor(column.movement / power.moveCost))` — allocated Energy for Movement
  **sets** the turn's speed (it is not a cap); speed is fixed for the turn and not separately
  adjustable until variable-speed movement is added.
- `ship.armed = { mountId: { overload } }` for weapons with `armed`; **unarmed heavy weapons cannot be
  committed to fire** (fire step filters on `ship.armed`).
- `ship.capacitor = carriedCharge + column.phaserCap` — phasers fire from this (drawn per shot);
  replaces the impulse-recharge model **for phasers within a turn**.
- `ship.reinforce = { genReinf, specReinf }` — added to shield strength for the turn.
- `ship.ecmLevel / eccmLevel`, `ship.wildWeasel / suicide` — recorded (effects deferred).

---

## 2. Turn / phase flow

New top-level field in the shared battle state: `phase: 'energy' | 'impulse'`.

```
New battle / start of each turn  ->  phase='energy'
  each ship gets newEafColumn();  commanders adjust; each fleet LOCKS (sealed, final)
  all fleets locked  ->  server folds every column, phase='impulse', impulse=1
Impulse play (existing)  ->  ... impulse 32 reached ...  ->  next turn, phase='energy'
```

- **Lock is per fleet**, reusing the existing commit pattern (`committed[fleet]`, now used for the EA
  phase as well as 6D fire). Locking is **final for the turn** (final-warning confirm, like fire).
- **Fog of war:** each ship's `eaf` column is filtered server-side to the owning commander (same
  mechanism as fire plans); opponents see only a per-fleet **locked** badge until reveal.
- **Reveal:** when the last fleet locks, that commander is the resolver (same single-resolver pattern as
  6D fire) — it folds all columns and writes the authoritative `phase='impulse'` + folded ship state;
  everyone else picks it up by polling.

### Server (`serve.py`) additions

- Battle state gains `phase` and per-ship `eaf`.
- `POST kind='lockEnergy'` `{code, shipEaf: {shipId: column}}` — stores this fleet's columns, sets
  `committed[fleet]`; if it completes the set, returns `resolve: true` + all columns for folding.
- `POST kind='energyResolved'` `{ships:[folded], phase:'impulse'}` — authoritative write by the resolver.
- `battle_view` includes `phase`; `eaf` filtered to the requesting fleet's ships (fog of war).
- Optimistic locking + the file lock are unchanged; EA edits are local until Lock, so no per-ship
  contention during allocation.

---

## 3. UI — Energy Allocation mode in `battle.html`

Split-screen, shown whenever `phase === 'energy'`:

- **Left rail (controls).**
  - **Source pool** header: Warp / Impulse / Reactor / Batteries / Capacitor, each showing
    available and committed, and a big **Produced · Used · Free** balance meter (green/amber/red).
  - **Ship tabs** for commanders holding several ships (each with a mini balance dot + lock padlock).
  - **Grouped sink rows** mirroring the EAF, each rendered by its **input type**:
    - *Read-only*: production 1–4, batteries, Life Support, Totals — shown as values.
    - *Slider* (+ numeric stepper): Charge Phaser Capacitors, General/Specific Reinforcement, Energy
      for Movement (with a live "= N hexes" readout and the ≤30 cap), ECM, ECCM, Recharge/Reserve,
      Damage Control, Tractor, Transporters, Labs.
    - *Toggle*: Activate Shields, Wild Weasel, Suicide Shuttle, HET, Cloak.
    - *Two toggles* (arm/hold + overload) per **Heavy Weapon** row — no slider.
    - *Segmented*: Active Fire Control (Off / Low / Full).
  - Each row shows the **power units assigned** and updates the meter live; a row for a system the ship
    lacks is omitted.
  - **Lock** button (disabled while `status==='over'`; final-warning confirm). After lock the rail
    disables and the tab shows a padlock; the pool shows "Fed ✓ locked · Kli …".
- **Right (map).** The existing hex map, scrollable, **read-only** during allocation (drag/turn/fire
  disabled), so the commander can see positions while budgeting.

Reuses existing pieces: the map render, the split-panel layout + resizers, the toast, the
startup/commander-code join, the poll/optimistic-lock sync.

---

## 4. Combat integration (this pass)

- **Movement:** the per-ship free `speed` input is **removed** — a ship's speed is **set** by its
  allocated Energy for Movement (`speed = ⌊movement / moveCost⌋`, ≤30). Speed is fixed for the turn
  and not separately adjustable until variable-speed movement is implemented; the fleet-panel speed
  field becomes a read-only readout. The impulse mover already reads `ship.speed`.
- **Heavy weapons:** `fire6D` / `resolvePlanInto` filter mounts to `ship.armed`; **overloaded** mounts
  use overload damage/range (photon overload 16 @ range ≤ 8; disruptor overload per E3). Weapon-chart
  lookups gain an `overload` variant.
- **Phasers:** the phaser-availability check (`isCharged`) is replaced within a turn by drawing from
  `ship.capacitor`; a phaser is available if the capacitor has ≥ its firing cost, decremented on fire.
- **Shields:** `reinforce` adds boxes to the struck shield's effective strength in the DAC allocator
  for the turn.

## 5. Testing — `energy-model.test.mjs`

- Production from boxes: Fed CA / Klingon D7 totals match calibrated values; destroying source boxes
  reduces `total`.
- `capacitorCap`: Fed CA 9 (8×PH-1 + 2×PH-3), Klingon D7 9 (9×PH-2). Production anchors: Fed CA
  total 36 / 4 batteries, Klingon D7 total 39 / 3 batteries (flat 1-power/box; calibration task).
- Life support by size class (SC1=3 … SC5=0); mandatory and non-zeroable.
- `newEafColumn`: default arms all weapons, fills capacitor, activates shields, funds current speed.
- `validateEaf`: balanced/under/over; over-allocation and bad life-support flagged; capacitor-room and
  `impulseMove ≤ 1` enforced; battery draw accounted.
- `foldEaf`: movement→maxSpeed (⌊mp/cost⌋, ≤30); armed/overload flags; capacitor set; reinforcement.

E2E (Playwright): turn 1 opens in energy mode → adjust a ship, over-allocate → Lock disabled →
rebalance → Lock → all fleets locked → phase flips to impulse, impulse 1, map interactive.

## 6. Phasing / open questions

- **v1:** everything above.
- **Deferred:** ECM/ECCM to-hit math, mid-turn reserve discharge drawer, tractor/transporter/damage-
  control effects, typed-energy gating, fractional accounting, saved templates, HET/EM movement effects
  (allocatable now, effect later with the movement/impulse work).
- **Open — calibration:** confirm `PER_BOX_OUTPUT` and per-weapon arm/overload costs against the
  rulebook so standard-ship totals are exact; captured as a data task with unit-test golden vectors.
- **Open — stepping authority:** who advances impulse 32 → next turn (back to energy) — reuse "any
  commander steps," or gate on a turn-end confirm. Proposed: same as today (any commander), revisited
  in the impulse-procedure work.
