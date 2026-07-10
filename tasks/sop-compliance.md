# Sequence-of-Play Compliance (B2.0) — adopt battle-phase.js advance() as the real driver

Goal: make the game genuinely walk the SFB Sequence of Play (B2.2) — every phase a real ordered step —
by completing the designed architecture in `battle-phase.js` (its `advance()` was built to be the driver).
Approved approach: **adopt advance() as the driver** (Rick, 2026-07-09). Item 6 (6C Dogfight/Module J) deferred.

Each stage: pure pieces TDD'd, browser-verified in a solo battle, committed separately. Game stays playable at every commit.

## Stages
- [ ] **S1 — Extract resolvers (no behavior change).** Split `stepImpulse` body into named segment resolvers:
      `resolveMovement` (6A), `resolveSeekingImpact` (end-6A), `resolvePostCombat` (6E), `resolveFinalActivity`
      + `resolveRecordKeeping` (7/8). Pure refactor; suite + syntax + browser-play unchanged.
- [ ] **S2 — Pre-impulse driver + Phase 4 lock-on at its step (#5, #4-partial).** At energy resolve, set
      `gates.energyResolved` and call the new `runSequence()` over `advance()`; it runs speed → self-destruct →
      lockon → initial in order and rests at 6A2. Wire `ensureLocks()` to the `lockon` segment (not lazy).
- [ ] **S3 — Phase 3 Self-Destruction plotted (#1).** Plot self-destruct during energy allocation; resolve at the
      `self-destruct` segment on turn-start positions (before movement). Replace the instant context-menu detonation
      with "plot self-destruct this turn". TDD the ordering (plotted SD resolves before any 6A movement).
- [ ] **S4 — Per-impulse via advance() + 6B ordering (#2, #4-complete).** Drive phase-6 segments through
      `advance()`; gate launches / transport / mines / recovery / tractor to the 6B window in Annex-#2 order.
      Preserve the fire-commit + step UX; keep the working simultaneous-damage 6D resolution.
- [ ] **S5 — Phase 5 Initial Activity hook (#3) + indicator/cleanup.** Real auto `initial` step in sequence;
      SoP HUD tracks the real current segment; delete now-dead coarse branches + unused battle-phase exports.

## Deferred
- 6C Dogfight Resolution Interface / Module J (no fighters in the current roster).

## Verification
- Golden-sequence test (pure): a 2-ship solo turn emits segments in exact B2.2 order (`advance()` over the cursor).
- Browser: solo battle, step a full turn, confirm the SoP indicator walks energy→speed→self-destruct→lockon→
  initial→(32× 6A/6B/6D/6E)→final→record, and combat/movement still resolve correctly.
