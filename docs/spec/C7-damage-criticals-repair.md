# C7 — Damage, Critical Hits & Repair

## Purpose & Scope

This subsystem owns everything that happens to a unit *after* a weapon is declared to hit it: resolving which shield is struck, subtracting reinforcement / shield boxes / armor, forming penetrating points into **volleys**, running the **Damage Allocation Chart (DAC)** roll-by-roll against the unit's system-box registry, applying the layered DAC restrictions (bold, phaser-directional, every-third-best-type, hull and engine cascades, special-track ordering), recording internal box destruction with its deferred-effect timing, checking the **critical-hit** trigger and table, computing **ship destruction**, and driving in-scenario **damage control** (shield repair and continuous self-repair). It is a pure, deterministic reducer over a normalized "damage incoming" input produced by the weapons docs; all randomness flows through the seeded dice service so replays match. It does *not* decide whether a weapon hits or how much raw damage it carries (that is C4/C5), and it does not own boarding-party combat (C10) beyond exposing the internal-damage casualty counter.

**PHASE:** Core pipeline (shields → volley → DAC → destruction → in-scenario repair) is **[v1 AM-tournament]**. Critical hits ship in v1 as a per-scenario ruleset flag. Campaign repair, leaky shields, hit-and-run damage hooks, and base/fighter/Andromedan alternate charts are **[v2]**/**[v3 full Master]**.

## Rulebook References

- Shields as damage sink: **D3.21** (box decrement / DOWN), **D3.4–D3.43** (which shield struck; ambiguity cascade), **D3.34–D3.3413** (general / specific reinforcement consumption order; hellbore/enveloping pre-subtraction), **D3.61–D3.63** (leaky shields, leaked+excess merge).
- Penetration & volleys: **D4.11–D4.15** (armor, public ship-portion SSD, damage-point definition), **D4.22 / D4.34** (single-volley grouping, multi-ship/multi-volley ordering).
- DAC core: **D4.2 / D4.221–D4.223** (per-point 2d6, column A read, owner picks box, column cascade), **D4.23** (alternate charts for PF/base/fighter/drone/plasma/mine).
- DAC restrictions: **D4.31** (bold once per volley), **D4.321** (phaser directional), **D4.322 / D4.3221–D4.3223** (every-third-best-type), **D4.323** (TORP/DRONE alternate mappings), **D4.324** (any-weapon), **D4.33** (special-track top-box & protected last box), **D4.351** (F/R/C hull cascade), **D4.352** (engine left/right/center), **D4.36** (cargo absorbs excess).
- Destruction: **D4.40–D4.43** (excess-damage death rule, removal, seeking-weapon release, explosion).
- Critical hits: **D8.0–D8.32** (≥20-pt trigger, one 2d6/turn, effects table, 1d6 repair with escalating penalty, legendary officers).
- Damage control & repair: **D9.11–D9.12** (rating = top track box, taken at turn start), **D9.2–D9.23** (in-combat shield repair), **D9.3** (critical repair), **D9.4–D9.44** (campaign), **D9.7–D9.78** (continuous damage repair, caps, restrictions).
- Hooks: **D7.21** (internal-damage BP loss), **D14.0** (EDR, disabled by lab critical), **D22.0** (energy balance due to damage), **H1.0** (power until end of turn), **FP1.7** (plasma fires after launcher loss).

## Domain Model

```ts
type Facing = 1 | 2 | 3 | 4 | 5 | 6;            // shield #, #1 = front (D3.1)
type ShieldLevel = 'off' | 'min' | 'full';
type DacColumn = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
type CauseOfDestruction = 'dac' | 'critical' | 'excess' | 'hitAndRun' | 'gmOverride';

interface ShieldState {                          // D3.2x, D3.34
  facing: Facing;
  maxBoxes: number;                              // printed (B3 SSD)
  currentBoxes: number;
  level: ShieldLevel;
  dropped: boolean;
  specificReinfBoxes: number;                    // D3.342, temporary, this turn only
}

interface SystemBox {                            // the SSD box registry (sourced from B3-game-catalog-ssd-model.md)
  id: string;                                    // stable within the SSD, e.g. "PH1_R3"
  type: string;                                  // 'phaser1' | 'disruptor' | 'warp' | 'hull' | 'sensor' | 'damcon' | 'cargo' | ...
  destroyed: boolean;
  hullType?: 'F' | 'R' | 'C';                    // D4.351
  engineMount?: 'L' | 'R' | 'C';                 // D4.352
  trackRank?: number;                            // 0 = highest box; ordered tracks (D4.33)
  trackProtected?: boolean;                      // last box of a track is never destroyed (D4.33)
  weaponId?: string;                             // link to C4/C5 weapon for arc & best-type
  repairableInScenario: boolean;                 // false for damcon & excess boxes (D9.76)
  excessAbsorber?: boolean;                      // cargo / repair / mine-rack (D4.40)
}

interface ActiveCritical {                       // D8.2
  type: 'activeFc' | 'battery' | 'transporter' | 'lab' | 'tractor'
      | 'shuttleBay' | 'maneuver' | 'warpControl';
  rolledImpulse: number;
  repairAttempts: number;                        // drives -1/-2 escalation (D8.31)
  data?: { bayId?: string };                     // shuttle-bay critical picks a bay by die roll
}

interface DeferredEffect {                       // D4.223 / H1.0 / FP1.7
  kind: 'powerUntilEot' | 'sensorNextTurn' | 'controlBoxNextTurn' | 'plasmaFireWindow';
  boxId: string;
  expiresAt: { turn: number; impulse?: number };
}

interface DamageControlState {                   // D9
  ratingAtTurnStart: number;                     // top undestroyed damcon track box (D9.11)
  shieldRepairEnergy: number;                    // D9.21, ≤ rating
  shieldRepairTarget?: Facing;
  cdr: { boxId: string; pointsSoFar: number } | null;  // one box at a time (D9.74)
  cdrPointsThisTurn: number;                     // = rating, generated free (D9.72)
  cdrBoxesRepairedThisScenario: number;          // vs scenario cap (D9.76)
}

interface ShipDamageState {                      // folded from gameEvents (A3); embedded in snapshot
  shipId: string;
  sizeClass: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  heading: Facing;
  shields: Record<Facing, ShieldState>;
  generalReinfPoints: number;                    // D3.341, remaining this turn
  armorBoxes: number;                            // D4.12
  boxes: SystemBox[];
  dacId: string;                                 // 'standard' | 'pf' | 'starbase' | 'fighter' | ...
  criticalRolledThisTurn: boolean;               // D8.1 once-per-turn gate
  activeCriticals: ActiveCritical[];
  perImpulseShieldDamage: Partial<Record<Facing, number>>;  // ≥20 trigger accumulator
  internalDamageAccumulator: number;             // D7.21 (consumed by C10-boarding)
  deferredEffects: DeferredEffect[];
  damControl: DamageControlState;
}

interface Volley {                               // D4.22
  volleyId: string;
  shipId: string;
  struckShield: Facing;
  penetratingPoints: number;
  contributingUnits: Array<{ unitId: string; points: number; direction: Facing }>;
  damageStep: number;
  impulse: number;
  weaponClass: 'directFire' | 'seeking' | 'enveloping' | 'hellbore' | 'ppd' | 'internal';
}
```

**Mongoose sketch** (the per-ship damage block lives inside the `gameSnapshots` document; the authoritative log is `gameEvents`, per `A3-data-architecture-event-store.md`). The DAC table itself is reference data owned by `B2-rules-engine-core.md`.

```ts
const SystemBoxSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, required: true, index: true },
  destroyed: { type: Boolean, default: false },
  hullType: { type: String, enum: ['F', 'R', 'C'] },
  engineMount: { type: String, enum: ['L', 'R', 'C'] },
  trackRank: Number, trackProtected: Boolean,
  weaponId: String,
  repairableInScenario: { type: Boolean, default: true },
  excessAbsorber: { type: Boolean, default: false },
}, { _id: false });

const ShipDamageSchema = new Schema({
  shipId: { type: String, required: true, index: true },
  sizeClass: Number, heading: Number,
  shields: { type: Map, of: new Schema({ maxBoxes: Number, currentBoxes: Number,
    level: String, dropped: Boolean, specificReinfBoxes: Number }, { _id: false }) },
  generalReinfPoints: { type: Number, default: 0 },
  armorBoxes: { type: Number, default: 0 },
  boxes: [SystemBoxSchema],
  dacId: { type: String, default: 'standard' },
  criticalRolledThisTurn: { type: Boolean, default: false },
  activeCriticals: [{ type: Object }],
  perImpulseShieldDamage: { type: Map, of: Number },
  internalDamageAccumulator: { type: Number, default: 0 },
  deferredEffects: [{ type: Object }],
  damControl: { type: Object },
}, { _id: false });
```

## Events & Commands

C7 consumes the hit notifications emitted by `C4-direct-fire-combat.md` and `C5-seeking-weapons.md` (carried as `WeaponFired` / `SeekingWeaponDetonated` with `{ targetId, struckHexGeometry, rawPoints, weaponClass }`). It is the sole emitter of damage-mutation events.

**Commands consumed** (PascalCase, validated → emit events):

- `ResolveIncomingFire { gameId, targetId, impulse, damageStep, hits: HitInput[] }` — engine-internal command queued when fire is declared resolved; runs struck-shield + penetration + volley grouping.
- `ChooseStruckShield { gameId, targetId, firingUnitId, facing }` — owner choice in true-ambiguous geometry (D3.43-C); locked from first request until next impulse.
- `AllocateDamage { gameId, targetId, volleyId, placements: Array<{ pointSeq: number; boxId: string }> }` — the **one player decision** in the DAC: which qualifying box of the engine-resolved type to mark. Engine pre-computes the legal box set per point; this validates membership.
- `AttemptCriticalRepair { gameId, shipId, criticalType }` — owner picks the single critical to repair this turn (D8.31).
- `AllocateShieldRepair { gameId, shipId, energy, targetShield }` and `AllocateContinuousRepair { gameId, shipId, boxId, points }` — sourced from Energy Allocation (`C2-energy-allocation-power.md`); the *which-shield / which-box* choice resolves here.
- `ApplyGmOverride { gameId, target, value, reason }` — generic override (see §6).

**Events emitted** (past tense, appended to `gameEvents`):

- `ShieldStruck { shipId, facing, incomingPoints, generalReinfUsed, specificReinfUsed, shieldBoxesDestroyed, armorBoxesDestroyed, penetratingPoints }`
- `VolleyFormed { volleyId, shipId, struckShield, penetratingPoints, contributingUnits, damageStep, impulse, weaponClass }`
- `DiceRolled { rollId, kind: '2d6'|'1d6', result, purpose: 'dac'|'critical'|'criticalRepair'|'tieBreak', context }` — every roll comes from `E1-dice-rng-service.md`.
- `DamageAllocated { volleyId, shipId, placements: Array<{ pointSeq, roll, resolvedColumn, systemType, boxId }> }`
- `BoxDestroyed { shipId, boxId, systemType, cause, deferred?: DeferredEffect }` — one per box for fine-grained replay & UI.
- `StruckShieldChosen { shipId, firingUnitId, facing }`
- `CriticalHitChecked { shipId, struckShield, accumulatedPoints, rolled }`
- `CriticalHitApplied { shipId, criticalType, roll, data }`
- `CriticalHitRepaired { shipId, criticalType }` / `CriticalRepairFailed { shipId, criticalType, modifier }`
- `ShieldRepaired { shipId, facing, boxesRestored }`
- `RepairProgressed { shipId, boxId, pointsSoFar, cost }` / `SystemRepaired { shipId, boxId }`
- `ShipDestroyed { shipId, finalHitSeq, releasedSeekingWeapons: string[] }`
- `GmOverrideApplied { target, value, reason }`

## Engine / API

All resolvers are pure `(state, input, rng) → { events, nextState }`; the RNG handle is the seeded service so a given seed + command stream replays identically.

```ts
function determineStruckShield(
  geom: ShieldGeometry, target: ShipDamageState, ctx: MoveContext
): { facing: Facing } | { ambiguous: true; cascade: 'A' | 'B' | 'C' };          // D3.4–D3.43

function applyReinforcementAndShield(
  volley: Volley, s: ShipDamageState
): { events: DamageEvent[]; penetratingPoints: number; next: ShipDamageState }; // order: gen → spec → shield → armor (D3.3411, D4.12)

function formVolleys(hits: ResolvedHit[]): Volley[];                            // group by (shield, damageStep, impulse) (D4.22, D4.34)

function rollDamagePoint(rng: Rng): { roll: number; rollId: string };          // 2d6 (D4.221)

function resolveDacType(
  roll: number, dac: DacTable, s: ShipDamageState, r: DacRestrictionCtx
): { systemType: string; column: DacColumn };                                  // column A→cascade (D4.222) + restrictions (D4.3x)

function legalBoxesForPoint(
  systemType: string, struckShield: Facing, volley: Volley, s: ShipDamageState, r: DacRestrictionCtx
): string[];                                                                    // boxes the owner may pick among (D4.223, D4.321, D4.351, D4.352, D4.33)

function validateAllocation(
  placements: Placement[], legal: Map<number, string[]>
): { ok: true } | { ok: false; reason: string };

function checkCriticalTrigger(s: ShipDamageState, shield: Facing, impulsePts: number): boolean;  // ≥20 & not yet rolled (D8.1)
function rollCritical(rng: Rng): ActiveCritical['type'] | 'none';              // 2d6 (D8.2)
function applyCritical(s: ShipDamageState, c: ActiveCritical): ShipDamageState;
function attemptCriticalRepair(s, type, rng): { fixed: boolean; modifier: number }; // 1d6 -0/-1/-2 (D8.31)

function computeDamConRating(s: ShipDamageState): number;                      // top undestroyed damcon box (D9.11)
function accrueContinuousRepair(s, alloc): ShipDamageState;                    // +rating pts, ≤5/box, cap (D9.72/D9.76)
function applyEndOfTurnRepairs(s): { events: DamageEvent[]; next: ShipDamageState }; // shield boxes + CDR completions (D9.2/D9.73)

function checkDestruction(s: ShipDamageState): { destroyed: boolean; absorberBoxId?: string }; // D4.40
```

## Validation & Enforcement Rules

The referee enforces, automatically and without player input except where noted:

1. **Subtraction order** (D3.3411): general reinforcement → specific reinforcement → printed shield boxes → armor → internals. Hellbore/enveloping subtract *general points* from raw strength first (D3.3412); each PPD/enveloping plasma is its own volley (D4.23, never merged).
2. **Volley grouping** (D4.22/D4.34): fire from several directions onto the *same* shield in the *same* damage step of the *same* impulse is one volley; multi-volley/multi-ship ordering is largest-first, ties broken by a `DiceRolled` tie-break — this ordering matters only for phaser direction, never for box counts.
3. **DAC per point** (D4.221–223): one 2d6 per internal point; read column A; if no undestroyed box of that type, cascade A→B→C… then to Annex #7E priority. The owner selects *which* qualifying box; an `AllocateDamage` placement is rejected if the chosen box is absent from `legalBoxesForPoint`.
4. **Bold once per volley** (D4.31): a bold *chart position* scores at most once per volley; tracked in `DacRestrictionCtx.boldUsed`. Other rows hitting the same system type still count.
5. **Phaser directional** (D4.321): a phaser hit must land on a phaser able to fire toward the firer (direct-fire) or through the struck shield (seeking/enveloping); if none bears, cascade. "Any weapon" (D4.324) and internal explosions ignore direction and *must* take a qualifying box if one exists (excluding crew/BP/cloak/ammo tracks).
6. **Every-third-best-type** (D4.322): phasers reset the group-of-three counter per volley; torpedoes/drones use a cumulative per-scenario counter (separate fields). Max 1 point per volley on a stasis-field generator.
7. **Hull cascade** (D4.351): F vs R(=A) vs C; rear hits cannot take forward hull and vice-versa; while any C-hull box can take a hull hit, an F/R hit may not skip past it.
8. **Engine mount** (D4.352): a left/right hit may never mark a single (center) engine — cascade instead.
9. **Special tracks** (D4.33): sensor/scanner/damcon mark the highest remaining box first; the protected last box is never destroyed (so a residual rating/sensor always survives).
10. **Deferred effects** (D4.223/H1.0): destroyed power boxes still produce until end of turn; reduced sensor rating defers to next turn; lost control-box restrictions defer to end of turn; plasma launchers retain an 8-impulse fire window (FP1.7). These are queued as `DeferredEffect`s, not applied instantly.
11. **Critical hits** (D8.1): trigger when ≥20 points (shield + reinforcement + penetrating, summed across all same-shield fire that impulse) hit one shield; at most one 2d6 roll per turn regardless of how often the threshold is met; criticals disable, never destroy (D8.21).
12. **Damage control** (D9): rating is locked at turn start (D9.11); shield repair costs 2 energy/box up to the rating, repairs only prior-turn damage, no reserve power (D9.22/D9.23); CDR generates `rating` points/turn, ≤5 to any one box, one box at a time, cannot start a box destroyed the same turn, cannot repair damcon/excess boxes, and counts against the scenario cap (D9.73–D9.76).
13. **Destruction** (D4.40): the killing excess hit cannot be taken as excess while any cargo/repair/mine-rack box remains; on the true final hit emit `ShipDestroyed`, release controlled seeking weapons (D4.42 → C5), and signal the explosion handler in `C9-terrain-hazards.md` (D5.12).

**GM-override points** (`GmOverrideApplied {target, value, reason}`): (a) the struck shield in true-ambiguous geometry beyond the D3.43 cascade; (b) any specific DAC box placement contested between sides; (c) forcing or suppressing a critical-hit roll/result; (d) overriding a repair success/failure die; (e) declaring or sparing destruction in an edge case; (f) house-rule reinforcement or armor adjustments. Each override is a recorded event so replays remain deterministic.

## UI Contract

The client renders state; it never computes legality. C7 supplies:

- **SSD damage overlay** (`D2-ssd-viewer-ui.md`, wireframe `wireframes/D2-ssd-viewer.svg`): live per-box destroyed/critical/repairing status, shield box counts and DOWN/dropped flags, armor remaining. Per **D4.14** the *ship-portion* SSD (including shield damage) is inspectable by opponents and spectators; pending energy allocation, reinforcement amounts (D3.347), and sealed orders stay owner-only and are stripped server-side by `A4-realtime-sync-layer.md`.
- **Volley resolution panel** (`D5-targeting-combat-ui.md`, wireframe `wireframes/D5-targeting-combat.svg`): a stepped list — for each internal point show its 2d6 roll, the resolved system type, the highlighted set of legal boxes, and a click-to-place control that emits `AllocateDamage`. The engine offers an "auto-assign legal default" so play never stalls; the owner may re-pick before committing.
- **Struck-shield prompt**: appears only on `ambiguous` geometry; the owning side picks the facing (emits `ChooseStruckShield`), locked for the impulse.
- **Critical-hit banner** + a damage-control widget surfaced inside the Energy Allocation screen (`D3-energy-allocation-ui.md`) for shield-repair and CDR target selection.
- **GM/spectator console** (`D9-gm-spectator-console.md`): override controls for every point in §6, with a reason field.

## Dependencies

Builds on / services: `A3-data-architecture-event-store.md` (event log + snapshots), `A4-realtime-sync-layer.md` (fog-of-war stripping), `B2-rules-engine-core.md` (DAC table, Annex #7E cascade, Annex #9 repair costs, override plumbing), `B3-game-catalog-ssd-model.md` (the SSD box registry: types, hull/engine tagging, dac id), `E1-dice-rng-service.md` (seeded 2d6/1d6). Consumes hits from `C4-direct-fire-combat.md` and `C5-seeking-weapons.md`; reads facing/precedence from `C3-movement-engine.md` and `C1-sequence-of-play-engine.md` (timeline of when shields operate, when DAC resolves, when repairs apply). Provides the internal-damage casualty counter and box-destroy hooks to `C10-mines-boarding-misc.md` (D7.21, hit-and-run). Cooperates with `C2-energy-allocation-power.md` (reinforcement, damage-control energy, D22 energy balance) and `C8-ew-sensors-cloak.md` (lock-on gating, sensor-rating deferral). UI consumers: `D2-ssd-viewer-ui.md`, `D5-targeting-combat-ui.md`, `D3-energy-allocation-ui.md`, `D9-gm-spectator-console.md`. Replay validation: `E2-game-log-replay.md`.

## Edge Cases & Open Questions

- The full **DAC grid** (rows 2–12 × columns A–H with bold flags), **Annex #7E** cascade priority, **Annex #9** repair costs, and the **Annex #7D** weapon list are reference sheets not present in section-D prose; they must be imported as data into `B2-rules-engine-core.md`. C7 is written table-agnostic so it works once the data lands.
- Exact crew-quality modifiers to critical-hit repair (G21.132 outstanding / G21.232 poor) live in section G; assume ±1 pending confirmation.
- **D8.1** says the ≥20 trigger counts shield + reinforcement + penetrating on one shield in one impulse — we sum all same-shield fire that impulse (consistent with single-volley logic D4.34); confirm against worked examples.
- Warp-control critical (D8.23) stops movement immediately and interacts with `C3-movement-engine.md` and D22 energy balance; the cross-handoff (one Tactical Maneuver allowed if impulse power was on movement) needs a joint test with C3.
- Alternate DACs (PF/interceptor K5.0, starbase R1.1D, fighter J1.32, drone FD1.54, plasma FP1.6, mine M8.4) are selected by `dacId`; only `standard` ships in v1.

## Testing

- **Reinforcement + shield math**: reproduce D3.63 — 45 points on a 30-box shield with leaky variant yields a single 15-point internal volley (9 leaked + 6 excess); assert volley grouping and penetration count.
- **DAC determinism**: fixed RNG seed + fixed command stream must reproduce byte-identical `DamageAllocated`/`BoxDestroyed` event sequences (drives `E2` replay).
- **Restriction units**: bold-once-per-volley; phaser directional cascade when no phaser bears; every-third-best-type counter reset (phaser, per volley) vs cumulative (torpedo/drone, per scenario); F/R/C hull mandatory-C rule; left/right hit rejected on a single engine; track top-box ordering and protected last box.
- **Critical trigger**: exactly 19 vs exactly 20 points on one shield; multiple ≥20 events in a turn → still one roll; effect applied immediately, system disabled not destroyed.
- **Repair**: shield repair 2-energy/box capped at rating, prior-turn-only; CDR accumulation across turns with 5-pt/box cap, scenario cap enforcement, no-repair-same-turn-destroyed, damcon/excess boxes refused; 1d6 critical repair with −1/−2 escalation.
- **Destruction**: excess hits forced onto cargo/repair/mine-rack before the killing blow; `ShipDestroyed` releases controlled seeking weapons; deferred power-until-EOT still produces that turn.
- **Override**: a `GmOverrideApplied` on a contested box placement reshapes state and still replays deterministically.

## Phasing

- **[v1 AM-tournament]**: shield/armor/reinforcement subtraction, volley formation, full standard-DAC with all D4.3 restrictions, internal box destruction with deferred-effect timing, ship destruction (D4.40), in-scenario shield repair (D9.2) and continuous damage repair (D9.7), and critical hits (D8) exposed as a per-scenario ruleset flag (tournament templates set it on or off). These are the mechanics that decide a standard duel and are mandatory for faithful play.
- **[v2]**: campaign repair tallies (D9.4), leaky shields (D3.61), hit-and-run damage application (D7.8 hook from C10), alternate DACs for PFs/fighters/drones, legendary-officer independent repairs (D8.32, D9.711).
- **[v3 full Master]**: base/starbase DACs (R1.1D/R1.14), Andromedan PA panels in place of shields and D24 criticals, monitors (R1.22), area-by-area boarding damage (D16), and the full special-weapon separate-volley matrix. Deferred because they need their own SSD subtypes and rule sections beyond the tournament envelope.
