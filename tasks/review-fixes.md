# Adversarial-review fix list — working checklist

Source: `docs/adversarial-review.md` (96 confirmed findings). Strict TDD, one cluster at a time, in fix-order. Mark `[x]` as each lands (with commit). Per [[work-through-review-list]]: check this file before stopping; keep going while anything is unchecked.


## Phaser once-per-turn (E2.23)

- [x] 🔴 **E2.23** `ssd-pipeline/viewer/battle.html:1304` — A phaser can fire more than once per turn: eligibility is gated only on capacitor charge, not on whether that mount already fired this turn.

## Turn-mode category in commit path (C3)

- [x] 🔴 **C3.31 / C3.32 / C3.44** `ssd-pipeline/viewer/course-plan.js:46` — tryStep evaluates turn-mode legality with the ship category hardcoded to B, letting category C/D/E ships commit illegal early turns.

## Seeker-launch lock-on gate (D6.121)

- [x] 🟠 **D6.121** `ssd-pipeline/viewer/battle.html:362` — Seeking-weapon launch is gated on passive-FC and control channels but NOT on lock-on; a ship that failed its general lock-on may still launch drones/plasma.

## Overload true-range cutoff (E3.53/E4.42)

- [x] 🔴 **E3.53 / E4.42** `ssd-pipeline/viewer/weapon-charts.js:154` — Overload maximum-range cutoff (8 hexes) is tested against effective range, but the rules apply it to true range only.

## EW magnitude model (D6)

- [x] 🔴 **D6.34 / D6.35** `ssd-pipeline/viewer/direct-fire.js:17` — Net ECM points are added linearly to effective range instead of being converted to the D6.34 square-root shift; EW is grossly over-scaled.
- [x] 🔴 **D6.310 / D6.312** `ssd-pipeline/viewer/energy-model.js:72` — No combined ECM+ECCM cap — the two are each capped at 6 independently, so a ship can allocate 12 total EW instead of its sensor rating.
- [x] 🔴 **D6.112** `ssd-pipeline/viewer/lock-on.js:3` — ECM is used to BREAK lock-on, but the rules say EW only degrades weapon effect quality and cannot break a lock.
- [ ] 🟠 **FP1.611/D6.36** `ssd-pipeline/viewer/battle.html:1429` — Seeking weapons cannot be selected as fire targets, so the player can never direct PH-1/PH-2 at a drone or weaken an approaching plasma torpedo.
- [x] 🟠 **D6.35/E1.821/E1.822/D6.34** `ssd-pipeline/viewer/direct-fire.js:17` _(dup of EW cluster)_ — Electronic warfare is added to the chart-reading range instead of being applied as a die-roll shift, and uses raw net-ECM strength rather than the D6.34 sqrt shift.
- [x] 🟠 **D6.310** `ssd-pipeline/viewer/eaf-controls.js:24` _(dup of EW cluster)_ — ECM and ECCM are each capped at a hardcoded 6 independently, so combined EW can reach 12 and is not tied to the ship's actual sensor rating.
- [x] 🟠 **D6.310** `ssd-pipeline/viewer/energy-model.js:72` _(dup of EW cluster)_ — ECM and ECCM are each capped at 6 independently with no combined cap, letting a ship allocate 12 EW points when the rule caps ECM+ECCM combined at the sensor rating.

## Cloak cluster (G13)

- [x] 🔴 **G13.303 / G13.301** `ssd-pipeline/viewer/battle.html:573` — The firer's ECCM is subtracted from the cloak's ECM-equivalent, so ~5 ECCM completely defeats a cloak — but ECCM is explicitly ignored against cloaked ships.
- [x] 🔴 **G13.15 / G13.132 / G13.13** `ssd-pipeline/viewer/cloak.js:11` — Decloaking lets a ship fire in the same impulse; the required fire-control reactivation delay is not applied.
- [x] 🔴 **G13.51 / G13.133 / D19.21** `ssd-pipeline/viewer/cloak.js:16` — A cloaked ship is only blocked from direct fire, but can still launch seeking weapons, tractor, transporter-bomb, and boarding-raid.
- [x] 🟠 **G13.23 / G13.232** `ssd-pipeline/viewer/battle.html:1655` — Cloak energy cost is deducted on every uncloak->cloak toggle, so decloaking and re-cloaking in the same turn charges the cost twice.
- [x] 🟠 **G13.21 / G13.116 / G13.117 / G13.23** `ssd-pipeline/viewer/battle.html:1655` — Cloak energy is charged only once when the player manually toggles it on; there is no mandatory per-turn upkeep at Energy Allocation.
- [x] 🟠 **G13.301 / G13.331** `ssd-pipeline/viewer/lock-on.js:7` — A fully cloaked ship can still be locked on a die roll of 1 (roll+5<=6); the rules make lock-on of a cloaked ship impossible for a non-scout ship.
- [x] 🟡 **G13.14 / G13.302 / G13.31** `ssd-pipeline/viewer/cloak.js:5` — Cloak is a binary flag granting the full +5 benefit instantly; the 5-impulse fade-out/fade-in phase-in is not modeled.

