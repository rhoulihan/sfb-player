# Module: SSD Pipeline — Scan → Extract → Map → Viewer → Audit

> **Status:** spec for review. **The data-first foundation module.** Build this before any gameplay code.
> Realizes the design in `../B3-game-catalog-ssd-model.md` (catalog/SSD data), `../B4-ssd-layout-editor.md`
> (image-overlay mapper + CV-assist + consistency audit), and `../D2-ssd-viewer-ui.md` (viewer).

## 1. Purpose & Scope

Getting the **ship data right** is the elephant in the room: SFB has no authoritative machine‑readable inventory of per‑ship systems and weapon firing arcs (we searched — see `../B3-game-catalog-ssd-model.md`), so we must **build it ourselves from the SSDs we own**. This module front‑loads that work and proves the entire data pipeline end‑to‑end on a representative set before any rules/engine code exists.

**In scope:** for each chosen ship — (1) **scan** its SSD page from the owner's PDF, normalized to **landscape**; (2) **extract** a detailed inventory of every box (system/weapon/power/shield/track) and **every weapon's firing arc** using **CV‑assisted detection + human verification**; (3) **map** an interactive control overlay onto the real page image; (4) a working **landscape viewer** of each SSD with a **fully functional overlay** (per‑box live status, click/hover, rule deep‑links); (5) a **consistency audit** that proves the drawn SSD, the content inventory, and the overlay all agree.

**Out of scope:** the movement/combat/energy engines, the full ship roster, fighters/PF sub‑SSDs (escorts are mapped at hull level only). Those come after the data foundation is proven.

**Locked decisions (this module):**
- **Ship set:** one heavy cruiser **+** one escort per v1 race ≈ **8 ships** (cruiser = dense layout, escort = sparse layout — proves the pipeline on real variety).
- **Extraction:** **CV‑assisted + human verify** (auto‑detect the color‑coded boxes, human confirms types and assigns arcs).
- **Orientation:** **auto‑detect per SSD, present landscape** (most v1 SSDs are landscape‑native per the owner; portrait‑native ones are shown in a wide landscape viewport).

## 2. Goals, Non‑Goals, Acceptance Criteria

**Goal:** for each of the 8 ships, produce ① a landscape display of its **real** SSD with a **fully functional overlay**, ② a complete **content inventory** (systems/weapons/power/shields/tracks) with **every weapon's firing arc**, and ③ a **clean three‑way consistency audit**. The inventory exports as `../B3-game-catalog-ssd-model.md` catalog records (`SsdTemplate` content + `SsdImageMap`).

**Acceptance criteria (per ship):**
- [ ] SSD page renders in **landscape** at the viewer's target size, legible at 1:1 and on zoom.
- [ ] **Every** box on the SSD is an interactive **hotspot** bound to a content `boxId` of the correct type.
- [ ] **Every weapon mount carries a firing arc** (`WeaponMountDef.arc`), verified against the ship's R‑section entry.
- [ ] Overlay shows correct **live status** per box (intact / destroyed / depleted / loaded / crossed‑out / critical) driven by a test state script.
- [ ] **Consistency audit is clean** (`auditCatalogConsistency` → no `BOX_UNMAPPED` / `HOTSPOT_UNBOUND` / `CONTENT_MISSING_BOX` / `COUNT_MISMATCH` / `ARC_MISSING`).
- [ ] Inventory + image map persisted as versioned B3 catalog records; image asset is **owner‑gated**.

**Fleet acceptance:** all 8 ships pass; the fleet consistency report is green; the Federation CA is the documented **golden reference** (fully mapped, audited, and used as a regression fixture by `../E5-testing-strategy.md`).

**Non‑goals:** gameplay resolution; >8 ships; per‑fighter SSDs; mobile layout; OCR of rule text.

## 3. Architecture & Data Flow

Five stages, each emitting a versioned, inspectable artifact. Stages 1–2 are automated; stage 3 is human‑in‑the‑loop; stages 4–5 are automated consumers.

