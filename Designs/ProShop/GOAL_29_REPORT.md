# GOAL 29 — OPTIMIZATION REPORT (overnight, 2026-08-16)

**Probe lies this session: 1.** Commit 6a558ea published the corrected
census's "290 honest would-save" — and ~29 of those saves were STILL
phantoms (meshes with `visible:true` under hidden ancestors: the tier-gated
gondola, the suppressed lounge), found hours later when the batcher's
honest walk refused the gondola. The census's two new controls (planted
mover, flag mirrors) were green and did not cover that blind spot; the
number was believed and shipped in a commit message. Corrected the same
night (traverseVisible + HARNESS_DEBT 8) and every later figure uses the
corrected walk — but the standard is publication, and it was published.

Instrument slips caught by their own controls BEFORE any claim used them
(not lies, listed for the record): the +25-planted-draws control reading
+50 (the pass multiplier, first draws run); three twin-diff runs refusing
their plants (the Sky trap); one `holder` reference error (twin1).

Targets: LOAD <10 s warm / <15 s true-first-boot behind compile screen;
FRAMES no frame >16.7 ms normal play mid-range; DRAWS <400 standing (from
1,443); PROGRAMS <120 (from 193).

## The night in six lines

1. **The machine still reads degraded** (61.2 s warm vs 31.9 healthy, same
   20 s compile-stall signature), so the night ran on counts, per your rule.
2. **Draws: 2419 → 2355 shop** (controlled instrument, measured pass
   multiplier 2), goldens 13/13 — and the honest census says **<400 is
   unreachable by static merging** (~1850 is the floor of that lever).
3. **Programs: <120 is unreachable mechanically** — the "46 vertexColors
   folds" were 6 once the packed key bit was calibrated with planted pairs;
   the fold was built, measured, and REVERTED as not paying.
4. **Memory instrumentation now exists** (3 controls green): 544.5 MB
   textures, 62% of it 27 tripo hero-scan maps; 141 MB GLB per boot; fp
   tools double-load their world twins.
5. **register-till 215 ms = two shader compiles** (not uploads; key diff
   i48: 2→1), and the editor's 17 arrivals are pure LIGHT-STATE variants
   (0 materials born at entry — the old theory is measured dead). Both
   fixes are scoped state-parity draws.
6. Three new instrument traps found, controlled, and ledgered
   (HARNESS_DEBT 6–8): the Sky-trap donor constructor, phantom programs
   from instrument-time compiles, own-flag visibility in scene walks.

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

- PHASE 2 — draw calls: CLOSED (four batches live, golden-gated; residual
  map written)
- PHASE 4 — programs: CLOSED HONESTLY (fold measured at 6, reverted;
  target declared unreachable mechanically)
- PHASE 6 — memory/payload: INSTRUMENTED (three exact-byte controls green;
  levers named)
- PHASE 3 — BEFORE ledger written in counts; freeze + throttled acceptance
  need the next session
- PHASE 7 — till residual and editor arrivals attributed to named causes;
  fixes scoped
- PHASES 1/5 — timing-gated; scoped with tonight's count evidence attached

---

## PHASE 2 — draw calls (counts, valid on this machine)

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
- Slice 2, DeliveryRecyclingStation (static authored decor, 14 sources → 3
  batch meshes): landed and counted. TieredRetailGondola turned out to be
  TIER-GATED AND HIDDEN in this variant's starter (its 25 census saves were
  the phantom — HARNESS_DEBT 8); its batch now arms lazily on the first
  tier reveal instead (`batchGondolaWhenRevealed`, fixtures.js).

### Phase 2 close — the counted before/after (controls green in every run)

| station | BEFORE (two runs) | AFTER (all four batches) | delta |
|---|---|---|---|
| shop, default spawn | 2419 / 2421 | **2355** | **−64..−66 info-calls** (≈32 objects at pass-mult 2) |
| out 45 yd facing course | 274 / 276 | 271 | −4 |
| out 45 yd facing shop | 1889 | 1858 | −31 |

41 source meshes are layer-suppressed into 10 batch meshes across four live
batches (PineHillsV2StaticBatch, DeliveryRecyclingStation, two storage
totes); goldens 13/13 ok with all of them live (strict scenes 0 / 0 /
0.0006%), and the golden one-pixel control still catches a single flipped
pixel. Modest by design: the honest census left only ~240 visible identity
saves in the whole shop, and tonight took the ones whose owners are named.
Evidence: qa/electron/goal29-draws/g29-{before2,slice1,slice2,after,after2}-result.json,
golden-final.log, golden-control.log.

