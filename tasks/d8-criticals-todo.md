# D8 Critical Hits — full-simulation build (all nine inline)

Approved design: `docs/rules-audit.md` → "D8.0 Critical hits — full systems map". Rick approved "everything inline";
full D22 engine deferred to a TODO (warp crit uses the D8.23 simplification: cancel movement energy).

## Phase 0 — EA panel parity (Klingon D7 ⇄ Fed) — IN PROGRESS
Rick: new Klingon art, D7 at control parity with Fed, double-up controls into panels as needed, same shield
reinforcement functionality, **general reinforcement highlights all 6 shield fields as it increases**.
- [x] Copy `assets/newKlingon_EAF.png` → `ssd-pipeline/viewer/assets/`
- [x] Switch `CONSOLE.kli.art` → `newKlingon_EAF`; re-map kli zones to the new form (8 bay slots via L+R columns)
- [x] Shield reinforcement highlight: shield control highlights on specific OR general reinforcement
- [x] General reinforcement highlights ALL 6 shields (Fed ring SVG + Klingon controls) — browser-verified
- [x] Browser-verify the D7 form renders every control (RESERVE/SPEED/4 disruptors/PHASERS/FIRE CTL/GEN REINF/6 shields/bottom bar)
- [x] Add new D8 controls to the EA panel: **ERRATIC** (EM), **FC PASSIVE**, **EDR (labs)** — model fields + costs (C10.11/D14.12) TDD'd; rendered on both themes; browser-verified (EM toggle adds 6 to used)
- [ ] Rick to adjust control placement (Fed cluster is a rough first pass; Klingon uses top-row panels + free right slot)

## Phase 1 — Crit framework (foundation)
- [ ] `criticals.js` (TDD): D8.2 2d6→effect table, `rollCritical`, per-ship active-crit occurrences, `hasCrit`
- [x] Trigger: per-shield/impulse damage accumulator (`accrueShieldDamage`) at all 3 damage sites (direct fire, seekers, self-destruct); one deterministic 2d6 roll per ship per turn (D8.1); crit logged + persisted. End-to-end firing verification deferred to Phase 2 (first effect).
- [ ] `repair-stage.js` (TDD): end-of-turn crit repair (D8.31) + D14 EDR + shield repair (D9.21)
- [ ] UI: relabel "Criticals"→"Secondary explosions"; add optional default-off "D8 Critical hits" toggle
- [ ] UI: on-ship crit badges; crit-roll modal; end-of-turn repair panel

## Phase 2 — Effect wiring (all nine bite)
- [ ] 2 Fire control → passive FC (D19): eff.range 2×, 5-hex cap, no ECCM, no seeking guidance
- [ ] 3 Battery failure: zero charge, block hold/reserve/reinforce
- [ ] 4 Transporter: gate `mines.js` raid / T-bomb
- [ ] 5 Labs: block D14 EDR + lab use
- [ ] 9 Tractor: release all links (needs `tractor.js`)
- [ ] 10 Shuttle bay jammed (one bay): needs bay identity (verify.html capture)
- [x] 11 Maneuver restricted: speed ≤ 8 (maxBaseSpeed) + TM +1 (turnModeOf). Browser-verified: D7 max 23→8. [no-HET/no-EM once those are executable]
- [ ] 12 Warp: halt, no warp-move, ½ output lost (D22 simplified per D8.23)

**Also fixed:** auto-resume on reload (localStorage commander code) + crit state carried across resume — `32199b7`.

## Phase 3 — Absent subsystems (make outcomes fully bite)
- [ ] `tractor.js` (TDD): G7 link model (attach/hold/release/negative-tractor break) + map interaction
- [ ] EM erratic maneuvers (C10): cost 6 move-hexes; ±2 shift to weapons fired at AND by the EM unit; negates passive FC
- [ ] D14 emergency damage repair: mark DC box + 3 power/lab + target systems; end-of-turn roll ≤ DC rating
- [ ] Bay identity in verify.html + verified.json (which racks/shuttles per bay) + DC-track rating capture

## Deferred TODO (Rick-flagged)
- [ ] **Full D22 energy-balance engine** — incremental/instantaneous/continuous power-loss reallocation (D22.1–D22.6).
      Until then the warp crit uses D8.23's own allowance (cancel movement energy).
