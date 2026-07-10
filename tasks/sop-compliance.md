# Sequence-of-Play Compliance (B2.0) — adopt battle-phase.js advance() as the real driver

Goal: make the game genuinely walk the SFB Sequence of Play (B2.2) — every phase a real ordered step —
by completing the designed architecture in `battle-phase.js` (its `advance()` was built to be the driver).
Approved approach: **adopt advance() as the driver** (Rick, 2026-07-09). Item 6 (6C Dogfight/Module J) deferred.

Each stage: pure pieces TDD'd, browser-verified in a solo battle, committed separately. Game stays playable at every commit.

## Stages — ✅ COMPLETE (items 1–5; 6 deferred per Rick)
- [x] **S1 — Extract resolvers (no behavior change).** `resolveMovement` (6A), `resolveSeekingImpact` (end-6A),
      `resolvePostCombat` (6E), `resolveRepairStage` + `resolveFinalActivity` (record/final). `fd88a6c`
- [x] **S2/S4 — advance() is the real driver (#4, #5).** `runSequence()` walks the cursor and dispatches each
      segment's resolver. Movement auto-satisfied; the per-impulse pause is the 6D fire gate (fire at post-movement
      positions, as before). Phase 4 lock-on now rolls at its `lockon` segment. Also fixed a latent wrap bug. `1f4204d`
- [x] **S3 — Phase 3 Self-Destruction plotted (#1).** Declared during Energy Allocation (right-click → energy phase
      only); resolves at the `self-destruct` segment on turn-start positions, before movement (D5.1). `6cb4e73`
- [x] **S5 — Initial Activity (#3) + indicator + resume consistency.** The `initial` segment runs in sequence
      (no-op hook — correct for the current roster: no docked units/pulsars). The SoP HUD tracks the real segment
      (`Turn N · Impulse M/32 · Direct Fire`). `setCoarse`/`startBattle` land a mid-turn resume at the driver's
      `6D1` rest point (post-movement) so a resumed step doesn't re-move.

**#2 (6B ordering):** the architectural gap is closed — `advance()` provides real `6B1`–`6B8` segments and all
activity (launch / transport / mines / recovery / tractor) now happens in the impulse phase, after 6A movement,
before/around 6D fire. Fine Annex-#2 *micro*-ordering of user-clicked actions within 6B is deferred (it only
affects rare same-impulse edge interactions).

## Deferred
- 6C Dogfight Resolution Interface / Module J (no fighters in the current roster).
- Full Annex-#2 micro-step ordering within 6B / 6E / Initial / Final (edge interactions only).

## Verification
- Golden-sequence test (pure): a 2-ship solo turn emits segments in exact B2.2 order (`advance()` over the cursor).
- Browser: solo battle, step a full turn, confirm the SoP indicator walks energy→speed→self-destruct→lockon→
  initial→(32× 6A/6B/6D/6E)→final→record, and combat/movement still resolve correctly.
