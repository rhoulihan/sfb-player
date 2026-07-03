# C10 — Mines, Boarding & Miscellaneous Systems

## Purpose & Scope

This subsystem owns three families of "things that are not movement, energy, or a weapon you point and fire": **mine warfare** (rulebook section M — laying, arming, triggering, detonation, captor/sensor command, detection, sweeping, minefields), **boarding combat** (section D7 boarding-party transport/combat and hit‑and‑run raids, plus the area‑by‑area geography of D16), and a small registry of **miscellaneous in‑game systems** that don't earn their own doc — transporter bombs (which are simply small mines), defensive **web** (G10), and voluntary **self‑destruction** (D5.0). The referee automates every die roll, range/zone geometry, arming clock, casualty‑table cross‑index, and capture check, while leaving each genuine tactical choice to the player: whether/where/when to lay a mine and how to program its acceptance set, whether to transport marines and at what casualty cost to spend captured control rooms, whether and which SSD box to hit‑and‑run, and whether to scuttle. **PHASE: transporter bombs (small automatic‑explosive mines) + the generic mine trigger engine, boarding‑party combat, hit‑and‑run raids, and self‑destruction ship in [v1 AM-tournament]; the full mine taxonomy (large/captor/sensor/PA), control systems, minefields, detection, sweeping, and web are [v2]; Andromedan PA/Trans‑captor mines, alarm mines, the D16 area model, and ground‑base marine combat are [v3]. The data model and interfaces below are authored in full now so later phases extend without migration (see ## Phasing).**

## Rulebook References

- **Mines:** taxonomy/size/type/control (M2.0, M3.0, M4.0–M4.5, M5.0–M5.37); laying & storage (M2.1, M2.11–M2.134, M9.0–M9.23); transporter drop (M3.2, M3.22–M3.226); target programming (M2.14–M2.154); arming (M2.3, M3.223); triggering die (M2.4, M2.40–M2.48, M5.11–M5.1123); multi‑mine/multi‑unit order (M2.44, M2.47); explosion & damage (M2.5, M2.50–M2.55, M2.84); captor mines (M4.4 + subtype table M4.41, M5.112, M5.212); sensor mines (M4.5–M4.58, M5.32); control systems (M5.2x command, M5.3x chain/deadman); minefields/MFC (M6.0–M6.4); detection (M7.0–M7.54); sweeping (M8.0–M8.6); dummy mines (M2.9); Andromedan PA/Trans‑captor (M10.0, M11.0).
- **Boarding:** ship‑combat BP loss (D7.21); combat resolution & Marine Casualty Table (D7.32, D7.41–D7.44, D7.422); capture (D7.50–D7.539); hit‑and‑run raids (D7.8, D7.81–D7.86); area geography & sequence (D16.2–D16.46).
- **Misc:** self‑destruction & explosion (D5.0, D5.12, D5.2); web (G10) — interactions only; crew units / skeleton crew (G9.x) consumed by boarding; explosion strength (`crawford.explosionStrength`, B3).
- **Cross‑system hooks:** order of precedence (C1.313); effective speed (C2.45); hidden deployment (D20.0); EW/lock‑on (D6.x); facing‑shield determination (D3.42); sequence sub‑stages 6A1/6A3/6A4/6B3/6B4/6B6/6D1/6D2 and Final Activity boarding segment.

## Domain Model

Mines and boarding contests are **derived runtime entities** reconstructed by folding `gameEvents` (`A3-data-architecture-event-store.md`); the secret programming of laid mines lives in a **server‑only hidden‑record store** (the Mine Field Controller, D20.0) that is never broadcast to opponents. Ship‑resident inputs — transporter‑bomb/dummy‑bomb consumable tracks, crew units, boarding‑party and deck‑crew tracks, and control‑room system boxes — are already defined on the SSD model (`B3-game-catalog-ssd-model.md`); this subsystem reads and mutates them through the engine functions below.

