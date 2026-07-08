# SFB Player — Completion Plan

> **Purpose.** Analyze the current SFB Player build against the SFB Online specs and lay out a
> reviewable, phased plan to **finish the game mechanics inside the existing framework**. This is a
> spec to review *before* implementing — nothing here is built yet.

## 0. Scope & guiding principles

**In scope:** the *game mechanics* that make SFB Player a complete, faithful Advanced-Missions
tournament game, integrated into the current design.

**Out of scope (deliberately):** the full-stack platform from `docs/spec/` — React/Vite SPA,
MongoDB event store, Socket.IO/Redis lockstep, identity/roles/portal gating, deployment, push
notifications, and the gated full-text Rules API. SFB Player keeps its lightweight equivalents:
client-side ES modules, `serve.py` JSON state + fog, and code-based fleet join.

**Integration principle — reuse the existing seams, add nothing parallel:**

| Seam (existing) | What new mechanics plug into it |
|---|---|
| `battle-phase.js` — `SEGMENTS` / `nextCursor` / `advance` + gates | new **resolvers** keyed to already-defined segments (`lockon`, `6A*`, `6B*`, `6E`, `final`, `record`) |
| `ui` state object | new interaction modes (drone-target, boarding, mine-drop) as fields, same render loop |
| `energy-model.js` (`newEafColumn`/`validateEaf`/`foldEaf`/`sinkMax`) + `#epOverlay` | EW/lock-on/drone-control/repair already have columns; give them combat effects |
| `fire-plan.js` / `direct-fire.js` — `resolveAttackPlan` | ECM range shift, lock-on gate, criticals hand-off |
| `dac-allocator.js` — `applyVolley` | the critical-hits table (C7) |
| `battle-map.js` — tokens + gestures + `plotOverlaySvg` | seeking-weapon tokens, terrain, boarding lines |
| `course-plan.js` / `movement.js` | reused verbatim to move **drones/plasma** on the Impulse Chart |
| `serve.py` `_battle.json` + `battle_view` fog + `committed` | RNG seed in state, sealed-order reveal, seeking/mine state |
| `node --test` (17 files / 102 tests) | one `*.test.mjs` per new pure module |

---

## 1. Current-state assessment

| Subsystem | Spec | Status | Notes |
|---|---|---|---|
| Sequence of play (turn/phase/impulse/segment) | C1 | ✅ | `battle-phase.js` full cursor; 3 input gates. Many segments are no-ops (see §2). |
| Energy allocation (power, arming, movement, EW columns) | C2 | ✅ | `energy-model.js` + EAF UI; warp-aware speed. |
| Movement (Impulse Chart, turn mode, sideslip, mid-turn speed change) | C3 | ✅ | `course-plan.js` + `movement.js`; drag plotting. |
| Direct fire → damage → SSD update | C4/C7 | ✅ | `resolveAttackPlan` → volleys → DAC → `s.status`. Arc/range/struck-shield correct. |
| DAC allocation (shields → armor → internal) | C7 | 🟡 | `applyVolley` allocates boxes; **no criticals**, `D4.33` last-box rule present. |
| Tactical Intelligence detection levels (D17.3/.4) | C8 | ✅ | Full chart + column shifts; enemy SSD & intel report filtered. |
| ECM/ECCM economy → **combat effect** | C8 | ⬜ | Columns exist; **not applied** to effective range. |
| Sensor lock-on (phase 4) | C8 | 🟡 | `lockon` segment + `hasLockOn` predicate exist; **fire never checks it**. |
| Multiplayer sync + fog | A4/E4 (lite) | 🟡 | `serve.py` state + per-commander fog + `committed` flags; **not** hash-sealed; fire resolves client-side. |
| Deterministic RNG | E1 | ⬜ | `Math.random` throughout → not fair for hidden info, not reproducible. |
| Repair / damage-control effect | C7 | ⬜ | `damageControl` allocated but never repairs boxes. |
| Seeking weapons (drones, plasma) | C5 | ⬜ | None. Racks/plasma launchers exist on SSDs but no launch/move/impact. |
| Shuttles / wild weasel / scatter-pack | C6 | ⬜ | None. |
| Mines / boarding / transporters / self-destruct | C10 | ⬜ | None. |
| Terrain (barrier, asteroids, planets) | C9 | ⬜ | Open map only. |
| Ship roster (four-empire v1) | B3 | 🟡 | Verified: FED-CA, FED-CL, FED-NCL, GOR-CA, KLI-D7. **Missing Kzinti**; finish arcs. |
| SSD viewer + verify/overlay editor | D2/B4 | ✅ | `ssd.html` (read-only, tac-intel filtered) + `verify.html`. |

