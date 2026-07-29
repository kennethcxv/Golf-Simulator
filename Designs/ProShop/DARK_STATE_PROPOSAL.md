# The unpowered room is not dark — measurement and proposal

**Status: APPROVED AND IMPLEMENTED, 2026-07-29.** Option A, hemisphere only,
scale **0.40**, blended over 1.5 yd at the threshold. §6 below records what the
shipped version measures — which is not what §5 predicted, and the difference is
instructive.

Blocker 8. The walk's finding was "the room is not dark enough", and the
previous session's finding — that the cause is the two global lights rather than
the interior daylight fills — is now measured rather than asserted.

Instruments: `tools/qa/proshop-dark-state-luma.js` (the fixed-pose baseline) and
`tools/qa/proshop-world-light-contribution.js` (the A/B). Data:
`Designs/ProShop/Greybox/data/world-light-contribution.json`, captures under
`Greybox/data/world-light-contribution/`.

---

## 1. The probe was fixed first

Two faults, both of which would have produced a confident wrong answer.

**The dark-state probe could not reach an unpowered room.** It read
`ceilingLightingDiagnostics().circuitPowered`, which reports the *shell's* flag.
That flag initialises to `true` and only becomes false when the clubhouse update
runs `updateFlicker`. `tools/qa/dark-state-power-diagnosis.js` measured the gap
directly: the **sim** says unpowered from the first frame after boot — campaign
enabled, ceiling component unrestored — while the **shell** still says powered
and takes a few seconds of running to catch up. The probe's fixed 1200 ms wait
landed inside that gap, so it refused to run at all. The refusal was right; the
wait was wrong. It now reads the sim, then polls the shell until it agrees, and
fails loudly if they never do.

**The A/B measured a light that was never turned off.** `applyTimeWeather` runs
every frame from `main.js` and writes `hemi.intensity` unconditionally
(`hemi.intensity = rainy ? 0.9 : 1.0`, plus the dusk and night branches). A
plain assignment is undone before the next render. The first A/B run duly
reported the hemisphere contributing **exactly 0.0% at all six poses**, indoors
and out — not a result, a light that stayed on. Only the hemisphere came out at
zero, because nothing reassigns the ambient, and that asymmetry is what exposed
it. The probe now replaces `intensity` with an accessor for the duration of the
capture so the frame loop's write is a no-op, and asserts the pin held before
measuring anything.

> **This is a constraint on any implementation, not just on the probe.** Anything
> that scales `hemi.intensity` must run *after* `applyTimeWeather` each frame or
> it will be silently overwritten, and the symptom will be "the change did
> nothing" rather than an error.

---

## 2. What the two lights actually contribute

Unpowered `pine-hills-v2`, 10:00, no customers, fixed poses, whole-frame mean
luma (0–255).

| | as shipped | −hemisphere | −ambient | −both | left |
|---|---|---|---|---|---|
| **p1 door-in** | 167.65 | −6.0% | −1.3% | −7.8% | 154.65 |
| **p2 retail wall** | 100.76 | −39.2% | −8.3% | −54.0% | 46.34 |
| **p3 under the faulted run** | 98.69 | −56.6% | −13.2% | −80.5% | 19.20 |
| **p4 desk approach** | 114.72 | −14.7% | −3.3% | −19.2% | 92.66 |
| **interior mean** | **120.46** | | | **−40.4%** | **78.21** |
| c1 porch, outside | 51.69 | −52.9% | −10.4% | −65.1% | 18.04 |
| c2 fairway | 126.21 | −14.7% | −2.7% | −18.4% | 102.93 |
| **course mean** | **88.95** | | | **−41.8%** | **60.48** |

Shipped intensities at capture: hemisphere **0.9**, ambient **0.16**.

**The headline finding is not the one expected.** The two globals supply ~40% of
interior luma — and ~42% of *course* luma. They are not disproportionately
lighting the sealed room; they light everything about equally, because neither is
occluded by anything. The room reads bright because a windowless interior is
getting the same sky fill as open ground, and the fill is a large share of the
image everywhere.

The hemisphere is the term that matters. Ambient is 1.3–13.2% indoors and is not
worth touching on its own.