```typescript
import { HexCoord, Facing } from './movement';      // C3-movement-engine.md
import { SideId, UnitId } from './sequence';         // C1-sequence-of-play-engine.md
import { LockOnRef } from './ewSensors';             // C8-ew-sensors-cloak.md

export type MineId = string;
export type MineSize    = 'large' | 'small';
export type MineType    = 'explosive' | 'captor' | 'sensor' | 'PAM' | 'transCaptor' | 'dummy';
export type MineControl = 'automatic' | 'command' | 'chain' | 'deadman';
export type MineMode    = 'active' | 'preActive' | 'inactive' | 'disabled';
export type CaptorSubtype = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'J';   // M4.41

/** One mine counter. The hidden programming fields are fog-gated by A4 (M2.14 secrecy). */
export interface MineState {
  id: MineId;
  ownerSide: SideId;
  hex: HexCoord;
  size: MineSize;
  type: MineType;
  controlSystem: MineControl;
  detonatorEnabled: boolean;            // command/chain mines also carry an auto-detonator (M5.2/M5.3)
  mode: MineMode;
  yield: number;                        // 35 large explosive, 10 small/T-bomb; 0 sensor/PAM (M2.0/M3.31)
  detectionRangeHexes: number;          // 0–6; default 1 for explosive (M2.31); zone = ring of that radius
  acceptedSizeClasses: number;          // bitset over R0.6 classes 1–8; 0 = accept all (M2.141)
  nthTargetDelay: number;               // ignore first 0–6 acceptable targets (M2.15)
  targetsSeenCounter: number;           // increments on each accepted entry; resets between scenarios
  detectionNumber: [number] | [number, number]; // 1–6; two values for deadman (M6.1)
  armed: boolean;
  preActiveUntilImpulse?: number;       // transporter 2-impulse delay (M3.223); end-of-Movement-Step arm (M2.35)
  layingUnitId?: UnitId;                // safety-range owner; arms when it leaves detection range (M2.3)
  isDummy: boolean;                     // mirrors a real mine but never acts (M2.91)
  isHidden: boolean;                    // hidden-deployment counter not yet revealed (D20.0)

  captor?: CaptorLoadout;               // type === 'captor' | 'transCaptor'
  sensor?: SensorLink;                  // type === 'sensor'
  command?: CommandLink;                // controlSystem === 'command'
  chainSourceMineIds?: MineId[];        // ≤6 explosive triggers within ≤20 hex (M5.31)
  deadmanSourceMineIds?: MineId[];      // fires when a named mine is destroyed (M5.35)
  paWarheadDrain?: number;              // PAM only: 25 (M10.22)
  transCaptorContents?: MineId[];       // Andromedan trans-captor cargo, ≤4 (M11.2)
}

export interface CaptorLoadout {        // M4.4 / M4.41 subtype chart
  subtype: CaptorSubtype;
  weaponLoad: string;                   // 'drone-I'|'plasma-F'|'disruptor'|'phaser-2'|'hellbore'|'photon'|'plasma-D'|'antiDrone'
  ammoRemaining: number;                // large/small loadout per M4.41
  firingArcLimitDeg?: 60|120|180|240|300|360; // limitable pre-scenario (M4.434)
  builtInEccm: 3;                       // M4
  launchVsBolt?: 'launch'|'bolt';       // types B/E/G uniform setting (M4.43)
  lockOnState?: LockOnRef;              // M7.41 captor lock-on (sensor rating capped 4)
  lastFireTurn?: number;                // 1/4-turn re-fire gap (M4.42)
}

export interface SensorLink {           // M4.5 — detects, never fires; commands linked mines
  controlledMineIds: MineId[];          // ≤6, each ≤15 hex (M4.52)
  jointControllerOf?: MineId[];         // a mine may be controlled by ≤3 sensors (M4.55)
  programmedAction: 'detonate'|'fire';
  alarmMode: boolean;                   // reports presence to nearest base only (M4.58)
}

export interface CommandLink {          // M5.2 — base subspace control
  controllingBaseId: UnitId;            // base within ≤50 hex with active fire control (M5.21)
  channelCounter: number;               // each command = 1 seeking-weapon equiv for 8 impulses (M5.22)
}
```

```typescript
// ---- Minefield hidden store + belt geometry (M6) ----
export interface MineFieldController {  // SERVER-ONLY; fog-gated, never sent to opponents
  gameId: string; ownerSide: SideId;
  records: MineState[];                 // every mine's full attribute set incl. detectionNumber
  beltGeometry?: BeltGeometry;
  packageCount?: 1|2|3|6;               // base-encircling belt packages (M6.3)
}
export interface BeltGeometry {         // M6.31–M6.34 base-encircling ring
  centerHex: HexCoord; radiusHexes: number;
  segments: { startDeg: 0|60|120|180|240|300; mineCount: number }[]; // six 60° wedges, each ≥10%
}

// ---- Boarding (D7) ----
export type CrewQuality =
  'green'|'normal'|'crack'|'elite'|'legendary'|'commando'|'outstanding'|'poor';

export interface BoardingForce {        // one side's marines aboard a contested hull
  side: SideId;
  byQuality: Partial<Record<CrewQuality, number>>; // BP counts per quality group (D7.421 mixed)
}
export interface ControlRoomState {     // a system box on B3, surfaced here for capture tracking
  boxId: string;
  kind: 'bridge'|'aux'|'emergency'|'flag'|'security';
  intact: boolean;
  capturedBy?: SideId;
  pointHeld: number;                    // ≤ cost; only one casualty point progresses at a time (D7.362)
}
export interface BoardingContest {      // folded per contested unit
  hostUnitId: UnitId;
  forces: BoardingForce[];              // 2+ unallied sides (D7.34/D7.35 multi-sided)
  controlRooms: ControlRoomState[];
  securityStations: number;             // undestroyed/uncaptured, drives Klingon +mod (D7.422)
  internalDamageAccumulator: number;    // D7.21 BP-loss thresholds at 50,60,70…
  captured: boolean;
}

// ---- D16 area model [v3] ----
export interface BoardingArea {
  code: string;                         // area letter (resolution order is alphabetic for ships, D16.24)
  kind: 'weapons'|'power'|'hull'|'bridge'|'cargo'|'pod'|'module'|'lab'|'flag'|'aux'|'emergency'|'core'|'shuttleBay';
  passages: string[];                   // adjacent area codes (1 area/turn, no skipping, D16.41)
  occupants: Partial<Record<SideId, number>>;
}

// ---- Misc systems ----
export interface WebState {             // G10 — mechanics deferred; geometry modeled now [v2]
  id: string; anchorHexes: HexCoord[]; strength: number; ownerSide: SideId; isAnchored: boolean;
}
export interface SelfDestructState {    // D5.0
  unitId: UnitId; armedTurn: number; detonateImpulse: number; force: number; // = crawford.explosionStrength
}
```

