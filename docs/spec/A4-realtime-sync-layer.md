# A4 — Real-Time Sync Layer

## Purpose & Scope

The Real-Time Sync Layer is the network nervous system that connects every client to the authoritative referee. It owns Socket.IO transport, per-game rooms and fog-scoped sub-rooms, player presence, and the *choreography* of the impulse-lockstep loop: opening a sealed-submission window, collecting hash-committed orders from each side, holding a lock barrier until all required sides are committed, then triggering deterministic reveal-and-resolve and fanning the resulting events back out. It deliberately does **not** decide rules legality or compute results — that belongs to `C1-sequence-of-play-engine.md` and `B2-rules-engine-core.md`; A4 is the asynchronous barrier primitive those engines `await`, plus the wire protocol, reconnection/resync, the secondary async order-submission path, optimistic client previews with server reconciliation, and the Redis adapter that makes all of this work across a PM2 worker cluster. A4 transmits **no** randomness and makes **no** tactical choices: every secret commitment is a player decision; A4 only guarantees it stays secret until simultaneous reveal.

**PHASE:** Core barrier + presence + reconnection + Redis fan-out are **[v1 AM-tournament]**; richer async play-by-mail, multi-commander sub-locks, and spectator reveal controls are **[v2]**; many-sided fleet scale and sharded game runners are **[v3 full Master]**.

## Rulebook References

- **(B2.1)** Turn structure — the unit of synchronization is the turn and its 32 impulses.
- **(B2.2)** Master 8-phase cycle — A4 opens a window only at the phases/segments that are sealed-simultaneous.
- **(B2.3 step 1)** Energy Allocation — a per-turn, all-sides-simultaneous sealed window (detail in `C2-energy-allocation-power.md`).
- **(B2.3 step 4)** Sensor Lock-On — single roll per ship; resolved through `E1-dice-rng-service.md`, surfaced (not sealed-vs-opponent) here.
- **(B2.3 step 6A)** Movement Segment — an **open** per-impulse input round (observable), not a sealed barrier.
- **(B2.3 step 6B)** Impulse Activity — sealed launches/transport (drones, plasma, shuttles, mines).
- **(B2.3 step 6D)** Direct-Fire Weapons — the canonical per-impulse sealed window; fire orders **and** EW changes lock together.
- **(B2.4)** Secret & Simultaneous Announcements — the rule A4 exists to enforce perfectly: commit, lock, reveal, resolve, with no information leaking from an early announcer.
- **(C1.44)** Controller role — the engine, not a human, owns the movement schedule that A4 sequences each impulse.

## Domain Model

A4's durable state is small; most coordination lives in Redis (ephemeral, TTL'd). Two collections persist so that paused/async games survive Redis eviction. The event log and snapshots themselves are owned by `A3-data-architecture-event-store.md` and are only referenced here.

```ts
type GameId = string; type SideId = string; type UserId = string;
type DecisionPointId = string;     // `${turn}:${phase}:${impulse}:${segment}:${kind}`

type WindowKind =
  | 'EnergyAllocation'   // B2.3(1)
  | 'DirectFire'         // B2.3(6D)
  | 'ImpulseActivity'    // B2.3(6B): launches/transport/mines
  | 'EWChange'           // committed alongside DirectFire
  | 'SeekingLaunch';     // F-series, modelled in C5

interface SubmissionWindow {
  gameId: GameId;
  decisionPointId: DecisionPointId;
  kind: WindowKind;
  participants: SideId[];        // sides whose seal is REQUIRED to complete the barrier
  fogScope: 'perSide' | 'public';
  openedAt: number;
  deadlineAt?: number;           // soft for live, hard for async ([v2] for hard auto-timeout)
  status: 'open' | 'allLocked' | 'resolving' | 'resolved' | 'cancelled';
  resolvedEventSeq?: number;     // first gameEvents seq written by resolution (idempotency anchor)
}

interface SealedOrder {
  gameId: GameId;
  decisionPointId: DecisionPointId;
  sideId: SideId;
  submittedBy: UserId;
  commitHash: string;            // sha256(canonicalJSON(payload)+serverSalt+decisionPointId)
  payload: unknown;              // the SubmitSealedOrders command body; withheld from other sides pre-reveal
  locked: boolean;               // true => immutable (B2.4 "decisions cannot be changed")
  source: 'live' | 'async';      // async = pre-submitted while absent
  clientCommitNonce: string;     // idempotency key for network retries
  submittedAt: number;
}

// --- ephemeral, Redis only ---
interface PresenceEntry {
  userId: UserId; role: 'gm'|'commander'|'player'|'spectator';
  sideId?: SideId; socketIds: string[]; lastSeen: number; status: 'online'|'idle'|'away';
}
interface BarrierState { decisionPointId: DecisionPointId; lockedSides: SideId[]; pendingSides: SideId[]; complete: boolean; }
```