---

## 2. Completion checklist

Legend: ✅ done · 🟡 partial · ⬜ missing.  Priority: **P0** core-loop correctness/fairness · **P1**
tournament-complete · **P2** breadth.

### P0 — Make the core loop correct & fair
- ✅ **RNG-1** Deterministic seeded RNG service (one seeded stream; replaces `Math.random` in dice/DAC/to-hit).
- ✅ **SEAL-1** Sealed-simultaneous fire: server holds committed fire, reveals only when all fleets locked, resolves **authoritatively** (not on one client), broadcasts results.
- ⬜ **DAC-1** *(deferred — optional v1 flag)* Critical hits (C7) on internal damage (the DAC "excess/critical" outcomes).
- ✅ **REP-1** Repair phase (C7): apply `damageControl` allocation at phase 8 to restore boxes.
- ✅ **REC-1** *(audit-pass — no code needed)* `resolveEnergy` already carries the phaser capacitor (H6.21, foldEaf), re-arms from the new column, and resets movement/EW/battery every turn; heavy-weapon re-arm is handled by `armedOk`'s turn comparison; capacitor carryover is covered by existing energy-model tests. Rack reload is N/A until SEEK-1.

### P1 — Tournament-complete mechanics
- ✅ **LOCK-1** Phase-4 lock-on: roll per turn (deterministic from seed+turn), net ECM can deny a lock, enforced in fire resolution.
- ✅ **EW-1** ECM/ECCM combat effect (C8): net ECM shifts effective range in both fire resolution and the targeting preview.
- ⬜ **SEEK-1** Seeking weapons (C5): drone/plasma launch (6B), seeking movement on the Impulse Chart (6A), tracking/lock, impact resolution → DAC. Racks, reloads, plasma bolt/enveloping.
- 🟡 **ROSTER-1** Complete the four-empire v1 roster (verify **Kzinti** CA; finish/annotate all weapon arcs; confirm clean audits).
- ⬜ **TERR-1** Terrain slice (C9): tournament-map barrier edge (P17) + asteroid fields (P3); movement/LoS effects.

### P2 — Breadth (rounds out "faithful", optional to first-finish)
- ⬜ **SHUT-1** Admin/suicide shuttles, wild weasel, scatter-packs (C6 v1 slice).
- ⬜ **MINE-1** Transporter bombs, boarding parties / hit-and-run, self-destruct, transporters (C10 v1 slice).
- ⬜ **SOP-1** Activate remaining segments (6B activity, 6E post-combat announce, phase-3 self-destruct); 6C dogfight stays deferred (needs C6).

---

## 3. Integration spec (per work item)

Each item: **design → files → data → UI → tests**, written to drop into the existing seams.

### RNG-1 — Deterministic seeded RNG  *(P0, foundational — do first)*
- **Design.** One tiny PRNG module (e.g. mulberry32) seeded per game from a value stored in
  `_battle.json` (`seed`) and advanced by a persisted `rngCursor`. All dice draw from it, so a given
  battle resolves identically for both clients and is replayable.
- **Files.** New `viewer/rng.js` (`makeRng(seed)` → `next()`, `roll(nSides)`, `d6()`); thread a `roll`
  fn through `resolveAttackPlan` (already accepts `rand`), `makeDice`, and any future resolver. Store
  `seed` + `rngCursor` in `_battle.json`; `serve.py` returns them in `battle_view`.
