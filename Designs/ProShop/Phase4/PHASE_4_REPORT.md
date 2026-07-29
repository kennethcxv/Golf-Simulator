# Phase 4 — Materials and lighting on the v2 architecture

**Status:** complete, awaiting the walk-through gate (SLICE_BRIEF §15: work stops for
human visual approval after the material and lighting pass).

**Scope held:** architecture only — walls, ceiling, beams, trim, the corridor seal and
the west-seal fillets. **Fixtures are still greyboxed** (Phase 5). No hero assets, no
authored dirt, no room resize, no SIM-TIME-001 fix. v1 is byte-identical: every change
rides the `?clubhouse=pine-hills-v2` variant seam, and a Node-side test pins the v1
resolution of both new layout exports.

Commits: `2b62c41` (lighting seam) → `7c075ab` (materials) → `0b68678` (key-light
resolution) → `7e0a6cd` (texel solve + audit) → this report. Full suite green
(2,413 tests) before each.

---

## 1. What the before-captures proved was wrong

The greybox room was **lit entirely by sources the player could never see**:

| Leak | Mechanism | Fixed by |
|---|---|---|
| The whole ceiling rig | The v1 eight-panel rig hangs at the 3.2-yd shell ceiling. The v2 lid is at 2.80. RectAreaLights are a global fragment term and do not occlude, so all four budget-selected panels lit the room **through an opaque ceiling** | `CEILING_PANEL_RIG` hangs the four in-envelope stations from the v2 lid |
| Daylight fill at (−6.6, 3.4) | Sits in sealed cavity west of the resized wall; a non-shadowing PointLight, so it spilled straight through | `SHELL_LIGHT_PLACEMENTS` drops it |
| Retail accent at (−7.8, −1.25) | Same — cavity-side, bleeding through the west wall | Moved to the west retail run, in-envelope |
| Fill at (3.0, −4.0) | Faked daylight from the north window the resize walled off | Dropped; a door-glazing fill replaces it at the room's one real aperture |

**The FLICKER beat — and only the flicker beat — was dead in v2.** The sim owns exactly
two light targets — `ceiling:panel-02` (flicker) and `ceiling:panel-07` (dead) — and
panel-02's authored station is cavity-side after the resize. The v2 module's repair
interaction targeted `ceiling:panel-03`, which matches no sim target at all, so the
flickering-light repair could never be completed in this room. Panel rows now carry
`simId` beside `id`: the sim's panel-02 state drives the in-envelope panel-03 station,
and the repair interactions target the real ids. The save shape is untouched (its
validator pins exact key sets).

> **Correction, 2026-07-28 — read this before citing the paragraph above.**
> The pre-Phase-4 code filtered `id === 'panel-03' || id === 'panel-07'`, so the
> **dead-panel beat (`ceiling:panel-07`) was correctly targeted before Phase 4 and is
> unchanged by it.** Phase 4 fixed the flicker beat's wiring and nothing else about
> these repairs. Any summary of this phase that says "a dead campaign beat was
> repaired" is describing the flicker beat; it must not be read as covering the dead
> panel.
>
> That distinction matters because the dead-panel repair was independently broken the
> whole time, and this phase did not find it. Pressing E on it reported "Dead ceiling
> light repaired" while the room stayed dark — the panel state really did change, but
> the ceiling **circuit** is gated separately on the structural `ceiling` component
> ("Office power and ceiling"), and with the ring dead no panel can light whatever
> state it is in. Two further holes sat beside it: `repair-light` consumed no repair
> kit at all, so one kit serviced every panel forever, and the interaction's
> availability check counted kits sealed inside unopened delivery boxes.
>
> Phase 4 verified that panels *render* and that the dark start survives; it never
> verified that completing a panel repair *changes what the player sees*. All three
> holes were found by the walk-through and fixed under Blocker 1 — see
> `../PLAYTEST_FINDINGS.md` PT-20.

---

## 2. Materials

`makeV2ArchitectureMaterials()` — a per-instance architecture kit in the repo's
procedural-canvas idiom, fed the ART_BIBLE §8 palette hexes **at the source**, so shipped
means land on palette without the §7.4.1 multiply drift (that failure belongs to photo
sources; here the maker *is* the map).

