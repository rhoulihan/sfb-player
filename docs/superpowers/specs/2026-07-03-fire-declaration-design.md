# Direct-Fire Declaration — Fire Groups & Attack Plan (client prototype)

**Date:** 2026-07-03 · **Status:** design (approved for spec) · **Phase:** prototype (pre-engine)

## Purpose & Scope

A standalone, client-side prototype of the SFB direct-fire **declaration** step (the part of
Segment 6D where a commander decides what fires at what). On a hex mapboard showing two fleets,
the player:

1. selects one or more of their own ships to form a **fire group**,
2. picks an enemy ship as that group's **target**,
3. pages through the group's ships and selects/deselects which of each ship's **in-arc weapons**
   fire — the weapons that *bear on the target* auto-highlight from the target's position,
4. builds up **one or more fire groups** into an **attack plan**, and
5. **commits** the plan — which seals it and shows a per-target **combined-damage preview**.

It stops at declaration. There are **no to-hit rolls, no damage application, and no multiplayer
server** — those arrive when this is wired into the impulse engine (`C1`/`C4`). The whole point of
building it now is the *interaction and data model*; both are shaped so a committed plan expands
directly into C4's `FireIntent`/`SubmitSealedOrders` with no rework.

Built in the existing static-HTML/vanilla-JS style as **`ssd-pipeline/viewer/battle.html`**,
evolving the existing `docs/spec/wireframes/battle-screen.html` mockup and reusing the shared
`arc-geom.js` (arc membership) plus each ship's **verified** SSD data (real weapon arcs + shields).

## Rulebook References (mechanics summarized; no rules text reproduced)

- **Declaration window:** direct fire is declared in Segment **6D**, *secret & simultaneous*
  (B2.4) — everyone commits hidden orders, then all reveal together.
- **Simultaneity:** the fire list is frozen before resolution; a ship killed this impulse still
  fires (E1.13). *(Relevant to the future engine; the prototype only produces the frozen list.)*
- **Firing arcs:** six 60° base arcs (LF, RF, R, L, RR, LR) and combined codes (FA/FX/RA/RX/RS/LS…),
  with on-boundary hexes counting in-arc (D2.0–D2.2).
- **Shields:** six fixed facings, **#1 = front**; the struck facing is the one the firer→target
  center line crosses (D3.1, D3.4/D3.402).
- **Combined fire:** when several ships strike the **same enemy shield in the same impulse**, their
  damage stacks into one volley through that shield (D4.34) — the rules basis for the fire-group
  combined-damage preview.
- **Range:** true range measured in hexes (D1.4). Overload/energy economy is out of scope here.

## Domain Model

Client-side, in-memory only (no persistence in the prototype). Coordinates and geometry come from
the map; ship loadouts come from the verified SSD data.

```ts
type Side = 'friendly' | 'enemy';
type Facing = 0 | 1 | 2 | 3 | 4 | 5;          // the 6 hex directions; exact orientation matches the map geometry
type ShieldFacing = 1 | 2 | 3 | 4 | 5 | 6;    // #1 = front

interface PlacedShip {
  id: string;                 // scenario-unique, e.g. 'F1'
  code: string;               // ship code, e.g. 'FED-CA' (keys the verified data)
  name: string;
  side: Side;
  q: number; r: number;       // hex position
  facing: Facing;
  shields: number[];          // [s1..s6] current box counts (from verified shield groups)
  weapons: Weapon[];          // derived from verified weapon-family groups
}

interface Weapon {
  id: string;                 // ship-unique, e.g. 'F1.disr.0'
  cls: string;                // weapon class label, e.g. 'PH-1','DISR','PHOTON'
  arc: ArcDef;                // the verified arc (base/combined/painted) — fed to arc-geom.js
  maxRange: number;           // prototype per-class default (see MAX_RANGE)
  count: number;              // mounts represented by this weapon row (from box count)
}

// ---- fire-group / attack-plan state ----
interface FireGroupMember { shipId: string; weaponIds: string[]; }   // selected weapons (subset of in-arc)
interface FireGroup { id: string; targetShipId: string | null; members: FireGroupMember[]; }
interface AttackPlan { groups: FireGroup[]; committed: boolean; }

// ---- derived, per (weapon, target) — recomputed whenever the target or geometry changes ----
interface WeaponEligibility {
  weaponId: string;
  inArc: boolean; coveringArc?: string;   // which base wedge satisfied it (D2.1)
  trueRange: number; inRange: boolean;
  available: boolean;                     // inArc && inRange
  struckShield?: ShieldFacing;            // if available, the facing this firer would strike
}

// ---- combined-damage preview (D4.34), per target ----
interface TargetPreview {
  targetShipId: string;
  perShield: { shield: ShieldFacing; nominalDamage: number; firers: string[] }[];  // stacked
  shieldStrength: number[];               // public shield boxes on each struck facing
  totalNominal: number;                   // sum across firers (pre-shield, nominal)
}
```

**Selection invariants**
- A weapon can be selected only when `available` (in-arc **and** in-range). Out-of-arc / out-of-range
  weapons render disabled and cannot be toggled on.
