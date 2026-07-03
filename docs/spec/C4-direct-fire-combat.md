# C4 — Direct-Fire Combat

## Purpose & Scope

This subsystem turns a player's intent to fire a beam/bolt weapon into a validated, deterministic result and hands the *scored damage* to the damage subsystem. It owns four jobs: (1) the firing-arc geometry of section D2 as queryable data plus an arc-membership test; (2) the shield-facing model of D3 — operating level, exposed-box exposure, and the "which shield was struck" determination of D3.4 — to the extent direct fire needs it; (3) the to-hit / damage resolution for every *direct-fire* weapon in section E (the catalog), including effective-vs-true range, die-roll modifiers, narrow salvoes, and small-target ECM; and (4) sealed fire declaration inside the correct impulse window (Segment 6D) followed by deterministic resolution. C4 does **not** decrement shield boxes, form volleys across the Damage Allocation Chart, roll critical hits, or destroy ships — it computes the `ScoredHit` (struck shield + raw damage points + direction) and passes it to `C7-damage-criticals-repair.md`. Seeking weapons (drones, plasma) are armed/launched in `C5-seeking-weapons.md`; their *impact* damage reuses C6, not C4. The headline UI deliverable is **assisted targeting**: for every (weapon, candidate target) pair the server pre-computes in-arc, in-range, exposed-shield, hit-probability and expected-damage so the client can paint targeting overlays — while every tactical choice (whether to fire, which target, overload or not, salvo grouping) remains the player's.

**PHASE:** [v1 AM-tournament] core firing pipeline + phaser/disruptor/photon/fusion/hellbore/ADD + standard arcs + struck-shield determination. [v2] mauler, tractor-repulsor, PPD, special arcs, Andromedan PA-panel targets, leaky shields. [v3] remaining section-E exotics.

## Rulebook References

