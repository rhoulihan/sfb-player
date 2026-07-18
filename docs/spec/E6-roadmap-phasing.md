# E6 — Roadmap & Phasing

## Purpose & Scope

This document is the **authoritative phase plan and capability-gating subsystem** for SFB Player. It does two jobs. First, as governance prose, it enumerates exactly what ships in **v1 (AM-tournament)**, **v2**, and **v3 (full Master Rulebook)** — the subsystems, weapons, empires/ships, and map/terrain each phase delivers — and fixes the milestone sequence, dependency order, and top program risks. Second, as a real subsystem, it specifies the **Capability Registry** and **per-game capability profile** that turn "phase" from a planning word into an enforced runtime fact: every game pins the exact capability set it was created under, so the authoritative referee (`B2-rules-engine-core.md`) only ever validates against content the platform actually implements, and replays (`E2-game-log-replay.md`) stay deterministic even after the platform is promoted to a later phase. This doc is the single place where the `PHASE:` tags scattered across `A1`–`A4`, `B1`–`B3`, `C1`–`C10`, and the `D`/`E` docs are reconciled into one consistent, machine-checkable graph. Where sibling docs disagree (see §9), E6 is the tie-breaker.

**PHASE:** The Capability Registry, dependency-closure resolver, per-game profile pinning, and the v1 gate are **[v1 AM-tournament]**. Content-pack management UI, ranked/casual flagging, and per-game GM content annotations are **[v2]**. The full Master content graph plus errata/edition versioning (joined to `B1-rules-content-api.md`) is **[v3 full Master]**.

## Rulebook References

E6 implements no game rule; it indexes the **rule sections each phase covers**, so the registry's `rulebookRefs` are auditable against the book:

- **(A2.0), (B2.0)** general course of play / sequence of play — phase-invariant; v1 (`C1-sequence-of-play-engine.md`).
- **(C1.0–C8.0)** core movement — v1; **(C10–C12)** erratic/nimble/mid-turn speed change — v2 (`C3-movement-engine.md`).
- **(D3, D4, D6, D7.2–D7.8, D13, D17.3–.5)** shields/DAC/fire-control/boarding/AEGIS/Tac-Intel — v1; **(D17.6–.8, D20)** deception & hidden deployment — v3.
- **(E2, E3, E4, E5, E7, E10)** phaser/disruptor/photon/anti-drone/fusion/hellbore — v1; **(E8, E9, E11)** mauler/tractor-repulsor/PPD — v2; **(E12, E13, E16, E17, E18)** web-caster/snare/shield-cracker/particle-cannon/rail-gun — v3.
- **(F1–F4, FD2/FD drones I–VI, FP plasma R/S/G/F/D)** seeking weapons — v1; **(FD5–FD17, FP11–FP14)** advanced munitions — v2; **(F1.3 type VII–XII, plasma L/M)** — v3 (`C5-seeking-weapons.md`).
- **(G13)** cloak, **(G23)** ESG, **(G24)** offensive EW/scouts — v2; **(G10)** web — v2 (`C8-ew-sensors-cloak.md`, `C10-mines-boarding-misc.md`).
- **(J)** fighters/shuttles, **(K)** PFs — admin/suicide shuttles + wild weasel v1, fighters/PFs v2, dogfight/bombers v3 (`C6-carriers-shuttles-pf.md`).
- **(M)** mines — transporter bombs v1, full mine warfare v2, PA/trans-captor v3 (`C10-mines-boarding-misc.md`).
- **(P2 core, P3, P8, P17)** planets/asteroids/orbits/tournament barrier — v1; **(P4–P16 remainder)** — v2/v3 (`C9-terrain-hazards.md`).
- **(R0–R16)** ship section by empire; **(S2.1)** BPV; **(X)** advanced technology; **(Y)** early years; **(Annex #3/#4)** master ship & fighter charts (`B3-game-catalog-ssd-model.md`).

## Domain Model

```ts
type Phase = 'v1' | 'v2' | 'v3';
type CapabilityId = string;          // dotted: 'weapon.photon', 'empire.R2', 'terrain.asteroid', 'subsystem.carriers'
type CapStatus = 'planned' | 'in-progress' | 'shipped' | 'experimental' | 'deprecated';
type CapCategory = 'subsystem' | 'weapon' | 'empire' | 'ship' | 'terrain' | 'map' | 'maneuver' | 'infra';

/** One implementable capability. The registry is the closure-checked graph the whole phase plan reduces to. */
interface CapabilityDescriptor {
  id: CapabilityId;
  category: CapCategory;
  phase: Phase;                       // the phase this capability is *targeted* for
  status: CapStatus;
  dependsOn: CapabilityId[];          // hard prerequisites (must be in the enabled closure)
  specDoc: string;                    // owning sibling doc, e.g. 'C4-direct-fire-combat.md'
  rulebookRefs: string[];            // e.g. ['E4.12','E4.4','E4.3']
  flagDefault: boolean;              // platform default when its phase is active
  ranked: boolean;                   // may appear in a ranked/ladder game (false ⇒ casual-only)
}

/** A shippable bundle of capabilities (an empire, a weapon family, a terrain set, a milestone slice). */
interface ContentPack {
  id: string;                         // 'pack.empire.federation', 'pack.terrain.tournament'
  title: string;
  phase: Phase;
  capabilities: CapabilityId[];
  milestoneId: string | null;
}

/** Resolved, immutable ruleset a single game was created under. Pinned at first event; protects replays. */
interface GameCapabilityProfile {
  gameId: Uuid;
  basePhase: Phase;                   // platform phase at creation
  enabled: CapabilityId[];            // dependency-closed, sorted
  experimental: CapabilityId[];       // GM-enabled beyond basePhase ⇒ game is non-ranked
  ranked: boolean;
  pinnedAt: ISODate;
  pinnedBy: Uuid;                     // gm/admin actor
}

/** Program milestone; the DAG of these defines build order. */
interface Milestone {
  id: string;                         // 'M1.engine-core', 'M3.tournament-roster'
  phase: Phase;
  title: string;
  dependsOn: string[];               // milestone ids
  delivers: CapabilityId[];
  exitCriteria: string[];            // testable gates (cite E5 suites)
}
```

```ts
// Mongoose sketches (collections owned by E6)
const CapabilitySchema = new Schema<CapabilityDescriptor>({
  _id: { type: String },             // = CapabilityId
  category: { type: String, index: true },
  phase: { type: String, index: true },
  status: { type: String, default: 'planned' },
  dependsOn: { type: [String], default: [] },
  specDoc: String,
  rulebookRefs: [String],
  flagDefault: { type: Boolean, default: false },
  ranked: { type: Boolean, default: true },
}, { timestamps: true });            // collection: 'capabilities'

const GameProfileSchema = new Schema<GameCapabilityProfile>({
  gameId: { type: String, unique: true, index: true },
  basePhase: String,
  enabled: [String],
  experimental: { type: [String], default: [] },
  ranked: { type: Boolean, default: true },
  pinnedAt: Date,
  pinnedBy: String,
}, { timestamps: true });            // collection: 'gameCapabilityProfiles'
```

The platform's current phase and feature-flag overrides live in a single `platformConfig` singleton (`{ activePhase: Phase; flagOverrides: Record<CapabilityId, boolean> }`), audited through the events below rather than mutated silently.

## Events & Commands

Capability changes are first-class, audited facts, written to the admin audit stream (and, for per-game pinning, to that game's `gameEvents` log so the profile is part of the replay).

```ts
// COMMANDS (PascalCase imperative)
interface PromotePhase        { type: 'PromotePhase'; to: Phase; reason: string; }
interface ToggleFeatureFlag   { type: 'ToggleFeatureFlag'; capId: CapabilityId; enabled: boolean; reason: string; }
interface EnableContentPack   { type: 'EnableContentPack'; packId: string; }
interface SetGameCapabilityProfile { type: 'SetGameCapabilityProfile'; gameId: Uuid; requested: CapabilityId[]; allowExperimental?: boolean; }

// EVENTS (past-tense)
interface PhasePromoted       { type: 'PhasePromoted'; from: Phase; to: Phase; actor: Actor; at: ISODate; reason: string; }
interface FeatureFlagToggled  { type: 'FeatureFlagToggled'; capId: CapabilityId; enabled: boolean; actor: Actor; reason: string; }
interface ContentPackEnabled  { type: 'ContentPackEnabled'; packId: string; capabilities: CapabilityId[]; actor: Actor; }
interface GameCapabilityProfileSet { type: 'GameCapabilityProfileSet'; gameId: Uuid; profile: GameCapabilityProfile; }
interface CapabilityGateRejected   { type: 'CapabilityGateRejected'; gameId: Uuid | null; missing: CapabilityId[]; context: string; }
// GmOverrideApplied (A3/A5) is reused to enable an experimental capability inside one game (sets non-ranked).
```

`GameCapabilityProfileSet` is emitted exactly once per game, before any mechanics event; the reducer treats a later attempt as illegal (see §6). `CapabilityGateRejected` is informational telemetry for the lobby and analytics, not a state mutation.

## Engine / API

Pure resolvers (no I/O) so they unit-test trivially and run identically on client preview and server enforcement:

```ts
// dependency closure — expand a requested set to include all hard prerequisites
function capabilityClosure(ids: CapabilityId[], reg: Map<CapabilityId, CapabilityDescriptor>): Set<CapabilityId>;

// what is live on the platform right now (phase + flag overrides), closed over dependencies
function resolveActiveCapabilities(cfg: PlatformConfig, reg: Map<CapabilityId, CapabilityDescriptor>): Set<CapabilityId>;

// validate a scenario/force against a profile; returns the missing capability ids (empty ⇒ legal)
interface CapabilityCheck { ok: boolean; missing: CapabilityId[]; nonRanked: CapabilityId[]; }
function validateScenarioCapabilities(scenario: ScenarioDef, profile: GameCapabilityProfile,
                                      reg: Map<CapabilityId, CapabilityDescriptor>): CapabilityCheck;

// gate one SSD: every weapon mount, special system, and arc on the template maps to a CapabilityId
function gateContent(tpl: ShipTemplate, profile: GameCapabilityProfile): { ok: boolean; missing: CapabilityId[] };

// pin a game's profile (called by game-create); throws CapabilityGateRejected on illegal request
function pinGameProfile(gameId: Uuid, requested: CapabilityId[], actor: Actor, cfg: PlatformConfig): GameCapabilityProfile;

// build order: topological sort of milestones; throws on cycles
function topoSortMilestones(ms: Milestone[]): Milestone[];
```

`gateContent` is the workhorse: `B3-game-catalog-ssd-model.md` annotates every `WeaponMount`, special-system box, and non-standard arc on a `ShipTemplate` with the `CapabilityId` it requires, so adding an empire is data, not code. The lobby (`D8-lobby-scenario-ui.md`) calls `validateScenarioCapabilities` for instant feedback; the server re-runs it authoritatively at game create.

## Validation & Enforcement Rules

1. **Profile is immutable post-pin.** Once `GameCapabilityProfileSet` is in a game's log, the reducer rejects any further profile command for that game. This guarantees a v1 game stays a v1 game forever — fairness and replay determinism both depend on it.
2. **Closed-set enforcement.** A game may only emit mechanics events whose required `CapabilityId` is in `profile.enabled ∪ profile.experimental`. `B2-rules-engine-core.md` resolves the required capability for each command and rejects out-of-profile actions before validation proceeds.
3. **Dependency closure must hold.** `pinGameProfile` rejects a request whose closure references a `planned`/`in-progress` (not `shipped`) capability unless `allowExperimental` and the actor is gm/admin.
4. **Experimental ⇒ non-ranked.** Any GmOverrideApplied that enables an out-of-phase capability flips `ranked=false` and records the override (`{target, value, reason}`); ladder standings (`E3`) ignore non-ranked games.
5. **Phase promotion never downgrades.** `PromotePhase` is admin-only and only *adds* capabilities to the active set; existing games are untouched (their pinned profile insulates them). There is no auto-demotion of a deprecated capability inside a live game.
6. **GM override scope.** A host can enable experimental content *only* in their own game; only `admin` can `PromotePhase` or `ToggleFeatureFlag` platform-wide.

## UI Contract

E6 is not a `D`-doc and owns no battle screen, but it supplies three contracts to UI surfaces (no new wireframe; it feeds existing ones):

- **Lobby (`D8-lobby-scenario-ui.md`):** a "tournament-legal (v1)" filter, per-empire/ship **capability badges**, and locked content rendered greyed with a tooltip naming the gating phase and owning spec doc. Force-builder calls `validateScenarioCapabilities` live and shows `missing` inline.
- **Admin Phase Console (under `A2-identity-roles-gating.md` admin):** read the capability graph (status/phase/owner), toggle flags, run `PromotePhase`, and view the milestone DAG as a burndown. Every action issues an audited command from §4.
- **GM/Spectator console (`D9-gm-spectator-console.md`):** a per-game panel showing the pinned profile, any experimental overrides, and the resulting ranked/non-ranked badge.

## Dependencies

E6 sits above the entire stack and indexes it. It consumes phase declarations from and feeds the gate back into: `A1-deployment-infrastructure.md` (deploy targets per milestone), `A2-identity-roles-gating.md` (admin/gm authority for promotion/override), `A3-data-architecture-event-store.md` (audit/event envelope, `Actor`, `GmOverrideApplied`), `A4-realtime-sync-layer.md` (which sync features per phase), `B1-rules-content-api.md` (rule-text coverage per phase; v3 errata/edition versioning), `B2-rules-engine-core.md` (capability resolution at command time), `B3-game-catalog-ssd-model.md` (per-template `CapabilityId` annotations), all of `C1`–`C10` (each contributes its `PHASE` tags), the `D`-series UI docs, `E2-game-log-replay.md` (profile-pinned deterministic replay), `E4-security-integrity.md` (tamper-proof audit of promotion/override), and `E5-testing-strategy.md` (the suites cited as milestone exit criteria).

## Edge Cases & Open Questions

- **Cross-doc roster inconsistency (must resolve).** `C4-direct-fire-combat.md` cites a **FED/KLI/KZI/Lyran/Hydran** v1 matchup rationale, but Lyran's **ESG (G23)** is unspecced and Hydran's tournament cruiser fields **Stinger fighters**, which `C6-carriers-shuttles-pf.md` defers to **v2**. E6 is authoritative: **Lyran and Hydran move to early v2**; the v1 launch roster is FED/KLI/KZI/GORN (see §11). Logged as an open question for the `C4`/`C6` owners to reconcile their `PHASE` tags.
- **Mixed-phase units.** A ship's hull and shields may be v1 while one weapon family is v2 (e.g. a Gorn refit drone rack). `gateContent` works at the per-system granularity, so such a ship is simply unavailable under a v1 profile rather than partially loaded.
- **Replay across promotions.** A v1 game replayed after the platform reaches v3 must use its pinned profile and the *historical* reducer behavior; `E2` resolves reducer version from the profile, not from `platformConfig`.
- **Errata mid-phase.** A balance/errata change to a shipped capability is a `B1` edition bump; whether to re-pin or honor the original is a §11 v3 question (default: honor original, flag the game).
- **Top program risks** (tracked here, owned by leads): (R1) **simultaneity correctness** — sealed-order/reveal determinism is the hardest core invariant; if it slips, every later phase inherits the bug. (R2) **SSD digitization fidelity & throughput** (`B3`) — the v1 roster gates on accurate machine-readable SSDs; mis-keyed arcs/boxes silently corrupt combat. (R3) **rulebook IP boundary** — no verbatim text may leak into registry `rulebookRefs` or `B1`. (R4) **scope creep into v2 weapons** (ESG/cloak/PPD pull) before the v1 four-empire slice is proven end-to-end. (R5) **replay determinism** under library/Node upgrades — pin the RNG and reducer via `E1`/`E2`.

## Testing

- **Closure & acyclicity:** unit-test `capabilityClosure` (every dependency resolvable) and `topoSortMilestones` (DAG has no cycle); fail CI if any `dependsOn` points at a non-existent id.
- **Phase-lint:** a build-time check that **no v1-tagged capability depends on a v2/v3 capability**, and that every `CapabilityId` referenced by a `ShipTemplate` exists in the registry (cite `E5-testing-strategy.md`).
- **Golden tournament roster:** load the FED(R2)/KLI(R3)/KZI(R5)/GORN(R6) tournament cruisers and assert `gateContent(tc, v1Profile).ok === true` for each, and that Lyran/Hydran/Romulan TCs return the expected `missing` set under v1.
- **Immutability:** assert a second `SetGameCapabilityProfile` on a pinned game is rejected; assert experimental override flips `ranked=false`.
- **Determinism across promotion:** replay a recorded v1 game (`E2`) after promoting `platformConfig` to v3 and assert byte-identical final snapshot.
- **Worked scenario:** run a full FED-vs-KLI tournament duel on the v1 map (P17 barrier + asteroids) end-to-end as the v1 acceptance gate.

## Phasing

**[v1 AM-tournament] — single-duel correctness on the tournament map.**
- *Subsystems:* sequence-of-play (`C1`), energy allocation (`C2`), core movement incl. HET/sideslip/Tac-maneuver/ED/disengagement (`C3`), direct fire (`C4`), seeking weapons (`C5`), admin/suicide shuttles + wild weasel + scatter-pack (`C6`), damage/criticals/repair (`C7`), sensors/lock-on/ECM-ECCM/AEGIS/Tac-Intel fog (`C8`), transporter bombs + boarding + hit-and-run + self-destruct (`C10`), terrain framework (`C9`); infra `A1`–`A4`, rules API `B1`, catalog `B3`; UI `D1/D2/D3/D4/D5/D6/D8/D9`.
- *Weapons:* phaser-1/2/3/G, disruptor (+overload/UIM), photon (+overload/proximity), fusion (+overload/suicide), hellbore (+enveloping/overload), anti-drone; drones I–VI with racks; plasma R/S/G/F/D (+enveloping/shotgun/bolt/pseudo).
- *Empires/ships (R-codes):* **Federation (R2), Klingon (R3), Kzinti (R5), Gorn (R6)** — each tournament cruiser fully expressible in v1 caps. **Romulan (R4)** is the stretch empire (plasma is v1; cloak G13 deferred) playable in a no-cloak variant.
- *Map/terrain:* the floating **tournament map with barrier edge (P17)**, **asteroid fields (P3)**, **class-M planets / small moons (P2 core)**, **standard orbits (P8)**.
- *Data acquisition (gating):* there is **no authoritative external dataset** of per-ship weapon mounts + firing arcs (confirmed by search), so the v1 ship inventory — system/weapon/power/shield box sets **and every weapon's arc** — is **built by hand from the SSDs** via the B4 image-overlay mapper. A ship is **v1-ready only when its B4 systems-consistency audit is clean** (drawn SSD ↔ content inventory ↔ control overlay all agree; every weapon arc set). This gates the four-empire roster above.

**[v2] — fleets, carriers, and information warfare.** Fighters & carriers + PFs (`C6`); cloaking, scouts, offensive/lent EW (`C8` G13/G24); mauler, tractor-repulsor, PPD, special ± / pod / swivel arcs (`C4`) — unlocking **ISC, Lyran (ESG G23), Hydran (fighters), Tholian (web G10)**; full mine warfare (`C10` M-section); advanced munitions, multi-warhead buses, ECM/probe drones (`C5`); erratic/nimble/mid-turn speed change (`C3` C10–C12); broader terrain — black holes, pulsars, nebulae, gravity waves, heat/radiation zones (`C9`); more empires (Orion, WYN, LDR). Ranked/casual flagging and content-pack management UI land here.

**[v3 full Master] — everything.** Advanced technology / **X-ships** (drones VII–XII, plasma L/M, X1 module); **Early Years (Y-section)** ships and tech; **all remaining empires** incl. **Andromedan** (PA panels/displacement, PA & trans-captor mines) and the **monster** roster; remaining section-E exotics (web-caster, snare, shield-cracker, particle cannons, rail gun); Tac-Intel deception & hidden deployment (`C8` D17.6–.8/D20); dogfighting/heavy fighters/bombers/PF leaders (`C6`); remaining terrain (ion storms, novae, sunspots, WYN zone, dust, comets); errata/edition versioning joined to `B1`.

**Dependency order (milestone DAG):** M1 engine-core (`A1`–`A4`,`B2`,`C1`,`E1`) → M2 SSD pipeline + four-empire catalog incl. hand-built weapon/arc inventory + clean systems-consistency audit (`B3`/`B4`) → M3 mechanics slice (`C2`–`C5`,`C7`,`C8` v1) → M4 terrain + shuttles + mines slice (`C6`/`C9`/`C10` v1) → M5 UI + lobby + gate (`D*`,`E6` gate) → **M6 v1 acceptance** (golden FED-vs-KLI duel). M1–M2 are the critical path; everything in v2/v3 attaches downstream of M6.
