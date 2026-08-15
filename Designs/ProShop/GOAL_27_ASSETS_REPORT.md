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
| 11 | **The customer basket** — Publix-style hand-carry, moulded plastic, two folding handles, open top, stackable taper | what shoppers carry round the floor; a SEPARATE object from the checkout bag | added to the list, **not built** |

**The bag is two objects, not one.** #8 is the CHECKOUT BAG
(`FrontDeskShoppingBag`) that sits on the counter and that goods have been
phasing into. #11 is the customer basket shoppers carry. They are different
assets and only the first is built.

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

### ROUND 2 — THREE FAULTS I SHIPPED, AND WHAT THEY EXPOSED

The owner found three faults in the shipped turntable that I had not:

1. **The thumb was detached** — a separate lump on the back of the hand.
2. **The thumb phased through the shaft**, visibly, in frame 3.
3. **A hole on the ulnar side** you could see the background through.

I had reviewed off the hero shot, which hides all three, and off the contact
sheet, which renders each view at about 500 px. Looking at the eight frames
INDIVIDUALLY at full size, every one is unmistakable.

**Why the assertions passed anyway.** `assert_digits_do_not_interpenetrate`
compares parts of the hand to each other. That is one claim, and there are three:

| claim | what it catches | did it exist? |
|---|---|---|
| clear of every other part | thumb buried in the index knuckle | yes |
| ATTACHED to the mass it grows out of | a floating thumb | **no** |
| TOUCHING the thing it holds | daylight in the grip | **no** |

A part can be clear of every other part and still be floating, and a hand can
clear a shaft perfectly by holding it at arm's length. Both new assertions were
watched failing on the shipped build:

```
BUILD FAILED: the hand is 3 separate pieces (vertex counts [2735, 354, 1])
```

The 354-vertex island was the thumb. It was never attached — the Skin modifier
emits a second closed hull instead of a junction when a child bone sits inside
its parent's tube, and the whole thumb root was inside the palm.

**The deeper fault was that the pose was authored and the shaft was fitted to
it.** Pick flexion angles, then drop a cylinder into whatever void the fingers
leave, and call the void a grip. That is backwards, and no amount of angle-tuning
fixes it. The shaft is now an INPUT — a 30 mm handle resting against the palm —
and every phalanx rotates until it touches and no further, so contact is a
consequence of the solve and penetration is impossible by construction.

Getting both zero penetration and zero daylight needed one more idea: a single
solve margin cannot do it, because the skinned surface bulges past the skeleton
segment by different amounts at different joints — back it off enough to clear
everywhere and the middle and ring fingers sit 3 mm off. So the fingers are
solved slightly CLOSED and the skin is then conformed to the cylinder, which is
what flesh does. All five digits now report **+0.1 mm**.

### Round 2 fault log, by frame

| round | frame | fault | fix |
|---|---|---|---|
| 14 | all | thumb a separate island (546 v) | Boolean-union the skin hulls; voxel remesh made it worse (2 shells → 73) |
| 14 | — | 11 vertices 1.7 mm inside the shaft | solve margin, then conform-to-cylinder |
| 15 | 1, 6 | thumb a 77 mm blade pointing along the forearm | its flexion axis is now the SHAFT itself, so it wraps like a finger |
| 16 | 5 | daylight between adjacent fingers | convergence signs were inverted — positive yaw carries a finger ulnar, so the index was fanning away from the middle |
| 17 | 7 | jagged stepped silhouette where hand meets pole | relax the contact patches, then re-conform |
| 18 | 7 | serrated fingertip edge | nails were flat cards standing proud; set into the nail bed |
| 19 | 3, 7 | forearm read as a noodle | 41–49 mm wide where a real one at that length is 58–65 |

### Rounds 20-24: a hole, and three attempts that made it worse

Putting the reference beside frames 4 and 6 showed a fault neither the
assertions nor I had caught: **a black through-hole between the ring and little
fingers**, above the pole, with the background visible through it. The
grip-contact assertion cannot see it — it measures each digit against the SHAFT
and says nothing about daylight BETWEEN digits.

Closing it took four attempts, three of which traded the hole for something
worse. Each time the fix produced a flat torn sheet between those two fingers:

