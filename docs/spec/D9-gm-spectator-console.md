# D9 — GM & Spectator Console

## Purpose & Scope

This document specifies the two privileged surfaces that sit *outside* the normal commander/player
loop: the **GM (host/referee) Console** and the **read-only Spectator View**. The GM Console is the
human referee's cockpit — it is where the empowered host applies a recorded override to any ruling or
result, adjudicates a contested call raised by a player, reveals or re-scopes fog of war (both for
spectators and, as a house ruling, between sides), edits the forces on the map (add, remove, or repair
a ship), pauses the game, and **rewinds** the game to a prior event without ever destroying history. The
Spectator View is the omniscient-or-gated read window: a non-participant watches the battle at a
reveal level the GM controls, with **no** ability to mutate state. Both surfaces are thin clients over
the same authoritative engine described in `C1-sequence-of-play-engine.md`; every GM action is itself a
recorded, replayable game event, so the referee never silently mutates state and the audit trail is the
log. **PHASE: [v1 AM-tournament]** ships the full single-GM console (override, dispute queue, fog
controls, force editor, pause, event-rewind) plus the gated spectator view; co-host GMs, spectator
reveal-requests, and what-if branch forking are **[v2]**/**[v3]**.

## Rulebook References

The rulebook formalizes the *referee* role this console implements and the simultaneity/fog rules the GM
may bend:

- **(B2.4)** Secret & simultaneous announcements — the GM may force-resolve, reopen, or rewind past a
  sealed window; fog reveal is the controlled relaxation of this rule.
- **(B2.3)** Sequence of play — pause/resume and clock-jump act on the master cycle owned by `C1`.
- **(B2.3 step 4) / (D6.1, D6.3)** Sensor lock-on and EW — the fog model the GM adjusts (a reveal can
  expose a unit a side would not normally see; see `C8-ew-sensors-cloak.md`).
- **(D6.x) / (G-series)** Cloaking and EOB — the hidden-unit cases the fog controls reveal/conceal.
- **(D5.0)** Self-destruction, **(C7.x)** internal damage — fields the force editor may set when
  adjudicating an out-of-band situation.
- **(S0.0) / (T0.0)** Scenario and tournament framework — the GM is the rulebook *referee*; tournament
  policy constrains which GM powers are legal in rated play (e.g. no live omniscient reveal, no rewind
  past a reveal). The console exposes the powers; tournament policy (`E6-roadmap-phasing.md`) gates them.

## Domain Model

The console adds **no new authoritative aggregate** — current game state is the same `GameState` folded
from `gameEvents` (`A3-data-architecture-event-store.md`). It adds (1) typed GM **command/event**
payloads, (2) two **projections** rebuildable from the log (the dispute queue and the fog-reveal policy),
and (3) one optional read-model collection for fast GM-console queries.

```ts
type Uuid = string; type SideId = string; type UserId = string;

/** Canonical override target — extends A3's {seq?,entity?,field?} with a dot-path. */
interface OverrideTarget {
  seq?: number;            // an existing event to supersede (A3 target.seq)
  entity?: string;         // 'ship:FED-CA-1' | 'window:t3:p6:i12:D' | 'roll:<eventSeq>'
  field?: string;          // dot-path within entity, e.g. 'shields.6.current'
}

type DisputeCategory =
  | 'rules-legality' | 'dice-result' | 'damage-allocation'
  | 'sequence-timing' | 'fog-visibility' | 'other';

interface Dispute {                       // projection of DisputeRaised/DisputeResolved
  disputeId: Uuid;
  raisedBy: UserId; raisedSide?: SideId;
  aboutSeq?: number;                       // the event under dispute (jumps the scrubber)
  category: DisputeCategory;
  note: string;
  status: 'open' | 'upheld' | 'overruled' | 'noted';
  ruling?: { reason: string; resolvedBy: UserId; linkedOverrideSeq?: number };
  raisedAtSeq: number; resolvedAtSeq?: number;
}

