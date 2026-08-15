# GOAL 27 — TEN HERO ASSETS

**Design only.** Nothing this session is wired into the game. Ownership was
`tools/blender/` and `Assets/models/`; no file under `src/` was touched, because
a second session is doing performance work in those files.

Because nothing is wired in, the renders ARE the evidence rather than a
supporting exhibit. Every asset gets the same four passes from
`tools/blender/hero/hero_lib.py`:

| pass | what it answers |
|---|---|
| **turntable** — 8 views, contact-sheeted | proportion faults that hide at one angle do not hide across eight |
| **hero / dorsal / palmar / ulnar / radial** | the framing an art review argues over |
| **silhouette** — black on white | "would you recognise it as a black shape?" cannot be answered from a lit render; specular and colour do too much work |
| **apparent** — 66° vertical FOV, 16:9 | the size the PLAYER gets. A model that only survives a close-up has not survived |

Lighting is a neutral three-point studio, not an HDRI: an HDRI bakes a location's
colour into the frame and this project already has a history of arguing about a
fault that was really a light.

---

## THE TEN, AND WHY

Taken from the brief's list. I dropped nothing, and would make one substitution
if forced to (below). Working order is by damage, not by the brief's numbering:

| # | asset | why it is hero | state |
|---|---|---|---|
| 1 | **The hands** | asked six times, never delivered; on screen every second the player holds anything | **SHIPPED — this report** |
| 2 | **The mop head** | nine passes of parameter tuning; last frame had the head reading as detached | not started |
| 3 | **The bunker rake** | currently a detached hand floating in the sky — a broken asset, not an ugly one | not started |
| 4 | **The ledger book**, closed and open | the player *reads* it, at reading distance | not started |
| 5 | **The dustpan** | held at arm's length, whole-screen during a sweep | not started |
| 6 | **The spray bottle** | bare-hand tool, drawn right at the camera | not started |
| 7 | **The cloth / sponge** | same, and the hardest to make read as fabric | not started |
| 8 | **The shopping bag** | the object the whole checkout gesture ends on | not started |
| 9 | **The credit card in the customer's fingers** | reported flat and phasing through | not started |
| 10 | **The cash register / till** — drawer, monitor, body | stared at during every sale | not started |

**The substitution I would make.** If one of these could be dropped I would drop
the till *body* and put the **card payment terminal** in its place. The terminal
floats up to the player's face during every checkout — it is closer to the camera
and for longer than the till carcass ever is, and the till's hero parts are
really the drawer front and the monitor bezel, which are two details rather than
an asset. I have not acted on that; the list above is the brief's.

**The broom is untouched**, as instructed.

---

## ASSET 1 — THE HANDS

**Reference:** `Designs/ProShop/Images/Goal_26/HandsRefrenceImage.png` — a first-person
right hand wrapped around a shaft, seen from behind and slightly above.

**Build:** `tools/blender/hero/build_hand.py` → `Assets/models/hero/fp_hand.glb`

| | |
|---|---|
| triangles | **5,179** (hand 4,600 + 5 nails) |
| draw calls | 6 objects, **2 materials** (skin, nail) |
| palm | measured **29.3 mm** thick — anatomical 26 |
| knuckle breadth | **84.3 mm** — anatomical 88 |
| handle the grip encloses | **34.2 mm** — a 30 mm broom handle fits |
| glTF validation | `tools/validate-gltf.mjs` — 0 failed, 0 warnings |

### Why the shipped hand fails, as a modelling fact

The runtime hand is about twenty **separate convex primitives** — a scaled sphere
for the palm, spheres for the thenar and each knuckle, a capsule per phalanx.
Twenty convex lumps sharing no surface cannot make a hand, because a hand reads
by **continuity**: the back of the hand is one plane that does not break into
fingers until past the knuckles, and the joints are bulges in a continuous form
rather than gaps between separate ones. Photographed, that reads as a bunch of
grapes. "Bobbles" was the correct word.

### Rounds

| round | technique | verdict and the fault that ended it |
|---|---|---|
| 1 | metaballs | **ITERATE.** Palm, wrist, forearm, thenar, hypothenar and every knuckle were missing from the render. Blender 5.1's ELLIPSOID element produces no surface at any size, radius or stiffness — measured, `probe_metaball.py` |
| 2 | metaballs, ball+capsule | **ITERATE.** Recognisable hand. Camera was inside it; grip instrument reported a 95 mm handle |
| 3 | metaballs | **ITERATE.** Slimmer, but the blend swallowed the fingers and smoothed the knuckle ridge off |
| 4 | **switch to Skin modifier** | **ITERATE.** Palm slab landed at 27.1 mm against 26. Nails raycast into empty space |
| 5 | Skin | **ITERATE.** Found the flexion sign — see below |
| 6–7 | Skin | **ITERATE.** Over-corrected the palm into a narrow trunk, then into a pillow |
| 8 | Skin | **ITERATE.** Found the camera fault — see below |
| 9–10 | Skin | **ITERATE.** Thumb inside the index knuckle |
| 11 | Skin, fan topology | **the shard is gone** |
| 12 | Skin | grip instrument rebuilt around enclosure; curl retuned to hold a broom handle. **SHIP, with finishing notes** |

