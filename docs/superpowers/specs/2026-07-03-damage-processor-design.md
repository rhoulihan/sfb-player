# SSD Damage Processor — Design Spec

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Module:** `ssd-pipeline/` (SSD tooling)

## 1. Summary

Add a player-facing **Damage Processor**: an "Apply damage" control that takes a struck
shield facing and a volley of damage points, simulates the Star Fleet Battles **Damage
Allocation** process (D3.4–D4.4) — shields → armor → internal systems via the Damage
Allocation Chart (DAC) — and updates the SSD display so every affected box (destroyed
systems, depleted shields, degraded rating tracks) reflects the result. Dice are rolled
internally; the user sees the *result* applied at an adjustable rate, not every roll.

The processor is a **new player view (`damage.html`)** built on a **shared rendering
engine** factored out of the existing editor (`verify.html`). The DAC is implemented at
**full fidelity**. Per D4.324 the DAC never touches crew/boarding/deck-crew/cloak/ammo,
so those are shown but never decremented (the mechanics that *do* reduce them — boarding
and hit-&-run — are a later, separate feature).

## 2. Goals / Non-goals

**Goals (v1)**
- Faithful DAC internal-damage allocation for a single ship loaded from its `verified.json`.
- Shield depletion, armor, and the full internal DAC with all restriction rules (§7).
- Optional **Leaky Shields** rule (D3.6) with selectable rate (every 4th / 6th / 10th).
- Adjustable application **speed** (slow / medium / fast / instant).
- Live SSD display of resulting box states; concise end-of-volley summary.

**Non-goals (v1)**
- No energy allocation / shield reinforcement / batteries-as-reinforcement (shields are
  just their printed boxes). Noted as a later layer.
- No boarding parties / hit-&-run / crew loss (crew & boarding shown, never touched).
- No chain-reaction explosions (D12), scatter-packs, or special-unit DACs (fighters, PFs,
  bases, Andromedan PA panels).
- No manual per-hit owner prompts — owner choices are auto-resolved with sensible defaults.
- Single ship at a time.

## 3. Rules basis (Captain's Master Rulebook)

| Rule | Content used |
|------|--------------|
| D3.4 | Which shield is struck (input to us: the user picks it). |
| D3.6 / D3.61–63 | Leaky shields: every Nth penetrates; on shield-down, leaked + excess merge into one internal volley. Worked example D3.63. |
| D4.11–13 | Volley hits shields, then armor, then internals. |
| D4.12 | Armor: each penetrating point destroys one armor box before internals. |
| D4.22 / D4.221–223 | Per-point 2d6 → DAC row → walk columns A,B,C… to first live target; mark one box destroyed. |
| D4.31 | **Bold** results (control boxes) may be scored only **once per volley** per chart position. |
| D4.321 | **Phaser directional**: a phaser is hittable only if it bears toward the struck shield. |
| D4.3221/2 | Every **3rd** phaser/torpedo hit in the volley must go to the best available type. |
| D4.323 | `TORP` = disruptor/photon/plasma/plasma-D/fusion/TR boxes; `DRONE` = drone rack/ADD/ESG/PPD/hellbore/web/PA-panel. |
| D4.324 | `any weapon` cannot be scored on crew, boarding party, deck crew, cloak, shuttle-dp, or ammo track. |
| D4.33 | Special-function tracks (sensor/scanner/damcon): destroyed **in order**, highest first; the **last box is never destroyed**. |
| D4.351 | Hull F/R/C: F-hits can't land on R hull and vice-versa; if only C hull remains, F/R hits must land on C. Barracks/Repair destroyed by hull hits. |
| D4.352 | Warp L/R/C designations are honored; skip a side the ship lacks. |
| D4.36 / D4.40 | Excess damage → cargo/repair/mine may absorb; when none remain, one more excess hit **destroys** the ship. |
| D4.5 | Worked example (D7, 25 internal hits) — used as the correctness test vector (§11). |

## 4. Architecture

### 4.1 Shared engine — `ssd-pipeline/viewer/ssd-engine.js`
Extract the pure, already-working rendering primitives out of `verify.html`:
- Taxonomy: `TAX`, `FAMCOL`, `FAMNAME`, `CATS`.
- Layout math: `med`, `globalCell`, `layoutGroup`, `isWide`, `boxRect`, `inkFor`.
- Base draw: `renderSSD(svgEl, {boxes, groups, groupOf, labels, status, IMGW, IMGH, opts})`
  — draws uniform cells, family (or status) fill, consistent borders, double-width dividers,
  and cell labels. Returns nothing; caller layers its own overlays on top.

`verify.html` is refactored to call the engine for its base draw and keep only its
editor-specific overlays (selection rings, current-group halo, dblclick label edit,
tooltips). **Acceptance gate: verify.html is visually and behaviorally unchanged after the
extraction** (re-verified via Playwright) before any damage work builds on it.

### 4.2 Player view — `ssd-pipeline/viewer/damage.html`
Loads `detection.json` + `verified.json` + `/api/labels/<ship>`, builds the ship model
(§5), renders via the engine with a **status map**, and hosts the Apply-damage panel (§8).
Pure client-side; no server changes required for v1 (the existing static server serves it).

