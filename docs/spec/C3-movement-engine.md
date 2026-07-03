# C3 — Movement Engine

## Purpose & Scope

The Movement Engine owns every spatial fact about a unit: where it sits (hex), which way it points (facing), how fast it is going (the four SFB "speeds"), and the legality of every turn, sideslip, High Energy Turn (HET), reverse, Tactical Maneuver, Emergency Deceleration (ED), speed change, and disengagement attempt. It is the authoritative referee for motion: given a unit's energy-funded speed plot and the current impulse, it deterministically schedules which impulses the unit advances, validates each maneuver against the Turn Mode rules, rolls breakdown/quick-reverse dice through the seeded RNG, and emits the past-tense events that the fold reconstructs into board position. It automates all bookkeeping (hex arithmetic, the Impulse Chart lookup, Turn-Mode counters, acceleration/deceleration caps, the four-speed recomputation) while leaving every tactical choice — when to turn, which way, whether to risk an HET, how to spend reserve power — to the player.

**PHASE:** [v1 AM-tournament] covers hex/facing, proportional impulse movement, Standard Free plotting (level B), the Turn Mode chart and its restrictions, acceleration/deceleration limits, sideslip, Tactical Maneuvers, HET + breakdown, reverse/braking + Quick Reverse, Emergency Deceleration, tractor pseudo-speed timing, and the four disengagement methods. Mid-turn speed change (C12), nimble (C11) and erratic (C10) maneuvering, base rotation, and the liberal/plotted levels are [v2]. Tumbling, Directed Turn Modes, positron flywheel, and super-fast (>32) movement are [v3].

## Rulebook References

Hex/facing & movement-ahead (C1.11, C1.12, C1.2–C1.22); proportional 32-impulse movement (C1.4–C1.45); Order of Precedence (C1.311, C1.313); plotting levels & always/never-plotted lists (C1.3–C1.35); energy cost & movement points (C2.1–C2.18); acceleration/deceleration (C2.2–C2.234, C12.32–C12.33); four speeds (C2.4–C2.46); Turn Mode definition & assignment (C3.0–C3.24, C3.3); Turn Mode Chart (C3.31, C3.32); turn timing/carryover/reset (C3.1, C3.33, C3.41–C3.46); sideslip (C4.0–C4.36); Tactical Maneuvers (C5.0–C5.54); HET (C6.0–C6.42); breakdown & tumbling (C6.5–C6.565); reverse/braking & Quick Reverse (C3.5–C3.63, C12.37); Emergency Deceleration (C8.0–C8.44); mid-turn speed change (C12.0–C12.39); tractor effects on movement (C2.413, C2.417, C2.451, C2.46, C7.122, C7.35); disengagement (C7.0–C7.53); base rotation & Directed Turn Modes (C3.7–C3.89).

## Domain Model

