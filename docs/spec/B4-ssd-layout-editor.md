# B4 — SSD Image-Overlay Editor (Hotspot Mapper)

## Purpose & Scope

This subsystem is the **authoring tool** that produces the `SsdImageMap` records defined in `B3-game-catalog-ssd-model.md` and rendered by `D2-ssd-viewer-ui.md`. Because the platform displays each ship's **actual SSD page image** (and is gated to verified product owners, so the scans can be served directly), the viewer needs no redrawn artwork — it needs an interactive **control overlay**: one **hotspot** per addressable element of the page (each shield‑point box, system box, weapon mount, power box, rating step, consumable/crew slot, and DAC cell), bound to a content `boxId`. This editor is where an author (admin/cataloguer role) loads a ship's page image and **maps** those hotspots onto it — drawing a rectangle or polygon over each box and binding it — then validates and publishes. No silhouette, no redrawn boxes: the scan carries all the static visuals; the author only authors the overlay. Two products fall out of this same pass: the **control overlay** (hotspots) *and* the **per‑ship weapon/system inventory with firing arcs** — which we must build ourselves, because no authoritative external dataset exists (see `B3-game-catalog-ssd-model.md`). The editor therefore also runs a **systems consistency audit** (drawn SSD ↔ content inventory ↔ overlay) so the inventory we build is complete and the overlay stays consistent with it. This document covers the editor's data, commands, validation, and screen; it does **not** define the SSD data shapes (B3) or the in‑game viewer (D2).

**PHASE:** [v1 AM-tournament] — an editor capable enough to map every tournament‑legal ship faithfully (upload image, draw/bind/validate/publish, zoom/pan, snap‑to‑grid, multi‑select). [v2] **computer‑vision assist** that proposes box rectangles from the scan for the author to confirm, hotspot **templates** for repeated layouts (clone a cruiser overlay and re‑bind), and an owner‑upload image pipeline. [v3] full‑roster mapping throughput, multi‑page/fold‑out SSDs, fighters/bases/pods, and a community contribution + review queue.

## Rulebook References

- **R0.8 (items 1–19)** — the anatomy of an SSD; tells the author *what* must be mapped (crew, transporter bombs, probes, shuttle table, ship‑data table, turn‑mode table, the SSD proper, weapon tables, pseudo‑plasma, firing‑arc template, hit‑and‑run, movement‑cost chart, drone racks, anti‑drone, fighters, fighter‑data table, Crawford table).
- **R0.8.9** — shaded boxes = refits (`Hotspot.refitGated`); the six shield rows whose point boxes each get a hotspot.
- **D2.0** — the firing arcs / six‑sector template (the arc tag on weapon‑mount hotspots).
- **D4.0** — the Damage Allocation Chart (DAC cell hotspots; routing keys owned by `C7-damage-criticals-repair.md`).
- **R0.2** — Commander's‑SSD philosophy: the whole sheet is present, so the overlay must make every element on it interactive.

## Domain Model

An **authoring draft** wraps the `SsdImageMap` (B3) under construction plus editor‑only state (the uploaded image, zoom/pan, selection, validation results, coverage tracking). Drafts and published maps live in the catalog store, **not** the per‑game event log — authoring is administrative CRUD with an audit trail, versioned alongside the catalog.

```ts
import type { SsdImageMap, SsdImageRef, Hotspot, HotspotShape, ArcCode } from 'B3';

type AuthorId = string;

interface ContentBinding {                // which content boxes have a hotspot vs are outstanding
  shipTypeId: string; catalogVersion: string;
  contentBoxIds: string[];                // from B3 SystemBox/WeaponMount/PowerSource/shield/track slots
  mappedBoxIds: string[];                 // subset that already has a bound hotspot
}
interface ValidationIssue {
  severity: 'error'|'warn'; code: string; // 'BOX_UNMAPPED','HOTSPOT_OVERLAP','HOTSPOT_UNBOUND','ARC_MISSING','DAC_INCOMPLETE','NO_IMAGE'
  message: string; refBoxId?: string; refHotspotId?: string;
}
interface DetectedRegion {                // optional CV-assist proposal ([v2]); author confirms -> Hotspot
  shape: HotspotShape; confidence: number; suggestedKind?: Hotspot['kind'];
}
interface ImageMapDraft {
  draftId: string; map: SsdImageMap;      // the work-in-progress B3 SsdImageMap (image + hotspots)
  binding: ContentBinding;
  view: { zoom: number; panX: number; panY: number; gridSnap: boolean; gridPx: number };
  selection: string[];                    // selected hotspotIds
  detections?: DetectedRegion[];          // CV-assist queue ([v2])
  validation: ValidationIssue[];
  authoredBy: AuthorId; basedOnMapId?: string;   // clone/template source ([v2])
  status: 'draft'|'in-review'|'published'|'deprecated';
}
```

