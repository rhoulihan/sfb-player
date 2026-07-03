# D4 — Movement Plotting UI

## Purpose & Scope

The Movement Plotting UI is the client surface a commander uses to author a unit's motion for a turn and to steer it impulse-by-impulse during play. It is a *thin, optimistic mirror* of the authoritative Movement Engine (`C3-movement-engine.md`): the player drags a projected path across the hex grid, the workspace renders live Turn-Mode legality (legal turns glow, illegal turns are blocked with the citing rule on hover), shows the speed plan against the 32-impulse Impulse Chart so the rhythm of motion is visible, and exposes sideslip / HET / Tactical-Maneuver / Emergency-Deceleration / reverse controls — each enabled or disabled exactly as the referee would rule. Nothing here decides tactics: the workspace only *previews* legality and *packages* the player's choice into the canonical commands (`PlotMovement`, `DeclareTurn`, `DeclareSideslip`, `DeclareHET`, …) that the server re-validates and folds. The same pure functions that the server uses to validate (shared package `@sfb/movement-core`) run client-side for zero-latency feedback, so what the ghost preview shows is what the engine commits.

**PHASE:** [v1 AM-tournament] delivers the two core modes — **Speed-Plan mode** (set the constant turn speed and movement-energy commitments during Energy Allocation, level B Standard Free) and **Live-Steer mode** (drag the ghost path forward each Movement Segment, choosing turn/slip/HET/reverse/Tac/ED with live legality), the Impulse-Chart ribbon, the legality overlay, the ghost preview, and the sealed commit. Pre-Plot mode (draw the whole hex path up front for levels C/C1) and the per-impulse mid-turn speed-plan editor (C12) are [v2]. Tumbling animation, Directed-Turn-Mode declaration UI, positron flywheel, and super-fast multi-hex steps are [v3].

## Rulebook References

- Plotting levels & always/never-plotted lists (C1.31–C1.35); pre-plotted movement & the controller role (C1.32, C1.44).
- Proportional 32-impulse movement / Impulse Chart, no move on #1–#2, speed-1 on #32 (C1.43).
- Energy cost of movement and the speed caps the plan must honor (C2.11–C2.16); between-turn acceleration ceiling `prev + max(prev,10)` (C2.21).
- Turn timing, the straight-hex counter, carryover and resets (C3.1, C3.33, C3.41–C3.45); Turn-Mode chart & assignment (C3.31, C3.32).
- Sideslip — constant slip mode 1, counts as straight for Turn Mode, cannot combine with a turn (C4.0, C4.31, C4.32, C4.34).
- High Energy Turn — cost, 180° limit, spacing, post-HET restriction window (C6.0, C6.36, C6.38, C6.39); free vs plotted HET (C6.11, C6.12).
- Tactical Maneuvers (C5.0, C5.13); Emergency Deceleration — never plotted (C8.0, C8.25); reverse/braking (C3.5).
- Movement Segment placement and the "announce movement changes" delay (B2.3 6A, 6A4); secret-and-simultaneous sealed submission (B2.4).

## Domain Model

These are **client view-models** held in the workspace store (Zustand). Authoritative motion types (`Facing`, `MovementMode`, `HexCoord`, `MovementPlot`, `UnitMovementState`, `RuleViolation`) are imported from `@sfb/movement-core`, the shared package extracted from `C3-movement-engine.md`, so client and server never drift.