```ts
export type Facing = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';      // C1.12, clockwise A..F
export type MovementMode = 'forward' | 'reverse';            // C3.5
export type TurnModeCategory =
  | 'AA' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'                 // ship hull classes, C3.31
  | 'SHUTTLE' | 'SEEKING';                                   // C3.31 special columns
export type CrewQuality = 'poor' | 'average' | 'outstanding';
export type PlottingLevel = 'A' | 'B' | 'C' | 'C1' | 'D1' | 'D2' | 'E'; // C1.31

/** Internal hex math uses cube coords; hexId is the SSD 4-digit "CCRR" label. */
export interface HexCoord { hexId: string; x: number; y: number; z: number; } // x+y+z===0

/** One unit's complete motion state — folded from events, cached in gameSnapshots. */
export interface UnitMovementState {
  unitId: string;
  hex: HexCoord;
  facing: Facing;
  direction: MovementMode;
  category: TurnModeCategory;
  breakdownRating: number;          // current threshold; degrades on breakdown (C6.544)
  isNimble: boolean;                // C11
  crew: CrewQuality;

  // Derived speeds (recomputed on any input change — C2.43/C2.44)
  practicalSpeed: number;           // warp pts + (<=1 impulse); only speed for accel/reverse; cap 31 (C2.16)
  effectiveSpeed: number;           // practical + EM + terrain (C2.42)
  pseudoSpeed: number;              // warp / combined movement cost when tractor-linked (C2.413)
  maneuverRate: number;             // practical + HET/braking/Tac/EM costs (C2.42)

  // Turn / slip bookkeeping
  straightHexSinceTurn: number;     // counter vs Turn Mode (C3.1)
  slipHexSinceSlip: number;         // counter vs slip mode (always 1) (C4.31)
  lowestSpeedPrior32: number;       // accel ceiling base (C2.23)
  previousTurnSpeed: number;        // accel/braking base (C2.21, C3.52)

  // Timed lockouts, expressed as absolute "turn:impulse" cursors
  lastHetAtImpulse: number | null;          // 1/4-turn HET spacing (C6.36)
  postHetRestrictionUntil: number | null;   // +4 impulses, no dock/launch (C6.38)
  postBreakdownUntil: number | null;        // +16 impulses, no move (C6.546)
  weaponLockoutUntil: number | null;        // +8 impulses (C6.547)
  edStopAtImpulse: number | null;           // declare+2 (C8.10)
  postDecelUntil: number | null;            // stop+16 (C8.42)
  isTumbling: boolean;                      // C6.55 (v3)

  tractorLinks: string[];                   // partner unitIds (G7)
}

/** Funded plan written during Energy Allocation; sealed until reveal. */
export interface MovementPlot {
  unitId: string;
  plottingLevel: PlottingLevel;             // tournament default 'B'
  direction: MovementMode;
  speedPlot: number[];                      // length 32; constant at level B, per-impulse for C12
  directionPlot?: Facing[];                 // only when plotted (level C/C1)
  brakingEnergyAllocated: number;           // reverse cost, must be used (C3.52)
  hetPlottedImpulses?: { impulse: number; newFacing: Facing }[]; // plotted HET (C6.12)
  tacManeuversAllocated: number;            // warp Tac reserved (C5.22)
}
```

The Turn Mode Chart (C3.31) is a hard-coded breakpoint table — never persisted, never edited at runtime:

```ts
// Each entry: ascending [inclusiveMaxSpeed, turnMode]; speed 1 => TM 0; speed 0 => no turn.
export const TURN_MODE_CHART: Record<TurnModeCategory, [number, number][]> = {
  SEEKING: [[32, 1]],                                        // always TM1 (C3.32)
  SHUTTLE: [[11, 1], [23, 2], [Infinity, 3]],
  AA: [[8, 1], [16, 2], [24, 3], [Infinity, 4]],
  A:  [[6, 1], [12, 2], [19, 3], [26, 4], [Infinity, 5]],
  B:  [[5, 1], [10, 2], [15, 3], [21, 4], [28, 5], [Infinity, 6]],
  C:  [[4, 1], [9, 2], [14, 3], [20, 4], [27, 5], [Infinity, 6]],
  D:  [[4, 1], [8, 2], [12, 3], [17, 4], [24, 5], [Infinity, 6]],
  E:  [[3, 1], [6, 2], [10, 3], [14, 4], [20, 5], [29, 6], [Infinity, 7]],
  F:  [[3, 1], [5, 2], [9, 3], [13, 4], [17, 5], [23, 6], [29, 7], [Infinity, 8]],
};
```

**Mongoose sketch.** Movement state is event-sourced; the only persisted artifacts are (a) the sealed `MovementPlot` inside the energy-allocation sealed-order store (see `C2-energy-allocation-power.md`) and (b) the folded `UnitMovementState` embedded in each `gameSnapshots` document. Events live in the canonical `gameEvents` collection (see `A3-data-architecture-event-store.md`).