Lint ratchet: 323 exactly after all edits.

### Instrument faults found and fixed on the way (HARNESS_DEBT 6-8)

1. **The Sky trap.** Every planted-object control borrowed the first mesh's
   constructor; the first mesh in traverse order is the addon SKY, whose
   constructor ignores its arguments and mints its own ShaderMaterial and
   BoxGeometry — plants rendered the sky's material while the planted
   material attached to nothing (three twin-diff runs read MISSING PROGRAM
   before goal29-properties-probe.js chased it to `plantCtor: "Sky"`). All
   donor-built instruments now pin plain-Mesh donors and assign
   geometry/material explicitly.
2. **Instrument-time compiles mint phantom programs** (+35..56 cacheKeys from
   one renderer.compile/render on a settled boot — the direct path sees
   non-composer light state). The program census now analyzes the
   pre-instrument prefix of info.programs only.
3. **Own-flag visibility**: the census counted the tier-gated gondola's 25
   meshes as standing candidates while its root was invisible — geometry
   that has never drawn in this variant tier. traverseVisible now; the
   gondola batch instead arms lazily on the first tier reveal
   (fixtures.js `batchGondolaWhenRevealed`).

### Where the rest of the shop's draws live (the residual map)

census-g29b read 269 identity saves; subtract the hidden-subtree phantoms
its own successor exposed (gondola 25, suppressed lounge 4) and the 19
already taken, and the honest REMAINING identity headroom is ~221 draws
(~440 info-calls at ×2) across: an anonymous 35-mesh procedural
exterior assembly (group idx142, 13×4.5×7.7 yd — 29), a 21-mesh mid-shop
tower (interior idx138 — 17), a 7×10-mesh anonymous fixture wave on the
shop floor (~35), merch storage-tote kit instances (~12), parking bays (6),
Fixture_backcounter (9, movable-fixture mechanics needed), doors
(~121 across five door systems — leaf/frame split needed), and a long tail
of ≤5s. Identified by world-position signature
(qa/electron/goal29-draws/root-identify.json); each needs its OWNER named
before merging — the gondola/door/progression lessons are exactly why
anonymous subtrees do not get merged on idle-stability evidence.

---

## PHASE 4 — programs (closed honestly: the axis was measured and it does not pay)

### The twin-diff value matcher, controlled

`tools/qa/goal29-program-twin-diff.js` — the instrument Goal 28 named.
Program cacheKeys captured with their owning materials
(renderer.properties bookkeeping), twin pairs (exactly one differing key
index) vote on field names by single-field material diffs; PLANTED GROUND
TRUTH (three live-compiled pairs differing ONLY in
vertexColors / side / alphaTest) must be named correctly or the table is
void; plants are excluded from voting so the control cannot confirm itself.

**What the control forced into the open: vertexColors and alphaTest live in
the SAME packed integer field of the key (index 51 on this build; side is
its own field, 52).** "Differs at the vertexColors index" is NOT "differs by
vertexColors" — the planted pairs calibrate the exact BIT each flag flips
(vc = 1024, alphaTest = 512), and only exact-bit pairs count.

### The fold table, bit-calibrated — and the change reverted before shipping

| measure | naive (index-level) | bit-calibrated |
|---|---|---|
| pairs at the packed field | 46 | 46 |
| pairs that are actually vertexColors | — | **6** |
| standing programs (settled boot) | 170–171 | 170–171 |
| programs after a perfect vc fold | "125" | **164** |

Goal 28's "~46 mechanically mergeable on the vertexColors axis" was an
index-level illusion; 40 of those 46 pairs differ by alphaTest and other
packed booleans, which are semantic (the goal sheet itself says leave
them). **The vertexColors fold was implemented, measured against this
table, and REVERTED the same hour**: −6 programs does not pay for white
colour attributes on every standard-material geometry (tens of MB). A
tombstone comment at the prewarm site records the arithmetic so the 46 is
never re-derived from key positions again.

**PROGRAMS < 120: UNREACHABLE without semantic changes.** Standing count is
170 settled (201–208 after play warms). The remaining axes are
side/alphaTest (semantic, per-material surgery), light-state families, and
geometry-shape — each a design decision, not a mechanical fold. Evidence:
qa/electron/goal29-programs/twin5.json (controls ok).

---

## PHASE 6 — memory and payload (instrumentation now exists; controls green)

