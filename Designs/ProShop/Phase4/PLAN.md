# Phase 4 — Materials and lighting on the v2 architecture (working plan)

Authorized 2026-07-28 (swapped order per SLICE_BRIEF §14). Scope: the room's
**architecture only** — walls, floor, ceiling, beams, trim, door/window
reveals. **Fixtures stay grey** (Phase 5). No room resize. No SIM-TIME-001 fix.
Full suite green before each commit; stop at end of phase for the walk-through.

This file is the working checklist; the phase report supersedes it.

## 0. What the architecture actually is in v2

The v2 room mixes two kinds of surface:

| Surface | Owner | State today |
|---|---|---|
| West wall, north wall, ceiling lid, 4 beams | v2 greybox (`GREY_WestWall`, `GREY_NorthWall`, `GREY_Ceiling`, `GREY_CeilingBeam_1..4`) | grey boxes |
| Corridor seal + 3 west-seal fillets | v2 greybox (`GREY_CorridorSeal`, `GREY_ReturnBackFill`, `GREY_HutchGapFill`, `GREY_HutchEastFill`) | grey boxes |
| Floor, south wall + main door, east partition, porch | v1 shell (shared meshes) | already carry the production material kit |
| Trim (chair rail, skirting), door reveals on the new walls | do not exist yet | Phase 4 adds them (v2-owned) |

So "apply the shared material library" = materialize the nine grey pieces +
author the missing trim, all riding the variant seam; the v1-shared surfaces
keep their kit materials and are audited against §8, not re-skinned. v1 stays
byte-identical.

## 1. Surface → material mapping (ART_BIBLE §7.2/§8)

All from the shared kit family table; palette hexes are §8 authority
(`ART_BIBLE_SRGB_HEX`); procedural canvas makers are fed §8 hexes directly so
the mean lands on palette at the source (no multiply drift — the §7.4.1 lesson
applies to photo sources; the makers ARE the map).

| Piece | Family | Palette | Notes |
|---|---|---|---|
| Walls above chair rail (west/north/seal) | Painted wall / plaster, rough 0.85–0.95 | Warm cream `#E8DFC9` | plaster grain map + roughness variation |
| Walls below chair rail | Lower panelling | Sage green `#9FB09A` | §8: "lower wall panelling"; panel relief via geometry only if cheap — GTAO needs a real crevice (§2.1) |
| Chair rail + skirting (new trim runs) | Medium walnut, rough 0.55–0.70 | `#6B4A2F` | §8: trim/chair rail |
| Ceiling lid | Painted ceiling, rough 0.88–0.98 | Warm cream `#E8DFC9` | kit `ceiling` slot look |
| Beams (4) | Dark walnut, rough 0.55–0.70 | `#3E2A1B` | §8: beam faces |
| Corridor seal wall | Same as walls (cream above, sage band below) | | it reads as wall, § the drawn partition |
| West-seal fillets (3) | Cabinetry, medium walnut | `#6B4A2F` | "cabinet-height fillets" per layout note |
| Door reveal (main door head/jambs on south wall are v1) | — | — | v1 owns them; v2 adds nothing unless the walk finds a seam |

Texel discipline (§7.3): walls/seal = Standing class (384 t/yd) → 512² canvas
at tile ≤ 1.33 yd; ceiling/beams = Out-of-reach (192 t/yd) → 512² at ≤ 2.67 yd
or 256² at ≤ 1.33 yd; fillets are hero-reachable (768 t/yd) → 512² at ≤ 0.67 yd.
Verify with `tools/qa/proshop-texel-density.js` (read `hit`/`tex` fields —
untextured surfaces pass rays through).

Texture memory: reuse the clubhouse's existing kit instance/textures where the
slot already exists (texture `.clone()` with a different `repeat` shares the
GPU upload — uploads key on Source, and repeat is a uniform). New canvases only
where §8 hexes differ from the kit's bases. Measure with
`tools/qa/proshop-texture-infrastructure.js` against the 150 MB reopen
threshold (TEXTURE_MEMORY_POLICY §4).

Metalness stays binary; no metallic surface in this pass (architecture is
paint/wood). No one-off materials.

## 2. Lighting

**The v2 rig gap (measured against live code):** only panel stations 03/04/07/08
fall inside the v2 envelope (01/02/05/06 sit at x −7.5/−4.1 — sealed cavity).
The full v1 shell builds under v2: its 8-panel rig hangs at y 3.11–3.175,
**above** the greybox lid (top 2.86), and the 4 budget-selected RectAreaLights
light the room *through* the lid (nothing interior casts, §2.2). Two more
leaks: the daylight fill at (−6.6, 3.4) and the retail accent PointLight at
(−7.8, −1.25) sit in cavity and spill through the west wall. Today the greybox
room is lit entirely by invisible sources — the anti-slop "no major light
leak" line fails three ways.

**Fault-state reality:** the sim knows exactly two light targets
(`ceiling:panel-02` flicker, `ceiling:panel-07` dead) and the save validator
requires exact key sets (`hasExactKeys`), so the sim is NOT touched. In v2,
panel-02 (the flicker beat) sits in cavity, and the v2 module's existing
panel-03 interaction targets `ceiling:panel-03`, which does not exist in the
sim — dead wiring; the flicker beat is currently lost in v2.

