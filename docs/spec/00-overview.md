# 00 — SFB Online: Master Overview & Specification Index

> Canonical index for the SFB Online spec. Read this first, then read the per-subsystem
> docs in the order of the [Subsystem Map](#subsystem-map). Every subsystem doc conforms to
> the 11-section template described in [How to Read This Spec](#how-to-read-this-spec).

## Executive Summary

**SFB Online** is a web platform that hosts faithful, multiplayer games of *Star Fleet Battles*
(Captain's Edition Master Rulebook). Two or more sides — each with one or more commanders, each
commander controlling one or more ships — play the tabletop game over the network. The platform
automates the *drudgery* (rolling dice, tracking energy, decrementing shield boxes, totaling damage,
walking the 32-impulse clock) and **assists** players with graphical tools (targeting overlays,
movement plotting, energy worksheets), but it **never makes a tactical decision for a player**.
Whether to fire, which target, how much power to the engines, when to launch a drone — every choice
that a human makes at the table remains a human choice here. The tabletop experience is preserved;
only the bookkeeping is removed.

Four architecture decisions are **locked** and bind every document in this spec:

1. **Scope & phasing.** The data model and engine are architected for the **complete Master Rulebook**,
   but the first implementable milestone (**v1**) targets **Advanced Missions (AM) tournament play** —
   two sides, one map, fixed lock-on, no terrain. Every feature is tagged `[v1 AM-tournament]`,
   `[v2]`, or `[v3 full Master]`. See [Phasing Summary](#phasing-summary) and
   [E6 — Roadmap & Phasing](./E6-roadmap-phasing.md).
2. **Authoritative referee.** The server validates legality, blocks illegal actions, auto-rolls all
   dice, and computes damage allocation and the energy balance. It is the rules referee, not a passive
   relay. A designated **GM/host** can override **any** ruling, recorded as a `GmOverrideApplied` event
   for edge cases and house rules.
3. **Persistent, real-time-first sessions.** Synchronous play over Socket.IO lockstep is the primary
   mode, but every game is fully **persistent** and can pause/resume across days. Asynchronous
   order-submission is a supported secondary path.
4. **Gated Rules API.** A private, full-text + semantic rules search, deep-linked by rule number, is
   available only to verified rulebook owners. This spec *describes* that system; it does **not** embed
   verbatim rulebook prose.

## System Architecture

SFB Online is an **event-sourced** system with an **authoritative referee** at its core. Per game,
an append-only log (`gameEvents`) is the single source of truth; current game state is a deterministic
**fold** (reducer) over that log, checkpointed periodically into `gameSnapshots` for fast load. Players
issue **commands** (PascalCase, imperative — `PlotMovement`, `AllocateEnergy`, `DeclareFire`); the
referee **validates** each against the current clock position and state, and on success emits one or
more **events** (past-tense — `MovementPlotted`, `EnergyAllocated`, `WeaponFired`). State is never
mutated directly; it only ever advances by appending events. Because all randomness flows through one
seeded Dice/RNG service and the fold is pure, **replays are byte-for-byte reproducible**.

The stack mirrors the sibling *wavemax-affiliate-program* deployment:

- **Server:** Node.js + Express, MongoDB via Mongoose, express-session + connect-mongo, JWT, Helmet,
  csrf-csrf, express-rate-limit, Winston, nodemailer; Firebase for push.
- **Real-time:** Socket.IO for lockstep sync; **Redis** for cross-worker pub/sub fan-out (PM2 cluster),
  the sealed-order hot store, and presence.
- **Client:** React + TypeScript + Vite SPA; Socket.IO client; battle map rendered with SVG/Canvas
  (Konva or PixiJS).
- **Deploy:** Docker + PM2 (`ecosystem.config.js`) on OCI behind nginx; gated portal on chrsent.com.

```
                          BROWSER (React + TS + Vite SPA)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  D1 Map  D2 SSD  D3 Energy  D4 Move  D5 Targeting  D6 Impulse-HUD          │
  │  D7 Rules-Browser   D8 Lobby/Setup   D9 GM/Spectator Console               │
  │  • renders fog-filtered state   • runs the SAME reducers (optimistic UI)   │
  └───────────────┬───────────────────────────────────▲──────────────────────┘
       Commands   │ (PlotMovement, AllocateEnergy,     │  fog-filtered events +
       + sealed   │  DeclareFire, SubmitSealedOrders…) │  ClockView + lock-status
       commits    ▼                                    │
  ┌──────────────────────────  A4 REAL-TIME SYNC LAYER  ──────────────────────┐
  │   Socket.IO (lockstep)   │   Redis pub/sub fan-out across PM2 workers      │
  │   presence • idempotent delivery • sealed-order hot store • fog stripping  │
  └───────────────┬───────────────────────────────────▲──────────────────────┘
                  │ validated command                  │ events (E1 DiceRolled,
                  ▼                                     │  C1 ImpulseAdvanced, …)
  ┌────────────────────── AUTHORITATIVE REFEREE (engine) ─────────────────────┐
  │  C1 SEQUENCE-OF-PLAY ENGINE  — the clock + the GATE (legalCommandsAt)      │
  │      dispatches resolvers, one rule-legal step at a time:                  │
  │   ┌──────────────────────────────────────────────────────────────────┐    │
  │   │ C2 Energy │ C3 Move │ C4 Direct-Fire │ C5 Seeking │ C6 Carriers/PF │    │
  │   │ C7 Damage/Crit/Repair │ C8 EW/Sensors/Cloak │ C9 Terrain │ C10 Misc│    │
  │   └──────────────────────────────────────────────────────────────────┘    │
  │  B2 RULES ENGINE CORE  validate(state,cmd) → resolve() → events[]          │
  │  E1 DICE/RNG (seeded, deterministic)   E4 Security/Integrity (fog, hashes) │
  └───────┬───────────────────────────────────────────────┬──────────────────┘
          │ appendEvents(expectedHeadSeq)                  │ reads catalog + rules
          ▼                                                ▼
  ┌──────────────── A3 DATA / EVENT STORE ────┐   ┌──────────── REFERENCE DATA ───────────┐
  │  gameEvents (append-only, totally ordered)│   │ B3 Game Catalog & SSD model (shipCatalog│
  │  gameSnapshots (fold checkpoints)         │   │     / ssdTemplates)                     │
  │  sealedOrders (hash-committed, fog-gated) │   │ B1 Rules Content + Rules API (rules /   │
  │  games (lifecycle)                        │   │     ruleEmbeddings, gated, deep-linked) │
  └───────────────────────────────────────────┘   └────────────────────────────────────────┘
        MongoDB replica set (transactions)              E2 Replay/Save · E3 Notifications
```

The **rules engine core (B2)** is the validate/resolve brain that the C-series mechanics plug into;
the **sequence-of-play engine (C1)** is the clock and the legality gate that decides *when* each
mechanic may run; the **catalog (B3)** supplies ship/SSD reference data the resolvers read; and the
**Rules API (B1)** is a separate, gated read path for human reference (the D7 browser) — it is not in
the command/event hot path.

## Subsystem Map

Docs are grouped **A** (platform/infra), **B** (rules & data), **C** (game mechanics),
**D** (client UI), **E** (cross-cutting services). Read top-to-bottom for a clean dependency order.

### A — Platform & Infrastructure
- [A1 — Deployment & Infrastructure](./A1-deployment-infrastructure.md) — Docker/PM2/nginx on OCI, MongoDB replica set, Redis, env/secrets, cluster topology.
- [A2 — Identity, Roles & Portal Gating](./A2-identity-roles-gating.md) — auth, the role model (admin/gm/commander/player/spectator), rulebook-owner verification, portal gating.
- [A3 — Data Architecture & Event Store](./A3-data-architecture-event-store.md) — `gameEvents` log, snapshots, sealed orders, the fold/reducer contract, optimistic-concurrency append.
- [A4 — Real-Time Sync Layer](./A4-realtime-sync-layer.md) — Socket.IO lockstep, Redis fan-out, presence, sealed-submit→lock→reveal transport, server-side fog stripping.

### B — Rules & Reference Data
- [B1 — Rules Content Pipeline & Rules API](./B1-rules-content-api.md) — ingestion, full-text + semantic search, gated deep-link-by-rule-number API.
- [B2 — Rules Engine Core](./B2-rules-engine-core.md) — the `validate(state, command)` / `resolve()` framework all mechanics register into.
- [B3 — Game Catalog & SSD Data Model](./B3-game-catalog-ssd-model.md) — ship/SSD templates, weapon/system definitions, the **`SsdImageMap`** (real SSD page image + hotspot overlay), scenario catalog.
- [B4 — SSD Image-Overlay Editor](./B4-ssd-layout-editor.md) — the hand-mapping tool that overlays interactive hotspots on each ship's real SSD page image and feeds D2.

### C — Game Mechanics (resolvers driven by C1)
- [C1 — Sequence of Play / Turn-Impulse Engine](./C1-sequence-of-play-engine.md) — the master clock (turn/phase/impulse/segment) and the legality **gate**; orchestrates every other C-doc.
- [C2 — Energy Allocation & Power Systems](./C2-energy-allocation-power.md) — phase-1 power distribution, reactors/batteries, arming, the energy balance.
- [C3 — Movement Engine](./C3-movement-engine.md) — the Impulse Chart, turn mode, plotting/execution of movement, hex geometry.
- [C4 — Direct-Fire Combat](./C4-direct-fire-combat.md) — arcs, range, to-hit/damage for beam/bolt weapons, struck-shield determination, the `ScoredHit` hand-off.
- [C5 — Seeking Weapons (Drones & Plasma)](./C5-seeking-weapons.md) — launch, seeking movement, tracking, impact resolution.
- [C6 — Carriers, Shuttles & Fast Patrol Ships](./C6-carriers-shuttles-pf.md) — shuttle/fighter/PF operations, launch/recover, dogfight hooks.
- [C7 — Damage, Critical Hits & Repair](./C7-damage-criticals-repair.md) — the Damage Allocation Chart (DAC), volley formation, criticals, in-game repair.
- [C8 — Electronic Warfare, Sensors & Cloaking](./C8-ew-sensors-cloak.md) — EW economy, sensor lock-on (phase 4), ECM/ECCM, cloaking.
- [C9 — Terrain & Navigational Hazards](./C9-terrain-hazards.md) — planets, asteroids, dust, radiation and other map features `[v2/v3]`.
- [C10 — Mines, Boarding & Miscellaneous Systems](./C10-mines-boarding-misc.md) — mines, boarding parties, transporters, self-destruct, sundry systems.

### D — Client UI (each cites a wireframe under `./wireframes/`)
- [D1 — Hex Map Board UI](./D1-map-board-ui.md) — the battle map: hex grid, tokens, ranges, overlays.
- [D2 — Ship Token & Interactive SSD Viewer](./D2-ssd-viewer-ui.md) — the live Ship System Display with damage state.
- [D3 — Energy Allocation Panel UI](./D3-energy-allocation-ui.md) — the phase-1 power worksheet with live balance checks.
- [D4 — Movement Plotting UI](./D4-movement-plotting-ui.md) — plotting paths against the Impulse Chart and turn mode.
- [D5 — Assisted Targeting & Combat UI](./D5-targeting-combat-ui.md) — per-weapon targeting overlays, hit-probability/expected-damage, fire declaration.
- [D6 — Impulse / Turn HUD](./D6-impulse-hud.md) — the clock strip, current step, per-actor lock status, submit/lock control.
- [D7 — Rules Reference Browser UI](./D7-rules-browser-ui.md) — the gated rules search/browse surface over the B1 API.
- [D8 — Lobby, Scenario Setup & Session Management](./D8-lobby-scenario-ui.md) — game creation, scenario/force selection, seating, pause/resume.
- [D9 — GM & Spectator Console](./D9-gm-spectator-console.md) — the unfiltered stream, override controls, fog-gated spectating.

Each D-doc cites a static SVG mockup under `./wireframes/`. Two **working interactive prototypes** exist: the integrated battle screen [`./wireframes/battle-screen.html`](./wireframes/battle-screen.html) (map + ship selection + SSD + live firing arcs + exposed-shield targeting + impulse HUD), and the **SSD viewer** [`./wireframes/D2-ssd-viewer.html`](./wireframes/D2-ssd-viewer.html), which loads a ship's **actual SSD page image** (the owner's scan) and lays the per-box status overlay on top.

### E — Cross-Cutting Services
- [E1 — Dice & RNG Service](./E1-dice-rng-service.md) — the single seeded random source; emits `DiceRolled`; the determinism guarantee.
- [E2 — Game Log, Replay & Save/Resume](./E2-game-log-replay.md) — log scrubbing, replay, persistence/resume built on the A3 fold.
- [E3 — Notifications](./E3-notifications.md) — email/push (nodemailer/Firebase): your-turn, game-resumed, results.
- [E4 — Security & Integrity](./E4-security-integrity.md) — fog-of-war enforcement, sealed-order hashing/encryption, anti-cheat, auditing.
- [E5 — Testing Strategy](./E5-testing-strategy.md) — golden-game fixtures, gate/determinism/fog test suites.
- [E6 — Roadmap & Phasing](./E6-roadmap-phasing.md) — the authoritative v1/v2/v3 milestone plan.

### Build Modules (implementation specs that operationalize the design above)
- [Module: SSD Pipeline](./modules/ssd-pipeline.md) — **the data-first foundation, built first.** Scan → CV-assisted extract → map → **landscape** viewer → consistency audit, proven on 8 representative ships (cruiser + escort per v1 race). Produces the per-ship weapon/system inventory (with firing arcs) and the working SSD viewer + overlay.

## Cross-Subsystem Interface Map

**C1 is the conductor.** It owns the clock `(turn, phase 1–8, impulse 1–32, segment A–E, micro-step)`
and the **gate** function `legalCommandsAt(state, actor)`. Every mechanics module registers a
**resolver** that C1 invokes only when the clock reaches that module's window; modules never run
themselves out of sequence. The strict per-turn order (top-to-bottom; phase 6 repeats A–E 32 times)
binds who-produces-what:

| Clock step | Decision opened | Resolver doc | Key event(s) |
|---|---|---|---|
| Phase 1 — Energy Allocation | power, speed, arming | **C2** | `OrdersRevealed` → `EnergyAllocated` |
| Phase 4 — Sensor Lock-On | attempt lock or not | **C8** | sealed intent → `DiceRolled` → lock flag set |
| 6A — Movement | one-hex move / turn | **C3**, then **C5** impact | `SegmentEntered`, `MovementPlotted`/executed, `SeekingWeaponImpact` |
| 6B — Impulse Activity | launch/transport/mine | **C5**, **C6**, **C10** | `SeekingWeaponLaunched`, shuttle/PF events |
| 6D — Direct Fire | fire + EW + targets | **C4** (+**C8** EW) | `OrdersRevealed` → `FireDeclared` → `DiceRolled` → `WeaponFired` |
| 6E / Phase 7 — Post-combat / Final | post-combat actions | **C7**, **C10** | `DamageAllocated`, repair/activity events |
| Phase 8 — Record Keeping | none (auto) | **C2** carryover | `TurnCompleted` |

A **representative impulse** flows: C1 enters phase 6, impulse *n*, segment **6A** → C3 moves units
on their scheduled impulses (open-sequential), then C1 runs C5's end-of-6A seeking-impact resolver
(a drone kill here prevents that ship firing this impulse — load-bearing ordering). Segment **6B**
handles sealed launches (C5/C6/C10). Segment **6D** is sealed-simultaneous: each side commits fire
orders **bundled with its EW changes** (C4 + C8); C1 reveals only when all required actors are locked,
freezes the committed-to-fire list, then runs C4's resolver so two ships can destroy each other on the
same impulse. C4 computes the `ScoredHit` and hands it to **C7**, which forms the volley, walks the
**DAC**, rolls criticals, and emits `DamageAllocated`. Segment **6E** runs post-combat announcements.
Throughout, **A3** appends every event with its `GameClock` stamp and a gapless `seq`; **A4** streams
the fog-filtered tail to clients; **E1** supplies the seeded RNG cursor so the whole sequence replays
identically.

**Producer/consumer summary:** C1 produces clock/step events (`ImpulseAdvanced`, `OrdersSealed`,
`OrdersRevealed`, `StepResolved`) and consumes the mechanics modules' resolvers. C2/C3/C4/C5/C7/C8/C10
produce their domain events and consume the clock gate + B3 catalog data + E1 dice. A3 consumes all
events (append) and produces the folded state every doc reads. A4 consumes events (server) and produces
fog-filtered streams (client). E2 consumes the log for replay; E4 polices the fog boundary across all
of them.

## Data Flow — Worked Example: One Player Fires a Weapon

This traces a single phaser shot from click to SSD update, naming every event. (Mechanics owned by
[C4](./C4-direct-fire-combat.md), [C7](./C7-damage-criticals-repair.md), [C8](./C8-ew-sensors-cloak.md);
plumbing by [C1](./C1-sequence-of-play-engine.md), [A3](./A3-data-architecture-event-store.md),
[A4](./A4-realtime-sync-layer.md), [E1](./E1-dice-rng-service.md).)

1. **Gate opens.** C1 reaches phase 6, impulse 12, **segment 6D**. It marks the step
   `awaiting-orders` and publishes a `ClockView` over A4. The D6 Impulse HUD lights "Submit & Lock";
   `legalCommandsAt` now admits `SubmitSealedOrders` for fire.
2. **Player composes fire.** In the D5 targeting UI the player picks weapon + target. C4 has
   pre-computed in-arc / in-range / exposed-shield / hit-probability / expected-damage overlays, but
   the *choice to fire* and *which target* are the player's. The client builds a `FireIntent` (and any
   bundled EW change from C8).
3. **Sealed submit.** The client sends `SubmitSealedOrders { firerShipId, intents, commitHash }`.
   A4 routes it; A3 stores the plaintext in `sealedOrders` (encrypted, fog-gated) and appends
   `OrdersSealed { firerShipId, commitHash, impulse, segment }`. Opponents see only that a commit
   exists — never its contents (E4).
4. **All-locked → reveal.** When every required actor is locked, C1 verifies each `commitHash`
   against `sha256(canonicalJson(orders)+nonce)`, then emits `OrdersRevealed { firerShipId, intents }`.
   The committed-to-fire weapon list is **frozen** so a weapon destroyed elsewhere this segment still
   fires (simultaneity).
5. **Resolution.** C1 invokes C4's `resolveDirectFire` with a scoped RNG stream. C4 emits
   `FireDeclared { weaponInstanceId, targetRef, armingStatus, effectiveRange, trueRange }`, draws from
   E1 → `DiceRolled { weaponInstanceId, rolls, rngCursor }`, applies range/ECM modifiers, determines
   the struck shield, and emits either `ShotMissed` or
   `WeaponFired { hit, struckShield, direction, rawDamagePoints, appliedModifier }`.
6. **Damage allocation.** `WeaponFired` carries the `ScoredHit` into C7, which forms the volley,
   walks the **DAC**, decrements the struck shield / internals, rolls any criticals (more `DiceRolled`),
   and emits `DamageAllocated { targetShipId, hits[], criticals[] }`.
7. **State update.** A3 has appended each event with a gapless `seq`; the pure fold updates ship
   state. A4 streams the fog-filtered tail; clients run the **same reducers** to reconcile their
   optimistic view. D2 animates the SSD (shield box down, internals struck); D1 flashes the hit on the
   map; D6 advances the clock when 6D completes. E2 can later replay this exact sequence from the log.

## Glossary

- **Turn** — the top-level cycle (B2.1); one turn = 8 phases. Phase 6 contains the 32-impulse loop.
- **Phase (1–8)** — the eight ordered steps of a turn (energy, speed, self-destruct, lock-on, initial
  activity, the impulse process, final activity, record-keeping).
- **Impulse (1–32)** — the fine-grained sub-steps inside phase 6; movement happens on the impulses a
  unit's **speed** schedules per the **Impulse Chart**.
- **Segment (6A–6E)** — the ordered sub-steps of each impulse: movement, impulse activity, dogfight,
  direct fire, post-combat.
- **Turn mode** — the movement constraint that fixes how many hexes a ship must travel between
  course changes, by class/speed (owned by [C3](./C3-movement-engine.md)).
- **EA (Energy Allocation)** — the phase-1 commitment of every unit's power for the whole turn
  ([C2](./C2-energy-allocation-power.md)); the energy budget is sealed and balanced by the referee.
- **SSD (Ship System Display)** — the per-ship sheet of boxes (shields, systems, weapons); the live,
  damage-tracked version is the [D2](./D2-ssd-viewer-ui.md) viewer over the [B3](./B3-game-catalog-ssd-model.md) template.
- **DAC (Damage Allocation Chart)** — the table that maps incoming damage volleys to the systems they
  strike ([C7](./C7-damage-criticals-repair.md)).
- **Direct-fire vs seeking** — direct-fire weapons (phasers, disruptors, photons…) resolve instantly at
  declaration ([C4](./C4-direct-fire-combat.md)); seeking weapons (drones, plasma) move on the map and
  impact later ([C5](./C5-seeking-weapons.md)).
- **Lock-on** — the phase-4 sensor result that permits a ship to fire this turn ([C8](./C8-ew-sensors-cloak.md)).
- **Sealed / simultaneous orders** — the commit→reveal protocol (B2.4): each side hash-commits hidden
  orders; nothing is revealed until all are locked, so no side reacts to another's choice.
- **Sealed envelope / commit hash** — the server-side record holding plaintext orders + a
  `sha256(orders+nonce)` integrity hash; fog-gated, never sent to opponents.
- **Fog-of-war** — server-side hiding of information a side should not see; clients receive only
  fog-filtered events ([E4](./E4-security-integrity.md)).
- **Event / Command** — past-tense fact (`WeaponFired`) vs imperative request (`DeclareFire`).
- **Fold / reducer** — the pure function that rebuilds current state from the event log.
- **Snapshot** — a periodic materialized fold checkpoint for fast load ([A3](./A3-data-architecture-event-store.md)).
- **seq / head seq** — the gapless per-game total-order index; the optimistic-concurrency token.
- **Resolver** — a mechanics function C1 invokes when the clock reaches its window.
- **GM override** — a host-issued correction recorded as `GmOverrideApplied { target, value, reason }`;
  the single sanctioned escape hatch.
- **Determinism / RNG cursor** — all randomness comes from one seeded stream keyed by
  `(gameId, clock, cursor)`, so replays match exactly ([E1](./E1-dice-rng-service.md)).

## Phasing Summary

The full breakdown lives in [E6 — Roadmap & Phasing](./E6-roadmap-phasing.md); at a glance:

- **[v1 AM-tournament]** — The minimum faithful tournament referee: two sides, one map, fixed lock-on.
  Full clock + gate (C1); energy allocation (C2); movement with Impulse Chart + turn mode (C3);
  direct fire for the core weapons — phaser/disruptor/photon/fusion/hellbore/ADD (C4); drones & plasma
  (C5); the DAC, criticals, basic repair (C7); the EW economy + phase-4 lock-on (C8); the event store +
  fold + snapshots (A3); Socket.IO lockstep + Redis fan-out + sealed/reveal (A4); seeded RNG (E1);
  identity/roles/gating (A2); the core UIs (D1–D6, D8) and GM console (D9); replay/save-resume (E2);
  security/fog (E4). This is the playable backbone.
- **[v2]** — Carriers/shuttles/PF and the dogfight interface (C6, segment 6C); terrain & hazards (C9);
  mines/boarding/transporters breadth (C10); exotic weapons (mauler, PPD, special arcs) in C4; richer
  notifications (E3); cold archival in A3/E2. Expands beyond the tournament envelope.
- **[v3 full Master]** — The remaining Master Rulebook breadth: full terrain, every section-E weapon,
  multi-map/sub-light edge cases, scenario-scheduled turn-events, advanced fire-control variants,
  sharding/multi-region scale. Deferred because the fixed tournament model the v1 engine already covers
  is the proving ground.

## How to Read This Spec

Read this overview, then the [Subsystem Map](#subsystem-map) order (A → B → C → D → E). **Every
subsystem doc uses the same 11-section template, in this order** — use it to navigate any doc:

1. **Purpose & Scope** — one paragraph + a `PHASE` tag line.
2. **Rulebook References** — the rule numbers the subsystem implements (e.g. `(B2.0)`, `(D0.0)`).
3. **Domain Model** — TypeScript interfaces for entities + a Mongoose schema sketch for persisted collections.
4. **Events & Commands** — the commands consumed and events emitted, with payload shapes.
5. **Engine / API** — server function signatures (validators, resolvers, queries); pure where possible.
6. **Validation & Enforcement Rules** — the referee logic, legality checks, explicit GM-override points.
7. **UI Contract** — what the client needs; D-docs include the screen layout + a `./wireframes/` reference.
8. **Dependencies** — other docs this builds on / services, by filename.
9. **Edge Cases & Open Questions** — known gaps, externalized data tables, unresolved rulings.
10. **Testing** — how to verify; cited against rulebook worked examples where relevant.
11. **Phasing** — what ships in v1 AM-tournament vs deferred, with rationale.

**Conventions across all docs:** commands are PascalCase imperatives; events are past-tense; the
canonical names in the design contract (`PlotMovement`/`MovementPlotted`, `AllocateEnergy`/`EnergyAllocated`,
`DeclareFire`/`WeaponFired`, `LaunchSeekingWeapon`/`SeekingWeaponLaunched`, `SubmitSealedOrders`/`OrdersSealed`+`OrdersRevealed`,
`AdvanceImpulse`/`ImpulseAdvanced`, `ApplyGmOverride`/`GmOverrideApplied`, `DiceRolled`) are used
verbatim. Rule numbers and numeric facts (ranges, costs, die results, chart outcomes) are cited as
facts; **no rulebook prose is quoted**. Docs cross-reference each other by filename so the stack hangs
together. Throughout, the line between **automated** (dice, math, legality, bookkeeping) and
**player decision** (every tactical choice) is explicit — assisting the player, never deciding for them,
is the product's north star.

## Appendix A — Canonical Event & Command Vocabulary (authority)

This appendix is the **single source of truth** for the shapes that several subsystems share. Where a
subsystem doc shows a narrower local view, these definitions win. Shared id aliases: `GameId`,
`UserId`, `ShipInstanceId`, `WeaponId`, `Uuid` are opaque strings.

```ts
// ---- Turn clock (owned by C1; consumed everywhere) ----
interface ImpulseAdvanced { gameId: GameId; turn: number; impulse: number /*1..32*/; movers: ShipInstanceId[]; }
interface SegmentEntered  { gameId: GameId; turn: number; impulse: number; segment: 'A'|'B'|'C'|'D'|'E'; }
// `movers` = ships whose speed plot moves them this impulse (drives D4 live-steer); per-impulse
// sub-pulse detail is carried by SegmentEntered, NOT by ImpulseAdvanced.

// ---- Dice / RNG (owned by E1) ----
type DiePurpose =
  | 'to-hit' | 'damage-points' | 'damage-allocation' | 'critical-hit'
  | 'seeking-control' | 'salvo' | 'wave-lock' | 'breakdown' | 'general';
interface DiceRolled { gameId: GameId; type: 'DiceRolled'; rolls: number[]; total: number;
                       purpose: DiePurpose; rngCursor: number; context?: unknown; rule?: string; }
// Cursor field is `rngCursor` (monotonic per game, enables replay/audit). No `seedCursor`.

// ---- GM override (owned by D9; recorded like any event) ----
interface OverrideTarget { seq?: number; entity?: string; shipInstanceId?: string; field?: string; }
interface ApplyGmOverride   { gameId: GameId; target: OverrideTarget; value: unknown; reason: string; }
interface GmOverrideApplied { gameId: GameId; target: OverrideTarget; value: unknown; reason: string; appliedBy: UserId; }
// `target` is ALWAYS the structured OverrideTarget object, never a bare string.

// ---- Direct fire (owned by C4) ----
// FireIntent is a client-built DTO (not an event); the event chain is FireDeclared -> WeaponFired.
interface FireIntent { weaponInstanceId: WeaponId; targetRef: string; armingStatus: string; /* ...C4 */ }
// Command:  DeclareFire { intent: FireIntent }   (or SubmitSealedOrders { intents: FireIntent[], commitHash })
// Events:   FireDeclared { weaponInstanceId, targetRef, armingStatus, effectiveRange, trueRange, segment }
//           WeaponFired  { ...resolved result }  ->  DamageAllocated { ... }
```

**Canonical filename numbering.** Subsystem docs are referenced by the exact filenames in the
[Subsystem Map](#subsystem-map) above (e.g. the battle map is `D1-map-board-ui.md`, the SSD panel is
`D2-ssd-viewer-ui.md`, the impulse HUD is `D6-impulse-hud.md`, dice live in `E1-dice-rng-service.md`,
GM override lives in `D9-gm-spectator-console.md`). Earlier drafts used other numbers; those are retired.
