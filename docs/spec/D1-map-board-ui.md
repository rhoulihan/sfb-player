# D1 — Hex Map Board UI

## Purpose & Scope

The Hex Map Board is the central spatial surface of SFB Player: the rendered hexagonal grid on which every ship, seeking weapon, marker, and terrain feature lives, and the primary instrument through which players read the tactical situation. It is a **projection and interaction layer**, not a rules engine — it folds the fog-scoped event stream into a render model, draws it with a layered SVG/Canvas pipeline (Konva on a cached static grid), and translates pointer/keyboard input into hex and token selections. It owns the coordinate system on screen (cube-to-pixel projection, the 4-digit `CCRR` hex labels, pan/zoom viewport math), the visual language of ship tokens (facing notch, side color, selection, shield pips, size scaling), terrain rendering, the click-for-detail hex inspector, and the layering/performance strategy that keeps the board at 60 fps with fleet-scale token counts. It deliberately makes **no** tactical decisions and computes **no** hidden information: the board can only show what the server's per-viewer projection already permits. Movement plotting, targeting, and the impulse clock are drawn *onto* this board by sibling overlay docs; D1 provides the canvas, the projection, the tokens, the terrain, and the inspector they all build upon.

**PHASE:** [v1 AM-tournament] delivers the hex grid, pan/zoom, coordinate readout, ship/seeking tokens with facing + side color + selection, the open-space tournament map with its barrier edge, the minimal terrain set, click-for-detail, fog-correct rendering, and the layered Konva pipeline. The full P-section terrain palette, shared GM "spotlight" presence, and movement tweening are [v2]; multi-hex gas giants, gravity-wave/nova animation, temporal-elevation rendering, and WebGL fleet-scale instancing are [v3 full Master].

## Rulebook References

- **(C1.11, C1.12)** — hexagonal grid; every unit occupies exactly one hex and faces one of six directions A–F (A = the reference "up"/north edge), the basis for token placement and the facing notch.
- **(C1.2–C1.22)** — adjacency and movement-ahead geometry; the six neighbor hexes a facing can address, used by hover/legal-hex highlighting fed from `C3-movement-engine.md`.
- **(C1.61, C1.62)** — stacking is unlimited and each counter resolves independently; the board must fan/spread co-located tokens, never block placement.
- **(D2.0)** — the six-sector firing-arc template; the board can overlay a unit's weapon arcs (consumed from `D5-targeting-combat-ui.md`).
- **(R0.6)** — size class 0–7; drives proportional token scaling (starbase ≫ frigate).
- **(R0.8.9 / D3.x)** — six shield facings 1–6; rendered as per-token shield pips (down shields shown for own/revealed units).
- **(P2.0, P3.0, P4.0, P5.0, P6.0, P9.0, P13.0)** — planets, asteroids, black holes, pulsars, nebulae, gravity waves, dust clouds: the terrain feature catalog the terrain layer draws.
- **(P17.0)** — the tournament map edge acts as an impermeable barrier; rendered as a distinct framed boundary for v1 AM-tournament maps.
- **(M7.0)** — mines are hidden until detected; only located mines (size + hex revealed) become render markers, never the hidden minefield.
- **(G13.x)** — cloaked units render at last-known/degraded position only as the fog projection permits.

## Domain Model

Geometry types reuse the canonical `HexCoord`/`Facing`/`DIR_VECTORS` from `C3-movement-engine.md`; D1 owns only the **projection** from cube space to pixels and the **render model** the client folds for drawing.