```
 owner's SSD PDF (owned)
        │  pdftoppm @≥150dpi
        ▼
 ┌──────────────┐   page image + orientation     ┌───────────────────────────┐
 │ 1. SCAN      │ ─────────────────────────────▶ │ SsdImageRef (owner-gated)  │
 │  normalize   │   {assetKey,pxW,pxH,rotation,  │  -> B3 'ssdImageMaps'.image│
 │  -> landscape│    sourceBook,page}            └───────────────────────────┘
 └──────────────┘
        │ image
        ▼
 ┌──────────────┐   DetectedRegion[]             (chroma + low-chroma masks,
 │ 2. DETECT    │ ─────────────────────────────▶  connected-components, OCR labels
 │  CV (auto)   │   {bbox(normalized), colorClass,  + arc codes, confidence)
 └──────────────┘    proposedType, proposedArc, conf}
        │ proposals
        ▼
 ┌──────────────┐   (B4 image-overlay editor)    ┌───────────────────────────┐
 │ 3. INVENTORY │ ─ human confirms/corrects ───▶ │ content inventory (B3)     │
 │  + MAP       │   binds boxIds, assigns arcs,  │  + SsdImageMap (hotspots)  │
 │  (verify)    │   marks DAC/tracks             │  published + version-pinned│
 └──────────────┘                                └───────────────────────────┘
        │ published map + inventory
        ├───────────────▼ 4. VIEWER (D2): landscape image + functional overlay, live status, zoom/pan
        └───────────────▼ 5. AUDIT (B4.auditCatalogConsistency): drawn ↔ content ↔ overlay  → gate
```

**Feasibility evidence (validated on the real Fed CA page, 1275×1650).** A chroma mask (`max−min RGB > 16`, value > 90) + `scipy.ndimage` connected‑components auto‑detected **357 single boxes, cleanly separated (0 merges)** — the SSD's black box‑borders break connectivity, so adjacent boxes label individually. Color classification grouped them (blue/purple shields, yellow systems, pink weapons, green rating tracks). Two known gaps confirm where humans/extra passes are needed: the **near‑white beige hull boxes** (very low chroma — need a dedicated low‑chroma/template pass) and the **tiny weapon arc codes** (RF/R/LF/L/FA — best‑effort OCR, human‑verified). This is exactly the "~80% auto, human nails the rest + arcs" profile we chose.

## 4. The representative ship set (8)

| Race (R‑code) | Cruiser (dense) | Escort (sparse) |
|---|---|---|
| Federation (R2) | **CA** — Heavy Cruiser *(Basic Set p.14, golden reference, already extracted)* | **DD** — Destroyer |
| Klingon (R3) | **D7** — Battlecruiser | **F5** — Frigate |
| Kzinti (R5) | **CC** — Command Cruiser | **FF** — Frigate |
| Gorn (R6) | **CA** — Heavy Cruiser | **DD** — Destroyer |

Source = the owner's **Basic Set** (`SFBBasicSetSSDscolor.pdf`) and **Master** (`AMSSDs2014color.pdf`) SSD PDFs; the exact book+page per ship is resolved during Stage 1 (a small page‑finder over the owned PDFs; the page index is recorded in `SsdImageRef.sourceBook`/`.page`). The cruiser/escort split deliberately spans a dense, weapon‑rich layout and a sparse one, so detection, mapping, arcs, and the audit are exercised on both extremes.

## 5. Stage 1 — Scan & Orientation Normalize

**Render.** `pdftoppm -png -r 150` (or higher for dense sheets) extracts the ship's page from the owned PDF to a PNG. The binary is stored in **owner‑gated object storage** (`../E4-security-integrity.md` / `../A2-identity-roles-gating.md`); only entitled owners ever receive a URL.

**Multi‑SSD pages.** Some pages carry more than one SSD; a bounding‑box segmentation (largest connected non‑white regions + the title band) crops each ship to its own image.

