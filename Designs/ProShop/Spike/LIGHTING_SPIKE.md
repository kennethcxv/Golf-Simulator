# Interior Lighting Spike — throwaway experiment

Branch `spike/interior-lighting-test`, cut from `52013f8` (end of the Part A fixes).
**This branch is disposable and must not be merged.** Everything in it is experiment code.

**Question:** how much of the room's flat, pasted-on look is caused by the absence of
interior shadows rather than by asset quality?

**Short answer:** lighting is a real contributor but it is **not** the main one. The
crudest full-strength lighting change available made the room measurably different and
still left it looking like the same room. Assets and composition remain the larger share.
Hero-asset count should **not** go down — but the phase order should change.

---

## Method

| | |
|---|---|
| Poses | The exact ten in `Baseline/BASELINE_CAMERA_TRANSFORMS.md`, reproduced exactly |
| Capture | `tools/qa/spike-lighting-arm.js`, 1600 × 900, FOV 66, clock pinned 13:00, sim paused |
| Seed | **Fixed** — `newStarterEmpire('relaxed', 20260727)`, so all four arms share one world |
| FOV assertion | `camera.fov === walk.state.fov` checked before **every** shot; passed on all 40 |
| Perf | 3 scenarios × 2 runs per arm |
| Diff | `Designs/ProShop/Spike/diff_arms.py`; composites in `lighting/compare/` |

The poses reproduced exactly. Nothing was approximated.

Two things had to be neutralised to make the arms comparable, both capture-side only:

* **Fixed seed.** The menu's New Game path seeds with `Math.random()` (`main.js:2829`),
  which re-rolls the golf course and therefore everything visible through the windows.
* **Customers hidden per frame.** A single NPC standing in shot 02 produced a 4.2 meanAbs
  / 9 % pixel delta between two arms that were otherwise pixel-identical. That is larger
  than the entire signal of Arm 1.

**No mesh, GLB, texture or material definition was touched.** No material consolidation.

### Diff metrics

`meanAbs` mean absolute per-channel difference (0–255) · `pctDiff8` % of pixels where any
channel moved > 8 · `dLuma` mean signed luminance change, negative = darker.

---

## Arm 0 — control

Current state on the fixed seed. Interior: **6 casters and 250 receivers out of 2,191
meshes.** 20 lights. Effective shadow type `PCFShadowMap` (see Arm 1).

---

## Arm 1 — request PCFShadowMap, tune `sun.shadow.radius`

Changed `courseScene.js:677` to request `PCFShadowMap` and set `sun.shadow.radius = 4`.

**Result: a visual null. Nothing changed.**

| | mean across 10 shots |
|---|---|
| meanAbs | **0.389** |
| pctDiff8 | **0.61 %** |
| dLuma | −0.229 |

Nine of ten shots came in at ≤ 0.25 meanAbs — below perceptibility, consistent with
antialiasing noise. The single outlier (shot 08, 2.75) was inspected: the difference is
**two HUD objective toasts**, not lighting. Side-by-side:
`compare/arm0-vs-arm1-08-customer-route.png`.

Two findings, both confirming Phase 1 §11 rather than improving anything:

1. **The deprecation warning is gone** — it no longer fires on boot. That is the entire
   benefit.
2. **`sun.shadow.radius` does nothing.** three.js r185 only uses `radius` for
   `PCFSoftShadowMap` and `VSMShadowMap`; plain `PCFShadowMap` uses a fixed kernel. Since
   r185 coerces PCFSoft to PCF, **there is currently no way to soften the sun shadow by
   tuning radius.** Softening would require moving to `VSMShadowMap`, which is a different
   change with its own artefacts and was not in scope for this arm.

`shadowMapType` reads `1` in both Arm 0 and Arm 1 — the engine was already running PCF.
**Arm 1 is a correctness/hygiene fix, not a visual one.**

---

## Arm 2 — Arm 1 plus interior meshes cast and receive shadows

Inverted `interiorShadowPolicy.js` so the interior `add` funnel enables `castShadow` and
`receiveShadow` instead of stripping them.

**Coverage achieved: 2,186 of 2,191 meshes casting, 2,180 receiving** (from 6 / 250). The
"single funnel" claim in Phase 1 §1 held — one function reached essentially the whole room.

