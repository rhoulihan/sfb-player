# E1 — Dice & RNG Service

## Purpose & Scope

This subsystem is the single, auditable source of randomness for SFB Player. It owns a **per-game, seeded, counter-based pseudo-random generator** whose every output is a deterministic function of `(perGameSeed, rngCursor)`, so that re-folding an event log or re-running a resolver reproduces every die *exactly*; the `DiceRolled` event that records each draw together with its request context (who rolled, why, at what clock position, against which rule); the request API that the rules engine and every mechanics module call — generic `nDm` rolls, the d6/2d6 resolutions Star Fleet Battles actually uses, and numeric chart lookups; and the **anti-tamper / provable-fairness** machinery: a seed commitment published at game start, the secret seed sealed during play and revealed for verification at game end, and an audit pass that recomputes every recorded roll from the revealed seed. E1 never makes a tactical decision and never *decides* a game outcome — it produces unbiased numbers and a tamper-evident record; the modules that consume those numbers (`C3-movement-engine.md`, `C4-direct-fire-combat.md`, `C5-seeking-weapons.md`, `C6-carriers-shuttles-pf.md`, `C7-damage-criticals-repair.md`) own the rules that interpret them. It is injected into resolvers (never imported as a global), so the rules engine stays a pure reducer per `B2-rules-engine-core.md`.
**PHASE:** [v1 AM-tournament] for the seeded HMAC-CTR generator, `DiceRolled` logging, d6/2d6/nDm + chart-lookup API, seed commit-at-start / reveal-at-end, and the audit verifier. [v2] per-side client-seed contribution for trustless provable fairness and a live in-game fairness panel. [v3] pluggable non-d6 dice for non-Master modules and optional hardware-entropy seeding.

## Rulebook References

Star Fleet Battles resolves almost everything on six-sided dice; E1 provides the *mechanism*, the cited modules own the *interpretation*:

- **General** — six-sided dice throughout; most resolutions are 1d6, several charts are 2d6 (hellbore, PPD, mauler — see `C4-direct-fire-combat.md`).
- **(D6.1)** Sensor lock-on — one d6 per attempting ship in Phase 4 (consumed by the EW/sensors module; see `B2-rules-engine-core.md`).
- **(E1.8, E1.821, E1.822, E1.823)** Direct-fire die-roll resolution models (hit-or-miss, range-of-effect, proportional) and die-roll modifiers — the to-hit numbers `C4` reads off E1's rolls.
- **(D4.2)** Damage Allocation Chart — one d6 per volley/internal-point step to pick the DAC column (`C7-damage-criticals-repair.md`).
- **(FP8.42–FP8.43)** Plasma-bolt hit determination (`C5-seeking-weapons.md`).
- **(C3/C5 breakdown, HET, Quick Reverse)** breakdown and maneuver rolls (`C3-movement-engine.md`).
- **(B2.4)** Secret & simultaneous resolution — all randomness is drawn at the *reveal/resolution* step, after sealed orders are opened, so no roll leaks before it is committed.

## Domain Model

