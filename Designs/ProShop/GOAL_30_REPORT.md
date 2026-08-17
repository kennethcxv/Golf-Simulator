# GOAL 30 — THREE LEVERS, WORKED 2026-08-16 (overnight)

**Probe lies this session: 0.** Every instrument shipped with a control that
was watched working (and five of those controls caught real staging or
instrument defects before they could become published numbers — the ledger of
those catches is at the bottom, and two became HARNESS_DEBT 9 and 10).

## PHASE 0 — the machine

**DEGRADED, again — Lever A is blocked again.** Three warm boots on
`gfqa-warmprof`, same instrument and profile as every prior watch:

| run | spawn → playable | stall bailout fired at | worst single rAF gap |
|---|---|---|---|
| 1 | 36.3 s | 10.6 s | 12.1 s |
| 2 | 43.5 s | 13.3 s | 10.7+ s |
| 3 | 43.6 s | 12.0 s | — |

Median **43.5 s** against the 31.9 s healthy reference; the prewarm stall
bailout fired on ALL THREE boots (the healthy signature is that it never
fires). Milder than last night's 61.2 s — the machine is drifting back — but
the pathological single-draw stall is present in every boot and the
run-to-run spread is 7.3 s, so no timing claim stands tonight. Both boot
controls green every run (planted 400 ms stall caught; segment sum exact).
Evidence: `qa/electron/load-breakdown/goal30-phase0-warm{1,2,3}-*`.

Per the directive: Lever C first, then Lever B's count side. **Lever A was
not pulled** — it needs stamped-vs-unstamped medians on a machine that can
hold a number still. Its count-side scoping from Goal 29 stands unchanged
(warm `renderer.compile` 158 ms; the 20 s monster lives in compile-hidden's
program-acquiring mega-draws, exactly what a stamp should skip).

## LEVER C — the texture rebake. PULLED, LANDED, PUSHED (151e403).

**The goal doc's target list was wrong in a useful way.** The census's 336 MB
of tripo scans is not "shelf items": it is the outdoor groundskeeping set —
workbench, club sign, broken tee sign, shed at 3×2048² each (268 MB of the
336), plus five already-1024 props. Nine MORE outdoor tripo GLBs sat at
3×2048 on disk unloaded at the census position (golf cart, both tractors,
mower deck, rake, course sign, bucket, hand fork, hose nozzle), and the three
real shelf heroes (shoe/cap/rangefinder) carried one 2048 map each. The
policy file had already named this exact set: TEXTURE_MEMORY_POLICY §3 —
"the real texture-memory problem in this game is outside the slice."

**The decision evidence the doc demanded, before any rebake:** one live prop,
one camera, candidate atlases swapped in place between frames
(orig → 1024 → 512 → orig-restored), so framing, sun and the text overlay are
pixel-identical and the restore frame measures the ambient noise floor.
Instrument: `tools/qa/goal30-rebake-abswap.js`; frames in `qa/goal30/`.

| station | 1024 vs orig | 512 vs orig | noise floor (restore) |
|---|---|---|---|
| club sign @ 2.6 m reading distance | 3.2% px | 5.3% px | 1.6% |
| club sign @ 2.05 m walk-up limit | 2.7% px | 4.9% px | 1.2% |
| shoe @ 1.02 yd (measured) | **1.28% px** | 1.44% px | **1.20%** |

Viewed verdict (crops saved beside the frames): 1024 is indistinguishable at
both stations — at the walk-up limit I could not tell the pillar veining
apart. 512 leaves a real step (marble veining smudges, cap moldings soften)
at walk-up. The shoe at arm's length sits AT the noise floor even for 512 —
a 0.3 m object at a metre simply has no pixels left to lose. **Decision:
1024, the ceiling the fleet's other half has carried since release polish.**

**Applied** with the existing stage→validate→apply tool to all 16 files
still above the ceiling (13 outdoor at 3×2048, 3 heroes at 1×2048; tris,
materials, bounds and image counts revalidated on reimport; `Assets/` raws
untouched; `clubhouse_ext` stays excluded — the runtime loads its `_opt`
sibling). All 16 pass `tools/validate-gltf.mjs`.