| | mean across 10 shots |
|---|---|
| meanAbs | **8.381** |
| pctDiff8 | **23.21 %** |
| dLuma | **−8.769** |

**The room got uniformly darker, and nothing became grounded.**

This is the arm I expected to be the answer, and it is not. The reason is physical and the
original code comment (`clubhouse.js:572-578`) already said it: *the sun cannot reach
under the roof.* Making interior meshes cast into the **sun's** shadow map does not create
contact shadows between objects in the room — it shadows the entire interior behind the
shell, which reads as an exposure drop. Shot 09 (floor close-up) darkened by 28.5 luma
across 61 % of pixels and gained no visible object grounding.

Side-by-side: `compare/arm0-vs-arm2-02-wide-room-overview.png`,
`compare/arm0-vs-arm2-09-floor-dirt-read.png`.

**The existing shadow-stripping policy is correct and should stay.** It is not the cause
of the flat look.

---

## Arm 3 — Arm 2 plus one warm shadow-casting key light indoors

Added a single `DirectionalLight(0xffd9a8, 2.0)` inside `interior`, positioned local
(6, 5.5, 5) aimed at (−2, 0, −1), `castShadow`, 2048² map, ortho ±14.

This is the only arm that could produce contact shadows at all, because **the eight
ceiling panels are RectAreaLights and three.js cannot cast shadows from them** — so before
this arm, no interior light in the game was capable of casting anything.

| vs | meanAbs | pctDiff8 | dLuma |
|---|---|---|---|
| Arm 3 vs Arm 0 (control) | **10.148** | **29.20 %** | −6.485 |
| Arm 3 vs Arm 2 (the key light alone) | **3.167** | **8.95 %** | **+2.284** |

**What it demonstrably bought:** a visible directional shadow band across the floor,
warm directional falloff, and specular/tonal separation on merchandise — the snack rack in
shot 07 gains legible form. The positive `dLuma` shows it puts back some of the light Arm 2
removed. Best single piece of evidence: `compare/arm2-vs-arm3-07-cleaning-route.png`.

**What it did not buy:** tight contact. Table legs and bench feet still meet the floor
without a dark contact gradient — objects read as *near* the floor, not *on* it. Shot 09,
the floor close-up, barely moved at all against Arm 2 (0.519 meanAbs, 2.55 %), which is
exactly where grounding would show if it existed.

**Caveats, reported rather than tuned away:**

* The arm emitted `THREE.WebGLProgram: Shader Error 0 — VALIDATE_STATUS false` on boot.
  Adding a second shadow-casting directional light appears to hit a shader/program problem.
  Not investigated — the arm is throwaway — but any real version of this must resolve it.
* Load time rose from ~18.4 s to **21.5 s** (+17 %), the largest single regression measured.
* The light direction corresponds to no window or fixture in the room, so its shadows are
  physically arbitrary. A production version would need motivating sources.
* The shot-04 delta against control is inflated by the **entrance doors being open** in that
  frame, not by lighting. Door state is dynamic and was not suppressed.

---

## Performance

2 runs per scenario per arm. Deltas are against Arm 0.

| Arm | scenario | avg ms | Δ | 1 % low ms | Δ | worst ms |
|---|---|---|---|---|---|---|
| 0 | idle-interior | 6.71 | — | 20.09 | — | 27.9 |
| 0 | spin-interior | 9.12 | — | 30.12 | — | 41.8 |
| 0 | entrance-sightline | 9.22 | — | 25.21 | — | 27.8 |
| 1 | idle-interior | 6.62 | −1.3 % | 19.15 | −4.7 % | 27.7 |
| 1 | spin-interior | 8.89 | −2.5 % | 29.02 | −3.7 % | 38.9 |
| 1 | entrance-sightline | 8.97 | −2.7 % | 24.03 | −4.7 % | 30.5 |
| 2 | idle-interior | 6.95 | +3.6 % | 20.70 | +3.0 % | 27.8 |
| 2 | spin-interior | 9.48 | +3.9 % | 30.05 | −0.2 % | 44.5 |
| 2 | entrance-sightline | 9.47 | +2.7 % | 26.63 | +5.6 % | 30.5 |
| 3 | idle-interior | 7.09 | **+5.7 %** | 21.35 | **+6.3 %** | 27.7 |
| 3 | spin-interior | 9.62 | **+5.5 %** | 31.09 | +3.2 % | 41.7 |
| 3 | entrance-sightline | 9.61 | +4.2 % | 25.70 | +1.9 % | 27.8 |

