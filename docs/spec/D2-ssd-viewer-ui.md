# D2 — Ship Token & Interactive SSD Viewer

## Purpose & Scope

This document specifies the client surface that turns the abstract per‑ship state into the players' primary "instrument panel": the **ship token** rendered on the battle map and the **interactive Ship System Display (SSD) viewer** that opens when a token is clicked. The SSD is, in tabletop play, both the printed schematic and the live state record for one ship (R0.8); SFB Player preserves that experience by rendering every shield box, system box, weapon mount, power block, rating strip, and consumable track with its current status — operational, damaged, destroyed, crossed‑out, loaded, or repairing — so a commander never needs a rulebook lookup at the table (the Commander's‑SSD philosophy, R0.2). Crucially, the viewer **displays the actual SSD page image** — the owner's scan, served directly because the platform is gated to verified owners — and lays an interactive **control overlay** on top of it, defined by the ship's `SsdImageMap` (`B3-game-catalog-ssd-model.md`, mapped in `B4-ssd-layout-editor.md`). Every box on the page has a **hotspot** bound to a content `boxId`; the viewer draws live status — destroyed, depleted, loaded, crossed‑out, repairing, criticaled — as markers at those hotspot positions over the image, and routes every click/hover to the bound box. The page image *is* the faithful display; an optional **data view** lists the same boxes as a structured fallback (for accessibility, or when no scan is available). D2 is a **pure view**: it renders state and forwards player choices to the owning engines, but it makes no tactical or legality decisions of its own. It does not compute damage, energy, or fire legality — those belong to `C7-damage-criticals-repair.md`, `C2-energy-allocation-power.md`, and `C4-direct-fire-combat.md`; D2 assembles a fog‑filtered view‑model from their folds and provides the click targets through which the player marks damage, picks a repair, or opens a rule citation.

**PHASE:** [v1 AM-tournament] the token chrome + full SSD viewer for the tournament ship roster — shields, system/weapon boxes with live status, the inventory panel (drone/plasma/anti‑drone ammo, shuttles, transporter bombs, probes), the power‑routing read‑out, damage‑marking click‑to‑place, and hover‑for‑rule deep‑links. [v2] fighter sub‑SSDs, tug/pod variant switching, scout‑channel and cloak‑fade overlays, advanced‑shuttle ("A") boxes, mobile/responsive layout. [v3] full Master roster, base augmentation modules, monsters.

## Rulebook References