```ts
// Mongoose (collection: 'ssdImageMapDrafts'); published output is the B3 'ssdImageMaps' collection.
// The uploaded image binary goes to owner-gated object storage; the draft holds only its assetKey.
const SsdImageMapDraftSchema = new Schema({
  draftId: { type: String, unique: true },
  shipTypeId: { type: String, index: true },
  map: Schema.Types.Mixed, binding: Schema.Types.Mixed,
  view: Schema.Types.Mixed, validation: [Schema.Types.Mixed],
  authoredBy: String, basedOnMapId: String,
  status: { type: String, enum: ['draft','in-review','published','deprecated'], default: 'draft' }
}, { timestamps: true });
```

## Events & Commands

Authoring is admin CRUD; mutations are recorded to a **`catalogAudit`** trail (who/when/what), not to a game's `gameEvents`. Commands are PascalCase imperatives; audit entries are past‑tense.

```ts
// Commands (author/admin only)
CreateImageMapDraft   { shipTypeId, catalogVersion, basedOnMapId? }   // pre-seeds binding from B3 content
UploadSsdImage        { draftId, assetKey, book?, page?, pxWidth, pxHeight }  // owner-gated asset
DrawHotspot           { draftId, shape: HotspotShape, kind }          // add an overlay region (normalized coords)
MoveOrResizeHotspot   { draftId, hotspotId, shape: HotspotShape }
BindHotspot           { draftId, hotspotId, contentBoxId }            // link hotspot -> B3 content box
AssignArc             { draftId, hotspotId, arc: ArcCode }            // D2.0 (weapon mounts)
MarkDacCell           { draftId, hotspotId, col, row }                // DAC cell hotspots (D4.0)
RequestAutoDetect     { draftId }                                     // CV-assist proposes rects ([v2])
AcceptDetection       { draftId, detectionIndex, contentBoxId }       // confirm a proposal into a bound hotspot
RunMapValidation      { draftId }
RunSystemsAudit       { shipTypeId? }                                 // one ship, or fleet-wide when omitted -> SystemsConsistencyReport
SubmitForReview       { draftId }
PublishImageMap       { draftId, mapVersion }                         // writes B3 'ssdImageMaps', bumps version
DeprecateImageMap     { mapId }

// Audit entries (catalogAudit)
ImageMapDraftCreated · SsdImageUploaded · HotspotDrawn · HotspotMoved · HotspotBound ·
ArcAssigned · DacCellMarked · DetectionAccepted · MapValidated · MapSubmitted ·
ImageMapPublished { mapId, mapVersion, shipTypeId } · ImageMapDeprecated
```

`PublishImageMap` is the only command that produces a catalog‑visible artifact (a frozen `SsdImageMap` keyed by `mapVersion`); D2 instances pin the map version the same way ship instances pin `templateVersion`, so the overlay is reproducible for replay.

## Engine / API

Pure validators where possible; publish is transactional.

```ts
seedBindingFromContent(shipTypeId: string, catalogVersion: string): ContentBinding
validateMap(draft: ImageMapDraft): ValidationIssue[]        // total; see rules below
auditCatalogConsistency(shipTypeId?: string): SystemsConsistencyReport  // three-way drawn<->content<->overlay; fleet-wide when omitted
overlaps(a: Hotspot, b: Hotspot): boolean                   // normalized-coord collision test (with tolerance)
unmappedBoxes(draft: ImageMapDraft): string[]               // contentBoxIds with no bound hotspot
autoDetectRegions(image: SsdImageRef): DetectedRegion[]     // CV-assist box-finder ([v2]); never auto-binds
publishImageMap(draft: ImageMapDraft, mapVersion: string): SsdImageMap   // freezes + writes B3 'ssdImageMaps'
cloneMap(sourceMapId: string, targetShipTypeId: string): ImageMapDraft   // [v2] template/family reuse
renderOverlayPreview(map: SsdImageMap, demoState?: ShipRuntimeState): OverlaySvg  // == D2 overlay renderer
```