**Measured after (same census, controls exact — planted texture +1 MiB
exact, planted geometry +96 B exact):**

| number | before | after |
|---|---|---|
| texture bytes, shop standing | 570,952,775 (544.5 MiB) | **369,626,183 (352.5 MiB)** |
| tripo class | 336.0 MiB / 27 sources | **144.0 MiB / 27 sources** |
| 2048-class sources | 13 | 1 (a no-mip shadow-adjacent map) |
| disk payload of the 16 | 23.6 MB | 16.0 MB |

The drop is exactly the twelve resident 2048 mip chains (−192 MiB). Largest
remaining texture owners: the 16 MiB shadow map, the 8 MiB course photo,
5.33 MiB fairway detail. **JS heap: not measurable** — `performance.memory`
is quantized on this build (527.38 "MB" before AND after; the API bucketizes
without cross-origin isolation). Goldens 13/13 with the one-pixel control
caught — the rebaked props sit outside every golden framing, so no
re-baseline was needed; the abswap frames carry the visual acceptance.

**KTX2/Basis, costed as asked:** already evaluated and REJECTED in
TEXTURE_MEMORY_POLICY §3 — the three.js Basis transcoder is an embind build
whose invokers are minted with `new Function`, which requires document-wide
`'unsafe-eval'` under the packaged app's file:// CSP (no worker-scoped
header is possible there). Reopen condition — interior slice >150 MB
measured by its own instrument — is not near tripping, and tonight's rebake
moves the whole-scene number the policy said to spend first.

## LEVER B — the matrix freeze. PULLED: 9,151 → 3,987, UNDER the 4,000 target.

Baseline re-measured tonight on the same instrument that carries the planted
±10 control: **9,151 updateMatrix/standing frame** (pass multiplier 2 —
composer prepass + beauty; the control reads +20 for 10 plants exactly).

**Stage 1 — owner-scoped freezing** (`src/render3d/matrixFreeze.js`,
`freezeStaticMatrices` with the batcher's exclusion contracts plus
characters, door/controller-key hardware, cameras/lights/rigs):
batch-suppressed sources at suppression time; the v2 greybox layer behind
its builder's own exclusion set; propPlacement entries with no fixture
anchor, no live-visual flag, no controller and no verb (its visibility gate
provably writes `visible` only, so gating alone no longer blocks); fixture
INTERNALS after the kit lands (roots stay auto — build mode re-lays them);
the outdoor putModel allowlist (shed, workbench, tool chest, both signs,
club sign, groundskeeper house — never vehicles or chore props).
Result: 9,151 → 7,565 (−17%), and an owners map naming every residual block.

That map exposed the floor: the potential-mover ledger (delivery boxes and
equipment, register, ledger book, camera-riding viewmodel rigs, markers,
stock) sums to ~2,064 objects ≈ 4,128 calls at multiplier 2 — **the 4,000
target sits BELOW what owner-scoped freezing can reach.**