- **R0.2 / R0.8 (items .1–.19)** — SSD layout the viewer reproduces: crew/boarding/deck tracks (.1), transporter bombs (.2), probes (.3), shuttlecraft table & bays (.4), Ship Data Table (.5), turn‑mode block (.6), counter ID (.7), ship title (.8), the central SSD geometry — shields/system boxes/weapons (.9), weapon tables (.10), pseudo‑plasma (.11), firing‑arc template (.12), hit‑and‑run box (.13), movement‑cost chart (.14), drone racks (.15), anti‑drone (.16), fighters (.17/.18), Crawford table (.19).
- **R0.8.9** — six shield facings (#1 front … #6) and the destroyable 1‑point system box; **shaded boxes** present only with a refit/year (gated by `B3-game-catalog-ssd-model.md`).
- **D2.0** — firing arcs / six‑sector template drawn around each weapon mount.
- **D3.21** — shield box decrement and the DOWN/dropped flag rendered on each facing.
- **D4.14 / D3.347** — the *ship‑portion* SSD (boxes + shield damage) is public to opponents/spectators, but pending **reinforcement** amounts and energy allocation stay owner‑only (the fog boundary D2 must honor).
- **D8.2** — critical‑hit effects rendered as an active‑critical badge on the affected system.
- **D9.11 / G17.0** — damage‑control rating strip and repair‑box "repairing" state.
- **G2.0 / G9.4 / G13.0 / G24.0** — ship‑level overlays: *uncontrolled* (all control boxes gone), the ✱ minimum‑crew marker, the cloak (not an SSD box — only a Cloak H&R record) and its fade state, and scout‑channel function/blinding badges.
- **R0.6 / R0.8.19** — size class and Crawford scalars (YS/DK/EX/CR) shown in the header.
- **R0.3 / F3.211** — derived read‑outs (seeking‑weapon control capacity from current sensor rating).

## Domain Model

D2 owns no authoritative game state; its model is (a) the **view‑model** the server assembles per viewer from the B3/C7/C2 folds, and (b) a small **persisted per‑user preferences** document. View‑models are derived and never event‑sourced.

```ts
type BoxRenderState =
  | 'operational' | 'damaged'      // 'damaged' = degraded but functioning (e.g. partial track)
  | 'destroyed'   | 'crossedOut'   // R0.8.1 unused boxes crossed out at setup
  | 'loaded'      | 'fired'        // weapon/consumable runtime (B3 WeaponRuntime)
  | 'repairing'   | 'criticaled';  // C7 CDR in progress / active critical (D8.2)

interface ShieldFacingVM {                 // R0.8.9, D3.21
  facing: 1|2|3|4|5|6; current: number; max: number;
  dropped: boolean; level: 'off'|'min'|'full';
  reinforcementHidden: boolean;            // true for non-owners (D3.347 fog)
  ringPct: number;                         // 0..1 for the token integrity ring
}
interface SystemBoxVM {                     // one addressable SSD box (B3 SystemBoxDef)
  boxId: string; label: string; type: string;   // 'BRIDGE','IMPULSE','L-WARP','LAB','TRANS',...
  state: BoxRenderState;
  region: 'forwardHull'|'centerHull'|'rearHull'|'controls'|'power'|'electronics'|'special';
  systemKey: string;                        // B1 rules lookup key (hover deep-link)
  highlightAsLegalDamage?: boolean;         // set during DAC marking (mirrors C7 legalBoxesForPoint)
}
interface WeaponMountVM {                    // R0.8.9/.10, D2.0
  boxId: string; weaponClass: string; arc: string;  // 'PH-1','PHOTON','DRN-RACK' + arc code
  state: BoxRenderState; loadedEnergy?: number; armedAs?: 'normal'|'overloaded'|'held';
  arcHighlighted?: boolean; systemKey: string;
}
interface PowerRoutingVM {                   // read-only reflection of C2 EnergyAllocated (D4.14 fog: owner-only)
  sources: { boxId: string; kind: string; output: number; destroyed: boolean }[];
  routes: { fromKind: string; toFunction: string; amount: number }[]; // sankey-style links
  totals: { produced: number; used: number; battery: number; balance: 'green'|'amber'|'red' };
  visible: boolean;                          // false when viewer is not the owner/GM
}
interface InventoryVM {                      // R0.8.2/.3/.4/.15/.16
  droneRacks: { boxId: string; type?: string; loaded: boolean; reloads: boolean[] }[];
  antiDrone: { loaded: boolean[]; reloads: boolean[] };
  transporterBombs: boolean[]; dummyBombs: boolean[]; probes: boolean[];
  shuttles: { counterId: string; damage: number; special?: string; bayId: string }[];
  seekingControlCapacity: number;            // R0.3#5 / F3.211 derived
}
interface ShipTokenVM {                      // the map counter D1 mounts (R0.8.7/.8)
  shipInstanceId: string; counterId?: string; sideColor: string; facing: number;
  title: string; sizeClass: number; selected: boolean;
  shieldRing: { facing: number; pct: number; dropped: boolean }[];
  overallIntegrity: number;                  // 0..1 quick glance
  flags: { uncontrolled: boolean; undermanned: boolean; cloakFade?: number; crippled: boolean };
  fog: 'full'|'shipPortionOnly'|'silhouette'; // per viewer (D4.14 / A4)
}
interface SsdViewModel {
  shipInstanceId: string; title: string; reference: string;   // R0.1 join key
  imageMap: SsdImageMap;                      // B3 page-image + hotspot overlay; boxes/shields/weapons below carry live state keyed by boxId
  imageUrl?: string;                          // resolved owner-gated page-image URL (absent for non-entitled viewers)
  viewMode: 'image'|'data';                   // 'image' = page scan + overlay (default); 'data' = structured fallback list
  header: { bpv: number; sizeClass: number; crawford: { YS:number|null; DK:number; EX:number; CR:number } };
  shields: ShieldFacingVM[]; boxes: SystemBoxVM[]; weapons: WeaponMountVM[];
  power: PowerRoutingVM; inventory: InventoryVM;
  ratings: { sensor: number; scanner: number; damageControl: number; excessDamage: number };
  crew: { units: number; min: number; minBreached: boolean };
  activeCriticals: { type: string; boxId?: string }[];        // C7 ActiveCritical
  fog: ShipTokenVM['fog']; viewerRole: 'owner'|'ally'|'opponent'|'spectator'|'gm';
}
```

```ts
// Persisted preferences (collection: 'ssdViewerPrefs') — the only thing D2 stores.
const SsdViewerPrefsSchema = new Schema({
  userId: { type: String, index: true, unique: true },
  pinnedShipIds: [String],                 // panels kept open across impulses
  dockSide: { type: String, enum: ['left','right','float'], default: 'right' },
  autoAllocateLegalDefault: { type: Boolean, default: true },  // C7 "auto-assign" convenience
  palette: { type: String, enum: ['default','colorblind'], default: 'default' },
  defaultViewMode: { type: String, enum: ['image','data'], default: 'image' }, // page scan + overlay, or structured fallback
  showArcOverlays: { type: Boolean, default: true },
  showPowerRouting: { type: Boolean, default: true }
}, { timestamps: true });
```

## Events & Commands

D2 emits **no authoritative game events**. Player actions taken on the SSD surface forward to commands owned by other subsystems; D2 owns only a UI‑preference command/event pair and read‑side queries.

**Queries / subscriptions (read side)**
```ts
RequestSsdViewModel  { gameId, shipInstanceId }            // -> SsdViewModel (fog-scoped)
SubscribeShipProjection { gameId, shipInstanceId }         // live deltas via A4 socket channel
RequestTokenSummaries { gameId }                           // ShipTokenVM[] for the D1 map layer
```

**Domain commands forwarded (owned elsewhere — D2 only renders the trigger)**
```ts
AllocateDamage            // -> C7-damage-criticals-repair.md  (click a highlighted legal box, D4.223)
AttemptCriticalRepair     // -> C7  (pick the one critical to repair this turn, D8.31)
AllocateShieldRepair / AllocateContinuousRepair  // -> C7 (which shield / which box)
ChooseStruckShield        // -> C7  (ambiguous-geometry facing pick, D3.43)
ApplyGmOverride           // -> canonical; GM forces a box/shield/critical state
```

**D2‑owned command/event (UI prefs only)**
```ts
SaveSsdViewerLayout { userId, prefs: Partial<SsdViewerPrefs> }
// emits:
SsdViewerLayoutSaved { userId, prefs }
```

The viewer **consumes** the gameplay events that mutate boxes — `ShieldStruck`, `VolleyFormed`, `DamageAllocated`, `BoxDestroyed`, `CriticalHitApplied`/`CriticalHitRepaired`, `ShieldRepaired`, `RepairProgressed`/`SystemRepaired`, `ShipDestroyed` (all from `C7`); `EnergyAllocated`/`BatteryStateChanged` (from `C2`); `WeaponArmed`/`WeaponFired` (from `C4`/`C5`); `ShipInstantiated`/`BoxesCrossedOut` (from `B3`) — and folds them into the live `SsdViewModel` the same way the server does, so optimistic previews reconcile against authoritative deltas (`A4-realtime-sync-layer.md`).

## Engine / API

The "engine" here is the **server‑side projection assembly** plus the client view fold — both pure so the two stay byte‑identical for lockstep.

```ts
// Server: assemble a fog-scoped view-model from the three folds (B3 + C7 + C2).
function buildSsdViewModel(args: {
  template: SsdTemplate;            // B3 catalog (box geometry, arcs, ratings)
  imageMap: SsdImageMap;           // B3 page-image + hotspot overlay (from B4); positions every box on the scan
  ship: ShipRuntimeState;          // B3 fold (crossed-out, weapon runtime, consumables)
  damage: ShipDamageState;         // C7 fold (box destroyed/critical/repair, shields)
  energy: EnergyAllocationState;   // C2 fold (this turn's routing; owner-only)
  viewer: ViewerContext;           // role + side, drives fog
}): SsdViewModel;

function deriveTokenSummary(
  template: SsdTemplate, ship: ShipRuntimeState, damage: ShipDamageState, viewer: ViewerContext
): ShipTokenVM;                                              // for the D1 map layer

function applyFogToSsd(vm: SsdViewModel, viewer: ViewerContext): SsdViewModel;
// D4.14: opponents/spectators keep ship-portion boxes + shield damage; strips reinforcement (D3.347),
// pending energy routing, sealed orders, and hidden cloaked-ship internals (A4 enforces server-side).

function computePowerRoutingView(energy: EnergyAllocationState, template: SsdTemplate): PowerRoutingVM;
function shieldRingFromFacings(shields: ShieldFacingVM[]): ShipTokenVM['shieldRing'];
function highlightLegalDamage(vm: SsdViewModel, legalBoxIds: string[]): SsdViewModel; // mirror C7.legalBoxesForPoint
function highlightArc(vm: SsdViewModel, weaponBoxId: string): SsdViewModel;           // D2.0 arc overlay
function resolveHoverCitation(systemKey: string): Citation;                          // B1 lookup?systemKey=
```

`buildSsdViewModel` is deterministic over the three input folds; `applyFogToSsd` is the single chokepoint that decides what a given `viewerRole` may see and is also re‑applied server‑side by `A4` before any payload leaves the process (the client copy is convenience, never the security boundary). `resolveHoverCitation` returns the `Citation` object from `B1-rules-content-api.md`, including the `#rule/<number>` anchor used by the deep‑link.

## Validation & Enforcement Rules

The viewer enforces *display* invariants only; gameplay legality is owned upstream and merely reflected:

1. **Fog boundary (D4.14 / D3.347).** A non‑owner view‑model must never contain reinforcement amounts, pending `EnergyAllocated` routing, sealed orders, or (for a fully cloaked ship, G13) internal box status. `applyFogToSsd` strips these; `A4-realtime-sync-layer.md` re‑strips authoritatively. A failed strip is a release‑blocking test, not a runtime prompt.
2. **Render‑state mapping is total.** Every `boxId` in the resolved effective set (B3 `effectiveBoxIds`) maps to exactly one `BoxRenderState`; an unmapped box is a defect, never blank.
3. **Damage‑marking surface (D4.223).** The viewer may emit `AllocateDamage` only for a box currently carrying `highlightAsLegalDamage` (the legal set is computed by `C7.legalBoxesForPoint`, never by D2). Clicking a non‑highlighted box is inert. The stepped roll list and the auto‑default live in the volley panel (`D5-targeting-combat-ui.md`); the SSD is the placement canvas.
4. **Repair pick (D8.31 / D9).** The critical‑repair badge offers exactly one `AttemptCriticalRepair` per ship per turn; shield/CDR target selection forwards to `C7` and is reflected as `repairing` until `SystemRepaired`/`ShieldRepaired`.
5. **Ship‑level overlays.** *Uncontrolled* (G2.0) is shown only when all non‑security control boxes read destroyed/captured per the C7/C8 fold; the ✱ minimum‑crew marker (G9.4) flips to a warning when `crew.minBreached`. These are derived, never set in the viewer.
6. **GM override is explicit.** Any forced box/shield/critical state arrives as `GmOverrideApplied` and renders with a distinct GM badge so players can see a ruling was applied; the GM console (`D9-gm-spectator-console.md`) is the only surface that emits it.

## UI Contract

The screen is specified by the working prototype **`wireframes/D2-ssd-viewer.html`** — it loads the ship's **actual SSD page image** (the owner's scan, e.g. `wireframes/assets/ssd-fed-ca.png`, the Federation CA) and lays the interactive control overlay on top: per-box status markers (destroyed/critical/depleted/loaded/selected), hover-for-rule tooltips, an Image/Data toggle, and zoom. (A static schematic version remains at `wireframes/D2-ssd-viewer.svg`.) The viewer is a dockable panel (default right dock; floatable/pinnable per `ssdViewerPrefs`) that opens when the player clicks a **ship token** on the battle map (`D1-map-board-ui.md`, wireframe `wireframes/D1-map-board.svg`); the token component itself — facing pip, side color, selection halo, and a six‑segment **shield‑integrity ring** with a center overall‑integrity fill and small `uncontrolled/undermanned/cloaking/crippled` flag glyphs — is owned here and mounted by the map host. Layout, top to bottom:

- **Header bar** — ship title + counter ID (R0.8.7/.8), reference code, size class, and the Crawford scalars YS/DK/EX/CR (R0.8.19); a fog chip states the viewer's access level (owner / opponent ship‑portion‑only / spectator).
- **Shield rosette** — six facings (#1 front clockwise to #6) drawn as the classic hex‑edge arrays, each showing `current/max` boxes with depleted boxes greyed and a red **DOWN** flag when dropped (D3.21). Owner‑only: a thin reinforcement halo (general + specific, D3.347); stripped for others.
- **SSD page image + control overlay** — the central panel shows the ship's **actual SSD page image** (`imageUrl`, owner‑gated) with the `SsdImageMap` **hotspot overlay** on top. Each hotspot is bound to a box (`boxId`); the viewer paints live state *at the hotspot, over the scan* — **destroyed** (red ✕ / tint), depleted shield box (shaded), crossed‑out at setup (hatch), **loaded/fired** weapon markers, **repairing** (animated), **criticaled** (D8.2 badge) — without altering the underlying image. Hovering a weapon hotspot paints its firing arc (the hotspot's `arc`, D2.0) onto the D1 map; hovering any hotspot shows its rule tooltip; clicking forwards the box action (damage marking, repair, inspect). **Pan/zoom** supports dense sheets (carriers/bases). A **view‑mode switch** (Image / Data) sits in the header: **Image** is the default scan‑plus‑overlay; **Data** is a structured box list fallback for accessibility or when no scan is available. The page image is released only to entitled owners — a non‑owner viewer gets the public‑box data view (fog).
- **Rating strips** — descending sensor / scanner / damage‑control / excess‑damage tracks (R0.8.9 bottom edge) with the current step lit; a derived read‑out shows seeking‑weapon control capacity (R0.3/F3.211) recomputed from the live sensor step.
- **Inventory panel** — drone racks (type + reload pips, R0.8.15), anti‑drone (R0.8.16), transporter bombs/dummies (R0.8.2), probes (R0.8.3), and the shuttle table with per‑shuttle damage and special‑arming notes (R0.8.4).
- **Power‑routing read‑out** (owner/GM only, D4.14) — a compact Sankey of `powerSource → function` for the current turn reflecting `EnergyAllocated`, with a green/amber/red balance chip; it is a *display* of the C2 fold, editing happens on the Energy Allocation screen (`D3-energy-allocation-ui.md`).
- **Interaction model** — clicking a token opens/raises the panel; during the DAC step the panel enters **damage‑marking mode**, highlighting the legal box set for the active point (from `C7`) and emitting `AllocateDamage` on click, in lock‑step with the stepped roll list in `D5-targeting-combat-ui.md`; the critical badge offers the one‑per‑turn repair; **hovering any box, weapon, shield, or rating shows a tooltip with its rule citation and an "open rule" deep‑link** resolved through `B1-rules-content-api.md` (`lookup?systemKey=` → `#rule/<number>`), surfacing in the rules panel `D7-rules-browser-ui.md`.

