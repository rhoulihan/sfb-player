# B2 — Rules Engine Core

## Purpose & Scope

This document specifies the **referee kernel** of SFB Online: the framework that turns the append-only event log into a legal, deterministic game. It is *not* a rules subsystem itself — it owns no Star Fleet Battles rule in detail. Instead it defines the contracts that every rules subsystem (C1 sequence, C2 energy, C4 direct fire, C5 seeking weapons, C7 damage, C8 EW, C10 boarding, …) plugs into: the pure `validateCommand(state, command) -> Legality` and `resolveSimultaneous(state, sealedOrders) -> events[]` functions, the `RuleModule` registry that lets those subsystems register handlers and compose, the deterministic RNG injection from the Dice service, the GM-override hook points, and the structured legality/error model the client renders. The engine is a **pure, side-effect-free reducer**: persistence (A3), transport (A4), and randomness sourcing (E1) are injected so the same events always fold to the same state and the same sealed orders always resolve to the same events — the determinism guarantee that makes replay (E2) and lockstep sync (A4) sound. PHASE: core engine and the sequence + direct-fire module-host paths are **[v1 AM-tournament]**; advanced composition features (passive fire control hooks, multi-module override arbitration) are **[v2]/[v3]**.

## Rulebook References

The kernel reifies the *mechanism* behind these rules; the cited subsystem docs own the numeric detail.

- **(B2.0)–(B2.2)** master turn/impulse/segment clock the engine schedules — owned in detail by `C1-sequence-of-play-engine.md`.
- **(B2.3)** per-step phase/segment actions that modules hook (energy B2.3-1, lock-on B2.3-4, direct fire B2.3-6D).
- **(B2.4)** secret-and-simultaneous commit → lock → reveal protocol — the `resolveSimultaneous` contract.
- **(D2.0)–(D4.2)** direct-fire pipeline used as the worked combat exemplar (arc D2, struck-shield D3.4, volley D4.1, DAC D4.2) — owned by `C4-direct-fire-combat.md` / `C7-damage-criticals-repair.md`.
- **(D6.1)** sensor lock-on roll the phase-4 hook auto-resolves — owned by `C8-ew-sensors-cloak.md`.
- **(D8.1)** critical-hit trigger as an example of a per-impulse accumulator hook.

These appear only to ground the framework in worked examples; verbatim rule text is never embedded (see `B1-rules-content-api.md`).

## Domain Model

The engine operates over a `GameState` aggregate that is a deterministic fold of `DomainEvent`s. The kernel owns the *envelope* fields and the clock; each rule module owns a namespaced slice under `state.modules[id]`.

```ts
type Phase = 1|2|3|4|5|6|7|8;            // B2.2 master cycle
type Segment = 'A'|'B'|'C'|'D'|'E';      // B2.3-6 impulse sub-sequence

interface GameClock {
  turn: number;                          // 1..N
  phase: Phase;
  impulse: number;                       // 1..32 during phase 6, else 0
  segment: Segment | null;               // non-null only in phase 6
  step: number;                          // intra-segment ordinal (Annex #2 ordering)
}

interface GameState {
  gameId: string;
  seq: number;                           // seq of the last folded event
  clock: GameClock;
  rngCursor: number;                     // # of dice draws consumed (determinism anchor)
  units: Record<string, UnitState>;      // shape owned by B3 + C-docs
  sealedLocks: SealedLockState;          // commit/lock bitmap per decision point
  activeOverrides: Record<string, OverrideValue>; // keyed by OverridePoint id
  modules: Record<string, unknown>;      // per-module private slice (init() output)
  ended: boolean;
}

// A GM-substitutable decision site declared by a module.
type OverridePoint = string;             // e.g. 'lockOn.result:U17', 'dac.box:U3#v8'
interface OverrideValue { value: unknown; reason: string; by: string; eventSeq: number; }
```

A **RuleModule** is the unit of composition. Modules are registered at boot, topologically sorted by `dependsOn`, and frozen into a `RuleRegistry`.