| attempt | change | result |
|---|---|---|
| 20 | little knuckle in 3.8 mm, fatter, less shaft tilt | flap appears |
| 21 | suspected the nail's dorsal direction; fixed a real bug there | flap unchanged |
| 22 | reverted knuckle positions | flap unchanged |
| 23 | reverted little-finger radii | flap unchanged |
| 24 | reverted knuckle position to -0.0350, closed the gap with CONVERGENCE instead | **flap gone, hole gone** |

The mechanism: the Skin modifier's five-way branch at the distal palm cannot
take two knuckle hulls that overlap. Anything that brings the little finger's
knuckle inside -0.0350 — position or radius — makes it emit a torn face instead
of a junction. The gap therefore has to close along the finger's LENGTH, with
more yaw toward the ring finger, leaving the knuckles where the solver can build
them.

Two controls did the diagnostic work: a render with the nails removed entirely
(the flap was identical, so it was skin, not a nail), and the archived round-19
frame (clean, so the flap was introduced by a specific later change rather than
having always been there). Without the archived frame I would have kept
attributing it to whatever I had touched most recently — which is exactly what
attempts 21 through 23 were.

### The bar, and how the reference was used

The brief sets House Flipper's first-person hands as the bar. I could not fetch
a House Flipper screenshot as an image I can actually LOOK at — web search
returns text, and a reference I cannot see is a reference I would only be
pretending to use. What I used instead is the reference already in the repo:
`HandsRefrenceImage.png`, a first-person hand gripping a mop shaft with a "Hold
and switch to Move objects" prompt on screen — House-Flipper class, very
probably House Flipper itself. `tools/blender/hero/side_by_side.mjs` writes it
into one strip beside the render so the comparison is unavoidable rather than
optional, and `hand-vs-reference.png` is that strip.

Putting them side by side is what found the through-hole. It is also what shows
the two differences that remain: the reference's fingers are noticeably more
slender than mine, and its knuckles read as a soft row where mine are smooth.

### NOT DONE: the ring/little gap, and why I stopped trading it

**Frame 4 still shows a narrow slot between the ring and little fingers with the
pole visible through it.** It is smaller than it was — the convergence work in
rounds 24 and 26 more than halved it — but it is still a hole, and I am
reporting it as outstanding rather than claiming it closed.

I attempted it six times. The pattern is consistent and worth writing down,
because it is a property of the tool rather than of this asset:

> Anything that brings the little finger's knuckle nearer the ring finger's —
> its POSITION or its RADIUS — makes the two hulls overlap at the Skin
> modifier's five-way palm branch, and it emits a flat torn sheet between them
> instead of a junction. Closing a hole that way produces a worse hole.

What does work is closing the gap along the fingers' LENGTH with convergence
yaw, which leaves the knuckles where the solver can build them. That took the
slot from a wide black hole showing the background to a narrow one showing the
pole, and further yaw starts to read as a claw.

The real fix is a topology change: an explicit interdigital web, or splitting
the five-way branch so no two knuckle hulls share a vertex. Both are larger than
a tuning pass and both risk reintroducing the shard class that the fan topology
was adopted to remove, so it is the right place to stop and say so.

### What else I can still name across the eight frames

- **Frame 1** (down the arm): the hand is an undifferentiated blob, and there is
  a single-pixel nail speck visible at the top of the fist. Partly inherent —
  in game this view never occurs.
- **Frame 7**: the fingertips clump into a slightly ragged lump at the ulnar
  edge. Real geometry, reads awkwardly.
- **Against the reference**: my fingers are chunkier and my knuckle row is
  smooth where the reference's reads as a soft row of four.
- **All frames**: the skin reads waxy. No tendons, no creases, no pores. That is
  a normal-map pass, not a modelling one, and it is the honest ceiling for
  geometry alone.

**So this is not a SHIP.** The three faults the owner named are fixed and each
is now held by an assertion that was watched failing first. One fault he did not
name is still open, and four cosmetic ones are listed above.

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

---

## ASSETS 2, 3, 4 — BROOM HEAD, DUSTPAN, SPRAY BOTTLE

Hard surface, no solving. All three share `tools/blender/hero/hardsurface_lib.py`.

### The assertion that matters, and the four instrument bugs it took to get it right