All tactical choices (which legal box to mark, which critical to repair, which shield to reinforce, which weapon to inspect) remain player decisions; D2 only renders the options the engines declared legal and forwards the click.

## Dependencies

- **`B3-game-catalog-ssd-model.md`** — the authoritative box content, arcs, ratings, refit gating, the **`SsdImageMap`** (page image + hotspot overlay), and the `ShipRuntimeState` fold the view‑model is built from.
- **`B4-ssd-layout-editor.md`** — authors the `SsdImageMap` this viewer renders; the two **share the overlay renderer** so editor preview == player view.
- **`E4-security-integrity.md` / `A2-identity-roles-gating.md`** — gate the page‑image asset URL to entitled owners; non‑owners never receive it.
- **`C7-damage-criticals-repair.md`** — live box destroyed/critical/repair status, shield boxes, the legal‑box set for damage marking, and the public‑SSD fog rule (D4.14/D3.347).
- **`C2-energy-allocation-power.md`** — the `EnergyAllocated` fold backing the power‑routing read‑out (editing on `D3-energy-allocation-ui.md`).
- **`C4-direct-fire-combat.md` / `C5-seeking-weapons.md`** — weapon arming/fired runtime and arc data rendered on mounts; seeking‑weapon tokens are owned by C5 on the D1 map.
- **`A4-realtime-sync-layer.md`** — the socket channel for `SubscribeShipProjection` and the authoritative fog strip.
- **`A3-data-architecture-event-store.md`** — the event log / snapshot fold the client view replays.
- **`A2-identity-roles-gating.md`** — supplies the `ViewerContext` role/side that drives fog.
- **`B1-rules-content-api.md`** — `Citation` + `systemKey` lookup for hover deep‑links.
- **`D1-map-board-ui.md`** — mounts the `ShipTokenVM`; **`D5-targeting-combat-ui.md`** — the volley stepper paired with damage marking; **`D9-gm-spectator-console.md`** — emits `GmOverrideApplied`; **`D7-rules-browser-ui.md`** — renders the opened citation.

