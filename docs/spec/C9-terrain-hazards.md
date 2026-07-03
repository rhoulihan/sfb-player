# C9 — Terrain & Navigational Hazards

## Purpose & Scope

This subsystem is the **terrain layer**: it turns a flat hex map into a battlefield where space itself
can hurt, block, blind, and drag a ship. It models every feature in the rulebook's P section — planets,
moons, gas giants and their rings, asteroid fields, black holes, pulsars, nebulae, heat zones, radiation
zones, gravity waves, ion storms, dust clouds, novae/supernovae, sunspot activity, comets, the WYN
radiation zone, neutron stars, white dwarfs, and the tournament map-edge barrier — as **attributes of
hexes and line-of-fire paths** rather than as actors. Terrain never *decides* anything; it is pure,
deterministic environment. The design hinges on two ideas. First, every feature's effect decomposes into
exactly **four channels** — MOVEMENT (collision, crash, speed cap, involuntary pull), COMBAT (blocked
fire, weapon degradation), SHIELDS (down-shield damage, ECM), and SENSORS (lock-on breaks, sensor-rating
caps, scout-channel blinding) — so the movement (`C3-movement-engine.md`), direct-fire
(`C4-direct-fire-combat.md`), seeking-weapon (`C5-seeking-weapons.md`), damage (`C7-damage-criticals-repair.md`),
and EW/sensor (`C8-ew-sensors-cloak.md`) engines each consume one channel through a narrow query API and
never need to know what a black hole *is*. Second, almost every periodic terrain effect (heat, radiation,
dust, gravity waves, black-hole pull, nova advance, pulsar bursts) is a **scheduled effect keyed to the
impulse clock**, so a single `TerrainScheduler` driven by `C1-sequence-of-play-engine.md` fires them in
the right stage with the right randomness. All math, geometry, timing, and damage allocation is AUTOMATED;
every navigational choice — what speed to run an asteroid field at, whether to risk a planet's gravity to
break a lock, when to enter orbit, which shield to land a large asteroid against — remains a PLAYER DECISION.

**PHASE:** v1 ships the full hex-attribute framework, the four-channel query API, the `TerrainScheduler`,
the **tournament barrier (P17)**, **asteroid fields (P3)**, **class-M planets / small moons (P2 core)**,
and **standard orbits (P8)** — the terrain that appears on AM-tournament and common duel maps. Black holes,
pulsars, nebulae, gravity waves, heat/radiation zones, ion storms, dust, novae, sunspots, comets, the WYN
zone, neutron stars and white dwarfs are modeled here now but resolved in **[v2]/[v3]** (see Phasing).

## Rulebook References

- Terrain framework & planets: **P0.0, P1.0, P2.0–P2.86** — planet classes (P2.0–P2.2), atmosphere depth
  (P2.6–P2.63), blocking fire / lock-on / seeking re-target (P2.3–P2.36), landing / takeoff / crash
  (P2.4–P2.45), atmosphere ECM & weapon degradation (P2.5–P2.55), ground bases vs atmosphere (P2.722/P2.736).
- Asteroids: **P3.0–P3.45** — collision table (P3.2), ECM (P3.25), path clearing (P3.3), large asteroids (P3.4).
- Black hole / white dwarf: **P4.0–P4.29, P10.5**. Variable & regular pulsar: **P5.0–P5.355**.
- Nebula: **P6.0–P6.73**. WYN radiation zone: **P7.0–P7.96**. Standard / higher orbits: **P8.0–P8.6**.
- Gravity waves (linear & black-hole spherical): **P9.0–P9.43**. Heat zones: **P10.0–P10.6**.
- Sunspot activity: **P11.0–P11.5**. Novae / supernovae: **P12.0–P12.53**. Dust clouds: **P13.0–P13.7**.
- Ion storms: **P14.0–P14.3**. Radiation zone / neutron star: **P15.0–P15.7**. Comets: **P16.0–P16.33**.
- Tournament barrier: **P17.0–P17.4**.
- Consumed cross-refs: size classes **R0.6** (collision/devastation), Order of Precedence **C1.313**
  (involuntary-movement ordering), effective speed / movement-without-MP **C2.45/C2.451**, Dogfight
  Resolution Interface timing **6C** (heat/radiation per-DRI), Involuntary Movement Stage **6A1**,
  hidden deployment **D20.0** (terrain placement), webs block pulsar/wave **G10.751/G10.114**, stabilizers
  immune to black hole **G29.27**, displacement **G18.0**, stasis **G16.61**. Mine↔terrain interactions
  (black hole moves mines P4.14 vs M2.21; nebula disables mines P6.6) are owned by `C10-mines-boarding-misc.md`.