```ts
type Validator = (s: GameState, c: Command, ctx: EngineContext) => LegalityReason[];
type Resolver  = (s: GameState, c: Command, ctx: EngineContext) => DomainEvent[];
type Reducer   = (s: GameState, e: DomainEvent) => GameState;     // MUST be pure

interface ModuleHooks {
  onPhaseEnter?: Partial<Record<Phase, Resolver>>;   // e.g. phase 4 -> lock-on rolls
  onSegmentEnter?: Partial<Record<Segment, Resolver>>;
  onImpulseEnd?: Resolver;                            // e.g. D8.1 critical accumulator flush
  onTurnEnd?: Resolver;                               // record-keeping carryover (B2.3-8)
}

interface RuleModule {
  id: string;                              // 'sequence' | 'direct-fire' | 'energy' ...
  version: string;                         // pinned per game for replay (gameRuleset)
  rulebookRefs: string[];
  dependsOn?: string[];                    // module ids -> ordering
  init?(scenario: ScenarioConfig): unknown;
  validators?: Partial<Record<CommandType, Validator[]>>;   // composed, many per command
  resolvers?:  Partial<Record<CommandType, Resolver>>;      // exactly one owner per command
  reducers?:   Partial<Record<EventType,  Reducer[]>>;      // composed, many per event
  hooks?: ModuleHooks;
  overridePoints?: OverridePoint[];        // declared substitutable sites
}
```

The kernel persists only the **determinism anchor**; the canonical event/snapshot stores live in `A3-data-architecture-event-store.md`, and sealed orders live in Redis per the stack contract.

```ts
// Mongoose sketch — collection 'gameRulesets' (owned by B2)
const GameRulesetSchema = new Schema({
  gameId:         { type: String, index: true, unique: true },
  rngSeed:        { type: String, required: true },          // hex seed for DiceService (E1)
  moduleVersions: [{ id: String, version: String }],         // pins handler code -> replay-safe
  optionalRules:  { type: Map, of: Boolean },                // leakyShields, fractionalAccounting, criticals (D8.0)...
  phaseScope:     { type: String, enum: ['v1-am-tournament','v2','v3'], default: 'v1-am-tournament' },
  annexTables:    { type: Map, of: String },                 // versioned table ids: Annex #2/#7E/#9, Impulse Chart
  createdAt:      { type: Date, default: Date.now }
});
```

## Events & Commands

The kernel defines the **envelopes** and routes them; payload shapes belong to the owning subsystem doc.

```ts
interface Command<T = unknown> {
  type: CommandType;                       // PascalCase imperative (canonical names)
  gameId: string;
  issuedBy: { userId: string; role: Role; side?: string };
  payload: T;
  clientSeq: number;                       // per-actor idempotency key
  sealed?: boolean;                        // belongs to a B2.4 sealed bundle
}

interface DomainEvent<T = unknown> {
  type: EventType;                         // past-tense (canonical names)
  gameId: string;
  seq: number;                             // global monotonic per game
  clock: GameClock;                        // clock at emission
  causedBy: string;                        // command id or parent event seq
  payload: T;
}
```

Kernel-owned commands/events (subsystem commands are merely routed):

| Command | Emitted event(s) | Notes |
|---|---|---|
| `SubmitSealedOrders` | `OrdersSealed` | hash-committed server-side; payload hidden until reveal (B2.4) |
| `AdvanceImpulse` | `ImpulseAdvanced` / `SegmentAdvanced` / `PhaseAdvanced` | only legal when all sides locked; drives the clock |
| (reveal, server-internal) | `OrdersRevealed`, then module events | triggered when `sealedLocks` for the segment are all set |
| `ApplyGmOverride` | `GmOverrideApplied` | `{ target: OverridePoint, value, reason }` |
| (any resolver draw) | `DiceRolled` | every RNG draw is logged so the fold reproduces `rngCursor` |

Every `DiceRolled` event is emitted **before** the event whose computation consumed it, so re-folding advances `rngCursor` identically.

## Engine / API

The two contracts the prompt names, plus the registry and fold:

```ts
// Pure legality check — used at submit time AND inside sealed-order validation.
function validateCommand(s: GameState, c: Command, ctx: EngineContext): Legality;

interface Legality { legal: boolean; reasons: LegalityReason[]; }
interface LegalityReason {
  code: string;                 // machine code, e.g. 'NO_LOCK_ON', 'OUT_OF_ARC', 'WRONG_SEGMENT'
  ruleRef: string;              // 'D6.1'
  message: string;              // original UI prose (never rulebook verbatim)
  severity: 'error' | 'warning';
  target?: { unitId?: string; weaponId?: string; field?: string };
  overridable: boolean;         // GM may suppress this exact block
  overridePoint?: OverridePoint;
}

// Pure simultaneous resolver — B2.4 reveal step. Deterministic given (state, orders, seed).
function resolveSimultaneous(
  s: GameState,
  sealedOrders: SealedOrderBundle,   // all sides' revealed commitments for this decision point
  ctx: EngineContext
): DomainEvent[];

// Single-command (non-simultaneous) path, e.g. AdvanceImpulse, ApplyGmOverride.
function applyCommand(s: GameState, c: Command, ctx: EngineContext): DomainEvent[];

// The fold. reduce(events) === state, for all permitted orderings the engine produced.
function applyEvent(s: GameState, e: DomainEvent): GameState;
function fold(initial: GameState, events: DomainEvent[]): GameState;

// Registry assembly (boot-time, once).
function buildRegistry(modules: RuleModule[]): RuleRegistry; // topo-sorts dependsOn, freezes
```

`EngineContext` injects every non-pure dependency, keeping the functions above referentially transparent:

```ts
interface EngineContext {
  rng: DiceCursor;              // seeded stream (E1); rng.d6()/rng.d6x2() advance rngCursor
  registry: RuleRegistry;       // module lookup + composed chains
  catalog: ShipCatalog;         // SSD lookups (B3)
  overrides: (p: OverridePoint) => OverrideValue | undefined;  // reads state.activeOverrides
  scenario: ScenarioConfig;
}
```

**Composition mechanics.** For a command type, `validateCommand` runs the *concatenated* validator arrays of every module that registered for it, in `dependsOn` order, and unions the returned `LegalityReason[]`; the command is legal iff no `severity:'error'` reason survives override suppression. Resolution has exactly **one** owning module resolver per command type, but that resolver may call sibling-module *services* exposed through the registry (e.g. the direct-fire resolver calls the damage-allocation service in `C7`). Event reducers compose: a single `WeaponFired` event may be reduced by both the combat slice (mark weapon fired) and the unit slice (decrement boxes) — `applyEvent` runs all registered reducers for the type in order.

**Deterministic RNG injection.** `ctx.rng` is a *cursor* over the seeded stream defined in `E1-dice-rng-service.md`, keyed by `gameRulesets.rngSeed` and positioned at `state.rngCursor`. Resolvers never call `Math.random`; they call `ctx.rng.d6()`, which (a) is a pure function of `(seed, cursor)` and (b) causes the orchestrator to prepend a `DiceRolled` event. Re-folding replays those `DiceRolled` events, advancing `rngCursor` to the identical position — so a replayed `resolveSimultaneous` draws the same numbers.

## Validation & Enforcement Rules

The kernel is the **authoritative referee**: clients send intent, the server decides legality and computes outcomes; no hidden state ever reaches a client (fog-of-war is enforced because sealed payloads are withheld until `OrdersRevealed`).

**Sequence exemplar (B2.0–B2.4).** `AdvanceImpulse` is gated by the `sequence` module validator: it returns `{code:'NOT_ALL_LOCKED', ruleRef:'B2.4', severity:'error'}` unless every side's `sealedLocks` for the current decision point is set; and `{code:'WRONG_SEGMENT'}` if a side tries to act out of segment order (the order is a hard contract per the B2.3 closing note). On a legal advance the resolver emits the clock-stepping event, then the orchestrator fires the next segment/phase `hooks`. Entering **phase 4** triggers the `sensors` module `onPhaseEnter[4]`, which auto-rolls one lock-on per attempting ship via `ctx.rng` (D6.1), emitting `DiceRolled` + `LockOnResolved`; undamaged-sensor ships short-circuit to automatic lock-on with no draw. This shows hook-driven automation, RNG injection, and turn-scoped state all composing through the kernel without the sequence module knowing combat rules.

