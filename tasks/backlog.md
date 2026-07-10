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

## Adversarial rules review (2026-07-10)
- [ ] **96 confirmed rules-compliance findings** — see `docs/adversarial-review.md` (443-agent adversarial review, 3-vote verified). 13 high / 67 med / 16 low. Prioritized fix order in the report's executive summary; worst clusters: cloak (G13), EW magnitude (D6.34/D6.310/D6.112), D9.7 repair, D5 self-destruct, E2.23 phaser once/turn, C3 turn-mode category in the commit path.

## Still open — need Rick's input / not safely autonomous
- [ ] **Full D22 energy-balance engine** (Rick-flagged, large) — general mid-turn power-loss reallocation for *any* damage. D22.0 is an *optional* rule ("greater realism at considerable cost in complexity"). The warp-crit slice (D8.23) is done; the general engine is a multi-part feature: classify every expenditure as expended/available/operating (D22.11 incremental / D22.12 instantaneous / D22.13 continuous); two-phase shortage resolution — warp shortage first (D22.2, steps A–G) then general shortage (D22.3/D22.4); phaser-capacitor accounting (D22.15); power-shedding priority chain (cancel accel/HET/EM → stop arming → slow down, D22.27/D22.52); plus UI to prompt/auto-shed. **Warrants a design + Rick's buy-in before building — not a blind autonomous build (would over-engineer an optional rule).** Rules read & scoped 2026-07-09.
- [ ] **Extract EA control CSS** to a shared `eaf-panel.css`. **Deliberately deferred:** low value (DRY on ~25 lines that rarely change), the two copies intentionally differ (editor uses `cursor:grab` + `#eafArtWrap` scope; game uses `cursor:pointer`), and — decisively — the live game EA panel can't be visually regression-checked without standing up a full battle, so a blind extraction to the primary UI fails the "prove it works" bar. Do it when a live battle is up to screenshot-compare before/after.