```ts
import type { HexCoord, Facing } from './C3-movement-engine'; // x+y+z===0 cube; hexId = "CCRR"

export interface PixelPoint { x: number; y: number; }

/** Map orientation + scale config. SFB hexes are flat-top, columns vertical, A = screen-up.
 *  The 2x2 layout matrix is calibrated so DIR_VECTORS['A'] projects to -y (a unit test asserts it). */
export interface MapGeometry {
  orientation: 'flatTop';            // flat-top: neighbors at 0/60/120/180/240/300 deg from north
  hexSize: number;                    // circumradius in CSS px at scale 1
  layoutMatrix: [number, number, number, number]; // cube->pixel; calibrated to A=up
  origin: PixelPoint;                 // pixel of hexId "0101" center
}

export interface Viewport {
  scale: number;                      // zoom, clamped [minScale,maxScale]
  translate: PixelPoint;              // world->screen pan offset
  width: number; height: number;      // canvas CSS size
  minScale: number; maxScale: number;
}

export type FogVisibility = 'own' | 'allied' | 'visibleEnemy' | 'contact' | 'gmRevealed';

/** One drawable ship/base. Hidden fields are simply absent when fog forbids them. */
export interface ShipToken {
  unitId: string;
  side: string;                       // owning side code (FED, KLI, ...)
  hex: HexCoord;
  facing: Facing;
  sizeClass: 0|1|2|3|4|5|6|7;         // R0.6 -> token scale
  roleClass: string;                  // 'CA','DD','BASE',... for silhouette pick
  label: string;                      // hull code / player-assigned name
  visibility: FogVisibility;
  isSelected: boolean;
  downShields?: (1|2|3|4|5|6)[];      // only when own/revealed (R0.8.9)
  statusBadges?: ('crippled'|'cloaked'|'tractored'|'het'|'breakdown'|'disengaging')[];
  stackIndex: number; stackCount: number; // for fan-spread within a shared hex (C1.61)
}

export interface SeekingToken { unitId: string; kind: 'drone'|'plasma'|'seekingShuttle'; hex: HexCoord; facing: Facing; side: string; visibility: FogVisibility; }
export interface MarkerToken  { id: string; kind: 'mine'|'webAnchor'|'wreck'|'shuttle'|'tbomb'; hex: HexCoord; visibility: FogVisibility; }

/** Terrain is resolved by C9-terrain-hazards.md; D1 only renders these descriptors. */
export interface TerrainFeature {
  id: string;
  kind: 'planetM'|'moon'|'gasGiant'|'asteroidField'|'blackHole'|'pulsar'|'nebula'|'dust'|'gravityWave'|'barrier';
  hexes: HexCoord[];                  // 1 hex (planetM), ring/disc (gasGiant), or map-wide sentinel
  scope: 'hex' | 'multiHex' | 'mapWide';
  params?: Record<string, number|string>; // radius, strength, waveRow, atmosphereDepth...
}

/** The complete, fog-filtered model the client renders each impulse. Built server-side or
 *  folded client-side from the per-viewer event stream — never contains hidden data. */
export interface MapRenderModel {
  gameId: string;
  viewerSide: string | null;          // null for GM/spectator with reveal grant
  clock: { turn: number; impulse: number|null };
  ships: ShipToken[];
  seeking: SeekingToken[];
  markers: MarkerToken[];
  terrain: TerrainFeature[];
  selection: { unitId?: string; hexId?: string };
  measure?: { fromHex: HexCoord; toHex: HexCoord; range: number }; // true hex distance
}

/** Click-for-detail payload; server-authoritative + fog-filtered (see Validation). */
export interface HexDetail {
  hexId: string; cube: HexCoord;
  terrain: { kind: string; label: string; effects: string[] }[]; // e.g. asteroid collision, nebula ECM
  atmosphere?: { depth: number; class: string };
  occupants: { unitId: string; label: string; side: string; facing?: Facing; visibility: FogVisibility }[];
  rangeFromSelected?: number;         // hex distance to current selection (C1.2 counting)
  isBarrierEdge?: boolean;            // P17.0
}
```

**Mongoose sketch.** The board is overwhelmingly client/derived state; the only durable artifact is each user's per-game view preference (last viewport, layer toggles, accessibility palette). Ephemeral live viewport/selection lives client-side and, optionally, in the A4 presence channel (Redis), never in Mongo. The scenario's map dimensions and terrain placement are owned by the catalog/scenario layer (`B3-game-catalog-ssd-model.md`) and read, not written, here.

