# C8 — Electronic Warfare, Sensors & Cloaking

## Purpose & Scope

This subsystem owns the **information state** of every game: what each side is allowed to *know*, what each unit can *target*, and how electronic warfare warps both. It models sensor lock-on (D6.1), the scanner/sensor effective-range pipeline (D6.2), ECM/ECCM generation and the net-shift math (D6.3), fire-control mode (active / passive / inactive / disrupted / low-power, D6.6–D6.7), AEGIS sequential fire control (D13), passive fire control (D19), the graduated Tactical Intelligence "what you can see" ladder (D17), cloaking (G13), and hidden deployment (D20). It is the single authority for **server-enforced fog of war**: it computes, per `(observer, target)` pair, the masked view each client is permitted to receive, and it supplies the to-hit / detonation / detection shifts that the combat and seeking-weapon engines apply. It automates all dice, caps, timers, and masking; it never makes a tactical choice (how much ECM to buy, whether to activate fire control, when to cloak, what to scan) — those remain player decisions.

**PHASE:** Sensor lock-on, the effective-range pipeline, ECM/ECCM net-shift, fire-control modes (active/inactive/disrupted), AEGIS, and the Tactical-Intelligence visibility model with public-EW broadcast are **[v1 AM-tournament]**. Cloaking (G13), scout special-sensor channels and lent/offensive EW (G24), low-power & passive fire control (D6.7/D19), Tac-Intel deception (D17.6–.8), and hidden deployment (D20) are **[v2]**/**[v3 full Master]**.

## Rulebook References

- (D6.1, D6.11–D6.135) Sensors & lock-on; sensor rating, one-roll-per-turn, per-target re-rolls.
- (D6.12, D6.121–D6.127) Effects of failing to lock-on; no-lock range doubling; lock-on-required system list (D6.124).
- (D6.2, D6.21–D6.23) Scanner adjustment factor; effective-range computation; scanner-immune systems.
- (D6.3, D6.31–D6.317) EW generation, source categories, caps, circuits, reserve power.
- (D6.32, D17.194) EW announcement; EW levels are public state.
- (D6.34–D6.35) Net ECM shift (integer-sqrt table); direct-fire shift via (E1.8).
- (D6.36, D6.361–D6.364) Seeking-weapon Proximity of Detonation.
- (D6.37, D6.371–D6.373, D6.38) EW on tractors/transporters/SFGs; EW-immune systems.
- (D6.6, D6.61–D6.68) Fire-control modes, 1-pt cost, 4-impulse activation delay, disrupted FC.
- (D6.7, D6.71–D6.73) Low-power fire control (LPFC).
- (D13.0, D13.1–D13.5) AEGIS sequential fire control; 4/2 firings; seeking-weapon ID.
- (D17.0, D17.21–D17.26, D17.3–D17.5) Tactical Intelligence levels A–M, range chart, EW shift, prolonged observation, always/never-known fields.
- (D19.0, D19.1–D19.3) Passive fire control; (D20.0–D20.3) Hidden deployment.
- (G13.0–G13.6) Cloaking device; (E1.7) small-target ECM; (E1.8) direct-fire die-roll shift.

## Domain Model

```ts
type UnitId = string;
type Impulse = number;                        // 1..32 within a turn
type FireControlMode = 'active' | 'passive' | 'inactive' | 'disrupted' | 'lpfc';

// --- Damage tracks that feed the range pipeline (sourced from B3-game-catalog-ssd-model.md) ---
interface SensorTrack { boxes: boolean[]; }   // true = undestroyed; rating = index of highest true box +1
interface ScannerTrack { boxes: boolean[]; }  // factor = lowest undestroyed box value (start 0)

// --- Fire control state machine (D6.6) ---
interface FireControlState {
  mode: FireControlMode;
  powerAllocated: number;                     // 1 (active) | 0.5 (lpfc) | 0
  activationAnnouncedImpulse?: Impulse;       // when 'active' requested
  activationFunctionalImpulse?: Impulse;      // announce + 4 (D6.611)
  disruptedUntilImpulse?: Impulse;            // disruption + 4 (D6.68)
  pfcBenefitActive: boolean;                  // +2 natural ECM (D19.31)
  impulsesWithoutActiveFc: number;            // counter toward 32 for PFC bonus
}

// --- Lock-on (D6.1) ---
interface LockOnState {
  hasGeneralLockOn: boolean;                  // covers every eligible target
  perTargetOverride: Record<UnitId, boolean>; // cloak/terrain exceptions only (D6.113, G13.33)
  currentSensorRating: number;                // recomputed from SensorTrack, default 6
  lockOnRollMadeThisTurn: boolean;            // one general roll per turn (D6.11)
}

// --- EW ledger: typed points by source category (D6.314) ---
interface EwLedger {
  selfEcm: number; selfEccm: number;          // self+self <= sensorRating (D6.3141)
  builtInEcm: number; builtInEccm: number;    // automatic, off-limit (D6.3142)
  naturalEcm: number;                         // terrain/EM/small-target (D6.3143, E1.7)
  lentEcm: LentPoint[]; lentEccm: LentPoint[];// cap 6 ECM & 6 ECCM combined (D6.3144)
  offensiveEcmReceived: number;               // <=6, cannot be ignored (D6.3145)
  circuits: EwCircuit[];                       // count = sensorRating
  reserveEwCommitted: number;
}
interface LentPoint { sourceId: UnitId; points: number; sourceHasLockOn: boolean; }
interface EwCircuit { assigned: 'ecm' | 'eccm' | 'free'; lastChangedImpulse: Impulse; } // 8-impulse swap cooldown

// --- AEGIS (D13) ---
interface AegisState {
  type: 'none' | 'limited' | 'full';
  active: boolean;
  activationImpulse?: Impulse;                // functional 4 impulses later
  firingsUsedThisImpulse: number;             // <=4 (full) | <=2 (limited)
  seekingIdAttemptsUsedThisTurn: number;      // <=6, full only
  weaponsUsedForAegisThisImpulse: UnitId[];
}

// --- Cloak (G13) — NOT an SSD box; a unit property ---
interface CloakState {
  active: boolean;
  fadeDirection: 'none' | 'in' | 'out';
  fadePhase: 0 | 1 | 2 | 3 | 4 | 5;           // +1 effective-range hex per phase, to +5
  energyCost: number;                         // from SSD (G13.21)
}

// --- Hidden deployment (D20) ---
interface HiddenState {
  hidden: boolean;
  secretHex: string;                          // server-only; never sent to opponent
  terrainType: string;
  longTermCloak: boolean;
}

// --- The fog-of-war output: one masked view per (observer, target) ---
interface TacIntelView {
  observerId: UnitId; targetId: UnitId;
  highestLevel: InfoLevel;                    // 'A'..'M'
  effectiveRange: number;
  revealedFields: Partial<UnitPublicState>;   // SSD attributes earned at/under highestLevel
  approxLocation?: { centerHex: string; radius: number }; // cloaked/hidden uncertainty
  netEcmShift: number; eccmShift: number;
}
type InfoLevel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M';
```

**Persistence.** Information state is a deterministic fold over `gameEvents` (see `A3-data-architecture-event-store.md`); the per-unit fields above live inside the unit document in `gameSnapshots`. The only separately-projected collection is the visibility cache, rebuilt each impulse and used to drive server-side fog filtering:

```ts
const InfoStateSnapshotSchema = new Schema({
  gameId: { type: String, index: true },
  turn: Number, impulse: Number,
  unitId: { type: String, index: true },
  fireControl: { mode: String, powerAllocated: Number, activationFunctionalImpulse: Number,
                 disruptedUntilImpulse: Number, pfcBenefitActive: Boolean, impulsesWithoutActiveFc: Number },
  lockOn: { hasGeneralLockOn: Boolean, perTargetOverride: Object, currentSensorRating: Number,
            lockOnRollMadeThisTurn: Boolean },
  ew: { selfEcm: Number, selfEccm: Number, builtInEcm: Number, builtInEccm: Number, naturalEcm: Number,
        lentEcm: [Object], lentEccm: [Object], offensiveEcmReceived: Number, circuits: [Object] },
  aegis: { type: String, active: Boolean, firingsUsedThisImpulse: Number, seekingIdAttemptsUsedThisTurn: Number },
  cloak: { active: Boolean, fadeDirection: String, fadePhase: Number },
  hidden: { hidden: Boolean, secretHex: String, terrainType: String }, // secretHex projection-excluded by default
}, { timestamps: true });
InfoStateSnapshotSchema.index({ gameId: 1, turn: 1, impulse: 1, unitId: 1 }, { unique: true });

const TacIntelVisibilitySchema = new Schema({   // derived; one row per ordered pair
  gameId: { type: String, index: true }, turn: Number, impulse: Number,
  observerId: String, targetId: String,
  highestLevel: String, effectiveRange: Number, netEcmShift: Number, eccmShift: Number,
  revealedFields: Object, approxLocation: Object,
}, { timestamps: true });
```

## Events & Commands

**Commands (PascalCase, validated before any event):**

- `SetFireControlMode { unitId, mode }` — request active/passive/inactive/lpfc; active/lpfc starts the 4-impulse delay.
- `AllocateEW { unitId, selfEcm, selfEccm }` — in Energy Allocation; each point typed at allocation (D6.31).
- `ReassignEwCircuit { unitId, circuitIndex, to: 'ecm'|'eccm' }` — rate-limited to 1/8 impulses (D6.313).
- `LendEW { sourceId, targetId, ecm, eccm }` *(v2, scout)* — see `C…` scout channels; caps at 6/6 (D6.3144).
- `RequestLockOn { unitId, targetId? }` — general roll (per turn) or per-target re-roll on terrain/cloak change.
- `DropLockOn { unitId }` — voluntary drop of the general lock-on (cannot selectively drop, D6.135).
- `ActivateAegis { unitId, level }` / `FireAegisPulse { unitId, firingId, weaponIds, targetIds }` (D13).
- `IdentifySeekingWeapon { unitId, weaponId, source: 'lab'|'aegis'|'probe'|'scout' }` (D13.32 / G4.2).
- `ActivateCloak { unitId }` / `DeactivateCloak { unitId }` *(v2)* — 5-impulse fade (G13.14/.15).
- `DeployHidden { unitId, hex, terrainType, longTermCloak? }` *(v3)* — at-start only (D20).
- `RequestTacIntel { observerId, targetId, level? }` — read; returns the masked `TacIntelView`.

**Events (past-tense, appended to `gameEvents`):**

- `FireControlModeChanged { unitId, mode, functionalImpulse?, pfcBenefitLost? }`
- `EwAllocated { unitId, selfEcm, selfEccm }` and `EwAnnounced { unitId, totals, sourceBreakdown }` — public to both sides (D6.32, D17.194).
- `EwCircuitReassigned { unitId, circuitIndex, to, impulse }`
- `DiceRolled { purpose: 'lockOn'|'proximity'|'aegisId'|'cloakAdjust'|'systemUse', seedRef, result }` (via `E1-dice-rng-service.md`).
- `LockOnRolled { unitId, rating, roll }`, `LockOnAchieved { unitId, scope: 'general'|targetId }`, `LockOnLost { unitId, scope }`.
- `NetEwComputed { firerId, targetId, targetEcm, firerEccm, netEcm, shift }` — attached to every fire/detection resolution.
- `AegisActivated { unitId, level, functionalImpulse }`, `AegisPulseFired { unitId, firingId }`, `SeekingWeaponIdentified { weaponId, by, infoLevel }`.
- `CloakEngaged { unitId }`, `CloakFadeProgressed { unitId, phase, direction }`, `CloakDisengaged { unitId }`.
- `HiddenUnitDetected { unitId, byUnitId, reason, lockOnGranted }`, `TacIntelRevealed { observerId, targetId, level, fields }`.
- `GmOverrideApplied { target, value, reason }` — see `D9-gm-spectator-console.md` (any roll/cap/level can be set).

## Engine / API

All resolvers are **pure** over a typed state slice; the only entropy source is the seeded dice service (`E1-dice-rng-service.md`), so replays match.

```ts
// --- Tracks ---
function sensorRating(t: SensorTrack): number;            // highest true box (last box never destroyed, D4.33)
function scannerAdjustment(t: ScannerTrack): number;      // lowest undestroyed box value (start 0)

// --- Effective-range pipeline (D6.2) — ORDER MATTERS ---
function effectiveRange(p: {
  trueRange: number; hasLockOn: boolean; scannerAdj: number;
  targetCloaked: boolean; observerEM?: boolean;           // observerEM only adds for Tac-Intel (D17.224)
}): number;  // = (hasLockOn ? trueRange : trueRange*2) + scannerAdj + (targetCloaked ? 5 : 0) + (observerEM ? 10 : 0)

// --- Lock-on (D6.1) ---
function rollLockOn(rating: number, roll: Dice): boolean; // success when roll <= rating
function lockOnRequiredSystemsBlocked(s: LockOnState, targetId: UnitId): boolean; // D6.124 list

// --- EW (D6.3 / D6.34) ---
function totalTargetEcm(l: EwLedger): number;             // self+builtIn+natural+lent+offensive (E1.7 small-target)
function totalFirerEccm(l: EwLedger, weaponBuiltInEccm?: number): number; // +weapon built-in for seeking (D6.34 step2)
function netEcmShift(targetEcm: number, firerEccm: number, opts?: { keepNegative?: boolean }): number;
        // = floorSqrt(max(0, targetEcm - firerEccm)); keepNegative for cloak/elite-crew (G13.33/G21.211) & D17.26

// --- Resolution hooks consumed by other engines ---
function directFireShift(firer: UnitId, target: UnitId, state: GameState): number;        // -> C4 (E1.8)
function proximityOfDetonation(shift: number, roll: Dice, cloaked: boolean): number;       // warhead % (D6.361/G13.37)
function systemUseRoll(shift: number, roll: Dice): boolean;                                // d6+shift <= 6 (D6.372)

// --- Fire control / cloak timers ---
function advanceFireControl(s: FireControlState, impulse: Impulse): FireControlState;       // delay/disruption/PFC counters
function advanceCloakFade(c: CloakState, impulse: Impulse): CloakState;                     // +1 phase/impulse to 5

// --- Tactical Intelligence (D17) ---
function tacIntelLevel(p: {
  observerType: ObserverColumn; effectiveRange: number;
  netEcmShift: number; eccmShift: number; prolongedBonus: 0|1|2; columnShift: 0|1|2;
}): InfoLevel;                                              // range->level, then +/- EW, +prolonged, column shift
function maskUnitState(target: UnitPublicState, level: InfoLevel): Partial<UnitPublicState>; // SSD masking
function buildTacIntelView(observerId: UnitId, targetId: UnitId, state: GameState): TacIntelView;

// --- Hidden deployment (D20) ---
function evaluateHiddenTriggers(unit: HiddenState, action: GameAction, state: GameState):
  { detected: boolean; reason?: string; autoLockOn: boolean };
```

`floorSqrt` is the integer square root, so `netEcmShift` reproduces the D6.34 table exactly: 1–3→1, 4–8→2, 9–15→3, 16–24→4, 25–35→5, 36–48→6, … extending to infinity. The same primitive powers direct-fire (E1.8 in `C4-direct-fire-combat.md`), seeking proximity (`C5-seeking-weapons.md`), lock-on-dependent system rolls, and Tac-Intel level adjustment.

## Validation & Enforcement Rules

The server is the authoritative referee for both **legality** and **visibility**.

- **Fog of war is computed server-side.** Clients never receive hidden facts. Every outbound game-state diff is filtered through `buildTacIntelView`/`maskUnitState`; a field appears only if the recipient's best observer earns its info level. Hidden-unit `secretHex` is projection-excluded and never serialized to the opponent (`E4-security-integrity.md`).
- **EW is public.** ECM/ECCM totals and their full source breakdown are broadcast to both sides each turn in the Sensor Lock-On segment (D6.32/D17.194). ECCM benefit and visibility are gated on active fire control (D6.622): a passive-FC unit may emit ECM but its ECCM is inert and unrevealed until it activates.
- **Generation caps** (auto-enforced at `AllocateEW`): `selfEcm + selfEccm ≤ sensorRating` (usually 6); lent ≤ 6 ECM and ≤ 6 ECCM combined; offensive ECM ≤ 6 and cannot be voluntarily ignored. Built-in/natural points are off-limit. Circuit reassignment is blocked if `impulse − lastChangedImpulse < 8`. ECM cannot be raised in reaction to announced ECCM (the decision precedes fire, D6.315).
- **Lock-on cadence.** One general lock-on roll per turn (`lockOnRollMadeThisTurn` guards re-attempts); a fresh per-target roll is permitted only when a target re-emerges from terrain (D6.113) or a cloak relationship changes (G13.33). Mid-turn sensor damage reduces `currentSensorRating` at end of the Stage but does not re-roll the general lock-on until next turn.
- **No-lock-on penalty.** When firing at a non-locked target, `effectiveRange` doubles the true range *before* adding the scanner factor; if the result exceeds weapon max range the weapon is blocked (with the overload exception of D6.1261). Seeking weapons cannot launch without lock-on, and unguided ones already aloft are released (D6.121).
- **Fire-control timing.** `SetFireControlMode → active/lpfc` costs 1 pt (½ for LPFC), becomes functional 4 impulses later, and immediately forfeits any PFC bonus. Disrupted FC is forced for exactly 4 impulses (D6.68). Cloak forces inactive; wild weasel forces passive. A sensor rating < 6 turns activation itself into a die roll (D6.66).
- **AEGIS.** ≤ 4 firings/impulse (limited: 2); first firing is simultaneous with all non-AEGIS fire, the rest sequential; targets restricted to size class ≤ 6 within 6 hexes; requires active FC + lock-on (LPFC insufficient, D13.524); no power; cannot be destroyed; 4-impulse activation lockout; seeking-ID ≤ 6 attempts/turn.
- **GM-override points.** A GM may override any lock-on result, EW total, net shift, Tac-Intel level, AEGIS eligibility, cloak fade, or hidden-detection trigger via `GmOverrideApplied { target, value, reason }`, recorded in the log for replay and audit.

## UI Contract

This engine is consumed primarily by the **targeting UI** (`D5-targeting-combat-ui.md`) and the **battle map** (`D1-map-board-ui.md`); it owns no screen of its own. It must expose, per requesting client (already fog-filtered):

1. **Map render data** — for each enemy unit the client may perceive: position (or `approxLocation.centerHex` + `radius` for cloaked/hidden contacts, radius 4/3/2/1/0 by level A–E, D17.2211), facing/speed/Turn-Mode (always-known, D17.51), and a "contact confidence" badge reflecting `highestLevel`.
2. **EW HUD** — a public, both-sides panel showing each unit's ECM/ECCM totals and source breakdown (self / built-in / natural / lent / offensive), updated whenever `EwAnnounced` fires.
3. **Lock-on & fire-control indicators** — per own unit: FC mode, activation countdown (impulses until functional), disruption timer, general-lock-on status, and per-target lock badges for cloak/terrain exceptions.
4. **To-hit preview** — given a selected weapon + target, the engine returns the `netEcmShift` and resulting modifier so the targeting panel can show the player the EW penalty *before* committing fire (no hidden info leaked — both sides already know EW levels).
5. **AEGIS console** — firing-budget remaining this impulse, eligible (size ≤ 6, range ≤ 6) target list, and seeking-ID attempts left.
6. **Tac-Intel inspector** — a "scan" affordance on any contact that calls `RequestTacIntel` and renders the masked SSD: only earned attributes are populated; unearned ones render as "unknown."

Wireframes live with the consuming D-docs (`docs/spec/wireframes/D5-targeting-combat.svg`, `docs/spec/wireframes/D1-map-board.svg`); this doc is the data/contract source they bind to.

## Dependencies

- `A3-data-architecture-event-store.md` — event log, deterministic fold, snapshots that carry info state.
- `E4-security-integrity.md` — the fog-of-war enforcement boundary this engine feeds; sealed EW/FC commitments.
- `D9-gm-spectator-console.md` — `GmOverrideApplied` for any ruling here.
- `A4-realtime-sync-layer.md` — per-client filtered diffs; presence.
- `B3-game-catalog-ssd-model.md` — sensor/scanner tracks, built-in ECM/ECCM values, AEGIS type, cloak cost, and the maskable SSD attribute→level map.
- `C1-sequence-of-play-engine.md` — the impulse stages this subsystem hooks (Sensor Lock-On segment, Fire Control step 6B1, Cloaking Device stage).
- `C2-energy-allocation-power.md` — ECM/ECCM power, fire-control & cloak energy, reserve power for mid-turn EW/FC.
- `C4-direct-fire-combat.md` — consumes `directFireShift` (E1.8) and the no-lock effective-range result.
- `C5-seeking-weapons.md` — consumes `proximityOfDetonation` and lock-on requirements for launch/guidance.
- `E1-dice-rng-service.md` — the sole seeded entropy source for all rolls here.
- `B1-rules-content-api.md` — Citation objects attached to validation rejections and overrides.

## Edge Cases & Open Questions

- **Shift application sign (E1.8):** D6.35 only points to E1.8; `C4-direct-fire-combat.md` owns whether the shift is added to the die or subtracted from the to-hit number per weapon family. This engine returns a signed magnitude; C4 applies it.
- **Built-in EW values** per ship/fighter type live in SSDs / Annex #6–#7, not Section D; `ecmBuiltIn`/`eccmBuiltIn` must be sourced from `B3-game-catalog-ssd-model.md`.
- **Tac-Intel attribute→level map** (D17.4) references hull-type annexes and R-series rules; the full masking table is data, owned by B2, not hard-coded here.
- **Observer-column shift ordering:** crippled (+2), sensor < 6 (+1), and uncontrolled (+2) are "use the worst, non-cumulative," but their interaction with EW shifts and prolonged-observation bonuses needs an explicit, tested resolution order (the engine applies column shift first, then range→level, then EW ±, then prolonged +).
- **ECCM sign-keeping for Tac-Intel (D17.26)** differs from combat (D6.34 step 4 zeroes negatives) — `netEcmShift({keepNegative})` must be called correctly in each context.
- **Scout channel model (G24, functions 24–29)** and "undesignated" EW channel points are only referenced by Section D; full modeling is deferred with the scout doc.
- **Effective-range for non-FC observers:** D17.22/.227 imply Tac-Intel uses the same no-lock doubling; confirm against D1.4 for every observer column.

## Testing

- **Effective-range worked example (D6.21):** true range 3, no lock-on → 6, scanner factor +3 → **9**; add cloak (+5) → 14. Assert ordering (double first, then scanner, then cloak).
- **Net-shift table (D6.34):** property-test `netEcmShift` against `floorSqrt` across 0–500; spot-assert 3→1, 4→2, 8→2, 9→3, 24→4, 36→6, 49→7. With ECCM ≥ ECM, result is 0 in combat but sign-kept for D17.26.
- **Proximity of Detonation (D6.361):** die+shift 1–6 → 100%, 7–8 → 50%, 9–10 → 25%, 11+ → 0%; with zero shift, only 100% is reachable.
- **Lock-on cadence (D6.11):** a unit may roll the general lock-on once/turn; a second `RequestLockOn` without a terrain/cloak trigger is rejected; sensor damage mid-turn lowers per-target re-roll rating but not the standing general lock-on.
- **Fire-control delay (D6.611):** `SetFireControlMode(active)` at impulse *n* yields `functionalImpulse = n+4`; firing before then is blocked; cancelling within the window still forfeits the PFC bonus.
- **AEGIS budget (D13):** assert ≤ 4/2 firings, size ≤ 6 & range ≤ 6 eligibility, no power consumed, and the seeking-ID range table (0–3 auto; 4 → 1–4; 5 → 1–3; 6 → 1; −1 repeat) with the 6/turn cap.
- **Fog of war:** a field masked at the observer's level is absent from that client's diff; flip the observer to a closer range / higher ECCM and assert the field appears; verify `secretHex` of a hidden unit never serializes to the opponent.
- **Determinism:** replay a full EW/lock-on/fire sequence from the seeded RNG and assert byte-identical info-state snapshots (per `E5-testing-strategy.md`).

## Phasing

- **[v1 AM-tournament]:** sensor rating & lock-on (D6.1) with one-roll-per-turn enforcement; the effective-range pipeline (D6.2); ECM/ECCM generation, caps, circuits, and the net-shift math (D6.3/D6.34) wired into direct fire (E1.8) and seeking proximity (D6.36); fire-control modes active/inactive/disrupted (D6.6); AEGIS (D13); the Tactical-Intelligence visibility ladder (D17.3–.5) with server-enforced fog of war and public-EW broadcast. Rationale: a tournament duel needs lock-on, EW to-hit shifts, AEGIS point-defense, and correct "what each side sees" before anything else is playable.
- **[v2]:** cloaking (G13) with the 5-impulse fade and Fire-Adjustment chart; scout special-sensor channels, lent EW, and offensive ECM (G24); low-power and passive fire control (D6.7/D19); Tac-Intel prolonged-observation timers and EW-driven level shifts at full fidelity. Rationale: these require special ships/multi-ship play beyond the tournament core.
- **[v3 full Master]:** Tac-Intel deception layers (D17.6–.8 — shield/power faking, dummy/concealed weapons, silent running, secret damage), hidden deployment (D20) including long-term cloaking, and the complete per-empire built-in-EW and special-sensor catalogs. Rationale: scenario-level information warfare scales the same engine once the v1/v2 contracts are proven.