## Domain Model

Terrain splits into **static configuration** (placed at scenario setup, immutable once play starts) and
**dynamic state** (positions of moving fronts, pulsar schedules, surface-unit landing steps, tractor links,
units displaced by pulls). Static config rides in the scenario/map document; dynamic state is a deterministic
fold over events and lives in `gameSnapshots` (`A3-data-architecture-event-store.md`).

```ts
type HexId = string;                 // SFB 4-digit hex number, e.g. "1015"
interface Cube { q: number; r: number; s: number }  // cube coords for distance/line math (C3 owns conversion)
type ShieldFacing = 1|2|3|4|5|6;     // which facing shield terrain damage hits

type TerrainKind =
  | 'planet' | 'moon' | 'gasGiant' | 'ring'           // P2
  | 'asteroidField' | 'largeAsteroid'                 // P3
  | 'blackHole' | 'whiteDwarf' | 'neutronStar'        // P4 / P10.5 / P15.7
  | 'pulsar' | 'nebula' | 'wynRadiationZone'          // P5 / P6 / P7
  | 'heatZone' | 'radiationZone'                       // P10 / P15
  | 'gravityWave' | 'ionStorm' | 'dustCloud'           // P9 / P14 / P13
  | 'nova' | 'supernova' | 'sunspotField'              // P12 / P11
  | 'comet' | 'tournamentBarrier';                     // P16 / P17

// A placed feature. `geometry` says how it occupies the map; `params` is a
// discriminated payload (one interface per kind, sketched below).
interface TerrainFeature {
  featureId: string;
  kind: TerrainKind;
  geometry:
    | { mode: 'mapWide' }                               // nebula, dust, sunspot, ion storm
    | { mode: 'centerRadius'; center: HexId; radius: number }  // planet body, black hole, pulsar, zones
    | { mode: 'hexList'; hexes: HexId[] }               // irregular asteroid field, comet tail
    | { mode: 'movingFront'; rowHexes: HexId[]; direction: HexDir }; // gravity wave, nova front
  params: TerrainParams;
  phaseTag: 'v1' | 'v2' | 'v3';
}
type HexDir = 0|1|2|3|4|5;          // 6 hex directions

// ---- Per-kind parameter payloads (discriminated by TerrainFeature.kind) ----
interface PlanetParams {            // P2.0–P2.63
  planetClass: 'M' | 'moon' | 'gasGiant';
  diameterHexes: number;            // 1 for class-M; >=7 large gas giant has atmosphere ring (P2.62)
  airless?: boolean;                // class-M may be specified airless (P2.231)
  atmosphereHexes: HexId[];         // outer ring(s); 1 hex for class-M (P2.6)
  ringHexes?: HexId[];              // gas-giant ring material = special-damage asteroid hexes (P2.222)
  devastationPerHexSide: number;    // default 200 (P2.33)
  blocksFire: boolean;              // class-M true; moon false (P2.31/P2.32)
  lockOnBreak: 'always' | 'roll50'; // class-M always; moon 50%/impulse (P2.32)
}
interface AsteroidFieldParams { collisionTable: CollisionTable; ecmPerHex: number; /* P3.2/P3.25 */ }
interface BlackHoleParams {         // P4.1
  pullSchedule: PullScheduleRow[];  // per-range impulse list (closest-first)
  emitsGravityWave?: { strength: 100; everyTurns: 10; startTurn: 5 };
  whiteDwarf?: boolean;             // adds heat zone, halves pull ranges (P10.5)
}
interface PulsarParams {            // P5
  baseStrengthDie: '1d6x10'; rangeBands: { maxHex: number; pct: number }[]; // 5→100,10→75,20→50,50→25
  regularIntervalImpulses?: number; // P5.13 non-variable option
}
interface NebulaParams { ecm: 9; reinforceCapPerShield: 5; reinforceCapTotal: 5; disabledSystems: string[] } // P6
interface HeatZoneParams { perDriPerDownShield: 1 }                                    // P10
interface RadiationZoneParams { pointSource?: HexId; crewPerDri: 1; neutronStar?: { pullImpulse: 16; rangeCapHex: 25 } } // P15 / P15.7
interface GravityWaveParams { strength: number; blackHole?: boolean; forceByImpulse?: number[] } // P9 / P9.42
interface DustCloudParams { intense?: boolean; ecm: 1; damageTable: DustTable }       // P13
interface IonStormParams { gravityWaveSpacingHex: 32; gravityWaveStrength: 10 }       // P14
interface NovaParams { novaType: 'nova' | 'supernova'; zoneRanges: NovaZoneRanges; castOffSpeed: 20 } // P12
interface SunspotParams { ecm: 8; starDirection: HexDir; disabledSystems: string[] }  // P11
interface WynZoneParams { warpPerBoxByTurn: number[]; sensorCapByTurn: number[] }     // P7
interface CometParams { nucleusHex: HexId; tailHexes: HexId[] }                       // P16
interface BarrierParams { impactDamage: 5; mapEdgeHexSides: string[] }                // P17
type TerrainParams =
  | PlanetParams | AsteroidFieldParams | BlackHoleParams | PulsarParams | NebulaParams
  | HeatZoneParams | RadiationZoneParams | GravityWaveParams | DustCloudParams | IonStormParams
  | NovaParams | SunspotParams | WynZoneParams | CometParams | BarrierParams;

// die roll 1-6 across speed bands 1-6 / 7-14 / 15-25 / 26+ → damage points (P3.2, P2.223 ring)
type CollisionTable = { band: '1-6'|'7-14'|'15-25'|'26+'; byDie: [number,number,number,number,number,number] }[];
interface CollisionProfile { table: CollisionTable; facingForward: ShieldFacing; facingReverse: ShieldFacing }
interface PullScheduleRow { maxRangeHex: number; impulses: number[] }    // e.g. {maxRangeHex:5, impulses:[2,5,8,...]}
type DustTable = { impulse: 5|10|15|20|25|30; minSpeedBands: string[] }[];  // P13.2
interface NovaZoneRanges { radiationHex: number; heatHex: number; nebulaHex: number; pulsarEveryImpulse: number; asteroidsPerImpulse: number }
```

