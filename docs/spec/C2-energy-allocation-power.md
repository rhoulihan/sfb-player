# C2 — Energy Allocation & Power Systems

## Purpose & Scope

This subsystem owns the per-turn **Energy Allocation Form (EAF)** and the **power economy** that
underlies every other action in the game. Each turn, before anything moves or fires, every ship's
controllers secretly budget all available energy across a fixed schedule of line items; the server
acts as authoritative referee, computing every total automatically, enforcing that allocations
**balance** (never over-allocate, pay all mandatory costs), and committing the budget under
sealed-orders fog-of-war so opponents learn only that a ship has locked. It also models the
**power sources** (warp/impulse engines, reactors), **storage** (batteries, phaser capacitor),
and the **reserve-power** rules that let stored energy be spent mid-turn. The hard line we hold:
*all arithmetic, legality, and bookkeeping is AUTOMATED; every distributive choice — how much power
goes where, when to discharge a battery, whether to gamble on a contingent allocation — is a
PLAYER DECISION.* This doc implements B3.0 and the whole H section.

**PHASE:** Core EAF, all standard power sources, batteries (1-point cells), phaser capacitor,
life support, and reserve power (H7.1–H7.6) are **[v1 AM-tournament]**. Fractional accounting,
AWR typing nuances, mauler/X-ship batteries are **[v2]**. Andromedan/Vudar/specialized EAFs are **[v3 full Master]**.

## Rulebook References

- Energy Allocation procedure & EAF: **B3.0, B3.1**; fractional accounting **B3.2, B3.21, B3.22**;
  life support **B3.3**; non-expenditure **B3.4**; records/audit **B3.5**.
- Power systems overview **H0.0, H1.0**; warp engines **H2.0–H2.5**; impulse **H3.0–H3.5**;
  APR/AWR reactors **H4.0–H4.32**; batteries **H5.0–H5.6**; phaser capacitor **H6.0–H6.5**.
- Reserve power timing/restrictions **H7.0, H7.11–H7.134, H7.3–H7.38**; typed reserve (warp/impulse/APR)
  **H7.4–H7.49**; reserve for weapons **H7.5–H7.55**; contingent reserve **H7.6–H7.65**.
- Vudar ionization **H8.0–H8.32** [v3].
- Cross-refs consumed: shield costs (D3.32, D3.341/342), fire control (D6.6/D6.7), damage stops
  production at end of turn (D4.223), energy balance due to damage (D22.0/D22.15), capture transfer (D7.503),
  movement caps (C2.111/C2.112), crippled emergency LS (S2.4).

## Domain Model

