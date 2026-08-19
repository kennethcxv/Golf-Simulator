# Overnight report — 2026-08-20

Gate green at the end: `npm run gate` → **GATE_EXIT=0**, one-pixel control fired,
suite 3782/3783 (the one failure was a stale asset manifest, regenerated).

Two of the five blocks are fixed and measured. One is diagnosed and its premise
overturned. One is diagnosed and its design killed by its own control. And I
found a **found-false**: last night's gate was not green.

---

## Block 0 — the tool swap. FIXED. p50 122.1 ms → 14.3 ms

**You were right and the harness was wrong, and I can say exactly how.**

All 831 tool drivers in this repo swap with `walk.setTool('broom')` — a direct
API call, no keyboard, no tap/hold arbitration, no debounce. You press a key.
`src/main.js` routed that key through `beginToolKey`/`endToolKey`, and
`cycleWalkTool()` hung off **endToolKey, which runs on key UP**.

So the tool could not begin to change until you let go. Every swap cost you the
duration of your own finger before anything started, and no frame-time probe
could ever see it, because the frames in that window are 5 ms and perfectly
healthy. That is the whole of "4.2 ms median" being true and useless.

`tools/qa/tool-swap-input-to-pixel.js` is the first instrument here that presses
a key. Keydown to the frame that draws the new viewmodel, warm belt, live scene,
staged crowd, 90 ms press:

| | p50 | all nine |
|---|---|---|
| before | 122.1 ms | 108–128 |
| after | **14.3 ms** | 12–23 |
| the same swap through the API | 28.1 ms | — |
| frame intervals over the run | p50 5.6, p95 16.5, p99 21.8 | — |

The worst press now is better than the old best.

**It also discarded presses outright.** `endToolKey` only cycled if the press had
lasted under 500 ms, so any block longer than half a second turned a normal tap
into a dropped one. One run with an 8,142 ms stall in it lost seven presses in a
row. That is the other half of "the game feels laggy": not slow, *unresponsive*.

The tap/hold split survives. The tap applies at keydown; if the key is still down
at 230 ms the wheel opens and the tool you held at keydown is put back — proved
in the driver, wheel open with the broom still in hand, not assumed. **The stated
cost:** hold the belt key and you will see the next tool in hand for 230 ms
before the wheel appears. Taps outnumber holds and the tap is what felt broken,
so I took that trade; say the word and I will find another.

Both of the driver's controls failed on the first two runs and both failures were
real, not noise — the first "floor" was a cold first-equip compile at 337.8 ms,
and I was subtracting that bad floor from the injected-latency check.

### What I did NOT fix

The **sporadic multi-second block** is still there — a 12,592 ms frame in one
run, 2,118 ms landing on a single press in another. It is the same smell as your
300× washer spread and as boot times that read 45.2 / 25.2 / 16.2 s on three
identical runs. I did not find it. It is the one open thread from Block 0.

---

## Blocks 1 + 2 — the loading screen, one number. 67.3 s → ~15 s

You asked for one combined number, so: **veil lift on a stamped boot, three
runs: 14.3 / 17.5 / 14.9 s.** It was 67.3 s.

You asked what is redoing work a stamped boot has already done. Here it is.

`tools/qa/warm-stage-value.js` measures what each warm stage *buys* rather than
what it costs: boot with stages skipped, then touch every surface they exist to
protect and record the worst main-thread block, on a timer-queue recorder with a
deliberate 400 ms block as its control.

| first touch, with NO warm at all | worst block | programs minted |
|---|---|---|
| all nine belt tools | ≤ 54.3 ms | vacuum 6, mop 2 |
| Tab, the overview | 44.8 ms | 2 |
| enter the editor | 79.3 ms | 7 |
| exit the editor | 32.0 ms | 0 |
| **open the laptop** | **1,197.8 ms** | 6 |

Four stages were spending ~23 s of every boot to prevent at most 79 ms of hitch,
once, on surfaces you reach minutes in. Prewarm's compile pass and its
hidden-object reveal had grown to cover what they were written for. **belt,
belt-outdoor, editor and overview are retired. The laptop stays** — it is the
only one that still buys anything — with its budget cut 10 s → 4 s, because its
two holds carry minimum frame floors (24 and 30 frames) and at the 150 ms a frame
the thumbnail rig costs, those floors alone were 8–9.6 s.

After: the laptop's first open is **22–30 ms**, and the worst first touch
anywhere is 77–79 ms at the editor.