A unit standing on or inside terrain needs more position state than a free-space unit. Surface units carry
a hex-side and a landed/atmosphere flag (P2.21–P2.23); tractor links are first-class so pulls and barriers
can drag or break them (P4.11/P17.3); and any lock-on the sensor engine holds can be capped or expired by
terrain (P7/P5.355).

```ts
interface SurfaceUnitState {            // landed or in atmospheric flight (P2.231)
  unitId: string; planetId: string;
  hex: HexId; hexSide: HexDir;          // recorded as hex/hexSideA (atmosphere) or hex/hexSideL (landed)
  state: 'atmosphere' | 'landed';
  landing?: { system: 'gravity'|'aerodynamic'|'powered'|'crash'|'catastrophic'; step: number };
  blockedArc?: ShieldFacing;            // large-asteroid landed unit blocks one arc (P3.431)
}
interface TractorLink { aId: string; bId: string; operatedBy: string }       // dragged/broken by terrain
interface OrbitState {                  // P8
  unitId: string; planetId: string; radius: 1|2|3; pathHexes: HexId[];
  insertionDone: boolean; facingRule: 'shipTurn' | 'baseRotate';
}
interface TerrainState {                // dynamic projection inside gameSnapshots (A3)
  gameId: string;
  movedFronts: Record<string, { rowHexes: HexId[] }>;     // gravity-wave / nova positions
  pulsarSchedule: Record<string, { nextBurstTurn: number; burstImpulse: number }>;
  displacedThisImpulse: { unitId: string; fromHex: HexId; toHex: HexId }[];
  surface: SurfaceUnitState[];
  orbits: OrbitState[];
  tractorLinks: TractorLink[];
  wynCounters: Record<string, { zoneTurnCounter: number }>;
  lastEventSeq: number;
}
```

**Mongoose sketch.** Static terrain is embedded on the game/scenario document; dynamic `TerrainState` is part
of the snapshot blob. Only terrain that is *placed by hidden deployment* (D20.0) keeps a separate fog record.

