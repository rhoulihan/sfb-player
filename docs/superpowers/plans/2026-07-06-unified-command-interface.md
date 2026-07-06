# Unified Command Interface + Turn Engine — Implementation Plan (expanded)

> **For agentic workers:** implement task-by-task, **strict TDD** on engine logic (`node --test`),
> MCP-Playwright browser verification on map/UI interactions (no in-repo Playwright harness — verify
> through the live server at `http://127.0.0.1:8741`). Steps use `- [ ]` checkboxes; commit per task.

**Goal:** (A) Model the **real SFB Sequence of Play** (B2.2) — turn phases + the 32-impulse segment
sequence — as an explicit turn engine, replacing the 2-node `energy`/`impulse` machine. (B) Merge the
energy-allocation and battle maps into one phase-gated interactive command interface with map-based fire
planning driven by draggable "ghost" positions.

**Architecture:** four-way split of the monolithic `battle.html`:
- **`battle-phase.js`** (new) — the turn/segment state machine: an ordered `SEGMENTS` table, `advance()`
  with auto-advance + input gating, and pure gating predicates. Owns `clock` + turn-scoped caches.
- **`battle-map.js`** (new) — map render + geometry/hit-testing + all map gesture handlers + course
  plotting. `createBattleMap(ctx)`; owns its gesture state; emits intents via callbacks.
- **`battle-fire.js`** (new) — fire-plan game-state adapters + resolution, ghost-aware via an optional
  `posProvider`; keeps the real commit's persistent-model accumulation / `firedAt` / capacitor drain.
- **`battle.html`** (host) — orchestrator: `render()`, `save`/`applyRemote`/polling, the EAF console, the
  sidebars, and the shared `ui` state singleton.

**Tech stack:** plain ES modules, `node --test`, Python `serve.py`, MCP-Playwright. No new deps.

## Global Constraints

- No copyrighted rules prose / SSD art committed; images gitignored.
- `serve.py`'s `WEAPON_CHARTS_FUNCS` must stay in sync with `weapon-charts.js` (existing guard test).
- Per-ship optimistic locking + fog-of-war are the single source of truth — **all sync stays in the host**;
  map/fire modules operate on the *same* ship object identities `applyRemote` mutates (no copies).
- `applyRemote` can flip phase/plan/committed between frames — modules re-read `getPhase()`/`getClock()`
  every frame, never cache mode at init.
- Existing 85 tests stay green throughout.

---

## The turn/segment model (`battle-phase.js`)

Replace `phase ∈ {energy, impulse}` with a **segment cursor**. `clock = { turn, impulse /*0=setup,1..32*/,
phase /* segment id */ }`. The two working commit gates (energy lock, 6D fire) are preserved.

**`SEGMENTS[]` — one ordered descriptor drives everything** (ids per SFB Sequence of Play B2.2 + Annex #2):

```
energy(1,input) → speed(2,auto) → self-destruct(3,auto) → lockon(4,auto) → initial(5,auto)
→ [IMPULSE LOOP ×32:  6A1(auto) → 6A2(input:free-move) → 6A3(auto:seeker-impact) → 6A4(auto)
                      → 6B1..6B8(input; auto-skip when empty) → 6C(mixed; onlyIf imp%8===0)
                      → 6D1(input:fire+self-EW commit) → 6D2(auto:fire) → 6D3(auto) → 6D4(auto:damage)
                      → 6D5(auto) → 6E(input) ]
→ final(7,mixed) → record(8,auto) → turn++ → energy
```

Each segment = `{ id, kind, onlyIf(state)?, auto(state)→bool, gate(state)→bool, run(state) }`.

**`advance()`**: `seg = SEGMENTS[cursor]`; if `onlyIf && !onlyIf()` → skip; if `kind==='automatic' ||
auto()` (no pending player work) → `run()`, `cursor++`, **recurse** (chains auto segments in one press);
else **stop** and wait until `gate()` is true. Wrap: after 6E, `impulse++`; if `>32` run 7→8, `turn++`,
`impulse=1`, cursor=`energy`. **Fast path preserved:** "▶ step impulse" = advance() until it blocks or the
impulse rolls; "▶▶ step segment" = one advance().

**Turn-scoped caches:** `turnCache = { movementChart:{[imp]:[shipId]}, lockOn:{[id]:true|Set}, sensorRating }`
built at speed/lockon, reset at record. `perImpulse = { movesDone:Set, pendingInternal:[], seekerImpacts:[] }`
cleared each 6A.

**Gating predicates (pure, read-only)** the interface needs:
`canLockEnergy(fleet)`, `energyResolved()=allFleets(committed)`, `movesThisImpulse(ship)`,
`moveSatisfied()` (6A2 gate: every free mover placed its hex; autopilot auto-satisfies), `canFire(ship,target)`
(lock-on ∧ fire-control ∧ charged — **wire lock-on here, currently missing**), `canCommitFire(fleet)`,
`fireResolved()`, `segmentBlocked()` (drives the "waiting for other fleet" UI + disables ▶).

**Scope boundary — build the machine, stub the systems.** Today's build already covers phase 1 (full EAF +
lock), 6A2 movement (autopilot/plot), and a *fused* 6D1+6D2+6D4 commit-resolve. Everything else is a
segment whose `auto()→true` no-op the cursor streams past (self-destruct blast, lock-on roll, all 6B
launches, 6C, 6D3/6D5 crits). They drop in later with **zero machine changes**. See Appendix A for the full
implemented-vs-missing gap list.