```ts
const HexCoordSchema = new Schema({ hexId: String, x: Number, y: Number, z: Number }, { _id: false });
const MovementPlotSchema = new Schema({
  unitId: { type: String, index: true },
  plottingLevel: { type: String, enum: ['A','B','C','C1','D1','D2','E'], default: 'B' },
  direction: { type: String, enum: ['forward','reverse'], default: 'forward' },
  speedPlot: { type: [Number], validate: (a: number[]) => a.length === 32 },
  directionPlot: [String],
  brakingEnergyAllocated: { type: Number, default: 0 },
  hetPlottedImpulses: [{ impulse: Number, newFacing: String }],
  tacManeuversAllocated: { type: Number, default: 0 },
}, { _id: false });
```

## Events & Commands

Commands are validated, then emit events; all dice flow through `DiceRolled` so replays match (canonical RNG, `E1-dice-rng-service.md`).

```ts
// COMMANDS (PascalCase imperative)
type MoveCommand =
  | { type: 'PlotMovement'; plot: MovementPlot }                              // C2/C12, during Energy Alloc
  | { type: 'SetPlottingLevel'; gameId: string; level: PlottingLevel }        // C1.31 (pre-game consent)
  | { type: 'DeclareTurn'; unitId: string; impulse: number; turnTo: Facing }  // C3.1 free steering
  | { type: 'DeclareSideslip'; unitId: string; impulse: number; toHex: string } // C4.0
  | { type: 'DeclareHET'; unitId: string; impulse: number; newFacing: Facing }  // C6.0
  | { type: 'DeclareTacticalManeuver'; unitId: string; impulse: number; source: 'sublight'|'warp'; turnTo: Facing } // C5.0
  | { type: 'DeclareEmergencyDeceleration'; unitId: string; impulse: number; reinforceShield: 1|2|3|4|5|6 } // C8.0
  | { type: 'DeclareReverse'; unitId: string; quick?: boolean }               // C3.5 / C3.6
  | { type: 'ChangeSpeed'; unitId: string; atImpulse: number; newSpeed: number; reserve?: boolean } // C12 [v2]
  | { type: 'DeclareDisengagement'; unitId: string; method: 'acceleration'|'separation'|'sublight'|'automatic' } // C7.0
  | { type: 'RotateBase'; unitId: string; impulse: number }                   // C3.7 [v2]
  | { type: 'AdvanceImpulse'; gameId: string };                               // drives the schedule (B3)

// EVENTS (past-tense) — payloads carry everything the fold needs
type MoveEvent =
  | { type: 'MovementPlotted'; unitId: string; plot: MovementPlot }
  | { type: 'ImpulseAdvanced'; gameId: string; turn: number; impulse: number; movers: string[] } // C1.43
  | { type: 'UnitMoved'; unitId: string; fromHex: string; toHex: string; impulse: number }
  | { type: 'ShipTurned'; unitId: string; impulse: number; from: Facing; to: Facing }
  | { type: 'ShipSideslipped'; unitId: string; impulse: number; toHex: string }
  | { type: 'HighEnergyTurnExecuted'; unitId: string; impulse: number; from: Facing; to: Facing; costHexes: 5 }
  | { type: 'BreakdownOccurred'; unitId: string; impulse: number; roll: number; threshold: number; tumbling: boolean; damage: BreakdownDamage }
  | { type: 'TacticalManeuverPerformed'; unitId: string; impulse: number; source: 'sublight'|'warp'; to: Facing }
  | { type: 'EmergencyDecelerationCompleted'; unitId: string; impulse: number; shieldEnergyAdded: number; shield: number }
  | { type: 'DirectionReversed'; unitId: string; brakingSpent: number; quick: boolean; succeeded: boolean }
  | { type: 'SpeedChanged'; unitId: string; impulse: number; from: number; to: number; unplotted: boolean; cost: number }
  | { type: 'DisengagementDeclared'; unitId: string; method: string; valid: boolean }
  | { type: 'BaseRotated'; unitId: string; impulse: number; to: Facing }
  | { type: 'DiceRolled'; purpose: 'breakdown'|'quickReverse'|'sublightEvasion'; rolls: number[]; rngCursor: number }
  | { type: 'GmOverrideApplied'; target: OverrideTarget; value: unknown; reason: string };

interface BreakdownDamage { crewKilled: number; warpBoxesDestroyed: number; internalHits: number; } // C6.542
```

