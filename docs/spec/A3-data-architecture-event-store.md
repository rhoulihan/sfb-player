# A3 — Data Architecture & Event Store

## Purpose & Scope

This document defines the persistence backbone of SFB Online: the MongoDB collection inventory, the append-only `gameEvents` log and its envelope schema, the `gameSnapshots` checkpointing strategy, the deterministic state-fold (reducer) pattern that reconstructs current game state from events, the optimistic-concurrency append protocol that totally orders events within a game, the indexing plan, and retention/archival policy. Every mechanics subsystem (`C1`–`C10`), the rules engine (`B2-rules-engine-core.md`), the dice service (`E1-dice-rng-service.md`), and the sync layer (`A4-realtime-sync-layer.md`) write through the contracts defined here; the event log is the single source of truth from which all current state, replays, and audits derive. **PHASE: [v1 AM-tournament]** for the core store, fold, snapshotting, and concurrency; cold archival, sharding, and multi-region are **[v2]/[v3]**.

## Rulebook References

The store does not implement game rules; it encodes the *coordinate system* those rules run on and the *commitment protocol* simultaneity requires:

- **(A2.0)** General course of play — the game is a deterministic sequence of player decisions and resolutions, which maps cleanly onto an append-only command→event pipeline.
- **(B2.0)–(B2.3)** Sequence of play — every event carries a `GameClock` coordinate `{turn, phase 1–8, impulse 1–32, segment A–E}` derived from the master cycle (B2.1 turns, B2.2 the eight-phase order, B2.3(6) the 32-impulse loop, B2.3(6A–6E) the five segments). The clock is data, not logic; ordering is enforced by `C1-sequence-of-play-engine.md`.
- **(B2.4)** Secret and simultaneous announcements — modeled as a two-event commit/reveal pair (`OrdersSealed` → `OrdersRevealed`) with server-side hash commitment, so no side gains information from another's ordering.

## Domain Model

```ts
type Uuid = string;          // UUIDv7 (time-ordered) for natural _id locality
type ISODate = string;       // server-authoritative wall time

/** B2.0 master-clock coordinate stamped on every event. Null fields = outside the impulse loop (phases 1–5,7,8). */
interface GameClock {
  turn: number;                              // 1..N, scenario-unbounded (B2.1)
  phase: 1|2|3|4|5|6|7|8;                     // B2.2 eight-phase cycle
  impulse: number | null;                    // 1..32 during phase 6 (B2.3(6)), else null
  segment: 'A'|'B'|'C'|'D'|'E' | null;        // B2.3(6A..6E), else null
}

/** Who emitted the event. system = engine-generated (DiceRolled, ImpulseAdvanced). */
interface Actor {
  kind: 'player' | 'commander' | 'gm' | 'admin' | 'system';
  userId: Uuid | null;                        // null when kind === 'system'
  side?: string;                              // e.g. 'FED' — owning side, used for fog scoping (E4)
  onBehalfOfGm?: boolean;                     // GM acted through a player surface
}

/** The canonical, append-only event record. payload is owned by the emitting mechanics doc. */
interface EventEnvelope<T extends EventType = EventType, P = unknown> {
  _id: Uuid;
  gameId: Uuid;
  seq: number;                                // gapless, 1-based total order within the game
  type: T;                                    // past-tense discriminator
  schemaVersion: number;                      // payload version for upcasting
  actor: Actor;
  clock: GameClock;
  payload: P;
  ts: ISODate;
  causationId: Uuid | null;                   // command/event that directly caused this
  correlationId: Uuid;                        // groups every event from one command
  deterministic: boolean;                     // false only for DiceRolled & external inputs
}

/** Periodic materialized fold for fast load. state is the serialized GameState aggregate. */
interface SnapshotEnvelope {
  _id: Uuid;
  gameId: Uuid;
  seq: number;                                // the head seq this snapshot reflects
  clock: GameClock;
  engineVersion: string;                      // reducer build that produced it (replay safety)
  state: GameState;                           // see B2 / C1 for the aggregate shape
  createdAt: ISODate;
}

/** Durable, fog-gated plaintext for a sealed simultaneous step (B2.4). Never sent to other sides. */
interface SealedOrderRecord {
  _id: Uuid;
  gameId: Uuid;
  stepId: string;                             // e.g. 't3:p6:i12:D'
  side: string;
  commitHash: string;                         // sha256(canonicalJson(orders)+nonce)
  orders: unknown;                            // plaintext (encrypted at rest, E4)
  nonce: string;
  sealedAt: ISODate;
  revealedAt: ISODate | null;
}
```