## Damage-control repair (D9) — ✅ un-deferred (Annex #9 provided via SFBModuleG3)

- [x] 🔴 **D9.7 / D9.74 / D9.711** `ssd-pipeline/viewer/battle.html:804` — Continuous system-box repair uses leftover D9.2 shield energy, repairs multiple boxes/turn at flat cost 1, ignoring D9.7's separate free points, one-box-per-turn limit, and the Cost-of-Repair chart.
- [x] 🔴 **D9.711 / D9.72 / D9.741 / D9.76** `ssd-pipeline/viewer/battle.html:806` — Continuous Damage Repair (D9.7) repairs one system box per leftover damage-control energy point, ignoring the per-system Cost-of-Repair chart, the free-points model, the one-box-at-a-time limit, and the scenario cap.
- [x] 🟠 **D9.22** `ssd-pipeline/viewer/battle.html:800` — End-of-turn shield repair erases boxes knocked down THIS turn, but D9.22 forbids repairing the current turn's hits.
- [x] 🟠 **D9.22 / D9.73** `ssd-pipeline/viewer/battle.html:802` — Damage-control repair erases damage inflicted on the SAME turn; both shield (D9.22) and system (D9.73) repair may only touch prior-turn damage.
- [x] 🟠 **D9.21** `ssd-pipeline/viewer/energy-model.js:79` — The damage-control energy ceiling is the count of DC boxes, not the DC rating (highest number on the track).

## Self-destruct (D5)

- [ ] 🟠 **D5.12** `ssd-pipeline/viewer/battle.html:792` — A ship destroyed in combat never explodes; only the plotted self-destruct path ever calls selfDestruct().
- [x] 🟠 **D5.5 / D5.51** `ssd-pipeline/viewer/battle.html:843` — resolvePlottedSelfDestruct detonates any ship flagged self-destruct with no crew-unit / last-friendly-ship precondition.
- [x] 🟠 **D5.2 / D5.12 / D5.41** `ssd-pipeline/viewer/mines.js:36` — Self-destruct explosion strength is a hardcoded 30 for every ship instead of the per-ship Basic Explosion Strength from the Master Ship Chart.
- [x] 🟠 **D5.41** `ssd-pipeline/viewer/mines.js:36` — Self-destruct blast radius is hardcoded to 2 hexes; the rule caps the zone at radius 1 (or radius 0 for a small explosion).
- [x] 🟠 **D5.2** `ssd-pipeline/viewer/mines.js:36` — Self-destruction force is a hardcoded 30 for all ships instead of the per-ship value from the Master Ship Chart.
- [x] 🟠 **D5.41** `ssd-pipeline/viewer/mines.js:37` — Self-destruct blast uses radius 2 with a 1/distance damage falloff; D5.41 is radius 1 (BES>=10) or same-hex-only (BES<=9), with the FULL BES applied to every unit in the zone.
- [x] 🟡 **D5.0 / D7.8 / M3.0** `ssd-pipeline/viewer/mines.js:34` — Several rule-number citations in the comments point to the wrong rules for this edition.

## Wild weasel / shuttles (J3/C6)

- [x] 🔴 **J3.12** `ssd-pipeline/viewer/battle.html:418` — Wild weasel launches instantly and free; the rule requires charging 1 energy on each of two consecutive turns before launch.
- [x] 🔴 **J3.13/J3.131/J3.132/J3.12** `ssd-pipeline/viewer/battle.html:418` — Wild weasel launch enforces none of the J3.13 launching-ship restrictions and costs no energy, so a ship gets a free no-downside decoy.

## Remaining — sequence

- [ ] 🟠 **D6.123 / D6.1142** `ssd-pipeline/viewer/lock-on.js:24` — Failing lock-on completely blocks direct fire at that target; the rule instead DOUBLES the firing range and only blocks if the doubled range exceeds the weapon's max.

## Remaining — energy