## Engine / API

All hex math and chart lookups are pure; resolvers take the seeded RNG so they remain deterministic.

```ts
// --- Pure geometry (C1.2) ---
const DIR_VECTORS: Record<Facing, [number, number, number]>;          // map-orientation config
function neighbor(hex: HexCoord, facing: Facing): HexCoord;            // hex ahead
function rotateFacing(f: Facing, steps: number): Facing;              // mod-6 ring
function reverseTarget(hex: HexCoord, facing: Facing): HexCoord;      // neighbor of rotateFacing(f,3) (C3.5)
function sideslipTargets(hex: HexCoord, facing: Facing): [HexCoord, HexCoord]; // rotateFacing(f,-1/+1) (C4.0)
function hexDistance(a: HexCoord, b: HexCoord): number;               // cube distance = effective range

// --- Chart lookups (pure) ---
function turnMode(category: TurnModeCategory, speed: number): number; // TURN_MODE_CHART; speed1=>0
function impulseScheduleForSpeed(speed: number): boolean[];           // 32-bit mask, sourced from B3 Impulse Chart
function tacEarnImpulses(crew: CrewQuality): number[];                // Speed-4 col => [2,8,16,24] (C5.23)

// --- Derived speed recomputation (C2.43/C2.44) ---
function recomputeSpeeds(u: UnitMovementState, ctx: TurnContext): Pick<UnitMovementState,
  'practicalSpeed'|'effectiveSpeed'|'pseudoSpeed'|'maneuverRate'>;

// --- Validators: return structured verdicts, never throw on illegality ---
interface ValidationResult { ok: boolean; violations: RuleViolation[]; gmOverridable: boolean; }
function validateMovementPlot(plot: MovementPlot, u: UnitMovementState, ctx: TurnContext): ValidationResult;
function validateTurn(u: UnitMovementState, turnTo: Facing, ctx: TurnContext): ValidationResult;
function validateSideslip(u: UnitMovementState, toHex: HexCoord, ctx: TurnContext): ValidationResult;
function validateHET(u: UnitMovementState, ctx: TurnContext): ValidationResult;
function validateTacticalManeuver(u: UnitMovementState, src: 'sublight'|'warp', ctx: TurnContext): ValidationResult;
function validateEmergencyDeceleration(u: UnitMovementState, ctx: TurnContext): ValidationResult;
function validateReverse(u: UnitMovementState, quick: boolean, ctx: TurnContext): ValidationResult;
function validateSpeedChange(u: UnitMovementState, newSpeed: number, atImpulse: number, ctx: TurnContext): ValidationResult; // [v2]
function validateDisengagement(u: UnitMovementState, method: string, ctx: TurnContext): ValidationResult;

// --- Resolvers: fold-producing, deterministic ---
function resolveImpulseMovement(state: GameState, turn: number, impulse: number, rng: SeededRng): MoveEvent[];
function rollBreakdown(u: UnitMovementState, rng: SeededRng, modifiers: number): { broke: boolean; tumbling: boolean; roll: number };
function applyAccelerationLimits(prevTurnSpeed: number, target: number): number; // between-turn max(prev,10) (C2.21)
```

`resolveImpulseMovement` is the heart of the loop: for `impulse`, it computes each mover via `impulseScheduleForSpeed` (using pseudo-speed when tractor-linked), orders them by the Order of Precedence comparator (C1.313 — slowest first, worse Turn-Mode-category last, simultaneous hidden orders only for true ties), then for each mover applies any declared HET → Tac → turn/sideslip → forward/reverse step, emitting `ImpulseAdvanced` plus the per-unit events. Impulses #1–#2 produce no movement; speed-1 units move only on #32 (C1.43).

