# C5 — Seeking Weapons (Drones & Plasma)

## Purpose & Scope

This subsystem models every weapon that, once launched, exists as an independent counter on the hex map and homes on a target under its own movement rules: radar-homing **drones** (rulebook superscript FD) and energy-ball **plasma torpedoes** (superscript FP), plus the "other units" (suicide shuttles, scatter-packs) that borrow the same movement code. It owns the full lifecycle of a seeking unit — launch placement and arc legality, per-impulse homing movement, guidance/control channels and their continuous re-validation, endurance and ammunition bookkeeping, point-defense interaction, and impact/interception resolution — and emits the events that hand scored damage to the damage engine (`C7-damage-criticals-repair.md`). The referee automates all of the math, legality, and dice while leaving every tactical choice (whether to launch, initial facing, which tied homing hex to enter, when to release control, bolt-vs-seek, EPT-vs-normal) to the player. **PHASE: core seeking-unit engine + standard drones (types I–VI) and plasma (types R/S/G/F/D) ship in [v1 AM-tournament]; exotic warheads, scatter-packs, X-ship munitions are [v2]/[v3] (see ## Phasing).**

## Rulebook References

- General seeking-weapon rules: (F0.0), (F1.0)–(F1.4) launch/placement/disclosure; (F2.0)–(F2.6) movement, HET, impact, mutual impact, tracking/identity; (F3.0)–(F3.6) control channels, release/transfer, self-guidance, secret targeting; (F4.0)–(F4.5) ballistic targeting.
- Drones: (FD1.0)–(FD1.8) general/firing-at; (FD2.0)–(FD2.5) type chart & improvements; (FD3.0)–(FD4.5) racks & firing rates; (FD5.0)–(FD5.3) control methods (launcher / energy-seeking / ATG); (FD6.0) probe; (FD7.0) scatter-packs; (FD8.0) multi-warhead; (FD9.0) ECM drones; (FD10.0) availability; (FD11.0)–(FD17.0), (FD21.0) specialized warheads & type-H.
- Plasma: (FP1.0)–(FP2.6) types/arming/movement/strength; (FP3.0) arcs & launchers; (FP4.0) guidance; (FP5.0) enveloping; (FP6.0) pseudo-plasma; (FP7.0) shotgun; (FP8.0) bolts; (FP9.0)–(FP10.0) type-D & plasma rack; (FP11.0) sabot; (FP12.0) ECM plasma; (FP13.0) plasma-K; (FP14.0) carronade.
- Cross-system hooks: (C1.313) order of precedence; (D1.4) effective range; (D3.42) facing-shield determination; (D6.392) lent-ECM cap; (E5.0) anti-drones; Annex #2 sequence steps 6A1/6A3/6B3/6B6/6B8/6D2.

## Domain Model

Seeking-weapon counters are **derived map entities** — they are reconstructed by folding the event log (`A3-data-architecture-event-store.md`) and are not authored directly. Launcher/rack inventory, by contrast, is part of the ship's persisted SSD record (`B3-game-catalog-ssd-model.md`). The interfaces below describe the folded runtime state; the Mongoose sketch describes the snapshot/projection collection used for fast load.

```typescript
import { HexCoord, Facing } from './movement';     // C3-movement-engine.md
import { SideId, UnitId } from './sequence';        // C1-sequence-of-play-engine.md

export type SeekingFamily = 'drone' | 'plasma' | 'seekingShuttle' | 'other';
export type ControlState  = 'controlled' | 'released' | 'self' | 'inert';
export type DroneType  = 'I'|'II'|'III'|'IV'|'V'|'VI'|'H1'|'H2'|'H3'|'H4';
export type DroneSpeedTier = 'slow'|'moderate'|'medium'|'fast';   // 8/12/20/32 (FD10.32)
export type DroneControlMethod = 'launcher'|'energySeek'|'atg';   // FD5.x
export type PlasmaType = 'R'|'S'|'G'|'F'|'D'|'K'|'L'|'M';
export type WeaponId = string;

/** Base counter — every seeking unit on the map (F1.0, dataModelHints). */
export interface SeekingWeaponState {
  id: WeaponId;
  family: SeekingFamily;
  subtype: DroneType | PlasmaType | 'suicideShuttle' | 'scatterPack';
  ownerSide: SideId;
  launchingUnitId: UnitId;
  launcherId: string;                 // SSD rack/tube that fired it (F1.23 disclosure)
  launchTurn: number;
  launchImpulse: number;              // 1..32
  position: HexCoord;
  facing: Facing;                     // 0..5 hexside
  speed: number;                      // hexes-per-turn rating mapped onto impulse chart
  turnMode: number;                   // 1 for drones/plasma (F2.121); native for shuttles
  target: { kind: 'unit'; unitId: UnitId } | { kind: 'hex'; hex: HexCoord };  // F2.33 / F4.11
  targetSecret: boolean;              // F3.6 written face-down record
  controlState: ControlState;
  controllerUnitId?: UnitId;          // present iff controlState==='controlled'
  enduranceRemaining: number;         // turns (drone) or impulses (plasma) (F1.4)
  hexesTraveled: number;              // true-distance counter (plasma strength & sabot)
  hetUsed: boolean;
  hetWindowStartImpulse: number;      // rolling 32-impulse window (F2.13)
  firstMoveDone: boolean;             // first move must be straight (F2.123)
  mustGoStraightNextMove: boolean;    // set after HET (F2.131)
  identityKnownBySide: SideId[];      // continuous-tracking identity (F2.6)
  inertReason?: 'guidanceLost'|'friendlyTractor'|'noTarget'|'stasis'|'outOfRange';
}

export interface DroneState extends SeekingWeaponState {
  family: 'drone';
  droneType: DroneType;
  speedTier: DroneSpeedTier;
  warheadDamage: number;              // FD2.1 chart
  destroyPoints: number;              // damage to kill it (FD1.54)
  damageAccumulated: number;          // point-defense progress
  sizeSpaces: number;
  atg: boolean;                       // self-guide after 8-hex lock (FD5.2)
  ownLockAcquired: boolean;           // ATG/energy-seek own lock (<=8 hex)
  extendedRange: boolean;
  builtInEccm: number;                // ATG=2 (FD5.26), type-III includes
  controlMethod: DroneControlMethod;
  isNonImpact: boolean;               // ECM/probe/empty-bus do no damage (F2.4)
  externalArmorSpeedPenalty: number;  // FD12.132
}

export interface PlasmaState extends SeekingWeaponState {
  family: 'plasma';
  plasmaType: PlasmaType;
  currentWarhead: number;             // recomputed at impact from range table
  phaserDamageAccumulated: number;    // 2 pts -> -1 warhead (FP1.611)
  terrainDamageAccumulated: number;
  builtInEccm: number;                // 3 (FP4.31)
  enveloping: boolean;                // EPT (FP5.0)
  shotgunSubs?: WeaponId[];           // FP7.0
  boltMode: boolean;                  // detonated in-tube as direct fire (FP8.0)
  isPseudo: boolean;                  // PPT — no damage (FP6.0)
  isEcp: boolean;                     // ECM plasma (FP12.0)
  sabot: boolean;                     // Speed 40 super-fast (FP11.0)
}

/** Per-guiding-unit control ledger, recomputed each impulse (F3.1–F3.3). */
export interface ControlLedger {
  unitId: UnitId;
  sensorRating: number;               // usually 6
  controlChannelsTotal: number;       // F3.211/3.212/3.213 capacity calc
  controlledWeaponIds: WeaponId[];
  fireControlActive: boolean;
  lockOnTargets: UnitId[];
  scoutChannelsUsedForControl: number;
  lentEccmToWeapon: Record<WeaponId, number>;
}
```

### Mongoose sketch (projection collection `seekingWeapons`)

```typescript
// Fast-load projection rebuilt from gameEvents; authoritative state is the event fold.
const SeekingWeaponSchema = new Schema({
  gameId:        { type: Schema.Types.ObjectId, index: true, required: true },
  weaponId:      { type: String, index: true, required: true },
  family:        { type: String, enum: ['drone','plasma','seekingShuttle','other'] },
  subtype:       String,
  ownerSide:     String,
  launchingUnitId: String,
  launcherId:    String,
  launchTurn:    Number,
  launchImpulse: Number,
  position:      { q: Number, r: Number },        // axial hex (see C3)
  facing:        { type: Number, min: 0, max: 5 },
  speed:         Number,
  target:        { kind: String, unitId: String, hex: { q: Number, r: Number } },
  targetSecret:  Boolean,
  controlState:  { type: String, enum: ['controlled','released','self','inert'] },
  controllerUnitId: String,
  enduranceRemaining: Number,
  hexesTraveled: Number,
  hetWindowStartImpulse: Number,
  identityKnownBySide: [String],                  // fog-of-war gated on read (A4)
  drone:  { type: Schema.Types.Mixed },           // DroneState extras
  plasma: { type: Schema.Types.Mixed },           // PlasmaState extras
  alive:  { type: Boolean, default: true },
}, { timestamps: true });
SeekingWeaponSchema.index({ gameId: 1, alive: 1 });
```

Launcher/rack inventory (drone racks A–H, plasma tubes R/S/G/F/D, plasma racks) lives in the unit SSD subdocument defined in `B3-game-catalog-ssd-model.md`; this subsystem reads and mutates `lastFireImpulse`, `loadedAmmo[]`, `armingTurnsPaid`, and `magazines[]` on those records via the engine functions below.

## Events & Commands

All randomness (bolt hit rolls, random scatter-pack target ties) is drawn from the seeded dice service (`E1-dice-rng-service.md`) so replays match. Commands are validated, then emit past-tense events appended to `gameEvents`.

**Commands (consumed):**

```typescript
// Issued in Seeking Weapons Stage 6B6 (F1.221). All same-type launches resolve simultaneously.
interface LaunchSeekingWeapon {
  type: 'LaunchSeekingWeapon';
  unitId: UnitId; launcherId: string;
  family: SeekingFamily; subtype: string;
  facing: Facing;                                  // owner-chosen at launch (FD1.21/FP1.312)
  target: { kind: 'unit'; unitId: UnitId } | { kind: 'hex'; hex: HexCoord };
  secret?: boolean;                                // F3.6
  plasmaMode?: 'seek'|'bolt'|'enveloping'|'shotgun'|'pseudo'|'sabot';
  scatterPackProgram?: ScatterPackProgram;         // [v2] FD7.31
}
interface MoveSeekingWeapon {                       // Movement Segment 6A1 (F2.0)
  type: 'MoveSeekingWeapon';
  weaponId: WeaponId; chosenHex: HexCoord; newFacing: Facing; useHet?: boolean;
}
interface TransferSeekingControl { type: 'TransferSeekingControl'; weaponId: WeaponId; toUnitId: UnitId; }   // F3.5
interface ReleaseSeekingControl  { type: 'ReleaseSeekingControl';  weaponId: WeaponId; }                     // F3.4
interface DeclarePlasmaBolt      { type: 'DeclarePlasmaBolt'; unitId: UnitId; launcherId: string; targetId: UnitId; }  // FP8.0 (6D2)
```

**Events (emitted):**

```typescript
interface SeekingWeaponLaunched {
  type: 'SeekingWeaponLaunched'; weaponId: WeaponId; ownerSide: SideId;
  launchingUnitId: UnitId; launcherId: string; family: SeekingFamily; subtype: string;
  position: HexCoord; facing: Facing; target: SeekingWeaponState['target'];
  speed: number; enduranceRemaining: number; turn: number; impulse: number;
  // hidden fields (type, secret target) are fog-gated by A4 before broadcast
}
interface SeekingWeaponMoved {
  type: 'SeekingWeaponMoved'; weaponId: WeaponId;
  from: HexCoord; to: HexCoord; facing: Facing; usedHet: boolean;
  hexesTraveled: number; enduranceRemaining: number;
}
interface SeekingControlTransferred { type: 'SeekingControlTransferred'; weaponId: WeaponId; fromUnitId?: UnitId; toUnitId: UnitId; }
interface SeekingControlReleased    { type: 'SeekingControlReleased'; weaponId: WeaponId; newState: 'self'|'inert'; }
interface SeekingWeaponWentInert    { type: 'SeekingWeaponWentInert'; weaponId: WeaponId; reason: SeekingWeaponState['inertReason']; }
interface SeekingWeaponIntercepted  { // weapon-vs-weapon (F2.5) or point-defense kill (FD1.5)
  type: 'SeekingWeaponIntercepted'; weaponId: WeaponId; byWeaponId?: WeaponId; byUnitId?: UnitId; cause: 'mutualImpact'|'pointDefense'|'terrain'; }
interface SeekingWeaponImpacted {   // resolved in step 6A3 Seeking Weapon Damage
  type: 'SeekingWeaponImpacted'; weaponId: WeaponId; targetId: UnitId;
  shieldFacingHit: number;          // D3.42
  warhead: number;                  // plasma: range-table value post-reductions
  enveloping?: { perShield: number; leftover: number };   // FP5.31
  // followed by a DamageAllocated event handed to C7
}
interface PlasmaBoltResolved { type: 'PlasmaBoltResolved'; weaponId: WeaponId; targetId: UnitId; hit: boolean; damage: number; ewShift: number; dieRoll: number; }
```

## Engine / API

Functions are pure where possible (state in, events out); side-effecting helpers take the folded `GameState` and return events for the reducer to apply.

```typescript
// ---- Launch (6B6) ----
function validateLaunch(cmd: LaunchSeekingWeapon, gs: GameState): ValidationResult;
//  checks: arc-at-launch (target in WEAPON's FA, F1.24/FP1.312), free control channel
//  (F3.31-6 unless ballistic/self-guiding), rack rate-gap (8 impulses, FD3.x), ammo present,
//  ship-size limits for plasma R/S (FP2.13), stage===6B6.
function resolveLaunch(cmd: LaunchSeekingWeapon, gs: GameState, rng: Rng): GameEvent[];
//  emits SeekingWeaponLaunched (+ DiceRolled only if a roll is needed); debits ammo/endurance.
function orderSimultaneousLaunches(cmds: LaunchSeekingWeapon[]): LaunchSeekingWeapon[]; // F1.221/6B6 ordering

// ---- Homing movement (6A1) ----
interface HomingOption { hex: HexCoord; facing: Facing; closesRange: boolean; keepsTargetInFA: boolean; requiresHet: boolean; }
function computeHomingOptions(w: SeekingWeaponState, gs: GameState, impulse: number): HomingOption[];
//  enumerates legal hexes per F2.21 (must close if possible -> else maintain) + F2.22 arc priority,
//  honoring Turn Mode 1 and straight-first-move (F2.123). Returns the tie set the owner picks from.
function validateMove(cmd: MoveSeekingWeapon, gs: GameState): ValidationResult;  // chosenHex must be in option set
function isMovementImpulse(speed: number, impulse: number, sabot: boolean): boolean; // imports C3 impulse chart

// ---- Impact & interception (6A3) ----
function detectImpacts(gs: GameState): { weaponId: WeaponId; targetId: UnitId }[]; // entry both directions (F2.31)
function resolveMutualImpact(a: SeekingWeaponState, c: SeekingWeaponState, gs: GameState): GameEvent[]; // F2.51-54 + speed tiebreak
function shieldFacingHit(w: SeekingWeaponState, target: UnitState): number;        // D3.42, HET/TacMan shift (F2.3231)

// ---- Plasma strength & bolts ----
function plasmaWarheadAtRange(type: PlasmaType, hexesTraveled: number, enveloping: boolean): number; // FP1.53 table x2 if EPT
function applyPhaserReduction(w: PlasmaState, phaserPoints: number): PlasmaState;   // 2:1, fraction-combine (FP1.611/615)
function resolveEnveloping(warhead: number, generalReinforcement: number, divisor: 6|2): { perShield: number; leftover: number }; // FP5.31
function resolvePlasmaBolt(launcher: PlasmaLauncher, range: number, ewShift: number, rng: Rng): { hit: boolean; damage: number; roll: number }; // FP8.42/43

// ---- Control channels (re-run every impulse) ----
function controlCapacity(unit: UnitState): number;                                 // F3.211-3.216
function validateControlConditions(unit: UnitState, w: SeekingWeaponState, gs: GameState): { ok: boolean; failed?: keyof typeof F331 }; // the six F3.31 tests
function reconcileControl(gs: GameState): GameEvent[];                              // auto-release/inert on lost conditions (F3.32)
function aggregateEccm(w: SeekingWeaponState, gs: GameState): number;               // built-in + controller-lent (F3.331)

// ---- Inventory ----
function rackCanFire(rack: DroneRack, impulse: number): boolean;                    // 8-impulse gap, capacity, C-rack 12-impulse
function debitAmmoAndMaybeReload(unit: UnitState, rackId: string, turn: number): void; // FD2.42 reload-if-not-fired
```

## Validation & Enforcement Rules

The server is the authoritative referee for all of the following; each is a recorded, GM-overridable decision point.

1. **Launch legality (F1.24, FP1.312, F2.3232).** The announced target must lie in the *weapon's own* forward arc (FA) at the placement hex — even for a same-hex launch. Plasma is additionally constrained by the launcher arc (fixed 120° / swivel 180°, FP3.11/3.21); if no target sits in a legal arc the torpedo must be held or ejected. The engine blocks an illegal launch and surfaces the reason.
2. **Channel accounting (F3.21, F3.31).** Each controlled drone, plasma, pseudo-plasma, scatter-pack, or suicide shuttle consumes exactly one control channel; ballistic and fully self-guiding weapons consume none (F4.12, FP4.2). Every impulse the engine re-runs the six F3.31 conditions (active FC, lock-on, ≤35 hex unit→target, ≤35 hex unit→weapon, ≤35 hex weapon→target on **effective** range from `C8-ew-sensors-cloak.md`, and a free channel); losing any condition auto-releases the weapon, which then self-guides if able else goes inert (F3.32/3.41).
3. **Homing constraint (F2.21–2.23).** On each movement impulse the weapon **must** take a forward move that reduces range if one is legal; failing that it must hold range; subject to that it keeps the target in FA, else FX, else ignores arc. The owner only chooses among genuinely tied hexes. The weapon is **never** forced to spend its HET to satisfy homing (F2.132), and its first post-launch move must be straight (F2.123).
4. **HET budget (F2.13).** One high-energy turn per rolling 32 impulses, never on the launch impulse, never when a closing move is available; it costs the impulse's movement (one endurance hex) and forces a straight next move.
5. **Impact (F2.31, F2.313, F2.315).** Impact triggers when the weapon enters the target hex or the target enters the weapon's hex; the weapon is destroyed and its explosion resolves in step 6A3 *before* asteroid/mine damage. The target may not fire at the weapon at range 0 on the impacting entry, but a non-target unit merely sharing the hex may. Same-hex launches (6B6, after Movement) expose the new weapon to defensive direct fire in 6D2 that impulse; impact occurs on N+1 against the shield facing the launcher at launch (F2.323), adjusted for any target HET/Tactical-Maneuver facing shift.
6. **Plasma strength (FP1.51, FP1.61).** Warhead is read from the range-traveled table at impact, then reduced 2-phaser-points-per-1 (fractions combined, rounded per A3.5) and by qualifying terrain; reaching 0 mid-flight removes the torpedo. Only phasers and large-object/terrain impacts can reduce plasma (FP1.62) — no other weapon, mine, or ESG affects it, and it cannot be tractored or overloaded (FP1.87/1.85).
7. **Enveloping (FP5.31).** Subtract general reinforcement, divide the doubled warhead by 6 (by 2 for Interceptors/Andromedans), drop fractions to all shields equally, and prompt the target owner to place ≤1 leftover point per shield. Reserve power can never complete an EPT (FP1.92).
8. **Point-defense penalty (FD1.51/1.52).** Phasers, anti-drones, plasma, maulers, and Web Fist fire at drones without penalty; photons, disruptors, hellbores, fusion, plasma bolts, particle cannons, PPD, and probes-as-weapons take a 4-point ECM penalty. A drone dies once accumulated damage ≥ its destruction rating; the owner discloses only that it died, not the points used (FD1.54).
9. **Drone-vs-drone (FD1.56).** Any explosive-drone impact destroys any other drone regardless of warhead/armor, except the null/probe/ECM/expended-bus/slug/dummy list (FD1.562); plasma may merely damage a drone if its warhead is too weak (FP1.563).

**GM-override points.** Each numbered rule is enforced via a check that, on failure or contest, can be superseded by an `ApplyGmOverride` command producing a `GmOverrideApplied` event carrying `{ target: weaponId|unitId, value, reason }` — e.g. overriding an arc-at-launch rejection, forcing a control release, hand-setting a plasma warhead for a house-rule terrain, or declaring a contested same-hex impact. Overrides are recorded in the log and replay deterministically.

## UI Contract

Seeking weapons surface across three client screens; the primary launch/targeting interactions belong to the Assisted Targeting & Combat screen — see `wireframes/D5-targeting-combat.svg` and `D5-targeting-combat-ui.md`.

- **Launch panel (D5).** When a unit with a loaded rack/tube acts in 6B6, the client offers a launch control listing each eligible launcher with its loaded munition, remaining ammo, and rate-gap countdown. Selecting a target highlights the legal FA/launcher arc as a shaded wedge (reusing the arc overlay from `C4-direct-fire-combat.md` / D5) and disables out-of-arc targets. For plasma the panel exposes the mode toggle (seek / bolt / enveloping / shotgun / pseudo) with the energy implication shown from `C2-energy-allocation-power.md`.
- **Counters on the map (D1).** Each live seeking weapon renders as a distinct token (drone vs plasma glyph, side color, facing pip) on `wireframes/D1-map-board.svg`; fog-of-war (`A4-realtime-sync-layer.md`) hides type/secret-target from the enemy and shows ambiguous identity after a lock-loss. Clicking a counter the owner controls opens its detail (target line, endurance, control state, controller, plasma current-warhead-at-this-range estimate).
- **Homing assist (D4/D1).** On the weapon's movement impulse the engine returns the `HomingOption[]` tie set; the client highlights the candidate hexes and lets the owner pick one (and toggle HET when available), mirroring the movement-plotting affordances in `D4-movement-plotting-ui.md`. The server still validates the choice.
- **Impulse HUD (D6).** The persistent stepper (`D6-impulse-hud.md`) shows the active sequence step (6B6 launch, 6A1 move, 6D2 defensive fire, 6A3 seeking damage) and the dice log for bolt hits and random-target ties.

The UI never decides for the player: it computes eligibility, arcs, expected plasma strength, and the legal homing set, but the launch, target, facing, tied-hex choice, HET use, control release, and bolt/EPT election are all explicit player commands.

## Dependencies

- `C1-sequence-of-play-engine.md` — owns the impulse loop and step numbers (6A1/6A3/6B3/6B6/6B8/6D2) and the order-of-precedence (C1.313) that decides whether the target moves before the homing weapon.
- `C2-energy-allocation-power.md` — plasma 3-turn arming costs, hold/eject, type-D activation, EPT/shotgun double-energy, and the energy a control channel implies.
- `C3-movement-engine.md` — canonical `HexCoord`/`Facing`, the speed→impulse movement chart, Turn Mode, sideslip, and HET geometry this subsystem calls into.
- `C4-direct-fire-combat.md` — phasers/anti-drones firing **at** seeking weapons in 6D2, plasma bolts and swordfish/Starfish ADD direct fire, and the shared arc overlay.
- `C6-carriers-shuttles-pf.md` — suicide-shuttle / scatter-pack launch in 6B8, fighter/MRS drone control channels, deck-crew reloads.
- `C7-damage-criticals-repair.md` — receives `SeekingWeaponImpacted`/enveloping volleys and resolves shield + internal damage.
- `C8-ew-sensors-cloak.md` — lock-on, ECM/ECCM and the 6-point lent-ECM cap (D6.392), effective-range function, scout channels, cloak lock-retention rolls.
- `C9-terrain-hazards.md` / `C10-mines-boarding-misc.md` — web, asteroids/nebula strength reductions, tractors (friendly→inert, enemy→held), stasis, and minefield interaction.
- `B3-game-catalog-ssd-model.md` — persisted rack/tube/magazine and drone-inventory subdocuments.
- `A3-data-architecture-event-store.md` / `A4-realtime-sync-layer.md` — event log, snapshots, sealed-order fog enforcement.
- `E1-dice-rng-service.md` — seeded rolls for bolt hits and random-target ties; `E2-game-log-replay.md` for deterministic replay.

## Edge Cases & Open Questions

- **Distance timing (F2.24, C1.313).** Range is judged at the instant before the weapon moves; when both target and weapon are scheduled the same impulse the target moves first, so the weapon homes on the hex the target is *entering*. The scheduler must serialize per the precedence table.
- **Tractors (F2.314/4.5).** A friendly tractor renders a seeking weapon inert; an enemy tractor holds it but it still impacts if conditions exist; a released ballistic drone resumes its original heading offset by the tractor displacement. Plasma cannot be tractored at all (FP1.87).
- **Identity ambiguity (F2.63/2.65).** Continuous lock-on by ≥1 enemy ship keeps a weapon individually identified launch-to-impact; a lock-loss-then-regain scrambles which-is-which among same-strength plasmas. Plasma strength stays visible within 35 hexes (FP1.323); passive/cloaked units retain identity within 5 hexes (F2.66).
- **Feedback (FP1.86, FP8.36).** A same-hex plasma impact deals the firing ship 25% of the warhead on its facing shield without reducing the warhead, reduced by EW% and cloak.
- **Open — movement chart import.** F2.0 only says "move when the chart calls for it"; the exact impulse-by-impulse cadence for speeds 8/12/20/32/40 must come from `C3-movement-engine.md`. The sabot super-fast double-move impulses (#4,8,…,32) and the launch-impulse exception (FP11.315) are specified here but realized by C3.
- **Open — Turn Mode 1 semantics.** How many straight hexes precede a legal turn, and the sideslip definition, are section-C facts that F2.23 relies on; confirm the shared geometry primitive.
- **Open — effective vs true range.** Control ranges (F3.31) use EW-affected effective range (D1.4); plasma strength uses true hexes-traveled. The model carries both; confirm the C8 effective-range signature.
- **Open — plasma table index.** Rule text ("moved twelve times", FP1.61) indicates the table is indexed by hexes/impulses **traveled**, not current range-to-target; lock this before encoding the table.
- **Open — X-ship scope.** Type VII–XII drones and plasma L/M require Module X1 (F1.3) and are excluded from Basic scope; confirm whether the engine should carry their fields at all.

## Testing

- **Unit (pure functions).** `plasmaWarheadAtRange` against the full FP1.53 chart for R/S/G/F/D at every range bracket, including the EPT doubling and zero-warhead removal. `resolveEnveloping` against the FP5.31 worked example (general-reinforcement subtraction, /6 with floor, leftover ≤1/shield). `applyPhaserReduction` fraction-combining per A3.5. `resolvePlasmaBolt` hit numbers by range bracket with EW die shift (FP8.42).
- **Homing.** Property tests asserting `computeHomingOptions` always includes a closing move when one exists, never forces an HET (F2.132), and enforces straight-first-move; reproduce the F2.21 "drone circling a stationary wild-weasel" example where the weapon can only hit via an HET it is never required to take.
- **Control.** Drive a controller out of one F3.31 condition at a time and assert auto-release/inert and ECCM withdrawal at the right stage; verify channel capacity for a standard ship (6), a non-drone ship (3), and a double-control ship using a scout channel (18).
- **Impact ordering.** Mutual-impact matrix F2.51–2.54 including the equal-speed "both hit, same shield" branch and the faster-weapon-first tiebreak. Confirm seeking damage in 6A3 precedes asteroid/mine damage in the same hex.
- **Inventory.** Rack rate gates: type-A 8-impulse gap across a turn boundary, type-C 12-impulse gap, type-D magazine draw/destruction, reload-only-if-not-fired (FD2.421).
- **Determinism/replay.** Re-fold the event log with the same RNG seed (`E1`) and assert identical bolt rolls, random-target assignments, and final board state, per `E2-game-log-replay.md`.

## Phasing

**[v1 AM-tournament]** — the seeking-weapon engine and the munitions that appear in Advanced Missions tournament forces:
- Core counter lifecycle: launch placement & arc legality, per-impulse homing (F2.0), HET, endurance, impact & mutual-impact resolution, identity/lock-on tracking.
- Standard drones types I–VI with the FD2.1 stat chart, speed tiers (8/12/20/32), ATG self-guidance, energy-seeking type-VI; racks A/B/C/E/G with rate gates and reloads; launcher-guided control and the full F3 channel/release/transfer model; point-defense (phasers + anti-drones) interaction (FD1.5).
- Plasma types R/S/G/F/D: 3-turn arming/hold/eject, fixed & swivel arcs, self-guidance, the range-strength table, phaser/terrain reduction, **enveloping (EPT)**, **shotgun**, **bolts**, and **pseudo-plasma (PPT)** — all standard tournament tools.
- Ballistic targeting (F4.0) for drones/plasma as a deception/minefield tool.

**[v2]** — broaden to the full carrier/operations layer: scatter-packs (FD7.0), multi-warhead buses and Starfish/Stingray/Stonefish (FD8/FD15–17), ECM drones (FD9.0) and probe drones (FD6.0), specialized warheads (Swordfish/Spearfish/Armor, FD11–14), type-III Tame/Wild Boar (FD5.25), plasma-K dogfight (FP13.0), ECM plasma (FP12.0), sabot (FP11.0), carronade (FP14.0), and full availability/year-table validation (FD10.6).

**[v3 full Master]** — type-H ground-base drones (FD21.0), X-ship advanced drones (types VII–XII) and plasma L/M via Module X1 (F1.3), and any remaining monster/ground-target seeking interactions (P2.x). Rationale: tournament balance never fields these, so they carry no v1 weight, but the base entity and event shapes above already reserve the fields (`subtype`, `plasmaType` L/M, `DroneType` H1–H4) so later phases extend without migration.
