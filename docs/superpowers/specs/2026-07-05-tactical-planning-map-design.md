# Tactical Planning Map + Draggable EAF Console — Design Spec

**Date:** 2026-07-05
**Status:** Draft for review
**Context:** Replaces the split-screen energy view in `ssd-pipeline/viewer/battle.html` with (a) a
**draggable, race-themed EAF console modal** (over the `assets/Fed_EAF.png` / `assets/Klingon EAF.png`
control-panel art) opened by clicking a ship, and (b) an **interactive tactical planning map** for
range-checking, course plotting, mid-turn speed changes, and autopilot. Builds on the energy engine
(`energy-model.js`), the movement chart (`movement.js`), and hex geometry (`battle-geom.js`).

## Confirmed decisions (from review)

1. The draggable image-modal **replaces** the split-screen energy view.
2. **Plotted** speed changes only for v1; reserve-power (non-plotted) acceleration (C12.24) is deferred.
3. Course plotting **snaps to legal turns** (illegal turns are not selectable).
4. While plotting, **highlight candidate next hexes**: opaque **green** = legal, opaque **red** = illegal.
   The **1-impulse announce delay** (C12.36) is modeled now.

## Rules basis (verified against the Master Rulebook)

- **Speed is plotted; path is free** (C12.12): direction is decided in real time, but the speed at each
  impulse is fixed at Energy Allocation. A course plot is a *planning aid* that yields the speed-change
  impulse schedule + movement energy; it is not itself required.
- **Speed plot = speed-per-impulse schedule** (C12.12 example: imp 1‑16 = Sp 9, 17‑26 = Sp 19, 27‑32 = Sp 14).
- **1-impulse announce delay** (C12.10/C12.36): a change announced *during* impulse K takes effect
  *beginning* impulse K+1.
- **Movement energy = total hexes across all segments** (C12.21).
- **Turn mode is per-speed and changes mid-turn** (C12.11 → C3.44): a slower segment turns more tightly.
- **Segmented move chart**: on impulse *i* the ship moves iff `movesOnImpulse(speedAt(i), i)` — i.e. each
  speed's global Bresenham pattern applies within its segment (validated: Sp 8 imp 1‑9 → 2 hexes,
  Sp 18 imp 10‑32 → 13 hexes = 15 total, matching the C12.10 worked example).

---

## 1. Course-planning engine — `course-plan.js` (new, pure, unit-tested)

Dependency-free ES module beside `movement.js`. No DOM. All rules live here.

```ts
// A speed plot: base speed plus ordered mid-turn changes (announce impulse → effective +1).
interface SpeedPlot { base: number; changes: { announceImpulse: number; speed: number }[] }

// A drawn course: the hex path a ship intends to follow (advisory; autopilot follows it).
interface Course { start: {q,r,facing}; steps: {q,r,facing}[] }   // steps are legal, snapped
```

**Speed schedule (with announce delay):**
- `speedAt(plot, impulse) -> number` — base, overridden by the latest change whose `announceImpulse < impulse` (effective = announce+1).
- `speedSchedule(plot) -> number[32]` — speed on each impulse 1..32.

**Movement chart (segmented):**
- `movesOnImpulseAt(plot, impulse) -> boolean` = `movesOnImpulse(speedAt(plot, impulse), impulse)` (reuses `movement.js`).
- `hexesInPlot(plot) -> number` = count of move-impulses = **movement energy / moveCost** (C12.21).
- `impulseTimeline(plot) -> { impulse, hexIndex }[]` — for each move-impulse, the running hex index (so hex *n* on a path is reached on a known impulse). Drives the on-map impulse labels + autopilot.

**Turn-mode legality (drives the green/red highlight + snap):**
- `legalNextHexes(pos, facing, speed, hexesSinceTurn) -> { hex:{q,r}, facing, legal:boolean }[]` — three
  candidates: straight `neighbor(facing)` (**always legal**), and the two `neighbor(facing±1)` turns
  (**legal iff `hexesSinceTurn >= turnMode(speed)`**). Sharper turns aren't reachable in one hex.
  Green = `legal`, red = not.
- `extendCourse(course, hex, plot) -> { course, hexesSinceTurn }` — appends `hex` if it is a legal next
  hex (else no-op); updates facing (0/±1) and `hexesSinceTurn` (reset to 0 on a turn, else +1). The active
  speed for the turn-mode check comes from the impulse the new hex is reached (`impulseTimeline`).

**Speed-change placement:**
- `setSpeedChange(plot, timeline, atHexIndex, newSpeed) -> SpeedPlot` — the impulse the ship reaches
  `atHexIndex` becomes the `announceImpulse`; the change takes effect the next impulse. Recomputes the
  schedule; the caller re-validates the course forward (turn mode may tighten/loosen).

