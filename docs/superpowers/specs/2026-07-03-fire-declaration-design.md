# Direct-Fire Combat Sandbox — Fire Groups, Attack Plans & Damage

**Date:** 2026-07-03 · **Status:** design (in review) · **Phase:** prototype (pre-server)

## Purpose & Scope

A standalone, client-side **direct-fire combat sandbox** — no server. On a hex mapboard the player
can freely **reposition and re-face both fleets' ships** to test firing geometry, then run the full
direct-fire declaration → resolution → damage loop:

1. **Reposition** — drag any ship to a new hex and rotate its facing; arcs/ranges/exposed-shields
   recompute live, so you can probe different angles.
2. **Form fire groups** — select one or more friendly ships and pick an enemy **target**.
3. **Select weapons per mount** — page through the group's ships; each ship's individual weapon
   **mounts** that *bear on the target* auto-highlight (in-arc + in-range from the target's position),
   and you toggle exactly which mounts fire. A ship may appear in **several fire groups** (split-fire):
   a mount already committed to another group is **marked**, and selecting it prompts a confirm to
   reassign it.
4. **Commit the attack plan** — seal the groups; see a per-target combined-damage **preview** (D4.34).
5. **Resolve** — roll each committed mount against its weapon chart, stack hits by struck shield into
   volleys, and apply them through the **existing DAC damage engine** to the targets. Damage shows on
   each target (shields down, systems destroyed).

The four **standard races** (Federation, Klingon, Kzinti, Gorn) and their **direct-fire** weapons are
covered: **Phaser-1, Phaser-2, Phaser-3, Disruptor, Photon torpedo**. (Plasma and drones are *seeking*
weapons — out of scope.) There is still **no server, no multiplayer, no movement/energy/impulse
economy** — those arrive with the impulse engine. The data model mirrors C4 (`weaponInstanceId`,
`FireIntent`, `SubmitSealedOrders`) so this drops into the authoritative engine later.

Built in the existing static-HTML/vanilla-JS style as **`ssd-pipeline/viewer/battle.html`**, reusing
`arc-geom.js` (arcs), `ship-model.js` + `dac-allocator.js` (the DAC damage engine already validated
against the D4.5 worked example), and each ship's **verified** SSD data (weapon mounts + arcs +
shields).

## Rulebook References (mechanics summarized; **no rules text or chart numbers reproduced here**)

- **Firing arcs** — six 60° base arcs + combined codes; on-boundary hexes count in-arc (D2.0–D2.2).
- **Shields** — six fixed facings, **#1 = front**; the struck facing is the one the firer→target
  center line crosses (D3.1, D3.4/D3.402).
- **Combined fire** — several firers striking one shield in one impulse stack into one volley (D4.34).
- **Direct-fire resolution models** — range-of-effect phasers (die-vs-range → variable points, E1.822);
  hit-or-miss bolts — disruptor (chart E3.4), photon (chart E4.12, min true range 2, E4.14).
- **Damage allocation** — shields → armor → internal DAC exactly as the built engine already does
  (D3.6–D4.4); combined volleys per D4.34.
- **Range** — true range in hexes (D1.4). Overload/proximity modes are a near-term add (see Phasing).

## Weapon Catalog & Charts (`weapon-charts.js`)

A committed data module holding the five direct-fire weapon definitions and their numeric charts,
**transcribed from owned material and treated exactly like the existing `dac.js`** — functional
game-mechanics data, not artwork or rules prose (`.gitignore` excludes only images + rules text).
The actual chart numbers live only in that module, never in this design doc.

```ts
type Resolution = 'range-of-effect' | 'hit-or-miss';
interface WeaponDef {
  cls: 'PH-1'|'PH-2'|'PH-3'|'DISR'|'PHOTON';
  resolution: Resolution;
  maxRange: number;            // true-range max
  minRange?: number;           // photon = 2 (E4.14)
  dieSize: 1;                  // all five roll 1d6
  // range-of-effect (phasers): effectGrid[die-1][bandIdx] → points; bands: RangeBand[]
  // hit-or-miss (disr/photon): per band → hit test + fixed damage
  chart: WeaponChart;          // shape mirrors C4's WeaponChart; numbers loaded from data
}
```