### Mongoose sketches

```typescript
// Projection rebuilt from gameEvents; authoritative state is the fold (A3).
const MineSchema = new Schema({
  gameId: { type: Schema.Types.ObjectId, index: true, required: true },
  mineId: { type: String, index: true, required: true },
  ownerSide: String, hex: { q: Number, r: Number },
  size: String, type: String, controlSystem: String, mode: String,
  yield: Number, detectionRangeHexes: Number,
  acceptedSizeClasses: Number, nthTargetDelay: Number, targetsSeenCounter: Number,
  detectionNumber: [Number], armed: Boolean, preActiveUntilImpulse: Number,
  layingUnitId: String, isDummy: Boolean, isHidden: Boolean,
  captor: Schema.Types.Mixed, sensor: Schema.Types.Mixed, command: Schema.Types.Mixed,
  chainSourceMineIds: [String], deadmanSourceMineIds: [String],
  alive: { type: Boolean, default: true },
}, { timestamps: true });
MineSchema.index({ gameId: 1, alive: 1 });

// Hidden programming store — NEVER projected to clients; read server-side only (D20.0).
const MineFieldControllerSchema = new Schema({
  gameId: { type: Schema.Types.ObjectId, index: true }, ownerSide: String,
  records: [Schema.Types.Mixed], beltGeometry: Schema.Types.Mixed, packageCount: Number,
}, { timestamps: true });

const BoardingContestSchema = new Schema({
  gameId: { type: Schema.Types.ObjectId, index: true }, hostUnitId: String,
  forces: [Schema.Types.Mixed], controlRooms: [Schema.Types.Mixed],
  securityStations: Number, internalDamageAccumulator: Number, captured: Boolean,
}, { timestamps: true });
```

## Events & Commands

All randomness is drawn from the seeded dice service (`E1-dice-rng-service.md`) so replays match. Commands are validated, then emit past‑tense events appended to `gameEvents`.

**Commands (consumed):**

```typescript
interface LayMine {                      // bay/rack drop into own hex (M2.1); 6B Impulse Activity
  type: 'LayMine'; unitId: UnitId; bayOrRackId: string;
  program: MineProgram;                  // owner's secret settings at lay time
}
interface TransportMine {                // T-bomb/PA via transporter into a target hex (M3.2)
  type: 'TransportMine'; unitId: UnitId; transporterId: string;
  targetHex: HexCoord; mineKind: 'tbomb'|'PAM'|'dummy'; program: MineProgram;
}
interface MineProgram {                  // M2.14: acceptance set + delay + (type-specific) links
  size: MineSize; type: MineType; controlSystem: MineControl;
  detectionRangeHexes?: number; acceptedSizeClasses?: number; nthTargetDelay?: number;
  captor?: Partial<CaptorLoadout>; sensor?: Partial<SensorLink>; command?: Partial<CommandLink>;
  chainSourceMineIds?: MineId[]; deadmanSourceMineIds?: MineId[]; isDummy?: boolean;
}
interface ScanForMines  { type: 'ScanForMines'; unitId: UnitId; }                       // M7.3 (6B4)
interface IssueMineCommand { type: 'IssueMineCommand'; baseId: UnitId; mineIds: MineId[]; action: 'activate'|'deactivate'|'trigger'; } // M5.2
interface SweepMine     { type: 'SweepMine'; unitId: UnitId; mineId: MineId; method: 'phaser'|'seeking'|'mss'; weaponId?: string; } // M8

interface TransportBoardingParty { type: 'TransportBoardingParty'; unitId: UnitId; transporterId: string; targetUnitId: UnitId; count: number; quality: CrewQuality; } // D7.2
interface DeclareHitAndRun { type: 'DeclareHitAndRun'; unitId: UnitId; targetUnitId: UnitId; targetBoxId: string; bpQuality: CrewQuality; } // D7.8
interface AllocateBoardingCasualties { type: 'AllocateBoardingCasualties'; hostUnitId: UnitId; side: SideId; spends: { kind:'killBP'|'captureControl'|'captureSecurity'; ref: string }[]; } // D7.43
interface SurrenderControlRooms { type: 'SurrenderControlRooms'; hostUnitId: UnitId; side: SideId; controlRoomIds: string[]; } // D7.44
interface MoveBoardingUnits { type: 'MoveBoardingUnits'; hostUnitId: UnitId; side: SideId; moves: { fromArea: string; toArea: string; count: number; turboLift?: boolean }[]; } // D16.41 [v3]

interface DeclareSelfDestruct { type: 'DeclareSelfDestruct'; unitId: UnitId; } // D5.0 (Self-Destruction phase 3)
```