### Block 2, answered by retiring it rather than by reaching 9/9

`warmSummary.belt` read 1/9 because the stage spent its whole 10 s budget inside
the first tool. But `tools/qa/belt-warm-anatomy.js` equips all nine after the
veil and they cost **474 ms total, 50 ms each, minting zero programs, zero
geometries and zero textures** — on a boot where only the vacuum was ever warmed.
Its control (a second pass over the same nine) came back only 5.5% cheaper and
*failed*, which is the informative direction: there is no first-equip cost left
to warm. 9/9 would have bought nothing. The belt's worst first touch is 54 ms.

**Two void measurements on the way, both now recorded at the call site.** The
skip flag was first delivered through `addInitScript` on an already-loaded page,
so I compared two CONTROL boots and nearly reported a 20 s saving from a switch
that was not connected. Then the laptop row pressed `l` (cart lights) and the
editor check asked `scene3d.courseEditor()`, which does not exist — three
surfaces read as free on a boot where none of them opened. Every surface now
asserts it actually opened before its number counts.

**A caveat you should have:** boot time on this machine varies enormously —
three identical control boots read 45.2, 25.2 and 16.2 s. Every decision above is
taken on repeated runs, and 15 s is the median rather than a guarantee.

---

## Block 3 — NOT DONE, and the stated cause is wrong

`tools/qa/interior-fill-census.js` asks the lights directly: every light that
actually contributes, evaluated at six normals with three's own formulas, at your
eye, inside, with the ceiling repaired.

| | |
|---|---|
| up | 0.268 |
| side average | **0.378** |
| **up : side** | **0.71** — verticals get *more* |

| term | up | side |
|---|---|---|
| AmbientLight | 0.144 | 0.144 — **normal-independent** |
| HemisphereLight | 0.082 | 0.062 — 1.33 : 1 |
| PointLights | small | favour the sides here |

Ambient alone is 54% of the up total, so the smallest side:up these lights can
produce is about **0.54**. Twenty to one is arithmetically out of reach.
`interiorFillScale` (0.10 indoors) cannot get there either — it scales the
hemisphere, which is the 1.33:1 term. **Fixing the room would not have fixed the
garments.** Whatever makes a hung garment dark is local to the garment.

I could not finish it, and I will not pretend otherwise:

- `tools/qa/hung-garment-attribution.js` finds **zero hero garment meshes** in
  pine-hills-v2. `table_polos` and `rail_outer` are in `cutFixtures`, so the
  starter has no apparel display at all and the eleven garments cannot be
  re-measured in the shipping variant.
- `tools/qa/vertical-vs-horizontal-probe.js` builds six identical plates that
  differ only in shading normal. Its first shape failed its unlit control at 37%
  and the table showed why — mean luma tracked *coverage* row for row, so it was
  measuring projected area. Fixed. It then read up:side ≈ 1.0 — and its **dark
  control failed**: killing every light in the scene moved the plate from 0.6599
  to 0.6538. It is not being shaded, so that 1.0 measures nothing.

The reason is on the console and is worth knowing on its own: a
`MeshStandardMaterial` created at runtime in that room fails to link with
`FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)`.
**The clubhouse is at the texture-unit ceiling.** A probe cannot simply add a lit
material to it, and that is probably worth your attention independently.

---

## Block 4 — reference measured, design killed by its own control

**The photographs confirm one of your readings and overturn the other.**
`tools/course/wear_sample.py` sorts ground pixels in the six tracked photographs
into living turf, dying straw halo and compacted tread, and reports the ratio
*within* each frame.

| image | turf | dry | core | dry/turf | core/turf |
|---|---|---|---|---|---|
| amer_path | 0.2975 | 0.3439 | 0.4476 | 1.16 | 1.50 |
| amer_path_2 | 0.2794 | 0.3437 | 0.4881 | 1.23 | 1.75 |
| cyclepath_margin | 0.3223 | 0.3622 | 0.5157 | 1.12 | 1.60 |
| helsinki_line | 0.2604 | 0.2870 | 0.2995 | 1.10 | 1.15 |
| lisboa_organic | 0.4310 | 0.4692 | 0.7252 | 1.09 | 1.68 |
| santander_scar | 0.3232 | 0.3899 | 0.6397 | 1.21 | 1.98 |
| **median** | | | | **1.14** | **1.64** |