**Mongoose schema sketch** (key collections; `strict: true`, no app-level updates to events):

```ts
const EventSchema = new Schema({
  _id: { type: String },                                    // UUIDv7
  gameId: { type: String, required: true },
  seq: { type: Number, required: true },
  type: { type: String, required: true },
  schemaVersion: { type: Number, default: 1 },
  actor: { kind: String, userId: String, side: String, onBehalfOfGm: Boolean },
  clock: { turn: Number, phase: Number, impulse: Number, segment: String },
  payload: { type: Schema.Types.Mixed },
  ts: { type: Date, default: () => new Date() },
  causationId: { type: String, default: null },
  correlationId: { type: String, required: true },
  deterministic: { type: Boolean, default: true },
}, { versionKey: false, collection: 'gameEvents' });
EventSchema.index({ gameId: 1, seq: 1 }, { unique: true });   // total order + CAS guard

const SnapshotSchema = new Schema({ /* SnapshotEnvelope */ }, { collection: 'gameSnapshots' });
SnapshotSchema.index({ gameId: 1, seq: 1 }, { unique: true });

const SealedOrderSchema = new Schema({ /* SealedOrderRecord */ }, { collection: 'sealedOrders' });
SealedOrderSchema.index({ gameId: 1, stepId: 1, side: 1 }, { unique: true });
SealedOrderSchema.index({ revealedAt: 1 }, { expireAfterSeconds: 86400 }); // TTL plaintext post-reveal
```

**Collection inventory.** A3 owns `gameEvents`, `gameSnapshots`, `sealedOrders`, and the `games` lifecycle doc (game metadata, status, scenario ref, head seq, participant refs — participant identity owned by `A2-identity-roles-gating.md`). It references but does not own: `users` (A2), `sessions` (connect-mongo, `A1-deployment-infrastructure.md`), `shipCatalog`/`ssdTemplates` (`B3-game-catalog-ssd-model.md`), `rules`/`ruleEmbeddings` (`B1-rules-content-api.md`), `notifications` (`E3-notifications.md`), and `auditLog` for platform-admin actions distinct from per-game events (`E4-security-integrity.md`).

## Events & Commands

A3 defines the **envelope and registry**, not individual mechanics payloads. Commands enter, are validated by `B2`, and emit one or more events that are appended here:

```ts
interface CommandEnvelope<T extends CommandType = CommandType, P = unknown> {
  commandId: Uuid;
  gameId: Uuid;
  type: T;                                    // PascalCase imperative
  actor: Actor;
  expectedHeadSeq: number;                    // optimistic concurrency token
  payload: P;
  issuedAt: ISODate;
  idempotencyKey?: string;                    // dedupe retried submits
}

type CommandType =
  | 'PlotMovement' | 'AllocateEnergy' | 'DeclareFire' | 'AllocateDamage'
  | 'LaunchSeekingWeapon' | 'SubmitSealedOrders' | 'AdvanceImpulse' | 'ApplyGmOverride';

type EventType =
  | 'MovementPlotted' | 'EnergyAllocated' | 'FireDeclared' | 'WeaponFired'
  | 'DamageAllocated' | 'SeekingWeaponLaunched' | 'OrdersSealed' | 'OrdersRevealed'
  | 'ImpulseAdvanced' | 'GmOverrideApplied' | 'DiceRolled';
```

Representative envelope-level payloads A3 cares about (others are owned by their mechanics doc):

```ts
interface OrdersSealedPayload {               // (B2.4) commit — NO plaintext in the log
  stepId: string; side: string;
  commitHash: string; sealedOrderRef: Uuid;   // -> sealedOrders (fog-gated)
}
interface OrdersRevealedPayload {             // (B2.4) reveal — plaintext now public to resolution
  stepId: string; side: string; orders: unknown; nonce: string;
}
interface DiceRolledPayload {                 // outcome persisted so replays match (E1)
  requestContext: string; faces: 6; count: number;
  rolls: number[]; total: number; rngCursor: number;
}
interface GmOverrideAppliedPayload {          // {target, value, reason} per the canonical contract
  target: { seq?: number; entity?: string; field?: string };
  value: unknown; reason: string;
}
interface ImpulseAdvancedPayload {            // emitted by C1 as it walks B2.0
  fromClock: GameClock; toClock: GameClock;
}
```