`resolveMount` (below) branches on `resolution`: **range-of-effect** rolls 1d6 and reads the
die×range cell for its points (always contributes); **hit-or-miss** rolls 1d6, hits if within the
band's hit test and then contributes its fixed warhead, else contributes 0. EW/ECM die-shift,
overload, and small-target ECM are **not** applied in v0 (flagged in Phasing).

## Domain Model

Client-side, in-memory. Geometry from the map; loadouts from verified SSD data.

```ts
type Side = 'friendly' | 'enemy';
type Facing = 0|1|2|3|4|5;                 // 6 hex directions; orientation matches map geometry
type ShieldFacing = 1|2|3|4|5|6;           // #1 = front

interface WeaponMount {                     // the selectable, individually-firable unit (≈ C4 weaponInstanceId)
  id: string;                               // ship-unique, e.g. 'F1.PH-1.2'
  cls: WeaponDef['cls'];
  arc: ArcDef;                              // verified arc for this mount's group → arc-geom.js
}
interface PlacedShip {
  id: string; code: string; name: string; side: Side;
  q: number; r: number; facing: Facing;     // editable via drag + rotate
  shields: number[];                        // [s1..s6] current boxes (from verified shield groups)
  mounts: WeaponMount[];                     // expanded from verified weapon groups (one per box/mount)
  model?: ShipModel;                         // lazy buildShipModel() for damage resolution
  status?: Record<string,'destroyed'>;       // set by resolution (DAC)
}

interface FireGroupMember { shipId: string; mountIds: string[]; }   // selected mounts (subset that bear)
interface FireGroup { id: string; color: string; targetShipId: string|null; members: FireGroupMember[]; }
interface AttackPlan { groups: FireGroup[]; committed: boolean; }

interface MountEligibility {                 // per (mount, target), recomputed on any geometry change
  mountId: string;
  inArc: boolean; coveringArc?: string;
  trueRange: number; inRange: boolean;
  available: boolean;                        // inArc && inRange
  struckShield?: ShieldFacing;
  assignedGroupId?: string;                  // set if this mount is committed to some fire group
}
```

**Exclusivity & split-fire (revised).** A **mount** belongs to at most one fire group (a mount fires
at one target). A **ship** may belong to **several** groups — different mounts at different targets
(split-fire). When selecting mounts for group B, any mount already assigned to group A shows
`assignedGroupId = A` and is **marked, not auto-selected**; toggling it on prompts a confirm and, on
accept, **reassigns** it from A to B.

**On-target defaults.** Setting a group's target auto-selects that group's members' mounts that are
`available` **and** unassigned; already-assigned mounts stay marked. Retargeting recomputes and
re-defaults.

## Data Source & Scenario