- **CONFIRMED:** worn ground is LIGHTER than the turf, unanimously. What ships
  today mixes toward `vec3(0.40, 0.35, 0.18)` — a dark brown — at a single
  threshold. Wrong in both of the ways you named.
- **OVERTURNED:** you expected the compacted core DARKER than the straw halo. All
  six say the reverse: the core runs **1.44× the halo**, because a tread polished
  bare is mineral soil with nothing growing on it, and that is the brightest
  thing in the scar. The halo is only dying grass. The ordering is
  **turf < halo < core**. (The classifier splits the two worn populations by
  saturation — the halo keeps a yellow tint, the tread has almost none. That is a
  definition, and I am flagging it as one.)

### Why nothing shipped in the shader

First, the acceptance driver was lying. It clicked New Game and rolled a fresh
world every boot, so two runs stood on two different courses:

| two identical runs | before pinning the seed | after |
|---|---|---|
| tee-apron p50 | 0.4431 / 0.5224 | 0.4526 / 0.4529 |
| bright tail | 1.16 / 1.129 | 1.141 / 1.141 |
| hole-1 tee x | −314.07 / −313.90 | identical |

An 18% noise floor became under 0.1%. Every before/after difference I had
measured sat inside it — including one alarming frame of a fairway apparently
turned to dust, which was a different course with a different bunker, not the
change.

With the seed pinned, the honest A/B killed the design:

| station | bright tail | saturation |
|---|---|---|
| tee apron | 1.141 → 1.157 | 0.5325 → 0.4696 |
| green walk-off | 1.123 → 1.119 | 0.5037 → 0.3260 |
| **mid-fairway CONTROL** | 1.126 → **1.151** | 0.5154 → **0.4697** |

The control station moved by twenty-five times the noise floor. And the cause is
not tuning. In `visualField.js`:

```js
if (field.data[sourceOffset] !== zoneId) return exteriorStepYd;
```

**The TEE and BUNKER channels of `uSurfaceDistance` are not distances.** They are
two-valued flags — negative inside the shape, one exterior step outside it —
which is all the shader needs to antialias the shape's own edge. Reading them as
proximity gives "just outside a tee" *everywhere on the course*. An apron cannot
be authored from that field at all.

The authoring is kept as `Designs/Course/Ground/wear/two-tone-wear.patch`. The
colours in it are measured and stand; the mask it hangs on does not exist yet.
**What it needs:** a real distance transform out from the tee and green polygons,
or the sim wear channel seeded from the course vector at load — that channel is
currently zero across the whole course (max 6.4 of 100), so it carries nothing to
render either.

---

## Found false: last night's gate

The previous session reported `GATE_EXIT=0` for `aa87421` (the club wall). It was
not green. Bisected by running the golden suite against each tree:

| tree | bag-packed | stockroom-wall | exit |
|---|---|---|---|
| `aa87421~1` | 0.0752 | 0.0000 | **0** |
| `aa87421` | 4.7119 | 27.474 | **1** |

Nothing from tonight caused it. Both are now rebaselined one at a time with
`--only`, never the set, each with its reason:

- **stockroom-wall** is not a defect. The pose is misnamed — it stands at
  interior-local (0, −2.0) with yaw 0, looking along −z straight at local
  z −4.25, which is exactly where you asked for the three club racks. The new
  baseline contains those racks reading dark, so this pose will move again when
  Block 3 is fixed, correctly.
- **bag-packed** is a real shift, read from the image not the number: the
  terminal says CARD PRESENTED where the baseline says INSERTING CARD, and the
  customer's hand is down with the card on the desk. The floor plan changed under
  a scripted customer, so the walk to the counter takes a different time and the
  capture lands one phase later. Three runs measured 4.7119 / 4.7097 / 4.6776
  with identical content, which is what made it safe to accept.

`shop-floor` and all ten tool poses were left alone and still pass.

---

## Open, in the order I would take them

1. **The sporadic multi-second block.** Boot 45.2 / 25.2 / 16.2 s on identical
   runs; a 12,592 ms frame in play; 2,118 ms landing on one keypress. Unexplained,
   and it is the residue of your "generally sluggish".
2. **Block 3**, with an instrument that can actually shade a probe — which means
   working around the texture-unit ceiling, and measuring the garments on a
   variant that has an apparel rail.
3. **Block 4's mask**, which needs a genuine distance field, not the flag.
4. `bag-packed` is timing-coupled to the floor plan and will drift again the next
   time a fixture moves. It wants staging, not a baseline.