type RevealLevel =
  | 'publicOnly'   // only what any onlooker may see (positions of uncloaked units, public events)
  | 'sideA' | 'sideB'  // see exactly as one side sees (its fog scope)
  | 'omniscient'   // full GM-grade visibility
  | 'delayed';     // omniscient but lagged N impulses to prevent live coaching

type RevealSubject =
  | { kind: 'allSpectators' }
  | { kind: 'spectator'; userId: UserId }
  | { kind: 'side'; sideId: SideId }                 // house-ruling reveal BETWEEN sides
  | { kind: 'unit'; unitId: string; toSideId: SideId };

interface FogRevealPolicy {                // projection of FogRevealSet events
  spectatorDefault: RevealLevel;           // default 'delayed' in tournament, 'omniscient' casual
  delayImpulses: number;                   // for 'delayed'
  perSpectator: Record<UserId, RevealLevel>;
  sideReveals: Array<{ subject: RevealSubject; reason: string; setBySeq: number }>;
}

type ForceEditOp =
  | { kind: 'addShip'; sideId: SideId; shipClassId: string; hex: string;
      facing: 0|1|2|3|4|5; reinforcement?: boolean; initialState?: Partial<ShipStatePatch> }
  | { kind: 'removeShip'; shipId: string }
  | { kind: 'setShipState'; shipId: string; patch: ShipStatePatch }   // shields/internals/energy/speed/position
  | { kind: 'teleportShip'; shipId: string; hex: string; facing: 0|1|2|3|4|5 };

interface ShipStatePatch { path: string; value: unknown }[];          // dot-paths into the ship aggregate
```

```ts
// Optional read-model: a fast GM-console queue. Source of truth is gameEvents; this is rebuildable.
const GmReviewItemSchema = new Schema({
  gameId:   { type: String, index: true, required: true },
  disputeId:{ type: String, required: true },
  raisedBy: String, raisedSide: String, aboutSeq: Number,
  category: { type: String, required: true },
  note:     String,
  status:   { type: String, enum: ['open','upheld','overruled','noted'], default: 'open', index: true },
  ruling:   { reason: String, resolvedBy: String, linkedOverrideSeq: Number },
  raisedAtSeq: Number, resolvedAtSeq: Number,
}, { timestamps: true, collection: 'gmReviewItems' });
GmReviewItemSchema.index({ gameId: 1, status: 1, raisedAtSeq: 1 });
```

The `FogRevealPolicy` rides inside the `GameState` aggregate (so it snapshots with everything else); it
is mutated only by folding `FogRevealSet` events. No separate fog collection is required.

## Events & Commands

All GM commands are gated to `gm`/`admin` by `assertCommandAuthz` (`A2-identity-roles-gating.md`) and
**every one requires a non-empty `reason`** — the reason string *is* the referee's logbook.

```ts
// Commands consumed (PascalCase imperative) — actor must be gm/admin unless noted.
interface ApplyGmOverride { gameId: Uuid; target: OverrideTarget; value: unknown; reason: string; }
interface RaiseDispute    { gameId: Uuid; aboutSeq?: number; category: DisputeCategory; note: string; } // commander/player
interface ResolveDispute  { gameId: Uuid; disputeId: Uuid; ruling: 'upheld'|'overruled'|'noted';
                            reason: string; override?: { target: OverrideTarget; value: unknown }; }
interface SetFogReveal    { gameId: Uuid; subject: RevealSubject; level?: RevealLevel;
                            delayImpulses?: number; reason: string; }
interface EditForce       { gameId: Uuid; op: ForceEditOp; reason: string; }
interface RewindToEvent   { gameId: Uuid; toSeq: number; reason: string; }
// PauseGame / ResumeGame are owned by C1 and surfaced here unchanged.

// Events emitted (past-tense, appended to gameEvents; each carries actor + reason).
interface GmOverrideApplied { target: OverrideTarget; value: unknown; reason: string; appliedBy: UserId; }
interface DisputeRaised     { disputeId: Uuid; aboutSeq?: number; category: DisputeCategory;
                              note: string; raisedBy: UserId; raisedSide?: SideId; }
