# The lamp, first time — the shortest path a new player takes (L4)

The claim under test: a first-time player can find, understand, and finish the
starter light repair with nothing but what the world tells them. This document
walks that path surface by surface. Each rung names WHERE the information
lives; the verbatim prompt strings get captured here AFTER the O2 copy pass so
this file cannot drift stale against rewritten copy.

**The repair beat:** the furnished starter opens fully restored except the
ceiling lights — PANEL-02 is dead and PANEL-07 flickers
(`CLUBHOUSE_LIGHT_TARGET_IDS`, the starter's designed first fix).

## The path

1. **The room says something is wrong.** Two ceiling panels visibly misbehave:
   one dark, one flickering. No marker, no quest pin — the flicker is the
   invitation.
2. **The register says it in writing.** The club register on the front desk
   (west front half, `Club register - [E] read`) carries a HOUSE NOTES back
   page — turn to the last spread. On a fresh club it reads, dry as the desk
   would write it:
   - `PANEL-02 gives nothing. The ceiling circuit is dead.`
   - `PANEL-07 flickers. The wiring is on its way out.`
   A player who never looks up still finds the job in the book. When the work
   is done the page collapses to `Nothing outstanding. The house behaves.`
3. **The panel names its need.** Standing under the dead panel, the aim prompt
   (C8's first rung) names the object and the requirement:
   *dead panel → repair kit required, and where the kits live (the back room
   shelves).* [VERBATIM CAPTURE AFTER O2]
4. **The refusal teaches.** Pressing E with empty hands does not silently
   fail: the refusal toast names what to fetch and where from. [VERBATIM
   CAPTURE AFTER O2]
5. **The kit is where the prompt said.** Back-room shelving carries
   `repairkit1`; picking it up is the same X/carry verb the boxes taught.
6. **The hold-E finishes it.** Under the panel with the kit, the prompt
   becomes the repair verb; holding E runs the repair and the panel lights.
   The SECOND panel (the flicker) now reads as "the same job again" — the
   player repeats the loop unprompted.
7. **The book closes the loop.** The HOUSE NOTES page no longer lists the
   panel: the register quietly records that the house got better. This is the
   same lens the NamedGolfers spec calls the ledger to be — a record of
   progress earned in the world, deciding nothing.

## Where each rung is verified

- Rungs 3, 4, 6: `tools/qa/` C8 lamp-legibility driver (commit 3047f88) reads
  the prompt VERBATIM at each gate rung in the build.
- Rungs 2, 7: `tools/qa/house-notes.js` (L4) — fresh boot shows both panel
  notes on the register's back page; repairing PANEL-02 in the same session
  removes its line; screenshots in `qa/electron/house-notes-l4/`.
- Rung 1: the flicker/dark panels are the ceiling rig's own state
  (`lightPanels`), visible in any interior screenshot with the panels in
  frame.

## Open edges (recorded, not hidden)

- The verbatim strings in rungs 3-4 are deliberately NOT quoted yet: O2
  rewrites player copy after this lands, and a quoted prompt would go stale
  the same day. Capture them here during O2's verification run.
- The HOUSE NOTES page lists the seven architecture components too when a
  future property starts unrestored; the starter only exercises the two light
  panels.