```ts
const UserMapPrefsSchema = new Schema({
  userId:  { type: String, index: true },
  gameId:  { type: String, index: true },
  viewport: { scale: Number, translateX: Number, translateY: Number },
  layers:  { type: Map, of: Boolean },          // grid/terrain/arcs/labels/range toggles
  palette: { type: String, enum: ['default','deuter','protan','tritan','highContrast'], default: 'default' },
  showCoordsAlways: { type: Boolean, default: false },
}, { timestamps: true });
UserMapPrefsSchema.index({ userId: 1, gameId: 1 }, { unique: true });
```

## Events & Commands

The board is a **consumer**: it folds events authored elsewhere into the `MapRenderModel`. It issues only **client-local view commands** (PascalCase, but explicitly *not* appended to `gameEvents`) and one optional presence event in [v2].

```ts
// VIEW COMMANDS (client-local; never reach the authoritative event log)
type MapViewCommand =
  | { type: 'SelectUnit'; unitId: string }
  | { type: 'ClearSelection' }
  | { type: 'InspectHex'; hexId: string }                     // triggers getHexDetail query
  | { type: 'SetViewport'; viewport: Partial<Viewport> }       // pan/zoom
  | { type: 'ToggleLayer'; layer: LayerId; on: boolean }
  | { type: 'SetMeasureAnchor'; hexId: string | null };        // range ruler

// CONSUMED GAME EVENTS (fog-scoped, from A3/A4) -> fold into render model
//   ImpulseAdvanced (C3) ............ advance clock, recompute mover positions
//   UnitMoved / ShipTurned / ShipSideslipped / HighEnergyTurnExecuted /
//   TacticalManeuverPerformed (C3) .. update token hex + facing
//   DamageAllocated (D2) ............ refresh downShields + crippled badge
//   SeekingWeaponLaunched / SeekingWeaponMoved (C5) .. add/move seeking tokens
//   MineDetected (M7, C10) .......... add a mine MarkerToken (only when detected)
//   TerrainEffectApplied (C9) ....... move gravity wave row, reveal hazard
//   UnitDestroyed .................... replace token with wreck marker
//   FogRevealed (A4/A2, GM) ......... promote hidden units to gmRevealed visibility

type MapPresenceEvent =                                         // [v2] via A4 presence, not gameEvents
  | { type: 'MapSpotlightShared'; bySide: string; hexId: string }; // GM/teammate shared pointer
```

Real **game** commands that originate from clicking the board (declare a turn hex, pick a target) are forwarded to and owned by `D4-movement-plotting-ui.md` and `D5-targeting-combat-ui.md`; D1 only reports *which hex/token* was hit.

## Engine / API

Geometry is pure and deterministic; rendering and hit-testing run client-side; the single fog-sensitive call (`getHexDetail`) is server-authoritative.

```ts
// --- Pure projection (flat-top; calibrated so DIR_VECTORS['A'] -> screen up) ---
function cubeToPixel(h: HexCoord, g: MapGeometry): PixelPoint;
function pixelToCube(p: PixelPoint, g: MapGeometry): HexCoord;   // includes cube-rounding
function hexCorners(h: HexCoord, g: MapGeometry): PixelPoint[];  // 6 vertices for grid stroke
function hexSideMidpoint(h: HexCoord, dir: Facing, g: MapGeometry): PixelPoint; // facing notch anchor
function hexDistance(a: HexCoord, b: HexCoord): number;          // = C3 range counting (C1.2)
function hexesInViewport(vp: Viewport, g: MapGeometry): HexCoord[]; // culling set

// --- Viewport math ---
function zoomAt(vp: Viewport, anchor: PixelPoint, factor: number): Viewport; // cursor-anchored zoom
function clampViewport(vp: Viewport, mapBounds: { cols: number; rows: number }, g: MapGeometry): Viewport;
function worldToScreen(p: PixelPoint, vp: Viewport): PixelPoint;
function screenToWorld(p: PixelPoint, vp: Viewport): PixelPoint;

// --- Render model assembly (applies fog; pure given a fog-scoped state slice) ---
function buildMapRenderModel(slice: FogScopedGameSlice, viewerSide: string|null, sel: { unitId?: string; hexId?: string }): MapRenderModel;

// --- Layer renderers (Konva); each owns one z-band, redraws only when dirty ---
function drawGridLayer(layer: Konva.Layer, g: MapGeometry, vp: Viewport): void;         // cached/static
function drawTerrainLayer(layer: Konva.Layer, terrain: TerrainFeature[], g: MapGeometry): void;
function drawTokenLayer(layer: Konva.Layer, m: MapRenderModel, g: MapGeometry, palette: PaletteId): void;
function drawOverlayLayer(layer: Konva.Layer, m: MapRenderModel, g: MapGeometry): void;  // range, arcs, ghost track
function drawSelectionLayer(layer: Konva.Layer, m: MapRenderModel, g: MapGeometry): void;

// --- Interaction ---
function hitTestHex(screen: PixelPoint, vp: Viewport, g: MapGeometry): HexCoord;
function hitTestToken(screen: PixelPoint, m: MapRenderModel, vp: Viewport, g: MapGeometry): string | null;

// --- Server query (fog-authoritative) ---
async function getHexDetail(gameId: string, hexId: string, viewer: ViewerContext): Promise<HexDetail>;
```