- [ ] 🟠 **D14.12** `ssd-pipeline/viewer/battle.html:832` — EDR auto-repairs arbitrary destroyed boxes rather than the systems the player must specify when allocating lab energy.
- [x] 🟠 **D3.343** `ssd-pipeline/viewer/battle.html:1112` — The reactive reserve-reinforcement modal lets a defender put SPECIFIC reinforcement onto a down (0-strength) shield.
- [x] 🟠 **H7.41 / H7.42** `ssd-pipeline/viewer/energy-model.js:74` — Reserve warp power is capped in quantity but not gated to warp-engine source, letting warp output be double-committed to movement and reserve simultaneously.
- [x] 🟠 **D3.343** `ssd-pipeline/viewer/energy-model.js:84` — A down (0-strength) shield can still receive specific reinforcement, which D3.343 forbids.
- [x] 🟠 **C2.11 / C2.112** `ssd-pipeline/viewer/energy-model.js:128` — validateEaf never gates movement energy to the warp+impulse sources, so movement can be funded from APR/batteries and can exceed the 30-from-warp cap.
- [x] 🟡 **D3.342** `ssd-pipeline/viewer/energy-model.js:84` — Specific reinforcement is capped at the shield's printed box value, but D3.342 places no such cap.
- [x] 🟡 **C2.411 / C2.112** `ssd-pipeline/viewer/energy-model.js:163` — foldEaf caps folded speed at 30 though maximum practical speed is 31 (30 warp + 1 impulse).

## Remaining — arming

- [x] 🟠 **E4.44 / E4.413** `ssd-pipeline/viewer/energy-model.js:124` — Holding a fully-armed OVERLOADED photon is charged 1 energy/turn instead of the required 2.
- [x] 🟠 **E4.411 / E4.412** `ssd-pipeline/viewer/energy-model.js:124` — A fully-armed photon that is being held cannot be overloaded on a later turn, though the rules explicitly allow it.
- [x] 🟠 **E4.23** `ssd-pipeline/viewer/energy-model.js:135` — Photon arming/overload energy is not restricted to warp power sources as E4.23 requires.
- [x] 🟠 **E4.431 / E4.413** `ssd-pipeline/viewer/weapon-charts.js:126` — Full-overload photon feedback damage is set to 2, but the code applies the full warhead-16 overload, whose E4.413 feedback is 4.

## Remaining — directfire

- [x] 🟠 **E4.413/E4.431** `ssd-pipeline/viewer/weapon-charts.js:126` — Overloaded-photon feedback is hardcoded to 2, but the 16-point warhead the code fires does 4 feedback per the E4.413 ladder.
- [x] 🟠 **E4.32** `ssd-pipeline/viewer/weapon-charts.js:147` — Proximity-photon automatic-miss-under-9 test uses effective range, but E4.32 specifies true range.
- [x] 🟠 **E3.33** `ssd-pipeline/viewer/weapon-charts.js:166` — Disruptor damage is read at the effective (EW/passive-adjusted) range instead of the true range.
- [ ] 🟡 **E4.43** `ssd-pipeline/viewer/fire-plan.js:13` — mountEligibility blocks a photon at true range 1 (min-range gate, no overload awareness), so the only representable point-blank overload shot can never be assigned.

## Remaining — movement

- [ ] 🟠 **C1.43 / phaser range chart** `ssd-pipeline/viewer/battle-geom.js:17` — hexDistance clamps distance to a minimum of 1, making the range-0 column of every weapon chart unreachable.
- [x] 🟠 **C3.41 / C3.42** `ssd-pipeline/viewer/battle-map.js:40` — Turn-mode carryover between turns is not tracked; hexesSinceTurn is reseeded to full turn-mode satisfaction at the start of every turn.
- [x] 🟠 **C12.311 / C12.312 / C12.313 / C12.32** `ssd-pipeline/viewer/course-plan.js:68` — Mid-turn speed changes are accepted with none of the C12.3 legality restrictions enforced.
- [ ] 🟠 **P3.31 / P3.33** `ssd-pipeline/viewer/terrain.js:31` — Regular asteroids are modeled as hard line-of-sight blockers, but SFB asteroid fields do not block fire — they give the target ECM.

## Remaining — seeking

- [x] 🟠 **FD3.3 / FD3.5 (rate of fire); FD3.1** `ssd-pipeline/viewer/drone-inventory.js:4` — The rack model stores only capacity, not per-turn rate of fire, so rapid-fire type-C and type-E racks are under-fired.
- [x] 🟠 **F2.121 / F2.14** `ssd-pipeline/viewer/seeking.js:10` — Homing snaps the seeker's facing to any of six directions in a single impulse, ignoring its Turn Mode of 1 and the no-reverse rule.
- [x] 🟠 **F3.31 / F3.32** `ssd-pipeline/viewer/seeking.js:70` — Only control-channel count (condition 6) is enforced; the fire-control, lock-on, and 35-hex range conditions for guiding seekers, and their loss effects, are absent.
- [x] 🟡 **FD2.1** `ssd-pipeline/viewer/drone-inventory.js:8` — Type-VI drone warhead is coded as 6 but the Drone Type Chart gives 8.
- [x] 🟡 **F3.21 / F3.224** `ssd-pipeline/viewer/seeking.js:69` — controlledCount treats every 'shuttle' token as a controlled seeking weapon, counting admin shuttles against the control-channel limit.