**The regression is real but smaller than expected, and I am flagging that rather than
celebrating it.** You predicted the lows would get worse; they did, by 2–6 %. But Phase 1
measured run-to-run variance of comparable magnitude on this same harness, and this spike
ran only 2 runs per scenario. **These deltas sit close to the noise floor and should not be
treated as precise.** Arm 1 even measured *faster* than control, which is not a real
speedup — it is the noise floor making itself visible.

What is not noise: interior draw calls roughly doubled at idle (1,454 → 3,102 in Arm 2),
and Arm 3's load time rose 3 s. A production version paying full shadow cost on a weaker
GPU would be a materially different measurement — everything here is one RTX 5080.

---

## Verdict

### Is the flat look primarily lighting or primarily assets?

**Both, and not in the proportion I implied in Phase 1.** My §10 finding — "the room reads
flat because nothing indoors casts a shadow" — was correct about the *mechanism* and
overstated as an *explanation*. Removing that constraint entirely, plus adding the missing
shadow-casting light, changed 29 % of pixels and still left a room that reads as the same
flat room.

Splitting it honestly, as judgment and not measurement:

* **Lighting: roughly a third of the problem.** Arm 3 bought directional form, warmth and a
  floor shadow. That is a genuine, visible improvement and it is cheap.
* **Assets, materials and composition: the larger remainder.** The things that made the
  baseline look pasted-on are still there under every arm — flat-shaded primitive
  silhouettes, packaging that is printed cards rather than boxes, the debris quads,
  long runs of empty pegboard, and the counter blocking the entrance sightline. No lighting
  change touches any of those.

The cleanest single proof is shot 09: the floor close-up moved 26.7 luma between control
and Arm 2 and then barely moved again for Arm 3 — the floor got *darker* but never got
*grounded*, because grounding is a property of contact, not exposure.

### What this implies for the Phase 4 hero-asset count

**The count should not go down.** Lighting did not substitute for asset quality in any arm,
so removing hero assets on the strength of a lighting fix would be unsupported.

Two recommendations that the evidence does support:

1. **Do lighting before hero assets — swap Phase 5 ahead of Phase 4.** Arm 3 showed that
   directional light and shadow make existing geometry read with more form. Every hero
   asset authored under the current flat rig will be judged, approved and possibly
   over-detailed against lighting that is about to change. Author them under the final
   lighting instead.
2. **Budget one specific technical task before either.** The room currently has no
   shadow-casting interior light and cannot have one from the ceiling panels, because
   RectAreaLights do not cast in three.js. Whatever Phase 5 does about that — a
   motivated key light, baked contact, stronger GTAO, or accepting the limitation — is a
   decision that belongs in the art bible, and it is now a known constraint rather than an
   assumption.

### What I would not conclude from this spike

* That interior shadows should be enabled in production. Arm 2 says the opposite: the
  existing suppression is correct, and the measured cost of reversing it bought nothing.
* That the performance headroom is proven. Two runs, one GPU, deltas near the noise floor.
* That `PCFShadowMap` improves anything visually. It does not. It removes a warning.

---

## Files

```
Designs/ProShop/Spike/
  LIGHTING_SPIKE.md          this report
  diff_arms.py               throwaway diff/composite tool
  lighting/arm0..arm3/       10 screenshots + arm.json per arm
  lighting/compare/          40 side-by-side composites
```

Reproduce an arm with `ARM=<n> HEADED=1 node tools/qa/run-playwright.cjs
tools/qa/spike-lighting-arm.js` on the matching commit of this branch.

---
---

# ADDENDUM — Arms 4 and 5: contact occlusion

The verdict above stands as written and is not revised. This addendum answers a narrower
question it raised but did not test: **Arm 3 gave objects form but left table legs meeting
the floor with no tight contact. Directional shadow gives form; ambient occlusion gives
grounding — and GTAO was never tested.**

