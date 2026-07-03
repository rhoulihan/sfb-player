# C6 — Carriers, Shuttles & Fast Patrol Ships

## Purpose & Scope

This subsystem models every small craft that operates from, or in support of, a ship: administrative
shuttles and their special missions (suicide shuttle, wild weasel, scatter-pack), fighters and the
carriers/deck-crews/ready-racks that arm them, dogfighting, heavy fighters, bombers, fighter pods, and
the entire Fast Patrol Ship (PF) family — interceptors, leaders, tenders (PFT), Fi-Cons, survival pods,
engine degradation, and death-riders. It owns the *life-cycle and bookkeeping* of these units (charge
state, arming, launch/recovery timing, ammunition pools, pilot/crew quality, docking) and delegates the
things that already have engines elsewhere: a shuttle in flight is a movement actor (`C3`), a firing
shuttle is a direct-fire source (`C4`), a launched suicide shuttle or fighter drone is a seeking weapon
(`C5`), and damage on any of them is allocated by `C7`. The contract here is to define the complete
data model and interfaces now so the AM-tournament slice composes cleanly with later carrier/PF content.
**PHASE:** v1 ships administrative shuttles, suicide shuttles (J2.22), wild weasels (J3.0), scatter-packs
(J2.24), and the shuttle bay launch/recovery clock (J1.50–J1.66) — all of which appear in AM tournament
play. Fighters, carriers, deck crews, dogfighting, pods, heavy fighters, bombers (J4–J16) and the full
PF stack (K1–K8) are modeled here but deferred to **v2/v3**.

## Rulebook References

- Shuttle base rules: launch/recovery clock and facilities (J1.0, J1.21–J1.32, J1.50–J1.66), tractor
  recovery rotation on Impulse #32 (J1.620–J1.621), overcrowding (J1.64).
- Administrative shuttles (J2.0–J2.17); suicide shuttles (J2.22, J2.221–J2.229); scatter-packs
  (J2.24, cross-ref FD7.0); special-mission identity concealment (J2.15, J2.151–J2.153).
- Wild Weasel: charging/course/activation (J3.0, J3.11–J3.18), launching-ship restrictions and voiding
  (J3.13, J3.40–J3.49), destroyed/voided states, 5-impulse explosion period, collateral chart
  (J3.20–J3.31, J3.30–J3.304).
- Fighters: movement/HET/tactical (J4.1), seeking-weapon launch and control (J4.2), post-launch and
  weapon restrictions (J4.3), squadrons and built-in EW (J4.46–J4.48), carriers/supplies (J4.6–J4.75),
  deck crews (J4.81), rearming (J4.82–J4.899). Warp Booster Packs (J5.0–J5.43). Pilot quality (J6.0–J6.64).
- Dogfighting (J7.0–J7.82): declaration (J7.0–J7.45), DRI 9-step sequence (J7.50–J7.563), advantage
  computation (J7.60–J7.663), breakaway/surrender (J7.7–J7.82).
- Heavy fighters (J10.0–J10.44); fighter pods (J11.0–J11.42); bombers (J14.0–J14.33).
- Fast Patrol Ships: general operations (K1.0–K1.74), PF Warp Booster Packs (K1.6–K1.65), survival pods
  and Fi-Cons (K1.8–K1.95); tenders/mech-links/reload/repair (K2.0–K2.65); interceptors (K3.0–K3.9);
  leaders (K4.0–K4.4); PF Damage Allocation Chart and weapon spec (K5.0–K5.2); engine degradation
  (K6.0–K6.4); death-riders (K7.0–K7.82); PF crew quality (K8.0–K8.43).

## Domain Model

