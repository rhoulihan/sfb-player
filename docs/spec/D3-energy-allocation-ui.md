# D3 — Energy Allocation Panel UI

## Purpose & Scope

This document specifies the **Energy Allocation Panel** — the player-facing graphical surface that
sits on top of the energy engine in `C2-energy-allocation-power.md`. Each turn, during the Energy
Allocation Phase (Phase 1 of the Sequence of Play, `C1-sequence-of-play-engine.md`), a commander uses
this panel to distribute every ship's available power across a fixed schedule of sinks — movement,
weapons, shields, reinforcement, fire control, special systems — by **dragging power tokens or moving
sliders/steppers** from a live **source pool** into **sink rows**. The panel renders the budget the
engine will validate: a continuously-updating *remaining-to-allocate* readout, an *over-/under-
allocation* balance meter that gates legality, **presets/templates** and **copy-last-turn** to remove
drudgery, and a **secret submit (Lock)** action with a per-side **ready indicator**. The hard line
this doc inherits from the contract: *the UI surfaces costs, totals, legality, and bookkeeping
(all AUTOMATED) but never chooses where power goes — every distributive choice is a PLAYER DECISION.*
The panel is advisory and optimistic; the authoritative referee verdict is always the server-side
`validateAllocation` in C2.

**PHASE:** The full drag/slider routing surface, balance meter, presets/templates, copy-last-turn,
sealed simultaneous submit with ready indicator, and the basic mid-turn reserve drawer are
**[v1 AM-tournament]**. Fractional-accounting drag granularity and AWR-vs-APR source badges are
**[v2]**. Andromedan/Vudar specialized EAF layouts (extra source pools, ionization surcharge row)
are **[v3 full Master]**.

## Rulebook References

The panel does not *implement* rules; it presents the line items the engine derives from them and
relays the player's intent back as an `EafColumn`. The rules it makes visible:

- EAF line schedule and per-turn columns: **B3.0, B3.1**; under-allocation is legal but never becomes
  reserve, so the panel warns and offers a route-to-batteries fix: **B3.4**; secret records revealed
  only at game end: **B3.5**.
- Mandatory **Life Support** row (locked, force-filled by size class SC1=3 … SC5=0): **B3.3**.
- Source-pool composition — warp **H2.0**, impulse **H3.0**, APR/AWR **H4.0**, batteries (pip cells)
  **H5.0**, phaser-capacitor carry-over store **H6.0**; reserve-drawer typing **H7.4–H7.49**.
- Sink costs surfaced (values owned by their engine docs): shields/reinforcement **D3.32/D3.341/D3.342**
  (`C7-damage-criticals-repair.md`), active/low fire control 1 / 0.5 **D6.6/D6.7**, photon multi-turn
  arming **E4.21**, ≤1 impulse point to movement & 30-MP warp cap **H3.4/C2.112** (`C3-movement-engine.md`).
- Mid-turn reserve discharge/transfer at legal sequence steps **H7.11/H7.131/H7.132**, post-damage
  reserve limits **H7.134**.

## Domain Model

These are **client view-models** (derived each render from the C2 `ShipPowerState` projection
streamed by `A4-realtime-sync-layer.md`) plus one **persisted** collection — saved allocation templates.