```ts
const TerrainFeatureSchema = new Schema({
  featureId: { type: String, required: true },
  kind:      { type: String, required: true, index: true },
  geometry:  { type: Schema.Types.Mixed, required: true },
  params:    { type: Schema.Types.Mixed, required: true },
  phaseTag:  { type: String, enum: ['v1','v2','v3'], default: 'v1' },
  hidden:    { type: Boolean, default: false },   // placed via D20.0; fog-of-war gated
}, { _id: false });
const MapTerrainSchema = new Schema({
  gameId:   { type: ObjectId, index: true, required: true, unique: true },
  mapSize:  { cols: Number, rows: Number },       // tournament fixed size (P17)
  features: [TerrainFeatureSchema],
}, { timestamps: true });
```

## Events & Commands

Terrain is mostly **referee-applied**, so most of its work is the scheduler emitting result events. Player
decisions that touch terrain are a small command set; ordinary `PlotMovement` (owned by `C3`) flows through
the movement engine, which calls C9's query API to validate paths.

**Commands consumed** (PascalCase):

| Command | Payload | Notes |
|---|---|---|
| `EnterOrbit` | `{ gameId, unitId, planetId, radius }` | Insert into a standard/higher orbit (P8.1). |
| `InitiateLanding` | `{ gameId, unitId, planetId, hexSide, system }` | Begins the multi-step landing (P2.4). |
| `InitiateTakeoff` | `{ gameId, unitId }` | Begins takeoff (P2.43). |
| `DeclareAsteroidColumn` | `{ gameId, leaderId, followerIds }` | Column follow-the-leader, max length 2 (P3.23). |
| `ChooseBlockedArc` | `{ gameId, unitId, shieldArc }` | Large-asteroid landed unit picks blocked arc (P3.431). |
| `ResolveInvoluntaryMovement` | `{ gameId, expect: GameClock }` | Engine-issued at 6A1; folds pulls/wave advance. |
| `ResolveTerrainTick` | `{ gameId, expect: GameClock }` | Engine-issued per-DRI / per-impulse-÷N effects. |
| `ApplyGmOverride` | `{ gameId, target, value, reason }` | Override any terrain roll/result (A2). |

**Events emitted** (past-tense): `InvoluntaryMovementResolved {moves:[{unitId,fromHex,toHex,cause}]}` ·
`TerrainCollision {unitId,speed,dieRoll,damage,shieldFacing,source}` · `TerrainDamageApplied
{unitId,channel,shieldFacing,amount,source}` · `CrewLostToRadiation {unitId,count,derelict?}` ·
`PulsarBursted {featureId,baseStrength,impulse,affected:[{unitId,shieldFacing,damage}]}` ·
`GravityWaveAdvanced {featureId,newRow,affected:[{unitId,shieldFacing,damage,turnedTo}]}` ·
`NovaFrontAdvanced {featureId,newRow,destroyed:[unitId]}` · `UnitEnteredLethalHex {unitId,hazard}` ·
`OrbitEntered {unitId,planetId,radius}` · `LandingStepCompleted {unitId,step}` · `LandingCompleted
{unitId}` · `TakeoffCompleted {unitId}` · `CrashResolved {unitId,outcome,crewSurvivors}` · `BarrierImpact
{unitId,shieldFacing,damage,stopped:true,plottedMovementLost:true}` · `LockOnBrokenByTerrain
{unitId,targetId,cause}` · `ScoutChannelsBlinded {unitId,count}` · `SensorRatingCapped {unitId,cap}` ·
`WarpPowerCapped {unitId,perBox}` · `TractorLinkBroken {aId,bId,cause}`. Actual unit destruction is emitted
by `C7`; lethal-hex entry, explosion force, and radiation derelict states are signalled to it. All randomness
is drawn from the seeded RNG (`E1-dice-rng-service.md`) so bursts and collisions replay identically.

## Engine / API

Two query families serve the four channels; one scheduler drives time-based effects. All are pure functions
of `(TerrainState, MapTerrain, args)` returning data + events, so they replay deterministically.

