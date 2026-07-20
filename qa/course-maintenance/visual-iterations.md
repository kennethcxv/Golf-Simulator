# Visual QA revisions

All passes used the deterministic Willow Creek fixture (empire seed 20260719,
property seed 872962804), Chrome at 1600x900 and DPR 1, and the normal
first-person controls. Each pass replayed the route, checked the console, and
captured action frames. Representative source captures remain in the
`iteration-*` directories; the accepted sequence is in `final-release/`.

## Iteration 1 — interaction read

| Finding | Revision |
| --- | --- |
| The route had no physical starting point. | Added the maintenance-yard work board and review interaction. |
| Inspection read like a permanent debug heatmap. | Made the overlay subtle, contextual, and fully toggleable. |
| A selected cell exposed numbers without explaining them. | Added target height and plain-language dry/hungry/disease causes. |
| The work order was difficult to scan. | Built a right-side tablet with score, equipment, inventory, and ordered steps. |
| The greens mower had no production silhouette. | Authored and integrated a correctly scaled separate-part GLB. |
| Irrigation had no physical course context. | Added heads, status, controller, hose, and real coverage. |
| Disease looked like a flat debug disk. | Replaced it with restrained value-noise discoloration and a contextual halo. |
| Tool use had no material feedback. | Added soft water, clipping, granule, soil, rake, and treatment particles. |
| Equipment state was implicit. | Added named equipment, blade state, inventory, and actionable prompts. |
| The generic tutorial competed with the new route. | Suppressed tutorial/lock hints while the maintenance route is active. |
| Save completion was ambiguous. | Kept save/load pending until a later real reload is observed. |
| Old action toasts polluted later captures. | Scoped and cleared route feedback between QA actions. |

## Iteration 2 — tool and tablet clarity

| Finding | Revision |
| --- | --- |
| The tablet overflowed vertically at 900 px. | Switched work steps and equipment to compact two-column grids. |
| Category changes were hard to compare. | Aligned the eleven score categories in a dense value grid. |
| Inspection status was easy to miss. | Added a high-contrast on/off control and focused-patch panel. |
| Tool selection did not name the held object consistently. | Unified equipment names across buttons, prompts, and action HUD. |
| Hose coverage was visible but the held nozzle was not. | Reframed the nozzle and coil inside the first-person safe area. |
| The spreader clipped the lower frame. | Corrected its scale, handle pivot, and held-camera offset. |
| The treatment tool was indistinct from the spreader. | Gave it a separate pump/tank silhouette and treatment-colored output. |
| Divot repair looked like a single click. | Exposed the quick two-stage add-mix then level flow. |
| Ball marks were too easy to confuse with disease. | Used shallow green indentations and a fork-specific prompt. |
| Footprints disappeared against bunker texture. | Increased restrained indentation contrast and localized rake feedback. |
| Result states were missing from evidence. | Added paired `b` captures after irrigation, feeding, treatment, and repairs. |
| Debris used many independent leaf objects. | Converted each bounded cluster to one vertex-colored mesh. |

## Iteration 3 — player-camera polish

| Finding | Revision |
| --- | --- |
| The rake read as a tiny one-handed prop. | Reframed the existing rake as a believable two-handed tool. |
| The ball-mark fork sat outside the useful frame. | Moved the existing fork into the lower-right hand pose. |
| The divot bucket hid the target. | Split bucket/tool framing so the damaged turf stays visible. |
| Mower feedback obscured the cut line. | Raised the implement framing and compacted the action prompt. |
| Wetness could be mistaken for a global tint. | Restricted darkening and particles to actual hose/sprinkler coverage. |
| Fertilizer response looked immediate. | Showed pending feed at application and delayed field release in simulation. |
| Treatment success had no positive read. | Added post-treatment wording and a reduced disease patch. |
| Repaired divots remained visually severe. | Swapped open damage for a leveled recovery patch. |
| Raking lacked direction. | Persisted local rake angle/lines from the real sweep path. |
| Collected debris left a target halo. | Bound halo visibility to the persisted collected state. |
| Tractor mowing did not clearly expose blade state. | Added blades-on HUD and real implement-following path updates. |
| Reinspection did not summarize completion. | Added 14/15 pending and 15/15 verified tablet states. |

## Iteration 4 — release and performance polish

| Finding | Revision |
| --- | --- |
| Initial integration reached roughly 740 draw calls. | Batched safe static siblings and shared issue/sprinkler geometry. |
| Equipment imports duplicated equivalent materials. | Deduplicated materials across the three project-owned GLBs. |
| Naive batching could absorb moving parts. | Excluded pivot-bearing wheels, reels, handles, and authored moving nodes. |
| Distant maintenance props remained rendered. | Added player-distance culling for physical maintenance groups. |
| Save encoding generated four full candidates per field. | Selected stable formats directly and cached encoded revisions. |
| The first integrated save took about 30 ms. | Added revision caching and preallocated RLE output; final save is 4.3 ms. |
| The first integrated load took about 45 ms. | Added saved-layout restore, tile topology construction, and row-band decode; final is 7.4 ms. |
| A subtle field change could reuse stale encoded data. | Invalidated save revision on every real mutation and added a regression test. |
| A changed authored course could trust stale surface data. | Added layout/surface hashing and a tested safe-rebuild migration path. |
| Short samples reported unstable resource counts. | Adopted three fixed six-second samples after a five-second warm-up. |
| A single heap reading looked like retention. | Added forced-GC checkpoints after 20/40/60 interaction cycles; the heap plateaued. |
| The final state did not explicitly prove reload. | Added “save and reload verified” only after reload count advances. |

## Accepted visual evidence

- [Work board and tablet](final-release/02-work-order.png)
- [Inspection and one-yard diagnosis](final-release/03-first-inspection.png)
- [Greens mowing and stripe](final-release/04-greens-mowing.png)
- [Irrigation](final-release/05-irrigating.png)
- [Fertilization](final-release/06-fertilizing.png)
- [Disease treatment](final-release/07-disease-treatment.png)
- [Divot repair](final-release/08-divot-repair.png)
- [Ball-mark repair](final-release/09-ball-mark-repair.png)
- [Bunker raking](final-release/10-bunker-raking.png)
- [Debris cleanup](final-release/11-debris-cleanup.png)
- [Tractor mowing](final-release/12-tractor-mowing.png)
- [Verified state after reload](final-release/14-after-reload.png)
- [Complete recorded route](final-release/maintenance-route.webm)
