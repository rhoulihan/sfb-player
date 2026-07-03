# D8 — Lobby, Scenario Setup & Session Management

## Purpose & Scope

This subsystem is the **front door** to a game: it lets a host create a game, pick and configure a scenario (forces/BPV, map size and topology, terrain/local conditions, victory conditions, scenario date, weapons status, and balancing), invite and seat commanders/players, drive every side to a legal and *ready* state, then commit that configuration into the authoritative event log so play can begin. After kickoff it owns the **session surface**: the async status board (whose turn it is, which sides have sealed their orders, who is online) and the resume flow that re-enters a paused or in-progress game. D8 is deliberately a *configuration-and-orchestration* layer: it validates force legality and setup completeness and then hands a deterministic batch of start-of-game events to the store; the per-turn mechanics belong to `C1-sequence-of-play-engine.md` and its siblings. Every pre-game choice here — empire, ship mix, options, where to deploy — is a **player decision**; D8 automates only the bookkeeping (BPV sums, budget/command-limit/option-cap checks, weapons-status and local-conditions dice, and placement of the initial order of battle). **PHASE: [v1 AM-tournament]** for the lobby, the fixed-force and patrol-buy paths, the readiness board, the async session board, and resume; advanced local-conditions, bidding, multi-commander seat planning, and a scenario-authoring UI are **[v2]/[v3]**.

## Rulebook References

D8 implements the **scenario-framework wrapper** (the S-series) around the per-turn loop, plus the pre-game setup steps:

- **(S1.0, S1.1, S1.2)** — standard scenario format (title/players/initial-setup fields) drives the `ScenarioTemplate` data model and the deployment editor.
- **(S1.41, S1.42)** — arrivals placed before the first Energy Allocation Phase; mid-turn entrants pay full-turn movement at their assumed prior-turn speed (S1.42 acceleration limit).
- **(S1.43, S8.135)** — fixed vs floating map and default 10-hex shift; the map decision is made **before** forces are bought.
- **(S2.1, S2.11–S2.14)** — Economic / Combat / GABPV families; force-buying uses **Combat** BPV.
- **(S2.20, S2.201, S2.202, S2.3)** — standard / modified / task-based victory configuration and the Levels-of-Victory ladder.
- **(S3.1, S3.2, S3.211, S3.223, S3.4)** — balancing: Commander's Options (cap 20% of Effective Adjusted Combat BPV; 30% for D% drone ships), scenario modifications, and bidding for a side.
- **(S4.1, S4.2, S4.25, S4.3)** — Weapons Armed Status WS-0..WS-III, the determination die roll + per-ship modifiers, and the pre-arm overload restriction; status constrains **only** the start state.
- **(S5.0–S5.4)** — local conditions / terrain generators (2d6 standard chart and the advanced nested charts), base-exclusion and relocation rules.
- **(S8.0, S8.11–S8.135, S8.17, S8.2)** — patrol-scenario force buy, scenario-date availability gating, ~3-ships/player guideline, and command-rating force-structure caps.
- **(SG1.0)** — "The Duel" supplies the canonical golden scenario template (see Testing).

## Domain Model

D8 does **not** redefine the `games` lifecycle document (owned by `A3-data-architecture-event-store.md`); it writes `games.status`/`games.scenarioRef` through A3's lifecycle API and owns two of its own collections: a versioned **`scenarioTemplates`** catalog and a mutable per-game **`gameSetups`** draft that holds all pre-commit configuration. Per-game *seats* are events owned by `A2-identity-roles-gating.md`; *ships* are instantiated by `B3-game-catalog-ssd-model.md`. The runtime composes a read-only **`StatusBoard`** from A3/A4 for the async board.

