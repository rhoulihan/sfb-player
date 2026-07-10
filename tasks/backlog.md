# SFB Player — Backlog (deferred refinements)

Lower-priority polish. None block normal cruiser play.

## Done this pass
- [x] **Shield-repair split** (D9.21+D9.7) — repair a shield first, leftover DC energy to systems. `2b6a921`
- [x] **Verified DC-track rating** (D9/D14) — captured in verify.html (stats.dcRating), used by the D14 EDR roll. `2b6a921`
- [x] **Negative-tractor break** (G7.35) — a held ship spends negative-tractor power to break the beam. `0701e6f`
- [x] **EAF editor group-drag** — Shift-drag moves a control's whole category (shields/weapons/systems). `850bee8`
- [x] **EAF editor remove-on-drag-off** — drag a placed control off the form to unplace it. `a7e9f21`
- [x] **Proper towing** (G7.32/36) — a tractored ship is dragged by its tower (verified F1→E1 stayed adjacent). `8efe5e7`
- [x] **Warp-crit power loss** (D8.23) — half the warp output is unusable while warp-crit'd (verified 42→27 produced).
- [x] **Passive-FC reactivation delay** (D19.26) — FC restored from passive can't fire/guide for 1/8 turn (4 impulses). `103e159`
- [x] **Shuttle-bay crit identity** (D8.24) — bays derived from the SSD; a bay crit jams a specific bay + its drone racks. `1e3b6bd`
- [x] **New-race art upload** — EAF editor 'Upload art' → POST /api/eaf-art/<name> writes viewer/assets/<name>.png. `e196c69`
- [x] **Towing speed restriction** (G7.36B) — `pseudoSpeed()` slows the tower to movement-energy ÷ combined move cost (tow a dead ship → half speed; verified 16→8 hexes/turn).
- [x] **Klingon shield overlays** — hexes now read the saved layout (`controls['shield-N']`, was silently reading the wrong key), sized to the SSD boxes and rotated tangent to the ring (derived from the ring centroid). Screenshot-verified against the real Klingon EAF art.

## Still open
- [ ] **Full D22 energy-balance engine** (Rick-flagged) — general mid-turn power-loss reallocation for *any* damage (D22.1–D22.6: incremental / instantaneous / continuous). The warp-crit slice above is done; the general engine (recomputing the EAF when any power source is lost mid-turn) is the remaining large piece.
- [ ] **Shuttle-bay crit specifics (D8.24)** — pick the jammed bay by die roll + jam drone racks *inside* it. Needs bay identity (which racks/shuttles per bay) captured in verify.html/verified.json; today a bay crit just decrements the shuttle-bay count.
- [ ] **Extract EA control CSS** to a shared `eaf-panel.css` (currently inline in battle.html + copied into verify.html).