| Surface | Family | Palette | §7.3 class | Supplied | Required |
|---|---|---|---|---|---|
| Wall panelling below the rail | Sage paint | `#9FB09A` | standing | **383.8** | 384 |
| Wall field above the rail | Warm cream plaster | `#E8DFC9` | background | **256.0** | 256 |
| Chair rail | Medium walnut | `#6B4A2F` | hero | **767.8** | 768 |
| Skirting | Medium walnut | `#6B4A2F` | hero | **764.4** | 768 |
| Ceiling lid | Cream ceiling paint | `#E8DFC9` | out-of-reach | **192.0** | 192 |
| Beams ×4 | Dark walnut | `#3E2A1B` | out-of-reach | **191.9** | 192 |
| Corridor seal | Cream / sage banded | as walls | background | **255.9** | 256 |
| West-seal fillets | Medium walnut cabinetry | `#6B4A2F` | hero | **767.8** | 768 |

Walls are real banded construction — sage below, cream above, walnut rail and skirting
standing proud of the face — because GTAO only grounds a crevice that physically exists
(§2.1). The chair rail sits at **1.0 yd, the v1 wainscot's own `RAIL_Y`**, so the new
west/north walls and the inherited south wall read as one construction line around the
room.

**Texel repeats are solved, not chosen:** `repeat = required × span / mapSize`, and
deliberately fractional. This was forced by measurement — see §5.

---

## 3. Lighting, and the §3 key light

The v2 rig is four recessed emissive panels on the lid, inheriting the shared rig's
power gating, dead-diffuser treatment, tier/mood scaling and 4-panel render budget
unchanged. The dark-start campaign beat survives by construction: `powered` is still
`!campaign.enabled || repairComplete(state, 'ceiling')`.

**The interior key light — the slice's largest open question — is resolved as: there is
none.** Both candidate classes were killed by their own §3 conditions, with measurements
rather than taste:

1. **Panel-motivated steep directional.** Prototyped behind the seam, gated to
   `ceilingPowered × workingFraction × panelScale`, non-casting per §2.2. Measured at
   contact/face crops (`proshop-phase4-keylight-probe.js`): **+4–8 luma globally, biased
   to floors** — wide pose +4.1 on contact, floor and wall alike; route pose floor +7.4
   against wall face +2.7. That is §3's own Arm-2 failure (lighter everywhere,
   form-flattening), not form. With interior casters stripped, an uncast directional can
   only re-shade by N·L, and floors win.
2. **Door-motivated raking daylight.** The only direction a windowless room can motivate
   — the resize sealed every public-room window, leaving the glazed main door. A daylight
   key **cannot gate to `ceilingPowered`** without being physically wrong, failing the
   gating condition outright.

Prototype and its QA hook were removed; the probe stays as the instrument for any future
candidate. **What §3 originally wanted — cast shadow and true directional form — needs
VSM or selective interior casting, both rejected elsewhere in the bible.** If Phase 5
hero assets prove starved of form under this rig, that evidence reopens §3; nothing else
does.

### The three §12 deferrals, now settled into the bible

| Value | Settled as |
|---|---|
| Shadow softness | **None exists, by construction.** No interior caster (§2.2); sun is plain PCF with `shadow.radius` inert (§2.3). Not a tunable in this configuration |
| Final exposure | **ACESFilmic, `toneMappingExposure` 1.12** — judged across dark / powered / restored at the fixed poses; panel faces unclipped, dark start keeps usable floor detail, no state needed its own grade |
| Contrast target | **Measured anchors:** open floor 72–182 by panel proximity, cream field ~172, sage band ~99, contact bands up to ~56 below adjacent open floor. Drift beyond ~15 steps, clipped panel faces, or a collapsed contact-vs-floor gap = re-approval |

Consequence: **Phase 5 assets are judged under final lighting.** The §11
provisional-lighting flag is retired for approvals made from 2026-07-28.

---

## 4. Dirt preparation (no dirt authored)

Per the DIRT_MAP conventions, the mounting points exist and nothing is painted:

* Every architecture band mesh authors a **`uv1`** attribute (three's `aoMap` channel),
  and every architecture material carries a neutral 1×1 `aoMap`, so a Phase 5 mask lands
  without material rework.
* New facade hook **`setArchitectureDirtMask(texture)`** swaps that map across the whole
  architecture kit; `null` restores the neutral no-op.
* The existing floor-grime system is untouched and already variant-aware (its wall-dust
  banks and corner buildup read `PUBLIC_ROOM_BOUNDS`, so it does not paint into sealed
  cavity).

---

## 5. What the instruments caught (the honest part)

The texel audit is new for this phase, and it failed the work three times before it
passed:

1. **Beam faces supplied 1,417 texels/yd against a 192 requirement.** A 0.22-yd box face
   maps the whole 0–1 UV across its own extent, so any tile-based repeat ≥ 1 oversupplies
   by an order of magnitude. This is what forced solved, fractional repeats.
2. **The west-seal fillets supplied 443 — exactly √(256 × 768).** The span passed was the
   box's width while the corridor sees its depth face; the geometric mean of a mismatched
   axis pair is the signature of that bug.
3. **Two probes measured the wrong surface entirely** — the walk collider silently
   relocated the camera (−2.00 → −1.56, behind a shelf; 1.44 → 3.00, onto a production
   moulding). Caught only because §7.3 demands the `hit` field be read; the audit now
   verifies target identity per row.

And two the **instruments** got wrong about themselves:

* The texel audit's early revision gated acceptance on camera drift and reported the
  fillets **"not player-visible"** — while its own attempt log showed a stand landing 208
  samples on them. Supply is distance-independent by construction, so drift is now
  reported, not gated. A harness that manufactures a convenient finding is worse than no
  harness.
* The compare harness booted through the menu's New Game path, which seeds the world with
  `Math.random()` — the exact defect BASELINE_PERFORMANCE §8 diagnosed for the perf
  harness. Two runs of **identical v1 code** differed by a median 46 % of pixels
  (terrain through the glazing, grime seeding, customer positions). The first before/after
  pair therefore compared seeds, not work, and was thrown away. The harness now boots a
  pinned-seed empire and, per pose, hides customers, closes doors and hides the
  notification centre; every frame in §7 comes from the re-shot deterministic set, with
  the pre-Phase-4 tree served from a worktree so both sides use one instrument.

---

## 6. Performance, texture memory, and the §7.3 ceilings

### Frame time — Phase 4 costs nothing measurable

The first before/after perf pair was **discarded as environment-contaminated, and the v1
control is what caught it**: v1 — which Phase 4 does not touch — measured 40–47 % faster
in the after-session than the before-session. A control that "improves" is proof the
machine, not the code, changed. Per BASELINE_PERFORMANCE §8 a busy machine costs up to
+38 %, and the before-session's own CV values (4.2 %, 7.6 %, 8.6 %, 11.5 %) flagged
themselves as untrustworthy.

**The after-session is certified instead**, by the same control: v1-after reproduces the
Phase 0 baseline within **0.0–3.4 % on six of seven scenarios** (`laptop-open` +7.4 % is
the one outlier, and §5 of that document already records that scenario's quirks). A
quiet machine and an unchanged v1 are therefore both established.

The Phase 4 cost was then measured cleanly, A/B, on that quiet machine: the pre-Phase-4
tree (`95821a7`) served from a second worktree on port 8458, the shipped tree on 8457,
same variant, same seed, same instrument, 4 runs each with the first discarded.

| Scenario | pre-Phase-4 v2 | shipped v2 | Δ | 95 % CI (shipped) |
|---|---|---|---|---|
| idle-interior | 5.157 ms | 5.047 ms | **−2.1 %** | ± 0.137 |
| spin-interior | 8.233 ms | 8.070 ms | **−2.0 %** | ± 0.174 |
| walk-spin-interior | 7.837 ms | 7.670 ms | **−2.1 %** | ± 0.025 |
| entrance-sightline | 7.177 ms | 6.997 ms | **−2.5 %** | ± 0.162 |
| broom-sweeping | 4.393 ms | 4.433 ms | **+0.9 %** | ± 0.299 |
| live-speed16-customers | 8.487 ms | 8.223 ms | **−3.1 %** | ± 0.527 |
| laptop-open | 4.247 ms | 4.150 ms | **−2.3 %** | ± 0.090 |

**Worst case +0.9 %, against the B1 budget of +10 % and the harness's own 3 % resolution
floor — i.e. no detectable regression.** Six of seven scenarios came out slightly
faster, which is consistent with the rig change rather than luck: the v2 room now runs
**four** RectAreaLights instead of eight and one fewer daylight fill, and area lights are
a global fragment-shader term. Load time: 16.45 s → 14.88 s (B2 budget is +10 % on
18.3 s; both are under it).

For reference against Phase 0 (the v1 room, quiet machine): the shipped v2 room is
10–28 % faster on every scenario, mostly because it is smaller and its props are still
greyboxed — that is a room comparison, not a Phase 4 result, and it will move in Phase 5.

Draw calls (B4, +15 % budget): **`entrance-sightline` is 1,791 before and 1,791 after —
unchanged**, and it is the only scenario whose reading is meaningful, because it holds a
static camera. The moving-camera scenarios swing between −76 % and +67 % run to run on
identical code, which is BASELINE_PERFORMANCE §2's own warning ("instantaneous reads …
vary with what the camera happens to face; treat them as indicative, not exact") rather
than a Phase 4 effect. For room scale: the v2 room draws 1,791 at that pose against
v1's 3,051.

### Texture memory

| Bucket | Sources | Resident (RGBA8 + mips) |
|---|---|---|
| **Phase 4 architecture** | 15 | **10.67 MB** — all 256² / 512², zero over the ceiling |
| Inherited (v1 shell + shared kits) | 123 | 99.25 MB |
| **Whole interior** | 138 | **109.92 MB** against the 150 MB reopen threshold |

**512 ceiling:** the architecture passes outright. `tests/proshop-texture-budget.test.js`
reads shipped GLBs and **cannot see canvas textures at all**, so the audit is the only
check covering them. Recorded, not gated: **15 inherited sources exceed 512** — `OakSlat`
1024², `KitWalnut` 1024×512, three package labels at 640×448, the 1024×640 grime canvas
and others. They belong to the v1 shell and shared fixture/merch kits, which this phase
is not permitted to re-author (doing so would change v1). This is a pre-existing §7.3
exposure, now on the record.

**767 px/yd:** holds, and is now independently corroborated. The probe measures
1,112 px/yd at 0.58 yd and 505 px/yd at 1.35 yd; both match the analytic
`H / (2·d·tan(fov/2))` at fov 66 to within 2%, confirming the lens the requirement curve
was derived under.

---

## 7. The before/after comparison, quantified

Frames are compared by mean absolute luma difference and the share of pixels moving more
than 8/255. The **v1 control is the proof the comparison is sound**: it is the same code
on both sides, so it must not move.

| Set | Median pixels moved > 8 | Median mean-Δ luma | Reading |
|---|---|---|---|
| **v1 control** (unchanged code) | **0.16 %** | **0.23** | Unchanged, quantitatively. One frame of 30 reaches 7.0 % at mean-Δ 1.8/255 — under 1 % luma, consistent with GTAO temporal settle, not a code difference |
| **v2 subject** (Phase 4) | **74.1 %** | **43.1** | The material and lighting pass |

For scale: before the determinism fix, that same v1 control moved a median **46 %** of
pixels with mean-Δ 9.7 — the seed, not the work.

What the v2 pair shows at the wide pose: a flat grey lid and grey beams lit by a bright
wash with no visible source become a **warm cream ceiling, dark-walnut beams, and four
luminous recessed panels that are visibly the thing lighting the room**. The
`--dark` frames confirm the campaign beat survives: the room stays under-lit with the
panel faces reading as unlit cream diffusers rather than black holes.

---

## 8. Evidence

| Artefact | Path |
|---|---|
| Before/after fixed poses, v2 (11 poses × 3 lighting states) | `Phase4/screenshots/{before,after}-v2/` |
| Before/after fixed poses, v1 control (10 poses × 3 states) | `Phase4/screenshots/{before,after}-v1/` |
| Capture manifests + render stats | `Phase4/data/phase4-compare-{before,after}-{v1,v2}.json` |
| Pre-Phase-4 perf (A/B partner) | `Phase4/data/perf-prephase4-v2.json` |
| Key-light measurement + its frames | `Phase4/data/phase4-keylight-probe.json`, `Phase4/screenshots/keylight-probe/` |
| Texel + texture-source audit | `Phase4/data/phase4-texel-audit.json` |
| Performance, before and after, both variants | `Phase4/data/perf-{before,after}-{v1,v2}.json` |

Harnesses: `proshop-phase4-compare.js`, `proshop-phase4-keylight-probe.js`,
`proshop-phase4-texel-audit.js`, `proshop-baseline-performance.js`.

---

## 9. Open items for the walk-through

1. **The room is windowless.** The resize sealed all three public-room windows; the
   glazed main door is the only aperture. That is a layout consequence, not a Phase 4
   choice, but it is the single biggest constraint on how this room can ever be lit —
   worth a decision at the walk.
2. **Inherited over-512 textures** (§6) — whether to schedule a pass on the v1 shell and
   shared kits, which would change v1.
3. Standing from the previous session: the crowd-churn cap decision (NAV-CHURN-001) and
   the SIM-TIME-001 fix, scheduled before Phase 7.