```ts
type Uuid = string;            // UUIDv7
type Hex = string;             // lowercase hex-encoded bytes
type ISODate = string;
// GameClock & Actor are imported from A3-data-architecture-event-store.md

type DiePurpose =
  | 'to-hit' | 'damage-allocation' | 'damage-points' | 'critical-hit'
  | 'lock-on' | 'breakdown' | 'quick-reverse' | 'sublight-evasion'
  | 'plasma-bolt' | 'random-selection' | 'initiative' | 'generic';

/** Structured "why" recorded on every roll; A3's flat requestContext = canonicalString(this). */
interface RollContext {
  subsystem: string;           // e.g. 'C4-direct-fire-combat'
  clock: GameClock;            // turn/phase/impulse/segment at draw time
  shipId?: string;
  weaponInstanceId?: string;
  targetRef?: string;
  note?: string;               // free-text for the game log (E2)
}

interface RollRequest {
  faces?: number;              // default 6 (SFB d6); nDm allows others (v3)
  count: number;               // number of dice in this draw (2 for 2d6)
  purpose: DiePurpose;
  rule?: string;               // deep-linkable rule ref, e.g. 'E4.12' (B1)
  context: RollContext;
}

interface RollResult {
  rollId: Uuid;
  rolls: number[];             // each in 1..faces
  total: number;
  faces: number;
  startCursor: number;         // == DiceRolled.rngCursor (A3 anchor)
  endCursor: number;           // bytesConsumed = endCursor - startCursor (rejection sampling ⇒ variable)
  request: RollRequest;
}

/** Folded into GameState from DiceRolled events; the determinism anchor B2/C1 already carry as rngCursor. */
interface RngState {
  cursor: number;              // next free byte index in the keystream
  drawCount: number;           // number of DiceRolled appended
  algorithm: string;          // e.g. 'hmac-sha256-ctr@1' (pinned for replay safety)
  seedCommitment: Hex;         // published at init; verifiable at reveal
}

/** Low-level numeric chart resolver; domain charts (WeaponChart, DAC, crit table) layer on top. */
interface DiceChart<TOut> {
  id: string;
  dieSize: 1 | 2;
  byTotal?: Record<number, TOut>;                 // exact total → outcome
  bands?: { lo: number; hi: number; out: TOut }[]; // inclusive total bands
}
```

**Mongoose schema sketch.** The only persisted artifact E1 *owns* is the secret seed, deliberately kept **out of the event log and out of `GameState`** so it can never reach a client and let a player predict future rolls. `RngState` lives in the fold (anchored by `rngCursor`, already declared in `B2`/`C1`); the public `seedCommitment` rides in the `GameRngInitialized` event.

```ts
const RngSecretSchema = new Schema({
  _id:            String,                       // gameId
  algorithm:      { type: String, default: 'hmac-sha256-ctr@1' },
  seedCiphertext: Buffer,                       // AES-256-GCM(perGameSeed) — wrapping key from rngMasterSeedSalt (A1)
  seedIv:         Buffer,
  seedTag:        Buffer,
  seedCommitment: { type: String, required: true }, // sha256(perGameSeed)
  createdAt:      { type: Date, default: () => new Date() },
  revealedAt:     { type: Date, default: null },
}, { collection: 'gameRngSecrets', versionKey: false });
RngSecretSchema.index({ _id: 1 }, { unique: true });
```

`B2`'s `gameRulesets.rngSeed` is the server-side handle to this seed; E1 mandates it be encrypted at rest and **stripped from every client-facing projection** (fog enforcement in `E4-security-integrity.md`). The per-game seed is the PRF key; A1's server-wide `rngMasterSeedSalt` is the *wrapping* key that encrypts the seed at rest, **not** an input to roll generation — so revealing one game's seed at its end yields full public verifiability of that game without exposing the platform salt or any other game's stream.

## Events & Commands

**Commands consumed:**

- `InitializeGameRng { algorithm }` — emitted once at game creation (by the `games` lifecycle, `A3`). E1 generates `perGameSeed`, stores the encrypted secret, returns the commitment.
- `RequestManualRoll { request: RollRequest }` — GM/host-only manual roll for house-rule/edge-case events (gated by `A2-identity-roles-gating.md`).
- `RevealGameSeed { reason }` — GM/admin-only; normally at game end. Publishes the plaintext seed for audit.
- `ApplyGmOverride { target, value, reason }` — supersede a recorded roll (see override points below).

**Events emitted (past-tense, appended to `gameEvents`):**

```ts
interface GameRngInitializedPayload {
  algorithm: string; seedCommitment: Hex;         // seed itself is NOT here
}

interface DiceRolledPayload {                       // extends A3's sketch; deterministic:false on the envelope
  rollId: Uuid;
  algorithm: string;                               // pins generator version for replay
  requestContext: string;                          // canonicalString(context) — A3 compatibility
  context: RollContext;                            // structured form (for E2 rendering / audit)
  faces: number; count: number;
  rolls: number[]; total: number;
  rngCursor: number;                               // == startCursor (A3 anchor; some C-docs call this rngCursor)
  endCursor: number;
  purpose: DiePurpose; rule?: string;
  overridden?: boolean;                            // set when a later GmOverrideApplied supersedes value
}

interface GameSeedRevealedPayload { seed: Hex; commitmentVerified: boolean; reason: string; }
// GmOverrideApplied uses A3's canonical {target,value,reason}; target.seq → the DiceRolled being overridden.
```