- A ship belongs to **at most one fire group** (targets one enemy per plan). True split-fire (one
  ship's weapons across two targets) is a deliberate later refinement, not in this prototype.
- On targeting, every `available` weapon starts **selected** (on-by-default); the player deselects to
  hold. Changing a group's target recomputes availability and re-defaults the selection.

## Data Source & Scenario

Each `PlacedShip` is hydrated from that ship's verified SSD data — the same `verified.json` the
damage processor already consumes:

- **Weapons:** each verified group whose family is a weapon system becomes a `Weapon` row —
  `cls` from the family, `arc` from the group's `arcDef`, `count` from the group's box count.
- **Shields:** the six shield-family groups give the `shields[]` box counts.

A **scenario** is a small JSON literal listing `{ id, code, side, q, r, facing }` per ship; v0 ships a
fixed ~2-v-2 (e.g. `FED-CA` + `FED-DD` vs `KLI-D7` + `KLI-F5`). The loadout adapter is:

```ts
function shipLoadout(verified, detection): { weapons: Weapon[]; shields: number[] };
```

Weapon **max ranges** are a prototype placeholder until the real per-instance ranges are imported
from the C4 catalog:

```ts
const MAX_RANGE: Record<string, number> = {   // placeholder — replaced by C4 catalog import
  'PH-1': 25, 'PH-2': 15, 'PH-3': 8, 'PH-4': 4,
  'DISR': 30, 'PHOTON': 30, 'ADD': 12, 'FUSION': 8, 'HELLBORE': 30,
  default: 20,
};
```

## Screen Layout (four regions over the map — evolves `battle-screen.html`)

- **(A) Fleet & fire-group rail (left).** My fleet listed; below it the current attack plan as a list
  of fire groups, each showing its target and member ships. Selecting a group makes it the working
  group; a "＋ New fire group" affordance starts an empty one.
- **(B) Battle map (center).** Hex grid, both fleets drawn with facing pips. The working group's ships
  are highlighted; each fire group is color-keyed, with a thin line-of-fire from each member to its
  target. For the **active ship**, the selected weapons' **arc wedges** are shaded and the **exposed
  enemy shield** on the target is highlighted with its current strength. Click a friendly ship to add/
  remove it from the working group; click an enemy to set the working group's target.
- **(C) Weapon panel (right).** The **active ship** of the working group, with **◀ / ▶ paging** across
  the group's ships. One row per weapon: name · arc badge · true range · an eligibility pill
  (`in-arc` / `out-of-arc` / `out-of-range`) · a toggle. In-arc weapons are highlighted and toggled on
  by default; disabled rows can't be selected. A "→ shield #N" tag shows what each in-arc weapon would
  strike.
- **(D) Attack-plan tray (bottom).** Per fire group: target, member/weapon counts, and the
  **combined-damage preview** — for each struck shield, the stacked nominal damage and which ships
  contribute (D4.34), against that shield's public strength. A **"Commit attack plan"** button seals
  the plan (and a "Clear" to start over). After commit, the tray switches to a read-only sealed view.

## Interaction Flow

1. **Load** the scenario; hydrate every ship's loadout from verified data; render map + fleets.
2. **Select firers** — click ≥1 friendly ship → working `FireGroup.members` (no target yet).
3. **Target** — click an enemy → `targetShipId`. Recompute `WeaponEligibility` for every member ship's
   weapons against the target; auto-select all `available` weapons; paint arcs + exposed shield.
4. **Refine** — page through member ships (◀/▶), toggle weapons on/off; the map + preview update live.
5. **Repeat** — "＋ New fire group", select other ships, target another enemy. Groups coexist.
6. **Commit** — validate (≥1 group with ≥1 selected weapon), seal the `AttackPlan`, freeze the preview.

## Engine / API (pure functions, unit-testable, no DOM)

Geometry mirrors the mockup (flat-top hexes, odd-q offset); arc membership reuses the shared engine.

```ts
function hexCenter(q, r): { x, y };
function hexDistance(a, b): number;                          // true range in hexes (D1.4)
function bearingDeg(fromHex, toHex): number;                 // 0..360 in map frame

// arc membership — generalizes the mockup's "forward hemisphere" to real arcs via arc-geom.js
function isInArc(firer: PlacedShip, weapon: Weapon, target: PlacedShip):
  { inArc: boolean; covering?: string };                     // bearing→ship-local→arcCoversBearing (D2.0–D2.2)

function exposedShield(firer: PlacedShip, target: PlacedShip): ShieldFacing;   // firer→target line-cross (D3.402)

function weaponEligibility(firer, weapon, target): WeaponEligibility;          // inArc && inRange (+ struckShield)
function groupEligibility(group: FireGroup, ships): Map<weaponId, WeaponEligibility>;

function combinedPreview(group: FireGroup, ships): TargetPreview;              // stack by struck shield (D4.34)

// forward-integration shape (not called in the prototype, but asserted by a test)
function expandPlanToIntents(plan: AttackPlan): FireIntent[];                  // one per selected weapon → C4
```

`isInArc` converts the firer→target map bearing into the ship's local frame (subtract facing) and
calls `arc-geom.js`'s `arcCoversBearing(weapon.arc, localBearing)` — the exact predicate the verify
editor and damage engine already use, so arcs are consistent across the app.

## Validation & Rules Enforced (now)

- **Arc/range gate:** only `available` weapons are selectable; the pill states the reason otherwise.
- **One-group-per-ship:** adding a ship already in another group moves it (with a confirm) or is blocked
  — the prototype **blocks** and flags it, keeping the model simple.
- **Commit precondition:** at least one fire group with a target and ≥1 selected weapon.
- **Public data only:** the preview uses public shield strength; it never asserts internal/penetration
  results (consistent with fog-of-war in the real engine, though the prototype is single-player).
- **Nominal, not rolled:** preview damage is the weapon's *nominal* value at that range (a fixed
  per-class figure for the prototype), explicitly labelled "nominal (pre-roll)" so it is never mistaken
  for a resolved result.

