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
