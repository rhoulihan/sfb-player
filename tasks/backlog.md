# SFB Player — Backlog (deferred refinements)

Lower-priority polish deferred from completed features. None block normal cruiser play.

## EAF editor refinements
- [ ] **Group-drag** — Rick: "drag the controls for the label as a group OR a specific control in the label set." Today each control drags individually. Add a way to move a related set together (e.g. all 6 shields, or a weapon + its arming controls) — most "labels" are single controls, but grouped drag is the missing half.
- [ ] Extract the EA control CSS to a shared `eaf-panel.css` (currently duplicated: inline in battle.html + copied into verify.html for the editor).
- [ ] Editor polish: snap-to-grid, remove-a-placed-control (drag off the form), new-race art upload.

## Shield overlays
- [ ] **Craft the Klingon (and future-race) shield overlays to match the art's hex shapes/positions precisely.** A basic `kliShieldSvg` is wired (green→red hex by strength + yellow reinforcement glow, like the Fed CA), but the hexagons are approximate — tune the shape/size/orientation to sit exactly on the SSD shield boxes. Ideally derive the shape from the layout, not hardcoded px.

## Reserve energy — done + refinement
- [x] **Proactive reserve-power allocation during impulse play** — an "⚡ Reserve" button on the impulse-phase EA view opens a modal to spend reserve warp / battery on ECCM (H7.33), the phaser capacitor (E2.33), and general/specific reinforcement (D3.341/342), with a warp/battery source toggle; always confirmed, applied on confirm. Verified: 2 ECCM → battery 3/3→1/3.
- [x] **Queue reserve allocations to their applicable segment** — the reserve modal now queues (`s.reserveQueue`) rather than applying immediately; the queue applies at its next applicable segment (before the impulse's fire resolution, or at the impulse boundary). A "⚡ Reserve •" badge marks a pending queue; reopening the modal loads it for adjustment; the on-hit reinforcement modal shows the queued allocation. Verified: queue held the battery at 3/3, stepping applied it → 1/3.

## EAF layout editor — done (`9df9566` + `c3a19b8`)
Data-driven per-race layouts (`data/eaf-layouts/*.json`) + drag-drop editor & control-placement validation in verify.html. Remaining polish: add-race art upload, marker labels legend, snap-to-grid.


## D8 critical hits — refinements
- [ ] **Full D22 energy-balance engine** (Rick-flagged) — incremental/instantaneous/continuous power-loss reallocation (D22.1–D22.6). The warp crit currently uses D8.23's own allowance (cancel movement energy) + halts the ship; the "½ warp output usable for other systems" loss is not yet applied.
- [ ] **Exact DC-track rating from verified.json** — D14 EDR and the D14.11 DC-box sacrifice use a `min(4, intact-DC-boxes)` proxy. Capture the real per-ship DC-track rating in verify.html (verification-owns-ship-data) and read it here.
- [ ] **Shuttle-bay crit specifics (D8.24)** — pick the jammed bay by die roll; jam drone racks *inside* that bay (currently a bay crit just decrements the shuttle-bay count).
- [ ] **Negative-tractor break auction UI (G7.35)** — a held ship spending negative-tractor power to break the link point-for-point. Currently links break only by release, out-of-range, or a tractor crit (`pruneTractors`).
- [ ] **Proper towing movement (G7.21/32/36)** — a tractor link currently locks both ships in place (simplified). Real towing drags the held ship with the tower at a restricted speed.
- [ ] **Passive-FC voluntary-toggle depth** — the FC-PASSIVE toggle applies the D19 fire penalties; deeper effects (reactivation delay D19.26, EM interaction C10.415 beyond the no-EM block) are approximate.
- [ ] **Shield repair split** — D9.21 shield repair vs D9.7 system repair currently is either/or per turn; SFB lets a ship split its damage-control energy between them.