```ts
// ---- MOVEMENT channel ----
function terrainAt(t: TerrainCtx, hex: HexId): HexTerrainEffects;
function isLethalEntry(t: TerrainCtx, hex: HexId, mode: EntryMode): boolean;   // planet surface, black-hole/pulsar/nova hex
function atmosphereSpeedCap(t: TerrainCtx, hex: HexId): number | null;         // 1 inside atmosphere (P2.41)
function collisionOnEntry(t: TerrainCtx, hex: HexId, unit: UnitMoveCtx, rng: RngStream)
  : { damage: number; shieldFacing: ShieldFacing; events: GameEvent[] };       // asteroid/ring (P3.2)
function orbitPath(t: TerrainCtx, planetId: string, radius: 1|2|3): HexId[];    // circular ring (P8.4)

// ---- COMBAT channel: a function of the LINE of fire, not a single hex ----
interface FireLineTerrain {
  blocked: boolean;                 // class-M between firer & target (P2.31); black hole within 2 hex (P4.22)
  breaksLockOn: 'always' | 'roll50' | 'none';
  atmosphereHexes: number;          // hexes of atmosphere on the line (P2.51)
  asteroidHexes: number;            // natural ECM contributors (P3.25)
  ecmTotal: number;                 // summed natural ECM (asteroid + atmosphere + zone), ECCM-counterable
  nearBlackHoleEcm: number;         // +2 if line within 10 hex of a hole/pulsar (P4.22/P5.355)
}
function traceFireLine(t: TerrainCtx, from: HexId, to: HexId): FireLineTerrain;
function degradeWeapon(weapon: WeaponRef, atmosphereHexes: number): WeaponDegradation;  // P2.54x
function seekingReTarget(t: TerrainCtx, weaponHex: HexId, targetHex: HexId): { hitsPlanetId?: string };  // P2.34

// ---- SHIELDS channel ----
function downShieldHazardAt(t: TerrainCtx, hex: HexId): { perDriDamage?: number; perDriCrew?: number };   // heat P10 / radiation P15
function reinforcementCaps(t: TerrainCtx, hex: HexId): { perShield: number; total: number } | null;       // nebula P6

// ---- SENSORS / EW channel ----
function naturalEcmAt(t: TerrainCtx, hex: HexId): number;                       // nebula 9, sunspot 8, dust 1...
function sensorRatingCap(t: TerrainCtx, hex: HexId, turn: number): number | null;  // nebula/WYN/neutron
function lockOnConstraint(t: TerrainCtx, hex: HexId, turn: number): LockOnConstraint;  // cap + expiry (P7/P5)
function scoutChannelsBlinded(damageTaken: number): number;                     // 1 per 12 pts (P5.21/P9.31)

// ---- SCHEDULER: invoked by C1 at the matching clock position ----
function resolveInvoluntaryMovement(t: TerrainCtx, clock: GameClock, rng: RngStream): Reduction;  // 6A1
function resolveTerrainTick(t: TerrainCtx, clock: GameClock, rng: RngStream): Reduction;          // per-DRI / ÷N
function pulsarShouldBurst(t: TerrainCtx, clock: GameClock): string[];          // featureIds bursting now
function advanceMovingFronts(t: TerrainCtx, clock: GameClock): Reduction;       // gravity wave / nova
```

`TerrainCtx = { state: TerrainState; map: MapTerrain; geom: HexGeometry }`. `HexGeometry` (distance, line,
ring, direction) is the shared geometry service the movement engine also uses; C9 consumes it, never
re-implements it. `EntryMode` distinguishes voluntary movement, displacement, transporter arrival, and
pull, because several hazards only trigger on actual movement-into (P2.416 analogue, P4.2).

The **scheduler contract** maps clock predicates to effects: Involuntary Movement Stage **6A1** runs
black-hole/neutron pulls and gravity-wave/nova advance (closest-first by Order of Precedence C1.313, ties
simultaneous; long-range pulls and nova advance on impulse 16; orbital and Speed-1 movement on impulse 32);
the per-DRI hook fires on every 8th impulse (**6C**) for heat (one point per down shield, P10.1) and radiation
(one crew unit if any shield down, P15.1); dust resolves on impulses divisible by 5 (P13.2); pulsar PA-charge
ticks on impulses 8 & 24; pulsar bursts on their randomly-selected turn/impulse (P5.11–P5.12).

## Validation & Enforcement Rules