## Engine / API

Pure functions are folds; impure functions touch IO. All exported by an `eventStore` module consumed via `B2`/`C1`.

```ts
// --- Append (impure, optimistic concurrency) ---
function appendEvents(
  gameId: Uuid, expectedHeadSeq: number, drafts: EventDraft[],
): Promise<{ events: EventEnvelope[]; headSeq: number }>;   // throws ConcurrencyError on seq clash

// --- Read (impure, streaming) ---
function readEvents(
  gameId: Uuid, opts?: { fromSeq?: number; toSeq?: number; types?: EventType[] },
): AsyncIterable<EventEnvelope>;
function getLatestSnapshot(gameId: Uuid, atSeq?: number): Promise<SnapshotEnvelope | null>;

// --- Fold (PURE — no RNG, no clock, no IO) ---
function reduce(state: GameState, event: EventEnvelope): GameState;
function foldEvents(seed: GameState, events: Iterable<EventEnvelope>): GameState;
function registerReducer(type: EventType, fn: (s: GameState, e: EventEnvelope) => GameState): void;

// --- Materialize current state (snapshot + tail fold) ---
function loadState(gameId: Uuid, atSeq?: number): Promise<{ state: GameState; headSeq: number }>;

// --- Snapshot / replay ---
function writeSnapshot(gameId: Uuid, state: GameState, seq: number): Promise<SnapshotEnvelope>;
function replay(gameId: Uuid, fromSeq: number, toSeq: number): Promise<GameState>;

// --- Sealed orders (B2.4) ---
function commitSealedOrder(gameId: Uuid, stepId: string, side: string, orders: unknown): Promise<{ commitHash: string }>;
function revealSealedOrders(gameId: Uuid, stepId: string): Promise<OrdersRevealedPayload[]>;  // verifies hashes
```

`loadState` loads the newest snapshot with `seq <= atSeq`, then folds events `(snapshot.seq, atSeq]` over it; with no snapshot it folds from `seed` (empty game). The append protocol: the caller passes `expectedHeadSeq` (the version its decision was based on); the store assigns `seq = expectedHeadSeq + i + 1` to each draft and inserts under the unique `{gameId, seq}` index inside one transaction. A duplicate-key (E11000) means a concurrent writer already claimed that seq → the store throws `ConcurrencyError`; `B2` reloads the tail, re-validates the command against fresh state, and retries (bounded). This is classic optimistic event-sourcing concurrency with the database index as the hard serialization point.

## Validation & Enforcement Rules

The store is an authoritative referee at the persistence layer:

- **Append-only invariant.** No code path updates or deletes a `gameEvents` document. The Mongoose model exposes no update/remove routes; the production DB user is granted insert/find only on `gameEvents`. Corrections are *compensating events*, never edits.
- **Gapless total order.** `seq` is 1-based, contiguous, monotonic per game. The unique `{gameId, seq}` index makes any gap or duplicate impossible to commit.
- **Determinism of the fold.** `reduce` MUST be pure: no `Date.now()`, no RNG, no IO. All randomness is produced once at command time by `E1-dice-rng-service.md`, persisted as `DiceRolled` events (`deterministic: false`), and merely *read back* by reducers — so two replays of the same log produce byte-identical state.
- **Commit/reveal integrity (B2.4).** `OrdersSealed` stores only `commitHash`; plaintext lives in `sealedOrders`, fog-gated server-side and never streamed to other sides (`E4`). `revealSealedOrders` recomputes `sha256(canonicalJson(orders)+nonce)` and rejects any mismatch before emitting `OrdersRevealed`.
- **Actor authorization** is delegated to `A2-identity-roles-gating.md`; the store records the resolved `actor` but trusts `B2`'s gate.
- **GM override is an event.** `ApplyGmOverride` → `GmOverrideApplied` is appended like any other event, carrying `{target, value, reason}`; it never silently mutates state or rewrites history. This is the single explicit override point — any prior event/result can be superseded by an override that references it via `target.seq` and `causationId`.

## UI Contract