```ts
import type {
  Facing, MovementMode, HexCoord, MovementPlot, UnitMovementState,
  PlottingLevel, RuleViolation, ValidationResult,
} from '@sfb/movement-core';

export type WorkspaceMode = 'speed-plan' | 'live-steer' | 'pre-plot' /*v2*/ | 'readonly';
export type Maneuver =
  | 'straight' | 'turn-left' | 'turn-right'
  | 'slip-left' | 'slip-right' | 'het' | 'reverse' | 'tac' | 'ed';

/** The editable speed plan authored during Energy Allocation (phase 1). */
export interface SpeedPlanDraft {
  unitId: string;
  plottingLevel: PlottingLevel;       // tournament default 'B'
  direction: MovementMode;            // forward | reverse (reverse is plotted, C3.5)
  speedConstant: number;              // level-B single speed; fills speedPlot[1..32]
  speedPlot: number[];                // length 32 (constant at B; per-impulse for C12 [v2])
  brakingEnergyAllocated: number;     // must be fully used if reversing (C3.52)
  hetReserveAllocated: number;        // warp hexes set aside for a free HET (C6.11)
  tacManeuversAllocated: number;      // warp Tac reserved (C5.22)
  estMovementCost: number;            // echoed from C2 ledger for the readout
}

/** One projected hex-entry along the ghost path; produced purely from the plan + unit state. */
export interface GhostStep {
  index: number;                      // 0-based ordinal along the path
  impulse: number;                    // which of the 32 impulses this entry lands on (C1.43)
  fromHex: HexCoord;
  toHex: HexCoord;
  facingAfter: Facing;
  maneuver: Maneuver;
  legal: boolean;                     // mirror of C3.validate* for this step
  turnModeNeeded: number;             // hexes of straight movement required (C3.31)
  straightHexCounter: number;         // running counter at this step (C3.1)
  violation?: RuleViolation;          // cite rule when illegal (shown on hover)
  committed: boolean;                 // sealed/acknowledged by the server already
}

export interface GhostPath {
  unitId: string;
  steps: GhostStep[];
  committedThroughIndex: number;      // -1 until first impulse committed
  endsFacing: Facing;
  totalHexes: number;                 // == practical speed for a full plan
}

/** Affordances offered at the *current* decision hex while live-steering. */
export interface HexAffordance {
  hex: HexCoord;
  kind: Maneuver;
  legal: boolean;
  reasonRuleRef?: string;             // e.g. 'C3.1' when a turn is blocked
}

export interface MovementWorkspaceState {
  gameId: string;
  unitId: string;
  mode: WorkspaceMode;
  clockOpen: boolean;                 // is this unit's submit gate open right now (from C1 ClockView)
  unit: UnitMovementState;            // last folded state for the unit (server-pushed)
  plan: SpeedPlanDraft;
  ghost: GhostPath;
  affordances: HexAffordance[];       // recomputed each pointer move / impulse
  selectedManeuver: Maneuver | null;  // pending live-steer choice
  serverVerdict?: ValidationResult;   // authoritative confirmation of the sealed plan
  lockStatus: 'editing' | 'sealing' | 'locked';
  dirty: boolean;                     // unsealed edits exist (drives autosave)
}
```

**Mongoose sketch.** The UI owns one persisted collection: `movementPlotDrafts`, a fog-safe autosave of an *unsealed* draft so a player who disconnects mid-plot resumes exactly where they left off (pairs with the pause/resume guarantee in `C1-sequence-of-play-engine.md`). Sealed plots live in the C1/C2 sealed-order store, never here; a draft is private to its `actorId` and is deleted on seal.

```ts
const MovementPlotDraftSchema = new Schema({
  gameId:   { type: ObjectId, index: true, required: true },
  actorId:  { type: String,   index: true, required: true }, // owner only; fog-enforced
  unitId:   { type: String,   required: true },
  turn:     { type: Number,   required: true },
  plan:     { type: Schema.Types.Mixed, required: true },     // SpeedPlanDraft
  ghost:    { type: Schema.Types.Mixed },                     // GhostPath (pre-plot levels)
  updatedAt:{ type: Date, default: Date.now },
}, { timestamps: true });
MovementPlotDraftSchema.index({ gameId: 1, actorId: 1, unitId: 1, turn: 1 }, { unique: true });
```

## Events & Commands

The workspace issues the *same* canonical commands the engine defines; it never invents UI-only mutations. They are routed through the C1 gate (`SubmitSealedOrders` for sealed steps, `DeclareOpenAction` for open-sequential 6A steering) and re-validated by C3.

