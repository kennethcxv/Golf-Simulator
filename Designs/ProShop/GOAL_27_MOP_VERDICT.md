# THE MOP — ATTEMPT ELEVEN, AND THE VERDICT

**KEEP IT.** The rebuilt head beats the shipped one decisively, and every one of
the four faults my own review found is gone and *measured* gone.

Build: `blender --factory-startup -b --python tools/blender/hero/build_mop.py -- cycles`
Frames: `qa/hero/mop/` — turntable, hero, side, above, under, silhouette.
Reference beside it: `qa/hero/mop/mop-vs-ref.png`.

---

## THE FIRST TURNTABLE THIS ASSET HAS EVER HAD

That is the headline. Ten attempts went through parameter bisection, not the
hero pipeline, so the frame set the faults would have been caught in never
existed. It exists now: 8 turntable frames plus 5 fixed views, all reviewed at
full size, none blank (`blank_frame_scan --gate`: 29 frames, 0 empty).

## THE FOUR FAULTS, EACH NOW A CHECK

| the fault that shipped | the check | what it reads now |
|---|---|---|
| strand ring **detached** from the hub | `assert_rooted` on every tuft | 318 tufts seated, shallowest **7.0 mm** inside the hub |
| head **hollow** through the middle | 24 rays fired up through the inner 34% of the disc | all 24 hit yarn |
| shaft **through** the hub's top | the shaft's lowest vertex must be inside the hub and above its underside | tip buried, **1.8 mm** above the underside |
| hub **offset sideways** | hub centroid vs yarn centroid | **0.02 mm** apart |

No solver. The head is modelled geometry, the way the broom's bristles are —
which was the instruction, and the broom is the one tool in this project that
already reads correctly.

## THE SIX ROUNDS, AND WHAT EACH ONE COST

1. **53 of 117 tufts not rooted.** Rooting each ring under its own radius put
   the outer rings at the hub's edge. Fixed by clamping every tuft in the middle
   and fanning it out — which is also what a spin mop actually does.
2. **The shaft check fired at 204 mm** — I had written it to compare the
   shaft's *highest* point with the hub's, and of course the handle runs up and
   away. Rewritten to measure the lower end. *The check was wrong, not the model.*
3. **The concentric check fired at 6.85 mm on a perfectly centred hub** — a
   three-lobed triangle's bounding box is not centred on its centroid. Switched
   to vertex centroids. *Again the instrument, not the model.*
4. First clean build. Reads as a mop. Strands are flat blades.
5. Density up to 288 thinner, rounder, length-jittered tufts — and the fill
   check immediately caught **4 of 24 rays missing at 11 mm from centre**, a
   hole the thinner strands had opened.
6. Centre cluster added. All five assertions pass.

Two of the six rounds were spent fixing checks that were measuring the wrong
thing. That is worth saying plainly: I wrote three new assertions for this asset
and two of them were wrong on first contact with real geometry.

## COST

| | |
|---|---|
| triangles | **5,616** (3,816 of them yarn) |
| objects | **4** — hub, socket, shaft, and the 318 tufts joined into one mesh |
| materials | **3** — red hub, white fibre, steel shaft |
| proportion | 209 mm across, 84 mm deep — **2.49x as wide as deep** |

The tufts are asserted individually and *then* joined. 318 loose objects would
have been 318 draw calls, which would have been a worse fault than the one being
fixed.

## WHAT IS STILL WRONG, HONESTLY

- **It reads as a stiff-bristled brush, not soft microfibre.** The reference is a
  dense mass of soft loops that reads as a solid white disc with a radial
  corduroy texture; mine is individually visible straight spikes. This is the
  one real gap left.
- **The hub is a soft pillow** where the reference is a crisp moulded triangle
  with a raised rim and a visible clamp plate.

If you want that closed, the move is not more strands — it is a **skin over the
tuft mass** (one lofted shell with the strand silhouette cut into its edge, the
strands only at the fringe), which would also drop the triangle count. That is a
different construction and I have not spent a round on it, because six were up.

**But the decision you asked for is not close: do not cut the mop.** The shipped
head had a ring floating below an offset hub with a hole through it and the shaft
poking out the top. This one has none of that, and the silhouette — which is
where the old one failed worst — now reads as a solid fringed dome on a stick.