**Deferred correctness refactors (own tasks, later — not the machine):** split 6D2(roll+mark shields, push
`pendingInternal`) from 6D4(drain internals via DAC) to open the reserve-power window and host seeker
damage; add the 6A3 seeker-impact hook. Keep the fused resolve inside 6D2 until reserve-mitigation/seeking
weapons exist. (Recorded so the segment table already has the slots.)

## Shared state contract

```js
const ui = { plotShipId:null, eaSelected:null, selectedId:null, activeId:null, rangeAnchor:null,
             dragging:null, targetId:null, fireGroup:[], ghosts:{}, ghostMode:false };
// clock (incl. phase segment id) lives in battle-phase.js; getPhase = () => clock.phase-family
```
`getPhase()` returns the coarse family (`energy` | `impulse`) for the map's energy/impulse fork, plus a
`getSegment()` for fine gating. `dragging` exposed for `applyRemote`'s mid-drag guard. `ghosts`/`ghostMode`/
`targetId`/`fireGroup` are new (Phases 3–4); **ghosts are ephemeral — never serialized**.

## Ghost seam

Arc/range/shield read `.q/.r/.facing` off whole ship objects — **3 injection sites**: `eligForTarget`,
`combinedPreview`, `resolveAttackPlan`. Ghost mode = pass ghost-cloned ship objects `{...ship, q, r, facing}`
(cleaner than a provider, per review) through the **preview path only**; the **real commit always uses live
positions** (drop `posProvider` from `direct-fire.js`). Preview must be **read-only**: it must NOT mutate
`reinfLeft` (reinforceOf) or run `pruneUnavailable` on the real plan — use throwaway shield/reinforce copies.

---

## Phase 0 — Turn engine `battle-phase.js` + shared `ui` migration  *(foundation)*

**Files:** Create `battle-phase.js`, `test/battle-phase.test.mjs`; modify `battle.html`.