- **Data.** `_battle.json`: `seed:int`, `rngCursor:int`. Combat resolution increments the cursor.
- **UI.** None (invisible), except an optional "seed" line in a debug/GM view.
- **Tests.** `rng.test.mjs`: same seed → same sequence; cursor advance is monotonic. Update
  `direct-fire.test.mjs` to pass a seeded fn and assert fixed outcomes.

### SEAL-1 — Server-authoritative sealed fire  *(P0)*
- **Design.** Fire is already committed per fleet (`committed`), but each client resolves its own plan
  (`fireNow`). Move resolution to the **reveal moment on the server**: when all required fleets are
  locked for `6D1`, `serve.py` runs the deterministic resolver (shared logic) and appends `lastFire`
  results, which both clients then apply. This preserves simultaneity and hides intent (fog) until
  reveal. Keeps the existing `committed`/`rev` optimistic-locking model — no new transport.
- **Files.** Factor the pure resolution (`resolveAttackPlan` + DAC) so it can run in `serve.py` via a
  small Node shim, **or** designate a deterministic "resolver of record" (creator fleet) and have the
  other client verify against the shared seed. Recommended: keep resolution in JS, run it in a
  headless `node` child process from `serve.py` at reveal (mirrors the existing scan-subprocess
  pattern), write results to `_battle.json`.
- **Data.** `_battle.json`: `sealedFire: { <fleet>: FireIntent[] }` (fog-gated in `battle_view`),
  `lastFire: { volleys[], rngCursorAfter }`. Reveal clears `sealedFire`.
- **UI.** Existing "LOCK / commit" flow; add a "waiting for opponent" state on the fire button when
  committed-but-not-revealed (mirror the energy lock UX).
- **Tests.** `sealed.test.mjs`: two intents → single deterministic reveal; a late commit doesn't let a
  fleet see the other's intent (fog assertion on `battle_view`).

