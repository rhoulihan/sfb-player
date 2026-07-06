# Unified Command Interface — Design Spec (for review)

**Date:** 2026-07-06
**Status:** Draft for discussion — NOT yet approved to build
**Context:** `ssd-pipeline/viewer/battle.html` has grown from a "Direct-Fire Sandbox" into the primary
game interface (energy allocation, movement/course planning, sideslip, autopilot, direct fire). This
spec merges the energy-allocation-phase map and the battle-phase map into **one interactive map** used
in every phase, with behavior gated by phase, and adds map-based fire planning with draggable "ghost"
positions.

---

## 0. Rename

**Decided: the app is named "SFB Player."** Applies to the `<title>` and the header title text
(replacing "Direct-Fire Sandbox").

---

## 1. The unified model (phase-gated)

**Model the real SFB Sequence of Play (B2.2) as the phase state** — a `battle-phase.js` module owning the
8-phase order: (1) Energy Allocation, (2) Speed Determination, (3) Self-Destruction, (4) Sensor Lock-On,
(5) Initial Activity, (6) Impulse Procedure [A Movement · B Activity · C Dogfight · **D Direct-Fire** · E
Post-Combat], (7) Final Activity, (8) Record Keeping. Phases 2–5,7,8 are administrative/auto for now
(instantaneous transitions, no UI); the interactive states are **Energy Allocation (1)** and **Impulse
Procedure (6)** with its **Direct-Fire segment (6D)**. The existing `energy`/`impulse` coarse state maps
onto phases 1 and 6; **direct-fire is segment 6D of the impulse, gated by the `committed` handshake, not a
separate phase** (per review). One map, one interaction layer, features switched by phase:

| Capability | Energy Allocation | Battle (impulse) | Direct-Fire resolve |
|---|---|---|---|
| Route / re-plot from a selected hex | ✅ | ✅ | ❌ |
| Speed-change markers on path hexes | ✅ | ❌ | ❌ |
| Build fire group + pick target on map | ✅ | ✅ (**virtual** only) | — |
| Drag ships → rotatable **ghosts** | ✅ | ✅ | ❌ |
| Ghost positions drive range / arc / nominal damage | ✅ | ✅ | — |
| EAF editable | ✅ (draggable console modal) | ❌ read-only (**right-click → View EA**) | ❌ |
| Fire **commit** | ❌ | ✅ (real fire, current positions) | resolves |
| Autopilot paths shown for selected ships | ✅ | ✅ | — |

Fire-group **summary** moves from the bottom tray to a **floating modal pinned near the target**,
updating live as ghosts move and weapons toggle.

## 2. Interaction model

- **Click friendly ship** → select it: becomes the *route subject* (route anchors at its hex) **and**
  joins the current *fire group*.
- **Click a hex on a friendly ship's own path** → re-anchor the route mapper there, re-plot forward.
- **Click adjacent legal hexes** → extend route (green/red snap); **drag** = sideslip (existing).
- **Allocation only:** click a *path* hex → drop a speed-change marker; click that marked hex again →
  speed-change modal. Disabled in battle.
- **Shift-click enemy ship** → set/replace the fire group's **target**. (Shift-click empty hex still
  measures range.)
- **Drag a fire-group ship or the target** → spawn a **ghost** at the drop hex; ghost is rotatable to
  set facing. Range/arc/nominal-damage recompute from ghost positions.
- **Right-click ship (battle)** → context menu → **View EA** (read-only console modal). Existing
  "View SSD" stays.

## 3. State & data model

- `selectedId` (route subject), `fireGroup: string[]` (friendly ids being planned), `targetId`.
- `ghosts: { [shipId]: { q, r, facing } }` — planned override positions. `null`/absent = use real pos.
- `plan.speedPlot.changes` already exist; add a per-hex marker index so a path hex knows it carries a change.
- **Virtual vs real fire group:** battle-mode map planning writes to a `virtualGroup` that is never
  serialized into the committable `plan.groups`. Allocation-mode planning is inherently non-committing
  (there is no fire commit that phase). The real committable direct-fire path (battle: build group →
  Commit → 6D resolve) is unchanged and uses **real** positions, not ghosts.
- Ghosts persist until: allocation → Lock; battle → the impulse that executes; or manual clear. *(assump.)*

## 4. Engine (pure, testable) — `fire-plan.js` / `direct-fire.js` extensions

- `effectivePos(ship, ghosts)` → ghost position if present else real. All range/arc/nominal callers
  take an optional position resolver so they compute from ghosts when planning.
- Nominal-damage + arc + range recompute against `effectivePos` for firer and target. No new rules,
  just a position-source seam — unit-tested with golden ghost-vs-real vectors.

## 5. UI components

- **Right-pane targeting panel** — **kept collapsed by default; pops out when a target is selected.**
  Lists the fire group's weapons with per-weapon in-arc / in-range state + mode toggles
  (arm/OL/PROX drawn from the EAF), and the target. (Weapon *arming* is set in the EAF; here you pick
  which armed weapons fire and their mode.)
- **Floating summary modal** near the target — live nominal-damage total per shield facing, updates on
  ghost move / weapon toggle. Replaces the bottom tray.
- **EA console modal** — already draggable; in battle it renders read-only (controls disabled).
- **Autopilot path rendering** for selected ships in allocation + battle (reuse the course overlay).

## 6. Phasing (build order)

1. **Extract the map interaction layer into a module + unify map + phase-gating + route-from-selected-hex**
   — pull the map render/geometry/interaction code out of `battle.html` into a focused module
   (`battle-map.js` or similar) with a clean interface; one map component, phase flags, click a
   ship/path-hex to anchor and re-plot. (No fire changes yet.) *[extraction moved up per review]*
2. **Speed-change on path-hex** (allocation) — marker on click, modal on re-click; battle disables it.
3. **Fire group + target selection on the map** — click friendly / shift-click enemy; right-pane panel.
4. **Ghosts** — drag to reposition + rotate; `effectivePos` seam; nominal damage from ghosts (TDD).
5. **Floating summary modal** (replace bottom tray) + finalize right-pane panel.
6. **Battle-mode wiring** — read-only EAF, context-menu View EA, virtual (non-committable) groups,
   autopilot display; keep real fire commit intact.

## 7. Testing

- Engine: `effectivePos` + ghost-based range/arc/nominal (node --test, golden vectors).
- Playwright per phase: route-from-hex, speed-change marker+modal (allocation) / disabled (battle),
  fire-group+target selection, drag→ghost→rotate→nominal recompute, floating summary updates,
  read-only EAF + View-EA context menu (battle), real fire commit still resolves.

## 8. Risks

- Click overload: several gestures on the map; the disambiguation in §2 is the main thing to validate
  early (Phase 1/3) before layering ghosts on top.
- `battle.html` is already very large; this adds significant JS. Consider extracting the map
  interaction layer into a module if it grows unwieldy (revisit after Phase 3).

## 9. Decisions (resolved 2026-07-06)

1. **Name** — ✅ **SFB Player.**
2. **Right pane** — ✅ persistent targeting panel, **collapsed by default, pops out when a target is
   selected**; summary is the separate floating modal near the target.
3. **Battle ghosts vs real fire** — ✅ real committable fire stays as-is on current positions; ghosts are
   a parallel what-if overlay only.
4. **Ghost persistence / clear timing** — ✅ persist until Lock (allocation) / execution (battle) / manual clear.
5. **Slice order** — ✅ §6 order, with the **map-interaction-layer extraction pulled into Phase 1**.