- [ ] **0a. Shared `ui` object (committed migration, verified).** Introduce `ui`; migrate **all reads AND
  writes** of `plotShipId/eaSelected/selectedId/activeId/dragging` to `ui.*` (write-sites incl. remote flips).
  Acceptance: 85 node tests green + MCP-Playwright smoke of energy+impulse. *(review #7)*
- [ ] **0b. `SEGMENTS` table + `advance()` (TDD).** Write `battle-phase.test.mjs` first: from `energy`,
  advancing with all-fleets-locked auto-chains speed→…→initial→6A1 and stops at 6A2 when a free mover is
  unplaced; auto-chains 6A3→6A4→6B(empty)→(skip 6C off-8)→ stops at 6D1; after 6D1 commit auto-chains
  6D2→…→6E→ next impulse 6A1; wrap at impulse 32 runs 7→8→turn++→energy. Implement the table + `advance()`
  + `onlyIf`/`auto`/`gate`. `node --test`.
- [ ] **0c. Gating predicates (TDD).** `canLockEnergy/energyResolved/movesThisImpulse/moveSatisfied/
  canFire/canCommitFire/fireResolved/segmentBlocked` as pure fns of `(clock, ships, gates)`. Golden tests
  incl. `canFire` returns false without lock-on once lock-on is wired (0e). `node --test`.
- [ ] **0d. Adopt the engine in the host.** Replace `clock={turn,impulse}` + `phase` with the engine's
  `clock`; route `stepImpulse`→`advance()` (impulse-step), `lockEnergy`/`resolveEnergy` behind the
  energy/speed/lockon segments, `commitFiring`/`resolveAll` behind 6D1→6D4. Keep `getPhase()` returning the
  coarse family so existing energy/impulse UI branches keep working. MCP-Playwright: full turn cycle
  (allocate→lock→step 32 impulses→wrap→energy) unchanged in feel; the clock header shows `TURN·IMP·SEG`.
- [ ] **0e. Wire lock-on (phase 4) as the first real filled segment.** `turnCache.lockOn` = true for
  undamaged sensors (auto); `canFire` gates on it. Minimal but real — proves the machine hosts a rule.
  Golden test + MCP-Playwright (fire still resolves with lock-on present).

## Phase 1 — Extract `battle-map.js` + unify map + phase-gating + route-from-hex

**Files:** Create `battle-map.js`, `test/battle-map.test.mjs`; modify `battle.html`.

**Interface — `createBattleMap({ map, ui, getPhase, getSegment, getShips, byId, isMine, COLS, ROWS,
getMovementEnergy(id), setMovementEnergy(id,v), getPlan, eligForTarget, groupOfShip, requestRender,
saveSoon, onShipClick, turnAction, openSSD, clearPlot })` → `{ drawMap, plotOverlaySvg, buildGrid, applyZoom,
fitToShips, setZoom, pixelToHex, clickToHex, dispose }`.** *(ctx completed per review #1/#2: `getMovementEnergy`
replaces the `eafDraft`/`plotBase`/`powerOf` reach-through and returns the already-divided base speed;
`getPlan`/`eligForTarget`/`groupOfShip` are swappable providers so Phase 3 only changes their impl.)*

- [ ] **1a. Pure helpers + course cursor (TDD).** Move `pixelToHex`, `hexPath`, `rad`, `plotCursor`,
  `courseOf`, `speedPlotOf`, `ensureSpeedPlot`; route base-speed through `getMovementEnergy` (**no eafDraft
  in the module**). Unit-test `pixelToHex` (inverse of `hexCenter`), `plotCursor` slip/turn tracking. `node --test`.
- [ ] **1b. Draw pass with swappable fire-overlay providers.** `drawMap()` (ships + per-group line-of-fire/
  shield-arc via injected `getPlan`/`eligForTarget`/`groupOfShip`) + append `plotOverlaySvg()`; host
  `render()` calls it. MCP-Playwright screenshot parity, energy+impulse. *(review #2)*
- [ ] **1c. Gesture handlers as a unit.** Energy sideslip/plot/range/speed-change + impulse ship-drag +
  contextmenu; preserve `suppressClick↔plotDrag` ordering, both phase-gated mousedown listeners, `dragging`
  getter, window-listener non-duplication; `phase`→`getPhase()`, `render/save`→callbacks. MCP-Playwright all
  gestures per phase. *(review risks 1/2/4)*
- [ ] **1d. Route-from-selected-hex** with **explicit precedence** *(review #4)*: a bare click on an interior
  path hex = re-anchor + re-plot from there (truncate). Speed-change (Phase 2) is a **distinct affordance**
  (marker-glyph hit-test / modifier), tested before the truncate branch so a path-hex click does exactly one
  thing. MCP-Playwright.

## Phase 2 — Speed-change on path hex (allocation only)

- [ ] **2a.** Allocation phase, distinct speed-change affordance on a path hex → drop a marker glyph
  (`setSpeedChange`); does not collide with 1d re-anchor. Battle: no-op.
- [ ] **2b.** Click an existing marker → speed-change popover (replace blocking `prompt()`);
  recompute `hexesInPlot`→`setMovementEnergy`. MCP-Playwright: marker vs re-anchor disambiguated; battle shows neither.

## Phase 3 — Fire group + target on the map + pop-out right pane

- [ ] **3a. `battle-fire.js`:** move `isCharged/armedOk/isPhaser/HEAVY_CLS/PHASER_FIRE_COST/eligForTarget/
  pruneUnavailable/autoSelectShip/alphaStrike` given `{byId, clock, saveSoon, buildShipModel}`; **rewrite**
  `onShipClick` (not just move) to the full fire-group lifecycle. Ghost-clone support added in 4. `node --test`
  eligibility golden vectors. *(review #6 keeps commit side-effects in the host resolve path.)*
- [ ] **3b. Map fire-group lifecycle** *(review #5)*: click friendly → add to `ui.fireGroup` + route subject;
  **re-click friendly → remove from group** (route subject independent); **click empty hex / Esc → clear group**;
  **shift-click enemy → set `ui.targetId`** (shift-click empty hex still measures range); clearing target
  collapses the pane. Define all four gestures explicitly. MCP-Playwright.
- [ ] **3c. Right pane — collapsed by default, pops out when `ui.targetId` set** (weapon-target toggles:
  per-weapon in-arc/in-range + mode from the folded EAF). Collapses on clear. MCP-Playwright.

## Phase 4 — Ghosts + ghost-based nominal (ephemeral, modal-clear)

- [ ] **4a. Ghost data + interaction.** Drag a fire-group ship / the target → `ui.ghosts[id]={q,r,facing}` +
  set `ui.ghostMode=true`; rotate affordance sets facing; render ghost glyphs. **A prominent "✓ Clear
  ghosts to continue" control appears whenever a ghost exists**; ghosts are ephemeral (not saved/synced).
- [ ] **4b. Modal-clear gating** *(user decision):* while `ui.ghostMode`, **suspend** the real fire-group
  mechanics and block every other action until ghosts are cleared. Clearing removes all ghosts + `ghostMode`.
- [ ] **4c. Ghost-based nominal (TDD).** `eligForTarget` + `combinedPreview` accept ghost-cloned ships;
  golden test: same plan → different nominal/struck-shield under ghost vs live; ghost preview does **not**
  mutate `reinfLeft` or prune the real plan (throwaway copies). `direct-fire.js` real resolve unchanged /
  identity-only. `node --test` + MCP-Playwright (drag/rotate recompute; commit uses live positions).

## Phase 5 — Floating summary modal (replace bottom tray)

- [ ] **5a.** Summary modal pinned near the target: per-shield-facing nominal totals, live on ghost-move /
  weapon-toggle (reuses `combinedPreview` with ghost clones).
- [ ] **5b.** Remove the bottom tray; impulse real-fire result log stays. MCP-Playwright.

## Phase 6 — Battle-mode wiring

- [ ] **6a. Read-only EAF in battle** — `renderEnergy` disabled when not in the energy segment; opened via
  **right-click ship → View EA** (alongside View SSD).
- [ ] **6b. Virtual fire groups in battle** — map fire-planning in battle writes `ghostMode`/virtual state
  **never** serialized into committable `plan.groups`; the real commit (6D1) path is untouched, live
  positions. Autopilot paths render for selected ships in battle.
- [ ] **6c.** Confirm the full gating matrix (spec §1) across energy / impulse-move / 6D-commit via
  MCP-Playwright; gate resolve-time restrictions on the **committed** signal, not a fake direct-fire phase
  *(review #3)*.

## Testing

- `node --test`: `battle-phase` (SEGMENTS/advance/predicates, golden turn walks), `battle-map` pure helpers,
  `battle-fire` eligibility + ghost-vs-live no-mutation. Existing 85 stay green.
- MCP-Playwright: spec §1 matrix; the refactor risks (sideslip-not-double-firing; phase-gated dispatch;
  no drag-clobber during poll); full turn cycle through the segment engine.

## Appendix A — implemented vs missing (scope boundary)

**Implemented:** phase 1 EAF (full, lock), course/speed/sideslip plotting, 6A2 movement (autopilot),
fused 6D1+6D2+6D4 fire commit/resolve vs pre-fire cached models.
**Partial:** phase 2 speed-determination (silent in resolveEnergy), phases 7/8 (collapsed into the wrap).
**Missing (segment stubs / future):** self-destruct blast (3), sensor lock-on roll (4 — 0e wires the flag),
initial activity (5), 6A1/6A3/6A4, all of 6B (cloak/EW-lending/systems/scout/seeking-launch/transporter/
shuttle), 6C dogfight, 6D1 per-impulse self-EW change (+8-impulse lock), 6D2/6D4 split + reserve window,
6D3 web / 6D5 crits, 6E. Each is a segment `run()` added later with no machine change.