**Combat exemplar (B2.4 + D-pipeline).** At segment **6D** every side submits `DeclareFire` as a **sealed** order. Submit-time `validateCommand` runs the composed chain: `sequence` (must be segment D), `sensors` (`NO_LOCK_ON` → block, ruleRef D6.1, `overridable:true`), `direct-fire` (`OUT_OF_ARC`, ruleRef D2.0), `energy` (fire-control/phaser-capacitor power present). When all sides lock, the orchestrator reveals and calls `resolveSimultaneous` once: it **snapshots the committed-weapon list first** so a weapon destroyed mid-segment still fires (B2.4 / D-simultaneity), then per weapon resolves struck shield (D3.4 — including the D3.41 "advance one hex" tie-break and the D3.43 ambiguous fall-through), forms one volley per (shield, damage-step, impulse) (D4.1/D4.22/D4.34), subtracts general → specific reinforcement → shield boxes → armor (D3.34/D4.12), and rolls the DAC per internal point (D4.2) applying bold/phaser-directional/hull/engine restrictions (D4.3). Output is an ordered `DiceRolled`/`WeaponFired`/`DamageAllocated` stream. Because resolution is one pure function over the revealed bundle, both lockstep clients fold to byte-identical state.

**GM-override hook points.** Two classes: (1) **legality suppression** — any `LegalityReason{overridable:true}` can be neutralized by a prior `GmOverrideApplied{target: reason.overridePoint, value:{allow:true}}`; `validateCommand` consults `ctx.overrides` and drops the matching error. (2) **value substitution** — a module declares `overridePoints` (e.g. `'lockOn.result'`, `'dac.box'`, `'shield.struckFacing'`); inside a resolver, before using a computed/rolled value, it calls `ctx.overrides(point)` and, if present, uses the GM value instead and tags the emitted event `overriddenBy`. Every override is itself the recorded `GmOverrideApplied` event `{target, value, reason}` (host/GM role only; enforced by `A2-identity-roles-gating.md`), so the audit trail and replay stay complete.

## UI Contract

The kernel exposes a thin, rules-agnostic surface the client renders uniformly:

- **Dry-run legality:** `POST /api/games/:id/validate` returns `Legality` for a candidate command without emitting events, so the targeting/energy/plotting UIs (`D3`,`D4`,`D5`) can grey out illegal actions and show inline reasons keyed by `target.{unitId,weaponId,field}`. Each reason carries `code`, `ruleRef` (deep-linkable into `B1`/`D7`), and `message`.
- **Lock/commit state:** the per-decision `sealedLocks` bitmap (which sides have committed) is broadcast so the Impulse HUD (`D6`) shows the "waiting on N players" gate — without leaking any sealed payload.
- **Override channel:** the GM/spectator console (`D9`) lists overridable reasons and declared `overridePoints` at the current step and submits `ApplyGmOverride`; resolved events return `overriddenBy` so the UI can badge them.
- **Determinism is invisible:** clients never receive RNG seeds or hidden orders; they receive only revealed events. See wireframes referenced by the D-docs.

## Dependencies

- `A3-data-architecture-event-store.md` — canonical `gameEvents`/`gameSnapshots` persistence; B2 is the reducer that defines current state.
- `A4-realtime-sync-layer.md` — lockstep transport, the commit-lock-reveal socket choreography, Redis sealed-order store.
- `A2-identity-roles-gating.md` — role checks; GM/host authority for `ApplyGmOverride`.
- `E1-dice-rng-service.md` — the seeded `DiceCursor` injected as `ctx.rng`.
- `E2-game-log-replay.md` — replays the event log through `fold`; relies on `gameRulesets` module-version pinning.
- `B1-rules-content-api.md` — resolves `ruleRef` deep links for legality reasons.
- `B3-game-catalog-ssd-model.md` — the `ShipCatalog`/`UnitState` shapes the engine folds over.
- Rule modules hosted by the kernel: `C1-sequence-of-play-engine.md`, `C2-energy-allocation-power.md`, `C3-movement-engine.md`, `C4-direct-fire-combat.md`, `C5-seeking-weapons.md`, `C7-damage-criticals-repair.md`, `C8-ew-sensors-cloak.md`, `C10-mines-boarding-misc.md`.
- `E4-security-integrity.md` — sealed-order hashing, fog-of-war guarantees.

