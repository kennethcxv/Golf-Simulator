# GOAL 29 — OPTIMIZATION REPORT (overnight, 2026-08-16)

**Probe lies this session: 0** (running count; updated as instruments are
controlled).

Targets: LOAD <10 s warm / <15 s true-first-boot behind compile screen;
FRAMES no frame >16.7 ms normal play mid-range; DRAWS <400 standing (from
1,443); PROGRAMS <120 (from 193).

---

## PHASE 0 — the machine, measured first

**VERDICT: DEGRADED. No absolute timing claim in this report stands on this
machine; the night's work is the count-verifiable phases (2, 4, 6), per the
standing order.**

One warm-tier baseline boot (same instrument, same profile, same invocation
as the Goal 27 watch): `electron-load-breakdown`, profile `gfqa-warmprof`
(GPUCache 7.2 MB intact), ambient CPU ~20% before launch.

| measure | tonight | healthy era | degraded era (Aug 15) |
|---|---|---|---|
| spawn → playable (veil gone) | **61.2 s** | 31.9 s | 49.5–69.1 s |
| worst single rAF gap | 20.6 s | — | 17.8–29.8 s |
| prewarm stall bailout | FIRED at 20.3 s | did not fire | fired every boot |

The signature is unchanged from the watch's final (refuted-remedy) era: one
pathological >20 s draw inside `compile-hidden`, an 8.4 s gap in
three-spin-frames, everything else ordinary. Both negative controls passed
(planted 400 ms stall caught at 423.4 ms; segments sum 56160 vs 56160 exact).
Evidence: `qa/electron/load-breakdown/goal29-phase0-warm1-{result.json,log}`.

Attribution of the degraded boot, for the record (counts are sound even when
seconds are not): prewarm TOTAL 33.6 s, of which compile-hidden 20.4 s (the
stall), three-spin-frames 8.4 s, assets-ready 2.3 s, renderer.compile 0.16 s.
gl-programs at prewarm close: 121.

---

## Phases worked tonight (in doc order, degraded-machine set)

- PHASE 2 — draw calls (count-verifiable): in progress
- PHASE 4 — programs (count-verifiable): queued
- PHASE 6 — memory/payload instrumentation (count-verifiable): queued
- PHASE 1/3/5/7 — deferred or partial: any timing acceptance is marked
  DEGRADED-MACHINE and does not stand as a result.

---

## PHASE 2 — draw calls (in progress; numbers below are counts, valid on this machine)

### The instrument, controlled first

`tools/qa/goal29-standing-draws.js`: renderer.info per-frame sampler, two
stations (default spawn pose untouched; 45 yd out facing course and back),
sim speed 0 + 14:00 clock pin for count stability. TWO negative controls in
every run:
- planted draws: 25 meshes, own material each — calls must rise by an exact
  integer multiple of 25 and return exactly on removal;
- the broken shape (this repo's recorded lie): the same 25 with
  layers.mask=0 — calls must NOT move (a graph-counting probe fails here).

**First run of the control corrected the instrument itself: +25 objects =
+50 calls. The composer renders the scene through 2 passes (GTAO prepass +
beauty), so `renderer.info.render.calls` counts pass-draws. The measured
pass multiplier (2) is now part of the instrument's output; every "saved
draw" saves 2 info-calls.** Second run: both controls ok, multiplier 2,
exact return. (First run's +50-vs-+25 FAIL is the instrument working, not a
probe lie — it refused its own numbers, was corrected, and re-passed.)

### Baseline (2026-08-16 overnight, this build, pine-hills-v2 starter)

| station | info calls (median) | tris | programs |
|---|---|---|---|
| shop, default spawn | **2419–2421** (two runs) | 5.08 M | 201 |
| out 45 yd facing course | 274–276 | 7.0 M | 208 |
| out 45 yd facing shop | 1889 | 5.4 M | 208 |

(The goal sheet's "1,443 standing" was an earlier build/pose on the same
whole-frame counter; tonight's controlled before/after uses the numbers
above. The goal's "under 400" at pass-multiplier 2 means ~200 unique standing
objects in the shop view.)

### The census, made honest (its old control was void)

`electron-static-stability-census` rebuilt with: a PLANTED MOVER control
(the old run reported "0 of 1566 moved" — a dead world and a live one were
indistinguishable; now an rAF-wiggled mesh must read moved or the census is
void), door contracts (ArchitecturalDoor/\*DoorFallback/MainEntranceFallback
— doors swing when used; idle stability proves nothing), a
ShopProgressionVisuals contract (it swaps MATERIALS at runtime), and the
propPlacement ENTRY-FLAG MIRRORS (the named gap): fixtureId /
liveVisualHierarchy / visibilityGated now live in root.userData where a
traversal can see them (`prepareEntry`, propPlacement.js), and the census
requires them visible (fixture 3 / live-hier 23 / vis-gated 22 found).

**Corrected honest headroom: 437 truly-static meshes (was 930), 147
materials, would-save 290 by identity, 285 by exact-value fold (was 646).**
The old figure's largest slice — Assets61to100Runtime at 194 — was entirely
mirage: movable fixtures, live visual hierarchies and visibility-gated
entries the blind walk counted as mergeable. Controls: planted mover ok,
mirrors ok. Evidence: `qa/electron/static-stability-census/census-g29.json`.

**Consequence stated plainly: DRAWS < 400 in the shop is UNREACHABLE by
static merging alone.** Perfect execution of every honest candidate is
2421 − 2×285 ≈ 1851. The remainder lives in: 1129 flagged-stable meshes
(movable fixtures, doors, checkout/delivery/sheet06 contracts, sim items —
each needs its own cohort mechanism: per-fixture batches that ride their
anchors, rebatch-on-relay, door-frame-vs-leaf splits), skinned customers,
and the multi-material/instanced sets. Scoped for a follow-up; not safe in
one night.

### Merges landed (each pixel-gated)

New module `src/render3d/staticSubtreeBatch.js` — the placed-batch pattern
with the two corrections Phase 3 (Goal 27) demanded: SHADOW FLAGS ARE PART
OF THE BUCKET KEY (the old batch silently stopped casting), and NOTHING IS
QUANTISED (the old vertex-palette fold rounds roughness/metalness into 4
stylised responses — a restyle, not a merge; here a colour fold happens only
when every other parameter is float-exact, colour moves to vertex colours,
white × c == c). Identity buckets REUSE the material object (no new
programs). uv1/uv2 survive (architecture dirt-mask channel). Suite:
tests/static-subtree-batch.test.js — 6 tests including the shadow-key
red-green (the debug key that drops shadow flags MERGES what the honest key
refuses — the defect demonstrated, the key proven to be what prevents it)
and a float32-exactness pin on the fold.

- Slice 1, PineHillsV2InteriorLayer (in-module, builder-owned exclusion set:
  fixture volumes re-cut on relay, facility-gated desk/boards, neglect and
  desk-mess restoration visuals, crooked chair, office door reveal):
  11 sources → 3 batch meshes, **−17 info calls** (2419 → 2402 shop
  station). The census promised 31 here; the builder's own mutable
  inventory shrank it to the honest 8 — a second census blind spot (facility
  gates and relay-cut volumes) recorded.
- Slice 2, TieredRetailGondola (batch after the kit lands, rides the tier
  gate; slot sockets are empty Object3Ds and survive) + 
  DeliveryRecyclingStation (static authored decor): wired, counted in the
  next boot below.

Lint ratchet: 323 exactly after all edits.