```typescript
import type {
  EafColumn, ShipPowerState, ValidationResult, BalanceError, BalanceWarning, EnergyType,
} from './C2-energy-allocation-power'; // engine types are the contract

type BalanceStatus = 'balanced' | 'underAllocated' | 'overAllocated'; // green / amber / red

// One source chip in the left Source Pool (H2–H6). Battery renders as discrete pips.
interface PoolChipVM {
  source: 'warpEngine' | 'impulse' | 'apr' | 'awr' | 'battery' | 'capacitorCarryover';
  energyType: EnergyType;          // gates which sinks accept a token dragged from here
  available: number;               // unchecked-box count (AUTOMATED, C2.computeAvailablePower)
  committed: number;               // points routed out of this chip in the draft
  pips?: { capacity: number; stored: number; destroyed: boolean }[]; // batteries only (H5.2)
  citation: string;                // e.g. 'H2.0' — opens the rule via B1
}

// One allocatable sink row in the center board. Maps 1:1 to an EafColumn field/element.
interface SinkRowVM {
  sinkId: string;                  // 'movement' | 'phaserCap' | `torp:${tubeId}` | 'shields' | …
  group: 'mandatory' | 'movement' | 'weapons' | 'defense' | 'systems' | 'housekeeping';
  label: string;
  eafPath: string;                 // dot-path into EafColumn, e.g. 'line14.warpPoints'
  current: number;                 // points currently routed here in the draft
  min: number; max: number;        // clamp bounds (e.g. life support min==max; impulseToMove max 1)
  unitCost: number;                // points per increment (ph-3=0.5, shield rows by chart)
  acceptsTypes: EnergyType[];      // typed-source gating (movement rejects awr/apr/battery, H7.45)
  locked: boolean;                 // life support (B3.3) — forced, non-editable
  unmet?: string;                  // e.g. 'tube destroyed' or 'capacitor full' (advisory)
  citation: string;
}

interface BalanceMeterVM {
  produced: number;                // line4 + battery draw available
  used: number;                    // line20 live
  remaining: number;               // produced - used (the big readout)
  status: BalanceStatus;
  errors: BalanceError[];          // from C2.validateAllocation — block Lock
  warnings: BalanceWarning[];      // under-allocation, surplus-not-reserved (B3.4)
}

interface ReadyIndicatorVM {       // driven by A4 lockStateChanged
  sidesLocked: number; sidesTotal: number;     // "1 of 2 sides locked"
  myShipsLocked: number; myShipsTotal: number; // a commander may hold several ships
  selfLocked: boolean;
}

interface EnergyPanelViewModel {
  shipId: string; turn: number;
  pool: PoolChipVM[];
  sinks: SinkRowVM[];
  draft: EafColumn;                // the in-progress column (optimistic, never sent to opponents)
  balance: BalanceMeterVM;
  ready: ReadyIndicatorVM;
  ruleset: { fractionalAccounting: boolean }; // drag granularity 1 vs ⅓/½ (v2)
}
```

**Mongoose sketch — persisted allocation templates** (user-scoped config, *not* game events; CRUD
over REST, never in the `gameEvents` log):

```typescript
const eaTemplateSchema = new Schema({
  ownerId:   { type: ObjectId, ref: 'User', index: true },
  name:      { type: String, required: true },     // "Alpha Strike", "Defensive Hold"
  scope:     { type: String, enum: ['shipClass', 'global'], default: 'shipClass' },
  shipClass: { type: String, index: true },        // e.g. 'FED-CA' — matches B3 catalog key
  ruleset:   { fractionalAccounting: Boolean },
  // store sink intents as fractions of available, so a template adapts to a damaged ship
  intents:   [{ sinkId: String, mode: { type: String, enum: ['absolute', 'fillTo', 'percent'] },
               value: Number }],
  createdAt: Date, updatedAt: Date,
}, { timestamps: true });
eaTemplateSchema.index({ ownerId: 1, shipClass: 1, name: 1 }, { unique: true });
```

The draft `EafColumn` lives only in client memory until Lock; on Lock it becomes the encrypted
`sealedPayload` of a `SubmitSealedOrders` command (sealed-order store owned by
`A4-realtime-sync-layer.md` and C2). The revealed column and folded `ShipPowerState` arrive back via
`A3-data-architecture-event-store.md`.

## Events & Commands

**Commands the panel emits** (validated server-side before any event):

- `AllocateEnergy` — `{ gameId, turn, shipId, column: EafColumn }`. Sent **only** as the decrypted
  payload at reveal (C2 owns timing); during editing the draft stays local and is *not* transmitted.
- `SubmitSealedOrders` — `{ gameId, turn, shipId, side, commitHash, sealedPayload }`. The **Lock**
  button seals one ship; a side-level **Lock All** issues one per controlled ship, then the client
  raises `LockOrders` (A4) to close its submission window.
- `DischargeReservePower` / `TransferReservePower` — emitted by the mid-turn reserve drawer at a legal
  sequence step (payloads per C2; A4 carries the impulse/step cursor).
- `ApplyGmOverride` — only surfaced to `gm`/`host` (role check via `A2-identity-roles-gating.md`),
  e.g. to force a balance verdict or a line value.

**Template CRUD (REST, not event-sourced):** `POST/GET/PUT/DELETE /api/games/:id/ea-templates`
returning `EaTemplate` docs; client actions `SaveEaTemplate`, `ApplyEaTemplate`, `DeleteEaTemplate`
are pure client operations that read/write that collection and rebuild the draft locally.

**Events the panel consumes** (from the fog-filtered tail via A4):

