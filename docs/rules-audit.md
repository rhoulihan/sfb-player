# SFB Player — Rules Consistency Audit & Prioritized Checklist

_Generated from a 7-domain parallel review of the implementation against the SFB Captain's Master Rulebook
(ADB5412). Every rule number below was grep-verified in the rulebook text; code cited as `file:line`. Scope =
the cruisers actually in the game (Fed CA/CL/NCL, Klingon D7, Gorn CA, Romulan King Eagle, Kzinti CS)._

## Progress log (landed since the audit)
- ✅ **Holdability** — disruptor (E3.24) & plasma-R (FP1.311) non-holdable; discharge-if-not-fired; plasma-F `[1,1,3]`; held overload = 1/turn (E4.22). `839c7be`
- ✅ **Reactive power foundation** — reserve warp held pool + carry to batteries (H7.36) `9e19880`; async fire resolution `7a1ffcf`; reserve-power spend/cost module `cc13aa2`.
- ✅ **On-hit reactive shield reinforcement** — H7.134/342/344 modal (spec 1/pt, gen 2/pt, source toggle, reinforce-not-raise). `9bb07bf`
- ✅ **Plasma rolling delay + reserve completion** — FP1.221 roll (2, 1 for F) to stall on the final arming turn `8472b80`; FP1.222 reserve-warp completion mid-turn (R3/S2/G1/F2, warp only) `7149811`.
- ✅ **Tier 0 quick fixes + feedback damage** — disruptor overload doubled (E3.52), overloaded photon R0-1 hit 1-6 (E4.43), photon proximity auto-miss <9 → 1-4/1-3 (E4.32/33), overload **feedback damage** to the firer (E4.431/E3.54), HET 5 (C6.21), scatter-pack 6 (FD7), T-bomb 10 (M3.0). `d7284e2`
- ⏳ **Reactive power remaining:** proactive impulse allocation + queued-at-segment; on-hit modal showing queued allocations w/ adjust-override; reactive ECCM (H7.33); reactive weapon overload/capacitor (H7.54/E2.33); multiplayer defender sync.
- ✅ **Tier 1 plasma damage** — FP1.53 warhead + stepwise aging table + 32-impulse endurance (`404e8b1`); FP1.611 phaser-weakening — PD weakens, never one-shots, ADDs excluded per E5.32 (`f27de1f`).
- ⏳ **Tier 1 remaining:** drone fire-rate/warhead-by-type/endurance/reload; turn-mode-by-ship-class; acceleration limit; cloak cost; control channels; ADD-as-ammo; general-reinforcement cost/order.

## Headline

The **foundations are solid.** Verified consistent with the rulebook, cell-by-cell where charts exist:

- **Damage allocation (DAC).** The DAC table verifies against the rulebook's 25-hit worked example (D4.5);
  volley resolution, shield facing, bold-once-per-volley, leaky shields, excess-damage flow, protected
  last-boxes all correct.
- **Standard direct fire.** Phaser range-of-effect model (E1.33), photon standard to-hit + 8 damage (E4.12/13),
  disruptor standard to-hit + damage across all 7 range bands (E3.4), combined firing arcs (D2.2), hex range.
- **Energy core.** Life support by size class (B3.3), phaser capacitor (H6), batteries (H5), photon/disruptor
  arming (E4.21/E3.20), EAF balance.
- **Multi-turn arming (just built).** Photon 2+2/hold-1, plasma R/S/G arming schedules + hold, launch-gated on
  fully-armed, re-arm on launch — all match E4.21/E4.22/FP2.51.
- **Movement structure.** Sequence-of-Play order (B2.2), impulse movement chart (C1.43), sideslip (C4.1),
  speed-change announce delay (C12.36), speed-of-one.
- **Tactical intel (D17).** The D17.3 information chart is transcribed exactly across all levels A–L and the
  observer-column shifts — strong.

The gaps are concentrated in **plasma damage, drone/seeking mechanics, turn-mode-by-ship-class, overload/
proximity weapon variants, and cloak cost** — plus the two you already flagged (control channels, ADD ammo).

---

## Tier 0 — Quick correctness fixes (small, high-confidence data changes)

Mostly 1–3 line changes; each closes a verified rule mismatch.

