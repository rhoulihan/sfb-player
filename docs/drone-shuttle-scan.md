# Drone & Shuttle SSD scan — all 7 verified ships

> **Purpose.** Functional data pulled from each verified ship's SSD art (drone racks, ammo tracks,
> shuttle hit tracks, advanced/heavy-shuttle notes, refit footnotes) to spec the drone-inventory and
> shuttle-hit systems. Counts/effects only — no reproduced rules prose. Scanned per-ship from the
> `image.png` SSDs; rule references (J17.0, Y-dates, Type-A/B) are cited as facts.

## A. Drones — racks, spaces, refits, anti-drone

| Ship | Racks | Detected boxes | Space read | Refit / capacity markers | Reloads | Anti-drone (ADD) |
|---|---|---|---|---|---|---|
| **FED-CA** | 1 | 4 | 4 (single-width) | `1`…`G` end-caps | 2 (pre-Y175) / 3 (post) | via rack; 1 reload all-ADD; **no launcher** |
| **FED-CL** | 1 *(CL+ refit adds it)* | 4 | 4 | `1`…`G` | 2 / 3 | via rack |
| **FED-NCL** | 1 *(standard)* | 4 | **12 ⚠** (4×1 + 4 "double" boxes ×2) | `1`…`G` | 2 / 3 | via rack |
| **KLI-D7** | 2 | 12 | 12 (6/rack) | **Type-A → `A` (4/rack); Type-B → `B` (6/rack)** via Y175 | Type-A 1 · Type-B 2 (1/rack/turn) | **separate ADD launcher**, 6→12 rounds (B-refit Y165) |
| **KZIN-CS** | 4 | 16 | 16 (4/rack, single) | `A` end-cap per rack | — | none |
| GOR-CA | none | — | — | — | — | none (plasma) |
| ROM-KR | none | — | — | — | — | none (plasma) |

## B. Shuttles — capacity, hit tracks, HP by type

| Ship | Bays / capacity | Hit tracks | Reg HP | Advanced "A" | Heavy | Group status |
|---|---|---|---|---|---|---|
| **FED-CA** | 1 / 4 | **1 lumped** "Admin Shuttles" (32) | 6 | +2 → 8 | — | ⚠ **split → 4×8** |
| **FED-CL** | 1 / 2 | 2 split (8 ea) | 6 | +2 → 8 | — | ✅ split |
| **FED-NCL** | 1 / 4 | 4 split (8 ea) | 6 | +2 → 8 | — | ✅ split |
| **GOR-CA** | 2 / 6 | 4 reg (8) + **2 "GAS" (10)** | 6 / **8** heavy | +2 each | heavy = 8 base | ✅ split |
| **KLI-D7** | 1 / 2 | **1 lumped** "Admin Shuttles" (16) | 6 | +2 → 8 | — | ⚠ **split → 2×8** |
| **KZIN-CS** | 1 / 2 | 2 split (6 ea) | 6 | **none** (Basic Set) | — | ✅ split |
| **ROM-KR** | 1 / 4 | 4 (8 ea, unlabeled) | 6 | +2 → 8 | — | ✅ split |

**Advanced-shuttle rule** (all module SSDs; the Kzinti Basic Set is the exception): each shuttle's
last **2 boxes are "A"**, used only for advanced shuttles (post-Y179, J17.0 / Module J2). So
**regular = 6 HP, advanced = 8 HP; Gorn heavy/"GAS" = 8 base / 10 advanced.** The Kzinti Basic Set
SSD shows plain 6-HP shuttles with **no "A" boxes** → the option is SSD-edition-dependent.

## C. Other ammo (uniform across all 7)
**Probes = 5** · **Transporter bombs = 4 live + 4 dummy** (dummy = no damage; relevant to the
transporter-bomb feature).

## D. Per-ship notes (from the scans)

- **FED-CA / FED-CL / FED-NCL** — 1 drone rack each; FED-CL's rack is added by the **CL+ refit** (its
  `DRN` box is shaded as a refit item), CA/NCL standard. Reloads 2→3 at Y175, **one reload entirely
  ADDs**; no dedicated ADD launcher (ADDs ride the rack). An anti-drone to-hit reference table is
  printed (range 0/1/2/3/4+ → hit 1-2/1-3/1-4 at ranges 1/2/3, no shot at 0 or 4+).
- **KLI-D7** — 2 racks, ammo boxes are wide with A/B thresholds: **Type-A rack** (original) fills to
  the `A` mark (4 boxes/rack, 1 reload, fires 1 drone/turn total); **Type-B rack** (Y175 refit) fills
  to `B` (6 boxes/rack, 2 reloads, fires 1/rack/turn). Separate **ADD launcher** system + 12-box ADD
  ammo track (ADD added by B-refit Y165; 6 rounds pre-Y175, 12 after).