`renderOverlayPreview` shares the **same overlay renderer** as `D2-ssd-viewer-ui.md` so what the author sees over the image equals what players see (single source of truth for hotspot geometry and state markers). `autoDetectRegions` only *proposes* rectangles; binding is always a human act, so a misdetection can never silently mis‑map a box.

## Validation & Enforcement Rules

Authoring is gated to the **admin/cataloguer** role (`A2-identity-roles-gating.md`); ordinary players cannot author or publish. `validateMap` blocks **PublishImageMap** on any `error` (warnings allowed); each rule is an admin‑override (`forcePublish`, audited):

1. **Image present.** A draft with no uploaded `image` cannot be published (`NO_IMAGE`).
2. **Coverage.** Every content `boxId` in `binding.contentBoxIds` has exactly one bound hotspot (`BOX_UNMAPPED` / a box bound twice → `HOTSPOT_DUPLICATE`). The author cannot publish a partially mapped SSD.
3. **No overlap.** No two hotspots overlap beyond a small tolerance (`HOTSPOT_OVERLAP`) — so a click resolves to one box unambiguously.
4. **Bind integrity.** Every hotspot references a real content `boxId` at the pinned `catalogVersion` (`HOTSPOT_UNBOUND` / dangling bind blocks publish).
5. **Arc legality (D2.0).** Every weapon‑mount hotspot carries a known `ArcCode` (or documented combined arc) — `ARC_MISSING`.
6. **DAC completeness (D4.0).** DAC‑cell hotspots cover all six columns; every `DamageRoute` used by a content box has at least one DAC cell — `DAC_INCOMPLETE`.
7. **Coordinates in bounds.** All normalized coords lie within `[0,1]`; nothing maps off the image.
8. **Image entitlement.** The `image.assetKey` resolves to an owner‑gated asset; the validator confirms it is stored with the ownership‑entitlement tag and never marked public (`E4-security-integrity.md`).
9. **Systems‑inventory consistency (three‑way).** The audit cross‑checks the three representations of a ship and blocks publish on a mismatch: (a) the **drawn SSD** (what boxes appear on the page), (b) the **content inventory** (B3 system/weapon/power/shield/track box set), and (c) the **control overlay** (hotspots). Flags: a content box with no hotspot (`BOX_UNMAPPED`); a hotspot with no content box (`HOTSPOT_UNBOUND`); a box **drawn on the SSD but absent from content** (`CONTENT_MISSING_BOX` — the inventory is incomplete) or **in content but not drawn** (`CONTENT_EXTRA_BOX`); a per‑type **count mismatch** (`COUNT_MISMATCH`, e.g. content says 4 warp boxes, the SSD draws 6); a weapon mount missing its arc (`ARC_MISSING`). Drawn‑side counts come from the author's coverage confirmation (and CV‑assist counts in [v2]).

### Systems Consistency Audit (per ship + fleet‑wide)

Because the weapon/system inventory is **built by hand from the SSDs** — no authoritative external dataset exists (searched: ADB publishes only copyrighted PDF Master Ship Charts; sfbonline.com is a closed licensed implementation; community resources are tools/scans, not reusable data) — that inventory must be **validated against the SSD it was extracted from** and kept consistent with the overlay. `auditCatalogConsistency` runs the rule‑9 cross‑check for one ship or for the **whole fleet**, producing a `SystemsConsistencyReport` that lists, per ship: unmapped/orphan boxes, content↔SSD gaps, count mismatches, missing weapon arcs, and DAC gaps. A ship is **v1‑ready only when its audit is clean** (content complete + every box mapped + every weapon arc set + overlay consistent). The fleet report is the readiness gate referenced by `E6-roadmap-phasing.md`, and `E5-testing-strategy.md` runs it as an automated test over every published ship so drift is caught in CI.

## UI Contract

A focused image‑mapping screen; wireframe **`wireframes/B4-ssd-editor.svg`**.