## Combined-Damage Preview (D4.34)

For a group, compute each selected weapon's `struckShield` and nominal damage, then **sum by struck
shield** across all firers in the group. The tray shows, per struck facing: stacked nominal total, the
contributing ships, and the facing's public strength — surfacing the "concentrate fire to overwhelm one
shield" decision the combined-volley rule rewards. No dice, no allocation.

## Mapping to C4 (why this isn't throwaway)

`expandPlanToIntents(plan)` turns each selected `(shipId, weaponId, group.targetShipId)` into a C4
`FireIntent { firerShipId, weaponInstanceId, targetRef:{kind:'unit',unitId}, segment:'6D-direct' }`;
the full plan becomes the `intents[]` of a future `SubmitSealedOrders`. The prototype's
`isInArc`/`exposedShield`/`hexDistance` are the same predicates C4/D5 specify, so when the impulse
engine lands, resolution consumes this plan directly.

## Out of Scope (deferred to the impulse-engine integration)

To-hit rolls and damage application; the authoritative server, multiplayer, and sealed-simultaneous
reveal; energy/arming/overload/hold economy; movement and the impulse clock (ships sit in a fixed
scenario); EW/ECM effective-range and lock-on; seeking weapons; true per-ship weapon ranges (placeholder
table until the C4 catalog import); split-fire (one ship across two targets).

## Edge Cases & Open Questions

- **Weapon count vs mounts.** A verified weapon *group* may represent several mounts; the prototype
  treats one group as one `Weapon` row with a `count`. Whether the player selects per-mount is deferred
  (row-level toggle only for now).
- **Ambiguous struck shield (hexside).** When the firer→target line runs along a hexside (D3.41), the
  prototype picks the lower-numbered candidate facing and tags it "≈"; the real defender-chooses rule
  (D3.43) is an engine concern.
- **Ships stacked in one hex / adjacent range 0.** Range clamps to a minimum of 1 hex for arc/preview
  purposes (matches the mockup); range-0 special cases are an engine concern.
- **No verified data for a scenario ship.** If a ship code lacks `verified.json`, it can't be fielded —
  the loader flags it (consistent with "a ship isn't fielded until its audit is clean").
- **Arc frame.** Verified arcs are stored in the ship's local frame (0° = front); the map bearing must
  be de-rotated by `facing` before the arc test — covered by a dedicated unit test.

## Testing (Node `--test`, pure functions; no DOM)

- **Arc membership:** for a ring of target hexes around a firer at each of the 6 facings, assert
  `isInArc` matches `arc-geom.js` for base arcs and a combined code; assert on-boundary hexes register
  in-arc (D2.1).
- **Exposed shield:** table-driven firer/target/facing cases assert the crossed facing (#1 front, going
  clockwise); include a hexside case asserting the documented tie pick.
- **Eligibility:** a weapon just inside vs just outside its `maxRange` flips `inRange`; an out-of-arc
  weapon is never `available`.
- **Auto-select + defaults:** setting a target selects exactly the `available` weapons; retargeting
  re-defaults; deselect persists until retarget.
- **One-group-per-ship:** adding a ship already grouped is blocked.
- **Combined preview (D4.34):** two firers whose lines strike the same facing sum on that facing; a
  third striking a different facing lists separately.
- **C4 mapping:** `expandPlanToIntents` emits one intent per selected weapon with the right
  `firerShipId`/`weaponInstanceId`/`targetRef` and `segment:'6D-direct'`.

## Phasing

- **v0 (this build):** `battle.html` + fixed 2-v-2 scenario from verified ships, fire-group formation,
  target-driven weapon auto-highlight with paged select/deselect, multi-group attack plan, commit +
  combined-damage preview, the pure engine (`fire-plan.js`) + unit tests, and `expandPlanToIntents`.
- **v1 (engine integration):** replace the fixed scenario with live map/movement state, submit the plan
  through C1's 6D sealed gate, resolve via C4, hand scored hits to the DAC damage engine.
- **later:** split-fire, energy/overload economy, per-instance ranges, EW/lock-on, seeking-weapon launch.
