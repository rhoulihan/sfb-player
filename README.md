# SFB Player

A browser-based, rules-faithful implementation of **Star Fleet Battles** — the tactical
starship-combat game. It runs the real **Sequence of Play** turn/impulse engine end to end:
energy allocation, plotted movement on a hex map, heavy-weapon arming, simultaneous
direct fire resolved through the actual **Damage Allocation Chart**, seeking weapons, tractor
beams, cloaking, electronic warfare, criticals, repair, and more — for solo play or
networked multiplayer with per-fleet commander codes and fog of war.

Every mechanic is annotated with its governing rule number (e.g. `C3.31`, `D4.321`, `H7.4`)
so the code reads against the rulebook, and the rules engine is covered by a **251-test**
`node --test` suite with zero dependencies.

> **Status:** playable now in the browser (`battle.html`) against the local server. It began
> as an SSD-verification pipeline + a damage-allocation engine and has grown into a near-complete
> tactical-combat implementation. The 7-ship v1 roster (Federation, Klingon, Romulan, Gorn,
> Kzinti cruisers) is fully set up; more SSDs are inventoried in the pipeline.

---

## ⚠️ You must own the source material

*Star Fleet Battles* rules text and SSD artwork are © **Amarillo Design Bureau, Inc.** This
repository does **not** distribute that expressive content — no SSD page images, no rules
prose, no scanned rulebook/chart images (`git ls-files` tracks **zero** `.png`/`.pdf`). It
contains only our own **structural metadata** (box coordinates, system-family
classifications, firing arcs, box labels) and the **functional game-mechanics data** the
engine needs — the Damage Allocation Chart, the direct-fire weapon damage charts, and the
Master Ship Chart values (movement cost, size class, turn mode, explosion strength, breakdown
rating) — transcribed as data from material **you own**. SSD page images and the rulebook PDFs
are **regenerated locally from your own copies** and are `.gitignore`d.

Buy the products this project uses from the publisher's store, **Warehouse 23**:

| Source | Used for | Buy at Warehouse 23 |
|--------|----------|---------------------|
| SFB: Basic Set SSD Book (Color) | the ship SSDs | [product page](https://warehouse23.com/products/star-fleet-battles-basic-set-ssd-book-2011_color) |
| SFB: Captain's (Electronic) Master Rulebook | the rules (movement, combat, DAC…) | [product page](https://warehouse23.com/products/star-fleet-battles-electronic-master-rulebook) |
| SFB: Module G3 (Master Annexes) | the Master Ship Chart + Cost-of-Repair annex | [collection](https://warehouse23.com/collections/amarillo-design-bureau) |

---

## What's implemented

The engine walks the SFB **Sequence of Play** (`battle-phase.js`) one segment at a time and
dispatches each segment's resolver. Every system below is annotated with its rule number and,
where it is pure logic, unit-tested.

**Turn structure & energy**
- Sequence-of-Play driver over the real phase/impulse order (B2.2) — energy → movement →
  seeking impact → direct fire → post-combat → record-keeping.
- **Energy Allocation Form** — power derived from each ship's SSD boxes (`energy-model.js`):
  warp/impulse/APR output, batteries, phaser capacitor, weapon arming, shield reinforcement,
  ECM/ECCM, tractor/transporter/lab power, reserve/contingent power (H7), with a live balance
  meter and a sealed per-fleet **Lock**. Warp-source gating (C2.11/C2.112/H7.41), the 30-warp
  movement limit, and the per-ship life-support/size-class costs are all enforced.

**Movement**
- 32-impulse movement chart, odd-q flat-top hex grid, per-category **Turn Mode Chart**
  (C3.31, categories AA–F), mid-turn speed changes (C12), plotted courses with autopilot.
- **High Energy Turns** (C6) — snap-turn ignoring turn mode, with the C6.51 breakdown roll.
- **Emergency Deceleration** (C8) and **tractor towing** slowdown (G7.36B).

**Direct fire**
- Per-mount fire groups (split-fire across groups), weapon arcs (base + combined + plasma
  swivel, with painted SSD exceptions, D2/D4.321), the direct-fire weapon charts read at true
  and effective range, photon **overload** and **proximity** modes, point-blank feedback.
- **Electronic warfare** as a die-shift (D6.3/E1.82 — ECM/ECCM shift the roll, they don't add
  range), **lock-on** (D6.1) with the failed-lock double-range rule (D6.123), and cloak/terrain
  lock denial.
- Resolution stacks hits by struck shield into combined volleys (D4.34) and applies each
  through the **Damage Allocation Chart** engine (D3.6–D4.4), validated cell-for-cell against
  the rulebook's D4.5 worked example — including leaky shields, armor, excess damage, the
  every-3rd-weapon rules (D4.322), and optional D8 **critical hits**.

**Seeking weapons, mines & boarding**
- Drones (rack rate-of-fire per type, FD3), plasma torpedoes (multi-turn arming, warhead
  aging, phaser weakening FP1.611), scatter-packs, suicide shuttles (3-turn arming), wild
  weasels; seeker control channels (F3.21) and point defense (phasers + anti-drones).
- Nuclear space mines (neutral, with arming delay, M2), transporter bombs and hit-and-run
  boarding raids (D7/D15/G8), each costing transporter energy and honoring shield state.

**Ships & systems**
- **Tractor beams** (G7) — lock/tow/rotate, negative-tractor break, beam lockout.
- **Cloaking devices** (G13) — per-ship energy cost, fire-control reactivation delay, the
  cloak ECM shift.
- **Shields** — reinforcement (general/specific), reactive reserve-power reinforcement before a
  volley applies (H7.134), and voluntary shield-drop for transporters that auto-raises after
  its 8-impulse minimum (D3.51).
- **Criticals** (D8), **damage repair** (continuous D9.7 with Annex-#9 costs, emergency damage
  repair D14 with player-chosen targets), and **self-destruction / combat explosion** (D5.12,
  with chain reactions).
- **Tactical intelligence** (D17) — a detection-level model that filters what you see of an
  enemy ship by effective range and EW.

**Play**
- **Solo** (drive both fleets via a perspective switch) or **multiplayer** — join a fleet with
  a commander code, fog of war on the enemy, ship-level optimistic locking, and commit-based
  simultaneous 6D fire over the local server's save/poll channel.

---

## Getting set up

1. **Buy & download** the PDFs above and drop them in a local (git-ignored) folder, e.g. `./SFB/`.
2. **Regenerate the SSD images from _your_ copies** — this rebuilds each
   `ssd-pipeline/data/<ship>/image.png`, aligned pixel-for-pixel to the stored coordinates:
   ```bash
   python3 ssd-pipeline/extract_images.py --src ./SFB      # requires poppler + pillow
   ```
3. **Launch the server:**
   ```bash
   python3 ssd-pipeline/serve.py        # static files + save / audit / rescan / OCR-labels API on :8741
   ```
   Then open:
   - **`http://127.0.0.1:8741/viewer/battle.html`** — play a battle (solo or multiplayer)
   - `http://127.0.0.1:8741/viewer/` — home: pick a ship, open the verify editor or SSD viewer
   - `http://127.0.0.1:8741/viewer/verify.html?ship=FED-CA` — the SSD verify editor
   - `http://127.0.0.1:8741/viewer/ssd.html?ship=FED-CA` — read-only SSD viewer (intel-filtered for enemies)
4. **Run the rules-engine tests** (no dependencies):
   ```bash
   node --test ssd-pipeline/test/*.test.mjs      # 251 tests
   ```

### How to play, briefly
Start a new battle, add ships to each fleet (check **Solo** to drive both yourself), and begin.
Each turn: allocate energy on the EAF and **Lock**; plot movement / set speed; then step through
the impulses — heavy weapons must be armed to fire (with optional overload), phasers fire from
the charged capacitor, and both fleets' fire resolves simultaneously on the fire step. Right-click
a ship or a drone/plasma for context actions (tractor, boarding raid, transporter bomb, direct
phaser fire at a seeker). The turn controls carry HET and emergency-stop buttons.

---

## Architecture

The browser app is plain ES modules — **no build step, no framework**. `battle.html` is the host
(DOM, map rendering, networking, the SoP driver); all the rules live in small, pure,
independently-tested modules it imports. That split is deliberate: the rules engine can be
unit-tested headlessly with `node --test`, and the host stays a thin orchestration layer.

| Layer | Modules |
|-------|---------|
| **Sequence of Play** | `battle-phase.js` (segment cursor + `advance()` driver) |
| **Energy** | `energy-model.js`, `eaf-controls.js`, `reserve-power.js` |
| **Movement / geometry** | `movement.js`, `course-plan.js`, `battle-geom.js`, `battle-map.js`, `arc-geom.js` |
| **Direct fire** | `fire-plan.js`, `direct-fire.js`, `sealed-fire.js`, `weapon-charts.js`, `ship-loadout.js`, `lock-on.js`, `ew.js` |
| **Damage** | `dac.js`, `dac-allocator.js`, `ship-model.js`, `criticals.js`, `repair.js` |
| **Seeking / ordnance** | `seeking.js`, `drone-inventory.js`, `shuttle-inventory.js`, `weapon-arming.js`, `mines.js` |
| **Ship systems** | `tractor.js`, `cloak.js`, `terrain.js` |
| **Shared / util** | `ssd-engine.js`, `rng.js`, `scenario.js` |

Multiplayer determinism comes from a single seeded RNG (`rng.js`): one battle carries a `seed`
and a cursor, so every client draws the same dice and agrees on every result without a server
adjudicator.

---

## Repository layout

| Path | What |
|------|------|
| `ssd-pipeline/viewer/battle.html` | The game — hex map, EAF, movement, fire, all systems |
| `ssd-pipeline/viewer/*.js` | The pure rules engine (see the architecture table) |
| `ssd-pipeline/viewer/verify.html` | SSD verify editor — system families, arcs, labels, MSC-prefilled ship stats |
| `ssd-pipeline/viewer/ssd.html` | Read-only SSD viewer (tactical-intel filtered for enemy ships) |
| `ssd-pipeline/viewer/index.html` | Landing page — pick a ship / scan a new one |
| `ssd-pipeline/test/*.test.mjs` | 251 `node --test` unit tests for the rules engine |
| `ssd-pipeline/data/<ship>/` | Per ship: `detection.json`, `verified.json` (+ `image.png`, generated locally, **not** shipped) |
| `ssd-pipeline/ingest.py` | Render SSD pages → orient → CV box detection → `detection.json` |
| `ssd-pipeline/extract_images.py` | Regenerate the SSD `image.png` files from your owned PDFs |
| `ssd-pipeline/serve.py` | Static server + `save` / `audit` / `rescan` / OCR-`labels` API |
| `docs/` | Design specs, the rules audit, and the [adversarial code-review report](docs/adversarial-review.md) |
| `tasks/` | Running build log, fix lists, and backlog |

**Playable v1 roster:** `FED-CA`, `FED-CL`, `FED-NCL` (Federation), `KLI-D7` (Klingon),
`ROM-KR` (Romulan), `GOR-CA` (Gorn), `KZIN-CS` (Kzinti) — each with verified SSD data, an EAF
layout, and Master-Ship-Chart stats. Additional SSDs are inventoried in `ssd-pipeline/data/`.

---

## The SSD pipeline

Ship data is not hand-written — it's captured from the SSDs and owned by the verification step
(rule- and chart-derived per-ship data lives in `verified.json`, never hardcoded in game code):

1. **Ingest** — render an owned SSD PDF page, auto-orient to landscape, CV-detect every control
   box (chroma + light-region passes), group them, and OCR labels/arcs → `detection.json`.
2. **Verify** (`verify.html`) — assign each group a DAC **system family** (a taxonomy covering
   every damageable system), set weapon **firing arcs** on a hex editor (base + combined +
   plasma-swivel arcs, with painted exceptions), edit box labels, and record per-ship
   **Master Ship Chart stats** — turn category, size class, movement cost, damage-control
   rating, cloak cost, Basic Explosion Strength, breakdown rating — which **auto-prefill** from
   the built-in MSC table when a ship is opened.
3. **Audit** — a group-aware consistency check (unassigned boxes, unverified groups, weapons
   missing an arc). Verified results persist to each ship's `verified.json` and become the data
   backbone for the combat engine.

---

## Testing

```bash
node --test ssd-pipeline/test/*.test.mjs
```

251 tests, no dependencies. Highlights: the DAC engine is validated cell-for-cell against the
rulebook's D4.5 25-hit worked example; the energy, movement, arc, weapon-chart, seeking,
tractor, EW, lock-on, and mine modules each have focused coverage. New rules work is added
test-first (RED → GREEN).

---

*Built with [Claude Code](https://claude.com/claude-code). Star Fleet Battles is © Amarillo
Design Bureau, Inc.; this project is an unofficial, non-commercial implementation that ships no
copyrighted ADB content.*
