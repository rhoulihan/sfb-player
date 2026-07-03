# B3 — Game Catalog & SSD Data Model

## Purpose & Scope

This subsystem defines the **static catalog** of the game world — empires, ship classes, and every Ship System Display (SSD) digitized as structured data — and the rule by which a catalog entry **instantiates a mutable, per‑ship runtime state** that the rest of the engine folds events onto. An SSD (R0.8) is both the printed schematic and the live game‑state record for one ship; we model it as an immutable **Template** (box geometry, labels, firing arcs, ratings, refit conditions, reference charts) plus a per‑game **Instance** (box status, track counters, weapon states, shield strengths, ammunition). The catalog also owns **versioning** and the **import path** from the published SSD books. It is the foundation every combat, energy, and movement subsystem reads from: weapon mounts and arcs (E‑section), power sources and costs (energy allocation), shield facings and the Damage Allocation Chart routing (D4.0), turn‑mode/movement charts (C‑section), and consumable tracks. This document does **not** resolve damage or fire weapons — it provides the addressable box model those subsystems mutate.

**PHASE:** [v1 AM-tournament] for the data model, instantiation, refit/year resolution, and the digitized tournament‑legal ship roster; [v2]/[v3] expand the roster and add modular‑ship/tug pod variants, fighter substitution from Annex #4, and the full Master Rulebook catalog.

## Rulebook References

- **R0.0–R0.8** — ship rule numbering, defaults, class taxonomy, size class, carrier data chart, and the SSD‑as‑data model (every R0.8 item, .1 through .19).
- **R0.1** — reference‑code identity keys: `R{empire}.{index}`, refit `R#.R{n}`, fighter `R#.F{n}`, PF `R#.PF{n}`.
- **R0.3** — implicit defaults (acceleration, drone reloads, launch rate, seeking‑weapon control capacity).
- **R0.4 / R0.6** — role class taxonomy and the 0–7 size class; unit/ship/base/PF/shuttle entity lattice.
- **R0.7** — Carrier Data Chart (year → escorts + fighter group; co‑purchase coupling).
- **S2.1** — Battle Point Value (BPV / Point Value field).
- **C3.0 / C6.5 / C6.51 / C6.52** — turn mode, breakdown rating/rolls, High Energy Turn.
- **C2.0** — movement cost chart (warp energy per hex).
- **D2.0** — firing arcs and the six‑sector arc template.
- **D3.3 / B3.3 / G13.2** — shield operating cost, life‑support cost, cloak cost (with/without warp) — Ship Data Table scalars.
- **D4.0** — Damage Allocation Chart (referenced; box → hit routing lives there, see `C7-damage-criticals-repair.md`).
- **G9.4** — minimum‑crew effects (the ✱ box on the crew track).
- **F3.211** — seeking‑weapon control capacity derivation from sensor rating.

## Domain Model