Two poses are worth calling out. **p1 (standing in the door, looking out)** barely
moves at −7.8%: that frame is dominated by real daylight through the glazing, so
whatever is done to the fill will not fix or break the threshold shot. **p3
(looking up at the dead fittings)** loses 80.5%: the ceiling the walk complained
about is almost entirely lit by these two.

### Against the two properties the walk asked to protect

| pose | | ceiling band mean (p95) | nav band mean (p95 / p05) |
|---|---|---|---|
| p2 retail wall | as shipped | 111.51 (150.2) | 91.00 (158.5 / 9.2) |
| | −both | 52.81 (85.4) | 56.52 (113.2 / 0) |
| p3 under the run | as shipped | 85.35 (137.5) | 115.72 (137.5 / 34.9) |
| | −both | 6.83 (58.4) | 11.25 (58.4 / 0) |

Removing both entirely takes p3's ceiling band to a mean of **6.8** — the panel
faces stop being readable as pale shapes, which is the thing that makes the
repair beat findable. So the answer is not "remove them". It is a scale factor,
and the measurement says roughly where the floor is: at p3 the ceiling band needs
to stay above about 12 mean to keep the fittings legible, and the nav band needs
p95 − p05 above about 6 to keep shape to walk by.

---

## 3. Does three.js give a clean way to do this?

**No.** Stated plainly, because it is the question asked.

`AmbientLight` and `HemisphereLight` are constant irradiance terms added per
fragment in the standard lighting loop. There is no shadow map, no volume, no
falloff and no occlusion for either. There is no "this light does not reach
inside that building" in the engine.

The obvious-looking escape does not work either. `Light.layers` exists, but the
renderer tests light layers against the **camera**, not against each object
(`projectObject` collects a light when `light.layers.test(camera.layers)`), so
layers cannot exclude a light from *some objects* while keeping it on others.
They can only switch the whole scene at once — which is the same thing as
changing the intensity, with extra machinery.

So every option below is a workaround, and they differ in what they cost and
what they get wrong.

---

## 4. Options

### A — Camera-inside scale on the hemisphere (cheapest)

Scale `hemi.intensity` (and optionally ambient) by an "indoorness" factor derived
from the camera position, blended over ~1.5 yd at the threshold so there is no
pop.

- **Cost to build:** small. One lerp per frame, applied after `applyTimeWeather`.
- **Runtime cost:** nil.
- **What it gets wrong:** the fill is global, so while the player is inside, the
  *course* dims too — including everything visible through the glazed door and
  the porch. p1 shows that shot is only 7.8% fill-driven, so the error is small
  where it is most visible, but it is real. Also affects the shed interior, which
  shares the globals.
- **Verdict:** the honest 80% answer. Recommended if the goal is to ship the dark
  state this cycle.

### B — Per-material indoor factor via `onBeforeCompile`

Inject a uniform into the interior's materials that scales the irradiance from
ambient and hemisphere for those surfaces only.

- **Cost to build:** moderate-to-high. Every interior material has to be patched,
  and this room already has a material canonicalisation pass and merged static
  batches that the patch has to survive. Shader recompiles on first use.
- **Runtime cost:** nil after compile.
- **What it gets right:** only interior surfaces lose the sky fill. The view out
  the door stays correct. Customers standing inside are lit correctly.
- **What it gets wrong:** nothing structural, but it is a shader fork of the
  standard material to maintain.
- **Verdict:** the correct answer, at real cost. Worth it if the dark interior is
  a recurring art direction rather than one beat.

### C — Baked light probe for the interior

Replace the global terms indoors with an authored `LightProbe`.

- **Cost to build:** highest. Needs a bake step in the Blender pipeline and a
  runtime switch, plus a re-bake whenever the room changes — and this room has
  changed twice this month.
- **Runtime cost:** nil.
- **Verdict:** not now. Right answer for a finished room, wrong answer for a
  greybox still being re-laid-out.

### D — Do nothing to the lights; darken the room's own materials

Lower the interior albedo instead of the incoming light.

- **Cost to build:** small, and it is asset work.
- **What it gets wrong:** the room stays *flatly* lit — the same lack of contrast,
  just dimmer, because the fill is still unoccluded. It changes the level without
  changing the quality of the light, and the walk's complaint was about how the
  space reads, not only how bright it is.
- **Verdict:** not a substitute; possibly a small companion to A.

---

## 5. Recommendation

