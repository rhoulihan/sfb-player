# SFB Online — Spec Build TODO

## Locked decisions (2026-06-29)
- Scope v1: **Advanced Missions tournament play**; architect for full Master Rulebook.
- Enforcement: **Authoritative referee + GM override**.
- Sessions: **Live (WebSocket lockstep) primary + async resume**; event-sourced persistence.
- Rules API: **Gated full-text for owners** (no verbatim rulebook text embedded in spec).
- Stack: Node/Express + MongoDB/Mongoose + Socket.IO, Docker/PM2 on OCI, chrsent.com gated portal (aligned to wavemax).

## Source of truth
- `SFB/ADB5412.pdf` — Captain's Edition Master Rulebook (468pp, rules A0.0–Z).
- `SFB/AMSSDs2014color.pdf` — All Master SSDs color (148pp).
- `SFB/SFBBasicSetSSDscolor.pdf` — Basic Set SSDs color (52pp).

## Process (brainstorming -> writing-plans)
- [x] Explore project context (SFB docs + wavemax stack)
- [x] Lock the 4 architecture forks (AskUserQuestion)
- [x] Get approval on decomposition + production plan (full depth, SVG+1 interactive)
- [x] Pre-extract rulebook -> per-section text slices in scratchpad/source
- [x] Run spec-authoring workflow (wf_f0072ef9-061): research(12) -> author(32) -> wireframes(9) -> integrate(2)
- [x] Fix consistency defects: 56 stale cross-refs (140 edits), event-vocab (ImpulseAdvanced/DiceRolled/GmOverrideApplied/DiePurpose), canonical vocabulary appendix in 00-overview
- [x] Verify wireframes (rendered all 9 via headless chrome, visually inspected — all pass)
- [x] Built + verified interactive HTML battle screen (Playwright-driven: arcs/exposed-shield/fire all work)
- [x] Spec self-review: 0 stale refs, 0 placeholders, 0 divergences, 33/33 template-conformant
- [~] User reviewing written spec
  - [x] SSD refinement v1 (faithful vector redraw) — SUPERSEDED by v2 below
  - [x] SSD refinement v2 — REAL PAGE IMAGE + CONTROL OVERLAY (final, gated to owners)
        - B3: replaced vector SsdLayout with SsdImageMap (page image + normalized hotspots bound to boxIds) + ssdImageMaps collection
        - B4: reworked to SSD Image-Overlay Editor (hotspot mapper: upload image, draw/bind/validate/publish)
        - D2: displays page image + overlay; live state as markers on hotspots; Image/Data view modes; owner-gated image URL
        - Wireframes: rebuilt D2-ssd-viewer.svg + B4-ssd-editor.svg to render a REALISTIC SSD (hex shield ring + silhouette + system boxes + DAC + tracks) as the page, with the control overlay on top
  - [x] SSD refinement v3 — REAL BOOK IMAGE + overlay (final): extracted actual Fed CA SSD (Basic Set p.14) to wireframes/assets/ssd-fed-ca.png; built D2-ssd-viewer.html that loads the real page + interactive status overlay (verified via headless render)
  - [x] Weapons/systems inventory + arcs: searched web (no authoritative dataset — ADB PDFs / sfbonline closed / community tools only) -> build ourselves from SSDs. Called out in B3; propagated to C4, D5, E6 (readiness gate), E5 (CI test)
  - [x] Systems consistency audit (drawn SSD <-> content inventory <-> control overlay): added B4 rule 9 + auditCatalogConsistency + RunSystemsAudit; fleet-wide gate in E6; CI test in E5
        - Fixed 15 pre-existing dangling wireframe refs; verified 0 leftover vector-era terms
- [x] Spec reviewed & approved by user
- [x] SSD Pipeline module spec written (docs/spec/modules/ssd-pipeline.md)