- [ ] **Plasma-F arming schedule** — `weapon-arming.js:10` is `[1,1,1]`; FP2.51 table is **1/1/3** (hold 0). _(Bug I introduced in Phase B; GOR-CA carries two Plasma-F.)_
- [ ] **Disruptor overload damage** — `weapon-charts.js:102` is a flat `8`; E3.4 Damage(O) row is **10** (R0-1) / **8** (R2-4) / **6** (R5-8).
- [ ] **Photon proximity fuze** — `weapon-charts.js:127` is a flat hit band `[1,5]` at all ranges; E4.32 says **auto-miss below 9 hexes**, then hit **1-4** (R9-12) / **1-3** (R13-30). (Warhead 4 is correct.)
- [ ] **Overloaded photon at R0-1** — `weapon-charts.js:139` blocks below minRange 2; E4.43 says an overloaded photon **may fire at true range 0-1** (hit 1-6). (Depends on Range-0 being representable — see Tier 2 range-floor.)
- [ ] **HET energy cost** — `energy-model.js` `HET_COST = 2`; C6.21 is **5** hexes of warp energy.
- [ ] **Scatter-pack size** — `seeking.js:51` releases 4; FD7 is **six** drones.
- [ ] **Transporter-bomb warhead** — `battle.html:370` uses 20 (`MINE.warhead`); M3.0 is **10** points.
- [ ] **Held overloaded photon hold cost** — `energy-model.js` doubles the hold step (2/turn); E4.22 hold is **1/turn** regardless of overload.
- [ ] **Verify** Type-G drone-rack capacity — `drone-inventory.js:4` `G:2`; reviewer cites FD3.70 = **4 spaces**. Confirm against FD3.70 before changing (G-racks are special: they hold drones _and_ ADDs).

## Tier 1 — Core mechanics (materially distort normal cruiser play)

### Plasma damage (Gorn CA, Romulan KR — their primary offense)
- [ ] **Warhead strengths** — `seeking.js:72` `{R:40,S:20,G:12,F:5}`; FP1.53 table ≈ **R50/S30/G20/F20** at close range. _(Confirm exact values against the FP1.53 Plasma Torpedo Table / Master Weapons Chart image.)_ Code self-labels these "sandbox values."
- [ ] **Stepwise aging** — `seeking.js:37,74` uses linear `warhead − 1·hexes`; FP1.51/1.53 is a **stepwise range table** (e.g. Plasma-R stays 35 at 13 hexes, not 27). Endurance also **caps at 32 impulses** (FP1.42) — currently R can travel 40.
- [ ] **Phaser-weakening** — FP1.611: **every 2 points of phaser damage reduces the warhead by 1** (cumulative). Currently point-defense one-shot-destroys and direct-fire phasers can't weaken a torpedo at all. This is core plasma counterplay.

### Drones / seeking (Klingon D7, Kzinti CS, Fed drone racks)
- [ ] **Rack fire-rate gate** — FD3.1/FD2.5: a rack fires **one drone per turn** (no rack fires twice within ¼ turn). `battle.html:318` has no per-rack/per-turn gate — a ship can empty its magazine in one impulse.
- [ ] **Warhead by loaded type** — `battle.html:322-323` discards the shifted drone's type; every drone fires as the fixed `DRONE` spec (12). A Type-IV should deliver **24** (FD2.1).
- [ ] **Endurance in turns** — `seeking.js:20` flat 40-hex lifespan; FD2.1/2.2: endurance is **N turns** (Type-I = 3), range = speed × turns.
- [ ] **Reload rate & gate** — FD2.421: **up to 2 spaces/turn**, only if the rack **was not fired that turn**. `battle.html:645` refills the whole rack every turn with no gate.
- [ ] **Control channels (F3.21)** _(you flagged)_ — enforce seekers-guided ≤ sensor rating (6; half if not drone/plasma-armed, F3.211). `sensorRating` exists (`battle.html:1356`) but is used only for D17 intel; launches never cap guided count.
- [ ] **ADD as consumable ammo (E5.1)** _(you flagged)_ — rack holds **6** (E5.12), **one ADD/impulse** (E5.13), **no fire without lock-on** (E5.14), **2 reload sets** (E5.71). Currently a static PD rating (`pdRatingOf`, `battle.html:331`) with no ammo, cap, or lock-on gate.