## 2. Shared state + integration

- Each ship gains `plan.course` (the drawn `Course`) and `plan.speedPlot` (the `SpeedPlot`), stored in
  the shared battle state, **fog-of-war filtered** like the EAF (opponents don't see your course).
- **EAF ⇄ plot:** `hexesInPlot(speedPlot) * moveCost` fills "Energy for Movement" (read-only-derived when a
  plot exists; still hand-editable when there's no plot — a constant-speed default).
- **`speedAt(plot, impulse)`** drives `stepImpulse`: on each impulse the ship's current speed follows the
  schedule, so plotted speed changes fire on their locked impulses **regardless of the actual path taken**.

## 3. Map plotting UI (on the existing SVG map, impulse phase)

- **Select-to-plot:** click a ship → it becomes the plotting subject; its start hex/facing anchor the course.
- **Green/red candidates:** the three `legalNextHexes` are drawn as opaque green (legal) / red (illegal)
  hex fills; clicking a green one extends the course (snap). Red are shown for feedback, not clickable.
- **Course rendering:** the path draws as a line with a **hex-index / impulse label** at each step (from
  `impulseTimeline`), and a **▸speed marker** where a change is set.
- **Speed change:** click a plotted hex → small popover to set the segment's new speed → `setSpeedChange`
  → the path (and green/red candidates beyond it) recompute; the EAF movement energy updates.
- **Range tool:** shift-click (or a mode toggle) two hexes → shows `hexDistance` between them; optional
  range ring around the selected ship.
- **Autopilot:** a per-ship toggle stores the course + speed plot as the ship's auto-course. When on,
  `stepImpulse` auto-moves the ship along the course and auto-executes queued turns; it can be toggled
  off before or after any impulse's movement (C12: path is never binding, only the speed schedule is).

## 4. Draggable EAF console modal

- Clicking a ship (in a dedicated "energy" affordance, or during the energy phase) opens its EAF as a
  **draggable modal** whose background is the race console art (`Fed_EAF.png` / `Klingon_EAF.png`).
- The current 21-line controls are re-laid as an **overlay grid positioned over the art's display zones**
  (weapons left, power right, systems bottom, shields/tactical center — the shared region map the art was
  generated to). Controls: the same sliders/toggles/segmented + heavy-weapon arm/OL/PROX, the balance
  meter, and **Lock**. Coordinates are set as CSS `%` offsets calibrated per image (an implementation step).
- The modal is repositionable (drag by its title bar) so the map stays usable behind it; multiple ships'
  consoles can't overlap-lock (one at a time is fine for v1).
- Assets: rename `Klingon EAF.png` → `Klingon_EAF.png` (no space for URLs); both PNGs are large and stay
  **gitignored** like the SSD images (provided locally under `assets/`, served by `serve.py`).

## 5. Phasing (each independently testable)

1. **`course-plan.js` + tests** — schedule/announce-delay, segmented hex count vs the C12.10 example,
   `legalNextHexes` per speed/turn-mode, `impulseTimeline`, `setSpeedChange`.
2. **Map plotting + range** — select-to-plot, green/red candidates, snap, course + impulse labels, range tool.
3. **Speed changes + energy feedback** — speed markers, `setSpeedChange`, EAF movement energy from the plot,
   the 1-impulse announce delay in `stepImpulse`.
4. **Autopilot** — auto-follow + toggle; speed schedule drives speed even off-course.
5. **Draggable EAF console modal** — image backgrounds, overlay control layout per race, drag, replaces split-screen.

## 6. Testing

- `course-plan.test.mjs`: `speedAt` honors the +1 delay; `hexesInPlot` = 15 for the C12.10 plot
  (Sp 8→18 on imp 9); `legalNextHexes` returns straight-legal always and turns legal only at/after turn
  mode; `impulseTimeline` maps hex 2 → impulse 8 (Sp 8) etc.; `setSpeedChange` places the announce impulse
  and recomputes.
- Playwright: plot a course (green/red snap), set a mid-turn speed change (path + energy recompute),
  enable autopilot and step a turn (ship follows the plot; speed changes on the locked impulses), open the
  race console modal and drag it while the map stays live.

## 7. Open / calibration

- **Overlay coordinate calibration** per console image (place control zones over the art's screens) — a
  visual pass once the modal shell exists.
- **Turn-mode on the very first move of a segment** — `hexesSinceTurn` seeds at `turnMode(speed)` so a
  ship may turn on entry (SFB momentum); re-confirm when the segment speed drops mid-plot.
- **Autopilot vs. manual mid-turn** — if a player steers off the autopilot course, the speed schedule
  still governs (rules-correct); the drawn course is advisory only.