```ts
type GameId = string; type SideId = string; type AccountId = string;
type ScenarioRef = string;                         // 'SG1.0' | 'T-DUEL' | uuid
type EdgeCode = 'N'|'S'|'E'|'W';
type WeaponsStatus = 'WS0'|'WS1'|'WS2'|'WS3';      // S4.1
type GameStatus = 'forming'|'configuring'|'ready'|'active'|'paused'|'completed'|'aborted';
import type { ReferenceCode } from './B3-game-catalog-ssd-model';   // R0.1 join key
import type { GameClock } from './A3-data-architecture-event-store'; // {turn,phase,impulse,segment}

// ---------- SCENARIO CATALOG (static, versioned — collection 'scenarioTemplates') ----------
interface SideDef { sideId: SideId; name: string; empireCode?: string; allowedExitEdges?: EdgeCode[]; } // S1.2/S1.43
interface MapConfig {                              // S1.43 / S8.135
  size: { width: number; height: number } | 'standard';
  topology: 'fixed' | 'floating';
  floatingShiftHexes?: number;                     // default 10 (S1.43)
}
interface VictoryConfig {                          // S2.20 / S2.201 / S2.202 / S2.3
  mode: 'standard' | 'modified' | 'taskBased';
  useStepA: boolean;                               // BPV-difference to weaker force (S2.20A)
  useStepB: boolean;                               // Commander's-Option points to enemy (S2.20B)
  useStepC: boolean;                               // post-game damage scoring (S2.20C / S2.21)
  disengageForfeitTurn: number;                    // default 2: disengage by this turn forfeits step A
  levelTable: 'standard';                          // S2.3 ladder
  taskDescription?: string;                        // S2.202 GM-scored objective text (not rulebook prose)
}
interface ForceModel {                             // fixed OOB (tournament) vs patrol buy (S8.1)
  mode: 'fixed' | 'buy';
  budgetCombatBPV?: number;                        // per-side budget, Combat BPV (S8.11) when mode==='buy'
  fixedOOB?: Record<SideId, ForceEntry[]>;
  shipCountGuideline?: number;                     // ~3/player (S8.17)
}
interface ForceEntry { reference: ReferenceCode; refitConfig: ReferenceCode[]; options: OptionPurchase[]; }
interface OptionPurchase { item: string; cost: number; }      // S3.2, Annex #6 cost lookup
interface WeaponsStatusPolicy { mode: 'agree'|'roll'|'fixed'; fixed?: WeaponsStatus; }   // S4.2
interface BalancePolicy { allowBidding: boolean; allowCommandersOptions: boolean; defaultOptionCapPct: number; } // S3.2

interface ScenarioTemplate {
  scenarioRef: ScenarioRef; version: string;       // semver; frozen once published
  title: string; author?: string; era?: string;    // S*.0
  sides: SideDef[]; commandersPerSide: { min: number; max: number };  // S*.1
  defaultMap: MapConfig; defaultVictory: VictoryConfig; defaultDate: number; // S8.13 scenario year
  forceModel: ForceModel;
  weaponsStatusPolicy: WeaponsStatusPolicy;          // S4
  localConditionsPolicy: 'none'|'standard'|'advanced'|'fixed'; // S5
  fixedTerrain?: TerrainPlacement[];                 // when policy==='fixed'
  balance: BalancePolicy;                            // S3
  placementTemplates: UnitPlacementTemplate[];       // S*.2 default deploy / arrival areas
  specialRuleRefs: string[];                         // S*.4 rule numbers only
  phase: 'v1'|'v2'|'v3';
}
interface UnitPlacementTemplate {                    // S1.2 / S1.42
  slotId: string; sideId: SideId; suggestedReference?: ReferenceCode;
  startHex?: string; heading?: number; prevTurnSpeed?: number;  // S1.42 acceleration baseline
  arrivalArea?: { edge: EdgeCode } | { hexes: string[] };
  arrivalTurn?: number; arrivalImpulse?: number;     // reinforcement timing (S1.41)
}
interface TerrainPlacement { type: string; hex: string; radius?: number; meta?: Record<string, unknown>; } // S5
```