A `DiceRolled` is always appended **before** the event whose computation consumed it (the ordering rule from `B2`), so re-folding advances `rngCursor` to the identical position. The seed is never carried by `DiceRolled`; only its position and outcome are.

## Engine / API

```ts
// ---- Low-level generator (PURE given the seed) ----
function prfKey(perGameSeed: Buffer): Buffer;                      // identity/derivation; salt not mixed here
function keystreamBlock(key: Buffer, blockIndex: number): Buffer;  // HMAC-SHA256(key, le64(blockIndex)) → 32 bytes
function rollFromCursor(                                           // rejection-sampled, unbiased
  key: Buffer, startCursor: number, count: number, faces: number,
): { rolls: number[]; endCursor: number };

// ---- Per-resolution session (the injected stream; aliases below) ----
interface DiceService {
  roll(request: RollRequest): RollResult;          // advances the local cursor
  d6(purpose: DiePurpose, ctx: RollContext, rule?: string): number;          // 1d6 convenience
  d6x2(purpose: DiePurpose, ctx: RollContext, rule?: string): RollResult;    // 2d6 convenience
  rollNdM(count: number, faces: number, req: Omit<RollRequest,'count'|'faces'>): RollResult;
  resolveChart<T>(request: RollRequest, chart: DiceChart<T>): { roll: RollResult; outcome: T };
  cursor(): number;
  drainEvents(): EventDraft<'DiceRolled'>[];        // harvested by the resolver, prepended to its output
}
// Type aliases exported for sibling docs (all the SAME stream): DiceCursor (B2), RngStream/SeededRng (C1/C3), Rng (C5/C6).

function createDiceService(                          // built by B2/C1 per command resolution
  gameId: Uuid, rngState: RngState, seed: SeedProvider,
): DiceService;

// ---- Lifecycle & audit (impure: IO + secret store) ----
function initializeGameRng(gameId: Uuid): Promise<{ seedCommitment: Hex; event: EventDraft }>;
function revealGameSeed(gameId: Uuid, actor: Actor, reason: string): Promise<EventDraft>;
function auditGameRng(gameId: Uuid, revealedSeed: Buffer): Promise<DiceAuditReport>;

interface DiceAuditReport {
  ok: boolean;
  commitmentValid: boolean;                          // sha256(seed) === recorded commitment
  totalRolls: number;
  cursorContiguous: boolean;                         // ranges tile [0..cursor) with no gap/overlap
  mismatches: { seq: number; expected: number[]; recorded: number[]; overridden: boolean }[];
}
```

`SeedProvider` decrypts `gameRngSecrets` server-side and hands the raw key only to pure functions; it has no client-reachable surface. A die of `faces` is drawn by reading keystream bytes from `cursor`, rejecting any byte `≥ 256 − (256 % faces)` (removing modulo bias), mapping the first accepted byte to `(byte % faces) + 1`, and advancing `cursor` past every byte read — accepted or rejected — so `endCursor` is recorded and reproducible. Because the keystream is a CSPRNG-grade keyed PRF, observing the full history of past rolls reveals nothing about future rolls — essential, since rolls are public the instant they resolve mid-game.

## Validation & Enforcement Rules

The server is the authoritative, tamper-evident referee for randomness:

- **Single entropy source.** No code path calls `Math.random`, `Date.now()`-seeded RNG, or any unseeded source; A1 guarantees the deployed image isolates this service as the only entropy origin. Reducers (`A3`) never roll — they read recorded `DiceRolled` outcomes back.
- **Cursor monotonic & contiguous.** A `DiceRolled` is accepted only if its `rngCursor` equals the current folded `RngState.cursor`; its `[startCursor, endCursor)` must abut the previous draw with no gap (would hide a draw) and no overlap (would reuse entropy). Violations are rejected at validation and flagged by `auditGameRng`.
- **Speculative draws discarded on conflict.** Dice are computed during resolution; if the optimistic append loses the `seq` race (`A3` `ConcurrencyError`), the speculative `DiceRolled` drafts are dropped, so only the *winning* append advances the canonical cursor. The retried resolution re-draws at the now-current cursor.
- **Seed secrecy.** The plaintext seed never enters `gameEvents`, `gameSnapshots`, `GameState`, or any client payload; it is encrypted at rest and surfaced only by an explicit `RevealGameSeed`. Revealing during live play is blocked (it would let a side predict its rolls) except by `admin` with an all-sides-consent flag.
- **Commitment integrity.** `GameRngInitialized.seedCommitment = sha256(perGameSeed)` is published before the first roll; `revealGameSeed` recomputes and asserts the match, making after-the-fact seed substitution detectable by anyone.
- **GM-override points (`GmOverrideApplied`).** A GM may (a) **substitute** a recorded roll's value or (b) order a **reroll**. E1 resolves `B2`'s open question in favor of **consume-then-supersede**: the original draw is kept (cursor already advanced, `DiceRolled.overridden=true`), and `GmOverrideApplied{ target.seq, value:{rolls}, reason }` carries the value resolvers actually use. A reroll instead emits a fresh `DiceRolled` (new cursor span, `causationId` → the override) so the stream stays contiguous either way and the audit treats override-linked mismatches as legitimate, not tamper.

Automated vs. player decision: E1 **automates** seeding, drawing, bias removal, logging, commitment, and audit. It makes **no** tactical or rules decision — *which* roll to request, and how to read it, belongs to the consuming module and, above that, to the player.

## UI Contract

The client never holds a seed and never rolls; it only renders server results, which keeps authority and determinism intact. Each `DiceRolled` streams (fog-filtered, via `A4-realtime-sync-layer.md`) into the **game log / replay** (`E2-game-log-replay.md`) as an annotated entry — e.g. "C4 photon to-hit @ R5 — rolled [3] vs hit# ≤4 → HIT (E4.12)" — built from `context`, `rolls`, and `rule`. The **impulse HUD** (`D6-impulse-hud.md`) shows a running dice feed for the active segment. Optional dice-roll animation is purely cosmetic and is driven by the *already-decided result*, never a client RNG. The **GM/spectator console** (`D9-gm-spectator-console.md`) exposes `RequestManualRoll` and the override controls. A post-game **fairness panel** (surfaced in `E2`) lets verified owners trigger `RevealGameSeed` + `auditGameRng` and shows the report — commitment match, contiguous-cursor check, and any mismatches with their override status. E1 has no dedicated wireframe; it surfaces through those screens.

## Dependencies

- `A3-data-architecture-event-store.md` — the `DiceRolled` envelope (`deterministic:false`), the append/fold that carries `rngCursor`, snapshot replay.
- `A1-deployment-infrastructure.md` — `rngMasterSeedSalt` (seed-wrapping secret), Node `crypto` (HMAC-SHA256, AES-GCM), and the guarantee that this is the image's sole entropy source.
- `A2-identity-roles-gating.md` — role gates for `RequestManualRoll`, `RevealGameSeed`, and override.
- `A4-realtime-sync-layer.md` — streams `DiceRolled` to clients; injects no randomness of its own.
- `B2-rules-engine-core.md` — primary consumer; builds the injected `ctx.rng`/`DiceCursor` and orders `DiceRolled` ahead of dependent events.
- `C1-sequence-of-play-engine.md` — supplies the cursor position to resolvers and stamps the `GameClock` recorded in each roll's context.
- `B1-rules-content-api.md` — resolves each `rule` ref to a deep link for verified owners.
- `E2-game-log-replay.md`, `E4-security-integrity.md`, `E5-testing-strategy.md` — render/replay rolls, encrypt the seed + raise tamper alerts, and supply golden-seed fixtures. E1 **services every `C*` mechanics doc** that needs a die.