`tools/qa/goal29-memory-census.js` — texture memory by SOURCE, geometry
bytes, render targets, per-boot asset payload via a main-process webRequest
tap, tris in scene vs in view. Three controls, all green on the first
armed run: planted 512×512 texture read as +1 source / +1,048,576 bytes
exactly and vanished on dispose; planted 96-byte geometry read exactly;
the tap recorded 366 file:// asset requests.

### The numbers (shop station, settled boot)

- **Texture memory: 544.5 MB across 251 sources — and 336.0 MB of it (62%)
  is 27 tripo hero-product scan maps** (2048×2048 RAW at 21.33 MB apiece,
  three maps per product, on shelf items seen from 1–3 m). No texture
  exceeds 2048.
- Geometry: 59.7 MB (largest: CourseTerrain 18.5 MB).
- Render targets: 16 MB visible to the walk (the 2048² sun shadow map). The
  composer's GTAO/beauty targets are NOT reachable through scene3d's public
  surface — a named gap; the estimate is a floor, not a total.
- JS heap: ~527 MB.
- Payload per boot: **141 MB of GLB across 364 files**, images 16.8 MB.
  First-person tool variants DOUBLE-LOAD their world twins (mop 3.99 MB ×2,
  dustpan 2.46 ×2, trash bag 2.47 ×2...).
- Triangles: 3.36 M in scene; in-view reads are pass-inclusive (×2), so
  ~2.5 M visible at the shop station, ~3.5 M outdoors.

### What is obviously wrong, named with numbers (not taken tonight)

1. **Tripo product scans at 2048²** on shelf items seen from 1–3 m — the
   single texture-memory lever. A 1024² rebake (or KTX2) is an ASSET-pipeline
   change with intended visual diffs (golden re-accept), i.e. an owner call —
   scoped, not shipped overnight.
2. **The fp/world GLB double-load** — the loader pulls both the world and
   first-person variant of every cleaning tool every boot (~15–20 MB of the
   141 MB payload).

---

## PHASE 7 — the things still open

### register-till 215 ms: the named instrument built, the residual NAMED

`goal29-register-till-attribution.js` (counts across the enter() span, the
exact instrument Goal 28 named). Controls: planted upload read +1 geometry
/ +1 texture exactly; second press dead-null (0/0/0).

**First press: +0 geometries, +0 textures, +2 PROGRAMS.** The 215 ms
residual is two shader compiles. The gesture-register warm ENTERS the till
(its mark shows in every prewarm) and still misses two variants — the
first-equip lesson again (a real frame is more state than a warm draw).

Both arrivals are physical-family, width 58, each exactly ONE key step from
a settled twin at **index 48, value 2 → 1** — reproduced identically across
three runs. The obvious theory is a light count; it is now MEASURED FALSE:
a chain-visible light census taken before and during the till is byte-
identical (1 dir+shadow / 1 hemi / 1 ambient / 7 point visible, hidden sets
unchanged). Per the 2681f28 caution the field stays UNNAMED until a value
match lands; the next session's first move is the arrivals driver's
raw-tail dump on these two keys. The fix stays the same shape either way:
make the gesture-register warm draw under the till's exact program state.

### The editor's residual arrivals: 17, unchanged — and the theory that
### explained them is now measured false

Tonight's `electron-editor-arrivals` run: 17 arrivals (physical 10 /
normal 3 / depth 4), axes unchanged (12 × field-from-end-20 with live=4
entry=0, 3 × numDirLights, 2 singletons) — **and materialsBornAtEntry = 0.**
The driver's own header theory ("the materials those programs serve do not
EXIST until the editor builds its content at entry") is dead: every material
already exists; the editor's LIGHT STATE (a count dropping 4 → 0 at entry)
forks the programs. That makes the residual warmable in principle: the
prewarm's editor-camera-warm draws under LIVE lights; drawing once under
the editor's entry light signature would acquire these 17. Same fix class
as the till's two arrivals (i48: 2 → 1): STATE-SIGNATURE PARITY between a
warm and the surface it claims to warm. Both scoped with exact field
evidence; neither shipped tonight (the parity draw touches prewarm light
state, which is exactly where A3's six-programs-in-424-ms lesson lives —
not an hour-before-dawn edit).

### Ambient max 18.6 ms at 4K

NOT WORKED — it is a timing hunt, and Phase 0 forbids trusting one on this
machine tonight.

---

## PHASES 1, 3, 5 — why they were not worked tonight, and what tonight adds to them