- **Firing arcs:** D2.0, D2.1, D2.11 (drones/ADD unmarked), D2.2 (combined-code expansion), D2.3–D2.36 (special/hemispheric/plasma-swivel/Gorn arcs).
- **Shields (combat-facing subset):** D3.1–D3.13 (six fixed facings, #1 front), D3.21 (box decrement / DOWN), D3.31–D3.334 (operating level, 8-impulse change lock), D3.4–D3.43 (struck-shield determination + tie-break cascade), D3.54 (lock-on reveals shield status).
- **Direct-fire framework:** E1.0–E1.5 (firing window, 1/4-turn lockout, simultaneity E1.13, discharge E1.24), E1.6 (narrow salvo), E1.7 (small-target ECM), E1.8/E1.821–E1.823/E1.83 (die-roll modifiers).
- **Weapon catalog:** phasers E2 (E2.11–E2.42), disruptors E3 (chart E3.4, overload E3.5, R0 feedback E3.54), photons E4 (table E4.12, overload E4.4, proximity E4.3, min-range E4.14), anti-drones E5 (chart E5.6), fusion E7 (tables E7.31/E7.41/E7.42), maulers E8 (E8.22 range factor), tractor-repulsor E9 (E9.35/E9.36), hellbores E10 (E10.32 chart, enveloping E10.41, DF mode E10.7, overload E10.6), PPD E11 (E11.32 chart, wave-lock E11.31/E11.33, splash E11.35).
- **Ties to other sections:** D1.4 (true vs effective range), D6.124 (lock-on), D6.126 (overload true-range cap), C1.313 (movement precedence for D3.41 ties).

## Domain Model

Hex/coordinate primitives (`CubeHex`, `Heading`, distance, bearing) are imported from `C3-movement-engine.md`; live ship/weapon-instance state lives in the ship aggregate folded by `C7-damage-criticals-repair.md`. C4 owns the **static reference catalog** (weapon definitions + charts) and the transient **fire-declaration** records.

```ts
// ---- Arc geometry (D2) ----
type Heading = 1 | 2 | 3 | 4 | 5 | 6;                 // hex directions A–F internally
type BaseArc = 'LF' | 'RF' | 'R' | 'L' | 'RR' | 'LR'; // six 60° wedges (D2.1)
type SpecialArcId =
  | 'FH' | 'RH'                  // hemispheres (D2.31)
  | 'LP' | 'RP' | 'FP'          // plasma swivel mounts (D2.34)
  | 'AP' | 'LPR' | 'RPR'        // Gorn reverse-swivel pod (D2.36)
  | 'KL+' | 'KL-';              // Klingon wing +/- hex patterns (D2.32/D2.33)
type WeaponArc =
  | { kind: 'base'; arcs: BaseArc[] }        // standard or combined-code union
  | { kind: 'special'; id: SpecialArcId };   // hex-pattern arcs (v2)

// Combined-code → base-arc union (D2.2). Single base arcs map to themselves.
const ARC_EXPANSION: Record<string, BaseArc[]> = {
  FA: ['RF', 'LF'],                 // front
  FX: ['L', 'LF', 'RF', 'R'],       // front expanded
  RA: ['LR', 'RR'],                 // rear
  RX: ['L', 'LR', 'RR', 'R'],       // rear expanded
  RS: ['RF', 'R', 'RR'],            // right side
  LS: ['LF', 'L', 'LR'],            // left side
};

// ---- Shields (D3, combat-facing subset) ----
type ShieldFacing = 1 | 2 | 3 | 4 | 5 | 6;            // #1 is always front of the target
type ShieldLevel = 'off' | 'min' | 'full';
interface ShieldState {                               // read from ship aggregate (C6)
  facing: ShieldFacing;
  maxBoxes: number;
  currentBoxes: number;            // 0 ⇒ DOWN (D3.21)
  level: ShieldLevel;
  dropped: boolean;                // D3.5
  specificReinfBoxes: number;      // D3.342 (consumed in C6)
}

// ---- Direct-fire weapon catalog (section E) ----
type ResolutionModel = 'range-of-effect' | 'hit-or-miss' | 'proportional';
// range-of-effect: phaser, fusion, TR  (die-vs-range → variable points; E1.822)
// hit-or-miss:     photon, disruptor, hellbore, PPD wave-lock (vs hit#; E1.821)
// proportional:    mauler (energy × range factor, auto-hit; E1.823/E8.22)

type WeaponClass =
  | 'phaser-1' | 'phaser-2' | 'phaser-3' | 'phaser-4' | 'phaser-G'
  | 'disruptor' | 'photon' | 'add' | 'fusion'
  | 'mauler' | 'tr-heavy' | 'tr-light' | 'hellbore' | 'ppd';

type LoadVariant =
  | 'std' | 'overload' | 'suicide' | 'proximity'
  | 'uim' | 'derfacs' | 'enveloping' | 'direct-fire' | 'alt-hexside';

interface WeaponDef {
  class: WeaponClass;
  resolution: ResolutionModel;
  defaultArc: WeaponArc;
  maxRangeStd: number;             // disruptor: per-class, see Annex 8A (openQ)
  maxRangeOverload?: number;       // 8 for disruptor/photon/fusion/hellbore (D6.126)
  minTrueRange: number;            // photon=2 (E4.14), PPD=4 (E11.35), else 0
  armEnergy: number;               // per shot / per charge step
  armEnergySource: 'any' | 'warp'; // photon arming requires warp (E4.23)
  armTurns: 1 | 2;                 // photon/hellbore/TR/PPD = 2 (consecutive)
  holdable: boolean;
  holdCostPerTurn?: number;
  canOverload: boolean;
  overloadAddEnergy?: number;
  fireRateImpulses: number;        // 8 = 1/4-turn lockout (E1.52)
  shotsPerTurn: number;            // gatling = 4 (E2.151)
  ignoresEW?: boolean;             // ADD (E5.15)
  separateVolley?: boolean;        // enveloping hellbore, PPD (own DAC volley)
  splash?: boolean;                // PPD, enveloping hellbore (multi-shield)
  chartId?: string;               // FK → WeaponChart
  phase: 'v1' | 'v2' | 'v3';
}

interface RangeBand { minTrue: number; maxTrue: number; label: string; }
interface WeaponChart {
  id: string;
  dieSize: 1 | 2;                  // 1d6 or 2d6 (hellbore/PPD/mauler = 2d6)
  variant: LoadVariant;
  bands: RangeBand[];
  // hit-or-miss:
  hitNumber2d?: number[];         // per band: total ≤ value ⇒ hit (2d6)
  hitBand1d?: [number, number][]; // per band: die in [lo,hi] ⇒ hit (1d6)
  fixedDamage?: number[];         // per band (hit-or-miss)
  feedbackR0?: number[];          // R0 overload feedback to firer's facing shield
  // range-of-effect:
  effectGrid?: number[][];        // effectGrid[die-1][bandIndex] → damage points
  // splash (PPD / enveloping): handled by distributeSplash() in C6 hand-off
}

// ---- Fire declaration (sealed → revealed) ----
type FireSegment = '6D-ppd' | '6D-hellbore-1' | '6D-direct' | '6D-aegis' | '6D-hellbore-2';
type ArmingStatus = 'normal' | 'overload' | 'suicide' | 'proximity' | 'uim' | 'derfacs' | 'low-power';

interface FireIntent {
  firerShipId: string;
  weaponInstanceId: string;
  targetRef: TargetRef;            // ship | seekingWeapon | shuttle | wasteHex (E1.17)
  armingStatus: ArmingStatus;
  lowPowerMode?: 'as-ph3' | 'as-ph2' | 'as-ph1';   // E2.25
  narrowSalvoGroupId?: string;     // E1.6 (single type, single target, single impulse)
  segment: FireSegment;
}

// ---- Outputs ----
interface ScoredHit {                // C4 → C6 hand-off object
  targetId: string;
  struckShield: ShieldFacing;
  direction: { fromHex: CubeHex };   // for D4.321 phaser-direction restriction in C6
  rawDamagePoints: number;           // pre-shield; C6 subtracts reinf→shield→armor
  contributingWeaponId: string;
  separateVolley: boolean;           // forces own DAC volley (hellbore/PPD)
  splashPlan?: SplashElement[];      // PPD / enveloping hellbore shield spread
}
```

**Mongoose schema sketch** (static reference data, seeded once; not per-game):

```ts
const WeaponChartSchema = new Schema({
  _id: String,                          // e.g. 'disruptor.overload'
  dieSize: { type: Number, enum: [1, 2] },
  variant: String,
  bands: [{ minTrue: Number, maxTrue: Number, label: String }],
  hitNumber2d: [Number], hitBand1d: [[Number]],
  fixedDamage: [Number], feedbackR0: [Number],
  effectGrid: [[Number]],
}, { collection: 'weaponCharts' });

const WeaponCatalogSchema = new Schema({
  _id: String,                          // weaponClass id
  resolution: String, defaultArc: Schema.Types.Mixed,
  maxRangeStd: Number, maxRangeOverload: Number, minTrueRange: Number,
  armEnergy: Number, armEnergySource: String, armTurns: Number,
  holdable: Boolean, holdCostPerTurn: Number,
  canOverload: Boolean, overloadAddEnergy: Number,
  fireRateImpulses: { type: Number, default: 8 },
  shotsPerTurn: { type: Number, default: 1 },
  ignoresEW: Boolean, separateVolley: Boolean, splash: Boolean,
  chartId: { type: String, ref: 'weaponCharts' },
  phase: { type: String, enum: ['v1', 'v2', 'v3'] },
}, { collection: 'weaponCatalog' });
```

Sealed `FireIntent[]` are hash-committed in **Redis** (per `A4-realtime-sync-layer.md`), not Mongo; only the resolved `FireDeclared`/`WeaponFired` events are persisted to `gameEvents`.

Sample catalog rows (numeric facts from section E; full phaser grids are imported separately — see Open Questions):

```ts
// disruptor.std (E3.4):  bands 0|1|2|3-4|5-8|9-15|16-22|23-30|31-40
{ id:'disruptor.std', dieSize:1, variant:'std',
  hitBand1d:[null,[1,5],[1,5],[1,4],[1,4],[1,4],[1,3],[1,2],[1,2]],
  fixedDamage:[0,5,4,4,3,3,2,2,1] }
// disruptor.overload (E3.5): max true range 8
{ id:'disruptor.overload', dieSize:1, variant:'overload',
  hitBand1d:[[1,6],[1,5],[1,5],[1,4],[1,4],null,null,null,null],
  fixedDamage:[10,10,8,8,6,0,0,0,0] }
// photon.std (E4.12): 0-1|2|3-4|5-8|9-12|13-30, 8 dmg all bands
{ id:'photon.std', dieSize:1, variant:'std',
  hitBand1d:[null,[1,5],[1,4],[1,3],[1,2],[1,1]], fixedDamage:[8,8,8,8,8,8] }
// hellbore.std enveloping (E10.32): hit# 2d6, base on weakest shield
{ id:'hellbore.envelop', dieSize:2, variant:'enveloping',
  hitNumber2d:[11,10,9,8,7,6,5], fixedDamage:[20,17,15,13,10,8,4] }
// ppd.std (E11.32): per-pulse 2d6 wave-lock, splash 1+4+1 etc.
{ id:'ppd.std', dieSize:2, variant:'std',
  hitNumber2d:[null,9,8,7,6,5,4], fixedDamage:[0,6,5,4,3,2,1] }
```

## Events & Commands

**Commands consumed** (validated by C4, then emit events):

- `SubmitSealedOrders { firerShipId, intents: FireIntent[], commitHash }` — sealed fire list for the impulse (fog-of-war preserved; only the hash is broadcast until reveal).
- `DeclareFire { intent: FireIntent }` — async/single-weapon path; produces a `FireDeclared`.
- `DischargeWeapon { weaponInstanceId, reason }` — dump a loaded weapon that will not fire (E1.24); does **not** count as firing for the rate clock (except fusion suicide E7.412).
- `ApplyGmOverride { target, value, reason }` — see override points below.

**Events emitted** (past-tense, appended to `gameEvents`):

- `OrdersSealed { firerShipId, commitHash, impulse, segment }`
- `OrdersRevealed { firerShipId, intents, impulse }`
- `FireDeclared { weaponInstanceId, targetRef, armingStatus, effectiveRange, trueRange, segment }`
- `DiceRolled { weaponInstanceId, rolls: number[], rngCursor }` — every die comes from the seeded service (`E1-dice-rng-service.md`) so replays match.
- `WeaponFired { weaponInstanceId, hit: boolean, struckShield, direction, rawDamagePoints, appliedModifier, feedbackToFirer? }`
- `ShotMissed { weaponInstanceId, dieResult, hitThreshold }`
- `WeaponDischarged { weaponInstanceId, energyDumped }`
- `GmOverrideApplied { target, value, reason }`

`WeaponFired` is the hand-off trigger: its `ScoredHit` payload is consumed by C6, which emits `DamageAllocated` after volley formation + DAC. C4 never emits `DamageAllocated`.

## Engine / API

Pure functions where possible (all randomness injected via `DiceService`):

```ts
// Arc geometry (D2) — deterministic, pure
function expandArc(arc: WeaponArc): BaseArc[] | { special: SpecialArcId };
function isInArc(firer: CubeHex, heading: Heading, target: CubeHex, arc: WeaponArc): boolean;
//   boundary hexes (exactly on a bounding hex row) count as in-arc (D2.1)

// Range (D1.4 / D6.126)
function inRange(def: WeaponDef, trueRange: number, overloaded: boolean): boolean;

// Struck shield (D3.4) — may return an ambiguity needing tie-break
type StruckShieldResult =
  | { resolved: ShieldFacing }
  | { ambiguous: 'hexside' | 'same-hex' | 'fallthrough'; candidates: ShieldFacing[] };
function struckShield(firer: CubeHex, target: CubeHex, targetHeading: Heading): StruckShieldResult;
function resolveAmbiguousShield(                       // D3.41/D3.42/D3.43 cascade
  res: StruckShieldResult, ctx: TieBreakContext): ShieldFacing;

// To-hit / damage resolution (E1.8 + per-weapon)
interface ToHitContext {
  weaponInstanceId: string; def: WeaponDef; chart: WeaponChart;
  effectiveRange: number; trueRange: number;     // from C7-fire-control-ew
  ecmDieMod: number;                             // EW points (D6.3)
  smallTargetEcm: number;                        // E1.7 band lookup
  legendaryOfficerMod: number;                   // E1.812 (−1)
  crewQualityMod: number;                        // G21
  overloaded: boolean;
}
function resolveToHit(ctx: ToHitContext, dice: DiceService): ToHitResult;
function applyDieModifier(model: ResolutionModel, die: number, mod: number,
  chart: WeaponChart, bandIdx: number): { die: number; bandIdx: number; miss: boolean }; // E1.821-83
function resolveNarrowSalvo(group: FireIntent[], ctx: ToHitContext[], dice: DiceService): ToHitResult[]; // E1.6
function smallTargetEcmPoints(targetClass: SmallTargetClass, effRange: number): number; // E1.7 table

// Assisted targeting (UI) — pure, recomputed each impulse
function computeTargetingAssist(
  firer: ShipState, weapons: WeaponInstance[], candidates: TargetRef[],
  fireControl: FireControlSnapshot): TargetingAssist[];

// Orchestration
function validateDeclareFire(cmd: DeclareFire, state: GameState): ValidationResult;
function resolveSegment(state: GameState, segment: FireSegment, dice: DiceService):
  { events: GameEvent[]; scoredHits: ScoredHit[] };   // ordered per E11.31
```

`resolveSegment` walks Segment 6D in the fixed order (PPD → first hellbore option → direct-fire step → Aegis → second hellbore option), resolving simultaneous mutual fire (E1.13) by computing **all** `ToHitResult`s before any `ScoredHit` is forwarded to C6.

## Validation & Enforcement Rules

The server is the authoritative referee. `validateDeclareFire` blocks an illegal declaration with a typed error and never mutates state; legal declarations proceed to deterministic resolution.

- **Arc legality (D2.0):** `isInArc` must be true for the weapon's instance arc; combined codes expanded via `ARC_EXPANSION`; special arcs use their hex-pattern predicate (v2). Drones/ADD are unmarked (D2.11) — ADD uses a 360° field (E5.13) and skips this check.
- **Range legality:** `trueRange ≤ maxRangeStd`; overloaded weapons capped at `maxRangeOverload` (8, true range; D6.126); below `minTrueRange` is illegal unless an overload R0/R1 exception applies (disruptor E3.54, photon/hellbore overload feedback).
- **Fire window (6D):** the declaration's `segment` must match the weapon class — PPD only in `6D-ppd`, enveloping hellbores only in a hellbore option, everything else in `6D-direct` (E11.31). Declarations outside the impulse's active 6D step are rejected.
- **Rate clock (E1.5):** reject if `currentImpulse − lastFiredImpulse < fireRateImpulses` (8). Gatling phasers allow ≤4 shots/turn and ≤4 per 1/4-turn window (E2.151). Once-per-turn enforced via `firedThisTurn` for non-gatling.
- **Energy & arming:** weapon must be armed/loaded with the energy committed in `C2-energy-allocation-power.md`; arming source honored (photon = warp, E4.23); overload requires the extra energy actually allocated; unfired hit-or-miss bolts that cannot hold are lost, not carried.
- **Fire control (D6.124):** lock-on required where the weapon demands it (maulers need *active* FC, E8.15); effective vs true range supplied by `C8-ew-sensors-cloak.md`. C4 does not compute EW itself.
- **Struck shield (D3.4):** computed server-side; the **ambiguous fall-through (D3.43-C3)** default lets the *target owner* pick the struck shield, locked from first request until the next impulse, decided separately per firing ship. The "advance one hex forward" geometry for hexside ties (D3.41) and the entry-order rule for same-hex (D3.42) use movement precedence from `C3-movement-engine.md` (C1.313).
- **GM-override points (`GmOverrideApplied`):** force hit/miss; override the struck shield (overrides the D3.43 default); waive arc/range/min-range; substitute a die result or raw damage; permit an out-of-window shot. Every override is a recorded event carrying `{target, value, reason}`.

Automated vs player decision: C4 **automates** arc/range/window/rate/energy legality, all die-modifier math, ECM band lookup, struck-shield geometry, and damage-table lookup. The **player decides** whether/what/where to fire, overload vs normal, low-power mode, narrow-salvo grouping, and — in true D3.43 ambiguity — the struck shield.

## UI Contract

The client consumes the per-impulse `TargetingAssist[]` to drive the battle-map fire layer (wireframe: `wireframes/D5-targeting-combat.svg`; map host spec: `D1-map-board-ui.md`):

```ts
interface TargetingAssist {
  weaponInstanceId: string; targetId: string;
  inArc: boolean; trueRange: number; effectiveRange: number; inRange: boolean;
  struckShield: ShieldFacing | 'ambiguous';
  shieldRemaining: number;        // exposed boxes on the facing the line will strike
  shieldDown: boolean;
  hitProbability?: number;        // hit-or-miss weapons (from chart band)
  expectedDamage: number;         // EV after shield, for ranking targets
  fireRateReady: boolean;         // 8-impulse lockout cleared
  energyReady: boolean;           // armed/loaded
  overloadAvailable: boolean;
}
```

The map renders: (a) **arc wedges** per selected weapon (six-sextant overlay, special arcs as hex patterns); (b) **range rings** at each weapon's max and overload-cap range; (c) **exposed-shield highlight** — the target facing the firing line will strike, tinted by `shieldRemaining`/`shieldDown`; (d) a **target table** sorted by `expectedDamage`. The **fire-declaration panel** lets the player toggle overload/proximity/low-power, drag weapons into a narrow-salvo group, and sees the current 6D sub-step. Declarations submit as sealed orders; the client never receives the opponent's sealed intents (fog-of-war), only its own. Shield operating level/status of an enemy is shown only when lock-on exists (D3.54).

## Dependencies

- `C1-sequence-of-play-engine.md` — defines Segment 6D and its sub-steps; C4 fires only inside it.
- `C3-movement-engine.md` — `CubeHex`, `Heading`, distance/bearing helpers; movement precedence (C1.313) for D3.41/D3.42 shield ties.
- `C2-energy-allocation-power.md` — arming energy, overload energy, shield/reinforcement energy committed at Energy Allocation; C4 checks it is paid.
- `C5-seeking-weapons.md` — drones/plasma arming + launch; ADD targets seeking weapons; PPD consumes a seeking-weapon control channel.
- `C7-damage-criticals-repair.md` — **the damage subsystem**: receives `ScoredHit`, does reinforcement→shield→armor penetration, volley grouping, DAC, criticals (D8), destruction (D4.4).
- `C8-ew-sensors-cloak.md` — lock-on, effective-vs-true range, EW/ECM die modifiers, small-target classes, scout EW lending.
- `B3-game-catalog-ssd-model.md` — the per-ship **weapon mounts + firing arcs** (and system box set) this engine's in-arc test and resolution read. **Provenance:** no authoritative external arc dataset exists (confirmed by search); arcs are extracted from the SSDs and verified by the B4 systems-consistency audit — a ship cannot be fielded until that audit is clean.
- `E1-dice-rng-service.md` — seeded `DiceService` for replay-exact rolls; `A3-data-architecture-event-store.md` — `gameEvents`/snapshots; `A4-realtime-sync-layer.md` — sealed-order hash-commit store.
- `B1-rules-content-api.md` — deep-links each validation message to its rule number for verified owners.

## Edge Cases & Open Questions

- **Phaser damage grids absent from section E.** ph-1/2/3/4 die-vs-range tables live on the SSDs / Master Weapons Chart, not the E text (only anchor points: ph-1 die=1 → 8 @ true R1, 6 @ effective R3; E2.411/E2.412). The full grids must be imported into `weaponCharts` before v1 ships.
- **Disruptor max range varies by ship class** (Annex 8A); `maxRangeStd` must be set per *instance*, not per class — needs that table imported.
- **Overload warhead values** beyond the E4.413 photon table reference the Master Weapons Chart; confirm full overload damage import.
- **PPD wave-lock re-roll triggers (E11.5)** — EW shifts, range changes, cloaking (E11.473) can break a lock; the precise trigger list must be enumerated for the pulse scheduler (v2).
- **Andromedan targets have no shields** (PA panels, D10); struck-shield determination is bypassed and maulers/TR/PPD splash interact with panels — deferred with mauler/TR to v2.
- **Simultaneity (E1.13):** two ships firing on each other in one impulse compute both results before either takes damage — `resolveSegment` must batch `ScoredHit`s, not stream them.
- **Discharge (E1.24)** is observable and announced; the dumped energy amount is public but discharging is not "firing" for the rate clock (except fusion suicide-overload E7.412).
- **Narrow-salvo legality (E1.6):** same single type, one target, one impulse, one volley; different phaser types may share a die against their own tables; proximity+non-proximity photons cannot combine; seeking weapons and PPDs cannot salvo (E11.38). ADD salvo is special (E1.635): one hit die, then a separate damage die per hitting ADD.

## Testing

- **Arc membership:** unit-test `isInArc` for all 6 headings against a ring of targets at each clock position; assert boundary hexes register in **both** adjacent arcs (D2.1); verify combined-code expansion (FA/FX/RA/RX/RS/LS) matches D2.2 exactly.
- **Struck shield:** golden cases for direct-fire line crossing (D3.402), the "advance one hex forward" hexside tie (D3.41), and same-hex entry order (D3.42); assert D3.43 fall-through yields a target-owner decision request, not an auto-pick.
- **Range-of-effect modifier (E1.822):** reproduce the worked example — ph-1 at R3 with +3 modifier and a natural die of 4 bumps die 4→6 (two shifts) then +1 range column to R4, reading die6/R4; assert a negative modifier never drops below die 1 or shifts to a lower column (E1.83).
- **Hit-or-miss (E1.821):** disruptor.std chart — die within `hitBand1d` for the band hits for `fixedDamage`; modifier pushing the die above the band's high bound misses; overload caps at true R8.
- **Worked phaser anchors:** ph-1 die=1 → 8 @ true R1 and 6 @ effective R3; ph-3 die=2 @ R3 → 2 (E2.411/E2.412) once grids are imported.
- **Hand-off:** assert `WeaponFired` for an enveloping hellbore/PPD sets `separateVolley:true` and a `splashPlan`, and that C6 forms an independent DAC volley (Mizia behavior).
- **Determinism:** replay a recorded `gameEvents` slice through `resolveSegment` with the same seed cursor and assert byte-identical `DiceRolled`/`WeaponFired` output.

## Phasing

- **[v1 AM-tournament]** Standard six-arc geometry + combined codes (FA/FX/RA/RX/RS/LS); shield-facing model, operating-level read, and struck-shield determination incl. D3.41/D3.42 ties and the D3.43 target-owner fall-through; the full to-hit pipeline (effective-vs-true range, E1.8 modifiers, narrow salvo E1.6, small-target ECM E1.7); weapons **phaser-1/2/3/G, disruptor (std+overload+UIM/DERFACS), photon (std+overload+proximity), fusion (std+overload+suicide), hellbore (direct-fire + enveloping + overload), ADD**; sealed declaration in Segment 6D with simultaneity; assisted-targeting overlays; full GM override. Rationale: this covers the Federation/Klingon/Kzinti/Lyran/Hydran tournament matchups end-to-end.
- **[v2]** mauler (proportional model + battery accounting), tractor-repulsor (E9), PPD (4-impulse pulse scheduler + control channel + splash) to enable the ISC tournament cruiser, special arcs (Klingon ± hexes, Gorn pod, plasma swivel), Andromedan PA-panel targets, leaky shields (D3.6). Deferred because each needs an adjacent subsystem (control channels, Andromedan power model) that is not on the v1 critical path.
- **[v3]** remaining section-E exotics (web caster E12, snare E13, shield cracker E16, particle cannons E17, warp-augmented rail gun E18, monster close-in E6) for full Master Rulebook coverage.