Each ship is hydrated from its `verified.json` (the same data the damage processor uses): weapon
groups → `mounts` (one mount per box, `cls` from family, `arc` from the group's `arcDef`); shield
groups → `shields[]`; and `buildShipModel(verified, detection)` lazily builds the DAC model used at
resolution. A **scenario** is a small JSON literal (`{id, code, side, q, r, facing}` per ship); v0
ships a fixed ~2-v-2 (e.g. `FED-CA` + `GOR-DD` vs `KLI-D7` + `KZI-FF`) but every ship is drag/rotate
editable, so the player builds any geometry.

## Screen Layout (four regions over the map — evolves `battle-screen.html`)

- **(A) Fleet & fire-group rail (left).** Both fleets; below, the attack plan as color-keyed fire
  groups (target + member ships). Select a group to make it the working group; "＋ New fire group".
- **(B) Battle map (center).** Hex grid; every ship a token with a facing pip, **drag to move / rotate
  handle to re-face** (either fleet). Working group highlighted; each group color-keyed with lines of
  fire to its target. For the **active ship**, selected mounts' **arc wedges** shade and the **exposed
  target shield** highlights with its strength. Click friendly = add/remove from working group; click
  enemy = set working group's target.
- **(C) Weapon-mount panel (right).** The **active ship** with **◀/▶ paging** across the group's ships.
  One row **per mount**: type · arc badge · true range · eligibility pill (`in-arc`/`out-of-arc`/
  `out-of-range`) · a **cross-group tag** (`→ Group B`) if committed elsewhere · a toggle. In-arc
  unassigned mounts highlight and default on; out-of-arc disabled; assigned-elsewhere marked (toggling
  → confirm-and-steal). A "→ shield #N" tag per bearing mount.
- **(D) Attack-plan tray (bottom).** Per group: target, mount count, and the **combined-damage
  preview** — per struck shield, stacked **nominal (pre-roll)** total + contributing ships, vs the
  facing's strength (D4.34). **"Commit attack plan"** seals it; **"Resolve"** then rolls + applies
  damage; a **combat log** lists per-mount rolls, per-volley allocation, and destroyed systems, and a
  target can be opened to its SSD (reusing the damage-view render) to inspect applied damage.

## Interaction Flow

1. Load scenario; hydrate loadouts; render map + fleets.
2. (Any time) **Reposition**: drag / rotate ships; all eligibility, arcs, previews recompute live.
3. **Form group**: click ≥1 friendly → working group.
4. **Target**: click enemy → recompute `MountEligibility`; auto-select available+unassigned mounts.
5. **Refine per mount**: page ships, toggle mounts; stealing a mount from another group confirms first.
6. **More groups**: "＋ New fire group", repeat; a ship may recur across groups (different mounts).
7. **Commit**: validate (≥1 group, target, ≥1 mount); seal; freeze preview.
8. **Resolve**: roll each committed mount; stack by (target, struck shield) into volleys; `applyVolley`
   through the DAC engine per target; render damage + log.

## Engine / API (pure functions, unit-testable, no DOM)

```ts
// geometry (flat-top hexes, odd-q offset — matches the mockup)
function hexCenter(q,r): {x,y}; function hexDistance(a,b): number; function bearingDeg(from,to): number;

// arcs / shields — reuse the shared engine
function isInArc(firer: PlacedShip, mount: WeaponMount, target: PlacedShip): {inArc:boolean; covering?:string};
function exposedShield(firer: PlacedShip, target: PlacedShip): ShieldFacing;          // D3.402 line-cross

// declaration
function mountEligibility(firer, mount, target, def): MountEligibility;
function planEligibility(plan, ships, defs): Map<mountId, MountEligibility>;           // includes assignedGroupId
function assignMount(plan, groupId, shipId, mountId): {plan; conflict?: {fromGroupId}}; // steal → conflict for confirm
function combinedPreview(group, ships, defs): TargetPreview;                            // nominal, stacked by shield (D4.34)

// resolution + damage
function makeDice(seed): DiceFn;                                                        // reuse dac-allocator.makeDice
function resolveMount(firer, mount, target, def, dice): ScoredHit;                      // {hit, points, struckShield}
function resolveAttackPlan(plan, ships, defs, dice): ResolveResult;                     // → per (target,shield) volleys
//   for each volley: applyVolley(target.model, {shield, points,...}, dice)  (existing DAC engine)

// forward-integration (asserted by a test, not used in the prototype)
function expandPlanToIntents(plan): FireIntent[];                                       // one per committed mount → C4
```

`isInArc` de-rotates the map bearing by the ship's `facing` into the ship-local frame and calls
`arc-geom.js`'s `arcCoversBearing(mount.arc, localBearing)` — the same predicate the verify editor and
damage engine use. `resolveAttackPlan` groups every committed mount's `ScoredHit` by
`(targetShipId, struckShield)`, sums points per shield (D4.34), and applies each as one `applyVolley`
against that target's `ShipModel`, collecting destroyed boxes into `PlacedShip.status`.

## Validation & Rules Enforced

- **Arc/range gate:** only `available` mounts are selectable; the pill states the reason otherwise.
- **Mount exclusivity + split-fire:** a mount lives in one group; a ship may span groups; stealing a
  mount requires an explicit confirm and moves it (never silently duplicates fire).
- **Commit precondition:** ≥1 group with a target and ≥1 committed mount.
- **Resolution faithfulness:** per-mount rolls use the weapon chart at true range; combined volleys
  follow D4.34; allocation is the existing, D4.5-validated DAC engine — no bespoke damage math.
- **Nominal vs rolled:** the tray preview is nominal (pre-roll) and labelled as such; only **Resolve**
  produces rolled, allocated damage.
- **Public data:** the preview reads public shield strength only (no reinforcement/internals), keeping
  parity with the future fog-of-war engine even though the sandbox is single-viewer.

## Mapping to C4 (why this isn't throwaway)

Each committed `WeaponMount` is a C4 `weaponInstanceId`; `expandPlanToIntents` emits one
`FireIntent {firerShipId, weaponInstanceId, targetRef:{kind:'unit'}, segment:'6D-direct'}` per mount,
and the plan becomes a future `SubmitSealedOrders.intents[]`. `isInArc`/`exposedShield`/`resolveMount`
are the same predicates/model C4 specifies, so the impulse engine consumes this directly later.

## Out of Scope (deferred to the impulse-engine integration)

Server / multiplayer / sealed-simultaneous reveal; the impulse clock and movement (ships are placed and
hand-repositioned, not moved by orders); energy/arming economy and overload/proximity **modes** (near-
term toggle, see Phasing); EW/ECM die-shift, lock-on, small-target ECM; seeking weapons (plasma,
drones) and anti-drones; per-instance disruptor max-range table (a per-class default until imported).

## Edge Cases & Open Questions

- **Mount count vs boxes.** One mount per weapon-group box; if a system's box count ≠ its mount count
  for some ship, that ship's loadout adapter needs a per-code override (flagged at load).
- **Ambiguous struck shield (hexside).** Firer→target along a hexside (D3.41): pick the lower-numbered
  candidate and tag "≈"; the true defender-chooses rule (D3.43) is an engine concern.
- **Same/adjacent hex.** Range clamps to a minimum of 1 for arc/preview/resolution (matches mockup).
- **Missing verified data.** A scenario ship lacking `verified.json` can't be fielded (flagged), same
  rule as the rest of the app.
- **Repositioning after commit.** Committing locks the plan; moving a ship afterward warns and
  clears/invalidates affected groups rather than silently resolving stale geometry.
- **Photon min range (E4.14).** A photon inside its minimum true range is `out-of-range` (not merely
  weaker), consistent with the rule.

## Testing (Node `--test`, pure functions; no DOM)

- **Arc membership:** ring of targets at each of 6 facings matches `arc-geom.js` for base + a combined
  code; on-boundary hexes register in-arc (D2.1).
- **Exposed shield:** table-driven firer/target/facing → crossed facing (#1 front, clockwise); a
  hexside case asserts the documented tie pick.
- **Eligibility:** a mount just inside vs outside `maxRange` flips `inRange`; photon below `minRange`
  is `out-of-range`; out-of-arc is never `available`.
- **Auto-select + defaults:** targeting selects exactly available+unassigned mounts; retarget
  re-defaults; a mount assigned elsewhere is marked, not auto-selected.
- **Mount exclusivity:** stealing a mount reports a conflict for confirm and, on accept, removes it
  from the prior group.
- **Resolution models:** phaser reads the die×range cell (range-of-effect); disruptor/photon hit only
  within the band and then contribute fixed warhead; misses contribute 0 — asserted against
  `weapon-charts.js` with a seeded die.
- **Combined volley (D4.34):** two firers striking one facing sum into one `applyVolley`; a third on a
  different facing forms a separate volley; allocation matches the DAC engine.
- **C4 mapping:** `expandPlanToIntents` emits one correctly-shaped intent per committed mount.
- **Determinism:** same seed → identical rolls + allocation (reuses the seeded dice service).

## Phasing

- **v0 (this build):** `battle.html` + fixed 2-v-2 scenario; drag/rotate repositioning; fire-group
  formation with per-mount, target-driven selection; multi-group split-fire with cross-group marking +
  confirm-to-steal; commit + nominal preview; **Resolve** rolling the five weapons through
  `weapon-charts.js` and applying damage via the existing DAC engine; combat log + per-target damage
  view; the pure engine modules (`fire-plan.js`, `weapon-charts.js`, `direct-fire.js`) + unit tests;
  `expandPlanToIntents`.
- **near-term:** overload/proximity modes, EW/ECM die-shift + lock-on, per-instance disruptor ranges,
  seeking-weapon launch, more races' direct-fire weapons.
- **v1 (engine integration):** live map/movement/energy state, C1 6D sealed gate, C4 resolution,
  multiplayer.
