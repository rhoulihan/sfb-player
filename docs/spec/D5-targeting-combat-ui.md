# D5 — Assisted Targeting & Combat UI

## Purpose & Scope

This document specifies the **Assisted Targeting & Combat** screen: the client surface a commander uses during the Direct-Fire Weapons Segment (6D) to pick target(s), see firing arcs and which enemy shield each weapon would strike, read a per-weapon inventory of in-arc / in-range eligibility and **expected damage**, assign weapons to targets, preview the predicted effect, then commit a sealed fire order and watch it resolve through a dice log. The screen is a *decision-assist surface only*: the server (the authoritative referee in `C4-direct-fire-combat.md`) computes every arc test, range, hit probability, and damage value, and the client renders them — but the player alone chooses **which** targets, **which** weapons, **what mode** (overload / proximity / low-power / gatling), whether to declare a narrow salvo, and whether to fire or hold. Nothing on this screen ever auto-targets or auto-fires. The screen also hosts the seeking-weapon **launch** panel surfaced by `C5-seeking-weapons.md` and hands the which-box damage-allocation choice to the SSD panel (`D2-ssd-viewer-ui.md`). Layout reference: **`wireframes/D5-targeting-combat.svg`**. **PHASE: the targeting/eligibility/prediction/fire-plan/dice-log loop for the AM tournament weapon set ships in [v1 AM-tournament]; seeking-launch integration, point-defense targeting, and exotic weapons are [v2]/[v3] (see ## Phasing).**

## Rulebook References

- Firing arcs and field-of-fire: (D2.0)–(D2.3) six 60° base arcs (LF, RF, R, L, RR, LR) and combined codes FA/FX/RA/RX/RS/LS/FH/RH; on-boundary hexes count in-arc.
- Shields and which shield is struck: (D3.1)–(D3.3) six fixed facings (#1 front), down detection; (D3.4)/(D3.402) firer-center → target-center line crossing; (D3.41)/(D3.43) hexside/ambiguous cascade (default: target owner picks); (D3.54)/(D3.332) lock-on detection of shield level; (D3.347) reinforcement undetectable; (D4.14) ship-portion of SSD public.
- Damage preview math: (D4.1) volley formation; (D8.1) ≥20 points on one shield in one impulse → critical-hit threshold.
- Direct-fire framework: (E1.0)–(E1.5) firing in 6D, 8-impulse re-fire lockout, once-per-turn, simultaneity; (E1.6) narrow salvo; (E1.7) small-target ECM; (E1.8) die-roll modifiers (hit-or-miss vs range-of-effect shifting).
- Weapon tables consumed for prediction: phasers (E2.0–E2.4, range-of-effect), disruptors (E3.4 chart), photons (E4.12 chart + overload/proximity), anti-drones (E5.6), fusion (E7.31), maulers (E8.22 auto-hit ×range factor), hellbores (E10.32), PPD (E11.32).
- Range model: (D1.4) true vs effective range; overload true-range caps (8 hexes) per E3/E4/E7/E10.
- Lock-on/EW gating: (D6.1) lock-on required to fire; (D6.3) EW die shift.

## Domain Model

The targeting screen holds **no authoritative state of its own**. The in-flight `TargetingSession` is ephemeral client state; the only persisted artifact is the committed `DeclareFire` payload, which rides the generic sealed-order store owned by `C1-sequence-of-play-engine.md` / `A4-realtime-sync-layer.md` (no new Mongoose collection is introduced here). All read shapes below are server-computed projections delivered over Socket.IO and are fog-of-war gated before they leave the server.

```ts
import { HexCoord, Facing, BaseArc } from './movement';   // C3-movement-engine.md
import { UnitId, SideId } from './sequence';              // C1-sequence-of-play-engine.md
import { WeaponId, ArcCode } from './ssd';                // B3-game-catalog-ssd-model.md
type ShieldFacing = 1|2|3|4|5|6;                          // D3.1 (#1 = front)

type FireMode =
  | 'normal' | 'overload' | 'proximity'
  | 'lowPowerPh3' | 'lowPowerPh1or2'      // E2.25
  | 'gatling';                            // E2.151

type WeaponEligibility =
  | 'eligible' | 'outOfArc' | 'outOfRange' | 'noLockOn'
  | 'rateLocked' | 'firedThisTurn' | 'notLoaded' | 'noEnergy' | 'blocked'; // E1.21

type TargetRef =
  | { kind: 'unit'; unitId: UnitId }
  | { kind: 'hex';  hex: HexCoord };      // hex targeting (seeking ballistic, area)

/** Ephemeral CLIENT-ONLY working state — never written to the event log. */
interface TargetingSession {
  firingUnitIds: UnitId[];                // the commander's controllable group
  activeFiringUnitId: UnitId;             // ship whose inventory is shown
  selectedTargets: TargetRef[];           // single OR a group (D2.0 multi-target)
  assignments: WeaponAssignment[];        // weapon → target bindings, all firers
  salvoGroups: SalvoGroup[];              // E1.6 declared narrow salvoes
  ewChanges: EwChange[];                  // bundled with fire (B2.4); owned by C8
}

interface WeaponAssignment {
  weaponId: WeaponId;
  targetRef: TargetRef;
  mode: FireMode;
  gatlingShots?: number;                  // 1..4 (E2.151)
  salvoGroupId?: string;                  // membership in a SalvoGroup
}

interface SalvoGroup {                     // one die for every member (E1.62)
  id: string; weaponType: string;          // members must be a single type (E1.61)
  weaponIds: WeaponId[]; targetRef: TargetRef;
}
```

The **server-computed targeting solution** is what the inventory panel and arc/shield overlays render. It is recomputed whenever the firer, a target, or a mode toggle changes, and on every clock tick (range and rate gates move with the impulse).

```ts
interface WeaponSolution {
  weaponId: WeaponId; weaponClass: string;  // 'PH-1','DISR','PHOTON','HELLBORE','PPD',...
  arc: ArcCode;
  inArc: boolean; coveringArc?: BaseArc;     // which 60° wedge satisfies it (D2.1)
  trueRange: number; effectiveRange: number; // D1.4 (effective drives hit, true drives damage)
  maxRange: number; overloadRangeCap?: number;
  eligibility: WeaponEligibility;
  rateUnlockImpulse?: number;                // E1.52 — earliest legal re-fire impulse
  strikeShield?: ShieldFacing;               // D3.402 line-cross result
  energyCost: number;                        // from C2 (capacitor / arming / reserve)
  prediction: DamagePrediction;
  notes: string[];                           // human-readable referee remarks
}

interface DamagePrediction {
  kind: 'hitOrMiss' | 'rangeOfEffect' | 'autoHit';  // E1.821 vs E1.822 vs mauler
  hitProbability: number;                    // 0..1 (1.0 for range-of-effect & auto-hit)
  expectedDamage: number;                    // expected points at TRUE range
  damageRange: { min: number; max: number };
  ewDieShift: number;                        // D6.3/E1.8 net modifier applied
  smallTargetEcm: number;                    // E1.7 band points
  expectedShieldRemaining?: number;          // public shield strength − expected (NO reinforcement knowledge, D3.347)
  expectedPenetration?: number;              // advisory only; flagged uncertain
  contributesToCriticalMeter: number;        // points counted toward the ≥20/shield/impulse test (D8.1)
}

interface TargetSummary {                    // aggregate per target across all assigned weapons
  targetRef: TargetRef;
  struckShield: ShieldFacing; shieldStrength: number; shieldDown: boolean;
  expectedTotal: number; criticalMeter: number;   // 0..20+, drives the threshold gauge
  assignedWeaponIds: WeaponId[];
}

interface TargetingSolution {                // one per firing unit
  firingUnitId: UnitId;
  weapons: WeaponSolution[];
  targets: TargetSummary[];
  lockOn: boolean;                           // D6.1 whole-turn flag for this ship
}
```

## Events & Commands

The screen issues exactly one read-only RPC (no log entry) plus one canonical sealed command; everything it renders post-reveal is emitted by sibling resolvers.

**Read-only query (no event):**

```ts
// Fog-safe: server computes against frozen public state and returns ONLY public-derived
// predictions for `viewer`. Hidden reinforcement/internals are never encoded (D3.347, D4.14).
function queryTargetingSolution(
  firingUnitId: UnitId, gs: GameState, viewer: SideId): TargetingSolution;
```

**Command issued (canonical, sealed):** `DeclareFire` is the committed fire plan; `C1`'s gate wraps it as the `payload` of a `SubmitSealedOrders` at step 6D, bundling the EW change in the same envelope (B2.4).

```ts
interface DeclareFire {
  type: 'DeclareFire';
  unitId: UnitId;
  impulse: number;                          // must equal current 6D impulse
  assignments: WeaponAssignment[];
  salvoGroups: SalvoGroup[];
  ewChanges?: EwChange[];                   // C8-ew-sensors-cloak.md
}
```

**Events consumed (rendered; emitted by C4/C7/C8/C1 — shapes summarized, owned there):**

```ts
// from C1 — the sealed reveal that unblocks the dice log
interface OrdersRevealed { type:'OrdersRevealed'; stepKey:string; orders: DeclareFire[]; }
// from E1 via the C4 resolver — every roll, in order, for the log
interface DiceRolled  { type:'DiceRolled'; weaponId:WeaponId; rolls:number[]; total:number; purpose:'to-hit'|'damage-points'|'salvo'|'wave-lock'; }
// from C4 — per weapon outcome
interface WeaponFired { type:'WeaponFired'; weaponId:WeaponId; firingUnitId:UnitId; targetRef:TargetRef;
  hit:boolean; mode:FireMode; struckShield:ShieldFacing; damage:number; ewShift:number; salvoGroupId?:string; }
// from C7 — shield + internal results (the which-box pick is AllocateDamage, surfaced on D2)
interface DamageAllocated { type:'DamageAllocated'; targetUnitId:UnitId; volleyId:string;
  shieldFacing:ShieldFacing; shieldBoxesLost:number; internalsByBox:{ boxId:string; system:string }[]; }
interface CriticalHitRolled { type:'CriticalHitRolled'; targetUnitId:UnitId; faces:number[]; effect:string; } // D8.1
interface WeaponDischarged { type:'WeaponDischarged'; weaponId:WeaponId; energy:number; }                     // E1.24
```

The which-specific-box player choice for each internal damage point is the canonical `AllocateDamage` command (owned by `C7-damage-criticals-repair.md`); D5 routes that interaction to the `D2-ssd-viewer-ui.md` highlight-and-pick affordance and shows the result inline in the dice log.

## Engine / API

All eligibility, arc, range, struck-shield, and expected-damage math is the **same code path** the `C4` resolver uses to validate and resolve fire, exposed in a pure read-only form so a prediction can never disagree with the actual resolution (single source of truth). The client layer is thin selectors over `TargetingSession`.

```ts
// ---- Server read-side (pure; fog-safe) ----
function computeTargetingSolution(firingUnitId: UnitId, gs: GameState, viewer: SideId): TargetingSolution;
function weaponSolution(w: WeaponMount, firer: UnitState, t: TargetRef, gs: GameState): WeaponSolution;

function isInArc(arc: ArcCode, firerHex: HexCoord, firerFacing: Facing,
                targetHex: HexCoord): { inArc: boolean; covering?: BaseArc };          // D2.0–D2.2
function strikeShield(firerHex: HexCoord, targetHex: HexCoord,
                      targetFacing: Facing): ShieldFacing | { ambiguous: true };       // D3.402/D3.41/D3.43
function exposedShields(target: UnitState, firers: UnitState[]): Record<UnitId, ShieldFacing>; // overlay feed

function expectedDamage(w: WeaponMount, trueRange: number, effectiveRange: number,
                        mode: FireMode, ewShift: number, smallEcm: number): DamagePrediction;   // E-tables
function hitProbability(table: WeaponTable, effectiveRange: number, ewShift: number): number;   // E1.821 hit-or-miss
function rangeOfEffectExpectation(table: WeaponTable, trueRange: number, ewShift: number): { expected:number; min:number; max:number }; // E1.822
function criticalMeter(volleyContributions: number[]): number;                          // D8.1 ≥20 test

// ---- Mirrors the C4 fire validator so the client previews exactly what will be accepted ----
function validateFirePlan(cmd: DeclareFire, gs: GameState): ValidationResult;
//  per-assignment: in-arc (D2.0), within max/overload range, lock-on present (D6.1),
//  rate gap ≥8 impulses + not already fired this turn (E1.52), energy available (C2),
//  salvo legality (single type, one target, one impulse — E1.6).

// ---- Client selectors over the ephemeral session ----
function assign(s: TargetingSession, weaponId: WeaponId, t: TargetRef, mode: FireMode): TargetingSession;
function clearAssignment(s: TargetingSession, weaponId: WeaponId): TargetingSession;
function declareSalvo(s: TargetingSession, weaponIds: WeaponId[]): TargetingSession;     // E1.6
function summarize(s: TargetingSession, sol: Map<UnitId, TargetingSolution>): TargetSummary[];
function toDeclareFire(s: TargetingSession, unitId: UnitId, impulse: number): DeclareFire;
```

`expectedDamage` branches on weapon kind: **range-of-effect** weapons (phaser E2.4, fusion E7.31, mauler-as-auto E8.22, TR E9.35) average the die-vs-range table after applying the E1.822 column/row shift, so `hitProbability = 1` and `damageRange` spans the best/worst die faces; **hit-or-miss** weapons (disruptor E3.4, photon E4.12, hellbore E10.32, PPD wave-lock E11.32) return `P(hit) × warhead` with `damageRange = {0, warhead}`; maulers report `autoHit` with the deterministic `energy × rangeFactor` value (E8.22).

## Validation & Enforcement Rules

Every prediction the client shows is advisory; the referee re-runs the identical checks at 6D reveal and the server result is authoritative. Each numbered check is a recorded, GM-overridable decision point.

1. **Arc legality (D2.0–D2.3).** A weapon may be assigned only to a target in one of its tagged 60° arcs at the firer's current hex/facing; on-boundary hexes count in-arc. The inventory row shows `outOfArc` and disables assignment; the map shades the weapon's covered wedge.
2. **Range and overload cap (D1.4, E3/E4 etc.).** Eligibility checks the target against the weapon's max range; overloaded disruptors/photons/fusion/hellbores cap at true range 8. Hit probability uses **effective** range, the damage value uses **true** range — both are shown distinctly so the player understands a long-range "hit but light" shot.
3. **Lock-on required (D6.1).** With no whole-turn lock-on flag on the firing ship, every weapon is `noLockOn` and the Submit button is blocked for that ship (anti-drones are the documented exception in `C5`).
4. **Re-fire and once-per-turn gates (E1.50/E1.52).** A weapon fired within the last 8 impulses is `rateLocked` with its `rateUnlockImpulse`; a once-per-turn weapon already fired is `firedThisTurn`. The clock-aware solution updates these as impulses advance (`D6-impulse-hud.md`).
5. **Energy availability (C2).** Phaser shots require an energized, sufficiently charged capacitor; arming/overload energy and mid-turn reserve/contingent completion are validated against `C2-energy-allocation-power.md`. Insufficient energy → `noEnergy`.
6. **Struck-shield determination (D3.4).** The overlay highlights the shield each firer would strike via the center-to-center line (D3.402). On a hexside/ambiguous geometry (D3.41/D3.43) the UI marks the target shield **ambiguous** and labels that the defender will choose at resolution (default D3.43-C3) — the client never silently resolves it.
7. **Narrow salvo legality (E1.6).** A declared salvo must contain ≥2 weapons of a single type firing at one target this impulse; mixed/illegal members are rejected client-side and again by `validateFirePlan`.
8. **Fog of war (D3.347, D4.14).** Predictions are computed from **public** data only: current shield strength (publicly inspectable, D4.14) is shown, but general/specific reinforcement is invisible (D3.347), so `expectedPenetration` is explicitly flagged uncertain and internals are never asserted. The server strips any field the viewer is not entitled to before sending the solution.
9. **Critical-threshold gauge (D8.1).** The per-target `criticalMeter` sums points that would land on one shield this impulse; at ≥20 the gauge flags a possible critical, but the actual 2d6 roll (once per turn) is resolved server-side and shown in the dice log.

**GM-override points.** A GM may override any eligibility rejection, force/deny a hit, hand-set a struck shield in an ambiguous case, or substitute an expected/result value via `ApplyGmOverride` → `GmOverrideApplied { target: {unitId|weaponId}, value, reason }`, recorded in the log and replayed deterministically.

## UI Contract

The screen is a four-region layout over the shared battle map; see **`wireframes/D5-targeting-combat.svg`**. Region labels below match the wireframe. A working **interactive mockup** of the full battle screen — select a ship → SSD, target an enemy → live firing arc, exposed-shield highlight, per-weapon eligibility/expected-damage, and a sealed fire declaration — is at **`wireframes/battle-screen.html`** (open in a browser).

- **(A) Firing-Group Rail (left).** A vertical list of the ships this commander controls, each with a compact readiness chip: lock-on dot (D6.1), number of in-arc-eligible weapons, capacitor charge, and a rate badge if any weapon is locked. Selecting a ship makes it the `activeFiringUnitId` and repaints the arc overlay and inventory. A group header lets the commander work several ships into one sealed envelope before submitting.
- **(B) Battle-Map Viewport (center).** Reuses the `D1-map-board.svg` canvas. For the active firer it draws each selected weapon's **firing arc** as a translucent 60° wedge (or combined-arc union) keyed to the ship facing (D2.1). Target selection is by click (single) or shift-click / marquee for a **group** (D2.0 multi-target). For every selected target the **exposed shield** is highlighted — the struck facing (D3.402) glows, annotated with that shield's current strength and up/down state, and an ambiguous case is rendered with a split-shield "defender chooses" badge. Range rings and a thin line-of-fire connect firer to each target; out-of-arc targets show a muted "no-arc" cursor.
- **(C) Weapon-Inventory Panel (right).** One row per weapon on the active firer: name + type icon, arc badge, an eligibility pill (eligible / out-of-arc / out-of-range / rate-locked t+N / no-lock-on / already-fired), true-and-effective range, a **mode toggle** (normal · overload · proximity · low-power · gatling ×N) with the energy delta from `C2`, a target dropdown (defaults to the map selection), a "→ shield #N" tag, and the **expected-damage readout** (hit % and expected points, with the min–max die spread). Rows can be multi-selected and dropped into a **Narrow-Salvo** sub-group (E1.6) that then shares one die. Eligible-but-unassigned weapons are visually distinct from assigned ones.
- **(D) Fire-Plan Tray (bottom).** The running plan: assignments grouped by target, total committed energy, declared salvoes, and a per-target **aggregate prediction** — expected damage to the struck shield, an advisory penetration estimate, and a **critical-threshold gauge** filling toward 20 (D8.1). A "Submit & Lock" button is enabled only while the impulse HUD reports step 6D `awaiting-orders`; it serializes the session into `DeclareFire` envelopes and seals them. Holding (not firing) and discharging (E1.24) are explicit controls here.
- **(E) Resolution / Dice-Log Overlay.** On `OrdersRevealed` the tray flips to a chronological dice log: each `WeaponFired` shows its `DiceRolled` faces, hit/miss against the chart, mode, struck shield, and damage; salvo members share one highlighted die. Penetrating volleys cascade into `DamageAllocated` lines, and where the owner must pick a box the overlay focuses the `D2-ssd-viewer-ui.md` and records the `AllocateDamage` choice. `CriticalHitRolled` and `WeaponDischarged` appear inline. The log is scrollable and is the canonical post-combat record the player reviews.

Throughout, the client computes and displays eligibility, arcs, exposed shields, and expected damage, but **target selection, weapon choice, mode, salvo declaration, and fire/hold/discharge are all explicit player commands** — the assist never decides.

## Dependencies

- `C4-direct-fire-combat.md` — owns arc tests, hit/damage tables, struck-shield logic, the 6D resolver, and `WeaponFired`; D5's read-side calls its pure functions so previews match resolution.
- `C7-damage-criticals-repair.md` — volley penetration, the DAC `AllocateDamage` which-box choice, `DamageAllocated`/`CriticalHitRolled`; surfaced via `D2-ssd-viewer-ui.md`.
- `C8-ew-sensors-cloak.md` — lock-on (D6.1), EW die shift (D6.3), effective-range function (D1.4), small-target ECM (E1.7); the EW change bundled into `DeclareFire`.
- `C2-energy-allocation-power.md` — capacitor charge, arming/overload energy, reserve/contingent completion that gates `noEnergy` and mode cost deltas.
- `C5-seeking-weapons.md` — the seeking-weapon **launch** panel that co-inhabits this screen and the point-defense fire-at-drones flow.
- `C1-sequence-of-play-engine.md` — the 6D gate, sealed→lock→reveal, and `OrdersRevealed`; `D6-impulse-hud.md` renders the active step and unlocks Submit.
- `C3-movement-engine.md` — `HexCoord`/`Facing`/`BaseArc` geometry primitives for arc and line-cross math.
- `B3-game-catalog-ssd-model.md` — `WeaponMount` arcs/tables and shield facings the inventory and overlay read. **Provenance:** per-ship weapon arcs have no authoritative external dataset; they are extracted from the SSDs and validated by the B4 systems-consistency audit, so this screen's arc overlays are only as complete as that extraction (a ship isn't fielded until its audit is clean).
- `D1-map-board-ui.md` / `D2-ssd-viewer-ui.md` — the shared map canvas and the SSD panel that renders shields and takes the damage-allocation pick.
- `A4-realtime-sync-layer.md` / `A3-data-architecture-event-store.md` — fog-of-war gating of solutions, sealed-order store, event log.
- `E1-dice-rng-service.md` — seeded rolls whose `DiceRolled` events feed the log; `E2-game-log-replay.md` for deterministic replay.

## Edge Cases & Open Questions

- **Hidden reinforcement makes internals uncertain (D3.347).** The penetration estimate must be presented as advisory, never as a committed internal-damage count; a volley fully absorbed by reinforcement legally yields only "no shield damage" with no amount disclosed.
- **Ambiguous struck shield (D3.41/D3.43).** When the firer-target line runs along a hexside, the screen shows a split/ambiguous shield and defers the choice to the defender at resolution; the preview should display both candidate shields and not bias the player.
- **Simultaneous fire (E1.13).** Because 6D is sealed-simultaneous and both ships may fire on the frozen state, predictions are computed against pre-reveal state; a target killed in the same segment still fired — the log must reflect both directions resolving before either's damage applies.
- **Effective-vs-true range surprises (D1.4).** Cloak/EW can make a "miss" at long effective range despite a close true range, or vice-versa; the readout shows both so the discrepancy is legible.
- **Gatling and salvo interaction (E2.151/E1.6).** Up to four gatling shots may individually combine into a narrow salvo; the assignment model must allow a single weapon to contribute multiple shots, and the salvo die rules must be encoded per shot.
- **Open — phaser tables not in section E.** The ph-1/2/3/4 die-vs-range grids live on the SSD / Master Weapons Chart, not in the rules text (E2.4 note); `expectedDamage` for phasers needs those tables imported via `B3` before the readout is exact. Only worked-example anchor points (e.g. ph-1 die=1 → 8 at range 1) are currently known.
- **Open — overload warhead magnitudes.** Some overload damage values reference the Master Weapons Chart beyond the in-text E4.413 table; confirm import before showing overload expected damage.
- **Open — multi-firer struck-shield aggregation.** When several of the commander's ships strike the same enemy shield in one impulse, the critical-meter must sum across firers (consistent with the single-volley D4.34 rule); confirm the aggregation key with `C4`/`C7`.

## Testing

- **Arc membership (D2.0–D2.2).** Property tests over `isInArc` for every base arc and combined code, asserting on-boundary hexes register in-arc and that combined codes equal the union of their base wedges.
- **Struck shield (D3.402).** Table-driven cases of firer/target hex pairs and facings asserting the crossed facing; explicit hexside cases asserting `ambiguous` rather than a silent pick.
- **Prediction-vs-resolution parity.** For each weapon class, assert the `expectedDamage` mean equals the empirical mean of many seeded `C4` resolutions at the same range/EW (range-of-effect averaging E1.822; hit-or-miss `P(hit)×warhead` E1.821; mauler exact E8.22), guaranteeing the preview never lies.
- **Eligibility transitions.** Advance the clock and assert `rateLocked → eligible` exactly at `rateUnlockImpulse` across a turn boundary (E1.52); assert `noLockOn` blocks Submit; assert overload range cap flips `eligible → outOfRange` past 8 hexes.
- **Fog safety.** Assert a viewer's `TargetingSolution` contains no reinforcement or internal-box data and that `expectedPenetration` is flagged uncertain (D3.347/D4.14).
- **Critical gauge (D8.1).** Build a plan totalling ≥20 points on one shield in one impulse and assert the gauge flags the threshold; verify the actual once-per-turn 2d6 critical resolves only server-side and renders in the log.
- **Salvo (E1.6).** Assert a declared salvo of one type/one target shares a single `DiceRolled` and rejects mixed-type membership; gatling shots correctly fan into per-shot dice.
- **Determinism.** Re-fold the log with the same seed (`E1`) and assert an identical dice-log sequence (`E2-game-log-replay.md`).

## Phasing

**[v1 AM-tournament]** — the full target → arc → exposed-shield → inventory → assign → predict → fire → dice-log loop for the tournament weapon set (phasers, disruptors, photons, fusion, hellbores, PPD, anti-drones, maulers, tractor-repulsor): single-ship and commander-group firing, multi-target assignment, narrow salvo, overload/proximity/low-power/gatling modes, exposed-shield overlay with ambiguity handling, expected-damage readouts (subject to importing the phaser/overload tables), the critical-threshold gauge, sealed `DeclareFire` with bundled EW, and the resolution/dice-log overlay handing the box pick to `D2`.

**[v2]** — first-class seeking-weapon launch panel integration (`C5`), point-defense targeting of incoming drones (anti-drones/phasers at seekers), advanced multi-target (3+ simultaneous targets and per-shield splitting), richer EW visualization (lent ECM, scout channels), and proximity/enveloping previews for special volleys.

**[v3 full Master]** — the remaining direct-fire catalog (web caster, snare, web breaker, shield cracker, particle cannons, warp-augmented rail gun, transporter artillery), monster/ground-target combat surfaces, and X-ship weapon modes. Rationale: tournament play never fields these, so they carry no v1 weight, but the `WeaponSolution`/`DamagePrediction` shapes already generalize (kind discriminants, mode enum) so later weapons extend without a schema migration.