**Events (emitted):**

```typescript
interface MineLaid        { type: 'MineLaid'; mineId: MineId; ownerSide: SideId; hex: HexCoord; size: MineSize; mineType: MineType; layingUnitId: UnitId; turn: number; impulse: number; } // hidden program fog-gated
interface MineArmed       { type: 'MineArmed'; mineId: MineId; reason: 'layerLeftRange'|'layerDestroyed'|'transporterDelayElapsed'; }
interface MineFieldDetected { type: 'MineFieldDetected'; bySide: SideId; nearestRange: number; }      // M7.1 (6A4)
interface MineLocated     { type: 'MineLocated'; mineId: MineId; bySide: SideId; size: MineSize; hex: HexCoord; method: 'scan'|'auto'|'identify'; } // M7.3/M7.34/M7.5
interface MineTriggered   { type: 'MineTriggered'; mineId: MineId; byUnitId: UnitId; dieRoll?: number; } // M2.4
interface MineDetonated   { type: 'MineDetonated'; mineId: MineId; zoneHexes: HexCoord[]; yield: number; } // followed by DamageAllocated volleys to C7
interface CaptorFired     { type: 'CaptorFired'; mineId: MineId; targetUnitId: UnitId; weaponLoad: string; mode: 'directFire'|'seeking'; } // hands off to C4/C5
interface SensorCommanded { type: 'SensorCommanded'; sensorMineId: MineId; commandedMineIds: MineId[]; action: 'detonate'|'fire'; }
interface MineDestroyed   { type: 'MineDestroyed'; mineId: MineId; by: 'sweep'|'detonation'|'incompleteAuto'; pointsScored?: number; }

interface BoardingPartyTransported { type: 'BoardingPartyTransported'; fromUnitId: UnitId; toUnitId: UnitId; side: SideId; count: number; quality: CrewQuality; }
interface BoardingCombatResolved { type: 'BoardingCombatResolved'; hostUnitId: UnitId; rolls: { side: SideId; die: number; casualtyPoints: number }[]; losses: { side: SideId; bpRemoved: number }[]; }
interface HitAndRunResolved { type: 'HitAndRunResolved'; unitId: UnitId; targetUnitId: UnitId; targetBoxId: string; die: number; result: 'systemDestroyedBpReturns'|'bothDestroyed'|'bpDestroyed'|'noEffect'; }
interface ControlRoomCaptured { type: 'ControlRoomCaptured'; hostUnitId: UnitId; controlRoomId: string; bySide: SideId; }
interface ShipCaptured     { type: 'ShipCaptured'; hostUnitId: UnitId; bySide: SideId; }

interface SelfDestructInitiated { type: 'SelfDestructInitiated'; unitId: UnitId; detonateImpulse: number; }
interface UnitExploded     { type: 'UnitExploded'; unitId: UnitId; force: number; zoneHexes: HexCoord[]; } // D5.12/D5.2 → DamageAllocated
```

## Engine / API

Functions are pure where possible (state in, events out); geometry helpers reuse the hex primitives from `C3-movement-engine.md`.