The model splits cleanly into the **catalog layer** (static, versioned, shared across all games) and the **runtime layer** (one document per ship per game). Reference codes (R0.1) are the join keys linking instance ↔ catalog entry ↔ Master Ship Chart (Annex #3).

```ts
// ---------- CATALOG LAYER (static, versioned) ----------

type ReferenceCode = string;            // e.g. "R2.2" (Fed DN), refit "R2.R1", fighter "R2.F8"
type RoleClass = 'CA'|'CC'|'CL'|'NCL'|'DN'|'DD'|'FF'|'ESC'|'BASE'|'PF'|'TUG'|'FRT'|string;
type SizeClass = 0|1|2|3|4|5|6|7;       // R0.6
type EntityType = 'ship'|'base'|'pf'|'shuttle'|'fighter'|'seekingWeapon';
type ArcCode = 'FA'|'FH'|'LF'|'RF'|'LR'|'RR'|'L'|'R'|'RA'|'360'|string; // D2.0; combined arcs allowed
type DamageRoute =                        // DAC column this box answers to (D4.0)
  'F-HULL'|'C-HULL'|'R-HULL'|'BRIDGE'|'POWER'|'WEAPON'|'DRONE'|'EXCESS'|string;

interface Empire {
  empireNumber: number;                  // R2 = Federation, etc. (R0.1)
  code: string;                          // 'FED','KLI','ROM',...
  name: string;
}

interface ShipDataTable {                // R0.8.5 scalar header
  bpv: { full: number; partial?: number }; // S2.1; "75/50" => {full:75,partial:50}
  breakdownRating: [number, number];     // die range, e.g. [3,6] (C6.5)
  shieldCost: { base: number; refit?: number };   // D3.3
  lifeSupportCost: number;               // B3.3 (by size class)
  sizeClass: SizeClass;                  // R0.6
  cloakCost?: { withWarp: number; withoutWarp: number; optionalRefit?: number }; // G13.2
  reference: ReferenceCode;              // R0.1 join key
  infoBar: string[];                     // free-text notes (e.g. "cloak included in BPV")
}

interface RefitDefinition {              // R0.8 item 9 shaded boxes + R0.8.5 REFITS
  code: ReferenceCode;                   // "R2.R1"
  name: string;                          // "AWR Refit"
  year: number;                          // available from this scenario year
  bpvDelta: number;                      // added BPV
  enablesBoxIds: string[];               // shaded boxes/weapons toggled on
}

interface ShieldFacingDef { facing: 1|2|3|4|5|6; max: number; }     // R0.8.9
interface SystemBoxDef {
  boxId: string; type: string;           // 'BRIDGE','IMPULSE','L-WARP','TRANS','LAB','BTTY',...
  route: DamageRoute;                     // DAC routing key
  refitGated?: ReferenceCode;             // present only if this refit is configured (shaded box)
}
interface WeaponMountDef {
  boxId: string; weaponClass: string;     // 'PH-1','PH-3','PHOTON','DISR','PL-F','DRN-RACK',...
  arc: ArcCode; tableRef: string;         // Master Weapons Chart / phaser table id
  route: DamageRoute; refitGated?: ReferenceCode;
}
interface PowerSourceDef {
  boxId: string; kind: 'warpL'|'warpC'|'warpR'|'impulse'|'APR'|'AWR'|'battery';
  output: number; route: DamageRoute; refitGated?: ReferenceCode;
}
interface RatingTrackDef {               // descending strip; current = highest undamaged box
  kind: 'sensor'|'scanner'|'damageControl'|'excess';
  steps: number[];                        // e.g. [6,5,4,3,2,1,0]
}
interface ConsumableTrackDef {
  kind: 'droneRack'|'antiDrone'|'transporterBomb'|'dummyBomb'|'probe'|'pseudoPlasma';
  slots: number;                          // box count = max carriable
  defaultReloadSets?: number;             // R0.3 (1 set/rack if silent)
  allowedTypes?: string[];                // drone types loadable per rack
}
interface CrewTrackDef {
  crewUnits: number; minCrewIndex: number; // ✱ box (G9.4)
  boardingParties: number; deckCrews: number;
}
interface TurnModeDef { category: string; bands: { speedMin: number; speedMax: number; straightHexes: number }[]; }
interface MovementCostDef { costPerHex: number; hetEnergy: number; erraticEnergy: number; } // C2.0 / C6.52

interface SsdTemplate {                   // = one catalog entry / one ship class
  shipTypeId: string;                     // stable internal id
  reference: ReferenceCode; shipTitle: string; entityType: EntityType;
  roleClass: RoleClass; sizeClass: SizeClass; commandRating: number;
  dataTable: ShipDataTable;
  crawford: { yearInService: number|null; dockingPoints: number; explosionStrength: number };
  shields: ShieldFacingDef[];             // 6 facings
  systemBoxes: SystemBoxDef[];
  weaponMounts: WeaponMountDef[];
  powerSources: PowerSourceDef[];
  ratingTracks: RatingTrackDef[];
  consumables: ConsumableTrackDef[];
  crew: CrewTrackDef;
  shuttleBays: { bayId: string; capacity: number; advancedShuttleBoxes: boolean }[]; // R0.8.4
  turnMode: TurnModeDef; movementCost: MovementCostDef;
  refits: RefitDefinition[];
  podVariants?: SsdTemplate[];            // tugs/modular ships (R0.8): selectable per pod config
  carrierData?: CarrierDataRow[];         // R0.7 (carriers only)
  imageMapId?: string;                    // -> SsdImageMap in 'ssdImageMaps' (page image + control overlay; mapped in B4)
}

interface CarrierDataRow {                // R0.7
  yearRange: [number, number]; escorts: ReferenceCode[];
  fighterCount: number; fighterType: ReferenceCode; ewFighterImplicit: boolean;
}
```

The **runtime layer** is the deterministic fold target. It never deletes template geometry; it carries per‑box status:

```ts
// ---------- RUNTIME LAYER (mutable, per ship per game) ----------
type BoxStatus = 'intact'|'destroyed'|'captured'|'crossedOut';

interface ShipRuntimeState {
  shipInstanceId: string; gameId: string;
  shipTypeId: string; templateVersion: string;   // pins catalog version for replay determinism
  refitConfig: ReferenceCode[]; scenarioYear: number; podVariantId?: string;
  counterId?: string;                              // R0.8.7 map-counter binding
  effectiveBoxIds: string[];                       // resolved set after refit/year gating

  boxStatus: Record<string, BoxStatus>;            // every system/weapon/power/hull box
  shieldStrength: Record<1|2|3|4|5|6, number>;     // current per-facing points
  weaponState: Record<string, WeaponRuntime>;      // loaded/armed/fired/destroyed + arming clocks
  powerOutputAvailable: Record<string, number>;    // per source after damage
  ratingCurrent: { sensor: number; scanner: number; damageControl: number };
  excessDamage: number;
  consumables: Record<string, { slotsUsed: boolean[]; reloads: boolean[]; type?: string }>;
  crew: { units: boolean[]; minCrewBreached: boolean; boardingParties: boolean[]; deckCrews: boolean[] };
  flags: { uncontrolled: boolean; undermanned: boolean; cloakActive: boolean };
}

interface WeaponRuntime {
  state: 'unarmed'|'partial'|'armed'|'held'|'overloaded'|'fired'|'destroyed';
  loadedEnergy: number; lastFiredImpulse: number|null; firedThisTurn: boolean;
}
```

**Image‑overlay layer (the SSD page image + a control overlay).** Rather than redraw each SSD, the platform displays the **actual SSD page image** — the owner's scan, served directly because the whole app is gated to verified product owners — and lays an interactive **control overlay** on top of it. The overlay is a set of **hotspots**, one per addressable element (each shield‑point box, system box, weapon mount, power box, rating step, consumable/crew slot, and DAC cell), positioned in **image‑relative (normalized) coordinates** and bound to a content `boxId`. The viewer (`D2-ssd-viewer-ui.md`) draws live state — destroyed, depleted, loaded, crossed‑out, repairing, criticaled — as markers at those hotspot positions over the image, and routes every click/hover to the same `boxId`. Hotspots are **hand‑mapped** per ship in the SSD image‑overlay editor (`B4-ssd-layout-editor.md`); the image itself carries all the static artwork, so we store only the picture plus the overlay — no redrawn geometry.

```ts
// ---------- IMAGE-OVERLAY LAYER (the SSD page image + hand-mapped hotspots) ----------
// Hotspot coordinates are NORMALIZED to the image (0..1 on each axis) → resolution-independent overlay.

type Norm = number;                          // 0..1 relative to image width / height
type HotspotKind =
  | 'shieldBox' | 'systemBox' | 'weaponMount' | 'powerBox' | 'ratingStep'
  | 'consumableSlot' | 'crewBox' | 'dacCell' | 'track' | 'region';
type HotspotShape =
  | { type: 'rect'; x: Norm; y: Norm; w: Norm; h: Norm }
  | { type: 'poly'; points: [Norm, Norm][] };

interface SsdImageRef {                       // the page-scan asset (served ONLY to entitled owners)
  assetKey: string;                           // object-store key; gated by ownership entitlement
  book?: string; page?: number;
  pxWidth: number; pxHeight: number;          // native pixel size (basis for the normalized coords)
}
interface Hotspot {                           // one interactive region of the overlay, bound to a content box
  hotspotId: string; boxId: string;           // -> a content box (system/weapon/power/shield/track/DAC slot)
  kind: HotspotKind; shape: HotspotShape;
  label?: string;                             // tooltip override (else from the content def)
  arc?: ArcCode;                              // weapon mounts (D2.0)
  facing?: 1|2|3|4|5|6; shieldIndex?: number; // shield-point hotspots (R0.8.9)
  dac?: { col: 1|2|3|4|5|6; row: number };    // DAC cell hotspots (D4.0)
  refitGated?: ReferenceCode;                 // shaded refit element — overlay shows it only when configured
}
interface SsdImageMap {                       // = one ship's page image + its complete control overlay
  mapId: string; shipTypeId: string; mapVersion: string;
  image: SsdImageRef;
  hotspots: Hotspot[];                         // exhaustive: one per addressable element on the page
  authoredBy: string; status: 'draft'|'published'|'deprecated';
}
```

**Mongoose sketch.** Catalog entries are a versioned, mostly read‑only collection; runtime is event‑sourced (see `A3-data-architecture-event-store.md`) and snapshotted.

```ts
// catalog (collection: 'ssdTemplates') — one doc per (reference, catalogVersion)
const SsdTemplateSchema = new Schema({
  shipTypeId: { type: String, index: true },
  reference:  { type: String, index: true },         // R0.1
  catalogVersion: { type: String, index: true },     // semver, e.g. "2014.1.0"
  source: { book: String, page: Number, revision: String }, // import provenance
  shipTitle: String, entityType: String, roleClass: String, sizeClass: Number,
  dataTable: Schema.Types.Mixed, crawford: Schema.Types.Mixed,
  shields: [Schema.Types.Mixed], systemBoxes: [Schema.Types.Mixed],
  weaponMounts: [Schema.Types.Mixed], powerSources: [Schema.Types.Mixed],
  ratingTracks: [Schema.Types.Mixed], consumables: [Schema.Types.Mixed],
  crew: Schema.Types.Mixed, shuttleBays: [Schema.Types.Mixed],
  turnMode: Schema.Types.Mixed, movementCost: Schema.Types.Mixed,
  refits: [Schema.Types.Mixed], podVariants: [Schema.Types.Mixed], carrierData: [Schema.Types.Mixed],
  status: { type: String, enum: ['draft','published','deprecated'], default: 'draft' }
}, { timestamps: true });
SsdTemplateSchema.index({ reference: 1, catalogVersion: 1 }, { unique: true });

// catalog version manifest (collection: 'catalogVersions')
const CatalogVersionSchema = new Schema({
  version: { type: String, unique: true }, parentVersion: String,
  publishedAt: Date, publishedBy: String, changelog: String,
  entryRefs: [String], frozen: { type: Boolean, default: false }
});

// runtime snapshot (collection: 'shipSnapshots') — fast load; authoritative state = fold over gameEvents
const ShipSnapshotSchema = new Schema({
  gameId: { type: String, index: true }, shipInstanceId: { type: String, index: true },
  atEventSeq: Number, state: Schema.Types.Mixed
});

// page image + control overlay (collection: 'ssdImageMaps') — one hand-mapped doc per ship class, versioned.
// The image binary lives in owner-gated object storage; only entitled owners ever receive the asset URL.
const SsdImageMapSchema = new Schema({
  mapId: { type: String, unique: true },
  shipTypeId: { type: String, index: true },
  mapVersion: { type: String, index: true },        // tracks catalog version it was mapped against
  image: Schema.Types.Mixed,                         // SsdImageRef { assetKey, book, page, pxWidth, pxHeight }
  hotspots: [Schema.Types.Mixed],                    // Hotspot[] — normalized coords, bound to content boxIds
  authoredBy: String,
  status: { type: String, enum: ['draft','published','deprecated'], default: 'draft' }
}, { timestamps: true });
SsdImageMapSchema.index({ shipTypeId: 1, mapVersion: 1 });
```

## Events & Commands

The catalog is largely administrative, but **instantiation and build‑time configuration** are first‑class commands. Per‑box *mutation* during play is owned by other subsystems; this doc supplies the **reducer** that folds their events onto `ShipRuntimeState`.

**Commands consumed**

```ts
ImportCatalogEntry  { source: {book,page,revision}, draft: SsdTemplate }
PublishCatalogVersion { version, parentVersion, entryRefs: ReferenceCode[], changelog }
InstantiateShip     { gameId, sideId, reference, catalogVersion, scenarioYear,
                      refitConfig: ReferenceCode[], podVariantId?, bpvSelection: 'full'|'partial' }
ApplyRefitConfig    { shipInstanceId, refitConfig: ReferenceCode[] }   // setup only
CrossOutUnusedBoxes { shipInstanceId, boxIds: string[] }               // R0.8.1 crew/ammo
SelectPodConfiguration { shipInstanceId, podVariantId }                // tugs/modular ships
```

**Events emitted (past tense; see canonical names in `A3-data-architecture-event-store.md`)**

```ts
CatalogEntryImported   { reference, catalogVersion, source }
CatalogVersionPublished{ version, entryRefs }
ShipInstantiated       { shipInstanceId, gameId, sideId, reference, catalogVersion,
                         scenarioYear, refitConfig, podVariantId, effectiveBoxIds,
                         bpvApplied: number }
RefitConfigApplied     { shipInstanceId, refitConfig, effectiveBoxIds }
BoxesCrossedOut        { shipInstanceId, boxIds }
PodConfigurationSelected { shipInstanceId, podVariantId }
```

**Events folded but not emitted here** (the reducer maps them onto boxes; emitters are the named docs): `DamageAllocated`/`ShieldDamaged` → `C7-damage-criticals-repair.md`; `EnergyAllocated` → `C2-energy-allocation-power.md`; `WeaponFired`/`WeaponArmed` → `C4-direct-fire-combat.md`; `SeekingWeaponLaunched` → `C5-seeking-weapons.md`; `MovementPlotted`/`HighEnergyTurnUsed`/`BreakdownOccurred` → `C3-movement-engine.md`; control/crew/cloak transitions → `C8-ew-sensors-cloak.md`. A `GmOverrideApplied { target: {shipInstanceId, boxId|field}, value, reason }` can force any box state or scalar.

## Engine / API

Pure functions where possible; the reducer is total and deterministic.

```ts
// catalog resolution
loadTemplate(reference: ReferenceCode, version: string): SsdTemplate
resolveEffectiveBoxSet(t: SsdTemplate, refitConfig: ReferenceCode[], year: number, podVariantId?: string)
  : { boxIds: string[]; weaponMounts: WeaponMountDef[]; powerSources: PowerSourceDef[] }
selectBpv(t: SsdTemplate, refitConfig: ReferenceCode[], which: 'full'|'partial'): number  // S2.1 + refit deltas

// instantiation + fold
instantiateShip(t: SsdTemplate, cmd: InstantiateShip): ShipRuntimeState
foldShipEvents(initial: ShipRuntimeState, events: DomainEvent[]): ShipRuntimeState
applyEvent(state: ShipRuntimeState, ev: DomainEvent): ShipRuntimeState     // total reducer

// derived queries (recomputed from current state)
energyBudget(s: ShipRuntimeState): { fromWarp:number; fromImpulse:number; fromBattery:number; total:number }
currentRating(s: ShipRuntimeState, kind:'sensor'|'scanner'|'damageControl'): number
seekingControlCapacity(s: ShipRuntimeState, carriesSeeking: boolean): number  // R0.3#5 / F3.211
mountsInArc(s: ShipRuntimeState, targetBearing: number): WeaponMountDef[]      // D2.0
shieldFacingForBearing(bearing: number): 1|2|3|4|5|6

// validation
validateBoxMutation(s: ShipRuntimeState, boxId: string, op: 'destroy'|'capture'|'crossOut'): Result
validateInstantiation(t: SsdTemplate, cmd: InstantiateShip): Result

// import path
importSsdBook(book: 'AMSSDs2014'|'BasicSetSSDs', pages: number[]): SsdTemplate[]  // see import section
```

`seekingControlCapacity` returns the current sensor rating when the ship itself carries seeking weapons, else half (rounding per F3.211 — see Open Questions). `currentRating` returns the highest undamaged step in the descending track. `energyBudget` sums `powerOutputAvailable` over undestroyed sources for the energy‑allocation phase (`C2-energy-allocation-power.md`).

## Validation & Enforcement Rules

The referee enforces the following; each numbered item is an explicit **GM‑override point** (`GmOverrideApplied`):

1. **Refit/year gating (R0.8.9).** A shaded box is in `effectiveBoxIds` only if its `refitGated` code is in `refitConfig` **and** `refit.year ≤ scenarioYear`. Instantiation rejects a refit whose year exceeds the scenario year unless overridden.
2. **Box mutation legality.** `destroy`/`capture` is rejected on a `crossedOut` or non‑existent box; the running internal‑damage total and "last crew unit / last 2 boarding parties cannot be killed by internal damage" protection (G9) are enforced by the crew reducer.
3. **Crew/ammo cross‑out (R0.8.1).** At setup, `CrossOutUnusedBoxes` may only target oversized crew/boarding tracks (e.g., large‑base SSDs) and unused consumable slots; reconciled against Annex #3 assigned crew. Over‑crossing is rejected.
4. **BPV selection (S2.1).** When `dataTable.bpv` is a pair, the engine records `bpvApplied` and the chosen role; mismatched selection (e.g., partial BPV on a fully crewed warship) is flagged for GM confirmation.
5. **Carrier coupling (R0.7).** A carrier cannot be instantiated without its escort set; escorts cannot be fielded standalone (except documented warship exceptions, e.g. early Kzinti CL escorts). Substitutions may only **downgrade** (earlier/smaller).
6. **Pod variants.** Tugs/modular ships must select exactly one `podVariantId`; the chosen variant's turn‑mode and movement‑cost charts become authoritative.
7. **Rating recompute.** After any track hit, derived capacities (seeking control, EW feed, repair rate) are recomputed; stale cached values are never trusted.

## UI Contract

The client needs, per ship: the **`SsdImageMap`** (the page‑image asset URL + the hotspot overlay) joined with the **content** (box definitions) and **live status** for every box, so the panel displays the real SSD page and draws intact/destroyed/crossed‑out/loaded markers at each hotspot — no rulebook lookup needed (Commander's‑SSD philosophy, R0.2). The image is the faithful view; the panel subscribes to a per‑ship state projection and highlights legal targets/arcs (by hotspot) on hover. Fog‑of‑war: opponents receive only public boxes (shield strengths, visible hull) — internal box status is withheld server‑side until revealed (and the *image URL itself* is gated to entitled owners). The screen and interaction model live in **`D2-ssd-viewer-ui.md`** (wireframe **`wireframes/D2-ssd-viewer.svg`**); the image maps themselves are produced in **`B4-ssd-layout-editor.md`**.

## Dependencies

- **`A3-data-architecture-event-store.md`** — event log, snapshots, reducer framework, `GmOverrideApplied`.
- **`B1-rules-content-api.md`** — R‑section identity codes; the gated rules deep‑links (`B1-rules-content-api.md`) keyed by reference code.
- **`C3-movement-engine.md`** — consumes `turnMode` and `movementCost`; emits HET/breakdown events folded here.
- **`C2-energy-allocation-power.md`** — consumes `powerSources`, `dataTable` costs (shield/life‑support/cloak).
- **`C4-direct-fire-combat.md`** / **`C5-seeking-weapons.md`** — consume `weaponMounts`/arcs and consumable tracks.
- **`C7-damage-criticals-repair.md`** — owns D4.0; uses our `DamageRoute` keys and box set.
- **`C8-ew-sensors-cloak.md`** — control/hull/crew/cloak/tractor/scout box semantics layered on this catalog.
- **`B4-ssd-layout-editor.md`** — authors the `SsdImageMap` records this catalog stores and `D2-ssd-viewer-ui.md` renders; binds every overlay hotspot to a content `boxId` here.
- **`D2-ssd-viewer-ui.md`** — consumes content + `SsdImageMap` + runtime status to show each ship's real SSD page with live state overlaid.
- Serviced by: every game session builds its order of battle from this catalog at scenario setup.

## Edge Cases & Open Questions

- **DAC not embedded here.** R0.0 only points to D4.0; the die‑roll→box table and hit‑distribution order are owned by `C7-damage-criticals-repair.md`. Our model supplies only the `DamageRoute` routing keys.
- **BPV pair semantics.** Rules for which value (full vs partial, e.g. 75/50, 26/12) applies in which scenario role (uncrewed/auxiliary/captured) are not fully specified in R0.0 — confirm before locking `bpvSelection`.
- **Shield facing ↔ hex side ↔ arc mapping** (#1 front … #6) is implied by SSD layout and D2.0, not enumerated in R0.0; `shieldFacingForBearing`/`mountsInArc` must be verified against C3.0/D2.0.
- **Seeking‑control rounding** (half sensor rating, R0.3#5) — confirm round‑up vs round‑down in F3.211.
- **Per‑ship numerics** (shield strengths, exact box counts, engine outputs) are *not* in R0.0 — they come from digitizing each SSD (import path below) or Annex #3.
- **Crawford table is duplicative** (YS/DK/EX/CR) — single source of truth is the catalog entry, not the printed copy.
- **Legacy SSDs** lack newer upgrade boxes; the canonical model follows the latest Master layout, not legacy sheets.

## Testing

- **Round‑trip fixtures.** Digitize the two sample SSDs cited in R0.0 and assert scalars: *Small Aux Carrier* (R1.13) → BPV {full:75, partial:50}, breakdown [3,6], shieldCost {base:0.5, refit:0.5}, lifeSupport 0.5, sizeClass 4, turn‑mode category C (speed 2‑4 → 1 straight hex … 28+ → 6), Crawford {DK:3, EX:6, CR:3}; *Fed DN* (R2.2) → BPV {full:180}, lifeSupport 1.5, sizeClass 2, AWR refit (Y170) +2, Crawford {YS:148, DK:10, EX:24, CR:10}.
- **Refit gating.** Instantiate Fed DN at year 169 vs 171 with the AWR refit and assert the shaded AWR box is excluded then included, and `bpvApplied` rises by 2.
- **Reducer determinism.** Replay an event stream twice; assert identical `ShipRuntimeState` (snapshot equality) — guarantees lockstep/replay parity (`A4-realtime-sync-layer.md`).
- **Derived recompute.** Apply sensor‑track hits and assert `seekingControlCapacity` and `currentRating('sensor')` step down correctly.
- **Cross‑out legality.** Attempt to cross out an in‑use weapon box → rejected; cross out surplus base crew boxes → accepted.

## Phasing

- **[v1 AM-tournament]** — full Template/Instance data model; refit/year resolution; the deterministic reducer; BPV/Crawford/turn‑mode/movement scalars; shield + system + weapon + power + rating + consumable + crew tracks; catalog versioning; digitization of the **tournament‑legal ship set** (the cruisers/destroyers fielded in AM tournament play). Includes the **`SsdImageMap`** (page image + hand-mapped hotspot overlay, authored in B4) for each tournament-legal ship, so the viewer shows the real book SSD with live state on top. This is the minimum to stand up authoritative play.
- **[v2]** — tug/modular‑ship pod variants and multiple turn‑mode/movement charts; full Carrier Data Chart coupling and downgrade substitution; fighter SSDs and Annex #4 substitution; admin/advanced‑shuttle ("A") boxes.
- **[v3 full Master]** — complete empire roster import, monsters (size class 0), bases (size class 1) with augmentation modules, and the long tail of refit/year permutations across the entire Master Rulebook.

### Import path from the SSD books

The catalog is built by **`importSsdBook`**, a semi‑automated pipeline over `SFB/AMSSDs2014color.pdf` (All Master SSDs, 148 pp) and `SFB/SFBBasicSetSSDscolor.pdf` (Basic Set SSDs). Per page it (1) crops each SSD region, (2) OCR/visually extracts the Ship Data Table scalars, shield‑box counts per facing, labeled system boxes, weapon mounts with their printed arc codes, power blocks, and rating strips, (3) emits a **draft `SsdTemplate`** with `source: {book, page, revision}` provenance, (4) flags shaded (refit) boxes for `RefitDefinition` binding, and (5) routes the draft to human verification before `PublishCatalogVersion`. Each published `catalogVersion` is immutable and **frozen**; instances pin `templateVersion` so a game started under `2014.1.0` replays identically even after the catalog advances (e.g., Module G3A carrier‑chart updates). Only structured game data is stored as catalog content — numeric facts and box definitions.

The **image map** (`SsdImageMap`) is produced separately and by hand: per the product decision, the platform serves the **actual SSD page image** (gated to owners) and an author maps an interactive **hotspot** over each box in the **SSD image‑overlay editor** (`B4-ssd-layout-editor.md`), binding each to a content `boxId`. No artwork is redrawn — the scan is the display; we author only the overlay. The image binary lives in owner‑gated object storage and is released solely to entitled owners (`E4-security-integrity.md` / `A2-identity-roles-gating.md`). Image maps are versioned and published alongside the catalog. (The content‑scalar import above pre‑seeds a ship's box set so the author only has to *map* hotspots, not re‑enter boxes.)

### Weapon inventory & firing arcs — data acquisition (REQUIRED, from the SSDs)

**There is no comprehensive machine‑readable inventory of per‑ship weapon mounts and their firing arcs.** Which weapon occupies which arc is ship‑specific information drawn on each **SSD** (every weapon box sits in its firing position, keyed to the six‑sector arc template, D2.0); partial textual hints exist in the R‑section ship descriptions and the Master Ship Chart/annexes, but nothing structured and complete. **We searched for an authoritative external dataset and found none** — ADB publishes only copyrighted PDF Master Ship Charts, sfbonline.com is a closed licensed implementation, and community resources (the SWA BPV calculator, fan SSD scans, the open‑source companion app) are tools/scans, not a reusable arc inventory. **So we build the inventory ourselves**, extracting it from the SSDs we own. The per‑ship **weapon mounts + arcs** (`WeaponMountDef.weaponClass`, `.arc`) and the full system box set are therefore a first‑class, required v1 **data‑acquisition task**, not an automatic import.

The extraction is captured during the **B4 image‑overlay mapping pass**: as the author maps each ship's SSD, every **weapon hotspot** is bound to its mount and tagged with its firing arc (B4's `AssignArc` / arc picker, validated by B4 rule "arc legality"). The result is the authoritative per‑ship weapon‑inventory‑with‑arcs that:

- **`C4-direct-fire-combat.md`** reads for the in‑arc test, fire eligibility, and resolution, and
- **`D5-targeting-combat-ui.md`** reads to draw firing‑arc overlays and per‑weapon in‑arc/in‑range eligibility.

Where R‑section text or the Master Ship Chart lists arcs, it is used to **cross‑check** the SSD extraction, not replace it. Until a ship's weapon arcs are extracted, that ship cannot be fielded in authoritative play (targeting/combat would lack arc data) — so weapon‑arc extraction gates a ship's v1 readiness alongside its box content and image map (see `E6-roadmap-phasing.md`).