```typescript
// ---- Typed energy: the 'type' tag gates what a point may legally pay for ----
type EnergyType =
  | 'warpEngine'   // moves the ship; satisfies warp-required + movement-related functions
  | 'warpReactor'  // AWR: warp-required functions only, NEVER movement (H4.31, H7.45)
  | 'impulse'      // sublight; <=1 pt to movement, sublight TMs (H3.4, C5.1)
  | 'apr'          // any function NOT warp- or impulse-specific (H4.1)
  | 'battery'      // plain stored power; not warp/impulse (H5.0)
  | 'ion';         // Vudar ionized energy [v3] (H8.0)

interface PowerSourceBank {           // one per source type on the SSD
  kind: 'warp' | 'impulse' | 'apr' | 'awr';
  totalBoxes: number;
  offlineBoxes: number;               // destroyed/checked; availability = total - offline (AUTOMATED count)
  perBoxOutput: number;               // = 1 for standard boxes (H2.1/H3.1/H4.1)
}

// ---- A storage cell (battery). Cells are independent (H5.2). ----
interface BatteryCell {
  capacity: number;                   // 1 standard; 5 Andromedan, 3/5 X-ship (H5.5) [v2/v3]
  stored: number;                     // current charge, may be fractional
  storedTypes: { type: EnergyType; amount: number }[]; // mixed reserve sources (H7.40)
  destroyed: boolean;                 // on destruction, power lost IMMEDIATELY (H7.38)
}

// ---- Phaser capacitor: the ONLY source that fires phasers (H6.0). ----
interface PhaserCapacitor {
  capacity: number;                   // derived from phaser fit + rounding mode (H6.21)
  charge: number;
  holdTurnsRemaining: number;         // <=25, then lost (H6.4)
  destroyedPortion: number;           // empties first on phaser loss (H6.3)
}

// ---- The EAF: an ordered array of per-turn columns (B3.1). Fixed 21-line schema. ----
interface EafColumn {
  turn: number;
  // PRODUCTION — AUTOMATED (lines 1-4)
  line1_warpAvailable: number;        // = unchecked warp boxes
  line2_impulseAvailable: number;     // = unchecked impulse boxes
  line3_reactorAvailable: number;     // = unchecked APR/AWR boxes
  line4_totalPower: number;           // = l1+l2+l3 (excludes batteries)
  // BATTERY STATE (lines 5-6); l5+l6 MUST == undestroyed battery boxes
  line5_batteriesAvailable: number;
  line6_batteriesDischarged: number;
  // MANDATORY (line 7)
  line7_lifeSupport: number;          // force-deducted by size class (B3.3)
  // DISCRETIONARY — PLAYER DECISIONS (lines 8-19)
  line8_activeFireControl: 0 | 0.5 | 1;       // (D6.6/D6.7)
  line9_phaserCapacitor: number;              // charge added to capacitor (room-checked)
  line10_torpedoes: TorpedoAlloc[];           // per launching tube/box; multi-turn arming
  line11_shields: number;                     // min or full by size class (D3.32)
  line12_generalReinforcement: number;        // (D3.341)
  line13_specificReinforcement: { shield: 1|2|3|4|5|6; points: number }[]; // (D3.342)
  line14_movement: { warpPoints: number; impulsePoint: 0 | 1 }; // impulse <=1 (H3.4)
  line15_damageControl: number;               // (D9.x)
  line16_rechargeBatteries: number;           // (H7.41) — warp here becomes reserve-warp-engine
  line17_tractor: number;                     // (G7.0)
  line18_transporters: number;                // (G8.0)
  line19_misc: { system: string; points: number; type?: EnergyType }[]; // EW, cloak, shuttles
  // CHECKS — AUTOMATED (lines 20-21)
  line20_totalPowerUsed: number;      // sum(l7..l19); legality check vs available
  line21_batteryPowerUsed: number;    // drawn from batteries; carried to next turn's l5/l6
}

interface ShipPowerState {            // folded current state; lives in the ship snapshot
  sizeClass: 1 | 2 | 3 | 4 | 5;
  movementCost: number;               // 0.5 / 1 / 1.5 (per SSD)
  banks: PowerSourceBank[];
  batteries: BatteryCell[];
  capacitor: PhaserCapacitor;
  crippled: boolean;                  // -> emergency life support (S2.4)
  hasEAControl: boolean;              // boarded/no-control -> emergency LS
  eaf: EafColumn[];                   // one column per turn (append-only audit, B3.5)
  pendingContingent: ContingentAlloc[];
  ruleset: { fractionalAccounting: boolean; ionizationCost?: number };
}

interface ContingentAlloc {           // (H7.6) part now, remainder from reserve or forfeit
  functionId: string; allocatedPortion: number; requiredRemainder: number;
  reserveType: EnergyType; completed: boolean; irrevocableOverload?: boolean;
}
```

**Mongoose sketch.** The EAF column is the payload of an event and is also embedded in the ship
snapshot; the *secret in-flight* allocation lives in a short-lived commit collection owned generically
by `A4-realtime-sync-layer.md`, carrying this energy payload:

```typescript
const eafColumnSchema = new Schema({ /* 21 numbered lines above */ }, { _id: false });
const batteryCellSchema = new Schema({ capacity: Number, stored: Number,
  storedTypes: [{ type: String, amount: Number }], destroyed: Boolean }, { _id: false });

const sealedAllocationSchema = new Schema({   // EA-phase commit store (TTL until reveal)
  gameId:   { type: ObjectId, index: true },
  turn:     Number,
  shipId:   { type: String, index: true },
  side:     String,
  commitHash: String,                 // SHA-256 of {column, nonce}; fog-of-war (B3.5)
  sealedPayload: Buffer,              // encrypted EafColumn; engine-only until all sides locked
  lockedAt: Date,
}, { timestamps: true });
sealedAllocationSchema.index({ gameId: 1, turn: 1, shipId: 1 }, { unique: true });
```

Authoritative state is the append-only `gameEvents` log (see `A3-data-architecture-event-store.md`); the
revealed `EafColumn` and post-fold `ShipPowerState` are written into `gameSnapshots`. Energy
allocation carries **no randomness**, so replays are deterministic without touching the seeded RNG
(`E1-dice-rng-service.md`); only downstream resolution rolls dice.