```ts
// ---------- MUTABLE LOBBY DRAFT (collection 'gameSetups', one per game) ----------
interface ScenarioConfig {                           // template defaults + host overrides
  map: MapConfig; victory: VictoryConfig; date: number;       // S8.13
  forceModel: ForceModel; weaponsStatus: WeaponsStatusPolicy;
  localConditions: 'none'|'standard'|'advanced'|'fixed';
  fixedTerrain?: TerrainPlacement[];
  balance: BalancePolicy; specialRuleRefs: string[];
}
interface SideSetup {
  sideId: SideId; commanderAccountIds: AccountId[];  // resolved from A2 GameMembership
  force: ForceEntry[]; bidPoints?: number;           // S3.4
  ready: boolean; readyAt?: Date;
  validation?: ForceValidationResult;                // last computed legality (cached, advisory)
}
interface GameSetup {
  _id: GameId; gameId: GameId; hostAccountId: AccountId; status: GameStatus;
  scenarioRef?: ScenarioRef; scenarioVersion?: string;
  scenarioConfig?: ScenarioConfig; sides: SideSetup[];
  invitationIds: string[];                           // A2 Invitation refs
  createdAt: Date; updatedAt: Date; committedAt?: Date;
}

// ---------- COMPOSED READ-MODEL (not persisted; for the async status board) ----------
interface SideStatus { sideId: SideId; ready: boolean; commanders: AccountId[]; hasSealedCurrent: boolean; }
interface StatusBoard {
  gameId: GameId; status: GameStatus; clock?: GameClock;            // A3 fold / C1
  sides: SideStatus[];
  currentDecisionPoint?: { decisionPointId: string; kind: string; awaiting: SideId[]; sealed: SideId[] }; // A4
  presence: { accountId: AccountId; sideId?: SideId; status: 'online'|'idle'|'away' }[];                   // A4
}

interface ForceValidationResult {                    // pure output of validateForce
  legal: boolean; combatBPV: number; budgetCombatBPV?: number; overBudget: number; // S2.1 / S8.11
  commandLimit: { ok: boolean; flagshipRef?: ReferenceCode; limit: number; count: number }; // S8.2
  optionCaps: { shipRef: ReferenceCode; capBPV: number; spentBPV: number; ok: boolean }[];   // S3.211/S3.223
  dateIssues: { ref: ReferenceCode; reason: string }[];   // S8.13 availability / refit-year
  warnings: string[];
}
```

```ts
// Mongoose sketches (collections owned by D8)
const ScenarioTemplateSchema = new Schema({
  scenarioRef: { type: String, index: true }, version: { type: String, index: true },
  title: String, author: String, era: String,
  sides: [Schema.Types.Mixed], commandersPerSide: Schema.Types.Mixed,
  defaultMap: Schema.Types.Mixed, defaultVictory: Schema.Types.Mixed, defaultDate: Number,
  forceModel: Schema.Types.Mixed, weaponsStatusPolicy: Schema.Types.Mixed,
  localConditionsPolicy: String, fixedTerrain: [Schema.Types.Mixed],
  balance: Schema.Types.Mixed, placementTemplates: [Schema.Types.Mixed],
  specialRuleRefs: [String], phase: String,
  status: { type: String, enum: ['draft','published','deprecated'], default: 'draft' },
}, { timestamps: true });
ScenarioTemplateSchema.index({ scenarioRef: 1, version: 1 }, { unique: true });

const GameSetupSchema = new Schema({
  _id: String, gameId: { type: String, index: true, unique: true },
  hostAccountId: { type: String, index: true },
  status: { type: String, enum: ['forming','configuring','ready','active','paused','completed','aborted'], index: true },
  scenarioRef: String, scenarioVersion: String,
  scenarioConfig: Schema.Types.Mixed, sides: [Schema.Types.Mixed],
  invitationIds: [String], committedAt: Date,
}, { timestamps: true, _id: false });
```

## Events & Commands

