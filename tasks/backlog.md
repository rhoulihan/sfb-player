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

## MSC prefill (ad-hoc, 2026-07-10 — backlogged per Rick)
- [ ] **Prefill roster ship stats from the Master Ship Chart** — extract BES/move-cost/size-class/turn-mode/DC (and cloak cost) for the 7 roster ships (FED-CA/CL/NCL, GOR-CA, KLI-D7, KZIN-CS, ROM-KR) from the MSC (Annex R2.0 in `SFB/SFBModuleG3.pdf`, now available) into their `verified.json` stats. NOTE: PDF text extraction of the MSC is column-jumbled — read the MSC pages as images for accuracy. BES column: locate it in the MSC (D5.2 references it).
- [ ] **Auto-prefill MSC-derived stats when a new SSD is loaded** in verify.html — build an MSC data table (ship code → stats, functional data from Module G3) that the editor reads to auto-populate the stat fields (turnCategory/sizeClass/moveCost/dcRating/cloakCost/bes) whenever a ship is opened, so verification starts pre-filled.

## Adversarial rules review (2026-07-10)
- [ ] **96 confirmed rules-compliance findings** — see `docs/adversarial-review.md` (443-agent adversarial review, 3-vote verified). 13 high / 67 med / 16 low. Prioritized fix order in the report's executive summary; worst clusters: cloak (G13), EW magnitude (D6.34/D6.310/D6.112), D9.7 repair, D5 self-destruct, E2.23 phaser once/turn, C3 turn-mode category in the commit path.

## Still open — need Rick's input / not safely autonomous
- [ ] **Full D22 energy-balance engine** (Rick-flagged, large) — general mid-turn power-loss reallocation for *any* damage. D22.0 is an *optional* rule ("greater realism at considerable cost in complexity"). The warp-crit slice (D8.23) is done; the general engine is a multi-part feature: classify every expenditure as expended/available/operating (D22.11 incremental / D22.12 instantaneous / D22.13 continuous); two-phase shortage resolution — warp shortage first (D22.2, steps A–G) then general shortage (D22.3/D22.4); phaser-capacitor accounting (D22.15); power-shedding priority chain (cancel accel/HET/EM → stop arming → slow down, D22.27/D22.52); plus UI to prompt/auto-shed. **Warrants a design + Rick's buy-in before building — not a blind autonomous build (would over-engineer an optional rule).** Rules read & scoped 2026-07-09.
- [ ] **Extract EA control CSS** to a shared `eaf-panel.css`. **Deliberately deferred:** low value (DRY on ~25 lines that rarely change), the two copies intentionally differ (editor uses `cursor:grab` + `#eafArtWrap` scope; game uses `cursor:pointer`), and — decisively — the live game EA panel can't be visually regression-checked without standing up a full battle, so a blind extraction to the primary UI fails the "prove it works" bar. Do it when a live battle is up to screenshot-compare before/after.

## Suicide-shuttle variable arming energy — DONE 2026-07-18 (EAF shuttle-arming controls)
- ~~Fixed 3 points/turn~~ → the combined `shuttles` EAF control's SUI counter now commits 0–3 points/turn (J2.2211) with the turn-4+ hold
  (first point holds, extras keep arming to the 9-point cap, J2.2212). Remaining refinements:
  - [ ] **Half-point arming increments** (J2.2211 allows 1.0–3.0 in 0.5 steps; the stepper is integer-only — a legal subset).
  - [ ] **Reserve-power arming starts** — J2.2213 (suicide: reserve on any arming/hold turn) and J3.122 (weasel: reserve may
    BEGIN a charge, then EAF-only, 32-impulse minimum before launch). Currently EAF-allocation-only.
  - [ ] **Multiple simultaneous weasel charges** (J3.123) — one `wwArm` track per ship today.
  - [ ] **Shuttle recovery restoring inventory** (J1.86x) — `shuttlesGone` only ever grows; recovered/landed shuttles
    should decrement it (needs a recovery flow first).

## Boarding-party count (from D7/D15 fix)
- A hit-and-run raid currently commits a single boarding party per transporter. Add a control to choose HOW MANY boarding
  parties to commit per raid (D7.8x), affecting the odds/effect. Target selection is done (right-click the target).

## Multiplayer reactive reinforcement — defender-not-resolver handshake (from H7.134 fix)
- H7.134 reactive reserve reinforcement now prompts the defender for their own ships when THEY are the fire resolver
  (last to commit). When the ATTACKER is the resolver, the defending player is not local and cannot be prompted. The full
  fix is a networked mid-resolution handshake: the resolver pauses on each penetrating hit, requests the defending
  commander's reserve-reinforcement decision over the save/poll channel, waits, then applies it. Needs 2-player testing.

## Plotting UX rework — DONE 2026-07-19
- [x] Turn-vs-sideslip click chooser (dual-eligible hex asks; single option just executes)
- [x] Reroute-from-hex ask + truncation (EA also drops speed changes past the cut; impulse play keeps them immutable; executed steps protected)
- [x] Path cap at impulse 32 (click extend, drag router, and drop sites all honor the movement timeline)
- [x] **HET on the nav path — DONE 2026-07-19**: left-pane turn/HET buttons removed; red (illegal-turn) candidate hexes open the
  maneuver chooser with ⚡ High Energy Turn (+ Sideslip only when legal). HET steps carry ⚡ on the path and pay the 5 energy +
  C6.51 breakdown roll at execution; an unpayable HET breaks the plot there. Plotting any step now ENGAGES the autopilot
  (programmed paths execute without the 🅰 toggle — root of several "ships not following paths" reports).
- [ ] **Annex #2 exact 6B activity sub-order**: the OCR'd rulebook text lacks Annex #2 (the expanded Sequence of Play).
  The impulse engine maps B2.3's activity list onto the 6B1–6B8 slots; refine the in-segment ordering when Rick supplies
  Annex #2. Also future: per-segment pacing (faster poll cadence while a round is mid-flight) if multiplayer feels slow.