`tokenTransform(token, g, vp)` derives a token's screen position, the facing rotation (`facingIndex * 60°`, A = 0°/up), the size-class scale, and the fan offset for stacked counters (`stackIndex`/`stackCount` arrange evenly around the hex center so all co-located units stay readable, honoring unlimited stacking C1.61).

## Validation & Enforcement Rules

The board's "referee" responsibility is **information hygiene** — it must be impossible to read hidden state off the screen, because the screen can only draw what the per-viewer projection contains.

- **Fog is enforced upstream, never client-side (A4/A3).** `buildMapRenderModel` consumes an already-fog-scoped slice; hidden enemy facing/speed/cloaked exact-hex are *absent* from the data, not merely hidden in CSS. A `visibility: 'contact'` enemy renders as a generic unknown chit with no facing notch; a fully hidden unit has no token at all. This mirrors the fog contract in `A4-realtime-sync-layer.md`.
- **Click-for-detail is server-authoritative.** `getHexDetail` re-applies fog on the server using `ViewerContext` (role + side from `A2-identity-roles-gating.md`); occupant lists and terrain effects a viewer is not entitled to see are filtered out before transmission. The client never assembles `HexDetail` from a richer cache.
- **Sealed orders never render.** Until `OrdersRevealed`, no plotted movement, target, or launch appears on any side's board (B2.4). The ghost movement track is drawn only on the owning side's board from its own sealed plot.
- **Detected-only markers (M7.0).** A mine becomes a `MarkerToken` only after a `MineDetected` event scoped to the viewer; the hidden minefield is never sent. Cloaked units (G13.x) render at last-known position with a `cloaked` badge only where the projection allows.
- **GM reveal is an explicit, recorded grant.** A GM "reveal fog" action raises units to `visibility: 'gmRevealed'` for that GM/spectator surface via a `GmOverrideApplied`/`FogRevealed` event; revealed tokens are visibly flagged so the operator knows they are seeing privileged data.
- **No collision, unlimited stacking (C1.61/C1.62).** The renderer must place any number of tokens in one hex via fan-spread and resolve hit-tests to the topmost; it must never refuse to draw or imply a stacking limit.
- **Coordinate + range truth.** The readout always shows the canonical `CCRR` hexId; the range ruler reports true hex distance (`hexDistance`) — effective range (EW/ECM-adjusted) is labeled as such and sourced from the combat docs, not invented here.

## UI Contract

Wireframe: **`wireframes/D1-map-board.svg`**. The board fills the center of the game screen; HUD panels (impulse clock, energy, SSD) dock around it via their own docs but render their map overlays into this layer stack.