## Events & Commands

**Commands (validated, then emit events):**

- `SubmitSealedOrders` — `{ gameId, turn, shipId, side, commitHash, sealedPayload }`. Generic
  sealed-submit (A2 doc); the energy payload is one `EafColumn` per ship the actor controls.
- `AllocateEnergy` — `{ gameId, turn, shipId, column: EafColumn }`. The decrypted column applied at reveal.
- `DischargeReservePower` — `{ gameId, turn, impulse, shipId, batteryCellIndex, amount, targetFunction, asType }`.
  Mid-turn reserve use at the exact sequence step (H7.11/H7.131).
- `TransferReservePower` — `{ gameId, turn, impulse, shipId, fromCell, toFunction, amount }`.
  Delayed-use pre-transfer, legal only at end of impulse (H7.132).
- `ApplyGmOverride` — `{ target: 'eaf'|'reserve'|'battery'|'capacitor', shipId, path, value, reason }`.

**Events (past-tense, appended):**

- `OrdersSealed` `{ shipId, side, commitHash, lockedAt }` — opponents see only this.
- `OrdersRevealed` `{ turn, ships: shipId[] }` — emitted when **all** sides locked.
- `EnergyAllocated` `{ shipId, turn, column: EafColumn, derived: { totalPower, totalUsed, batteryUsed } }`.
- `BatteryStateChanged` `{ shipId, cells: BatteryCell[], cause: 'allocation'|'reserve'|'recharge'|'destroyed' }`.
- `CapacitorCharged` `{ shipId, charge, holdTurnsRemaining }`.
- `ReservePowerDischarged` `{ shipId, impulse, amount, asType, targetFunction }`.
- `ReservePowerTransferred` `{ shipId, impulse, toFunction, amount }` — delayed-use commit (H7.132).
- `LifeSupportResolved` `{ shipId, mode: 'standard'|'emergency', cost }`.
- `EnergyBalanceRecharged` `{ shipId, turn, recharged, lostReserveStatus }` — Repair Stage end-of-turn.
- `GmOverrideApplied` `{ ... }` (canonical).

## Engine / API

Pure where possible (no I/O); the resolver folds events.

```typescript
// --- Production & costs (pure, AUTOMATED) ---
function computeAvailablePower(s: ShipPowerState): {
  warp: number; impulse: number; apr: number; awr: number; total: number };       // lines 1-4
function lifeSupportCost(s: ShipPowerState): { mode:'standard'|'emergency'; cost:number }; // B3.3
function capacitorCapacity(phasers: PhaserMount[], fractional: boolean): number;  // H6.21
function maxWarpMovePoints(warpEnergy: number, moveCost: number): number;         // min(floor(e/cost),30) C2.112

// --- The legality validator (the heart of the referee) ---
interface ValidationResult { ok: boolean; errors: BalanceError[]; warnings: BalanceWarning[]; }
function validateAllocation(s: ShipPowerState, col: EafColumn): ValidationResult;

// --- Reserve / contingent (sequence-aware) ---
function validateReserveDischarge(s: ShipPowerState, req: DischargeReservePowerPayload,
  seq: { impulse: number; step: SequenceStep }): ValidationResult;               // H7.3/H7.5
function resolveContingent(s: ShipPowerState, c: ContingentAlloc, suppliedFromReserve: number): ShipPowerState;

// --- Folds & lifecycle ---
function foldEnergyAllocated(s: ShipPowerState, e: EnergyAllocated): ShipPowerState;
function endOfTurnRecharge(s: ShipPowerState): ShipPowerState;                   // Repair Stage; strips reserve-warp status (H7.36)
function revealWhenAllLocked(gameId: string, turn: number): Promise<OrdersRevealed | null>;
```

`validateAllocation` is invoked twice: client-side live (advisory totals) and server-side at reveal
(authoritative). Only the server result can emit `EnergyAllocated`.

## Validation & Enforcement Rules

The referee rejects any column failing these checks (hard errors → `ok:false`, allocation cannot be
committed). All are AUTOMATED:

1. **Production identity:** `line4 == line1+line2+line3`, each line = unchecked boxes of that bank.
2. **Battery conservation:** `line5+line6 == Σ undestroyed battery boxes`; `line21 <= line5`;
   destroyed cells are assumed to be previously-discharged ones first (H5/D-section).
