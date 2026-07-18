# E5 — Testing Strategy

## Purpose & Scope

This document defines how SFB Player proves it referees Star Fleet Battles correctly. It specifies four complementary layers: (1) **engine unit tests** that pin each subsystem's pure functions against the numeric facts in the rulebook (charts, ranges, costs, rounding); (2) **golden integration tests** that replay the two rulebook worked games — the Cadet's Game (A4.0) and the Sample Game / "The Duel" (A5.0, scenario SG1.0) — as fixed scripts of commands and forced dice, then assert that the folded `GameState` matches the rulebook's stated outcomes turn by turn; (3) **property tests** that assert invariants which must hold for *any* legal play (energy always balances, damage applied never exceeds damage dealt, the event `seq` stays gapless, replays are byte-identical); and (4) **Playwright end-to-end (E2E)** tests that drive the real React battle UI through a full impulse against a deterministic test-mode server. Fixtures are generated from the same catalog/SSD data the engine ships with (`B3-game-catalog-ssd-model.md`), so tests never drift from production geometry. A dedicated **catalog/overlay consistency audit** (the B4 `auditCatalogConsistency`, see `B4-ssd-layout-editor.md`) also runs in CI over **every published ship**, asserting the three-way *drawn SSD ↔ content inventory ↔ control overlay* match — no unmapped or orphan boxes, no content↔SSD gaps or per-type count mismatches, and every weapon mount carrying its firing arc — so the hand-built weapon/system inventory never drifts from the SSDs it was extracted from. Testing emits no game events of its own; it is a *consumer and assertor* of the canonical command/event contracts. PHASE: the golden-replay harness, the core property suite, sealed-reveal integration tests, the SSD fixture generator, and one happy-path E2E are **[v1 AM-tournament]**; the full Cadet ladder, victory/crippled/local-conditions scenario tests, visual regression, mutation testing, and load/soak are **[v2]**; the full-Master multi-empire scenario corpus is **[v3]**.

## Rulebook References

These supply the *expected values* the suite asserts; they are facts (numbers, ranges, outcomes), never copied prose.