**The seam design (all in `shopLayout.js`, v1 byte-identical):**

- `CEILING_PANEL_RIG` — variant-resolved. v1: the 8 authored panels at
  `y = SHELL.h`, `simId === id`. v2: four panels at the in-envelope stations,
  `y = 2.80` (faces recessed between the beam bays), with **`simId` mapping
  the sim's flicker panel onto the in-envelope panel-03 station**
  (`{id:'panel-03', simId:'panel-02'}`; 04/07/08 map to themselves). The
  shell rig keys state lookups, flicker and repair semantics by `simId`; mesh
  names stay position-keyed. The flicker beat returns to the visible room; the
  save shape is untouched; `tests/pine-hills-v2-layout.test.js:496`'s
  "panel-02 is cavity-side — the module must not expose it" stays satisfied
  (nothing renders or interacts at the cavity station).
- `SHELL_LIGHT_PLACEMENTS` — variant-resolved daylight fills and retail-accent
  position. v2 drops the cavity fill and the sealed-north-window fill, keeps
  the office/east-window fill (service wing still has the real window), adds a
  door-glazing fill at the main door, and moves the retail accent to the
  in-envelope west retail run. The reception accent already follows the desk
  frame (variant-resolved) and needs nothing.
- v2 repair interactions re-anchored to the two FAULTED rig stations and
  retargeted to the real sim targets (`ceiling:panel-02`, `ceiling:panel-07`)
  — fixing the dead panel-03 wiring as a side effect. Labels name the fault
  ("Flickering ceiling panel", "Dead ceiling panel"), not internal ids.
- Chair-rail height on the new walls = 1.0, matching the v1 shell's wainscot
  `RAIL_Y` so the v2 west/north walls and the v1 south wall read as one
  construction.

`powered` plumbing, tier/mood scaling, the 4-panel render budget, dead-diffuser
face treatment and repair-stops-flicker semantics all come free from the shared
rig code — gating is inherited, not re-implemented. The dark-start beat
survives by construction.

**Key light (bible §3):** resolve under the five conditions. Standing policy
(§2.2, interior casters stripped) stays — so a candidate key gives directional
form, not cast shadows. Procedure: prototype a restrained warm directional
gated to `powered && !bothPanelsFaulted`, direction motivated by the panel
rows (steep, slightly south-raked); measure the §3 contact crops and whole
poses vs no-key; adopt only if it buys tonal separation without flattening or
artifacts (VALIDATE_STATUS clean, no load regression). If it cannot be gated
cleanly or measures as noise — record "resolved: no interior key light;
panels + GTAO are the room's light" and leave it out, per the authorization.

**Settle and write into the bible (§12 outputs):**

- Shadow softness: PCF reality documented as the settled value (r185 coerces
  PCFSoft→PCF; `shadow.radius` inert). No interior shadow softness exists to
  spec; sun stays PCF as configured.
- Final exposure: pick against the lit restored room + dark start (current
  ACESFilmic / 1.12 is the baseline candidate) — settled by looking, recorded
  with the comparison frames.
- Contrast target: recorded from the adopted grade at the fixed poses.

## 3. Dirt prep (the §9 grime conventions)

- The 13×8 grime grid + `reno.grime` overlay is the mechanism (§9); the v2
  fixture layout needs its own dirt plan (cells authored against v2
  DOOR_MAIN/traffic/fixtures) — grime must not paint where nobody walks (cells
  west of x −2.60 are sealed cavity in v2).
- v2 architecture meshes get UV2 + mask hooks so Phase 5 dirt drops in:
  wall/ceiling pieces carry a second UV set and accept the grime overlay
  texture without material rebuilds.
- Authored wear positions (scuffs at hand height, plinth kicks) stay the
  existing cleanup-target decals; no new dirt AUTHORING this phase (forbidden:
  "author any dirt") — infrastructure only.

## 4. Evidence plan

- **Before/after fixed poses, both variants** — `tools/qa/proshop-phase4-compare.js`:
  v1 = the ten baseline poses (control: must be pixel-stable); v2 = the six
  baseline poses inside the envelope (01/03/04/05/08/10) + four v2-authored
  poses (wide from SW-in-envelope, merch wall from aisle, cleaning route,
  floor read) — same pose set before and after, states: campaign dark-start,
  powered neglected, powered restored.
- **Performance** — BASELINE_PERFORMANCE §8 protocol: 3 sessions per
  configuration (resolves 1.7%), quiet machine, pinned seed, discard first
  sample; report mean ± CI vs the Phase 0 baseline; 10% regression rule.
- **Texture memory** — proshop-texture-infrastructure.js, sources not
  instances, vs 150 MB reopen threshold.
- **512/767** — texture-budget test green; texel probe on the new
  architecture surfaces with hit/tex verification.

## 5. Known design-change surface (tests that will move)

- `tools/qa/proshop-greybox-acceptance.js` pins `greyPresent` by NAME — mesh
  names are kept, contract survives.
- `tests/shop-reno.test.js` pins the grime plan — gains the v2 plan variant.
- Any new pinned values (rig gating, palette assertions) get their own tests.

Constraint checks before each commit: fixtures stay grey; v1 byte-identical
(suite + v1 control screenshots); no dirt authored; no resize; suite green.