3. **Life support mandatory:** `line7 == lifeSupportCost(s)` (SC1=3, SC2=1.5, SC3=1, SC4=0.5, SC5=0).
   Auto-switch to emergency (cost 0) when `crippled || !hasEAControl || insufficient power`. It can
   **never** be voluntarily zeroed to kill boarders.
4. **Balance / no over-allocation:** `line20 == Σ(line7..line19)` and
   `line20 <= line4 + batteryDrawn`, where `batteryDrawn == line21`. This is the "must balance,
   cannot over-allocate" rule (B3.4). Under-allocation is **legal but flagged** — surplus engine
   power is *not* reserve (B3.4); a warning suggests routing it to `line16` to keep flexibility.
5. **Type gating** (the typed-energy contract):
   - Warp-required functions (HET, speed >1 hex/turn, warp-TM, photon arm/overload, displacement,
     suicide shuttle — H2.2) paid only with `warpEngine`/`warpReactor`.
   - Movement-related functions paid only with `warpEngine` or `impulse` — never AWR/APR/battery
     (except reserve-warp-engine / reserve-impulse, H7.45/H7.47).
   - `line14.impulsePoint <= 1` (H3.4); warp MP capped at 30 (C2.112).
6. **Capacitor room:** `line9` accepted only while `charge + line9 <= capacity` (H6.21). Phaser
   energy is the lone always-carries-over store (B3.1 NOTE).
7. **Reserve ceiling:** total committed reserve (battery + reserve-warp + reserve-impulse) `<= Σ battery capacity` (H7.113).
8. **Reserve timing/use:** mid-turn discharge legal only at its sequence point; prohibited for damage
   control, repair, EDR, and braking (H7.35/C3.53); cannot re-arm or re-fire a weapon already fired
   this turn (H7.531); multi-turn weapons started by reserve carry an 8-impulse fire lockout (H7.532);
   post-damage reserve (H7.134) may **only** add shield reinforcement (general in 2-pt increments) or
   raise PA-panel level — not raise shield level.
9. **Contingent forfeiture:** unmatched partial allocations are lost at end of turn; partial overload
   irrevocably overloads the weapon; contingent power may not feed continuous-supply systems (H7.63/H7.64).

**GM-override points:** any line value, the balance verdict, life-support mode, capacitor capacity,
or a reserve-legality rejection may be overridden via `GmOverrideApplied` (house rules / edge cases),
recorded immutably.

## UI Contract

The client renders the **Energy Allocation Form screen** specified in `D3-energy-allocation-ui.md`
(wireframe: `docs/spec/wireframes/D3-energy-allocation.svg`). Contract:

- Server pushes, per controlled ship: production lines 1–4, life-support line 7, battery state 5/6,
  capacitor capacity/charge, and a list of allowable target functions with their unit costs.
- Lines 8–19 are editable; lines 4/20/21 are read-only and **recompute live** from a client-side
  call to `validateAllocation`. A prominent balance meter shows **green (balanced)** /
  **amber (under-allocated, surplus not reserved)** / **red (over-allocated/illegal)**; commit is
  blocked while red.
- **Secret simultaneous submit:** a single **Lock** action seals all of that side's ships
  (`SubmitSealedOrders`). Opponents see only a per-ship "locked" badge (fog-of-war); raw EAF values
  are never sent to other clients during play. Full EAFs are disclosed only at game end (B3.5 audit)
  or on capture (D7.503).
- Mid-turn, a compact **reserve drawer** lets the player discharge/transfer battery power at legal
  sequence steps; per H7.37 use need not be announced, so opponents see only the manifested effect.

## Dependencies

- `A3-data-architecture-event-store.md` — append-only log, snapshot fold, command→event pipeline.
- `A4-realtime-sync-layer.md` — generic hash-commit sealed-order store + reveal-when-all-locked; this doc supplies the energy payload.
- `E1-dice-rng-service.md` — determinism contract (EA itself is dice-free).
- `B3-game-catalog-ssd-model.md` — box counts, size class, movement cost, phaser fit (source of truth for production).
- `C1-sequence-of-play-engine.md` — places EA as Phase 1; 32-impulse clock; Repair Stage recharge timing.
- `C3-movement-engine.md` — consumes `line14`; owns speed determination, HET/TM/EM and the MP caps.
- `C4-direct-fire-combat.md` — phaser capacitor consumers; photon arming/overload costs.
- `C5-seeking-weapons.md` — fire-control requirement for drone control (`line8`).
- `C7-damage-criticals-repair.md` — destroyed boxes, end-of-turn production cutoff (D4.223), D22 energy balance due to damage.
- `C7-damage-criticals-repair.md` — shield + reinforcement costs (lines 11–13).