| Arm | Change |
|---|---|
| **4** | Control lighting (Arm 0), GTAO pushed hard |
| **5** | Arm 3 **plus** Arm 4 |

GTAO settings for both, verified live at runtime rather than assumed:
`blendIntensity 0.4 -> 1.0`, `uniforms.radius 1.5 -> 2.4`, `samples 12 -> 24`,
denoiser radius `4 -> 2`, and **full resolution — render target 800x450 -> 1600x900**.

## Protocol changes, and what they invalidate

Three controls were added that the first pass lacked, all capture-side:

* **Doors forced closed** before every frame (`open/angle/swingTarget = 0`). Verified: every
  door angle is 0 in all 40 shots of every arm.
* **HUD toasts hidden** (`.notification-center` display:none). Verified per shot.
* **4 samples per scenario** instead of 2, as asked.

**Arms 0 and 3 were therefore re-shot** so the comparisons are like-for-like. The arm0/arm3
numbers below supersede those in the main report. **Arms 1 and 2 were not re-shot** — their
figures above come from the older, less-controlled pass, and Arm 1's conclusion (a visual
null) is unaffected because it was verified by direct inspection, not by the metric.

Shot 08 is excluded from conclusions: it frames the entrance and includes **moving outdoor
golfers and carts**, which were not suppressed. Its delta swings between 5.9 and 28.9
across comparisons of the same arms. That is the harness, not the lighting.

## A defect found on the way in — GTAO-1

**`GTAOPass` has no `radius` property.** The occlusion radius lives in
`gtaoMaterial.uniforms.radius` and is settable only through `updateGtaoMaterial()`
(`vendor/addons/postprocessing/GTAOPass.js:376-378`). So `main.js:196`'s
`gtao.radius = 0.7` on entering walk, and `main.js:221`'s `gtao.radius = 1.5` on leaving,
both write a **stray property that nothing reads**.

Captured proof from the Arm 5 run: `strayRadiusProp: 0.7` alongside `uniformRadius: 2.4`.

The real AO radius is whatever `updateGtaoMaterial` set at construction — **1.5 in every
mode**. The per-mode walk tuning has never taken effect.

**This corrects `PHASE_1_CLASSIFICATION.md` §10**, which stated "radius 0.7 in walk mode".
That was wrong; I took it from the `main.js` line without checking the API. Severity: minor,
one line, **not fixed** — but it means nobody has ever seen the walk-mode AO tuning they
thought they were shipping.

## The result: contact darkening where geometry meets the floor

Mean luminance of each crop. Lower = darker = more occlusion. Whole-frame meanAbs is the
wrong instrument here, so this measures only the contact regions.

| Contact point | arm0 control | arm3 key light | **arm4 GTAO** | **arm5 both** |
|---|---|---|---|---|
| display-table-legs | 90.6 | 53.5 | **83.1** | **48.4** |
| bench-base | 63.9 | 37.8 | **60.2** | **35.0** |
| table-legs-midroom | 100.6 | 84.7 | **94.0** | **79.0** |
| snack-rack-base | 46.9 | 40.5 | **41.8** | **36.3** |
| counter-plinth | 56.5 | 49.4 | **55.4** | **48.5** |
| shelving-base | 48.3 | 35.6 | **45.3** | **32.6** |

Six close-up strips, four arms side by side at 2x, in `lighting/contact/`.

### Answering the question directly: yes, partly — it is not purely geometric

**`contact/display-table-legs.png` is the decisive image.** In arm0 the table leg simply
*ends* where it meets the boards — there is no darkening at the join at all, which is
exactly the pasted-on symptom. In arm4 a visible occlusion pool appears around the base of
the leg and under the table. In arm5 that pool is present *and* the leg casts a directional
shadow, and it is the first frame in this whole spike where the table reads as standing on
the floor rather than floating in front of it.

So I am not going to tell you the grounding problem is purely geometric. **It is not.** The
room has been shipping with its only contact-darkening mechanism running at half resolution
and 40% blend, and turning that up produces contact that was previously absent.

### But two things temper it, and they matter

