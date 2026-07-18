# Rotating ship-counter icons — design

**Date:** 2026-07-15
**Status:** approved

## Purpose

Replace the current generic ship glyph on the battle map with a **square game counter** bearing a clean
line drawing of the ship it represents. The counter **rotates as a whole** to follow the ship's heading,
the way a physical cardboard counter is turned on the map. The same counter is shown in the verify UI,
and one is generated whenever a new SSD is loaded.

## Decisions

| Question | Decision |
|---|---|
| What the counter depicts | **Clean line drawings** of the ship's top-down shape — not a crop of the SSD raster (explicitly rejected: "not pixelated approximations"). |
| How they're produced | **Hand-drawn per hull class now**, with an **auto-derived vector outline as the fallback** for an unknown new ship. |
| Rotation | The **whole counter rotates** with heading. The ship-id label rides **above it, screen-upright**, so it stays readable at every facing. |
| Provenance | The drawings are **original art** (generic top-down forms), not traced from ADB's SSD artwork; the fallback outline is derived from already-committed box coordinates. Nothing here is ADB raster art, so all of it is committable. |

## Hull classes

Four drawings cover the whole current roster:

| class | ships | shape |
|---|---|---|
| `fed-cruiser` | FED-CA, FED-CL, FED-NCL | saucer + engineering hull + two nacelles |
| `klingon-d7` | KLI-D7, ROM-KR (the KR flies a D7-family hull) | command bulb + neck + swept wings + nacelles |
| `gorn-ca` | GOR-CA | broad hull + side nacelles |
| `kzinti-cs` | KZIN-CS | central hull + wing/drone pods |

Each drawing points **forward = up (−Y)** so a single rotation maps drawing-forward to ship-facing.

## Components

**`ssd-pipeline/viewer/ship-counter.js`** — pure, unit-tested. No DOM.
- `COUNTER_CLASS` — ship code → hull class map.
- `counterClassFor(code)` → class name, or `null` when the ship is unknown (triggers the fallback).
- `counterOutlineFromBoxes(boxes)` → a clean vector outline (polygon points) for the fallback: the
  concave outline of the ship-body box cluster, with the shield rows and off-ship tables excluded.
- `counterAngle(facing)` → the rotation in degrees for a facing, so the map and the verify preview
  agree on orientation.

**Art:** `ssd-pipeline/viewer/counters/<class>.svg` — one line drawing per hull class, drawn on a square
viewBox, forward = up, stroked in `currentColor` so the host can tint it per fleet.

**Battle map** (`battle.html` / `battle-map.js`): render each ship as a rounded square counter —
fleet-coloured frame, the hull drawing centred and tinted, the whole group rotated by `counterAngle`.
The existing selection, health, cloak, drag and right-click behaviours are preserved; the ship-id label
is emitted as a separate, un-rotated element above the counter.

**Verify UI** (`verify.html`): show the ship's counter as a live preview beside the ship-stats bar, so the
counter is confirmed at verification time. (The SSD's own "CNTR" box is the paper equivalent.)

## Data flow

```
ship code ──> counterClassFor ──┬── known class ──> counters/<class>.svg ──┐
                                │                                          ├──> tint + rotate ──> map / verify
                                └── unknown ─────> counterOutlineFromBoxes ┘
                                                   (verified.json boxes)
```

The fallback runs when a ship is opened in verify with no known class, and its result is saved as that
ship's `counter.svg`, editable afterwards.

## Testing

`ship-counter.test.mjs` covers: the code→class map (including the shared classes: the three Fed cruisers
resolve to one class, KLI-D7 and ROM-KR to another); `counterClassFor` returning `null` for an unknown
code; `counterAngle` mapping each of the six facings to the right degrees; and `counterOutlineFromBoxes`
producing a closed polygon that encloses the ship-body boxes and excludes shield-row boxes.

Rendering is verified in the browser: counters appear on the map, point the right way, and re-orient as a
ship turns.

## Out of scope

- Per-ship art variation within a hull class (the three Fed cruisers share one drawing).
- Editing the drawings in the UI. The fallback outline is editable data; the hand-drawn art is a file.