- **KZIN-CS** — 4 racks × 4 spaces (16 total), single boxes with a per-rack `A` end-cap; no ADD; no
  drone-loadout footnote (Basic Set). **SSD title is "Strike Cruiser (CS)"**, not Command Cruiser.
- **GOR-CA** — 6 shuttles across 2 bays (3 balcony positions each); 4 regular (6+2A) + 2 "GAS"
  heavy (8+2A). No drones.
- **ROM-KR** — 4 shuttles, 1 bay; 6+2A each; no drones. Shuttle rows unlabeled (auto-numbered).

## E. Open questions to resolve before speccing

1. **⭐ Drone-rack space count (the double-box question).** Readers disagree on the interstitial
   cells: FED-CA/CL → decorative (4 spaces); FED-NCL → real doubles (12 spaces); KLI-D7 → wide
   single boxes (6/rack). Same-era Fed CA/CL/NCL should match. **Decision needed: does a space = 1
   box, and do bigger drones cost 2 spaces (the "doubles" being wide-drone slots)?**
2. **Rack refits & capacity markers.** Green letters (`1`/`G`, `A`/`B`) are refit thresholds, not
   spaces. Model rack *type* (A/B) as a pre-scenario choice setting capacity + reloads + fire rate?
3. **Reloads.** Fed 2/3 (Y175) with one reload all-ADD; Klingon 1/2 (Type-A/B). Model reload count +
   the ADD-reload constraint?
4. **Advanced-shuttle HP.** Regular 6 / advanced 8 / Gorn heavy 8→10 — a per-scenario toggle
   (advanced shuttles on/off) swapping 6↔8? And normalize the Kzinti Basic SSD to 6+2A or leave at 6?
5. **Shuttle-track splitting (mechanical).** Split FED-CA (32→4×8) and KLI-D7 (16→2×8) "Admin
   Shuttles" into per-shuttle groups so every SSD has unique shuttle groups.
6. **Naming:** Kzinti SSD is **Strike Cruiser (CS)**.

## F. Build backlog (post-review)
1. Drone inventory tracking wired to the SSD ammo tracks · 2. Pre-scenario drone loadout selection UI ·
3. Drone-rack config options in `verify.html` · 4. All SSDs with shuttle hit tracks as unique groups
(split CA/D7) · 5. Advanced-shuttle hit-point rule · 6. Drone-rack loadout/refit rules.

## G. Rulebook resolutions (Master Rulebook, `SFB/ADB5412.pdf`)
Functional facts that settle the open questions (numbers only):

**Drone racks are measured in SPACES:**
| Rack type | Capacity | Notes |
|---|---|---|
| Type-A | **4 spaces** | most common; 1 launch/turn |
| Type-B | (D7 refit) | 1 launch **per rack**/turn |
| Type-E | **8 spaces** | small (type-VI) drones |
| Type-G | **2 spaces** | ADD rack (= 4 ADDs) |
| Type-F | — | shuttle-bay racks (Klingon), folded into BPV |

**Drone space cost:** standard drone (Type-I, 12-pt warhead) = **1** · heavy "two-space" drone = **2** ·
anti-drone (ADD) = **½** (so 4 ADDs = 2 spaces).

**Loadout** = fill a rack's spaces with drones by cost. **Reloads** = a full set (= total rack spaces)
drawn from cargo; ship carries N sets.

**Advanced shuttles (J17):** the "A" boxes are ignored for regular shuttles → **regular = 6 HP,
advanced = 8 HP; heavy = 8 base / 10 advanced.** → **Q1 (space model) RESOLVED.**

## H. Approved design & phasing (build order)
Decisions locked: v1 drones = **Type-I + ADD**; loadout = **presets** at a per-ship battle-setup step;
**real reloads** (finite, from cargo); rack type from SSD/MSC with verify.html override; advanced-shuttle
toggle **default off**, Kzinti Basic normalized to 6+2A.

- **Phase 1 — Shuttles:** split lumped groups (CA/D7); `shuttle-inventory.js` (HP by kind + advanced
  toggle + damage); per-shuttle HP on launched shuttles (point-defense/fire reduce it, destroy at 0).
- **Phase 2 — Drone inventory:** `drone-inventory.js` (rack capacity in spaces, space-fit, reloads).
- **Phase 3 — Loadout UI:** presets at battle setup → `launchDrone`/scatter-pack.
- **Phase 4 — verify.html:** rack type + shuttle kind config on the SSD groups.