"Many small things attached to one big thing" has failed twice here — the mop's
strands and the rake's bristles were both FLOATING IN AIR — so the property is
ROOT and CONNECTION, measured on geometry. Single-shell does not apply: these
legitimately have separate parts.

Each was watched failing on a deliberately broken variant. Four of those attempts
were wrong, and each was only caught because the broken variant was run first:

| bug | what happened |
|---|---|
| the broken variant lifted the bristles **UP** | which seats them DEEPER in a block that is above them. 60/60 tufts "passed" on a variant that was not broken |
| `assert_touching` used unsigned distance | a socket sunk 6 mm into a block reported a 6 mm "gap" and failed for being too well attached |
| `point_depth_inside` passed **world** coords to `closest_point_on_mesh` | which takes LOCAL. Silently correct for a host at the origin — true for the broom block, false for the spray head, where a nozzle 7 mm inside read as 2.2 mm outside |
| the broken trigger moved **forward** | along the 74 mm the head is deep, so it stayed in contact and passed |

### Triangle counts, against the hand's 5,179

| asset | triangles | objects | materials |
|---|---|---|---|
| broom head | **2,820** | 218 (216 tufts) | 3 |
| dustpan | **1,052** | 2 | 3 |
| spray bottle | **1,420** | 7 | 4 |

### BROOM — 5 rounds — **KEEP THE PROCEDURAL**

The bar was different: the procedural broom already reads correctly. Mine has a
better ferrule and a cleaner hem, but the bristles — which are the whole read —
are worse. The procedural's are fine and dense and read as fibre; mine are
chunkier flat blades with visible lanes between the rows.

Getting bristles that fine needs roughly 400 tufts, which is ~5,000 triangles on
bristles alone — the hand's entire budget, for a secondary prop. **Not clearly
better, so the procedural stays.** Evidence: `broom-vs-procedural.png`.

Rounds: comb of 20 countable teeth → 148 staggered tufts → darker (the studio was
blowing near-black to grey) → level hem and untapered bristles → 216 tufts with
less splay.

### DUSTPAN — 6 rounds — reads as a dustpan