## Edge Cases & Open Questions

- **Variable byte consumption.** Rejection sampling means a draw consumes an unpredictable number of bytes; `endCursor` (not `count`) is the source of truth for stream advance, which the contiguity check relies on.
- **Public verifiability vs. shared secret.** Keeping the PRF key = per-game seed (salt only wraps it at rest) lets the seed be revealed for *public* audit without exposing other games. If a future requirement needs the salt in the PRF, audit becomes admin-only — explicitly avoided in v1.
- **Trustless fairness.** v1 trusts the server not to *grind* seeds before commitment. v2's per-side client-seed contribution (`effectiveKey = HMAC(perGameSeed, concat(clientSeeds))`) removes that trust; open question is the join/commit ordering for late-joining commanders.
- **Reroll-heavy rules.** Rules that "reroll on a 1" each consume a fresh draw recorded as its own `DiceRolled`; the consuming module owns the loop, E1 just keeps issuing contiguous draws.
- **Clock-keyed addressing.** `C1` describes seeding by `(gameId, clock, rngCursor)`; canonical E1 keys the *position* by the linear cursor alone and records the clock as context. The two reconcile because every draw stamps its clock — open item only if a module needs clock-addressable replay slices.
- **Seed loss.** If `gameRngSecrets` is lost, the game still replays perfectly (outcomes are in the log) but is no longer fairness-auditable; mitigated by encrypted backups (`E4`).
- **Cross-runtime determinism.** Relies solely on HMAC-SHA256 and integer math (no floats), so results are identical across Node versions and PM2 workers.

## Testing

- **Determinism.** Same seed + same start cursor → byte-identical `rolls`/`endCursor` across repeated runs, machines, and Node versions; a recorded `gameEvents` slice re-folds to identical `RngState` (cross-checked against `C4`/`C5` replay tests).
- **Uniformity & bias.** Chi-square over ≥10⁶ d6 draws within tolerance; an explicit test proves naïve `byte % 6` would bias toward 1–4 and that rejection sampling removes it.
- **Commitment.** `sha256(revealedSeed) === GameRngInitialized.seedCommitment`; a substituted seed fails `revealGameSeed`.
- **Contiguity.** Appended `DiceRolled` ranges tile `[0..cursor)` with no gap/overlap; an injected gap fails validation and audit.
- **Tamper detection.** Flipping a recorded roll (no linked override) → `auditGameRng.ok=false` with a mismatch; a GM override → mismatch flagged `overridden:true` and `ok` stays true.
- **Override parity.** Replays with and without a value-substitution override reach the same `rngCursor` (consume-then-supersede), confirming `B2`'s parity requirement.
- **Golden seeds.** Fixtures seed the Cadet (A4.0) and Sample (A5.0) worked games (`E5-testing-strategy.md`) so documented rolls reproduce the rulebook's stated outcomes; resolvers are asserted never to call `DiceService` during a pure re-fold.

## Phasing

- **[v1 AM-tournament]** — HMAC-SHA256 counter-mode generator with rejection-sampled d6/2d6/nDm, the `DiceService` session + injected aliases, `DiceRolled` logging with structured context, `RngState` fold anchored on `rngCursor`, seed encrypted at rest (salt-wrapped) with commitment at init and reveal-at-end, the chart-lookup helper, full GM override (substitute + reroll), and `auditGameRng`. This is the minimum for a deterministic, replay-exact, tamper-evident tournament game.
- **[v2]** — per-side client-seed contribution for trustless provable fairness, a live in-game fairness/audit panel, and statistical-fairness dashboards (per-game and platform-wide chi-square monitoring).
- **[v3]** — pluggable non-d6 dice for non-Master modules that need them, optional hardware-entropy (or external beacon) seeding for the per-game seed, and a zero-knowledge fairness proof so a seed can be verified without full reveal. Deferred because tournament play is pure d6 and the commit/reveal scheme already gives sound auditability for v1.