1. **Lethal hexes are blocked, not "allowed-with-damage."** Entering a planet surface by any means other than
   landing/atmospheric flight is a crash (class-M) or catastrophic (gas giant); the black-hole, pulsar, and
   nova hexes destroy on entry (P2.231/P4.2/P5.34/P12.0). `validatePath` (called by `C3`) rejects such plots
   unless the unit is executing a sanctioned landing/orbit, in which case `isLethalEntry` returns false.
2. **Atmosphere speed cap (P2.41).** Inside atmosphere a unit may not exceed Speed 1 (1 MP/turn even if
   stationary); the movement engine clamps and C9 supplies the cap. Erratic maneuvers are prohibited in
   atmosphere and orbit (C10.46 cross-ref) — flagged, not silently dropped.
3. **Collision is automatic and facing-correct (P3.2/P2.223).** On entering an asteroid/ring hex the engine
   rolls the speed-band column, applies modifiers (nimble −1, EM shifts to next column, outstanding crew −1,
   legendary navigator −1 column, poor crew +1), and hits #1 forward / #4 reverse; sideslip/entry-hexside
   special cases route through the same facing resolver used for mines and combat (`C7`). Leaving a hex never
   damages (P3.26). Column-follow: only the lead unit rolls (P3.233); column length ≤2; a faster unit may not
   follow a slower one; tractored units may not lead or follow (P3.236).
4. **Path-clearing credit (P3.3).** Each damage point scored on an asteroid hex reduces *that unit's* next-entry
   collision by one, lost the instant it enters any other hex. Tracked per-unit-per-hex; ADD/PPD/ESG/displacement
   cannot clear (P3.255).
5. **Line-of-fire blocking & lock-break (P2.31/P2.32/P4.22).** `traceFireLine` is authoritative for the combat
   engine: a class-M planet fully blocks DF and breaks lock between units; a moon blocks nothing but rolls a 50%
   lock-break **each impulse** it sits on the line; a black hole blocks fire whose line passes within 2 hexes and
   adds +2 ECM within 10. Seeking weapons that lose their target behind a planet re-target the planet itself
   (P2.34). Passive-FC units must re-acquire after a planet passes — surfaced to `C8`.
6. **Weapon degradation is per-atmosphere-hex and weapon-specific (P2.54x).** `degradeWeapon` returns the
   cumulative modifier: phasers/fusion +1 to the die roll per hex; photon/hellbore/PPD/plasma-bolt/mauler/AM-probe
   lose 25% of original strength per hex (50/75/100% at 2/3/4); disruptor bolt −1 warhead/hex; tractor-repulsor
   counts each atmosphere hex as 5 range. Ground bases ignore atmosphere ECM on energy DF and get no
   ground-clutter bonus (P2.722/P2.736).
7. **Down-shield hazards check facing where required (P15.4).** Heat hits per down shield regardless of facing
   (P10.1); point-source radiation and the neutron star only kill crew if a *down* shield faces the source. Full
   shields (≥1 box each) grant immunity; a contaminated last-crew-unit ship becomes a recoverable derelict (P15.1).
   Armor gives no protection and is not consumed (P10.x). Heat/radiation do **not** affect drones, plasma, mines,
   or DefSats (P10.2/P15.2) and cannot penetrate atmosphere (P10.41/P15.41) — enforced by the channel queries.
8. **Involuntary movement ordering is load-bearing (P4.1/P9.0).** Pulls and wave advances resolve in stage 6A1,
   closest-first, ties simultaneous; tractor-linked units move together, and a conflicting pull may break the link
   (P4.11). Stabilized units (G29.27) are immune; mines ARE moved by black holes (P4.14, an exception owned by
   `C10`). The gravity wave turns each struck unit 60° parallel and splits damage over the two facing shields
   (odd point to either), with the 3-shield corner case (P9.43).
9. **Tournament barrier (P17).** A ship moving off the fixed map edge takes 5 points on the shield facing the
   imaginary entered hex, stops at the end of stage 6A3, and loses all remaining plotted movement; seeking
   weapons/shuttles take 5 but do not stop. A tractored unit forced into the barrier takes damage and its link
   breaks (involuntary, not a voluntary release, P17.3); a tractor *operated by* the impacting ship is not broken.
   Displacement off-map places the unit in the last edge hex with no damage and no stop.