## 5. Ship model (from `verified.json`)

Build once on load from the verified groups:

- **Shields**: the six `shield`-family groups, mapped to facings **#1–#6** by their `type`
  ("Shield 1"…"Shield 6"). Each shield = `{max, downCount}` over its box pool.
- **Armor**: `armor`-family groups → an armor box pool.
- **Internal pools**, keyed by DAC token, each an ordered list of box ids with a destroyed
  set:

  | DAC token | Source family / type | Notes |
  |-----------|----------------------|-------|
  | `IMPULSE` | `impulse-engine` | |
  | `L WARP` / `R WARP` / `C WARP` | `warp-engine`, split by type "Left/Right/Center Warp" | D4.352 |
  | `APR` | `apr` | |
  | `BATT` | `battery` | |
  | `PHASER` | `phaser` | directional + every-3rd-best |
  | `TORP` | `heavy-weapon` | every-3rd-best by weapon type |
  | `DRONE` | `drone-rack` (+ `anti-drone`,`esg`) | D4.323 |
  | `BRIDGE`/`FLAG`/`EMER`/`AUX` | `bridge`/`flag-bridge`/`emergency-bridge`/`auxiliary-control` | **bold** |
  | `SEC` | `security-station` | Flag/Aux hits may score here |
  | `SENSOR`/`SCANNER`/`DAMCON` | `sensor`/`scanner`/`damage-control` | special tracks (keep last) |
  | `F HULL`/`R HULL`/`C HULL` | `hull`, split by type "Forward/Rear/Center Hull" | D4.351 |
  | `LAB`/`TRANS`/`TRAC`/`PROBE`/`SHUTTLE` | `lab`/`transporter`/`tractor`/`probe-launcher`/`shuttle-bay` | |
  | `EXCESS` | `excess-damage` | |
  | `CARGO`/`REPAIR`/`MINE` | `cargo`/`repair`/`mine-rack` | excess absorbers (D4.40) |

- **Never-targets** (rendered, immutable in v1): `crew`, `boarding-party`, `ammo-track`,
  `cloaking-device`, `markers`.

If a ship lacks a pool, DAC column-walk skips it (D4.35).

## 6. DAC chart data

`ssd-pipeline/data/dac.json` — the standard Captain's-Edition DAC as a lookup:

```json
{ "2":  [ {"sys":"BRIDGE","bold":true}, {"sys":"FLAG","bold":true}, ... ],
  "3":  [ {"sys":"DRONE"}, ... ],
  ...
  "12": [ {"sys":"AUX","bold":true}, ... ] }
```

Each row is the ordered column list (A,B,C…) for that 2d6 result; `bold:true` marks a
once-per-volley position (D4.31). Tokens use the §5 vocabulary. Hull/warp tokens carry
their F/R/C · L/R/C designation.

**Sourcing:** the DAC is a graphic "separate sheet," not extractable text. It will be
rendered to PNG from the owner's PDF (Basic Set / rulebook chart page) and transcribed by
hand into `dac.json`, then **validated by replaying the D4.5 worked example** (§11) — if our
table + allocator reproduce the book's 25 listed results, the transcription is correct.

## 7. Allocation algorithm

`applyVolley({shield, points, leaky, leakRate, speed})` produces an ordered list of
**effects** (box destroyed / shield reduced / track degraded / ship destroyed), which the
UI then plays out at `speed`.

### 7.1 Shield phase (+ leaky, D3.6)
- **Leaky off:** deplete shield `#S` up to its remaining strength; `internal = points - depleted`.
- **Leaky on (D3.61–63):** iterate the volley; every `leakRate`-th point is set aside as
  *leaked*; the rest deplete the shield. Once the shield is destroyed, all further points are
  *excess*. `internal = leaked + excess`, resolved as **one** volley (D3.62). (Matches D3.63:
  45 pts, 30-pt shield, rate 4 → 15-pt internal volley.)

### 7.2 Armor phase (D4.12)
Consume `internal` points 1:1 against armor boxes until armor is gone; the remainder are the
internal DAC points.

### 7.3 Internal DAC phase (D4.22)
Volley-scoped state: `boldUsed:Set`, `phaserHitIdx`, `torpHitIdx`.
For each internal point:
1. Roll 2d6 → `row = DAC[roll]`.
2. Walk `row` left→right; take the **first** column whose token has a valid live target under
   the restriction checks (§7.4–7.8). "Valid" also enforces:
   - **bold**: if `col.bold` and this chart position already used this volley → skip.
   - Mark one box in that pool destroyed; if bold, record the position in `boldUsed`.
3. If no column yields a target, the point is **excess** (§7.8).

### 7.4 Phaser directional (D4.321)
Map struck shield `#S` to its facing direction (flat-top hex, ship faces A):
`#1→A #2→B #3→C #4→D #5→E #6→F`. A phaser box is a valid target only if its group's arc
(from `arcDef` — reuse the arc-editor geometry `hexInNamed`/paint set) **covers the bearing
of shield S**. If no bearing-capable phaser exists, the `PHASER` column is skipped (fall to
next column). `any weapon` hits ignore this restriction.