### Movement / energy
- [ ] **Turn mode by ship category (C3.3)** — `movement.js:20` is a single speed curve = **category B**. Correct for KLI-D7, but **Fed CA & Gorn CA are category D** (C3.23) and are allowed to turn a hex-side too early at many speeds. Needs a category×speed turn-mode chart + per-ship category.
- [ ] **Acceleration limit (C2.21)** — a turn's speed increase is capped at **max(previous speed, 10)**; code caps only by available energy (0→31 possible). `newEafColumn` already receives `prevSpeed`.
- [ ] **General reinforcement cost & order** — D3.341: general reinforcement costs **2 energy per shield point** (code appears to apply 1:1 — verify the halving at damage time); D3.3411: general **must be spent before** specific (code does specific-first, `battle.html:1431`).

### Balance
- [ ] **Cloak energy cost (G13.21)** — `energy-model.js` `CLOAK_COST = 0`; the Romulan KR must pay a per-turn drain (~20) whether cloaked 1 or 32 impulses (G13.23). Free cloak is strictly dominant.

## Tier 2 — Advanced / optional / edge / cosmetic

- [ ] **Seeker control maintenance (F3.31)** — a controlled seeker needs active FC + lock-on + ≤35 hexes; currently seekers home forever even if the firer dies/loses lock.
- [ ] **Seeker warhead degradation vs EW/cloak (D6.36)** — impacts always deal full warhead regardless of target ECM/cloak.
- [ ] **ECM/ECCM model** — combined ECM+ECCM cap ≤ sensor rating (D6.310); ECM should **degrade** lock quality, not break it (D6.112); magnitude uses a sqrt shift chart, not linear +hex (D6.34). **Meta-note:** power-bought ECM/ECCM is itself a *Commander's-level* rule — at Basic/Standard level EW comes only from weasels/terrain/small-target, so consider whether the ECM sliders belong at this tier at all.
- [ ] **Criticals** — the default-on `criticals` toggle is a home-brew that **contradicts D8.21** (real criticals never destroy a system, only disable it until repaired). Either implement real D8.0 or relabel/default-off the home-brew.
- [ ] **Cloak ×2 no-lock range** (G13.301) — the +5 is modeled, the range-doubling when there's no lock is not.
- [ ] **Enveloping plasma (FP5), pseudo-plasma bluff (FP6), plasma shotgun (FP7), rolling delay (FP1.221)** — advanced plasma options, unimplemented.
- [ ] **Mid-turn speed-change restrictions (C12.31)** — max 4/turn, ≥8-impulse spacing, not before imp4/after imp28, decel ≤ ½ speed; **HET as an executable snap-turn** (C6.1) with mode reset.
- [ ] **Phaser once-per-turn per mount (E2.23)** — `isCharged` gates phasers on capacitor only, not `firedAt`; a phaser can fire twice in a turn if charge remains.
- [ ] **ADD/PD hit chart (E5.6)**, **Type-VI dogfight warhead/range (FD2.54/55)**, **overload range gating in fire preview** (shows eligible to range 30, resolves 0 beyond 8), **exact FH/RH arcs (D2.31)**, **Range-0 representability** (`battle-geom.js:17` floors range at 1, making every Range-0 chart column dead).
- [ ] **Specific-reinforcement over-cap** (`energy-model.js:81` caps at shield box value — D3.342 has no such cap); **down-shield specific reinforcement not voided** (D3.343).
- [ ] **Verify phaser damage grids** — the phaser to-hit/damage tables are image-only in the rulebook; `weapon-charts.js` values match domain-knowledge Master Weapons Chart but weren't grep-verifiable. Confirm against the chart image.

---

### Cross-checks that came back clean (no action)
Down-the-line DAC scoring, any-weapon hits, armor-after-shields, leaky-shield every-4th, sensor/scanner/damcon
last-box protection, photon/disruptor **standard** charts, phaser arcs, SoP order, impulse chart, D17 intel
chart, plasma **arming** (R/S/G), photon/disruptor arming & discharge, battery/capacitor/life-support.