```ts
// COMMANDS the UI emits (payloads imported from C3; routed via C1)
type UiMoveCommand =
  | { type: 'PlotMovement'; plot: MovementPlot }                                   // phase-1 seal (C1.34)
  | { type: 'DeclareTurn'; unitId: string; impulse: number; turnTo: Facing }       // 6A live-steer (C3.1)
  | { type: 'DeclareSideslip'; unitId: string; impulse: number; toHex: string }    // 6A (C4.0)
  | { type: 'DeclareHET'; unitId: string; impulse: number; newFacing: Facing }     // 6A (C6.0)
  | { type: 'DeclareTacticalManeuver'; unitId: string; impulse: number; source: 'sublight'|'warp'; turnTo: Facing }
  | { type: 'DeclareEmergencyDeceleration'; unitId: string; impulse: number; reinforceShield: 1|2|3|4|5|6 }
  | { type: 'DeclareReverse'; unitId: string; quick?: boolean };                    // C3.5 / C3.6

// A non-mutating preview request (server runs C3 validators authoritatively).
type PreviewPlotQuery = { type: 'PreviewPlot'; gameId: string; plot: MovementPlot };
type PreviewPlotReply = { verdict: ValidationResult; ghost: GhostPath };
```

**Events the UI consumes** (it renders from the fold, it does not author events):

- `ClockView` (from `C1`) — sets `mode`/`clockOpen`: phase-1 ⇒ `speed-plan`; this unit listed in an `ImpulseAdvanced.movers` set ⇒ `live-steer`; otherwise `readonly`.
- `MovementPlotted` — server accepted and sealed the speed plan; flips `lockStatus → locked`.
- `OrdersSealed` / `AllOrdersLocked` / `OrdersRevealed` — sealed-step lock progress for the HUD badge.
- `ImpulseAdvanced { turn, impulse, movers }` — drives the live-steer turn order; the workspace activates only on this unit's mover step.
- `UnitMoved`, `ShipTurned`, `ShipSideslipped`, `HighEnergyTurnExecuted`, `TacticalManeuverPerformed`, `EmergencyDecelerationCompleted`, `DirectionReversed`, `BreakdownOccurred` — reconcile the ghost with reality and animate the token; on `BreakdownOccurred` the workspace clears the remaining ghost (the unit forfeits its movement, C6.5).
- `GmOverrideApplied` — surfaces a banner and re-pulls `UnitMovementState`.

## Engine / API

All projection/legality helpers are **pure and shared** with C3 (single source of truth); the React layer adds hooks and drag handlers.

```ts
// --- Shared pure helpers (exported by @sfb/movement-core, also used by C3) ---
function projectGhostPath(plan: SpeedPlanDraft, u: UnitMovementState,
                          chart: ImpulseChart): GhostPath;                    // C1.43 schedule + C3.1 counter
function affordancesAt(u: UnitMovementState, ctx: TurnContext): HexAffordance[]; // legal turn/slip/HET/reverse hexes
function turnMode(category: UnitMovementState['category'], speed: number): number;  // C3.31 lookup
function previewManeuver(u: UnitMovementState, m: Maneuver, ctx: TurnContext): ValidationResult; // mirrors C3.validate*
function accelBounds(prevTurnSpeed: number): { min: 0; max: number };        // C2.21 ceiling for the speed slider

// --- React hooks (client-only) ---
function useMovementWorkspace(gameId: string, unitId: string): MovementWorkspaceState & {
  setSpeed(n: number): void;                     // clamped to accelBounds; refills speedPlot
  setDirection(d: MovementMode): void;           // toggles reverse; surfaces braking control
  allocateBraking(hexes: number): void;
  allocateHetReserve(hexes: number): void;
  allocateTac(count: number): void;
  selectManeuver(m: Maneuver | null): void;      // arms a live-steer choice
  sealSpeedPlan(): Promise<ValidationResult>;     // → PreviewPlot then PlotMovement
  commitImpulseMove(): Promise<void>;            // → Declare* for selectedManeuver (or straight no-op)
};
function useGhostPath(unitId: string): GhostPath;          // memoized projectGhostPath
function useTurnModeHud(unitId: string): { turnMode: number; straightHexes: number; canTurnInHexes: number };

// --- Drag interaction (SVG/Canvas pointer handlers; pre-plot & live-steer) ---
function onHexPointerDown(e: PointerEvent): void;          // begin a drag from the unit token
function onHexPointerMove(e: PointerEvent): void;          // snap to hex center; extend ghost; recompute affordances
function onHexPointerUp(e: PointerEvent): void;            // commit drag to the draft (no server write yet)
function snapToHex(px: number, py: number): HexCoord;      // inverse of the map transform
```