- **(A2.0)–(A2.1)** turn = Energy Allocation Phase + 32 impulses, proportional movement — drives the impulse-walk assertions in golden replays.
- **(A3.4)** scale (1 hex = 10,000 km) and **(A3.5)** fraction rounding (drop ≤0.499, round up ≥0.500; Commander's-Option fractions retained) — the rounding-rule unit tests.
- **(A4.0)–(A4.4)** Cadet ladder rule-subset flags (phasers → heavy weapons → seeking weapons → full standard) — staged golden fixtures and the beginner-mode feature-flag tests; A4.3 drone facts (Speed 20, 4 HP, 12 warhead, 1/turn/rack, 8-impulse same-rack gap) as cadence assertions.
- **(A5.0)** the worked SG1.0 duel — the canonical regression fixture; its explicit per-turn die-roll arrays make every damage total reproducible (e.g. Turn-2 CA volley = 48 raw → 11 internal → 2 warp boxes; D7 volley = 16; final D7 phasers 6 → CA front shield = 8).
- **(B2.4)** sealed-commit → lock → reveal — the sealed-reveal integration tests.
- **(D3.x)/(D4.x)** absorption order (general → specific reinforcement → shield boxes → armor → internal) and the DAC — the damage-conservation property.
- **(S2.20)–(S2.3)** victory pipeline (step A BPV difference, step B options-to-enemy, step C per-ship greatest tier, ratio → level table) and **(S2.4)** continuous crippled evaluation — scenario-outcome assertions.
- **(S4.1)–(S4.25)** weapons-status initial-state builder and **(S5.1)–(S5.44)** local-conditions/pirate generators — RNG-chart and start-state tests.

## Domain Model

Fixtures are version-controlled JSON in the repo (reviewable, deterministic), described by these TypeScript shapes. CI persists only *baseline hashes* and run results to Mongo for drift detection.

```ts
type Hex = string;                 // "2123" offset coordinate, as the rulebook prints them

interface GoldenGame {
  id: 'cadet-A4.1' | 'sample-A5' | string;
  rulebookRef: string;             // 'A5.0'
  scenarioId: string;              // 'SG1.0'
  ruleset: { optionalRules: Record<string, boolean>; ruleLevel: 'Standard'|'Cadet' };
  setup: GoldenSetup;
  diceScript: DiceScript;          // forced rolls keyed to the worked example
  script: ScriptedStep[];          // ordered commands to feed the engine
  checkpoints: AssertionCheckpoint[];
}

interface GoldenSetup {            // A5.0 initial conditions
  startRange: number;              // 44
  units: Array<{
    ref: string;                   // catalog ReferenceCode, e.g. 'R2.x' (Fed CA), 'R5.x' (D7)
    side: string; hex: Hex; heading: 1|2|3|4|5|6; prevTurnSpeed: number;
    power: { warp: number; impulse: number; reactor: number; batteries: number };
    weaponsStatus: 0|1|2|3;        // S4.1
  }>;
  map: { size: [number, number]; fixed: boolean };
}

/** A queue of forced d6 outcomes so DiceRolled events reproduce A5's listed rolls (e.g. [1,2,4,5]). */
interface DiceScript {
  mode: 'forced';
  rolls: Array<{ context: string; values: number[] }>;  // context = 'T2:CA:photon.overload'
}

interface ScriptedStep {
  at: { turn: number; phase?: number; impulse?: number; segment?: 'A'|'B'|'C'|'D'|'E' };
  command: { type: string; actor: { side: string; userId: string }; payload: unknown };
}

/** A point-in-replay assertion. `path` reads into the folded GameState; `expect` is the rulebook fact. */
interface AssertionCheckpoint {
  at: { turn: number; impulse?: number; segment?: string };
  ruleRef: string;                 // 'A5.0'
  path: string;                    // 'units.CA.shieldStrength.1' | 'units.CA.excessDamage'
  expect: number | string | boolean;
  tolerance?: number;              // 0 for integer game state
}

interface PropertyConfig {
  name: 'energyBalances'|'damageConserved'|'seqGapless'|'foldDeterministic'|'noFogLeak'|'crippledMonotone';
  runs: number;                    // fast-check iterations
  generator: 'randomLegalTurn'|'randomFireSegment'|'randomScenarioSetup';
}
```

**Mongoose sketch** — fixtures are files; only CI bookkeeping is persisted:

```ts
const ReplayBaselineSchema = new Schema({          // collection: 'replayBaselines'
  goldenId:    { type: String, index: true },      // 'sample-A5'
  engineVersion: String,                            // pins B2 module-version set
  stateHash:   String,                              // sha256 of canonicalized final GameState
  eventLogHash:String,                              // sha256 of the emitted event stream
  createdAt:   { type: Date, default: Date.now }
}, { versionKey: false });
ReplayBaselineSchema.index({ goldenId: 1, engineVersion: 1 }, { unique: true });

const CiTestRunSchema = new Schema({                // collection: 'ciTestRuns'
  commit: String, suite: String, passed: Number, failed: Number,
  goldenDiffs: [{ goldenId: String, path: String, expected: Schema.Types.Mixed, actual: Schema.Types.Mixed }],
  durationMs: Number, ranAt: { type: Date, default: Date.now }
}, { versionKey: false });
```

## Events & Commands

Testing never defines game events; it **scripts existing commands** and **asserts on emitted events / folded state**. The harness wraps the canonical command names from `A3-data-architecture-event-store.md` (`PlotMovement`, `AllocateEnergy`, `DeclareFire`, `AllocateDamage`, `SubmitSealedOrders`, `AdvanceImpulse`, `ApplyGmOverride`) inside `ScriptedStep.command`. The only test-mode injection is the **forced dice feed**: instead of the seeded stream, `E1-dice-rng-service.md` runs in `forced` mode and dequeues `DiceScript.rolls`, so every emitted `DiceRolled` event carries the rulebook's listed values (A5.0). The harness then reads the canonical past-tense events it expects to see — `EnergyAllocated`, `MovementPlotted`, `OrdersSealed`/`OrdersRevealed`, `WeaponFired`, `DamageAllocated`, `ImpulseAdvanced`, `GmOverrideApplied` — and folds them through the production reducer (`A3.foldEvents`) before evaluating checkpoints. A golden run therefore exercises the *exact* command→validate→resolve→event→fold pipeline that live play uses; nothing is stubbed except wall-clock and the RNG source.

## Engine / API

All harness functions are pure given their inputs except the IO-bound loaders, mirroring the engine's own discipline.

```ts
// --- Golden replay ---
function loadGoldenGame(id: string): GoldenGame;                          // reads repo JSON
function forcedDice(script: DiceScript): DiceCursor;                      // E1 forced-mode cursor
function replayGoldenGame(g: GoldenGame): {                              // drives B2 + A3
  finalState: GameState; events: DomainEvent[]; checkpointResults: CheckpointResult[];
};
interface CheckpointResult { ref: string; path: string; expected: unknown; actual: unknown; pass: boolean; }
function assertGolden(g: GoldenGame): void;                              // throws on first mismatch

// --- Property suite ---
function runProperty(cfg: PropertyConfig): PropertyReport;               // wraps fast-check
function arbLegalTurn(catalog: ShipCatalog): Arbitrary<ScriptedStep[]>;  // generates only valid commands
function arbScenarioSetup(): Arbitrary<GoldenSetup>;                     // S4/S5-legal start states

// --- Invariant probes (pure; reused by property + golden) ---
function energyResidual(s: GameState, shipId: string): number;          // available - used (must be >= 0)
function damageLedger(ev: DamageAllocated): {                           // sums must equal raw dealt
  raw: number; generalReinf: number; specificReinf: number; shield: number; internal: number;
};
function stateHash(s: GameState): string;                               // canonical-JSON sha256

// --- Fixture generation from catalog/SSD ---
function generateSsdFixtures(refs: ReferenceCode[], version: string): SsdFixture[]; // from B3
interface SsdFixture { ref: ReferenceCode; templateVersion: string; instance: ShipRuntimeState; }

// --- Sealed-reveal integration ---
function sealedRevealHarness(steps: ScriptedStep[]): {                  // exercises B2.4
  fogFilteredStreams: Record<string, DomainEvent[]>;                    // per-side, pre-reveal
  revealedState: GameState;
};

// --- E2E (Playwright page objects) ---
class BattleHarness {
  startDeterministicGame(g: GoldenGame): Promise<void>;                 // server test-mode endpoint
  eaf(): EnergyAllocationPage; map(): BattleMapPage; hud(): ImpulseHudPage; ssd(side: string): SsdPage;
}
```

## Validation & Enforcement Rules

This section is the heart of the doc: the *invariants the suite enforces against the engine*, each a referee guarantee the rulebook implies.

- **Energy balances (B3.0).** For every ship every turn, `energyResidual(s, shipId) >= 0` and all mandatory costs (life support B3.3) are paid. Golden anchor: the A5 Turn-1 allocations sum exactly to capacity — CA `1+1+6+8+2+12+4 = 34`, D7 `1+1+7+8+2+6+2+12 = 39`. The property generator `arbLegalTurn` may never produce an over-allocation that the engine accepts; if it does, the test fails (caught by `C2-energy-allocation-power.md`'s validator).
- **Damage conservation (D3/D4).** For each `DamageAllocated`, `damageLedger` must satisfy `generalReinf + specificReinf + shield + internal === raw` and `internal <= raw`. Golden anchor: A5 Turn-2 CA volley `raw = 48` → `internal = 11` with `2` warp boxes destroyed; the ledger must close to 48 with no point created or lost. Absorption order is asserted (reinforcement consumed before shield, shield before internal).
- **Determinism (B2/A3).** `replayGoldenGame` run twice yields identical `stateHash` and `eventLogHash`; the same golden run across two PM2 workers matches. Any `Math.random`, `Date.now`, or insertion-ordered `Map` iteration in a reducer surfaces here.
- **Gapless total order (A3).** Across any generated command stream, emitted `seq` is 1-based, contiguous, monotonic; the property fails on any gap/duplicate.
- **Fog integrity (B2.4/E4).** In `sealedRevealHarness`, before `OrdersRevealed` no side's `fogFilteredStreams` contains another side's sealed payload; a tampered plaintext fails hash verification at reveal (no `OrdersRevealed` emitted). This is asserted for both energy allocation and segment-6D fire.
- **Crippled is monotone-on-damage (S2.4).** After each `DamageAllocated`, the derived `crippled` flag is recomputed from all five conditions; absent repair, once true it stays true within a turn. Tests cover each condition independently (warp ≤10%, interior ≥50%, excess-damage, all control gone, all weapons gone).
- **Rounding (A3.5).** Unit tests assert ≤0.499 drops and ≥0.500 rounds up, with the Commander's-Option fractional-retention exception (S2.23 shuttle fractions also retained).
- **Victory pipeline (S2.20–S2.3).** A scenario-outcome test feeds a finished `GameState` and asserts step A (gated on no disengage by Turn 2), step B, step C greatest-tier-per-ship percentages on GABPV, the ratio, the `<1` clamp, and the level-table band.
- **GM override is replay-stable.** Any `ApplyGmOverride` in a golden script must produce a recorded `GmOverrideApplied` event and leave the replay byte-identical; a test confirms the override both suppresses a legality block and substitutes a resolver value without breaking `rngCursor` parity.

## UI Contract

E5 owns no screen and no wireframe; it *exercises the others'*. The Playwright layer needs two things from the client and server. First, a **stable selector contract**: every interactive control the E2E drives carries a `data-testid` (e.g. `eaf-line-movement`, `map-weapon-arc-PH1`, `hud-lock-waiting`, `ssd-shield-1`), so tests bind to intent, not layout. Second, a **deterministic test mode**: a gated server endpoint `POST /api/test/games` that boots a game from a `GoldenGame` with `E1` in forced-dice mode and a frozen clock, returning a join token per side. The happy-path E2E drives: login → join the SG1.0 game → fill the Energy Allocation Form (`D3-energy-allocation-ui.md`) → submit sealed orders and observe the HUD lock gate (`D6-impulse-hud.md`) → advance to the Impulse of Decision (#25) → plot movement (`D4-movement-plotting-ui.md`) → declare fire on the map fire layer (fire panel referenced by `C4-direct-fire-combat.md`) → assert the SSD viewer (`D2-ssd-viewer-ui.md`) shows the expected shield/box state matching the A5 golden checkpoint. Visual-regression snapshots are taken against the D-doc wireframes under `docs/spec/wireframes/` (e.g. `wireframes/D2-ssd-viewer.svg`) in [v2].

## Dependencies

- `A3-data-architecture-event-store.md` — `foldEvents`/`replay`/`stateHash` reused by the golden harness; the replay-equivalence test lives here too.
- `B2-rules-engine-core.md` — `validateCommand`/`resolveSimultaneous` are the system under test; module-version pinning makes baselines reproducible.
- `B3-game-catalog-ssd-model.md` — `generateSsdFixtures` reads `ssdTemplates`; fixtures pin `templateVersion`.
- `E1-dice-rng-service.md` — forced-dice mode is the single injection point for golden determinism.
- `E2-game-log-replay.md` — shares the replay path; E5 supplies its golden corpus as regression input.
- `E4-security-integrity.md` — fog-of-war and sealed-hash guarantees verified by the sealed-reveal harness.
- `A4-realtime-sync-layer.md` — the commit-lock-reveal choreography the sealed and E2E tests drive.
- Subsystems under test: `C1-sequence-of-play-engine.md`, `C2-energy-allocation-power.md`, `C3-movement-engine.md`, `C4-direct-fire-combat.md`, `C5-seeking-weapons.md`, `C7-damage-criticals-repair.md`, `C8-ew-sensors-cloak.md`, `C9-terrain-hazards.md`.
- UI under E2E: `D2-ssd-viewer-ui.md`, `D3-energy-allocation-ui.md`, `D4-movement-plotting-ui.md`, `D6-impulse-hud.md`.
- Tooling: Vitest/Jest (unit/integration), fast-check (property), Playwright (E2E), `mongodb-memory-server` for isolated Mongo, and the Docker test harness from `A1-deployment-infrastructure.md`.

## Edge Cases & Open Questions

- **SG1.0 full setup is not in the A/S source files.** A5.0 narrates a playthrough from range 44; the canonical starting hexes, exact map size, and victory text live in the SG scenario block. The `sample-A5` fixture must be locked against that block before its checkpoints are authoritative; until then, range-relative checkpoints (closure, Impulse-of-Decision geometry) are asserted, absolute hexes flagged provisional.
- **Section-E damage tables.** The A5 die-roll → damage numbers (e.g. 4 phaser-1 rolls `2,3,4,6` → 8 dmg) imply the phaser/photon/disruptor charts; those grids must be imported into `weaponCharts` (`C4`) before the golden damage totals can assert as equalities rather than ranges.
- **32-impulse movement chart.** Movement-waypoint checkpoints (e.g. D7 2708→2608 on impulse #11) require the precise speed→moving-impulse chart (Annex/Impulse Chart) the engine pins; the fixture cites the chart version.
- **Floating-point EV.** Assisted-targeting `expectedDamage` is real-valued; UI assertions use tolerance, but core game-state checkpoints are integers with `tolerance: 0`.
- **Override RNG parity (open in B2).** Whether a value-substitution override consumes-then-discards a die draw affects `rngCursor`; the golden override test must encode whichever rule B2/E2 finalize.
- **E2E flakiness.** Lockstep waits must key off the broadcast `headSeq`/lock bitmap, never fixed timeouts; the page objects expose `waitForHeadSeq(n)`.

## Testing

Verifying the verifier. (1) **Mutation testing** (Stryker, [v2]): deliberately flip a reducer constant (e.g. drop reinforcement-before-shield order) and assert the A5 golden and the damage-conservation property both fail — a green suite after a seeded mutation is itself a bug. (2) **Forced-dice fidelity:** a self-test confirms `forcedDice` dequeues A5's listed arrays in order and that the resulting `DiceRolled` events match, so a golden failure is attributable to engine logic, not the feed. (3) **Generator coverage:** `arbLegalTurn` must, over its run budget, reach overload allocations, battery discharge, and zero-movement turns (coverage assertions guard against a generator that only explores trivial states). (4) **Baseline drift:** CI compares each golden's `stateHash`/`eventLogHash` to `replayBaselines`; an intended engine change requires an explicit baseline re-bless commit, making silent rule changes impossible. (5) **Worked-example coverage map:** every numeric fact cited in the Rulebook References above maps to at least one checkpoint or unit test; a coverage report flags any cited rule number with no assertion.

## Phasing

- **[v1 AM-tournament]** — golden replay of the A5 duel (SG1.0) and the A4.1 phaser-only Cadet step; the core property suite (`energyBalances`, `damageConserved`, `seqGapless`, `foldDeterministic`, `noFogLeak`); the sealed-reveal integration harness; the SSD fixture generator from the tournament-legal roster; and one happy-path Playwright E2E (login → EA → sealed lock → impulse advance → fire → SSD assert). This is the minimum to certify a legal tournament duel end-to-end and to gate every CI build on replay equivalence.
- **[v2]** — the rest of the Cadet ladder (A4.2 heavy weapons, A4.3 seeking weapons/plasma); scenario-outcome tests for victory (S2.20–S2.3), crippled (S2.4), weapons-status setup (S4), and local-conditions/pirate generators (S5); visual regression against the D-doc wireframes; mutation testing in CI; and basic load/perf on the lockstep path. Deferred because they depend on v2 engine breadth (seeking weapons, terrain) and on the SG1.0 source being locked.
- **[v3 full Master]** — the full multi-empire scenario corpus, carrier/PF and fighter matchup goldens (`C6`), terrain-hazard integration (`C9`), and chaos/soak testing across long persistent games. Deferred until the full Master roster and rules modules exist to test against.
</content>
</invoke>