- `submissionWindowOpened` `{ turn, panel: 'energy' }` — arms the panel and starts the timer.
- `lockStateChanged` `{ sidesLocked, sidesTotal, shipsLocked[] }` — drives `ReadyIndicatorVM`.
- `OrdersSealed` `{ shipId, side }` — flips a ship to the locked badge (opponents see only this).
- `OrdersRevealed` `{ turn, ships }` — unlocks the read-only revealed column + reveal animation.
- `EnergyAllocated`, `BatteryStateChanged`, `CapacitorCharged`, `LifeSupportResolved`,
  `ReservePowerDischarged/Transferred`, `EnergyBalanceRecharged` — refresh pool chips and history.

## Engine / API

Client-side, pure where possible; all share C2's validator so client and server verdicts match.

```typescript
// Build the whole view-model from the streamed projection + previous turn's column.
function buildEnergyPanelViewModel(
  s: ShipPowerState, prevColumn: EafColumn | null,
): EnergyPanelViewModel;

// Pure reducer for one routing gesture (drag drop, slider move, stepper click, numeric entry).
interface RouteIntent { sinkId: string; sourceType: EnergyType; delta: number; } // signed points
function applyRouting(draft: EafColumn, intent: RouteIntent, s: ShipPowerState): EafColumn;

// Live, advisory validation — calls the SAME pure C2.validateAllocation; result feeds the meter.
function liveValidate(s: ShipPowerState, draft: EafColumn): ValidationResult;
function computeBalanceMeter(s: ShipPowerState, draft: EafColumn): BalanceMeterVM;

// Copy-last-turn: clone prev column, then CLAMP every sink to current availability after damage.
function copyLastTurn(prev: EafColumn, s: ShipPowerState): { draft: EafColumn; clamped: string[] };

// Apply a saved template; returns the draft plus any intents that could not be met (missing systems).
function applyTemplate(t: EaTemplate, s: ShipPowerState): { draft: EafColumn; unmet: string[] };

// Lock helpers (delegate sealing/hashing to A4/C2).
function lockShip(gameId: string, shipId: string, draft: EafColumn): Promise<CommandAck>;
function lockSide(gameId: string, side: string): Promise<CommandAck>;
```

Server side, this doc only owns the **template** endpoints (Express handlers, JWT + CSRF per the
wavemax stack); sealing, reveal, and the authoritative `validateAllocation` belong to C2/A4.

## Validation & Enforcement Rules

The panel is a **convenience layer over an authoritative referee**; it never lets the player *believe*
an illegal budget is legal, but the server has the final word.

1. **Block on red, advise on amber.** The **Lock** button is disabled whenever
   `balance.status === 'overAllocated'` or any `errors[]` are present (over-allocation, unbalanced
   `line20`, capacitor over-room, impulse-to-move > 1, typed-source violation). Under-allocation is
   *amber, never blocking* — surplus engine power is not reserve (B3.4); the warning offers a one-click
   "route surplus to batteries (line16)" fix.
2. **Clamp at the source.** Sliders/steppers and drag-drop are clamped to `[min, max]`; the
   life-support row is `locked` and force-filled (B3.3); impulse-to-movement maxes at 1 (H3.4); phaser
   capacitor refuses tokens past `capacity − charge` (H6.21).
3. **Typed-source gating is visual and enforced.** A `PoolChipVM`'s `energyType` must be in the
   target `SinkRowVM.acceptsTypes`; dragging warp-reactor/APR/battery onto a movement row is rejected
   with the citing rule on the hover tooltip (movement-related functions, H7.45). v2 surfaces AWR vs
   APR as distinct chips.
4. **Copy-last-turn respects damage.** `copyLastTurn` clamps to *current* box counts; sinks whose
   prior value no longer fits (destroyed warp boxes, a lost tube) are reduced and listed in `clamped[]`
   so the player re-decides rather than silently mis-budgeting.
5. **Templates never auto-commit illegality.** `applyTemplate` fills what it legally can and surfaces
   `unmet[]`; the player must resolve those before Lock.
6. **Fog-of-war.** The draft column and any reserve plan are owner-only; the client transmits nothing
   to opponents until reveal (B3.5). Opponents and spectators receive only lock badges and the
   post-reveal public column (gating in `A2-identity-roles-gating.md`, stripping in A4).
7. **Optimistic reconciliation.** If the server's `EnergyAllocated`/`commandAck` differs from the
   optimistic draft (e.g. a GM override changed a cost), the panel snaps to the authoritative column
   and flags the delta.

**GM-override points:** a `gm`/`host` may override the balance verdict, any sink value, the
life-support mode, or a typed-source rejection via `ApplyGmOverride`; the override banner cites the
reason and the affected line.