**Option A**, with the hemisphere scaled and the ambient left alone, tuned
against the two floors the measurement established (p3 ceiling band mean ≥ ~12,
nav band p95 − p05 ≥ ~6) rather than to a target that "looks dark". A single
scale factor, applied after `applyTimeWeather`, blended at the threshold.

The measurement says a scale of roughly **0.35–0.45** on the hemisphere takes the
interior mean from 120 to the mid-80s while keeping p3's ceiling band well clear
of the legibility floor. That number should be set by re-running the dark-state
probe at two or three candidate factors, not chosen here.

---

## 6. What it actually does, measured (2026-07-29)

Implemented as the last statement of `applyTimeWeather`, for the reason in the
box above. `interiorFillFactor` bisects `clubhouseApi.isInside` to recover a
smooth depth across the threshold: the boolean alone gives a three-level ramp
that reads as banding when you walk through the door.

Swept by `tools/qa/proshop-interior-fill-sweep.js`
(`Greybox/data/interior-fill-sweep.json`). Scale 1.00 is the negative control —
it disables the effect and is the behaviour before this change.

| scale | in-room mean | vs control | p3 ceiling band | nav-band contrast |
|---|---|---|---|---|
| **1.00** (control) | 107.66 | — | 85.35 | 39.8 |
| 0.55 | 92.85 | −13.8% | 64.05 | 47.8 |
| **0.40 (shipped)** | **87.07** | **−19.1%** | **56.13** | **50.5** |
| 0.30 | 82.90 | −23.0% | 50.13 | 52.3 |
| 0.20 | 78.47 | −27.1% | 43.89 | 55.3 |

**§5 predicted the wrong number, and for a reason worth keeping.** It said "0.35–
0.45 takes the interior mean from 120 to the mid-80s". The four-pose mean at 0.40
is 104.2, not the mid-80s — because p1 stands in the doorway looking out, is
carried by real daylight through the glazing, and moves only 167.65 → 161.89. §2
had already said that pose was 7.8% fill-driven; §5 then averaged it in anyway.
Excluding it, the three poses that are actually inside the room land at **87.07**,
which is the mid-80s §5 meant. The figure is now reported both ways.

**The contrast goes UP, not down.** This was not predicted at all. Nav-band
contrast rises 39.8 → 50.5 as the fill falls, because what is being removed is
flat, unoccluded, everywhere-equal irradiance. The walk's complaint was that the
room reads flat, not merely that it reads bright, and this addresses the flatness
directly rather than as a side effect. Both legibility floors (ceiling p95 ≥ 12,
nav p95−p05 ≥ 6) hold at every scale swept, including 0.20 — they are not the
binding constraint, so 0.40 is chosen for the level and the contrast rather than
against a floor.

**The course is untouched, measured at the mechanism.** Outside, the indoorness
factor is 0 and the hemisphere carries 0.9 at every scale — identical to the
control. Comparing outdoor screenshots was the indirect version of this question
and kept failing on 0.05 luma of renderer noise; an end-of-run recapture at the
control scale reads 0.000 drift, so the wobble is GTAO and cloud animation, not
the change.

### Four instrument faults, caught before the numbers were used

1. **The shipped scale was read after the sweep had overwritten it**, so the first
   run reported `shippedScale: 0.2` — the last value the sweep itself had set. An
   instrument reporting its own footprint as a measurement.
2. **The clock advanced between captures.** The probe must run at 1× (the shell
   only learns the circuit is dead when the clubhouse update runs), so the sun
   moved between frames and the outdoor control drifted 56.56 → 56.62 across the
   sweep. The clock is now re-pinned before every capture.
3. **The course check had no scale.** "Must not move" failed on 0.03 of noise
   until the noise was measured — a back-to-back repeat, plus an end-of-run
   recapture at the control scale — and then replaced entirely by the exact
   mechanism check above.
4. **The nav-band floor was measuring the HUD.** The probe hid `.hud`; the chips
   are `.hud-min` and the lock hint is `.shop-lockhint`, which sits inside the
   nav-band crop. White caption text in the band meant the ">= 6 contrast" floor
   passed on the caption at every scale. A check that cannot fail is not a check.
   With the overlay hidden the band measures the room — and only then does the
   contrast-rises-as-fill-falls result appear at all.