A3 is server-side; clients never query Mongo directly. They consume it through `A4-realtime-sync-layer.md`, which streams the **fog-filtered** event tail (hidden payloads stripped server-side per `E4`). The client maintains its own projection by running the *same* registered reducers on received events, enabling optimistic previews that reconcile against the authoritative `headSeq`. On (re)connect or late-join, the client bootstraps from a fog-scoped snapshot plus the event tail. `D6-impulse-hud.md` renders `clock` (turn/impulse/segment) and `headSeq`; `E2-game-log-replay.md` scrubs the log via `readEvents`/`replay`; `D9-gm-spectator-console.md` reads the unfiltered stream and issues `ApplyGmOverride`. No wireframe of its own — A3 surfaces through those screens.

## Dependencies

- `A1-deployment-infrastructure.md` — MongoDB replica set (transactions), Redis (advisory per-game append lock to cut contention; sealed-order hot store), PM2 cluster topology.
- `A2-identity-roles-gating.md` — resolves `Actor`; owns `users`, participant authorization.
- `A4-realtime-sync-layer.md` — transports events to clients; drives the sealed-submit→lock→reveal cycle.
- `B2-rules-engine-core.md` — `validate(state, command)` and `resolve(state, sealedOrders) → events[]` are the producers that feed `appendEvents`.
- `C1-sequence-of-play-engine.md` — stamps `GameClock` and emits `ImpulseAdvanced` walking B2.0.
- `E1-dice-rng-service.md` — emits `DiceRolled`; `E2-game-log-replay.md` and `E4-security-integrity.md` build directly on this store. A3 **services every `C*` mechanics doc**.

## Edge Cases & Open Questions

- **Document size.** A 16 MB BSON cap means events stay small; bulky artifacts (full damage charts) are referenced by id, not embedded. Snapshots of large late-game states may approach limits → chunk or gzip `state`.
- **Cross-version replay.** Reducer logic can change between deploys; `engineVersion` is pinned on snapshots and replays must run a matching reducer or upcast events (`schemaVersion`). Open: the upcaster registry format — likely co-located with each mechanics doc.
- **Override-vs-command race.** A GM override and a player command may target the same step concurrently; both serialize through the seq index, but the *semantics* of an override landing after a dependent event need a defined precedence rule (proposed: override wins, dependents recomputed via compensating events). Open question for `B2`/`D9`.
- **Crash mid-step.** Redis-resident sealed orders are mirrored to the durable `sealedOrders` collection so a worker crash before reveal loses nothing.
- **seq exhaustion** is not a practical concern (JS safe-integer ≫ any game length), but multi-document batch appends require a transaction (single replica set in v1).

## Testing

- **Concurrency:** two workers append at the same `expectedHeadSeq` → exactly one succeeds, the other gets `ConcurrencyError` (E11000); assert no gap/duplicate.
- **Fold determinism:** replay a log twice and a snapshot+tail load → identical state hash; verify reducers reference recorded `DiceRolled` outcomes rather than re-rolling.
- **Snapshot equivalence:** `loadState` via snapshot equals full `replay(0..head)`.
- **Commit/reveal:** tampered plaintext fails hash verification at reveal; sealed plaintext is never present in any fog-filtered stream.
- **Golden games:** replay the Cadet (A4.0) and Sample (A5.0) worked games as fixtures (driven by `E5-testing-strategy.md`) and assert resulting state matches the rulebook outcomes.
- **Property test:** for any random command sequence, `seq` stays gapless and monotonic.

## Phasing

**[v1 AM-tournament]** — single MongoDB replica set with transactions; the event envelope, `GameClock`, optimistic append, the reducer registry and fold, snapshotting (snapshot at each turn boundary plus every ~200 intra-turn events, keep newest few — older snapshots are regenerable), the four owned collections, the full index set, and TTL cleanup of revealed sealed-order plaintext. Hot retention only: completed games stay queryable.

**[v2]** — cold archival of completed games (compressed archive collection or object storage, surfaced via `E2`), background snapshot pruning, and richer projections/read-models for analytics.

**[v3]** — sharding `gameEvents`/`gameSnapshots` by `gameId` hash and multi-region replication for scale, plus formal event-schema upcaster tooling. Deferred because v1 tournament volume fits comfortably on one replica set, and premature sharding would complicate the transactional append the concurrency guarantee depends on.