`sealSpeedPlan()` first calls `PreviewPlot` (authoritative C3 verdict); if `verdict.ok` it dispatches `PlotMovement` wrapped in `SubmitSealedOrders` for the phase-1 step, else it renders the violations inline and keeps the plan editable. `commitImpulseMove()` maps `selectedManeuver` to the matching `Declare*` command for the current `impulse`; a `straight` choice is the default no-op that simply advances. Every helper is memoized on `(unit, plan, clock)` so dragging stays at 60 fps.

## Validation & Enforcement Rules

The workspace is **advisory, never authoritative** — it speeds the player up but the server rules. Enforcement contract:

- **Optimistic mirror, server truth.** Client legality comes from `@sfb/movement-core` (the exact functions C3 runs). The UI may *gray out* an illegal control, but a seal/commit is final only after the server's `ValidationResult.ok`; on a server reject the workspace rolls the ghost back and shows the violation with its rule citation.
- **Gate awareness (B2.3 / B2.4).** Submit controls are enabled only when `clockOpen` (C1's `legalCommandsAt` admits the command at the current clock). A speed plan seals during phase 1; steering commits only on this unit's `ImpulseAdvanced` mover step in 6A. Anything else is read-only.
- **Speed plan legality (C2.11–C2.16, C2.21).** The speed control is clamped to `accelBounds(previousTurnSpeed)` (between-turn max `prev + max(prev,10)`) and to the absolute cap 31; the warp/impulse split and ≤30-warp / ≤1-impulse rules are surfaced as the readout from `D3-energy-allocation-ui.md`/`C2-energy-allocation-power.md`. Reverse requires a non-zero braking allocation that must be fully spent (C3.52).
- **Turn legality (C3.1, C3.31, C3.33).** A turn affordance is offered only when `straightHexCounter ≥ turnMode(category, speed)`; the turned-into hex is shown resetting the counter to 1 (it is the first straight hex). Speed-1 renders as Turn-Mode 0 (turn-then-move on impulse #32, C3.33). Carryover across the turn break is reflected from the folded `straightHexSinceTurn` (C3.41).
- **Sideslip (C4.0).** Slip affordances appear when `slipHexSinceSlip ≥ 1`; the workspace forbids selecting a turn and a slip on the same impulse (C4.34) and shows the slipped-into hex advancing the straight-for-Turn-Mode counter but not the slip counter (C4.31, C4.32).
- **HET (C6.0).** The HET button is enabled only with ≥5 warp hexes reserved/available, disabled on impulse #1, within 8 impulses of a prior HET/Quick-Reverse (C6.36), and at speed 31 unless the ship can exceed 30 warp points (C12.38). On arm it previews any of the ≤180° refacings (C6.39) and warns that a breakdown die follows (the roll itself is the server's, via `E1`).
- **Never-plotted guardrails (C1.35, C8.25).** The Speed-Plan editor refuses to encode ED, weapons fire, tractors, reserve power, or launches into the plot; ED is offered only as a *live* control during 6A and may never be pre-anticipated in the speed plan.
- **Fog-of-war.** The workspace renders ghost paths and legality only for units this actor controls; it never receives or draws hidden enemy facing/speed/plan (server-enforced, `A2-identity-roles-gating.md`). Drafts in `movementPlotDrafts` are owner-scoped.
- **GM override point.** A `GmOverrideApplied` may force a plan accepted/rejected or relocate a unit; the workspace re-pulls state and shows a non-dismissable override banner.

## UI Contract

The screen is the **Movement Plotting Workspace**, laid out in `wireframes/D4-movement-plotting.svg`. It composes over the shared battle map (`D1-map-board-ui.md`) as an overlay layer plus a docked control rail, and it takes its clock/lock cues from the Impulse HUD (`C1-sequence-of-play-engine.md` `ClockView`). Regions, matching the wireframe callouts:

1. **Map canvas (center, ~70% width).** The hex grid with the selected unit's token and a faceted facing wedge (A–F). The plotting overlay draws: the **ghost path** as a dashed poly-line of `GhostStep`s (green = legal, red dashed = illegal, solid = already committed); per-step facing pips; the **affordance halo** at the current decision hex — forward hex (neutral), the two turn hexes (glow when `legal`, struck-through with a rule tooltip when not), the two forward-oblique sideslip hexes, and HET target ring. A drag from the token snaps point-to-point across hexes (`snapToHex`), extending the ghost while a live tooltip shows the running straight-hex counter vs Turn Mode. In pre-plot mode [v2] the entire path is drawn this way before sealing.

2. **Speed-Plan panel (right rail, top).** A speed stepper/slider clamped to `accelBounds`, a forward/reverse toggle, and — when reversing — a braking-energy field. Below it the **Impulse-Chart ribbon**: a 32-cell strip where cells the unit moves on (per `projectGhostPath`) are filled and idle cells are hollow, with the current impulse marked by a cursor (no fills on #1–#2; a lone fill on #32 for speed 1, C1.43). A movement-cost readout mirrors the C2 ledger. Reserve allocations for **HET** and **Tactical Maneuvers** sit here as small steppers.

3. **Maneuver toolbar (right rail, middle).** Buttons: Straight · Turn-L · Turn-R · Slip-L · Slip-R · HET · Reverse · Tac · ED. Each reflects `affordancesAt`/`previewManeuver`: enabled, or disabled with the citing rule on hover (e.g. HET → "C6.36: within 1/4 turn of a prior HET"). The armed maneuver is highlighted and previewed on the map before commit.

4. **Turn-Mode HUD (right rail, below toolbar).** Three live readouts from `useTurnModeHud`: current Turn-Mode number, accumulated straight hexes, and "may turn in N hexes." A small badge shows active lockout countdowns (post-HET, post-breakdown, post-ED) pulled from `UnitMovementState`.

5. **Commit bar (footer).** A plan summary ("Speed 13 · 13 hexes · 2 turns · ends facing C") and the **Seal / Commit** control. In speed-plan mode the button reads "Submit & Lock" and is enabled only when `clockOpen` and the client mirror passes; in live-steer mode it reads "Commit Impulse Move." A lock badge (editing / sealing / locked) and any `serverVerdict` violations render here.

The workspace never blocks the player from *considering* an illegal move — it shows it in red with the reason — but it only lets them *commit* legal moves, and the server has the last word. Tactical choices (which way to turn, slip vs turn vs straight, whether to risk an HET, when to ED) are always the player's; the UI only computes and displays legality.

## Dependencies

- `C3-movement-engine.md` — the authoritative engine; exports `@sfb/movement-core` (types, `turnMode`, `projectGhostPath`, validators) that this UI reuses verbatim.
- `C2-energy-allocation-power.md` — funds the speed plan; supplies the movement-cost / reserve readouts shown in the Speed-Plan panel.
- `C1-sequence-of-play-engine.md` — `ClockView`, the command gate (`legalCommandsAt`), and the sealed-submit → lock → reveal protocol the seal control is bound to.
- `D1-map-board-ui.md` — the shared hex-map renderer this workspace overlays; hex pick/transform helpers (`snapToHex`).
- `D3-energy-allocation-ui.md` — sibling phase-1 surface; the speed plan is sealed inside the same Energy-Allocation envelope and the two panels share the energy ledger.
- `A4-realtime-sync-layer.md` — Socket.IO transport for commands/events; idempotent delivery; Redis presence.
- `A2-identity-roles-gating.md` — actor/role resolution and fog-of-war enforcement for drafts and ghost paths.
- `A3-data-architecture-event-store.md` — the fold the workspace renders from; `movementPlotDrafts` persistence.
- `D5-targeting-combat-ui.md` — sibling that follows the same gate-driven enable/disable pattern (cross-checked for consistency, not a hard dependency).

## Edge Cases & Open Questions

- **Free vs plotted direction.** At level B (tournament) only *speed* is plotted; direction is steered live in 6A. The workspace must not let a player believe a dragged path is binding under level B — the ghost beyond the committed impulse is explicitly styled "projected, not committed." Pre-plot binding applies only to levels C/C1 [v2].
- **Announce-delay (B2.3 6A4).** A mid-turn speed change [v2] takes effect one impulse after announcement; the ribbon must visualize this one-impulse lag so the player isn't surprised. *Confirm the exact step label with `C1`.*
- **Breakdown mid-ghost.** When a HET breakdown occurs, the remaining ghost is invalidated (movement forfeited, C6.5); the workspace should animate the discard rather than silently drop it.
- **Sideslip target geometry.** The two forward-oblique hexes must match the C4.4 diagram for every facing/orientation; verify against `DIR_VECTORS` in C3 before locking the affordance renderer.
- **Drag fidelity on dense stacks.** Stacking is unlimited (C1.61); the drag picker must disambiguate overlapping tokens (z-cycling on repeated click) without affecting the path.
- **Optimistic/authoritative divergence.** If the client mirror ever disagrees with the server verdict, that is a bug in the shared package; the workspace logs a telemetry event and trusts the server. *Open: add a CI contract test that fuzzes states through both call sites.*

## Testing

- **Mirror parity:** property test — for random `UnitMovementState` + plan, assert `@sfb/movement-core.previewManeuver` (client) equals the server's `C3.validate*` verdict for every maneuver; zero divergence is the gate.
- **Ribbon correctness:** assert the Impulse-Chart ribbon fills exactly the scheduled impulses for speeds 1–31 (no fills #1–#2; single fill #32 at speed 1, C1.43); speed-N fills exactly N cells.
- **Turn legality overlay:** category D at speed 9 ⇒ turn affordance appears only after 3 straight hexes (TM3); at speed 13 ⇒ after 4 (TM4); speed 1 ⇒ turn-then-move offered on #32 only (C3.33).
- **Sideslip rules:** assert slip and turn are mutually exclusive on one impulse (C4.34) and that a slipped-into hex advances the Turn-Mode counter but not the slip counter (C4.31/C4.32).
- **HET gating:** with <5 reserved warp, on impulse #1, and within 8 impulses of a prior HET, the HET button is disabled with the correct citing rule (C6.0/C6.36); enabled otherwise.
- **Seal flow:** `sealSpeedPlan` calls `PreviewPlot`, then `PlotMovement` only on `ok`; on reject the plan stays editable and violations render; the draft autosaves and survives a simulated disconnect/reload (pause/resume).
- **Fog-of-war:** assert no enemy ghost/plan/facing is ever present in the client store or DOM; drafts are owner-scoped.
- **Determinism handoff:** committing the same sequence of maneuvers against a fixed seed reproduces the identical event stream the engine folds (shared replay with `C3`/`E2`).

## Phasing

**[v1 AM-tournament]:** Speed-Plan mode (level B constant speed, forward/reverse with braking, HET/Tac reserve) sealed in the Energy-Allocation envelope; Live-Steer mode with drag point-to-point projection, the affordance halo, legal/illegal turn highlighting, sideslip/HET/Tac/ED/reverse controls, the Impulse-Chart ribbon, the Turn-Mode HUD, ghost preview, the client mirror of C3 validators, owner-scoped draft autosave, and the gate-bound Seal/Commit bar. This covers everything two ships need to plot and dance in a tournament duel.

**[v2]:** Pre-Plot mode (draw and seal the whole hex path for levels C/C1, C1.32) and the per-impulse mid-turn speed-plan editor (C12) with the announce-delay visualization and the doubled-cost/speed-cap readout; nimble/erratic visual modifiers (extra HETs, 6-impulse spacing). Deferred because tournament play standardizes on a single sealed speed plan plus standard free steering.

**[v3 full Master]:** Tumbling animation and uncontrolled-facing display, the Directed-Turn-Mode left/right/neutral declaration strip (C3.8), positron-flywheel stored-momentum readout, and super-fast (>32) multi-hex-per-impulse step rendering — rare full-Master content with isolated interactions that do not change the v1 plotting contract.