## BUILD: SSD Pipeline module (approved — "lets build it")
- [x] M0.1 Scan + orientation auto-detect -> landscape (all 8 ships; 7 landscape-native, KZI-FF flagged portrait)
- [x] M0.2 CV detector: chroma + low-chroma + connected-components + label/arc OCR -> detection.json (all 8; 179-384 boxes/ship)
- [x] M0.3 Viewer: landscape SSD + functional overlay from REAL detected boxes (verified FED-CA + KLI-D7)
- [x] M0.4 Located (title-OCR) + scanned + detected all 8 (Basic Set pp.14/16/31/33/37/41/43/45)
- [x] Tighten detector: OSD orientation (all 8 landscape incl. KZI-FF); calibrated RGB classify (shields ~130, hull, blue, weapon, sys, track); multi-SSD via raw-title (GOR-CA = 1 shared CA/BC SSD)
- [x] M0.3b B4 verify UI (viewer/verify.html): group-centric verify (~54 groups/ship), family + arc assignment, keyboard-driven, save
- [x] M0.5 Consistency audit (serve.py /api/audit): verify->save->audit proven (clean=358/358; defects flag BOX_UNVERIFIED + ARC_MISSING)
- [~] Human verification pass: FED-CA FIRST PASS done (read arcs off SSD; 43/54 groups verified, 336/358 boxes; 11 groups flagged incl. mixed-arc phasers). Remaining 7 ships + resolve FED-CA flags.
- [x] B4 editor v2 (verify.html + serve.py): mutable groups; box select (click/rubber-band); create/reassign/remove/delete groups; manual box add; group property editing
- [x] Area RESCAN for missed white/grey/shaded control boxes (serve.py border detector) — verified: KLI-D7 found 3 new incl. shaded; FED-CA 0 (all colored)
- [x] HEX FIRING-ARC EDITOR (D2.0 geometry): 6x60° base arcs + combined (FA/FX/RA/RX/RS/LS/FH/RH) + paint exceptions on hex grid; pre-toggles detected arc; Fed CA rear-row exception paints — verified
- [x] Group-aware audit (BOX_UNASSIGNED / GROUP_UNVERIFIED / ARC_MISSING) — verified
- [x] FED-CA v2 pass (group format): 54/54 groups verified, CLEAN audit; weapon arcs per D2.11 (Photon FA, PH-1 FH, L+LF & R+RF with +rear-row paint exception, RH, PH-3 360); round-trips through UI (verified via Playwright)
      Note: D2.11 — whole phaser group fires in ALL shown arcs (no per-box split needed). 4 items best-guess-inferred (flagged in report).
- [x] Plasma firing arcs (D2.34/D2.36) added to arc editor: FP/LP/RP/AP/LPR/RPR — Gorn LP/RP selectable (verified)
- [x] DAC family taxonomy (workflow wf_cddb2459): 38 families / 10 categories, every DAC-damageable system + tracked
      non-DAC (crew/boarding/tracks) + markers; each a family with a distinct color; category-grouped dropdown
      - migrateFamily(): old coarse families auto-upgrade via type text (FED-CA/KLI-D7 → 0 invalid); weapon arc = phaser/heavy-weapon (D2.11)
- [x] Overlay rendering overhaul (verify.html): opaque uniform recolor (fixes multi-shade shields); one consistent
      border; GLOBAL uniform cell size; per-group grid snap → straight rows/cols; drone racks double-width + dotted
      divider; fill-opacity slider + "cells" toggle (verified on FED-CA via Playwright)
- [x] Box labels: server OCR prefill (/api/labels, ink-gated per-box, cached boxlabels.json) → letters/numbers
      rendered on cells with per-cell contrast; EDITABLE (double-click box → prompt) + persisted in verified.json labels{}
- [ ] Verify the other 7 ships (KLI-D7/F5, KZI-CC/FF, GOR-CA/DD, FED-DD) in the B4 UI
- [ ] Persist verified inventories to B3 catalog records
- [ ] Persist verified inventories to catalog (B3 SsdTemplate/SsdImageMap records)
- Built: ssd-pipeline/{ingest.py, find_pages.py, serve.py, viewer/index.html, viewer/verify.html, data/<8 ships>/}
- Run: python3 ssd-pipeline/serve.py -> :8741/viewer/verify.html?ship=FED-CA (verify) or /viewer/index.html?ship=... (view)

## Spec section map (subsystems) — see plan message
A. Foundation/Platform  B. Rules & Content  C. Game Mechanics
D. Player Experience/UI (+ wireframes)  E. Cross-cutting/Ops/Roadmap