**Stage 2 — the stability freeze, which is what the goal doc actually
specified** ("everything the honest census already proved bit-stable"). The
live-movers census measured an idle standing frame: of ~4,600 ticking
objects, the actual movers are the camera subtree (283 — the holstered
viewmodel rigs riding it), the sun and its target, and the rain. Everything
else is bit-stable. So: at frame 600 of active walk the scene's matrixWorlds
are snapshotted; at frame 900 everything bit-identical across that window —
minus contract movers and three named feel surfaces (register, checkout
hardware, ledger book, whose gestures play on camera at arm's length) — is
frozen and enrolled with a WATCHDOG: every frame a 400-entry round-robin
slice has position/quaternion/scale compared against freeze-time values;
any write thaws that object permanently, at worst ~7 frames late, once.
Kill switch: `__FW_DISABLE_STABILITY_FREEZE`.

1,742 objects froze; the skip ledger names every protected class (514
live-hierarchy, 409 camera/rig, 157 door/controller, 138 proxies, 123
movable fixtures, 270 feel-surface, 13 gated, 2 moved-in-window).

**The result, three runs, medians, control exact in every run:**

| state | updateMatrix / standing frame |
|---|---|
| before tonight | 9,151 |
| owner-scoped freezes | 7,565 |
| + stability freeze | **3,987 / 3,987 / 3,987** |

**The watched-fail the doc demanded, viewed:** a stability-frozen object in
the middle of the frame (the door-threshold guide lines) was written to by
code — the verb stand-in. The watchdog thawed it in 61 ms, its
matrixAutoUpdate returned, the thaw counter ticked, and the before/after
frames show the guide visibly floated up the door face while an untouched
frozen neighbour held bit-identical. Kill-switch boot: zero frozen. The
acceptance driver (`goal30-stability-freeze-acceptance.js`) carries all four
proofs; crops in `qa/goal30/`.

**What is still ticking (3,987/2 ≈ 1,990 objects), for the next session:**
the camera-riding viewmodel rigs (283 — they tick and MOVE even holstered;
the lever there is gating their update, not freezing), the register/checkout
/ledger feel surfaces (270, excluded by decision), door and controller
hardware (157), live-hierarchy propPlacement entries (514, many of which are
lamp bodies whose only live part is a light toggle — a finer flag would
free most of them), proxies and colliders (138), movable fixture roots (123).

**The 6.63× throttled-matrix acceptance is NOT claimed** — that is a timing
measurement and Phase 0 forbids it tonight. The count side is done; the
throttle run is the first thing to take on a healthy machine, right after
Lever A.

## THE THREE LEVERS, WHERE THEY LANDED

| lever | target | landed | measurement |
|---|---|---|---|
| A — prewarm re-ask | warm <15 s | **BLOCKED (machine)** | Phase 0: median 43.5 s vs 31.9 healthy, bailout fired 3/3 boots |
| B — matrix freeze | <4,000 updateMatrix/frame | **3,987, three identical medians** | churn instrument, ±10 plant control exact ×3; watched-fail viewed |
| C — texture rebake | rebake the 2048 set | **544.5 → 352.5 MiB measured** | memory census, exact-byte controls; decision frames viewed at three distances |

## Instrument catches that never became numbers (the control ledger)

1. `texture.clone()` shares its Source — assigning `.image` through a clone
   repainted the LIVE sign; the width read-back control caught 512/512/512.
   Now HARNESS_DEBT 9.
2. Two probe cuts framed the entrance's own flag-pillar dressing believing
   it was staged clones; two more framed the groundskeeper's house after
   walkEnter's anti-stuck shove moved a spawn inside a prop collider 15 yd
   down the course. Now HARNESS_DEBT 10 (stand-position readback + NDC
   projection guards required).
3. The first watched-fail cut monitored the procedural fallback door parked
   BELOW THE FLOOR (y=-2.1) — door-flag keys exist on dormant twins too;
   72 s of clip showed sealed doors while "angles" read flat zero.
4. The acceptance driver's first cut gated on post<pre updateMatrix and
   "failed" a working freeze — its pre-window had sampled a half-built
   scene (1,912/frame at 4.5 s). The baseline belongs to the dedicated
   churn instrument at full settle.
5. The churn instrument's rAF sampler self-terminated at 200 cumulative
   frames and returned null medians once the freeze-settle stretched its
   timeline; cap raised, nulls impossible.

## Items 4–6 of the extended directive

- **fp/world GLB double-load (item 4): measured NOT the same asset.** The
  world mop carries collision hulls, carry/placement sockets and the tool
  LOD; the fp twin carries 5 animation clips and a held LOD; JSON and binary
  chunks both differ (4,171,688 vs 4,169,656 bytes on the mop). "Load once"
  is false at the file level. The real seam — sharing their identical
  11-image texture payloads through content keys in CachedGLTFLoader — is
  named for a future slice, not rushed tonight.
- Items 5 (till/editor state-parity warms) and 6 (named-owner residual
  subtrees): see the session tail below / next session if the night ran out.

## Item 5 — the till's two arrivals and the editor's 17: NOT BUILT, and here is the wall

The instruction said "you named both fixes; build them." Building them hit a
precondition the 45-minute rule would not let me bulldoze:

**The till.** The prewarm ALREADY does what the named fix describes: after
the shadow-type settle it calls the real `register.enter()`, ticks the entry
animation eight frames through the composer, and leaves (label
`gesture-register-entered` in every boot's prewarm timings). The two
first-press programs arrive anyway, one packed-field step from their twins
at index 48, value 2 -> 1. That is the shadowMapType VALUE RANGE
(PCFSoft=2 -> PCF=1) — but the renderer builder carries a measured tombstone
(courseScene.js:763): declaring PCF up front floods the driver with 256
GL_INVALID_OPERATION errors, the deprecation flip is load-bearing, and the
register warm already runs AFTER the settle loop that waits for type 1. So
field 48 is NOT proven to be shadowMapType (index-level naming is exactly
the 46-fold lie from last night), and the remaining gap is some
warm-frame-vs-play-frame renderer state that a value-calibrated probe has
to name first. The alternative fix — a deferred REAL press two seconds into
play, the belt-warm pattern — is blocked by feel: enter() takes the camera
to the till, and a mid-play one-frame till flash is a regression he would
see. NOT DONE, with the calibration probe (plant materials under candidate
state pairs, diff index 48 by VALUE) as the named next step.

**The editor's 17.** Same family (pure light-state variants, zero content
born at entry, measured last night), same missing calibration. Building a
"warm under entry light-state" without knowing WHICH light-state axis the
field encodes is how a fake fix passes its own check. NOT DONE.

## Item 6 — the two named residual subtrees: measured, one closed, one designed

**Parking bays (6 draws): CLOSED — nothing to merge.** The owner is
nameable (the delivery apron builder in clubhouse.js, DeliveryReceivingSlab
through DeliveryReceivingThresholdConnector): seven meshes, seven
inline-minted materials, three of them CanvasTextures painted per-surface.
Identity buckets of one each; the batcher's no-reduction refusal would fire
on all of them. Collapsing them means repainting seven surfaces onto one
atlas — an art change, not a merge.

**Fixture_backcounter (9 draws): DESIGNED, not shipped.** The batch must
ride the movable anchor (bake relative to the fixture root so build-mode
moves carry it — the batcher's relative-matrix path already supports this),
but it needs (a) a contract waiver for ride-along descendants that carry
fixtureId (the mounted asset-62 cabinets move WITH the anchor, and the
batcher rightly refuses them today), and (b) a readiness hook that fires
after BOTH the merch kit shell and propPlacement's async cabinet mount
land, and (c) its own build-mode-move visual proof, which goldens do not
cover. Three of four "static" identifications last night were mutable;
this one does not get rushed at the end of a night.

## WHERE THE THREE NUMBERS LANDED — the plain statement

**Warm load: unchanged and unmeasurable — 43.5 s median on a machine reading
degraded for the third night** (31.9 s healthy reference; stall bailout
fired on all three boots; spread 7.3 s). Lever A stays the biggest lever in
the game and stays blocked on the machine, not on the code.

**Standing frame cost: 9,151 → 3,987 updateMatrix per frame** — under the
4,000 target, three identical run medians, the ±10 planted control exact in
every run, the watched-fail viewed frame by frame, and a kill switch proven
to zero it. The 6.63× throttled acceptance still needs a healthy machine.

**Texture memory: 544.5 → 352.5 MiB resident at the shop standing census**
(tripo class 336.0 → 144.0), controls exact to the byte, decision frames
viewed at three distances before the fleet moved, goldens untouched.

Gate at close: lint ratchet 323 exactly, vendor-models 127 up to date,
suite **3703 / 3703 / 0 fail** hands-off after all commits, goldens 13/13
twice tonight (after Lever C, after Lever B), one-pixel control caught both
times. Commits pushed: 151e403, 5d22c68, 02504ff, ac49d45, plus this report.

---

# EVENING ADDENDUM — THE PROFILE QUESTION, RE-BASELINED (2026-08-16, ~17:00)

## Part 1 — the clean-profile baseline: the split did NOT reproduce, and here is the unsoftened statement

`gfqa-warmprof` is retired aside as evidence
(`Temp\gfqa-warmprof-RETIRED-2026-08-16`). A fresh profile was stamped
through the kit's own protocol and measured: three cold, three warm.

| tier | runs | median |
|---|---|---|
| cold (fresh profile each) | 49.8 / 77.5 / 91.3 s | **77.5 s** |
| warm (clean stamped profile) | 59.1 / 73.8 / 81.5 s | **73.8 s** |

**What this game's warm load is on healthy hardware: THIS MACHINE STILL
CANNOT SAY.** One hour before these runs, the same clean-profile protocol
on the same silicon read 12.7 s warm with compile-hidden at 0.77 s. One
hour later it reads 59–81 s. The intermittent stall fired on four of six
clean-profile boots (12–18 s single gaps), so it is NOT a disease of the
retired profile — it lives on this machine and strikes fresh profiles too.
And a second signature appeared this hour that the morning's boots did not
show: 17–45 s of veil-hold AFTER prewarm completes, made of sub-2-second
frames (clean-warm2 paid 38.7 s of it with zero stalls and compile-hidden
at 0.8 s — the machine ran every frame slow rather than stalling once).
The stamp is present in every profile (checked at the leveldb level), so
this tail is not the compile screen re-running.

The 12.7 s reading from the kit hour was real and its controls were green
— it stands as proof of what this silicon can do in a quiet window, and
as the strongest evidence yet that the GAME is not the 60-second problem.
But three-nights-of-degradation-were-just-the-profile is NOT confirmed:
the machine got worse within the hour on every profile including the
retired one's replacement. The cross-machine kit run is now the only
instrument that can answer the question, which is why it exists.

## Part 2 — skipped, per its own gate

The order said "only if Part 1 confirms the split." It did not confirm.
The retired profile sits untouched for the day the comparison is worth
making on hardware that holds still.

## Part 3 — what could be re-priced honestly, and what could not

- **Standing draws: CONFIRMED unaffected.** 2,325 calls at pass
  multiplier 2 on the clean profile — the exact goal-29/30 number — with
  the planted (+25 objects = +50 calls, exact return) and suppressed-cube
  controls both green. The draws verdict stands.
- **Program count: CONFIRMED consistent** on the same instrument (202 at
  the driver's settle, matching its old-profile readings). The programs
  verdict stands.
- **The stall bailout: it still fires on clean profiles** (4 of 6 boots
  this hour). It is not protecting against something that existed only in
  the retired profile; it stays.
- **First-press census and ambient frame time: BLOCKED.** Both are timing
  measurements and this hour's machine cannot hold a number still. They
  are first in line on a clean window or the second computer.

## The target table, re-stated with tonight's knowledge

| target | old (through the retired profile) | clean-profile tonight | verdict |
|---|---|---|---|
| LOAD warm <10 s / first boot <15 s | 36–69 s "degraded machine" | 12.7 s witnessed in one quiet window; 59–81 s an hour later | **UNKNOWABLE ON THIS MACHINE — cross-machine kit run pending; the 12.7 s reading says the game itself may already be near target** |
| FRAMES no >16.7 ms | not measurable | not measurable this hour | BLOCKED (machine) |
| DRAWS <400 standing | 2,325 measured, floor ~1,950, UNREACHABLE by merging | **2,325 confirmed on clean profile** | verdict stands, profile-independent |
| PROGRAMS <120 | 170 settled, UNREACHABLE mechanically | same instrument reads consistent | verdict stands, profile-independent |
| updateMatrix <4,000/frame | 3,987 ×3 (Lever B) | counts are profile-independent | stands |
| TEXTURES | 544.5 → 352.5 MiB (Lever C) | byte census, profile-independent | stands |

Evidence: `qa/electron/load-breakdown/clean-{cold1..3,warm1..3}-result.json`,
`qa/electron/goal29-draws/clean-draws1.json`, stamp checks in this addendum.