## Remaining — damage

- [x] 🟠 **D4.3222 / D4.322** `ssd-pipeline/viewer/dac-allocator.js:64` — pickWeaponByType ignores the every-third-most-powerful-type requirement and the hitCount it is passed; comment falsely claims it is implemented.

## Remaining — criticals

- [ ] 🟠 **D8.31** `ssd-pipeline/viewer/battle.html:818` — When multiple criticals are active the engine always attempts to repair criticals[0] (the oldest); D8.31 gives the owning player the choice of which one to attempt.
- [ ] 🟠 **D19.26** `ssd-pipeline/viewer/battle.html:819` — Repairing a fire-control critical hit does not start the D19.26 reactivation delay, so active FC returns with no 4-impulse penalty.
- [ ] 🟠 **D14.13** `ssd-pipeline/viewer/battle.html:827` — The DC rating that sets EDR success probability and cap is never captured in verified.json, so a hardcoded min(4, intact-DC-boxes) proxy is always used.
- [x] 🟠 **D14.26** `ssd-pipeline/viewer/battle.html:862` — A ship can perform both D9.7 continuous system repair and D14 emergency damage repair in the same turn; the rules make them mutually exclusive.
- [x] 🟠 **D19.26** `ssd-pipeline/viewer/battle.html:1822` — During the 4-impulse fire-control reactivation window the ship is barred from firing entirely, but D19.26 allows it to keep firing on passive fire control.
- [x] 🟠 **D19.25** `ssd-pipeline/viewer/battle.html:1841` — A ship on passive fire control that is also using erratic maneuvers can still fire; D19.25 forbids any firing/launching in that state.
- [ ] 🟡 **D8.2 (#3)** `ssd-pipeline/viewer/battle.html:1037` — A battery critical hit only masks stored battery charge to 0 while active; the stored energy is silently preserved and restored when the crit is repaired.

## Remaining — tractor

- [x] 🟠 **G7.41A / G7.412** `ssd-pipeline/viewer/battle.html:473` — establishTractor never checks that the tractoring ship has a lock-on to the target.
- [x] 🟠 **G7.13** `ssd-pipeline/viewer/battle.html:485` — No once-per-turn / 8-impulse lockout after a beam is released or broken.
- [x] 🟠 **G7.352 / G7.63 / G7.41C** `ssd-pipeline/viewer/battle.html:488` — breakTractor demands raw allocated power (2 at R2, 3 at R3) of negative tractor instead of the 1 point that cancels one EFFECTIVE point.
- [x] 🟠 **G7.351 / G7.15** `ssd-pipeline/viewer/battle.html:489` — Negative tractor can only be paid from reserve/battery; EA-allocated tractor power designated as negative is unusable.
- [x] 🟠 **G7.124 / G7.42** `ssd-pipeline/viewer/battle.html:496` — A tractor link persists across turn boundaries for free; no new-power re-establishment / auction at start of turn.
- [x] 🟠 **G7.92 / G7.922** `ssd-pipeline/viewer/battle.html:574` — A tractored ship still receives its full +4 Erratic-Maneuver ECM benefit, which the rules say stops while it is held.
- [x] 🟠 **G7.941** `ssd-pipeline/viewer/battle.html:1650` — A ship held in a tractor beam can still launch shuttles, wild weasels, admin shuttles, scatter-packs and boarding raids.
- [x] 🟡 **G7.41B / G7.411** `ssd-pipeline/viewer/battle.html:481` — Reserve power cannot initiate or reinforce a positive tractor link; only EA-allocated tractorPower counts.
- [x] 🟡 **G7.91** `ssd-pipeline/viewer/fire-plan.js:15` — A tractored ship is never restricted from firing direct-fire/plasma at (or tractoring) ships other than the unit holding it.

## Remaining — ew

- [x] 🟠 **D17.26** `ssd-pipeline/viewer/battle.html:1765` — Tactical-intel level ignores the target's ECM entirely — every ECM shift in the target's favor should drop the info level one step.
- [ ] 🟠 **D17.22 / D17.221** `ssd-pipeline/viewer/battle.html:1768` — Tactical-intel level uses true hex distance, not effective direct-fire range, so intel is over-reported on cloaked targets (and observers using EM).
- [x] 🟠 **D6.11** `ssd-pipeline/viewer/lock-on.js:7` — The lock-on roll threshold is hardcoded to 6 and never uses the firer's current sensor rating, so a sensor-damaged ship still auto-locks.

## Remaining — mines

- [ ] 🟠 **J2.221 / J2.2211** `ssd-pipeline/viewer/battle.html:397` — Suicide shuttle launches instantly with a fixed 12-point warhead; the rules require three turns of arming and a variable warhead.
- [x] 🟠 **D7.821** `ssd-pipeline/viewer/battle.html:437` — No per-turn / per-transporter cap on hit-and-run raids — a ship can raid every impulse without limit.
- [x] 🟠 **G8.21** `ssd-pipeline/viewer/battle.html:440` — Hit-and-run raid and transporter bomb ignore the target's shields; transporters cannot beam through an intact shield.
- [x] 🟠 **D7.81** `ssd-pipeline/viewer/battle.html:445` — Hit-and-run picks a random enemy box; the rules require the attacker to designate the specific box, and restrict which boxes are legal.
- [x] 🟠 **G8.14** `ssd-pipeline/viewer/mines.js:13` — Transporter range hardcoded to 1 hex (adjacent) instead of the rulebook's 5.
- [x] 🟠 **M2.23** `ssd-pipeline/viewer/mines.js:25` — Mines only trigger on enemy units, but rules make a dropped mine neutral to all sides.
- [x] 🟠 **D7.81** `ssd-pipeline/viewer/mines.js:30` — Hit-and-run raid resolves 'success on 4+', but the D7.81 chart destroys the target system on a roll of 1-2 for a normal boarding party.
- [ ] 🟡 **G8.13** `ssd-pipeline/viewer/battle.html:437` — Hit-and-run raids and transporter bombs cost no energy; a transporter operation requires 1 energy point.
- [x] 🟡 **M2.31 / M2.34** `ssd-pipeline/viewer/mines.js:23` — No mine-arming delay: a mine can detonate the same impulse it is laid.

## Remaining — ssd

- [ ] 🟠 **D4.321 (also D2.14/D2.32/D2.33)** `ssd-pipeline/viewer/arc-geom.js:40` — Captured per-hex arc exceptions (paintAdd/paintRemove) are silently dropped when deciding phaser directional damage.
- [ ] 🟡 **C2.0 / Master Ship Chart (movement cost); B3.3 (size class)** `ssd-pipeline/viewer/energy-model.js:19` — Per-ship sizeClass and moveCost are hardcoded in SHIP_PROFILES and moveCost has no capture UI, violating 'verification owns ship data'.
- [ ] 🟡 **C3.3 / C3.31 (Turn Mode Chart)** `ssd-pipeline/viewer/verify.html:108` — Turn-mode category dropdown omits category F, which exists on the C3.31 chart.

## Remaining — ui

- [ ] 🟠 **D7/D15** `ssd-pipeline/viewer/battle.html:440` — A boarding raid auto-picks the first adjacent enemy and knocks out one random system; the player chooses neither the target ship nor how many boarding parties to commit.
- [x] 🟠 **E5.14** `ssd-pipeline/viewer/battle.html:547` — ADD point-defense auto-fires with no lock-on requirement (and ignores the defender being on passive fire control).
- [ ] 🟠 **G7.11/G7.6** `ssd-pipeline/viewer/battle.html:1658` — Tractor beams can only lock the single nearest in-range unit; the player has no way to choose which of several eligible targets to tractor.
- [x] 🟠 **C12.311/C12.312/C12.313/C12.32** `ssd-pipeline/viewer/battle.html:1666` — The mid-turn speed-change menu enforces none of the C12.31/.32 restrictions on number, spacing, impulse window, or deceleration magnitude.
- [ ] 🟠 **H7.134/H7.342** `ssd-pipeline/viewer/battle.html:1834` — Reactive reserve-power shield reinforcement is offered only in solo mode; a multiplayer defender never gets the H7.134 prompt.
- [ ] 🟡 **C6.0/C6.21** `ssd-pipeline/viewer/battle.html:190` — There is no High Energy Turn control anywhere, so the player cannot execute an HET snap-turn as a decision.
- [ ] 🟡 **C8.0/C8.10** `ssd-pipeline/viewer/battle.html:1700` — No Emergency Deceleration control — the player cannot declare a C8.0 emergency stop during the impulse phase.

