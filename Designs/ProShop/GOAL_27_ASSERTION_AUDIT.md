# GOAL 27 — WHY THE ASSERTIONS PASSED

Three assets with confirmed faults, their own shipped assertions run against
them, and the geometry measured beside each verdict.

Reproduce:

    blender --factory-startup -b --python tools/blender/hero/audit_assertions.py
    blender --factory-startup -b --python tools/blender/hero/control_blank_guard.py
    node tools/blender/hero/blank_frame_scan.mjs qa/hero --gate

---

# FIRST: TWO OF THE THREE FAULTS I REPORTED DO NOT EXIST

The assertions were right and my review was wrong, in the two places the brief
named. I looked at 900 px frames and called occlusion interpenetration.

**The basket's bail handles do not cross.** `assert_no_overlap` passed because
they are 6.60 mm apart and their y-spans do not overlap at all:

    handle A into handle B: deepest -5.01 mm, 0/78 verts inside
    handle B into handle A: deepest -4.92 mm, 0/78 verts inside
    true min surface distance (sampled both directions): 6.60 mm
    handle A y-span -0.1942..-0.0033  handle B y-span +0.0033..+0.1942
                                      overlap -0.0066 yd  (a gap, not an overlap)

The two arcs sit side by side with a finger's clearance — which the builder set
out to do deliberately, and which is what lets real basket handles fold past one
another. From the turntable's angle one passes in front of the other. That is
occlusion. I called it penetration.

**The dustpan's walls do not pass through its floor.** They stop 0.80 mm ABOVE
the floor's lowest point:

    lowest point on the WALLS (|x| > 92% of max): +0.00200
    lowest point on the FLOOR (|x| < 25% of max): +0.00120
    walls hang below the floor by -0.80 mm     (i.e. they do not)

The pan is a single lofted shell of 462 vertices and `assert_one_piece` is
correct about it. What I read as a protruding fin is the shell's own rolled rim
seen end-on.

**The wand is exactly as reported.** More on that below.

So the headline is still an assertion problem, but it is not the one in the
brief. The assertions did not green-light a wire through a wire. They
green-lit **four other things**, and they are all the same three bugs.

---

# WHAT THE AUDIT ACTUALLY FOUND

## Bug 1 — `assert_touching` treats interpenetration as success, without limit

Its embedded short-circuit returns PASS the moment a part is more than 0.2 mm
inside its host, and never looks at how much more:

```python
if deepest > 0.0002:
    print(f"  connection assertion passed: {a.name} is embedded ...")
    return
```

One millimetre in and forty millimetres through pass identically. Measured on the
wand:

    grip   into body: deepest +20.26 mm,  9/168 verts inside   body is 41.6 mm thick
    socket into body: deepest +19.47 mm, 15/56  verts inside
    guard  into grip: deepest  +9.43 mm, 12/78  verts inside   grip is 29.8 mm thick

The grip is driven half-way through the body. The assertion's own output for that
is `GripSocket is embedded in GunBody by 19.47 mm` printed as a **pass**, in
green, in the build log. It is an ATTACHMENT test that has been read as a
CONSTRUCTION test for nineteen assets.

An attachment test needs a ceiling as well as a floor: attached is 0.5–3 mm in,
not 20. Twenty is a part sticking out the other side.

## Bug 2 — the assertions are a hand-written list of PAIRS, and the faults are in the pairs nobody listed

The wand has 12 parts, so 66 possible pairs. The builder names 11. The audit
asked which of the pairs I measured a fault in are checked at all:

    grip    vs body  : NO ASSERTION PAIRS THESE      (+20.26 mm interpenetration)
    fitting vs body  : NO ASSERTION PAIRS THESE
    guard   vs grip  : NO ASSERTION PAIRS THESE      (+9.43 mm interpenetration)
    trigger vs grip  : NO ASSERTION PAIRS THESE
    qc      vs body  : NO ASSERTION PAIRS THESE
    socket  vs body  : checked  — and it PASSED at +19.47 mm, see bug 1

The grip is only ever checked against the socket, and the socket only against the
body. Nothing checks the grip against the body, which is the pair the fault is
in. This is not bad luck: an assertion you have to REMEMBER to write for each
pair gets forgotten exactly where the modelling was hardest and the parts are
most crowded, which is exactly where the faults are.

## Bug 3 — `assert_one_piece` is applied to one part per asset, by hand

The dustpan calls it on the pan. Not on the handle. The handle is three
disconnected shells:

    shells in pan   : [462]        one piece, correct
    shells in handle: [24, 24, 24] THREE separate cylinders, unchecked

That is the visible "diameter step mid-handle" in tt00/tt02/tt04 — it is not a
step, it is a gap between three loose tubes. And the whole three-piece assembly
is held to the pan by **2 vertices out of 72** at 1.50 mm.

Same class as bug 2: a per-part check that must be remembered per part.

## Bug 4 — `point_depth_inside` cannot tell a cavity from solid material

For a hollow shell, "inside the mesh" means inside the cavity. The basket's
handles arc over the open top and therefore measure as deeply inside the body:

    handle 0 into the BODY shell: deepest +69.12 mm, 12/78 verts inside
    handle 1 into the BODY shell: deepest +71.85 mm, 33/78 verts inside

They are not 70 mm into 6 mm of plastic; they are 70 mm into the air the basket
holds. The library knows this — `assert_touching` has a `require_surface` flag
to work around it, and the basket passes it — but the workaround is per-call and
opt-in, so any new call gets the wrong answer by default. The function should
refuse to answer for a non-closed or hollow host rather than return a number
that reads as material depth.