## Validation & Enforcement Rules

The referee runs the following guards; every failure yields a `RuleViolation` with the citing rule number, and every guard is a documented `GmOverrideApplied` point.

- **Legal speed plot (always required, C1.34).** `validateMovementPlot` checks: `practical = floor(warpForMove / movementCost) + impulseForMove`; ≤1 impulse point for movement+braking+sublight-Tac combined; ≤30 warp movement points (the 31st must come from impulse); total ≤31 for ships/shuttles (C2.16). Between-turn acceleration ≤ `prev + max(prev, 10)` (C2.21); deceleration between turns is unrestricted. Bases get speed 0 (C2.15); sublight-only hulls cap at 1 hex/turn and may not also Tac (C2.14).
- **Turn legality (C3.1).** A 60° turn is legal only when `straightHexSinceTurn ≥ turnMode(category, speedForTurnMode)`, where `speedForTurnMode = pseudoSpeed` if tractor-linked and it differs, else `practicalSpeed` (C2.417). Turning at the start of the impulse refaces, then the entered hex sets `straightHexSinceTurn = 1` (it counts as the first straight hex, C3.33). Carryover across the turn break is preserved (C3.41). Speed change does not reset the counter but the new speed's Turn Mode now applies (C3.44/C3.443). Speed-1 = Turn Mode 0 (turn-then-move on #32); speed 0 cannot satisfy any mode and may only reface via HET or Tac (C3.43).
- **Sideslip (C4.0).** Slip mode is constant 1: legal when `slipHexSinceSlip ≥ 1`. The slipped-into hex does not advance `slipHexSinceSlip` (C4.31) but does advance `straightHexSinceTurn` (counts as straight for Turn Mode, C3.24/C4.32). A unit may not both turn and sideslip in one impulse (C4.34). A turn resets `slipHexSinceSlip = 0` (C4.33).
- **HET (C6.0).** Requires 5 warp hexes available (engines or reserve warp, never impulse/AWR); illegal on impulse #1, while docked/in pinwheel/uncontrolled, within 8 impulses of a prior HET or Quick Reverse (C6.36), and — at speed 31 — only if the ship can generate >30 warp points (C12.38). On success: reface ≤180° (C6.39), reset `straightHexSinceTurn` and `slipHexSinceSlip` to 0 (C6.32), set the 4-impulse post-HET restriction window (C6.38), then `rollBreakdown` before moving (C6.512).
- **Breakdown (C6.5).** `roll1d6 + modifiers ≥ breakdownRating` ⇒ breakdown. Modifiers: first HET of scenario −2 (once per ship), EM +1, plus crew/navigator deltas. On breakdown: stop (or tumble on a natural 1, [v3]), forfeit all movement/HET/Tac/EM energy, apply `BreakdownDamage` (≈1/3 crew killed never below the last two, every 5th warp box, 2 internal hits), 16-impulse no-move + 8-impulse weapon/launch lockout, and `breakdownRating -= 1` for the rest of the scenario (C6.544).
- **Tactical Maneuver (C5.0).** Requires practical speed 0 this impulse (combine with ED, C5.51, or a mid-turn drop to 0). Sublight: 1 impulse point, one 60° turn, any impulse but #1. Warp: up to 4 turns earned on the Speed-4 schedule (`tacEarnImpulses`), only one held-and-unused at a time; caps 5/normal, 7/outstanding (Speed-6 column), 3/poor. Tac cost loads the maneuver rate for the rest of the turn (voids Wild Weasel, affects cloak — `C6-carriers-shuttles-pf.md`, `C8-ew-sensors-cloak.md`) unless the ship begins moving (C5.44).
- **Emergency Deceleration (C8.0).** Never plotted and may not be anticipated in the plot (C8.25). Stops exactly two impulses after declaration; unused movement energy (including allocated Tac, excluding allocated HET) is halved (floor) into one shield within a group {6,1,2} or {3,4,5} (C8.11); then a 16-impulse speed-0 lockout (C8.42). ED can only stop, never partially slow (C8.21).
- **Reverse / Quick Reverse (C3.5/C3.6).** Direction is plotted in Energy Allocation; forward and reverse cannot mix in one turn. Braking = previous-turn practical speed (warp, ≤1 impulse), must be fully used (C3.52), drops to 0, resets Turn/slip modes, then accelerates in reverse within limits. Quick Reverse rolls 1d6 in the reversing impulse: if `roll ≤ brakingShortage`, the ship breaks down (no first-use bonus); illegal within 1/4 turn of an HET/Quick Reverse (C3.62).
- **Disengagement (C7.0).** *Acceleration:* full turn at max practical speed, then warp remaining ≥ `max(ceil(0.5×originalWarp), 15)` (C7.11). *Separation:* during a Lock-On Stage, >50 effective hexes from every enemy ship, >75 from operating scouts, >35 from PFs/manned shuttles (C7.21). *Sublight evasion:* warp-less only, 1d6 ≤ 3 after modifiers (−1 per friendly non-disengaging ship ≤35, +1 per uncrippled enemy ≤15), once per turn (C7.31). Bases and pinwheels never disengage.
- **Mid-turn speed change [v2] (C12.0).** ≤4 changes/turn, none within 8 impulses (nimble 6) or before #4/after #28; decel always plotted and ≤ half current (round reduction up, or by 4 if speed <8); unplotted accel costs `min(2×hexesGained, hexesIfNewSpeedRanRemainder)` floored at 1, announced one impulse early (step 6A4) to take effect next impulse (6A2).