## Edge Cases & Open Questions

- **Cross-module override arbitration:** when two modules both block the same command and only one reason is overridden, the command stays illegal — correct, but the UI must show the residual block clearly. Multi-reason single-override UX is **[v2]**.
- **Hook ordering on phase transitions:** several modules may register `onPhaseEnter[1]` (energy) vs `onSegmentEnter['A']` (movement, seeking-weapon impact). The seeking-weapon end-of-segment-A impact must resolve *before* segment D — encoded via `dependsOn` so topo order is load-bearing, not advisory.
- **Annex #2 / table externalization:** intra-segment action ordering (Initial/Impulse/Post-Combat/Final/Record-Keeping), the Impulse Chart (speed → moving impulses), the DAC (Annex #7E), and repair costs (Annex #9) are **data**, versioned in `gameRulesets.annexTables`, not kernel code. Their exact contents are sourced in the C-docs; the kernel only guarantees they are pinned per game.
- **Non-determinism leaks:** any resolver that reads wall-clock time, iterates a `Map` in insertion-dependent order, or calls `Math.random` breaks replay. Enforced by lint + the property test below.
- **Open:** whether GM value-substitution overrides should *consume* an RNG draw (to keep `rngCursor` aligned) or skip it — leaning toward consuming-then-discarding so cursor parity holds across overridden/non-overridden replays. Needs confirmation against `E2`.
- **Open:** mid-game module upgrades. A deployed bugfix changes a `version`; `gameRulesets.moduleVersions` pins the original, so in-flight games must keep loading the pinned handler. Versioned-handler loading strategy is an `A3`/`E2` concern to finalize.

## Testing

- **Determinism property test:** for a corpus of recorded games, assert `fold(events) === snapshot` and `resolveSimultaneous(state, orders, seed)` is byte-identical across 100 repeated runs and across two PM2 workers (catches `Map`/time/`Math.random` leaks).
- **Replay equivalence:** re-fold every game in CI; any divergence fails the build (ties to `E2`, `E5`).
- **Sequence worked example:** drive a turn through phases 1→8 and impulses 1→32, asserting `WRONG_SEGMENT`/`NOT_ALL_LOCKED` blocks fire exactly when expected (B2.2/B2.4) and that phase-4 auto lock-on emits one `DiceRolled` per attempting ship (D6.1).
- **Combat worked example:** reproduce the D4.63 volley case (45 points on a 30-box shield → 15-point internal volley) end-to-end through `resolveSimultaneous`, and assert a weapon destroyed earlier in the same 6D segment still emits its `WeaponFired` (B2.4 simultaneity snapshot).
- **Override coverage:** for each declared `overridePoint`, a test that an `ApplyGmOverride` both suppresses a blocking reason and substitutes a resolver value, with `GmOverrideApplied` recorded and `overriddenBy` propagated.
- **Module isolation:** registry build rejects dependency cycles and duplicate resolver owners; fuzz random command streams to assert no resolver throws on illegal input (validation must gate first).

## Phasing

- **[v1 AM-tournament]:** the kernel itself — envelopes, `validateCommand`/`resolveSimultaneous`/`applyCommand`/`fold`, the `RuleModule` registry with `dependsOn` topo-sort, seeded RNG injection with `DiceRolled` logging, the structured `Legality` model, both override classes, and `gameRulesets` pinning. Hosts the v1 modules needed for tournament play: sequence (C1), energy (C2), movement (C3), direct fire (C4), seeking weapons (C5), damage/criticals/repair (C7), EW/lock-on (C8). This is the minimum to referee a legal tournament duel end-to-end.
- **[v2]:** advanced composition — passive/low-powered fire-control hooks (D19.0/D6.7) as alternate validators, multi-reason override arbitration UX, boarding/area combat hooks (C10), richer hook lifecycle (`onTurnEnd` carryover automation).
- **[v3 full Master]:** module hot-loading for the full rulebook breadth (terrain C9, carriers/PF C6, fighters Module J), and per-empire rule variants registered as supplemental validator/reducer layers without touching the kernel.