10. **GM override points.** Any terrain roll or result — a collision die, a pulsar burst total, a 50% lock-break,
    a crash outcome, an involuntary-pull ordering tie — may be overridden via `ApplyGmOverride`, emitting a
    replay-visible `GmOverrideApplied {target,value,reason}`. This is the sanctioned escape hatch for house-ruled
    terrain (`A2-identity-roles-gating.md` gates who may issue it).

## UI Contract

The battle-map renderer (`D1-map-board-ui.md`, wireframe `docs/spec/wireframes/D1-map-board.svg`) consumes a
`TerrainOverlayView` published per impulse: a typed list of features with their current hex membership, an
ECM/hazard heat-tint per hex, the live positions of moving fronts (gravity wave, nova) and the black-hole pull
radius rings, and per-planet atmosphere/ring shading. When a player plots movement, the movement-plotting UI
(`D4-movement-plotting-ui.md`) calls C9's `terrainAt`/`collisionOnEntry` in *preview* mode to show predicted
collision damage, the atmosphere speed clamp, lethal-hex warnings, and the orbit/landing step ladder before the
order is sealed — assist, never auto-decide. The targeting UI (`D5-targeting-combat-ui.md`) overlays
`traceFireLine` results on the firing solution: a blocked line is drawn struck-through, atmosphere/asteroid ECM
and weapon-degradation deltas annotate the shot, and a moon's pending 50% lock-break shows as an at-risk marker.
The Impulse HUD (`D6-impulse-hud.md`) flags scheduled terrain events on the 32-impulse strip (DRI heat/radiation
ticks, dust impulses, the next pulsar burst window, involuntary-movement at 6A1). The GM console
(`D9-gm-spectator-console.md`) can place/move/remove features, reveal hidden terrain, and override any roll. No
client receives hidden-deployment terrain (D20.0) until revealed; fog-of-war is enforced server-side.

## Dependencies

- `C1-sequence-of-play-engine.md` — drives the `TerrainScheduler`; supplies the clock and the 6A1 / per-DRI /
  per-impulse hooks; routes `ResolveInvoluntaryMovement` / `ResolveTerrainTick`.
- `C3-movement-engine.md` — owns `HexGeometry` and path validation; calls `terrainAt`, `collisionOnEntry`,
  `atmosphereSpeedCap`, `orbitPath`, `isLethalEntry`; enforces the barrier stop.
- `C4-direct-fire-combat.md` — consumes `traceFireLine`, `degradeWeapon` for blocking, ECM, and weapon math.
- `C5-seeking-weapons.md` — consumes `seekingReTarget` and nebula/dust attrition per hex.
- `C7-damage-criticals-repair.md` — applies all terrain damage to facing shields, handles destruction,
  explosion force, and radiation-derelict state.
- `C8-ew-sensors-cloak.md` — consumes `naturalEcmAt`, `sensorRatingCap`, `lockOnConstraint`,
  `scoutChannelsBlinded`; recomputes firing solutions after planet passes.
- `C10-mines-boarding-misc.md` — mine↔terrain interactions (black hole moves mines; nebula/sunspot disable mines).
- `A3-data-architecture-event-store.md` — event log + `TerrainState` snapshot projection.
- `E1-dice-rng-service.md` — seeded rolls for collisions, pulsar bursts, lock-breaks, crashes.
- `B3-game-catalog-ssd-model.md` — shield boxes / facings / crew units that terrain damages.

This document **services** the movement, combat, seeking-weapon, damage, and sensor engines (it answers their
environment queries) and **builds on** the sequence engine, geometry, event store, and RNG services.

## Edge Cases & Open Questions

- **Ring Material Damage Table (P2.223)** and the **black-hole gravity-wave force-decay chart (P9.42)** were only
  partially legible in the source; the exact per-cell values must be verified against the printed tables before
  v2 implementation. The data lives in `CollisionTable` / `GravityWaveParams.forceByImpulse` and is replaceable
  without code change.
- **"Effective speed" for terrain rolls.** Whether EM energy added to speed should count toward the asteroid
  collision column (P3.222 analogy) versus raw plotted speed needs confirmation for edge cases; modeled as a
  `UnitMoveCtx.effectiveSpeed` the movement engine supplies.
