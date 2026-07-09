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

## Phase 1 — Crit framework (foundation) — ✅ COMPLETE
- [x] `criticals.js` (TDD): D8.2 2d6→effect table, `rollCritical`, per-ship active-crit occurrences, `hasCrit`
- [x] Trigger: per-shield/impulse damage accumulator (`accrueShieldDamage`) at all 3 damage sites (direct fire, seekers, self-destruct); one deterministic 2d6 roll per ship per turn (D8.1); crit logged + persisted. End-to-end firing verification deferred to Phase 2 (first effect).
- [x] Repair stage: end-of-turn crit repair (D8.31) in stepImpulse — verified (d6=6 → still disabled) `17b8c32` [D14 EDR + D9.21 shield repair = Phase 3]
- [x] UI: relabel "Criticals"→"Secondary explosions"; add optional default-off "D8 Critical hits" toggle `e53b81c`
- [x] UI: on-ship crit badges (`17b8c32`) + crit-roll modal (`b01b9e4`) — both verified end-to-end (real self-destruct → Shuttle Bay crit)
- [x] **Bonus fix:** mid-turn auto-resume now restores the exact SFB segment (was resetting to energy) `17b8c32`

## Phase 2 — Effect wiring (6 of 9 bite)
- [x] 2 Fire control → passive FC (D19): eff.range 2× + 5-hex cap (TDD), no ECCM, no seeking launch — `47b0a81`
- [x] 3 Battery failure: batteryOf → 0 (verified 42→39) — `643f02e`
- [x] 4 Transporter: raid + T-bomb blocked (verified) — `5ef5c18`
- [x] 5 Labs: EDR hidden/zeroed (verified) — `5ef5c18`
- [x] 9 Tractor: full G7 subsystem (establish/hold/release/map/persist) + crit releases the ship's beams (verified) — `b4f232a`
- [x] 10 Shuttle bay jammed: each crit removes a bay from shuttleBaysOf; launches gate on it (verified) — `49469da`
- [x] 11 Maneuver restricted: speed ≤ 8 + TM +1 (verified 23→8) — `32199b7` [no-HET/no-EM once executable]
- [x] 12 Warp: halt + no warp-move (verified max→0) — `643f02e` [½-output loss = deferred D22]

**Also fixed:** auto-resume on reload (localStorage commander code) + crit state carried across resume — `32199b7`.

## Phase 3 — Absent subsystems (make outcomes fully bite) — 🎉 ALL 9 OUTCOMES WIRED
- [x] `tractor.js` (TDD) + full G7 integration (establish/hold/release/map/persist, crit-release) — `d6cd329`/`b4f232a`
- [x] EM erratic maneuvers (C10): cost 6 move-hexes (`18c9e2a`) + ±4 ECM at & by the EM unit (`b0021e8`)
- [ ] D14 emergency damage repair: mark DC box + 3 power/lab; end-of-turn roll ≤ DC rating (EDR control exists but is inert — the last "plus" item)
- [ ] Bay identity in verify.html + verified.json (specific bay by die roll, drone racks inside a bay — refinement)
- [ ] Refinements: negative-tractor break auction UI (currently auto/pruned); proper towing movement; passive-FC voluntary-toggle deeper effects

## Deferred TODO (Rick-flagged)
- [ ] **Full D22 energy-balance engine** — incremental/instantaneous/continuous power-loss reallocation (D22.1–D22.6).
      Until then the warp crit uses D8.23's own allowance (cancel movement energy).

## Deferred TODO (Rick-flagged)
- [ ] **Full D22 energy-balance engine** — incremental/instantaneous/continuous power-loss reallocation (D22.1–D22.6).
      Until then the warp crit uses D8.23's own allowance (cancel movement energy).