Pre-commit churn (force edits, ready toggles) mutates `gameSetups` and is **not** appended to `gameEvents` — it is draft state, not replayable history. Seat events (`SeatAssigned`, owned by A2) *are* appended as they happen during the lobby. At **commit** the host's `StartGame` runs a deterministic *setup builder* that appends the canonical, replayable start-of-game batch (scenario config → ships → status/terrain dice → placements → started), so a replay reconstructs the exact opening position. All randomness flows through `E1-dice-rng-service.md` and is persisted as `DiceRolled` so the build is reproducible.

```ts
// Commands (PascalCase imperative)
interface CreateGame      { scenarioRef?: ScenarioRef; title: string; visibility: 'private'|'unlisted'; }
interface SelectScenario  { gameId: GameId; scenarioRef: ScenarioRef; scenarioVersion: string; }
interface ConfigureScenario { gameId: GameId; patch: Partial<ScenarioConfig>; }   // map/victory/date/WS/terrain/balance
interface ProposeForce    { gameId: GameId; sideId: SideId; force: ForceEntry[]; bidPoints?: number; }  // S8.11 / S3.4
interface SetSideReady    { gameId: GameId; sideId: SideId; ready: boolean; }
interface StartGame       { gameId: GameId; }                                     // host commits setup
interface PauseGame       { gameId: GameId; reason?: string; }
interface ResumeGame      { gameId: GameId; }
interface AbortGame       { gameId: GameId; reason: string; }
// seating/invites delegate to A2: SendInvitation, AcceptInvitation, AssignSeat, RevokeSeat

// Events appended to gameEvents (past tense). Seq 1 begins at the first seat/lifecycle event.
interface GameCreated         { gameId: GameId; hostAccountId: AccountId; scenarioRef?: ScenarioRef; }
interface ScenarioConfigured  { scenarioRef: ScenarioRef; scenarioVersion: string; config: ScenarioConfig; } // canonical
interface LocalConditionRolled{ placements: TerrainPlacement[]; diceRef: string; }            // S5, builds on DiceRolled
interface WeaponsStatusAssigned { perShip: { shipInstanceId: string; status: WeaponsStatus }[]; diceRef?: string; } // S4
interface UnitPlaced          { shipInstanceId: string; sideId: SideId; hex: string; heading: number;
                                prevTurnSpeed: number; weaponsStatus: WeaponsStatus;
                                arrival?: { turn: number; impulse: number; edge: EdgeCode }; }  // S1.2/S1.41/S1.42
interface GameStarted         { startedBy: AccountId; clock: GameClock; }
interface GamePaused          { by: AccountId; reason?: string; }
interface GameResumed         { by: AccountId; }
interface GameAborted         { by: AccountId; reason: string; }
interface GameCompleted       { result: { perSideScore: Record<SideId, number>; levels: Record<SideId, string> }; } // S2.3
```

`ShipInstantiated` (B3) and `SeatAssigned` (A2) are emitted **inside** the commit batch but their types are owned by those docs; D8 orchestrates the ordering. A host's exceptional override of any setup validation (force over budget, a refit past its year, forcing a side ready) is recorded as the canonical `GmOverrideApplied { target, value, reason }`.

## Engine / API

Validators are **pure** (given the catalog as an injected port); orchestration is impure and isolated.