- **A — Board canvas (center, dominant).** The hex grid rendered flat-top with direction A pointing screen-up. Grid lines are a low-contrast stroke; every Nth hex (configurable) carries its faint `CCRR` label, and the hovered hex always shows its label in the readout. The tournament map [v1] is framed by a distinct **barrier edge** (hatched border, P17.0) so players see the wall they will bounce off.
- **B — Ship tokens.** Each token is a role-class silhouette filled with its **side color**, with a **facing notch/arrow** on the leading hexside (A–F) so heading is unambiguous at a glance. Tokens **scale by size class** (R0.6). A thin ring of six **shield pips** encircles own/revealed ships, dimmed where a shield is down (R0.8.9). Status badges (crippled, cloaked, tractored, HET, breakdown, disengaging) ride the token corner. The **selected** token gets a bright selection ring + soft glow and raises a halo on its hex; allied tokens are tinted lighter, enemies in a contrasting hue, unknown contacts as neutral chits.
- **C — Seeking weapons & markers.** Drones/plasma/seeking shuttles render as small directional darts; mines (once detected), wrecks, web anchors, and dropped shuttles render as distinct marker glyphs.
- **D — Terrain layer.** Planets draw as filled discs (class-M fills one hex; moons partial; gas giants span their multi-hex disc/ring in [v2+]); asteroid hexes use a stipple/clutter texture; black holes a dark vortex; pulsars a pulsing glyph; nebula/dust/sunspot are **map-wide** tints plus a status banner rather than per-hex fills; gravity waves draw as a moving line that advances with `TerrainEffectApplied`.
- **E — Toolbar (corner).** Zoom +/−, fit-to-content, recenter-on-selection, **layer toggles** (grid labels, terrain, firing arcs, range ruler, ghost track), and the **accessibility palette** selector (default / three color-blind modes / high-contrast).
- **F — Coordinate & range readout.** A persistent strip showing the hovered `hexId`, the selected unit, and live **range** (hex distance) from selection to cursor.
- **G — Hex inspector popover.** Clicking a hex opens a small panel (the click-for-detail surface) listing terrain in the hex and its effects, atmosphere depth if any, the fog-filtered **occupant list** (label, side, facing for visible units), and range from the current selection. It is the canonical realization of `HexDetail`.
- **H — Minimap.** A culled overview in a corner with the current viewport rectangle, draggable to pan; respects fog (no hidden contacts).

Pan is click-drag or arrow keys; zoom is wheel/pinch anchored at the cursor; the whole board is keyboard-navigable (hex-by-hex cursor, Enter to select/inspect) for accessibility. Movement-plotting ghost tracks (`D4-movement-plotting-ui.md`), targeting LOS/arc overlays (`D5-targeting-combat-ui.md`), and the impulse clock (`D6-impulse-hud.md`) all draw into the **overlay layer** defined here so they compose without fighting for z-order.

**Layer z-order (back→front):** background → static grid (cached) → terrain fill → terrain features → range/measurement → ghost movement track → seeking weapons → ship tokens → selection highlight → labels/coords → fog vignette → hover/cursor. Each band is a separate Konva layer so a token move only redirties the token + selection layers, never the cached grid.

## Dependencies

- `C3-movement-engine.md` — source of `HexCoord`, `Facing`, `DIR_VECTORS`, hex distance, and the per-impulse position/facing/legal-turn-hex data the board renders.
- `B3-game-catalog-ssd-model.md` — size class, role class, side, and shield-facing layout for token geometry; scenario map dimensions and terrain placement.
- `A3-data-architecture-event-store.md` — the event log/fold the render model is built from.
- `A4-realtime-sync-layer.md` — fog-scoped event delivery, reconnection resync of the render model, and the [v2] presence channel for shared spotlight.
- `A2-identity-roles-gating.md` — viewer role/side → fog scope and GM reveal authority used by `getHexDetail`.
- `C9-terrain-hazards.md` — authoritative terrain/hazard state the terrain layer draws (planets, asteroids, black holes, nebulae, gravity waves, barrier).
- `C10-mines-boarding-misc.md` — detected-mine markers (mine state and `MineDetected` events).
- `C5-seeking-weapons.md` — seeking-weapon tokens.
- `D4-movement-plotting-ui.md`, `D5-targeting-combat-ui.md`, `D6-impulse-hud.md` — overlay consumers that render into this board's layer stack.

## Edge Cases & Open Questions