Three rounds of metaball tuning moved faults around without fixing them, so the
**technique** changed rather than the parameters. That is the brief's own rule
and it was the right call: the ceiling was in the tool, not in the shape.

### Five faults only a rendered frame could have found

1. **Every finger was hyperextending.** A rotation about +X carries +Y toward
   +Z, which is the *back* of the hand. The grip had been opening backwards over
   the knuckles since round 1. It is why the fingers floated above the shaft in
   every render, and why the nail rays found no skin.

2. **The "dorsal" camera was looking straight down the forearm.** The back of
   the hand was in none of those frames, and the forearm seen end-on read as a
   pillow swallowing the fingers. Two rounds went into modelling my way out of a
   camera angle. Detail shots now frame the hand's own bounding sphere.

3. **A flat shard through the back of the hand.** It survived hiding the nails,
   skipping the fingertip taper, and skipping the weld — three controls, each
   ruling out one suspect. It was the Skin modifier folding the ninety-degree
   turn where the knuckle-arc chain met a finger. Raising `branch_smoothing`
   made it *larger*. A fan of four edges off one palm vertex has no turn to fold,
   and the shard went.

4. **The thumb tip was inside the index knuckle** — 15.6 mm apart occupying
   22.5 mm. There is now a build-time assertion for parts meant to be separate
   (`assert_digits_do_not_interpenetrate`), watched failing on the unfixed build
   before the thumb moved. The knuckle row is exempt: metacarpal heads genuinely
   abut.

5. **The grip is measured, not assumed.** `fit_shaft` reports the largest handle
   the curl actually encloses. Its first version returned 95 mm because nothing
   bounded the search — the further it walked from the hand the better its score,
   so it walked to the edge of its own search window and reported that.

### Two measured facts, for whoever touches this next

- **Blender 5.1.2's metaball ELLIPSOID element produces no surface.** Tested
  across four sizes, five radii and five stiffness values. BALL and CAPSULE work.
- **The Skin modifier's two radii are half-extents**, and `radius[0]` maps to the
  in-plane perpendicular while `radius[1]` is always world Z. That is what lets
  the palm be a 76 mm plate 26 mm thick without a squash pass — and the squash
  pass was the direct cause of two separate bugs, because it moved geometry the
  nail rays and the grip measurement had already been calculated against.

### A sixth fault, found last and worth its own note

**The grip measurement was wrong in both directions before it was right.** After
the enclosure test replaced the bounded search, the same curl that had been
reported as holding a 20.7 mm rod measured as holding a 49.8 mm one — the
instrument had been reporting the *opposite* of the truth, and both numbers
looked plausible. The curl is now tuned against a working instrument and encloses
34.2 mm, so a 30 mm broom handle fits.

The general lesson, since it has now cost this project several sessions: an
instrument that returns a number is not thereby measuring the thing. Both broken
versions returned numbers that moved when I changed the model, which is exactly
what makes a broken instrument convincing.

### Finishing notes — what a hostile reviewer would still say

1. **The skin reads waxy at close framing** — no tendons, no creases, no pores.
   At the apparent size a player gets, this does not matter. At hero framing a
   lead artist would call it a mannequin. Fixing it properly means a normal map,
   which is a texture pass rather than a modelling one.
2. **The knuckle ridge is soft.** The fan topology cost some of what the arc
   chain gave, and the arc chain cannot come back — it is what folded the shard.
3. **Fingers read slightly short.** The lengths are anatomically correct; the
   curl hides the proximal phalanx. This is a pose question, not a model one.
4. **The forearm seen end-on** (turntable frame 1) is a featureless mass. Inherent
   to looking down an arm's axis; in game that view never occurs.
5. **Knuckle breadth is 84.3 mm against an anatomical 88.** 4% narrow.

None of these is the failure the previous eight rounds had. They are finishing
notes on something that now reads as a hand at a glance, in silhouette, and at
player scale.

### Evidence

`Designs/ProShop/Images/Goal_27/hand/` — turntable contact sheet, hero, dorsal,
palmar, ulnar, radial, silhouette, apparent-size, the reference, and
`BEFORE-shipped-build.png` (the shipped build's frame, for comparison).