interface DisputeResolved   { disputeId: Uuid; ruling: 'upheld'|'overruled'|'noted';
                              reason: string; resolvedBy: UserId; linkedOverrideSeq?: number; }
interface FogRevealSet      { subject: RevealSubject; level?: RevealLevel; delayImpulses?: number;
                              reason: string; setBy: UserId; }
interface ForceEdited       { op: ForceEditOp; summary: string; appliedBy: UserId; }   // structural add/remove/patch
interface GameRewound       { toSeq: number; revertedRange: [number, number]; reason: string; by: UserId; }
```

`ForceEdited` and `FogRevealSet` are dedicated semantic events for clear audit and replay; the universal
`GmOverrideApplied` remains the escape hatch for arbitrary field-level corrections that lack a dedicated
command (e.g. nudging a single tracked counter). `ResolveDispute` may *carry* an override: when it does,
the engine emits `DisputeResolved` **and** a linked `GmOverrideApplied` sharing one `correlationId`, with
`DisputeResolved.linkedOverrideSeq` pointing at the override's `seq`.

## Engine / API

```ts
// Reducers: (state, command, ctx) -> { events, state }. Pure; persistence/fanout in the service layer.
function applyGmOverride(s: GameState, cmd: ApplyGmOverride, ctx: GmCtx): Reduction;
function raiseDispute(s: GameState, cmd: RaiseDispute, ctx: GmCtx): Reduction;
function resolveDispute(s: GameState, cmd: ResolveDispute, ctx: GmCtx): Reduction;  // may emit 2 events
function setFogReveal(s: GameState, cmd: SetFogReveal, ctx: GmCtx): Reduction;
function editForce(s: GameState, cmd: EditForce, ctx: GmCtx): Reduction;

// Rewind is a service operation (touches snapshots) wrapping a single GameRewound append.
async function rewindToEvent(gameId: Uuid, toSeq: number, reason: string, by: UserId)
  : Promise<{ rewoundTo: GameClock; newHeadSeq: number }>;

// --- The rewind fold (extends A3's foldEvents; deterministic, append-only) ---
function effectiveRevertedRanges(events: EventEnvelope[]): Array<[number, number]>; // pre-pass over GameRewound
function isReverted(seq: number, ranges: Array<[number, number]>): boolean;          // pure
// A3.foldEvents is taught to skip any event whose seq isReverted(...) — see Validation below.

// --- Projections (pure folds the console reads) ---
function projectDisputes(events: Iterable<EventEnvelope>): Dispute[];
function projectFogPolicy(events: Iterable<EventEnvelope>): FogRevealPolicy;

// --- Fog: the spectator view used by A4.broadcastFogScoped for spectator sockets ---
function spectatorView(state: GameState, policy: FogRevealPolicy, spectatorId: UserId): FogScopedState;
function sideRevealOverlay(state: GameState, policy: FogRevealPolicy, sideId: SideId): VisibleUnitId[];