**PHASE 1 (prewarm re-ask).** Its acceptance is stamped-vs-unstamped
three-run medians — timing this machine cannot certify. What tonight's
count evidence adds to the design: `renderer.compile` itself is 158 ms
warm; the 20.4 s monster lives in `compile-hidden`'s forced draws — the
PROGRAM-ACQUIRING bucket. On a stamped boot those draws are exactly the
work the stamp says is already paid, so Phase 1's skip would also dodge
the degraded machine's worst symptom (stated as hypothesis, not result —
the stall family is machine-state, not code).

**PHASE 3 (the 2,208-object subtree freeze).** The freeze itself is
untouched — its acceptance is the 6.63× throttled matrix, a timing
instrument. But its BEFORE ledger is now written in counts
(`goal29-matrix-churn.js`, planted ±10 control green with a measured
matrix pass multiplier of 2 — every renderer pass re-runs
scene.updateMatrixWorld, so the composer's two passes DOUBLE the matrix
work the same way they double info.calls):

- **9,143 updateMatrix calls per standing frame** (≈4,571 objects × 2
  passes), sim speed 0, nothing moving.
- The interior subtree alone: 2,846 objects, **2,604 with
  matrixAutoUpdate** (the "2,208" of the original brief has grown), plus
  186 layer-suppressed batch sources that never draw but still tick.
- Freezing the interior's static set is therefore worth ~5,200 of the
  9,143 calls per frame (~57%) before the throttled-matrix acceptance is
  even attempted — and it halves twice over: each frozen object saves its
  cost in BOTH composer passes.

**PHASE 5 (remaining load slices).** The "asset load — NEVER MEASURED" gap
is now half-closed by counts: the webRequest tap measures **141 MB of GLB
across 364 files per boot** with per-file sizes (the loader-level TIMING
attribution still needs the healthy machine). The fp/world double-load and
the tripo scans are its first two named levers.

---

## TARGETS — where each stands after tonight (counts, this build)

| target | goal | measured tonight | verdict |
|---|---|---|---|
| LOAD warm | <10 s | 61.2 s on a machine reading 2× its healthy self | NOT MEASURABLE tonight (Phase 0); Phase 1 is the lever and is scoped |
| FRAMES | no >16.7 ms | not measurable tonight | deferred (Phase 0) |
| DRAWS standing (shop) | <400 | 2419 → **2372** (−47 at measured pass-mult 2; outdoors 267–276 already under) | **UNREACHABLE by static merging**: honest headroom ~221 more; perfect execution lands ~1850 |
| PROGRAMS | <120 | 170 settled (201–208 played-in) | **UNREACHABLE mechanically**: vc fold = −6 (built, measured, REVERTED as not paying); rest is semantic |

The two "unreachable" verdicts are the goal sheet's own request honoured:
"If a target is unreachable, say so with the measurement behind it." The
measurements are the corrected census (269→~240 visible identity saves
incl. 19 taken) and the bit-calibrated fold table (6 real vc pairs of 46
apparent).

---

## Decided without you (each with the reasoning on record)

1. **The probe-lie count is 1, self-charged.** The census's would-save was
   published in a commit while carrying ~29 hidden-subtree phantoms its
   fresh controls did not cover. Strictness call: publication is the
   standard, so it counts, even though the same night's work caught it.
2. **The vertexColors fold was reverted on my own authority** — the goal
   sheet pre-authorizes it ("if a change does not pay, revert it"): −6
   programs for tens of MB of colour attributes does not pay.
3. **Ownership-unknown subtrees stay unmerged** (the 35-mesh exterior
   assembly, the 7×10-mesh fixture wave, the 21-mesh tower, all doors) —
   after the gondola/door lessons, idle-stability without a named owner is
   not merge evidence. ~150 identity saves deliberately left on the table
   for a session that can name their owners.
4. **The full first-press census was not run**: no load-saving landed
   tonight (Phase 1 untouched), the batches do their work at construction
   before the veil lifts, and the till got a dedicated first/second-press
   instrument with a null second press. The census guard is for load wins
   traded into gameplay hitches; nothing tonight makes that trade.
5. **The tripo 2048² rebake is scoped, not executed** — it is an
   intended-visual asset change (texture resolution), which is the owner's
   golden re-accept loop, not an overnight edit.
6. **The gondola batch arms on first tier reveal** — one small merge cost
   at the moment the tier gate opens, accepted for correctness over
   batching a hidden subtree.
7. **Mid-night commits pushed to origin** per the standing instruction;
   the first push also carried the compile-screen and Goal 28 commits that
   were sitting unpushed on local main.