## Edge Cases & Open Questions

- **Cloaked ships (G13).** A fully cloaked enemy must render as a silhouette token with no internal SSD; D2 must not even receive its boxes. The cloak is not an SSD box — only a Cloak H&R record — so the viewer shows a fade indicator, not a destroyable box. Confirm the exact reveal timing window with `C8-ew-sensors-cloak.md`.
- **Single‑bay visual split (R0.8.4).** Some SSDs print a shuttle bay as two visual boxes that are still one bay; the view‑model must label bay grouping from B3, not from box adjacency.
- **Oversized base crew tracks (R0.8.1).** Crossed‑out boxes must render distinctly from destroyed boxes; both are "non‑functional" but only destroyed boxes were lost in play.
- **Deferred effects (D4.223/H1.0).** A power box destroyed this turn still produces until end of turn; the viewer should show "destroyed (still powering)" so the power read‑out and the box state don't appear contradictory.
- **Scout channels & blinding (G24).** Special‑sensor "channel" badges (powered / blinded‑until‑impulse / function) are a [v2] overlay; v1 renders the SEN boxes as ordinary system boxes.
- **Fighter sub‑SSDs (R0.8.17).** Fighters are informal box clusters, not formal SSDs; whether they open in this viewer or a dedicated `C6-carriers-shuttles-pf.md` tray is a [v2] layout decision.
- **D9 naming.** The stack currently references both a rules‑reference panel and a GM/spectator console as "D9"; D2 deep‑links to the rules panel and forwards overrides to the GM console — reconcile filenames in the wireframe pass.