All small craft share one discriminated-union root so the same map, fog, and damage code can treat them
uniformly; mission-specific state hangs off optional sub-objects. Numeric performance values (Size, DFR,
rated max speed) are *not* stored here — they are looked up from the Master Fighter Chart held by
`B3-game-catalog-ssd-model.md` (Annex #4) keyed by `type`.

```ts
type SmallCraftKind =
  | 'admin' | 'mrs' | 'swac' | 'fighter' | 'heavyFighter' | 'bomber'
  | 'pf' | 'interceptor' | 'pfLeader' | 'survivalPod';

type MissionType = 'standard' | 'science' | 'combat' | 'suicide' | 'wildWeasel' | 'scatterPack';

interface SmallCraft {
  craftId: string;
  gameId: string;
  empire: string;                 // racial ruleset key (drives weapon-spec, drone %)
  kind: SmallCraftKind;
  type: string;                   // chart key, e.g. 'F-14', 'adminShuttle', 'G-1N'
  sizeClass: 1 | 2 | 3 | 4;       // 2=heavy fighter/heavy shuttle, 3=med bomber, 4=heavy bomber (J10/J14)
  manned: boolean;

  // Position is mirrored from C3; canonical owner is the movement engine.
  hex?: AxialHex;
  facing?: 0|1|2|3|4|5;
  currentSpeed: number;
  turnMode: number;

  // Damage (C7 writes damageTaken; thresholds live here per type, J1.32/J2.14/J14.31).
  damageTaken: number;
  destructionPoint: number;
  crippledThreshold: number;
  crippled: boolean;
  destroyed: boolean;

  // Loadout — composes with C4 (direct fire) and C5 (seeking).
  rails: FighterRail[];           // [] for admin shuttles
  pods: FighterPod[];
  heavyWeaponCharges: number;
  phaserReady: boolean;           // admin ph-3 etc. (J2.13 once/turn)
  seekingWeaponsControlled: string[]; // C5 weapon ids guided by this craft

  // Warp Booster Pack state (J5 / K1.6).
  wbp?: WarpBoosterPackState;

  // Crew/pilot quality (J6 / K8) — optional ruleset.
  pilotId?: string;

  // Built-in EW (J4.47 fighters: 2/2; K1.71 PF: 2 ECCM + 2 swing).
  builtInEcm: number;
  builtInEccm: number;
  swingPoints: number;

  // Home / organization.
  homeUnitId?: string;            // carrier, PFT, base, or controlling ship
  squadronId?: string;
  bayRef?: BayRef;                // where it sits when not in flight

  // Mission-specific sub-objects (exactly one non-null when applicable).
  suicide?: SuicideShuttleState;
  wildWeasel?: WildWeaselState;
  scatterPack?: ScatterPackState;
  pf?: PfState;                   // present for kind in {pf,interceptor,pfLeader}
}

interface WarpBoosterPackState {
  fitted: boolean;
  active: boolean;                // fighters/shuttles may toggle (J5.13); PFs cannot (K1.65)
  dropped: boolean;               // irrevocable (J5 / K1.62)
  perEnginePack?: boolean[];      // PF engines carrying packs (K1.63)
}

interface SuicideShuttleState {            // J2.22
  armingTurnsComplete: number;             // needs 3 (J2.221)
  energyAppliedTotal: number;              // 3–9 points, half-point increments
  warheadStrength: number;                 // 2 × applied energy, clamp [6,18]
  held: boolean;                           // holding 1 pt/turn after turn 3
  dummy: boolean;                          // J2.226 unarmed shell
}

interface WildWeaselState {                // J3.0
  chargeTurnsDone: number;                 // needs 2 consecutive (J3.11)
  heldInBay: boolean;                      // rolling 1 pt/turn upkeep (J3.121)
  presetCourse: number[];                  // up to 96 impulse directives (J3.111)
  active: boolean;
  voided: boolean;
  destroyed: boolean;
  destructionImpulse?: number;
  explosionPeriodEndsImpulse?: number;     // destructionImpulse + 4 (J3.211)
  ecmGranted: number;                      // 6 to launching ship (J3.23)
}

interface ScatterPackState {               // J2.24, FD7.0
  droneLoad: string[];                     // C5 drone ids carried
  robotPiloted: boolean;
  released: boolean;
}

interface PfState {                        // K1–K8
  flotillaId?: string;
  energyAllocationId?: string;             // PFs DO fill an EAF (C2), simplified
  shieldEnergy: number;
  sensorRating: number;
  hetUsedThisScenario: boolean;            // one free, then breakdown on 6 (K1.23)
  towBarOccupant?: string;
  dockState: 'free' | 'mechLink' | 'internal' | 'towed';
  mechLinkRef?: { tenderId: string; linkIndex: number; lastUndockImpulse?: number };
  weaponStatus: 0 | 1 | 2 | 3;             // shared from tender (K2.43)
  isLeader: boolean;
  isInterceptor: boolean;
  engineRunningTotal: number;              // ERT for degradation (K6)
  survivalPodState: 'none' | 'onMap' | 'towed' | 'rescued';
  deathRider?: { mode: 'autonomous' | 'controlled' | 'ghost'; program?: number[]; inertTurns?: number };
}
```

Carriers, casual carriers, escorts, and PFTs are *facility containers* attached to a ship record (owned
by `B3`); we persist their dynamic state separately so the ship SSD stays immutable.

```ts
interface ShuttleBay {                      // J1.50, D16.0
  bayId: string;
  boxes: BayBox[];
  launchTubes?: LaunchTube[];               // Hydran/SCS/CVA (J1.51)
  hasBalcony?: boolean;
  tunnelHatches?: number;                   // independent J1.50 hatches (J1.57)
  lastLaunchImpulse?: number;
  lastRecoverImpulse?: number;
}
interface BayBox {
  boxId: string;
  status: 'empty' | 'occupied' | 'destroyed';
  occupantCraftId?: string;
  readyRackType?: string;                   // fighter type this rack serves
  readyRackContents?: string[];             // munitions queued for reload
  capacitorCharges: number;                 // heavy-weapon charges held (J4.85)
}
interface DeckCrew {                         // J4.81
  crewId: string; bayId: string; boxId: string;
  assignedCraftId?: string;
  action?: { type: 'reload' | 'repair' | 'wbp' | 'transfer' | 'module';
             startImpulse: number; completeImpulse: number };
  transferring?: boolean;
}
interface CarrierSupply {                    // J4.7
  shipId: string;
  carrierType: 'fullyCapable' | 'casual' | 'escort';
  droneStorageSpaces: number;               // e.g. Kzinti CV 150 (J4.71)
  chaffPodSupply: number;
  ewPodSupply: number;
  wbpStockpileByType: Record<string, number>;
  podStockpileByType: Record<string, number>;
}
interface PfTender {                         // K2.0
  shipId: string;
  pftType: 'true' | 'base' | 'scs' | 'casual';
  mechLinks: { index: number; occupantCraftId?: string; lastUndockImpulse?: number }[];
  internalBays: string[];
  dronePoolSpaces: number;                  // true PFT 150/flotilla (K2.651)
  wbpSpareSets: number;
  repairPointsUsed: { scenario: number; campaign: number }; // caps 100/300 (K2.611)
}
```

Mongoose persistence (sketch). Small-craft and facility state are subdocuments of a per-game
`craftState` collection rather than the immutable SSD; the authoritative history remains the
`gameEvents` log per `A3-data-architecture-event-store.md`.

```js
const SmallCraftSchema = new Schema({
  craftId: { type: String, index: true }, gameId: { type: String, index: true },
  empire: String, kind: String, type: String, sizeClass: Number, manned: Boolean,
  currentSpeed: Number, turnMode: Number,
  damageTaken: Number, destructionPoint: Number, crippledThreshold: Number,
  crippled: Boolean, destroyed: Boolean,
  rails: [{ railType: String, contents: [String] }],
  pods: [{ type: String, railSlot: Number }],
  heavyWeaponCharges: Number, phaserReady: Boolean, seekingWeaponsControlled: [String],
  wbp: { fitted: Boolean, active: Boolean, dropped: Boolean, perEnginePack: [Boolean] },
  pilotId: String, builtInEcm: Number, builtInEccm: Number, swingPoints: Number,
  homeUnitId: String, squadronId: String, bayRef: { bayId: String, boxId: String },
  suicide: { armingTurnsComplete: Number, energyAppliedTotal: Number, warheadStrength: Number,
             held: Boolean, dummy: Boolean },
  wildWeasel: { chargeTurnsDone: Number, heldInBay: Boolean, presetCourse: [Number],
                active: Boolean, voided: Boolean, destroyed: Boolean,
                destructionImpulse: Number, explosionPeriodEndsImpulse: Number, ecmGranted: Number },
  scatterPack: { droneLoad: [String], robotPiloted: Boolean, released: Boolean },
  pf: Schema.Types.Mixed,
}, { timestamps: true });
SmallCraftSchema.index({ gameId: 1, homeUnitId: 1 });

const PilotSchema = new Schema({               // J6 / K8
  pilotId: String, gameId: String, side: String,
  quality: { type: String, enum: ['green','good','ace','legendary'] },
  experiencePoints: Number, perTypePoints: Schema.Types.Mixed, ejected: Boolean, rescued: Boolean,
});
```

## Events & Commands

All commands are validated then fold to events; every randomness draw routes through
`E1-dice-rng-service.md` and is recorded as `DiceRolled` so replays match. Launch/recovery/dogfight/
PF-release commands are only legal in the **Shuttle & PF Functions Stage (6B8)** of the impulse, while
arming/charging/deck-crew assignment are plotted during Energy Allocation (Stage 5, `C2`) and finalized
in the Final Records Stage (8C) — see `C1-sequence-of-play-engine.md`.

| Command | Emits | Notes |
|---|---|---|
| `LaunchShuttle{craftId, bayId, missionType, presetCourse?, wbpActive?}` | `ShuttleLaunched` | enforces 1-per-2-impulse bay clock (J1.50) |
| `RecoverShuttle{craftId, bayId, method:'land'\|'tractor'}` | `ShuttleRecovered` | tractor rotation deferred to Imp #32 (J1.620) |
| `ArmSuicideShuttle{craftId, energyThisTurn}` | `SuicideShuttleArmed`,`EnergyAllocated` | half-point increments, ≤3/turn (J2.221) |
| `LaunchSeekingWeapon{...}` (canonical) | `SeekingWeaponLaunched` | SS/SP/fighter-drone hand-off to `C5` |
| `ChargeWildWeasel{craftId}` | `WildWeaselCharged`,`EnergyAllocated` | 1 pt/turn ×2 consecutive (J3.11) |
| `LaunchWildWeasel{craftId, presetCourse, speed, wbpActive}` | `WildWeaselLaunched` | grants 6 ECM; voids any prior WW (J3.116) |
| `AssignDeckCrew{crewId, craftId, action, bayId, boxId}` | `DeckCrewAssigned` | 32/16-impulse action clock (J4.81) |
| `ReloadCraftWeapon{craftId, boxId, munition}` | `CraftRearmed` | space-keyed action cost (J4.82) |
| `DropWarpBoosterPack{craftId}` | `WarpBoosterPackDropped` | irrevocable; PFs all-at-once (K1.62) |
| `DeclareDogfight{hex, shuttleIds[]}` | `DogfightDeclared` | ≤3 craft; enemy cannot refuse (J7.0) |
| `ResolveDogfightImpulse{dogfightId}` | `DogfightResolved`,`DamageAllocated` | runs 9-step DRI (J7.50) |
| `DockPf{craftId, tenderId, linkIndex}` | `PfDocked` | face tender, decelerate to 0 (K2.32) |
| `ReleasePf{craftId, tenderId, linkIndex}` | `PfReleased` | requires completed EAF (K2.321) |
| `ApplyGmOverride{target,value,reason}` (canonical) | `GmOverrideApplied` | any check below is overridable |

Emitted-event payload shapes (illustrative):

```ts
interface WildWeaselLaunched { craftId: string; shipId: string; impulse: number;
  presetCourse: number[]; speed: number; ecmGranted: 6; activeImmediately: true; voidedPriorWwId?: string; }
interface WildWeaselDetonated { craftId: string; impulse: number;
  damageOnWeasel: number; collateralPoints: number; affectedCraftIds: string[]; explosionPeriodEndsImpulse: number; }
interface SuicideShuttleArmed { craftId: string; turn: number; energyThisTurn: number;
  energyAppliedTotal: number; warheadStrength: number; armingTurnsComplete: number; }
interface DeckCrewAssigned { crewId: string; craftId: string; action: string;
  startImpulse: number; completeImpulse: number; } // audit trail required by J4.8175
interface PfEngineRunningTotalUpdated { craftId: string; turn: number; roll: number;
  modifiers: number; ert: number; danger: boolean; critical: boolean; }
```

## Engine / API

Resolvers are pure functions over `(state, command, rng)` returning `Event[] | ValidationError`, so they
are unit-testable and deterministic. The orchestrator (`C1`) calls them at the right stage.

```ts
// Bay clock — J1.50/J1.502 (dropping a mine consumes a slot).
function canBayActThisImpulse(bay: ShuttleBay, impulse: number, action: 'launch'|'recover'): Result<true>;

// Shuttle recovery legality — J1.61 (land) / J1.62 (tractor) / J1.64 (overcrowd).
function validateRecovery(s: SmallCraft, ship: ShipState, bay: ShuttleBay, method: 'land'|'tractor'): Result<RecoveryPlan>;
function applyTractorRotation(plan: RecoveryPlan, impulse: number): Event[]; // executes only on Imp #32

// Suicide shuttle — J2.221–J2.223.
function validateSsArming(s: SuicideShuttleState, energyThisTurn: number): Result<true>;
function computeWarhead(energyAppliedTotal: number): number; // clamp(2*E, 6, 18)

// Wild Weasel state machine — J3.
function chargeWildWeasel(s: WildWeaselState): Result<WildWeaselState>;
function launchWildWeasel(craft: SmallCraft, ship: ShipState, course: number[], speed: number): Result<Event[]>;
function isWildWeaselVoided(ship: ShipState, action: ShipAction): boolean;          // J3.40–J3.49
function rangeVoidsWeasel(weaselHex: AxialHex, shipHex: AxialHex): boolean;          // >35 hexes (J3.42)
function weaselCollateral(damageOnWeasel: number): number;                           // J3.31 chart
function inExplosionPeriod(s: WildWeaselState, impulse: number): boolean;            // 5-impulse window

// Deck crews & rearming — J4.81/J4.82.
function deckCrewActionWindow(action: DeckCrew['action']['type'], half: boolean): number; // 32 | 16
function reloadActionCost(munitionSpaces: number, wrongBox: boolean, heavy: boolean): number;
function killDeckCrewsOnBoxLoss(boxId: string, crews: DeckCrew[]): Event[];          // J4.814 + interrupt cancel

// Dogfighting — J7.
function declareDogfight(hex: AxialHex, shuttles: SmallCraft[]): Result<Dogfight>;   // ≤3, pack-match J7.13
function advantage(d: DogfightParticipant, rng: Rng): AdvantageResult;               // J7.60 equation
function resolveDri(dogfight: Dogfight, rng: Rng): Event[];                          // 9-step J7.50
function breakawayMove(p: DogfightParticipant, rng: Rng): Result<MoveOrder>;         // J7.71

// PF specifics — K1/K5/K6.
function pfMoveCost(isInterceptor: boolean): number;                                // 1/5 or 1/6 (K1.21/K3.21)
function pfDamageAllocation(roll: number, empire: string, isLeader: boolean): DacResult; // K5.1/K5.2
function k163EngineCascade(hits: number, rng: Rng, isInterceptor: boolean): number; // die cascade / +1 (K1.63/K3.62)
function rollEngineDegradation(pf: PfState, quality: PilotQuality, rng: Rng): PfEngineRunningTotalUpdated; // K6
function survivalPodEscapes(rng: Rng): boolean;                                      // 1–3 (K1.91)

// Pilot/crew quality — J6/K8 (shared).
function rollQuality(rng: Rng): PilotQuality;                                        // 1-2 green,3-5 good,6 ace
function applyQualityModifiers(base: CraftPerf, q: PilotQuality): CraftPerf;
function promote(p: Pilot): Pilot;                                                   // 10 → good, 50 → ace
```

Queries the client and other engines consume: `getCraftForUnit(unitId)`,
`getActiveWildWeasel(shipId)`, `getBayClock(shipId)`, `getDeckCrewLog(shipId)` (audit per J4.8175),
`getDogfightsInHex(hex)`, `getDockedPfs(tenderId)`, `getEngineRunningTotals(side)`.

## Validation & Enforcement Rules

The referee automates *bookkeeping and legality*; every tactical choice (when to launch, what course to
preset, whether to dogfight, where to allocate damage among a docked PF stack) stays with the player.

- **Bay clock (J1.50):** a bay may launch *or* recover at most once per two consecutive impulses; dropping
  a mine/T-bomb counts as a launch (J1.502). Launch tubes, balconies, and tunnel hatches relax this per
  facility flags. The server rejects an out-of-window launch and offers the next legal impulse.
- **Shuttle launch/land cadence (J1.52):** a shuttle launches once and lands once per turn, with ≥8
  impulses between its own launch and land except tractor recovery. Landing requires same hex, ship
  speed ≤ shuttle speed, and an empty box; active SS/WW cannot land normally (J1.612).
- **Suicide shuttle (J2.22):** arming runs three turns at 1–3 warp points/turn in half-point increments;
  warhead = 2× applied energy clamped to [6,18]; after turn 3 the craft must pay 1 pt/turn upkeep or
  deactivate and lose all energy. On entering the target hex it detonates (hand-off to `C5` as a seeking
  weapon). Fighters/HTS/GAS may not be suicide shuttles.
- **Wild Weasel (J3):** requires two consecutive charge turns; on launch it is immediately active, grants
  the launching ship 6 ECM (inside D6.392's 6-point loaned cap), caps that ship's maneuver rate at 4,
  and forces fire control OFF. The validator enumerates voiding triggers (activating fire control, firing,
  launching a *seeking* shuttle/probe, transporting, tractoring/being tractored, ESG/SFG/web/mine ops) and
  auto-voids on violation, reverting attracted weapons to their original targets. A voided WW continues
  its course; a destroyed-but-unvoided WW keeps attracting newly launched weapons for a 5-impulse
  explosion period and inflicts collateral damage via the J3.31 chart. Only one active WW per ship;
  launching a second voids the first. Range >35 hexes from the launching ship voids it (J3.42).
- **Deck crews (J4.81):** an action spans 32 impulses (half = 16); crews are bound to a box and die with
  it; an interrupted action is cancelled entirely and the craft reverts to its pre-action state (J4.8174).
  Every deck-crew action is logged with start/complete impulses for opponent review (J4.8175).
- **Dogfighting (J7):** declared in 6B8; ≤3 craft per dogfight; WBP and non-WBP shuttles cannot dogfight
  unless packs are dropped (J7.13). Each DRI (every 4th impulse) runs the fixed 9-step sequence; phasers
  resolve at "low power" Range 2 and once committed cannot fire elsewhere that turn (J7.521). Advantage =
  die + pilot + DFR + speed + special ratings; degree of advantage gates weapon permissions and hit
  numbers; ties are head-on with collision risk.
- **PF rules (K1/K5):** PFs file a simplified EAF (no life-support/fire-control power), move at 1/5 (INT
  1/6) pt/hex with Turn Mode AA, get one free HET/scenario then breakdown on a 6, and use the mandatory
  K5.1 DAC with per-empire weapon spec. Released PFs must have completed an EAF and cannot fire/launch/
  control/tractor/transport within 4 impulses of launch (K2.322). PF WBP hits trigger the K1.63 die
  cascade (INT: flat +1, no roll). Optional engine degradation rolls in 8C accumulate the ERT; danger at
  50 forces pack drop and power loss, critical at 65 (62 INT) destroys the PF outright.
- **GM-override points (`GmOverrideApplied`):** any of the above — bay-clock rejection, WW void
  determination, dogfight advantage result, DAC column walk, degradation thresholds, survival-pod escape —
  may be overridden with `{target, value, reason}` recorded in the event log.

## UI Contract

The client never receives hidden state: a special-mission shuttle's true identity (SS/WW/SP) is masked
until release/target/destruction or detection by labs/scouts/tac-intel (J2.15), so the server emits a
generic "shuttle" token to opponents and the true `missionType` only to the owner (or to a side that has
earned detection per `C8-ew-sensors-cloak.md`). For each subsystem the client needs:

- **Shuttle/PF tray (D6 impulse HUD):** per-unit chips showing charge/arm progress (WW charge turns, SS
  warhead build-up), bay-clock readiness, WBP active/dropped, and a "launch legal next at impulse N" hint.
- **Launch/recovery affordances (D4 movement plotting, D1 map):** preset-course pen for WW/SS, tractor-
  recovery target picker, overcrowding warning.
- **Dogfight panel (D5 targeting/combat):** the 9-step DRI walkthrough, advantage breakdown (die +
  ratings), per-DRI weapon buttons gated by degree of advantage, and breakaway/surrender controls.
- **Carrier/PFT management (D9 GM/console + a dedicated hangar panel):** ready-rack contents, deck-crew
  assignment board with the mandatory action log, drone/WBP/pod stockpile gauges, mech-link occupancy.
- **Wireframes:** see `docs/spec/wireframes/` for `D2-ssd-viewer.svg`, `D5-targeting-combat.svg`, and
  `D2-ssd-viewer.svg` (to be produced in the wireframe pass); each references the D-doc owning its screen.

## Dependencies

- `C1-sequence-of-play-engine.md` — places every action in 6B8 / Stage 5 / 8C and drives the impulse clock.
- `C2-energy-allocation-power.md` — WW/SS charging energy, PF EAF, reserve-power gating, EW swing points.
- `C3-movement-engine.md` — shuttle/PF/fighter movement, Turn Mode, HET, nimble, tractor rotation (G7.7).
- `C4-direct-fire-combat.md` — shuttle/fighter/PF phasers and heavy weapons, fire-control state for voiding.
- `C5-seeking-weapons.md` — drones, plasma-D, suicide shuttle and scatter-pack as seeking weapons, control transfer.
- `C7-damage-criticals-repair.md` — damage accumulation, WBP damage doubling, PF DAC, deck-crew repair.
- `C8-ew-sensors-cloak.md` — built-in ECM/ECCM, WW ECM grant, special-mission detection, tac-intel reveal.
- `C9-terrain-hazards.md` / `C10-mines-boarding-misc.md` — web interactions, mines (bay-slot cost), boarding/capture of shuttles and PFs.
- `B3-game-catalog-ssd-model.md` — Master Fighter Chart (Annex #4), carrier/PFT data (Annex #7G/#7M), bay layouts.
- `A3-data-architecture-event-store.md`, `A4-realtime-sync-layer.md`, `E1-dice-rng-service.md` — event log, sealed-order reveal, seeded dice.

## Edge Cases & Open Questions

- Active suicide shuttle tractored into a bay explodes (J2.228); a friendly active SS goes inert when
  tractored — the recovery validator must surface a "watch out" confirm (J1.6204).
- Tractored-and-dragged WW *after* its explosion period does not void the protected ship (it took no
  action) (J3.452); launching a non-seeking shuttle does not void, a seeking one does (J3.41).
- Heavy fighters occupy two boxes with chain-reaction targeting (J10.14) and cannot use launch tubes;
  bombers operate only from ground bases, never ships (J14) — modeled but out of v1.
- A docked PF stack may absorb damage on the PFT or any one docked PF per point after the DAC type is
  known (K2.41); phaser hits on the PFT cannot be shunted to a mech-linked PF (K2.412).
- **Open:** per-empire MRS/SWAC weapon tables (J8.11/J9), exact fighter/bomber Size/DFR/max-speed values,
  and per-ship bay/deck-crew/storage counts live in Annexes the program must ingest separately — flagged
  for `B3`. Remote-controlled fighters (J15), megafighters (J16), advanced shuttles (J17), and
  shuttle-towing-shuttle (J18) are out of current scope; legendary-ace return charts (J6.42, mirror of
  K8.42) need a confirming read before the campaign layer is built.

## Testing

- **Unit (pure resolvers):** `computeWarhead` over the arming table (3 pts → 6, 9 pts → 18, clamp); the
  J3.31 collateral chart at every band boundary (2→0, 3→1, 18→4, 96→10); `pfMoveCost` (1/5 vs 1/6);
  `deckCrewActionWindow` (32/16); `pfDamageAllocation` against the K5.1 die-roll columns and per-empire
  K5.2 weapon spec including n/a → next-column.
- **Sequence/integration:** drive `C1` through a turn where a ship charges a WW over two turns, launches
  it in 6B8, then illegally activates fire control — assert auto-void and weapon reversion. Verify the bay
  clock rejects a second launch within two impulses. Verify tractor recovery rotates only on Impulse #32.
- **Dogfight:** seed the RNG so two ace-piloted shuttles produce a known advantage degree; assert phaser
  shift and drone hit numbers match J7.661–J7.663, and that a low-power phaser locks out other targets.
- **PF degradation:** replay a fixed engine-use sequence and confirm ERT crosses danger (50 → pack drop +
  power loss) and critical (65 / INT 62 → destruction, no D5 explosion) exactly as in K6 worked examples.
- **Determinism:** every test asserts identical event logs on replay from the same seed, per `E1`/`A3`.

## Phasing

- **v1 (AM tournament):** administrative shuttles (movement, 360° phaser-3, damage/cripple thresholds),
  suicide shuttles, wild weasels (full charge/void/explosion model — essential against seeking weapons in
  tournament play), scatter-packs, and the bay launch/recovery clock. These are the only small craft that
  appear in tournament games, but they exercise the full launch/seeking/EW/damage seams, so the v1 slice
  validates the architecture end-to-end. The complete `SmallCraft`, facility, and pilot data model ships
  in v1 even though most fields stay dormant, so no migration is needed later.
- **v2:** fighters, casual/fully-capable carriers, deck crews, ready-rack rearming, WBPs for fighters,
  pilot quality (J6), and the PF core (K1, K5 DAC, survival pods, basic tenders) — the bulk of campaign play.
- **v3:** dogfighting (J7), heavy fighters (J10), pods (J11), bombers (J14), PF leaders/interceptors/
  Fi-Cons (K3/K4), engine degradation (K6), death-riders (K7), full crew-quality campaigns (K8), and the
  remaining shuttle annexes (J8/J9/J12/J15–J18). Deferred because none affect AM-tournament correctness
  and each is large enough to warrant its own implementation milestone.
