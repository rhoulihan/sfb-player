# C1 — Sequence of Play / Turn-Impulse Engine

## Purpose & Scope

This subsystem is the master scheduler for SFB Player: the deterministic state machine that drives a game forward one rule-legal step at a time. It owns the *clock* — `(turn, phase 1‑8, impulse 1‑32, segment A‑E, micro-step)` — and the *gate* logic that decides which command types are legal at the current clock position. Every other mechanics module (energy, movement, direct fire, seeking weapons, EW/sensors, damage) plugs into this engine as a **resolver** that the engine invokes when, and only when, the clock reaches that module's window. The engine also operates the sealed‑submit → lock → reveal protocol that makes SFB's "secret and simultaneous" steps cheat‑proof, persists the clock so a game can pause across days and resume with fog‑of‑war intact, and guarantees deterministic replay by routing all randomness through the seeded Dice/RNG service. It does not implement any tactical rule itself — it sequences and gates the modules that do.

**PHASE:** Core engine ships in **[v1 AM-tournament]** (full 8‑phase / 32‑impulse / 5‑segment loop, sealed/reveal, pause/resume, determinism, GM override). Segment 6C (Dogfight Interface) and several non‑tournament micro-steps are **[v2]**/**[v3]**.

## Rulebook References

- (B2.0) Sequence of Play — master turn/impulse clock
- (B2.1) Turn definition and overall structure
- (B2.2) Canonical 8‑phase turn outline
- (B2.3) Phase-by-phase procedure, steps 1–8
- (B2.3 6A–6E) The five ordered impulse segments
- (B2.4) Secret & simultaneous announcement protocol
- (B3.0) Energy Allocation — turn step 1 (owned by `C2-energy-allocation-power.md`)
- (C1.32) Pre-plotted movement; (C1.44) the controller role
- (C2.111 / C2.112) Impulse-power cap and 30‑MP warp cap (speed math)
- (D0.0) Direct-fire combat resolution (segment 6D)
- (D5.0) Self-destruction blast (phase 3)
- (D6.1 / D6.3) Sensor lock-on roll and EW modifiers (phase 4)
- (F2.2 / FD5.0) Seeking-weapon movement; loss of tracking when fire control inactive
- (P2.0) Planets blocking lock-on
- Annex #2 — authoritative fine-grained ordering for phases 5, 6B, 6E, 7, 8 (externalized data)
- Module J — dogfight resolution (segment 6C)

## Domain Model

The engine state is a deterministic fold over the event log (see `A3-data-architecture-event-store.md`); the structures below are the in‑memory projection and the snapshot shape.

```ts
type PhaseId = 1|2|3|4|5|6|7|8;          // B2.2 master cycle
type SegmentId = 'A'|'B'|'C'|'D'|'E';     // B2.3(6A–6E)
type ActorId = string;                    // commander/player principal (A2)

interface GameClock {
  turn: number;                 // 1..N, scenario-bounded or open-ended (B2.1)
  phase: PhaseId;               // 1..8
  impulse: number | null;       // 1..32 iff phase === 6, else null
  segment: SegmentId | null;    // 'A'..'E' iff phase === 6, else null
  microStep: number;            // index into Annex #2 ordered sub-actions for the step
}

type StepStatus =
  | 'auto'              // engine computes + advances, no input
  | 'awaiting-orders'   // sealed-simultaneous: collecting hidden submissions
  | 'awaiting-action'   // open-sequential: collecting visible declarations in turn order
  | 'resolving'         // reveal done, resolver running
  | 'paused';

type Simultaneity = 'auto' | 'open-sequential' | 'sealed-simultaneous';

interface SequenceState {
  gameId: string;
  clock: GameClock;
  status: StepStatus;
  paused: boolean;
  pauseReason?: string;
  pausedBy?: ActorId;
  rngCursor: number;            // monotonic draw index into the seeded stream (E1)
  movementChartId: string;      // canonical Impulse Chart variant in use (C3 owns the table)
  activeStep?: ActiveStep;      // present while a sealed/open step is in flight
  lastEventSeq: number;         // log position this projection reflects
}

// Runtime instance of one sealed/open step: the commit buffer.
interface ActiveStep {
  key: string;                  // StepDescriptor.key, e.g. 'P6.D.directFire'
  simultaneity: Simultaneity;
  requiredActors: ActorId[];    // who MUST submit before reveal
  sealed: Record<ActorId, SealedEnvelope>;  // server-side; never sent to opponents
  lockedActors: ActorId[];
  revealed: boolean;
}

// Hidden order, hash-committed for integrity (commit/reveal store lives in A4).
interface SealedEnvelope {
  actorId: ActorId;
  commitHash: string;           // SHA-256(payload || nonce) — integrity, not secrecy
  payload: unknown;             // typed per step (FireOrders, EWChange, LaunchOrder, …)
  nonce: string;
  submittedAt: Date;
}

// Static description of every position the clock can occupy. The ordered array
// of these IS the phase-ordering contract (see table below).
interface StepDescriptor {
  key: string;
  phase: PhaseId;
  segment?: SegmentId;
  label: string;
  simultaneity: Simultaneity;
  loops?: 'impulse';            // marks the 32x inner loop steps (phase 6)
  conditional?: (s: SequenceState) => boolean;  // e.g. 6C only on dogfight impulses
  acceptsCommands: CommandType[];               // the GATE: legal commands here
  requiredActors: (s: SequenceState) => ActorId[];
  resolver: ResolverRef;        // subsystem fn invoked on reveal/auto (by doc)
  ruleRefs: string[];
}
```

**Mongoose sketch.** The current `SequenceState` rides inside `gameSnapshots` (A3); in-flight sealed envelopes get their own collection so an async game can resume mid-step. Redis fronts this for live fan-out (A4); Mongo is the durable copy.

```ts
const SealedOrderSchema = new Schema({
  gameId:     { type: ObjectId, index: true, required: true },
  stepKey:    { type: String, required: true },        // ActiveStep.key
  clock:      { turn: Number, phase: Number, impulse: Number, segment: String },
  actorId:    { type: String, required: true },
  commitHash: { type: String, required: true },
  payload:    { type: Schema.Types.Mixed, required: true },  // encrypted at rest
  nonce:      { type: String, required: true },
  locked:     { type: Boolean, default: false },
  revealed:   { type: Boolean, default: false },
  submittedAt:{ type: Date, default: Date.now },
}, { timestamps: true });
SealedOrderSchema.index({ gameId: 1, stepKey: 1, actorId: 1 }, { unique: true });
```

## Events & Commands

**Commands consumed** (PascalCase; validated then folded):

| Command | Payload | Notes |
|---|---|---|
| `AdvanceClock` | `{ gameId, expect: GameClock }` | Idempotent tick; `expect` guards against double-advance. Aliased to canonical `AdvanceImpulse` for phase‑6 ticks. |
| `SubmitSealedOrders` | `{ gameId, stepKey, commitHash, payload, nonce, lock?: boolean }` | One actor's hidden orders for the current sealed step (B2.4). |
| `LockOrders` | `{ gameId, stepKey }` | Actor confirms no further changes; all locked ⇒ reveal. |
| `DeclareOpenAction` | `{ gameId, stepKey, action }` | Visible declaration for open-sequential steps (e.g. one-hex move announce). |
| `PauseGame` / `ResumeGame` | `{ gameId, reason?, by }` | Suspend/restore the clock. |
| `ApplyGmOverride` | `{ gameId, target, value, reason }` | GM forces a clock jump, unlock, or resolver result. |

`PlotMovement`, `AllocateEnergy`, `DeclareFire`, `LaunchSeekingWeapon`, `AllocateDamage` are owned by sibling modules but are **routed through this engine's gate** — they are only accepted when the clock is at the matching step (see table). The engine wraps them as the `payload` of the step's sealed/open envelope.

**Events emitted** (past-tense):

`TurnStarted {turn}` · `PhaseEntered {turn,phase}` · `ImpulseAdvanced {gameId,turn,impulse,movers}` · `SegmentEntered {turn,impulse,segment}` · `OrdersSealed {stepKey,actorId,commitHash}` · `AllOrdersLocked {stepKey}` · `OrdersRevealed {stepKey, orders[]}` · `StepResolved {stepKey, emittedEventIds[]}` · `GamePaused {by,reason}` · `GameResumed {by}` · `TurnCompleted {turn}` · `GmOverrideApplied {target,value,reason}`.

`DiceRolled` events (E1) are emitted by resolvers, not by the engine, but their RNG cursor is supplied by this engine so replays match.

## Engine / API

Pure reducers (no I/O) so they replay deterministically; the surrounding service layer handles persistence and Socket.IO fan-out.

```ts
// The ordered descriptor table = the phase-ordering contract.
function stepTable(scenario: ScenarioConfig): StepDescriptor[];
function currentStep(s: SequenceState, table: StepDescriptor[]): StepDescriptor;

// THE GATE. Returns the command types this actor may legally issue right now.
function legalCommandsAt(s: SequenceState, actor: ActorId, table: StepDescriptor[]): CommandType[];
function validateCommand(s: SequenceState, cmd: Command, table: StepDescriptor[]): ValidationResult;

// Pure reducers: (state, command, ctx) -> { events, state }.
function submitSealedOrders(s: SequenceState, cmd: SubmitSealedOrders): Reduction;
function lockOrders(s: SequenceState, cmd: LockOrders): Reduction;
function declareOpenAction(s: SequenceState, cmd: DeclareOpenAction): Reduction;
function advance(s: SequenceState, ctx: ResolveCtx): Reduction;   // fold one step forward
function pause(s: SequenceState, by: ActorId, reason?: string): Reduction;
function resume(s: SequenceState, by: ActorId): Reduction;

// Predicates that drive auto-advance.
function isStepComplete(s: SequenceState): boolean;   // all required actors locked, or auto done
function allLocked(step: ActiveStep): boolean;

// THE FOLD: the single deterministic projector used by snapshots AND replay (E2).
function applyEvent(s: SequenceState, e: GameEvent): SequenceState;

// Resolver dispatch: engine calls the matching subsystem with a scoped RNG stream.
type ResolverRef =
  | { doc: 'C2', fn: 'resolveEnergyAllocation' }
  | { doc: 'C3', fn: 'buildMovementSchedule' | 'resolveMovementSegment' }
  | { doc: 'C5', fn: 'resolveSeekingImpact' }     // END of 6A
  | { doc: 'C8', fn: 'resolveLockOn' | 'applyEwChanges' }
  | { doc: 'C4', fn: 'resolveDirectFire' }        // 6D, simultaneous damage
  | { doc: 'C10', fn: 'resolveSelfDestruct' }     // phase 3
  | { doc: 'J',  fn: 'resolveDogfight' };         // 6C, [v2]
function invokeResolver(ref: ResolverRef, revealed: RevealedOrders, rng: RngStream): GameEvent[];
```

`ResolveCtx` carries `{ rng: RngStream, now: Date, scenario }`. `rng` is seeded by `(gameId, clock, rngCursor)` so every draw is reproducible (`E1-dice-rng-service.md`).

## Validation & Enforcement Rules

1. **Hard ordering (B2.2 / B2.3 NOTE).** A command is rejected with `OUT_OF_SEQUENCE` unless its type appears in `legalCommandsAt(...)` for the current clock. The descriptor array is normative: a later step can never resolve before an earlier one (some SFB actions are legal *only* because of where they fall in the sequence).
2. **Sealed simultaneity (B2.4).** For `sealed-simultaneous` steps the engine reveals nothing until **every** `requiredActor` has a `locked` envelope. Opponents' payloads are never sent to clients before `OrdersRevealed`; fog-of-war is enforced server-side. EW changes for an impulse must be carried in the *same* locked envelope as the fire orders (B2.3 6D) — the engine validates that 6D submissions bundle both.
3. **Simultaneous damage snapshot (6D / D0.0).** Before any 6D resolver runs, the engine freezes the committed-to-fire weapon list; a weapon destroyed earlier in the same segment still fires. Resolvers receive the frozen list, not live state.
4. **Seeking-weapon timing (6A end, F2.2).** The engine resolves `C5.resolveSeekingImpact` at the *end* of segment 6A — before 6D — so a unit killed by a drone/plasma cannot fire that impulse. This ordering is load-bearing and not configurable.
5. **Lock-on gating (phase 4, D6.1).** Phase 4 writes a per-ship whole-turn boolean (all targets or none). Segment 6D rejects fire from any ship without lock-on (`NO_LOCK_ON`). The flag is recomputed only at each turn's phase 4.
6. **Speed lock (phases 1–2).** Energy (C2) fixes speed in phase 1; phase 2 builds the immutable movement schedule. Movement commands in 6A are validated against that schedule + turn mode (C3); a unit may only advance on its scheduled impulses.
7. **Conditional steps.** 6C runs only when `conditional` returns true (designated dogfight impulse); otherwise the engine skips it without opening a gate. Empty Annex‑#2 micro-step lists auto-advance.
8. **GM override points.** `ApplyGmOverride` may: force-unlock a stuck actor, inject a substitute resolver result, or jump the clock (e.g. skip a phase for a house rule). Every override emits `GmOverrideApplied {target,value,reason}` and is replay-visible. This is the sanctioned escape hatch for edge cases (`A2-identity-roles-gating.md` defines who may issue it).
9. **Idempotency.** `AdvanceClock.expect` and event sequence numbers make every tick idempotent under Socket.IO retries (`A4-realtime-sync-layer.md`).

## Phase-Ordering Table (canonical)

Per turn, executed strictly top-to-bottom. Phase 6 repeats its A–E block 32 times.

| # | Step | Code | Loop | Simultaneity | Opens decision | Drives (doc) | Key event | Rule |
|--|--|--|--|--|--|--|--|--|
| 1 | Energy Allocation | P1 | — | sealed-simultaneous | Power distribution, speed, arming | C2 | `OrdersRevealed` | B2.3(1), B3.0 |
| 2 | Speed Determination | P2 | — | auto | none (speed already chosen) | C3 | `PhaseEntered` | B2.3(2) |
| 3 | Self-Destruction | P3 | — | auto | (prior plot) | C10/D5.0 | `StepResolved` | B2.3(3) |
| 4 | Sensor Lock-On | P4 | — | sealed intent + auto roll | Whether to attempt | C8/D6.1 | `OrdersRevealed` | B2.3(4) |
| 5 | Initial Activity | P5 | — | open-sequential (Annex #2) | Tractor/undock/pulsar/guard | C8, C10 | `StepResolved` | B2.3(5) |
| 6A | Movement Segment | P6.A | 32× | open-seq or pre-plotted sealed | One-hex move / turn | C3, then C5 impact | `SegmentEntered` | B2.3(6A), C1.32, F2.2 |
| 6B | Impulse Activity | P6.B | 32× | mixed (Annex #2; launches sealed) | Transport/mine/launch/recover | C5, C6, C10 | `StepResolved` | B2.3(6B) |
| 6C | Dogfight Interface | P6.C | conditional | per Module J | (fighter combat) | Module J **[v2]** | `StepResolved` | B2.3(6C) |
| 6D | Direct-Fire Weapons | P6.D | 32× | sealed-simultaneous | Fire + EW change + targets | C4 (+C8 EW) | `OrdersRevealed` | B2.3(6D), B2.4, D0.0 |
| 6E | Post-Combat | P6.E | 32× | open-sequential (Annex #2) | Post-combat announcements | C7, C10 | `StepResolved` | B2.3(6E) |
| 7 | Final Activity | P7 | — | open-sequential (Annex #2) | End-of-turn actions | C8, C10 | `StepResolved` | B2.3(7) |
| 8 | Record Keeping | P8 | — | auto | none | C2 carryover, scenario | `TurnCompleted` | B2.3(8) |

After P8, increment `turn`, fire any scenario turn-events, and return to P1.

## UI Contract

The engine publishes a `ClockView` over Socket.IO that the **Impulse HUD** (`D6-impulse-hud.md`) renders: current turn/phase/impulse/segment, a 32-impulse strip with the current position highlighted, the active step label, and per-actor *lock status* for sealed steps (locked/pending — never the hidden content). The HUD shows a "Submit & Lock" control whenever `status === 'awaiting-orders'` and surfaces `legalCommandsAt(...)` so other screens (`D3-energy-allocation-ui.md`, `D4-movement-plotting-ui.md`, `D5-targeting-combat-ui.md`) enable/disable their submit buttons exactly when their step is open. On `OrdersRevealed` the HUD animates the reveal and hands resolution detail to the relevant module UI. The GM console (`D9-gm-spectator-console.md`) gets pause/resume, force-unlock, and clock-jump controls bound to `PauseGame`/`ResumeGame`/`ApplyGmOverride`. Clients receive only their own sealed payloads plus public lock-status; no client ever receives an opponent's pre-reveal orders.

## Dependencies

- `A3-data-architecture-event-store.md` — append-only `gameEvents`, `gameSnapshots`, the fold contract.
- `A4-realtime-sync-layer.md` — Socket.IO lockstep, Redis sealed-order store + presence, idempotent delivery.
- `A2-identity-roles-gating.md` — actor/role resolution; who may pause or issue GM override.
- `E1-dice-rng-service.md` — seeded RNG stream keyed by clock + cursor (determinism).
- `E2-game-log-replay.md` — reuses `applyEvent` as the canonical projector.
- `C2-energy-allocation-power.md` — phase 1 resolver; speed/arming inputs.
- `C3-movement-engine.md` — owns the Impulse Chart and movement schedule; 6A resolver.
- `C4-direct-fire-combat.md` — 6D resolver (simultaneous damage).
- `C5-seeking-weapons.md` — end-of-6A impact resolver; launch handling in 6B.
- `C8-ew-sensors-cloak.md` — phase 4 lock-on; EW changes bundled into 6D.
- `C7-damage-criticals-repair.md`, `C10-mines-boarding-misc.md` — post-combat / activity / self-destruct resolvers.

This document **services** all C‑series mechanics docs (it sequences and gates them) and **builds on** the A‑ and E‑series infrastructure docs.

## Edge Cases & Open Questions

- **Annex #2 ordering** for Initial Activity (5), Impulse Activity (6B), Post-Combat (6E), Final Activity (7), and Record Keeping (8) is referenced but not in section B. These micro-step lists must be modeled as **externalized data tables** (replaceable by advanced products), not hardcoded. *Open: source the exact ordered lists.*
- **The Impulse Chart** (speed → which of the 32 impulses a unit moves) lives on a separate sheet owned by `C3-movement-engine.md`. C1 consumes it via `movementChartId`. *Open: source the full speed‑0..32 (and fractional) mapping.*
- **Module J / segment 6C** trigger impulses and mechanics are out of section B; C1 only provides the conditional gate. *Open: J digest.*
- **Disconnect mid-sealed-step:** the engine stays `awaiting-orders`; async submission (B2.4 written-orders analog) lets a player submit later. A GM may force-unlock with a default (no-fire / hold).
- **Held armed weapons, batteries, phaser capacitors, multi-turn arming** carry across the P8→P1 boundary (B3.1); C1 triggers C2's carryover but does not compute it.
- **Self-destruct (phase 3)** uses last turn's final positions, before any movement — the engine must not run phase 6 movement before phase 3.

## Testing

- **Golden-sequence test:** drive a 2-ship turn through all 8 phases and 32 impulses; assert the emitted event stream matches the canonical B2.2/B2.3 order exactly, and that re-folding the log reproduces `SequenceState` byte-for-byte (determinism via fixed RNG seed, E1).
- **Gate tests:** for each step, assert `legalCommandsAt` admits exactly the intended commands and rejects all others with `OUT_OF_SEQUENCE` (e.g. a `DeclareFire` at 6A is rejected; accepted at 6D).
- **Sealed-simultaneity test:** two actors submit; assert no `OrdersRevealed` until both `locked`, and that neither client received the other's payload pre-reveal (fog-of-war).
- **Ordering invariant (B2.3 NOTE):** assert seeking-weapon impact (end 6A) resolves before any 6D fire in the same impulse — a ship killed by a drone cannot fire that impulse.
- **Simultaneous-damage test:** two ships destroy each other in one 6D; assert both weapons fire from the frozen commit list (worked example basis: mutual phaser kill).
- **Pause/resume test:** pause mid-6D with one actor locked; persist, reload from snapshot + tail, resume; assert the in-flight `ActiveStep` and fog-of-war survive.
- **Override test:** `ApplyGmOverride` force-unlock yields a recorded `GmOverrideApplied` and a legal advance.

## Phasing

**[v1 AM-tournament]** — Full clock (8 phases × 32 impulses × 5 segments), the gate (`legalCommandsAt`), sealed→lock→reveal for phase 1, phase 4, 6B launches, and 6D (fire+EW); auto resolution of phases 2/3/8; open-sequential phase 5/6E/7 with tournament-relevant micro-steps only; the end-of-6A seeking-impact ordering; pause/resume; deterministic fold + RNG cursor; GM override hooks. This is the minimum viable referee backbone — nothing else runs without it.

**[v2]** — Segment 6C (Dogfight Interface → Module J) and the full Annex #2 micro-step tables for carriers/PFs (`C6-carriers-shuttles-pf.md`); richer Initial/Final activity (variable pulsar, complex tractor sequencing).

**[v3 full Master]** — Scenario-scheduled turn-events at arbitrary turns, multi-map/sub-light edge sequencing, and any advanced fire-control variants (passive/low-power, D19.0/D6.7) that alter phase-4 gating. These are deferred because tournament play uses a fixed two-side, single-map, lock-on-or-nothing model that the v1 engine already covers.