It also means **I cannot settle from this instrument whether the handle legs
pierce the basket wall.** That claim in my review is UNCONFIRMED, and the reason
it is unconfirmed is bug 4.

---

# WHAT SHOULD REPLACE THEM (not built — you said models come after this)

1. **Give `assert_touching` a ceiling.** `max_depth` defaulting to ~3 mm, and a
   separate `assert_seated(part, host, depth_range)` where deep insertion is
   intended. Watch it fail on the wand's grip first.
2. **Make the pair list exhaustive by default.** One call —
   `assert_assembly(parts)` — that walks ALL pairs, requires every part to be
   attached to at least one other, and fails any pair that interpenetrates
   beyond the ceiling unless it is on an explicit, named allow-list. Then a
   forgotten pair fails closed instead of silently not existing.
3. **Run `assert_one_piece` over every part automatically**, not per hand-picked
   part, with an allow-list for the genuinely multi-shell ones.
4. **Make `point_depth_inside` refuse hollow hosts.** Detect a cavity (ray parity
   or a wall-thickness probe) and raise rather than return a cavity depth.
5. Every one of those gets a deliberately broken variant that is WATCHED FAILING
   before the fix is believed. The builders already have `break=` variants; they
   test the assertions that exist, which is why they never caught these.

---

# THE BLANK FRAMES — CAUSE, FIX, AND CONTROL

## There were eleven, not three

`blank_frame_scan.mjs` scored all 569 frames in `qa/hero` on one statistic — the
99.9th percentile of local gradient, i.e. "does this image contain an edge
anywhere". The populations separate by a factor of 30 with nothing in between:

    1.4   broom/broom-under.png
    1.4   dustpan/dustpan-under.png
    1.4   hand/hand-palmar.png            <-- and its three variants
    1.4   hand/hand-palmar-no-nails.png
    1.4   hand/hand-palmar-no-taper-no-weld.png
    1.4   hand/hand-palmar-no-weld.png
    1.4   rake/rake-under.png
    1.4   rake/rake-eevee-under.png
    1.4   spreader/spreader-spinner.png
    2.2   mower/mower-reel.png
    2.2   mower/mower-eevee-reel.png
    ----- nothing between 2.2 and 63.0 -----
    63.0  cloth/cloth-eevee-above.png     (the least busy real frame)

**The hand's palmar view is blank in all four variants.** The palm of the hand —
the surface a grip is judged on — was never once photographed, and the report
lists "palmar" among the views it was reviewed from.

## The cause, in one line

`backdrop()` places a large grey card 1.05 subject radii BELOW the subject.
`orbit_position` with a negative elevation puts the camera below that card, and
the card fills the frame.

Measured on the dustpan:

    subject centre z +0.0999   backdrop plane z -0.1306   'under' camera z -0.6650
    the under-camera sits 534 mm BELOW the backdrop, looking up at its back face
    cameras go under the card below about -12.1 degrees of elevation

Every camera in the hero set at an elevation steeper than about −12° is blank,
and every camera above it survives. There are exactly eight negative-elevation
cameras in the whole set:

    hose  grip     -8   fine
    wand  trigger -12   fine (on the line)
    mower reel    -22   BLANK
    spreader spin -34   BLANK
    dustpan under -44   BLANK
    rake  under   -50   BLANK
    broom under   -52   BLANK
    hand  palmar  -66   BLANK

That is the whole population, with a boundary case on each side. Nothing else
about those shots was wrong.

`silhouette()` hides the backdrop already, which is why silhouette frames at odd
angles were never blank — the fix below is the same line applied to `render()`.

## The fix

**`hero_lib.render()` now does two things it did not.**

1. If the camera is below the backdrop, the backdrop is hidden for that frame.
   An under-view wants the object's underside; the floor was never the subject.
2. Every written frame is measured, and a frame with no subject in it
   **raises SystemExit and fails the build**. It is not a warning and it is not
   skippable — `assert_frame_has_subject` runs inside `render()`, so no code path
   in any builder can write a blank frame and carry on.

Threshold 8.0, chosen from the measured populations: worst blank 2.89, best real
frame 105.96 through the same code path — a 37x separation and roughly 3x margin
on each side.

## The control, watched failing

`control_blank_guard.py` makes the guard fail on purpose before anyone trusts it:

    ok  A  under-camera, backdrop visible (what shipped): guard FAILED THE BUILD
           edge score 2.19, floor 8.0
    ok  B  camera aimed at empty sky:                     guard FAILED THE BUILD
           edge score 1.41, floor 8.0
    ok  C  the normal hero camera:                        guard passed  (edge 119)
    ok  D  the same under-camera, fix active:             guard passed  (edge 80)

A is the historical bug reproduced exactly. D is the same camera with the fix,
and `qa/hero/_control/D-under-fixed.png` shows the dustpan's underside — I have
looked at it; it is dark, because every studio light is above the subject, and
an under-view wants a fill light. That is a follow-up, not this fix.

`qa/hero/dustpan/dustpan-under.png` is now a real frame (edge 107) and has been
looked at.

## The ten still on disk

The guard stops new blanks. The ten already written are still citable until their
assets are rebuilt, so the scanner has a gate mode that fails on them:

    node tools/blender/hero/blank_frame_scan.mjs qa/hero --gate
    -> 569 frames scanned, 10 contain no subject   EXIT 1

Rebuilding hand, broom, rake, mower and spreader clears all ten — but each of
those rebuilds is a model touch, so they are held until you say go.
