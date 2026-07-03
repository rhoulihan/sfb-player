# E2 — Game Log, Replay & Save/Resume

## Purpose & Scope

This subsystem turns the append-only event log defined in `A3-data-architecture-event-store.md` into the player- and operator-facing capabilities that depend on it: **replay/playback** (scrub the whole game forward and back, at any speed, from any side's fog perspective), **save/resume** (a game is *always* saved — the log is the save file — and can pause and resume across days with fog-of-war and any in-flight sealed step intact), **undo-to-last-commit** (freely revert the not-yet-locked sealed buffer within the current step, with the lock as the immutable commit boundary), and **export/import** (serialize a complete game to a portable, integrity-checked archive for tournament records, bug-repro, and sharing). E2 owns *no* game rule and *no* state shape of its own; it is a thin, deterministic consumer of A3's store (`readEvents`, `loadState`, `replay`, `getLatestSnapshot`) and of the canonical fold (`fold` in `B2-rules-engine-core.md`, `applyEvent` in `C1-sequence-of-play-engine.md`). Everything here works precisely because the log is the single source of truth and the fold is pure. **PHASE:** read-only replay, snapshot+fold resume, within-step undo, and single-game export/import are **[v1 AM-tournament]**; multi-perspective synchronized replay, annotated/branchable "what-if" forks, and bulk archive tooling are **[v2]/[v3]**.

## Rulebook References

E2 implements no tactical rule; it preserves the *informational* discipline the rules impose:

- **(B2.0)–(B2.3)** Sequence of play — replay walks the same `GameClock` `{turn, phase 1–8, impulse 1–32, segment A–E}` the live game stepped through, so a scrub position is always a legal clock coordinate.
- **(B2.4)** Secret & simultaneous announcements — the undo boundary *is* the (B2.4) commitment point: before a side locks, its orders are private and freely revertible; at lock they become immutable. Replay must never leak a side's pre-reveal orders to another perspective at a historical seq (fog is recomputed *as of that seq*).
- **(A4.0)/(A5.0)** The Cadet and Sample worked games are the golden fixtures replayed in CI (`E5-testing-strategy.md`).

## Domain Model

E2 reuses A3's `EventEnvelope`, `SnapshotEnvelope`, `Uuid`, and `GameClock` verbatim and adds only ephemeral/portable shapes. The within-step draft buffer is the only mutable state, and it is *pre-commit* by definition.

```ts
import type { Uuid, ISODate, GameClock, EventEnvelope, SnapshotEnvelope } from './A3';

/** Read-only playback cursor over one game. Never persisted; lives per-viewer. */
interface ReplaySession {
  gameId: Uuid;
  perspective: SideId | 'gm' | 'omniscient'; // fog lens; 'omniscient' only post-game or GM-granted
  headSeq: number;                            // authoritative end of log at session open
  cursorSeq: number;                          // current scrub position, 0..headSeq
  mode: 'paused' | 'playing';
  speed: 0.5 | 1 | 2 | 4 | 8;                 // impulses/sec multiplier for auto-play
  loop: boolean;
  bookmarks: ReplayBookmark[];
}

interface ReplayBookmark { seq: number; clock: GameClock; label: string; createdBy: Uuid; }

/** One uncommitted mutation in the current sealed step's draft buffer (pre-lock). */
interface DraftMutation {
  ordinal: number;            // 1-based position in the per-(actor,step) draft stack
  patch: unknown;             // partial order body (e.g. one EnergyLine, one FireAssignment)
  appliedAt: ISODate;
}

/** Per (game, step, actor) draft buffer. Mutable until LockOrders; then frozen. */
interface DraftBuffer {
  gameId: Uuid;
  stepKey: string;            // C1 StepDescriptor.key, e.g. 'P6.D.directFire'
  actorId: Uuid;
  baseCommitSeq: number | null; // OrdersSealed seq of the last LOCKED state this step, or null
  stack: DraftMutation[];     // ordered; undo pops the tail; "undo to last commit" clears to base
  committed: boolean;         // true once LockOrders appended OrdersSealed
}

/** Portable, self-verifying serialization of a whole game. NDJSON body + JSON manifest. */
interface GameArchive {
  manifest: {
    archiveVersion: 1;
    gameId: Uuid;
    exportedAt: ISODate;
    headSeq: number;
    rulesetRef: Uuid;          // -> gameRulesets pin (B2): rngSeed, moduleVersions, annexTables
    engineVersion: string;     // reducer build that produced the last snapshot (A3)
    eventCount: number;
    integrity: { algo: 'sha256-chain'; rootHash: string }; // chained digest over events in seq order
    fogScrubbed: boolean;      // true => unrevealed sealed plaintext stripped (mid-game export)
  };
  events: EventEnvelope[];     // streamed as NDJSON in transit
  snapshots: SnapshotEnvelope[]; // optional acceleration; regenerable from events
}
```

The `DraftBuffer` is the durable mirror of C1's `ActiveStep.sealed[actorId]` and A4's `SealedOrder`; E2 does not invent a second store. It lives in Redis (`draft:<gameId>:<stepKey>:<actorId>`) with the `sealedOrders` collection (A3) as the crash-durable copy, so a resume mid-compose restores a half-written order. No new persisted collection is introduced — E2 reads `gameEvents`/`gameSnapshots`/`sealedOrders` and writes only through A3's `appendEvents`.

## Events & Commands

E2 adds the playback/lifecycle commands and the undo command; durable game events remain owned by A3 and the mechanics docs.

```ts
type CommandType =
  | 'RevertDraft'        // undo within the current uncommitted step
  | 'PauseGame' | 'ResumeGame'          // reuse C1 lifecycle
  | 'BookmarkSnapshot'   // tag a seq as a named save point
  | 'ExportGame' | 'ImportGame';

interface RevertDraftPayload {
  stepKey: string;
  to: 'lastAction' | 'lastCommit';  // pop one DraftMutation, or clear to baseCommitSeq
}
interface BookmarkSnapshotPayload { seq: number; label: string; }
```

**Durable events.** Within-step undo is buffer-only and emits **no** `gameEvents` document — reverting a never-revealed draft rewrites nothing because nothing was committed. The only durable artifacts E2 causes are: `GameBookmarked {seq, label}` (a lightweight log entry for named save points), and the lifecycle `GamePaused`/`GameResumed` already emitted by `C1`. `ImportGame` does not append to the source log; it *materializes* a new game under a fresh `gameId` from the archive's events. The post-lock correction path is **not** an E2 event — it is a forward `GmOverrideApplied` (A3) or a mechanics compensating event; E2 surfaces the control but never deletes history.

**Ephemeral signals** (server → viewer, not persisted): `draftReverted {stepKey, stack}`, `replayFrame {cursorSeq, clock, events}`, `replayState {mode, speed, cursorSeq}`, `exportReady {downloadToken}`, `importProgress {pct, phase}`.

## Engine / API

All read paths are pure folds over A3; the only writes go through `appendEvents` (lifecycle/bookmark) or buffer mutation (undo).

```ts
// --- Save / Resume (build directly on A3.loadState + A4.buildResync) ---
function resumeGame(gameId: Uuid, viewer: Actor): Promise<{ state: GameState; headSeq: number; activeStep?: ActiveStep }>;
function pauseGame(gameId: Uuid, by: Actor, reason?: string): Promise<EventEnvelope>;   // -> C1.pause
function bookmarkSnapshot(gameId: Uuid, seq: number, label: string, by: Actor): Promise<EventEnvelope>;

// --- Replay / playback (read-only projections) ---
function openReplay(gameId: Uuid, perspective: ReplaySession['perspective']): Promise<ReplaySession>;
function seekTo(session: ReplaySession, seq: number): Promise<{ state: GameState; clock: GameClock }>;
function stepForward(session: ReplaySession, n?: number): Promise<ReplaySession>;
function stepBack(session: ReplaySession, n?: number): Promise<ReplaySession>;          // re-fold from nearest snapshot <= target
function play(session: ReplaySession, speed: ReplaySession['speed']): AsyncIterable<{ seq: number; events: EventEnvelope[] }>;

// --- Within-step undo (buffer only; PURE stack op + fog-safe rebroadcast) ---
function applyDraft(buf: DraftBuffer, m: DraftMutation): DraftBuffer;                    // pure
function revertDraft(buf: DraftBuffer, to: 'lastAction' | 'lastCommit'): DraftBuffer;    // pure
function projectDraft(state: GameState, buf: DraftBuffer): GameState;                    // optimistic preview, local only

// --- Export / import ---
function exportGame(gameId: Uuid, opts: { atSeq?: number; includeSnapshots?: boolean }): Promise<NodeJS.ReadableStream>;
function computeIntegrity(events: EventEnvelope[]): { algo: 'sha256-chain'; rootHash: string }; // pure
function validateArchive(a: GameArchive): { ok: boolean; problems: string[] };          // pure
function importGame(a: GameArchive, opts: { asGameId?: Uuid; verifyReplay?: boolean }): Promise<{ gameId: Uuid; headSeq: number }>;
```

`seekTo` is the workhorse: it calls `getLatestSnapshot(gameId, seq)` then folds the `(snapshot.seq, seq]` tail through the *same* registered reducers (`reduce`/`applyEvent`) the live game used — there is no second projector. `stepBack` cannot un-fold a pure reducer, so it re-seeks from the nearest snapshot; turn-boundary snapshots (A3 writes one per turn plus every ~200 events) keep that bounded. `play` emits fog-filtered frames via `A4.broadcastFogScoped` so a replaying player sees exactly what they could legally see *then*.

## Validation & Enforcement Rules

- **The log is immutable; undo respects the commit boundary.** `revertDraft` mutates only the pre-lock `DraftBuffer`. Once `LockOrders` appends `OrdersSealed` (A3/A4), `committed` is true and `RevertDraft` is rejected with `ALREADY_COMMITTED`. After reveal/resolution the only correction is a forward event (`GmOverrideApplied` or a compensating mechanics event) — E2 never issues a delete or update against `gameEvents`. This is the single, explicit "undo" contract: *free before lock, forward-only after.*
- **Replay fog is recomputed as of the cursor seq.** A player perspective never receives sealed plaintext that was unrevealed at `cursorSeq`, even for their own past turns' opponents. The fog function from `C8-ew-sensors-cloak.md`/`E4-security-integrity.md` is evaluated against the *historical* state, not the head. `'omniscient'` is allowed only after the game is `completed`, or when a GM grants reveal (`D9-gm-spectator-console.md`), recorded as `GmOverrideApplied`.
- **Resume preserves the in-flight sealed step.** `resumeGame` rehydrates `ActiveStep` (C1) and each side's `DraftBuffer`/lock state from `sealedOrders`, so a game paused mid-6D resumes with each side's secrecy and lock status intact (no re-submission, no leak).
- **Determinism on every replay.** Re-folding reads back `DiceRolled` outcomes (`E1-dice-rng-service.md`) rather than re-rolling, and runs under the pinned `engineVersion`/`moduleVersions` (`gameRulesets`, B2). A replay whose available reducer build differs from the pin must upcast by `schemaVersion` or refuse — it never silently produces divergent state.
- **Import integrity.** `importGame` runs `validateArchive` (gapless 1-based `seq`, `sha256-chain` root match, `correlationId`/`causationId` referential sanity, ruleset availability) and, when `verifyReplay`, folds the imported events and asserts the resulting state hash equals the archive's final snapshot hash before the new game is queryable. A failing archive is rejected whole.
- **Authorization** is delegated to `A2-identity-roles-gating.md`: replay/export require participation or GM/admin; `'omniscient'`/cross-perspective replay and import-as-new-game are GM/admin-gated.

## UI Contract

E2 surfaces through one dedicated screen plus hooks on existing ones. The **Replay Console** (`D` screen; wireframe `docs/spec/wireframes/D9-gm-console.svg`) provides: a horizontal timeline scrubber labeled by turn/impulse with bookmark pins; transport controls (play/pause, step ±1 event, step ±1 impulse, speed 0.5×–8×, loop); a perspective selector (each side, GM, or omniscient when permitted); a synchronized event-list panel that highlights the event at `cursorSeq`; and an "export" button yielding a `.sfbgame` download. Scrubbing drives `seekTo`; the board (`D1`/`D2` map and SSD viewers) re-renders from the returned `GameState`, and the HUD (`D6-impulse-hud.md`) reflects the historical `clock`. The **within-step undo** hook appears wherever a sealed order is composed — energy (`D3-energy-allocation-ui.md`), movement plot (`D4-movement-plotting-ui.md`), targeting (`D5-targeting-combat-ui.md`): an "Undo" (pop last) and "Revert to last committed" control bound to `RevertDraft`, enabled only while `!committed`; the optimistic preview re-renders via `projectDraft`. The GM console (`D9-gm-spectator-console.md`) gets save-point bookmarking, omniscient replay, and import. Save/resume is implicit: re-opening a game calls `resumeGame`; a "resume where you left off" entry on the lobby screen restores the last `cursorSeq`/live position.

## Dependencies

- `A3-data-architecture-event-store.md` — **the foundation**: `gameEvents`/`gameSnapshots`/`sealedOrders`, `readEvents`, `loadState`, `replay`, `getLatestSnapshot`, `writeSnapshot`, `reduce`/`foldEvents`, optimistic `appendEvents`. E2 is essentially the user-facing API over A3.
- `B2-rules-engine-core.md` — `fold`, `gameRulesets` pin (`rngSeed`, `moduleVersions`, `annexTables`, `engineVersion`) that makes cross-version replay sound.
- `C1-sequence-of-play-engine.md` — `applyEvent` projector, `SequenceState`/`ActiveStep`, `pause`/`resume`; the sealed-step lifecycle the undo boundary tracks.
- `A4-realtime-sync-layer.md` — `buildResync`, `broadcastFogScoped` (fog-filtered replay frames), the live `DraftBuffer` hot path.
- `E1-dice-rng-service.md` — recorded `DiceRolled` outcomes replays read back instead of re-rolling.
- `E4-security-integrity.md` — fog visibility function, at-rest encryption of unrevealed plaintext, export redaction, audit of GM reveals.
- `E3-notifications.md` — pause/resume and "your turn to resume" alerts. `E5-testing-strategy.md` — golden-game replay fixtures. `A2-identity-roles-gating.md` — replay/export/import authorization.

## Edge Cases & Open Questions

- **Step-back cost.** `stepBack` re-seeks from the nearest snapshot; a single backward event near a turn end may re-fold ~200 events. Acceptable at v1 latencies; if profiling shows hot scrubbing, cache the last folded state and replay incrementally. **[v2]**
- **Cross-version replay.** If a deployed reducer changed and the game's pinned `engineVersion` build is unavailable, replay must upcast events by `schemaVersion` or refuse rather than diverge. The upcaster registry location is the open question carried from A3/B2.
- **Mid-game export and secrecy.** A `fogScrubbed` export strips unrevealed sealed plaintext so it can't leak the opponent's pending orders; a full unredacted export is GM/admin-only and audited (`E4`).
- **Undo vs. concurrent reveal.** A `RevertDraft` racing the barrier reaching `allLocked` (A4) must lose: the buffer is checked against current window status; if the step already locked, the revert is rejected `ALREADY_COMMITTED`.
- **Import gameId collision / provenance.** Default import mints a new `gameId`; an "import in place" for disaster recovery is GM/admin-only and must verify the source game is absent. Provenance metadata (original gameId, exporter) is retained in the manifest.
- *Open:* branchable "what-if" forks (replay diverging from a chosen seq with new commands) are attractive for training but require a fork lineage model — deferred **[v3]**.

## Testing

- **Snapshot+fold equivalence.** For each golden game, assert `seekTo(head)` equals a full `replay(0..head)` equals the live final state hash (ties to A3 and `E5-testing-strategy.md`).
- **Scrub determinism.** Seek to every turn boundary forward then backward; assert the folded state at each seq is identical in both directions (no `stepBack` drift).
- **Fog correctness.** Replay the Cadet game as each side at an early seq; assert the opponent's unrevealed sealed orders are absent, and as `'omniscient'` post-game they are present.
- **Undo boundary.** Build a 6D fire order via several `applyDraft`s; `RevertDraft to:'lastAction'` pops one, `to:'lastCommit'` clears to base; after `LockOrders`, `RevertDraft` is rejected and no `gameEvents` document was ever written by undo.
- **Resume integrity.** Pause mid-6D with one side locked; reload via `resumeGame`; assert `ActiveStep`, lock status, and each `DraftBuffer` survive with secrecy intact (mirrors C1's pause/resume test).
- **Export/import round-trip.** Export a completed game, re-import with `verifyReplay`, assert the new game's final state hash and integrity root match the original byte-for-byte; corrupt one event and assert `validateArchive` rejects it.

## Phasing

**[v1 AM-tournament]** — Read-only replay (scrub/seek/step/play at variable speed, single perspective + GM + post-game omniscient), snapshot+fold resume of paused games with in-flight sealed steps preserved, within-step undo-to-last-commit on the sealed draft buffer, named bookmarks, and single-game export/import with `sha256-chain` integrity and optional verify-replay. This is everything a tournament needs: pause/resume across days, post-game review, and a portable, tamper-evident game record for dispute adjudication.

**[v2]** — Multi-perspective synchronized replay (split-screen side-by-side fog views), annotated replays (commentary tracks for teaching), incremental scrub caching, and bulk/cold-archive export tooling over the A3 [v2] archival store.

**[v3 full Master]** — Branchable "what-if" forks from any seq (training/analysis), large many-sided replay performance work, and a formal event-schema upcaster pipeline so very old archives replay against current reducers. Deferred because tournament v1 needs faithful linear review and durable records first; speculative branching and deep back-compat add model complexity with no tournament payoff yet.