## UI Contract

The Movement Engine feeds the battle map (`D1-map-board-ui.md`, wireframe `wireframes/D4-movement-plotting.svg`). Per impulse the client receives, for each controllable unit: current `hex`, `facing`, the four speeds, `straightHexSinceTurn` vs the live `turnMode` (so the map can highlight legal turn hexes), the two legal sideslip hexes, whether HET/Tac/ED/reverse are currently legal (with the citing rule on hover for illegal ones), and active lockout countdowns (`postHetRestrictionUntil`, `postBreakdownUntil`, `postDecelUntil`). The map renders a ghost track of the impulse schedule (which of the 32 impulses this unit moves) so the player can see the rhythm of motion. Tactical choices — turn direction, slip vs turn vs straight, HET timing, reverse, disengagement method — are always player-initiated; the engine only enables/disables the controls. Fog-of-war: hidden enemy facing/speed is never sent (server enforces, see `A3-data-architecture-event-store.md`).

## Dependencies

- `C2-energy-allocation-power.md` — funds the speed plot, reserve warp, braking energy, HET/Tac allocation; supplies the energy ledger this engine reads.
- `C1-sequence-of-play-engine.md` — owns the 32-impulse turn frame, the Impulse Chart, and the intra-impulse Movement Segment ordering this engine consumes.
- `E1-dice-rng-service.md` — seeded RNG behind `DiceRolled` (breakdown, Quick Reverse, sublight evasion, random tumbling facing).
- `C8-ew-sensors-cloak.md` — pseudo-speed and net-effective-vector inputs for towed movement.
- `C5-seeking-weapons.md` — seeking units are Turn-Mode-1 movers resolved in this engine's precedence order.
- `C7-damage-criticals-repair.md` — mid-turn engine loss forces deceleration-due-to-damage (C2.3); breakdown damage routes here.
- `A3-data-architecture-event-store.md` — append-only `gameEvents`, snapshots, fog enforcement.
- Erratic Maneuvering (C10.0) & Nimble Ships (C11.0) [v2] — Turn-Mode +1, extra HETs, 6-impulse change spacing. These are movement rules owned by **this** engine (added as a v2 extension), not a separate subsystem doc.