### DAC-1 — Critical hits  *(P0)*
- **Design.** Extend `applyVolley` so that internal-damage allocation rolls the C7 critical-hit
  outcomes (e.g. a struck system's follow-on effect) via the seeded RNG, emitting `critical` effects
  alongside `destroy`. The effect list is already the return contract the UI plays back.
- **Files.** `dac-allocator.js` (`applyVolley` → add crit rolls + `{type:'critical', …}` effects);
  `battle.html` fire-apply loop already iterates `v.effects` — handle the new type (mark + animate).
- **Data.** Effect `{type:'critical', system, boxId, severity}`; ship state unchanged (uses `status`).
- **UI.** Distinct marker/toast for a critical in the fire summary + on the SSD (respect the tac-intel
  damage filter already in `ssd.html`).
- **Tests.** Extend `allocator.test.mjs`/`dac.test.mjs` with seeded crit fixtures from the rulebook.

### REP-1 — Repair phase  *(P0)*
- **Design.** At phase 8 (`record`) resolver, spend each ship's `damageControl` allocation to restore
  destroyed boxes per the repair rules (priority order, points→boxes). Runs automatically as an
  `advance()` "ran" segment side-effect.
- **Files.** New `viewer/repair.js` (`applyRepair(ship, points)` pure); call from the phase-8 host
  hook in `battle.html`; `battle-phase.js` already stops/runs `record`.
- **Data.** Reads `eaf[ship].damageControl`; mutates `s.status` (un-destroy boxes).
- **UI.** A repair line in the end-of-turn summary; SSD boxes visibly restored.
- **Tests.** `repair.test.mjs`: N points restore the correct boxes in priority order; capped at rating.

### REC-1 — Record-keeping wiring  *(P0, mostly audit)*
- **Design.** Confirm phase-7/8 housekeeping: phaser-capacitor carryover into next turn (H6),
  heavy-weapon/rack reload, `firedAt` clear, `hexesSinceTurn`/turn-mode reset, EAF reset to the
  default column. Fill any gaps.
- **Files.** `battle.html` turn-boundary code + `energy-model.js` `newEafColumn(carried)`.
- **Tests.** `record.test.mjs`: capacitor carry-over equals leftover; reload flags reset.

### LOCK-1 — Sensor lock-on  *(P1)*
- **Design.** Give the `lockon` segment a resolver: each ship declares intent to lock a target;
  resolve with a die (fixed-lock tournament option = auto-success is acceptable for v1, but model the
  step). Store `lockOn[shipId] = true | Set<targetId>` (the shape `hasLockOn` already expects) and
  **gate fire** on it in `resolveAttackPlan` / `eligForTarget`.
- **Files.** `battle-phase.js` (`hasLockOn` exists); host resolver in `battle.html`; add the gate to
  `direct-fire.js`/`fire-plan.js` (a mount is ineligible if no lock on its target).
- **Data.** `_battle.json` `lockOn` map (fog-gated: you see your own locks).
- **UI.** A brief phase-4 step in the clock; a "no lock" reason in the targeting panel (reuses the
  existing per-mount eligibility pills).
- **Tests.** `lockon.test.mjs`: fire blocked without lock; allowed with lock.

### EW-1 — ECM/ECCM combat effect  *(P1)*
- **Design.** Compute net EW shift per firer↔target (`target.ecm − firer.eccm`, floored at 0, plus
  lent EW later) and add it to **effective range** in the range→damage lookup, matching the existing
  `weapon-charts.js` range bands. Reflect it in the D5 targeting preview.
- **Files.** `direct-fire.js`/`fire-plan.js` (effective-range calc), `weapon-charts.js` (lookup by
  effective range), the fire-summary/targeting render in `battle.html`.
- **Data.** Reads `eaf[ship].ecm/eccm` (already columns).
- **UI.** Show "range 8 (+3 ECM = eff 11)" in the fire summary; the modal already labels data points.
- **Tests.** `ew.test.mjs`: ECM raises effective range → lower damage bracket.

### SEEK-1 — Seeking weapons (drones + plasma)  *(P1, largest)*
- **Design.** New tokens that live on the map and move on the Impulse Chart, reusing `course-plan.js`.
  - **Launch (6B):** an armed rack / plasma launcher declares a launch at a target; creates a seeker
    token (owner, speed, target, warhead, endurance).
  - **Move (6A):** seekers advance via the same `movesOnImpulse`/turn logic as ships (drones speed 8/20/32
    by type; plasma has a speed + fade). Homing turns toward the target each impulse.
  - **Impact (end-6A / adjacency):** on reaching the target hex, resolve damage → DAC (reuses volley
    path); plasma applies distance-fade; drones apply warhead points. Anti-drone / point-defense fire
    (phaser-3/ADD) can kill drones in 6B/6D.
  - Endurance/tracking failure retires the token.
- **Files.** New `viewer/seeking.js` (pure: `launchSeeker`, `stepSeeker`, `resolveImpact`) + tests;
  `battle-map.js` renders seeker tokens + their vectors (extend `plotOverlaySvg`/token loop);
  `battle-phase.js` 6A/6B resolvers call it; arming lives in the EAF (rack/launcher already on SSDs via
  `ship-loadout.js`). Reuse `dac-allocator.js` for impact damage.
- **Data.** `_battle.json` `seekers: [{id, owner, q, r, facing, speed, type, warhead, targetId, endurance}]`
  (visible to both sides once detected, per tac-intel). `firedAt`/rack state tracks reloads.
- **UI.** Launch control on the map/weapons panel when a rack is armed + a target set; drone/plasma
  tokens with heading arrows (reuse the ship-glyph renderer); point-defense as a fire option.
- **Tests.** `seeking.test.mjs`: a speed-20 drone reaches an adjacent target in the right impulses;
  plasma fade by range; drone killed by ADD before impact.

### ROSTER-1 — Four-empire roster  *(P1, mostly data)*
- **Design.** Bring the Kzinti tournament cruiser to "v1-ready" (scan → verify → clean audit with all
  weapon arcs) via the existing `verify.html` pipeline; re-audit FED/KLI/GOR arcs. No engine code.
- **Files.** `data/KZI-*/` (scan+verify); optionally `scenario.js` presets for the tournament matchups.
- **Tests.** The existing `/api/audit` clean gate; add the ship to a scenario smoke test.

### TERR-1 — Terrain slice  *(P1)*
- **Design.** Add a terrain layer to the map: the **tournament barrier** (map-edge damage/turn-back)
  and **asteroid fields** (movement cost / blocked LoS / random damage). Terrain is board data the
  movement + fire resolvers consult.
- **Files.** New `viewer/terrain.js` (pure: `inBarrier`, `blocksLoS`, `asteroidAt`); `battle-map.js`
  renders it; `course-plan.js`/`direct-fire.js` consult it (LoS for fire, cost/turn-back for move).
- **Data.** `_battle.json` `terrain: {barrier, asteroids:[{q,r}]}` seeded at battle create.
- **UI.** Render asteroids + barrier ring; a scenario toggle in the new-battle dialog.
- **Tests.** `terrain.test.mjs`: LoS blocked through asteroid; barrier flags an edge hex.

### SHUT-1 / MINE-1 / SOP-1 — Breadth  *(P2)*
- **SHUT-1.** Shuttle tokens (admin/suicide) + wild weasel (decoy that seekers chase) + scatter-pack
  (drone bundle). Reuses SEEK-1 token + movement machinery; launch in 6B.
- **MINE-1.** Transporter bombs / mines as static tokens with trigger radius; boarding parties &
  hit-and-run as a 6B action resolving via seeded dice against the target's crew/security boxes;
  self-destruct in phase 3. Transporter use gated by the EAF `transporter` column (already present).
- **SOP-1.** Wire the remaining `battle-phase.js` segments to the above resolvers; keep 6C dogfight
  deferred until C6 fighters exist.
- **Tests.** One `*.test.mjs` per pure module (weasel diverts a drone; mine triggers in radius;
  boarding roll resolves).

---

## 4. Suggested build order

1. **RNG-1** (unblocks fair/repeatable everything).
2. **SEAL-1** (authoritative reveal) + **DAC-1 criticals** + **REP-1 repair** + **REC-1** → the core
   duel loop is *correct and fair*.
3. **LOCK-1** + **EW-1** → fire is rules-complete.
4. **SEEK-1** → drones/plasma (the biggest gameplay addition).
5. **ROSTER-1** + **TERR-1** → a real tournament duel is playable end-to-end.
6. **P2 breadth** (SHUT-1 / MINE-1 / SOP-1) as desired.

Each step ships behind the existing verify-in-browser + `node --test` discipline and a commit per
sub-step, exactly as the current codebase is built.

## 5. Decisions (resolved 2026-07-07)
1. **Lock-on:** **roll for lock** in v1 (a real phase-4 attempt, not auto-lock). → `LOCK-1`.
2. **Sealed-fire transport:** the **simpler designated-client-of-record + shared seed** — played
   among friends locally, cheating is not a concern, so no `node`-child server resolver. The battle
   creator's client resolves at reveal from the shared seed and writes `lastFire`; the other client
   applies it. → `SEAL-1`.
3. **Roster:** add **Kzinti** *and* **Romulan with cloaking (G13)** — Romulan is poorly balanced
   without the cloak. → `ROSTER-1` + new `CLOAK-1`.
4. **Breadth:** "finished" = **P0 + P1 + P2** — shuttles and mines are in. → `SHUT-1`, `MINE-1`.
5. **Map:** add a **scenario picker** (open vs. tournament barrier + asteroids). → `TERR-1`.

**Added to the P1 checklist by these decisions — `CLOAK-1`** Cloaking device (C8/G13): cloak/decloak
states, the two-way ECM/range penalties, fire restrictions while cloaked, and the cloaked-detection
tie-in with the existing tac-intel model. Unlocks a playable Romulan.

## 6. Build order (approved — implementing now, strict TDD)
RNG-1 → SEAL-1 → DAC-1 → REP-1 → REC-1 → LOCK-1 → EW-1 → SEEK-1 → CLOAK-1 → ROSTER-1 → TERR-1 →
SHUT-1 → MINE-1 → SOP-1. Each: failing `*.test.mjs` first, minimal green, refactor, browser-verify
the UI slice, commit.