Faults by frame, in order found: it read as a **canoe** (240 × 225 with the walls
sweeping to points at the lip — a dustpan's mouth has to be obviously the widest
thing about it); it rendered as brushed aluminium (a clearcoat over a near-black
base is a white specular sheet); **my hero camera was behind the pan** so the
mouth was hidden in every frame I judged from; the side walls tapered to
knife-thin spikes; the floor looked like crumpled foil (a 2.2 mm dish fighting
the rail's curvature under smooth shading); and flat shading over nine rail
stations banded the floor.

The lip is continuous with the pan by construction — it is where the lofted
shell's wall height goes to zero — and `assert_one_piece` holds it.

### SPRAY BOTTLE — 4 rounds — reads as a trigger spray

**Rendered in Cycles by default.** EEVEE's screen-space refraction turns the
translucent body into frosted grey speckle with no liquid visible at all, so the
fast engine cannot answer the only question this asset has to answer.

Faults by frame: the hero camera was on the **back** of the bottle — no trigger,
no nozzle, nothing to read; the bottle was too tall and narrow and read as a
drinks bottle; the trigger was a 4 mm strap that read as a wire bail; the head
was a plain matchbox; and at 18 sides the shoulder and waist showed flat facets,
which a translucent body puts in the frame twice — once as the outline and once
refracted through it.

### A studio calibration that affected all three

The renders were made at 0 EV with a bright three-point studio and AgX, and every
dark material came out light: charcoal read as brushed aluminium, near-black
bristles read as grey wire. I read that twice as a missing material before it
turned out to be exposure that had never been set. The studio now runs at
**−0.9 EV**.

---

## ASSETS 5, 6, 7 — CLOTH AND SPONGE, SHOPPING BAG, BUNKER RAKE

### First: the spray bottle was judged in the wrong engine

The owner's note — the game renders closer to EEVEE than to Cycles — turned out
to matter more than a preference. Rendered in EEVEE the finished spray bottle was
a **dark opaque blob**: no translucency, no liquid, nothing. Transmission is a
path-tracing feature, and the asset had been authored for the engine that will
never draw it.

Rebuilt on **alpha** instead of transmission, it reads in both, and EEVEE is now
arguably the better frame — the dip tube is visible through the liquid.
`spray-engines.png` is the pair. `hardsurface_lib.pbr` grew an `alpha` argument
and sets the raster blend mode, which is also what a Three.js material would use.

| asset | triangles | objects | materials | rounds |
|---|---|---|---|---|
| cloth + sponge | **1,536** | 2 | 3 | 3 |
| shopping bag | **1,020** | 3 | 2 | 3 |
| bunker rake | **628** | 18 | 3 | 2 |

All three pass `tools/validate-gltf.mjs` with zero failures and zero warnings.

### Three more broken instruments, caught by the broken variants

The discipline paid again. Every one of these was found because the deliberately
broken build ran first:

- **Inverted normals made the inside/outside test report the opposite.**
  `point_depth_inside` decides from the SIGN of the surface normal, and the
  sponge's lat/long grid wound inward — a point 106 mm OUTSIDE a 44 mm sponge
  came back as 106 mm inside it. Every depth-based assertion inherits that,
  including the rooting check the bristles rely on. Normals are now recalculated
  at construction rather than trusted.
- **The clearance test was measuring its own probe placement.** It parked the
  load exactly `margin` above the cavity floor and then required `margin` of
  clearance, so the bottom face sat on the boundary by construction: it reported
  **+3.00 mm against a 3.0 mm requirement** and failed a bag that fits fine. It
  now searches nine heights for a placement instead of assuming one, and reports
  a real 15.4 mm.
- **`assert_no_overlap` needed to exist at all.** A cloth resting against a
  sponge passes every attachment test precisely BY touching, and
  interpenetration is invisible from most angles because the buried part is
  buried.

### CLOTH AND SPONGE — 3 rounds

The sponge came out as an **oval disc**: the superellipsoid exponent was 0.84,
and 1.0 is an ellipsoid. A rounded box wants about 0.35 — that one number decides
whether it reads as foam or as a pebble. The cloth was a flat wavy sheet that
read as a rubber mat until it was folded over itself with a rolled edge. And the
scour pad was a stacked second solid whose rim overhung the body and read as a
lid with a seam; it is now one block with the material split by height, so the
boundary is a change of surface and nothing else.

### THE CHECKOUT BAG — respecified and rebuilt

The first version was the wrong object: a soft-cornered tote from a superellipse
section. The brief is a **Whole Foods paper grocery bag** — flat rectangular
base, creased side gussets, rolled top rim, walls standing open and holding
their shape — and its job is to be a CONTAINER, so the interior is the
deliverable and the silhouette is not.

**Units are YARDS**, because the game's are: `BAG_PRESENTATION_SCALE = 1.35`,
`BAG_PRESENTATION_FLATTEN = 0.55`, and the current in-game "interior" is
`BoxGeometry(0.24, 0.33, 0.15 × 0.55)` — a plain box. Modelled at true grocery
sack size, 12 × 7 × 17 inches.

#### The interior, MEASURED off the cavity mesh

| | authored (yd) | at game scale ×1.35 |
|---|---|---|
| **floor rectangle** | 0.3249 × 0.1860 | **0.4387 × 0.2512** |
| **opening rectangle** | 0.3297 × 0.1908 | **0.4451 × 0.2576** |
| **usable wall height** | 0.4133 | **0.5580** |
| exterior footprint | 0.3647 × 0.2258 | **0.4923 × 0.3048** |

**The authored keep-out is 0.40 × 0.24. This bag needs 0.492 × 0.305** — 23%
wider and 27% deeper than the rectangle the counter layout currently clears
against. That is the shape of the bug, and it is now a measured number rather
than a guessed one.

Every figure above is read off the built cavity by `measure_interior`, not
restated from the constants that drew it. A floor rectangle that comes from the
same variable that drew the floor proves nothing, and that is exactly the failure
mode the in-game bug is made of.

Faults found: the section was a superellipse and read as a leather tote until it
became a rounded rectangle with four corner creases; the gusset was invisible at
3 mm and reads as paper at 7.5 mm with a sharp V falloff; the handles were round
cord until flattened to an 1.8 × 10.5 kraft ribbon.

**And the broken variant did not break.** Units changed from metres to yards, so
the 0.030 interior shrink that used to fail left 4.7 of clearance and passed.
A broken variant that does not break is worth nothing — it only surfaced because
the broken build runs first. The shrink is now 0.060. The clearance assertion
also stopped printing "mm" on numbers that are yards.

### BUNKER RAKE — 2 rounds

What is in the game is capsule lumps floating in the sky with two planks through
them — a detached first-person hand. This is a moulded head with a smoothing
blade, fifteen rooted teeth, a ferrule and a shaft, and every joint is asserted.

Faults: the head read as a **steel bar with chrome trim**, because the smoothing
blade is a broad flat face and at 0.44 roughness it caught the key light; and the
tines were wire pins until they were widened into moulded teeth.

### One thing the studio still does

Even at −0.9 EV, near-black materials render as mid-grey — the rake head is
0.0105 linear and reads as gunmetal. That is AgX's midtone lift, not a missing
material, and it is worth knowing before anyone judges a black asset from these
frames.

---

## PRINTED ARTWORK — the checkout bag and the customer basket

Both were shapes with no product on them. They are now printed.

`tools/blender/hero/make_bag_art.mjs` draws the marks as SVG and rasterises them,
so the source is editable text rather than a baked image nobody can change:

- **`checkout_bag_print.png`** (1600 × 716) — kraft ground with fibre, a golf
  roundel, the PINE HILLS / GOLF CLUB wordmark with rules, a smaller mark on the
  back panel, fold rules on the gusset lines, and 100% RECYCLED KRAFT / PLEASE
  REUSE near the base.
- **`customer_basket_print.png`** (1024 × 320) — a moulded badge plate.

**The bag art leaves its middle band empty on purpose.** The game drops a dynamic
brand plane on the front at runtime (`CHECKOUT_DISPLAY_BRAND_PRESENTATION
.bagPanel`, 0.176 × 0.118 at y 0.150 — about 32% up), and printing under it would
stack two shop names on each other.

### ASSET 11 — THE CUSTOMER BASKET, built

`Assets/models/hero/customer_basket.glb` — **2,174 tris**, 4 objects, 3 materials,
validates clean. A separate object from the checkout bag: the game has it as
`customer-basket` (clubhouse.js, from merch, scale 0.66).

Publix-style: moulded plastic, tapered so they nest, 22 vertical ribs, a rolled
rim, two folding handles, and a badge. Its design is MOULDED rather than printed
because that is what injection tooling gives you — a printed decal on a shop
basket reads as a sticker.

Interior clears a 0.330 × 0.200 × 0.170 yd load by 0.042 at its tightest.

### Faults the assertions and the frames found

| fault | how it showed |
|---|---|
| the two handles ran **45 mm through each other** | both arcs converged on one apex point; real handles sit side by side with a finger's gap, which is also what lets them fold past one another |
| handle pivots floated **2.6 mm off the rim** | the rim rolls out to 1.03× and then takes a 6 mm shell, so its outer face is further out than the nominal top half-depth |
| the badge artwork came out as **scrambled white streaks** | `mesh_from` recalculates normals, which reorders the quad's loops, so a fixed UV sequence twisted the mapping into a bow-tie. UVs now come from vertex POSITION |
| then the wordmark printed **backwards** | I flipped u "because the badge faces −Y" on top of a flip the winding had already done |
| then the badge was **pierced by the ribs**, and after that **hidden behind them** | the shell tapers outward with height and Solidify offsets it by the wall; the badge has to follow both |
| the bag's roundel was an **ellipse** | the texture was square while the wrap is 2.24 : 1 perimeter-to-height |
| the bag's hero camera was on the **back panel** | same wrong-side fault as the spray bottle |

### And one assertion that was passing for the wrong reason

`assert_touching` short-circuits on "embedded", and for a HOLLOW host that is
wrong: "inside the mesh" of a 6 mm basket shell means inside its CAVITY, so a
handle arcing over the open top counted as embedded 70 mm deep and passed
however far above the rim it floated. **The broken variant proved it by
passing.** There is now a `require_surface` mode that measures surface distance
only, and the basket's handles use it.

The badge's tolerance is also sized to the rib depth rather than to a hair: it is
a four-corner quad on a ribbed wall, so a corner can land in a valley and the
measured gap is to the valley floor rather than the crest it is seated on.

### Still nameable

The 22 moulded ribs are barely legible at hero framing — they read at the
silhouette edges and wash out across the front face under the studio key.

---

## THE CASH REGISTER — drawer measured, both engines shown

`Assets/models/hero/cash_register.glb` — **728 tris**, 16 objects, 4 materials,
glTF clean. Body, keypad, monitor on a stalk with an EMISSIVE screen, and an open
drawer. Rendered in Cycles AND EEVEE (`register-engines.png`) because the screen
emits and the game draws closer to EEVEE.

### The drawer, measured off the tray (YARDS)

| | |
|---|---|
| outer | 0.4060 × 0.3900 × 0.1080 |
| interior | 0.3940 × 0.3780 × 0.1020 |
| **4 note bays** | **0.0944 × 0.2142**, divider wall 0.052 high |
| **5 coin wells** | **0.0744 × 0.1638**, divider wall 0.040 high |

Eight dividers — one rail, three note-bay walls, four coin-well walls — all
seated in the floor at 1.7 mm, with the broken variant (every divider lifted
20 mm) rejected.

### Four faults, and one assertion replaced

- **Every divider stacked on one spot 26 mm outside the tray.** `HS.box` stores
  its centre in the OBJECT's location, and I *assigned* the drawer offset instead
  of adding to it.
- Seating read **−1.00 mm** (bottoms through the underside of a 6 mm floor), then
  **+1.46** against a 1.5 threshold, before landing at 1.7.
- **Shrinking the dividers clear of the side walls looked like the fix and was
  the opposite.** The tray is hollow, so its cavity reads as *outside* the shell,
  and the corners that were scoring were the ones buried in wall material. That
  change took the reading from +1.46 to −0.04.
- **The drawer-face check reported 4.32 mm however far the face moved.** A number
  that does not respond to the thing it measures is not a measurement. Replaced
  with `assert_boxes_overlap`, which is coarser and honest about it — a
  bounding-box overlap cannot be invariant to position. It now reports 15.0 mm of
  shared volume.

---

## THE MONEY — variety through textures, and the cost of the whole set

`Assets/models/hero/money.glb`. Every design is a CELL in a shared atlas: one
mesh, one material, a UV offset per instance.

### THE COST, for all 24 designs

| | |
|---|---|
| designs | 12 cards + 8 note faces + 4 coins = **24** |
| **MATERIALS** | **4** — cards 1, notes 1, coins 2 (a silver and a copper) |
| programs | **4**, one per material, no shader variants |
| draw calls | 24 objects, batchable to **4** by material |
| triangles | **1,504** for all 24 — 63 each |
| atlases | 3 (cards 2048×969, notes 2048×436, coins 512×512) |

That is the target the brief set — one family for cards, one for notes, one or
two for coins — hit exactly. **No variant here adds a material.** Adding a
thirteenth card design costs one atlas cell and zero materials; the atlas has
room for none, so a thirteenth would mean a 4×4 grid and a re-bake, still at
zero new materials.

### The card was reported FLAT AND PHASING THROUGH

It now has ISO 7810 geometry — **0.09361 × 0.05903 × 0.00083 yd** (85.60 ×
53.98 × 0.76 mm), measured off the mesh — and the build FAILS below a 0.0006
minimum thickness. The broken variant (quarter thickness) is rejected at 0.207.

### Coins differ in SIZE, not just face

Scaled instances of one disc: quarter 0.02653 (100%), nickel 0.02320 (87%),
penny 0.02083 (79%), dime 0.01959 (74%). The register already hands the audio
cue its denomination, so a quarter sounds different from a twenty; different
diameters make that visible as well as audible, and the penny is the only one on
the copper material.

Everything is generic by construction — invented marks, no issuer names, no real
note reproduced.

---

## 5. THE PRESSURE WASHER WAND — SHIP

`tools/blender/hero/build_wand.py` → `Assets/models/hero/pressure_wand.glb`
Renders: `Designs/ProShop/Images/Goal_27/wand/` (Cycles `wand-*`, EEVEE `wand-eevee-*`)

**788 triangles, 9 objects, 3 materials.** Against the hand's 5,179 this is the
cheapest hero asset in the set — it is a belt tool at the lowest frequency, and
it is priced like one. Overall 0.043 × 0.737 × 0.113 yd, of which the lance is
0.540. Grip 0.030 across after being squashed to 0.78 in X: a round section
reads as a broom handle, an oval one reads as something a hand closes on.

Three materials on real part boundaries — the moulded shell, the plumbing steel,
the rubber. The steel is the specular event. Rendered in BOTH engines because it
is glossy; Cycles and EEVEE differ only in the softness of the specular
roll-off on the lance, with no engine-specific surprise (there is nothing
transmissive here, which is where the two engines actually part company).

### The joins, and the controls that prove the instruments work

Six small things on one big thing — the class that shipped the rake's floating
bristles and the register's drawer face. Each join is asserted, and each
assertion was watched failing on a variant that breaks that join and nothing
else, with the other assertions still passing in the same run:

| join | measured | control fired at |
|---|---|---|
| lance → body | embedded 11.17 mm | — |
| collar → body | embedded 4.00 mm | 26.00 mm clear |
| nozzle → lance | meets at 0.60 mm | 7.81 mm clear |
| trigger → body | embedded 8.53 mm | 9.00 mm clear |
| guard → body | embedded 9.35 mm | — |
| grip → body | embedded 20.26 mm | — |
| fitting → grip | embedded 5.95 mm | 25.50 mm clear |
| trigger ∦ guard | clears by 10.30 mm | — |

**Two instrument faults caught here, both worth carrying forward:**

1. **The hose fitting's flange is WIDER than the grip it bolts to**, so not one
   of its vertices landed inside the grip and the surface test correctly called
   it detached — the same shape as the register's drawer face. The fix was not
   to loosen the tolerance until it passed. A real fitting has a *shank* up
   inside the butt, so I modelled the shank; now the instrument measures the
   join instead of being weakened to accept a bad one.

2. **The `break=fitting` control did not fire the first time.** A 30 mm shove
   did not detach a 30 mm shank — it still overlapped, so the "broken" variant
   was still attached and passed. Third instance of this on the project (the
   broom's bristles lifted deeper into their block; the spray's trigger moved
   along the head's 74 mm depth). **A break must exceed the overlap it is meant
   to undo, or the control proves nothing.** Widened to 60 mm; it fires.

### The four rounds

- **R1** — the trigger was effectively invisible: the guard read as an empty
  hoop because the blade swept *backwards* and sat against the grip. The hose
  fitting read as a second barrel firing out of the handle. The grip was a plain
  round cone. The body was a featureless brick.
- **R2** — trigger rebuilt to hang forward into the guard; grip squashed oval
  with a palm swell; fitting shortened to a hex nut; a clamshell parting seam
  added in the existing rubber (a material break on a real part boundary at zero
  new material cost). Then: the trigger sat at the *rear* of the loop with the
  whole front half empty, and the body was still a perfect rectangular slab.
- **R3** — body tapered toward the muzzle; guard re-centred over the trigger.
  The seam overhung the body's bevelled ends and showed as a flat fin sticking
  out past the nose; the steel had a hard black-underside/white-top facet split.
- **R4** — seam inset inside both ends; round walls smooth-shaded with the end
  caps left flat; trigger given a real curl. Side-on it reads unambiguously as a
  pressure washer wand. SHIP.

glTF validated: 0 failed, 0 warnings.

---

## THE LEDGER BOOK — the gutter is measured off the mesh, not authored into it

*(This section was missing when the wand shipped — the asset was built and
committed but never written up. Numbers below are from a re-run, not memory.)*

`tools/blender/hero/build_ledger.py` → `Assets/models/hero/ledger_book.glb`
Renders: `Designs/ProShop/Images/Goal_27/ledger/`

**6,656 triangles, 16 objects, 3 materials.** The most expensive hero asset in
the set, and the one that earns it: the player *reads* this at reading distance,
so the page surface has to survive a close camera. Boards, spine, nine leaves and
one turning leaf.

The page surface is not a flat card. Each leaf is a solved surface with a
**gutter** — `g = drop · exp(−(u/0.34)²)` — so the paper dives toward the spine
the way a bound block actually does, and the fore-edge is wobbled rather than
ruled straight. The left page's UVs are flipped (`u if side > 0 else 1 − u`) so
the ruled artwork does not print backwards across the gutter.

**The assertion that matters is that the gutter is measured, not asserted from
the constant that authored it.** `gutter_depth(leaf)` reads the depth back off
the mesh and fails below 55 % of authored — 16.68 mm measured against 16.5
authored. If the surface solve ever flattens, the number moves; a check that
re-read the authoring constant could not have noticed.

Every leaf is asserted seated in its block (5.23–6.39 mm embedded), the turning
leaf is asserted still bound at the spine (0.00 mm — it is a hinge, not a gap),
and the ribbon is asserted lying on the page it marks (0.19 mm).

---

# REVISION PASS — all six, in the order written

Renders in `Designs/ProShop/Images/Goal_27/{register_rev,money_rev,basket_rev,wand_rev,bag_rev,ledger_closed}/`.

| asset | before | after | materials |
|---|---|---|---|
| Cash register | 728 tris | **3,324** | 4 → 4 |
| Money (24 designs) | 1,504 | **1,504** | 4 → 4 |
| Customer basket | 2,174 | **3,454** | 3 → 3 |
| Pressure wand | 788 | **1,208** | 3 → 3 |
| Checkout bag | 1,740 | **1,828** | 2 → 2 |
| Ledger, closed | *never built* | **1,560** | 3 |

**No asset gained a material.** Every new part boundary reuses a material that
was already on the object.

## 1. The register

Notes are on top now and coins beneath: five channels run the full length of
the floor and the note platform rests on their walls over the rear 52 %, so the
coins genuinely are under the notes and the front of every channel stays open.

| level | measured off the geometry |
|---|---|
| note bay | 0.1966 deep × 0.0930 wide × 0.0220 walls |
| a note is | 0.1706 × 0.0725 — flat, 26 mm to spare |
| clearance above the platform | 0.0490 to the rim (0.0270 above the bay walls) |
| coin channel | 0.0733 wide × 0.0420 deep, open 0.1814 in front |
| a quarter is | 0.0265 |

The monitor is built to the in-game kit spec (`build_checkout_kit.py`): a
0.352 × 0.2225 16:10 glass opening, 0.011 bezel, 0.020 chin, 0.030 deep, tilted
−7°, with the live 0.34 × 0.2125 canvas as its own quad in front of the glass.
It was 0.306 × 0.196 at −16°.

**The box under the monitor is the fixed housing and always was.** The fault
was that it *read* as a drawer. The shell is now a lower carcass and an upper
deck split by a recessed band, so the moving part is the only part that looks
like it moves.

## 2. The money

The interlocking circles are gone from every card, and the generator now
**refuses to write an atlas** that contains a scheme name or any two circles
that overlap without being concentric. Watched it fire by restoring the old
pair: *"two circles at (432.64,77.52) r27.45 and (463.36,77.52) r27.45 overlap
without being concentric"*.

There are no issuer names at all — an invented glyph and a category word — which
is the only way to be certain a name is not somebody's bank.

## 3–6

The basket's handles root in the rim through four pivot bosses; the ribs went
from 22 deep to 12 shallow on a denser section, because the corduroy was
aliasing (2.4 points per rib) as much as design. The wand's grip seats in a
moulded socket and gained a safety catch, quick-connect collar, finger ridges
and a 30° swivel inlet. The bag has been used rather than extruded, and its
cavity was re-measured **after** the deformation:

    floor 0.3249 × 0.1860 · opening 0.3323 × 0.1931 · wall height 0.4133
    at game scale: 0.4387 × 0.2512 · 0.4486 × 0.2607 · 0.5580

The ledger's closed state had **never been built** — `build()` took an `opened`
parameter that nothing in its body ever read.

## The instrument lesson this pass keeps repeating

Five separate parts this session were **wider than the thing they attach to**,
so not one of their vertices landed inside it and a vertex-sampling assertion
called them detached — correctly. The register's insert flange, the wand's
quick-connect collar, the note platform over a 5.5 mm divider, the basket's
handle end, the wand's hose fitting. The fix is never to loosen the tolerance:
either model the shank the real part has, test the join in the other direction,
or use `assert_boxes_overlap`, which exists for exactly this shape.

And a thin box has **no vertices except its end corners**, so any assertion that
samples vertices can only ever sample its ends. That is why burying a divider's
ends 3 mm deeper moved its rooting number by nothing at all.