```ts
// --- Pure validators / math ---
function computeCombatBPV(force: ForceEntry[], cat: CatalogPort): number;                 // S2.1 Combat BPV
function checkCommandLimit(force: ForceEntry[], cat: CatalogPort): ForceValidationResult['commandLimit']; // S8.21
function checkOptionCap(entry: ForceEntry, cat: CatalogPort, capPct: number): ForceValidationResult['optionCaps'][number]; // S3.211
function checkDateAvailability(force: ForceEntry[], date: number, cat: CatalogPort): ForceValidationResult['dateIssues']; // S8.13
function validateForce(cfg: ScenarioConfig, side: SideSetup, cat: CatalogPort): ForceValidationResult;
function validateScenarioConfig(cfg: ScenarioConfig): { ok: boolean; errors: string[] };  // map/victory/date sanity
function computeReadiness(setup: GameSetup, cat: CatalogPort): { allReady: boolean; bySide: Record<SideId, ForceValidationResult> };

// --- Deterministic setup builder (pure given a seeded DicePort) ---
function rollWeaponsStatus(policy: WeaponsStatusPolicy, ship: ForceEntry, mods: number, dice: DicePort): WeaponsStatus; // S4.2/S4.25
function rollLocalConditions(policy: ScenarioConfig['localConditions'], hasBase: boolean, dice: DicePort): TerrainPlacement[]; // S5.1/S5.32
function buildInitialEvents(setup: GameSetup, dice: DicePort, cat: CatalogPort): EventDraft[]; // ScenarioConfigured..GameStarted

// --- Impure orchestration (REST + socket entry points) ---
async function createGame(actor: AuthClaims, cmd: CreateGame): Promise<{ gameId: GameId }>;
async function selectScenario(actor: AuthClaims, cmd: SelectScenario): Promise<GameSetup>;
async function configureScenario(actor: AuthClaims, cmd: ConfigureScenario): Promise<GameSetup>;
async function proposeForce(actor: AuthClaims, cmd: ProposeForce): Promise<ForceValidationResult>;
async function setSideReady(actor: AuthClaims, cmd: SetSideReady): Promise<GameSetup>;
async function startGame(actor: AuthClaims, cmd: StartGame): Promise<{ headSeq: number }>;   // appends commit batch via A3
async function pauseGame(actor: AuthClaims, cmd: PauseGame): Promise<void>;
async function resumeGame(actor: AuthClaims, cmd: ResumeGame): Promise<{ resync: unknown }>; // A4 buildResync
async function abortGame(actor: AuthClaims, cmd: AbortGame): Promise<void>;

// --- Read models ---
async function getStatusBoard(gameId: GameId, actor: AuthClaims): Promise<StatusBoard>;       // composes A3+A4
async function listGamesForAccount(accountId: AccountId): Promise<GameSummary[]>;             // landing page groups
```

REST surface (gated portal, `helmet` + CSRF + rate-limited, mirroring A2): `POST /games`, `GET /games?status=`, `POST /games/:id/scenario`, `PATCH /games/:id/config`, `POST /games/:id/sides/:sideId/force`, `POST /games/:id/sides/:sideId/ready`, `POST /games/:id/start`, `POST /games/:id/pause|resume|abort`, `GET /games/:id/status-board`. Live status-board deltas arrive over the Socket.IO `presenceChanged`/`lockStateChanged`/`submissionWindowOpened` signals from `A4-realtime-sync-layer.md`; the REST endpoint is the cold-load/poll fallback for async play.

## Validation & Enforcement Rules

The server is the authoritative referee for setup exactly as it is in play:

- **Authorization.** Only the host (`gm`) may `SelectScenario`/`ConfigureScenario`/`StartGame`/`Pause`/`Abort`; a `commander` may `ProposeForce`/`SetSideReady` only for a side it seats; checks route through `assertCommandAuthz` in `A2-identity-roles-gating.md`.
- **Map-before-forces ordering (S8.135).** `ConfigureScenario` must fix map size and topology and the scenario `date` (S8.13) before a side's `ProposeForce` is accepted; force validation depends on date-gated availability and refit years.
- **Force legality (`validateForce`).** Buy-mode forces must satisfy `combatBPV ≤ budgetCombatBPV` (S8.11), the flagship command-rating cap (`flagship + rating` ships, with scout/base/fighter exemptions, S8.2), and per-ship Commander's-Option caps of 20% of Effective Adjusted Combat BPV (30% for D% drone ships, the extra 10% drones-only, S3.211/S3.223). Each option's cost is looked up from Annex #6 and recorded so victory step B can pay it to the enemy (S2.20B). Fixed-OOB scenarios skip budget/command checks (the OOB is authoritative) but still date-gate refits.
- **Weapons status (S4).** When `mode==='roll'`, the setup builder rolls one fleet die, applies cumulative per-ship +1/-1 modifiers clamped to [-2,+2] (S4.22–S4.24), and reads the S4.25 table (<3→WS0, 3–4→WS1, 5–6→WS2, 7+→WS3); a commander may voluntarily drop individual weapons to a *lower* status. Pre-arm overload energy is zeroed except the WS-III photon allowance of 2 free overload points/tube (S4.3). **Crucially, weapons status is written only into the `UnitPlaced`/`ShipInstantiated` opening state and never consulted by the in-turn validators** (`C2`/`C4`) — it shapes the start, not the rules.
- **Local conditions (S5).** When enabled the builder rolls the 2d6 chart (or the S5.4 nested charts) once, applies base-exclusion filtering (ignore results 2,3,5,8,9,11 when a base is present, S5.32), and emits fixed-hex `TerrainPlacement`s; ships set to specific hexes may relocate up to 6 hexes to avoid the feature (S5.33) — a player decision surfaced in the deploy editor.
- **Readiness gate.** `StartGame` is rejected unless `computeReadiness().allReady` is true: every side has a seated commander, a legal force, and `ready===true`, and the scenario config validates. Failures return a structured `ReadinessReport`; the host may override a specific failure via `GmOverrideApplied`.
- **Commit is atomic & deterministic.** `buildInitialEvents` produces the full batch and `startGame` appends it through A3's optimistic `appendEvents` in one transaction; a `ConcurrencyError` retries. The same `gameSetup` + seed always yields byte-identical events (golden-game parity, see Testing).
- **Lifecycle transitions.** `forming → configuring → ready → active → (paused ⇄ active) → completed|aborted`; illegal transitions (e.g. `ProposeForce` on an `active` game) are rejected. Pausing freezes the open submission window (A4) without resolving it; resuming re-arms it.

## UI Contract

The lobby/session UI is specified by **`wireframes/D8-lobby-scenario.svg`**; the client treats all legality/readiness state as advisory rendering only — the server re-validates every action. The wireframe defines four linked surfaces.