1. **Raising the radius was the wrong direction for *tight* contact.** At radius 2.4 the AO
   resolves as broad, soft, slightly blotchy pools spreading a foot or more across the
   floor — visible in the arm4 crop as patchy darkening that reads almost like staining
   rather than a crisp contact line. Tight contact wants a *smaller* radius at high
   intensity. The instruction said "radius raised" and I followed it; the honest result is
   that intensity and resolution did the useful work and radius worked against it.
2. **The remaining grounding failures are geometric, and GTAO cannot reach them.** The
   flat-bottomed meshes, absent floor bevels, and missing dust/scuff decals are all still
   there in arm5. AO darkens the air *near* a contact; it cannot invent the small-scale
   geometry that sells one. `contact/shelving-base.png` shows this — the shelf was already
   partly occluded by the wall, so the arms barely move it, while the free-standing table
   leg moves a lot.

So: **grounding is roughly half a lighting problem and half a geometry problem**, where the
main report's verdict put the whole flat-look question at about a third lighting. Contact
specifically is more lighting-fixable than the overall flatness is.

## Whole-frame deltas

| Comparison | meanAbs | pctDiff8 | dLuma |
|---|---|---|---|
| arm4 vs arm0 — GTAO alone | 6.336 | 18.07% | -3.577 |
| arm5 vs arm0 — everything | 10.748 | 34.08% | -9.168 |
| **arm5 vs arm3 — GTAO's marginal contribution** | **6.008** | **17.25%** | **-2.383** |

GTAO contributes about as much on its own (6.34) as it does on top of the key light (6.01),
so the two are close to independent rather than redundant.

## Performance — 4 samples per scenario

| Arm | idle avg / 1% low | spin avg / 1% low | entrance avg / 1% low |
|---|---|---|---|
| 0 control | 7.82 / 22.31 | 10.69 / 33.99 | 10.96 / 28.06 |
| 3 key light | 8.03 / 23.23 | 11.28 / 38.04 | 11.67 / 29.88 |
| **4 strong GTAO** | **7.78 / 22.10** | **10.62 / 34.79** | **10.95 / 29.45** |
| 5 both | 8.21 / 23.71 | 11.61 / 38.79 | 11.61 / 30.17 |

**Arm 4 is free.** Full-resolution GTAO at double samples measured indistinguishable from
the control — 7.78 vs 7.82 idle, 10.62 vs 10.69 spinning. That is reported with suspicion
rather than enthusiasm, because it contradicts the comment at `courseScene.js:722-724`
claiming the half-res optimisation saved ~5 ms/frame. Both can be true: that measurement
was taken on the **outdoor** spin route with the whole course in frame, while these are
interior scenarios behind an 80 yd draw gate with far less depth complexity. It should be
re-measured outdoors before anyone acts on it.

The interior-shadow arms (3 and 5) cost a consistent 3-8%.

**The noise floor, stated plainly.** Arm 0 measured `entrance-sightline` at **9.22 ms** in
the first pass and **10.96 ms** in this one — **19% apart on byte-identical code**. That
drift is larger than every inter-arm difference in the table above. Treat the ordering as
indicative and the magnitudes as unresolved; nothing here justifies a budget decision.

## What to take from the addendum

1. **Turn GTAO up before authoring hero assets.** It is the cheapest change tested in this
   entire spike — measurably free on interior scenes — and it is the only one that produced
   contact where none existed.
2. **Tune it for tightness, not breadth.** Full resolution and blend 1.0 earned their keep;
   radius 2.4 did not. Start from a radius at or below the shipped 1.5 and raise intensity.
3. **Fix GTAO-1 first**, or the per-mode tuning will keep silently doing nothing.
4. **The hero-asset recommendation is unchanged and slightly strengthened.** Count should
   not drop. Lighting should still precede Phase 4 — and now there is a specific, cheap
   lighting change to make first, so assets are judged against contact that actually exists.
5. **Some of the grounding work remains geometric** — floor bevels, contact dust, scuff
   decals, non-flat bottoms. AO makes those read better; it does not replace them.

## Addendum files

```
lighting/arm4/, arm5/            10 shots + arm.json each
lighting/contact/                6 four-arm contact close-ups at 2x
lighting/compare/                arm0-vs-arm4, arm0-vs-arm5, arm3-vs-arm5 side-by-sides
contact_crops.py                 throwaway crop/luma tool
```