```typescript
// ---- Laying & arming ----
function validateLayMine(cmd: LayMine|TransportMine, gs: GameState): ValidationResult;
//  bay rate (1/bay/turn through main hatch, M2.11), shuttle-launch conflict (M2.113), 1/4-turn
//  spacing (M2.115), tbomb stock vs cap (M2.116 chart), transporter occupancy+range 5+shield-drop
//  (M3.22), and lay-time legality of attributes per type (no captor/sensor/command/chain mid-scenario, M9.23).
function resolveLayMine(cmd: LayMine|TransportMine, gs: GameState): GameEvent[]; // debits consumable; MineLaid
function computeArming(mine: MineState, gs: GameState, impulse: number): GameEvent[]; // layer-left-range / 2-impulse delay / layer-destroyed → MineArmed (M2.3, M2.32, M3.223)

// ---- Geometry ----
function detectionZone(mine: MineState): HexCoord[];  // mine hex + ring of detectionRangeHexes (M2.0)
function explosionZone(mine: MineState): HexCoord[];  // mine hex + 6 adjacent (M2.5)

// ---- Triggering (6A movement-entry) ----
interface TriggerCandidate { mineId: MineId; auto: boolean; }
function candidateMines(unit: UnitState, enteredHex: HexCoord, gs: GameState): TriggerCandidate[]; // acceptance + armed (M2.4)
function triggerOrder(cands: TriggerCandidate[], rng: Rng): MineId[];          // randomize order, reroll ties (M2.44)
function rollTrigger(mine: MineState, unit: UnitState, rng: Rng): boolean;     // die < effSpeed; 1 always; sweeper +2; cloak/auto rules (M2.40–M2.45, M5.112)
function resolveEntry(unit: UnitState, hex: HexCoord, gs: GameState, rng: Rng): GameEvent[]; // enforces 1-mine/hex cap (M2.44) + chain/deadman exceptions (M5.3)

// ---- Detonation & captor/sensor ----
function resolveDetonation(mine: MineState, gs: GameState): GameEvent[];       // facing-shield per victim (D3.42/M2.53), separate volleys → C7
function resolveCaptorFire(mine: MineState, gs: GameState, rng: Rng): GameEvent[]; // closest target, lock-on, ammo, DF-now vs seeking-6B6 (M4.4/M5.212)
function propagateSensor(sensor: MineState, trigger: UnitState, gs: GameState): GameEvent[]; // 15-hex span, joint priority (M4.5)
function propagateChainDeadman(source: MineState, gs: GameState): GameEvent[]; // simultaneous detonations (M5.3)

// ---- Detection & sweeping ----
function announceMinefields(gs: GameState): GameEvent[];                       // mandatory MFC announce in 6A4 (M7.1)
function resolveScan(unit: UnitState, gs: GameState, rng: Rng): GameEvent[];   // cadence, range/speed legality, die vs detectionNumber (M7.3)
function autoDetect(unit: UnitState, mine: MineState, rng: Rng): boolean;      // active FC + speed≤6 → roll ≤ sensorRating (M7.34)
function sweepPhaser(unit: UnitState, mine: MineState, gs: GameState, rng: Rng): GameEvent[]; // adjacency/speed0/lock/tractor, ECM penalty (M8.1)
function sweepSeeking(weaponId: string, mine: MineState, gs: GameState): GameEvent[];          // M8.2
function sweepMssRemote(mss: ShuttleState, mine: MineState, rng: Rng): GameEvent[];            // 1-4 safe / 5 / 6 retry table (M8.3)
function incompleteDestruction(mine: MineState, attacker: UnitState, gs: GameState): GameEvent[]; // explode/captor-DF/sensor-command (M8.42)

// ---- Minefield setup ----
function minefieldCost(records: MineState[]): number;                          // per-mine + chain/command surcharge (M6.2)
function validateBelt(belt: BeltGeometry, total: number): ValidationResult;    // ring radius, 6 segments, ≥10% each (M6.3)

// ---- Boarding ----
function marineCasualtyPoints(bpCount: number, die: number): number;          // D7.42 table cross-index
function applyKlingonSecurityMod(roll: number, securityStations: number): number; // +1/station max +2, clamp 6 (D7.422)
function resolveBoardingRound(c: BoardingContest, gs: GameState, rng: Rng): GameEvent[]; // group-of-10 splitting, both sides
function applyInternalDamageBpLoss(c: BoardingContest, newInternal: number): GameEvent[]; // first 4 ignored, last 2 protected (D7.21)
function checkCapture(c: BoardingContest): GameEvent[];                        // all control rooms captured → ShipCaptured (D7.50)
function resolveHitAndRun(cmd: DeclareHitAndRun, gs: GameState, rng: Rng): GameEvent[]; // 1d6 vs quality column (D7.81)

// ---- Misc ----
function resolveSelfDestruct(unit: UnitState, gs: GameState): GameEvent[];     // D5.0 → UnitExploded (D5.12/D5.2)
```

## Validation & Enforcement Rules

The server is the authoritative referee for each of the following; every check is a recorded, GM‑overridable decision point.

