# D6 — Impulse / Turn HUD

## Purpose & Scope

The Impulse / Turn HUD is the persistent "cockpit chrome" that frames every game screen in SFB Online. It is a **read-mostly projection** of the authoritative clock owned by `C1-sequence-of-play-engine.md`: it renders the turn counter, the 1‑to‑32 impulse strip, the eight‑phase Sequence‑of‑Play stepper (with the A‑to‑E segment sub‑stepper inside phase 6), a "whose action" prompt banner, per‑side ready/lock indicators, the running dice‑roll log, the local player's action queue, and the pause/resume + connection state. The HUD's job is *situational awareness and gating affordances* — it tells each player exactly where the game is in the sequence, what (if anything) is being waited on, who is locked, and what they are allowed to do right now. It never decides a rule, never reveals hidden information, and never makes a tactical choice; it only mirrors server state and forwards two player intents (pause/resume and "submit & lock"). All mutation flows through C1/`A4-realtime-sync-layer.md`.

**PHASE:** The full HUD — clock strip, phase/segment stepper, lock indicators, dice log, action queue, pause/resume, reconnect badge — ships in **[v1 AM-tournament]**. Replay scrubber, dogfight (6C) sub‑step display, async deadline countdowns, and many‑sided/multi‑commander lock matrices are **[v2]**/**[v3]**.

> Naming note: this doc's id "D6" is the *UI module*, not rulebook section (D6.x), which covers sensor lock-on / fire control. Rulebook citations below use the (B2.x)/(D6.1) forms.

## Rulebook References

- (B2.0) Sequence of Play — the master clock the HUD visualizes
- (B2.1) Turn definition — the unbounded turn counter
- (B2.2) Canonical 8‑phase outline — the stepper's node order
- (B2.3 1–8) Phase‑by‑phase steps — phase labels and the auto/awaiting state of each
- (B2.3 6A–6E) The five ordered impulse segments — the segment sub‑stepper
- (B2.4) Secret & simultaneous announcements — the per‑side **lock/sealed** indicators and "submit & lock" affordance
- (D6.1) Sensor lock‑on roll — a representative entry surfaced in the dice log
- (C1.44) Controller role — the engine, not a player, advances movement; the HUD shows which impulses the viewer's ships move on (chart owned by `C3-movement-engine.md`)

## Domain Model

The HUD has almost no durable state of its own — it is a deterministic fold of the public/fog‑scoped event tail into a **view model**. The only persisted collection is per‑user display preferences. All shapes below are the client‑facing projection; canonical clock types are imported from `C1-sequence-of-play-engine.md`.

```ts
import type { PhaseId, SegmentId, StepStatus, CommandType } from './c1';
type SideId = string; type Role = 'gm'|'commander'|'player'|'spectator';

interface ClockView {                 // mirror of C1 GameClock + display labels
  turn: number;                       // 1..N (B2.1)
  phase: PhaseId;                     // 1..8 (B2.2)
  phaseLabel: string;                // e.g. "Energy Allocation"
  impulse: number | null;            // 1..32 iff phase===6 (B2.3 6)
  segment: SegmentId | null;         // 'A'..'E' iff phase===6
  segmentLabel: string | null;       // e.g. "Direct-Fire Weapons"
  status: StepStatus;                // auto|awaiting-orders|awaiting-action|resolving|paused
  stepKey: string;                   // current StepDescriptor.key (e.g. 'P6.D.directFire')
  stepLabel: string;
}

interface PhaseNode  { phase: PhaseId; label: string; state: 'done'|'current'|'upcoming'; ruleRef: string; }
interface SegmentNode{ segment: SegmentId; label: string; state: 'done'|'current'|'upcoming'|'skipped'; }
interface StepperView{ phases: PhaseNode[]; segments: SegmentNode[]; } // segments populated only in phase 6

interface ImpulseCell{ impulse: number; state: 'past'|'current'|'future';
  viewerMovesHere?: boolean;         // from C3 movement schedule for the viewer's ships
  isDogfightImpulse?: boolean; }     // 6C trigger [v2]
interface ImpulseStripView{ total: 32; current: number | null; cells: ImpulseCell[]; }

interface WhoseActionView{
  kind: 'sealed'|'open-sequential'|'auto'|'paused';
  message: string;                   // "Submit fire orders" / "Klingon side to move" / "Resolving…"
  awaitingSides: SideId[];           // sides we are still waiting on
  viewerActionRequired: boolean;
  legalCommands: CommandType[];      // from C1 legalCommandsAt() — arms the right panel (D3/D4/D5)
  decisionPointId?: string;
}

interface SideReadyView{
  sideId: SideId; sideName: string; isViewer: boolean;
  presence: 'online'|'idle'|'away'|'offline';     // from A4 presence
  lockState: 'not-required'|'pending'|'sealed'|'locked'; // sealed = submitted, not yet locked (B2.4)
}

interface DiceLogEntry{              // folded from DiceRolled events (E1)
  seq: number; at: string; turn: number; impulse: number | null;
  label: string;                     // "Sensor Lock-On — Klingon D7"
  purpose: string;                   // 'lock-on'|'to-hit'|'damage-alloc'|'breakdown'|…
  dice: number[]; total?: number; ruleRef?: string;  // e.g. 'D6.1'
  sideId?: SideId; visibleTo: 'all'|'side'|'gm';      // fog scope (A4/C8)
}

interface ActionQueueItem{           // the viewer's own pending/optimistic orders
  id: string; decisionPointId: string;
  kind: 'EnergyAllocation'|'DirectFire'|'EWChange'|'ImpulseActivity'|'SeekingLaunch'|'movement'|'override';
  summary: string;                   // "Disruptors → Fed CA · +2 ECM"
  state: 'draft'|'sealed'|'locked'|'revealed'|'resolved'|'rejected';
  editable: boolean; ruleRef?: string;
}

interface PauseView{ paused: boolean; by?: string; reason?: string; since?: string; canViewerToggle: boolean; }
interface ConnectionView{ status: 'live'|'reconnecting'|'resyncing'|'offline'; lastSeq: number; behindBy: number; }

interface HudViewModel{
  gameId: string; viewerRole: Role; viewerSideId?: SideId; generatedAtSeq: number;
  clock: ClockView; stepper: StepperView; impulseStrip: ImpulseStripView;
  prompt: WhoseActionView; sideStatus: SideReadyView[];
  diceLog: DiceLogEntry[]; actionQueue: ActionQueueItem[];
  pause: PauseView; connection: ConnectionView;
}
```

**Mongoose sketch — the only persisted HUD collection** (per‑user, per‑game UI prefs; not game state, never replayed):

```ts
const HudPreferenceSchema = new Schema({
  gameId:        { type: String, index: true, required: true },
  userId:        { type: String, index: true, required: true },
  diceLogFilter: { type: String, enum: ['all','mine','combat'], default: 'all' },
  collapsed:     { type: [String], default: [] },        // panel ids the user hid
  soundCues:     { type: Boolean, default: true },
  pinnedShips:   { type: [String], default: [] },        // ships whose move-impulses to highlight
}, { timestamps: true });
HudPreferenceSchema.index({ gameId: 1, userId: 1 }, { unique: true });
```

## Events & Commands

The HUD is overwhelmingly an **event consumer**. It subscribes to the fog‑scoped `eventBatch` stream from `A4-realtime-sync-layer.md` and folds each event into `HudViewModel`. Mapping of canonical events → HUD region:

| Event (source doc) | HUD effect |
|---|---|
| `TurnStarted` / `TurnCompleted` (C1) | Increment/reset the turn counter; reset stepper + impulse strip |
| `PhaseEntered` (C1) | Advance the phase stepper; relabel `clock.phaseLabel` |
| `ImpulseAdvanced` (C1/A4) | Move the impulse‑strip cursor; recompute `viewerMovesHere` cells |
| `SegmentEntered` (C1) | Advance the A–E segment sub‑stepper |
| `OrdersSealed` (A4) | Set the submitting side's `lockState='sealed'` (hash only — no payload) |
| `AllOrdersLocked` (C1) | All required sides → `locked`; prompt flips to "Resolving…" |
| `OrdersRevealed` (A4) | Animate reveal; flip the viewer's queued items to `revealed` |
| `StepResolved` / `WeaponFired` (C1/C4) | Append result rows; advance prompt to next step |
| `DiceRolled` (E1) | Append a `DiceLogEntry` (fog‑filtered) |
| `GamePaused` / `GameResumed` (C1) | Toggle the pause banner |
| `GmOverrideApplied` (C1) | Badge the affected region; append an override row to the dice/event log |

**Ephemeral A4 signals** also drive the HUD (not persisted): `submissionWindowOpened` arms the prompt + relevant input panel; `lockStateChanged {lockedSides,pendingSides}` refreshes `sideStatus`; `presenceChanged` refreshes presence dots; `reconnectRequired`/`gameSnapshot` drive the connection badge and resync.

**Commands the HUD emits** (the only mutations it originates):

```ts
interface PauseGame  { gameId: string; reason?: string; by: string; }   // C1 — gated to gm/host (A2)
interface ResumeGame { gameId: string; by: string; }
interface LockOrders { gameId: string; stepKey: string; }               // relay of the "Submit & Lock" affordance
```

Plus a **client‑only REST** preference write `PUT /api/games/:id/hud-prefs` (persists `HudPreferenceSchema`; emits no game event). The HUD never emits `DeclareFire`/`AllocateEnergy`/etc. itself — those originate in `D3/D4/D5` panels that the HUD merely *arms* via `prompt.legalCommands`.

## Engine / API

Server side, the HUD view is assembled fog‑scoped so a client is physically incapable of receiving hidden data:

```ts
// Build the full view for one viewer (fog applied via A4.broadcastFogScoped / C8 visibility).
function buildHudView(gameId: string, userId: string, atSeq?: number): Promise<HudViewModel>;
```

Client side, the HUD is a pure fold plus React selector hooks (no I/O in the reducer ⇒ it replays identically to `E2-game-log-replay.md`):

```ts
// Pure reducer: fold one already-fog-scoped event into the view model.
function foldHudEvent(view: HudViewModel, e: GameEvent): HudViewModel;

// Derivations (pure selectors over C1 ClockView + the engine's step table).
function deriveStepper(clock: ClockView, table: StepDescriptor[]): StepperView;
function deriveImpulseStrip(clock: ClockView, schedule: MovementSchedule, pinned: string[]): ImpulseStripView;
function deriveWhoseAction(clock: ClockView, barrier: BarrierState, viewer: ViewerCtx): WhoseActionView;
function deriveSideStatus(barrier: BarrierState, presence: PresenceEntry[]): SideReadyView[];
function appendDiceLog(log: DiceLogEntry[], e: DiceRolled, viewer: ViewerCtx): DiceLogEntry[]; // fog-filtered

// React hooks consumed by the chrome components.
function useHud(gameId: string): HudViewModel;
function useImpulseClock(): { turn: number; impulse: number|null; segment: SegmentId|null };
function useWhoseAction(): WhoseActionView;     // drives panel-arming across D3/D4/D5
function useDiceLog(filter: 'all'|'mine'|'combat'): DiceLogEntry[];
function useActionQueue(): ActionQueueItem[];
```

`deriveWhoseAction` reuses C1's `legalCommandsAt(state, actor, table)` so the HUD and the input panels agree byte‑for‑byte on what is currently legal; the HUD owns no independent legality logic.

## Validation & Enforcement Rules

1. **Read‑only over hidden state (B2.4).** The HUD renders only what `buildHudView` returns. Opponent sealed orders are never in the payload — `sideStatus` carries `lockState` (and at most a commit hash), never the order contents. A client cannot display what it was not sent.
2. **Dice‑log fog.** `appendDiceLog` shows an entry only when `visibleTo` permits: public rolls (e.g. environmental/breakdown) to all; a side's private lock‑on (D6.1) or seeking rolls to that side and the GM; everything to the GM console (`D9-gm-spectator-console.md`). Hidden rolls render as a redacted "● roll pending/hidden" placeholder so the timeline length is honest without leaking values.
3. **Affordance gating mirrors the engine.** "Submit & Lock" is enabled only when `clock.status==='awaiting-orders'`, the viewer is a `requiredActor`, and the viewer has a sealed (not yet locked) order; otherwise it is disabled with the reason surfaced. Out‑of‑sequence intents are impossible because `prompt.legalCommands` is the authoritative gate.
4. **Pause/resume authorization (A2).** `pause.canViewerToggle` is true only for `gm`/`host`; the button is hidden for others. The command still re‑validates server‑side — the HUD flag is a convenience, not the enforcement point.
5. **GM override visibility (C1).** Every `GmOverrideApplied` appends a clearly‑styled override row and badges the affected stepper node/dice entry so play stays auditable.
6. **Determinism.** `foldHudEvent` is pure and order‑sensitive only on `seq`; a gap (`behindBy>0`) forces `requestResync` rather than rendering a guessed state.

## UI Contract

The HUD is persistent chrome wrapping the battle map; layout is specified in **`wireframes/D6-impulse-hud.svg`** (`/mnt/c/Users/rickh/GitHub/sfb/docs/spec/wireframes/D6-impulse-hud.svg`). Regions, top to bottom:

- **Top status bar (full width).** Left: game title + `TURN n` counter (B2.1). Center: the **impulse strip** — 32 ticked cells `1…32`, current cell highlighted, past cells dimmed, future cells outlined; cells where the viewer's pinned ships advance (from `C3` schedule via `viewerMovesHere`) carry a small dot; `[v2]` dogfight cells (6C) are flagged. Right: **connection badge** (live / reconnecting / resyncing) and **presence dots** per side.
- **Sequence‑of‑Play stepper (below the bar).** Eight horizontal phase nodes in B2.2 order (1 Energy → 8 Record Keeping); the current node is filled, done nodes checked, upcoming nodes outlined. When `phase===6`, an inset **segment sub‑stepper** expands beneath the Impulse Procedure node showing A Movement · B Activity · C Dogfight · D Direct‑Fire · E Post‑Combat, with skipped conditional segments (e.g. 6C off‑impulse) greyed.
- **Whose‑action prompt banner.** A single high‑contrast line driven by `WhoseActionView`: e.g. "Submit fire orders — waiting on Klingon" or "Federation side to move (impulse 14)" or "Resolving direct fire…". When `viewerActionRequired`, it shows the primary **Submit & Lock** button (gated per rule 3) and a secondary **Unlock/Edit** while still `sealed`.
- **Per‑side ready/lock rail (right column).** One row per side: name, presence dot, and a lock chip — `pending` (grey) → `sealed` (amber, "committed") → `locked` (green, "🔒") — realizing the B2.4 barrier visually ("2 of 2 locked"). The viewer's own row is emphasized.
- **Dice‑roll log (right column, scrollable).** Reverse‑chronological `DiceLogEntry` rows: timestamp/impulse, label, die faces, total, rule ref; filterable (all/mine/combat) per `HudPreference`. Hidden rolls render redacted (rule 2).
- **Action queue (bottom strip).** The viewer's own `ActionQueueItem`s for the active and async‑queued decision points, with state chips (draft/sealed/locked/revealed/resolved) and an edit affordance while editable; this is where a player confirms what they have committed this impulse.
- **Pause overlay.** When `pause.paused`, a translucent banner dims the map and names who paused and why; GM/host see Resume.

Behavior: the prompt + stepper update on every `PhaseEntered`/`SegmentEntered`/`ImpulseAdvanced`; `OrdersRevealed` triggers a brief reveal animation handed off to `D5-targeting-combat-ui.md`. Responsive: on narrow viewports the 32‑cell strip collapses to a current±N window with a tap‑to‑expand; the dice log and queue become bottom‑sheet tabs. Accessibility: stepper and lock chips expose ARIA state, the prompt is an `aria-live="polite"` region, and color states are paired with icons/text (never color‑only).

## Dependencies

- `C1-sequence-of-play-engine.md` — `GameClock`/`ClockView`, `StepDescriptor` table, `StepStatus`, `legalCommandsAt`; the source of every clock/stepper field and the `PauseGame`/`ResumeGame`/`LockOrders` commands.
- `A4-realtime-sync-layer.md` — fog‑scoped `eventBatch`, `lockStateChanged`/`submissionWindowOpened`/`presenceChanged` signals, reconnection/`gameSnapshot`, the barrier state behind the lock rail.
- `E1-dice-rng-service.md` — `DiceRolled` events folded into the dice log.
- `A2-identity-roles-gating.md` — viewer role/side resolution; who may pause; fog entitlements.
- `A3-data-architecture-event-store.md` — the durable event/snapshot source `buildHudView` reads.
- `C3-movement-engine.md` — the movement schedule used to mark `viewerMovesHere` cells.
- `C8-ew-sensors-cloak.md` — visibility function that decides each dice entry's `visibleTo`.
- `D3-energy-allocation-ui.md`, `D4-movement-plotting-ui.md`, `D5-targeting-combat-ui.md` — panels the HUD **arms** via `prompt.legalCommands`/`submissionWindowOpened`.
- `D9-gm-spectator-console.md` — shares the pause/override controls and the unredacted dice log.

This document **builds on** C1/A4/E1 (it visualizes their state) and **services** the D3/D4/D5 input panels (it tells them when to arm).

## Edge Cases & Open Questions

- **Fast auto phases.** Phases 2/3/8 may resolve in one tick; the HUD must still flash the stepper node (min‑dwell animation) so players perceive the step, and batch the `eventBatch` (A4 already coalesces per segment).
- **Reconnect mid‑impulse.** On resync the HUD rebuilds from `gameSnapshot` + tail; the lock rail, prompt, and the viewer's own action‑queue/sealed state must restore exactly (rule 6).
- **Conditional 6C.** When fighters are absent, the segment sub‑stepper greys 6C as `skipped` rather than implying a missed step.
- **Async / absent opponent.** The prompt shows "waiting on Klingon (away)"; `[v2]` adds a soft deadline countdown sourced from A4's async deadline (open product decision on auto‑resolution policy — tracked in A4).
- **Hidden‑roll redaction granularity.** *Open:* should a redacted enemy lock‑on entry appear at all, or only after `OrdersRevealed`? Default: show a redacted placeholder for timeline honesty; revisit with playtest feedback.
- **Many‑sided / multi‑commander.** The single‑row‑per‑side lock rail must generalize to N sides and to "all commanders of a side locked" sub‑barriers — deferred to **[v2]/[v3]** with A4's multi‑commander sub‑locks.

## Testing

- **View‑model snapshot:** drive the golden 2‑ship turn (the C1 golden‑sequence fixture) through `foldHudEvent`; assert `HudViewModel` matches a recorded snapshot at each phase/segment boundary, and that re‑folding the same log is byte‑identical (determinism with `E2`).
- **Fog test:** with two simulated viewers, assert neither HUD ever contains the opponent's sealed payload pre‑reveal, and that a side‑private lock‑on (D6.1) appears unredacted only in its owner's and the GM's dice log.
- **Gate parity:** for each step, assert `prompt.legalCommands` equals C1's `legalCommandsAt`, and that "Submit & Lock" is enabled exactly when the rule‑3 predicate holds.
- **Lock‑rail correctness (B2.4):** simulate one side sealing then locking; assert chips progress pending→sealed→locked and the prompt flips to "Resolving…" only on `AllOrdersLocked`.
- **Stepper/strip:** assert the phase node and segment sub‑node highlight the live clock through all 8 phases and 32 impulses, and that `viewerMovesHere` cells match the `C3` schedule for the pinned ships.
- **Pause/resume:** GM pauses mid‑6D; assert the overlay shows, non‑GM lacks the toggle, and resume restores prompt/queue state.
- **Reconnect:** drop and resync mid‑impulse; assert no duplicate dice rows and exact restoration of lock/queue state.

## Phasing

**[v1 AM-tournament]** Turn counter; full 32‑cell impulse strip with current cursor and viewer move‑markers; 8‑phase stepper + A–E segment sub‑stepper; whose‑action prompt with Submit & Lock / Unlock affordances bound to C1 gating; per‑side ready/lock rail from the A4 barrier + presence; fog‑filtered dice log with all/mine/combat filter; the viewer's action queue; pause/resume overlay; connection/resync badge; per‑user HUD preferences. This is the minimum chrome a tournament 1v1 needs to play the sealed‑lockstep loop confidently.

**[v2]** Replay scrubber over `E2-game-log-replay.md` (scrub the impulse strip to past states, read‑only); dogfight (6C) impulse flags and sub‑step rendering (Module J); async deadline countdowns; richer presence (typing/"plotting…" hints); spectator dice‑log reveal levels via `D9`.

**[v3 full Master]** Many‑sided lock matrix and multi‑commander‑per‑side sub‑lock visualization; multi‑map/sub‑light clock variants; advanced fire‑control phase‑4 states (passive/low‑power) reflected in the stepper. Deferred because tournament play is fixed two‑side, single‑map with whole‑turn lock‑on, which the v1 HUD already covers.