// --- Validators (pure) ---
function validateOverrideTarget(s: GameState, t: OverrideTarget): ValidationResult;
function validateForceEdit(s: GameState, op: ForceEditOp): ValidationResult;   // class exists (B3), hex on map, etc.
function canRewindTo(s: GameState, toSeq: number): ValidationResult;           // not into a half-revealed step
```

`GmCtx` carries `{ actor, now, scenario }`. New unit ids minted by `addShip` are **derived
deterministically** from the emitting event's `seq` (e.g. `gen:<seq>`), so a replay re-creates the same
id. `rewindToEvent` writes a `gameSnapshots` checkpoint at `toSeq` (if absent), appends one
`GameRewound`, then has `C1` reload its `SequenceState` via `loadState(gameId, toSeq)` and resume; live
clients are pushed a fresh fog-scoped resync (`A4-realtime-sync-layer.md` `buildResync`).

## Validation & Enforcement Rules

The console is the *sanctioned* way to bend rules, but it bends them **on the record**:

- **Authorization.** Only `gm`/`admin` may issue `ApplyGmOverride`, `ResolveDispute`, `SetFogReveal`,
  `EditForce`, `RewindToEvent`, `PauseGame`/`ResumeGame`. Commanders/players may issue `RaiseDispute`
  only; spectators may issue **nothing** that mutates state. Enforced by `assertCommandAuthz` (`A2`).
- **Reason mandatory.** Every GM-mutating command is rejected if `reason` is empty/whitespace; the reason
  is persisted on the event and shown in the GM action log and replay (`E2-game-log-replay.md`).
- **Overrides are events, never edits (A3).** `GmOverrideApplied`/`ForceEdited`/`FogRevealSet` append to
  `gameEvents`; history is immutable. State changes only through the fold, so a replay reproduces the
  override exactly. When an override supersedes a prior result (`target.seq` set), the engine recomputes
  dependents via the normal fold — **override wins**, dependents are recomputed forward (the A3
  override-precedence rule).
- **Race avoidance.** A GM mutating command auto-`PauseGame`s the clock for the duration (configurable,
  default on) so an override never interleaves with an in-flight player command; resume is explicit. This
  resolves the A3 "override-vs-command race" open question for the console path.
- **Rewind is non-destructive (A3 append-only).** `RewindToEvent` appends `GameRewound
  {toSeq, revertedRange:[toSeq+1, headSeqAtRewind]}`. No event is deleted. The fold honors rewinds via a
  **two-pass**: `effectiveRevertedRanges` scans all `GameRewound` markers in `seq` order (a later rewind
  can itself be reverted), then `foldEvents` skips any event whose `seq` falls in a still-effective
  reverted range. This is deterministic and pure given the log, so replay matches and a rewind can itself
  be rewound.
- **Fog integrity.** `SetFogReveal` only *widens or narrows what the server projects*; it never lets a
  client compute hidden state locally. `A4.broadcastFogScoped` calls `spectatorView`/`sideRevealOverlay`
  so spectators and side-reveals receive exactly the permitted projection. Tournament default is
  `delayed` (or `publicOnly`) to bar live coaching; `omniscient` between live sides is blocked unless the
  scenario flags casual/teaching mode (`E6`/`T0.0`).
- **Force-edit legality.** `addShip` must reference a valid `shipClassId` from `B3-game-catalog-ssd-model.md`
  and an on-map hex; `setShipState`/`teleportShip` paths must be known fields. The GM *may* set values
  outside normal bounds (it is an override), but the validator returns a non-blocking `warning` so the UI
  can confirm. Editing a unit that appears in the current movement schedule re-derives that schedule via
  `C3-movement-engine.md`; adding/removing mid-turn updates `C1`'s `SequenceState`.
- **Dispute flow.** Any commander/player may `RaiseDispute` (rate-limited by `E4`); it does **not** auto-pause
  unless the GM enabled auto-pause-on-dispute. `ResolveDispute` requires a `reason`; an attached override
  emits the linked `GmOverrideApplied`. Spectator-raised disputes are deferred (**[v2]**).
- **Determinism after rewind.** The reverted events still carry their `DiceRolled` outcomes, but because
  they are skipped, new resolution after the rewind re-draws from the seeded stream at the `rngCursor`
  captured in the state-as-of-`toSeq` (`E1-dice-rng-service.md`), keeping replays byte-identical.

## UI Contract

The GM Console is a single GM-only screen; the wireframe is **`wireframes/D9-gm-console.svg`**. Layout:

- **Top bar** — game title and status; the live `ClockView` from `C1` (turn / phase / impulse / segment)
  with the 32-impulse strip; a large **Pause/Resume** toggle; a presence summary (who is online/away,
  from `A4`); and a prominent indicator when the clock is auto-paused for a GM action.
- **Left rail — God's-eye battle map.** The shared SVG/Canvas renderer (`D1-map-board-ui.md`) with
  **fog off**: both sides' ships, cloaked units, seeking weapons in flight, and per-side *lock badges*
  showing which sides have sealed/locked the current step (status only, never the hidden orders).
  Selecting a unit loads it into the force editor. A subtle overlay marks units currently revealed to the
  opposing side by a `FogRevealSet`.
- **Center — Action panel (tabbed):**
  - *Override* — an `OverrideTarget` builder (pick an event from the timeline to set `seq`, or pick an
    entity + dot-path), a typed value editor, a required reason field, and **Apply** → `ApplyGmOverride`.
  - *Force editor* — Add ship (side, class picker from the `B3` catalog, hex, facing, "reinforcement"
    flag); Remove ship; and for the selected unit a live mini-SSD (`D2-ssd-viewer-ui.md`) with editable
    shields/internals/energy/speed/position → `EditForce`.
  - *Fog* — spectator default `RevealLevel` selector, a delayed-reveal slider (`delayImpulses`),
    per-spectator overrides, and a "reveal unit X to side Y" control → `SetFogReveal`.
- **Right rail — Dispute / review queue.** Open `DisputeRaised` items with category, the raising side, and
  the disputed event (click to jump the timeline scrubber to `aboutSeq`); ruling controls
  (Uphold / Overrule / Note + reason + optional attached override) → `ResolveDispute`; and a resolved
  history list.
- **Bottom — Timeline scrubber + GM action log.** The shared `E2-game-log-replay.md` scrubber over the
  GM's *unfiltered* event stream; reverted ranges render greyed; a **"Rewind game to here"** button
  (confirm + reason) → `RewindToEvent`. A persistent strip lists recent overrides/edits/reveals/rulings
  with their reasons for at-a-glance referee accountability.

The **Spectator View** is a separate read-only screen (no center action panel, no scrubber controls): the
fog-gated battle map and read-only clock/impulse strip rendered at the spectator's `RevealLevel`, a
reveal banner ("Delayed by 3 impulses" / "Side A view"), and an optional commentary/log panel showing
**only revealed** events. Spectators receive their projection through `A4.emitToSpectators`; they can
issue no mutating command (a reveal-request affordance is **[v2]**).

## Dependencies

- `A2-identity-roles-gating.md` — `gm`/`admin` gate for every GM command; defines who may override.
- `A3-data-architecture-event-store.md` — `gameEvents`/`gameSnapshots`, append-only invariant,
  `GmOverrideApplied`; this doc extends A3's fold with `GameRewound` reverted-range semantics.
- `A4-realtime-sync-layer.md` — `broadcastFogScoped`/`emitToSpectators` consume `spectatorView`;
  `buildResync` after a rewind; force-resolve/reopen of stuck windows.
- `C1-sequence-of-play-engine.md` — pause/resume, force-unlock, clock-jump; `ClockView`; reloads state
  after rewind.
- `C3-movement-engine.md`, `C7-damage-criticals-repair.md`, `C8-ew-sensors-cloak.md` — field semantics
  the force editor and fog controls touch (schedule re-derive, internals, cloak/EW visibility).
- `B3-game-catalog-ssd-model.md` — ship classes for `addShip`; `D2-ssd-viewer-ui.md` for the mini-SSD.
- `E2-game-log-replay.md` — shared timeline scrubber + replay that rewind builds on.
- `E3-notifications.md` — alert the GM when a `DisputeRaised` arrives. `E4-security-integrity.md` — fog
  visibility function, rate-limits, tamper-evident audit. `E6-roadmap-phasing.md` / `T0.0` — tournament
  policy gating which powers are legal in rated play.
- `D1-map-board-ui.md`, `D6-impulse-hud.md`, `D8-lobby-scenario-ui.md` — reused renderers; D8 owns
  pre-game force composition, D9 owns in-game force edits.

## Edge Cases & Open Questions

- **Un-revealing seen information.** A rewind resyncs authoritative state, but it cannot erase what a
  human already saw; tournament policy should forbid rewinds past a reveal/`OrdersRevealed`. The engine
  warns when `canRewindTo` crosses such a boundary. *Open: exact tournament rewind policy with `T0.0`.*
- **Edit during a sealed window.** A force edit that changes the legality of already-sealed orders must
  cancel and reopen that window (`A4`); the engine flags this and, by default, voids unrevealed seals.
- **Nested / repeated rewinds.** Handled by `effectiveRevertedRanges` processing markers in `seq` order;
  a rewind that lands inside an earlier reverted range merges ranges deterministically.
- **Deterministic ids on add.** `addShip` mints `gen:<seq>` so replays are stable; collision with a
  scenario-defined id is rejected at validation.
- **Multiple GMs / co-host.** Conflicting overrides from two referees need precedence and locking —
  deferred to **[v2]** (delegated co-host from `A2`).
- **Override-precedence semantics** for an override landing after a dependent event is settled by the
  auto-pause rule here, but cross-worker timing remains an `A3`/`B2` concern for non-console commands.
- **Rewind of an archived/completed game** is **[v2]** (cold storage in `E2`).

## Testing

- **Authz:** a non-GM `ApplyGmOverride`/`EditForce`/`RewindToEvent`/`SetFogReveal` throws
  `AuthzError(403)` (`A2`); a `player` `RaiseDispute` succeeds.
- **Reason required:** empty/whitespace `reason` is rejected for every GM-mutating command.
- **Override is an event:** assert `GmOverrideApplied` is appended, state reflects `value`, and a full
  replay reproduces it; assert no `gameEvents` document was updated/deleted.
- **Rewind determinism & append-only:** rewind to `seq K`; assert `loadState` equals the pre-rewind state
  at `K`, the event count *grew* (no deletion), `foldEvents` skips the reverted range, and a fresh full
  replay reproduces the post-rewind state byte-for-byte; cover a rewind-of-a-rewind.
- **Fog:** a `publicOnly` spectator never receives a hidden payload (property test, reusing the `A4`
  splitter); changing reveal level mid-game re-syncs the spectator at the new scope; `delayed` reveal lags
  exactly `delayImpulses`; a side-reveal exposes only the named unit.
- **Force edit:** `addShip` from the `B3` catalog appears for both sides (fog permitting) and enters the
  `C3` schedule; `removeShip` leaves the schedule consistent; `setShipState` records and (out-of-bounds)
  warns.
- **Dispute flow:** `RaiseDispute` → appears in the queue → `ResolveDispute` with an attached override
  emits `DisputeResolved` **and** a linked `GmOverrideApplied` sharing one `correlationId`.
- **Golden game:** replay a worked example, inject a GM override correcting a damage allocation
  (`C7-damage-criticals-repair.md`), and assert downstream state recomputes to the intended result.

## Phasing

- **[v1 AM-tournament]:** single-GM console — `ApplyGmOverride` (with mandatory reason), the
  `RaiseDispute`/`ResolveDispute` queue, `SetFogReveal` (publicOnly/per-side/omniscient/delayed for
  spectators + per-unit side reveal), the force editor (add/remove/set-state/teleport), pause/resume and
  force-unlock via `C1`, non-destructive `RewindToEvent` with the reverted-range fold, the god's-eye map,
  and the read-only fog-gated spectator view. This is the minimum to referee a rated two-side duel and to
  let onlookers watch without leaking hidden orders.
- **[v2]:** delegated co-host GMs with override locking, spectator reveal- and dispute-requests,
  per-spectator delayed-reveal presets, a richer force/terrain editor, and rewind across archived games.
- **[v3 full Master]:** full Master-rulebook map objects and multi-map editing, and **branch forking** —
  spawn a parallel what-if game from a rewind point for analysis without disturbing the canonical line.
  Deferred because tournament play needs only a single GM, a single map, and a strictly linear,
  reason-logged override trail.