1. **Laying legality (M2.11–M2.116, M3.22).** Bay drops are gated to one mine per bay per turn through the main hatch, blocked on the impulse a shuttle launches/lands and the impulses adjacent to it, and capped by the per‑hull T‑bomb storage chart (size‑4 ship = 2, size‑1 starbase = 12, etc.). Transporter drops are one per transporter per turn at range ≤5 into an empty (no ship/planet/moon/shuttle) hex with a shield dropped; large mines may never be transported. Captor, sensor, and any command/chain/deadman mine cannot be laid or reloaded mid‑scenario (M9.23/M5.23) — only minefield setup (M6) may place them.
2. **Arming clock (M2.3, M3.223).** A mine is `preActive` until its layer leaves its detection range, then arms at the **end of the Movement Step** of that impulse (so a unit entering the same impulse cannot trigger it that impulse). A transporter‑dropped T‑bomb is inert for two full impulses regardless. If the layer is destroyed or displaced, the mine arms immediately (M2.32). The size‑acceptance set does **not** delay arming even if it would exclude the layer (M2.33).
3. **Trigger automation (M2.4, M5.11).** When an *acceptable* unit **enters** a hex in an armed automatic mine's zone, the engine rolls one die: trigger if `die < effectiveSpeed` (from `C2.45`); a 1 always triggers; speed ≥7 auto‑triggers; minesweepers add 2 (never negating the auto‑1); cloaked vs explosive triggers only on a 1; erratic‑maneuver units always trigger. Captor and sensor mines skip the speed roll and trigger automatically. Entering is the only act that counts — leaving, displacing‑in, transporting‑in, or burning MP in place does not (M2.41); EW never affects the roll (M2.419); black‑hole pull *can* trigger but TAC/HET/web‑struggle cannot.
4. **One‑mine‑per‑hex cap (M2.44).** A single moving unit triggers at most one automatically‑controlled mine per hex; the engine randomizes candidate order and rolls until one triggers or all fail, then resolves the next unit in order of precedence (C1.313) against the same (undeleted) mine list. Chain, deadman, ESG‑impact, and command‑controlled triggers are explicit exceptions and may detonate additional mines.
5. **Detection cadence (M7.1–M7.41).** Minefield‑presence announcement by the MFC is mandatory once per turn per side in 6A4 whenever a ship is within 10 hexes of ≥6 automatic mines. Individual scans cost 1 energy, are limited to one per 8 impulses (sweepers/X‑ships per 4), require effective speed ≤6 and no erratic maneuvers, and reveal any mine whose detection number equals the die roll. Auto‑detection (M7.34) and captor lock‑on (M7.41) cap the relevant sensor rating at 4.
6. **Sweep prerequisites (M8.1–M8.3).** Phaser sweeping requires the mine located, the firer at speed 0 in/adjacent to the mine hex with lock‑on (sensor rating ≤4) and the mine tractored; non‑minesweepers eat a 6‑ECM (or +2 die) penalty. A hit below the destruction threshold (6 large / 4 small) triggers the mine's incomplete‑destruction reaction (explosive detonates, captor fires DF this impulse, sensor commands its links) unless the mine is pre‑active or has a disabled detonator.
7. **Boarding combat (D7.41–D7.44, D7.21).** Resolved at end of turn in the Final Activity boarding segment: each side rolls 1d6 cross‑indexed with its BP count (split into groups of 10, summed per quality group), Klingon marines add +1 per security station (max +2, clamp 6); casualty points may be spent on specific allocation (2 = kill a named BP, 4 = capture a control room, 6 = a security station) before each side removes BPs equal to casualties scored against it (defenders may instead surrender control rooms). Ship‑combat internal damage kills 1 BP per 10th point with the first four such casualties ignored (first BP lost at the 50th internal point) and the last two BPs protected.
8. **Capture (D7.50–D7.54).** When every undestroyed control room (including security) is captured, the ship is captured: the captor may maneuver but not fire its weapons, seeking‑weapon control drops, and only skeleton‑crew systems remain operable. Only one casualty point progresses a given control room at a time (D7.362).
9. **Hit‑and‑run (D7.81–D7.85).** One raid per BP per turn and no two raids by the same side on one box within 1/8 turn; cloaking device, DERFACS, and UIM may be destroyed but not captured; self‑destruction cannot be deactivated by raid. The 1d6 result is read off the crew‑quality column.
10. **Self‑destruction (D5.0).** Declared in phase 3 against last turn's final positions; the explosion uses `crawford.explosionStrength` and resolves through the same zone/facing‑shield path as a mine detonation, handed to `C7-damage-criticals-repair.md`.

**GM‑override points.** Any check above may be superseded by an `ApplyGmOverride` command emitting `GmOverrideApplied {target, value, reason}` — e.g. forcing a contested same‑hex trigger, hand‑setting which control room a casualty point captures, overriding a sweep threshold for a house rule, or permitting an out‑of‑era mine. Overrides are logged and replay deterministically (`A2-identity-roles-gating.md` gates who may issue them).

## UI Contract

Mines and boarding surface across the assisted‑combat and GM screens; the primary wireframes are `wireframes/D2-ssd-viewer.svg` (`C10-mines-boarding-misc.md`) and `wireframes/D1-map-board.svg` (`C10-mines-boarding-misc.md`).