- **Center — Image canvas.** The uploaded SSD page image at the heart of the screen, with **zoom/pan** and an optional snap grid. The author draws hotspots directly on the image with a **rectangle** or **polygon** tool; existing hotspots render as translucent outlines (color‑coded by `kind`), selectable and resizable. Overlap and out‑of‑bounds are flagged live.
- **Left — Outstanding boxes & tools.** The draw‑tool palette (rect / poly / pan) and a live checklist of **unmapped content boxes**; pick a box, draw its region, and it auto‑binds (or draw first then bind from the inspector). The list shrinks to zero as coverage completes; a **CV‑assist** button ([v2]) queues detected rectangles for one‑click confirm.
- **Right — Inspector & validation.** Properties of the selected hotspot: bound content box, `kind`, label override, `refitGated` flag, and for weapon mounts the **arc picker** (D2.0); a **DAC editor** maps the chart cells (D4.0). Below it, a live **validation panel** (error/warn counts from `validateMap`); clicking an issue selects the offending hotspot. **Submit for review** / **Publish** are disabled while errors remain.
- **Preview.** A toggle renders the draft through the **D2 overlay renderer** (`renderOverlayPreview`) with a demo damage state, so the author confirms the live‑state markers land on the right boxes — exactly what players will see.

## Dependencies

- **`B3-game-catalog-ssd-model.md`** — defines `SsdImageMap`/`Hotspot`/content boxes; the editor reads content for binding and writes published maps to its `ssdImageMaps` collection.
- **`D2-ssd-viewer-ui.md`** — consumes the published map and **shares the overlay renderer** with this editor's preview.
- **`A2-identity-roles-gating.md`** — admin/cataloguer role gating, and the owner entitlement that authorizes uploading/serving the page image.
- **`E4-security-integrity.md`** — the owner‑gated object‑storage rules for the SSD image asset (never served to a non‑entitled session).
- **`B1-rules-content-api.md`** — rule deep‑links shown on box types (e.g. a phaser hotspot links to E2.0) so the author cross‑references while mapping.
- **`A3-data-architecture-event-store.md`** — the `catalogAudit` trail reuses the append‑only discipline (separate stream from `gameEvents`).

## Edge Cases & Open Questions

- **Image sourcing & licensing posture.** The whole app is gated to verified owners, so page scans are served directly; the entitlement check that proves ownership before any image URL is released is owned by `A2`/`E4` and must be airtight. Confirm the verification mechanism (proof‑of‑purchase, content code, honor‑gate).
- **Multi‑page / fold‑out SSDs.** Bases, carriers, and tug pod configurations span multiple sheets; a map may need an ordered set of images with a shared hotspot namespace (mostly [v2]/[v3]).
- **Image registration drift.** If an owner uploads a differently‑cropped scan, normalized coords may not line up; the editor needs an alignment/calibration step (corner anchors) so one overlay can serve multiple scans of the same sheet.
- **Refit overlays.** Shaded refit boxes occupy real positions on the page; their hotspots carry `refitGated` and the viewer shows/hides them by configuration — confirm whether legacy scans without a refit box need a synthetic hotspot.
- **Content drift.** When B3 content changes (a corrected box count), bound maps must surface a "content changed" diff so the author maps only the delta. Reconciliation UI is [v2].

## Testing

- **Round‑trip.** Map a small SSD (e.g. a Federation CA), publish, reload — assert the `SsdImageMap` is byte‑identical and `renderOverlayPreview` is stable.
- **Validation coverage.** Unit‑test each rule: leave a box unmapped → `BOX_UNMAPPED` blocks publish; overlap two hotspots → `HOTSPOT_OVERLAP`; drop a weapon arc → `ARC_MISSING`; leave a DAC column empty → `DAC_INCOMPLETE`; missing image → `NO_IMAGE`.
- **Renderer parity.** Assert the editor preview overlay and the D2 viewer overlay for the same map + neutral state are identical (shared renderer); markers land on the same normalized coords.
- **Owner gating.** A non‑owner/non‑admin cannot upload an image or publish; a published map's image URL is never released to a non‑entitled session (`E4-security-integrity.md`).
- **Coordinate robustness.** Resize the rendered image; assert hotspots stay aligned (normalized coords) and click targets still resolve to the correct box.
- **Fixture.** The hand‑mapped CA overlay becomes a golden fixture the D2 tests and the `wireframes/battle-screen.html` SSD panel both consume.

## Phasing

- **[v1 AM-tournament]** — upload image; draw/bind/validate/publish; zoom/pan, snap grid, multi‑select; arc + DAC mapping; preview parity with D2. Enough to map every tournament‑legal ship.
- **[v2]** — CV‑assist box detection, hotspot **templates** (clone + rebind), content‑change reconciliation diff, owner‑upload + image‑calibration workflow, and bulk re‑versioning.
- **[v3 full Master]** — full‑roster mapping throughput, multi‑page/fold‑out SSDs, fighters/bases/monsters, and a community contribution + review pipeline.
