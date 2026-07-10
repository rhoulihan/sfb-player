# SFB Player — Backlog (deferred refinements)

Lower-priority polish deferred from completed features. None block normal cruiser play.

## Pending feature (paused mid-request)
- [ ] **Proactive reserve-power allocation during impulse play** (H7 / audit "proactive impulse allocation + queued-at-segment"). The EA panel is read-only during impulse (`if (ui.viewEA) return`). On-hit reactive reinforcement + cloak/plasma reserve use already work; what's missing is: open the EA panel during impulse → allocate reserve/battery to reserve-eligible controls (ECCM H7.33, reinforcement, capacitor E2.33), queued and applied at the appropriate segment (or immediately if current), always confirmed. `reserve-power.js` already lists the eligible systems + costs; reuse the `promptReserveReinforce` modal pattern. Paused to build the EAF layout editor.

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