- **Mine‑laying panel (D8).** When a unit acts in 6B with an available bay/rack or transporter, the client lists eligible launchers with remaining T‑bomb/dummy stock and rate‑gap countdowns, and exposes the secret programming form (size class acceptance bitset, Nth‑target delay, and — for setup‑only mine types — control links). Transporter drops show the legal empty‑hex target ring and the required shield drop (cost from `C2-energy-allocation-power.md`). The server validates every field; illegal combinations are disabled with the reason surfaced.
- **Minefield & scan overlay (D1/D8).** Own mines render as owner‑only tokens on `wireframes/D1-map-board.svg`; enemy mines appear only once **located**, and only at the size/hex the scan revealed (programming stays hidden, fog‑gated by `A4-realtime-sync-layer.md`). The HUD shows the scan‑cadence countdown and the mandatory minefield‑presence banner with nearest‑mine range.
- **Boarding console (D7).** A per‑contested‑hull panel shows each side's BP counts by quality, the control‑room/security grid with capture progress, the Marine Casualty Table preview for the owner's current BP count, and the end‑of‑turn casualty‑allocation chooser (spend points to kill BPs / capture rooms, or surrender rooms). Hit‑and‑run opens a target‑box picker with the quality‑column odds shown.
- **Impulse HUD (D6).** The persistent stepper (`D6-impulse-hud.md`) flags the active sub‑stage (6A trigger, 6A3 detonation damage, 6A4 minefield announce, 6B4 scan, 6B6 captor seeking launch, Final Activity boarding) and logs every die roll.

The UI computes eligibility, zones, odds, and legal targets but never decides: laying, programming, scanning, sweeping, transporting marines, casualty spends, surrender, raids, and self‑destruct are all explicit player commands.

## Dependencies

- `C1-sequence-of-play-engine.md` — owns the phase/sub‑stage clock (self‑destruct phase 3, 6A movement triggers, 6A3 damage, 6A4 announce, 6B scan/lay/command, 6B6 captor seeking, Final Activity boarding) and order‑of‑precedence (C1.313).
- `C2-energy-allocation-power.md` — scan energy, command‑control channel accounting, transporter/shield‑drop energy, self‑destruct power state.
- `C3-movement-engine.md` — `HexCoord`/`Facing`, hex‑ring/zone geometry, effective speed for the trigger die, displacement/tractor‑rotation movement that does (or does not) trigger.
- `C4-direct-fire-combat.md` — captor direct‑fire weapons, phaser minesweeping, lock‑on, ECM penalty math, facing‑shield determination shared with detonation.
- `C5-seeking-weapons.md` — captor‑launched drones/plasma and seeking‑weapon minesweeping enter the seeking‑weapon engine; sensor‑mine `WeaponFired`/`SeekingWeaponLaunched` hand‑off.
- `C6-carriers-shuttles-pf.md` — minesweeping shuttles/PFs (MSS remote roll), bay‑slot drop conflicts, deck‑crew reload of bombs, transporter‑bomb plumbing.
- `C7-damage-criticals-repair.md` — receives `MineDetonated`/`CaptorFired`/`UnitExploded` volleys, runs the DAC, and owns crew‑unit/BP loss bookkeeping that boarding reads.
- `C8-ew-sensors-cloak.md` — lock‑on/`LockOnRef`, sensor rating caps, scan/auto‑detect rolls, ECM/ECCM, cloak‑vs‑trigger interaction.
- `C9-terrain-hazards.md` — terrain that moves/immunizes mines (black‑hole pull moves mines, nebula disables mines, planets/atmosphere block explosions, web/ESG interactions, barrier).
- `B3-game-catalog-ssd-model.md` — transporter‑bomb/dummy‑bomb consumable tracks, crew‑unit/boarding‑party/deck‑crew tracks, control‑room and security‑station system boxes, `crawford.explosionStrength`.
- `A3-/A4-` — event store, snapshots, and fog enforcement for the MFC hidden store and hidden mine programming; `A2-` GM gating; `E1-/E2-` seeded dice and deterministic replay.

## Edge Cases & Open Questions