Mongoose sketch (durable mirror; Redis is the hot path):

```ts
const SealedOrderSchema = new Schema({
  gameId: { type: String, index: true, required: true },
  decisionPointId: { type: String, required: true },
  sideId: { type: String, required: true },
  submittedBy: String,
  commitHash: { type: String, required: true },
  payload: Schema.Types.Mixed,           // encrypted-at-rest; never projected to other sides pre-reveal
  locked: { type: Boolean, default: false },
  source: { type: String, enum: ['live','async'], default: 'live' },
  clientCommitNonce: { type: String, required: true },
}, { timestamps: true });
SealedOrderSchema.index({ gameId: 1, decisionPointId: 1, sideId: 1 }, { unique: true });
SealedOrderSchema.index({ gameId: 1, clientCommitNonce: 1 }, { unique: true }); // retry idempotency

const SubmissionWindowSchema = new Schema({
  gameId: { type: String, index: true, required: true },
  decisionPointId: { type: String, required: true },
  kind: { type: String, required: true },
  participants: [String], fogScope: String,
  status: { type: String, enum: ['open','allLocked','resolving','resolved','cancelled'], default: 'open' },
  deadlineAt: Date, resolvedEventSeq: Number,
}, { timestamps: true });
SubmissionWindowSchema.index({ gameId: 1, decisionPointId: 1 }, { unique: true });
```

Redis key map: `presence:<gameId>` (hash userId→entry) + a heartbeat ZSET; `sealed:<gameId>:<dpId>` (hash sideId→commitHash|locked); `window:<gameId>:current`; `authority:<gameId>` (fenced lock naming the owning worker); pub/sub `cmd:<gameId>` for cross-worker command forwarding; plus the Socket.IO `@socket.io/redis-adapter` channels.

## Events & Commands

A4 consumes the canonical commands and emits the canonical domain events (persisted by A3), and additionally exchanges **ephemeral socket signals** that are never persisted. The distinction is load-bearing: durable events replay deterministically (`E2-game-log-replay.md`); signals are presentation only.

**Commands consumed** (client → server):
```ts
interface SubmitSealedOrders { gameId: GameId; decisionPointId: DecisionPointId;
  sideId: SideId; payload: unknown; clientCommitNonce: string; source?: 'live'|'async'; }
interface LockOrders   { gameId: GameId; decisionPointId: DecisionPointId; sideId: SideId; }
interface AdvanceImpulse { gameId: GameId; }              // emitted by the authority loop, not players
interface ApplyGmOverride { gameId: GameId; target: OverrideTarget; value: unknown; reason: string; }
```

**Durable events emitted** (written to `gameEvents`, then fanned out fog-scoped):
```ts
interface OrdersSealed   { decisionPointId: DecisionPointId; sideId: SideId; commitHash: string; source: 'live'|'async'; }   // hash only — no plaintext
interface OrdersRevealed { decisionPointId: DecisionPointId; orders: Array<{ sideId: SideId; payload: unknown }>; }          // post-barrier
interface ImpulseAdvanced { gameId: GameId; turn: number; impulse: number; movers: ShipInstanceId[]; } // per-impulse sub-pulse detail lives in SegmentEntered (see C1)
interface GmOverrideApplied { gameId: GameId; target: OverrideTarget; value: unknown; reason: string; appliedBy: UserId; }
interface SegmentEntered  { gameId: GameId; turn: number; impulse: number; segment: 'A'|'B'|'C'|'D'|'E'; }
```

**Ephemeral socket signals** (server → client, not persisted):
`submissionWindowOpened {decisionPointId, kind, participants, yourSubmissionRequired, deadlineAt?}`, `lockStateChanged {decisionPointId, lockedSides, pendingSides}`, `presenceChanged {entries}`, `commandAck {clientCommandId, accepted, reasons?}`, `eventBatch {events, fromSeq, toSeq}`, `gameSnapshot {state, seq, snapshotVersion}`, `reconnectRequired {reason}`.

## Engine / API

A4 is a service module loaded by the per-game **authority worker** (the single worker that currently holds `authority:<gameId>`). C1's turn loop calls `openSubmissionWindow` and `await`s a promise the barrier resolves.

