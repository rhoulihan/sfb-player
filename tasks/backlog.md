# SFB Player — Backlog (deferred refinements)

Lower-priority polish deferred from completed features. None block normal cruiser play.

## D8 critical hits — refinements
- [ ] **Full D22 energy-balance engine** (Rick-flagged) — incremental/instantaneous/continuous power-loss reallocation (D22.1–D22.6). The warp crit currently uses D8.23's own allowance (cancel movement energy) + halts the ship; the "½ warp output usable for other systems" loss is not yet applied.
- [ ] **Exact DC-track rating from verified.json** — D14 EDR and the D14.11 DC-box sacrifice use a `min(4, intact-DC-boxes)` proxy. Capture the real per-ship DC-track rating in verify.html (verification-owns-ship-data) and read it here.
- [ ] **Shuttle-bay crit specifics (D8.24)** — pick the jammed bay by die roll; jam drone racks *inside* that bay (currently a bay crit just decrements the shuttle-bay count).
- [ ] **Negative-tractor break auction UI (G7.35)** — a held ship spending negative-tractor power to break the link point-for-point. Currently links break only by release, out-of-range, or a tractor crit (`pruneTractors`).
- [ ] **Proper towing movement (G7.21/32/36)** — a tractor link currently locks both ships in place (simplified). Real towing drags the held ship with the tower at a restricted speed.
- [ ] **Passive-FC voluntary-toggle depth** — the FC-PASSIVE toggle applies the D19 fire penalties; deeper effects (reactivation delay D19.26, EM interaction C10.415 beyond the no-EM block) are approximate.
- [ ] **Shield repair split** — D9.21 shield repair vs D9.7 system repair currently is either/or per turn; SFB lets a ship split its damage-control energy between them.