- **Effective speed for the trigger die (M2.40).** Whether EM energy added to speed counts toward `effectiveSpeed` for the trigger roll (by analogy to asteroid collisions, P3.222) needs confirmation; the model carries plotted speed plus an EM flag so either reading is expressible.
- **Dummy and disabled‑detonator mines.** Dummies mirror a real mine but never act and are destroyed at lower thresholds (2 large / 1 small); disabled‑detonator command/chain mines are undetectable except by captor lock‑on (M7.4) and ignore all incomplete‑destruction reactions (M8.424). Both are flagged and short‑circuit the trigger/detonation paths.
- **Captor seeking timing (M4.4251, M5.212).** Captor‑launched seeking weapons commit at trigger but launch in 6B6 and use a fixed sensor rating of 6; base‑controlled type‑A/G/H/J fire once per impulse. The exact interaction with cloaked‑target lock‑on retention across the Lock‑On Stage must be modeled against `C5`/`C8`.
- **PA / Trans‑captor (M10/M11) [v3].** A PA mine transported into a plasma torpedo drains 25 warhead points and goes inert; an Andromedan trans‑captor is a command mine holding ≤4 T‑bombs/PA mines placed ≤1/turn with an 8‑impulse spacing. Order of operations vs enveloping/X‑plasma warhead modifiers (M10.224) is an open question for `C5`.
- **Web (G10) mechanics.** Only web's *interactions* (blocks gravity waves, halts ESG, struggle does not trigger mines) appear in the research; the full casting/strength/struggle rules live in section G and are an open import for the [v2] web build.
- **External chart imports.** The Marine Casualty Table and hit‑and‑run table values are encoded below; but minefield package BPV, captor/sensor ammo costs, the minesweeper list (Annex #3), bay counts (Annex #7M/#7G), and the Annex #2 sub‑stage ordering are external tables the program must ingest to fully automate timing and cost.
- **D16 area model.** Whether v1 needs any area geography (it does not — tournament boarding is whole‑ship, D7) vs deferring the entire `BoardingArea` model to v3 is settled as defer; the interface is reserved so base/large‑ship boarding extends without migration.

## Testing

- **Mine trigger (pure).** `rollTrigger` across the M2.40–M2.45 matrix: `die < effectiveSpeed`, the always‑on 1, speed‑7 auto‑trigger, minesweeper +2 not negating the 1, cloak‑only‑on‑1, sweeper‑vs‑captor 1–4, erratic‑always; and the non‑entry cases (leave/displace/transport/MP‑in‑place) producing no trigger.
- **One‑mine cap & order (M2.44).** Property test: a unit crossing a hex with several armed automatic mines triggers at most one; randomization order is seeded and reproducible; chain/deadman exceptions detonate additional mines.
- **Detonation geometry.** `explosionZone` = 7 hexes; facing‑shield per victim incl. the sideslip/reverse cases (M2.53); separate‑volley hand‑off to `C7`; no damage to plasma or other mines (M2.55).
- **Detection/sweep.** Scan cadence (8/4 impulse), speed/EW legality, die‑vs‑detection‑number reveal; MSS remote table 1‑4/5/6 with the mine‑warfare‑PF small‑mine survival (M8.33); incomplete‑destruction reactions per mine type.
- **Boarding.** `marineCasualtyPoints` against the full D7.42 table; group‑of‑10 splitting and mixed‑quality summation; Klingon +security clamp to 6; `applyInternalDamageBpLoss` first‑BP‑at‑50, last‑two‑protected; capture when all control rooms taken; hit‑and‑run quality columns including the "Poor crew never returns with system destroyed" dash.
- **Determinism.** Re‑fold the event log with the same `E1` seed and assert identical trigger rolls, casualty rolls, scan reveals, and final board/capture state (`E2-game-log-replay.md`).

**Reference charts (facts, encoded as data):**
Marine Casualty Table — casualty points by die (rows) × attacking BP count 1–10 (cols): die1 `0,0,0,0,1,1,1,1,1,1`; die2 `0,0,1,1,1,1,1,2,2,2`; die3 `0,1,1,1,2,2,2,2,3,3`; die4 `0,1,1,2,2,2,3,3,4,4`; die5 `1,1,2,2,3,3,4,4,5,5`; die6 `1,1,2,2,3,4,4,5,5,6` (D7.42). Specific allocation: 2 pts kill a BP, 4 capture a control room, 6 a security station (D7.43). Hit‑and‑run (1d6) by crew quality → result (D7.81): *system destroyed/BP returns* Normal 1 / Commando 1 / Outstanding 1‑2 / Poor — ; *both destroyed* Normal 2 / Cmdo 2‑3 / Outst 3 / Poor 1; *BP destroyed* Normal 3‑5 / Cmdo 4 / Outst 4 / Poor 2‑4; *no effect* Normal 6 / Cmdo 5‑6 / Outst 5‑6 / Poor 5‑6.

## Phasing

**[v1 AM-tournament]** — the parts that appear in a tournament duel: the generic **mine entity + trigger‑die engine** and **transporter bombs** (small automatic‑explosive mines: lay/transport, 2‑impulse arming, the M2.4 trigger roll, the 7‑hex 10‑point detonation, facing‑shield damage); **boarding‑party transport and combat** (D7.2–D7.5 with the Marine Casualty Table, internal‑damage BP loss, capture); **hit‑and‑run raids** (D7.8); and **self‑destruction** (D5.0). These are standard tournament equipment and actions.

**[v2]** — full mine warfare: large explosive (NSM) mines, **captor** (subtype A–J) and **sensor** mines, **command/chain/deadman** control systems, **minefields** (M6 composition, cost, base‑encircling belts, MFC hidden deployment), **detection** (M7 field/individual/auto/identify), **sweeping** (M8 phaser/seeking/MSS), minelayers/minesweepers, and the **web** system (G10). These need the planet/terrain layer (`C9`) and the carrier/shuttle layer (`C6`) to be meaningful and so follow them.

**[v3 full Master]** — Andromedan **PA** and **Trans‑captor** mines (M10/M11), **alarm** mines, the **D16 area‑by‑area** boarding geography for bases and large ships (turbo‑lifts, passage combat, fixed resolution orders), and **ground‑base** marine combat. Rationale: tournament play never fields these, so they carry no v1/v2 weight, but every interface above already reserves their fields (`MineType` PAM/transCaptor, `CommandLink`, `BoardingArea`, `WebState`) so later phases extend without a schema migration.
