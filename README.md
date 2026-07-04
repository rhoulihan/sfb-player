# sfb-player

An online **Star Fleet Battles** game-management platform — faithful turn/impulse play with
map control, interactive Ship System Displays (SSDs), power allocation, assisted targeting
(weapon arcs + shields), automated dice & housekeeping, a full-text-searchable rules API, and
a rules-accurate **Damage Allocation** engine. Targets deployment on OCI alongside the
existing wavemax stack, behind a gated portal on `chrsent.com`.

## ⚠️ You must own the source material

*Star Fleet Battles* rules text and SSD artwork are © **Amarillo Design Bureau, Inc.** This
repository does **not** distribute that expressive content — no SSD page images, no rules
prose, no scanned rulebook/chart images. It contains our own **structural metadata** (box
coordinates, system-family classifications, firing arcs, OCR'd box labels) plus the
**functional game-mechanics data** the engine needs — the Damage Allocation Chart and the
direct-fire weapon damage charts — transcribed as data from material **you own**. The SSD
**page images and PDFs are regenerated locally from your own copies** and are never shipped
here. (The optional weapon-table validation editor, `viewer/weapons.html`, is a local-only
tool and is not tracked.)

Buy the two products this project uses from the publisher's store, **Warehouse 23**:

| Source | Used for | Buy at Warehouse 23 |
|--------|----------|---------------------|
| SFB: Basic Set SSD Book 2011 (Color) | the 8 v1 ship SSDs | [product page](https://warehouse23.com/products/star-fleet-battles-basic-set-ssd-book-2011_color) |
| SFB: Electronic Master Rulebook | the rules (movement, combat, DAC…) | [product page](https://warehouse23.com/products/star-fleet-battles-electronic-master-rulebook) |

More ships come from ADB's other SSD books — see the full
[Amarillo Design Bureau collection](https://warehouse23.com/collections/amarillo-design-bureau).

## Getting set up

1. Buy & download the PDFs above; drop them in a local (git-ignored) folder, e.g. `./SFB/`.
2. Regenerate the SSD images from **your** copies — this rebuilds each
   `ssd-pipeline/data/<ship>/image.png`, aligned pixel-for-pixel to the stored coordinates:
   ```bash
   python3 ssd-pipeline/extract_images.py --src ./SFB      # requires poppler + pillow
   ```
3. Launch the tooling:
   ```bash
   python3 ssd-pipeline/serve.py
   #  → http://127.0.0.1:8741/viewer/                          (home — pick a ship, or scan a new one)
   #  → http://127.0.0.1:8741/viewer/verify.html?ship=FED-CA   (verify editor)
   #  → http://127.0.0.1:8741/viewer/damage.html?ship=FED-CA   (damage processor)
   #  → http://127.0.0.1:8741/viewer/battle.html                (direct-fire combat sandbox)
   #  → http://127.0.0.1:8741/viewer/weapons.html               (weapon-table verify/edit)
   ```
   Run the engine's unit tests with `node --test ssd-pipeline/test/*.test.mjs` (61 tests, no deps).

## Status

- ✅ **Platform spec** — full specification (34 documents + UI wireframes) in `docs/spec/`.
- ✅ **SSD pipeline** — scan → CV-extract → human-verify tooling; 8 v1 ships inventoried.
- ✅ **Damage processor** — the full DAC engine (D3.6–D4.4) is built and unit-tested,
  validated cell-for-cell against the rulebook's D4.5 worked example; player view at
  `ssd-pipeline/viewer/damage.html`.
- ✅ **Direct-fire combat sandbox** — reposition two fleets on a hex map, form per-mount fire
  groups (split-fire across groups), and resolve direct fire through the DAC engine; a pure
  engine (arcs, loadouts, weapon charts, fire plans, resolution) with 61 unit tests backs
  `ssd-pipeline/viewer/battle.html`. Weapon charts are verifiable/editable against the scanned
  source tables at `ssd-pipeline/viewer/weapons.html`.
- ⏭️ **Platform build** — authoritative Node/Express + MongoDB + Socket.IO engine per the spec.

## Repository layout

| Path | What |
|------|------|
| `docs/spec/` | Full platform specification + UI wireframes |
| `docs/superpowers/specs/` | Design specs (e.g. the damage processor / DAC) |
| `ssd-pipeline/ingest.py` | Render SSD pages → orient → CV box detection → `detection.json` |
| `ssd-pipeline/extract_images.py` | Regenerate the SSD `image.png` files from your owned PDFs |
| `ssd-pipeline/serve.py` | Static server + `save` / `audit` / `rescan` / OCR-`labels` API |
| `ssd-pipeline/viewer/verify.html` | B4 verify editor (system families, arcs, labels, grouping) |
| `ssd-pipeline/viewer/damage.html` | Damage processor — apply a volley, watch the DAC allocate it |
| `ssd-pipeline/viewer/ssd-engine.js` | Shared render engine (taxonomy + cell geometry) |
| `ssd-pipeline/viewer/{dac,ship-model,arc-geom,dac-allocator}.js` | Damage rules engine (D3.6–D4.4) |
| `ssd-pipeline/viewer/battle.html` | Direct-fire combat sandbox — hex map, drag/rotate, fire groups, resolution |
| `ssd-pipeline/viewer/weapons.html` | Weapon-table verify/edit — scanned source beside the extracted values |
| `ssd-pipeline/viewer/{battle-geom,ship-loadout,weapon-charts,fire-plan,direct-fire}.js` | Direct-fire engine (arcs, loadouts, weapon charts, fire plans, resolution) |
| `ssd-pipeline/test/*.test.mjs` | Node unit tests for the rules engine (D4.5 gate, leaky, tracks, excess…) |
| `ssd-pipeline/viewer/index.html` | Landing page — pick a ship (or scan a new one), open the editor or damage processor |
| `ssd-pipeline/data/<ship>/` | Per ship: `detection.json`, `verified.json`, `boxlabels.json` (`image.png` is generated locally, **not** shipped) |
| `ssd-pipeline/scripts/` | One-off dev scripts (PDF page finder, per-ship verification passes) |
| `tasks/` | Running build log |

Ships inventoried for v1: `FED-CA`, `FED-DD`, `KLI-D7`, `KLI-F5`, `KZI-CC`, `KZI-FF`,
`GOR-CA`, `GOR-DD` (all from the Basic Set SSD Book above).

## What the SSD pipeline does

1. **Ingest** — render owned SSD PDF pages, auto-orient to landscape (Tesseract OSD),
   CV-detect every control box (chroma + light-region border passes), group them, and OCR
   labels/arcs → `detection.json`.
2. **Verify** — the B4 editor: assign each group a DAC **system family** (a 38-family
   taxonomy covering every damageable system + tracked non-DAC systems), set weapon **firing
   arcs** on a hex editor (base + combined + plasma-swivel arcs, with painted SSD exceptions),
   edit the letters/numbers shown on each box, rescan/regroup, and delete false positives.
   The overlay renders as a clean, uniform, family-colored grid on top of the real SSD image.
3. **Audit** — group-aware consistency check (unassigned boxes, unverified groups, weapons
   missing an arc). Verified results persist to each ship's `verified.json`.

These verified inventories are the data backbone for the damage engine and assisted targeting.

## Roadmap

The full plan is in `docs/spec/00-overview.md`. The SSD pipeline and the Damage Allocation
engine (per `docs/superpowers/specs/2026-07-03-damage-processor-design.md`) are built; next
up is wiring these into the authoritative multiplayer platform (turn/impulse engine, map
control, power allocation, assisted targeting) described in the spec.

---

*Built with [Claude Code](https://claude.com/claude-code).*