- **Hex orientation calibration.** The flat-top projection must agree with `C3-movement-engine.md`'s `DIR_VECTORS`; a calibration test asserts `cubeToPixel(neighbor(h,'A'))` is directly above `cubeToPixel(h)`. *Confirm SFB flat-top orientation and the screen-up sense of direction A against the printed map.*
- **Heavy stacking & swarms.** Carriers plus fighter groups plus drone clouds can put dozens of tokens in/near one hex; the fan-spread must stay legible and hit-testable, and the token layer may need sprite batching ([v3] Pixi/WebGL instancing) above a threshold.
- **Multi-hex bodies.** Gas giants and rings span many hexes ([v2]); terrain hit-testing and the inspector must attribute a hex to the correct body and surface hex-side occupancy for landed units.
- **Cloaked / last-known rendering.** Exactly how much position fuzz to show for a cloaked contact is a fog-policy question owned by `A4`/`G13`; the board renders whatever the projection gives and must not interpolate a truer position.
- **Map-wide hazards.** Nebula/dust/sunspot have no single hex; rendering them as a tint + banner (vs. per-hex fill) is a UX choice to validate with playtesters.
- **Off-map / barrier interactions.** Seeking weapons and displacement can interact with the edge (P17); the board must render the bounce/stop without implying a movable off-map area.

## Testing

- **Geometry round-trip.** Property test: `pixelToCube(cubeToPixel(h)) === h` for all in-bounds hexes; `hexDistance` symmetry and triangle inequality; `hexSideMidpoint` lands on the shared edge of `neighbor(h,dir)`.
- **Orientation.** Assert direction A projects to screen-up and B–F proceed clockwise at 60° (calibration test vs `DIR_VECTORS`).
- **Hit-testing.** Random screen points map to the geometrically containing hex; `hitTestToken` returns the topmost of a fanned stack; verified across zoom levels and devicePixelRatio.
- **Fog projection (security).** Given a state with a hidden/cloaked enemy, assert `buildMapRenderModel` and `getHexDetail` for the opposing viewer contain **no** token, facing, or occupant for that unit; assert a `gmRevealed` viewer does. This is the load-bearing test.
- **Stacking.** Place N units in one hex; assert N distinct, hit-testable tokens and no placement refusal (C1.61).
- **Coordinate/range readout.** Hover assertions reproduce `CCRR` labels; the range ruler equals `hexDistance` for sampled pairs.
- **Performance.** Budget test: pan/zoom and a full impulse advance with a target token count (e.g. 200) hold 60 fps via viewport culling, cached grid, and per-layer dirty redraw; only token/selection layers redraw on a single move.
- **Visual regression.** Render a fixed scenario and diff against the `wireframes/D1-map-board.svg` reference composition (token anatomy, terrain glyphs, barrier edge).

## Phasing

**[v1 AM-tournament]:** flat-top hex grid with `CCRR` labels and barrier edge; cursor-anchored pan/zoom; coordinate + range readout; ship/base/seeking tokens with facing notch, side color, size-class scaling, shield pips, selection, and status badges; the minimal terrain needed for tournament scenarios (open space, occasional planet/asteroid, the P17 barrier); click-for-detail inspector; fog-correct render model and server-authoritative `getHexDetail`; layered Konva pipeline with culling, cached grid, and per-layer dirty redraw; minimap; accessibility palettes and keyboard navigation. This is everything two fleets need to fight a tournament duel and read the board faithfully.

**[v2]:** the full P-section terrain palette (black holes, pulsars, nebulae as map-wide tints, dust, gravity-wave animation, multi-hex moons/gas giants), shared GM/teammate spotlight presence, smooth movement tweening between impulses, firing-arc overlays from `D5`, and richer minimap/measurement tools. Deferred because tournament maps are mostly open space; these add scenario depth without changing the v1 token/fog contract.

**[v3 full Master]:** multi-hex gas-giant discs with rings and hex-side landing, nova/supernova wave fronts, temporal-elevation/sub-light-elevation rendering, comet tails, and WebGL/Pixi instanced rendering for many-sided fleet engagements — rare full-Master content with heavy visual and performance demands isolated from the core board.