**1. My-Games landing (left nav + grouped list).** A header "Create Game" button plus pending-invitation chips (fed by A2 `Invitation`s). The list is grouped into *Your Turn* (active games awaiting this account's seal — driven by `StatusBoard.currentDecisionPoint.awaiting`), *Active*, *Paused / Resumable*, *In Lobby*, and *Completed*. Each row shows scenario title, side/empire badges, the `GameClock` (turn · impulse) for in-play games, and a primary action (Resume / Open Table / Configure). This is the resume entry point: selecting a paused/active game calls `resumeGame`, which fetches an A4 `buildResync` payload and routes either back into this Setup screen (not yet started) or into the live table (`D6-impulse-hud.md`).

**2. Scenario picker (modal/left rail).** On Create, a filterable catalog of `scenarioTemplates` (filters: era, player count, tournament-legal, phase) with a detail pane showing sides, default map, default victory, and force model. Selecting one calls `createGame`+`selectScenario` and opens the Setup screen. SG1.0 "The Duel" and the AM tournament duel are the v1 seeds.

**3. Scenario Setup screen (the primary configurator — center of the wireframe).** A status header (title, status pill, host, and a host-only **Start** button that is disabled, with a tooltip listing blockers, until readiness is green). Below, a three-column layout:

- **Scenario Config panel (left).** Map size + a fixed/floating segmented control with the floating shift-hex field (S1.43); scenario date stepper (S8.13) that re-filters the force builder; victory mode selector (standard / modified / task-based, S2.20/.201/.202) with the disengage-forfeit-turn field; weapons-status mode (agree / roll / fixed, S4.2); local-conditions mode (none / standard / advanced / fixed, S5); and a balance block toggling Commander's Options and bidding (S3) with the option-cap percent.
- **Sides panel (center, one card per side).** Side name/empire, a seat roster with invite-link/short-code generation and assign/reassign controls (delegated to A2; the "waiting for 1 player" row lives here), and the **Force Builder**. In buy mode the builder is a ship picker drawn from the `B3-game-catalog-ssd-model.md` catalog filtered by date/empire, each pick showing its Combat BPV and an expandable Commander's-Options sub-panel with a live cap meter (20%/30%, S3.211) and refit toggles (B3). A running **budget meter** (combat BPV vs `budgetCombatBPV`) and a **command-limit indicator** (count vs flagship rating, S8.2) update on every `proposeForce` round-trip. In fixed mode the OOB renders read-only. Hovering a ship can preview its SSD via `D2-ssd-viewer-ui.md`.
- **Readiness rail (right).** Per-side legality badges (budget ✓, command ✓, options ✓, date ✓) from `ForceValidationResult`, a Ready toggle per side, and an "X of N sides ready" summary that drives the Start button.

A **Deploy sub-tab** (shown for scenarios with editable placement) renders the map with `UnitPlacementTemplate` slots, letting a commander set start hex/heading/prev-turn speed within S1.42 limits and choose arrival edge/turn for reinforcements (S1.41), plus the S5.33 relocate-to-avoid-terrain affordance.

**4. Async Status Board (right rail in-play; standalone for paused games).** Whose turn (`GameClock`), a per-side seal indicator ("Side A: sealed ✓ / Side B: waiting", from A4 barrier state), presence dots (online/idle/away), and pause/resume + "Open Table" controls. This same component is embedded as a strip inside the live HUD so a commander always sees who they are waiting on.

GM-only setup overrides (force-legality bypass, force-ready, manual terrain placement, reopen setup) surface through the host console in `D9-gm-spectator-console.md` (wireframe `wireframes/D9-gm-console.svg`).

## Dependencies

- `A1-deployment-infrastructure.md` — gated portal host, Mongo/Redis, nginx WebSocket upgrade for live status deltas.
- `A2-identity-roles-gating.md` — `SendInvitation`/`AcceptInvitation`/`AssignSeat`/`RevokeSeat`, `GameMembership`, and `assertCommandAuthz` for every D8 command.
- `A3-data-architecture-event-store.md` — the `games` lifecycle doc and `appendEvents`/`loadState`/snapshots; D8's commit batch and lifecycle events are appended here.
- `A4-realtime-sync-layer.md` — presence, submission-window barrier, and `buildResync` that powers the status board and resume.
- `B1-rules-content-api.md` / `B3-game-catalog-ssd-model.md` — the ship catalog the force builder reads; `InstantiateShip`/`ShipInstantiated` in the commit batch; BPV/refit/date data.
- `B2-rules-engine-core.md` — re-validates the committed setup before/after append.
- `C1-sequence-of-play-engine.md` — receives control at `GameStarted`; runs end-of-turn destroyed/forced-to-leave and disengage-by-turn-2 checks that feed `GameCompleted`.
- `E1-dice-rng-service.md` — seeded rolls for weapons status (S4.2) and local conditions (S5).
- `E2-game-log-replay.md` — resume/replay of paused games. `E3-notifications.md` — invitation + your-turn/async alerts. `E5-testing-strategy.md` — golden scenarios. `E6-roadmap-phasing.md` — sequencing.
- `D2-ssd-viewer-ui.md`, `D6-impulse-hud.md`, `D9-gm-spectator-console.md` — SSD preview, live table handoff, and GM overrides.

## Edge Cases & Open Questions

- **Reinforcement BPV timing (S2.20A).** Victory step A counts a reinforcing unit's Combat BPV only once it actually arrives; the commit batch records `arrivalTurn`/`arrivalImpulse`, and the scoring routine must defer that BPV — needs a defined hook with `C1`'s arrival handler.
- **Bidding flow (S3.4) [v2].** Order of operations (one player designs+offers, the other picks; low bidder buys with bid points) needs a turn-based lobby sub-protocol; v1 ships fixed/buy only.
- **Concurrent force edits.** Two commanders of one side editing `force` simultaneously — last-write-wins on `gameSetups` with an `updatedAt` precondition, or a per-side edit lock; v1 assumes one commander/side (T0.0 duel).
- **Re-seat mid-game.** A revoked seat's unrevealed sealed order should void (A2 open question); D8 surfaces the GM notice on the status board.
- **Host abandonment.** If the host disconnects pre-start, ownership/GM handoff policy is open; proposal: any seated commander may claim host after a grace timer, recorded via `GmOverrideApplied`.
- **SG1.0 source data.** The exact Duel placement (start hexes, map size, victory text) lives in the SG scenario block, not the S-series; it must be ingested into a `ScenarioTemplate` before it can serve as the golden fixture (see Testing).
- **Floating-map shift agreement (S1.43).** The shift distance is "10 or mutually agreed"; v1 hard-codes 10 with a host override field.

## Testing

- **Force-validator truth tables.** Assert over-budget rejection (S8.11); command-limit enforcement (flagship rating 9 → 10 ships max, with a free scout not counting, S8.2/S8.25); option caps (a standard ship capped at 20% EACBPV, a D% drone ship at 30% with the extra 10% drones-only, S3.211/S3.223); and date gating reusing the B3 fixture (Fed DN AWR refit excluded at year 169, included at 171, BPV +2).
- **Weapons-status determination.** Feed a fixed die + modifier set and assert the S4.25 banding; assert overload pre-arm is zeroed except the WS-III 2-pt/tube photon allowance (S4.3).
- **Local-conditions roll.** With a base present, assert results 2/3/5/8/9/11 are filtered (S5.32) and a placed terrain feature lands on its fixed hex.
- **Commit determinism.** Same `gameSetup` + RNG seed → byte-identical `buildInitialEvents` output; replaying the batch through A3 reproduces the opening state (lockstep parity with `E2`).
- **SG1.0 golden start.** Load the Duel template, commit, and assert the resulting `UnitPlaced` events reproduce the A5.0 opening (CA vs D7 at range 44; power budgets 34/39; batteries full) — the canonical fixture `E5-testing-strategy.md` drives, and the same opening seeds the C1–C7 worked-game tests.
- **Readiness gate.** A side with an illegal force or no seated commander blocks `StartGame`; a `GmOverrideApplied` clears exactly that blocker.
- **Status board / resume.** Two sides, one seals → board shows the other as `awaiting`; pausing then `resumeGame` restores `GameClock` and the open window via A4 `buildResync`.

## Phasing

- **[v1 AM-tournament]** — create/join; the scenario picker with the SG1.0 and AM-tournament duel templates; fixed-OOB **and** patrol-buy force models with full legality (budget, command limits, option caps, date gating); map size + fixed/floating; standard & modified victory config; weapons-status agree/roll/fixed with the S4.25 table and overload restriction; standard local conditions (S5.1) with base exclusion; the readiness board; the async status board (whose turn / who sealed / presence); pause/resume and resume-from-landing. This is the minimum to stand up and run a refereed two-side tournament game end-to-end.
- **[v2]** — advanced local conditions (S5.4 nested charts) and the pirate sub-mechanic; bidding (S3.4) and richer scenario modifications (S3.1); multi-commander-per-side seat planning with per-ship assignment; a deploy editor for arbitrary placement/arrival scheduling; spectator lobby seats; task-based victory scoring tools (S2.202).
- **[v3 full Master]** — a scenario-authoring UI over the full S1.0 template (OOB variations S*.6, balance notes S*.7), the complete Master scenario library, many-sided setup, monster/terrain-heavy and campaign (F&E) linkage, and league/tournament bracket integration.