### 7.5 Every-3rd-best (D4.3221/2)
Maintain a running phaser-hit and torpedo-hit counter across the volley. Every 3rd hit of
that class must be scored on the **best** available type (Ph-1 > Ph-2 > Ph-3; heavy-weapon
priority per Annex #7E ordering we encode). Otherwise, auto-pick any valid box (default:
worst type first, to preserve the best).

### 7.6 Special-function tracks (D4.33)
`SENSOR`/`SCANNER`/`DAMCON`: destroy the next box **in printed order** (highest rating
first). **Never** destroy the final box — if only one remains, the token has no valid target
(column-walk continues). Uses each track's box order (top→bottom / left→right by position).

### 7.7 Hull & engine designations (D4.351/2)
- Hull: `F HULL` targets forward pool; if empty but center hull exists, it **must** go to C
  hull; same for `R HULL`. `C HULL` may be taken by F or R hits. Barracks/Repair count as
  hull-destroyable.
- Warp: `L/R/C WARP` only targets that side; skip the column if the ship lacks it.

### 7.8 Excess & destruction (D4.40)
A point with no system target becomes **excess**: score on `excess-damage`; if none remain,
it may be absorbed by `cargo`/`repair`/`mine`; if none of those remain either, the ship is
**destroyed** (emit a terminal `SHIP_DESTROYED` effect and stop).

## 8. UI — `damage.html`

- **Display:** the SSD via the shared engine, with a **status map** coloring boxes by state
  (§9); a compact **shield readout** (`#1 24/30 … #6 0/24`, the struck facing highlighted).
- **Apply-damage panel:**
  - Shield selector `#1–#6`.
  - Volley size (integer).
  - Leaky-shields toggle + rate selector (4 / 6 / 10).
  - Speed selector: Slow / Medium / Fast / Instant (delay between applied hits).
  - **Apply** and **Reset** buttons.
- **Result summary** after a volley: shields depleted, armor lost, and a per-category tally
  of internals ("15 internal: 4 F-hull, 2 L-warp, 1 bridge, 1 Ph-3, 3 excess…"). No per-roll
  log.

## 9. Box-status visuals

Status map `status[boxId] ∈ {intact, destroyed}` (extensible later to `critical`/`repairing`).
- **intact** → family color (as today).
- **destroyed** → desaturated/greyed fill with a diagonal hatch or ✕, label dimmed.
- **shield boxes** → destroyed shield boxes rendered as "down" (empty/greyed) from the high
  end of the pool, so the shield visually depletes.
Rendered by the shared engine from the status map (no bespoke per-view redraw).

## 10. State & persistence

Damage state is **ephemeral** session state (`status` map + shield `downCount`s), driven by
the effect stream and cleared by **Reset**. v1 does not persist damage to disk (it's a live
simulator); a future "save battle state" can serialize the status map if wanted.

## 11. Correctness / testing

- **DAC replay test:** feed the exact 25 die rolls from the D4.5 example (6,7,9,2,7,4,10,7,8,
  11,7,6,3,8,5,7,8,4,5,10,12,7,9,7,2) through the allocator against a D7 model and assert the
  destroyed systems match the book's listed results (forward hull, warp, bridge, phasers,
  battery, impulse, drone rack, transporter, tractor, aux control, flag→security, lab, shuttle,
  etc.), including the bold-once and directional behaviors the example exercises.
- **Leaky test:** D3.63 — 45 pts, 30-pt shield, rate 4 → assert a 15-point internal volley.
- **Track test:** a track of N boxes can lose at most N−1; the last never destroyed.
- **Excess/destruction test:** a ship with no excess/cargo/repair/mine is destroyed by the
  next excess point.
- End-to-end: drive `damage.html` via Playwright, apply a volley, assert the status map and
  shield readouts.

## 12. Build sequence

1. Transcribe `dac.json` from the rendered chart; write the DAC replay test; iterate the
   table until D4.5 passes.
2. Extract `ssd-engine.js`; refactor `verify.html` onto it; re-verify verify.html unchanged.
3. Ship model builder from `verified.json` (§5) + pool mapping.
4. Allocator (§7) as a standalone, unit-tested module (§11) — shields/leaky, armor, DAC walk,
   restriction rules, excess/destruction.
5. `damage.html` — engine draw + status map + Apply-damage panel + speed-paced effect playback.
6. End-to-end verification; result summary polish.

## 13. Open questions / risks

- **DAC transcription accuracy** — mitigated by the D4.5 replay gate.
- **Ship-model completeness** — some verified ships may lack clean type strings for warp
  L/R or hull F/R/C; the builder falls back to position (left/right, fore/aft) when the type
  is ambiguous, and logs anything it can't classify.
- **Phaser-directional ↔ arc data** — depends on each phaser group having a usable `arcDef`;
  ships not yet arc-verified will treat phasers as any-direction (with a visible note).