- **Pull-without-MP triggers.** Black-hole pull is movement without MP; it can still trigger mines (P4 vs M2.451)
  but TAC/HET/web-struggle cannot — the `EntryMode` tag must distinguish these for `C10`.
- **Annex tables** (Annex #7B landing-capable ships and their landing systems, Annex #2 fine-grained 6A1/6A3/6C
  stage labels) are external data the program must ingest to fully automate landing legality and tick timing.
- **Overlapping terrain.** Novae, ion storms, and sunspots overlay *other* zone effects (radiation/heat/nebula/
  pulsar/asteroid) measured from a moving front (P12.5/P14.0). The channel queries must compose multiple features
  additively (ECM sums; the strongest cap wins) — composition order needs a written precedence rule.
- **White dwarf / neutron star** are composites (heat + halved-range black hole; radiation + impulse-16 pull +
  25-hex range cap). Modeled as a primary feature carrying a sub-flag rather than two stacked features, to keep
  ordering deterministic.

## Testing

- **Collision golden test (P3.2):** drive a ship through an asteroid hex at each speed band with fixed RNG; assert
  damage equals the published table cell, hits #1 forward / #4 reverse, and column-follow lets only the leader roll.
- **Path-clearing test (P3.3):** score N points on a hex, re-enter; assert next-entry damage drops by N and resets
  to zero after entering any other hex.
- **Line-of-fire test (P2.31/P2.32):** place a class-M planet between two ships → `blocked:true`, lock-break
  `always`; swap for a moon → `blocked:false`, 50% break rolled each impulse; assert seeking weapons re-target the
  planet (P2.34).
- **Atmosphere degradation test (P2.54x):** fire a phaser, a photon, and a disruptor through 1–4 atmosphere hexes;
  assert +1/hex die shift, −25%/hex strength, and −1 warhead/hex respectively, plus the ground-base exemption.
- **Involuntary-movement ordering test (P4.1):** two units at different ranges from a black hole on impulse 16;
  assert closest pulls first, ties resolve simultaneously, a tractor link drags both or breaks per P4.11.
- **Pulsar burst test (P5):** seed the turn/impulse selection and `1d6×10`; assert range-band percentages
  (100/75/50/25), facing-shield hit, .499-down/.500-up rounding, and one scout channel blinded per 12 points.
- **Barrier test (P17):** plot a ship off the map edge → 5 points on the facing shield, stop at end of 6A3, all
  remaining plotted movement lost; a seeking weapon takes 5 and continues; displacement off-map repositions with
  no damage.
- **Determinism test:** re-fold the event log for a scenario containing asteroids, a planet, and a barrier; assert
  `TerrainState` reproduces byte-for-byte under a fixed seed (`E1`).

## Phasing

**[v1 AM-tournament]** — The complete hex-attribute framework, the four-channel query API, the `TerrainState`
projection and fold, and the `TerrainScheduler` skeleton; plus the terrain that actually appears on AM-tournament
and common duel maps: the **tournament barrier (P17)**, **asteroid fields with the full collision/ECM/path-clearing
model (P3)**, **class-M planets and small moons** with blocking-fire / lock-break / seeking-re-target / atmosphere
ECM / weapon degradation / landing / collision (P2 core), and **standard orbits (P8)**. These cover every terrain
feature a tournament or introductory duel scenario can field, and they exercise all four channels end-to-end so the
movement, combat, and sensor engines are validated against real environment data from day one.

**[v2]** — Black holes & white dwarfs (P4/P10.5), pulsars (P5), nebulae (P6), gravity waves (P9), heat and
radiation zones (P10/P15), neutron stars (P15.7), and gas-giant rings (P2.62/P2.222). These add the moving-front
and per-DRI machinery; the scheduler hooks exist in v1 but resolve no-ops until these land. Deferred because they
appear in campaign and advanced-scenario maps, not tournament duels.

**[v3 full Master]** — Ion storms (P14), dust clouds & comets (P13/P16), novae/supernovae (P12), sunspot activity
(P11), and the WYN radiation zone (P7). These are map-wide, multi-effect, often empire-specific environments tied to
campaign and full-Master scenarios; they compose from the same channels and scheduler but carry the most external
data (overlay precedence, Annex tables) and the least tournament relevance, so they ship last.