```ts
// Barrier primitive — the heart of B2.4
function openSubmissionWindow(gameId: GameId, spec: WindowSpec): Promise<DomainEvent[]>;
function recordSeal(gameId: GameId, dpId: DecisionPointId, sealed: SealedOrder): Promise<BarrierState>;
function recordLock(gameId: GameId, dpId: DecisionPointId, sideId: SideId): Promise<BarrierState>;
function isBarrierComplete(b: BarrierState): boolean;                         // pure
function resolveWindow(gameId: GameId, dpId: DecisionPointId): Promise<DomainEvent[]>; // reveal→engine.resolve→persist→fanout

// Presence
function markPresent(gameId: GameId, userId: UserId, socketId: string, role: Role, sideId?: SideId): Promise<void>;
function markAbsent(gameId: GameId, socketId: string): Promise<void>;
function heartbeat(gameId: GameId, userId: UserId): Promise<void>;
function absentParticipants(gameId: GameId, required: SideId[]): Promise<SideId[]>;

// Authority / cluster
function acquireGameAuthority(gameId: GameId, workerId: string): Promise<{ ok: boolean; fencingToken: number }>;
function renewGameAuthority(gameId: GameId, workerId: string, token: number): Promise<boolean>;
function forwardCommandToAuthority(gameId: GameId, cmd: AnyCommand): Promise<void>;

// Fan-out (fog-of-war split happens HERE, server-side)
function broadcastFogScoped(gameId: GameId, events: DomainEvent[]): Promise<void>;
function emitToSide(gameId: GameId, sideId: SideId, signal: Signal): void;
function emitToSpectators(gameId: GameId, signal: Signal, revealLevel: RevealLevel): void;

// Reconnection
function buildResync(gameId: GameId, userId: UserId, sinceSeq?: number): Promise<ResyncPayload>; // fog-scoped snapshot + event tail

// Optimistic command path
function handleOptimisticCommand(socket: Socket, msg: { clientCommandId: string; command: AnyCommand }): Promise<CommandAck>;
```

`broadcastFogScoped` is the only place hidden information is filtered: it asks `E4-security-integrity.md`/`C8-ew-sensors-cloak.md` what each side may see, then projects a per-side event view before transmission. Clients are physically incapable of seeing what they were not sent.

## Validation & Enforcement Rules

- **Authorization.** A seal/lock for `sideId` is accepted only if the socket's authenticated principal controls that side or a ship in it (delegation table from `A2-identity-roles-gating.md`). Spectators may never submit.
- **Secrecy invariant (B2.4).** Before a window reaches `allLocked`, the server stores plaintext orders but transmits to other sides **only** the `OrdersSealed` hash. `OrdersRevealed` (full payloads, fog-permitting) is emitted **only** after the barrier completes. A property test asserts no message to side X ever contains side Y's plaintext pre-reveal.
- **Immutability after lock (B2.4).** While `status==='open'` a side may `unlock`→edit→resubmit. Once it sends `LockOrders` the sealed order is frozen; once the barrier hits `allLocked`, all participants freeze. Late edits are rejected.
- **Barrier completion.** Required set = present-or-async participants. A window resolves when every required side is `locked`, with async pre-submissions counting as already-locked. Movement (B2.3 6A) is exempt — it is an open round with no secrecy barrier.
- **Hash integrity.** On reveal the server recomputes `commitHash` from stored plaintext and aborts (raising a GM alert) on mismatch, giving tamper-evidence in the audit log.
- **Single resolution.** Only the authority worker resolves, guarded by the fenced `authority:<gameId>` lock; resolution writes events with `expectedVersion` optimistic concurrency (A3), so a stale split-brain writer is rejected. Resolution is idempotent against `resolvedEventSeq`.
- **Determinism.** A4 injects no randomness; all dice come from `E1-dice-rng-service.md` seeded per game so `E2` replays match byte-for-byte.
- **GM-override points** (each recorded as `GmOverrideApplied`): force-resolve a stuck window (absent/unlocked sides treated as no-op or auto per policy), extend/shorten a deadline, reopen a just-resolved window, reassign an absent side's control, set spectator `revealLevel`, or eject/mute a socket.

## UI Contract

Clients need: (1) a **connection lifecycle** — `joinGame` → `gameSnapshot` → live `eventBatch` stream, with `reconnectRequired` prompting an automatic `requestResync`; (2) a **presence roster** driven by `presenceChanged` so commanders see who is online/away; (3) a **submission-window controller** — on `submissionWindowOpened` the relevant input panel (energy form, fire-control panel, launch dialog) arms, shows the live `lockStateChanged` barrier ("2 of 2 sides locked"), and disables edits after the player's own `LockOrders`; (4) **optimistic previews** — movement ghosts and tentative energy totals render locally and reconcile to authoritative `eventBatch`/`commandAck`, never transmitted to opponents; (5) a **reveal animation** keyed off `OrdersRevealed`/`WeaponFired`. The HUD wiring for the per-impulse barrier lives in `D6-impulse-hud.md` (wireframe `docs/spec/wireframes/D6-impulse-hud.svg`); the energy and targeting panels are in `D3-energy-allocation-ui.md` and `D5-targeting-combat-ui.md`.