## Edge Cases & Open Questions

- Seeking and Shuttle chart columns cap (Seeking always TM1; Shuttle at TM3 "24+"); the model must never assign higher Turn Modes to those units — encoded via `TURN_MODE_CHART`. *Confirm against C3.32.*
- Exact Impulse Chart (which of 32 impulses each speed 1–31 moves) is owned by `C1-sequence-of-play-engine.md`; this engine consumes `impulseScheduleForSpeed`. The Speed-6 (outstanding-crew) and reduced poor-crew Tac-earn schedules still need their exact impulse lists.
- C12.24 unplotted-acceleration speed-cap math is intricate; encode as `min(2×gained, ifNewSpeedRanRemainder)` floor 1 and verify against all worked examples [v2].
- Sideslip target geometry (the two forward-oblique hexes) should be validated against the C4.4 diagram for each facing/orientation before locking `DIR_VECTORS`.
- Breakdown crew-loss rounding interacts with G9 ("never kill the last two crew") and boarding-party accounting; precise order needs `C7-damage-criticals-repair.md`/G9.
- No ramming/collision rules exist (C1.7); stacking is unlimited (C1.61) and each counter resolves independently — the engine must not auto-collide.

## Testing

- **Geometry:** property tests — `neighbor`/`rotateFacing` round-trip; `reverseTarget = neighbor(rotateFacing(f,3))`; `hexDistance` symmetry; sideslip targets are the two forward-oblique hexes for all six facings.
- **Turn Mode chart:** table-driven assertions on the worked examples — category D at speed 9 ⇒ TM3, at speed 13 ⇒ TM4; category B at 22 ⇒ TM5; speed 1 ⇒ TM0; seeking ⇒ TM1 at any speed.
- **Counters:** simulate a straight run then a turn; assert the entered hex resets `straightHexSinceTurn` to 1 and that carryover across the turn break is preserved (C3.41).
- **Schedule:** assert no movement on impulses #1–#2 and that a speed-1 unit moves only on #32 (C1.43); assert a speed-N unit moves on exactly N impulses.
- **Acceleration/deceleration:** between-turn `prev 3 ⇒ max 13`, `prev 13 ⇒ max 26`; mid-turn half-decel chain 31→15→7→3→0 [v2].
- **HET/breakdown:** with a fixed RNG seed, verify the threshold comparison, first-use −2, mode resets, and the 16/8-impulse lockouts; verify breakdown forfeits movement energy.
- **Determinism:** replay the full `gameEvents` log for a recorded skirmish and assert identical board state, proving the seeded RNG and fold are deterministic.

## Phasing

**[v1 AM-tournament]:** hex/facing/coords, proportional impulse movement and the Order of Precedence for ships/seeking/fighters, Standard Free plotting (level B) with a single legal speed plot, the full Turn Mode chart with carryover/reset, between-turn acceleration limits, sideslip, Tactical Maneuvers, HET + breakdown, reverse/braking + Quick Reverse, Emergency Deceleration, tractor pseudo-speed timing, the four-speed model, and disengagement (acceleration/separation/sublight evasion). These cover everything two ships need to dance in a tournament duel.

**[v2]:** mid-turn speed change (C12) with the doubled-cost/speed-cap math, nimble (C11) and erratic (C10) modifiers, base rotation, and the liberal/plotted levels (A/C/C1). Deferred because tournament play standardizes on a fixed speed plot and standard free movement; these add Commander's-rule depth without changing the v1 contract.

**[v3]:** tumbling, Directed Turn Modes, positron flywheel, super-fast (>32 hex/impulse) movement, monster/temporal precedence steps, pinwheels, and atmosphere-crash resolution — rare full-Master content with isolated rule interactions.