## Testing

- **Fog‑strip parity.** Build a `SsdViewModel` for owner, opponent, spectator, and GM viewers of a damaged ship; assert opponents/spectators see ship‑portion boxes + shield damage (D4.14) but **never** reinforcement (D3.347), power routing, or sealed orders; assert `applyFogToSsd` output equals the `A4` server‑side strip byte‑for‑byte.
- **Render‑state totality.** For every digitized tournament SSD, assert each `effectiveBoxId` maps to exactly one `BoxRenderState` across an event stream that destroys, criticals, repairs, and crosses out boxes.
- **Damage‑marking gate.** Drive a C7 DAC volley; assert the viewer highlights exactly `C7.legalBoxesForPoint`, that `AllocateDamage` is rejected/inert for a non‑highlighted box (D4.223), and that the SSD highlight stays in lock‑step with the D5 stepper.
- **Power‑routing reflection.** After `EnergyAllocated`, assert the Sankey totals (produced/used/battery) and the green/amber/red chip match the C2 `derived` payload; assert the panel is absent for non‑owners.
- **Hover citations.** For a sample of box `systemKey`s (bridge, phaser‑1, warp, sensor, drone rack) assert `resolveHoverCitation` returns a `Citation` whose `anchor` deep‑links to the expected rule (`#rule/D2.0` for an arc, `#rule/R0.8.15` for a drone rack), and is metadata‑only for non‑entitled users (`B1`).
- **Token integrity ring.** Step a ship through shield depletion and assert the six‑segment ring and overall‑integrity fill track the C7 shield fold; assert `uncontrolled`/`undermanned` flags flip with the G2.0/G9.4 conditions.
- **Replay determinism.** Fold the same event stream on server and client; assert identical `SsdViewModel` (snapshot equality), guaranteeing lockstep parity (`A4-realtime-sync-layer.md`).

## Phasing

- **[v1 AM-tournament]** — token chrome + integrity ring; full SSD viewer for the tournament roster: shield rosette, hull schematic with live `BoxRenderState`, rating strips, inventory panel (drones/anti‑drone/T‑bombs/probes/shuttles), owner‑only power‑routing read‑out, damage‑marking click‑to‑place paired with D5, hover‑for‑rule deep‑links, fog stripping, and the `ssdViewerPrefs` persistence. This is the minimum to play AM tournament games without paper SSDs.
- **[v2]** — fighter sub‑SSDs and carrier hangar integration, tug/pod variant switching, scout‑channel and cloak‑fade overlays, advanced‑shuttle "A" boxes, colorblind palette polish, and responsive/touch layout.
- **[v3 full Master]** — full empire roster, base augmentation modules, monsters (size class 0), and the long tail of refit/year box permutations surfaced by `B3-game-catalog-ssd-model.md`.