## Dependencies

- `A1-deployment-infrastructure.md` — Redis instance, PM2 cluster, nginx WebSocket upgrade + sticky routing.
- `A2-identity-roles-gating.md` — socket auth handshake (JWT/session), role and per-side delegation checks.
- `A3-data-architecture-event-store.md` — `gameEvents` append + `gameSnapshots`; A4 reads tails and writes resolution events.
- `B2-rules-engine-core.md` / `C1-sequence-of-play-engine.md` — `validate`/`resolve`; C1's turn loop awaits A4's barrier.
- `C2-energy-allocation-power.md`, `C4-direct-fire-combat.md`, `C5-seeking-weapons.md` — define each sealed window's payload shape and resolution.
- `C8-ew-sensors-cloak.md` / `E4-security-integrity.md` — the fog-of-war visibility function used by `broadcastFogScoped`.
- `E1-dice-rng-service.md` — seeded RNG. `E2-game-log-replay.md` — replay consumes the same events. `E3-notifications.md` — async/absent-player alerts. `E5-testing-strategy.md` — golden games.

## Edge Cases & Open Questions

- **Reconnect mid-window:** resync restores the player's own sealed order and the current `BarrierState`; their input panel re-arms in the correct locked/unlocked state.
- **Seal-then-disconnect:** a present player who sealed but disconnected before locking has their last sealed order auto-locked when the disconnect grace timer expires (configurable; default on), so one absent side does not stall the table.
- **Crash during resolve:** because events are the commit point and writes carry `expectedVersion`, a takeover worker either sees the resolution already persisted (idempotent skip) or re-runs it deterministically.
- **Split-brain authority:** stale fencing token → A3 rejects the write; the loser drops its in-memory engine.
- **Chattiness:** 32 impulses × 5 segments is noisy; A4 opens a window only when a segment actually has sealed participants and batches `eventBatch` per segment.
- **Out-of-order delivery:** events carry monotonic `seq`; a client gap triggers `requestResync`.
- *Open:* hard async deadline auto-resolution policy (forfeit-to-no-op vs auto-repeat-last-orders) needs a product decision **[v2]**. Fighter dogfight windows (segment C / Module J) are unscoped here **[v3]**. Multi-commander-per-side sub-barriers (all commanders of a side must lock before the side is "locked") are deferred **[v2]**.

## Testing

- **Unit:** barrier completeness across present/async/absent mixes; hash commit/verify; `clientCommitNonce` idempotency; fog-scoping splitter (snapshot-tested per side).
- **Integration (two simulated clients):** both seal direct fire (B2.3 6D); assert neither receives the other's plaintext until `OrdersRevealed`; assert resolution emits a single, ordered `eventBatch`.
- **Reconnection:** drop a socket mid-window, reconnect, assert sealed order + lock state restored and **no** duplicate resolution.
- **Multi-worker:** two PM2 workers, sockets split across them; assert Redis-adapter broadcast reaches both and exactly one worker resolves (authority lock).
- **Async path:** mark a commander absent, pre-submit via REST, assert auto-apply at window open and that `E3-notifications.md` fires only for absent participants.
- **Golden determinism:** drive the rulebook worked examples (the Cadet game and Sample game captured by `E5-testing-strategy.md`) through the live transport and assert the emitted event stream is byte-identical to the offline replay — proving A4 adds choreography but not nondeterminism.

## Phasing

**[v1 AM-tournament]** Per-game rooms + fog sub-rooms; presence + heartbeat; the full seal→lock→reveal→resolve barrier for Energy Allocation (B2.3 1), Direct Fire + EW (B2.3 6D), and Impulse-Activity launches (B2.3 6B); open movement rounds (6A); reconnection/resync from A3 snapshots; `@socket.io/redis-adapter` fan-out with the fenced per-game authority lock; basic async pre-submit; optimistic movement/energy previews. Tournament games are typically 1v1, keeping participant sets and barrier latency small — the right place to harden the protocol. **[v2]** Hard async deadlines and play-by-mail flows, multi-commander sub-locks, spectator reveal controls, deeper presence-aware notifications. **[v3 full Master]** Many-sided games, fighter/dogfight windows (Module J), large-fleet fan-out optimization, and sharded/region-pinned game runners.