## UI Contract

The screen is rendered per **`wireframes/D3-energy-allocation.svg`**; panel IDs below match that
wireframe so the layout is unambiguous. The energy panel is a full-width workspace that arms when A4
emits `submissionWindowOpened{panel:'energy'}` and is the focused surface during Phase 1.

- **Header bar (`#hdr`).** Left: **ship tabs** — one tab per ship the commander controls, each with a
  live mini balance dot (green/amber/red) and a lock padlock once sealed. Center: turn number and the
  **submission-window countdown**. Right: the **ready indicator** ("1 of 2 sides locked · 2 of 3 ships
  ready") bound to `ReadyIndicatorVM`, and the prominent **Lock** / **Lock All** buttons.
- **Source Pool — left rail (`#pool`).** A vertical stack of `PoolChipVM` cards: Warp, Impulse,
  APR/AWR, Batteries, and the Phaser-Capacitor carry-over store. Each card shows `available`,
  `committed`, and a thin bar of the remainder; **batteries render as discrete pips** (filled =
  charged, hollow = discharged, ✕ = destroyed). A large **Remaining to Allocate** number crowns the
  rail and updates on every gesture; it turns red on over-allocation and the offending chip flashes.
- **Sink Board — center (`#sinks`).** Grouped, collapsible sections mirroring the EAF schedule:
  *Mandatory* (Life Support — locked, pre-filled); *Movement* (warp MP with a live "= N hexes"
  readout and the 30-cap, plus the single impulse-point toggle); *Weapons* (Phaser Capacitor with a
  fill-to-capacity meter, and one row per torpedo tube with a multi-turn-arming progress chip);
  *Defense* (Shields min/full toggle, General Reinforcement, per-shield Specific Reinforcement);
  *Systems* (Fire Control 0/0.5/1, EW, Tractor, Transporters, Damage Control); *Housekeeping*
  (Recharge Batteries, Misc). Every row is a `SinkRowVM`: label · unit cost · **slider** ·
  **numeric stepper** · **drop target** · typed-source badge · "remaining after" · a rule-citation
  chip (opens `B1-rules-content-api.md`). **Drag interaction:** the player grabs a power token from a
  pool chip and drops it on a sink (or types/steps the value); incompatible drops are refused with a
  reason tooltip.
- **Balance & Actions — right rail (`#balance`).** The **Balance Meter** (a produced/used/remaining
  bar, green/amber/red) bound to `BalanceMeterVM`; a scrollable **message list** (blocking errors
  first, then advisory warnings, each citing its rule); the **Presets/Templates** dropdown (apply,
  save current as template, manage); the **Copy-Last-Turn** button (with a clamp badge if damage
  reduced availability); **Reset**; and a restated **Lock** with a confirm step ("orders are secret
  and final for this turn").
- **Reserve Drawer (`#reserve`).** Collapsed during Phase 1; during the impulse procedure it slides up
  to let the owner discharge/transfer battery and reserve power at legal sequence steps (post-damage
  reserve is filtered to shield reinforcement / PA-panel raises per H7.134). It is shared with the
  combat screens (`D5-targeting-combat-ui.md`, `D6-impulse-hud.md`) which host it during fire.
- **Locked / revealed states.** After Lock the ship's controls disable, the tab shows a padlock, and
  the ready indicator advances. On `OrdersRevealed` the column becomes a read-only summary and a brief
  reveal animation plays. Opponents never see anything but the lock badge.
- **Accessibility.** Every drag has a keyboard-equivalent stepper and a direct numeric-entry field;
  the balance status is announced (not color-only); citation chips are focusable links.

## Dependencies

- `C2-energy-allocation-power.md` — **the engine**: `EafColumn`, `validateAllocation`,
  `computeAvailablePower`, `lifeSupportCost`, `capacitorCapacity`, sealed-order commands/events. This
  doc is its presentation layer.
- `A4-realtime-sync-layer.md` — submission-window arming, `lockStateChanged` ready barrier,
  `SubmitSealedOrders`/`LockOrders` plumbing, fog stripping of drafts.
- `A3-data-architecture-event-store.md` — event tail + snapshot bootstrap that feeds the projection.
- `A2-identity-roles-gating.md` — who may edit which ship; GM override visibility; spectator fog.
- `B3-game-catalog-ssd-model.md` — box counts, size class, movement cost, phaser fit → pool chips,
  life-support row, capacitor capacity, template `shipClass` keys.
- `B1-rules-content-api.md` — citation chips / hover rule lookups.
- `C1-sequence-of-play-engine.md` — places EA as Phase 1; the 32-impulse clock the reserve drawer uses.
- `C3-movement-engine.md` — consumes `line14`; supplies the "= N hexes" readout and 30-MP cap.
- `C4-direct-fire-combat.md`, `C5-seeking-weapons.md`, `C7-damage-criticals-repair.md` — weapon/tube,
  drone fire-control, and shield/reinforcement cost owners surfaced as sink rows.
- Sibling D-docs: `D2-ssd-viewer-ui.md` (the SSD panel the player cross-checks while budgeting),
  `D5-targeting-combat-ui.md` and `D6-impulse-hud.md` (host the shared reserve drawer).

## Edge Cases & Open Questions

- **Multi-ship commanders.** A commander may hold several ships; the ready indicator tracks
  *ships-locked* and *sides-locked* separately, and **Lock All** seals every controlled ship that is
  currently balanced (red ships are skipped and highlighted). **Open:** whether a side's window closes
  only when *all* its ships are locked or a GM may force-close — defer to `A4`/`C1` policy.
- **Copy-last-turn after damage** reduces availability; the panel clamps and flags rather than
  carrying an illegal budget forward (handled by `copyLastTurn.clamped[]`).
- **Template drift.** A template referencing a now-destroyed weapon/system yields `unmet[]`; the panel
  applies the rest and prompts the player.
- **Fractional accounting [v2].** Drag granularity must switch from 1-point steps to ⅓/½ increments
  and the capacitor meter to exact (non-rounded) capacity; the slider snap model is an open UX detail.
- **Optimistic vs authoritative divergence.** Rare GM cost overrides mid-allocation force a snap-to
  authoritative draft; the diff banner wording is **open**.
- **Hard-block vs warn** is settled (block on over-allocation, warn on under) consistent with C2;
  confirm in UX review.

## Testing

- **Routing reducer (unit).** `applyRouting` is pure: dropping 3 warp onto Movement sets
  `line14.warpPoints=3` and reduces the Warp chip's remainder; an over-cap phaser drop is refused.
- **Live-validate parity (golden).** `liveValidate` must equal server `validateAllocation` on the C2
  vectors: Fed CA total power 34, life support by size class, Fed CA capacitor 6, Kzinti CV 11
  (10.5 fractional, v2), Klingon D7 9. Same `errors[]`/`warnings[]` on both sides.
- **Balance meter colors.** Balanced → green + Lock enabled; under-allocated → amber + Lock enabled +
  route-to-batteries suggestion (B3.4); over-allocated → red + Lock disabled.
- **Clamp rules.** Impulse-to-move cannot exceed 1 (H3.4); warp MP readout caps at 30 (C2.112);
  capacitor refuses tokens past room (H6.21).
- **Copy-last-turn after simulated damage** clamps destroyed-box sinks and populates `clamped[]`.
- **Template apply** with a missing tube returns the expected `unmet[]` and never auto-locks.
- **Fog (integration).** Assert an opponent socket receives no draft values during editing — only
  `OrdersSealed` badges — and the public column only after `OrdersRevealed` (A4 stripping).
- **E2E.** Drag to over-allocate → Lock disabled; rebalance → Lock enabled → `SubmitSealedOrders` →
  ship padlock + ready indicator advances → reveal animation on `OrdersRevealed`.
- **Accessibility.** Keyboard steppers reproduce every drag; status announced non-visually.

## Phasing

- **[v1 AM-tournament]:** complete panel — source pool with battery pips, all standard sink rows
  (movement, phaser capacitor, photon tubes, shields/reinforcement, fire control, EW, tractor,
  transporters, damage control, recharge, misc), drag + slider + stepper + numeric entry, live
  remaining/balance meter with hard-block-on-over / warn-on-under, presets/templates and copy-last-turn,
  secret simultaneous Lock with per-side ready indicator, and the basic mid-turn reserve drawer.
  Tournament's fixed standard-ship roster makes this set complete for v1.
- **[v2]:** fractional-accounting drag granularity and exact capacitor meter (B3.2); AWR-vs-APR
  distinct source chips with movement-gating badges (H4.31); X-ship battery pip capacities (H5.5).
- **[v3 full Master]:** Andromedan specialized EAF layout (extra source pools, power-absorber panels)
  and Vudar ionization-surcharge row with an "ionize energy" toggle (H8.0); Module R1/C2 special-EAF
  panel variants.