**Orientation → landscape.** Each SSD's native reading orientation is auto‑detected and the image is rotated so it presents **landscape**:
- **Aspect & content bbox** — the tight content bounding box aspect ratio is the first signal.
- **Title OCR** — OCR the title band at 0° and 90°; the orientation that reads as text wins (the SFB title runs along the SSD's long edge).
- **Silhouette axis** — the ship silhouette's major axis corroborates.
- Record `rotationApplied ∈ {0,90,180,270}` on `SsdImageRef` so normalized hotspot coords always map back to the stored image. (Most v1 SSDs are landscape‑native → `rotationApplied` is commonly 90°; portrait‑native sheets keep 0° and are shown inside a wide viewport, per the viewer's layout rule.)

**Output:** `SsdImageRef { assetKey, pxWidth, pxHeight, rotationApplied, sourceBook, page }` → becomes `SsdImageMap.image` in B3.

## 6. Stage 2 — CV Detection (automated proposals)

Produces a draft set of `DetectedRegion`s that seed the B4 mapper's CV‑assist queue. **Never auto‑binds** — every region is confirmed by a human in Stage 3.

**Box detection.**
- **Primary (chroma) mask:** `chroma = max(R,G,B) − min(R,G,B) > ~16` and `value > ~90` selects all saturated and pastel boxes; excludes white paper, black borders/text, grey shading. Validated: 357 boxes on the Fed CA page.
- **Low‑chroma pass:** a second detector for the near‑white **beige/cream hull** boxes — local‑contrast/edge detection bounded by the black border grid (these are the boxes the chroma mask misses).
- **Connected components** (`scipy.ndimage.label`, 4‑connectivity) on each mask; the black inter‑box borders keep adjacent boxes separate. Filter components to box‑shaped (area, fill ratio 0.4–1.05, plausible w/h and aspect). Touching boxes that still merge are split by a morphological watershed and flagged for human review.

**Grouping into systems.** Cluster boxes by color class + spatial proximity into candidate **system groups** (e.g., a 3×3 blue block → a warp engine; a vertical blue stack → impulse; a 6‑box purple row → a shield facing). Group geometry feeds the proposed `kind`.

**Label & arc reading (OCR, tesseract).** OCR the small cluster labels (`WARP`, `IMP`, `BTTY`, `BRIDGE`, `PH‑1`, `PHOT`, `LAB`, `TRAC`, `DRONE`…) to propose each group's **type**, and the tiny **arc codes** beside weapon boxes (`FA`, `RF`, `LF`, `RH`, `LH`, `L`, `R`, `360`) to propose each weapon's **firing arc**. OCR of arc codes is **best‑effort** — they are tiny and rotated; the proposal is always human‑verified (this is the accuracy‑critical step the human owns).

**Output per region:** `DetectedRegion { bbox(normalized), colorClass, proposedKind, proposedType?, proposedArc?, confidence }`. Low‑confidence regions are surfaced first in the verify queue.

## 7. Stage 3 — Inventory & Mapping (human verify in B4)

The **B4 image‑overlay editor** (`../B4-ssd-layout-editor.md`) consumes the detected regions over the landscape image. The author works the CV‑assist queue: **confirm / correct** each box's `kind` and bind it to a content `boxId`; **assign / confirm the firing arc** on every weapon mount (the arc picker, D2.0); mark the **DAC** cells (D4.0) and the **crew/ammo/shuttle/drone** tracks; flag **refit (shaded)** boxes. The coverage checklist drains to zero as every box is mapped.

This stage emits the module's two authoritative artifacts, both versioned and pinned:
- the **content inventory** — B3 `SystemBoxDef[] / WeaponMountDef[](with `.arc`) / PowerSourceDef[] / ShieldFacingDef[] / RatingTrackDef[] / ConsumableTrackDef[] / CrewTrackDef` — *this is the weapon/system inventory we build ourselves*; and
- the **`SsdImageMap`** — the hotspot overlay (normalized coords bound to those `boxId`s).

## 8. Stage 4 — Viewer (landscape + functional overlay)

The **D2 viewer** (`../D2-ssd-viewer-ui.md`) renders each ship's published map: the **landscape** SSD page image with the **fully functional control overlay** on top. Per‑box live status (destroyed ✕ / depleted shield / loaded ● / critical ! / crossed‑out hatch / selected ring) is painted at each hotspot over the scan; hover shows the rule tooltip + deep‑link (B1); click forwards the box action; **Image/Data** toggle and **zoom/pan** support dense sheets. Landscape‑native SSDs are rotated to fill the width; portrait‑native ones sit in a wide viewport with the inventory/legend panels beside them.

A working **prototype already exists** — `../wireframes/D2-ssd-viewer.html` loads the real Fed CA scan (`../wireframes/assets/ssd-fed-ca.png`) with an overlay — and is the seed for this stage; this module wires it to the published `SsdImageMap` of each of the 8 ships and applies the landscape orientation.

## 9. Stage 5 — Consistency Audit (the gate)

`auditCatalogConsistency` (`../B4-ssd-layout-editor.md`) runs the **three‑way** check per ship and fleet‑wide: **drawn SSD ↔ content inventory ↔ control overlay**. It cross‑checks the **CV box count** against the **content box count** and the **mapped hotspot count**, flagging `CONTENT_MISSING_BOX` (a drawn box absent from inventory — incomplete), `CONTENT_EXTRA_BOX`, `COUNT_MISMATCH` (e.g. content says 4 warp boxes, the SSD draws 6), `BOX_UNMAPPED`, `HOTSPOT_UNBOUND`, and `ARC_MISSING`. **A ship is "done" only when its audit is clean.** The fleet report over all 8 is the module's exit gate and feeds the v1 readiness gate in `../E6-roadmap-phasing.md`.

## 10. Data Produced (per ship)

```ts
// All types are defined in ../B3-game-catalog-ssd-model.md; this module produces instances of them.
SsdImageRef           // stage 1 — owner-gated landscape image + rotation + source
DetectedRegion[]      // stage 2 — CV proposals (transient; feeds B4 queue)
SsdTemplate.content   // stage 3 — SystemBoxDef/WeaponMountDef(.arc)/PowerSourceDef/Shield/tracks  ← the inventory
SsdImageMap           // stage 3 — hotspots[] bound to content boxIds                              ← the overlay
SystemsConsistencyReport // stage 5 — audit result (gate)
```

## 11. Tooling & Tech

- **Scan:** poppler `pdftoppm` (present); orientation OCR via **tesseract** (present).
- **CV detection:** Python + **numpy** + **Pillow** + **scipy.ndimage** (all validated working here); OpenCV optional for watershed split. Packaged as an **ingestion CLI/service** that takes `(pdf, page)` → `SsdImageRef` + `DetectedRegion[]`.
- **Verify + map:** the B4 editor UI (React/TS) reading the CV queue.
- **Viewer:** the D2 viewer (React/TS), seeded by `D2-ssd-viewer.html`.
- **Storage/stack:** Node/Express + MongoDB (`ssdImageMaps`, `ssdImageMapDrafts`, `ssdTemplates`), owner‑gated object storage for images — same stack as the rest of the platform.

## 12. The hard cases (explicitly handled)

- **Touching boxes** — the black borders separate them (probe: 0 merges); residual merges get a watershed split + a human‑review flag.
- **Faded / low‑chroma boxes** (beige hull, pale shields) — the dedicated low‑chroma/edge pass plus the border grid; human confirms.
- **Tiny labels & arc codes** — OCR is best‑effort; **weapon firing arcs are human‑verified against the R‑section** (the one place we do not trust automation).
- **Combined / non‑standard arcs, refit (shaded) boxes, multi‑bay shuttles, "R" reload boxes** — surfaced to the human; never auto‑bound.
- **Multi‑SSD pages & orientation edge cases** — segmentation + the 0°/90° title‑OCR test.

## 13. Build Sequence (milestones)

1. **M0.1 — Scan service.** `(pdf,page)→landscape image + SsdImageRef`; orientation auto‑detect; owner‑gated storage. Run for all 8 ships.
2. **M0.2 — CV detector.** chroma + low‑chroma + connected‑components + label/arc OCR → `DetectedRegion[]` with confidence. Tuned against the Fed CA golden page (357 boxes baseline).
3. **M0.3 — B4 verify pass.** Wire detections into the B4 mapper; **fully map + audit the Fed CA first** (the golden reference), then the remaining 7 ships.
4. **M0.4 — D2 landscape viewer.** Wire the viewer to each published `SsdImageMap`; apply landscape orientation; live‑status test script.
5. **M0.5 — Fleet audit green.** `auditCatalogConsistency` clean for all 8; export catalog records; lock the golden fixture.

**Deliverable:** 8 working landscape SSD viewers with fully functional overlays, the extracted inventories (systems + weapon arcs), and a green fleet consistency audit.

## 14. Risks & Open Questions

- **CV accuracy on faded/older scans** — mitigated by the human verify pass; track per‑ship auto‑detect hit‑rate (target ≥80%).
- **Arc OCR legibility** — arcs are tiny/rotated; the human verify against the R‑section is mandatory, not optional.
- **Per‑ship source/page** — the exact book+page for the 7 non‑Fed‑CA ships must be located in the owned PDFs (Stage 1 page‑finder); confirm each is the current (fully‑updated) SSD.
- **Escort scope** — escorts are hull‑level only here; fighter/PF sub‑SSDs are deferred.
- **Orientation truth** — confirm the landscape‑native assumption holds for D7/F5/Kzinti/Gorn during M0.1 (the detector handles either, but it sets the default viewer presentation).

## 15. Testing

- **Golden Fed CA** — fully mapped, audited, and frozen as a regression fixture (`../E5-testing-strategy.md`): assert box count, per‑system counts, and **every weapon arc** match the R2.4 SSD; assert overlay coords are stable and the live‑status script paints the right boxes.
- **Detector unit tests** — on the Fed CA page assert ≥ the 357‑box baseline at the tuned thresholds, 0 unexpected merges, and correct color‑class histogram.
- **Audit tests** — inject a deliberately incomplete inventory (drop a warp box) and assert `COUNT_MISMATCH`/`CONTENT_MISSING_BOX`; drop an arc and assert `ARC_MISSING`.
- **Cross‑ship** — the fleet audit runs in CI over all 8 published ships (the same suite `../E5-testing-strategy.md` runs over the full catalog later).