This subsystem **services** essentially every C-doc (it funds their actions) while **building on** the A-foundation and B1 data model.

## Edge Cases & Open Questions

- **No carry-over, with four exceptions:** only phaser capacitor, batteries, multi-turn-arming
  weapons, and held armed weapons persist across the turn boundary (B3.1 NOTE); `endOfTurnRecharge`
  resets everything else and strips reserve-warp/impulse typing (H7.36) — except 2nd-Gen X-batteries [v3].
- **Destroyed batteries lose power immediately** (H7.38), unlike other systems which stop producing at
  end of turn (D4.223) — batteries are prime hit-and-run targets; resolved against live state, not the EAF.
- **Mixed-type battery fractions** (H7.40) require per-cell `storedTypes`; the validator must pick the
  legal-typed fraction when a reserve point pays a typed function.
- **Energy Balance due to Damage** (D22.0/D22.15) is the *only* path to withdraw capacitor energy for a
  non-phaser purpose; it lives in `C7-damage-criticals-repair.md` and calls back into this engine.
- **Open:** exact persisted numbering of lines 12/13 and the misc line 19 should be confirmed against a
  physical EAF artifact (B3.1 reconstructed). **Open:** whether the live balance meter should hard-block
  or merely warn is settled here as *hard-block on imbalance, warn on under-allocation* — confirm in UX review.
- **Open:** precise "secret & simultaneous" wording is implied by B3.5 + the no-announcement rules
  (H7.37/H7.44); the Sequence-of-Play annex (referenced by `C1`) should be cross-checked for the canonical phrasing.

## Testing

- **Production & balance:** Fed CA undamaged → line4 = 34 (30 warp boxes at ×2 internal = 15, +0 APR…
  per SSD), life support (SC? ) deducted; assert `validateAllocation` flags any column where line20 ≠ Σ.
- **Capacitor capacity:** Fed CA (6× ph-1) → 6; Kzinti CV (5 ph-1 + 11 ph-3 = 10.5) → 11 standard,
  **10.5** with fractional accounting (B3.2); Klingon D7 (9× ph-2) → 9.
- **Life support chart:** parametrized test SC1=3 … SC5=0; crippled ship auto-emergency cost 0 (S2.4).
- **The energy cycle (reserve-warp-engine):** Fed CA discharges all 4 batteries in EA for non-warp
  systems, allocates 4 warp to `line16` → 4 points of flexible reserve-warp-engine power usable mid-turn
  for movement increase / photon overload (H7.41 worked example).
- **Fractional accounting:** Klingon C8 move 1.5 + ph-3 fire 0.5 = exactly 2 points (vs 3 rounded);
  battery may hold 2/3 but not 1-1/3 (B3.21).
- **Reserve legality:** assert post-damage reserve (H7.134) accepts only shield reinforcement / PA-panel
  raises and rejects damage-control (H7.35); assert 8-impulse lockout on reserve-started 2-turn weapons (H7.532).
- **Determinism:** re-fold the event log for a full game and assert identical `ShipPowerState`
  (no RNG dependence). Cite the rulebook H7.41 and H6.21 worked examples as golden vectors.

## Phasing

- **[v1 AM-tournament]:** full 21-line EAF; warp/impulse/APR production; standard 1-point batteries;
  phaser capacitor (integer rounding); mandatory life support; shields/reinforcement, movement, fire
  control, torpedo (photon multi-turn) allocation; reserve power core including reserve-warp-engine
  cycle and contingent reserve (H7.6) — tournament play leans heavily on HET/overload reserve gambits;
  sealed simultaneous allocation + the balance validator. Tournament uses a fixed standard-ship roster,
  so this set is complete for v1.
- **[v2]:** fractional-accounting toggle (B3.2) and exact capacitor capacity; full AWR vs APR typing and
  damage routing (H4.32); mauler battery grouping (E8.32); X-ship special battery capacities/warp-hold (H5.5).
- **[v3 full Master]:** Andromedan special EAF and 5-point batteries (D10.55); Vudar ionization surcharge
  system (H8.0); displacement-device and other specialized warp-required consumers; Module R1/C2 special EAFs;
  Legendary-Captain emergency-LS interactions (G22.2).
